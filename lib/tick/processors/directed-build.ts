import type { TickContext, TickProcessorResult } from "../types";
import { pulseShard } from "@/lib/tick/shard";
import { planFactionQueue, type BuildSystemState } from "@/lib/engine/directed-build";
import { fundQueue } from "@/lib/engine/construction";
import { workCostPerLevel } from "@/lib/constants/construction";
import { isEconomicallyActive } from "@/lib/engine/control";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import type { WorldConstructionProject } from "@/lib/world/types";
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
  /** Construction funding: the per-build absorption cap, the pool rate per pop, and a unique-id minter. */
  construction: {
    /** Most construction points one build can absorb per pulse (sets the minimum build time). */
    cap: number;
    /** Construction points a faction's pool gains per unit population per pulse. */
    throughputPerPop: number;
    /** Mints a unique id for each newly-committed project (backed by the world's nextId counter). */
    mintId: () => string;
  };
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
 * `pulseShard`; every other tick is a no-op.
 *
 * Construction is committed and throughput-paced: each due faction's auto queue policy
 * (`planFactionQueue`) proposes whole-level projects toward its ceilings (subtracting the
 * levels already in flight), the faction's per-pulse throughput pool funds the front-first
 * queue (`fundQueue`) at a per-build absorption cap, and only projects whose work COMPLETES
 * land — applied as whole-integer building-count increments. The open-project set is
 * persisted each pulse (funded, plus new commitments, minus what landed). Removal of levels
 * stays whole-level decay's job — this only adds.
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
  const openProjects = await world.getConstructionProjects(dueKeys);

  // Group rows + open projects by faction; plan and fund each faction independently.
  const byFaction = new Map<string | null, SystemBuildRow[]>();
  for (const r of rows) {
    const list = byFaction.get(r.factionId) ?? [];
    list.push(r);
    byFaction.set(r.factionId, list);
  }
  const openByFaction = new Map<string | null, WorldConstructionProject[]>();
  for (const p of openProjects) {
    const list = openByFaction.get(p.factionId) ?? [];
    list.push(p);
    openByFaction.set(p.factionId, list);
  }

  // Current counts per system, to turn a landed whole-level increment into an absolute write.
  const currentBySystem = new Map<string, Record<string, number>>();
  for (const r of rows) currentBySystem.set(r.systemId, r.buildings);

  const landedBySystem = new Map<string, Map<string, number>>();
  const nextOpen: WorldConstructionProject[] = [];

  for (const [factionId, group] of byFaction) {
    // The faction's per-pulse throughput pool: developed systems fund it (controlled/unclaimed
    // systems are inert with population 0). The pool drains the queue; it never enqueues.
    let pool = 0;
    for (const r of group) {
      if (isEconomicallyActive(r.control)) pool += Math.max(0, r.population) * params.construction.throughputPerPop;
    }

    const existing = openByFaction.get(factionId) ?? [];
    // Auto policy proposes new whole-level projects toward the ceilings, aware of what is in flight.
    const desired = planFactionQueue(group.map(toBuildState), params.routeCost, existing);
    const newProjects: WorldConstructionProject[] = desired.map((d) => ({
      id: params.construction.mintId(),
      factionId: d.factionId,
      systemId: d.systemId,
      buildingType: d.buildingType,
      levels: d.levels,
      workTotal: d.levels * workCostPerLevel(d.buildingType),
      workDone: 0,
    }));

    // Fund front-first: finish started work before new commitments; land completed levels.
    const { projects: fundedOpen, landed } = fundQueue([...existing, ...newProjects], pool, params.construction.cap);
    nextOpen.push(...fundedOpen);
    for (const l of landed) {
      const byType = landedBySystem.get(l.systemId) ?? new Map<string, number>();
      byType.set(l.buildingType, (byType.get(l.buildingType) ?? 0) + l.levels);
      landedBySystem.set(l.systemId, byType);
    }
  }

  // Emit absolute new counts = current + landed whole levels (integer).
  const updates: BuildBuildingUpdate[] = [];
  for (const [systemId, byType] of landedBySystem) {
    const current = currentBySystem.get(systemId);
    for (const [buildingType, levels] of byType) {
      if (levels <= 0) continue;
      const cur = current?.[buildingType] ?? 0;
      updates.push({ systemId, buildingType, count: cur + levels });
    }
  }
  if (updates.length > 0) await world.applyBuildingIncreases(updates);

  // Persist the due factions' open set (funded existing + new commitments, minus what landed) —
  // always, so a project that just landed is removed from the queue.
  await world.applyConstructionUpdates(dueKeys, nextOpen);

  return {};
}
