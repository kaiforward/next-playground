import type { TickContext, TickProcessorResult } from "../types";
import { migrationFlow, type MigrationNode } from "@/lib/engine/migration";
import { pulseShard, catchUpFactor } from "@/lib/tick/shard";
import type { EdgeView } from "@/lib/tick/world/trade-flow-topology";
import type {
  MigrationDelta, MigrationProcessorParams, MigrationWorld,
} from "@/lib/tick/world/migration-world";

/**
 * Pure processor body — a twin for people of the population resolution. A
 * monthly-pulse pass over the faction-bounded open edges: the whole edge set
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
  const { start, end } = pulseShard(total, ctx.tick, params.interval);
  const slice: EdgeView[] = edges.slice(start, end);
  if (slice.length === 0) return {};
  const catchUp = catchUpFactor(params.interval);

  const systemIds = new Set<string>();
  for (const e of slice) { systemIds.add(e.aSystemId); systemIds.add(e.bSystemId); }
  const nodes = await world.getNodesForSystems([...systemIds]);
  const nodeById = new Map(nodes.map((n) => [n.systemId, n]));

  // Local per-tick population deltas, so several edges touching one system compose.
  const popDelta = new Map<string, number>();
  const liveNode = (id: string): MigrationNode | null => {
    const n = nodeById.get(id);
    if (!n) return null;
    return { unrest: n.unrest, population: n.population + (popDelta.get(id) ?? 0), popCap: n.popCap };
  };

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
    const fromId = fromIsA ? edge.aSystemId : edge.bSystemId;
    const toId = fromIsA ? edge.bSystemId : edge.aSystemId;
    popDelta.set(fromId, (popDelta.get(fromId) ?? 0) - moved);
    popDelta.set(toId, (popDelta.get(toId) ?? 0) + moved);
  }

  const deltas: MigrationDelta[] = [];
  for (const [systemId, delta] of popDelta) if (delta !== 0) deltas.push({ systemId, delta });
  if (deltas.length > 0) await world.applyMigrationDeltas(deltas);
  return {};
}
