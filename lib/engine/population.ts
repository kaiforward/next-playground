/**
 * Pure population-dynamics functions — zero DB dependency.
 *
 * The consequence spine: measure → accumulate → threshold → effect.
 *  - measure:    dissatisfaction() folds per-good satisfaction into one convex number D
 *                weighted by demand × authored necessity, and foldSupplyState() classes
 *                the same goods as supplied/rationing/shortage — a cut on D plus a
 *                water/food survival floor. D picks the magnitude of the shortfall;
 *                the class picks the relaxation rate and carries the survival bit.
 *  - accumulate: accumulateUnrest() relaxes unrest toward a standing-pressure floor
 *                (tax + crowding) and integrates D on top of it, with gain =
 *                unrestSlope(D, survivalShortfall) × the relaxation rate. Equilibrium is
 *                therefore min(1, floor + slope × D) at any rate, so the named slopes
 *                state exchange rates and recovery speed, catch-up and equilibrium are
 *                all decoupled (Supplied recovers faster than Rationing).
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
import { SHORTAGE_SATISFACTION, D_SHORTAGE_CUT, D_SHORTAGE_BLEND } from "@/lib/constants/economy";
import { GOOD_NECESSITY, SURVIVAL_GOODS } from "@/lib/constants/physical-economy";

/** One consumed good's signal for a system this tick. */
export interface GoodSatisfaction {
  /** Which good this reading is for — resolves its GOOD_NECESSITY weight and survival status. */
  goodId: string;
  /** delivered / demanded in [0,1]; 1 = well-fed, 0 = floor-pinned. */
  satisfaction: number;
  /** demanded_g = civilian demand (per-capita baseline + skilled baskets). */
  demanded: number;
}

/** demanded × necessity — the fold's weight. An unweighted good contributes nothing, either way. */
function goodWeight(g: GoodSatisfaction): number {
  return Math.max(0, g.demanded) * Math.max(0, GOOD_NECESSITY[g.goodId] ?? 0);
}

/**
 * Convex, necessity-weighted dissatisfaction D in [0,1] for one system:
 *   weight_g = demanded_g × necessity_g,  share_g = weight_g / Σ weight
 *   D        = Σ share_g × (1 − satisfaction_g)²
 * Importance is the AUTHORED necessity weight times how much is actually wanted — demand volume alone
 * is a tier gradient and ranks medicine below gas. Convexity makes a deep shortage dominate many
 * shallow ones. Necessity is resolved from goodId here rather than passed in, so no call site can
 * diverge on the table. Returns 0 when Σ weight ≤ 0.
 */
export function dissatisfaction(goods: GoodSatisfaction[]): number {
  let totalWeight = 0;
  for (const g of goods) totalWeight += goodWeight(g);
  if (totalWeight <= 0) return 0;
  let d = 0;
  for (const g of goods) {
    const share = goodWeight(g) / totalWeight;
    const gap = 1 - clamp(g.satisfaction, 0, 1);
    d += share * gap * gap;
  }
  return d;
}

/** Supply-rate class for a system this tick. */
export type SupplyRegime = "supplied" | "rationing" | "shortage";

/**
 * The system's supply reading. `survivalShortfall` is carried alongside the label because the two
 * drive different things: the label picks the relaxation rate, the shortfall promotes the unrest
 * slope to the Shortage bound (see unrestSlope). It cannot be inferred back from the label —
 * a D-driven Shortage and a survival-driven one carry the same label and must not carry the same
 * slope shape.
 */
export interface SupplyState {
  regime: SupplyRegime;
  /** A demanded survival good (water/food) is below SHORTAGE_SATISFACTION. */
  survivalShortfall: boolean;
}

/** Is a demanded survival good below the shortage line? */
function hasSurvivalShortfall(goods: GoodSatisfaction[]): boolean {
  for (const g of goods) {
    if (g.demanded <= 0 || !SURVIVAL_GOODS.includes(g.goodId)) continue;
    if (clamp(g.satisfaction, 0, 1) < SHORTAGE_SATISFACTION) return true;
  }
  return false;
}

/**
 * The SYSTEM-level supply label, from the dissatisfaction the same goods folded to plus the
 * survival-good floor:
 *  - shortage  — D ≥ D_SHORTAGE_CUT, or a demanded survival good below SHORTAGE_SATISFACTION.
 *  - supplied  — D exactly 0. Reachable exactly, not approximately: delivery is full while stock
 *                covers the ration knee, so every gap above it is exactly 0.
 *  - rationing — anything in between.
 * `d` is the caller's own `dissatisfaction(goods)` over the SAME array, passed rather than recomputed
 * so the two folds cannot diverge. This label is about the whole system; the per-good chips read
 * stock cover and are a different labelling entirely.
 */
