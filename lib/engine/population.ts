/**
 * Pure population-dynamics functions — zero DB dependency.
 *
 * The consequence spine: measure → accumulate → threshold → effect.
 *  - measure:    dissatisfaction() folds per-good satisfaction into one convex,
 *                demand-weighted number D, and supplyRegime() folds the same goods
 *                into the worst-demanded-good rate class (supplied/rationing/shortage).
 *                D picks the magnitude of the shortfall; the regime picks the rate.
 *  - accumulate: accumulateUnrest() relaxes unrest toward a standing-pressure floor
 *                (tax + crowding) and integrates D on top of it. Equilibrium sits at
 *                the floor by construction, so recovery speed and the tax/crowding
 *                meaning are decoupled; the regime selects both the excess-gain and
 *                the relaxation rate (Supplied recovers faster than Rationing).
 *  - threshold:  strikeMultiplier() derives the production-suppression regime from
 *                unrest — a smooth ramp, not a binary halt. Unrest's own integral
 *                is the hysteresis, so no separate stored strike flag is needed.
 *  - effect:     populationDelta() grows at full rate until the cap, brakes to zero
 *                across [cap, crowdBrakeEnd·cap] via crowdFactor(), declines with
 *                unrest, and — only above the strike-level unrest gate — displaces
 *                housing overshoot as non-conserved death.
 *
 * Each is a small, total function so additions to the spine are new terms, not
 * new branches. Every function is finite for any input (popCap ≤ 0, negative pop,
 * catch-up-scaled rates > 1 included).
 */

import { clamp } from "@/lib/utils/math";
import { SHORTAGE_SATISFACTION } from "@/lib/constants/economy";

/** One consumed good's signal for a system this tick. */
export interface GoodSatisfaction {
  /** delivered / demanded in [0,1]; 1 = well-fed, 0 = floor-pinned. */
  satisfaction: number;
  /** demanded_g = civilian demand (per-capita baseline + skilled baskets) — the demand-share weight. */
  demanded: number;
}

/**
 * Convex, demand-weighted dissatisfaction D in [0,1] for one system:
 *   D = sum_g demandShare_g * (1 - satisfaction_g)^2,  demandShare_g = demanded_g / sum(demanded)
 * Importance comes from demand magnitude (people need ~8x more food than luxuries),
 * not a separate field; convexity makes a deep shortage dominate many shallow ones.
 * Returns 0 when nothing is demanded.
 */
export function dissatisfaction(goods: GoodSatisfaction[]): number {
  let totalDemand = 0;
  for (const g of goods) totalDemand += Math.max(0, g.demanded);
  if (totalDemand <= 0) return 0;
  let d = 0;
  for (const g of goods) {
    const share = Math.max(0, g.demanded) / totalDemand;
    const gap = 1 - clamp(g.satisfaction, 0, 1);
    d += share * gap * gap;
  }
  return d;
}

/** Supply-rate class for a system this tick, from the worst-supplied demanded good. */
export type SupplyRegime = "supplied" | "rationing" | "shortage";

/**
 * Worst-demanded-good fold: "shortage" if any demanded good's satisfaction is below
 * SHORTAGE_SATISFACTION, else "rationing" if any is short of full, else "supplied".
 * Zero-demand goods are ignored; no demanded goods ⇒ "supplied".
 *
 * The regime picks the accumulation *rate* while D picks the *magnitude* — D is already
 * demand-weighted, so a luxury-only shortage yields the fast gain times a small D. Bounded
 * and monotonic; the fold deliberately does no second demand-weighting.
 */
export function supplyRegime(goods: GoodSatisfaction[]): SupplyRegime {
  let regime: SupplyRegime = "supplied";
  for (const g of goods) {
    if (g.demanded <= 0) continue;
    if (g.satisfaction < SHORTAGE_SATISFACTION) return "shortage";
    if (g.satisfaction < 1) regime = "rationing";
  }
  return regime;
}

export interface UnrestParams {
  /** Excess-integration gain per reference month while Rationing. */
  gainRationing: number;
  /** Excess-integration gain while Shortage. */
  gainShortage: number;
  /** Relaxation rate toward the standing-pressure floor while Rationing/Shortage. */
  decay: number;
  /** Faster relaxation while Supplied — the recovery rate. */
  recoveryDecay: number;
}

/**
 * Relaxes unrest toward its standing-pressure floor and integrates dissatisfaction on top:
 *   unrest <- clamp(floor + (1 - k)*(unrest - floor) + gain(regime)*clamp(d,0,1), 0, 1)
 * where k = clamp(regime === "supplied" ? recoveryDecay : decay, 0, 1) and
 * gain = shortage → gainShortage, otherwise gainRationing.
 *
 * `floor` is the standing pressure (tax + crowding), clamped to [0,1] by the caller.
 * At D = 0 unrest settles exactly at `floor` whatever the relaxation rate, so equilibrium
 * and recovery speed are decoupled. Catastrophe lives in the integral — one bad pulse is
 * recoverable, chronic shortage climbs toward 1. The caller pre-scales gains and decays by
 * the catch-up factor; k is clamped after scaling, so a large catch-up can never flip the
 * relaxation term and overshoot below the floor.
 */
