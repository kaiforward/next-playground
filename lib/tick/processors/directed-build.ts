import type { TickContext, TickProcessorResult } from "../types";
import { shardRange } from "@/lib/tick/shard";
import { planFactionBuilds, type BuildSystemState } from "@/lib/engine/directed-build";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
} from "@/lib/tick/world/directed-build-world";

export interface DirectedBuildProcessorParams {
  interval: number;
  /** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
  routeCost: RouteCost;
}

/** Build the engine's per-system build state: capacity + per-good market state (shared derivation). */
function toBuildState(row: SystemBuildRow): BuildSystemState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    population: row.population,
    unrest: row.unrest,
    buildings: row.buildings,
    slotCap: row.slotCap,
    generalSpace: row.generalSpace,
    habitableSpace: row.habitableSpace,
    goods: toGoodMarketStates(row),
  };
}

/**
 * Pure processor body. PER-FACTION shard (mirrors directed-logistics): a contiguous
 * window of the stable faction-key order runs each tick, so every faction is planned
 * once per `interval` ticks. The build engine returns production + housing builds; we
 * apply them as building-count increments (continuous Float). The engine bounds each
 * build to the site's remaining capacity, so counts never exceed capacity. Removal
 * stays disuse-decay's job — this only adds.
 */
export async function runDirectedBuildProcessor(
  world: DirectedBuildWorld,
  ctx: Pick<TickContext, "tick">,
  params: DirectedBuildProcessorParams,
): Promise<TickProcessorResult> {
  const factionKeys = await world.getFactionShardKeys();
  if (factionKeys.length === 0) return {};

  const { start, end } = shardRange(factionKeys.length, ctx.tick, params.interval);
  const dueKeys = factionKeys.slice(start, end);
  if (dueKeys.length === 0) return {};

  const rows = await world.getSystemsForFactions(dueKeys);
  if (rows.length === 0) return {};

  // Group rows by faction; plan each faction independently.
  const byFaction = new Map<string | null, SystemBuildRow[]>();
  for (const r of rows) {
    const list = byFaction.get(r.factionId) ?? [];
    list.push(r);
    byFaction.set(r.factionId, list);
  }

  // Current counts per system, to turn engine "add count" into an absolute write.
  const currentBySystem = new Map<string, Record<string, number>>();
  for (const r of rows) currentBySystem.set(r.systemId, r.buildings);

  // Accumulate added units per system → buildingType across the faction's plans.
  const addedBySystem = new Map<string, Map<string, number>>();
  for (const group of byFaction.values()) {
    const plans = planFactionBuilds(group.map(toBuildState), params.routeCost);
    for (const b of plans) {
      const byType = addedBySystem.get(b.systemId) ?? new Map<string, number>();
      byType.set(b.buildingType, (byType.get(b.buildingType) ?? 0) + b.count);
      addedBySystem.set(b.systemId, byType);
    }
  }
  if (addedBySystem.size === 0) return {};

  // Emit absolute new counts = current + added (continuous Float). The engine already
  // bounds `added` to each site's remaining capacity, so cur + added never exceeds the
  // capacity cap. The per-cycle build budget already represents one shard cycle, so no
  // catch-up scaling is applied (scaling the capacity-bounded output would overshoot it).
  const updates: BuildBuildingUpdate[] = [];
  for (const [systemId, byType] of addedBySystem) {
    const current = currentBySystem.get(systemId);
    for (const [buildingType, added] of byType) {
      if (!Number.isFinite(added) || added <= 0) continue;
      const cur = current?.[buildingType] ?? 0;
      updates.push({ systemId, buildingType, count: cur + added });
    }
  }
  if (updates.length > 0) await world.applyBuildingIncreases(updates);

  return {};
}
