import type { TickContext, TickProcessorResult } from "../types";
import { pulseShard } from "@/lib/tick/shard";
import { planFactionBuilds, type BuildSystemState } from "@/lib/engine/directed-build";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
  SystemClaim,
  SystemDevelopment,
} from "@/lib/tick/world/directed-build-world";
import {
  proposeFactionClaims,
  resolveClaims,
  planFactionDevelopments,
  type ClaimCandidate,
  type ClaimProposal,
  type DevelopCandidate,
  type ExpansionParams,
  type DevelopParams,
} from "@/lib/engine/expansion";
import type { RNG } from "@/lib/engine/universe-gen";

export interface DirectedBuildProcessorParams {
  interval: number;
  /** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
  routeCost: RouteCost;
  /** Claim step (control tier). Omitted → no claim phase (the build-only path used by engine/adapter tests). */
  claim?: {
    reachProvider: (factionId: string) => ClaimCandidate[];
    rng: RNG;
    params: ExpansionParams;
  };
  /** Develop step (developed tier + colony seed). Omitted → no develop phase. */
  develop?: {
    candidateProvider: (factionId: string) => DevelopCandidate[];
    params: DevelopParams;
  };
}

/** Build the engine's per-system build state: capacity + per-good market state (shared derivation). */
function toBuildState(row: SystemBuildRow): BuildSystemState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    control: row.control,
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
 * Pure processor body. Monthly resolution pulse (mirrors directed-logistics): on the
 * boundary tick (`tick % interval === 0`) every faction is planned at once via
 * `pulseShard`; every other tick is a no-op. The build engine returns production +
 * housing builds; we
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

  const { start, end } = pulseShard(factionKeys.length, ctx.tick, params.interval);
  const dueKeys = factionKeys.slice(start, end);
  if (dueKeys.length === 0) return {};

  // ── Claim phase (control tier): every due faction proposes its best in-reach claim; conflicts
  // resolve deterministically (score, seeded-RNG ties); winners are written as ownership assignments.
  // Newly claimed systems are `controlled` (not developed), so the build phase ignores them this pulse. ──
  if (params.claim) {
    const proposals: ClaimProposal[] = [];
    for (const key of dueKeys) {
      if (key === null) continue;
      proposals.push(...proposeFactionClaims(key, params.claim.reachProvider(key), params.claim.params));
    }
    const resolved: SystemClaim[] = resolveClaims(proposals, params.claim.rng);
    if (resolved.length > 0) await world.applyClaims(resolved);
  }

  // ── Develop phase (developed tier): each due faction develops its best controlled system(s) —
  // intra-faction, so no cross-faction resolution. The colony seed is conserved (transferred from the
  // source in tick.ts). Systems developed this pulse become build-eligible next pulse. ──
  if (params.develop) {
    const developments: SystemDevelopment[] = [];
    for (const key of dueKeys) {
      if (key === null) continue;
      developments.push(...planFactionDevelopments(params.develop.candidateProvider(key), params.develop.params));
    }
    if (developments.length > 0) await world.applyDevelopments(developments);
  }

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