export function accumulateUnrest(
  unrest: number,
  d: number,
  floor: number,
  regime: SupplyRegime,
  params: UnrestParams,
): number {
  const k = clamp(regime === "supplied" ? params.recoveryDecay : params.decay, 0, 1);
  const gain = regime === "shortage" ? params.gainShortage : params.gainRationing;
  const relaxed = floor + (1 - k) * (unrest - floor);
  return clamp(relaxed + gain * clamp(d, 0, 1), 0, 1);
}

export interface StrikeParams {
  /** Unrest below this threshold produces no suppression (multiplier 1). */
  threshold: number;
  /** Production multiplier at unrest = 1 (deepest strike); e.g. 0.25 = 75% cut. */
  floorMultiplier: number;
}

/**
 * Production-suppression multiplier derived from unrest, in [floorMultiplier, 1].
 * Returns 1 below threshold, then ramps linearly to floorMultiplier at unrest = 1.
 * A smooth ramp (markets drift, never teleport). Consumption is never suppressed —
 * people still eat regardless of labor action.
 */
export function strikeMultiplier(unrest: number, params: StrikeParams): number {
  if (unrest <= params.threshold) return 1;
  if (params.threshold >= 1) return 1;
  const t = clamp((unrest - params.threshold) / (1 - params.threshold), 0, 1);
  return 1 - t * (1 - params.floorMultiplier);
}

/**
 * Growth brake from overcrowding: 1 while r = population/popCap ≤ 1, smoothstep down to
 * 0 at r = crowdBrakeEnd. popCap ≤ 0 reads fully crowded (0) — never Infinity/NaN. Total.
 */
export function crowdFactor(population: number, popCap: number, crowdBrakeEnd: number): number {
  if (popCap <= 0) return 0;
  const span = crowdBrakeEnd - 1;
  if (span <= 0) return population > popCap ? 0 : 1;
  const t = clamp((population / popCap - 1) / span, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Bounded standing unrest pressure from overcrowding: 0 at r ≤ 1, linear to maxPressure at
 * r ≥ brakeEnd. popCap ≤ 0 with population > 0 ⇒ maxPressure (fully crowded); both ≤ 0 ⇒ 0.
 * Total and finite for any input. Bounded by maxPressure so overcrowding alone can never
 * push the standing floor to the strike threshold.
 */
export function crowdingPressure(
  population: number,
  popCap: number,
  brakeEnd: number,
  maxPressure: number,
): number {
  if (popCap <= 0) return population > 0 ? maxPressure : 0;
  const span = brakeEnd - 1;
  if (span <= 0) return population > popCap ? maxPressure : 0;
  const t = clamp((population / popCap - 1) / span, 0, 1);
  return t * maxPressure;
}

export interface PopulationParams {
  /** Growth rate at full satisfaction, calm, and uncrowded (r ≤ 1). */
  growthRate: number;
  /** Decline rate scaled by unrest. */
  declineRate: number;
  /**
   * Fraction of housing-overshoot (population − popCap) removed as death per run,
   * scaled by unrest. Fires only in the collapse regime (unrest above the gate) — a
   * non-conserved sink, distinct from conserved migration.
   */
  overshootDeathRate: number;
  /** r = population/popCap at which the growth brake reaches zero. */
  crowdBrakeEnd: number;
  /** Unrest above which the overshoot-death term fires (collapse regime only). */
  overshootDeathUnrestGate: number;
}

/**
 * Population change for one tick:
 *   growth  = growthRate * pop * crowdFactor(pop, popCap, crowdBrakeEnd) * (1 - D)
 *   decline = declineRate * pop * clamp(unrest, 0, 1)
 *   death   = unrest > overshootDeathUnrestGate
 *               ? overshootDeathRate * max(0, pop - popCap) * clamp(unrest, 0, 1) : 0
 *   delta   = growth - decline - death
 * Fed and calm: grows at full rate until the cap, then the crowd brake ramps growth to
 * zero across [popCap, crowdBrakeEnd·popCap] (no runaway past housing). popCap ≤ 0 zeroes
 * growth via crowdFactor. Starved or unstable: net-declines. Housing-overshoot displacement:
 * once housing has rotted below its occupants AND unrest is in the strike regime, the
 * non-conserved death portion is removed here, unrest-weighted, so a violent collapse is
 * death-dominant. The conserved migration half is handled by the migration engine's explicit
 * overshoot coupling (negative headroom → repels outward migration).
 */
export function populationDelta(
  population: number,
  popCap: number,
  d: number,
  unrest: number,
  params: PopulationParams,
): number {
  const satisfactionFactor = clamp(1 - d, 0, 1);
  const growth =
    params.growthRate * population * crowdFactor(population, popCap, params.crowdBrakeEnd) * satisfactionFactor;
  const decline = params.declineRate * population * clamp(unrest, 0, 1);
  const death =
    unrest > params.overshootDeathUnrestGate
      ? params.overshootDeathRate * Math.max(0, population - popCap) * clamp(unrest, 0, 1)
      : 0;
  return growth - decline - death;
}
