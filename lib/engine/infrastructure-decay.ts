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
 *  - unrest teardown (catastrophic): above a threshold ONE per-system collapse debt accrues at the
 *    severity of the breach per run, and whole levels tear down as it crosses each integer — even
 *    used capacity (the discrete collapse; the infrastructure mirror of the population decline
 *    snowball). Below the threshold the debt resets: collapse is a regime, not a ledger.
 *
 * The catastrophic channel is scoped to the system rather than to each building type, so teardown
 * measures how badly a system is failing and not how many industries it happens to run — a ten-type
 * world and a one-type world at the same unrest shed the same number of levels. Severity ramps it, so
 * unrest just above the threshold is slow and only total unrest reproduces a level per run. Housing
 * is shed only above resident occupancy, so this channel can never strand a population at popCap 0.
 *
 * Both counters are tick-denominated — they accrue `catchUp` per run, so the wall-clock teardown rate
 * is interval-invariant; the buffer and threshold stay in reference-month units. Counts stay whole
 * integers; decay is downward-only and floored at 0. Growth is the directed-build processor's job.
 * popCap recomputes from the surviving housing.
 */
import {
  buildingUsed,
  housingPopCap,
  housingUsed,
  labourParts,
  labourStateFromParts,
  type UtilizationContext,
} from "@/lib/engine/industry";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { clamp } from "@/lib/utils/math";

/** The housing-occupancy primitive lives in industry.ts; re-exported here for callers/tests that read it directly. */
export { housingUsed };

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
  /** The system's fractional unrest-collapse accumulator (the catastrophic channel's state). */
  collapseDebt: number;
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
  /** The system's carried-forward collapse debt: the sub-level remainder, or 0 out of the regime. */
  collapseDebt: number;
  /** popCap recomputed from the post-decay housing count. */
  popCap: number;
}

/**
 * How hard the catastrophic channel bites, ∈ [0,1]: how far unrest sits above θ_decay across the
 * range remaining above it. 0 at or below θ (the channel is off and its debt resets), 1 at unrest 1
 * — where it reproduces one whole level per reference month. Total for every input: a θ ≥ 1 leaves
 * no span to divide by, so anything above it reads full severity rather than NaN.
 */
export function collapseSeverity(unrest: number, threshold: number): number {
  if (unrest <= threshold) return 0;
  const span = 1 - threshold;
  if (span <= 0) return 1;
  return clamp((unrest - threshold) / span, 0, 1);
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
  // Utilization is measured once, against the state the run started in — it drives the idle
  // countdown here and orders the collapse channel below off the same reading.
  const usedByType = new Map<string, number>();

  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const used = buildingUsed(type, count, ctx);
    usedByType.set(type, used);
    const prevIdle = buildingIdleMonths[type] ?? 0;

    // Hysteresis: the countdown accrues elapsed reference-months while ≥1 whole level
    // is idle, and resets the moment it refills.
    let idle = idleLevels(count, used) >= 1 ? prevIdle + catchUp : 0;
    if (idle >= params.idleBufferMonths) {
      newCounts[type] = Math.max(0, count - 1); // shed the marginal idle level and restart its countdown
      idle = 0;
    }
    if (idle !== prevIdle) newIdleMonths[type] = idle;
  }

  // Catastrophic channel: one debt for the whole system, accruing at the severity of the breach
  // rather than a flat rate, and spent at one whole level per eligible type per run. Collapse is a
  // regime, not a ledger — dropping to or below θ clears any sub-level residue.
  const prevDebt = Number.isFinite(input.collapseDebt) ? Math.max(0, input.collapseDebt) : 0;
  const severity = collapseSeverity(unrest, params.unrestThreshold);
  let collapseDebt = severity > 0 ? prevDebt + catchUp * severity : 0;
  let owed = Math.floor(collapseDebt);
  collapseDebt -= owed;

  if (owed > 0) {
    // A level may leave housing only while the one above resident occupancy is spare, so a system
    // holding population can never be torn down to popCap 0 through this channel. An emptied
    // colony's housing is fully eligible — the idle channel prunes that case independently.
    const housingFloor = Math.ceil(housingUsed(population));
    const eligible = [...usedByType.keys()]
      .filter((type) => {
        const count = newCounts[type] ?? buildings[type];
        if (count < 1) return false;
        return type !== HOUSING_TYPE || count - 1 >= housingFloor;
      })
      // Least-used first, ties by ascending type id: what a system is already failing to keep busy
      // goes before what it still leans on, and the outcome never depends on key order.
      .sort((a, b) => {
        const ratioA = (usedByType.get(a) ?? 0) / buildings[a];
        const ratioB = (usedByType.get(b) ?? 0) / buildings[b];
        if (ratioA !== ratioB) return ratioA - ratioB;
        return a < b ? -1 : 1;
      });

    // One level per type per run: the budget spreads across the base instead of gutting a single
    // industry. A system with fewer eligible types than levels owed sheds what it can and the
    // shortfall lapses — only the sub-level remainder carries forward.
    for (const type of eligible) {
      if (owed <= 0) break;
      newCounts[type] = Math.max(0, (newCounts[type] ?? buildings[type]) - 1);
      owed -= 1;
    }
  }

  // popCap tracks the post-decay housing count (POP_BASELINE_FLOOR stays at 0).
  const decayedBuildings = { ...buildings, ...newCounts };
  const popCap = housingPopCap(decayedBuildings) + SUBSTRATE_GEN.POP_BASELINE_FLOOR;
  return { newCounts, newIdleMonths, collapseDebt, popCap };
}
