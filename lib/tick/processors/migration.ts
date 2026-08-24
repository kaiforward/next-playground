import type { TickContext, TickProcessorResult } from "../types";
import { migrationFlow, type MigrationNode } from "@/lib/engine/migration";
import { allocateColonists } from "@/lib/engine/colonist-delivery";
import { cycleStartShard, catchUpFactor } from "@/lib/tick/shard";
import type { EdgeView } from "@/lib/tick/world/trade-flow-topology";
import type {
  MigrationDelta, MigrationProcessorParams, MigrationWorld,
} from "@/lib/tick/world/migration-world";

/**
 * Pure processor body — a twin for people of the population resolution. A
 * cycle-start pass over the faction-bounded open edges: the whole edge set
 * resolves on the boundary tick (`tick % interval === 0`), empty otherwise.
 * Population flows toward the more attractive (calmer, roomier) endpoint,
 * distance-attenuated, conserved. Deltas compose across edges within the tick so
 * a hub touched by several edges nets correctly. The per-edge moved amount is
 * scaled by `catchUpFactor(interval)` so the wall-clock migration rate is
 * interval-invariant.
 */
export async function runMigrationProcessor(
  world: MigrationWorld,
  ctx: TickContext,
  params: MigrationProcessorParams,
): Promise<TickProcessorResult> {
  const edges = await world.getOpenEdges();
  if (edges.length === 0) return {};

  const total = edges.length;
  const { start, end } = cycleStartShard(total, ctx.tick, params.interval);
  const slice: EdgeView[] = edges.slice(start, end);
  if (slice.length === 0) return {};
  const catchUp = catchUpFactor(params.interval);

  // Colonist delivery (targeted, equalising) — runs on the same cycle start as the edge sweep, BEFORE
  // diffusion, so diffusion balances the post-delivery state and colony delivery is the primary flow.
  // Faction pools of drawable spare are water-filled to raise the emptiest colonies (reaches the frontier
  // that gradient diffusion never could). Applied first so getNodesForSystems below reads the updated pop.
  // Famine inflow gate (Rule 1): a system currently in survival shortfall is flagged so its sink
  // headroom reads 0 — it can still donate, but water-fill gives it nothing.
  const developedRaw = await world.getDevelopedSystems();
  const developed = params.inflowBlockedSystemIds.size === 0
    ? developedRaw
    : developedRaw.map((s) =>
      params.inflowBlockedSystemIds.has(s.systemId) ? { ...s, inflowBlocked: true } : s,
    );
  const deliveryDeltas = allocateColonists(developed, params.delivery);
  if (deliveryDeltas.length > 0) await world.applyMigrationDeltas(deliveryDeltas);

  // Calibration instrumentation: the delivered amount is the sum of the positive (sink) side of
  // the conserved deltas — equal in magnitude to what sources gave, since allocateColonists nets
  // to zero per faction. Never broadcast, never persisted — see TickInstrumentation.
  let colonistsMoved = 0;
  // Same positive (sink) side, kept per-system rather than summed — the harness's pump-watch cohort
  // fold needs the per-system figure; a source's negative delta is deliberately excluded, matching
  // colonistsMoved's own convention above.
  const colonistDeliveryBySystem = new Map<string, number>();
  for (const d of deliveryDeltas) {
    if (!Number.isFinite(d.delta) || d.delta <= 0) continue;
    colonistsMoved += d.delta;
    colonistDeliveryBySystem.set(d.systemId, (colonistDeliveryBySystem.get(d.systemId) ?? 0) + d.delta);
  }

  const systemIds = new Set<string>();
  for (const e of slice) { systemIds.add(e.aSystemId); systemIds.add(e.bSystemId); }
  const nodes = await world.getNodesForSystems([...systemIds]);
  const nodeById = new Map(nodes.map((n) => [n.systemId, n]));

  // Local per-tick population deltas, so several edges touching one system compose.
  const popDelta = new Map<string, number>();
  const liveNode = (id: string): MigrationNode | null => {
    const n = nodeById.get(id);
    if (!n) return null;
    // labourDemand is building-derived (static within a cycle); population keeps its live
    // intra-tick delta so open jobs shrink correctly as pop arrives across several edges.
    // Famine inflow gate (Rule 1): flag reaches diffusion too — delivery's freed headroom must not
    // just hand the refill to the edge sweep on the same tick.
    return {
      unrest: n.unrest, population: n.population + (popDelta.get(id) ?? 0), popCap: n.popCap,
      labourDemand: n.labourDemand, inflowBlocked: params.inflowBlockedSystemIds.has(id),
    };
  };

  // Calibration instrumentation: the gross per-edge amount moved, summed as each edge resolves —
  // distinct from popDelta's net-per-system composition, which is what several edges touching one
  // hub actually apply.
  let diffusionMoved = 0;
  for (const edge of slice) {
    const a = liveNode(edge.aSystemId);
    const b = liveNode(edge.bSystemId);
    if (!a || !b) continue;
    const { fromIsA, quantity } = migrationFlow(a, b, edge.fuelCost, params.flow);
    // Catch-up: one shard run represents `interval / REFERENCE_INTERVAL` reference
    // periods of migration (1 at the reference interval). Conserved — the same
    // scaled amount leaves `from` and arrives at `to`.
    const moved = quantity * catchUp;
    if (!Number.isFinite(moved) || moved <= 0) continue;
    diffusionMoved += moved;
    const fromId = fromIsA ? edge.aSystemId : edge.bSystemId;
    const toId = fromIsA ? edge.bSystemId : edge.aSystemId;
    popDelta.set(fromId, (popDelta.get(fromId) ?? 0) - moved);
    popDelta.set(toId, (popDelta.get(toId) ?? 0) + moved);
  }

  const deltas: MigrationDelta[] = [];
  for (const [systemId, delta] of popDelta) if (delta !== 0) deltas.push({ systemId, delta });
  if (deltas.length > 0) await world.applyMigrationDeltas(deltas);
  return {
    migrationMoved: { colonists: colonistsMoved, diffusion: diffusionMoved },
    ...(colonistDeliveryBySystem.size > 0 ? { colonistDeliveryBySystem } : {}),
  };
}