export function foldSupplyState(goods: GoodSatisfaction[], d: number): SupplyState {
  const survivalShortfall = hasSurvivalShortfall(goods);
  if (survivalShortfall) return { regime: "shortage", survivalShortfall };
  if (d >= D_SHORTAGE_CUT) return { regime: "shortage", survivalShortfall };
  return { regime: d > 0 ? "rationing" : "supplied", survivalShortfall };
}

export interface UnrestParams {
  /** Settled unrest ABOVE the standing floor, per unit of D, while Rationing — an exchange rate, not
   *  a cap. It equals settled unrest only at D = 1, which does not occur (mean D ~0.15); the state
   *  itself is [0,1] and saturates there. */
  slopeRationing: number;
  /** …and while Shortage. Strictly above slopeRationing. */
  slopeShortage: number;
  /** Relaxation rate toward the standing-pressure floor while Rationing/Shortage. */
  decay: number;
  /** Faster relaxation while Supplied — the recovery rate. */
  recoveryDecay: number;
}

/**
 * The unrest-per-D slope this reading carries, in slopeRationing…slopeShortage.
 *
 * Two selectors, deliberately shaped differently. D drives a CONTINUOUS ramp across
 * [D_SHORTAGE_CUT, D_SHORTAGE_CUT + D_SHORTAGE_BLEND]: switching there would double a system's
 * settled unrest for an arbitrarily small change in delivered goods and land that step across strike
 * onset. The ramp starts at the cut, so the slope is exactly slopeRationing across the whole
 * Rationing range and the containment guarantee holds at the top of it. A survival shortfall is a
 * step to slopeShortage: famine in water or food is graded as famine whatever the fold says, which
 * is the guarantee the floor exists to make explicit rather than hope emerges from a squared average.
 * Total and monotone in both inputs.
 */
export function unrestSlope(d: number, survivalShortfall: boolean, params: UnrestParams): number {
  if (survivalShortfall) return params.slopeShortage;
  const ramp = D_SHORTAGE_BLEND > 0
    ? clamp((d - D_SHORTAGE_CUT) / D_SHORTAGE_BLEND, 0, 1)
    : (d >= D_SHORTAGE_CUT ? 1 : 0);
  return params.slopeRationing + ramp * (params.slopeShortage - params.slopeRationing);
}

/**
 * Relaxes unrest toward its standing-pressure floor and integrates dissatisfaction on top:
 *   unrest <- clamp(floor + (1 - k)*(unrest - floor) + slope*k*clamp(d,0,1), 0, 1)
 * where k = clamp(supplied ? recoveryDecay : decay, 0, 1) and slope = unrestSlope(d, …).
 *
 * Because the gain is `slope × k` rather than an independent number, the fixed point is
 * `min(1, floor + slope × D)` for ANY relaxation rate — so equilibrium, recovery speed and the
 * tick's catch-up factor are fully decoupled, and each slope constant states an exchange rate
 * rather than implying one through a ratio. `floor` is the standing pressure (tax + crowding),
 * clamped to [0,1] by the caller; at D = 0 unrest settles exactly at `floor`.
 *
 * The `min` is load-bearing, not defensive: unrest is a [0,1] state while the slopes exceed 1, so
 * `floor + slope × D` can ask for more than the state can hold. That only happens in the extreme
 * corner (highest tax + full crowding + a total food failure asks ~1.16), where distinct severities
 * do collapse to a single maxed-out reading — the graduated response holds everywhere below it.
 *
 * Catastrophe still lives in the integral — one bad cycle is recoverable, chronic shortage climbs
 * toward the settled level. The caller pre-scales the decays by the catch-up factor (never the
 * slopes); k is clamped after scaling, so a large catch-up can never flip the relaxation term and
 * overshoot below the floor.
 */
export function accumulateUnrest(
  unrest: number,
  d: number,
  floor: number,
  supply: SupplyState,
  params: UnrestParams,
): number {
  const k = clamp(supply.regime === "supplied" ? params.recoveryDecay : params.decay, 0, 1);
  const slope = unrestSlope(d, supply.survivalShortfall, params);
  const relaxed = floor + (1 - k) * (unrest - floor);
  return clamp(relaxed + slope * k * clamp(d, 0, 1), 0, 1);
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
  /**
   * r = population/popCap at which the growth brake reaches zero — shared boundary for two
   * consumers: the growth brake here in populationDelta(), and (threaded by the population
   * processor) the standing crowding-pressure ramp end in crowdingPressure().
   */
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
