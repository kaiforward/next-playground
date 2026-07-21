/**
 * Pure whole-level infrastructure decay — zero DB dependency.
 *
 * Capacity is a ratchet: construction adds whole levels, decay removes whole levels. Each decay run
 * measures a building's utilization (resolved uniformly by `buildingUsed`, dispatched on its typed
 * output) and:
 *  - idle contraction (buffered): while a whole level sits idle, a per-(system, type) countdown accrues
 *    the run's catch-up factor (elapsed reference-months); only after a sustained-idle buffer does the
 *    marginal idle level tear down — and the countdown resets the moment it refills, so a brief dip
 *    costs nothing.
 *  - unrest teardown (catastrophic): above a threshold a per-(system, type) collapse debt accrues the
 *    catch-up factor per run and whole levels tear down as the debt crosses each integer — even used
 *    capacity (the discrete collapse; the infrastructure mirror of the population decline snowball).
 *    Below the threshold the debt resets: collapse is a regime, not a ledger.
 *
 * Both counters are tick-denominated — they accrue `catchUp` per run, so the wall-clock teardown rate
 * is interval-invariant; the buffer and threshold stay in reference-month units. Counts stay whole
 * integers; decay is downward-only and floored at 0. Growth is the directed-build processor's job.
 * popCap recomputes from the surviving housing.
 */
import {
  buildingUsed,
  housingPopCap,
  labourParts,
  labourStateFromParts,
  type UtilizationContext,
} from "@/lib/engine/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

/** The housing-occupancy primitive lives in industry.ts; re-exported here for callers/tests that read it directly. */
export { housingUsed } from "@/lib/engine/industry";

export interface DecayParams {
  /** Sustained-idle runs (≈ months) a level must stay idle before the marginal level tears down. ≥ 1. */
  idleBufferMonths: number;
  /** θ_decay: unrest strictly above this tears down a whole level immediately (the discrete collapse). */
  unrestThreshold: number;
}

export interface SystemDecayInput {
  /** buildingType → whole-integer level count. */
  buildings: Record<string, number>;
  /** buildingType → current sustained-idle countdown (the decay buffer's state). */
  buildingIdleMonths: Record<string, number>;
  /** buildingType → fractional unrest-collapse accumulator (the catastrophic channel's state). */
  buildingCollapseDebt: Record<string, number>;
  population: number;
  /** Stored unrest integral 0…1. */
  unrest: number;
  /** Per produced-good isolated selling factor ∈ [0,1]; missing ⇒ 1. */
  sellingFactor: (goodId: string) => number;
  logisticsFundingBound?: (goodId: string) => boolean;
}

export interface SystemDecayResult {
  /** buildingType → new (strictly lower) integer count. Only entries that lost a whole level. */
  newCounts: Record<string, number>;
  /** buildingType → new idle countdown. Only entries whose countdown changed. */
  newIdleMonths: Record<string, number>;
  /** buildingType → new collapse debt. Only entries whose debt changed. */
  newCollapseDebt: Record<string, number>;
  /** popCap recomputed from the post-decay housing count. */
  popCap: number;
}

/**
 * Whole levels of `type` currently sitting idle: the integer count minus its utilization, floored.
 * A level counts as idle only when a FULL level's capacity is unused. Housing occupancy can exceed
 * its own count (over-crowding), which yields a negative gap → never idle.
 */
export function idleLevels(count: number, used: number): number {
  return Math.floor(count - used);
}

/**
 * Decay one system's whole built base by whole levels. Labour state is computed once and reused across
 * every building (the headcount gate + two skill-ceiling gates); selling is per produced good. Returns
 * the building types whose count fell and whose idle countdown changed, plus the recomputed popCap.
 */
export function computeSystemDecay(
  input: SystemDecayInput,
  params: DecayParams,
  /** Rate multiplier for this run (interval / REFERENCE_INTERVAL); 1 = reference cadence. */
  catchUp = 1,
): SystemDecayResult {
  const { buildings, buildingIdleMonths, population, unrest } = input;
  const parts = labourParts(buildings);
  const state = labourStateFromParts(parts, population);
  const ctx: UtilizationContext = {
    buildings,
    population,
    parts,
    state,
    sellingFactor: input.sellingFactor,
    logisticsFundingBound: input.logisticsFundingBound,
  };

  const newCounts: Record<string, number> = {};
  const newIdleMonths: Record<string, number> = {};
  const newCollapseDebt: Record<string, number> = {};

  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const used = buildingUsed(type, count, ctx);
    const prevIdle = buildingIdleMonths[type] ?? 0;

    // Hysteresis: the countdown accrues elapsed reference-months while ≥1 whole level
    // is idle, and resets the moment it refills.
    let idle = idleLevels(count, used) >= 1 ? prevIdle + catchUp : 0;
    let removed = 0;
    if (idle >= params.idleBufferMonths) {
      removed += 1; // shed the marginal idle level and restart its countdown
      idle = 0;
    }

    // Catastrophic channel: above the threshold, teardown accrues at one whole level per
    // reference-month; whole levels tear down as the debt crosses each integer. Collapse is
    // a regime, not a ledger — dropping below the threshold clears any sub-level residue.
    const prevDebt = input.buildingCollapseDebt[type] ?? 0;
    let debt = unrest > params.unrestThreshold ? prevDebt + catchUp : 0;
    const collapsed = Math.floor(debt);
    removed += collapsed;
    debt -= collapsed;

    if (removed > 0) newCounts[type] = Math.max(0, count - removed);
    if (idle !== prevIdle) newIdleMonths[type] = idle;
    if (debt !== prevDebt) newCollapseDebt[type] = debt;
  }

  // popCap tracks the post-decay housing count (POP_BASELINE_FLOOR stays at 0).
  const decayedBuildings = { ...buildings, ...newCounts };
  const popCap = housingPopCap(decayedBuildings) + SUBSTRATE_GEN.POP_BASELINE_FLOOR;
  return { newCounts, newIdleMonths, newCollapseDebt, popCap };
}
