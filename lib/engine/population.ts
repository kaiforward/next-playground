/**
 * Pure population-dynamics functions — zero DB dependency.
 *
 * The consequence spine: measure → accumulate → threshold → effect.
 *  - measure:    dissatisfaction() is the complement of provision() — 1 minus the
 *                necessity-and-demand-weighted MEAN of per-good satisfaction — so a partial
 *                shortfall reads its own size rather than a squared fraction of it.
 *                foldSupplyState() bins the same goods into four descriptive bands from
 *                provision() alone (Supplied/Strained/Rationing/Deprived), plus a water/food
 *                survival floor that punches through to Famine whatever Provision says. The band gates
 *                no rate or effect (accumulateUnrest reads one relaxation rate for every label);
 *                the survival bit, the critical-good weight (goods deep below the criticality
 *                line) and the empty-basket bit ride alongside the label for supplyUnrestTerm to
 *                read instead.
 *  - accumulate: accumulateUnrest() relaxes unrest toward a standing-pressure floor
 *                (tax + crowding) and integrates the supply term on top of it, with gain =
 *                the relaxation rate × supplyUnrestTerm(grievance, D, supply). Equilibrium is
 *                therefore min(1, floor + term) at any rate, so recovery speed, catch-up and
 *                equilibrium are all decoupled. The term itself is whichever reads larger of a
 *                memory-relative grievance reading and an absolute crisis reading (see
 *                supplyUnrestTerm) — famine and critical-good collapse stay absolute; everything
 *                else is judged against what a population has grown accustomed to.
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
import {
  SHORTAGE_SATISFACTION,
  SUPPLIED_PROVISION,
  RATIONING_PROVISION,
  DEPRIVED_PROVISION,
  CRITICAL_SATISFACTION,
  BAND_MIN_DEMAND_SHARE,
} from "@/lib/constants/economy";
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

/** demanded × necessity — the fold's weight. An unweighted good contributes nothing, either way.
 *  A non-finite `demanded` contributes zero weight rather than propagating — mirrors
 *  clampSatisfaction()'s reasoning: a corrupted reading cannot claim weight in the fold, it can only
 *  read as absent from it. */
function goodWeight(g: GoodSatisfaction): number {
  const demanded = Number.isFinite(g.demanded) ? Math.max(0, g.demanded) : 0;
  return demanded * Math.max(0, GOOD_NECESSITY[g.goodId] ?? 0);
}

/** Σ goodWeight over the basket — the same sum provision() folds over, extracted so foldSupplyState()
 *  can read the empty-basket condition (Σ weight ≤ 0) without re-implementing the fold. */
function totalGoodWeight(goods: GoodSatisfaction[]): number {
  let total = 0;
  for (const g of goods) total += goodWeight(g);
  return total;
}

/** Satisfaction clamped into [0,1]; NaN clamps to 0 rather than propagating — a corrupted read must
 *  read as the worst case, never silently pass a NaN into a mean (or, worse, into the world). */
function clampSatisfaction(satisfaction: number): number {
  return Number.isNaN(satisfaction) ? 0 : clamp(satisfaction, 0, 1);
}

/**
 * Provision computed against an ALREADY-KNOWN total basket weight — the shared core `provision()`
 * below and `foldSupplyState()` both call, so a caller that needs both Provision and the
 * empty-basket bit off the same goods array (foldSupplyState does) sums the basket exactly once,
 * not twice. `totalWeight` is trusted as-is: the caller owns computing it (via `totalGoodWeight`),
 * so this never re-derives it.
 */
function provisionFromWeight(goods: GoodSatisfaction[], totalWeight: number): number {
  if (totalWeight <= 0) return 1;
  let mean = 0;
  for (const g of goods) {
    const share = goodWeight(g) / totalWeight;
    mean += share * clampSatisfaction(g.satisfaction);
  }
  return mean;
}

/**
 * Provision: the necessity-and-demand-weighted MEAN of per-good satisfaction, in [0,1]:
 *   weight_g = demanded_g × necessity_g,  share_g = weight_g / Σ weight
 *   Provision = Σ share_g × satisfaction_g
 * Averaged, not squared-and-averaged, so a uniform partial shortfall reads its own size rather than
 * its square. dissatisfaction() below is exactly 1 − provision() — one implementation, two names, so
 * the two cannot drift apart.
 * Read directly: 100% = everything demanded arrived, or nothing is demanded at all; 50% = half of
 * what this world needs, weighted by how badly it needs it, is not arriving.
 * Returns 1 when Σ weight ≤ 0 — the empty basket (or a basket of goods nobody here demands or needs)
 * reads as fully provisioned, the complement of dissatisfaction()'s 0 for the same case. That value is
 * load-bearing: it is what an emptying world reads on its way out.
 */
export function provision(goods: GoodSatisfaction[]): number {
  return provisionFromWeight(goods, totalGoodWeight(goods));
}

/**
 * Necessity-weighted dissatisfaction D in [0,1] for one system — the exact complement of provision():
 *   D = 1 − provision(goods)
 * One implementation, two names, so the sim's Provision fold and the pop-needs display twin
 * (pop-needs.ts) cannot drift apart — both read the absolute per-good gap. That lockstep is with
 * the Provision fold only: the unrest spine no longer integrates this shortfall directly, it reads
 * grievance against a persisted memory of Provision (`grievanceShortfall`, below), with this
 * absolute reading kept alive as the crisis-term backstop and for growth/display. A partial
 * shortfall now reads its own size (a 17% uniform shortfall folds to ~0.17,
 * against the old squared fold's ~0.029) rather than a squared fraction of it — the old convexity,
 * where one deep shortage dominated many shallow ones, is gone: this fold responds identically to any
 * redistribution of the same total weighted gap. Importance is still the AUTHORED necessity weight
 * times how much is actually wanted — demand volume alone is a tier gradient and ranks medicine below
 * gas. Necessity is resolved from goodId here (via provision()) rather than passed in, so no call site
 * can diverge on the table. Returns 0 when Σ weight ≤ 0, the complement of provision()'s 1 for the
 * same basket.
 */
export function dissatisfaction(goods: GoodSatisfaction[]): number {
  return 1 - provision(goods);
}

/**
 * One demanded good's reading for the worst-good tail. `demandShare` is this good's share of the
 * world's total civilian DEMAND (Σ demanded over demanded goods) — deliberately NOT weighted by
 * necessity, because a demand-share floor filters tiny demand, not low importance. `necessity` is
 * carried alongside, unused here, so a necessity-floor variant can be decided from the same reading
 * without re-deriving either quantity.
 */
export interface DemandedGoodReading {
  goodId: string;
  /** Clamped into [0,1]; a non-finite input reads 0 rather than propagating. */
  satisfaction: number;
  demandShare: number;
  necessity: number;
}

/**
 * The `count` demanded goods with the lowest satisfaction, ascending, ties broken by descending
 * demandShare — the more-wanted of two equally-bad goods surfaces first. Goods with `demanded <= 0`
 * are not readings at all: a good nobody here demands cannot be "the worst demanded good". Returns
 * fewer than `count` entries rather than padding when the world demands fewer goods than that.
 */
export function worstDemandedGoods(goods: GoodSatisfaction[], count: number): DemandedGoodReading[] {
  const demanded = goods.filter((g) => g.demanded > 0);
  let totalDemand = 0;
  for (const g of demanded) totalDemand += g.demanded;
  const readings = demanded.map((g) => ({
    goodId: g.goodId,
    satisfaction: clampSatisfaction(g.satisfaction),
    demandShare: totalDemand > 0 ? g.demanded / totalDemand : 0,
    necessity: Math.max(0, GOOD_NECESSITY[g.goodId] ?? 0),
  }));
  readings.sort((a, b) =>
    a.satisfaction !== b.satisfaction ? a.satisfaction - b.satisfaction : b.demandShare - a.demandShare,
  );
  return readings.slice(0, Math.max(0, count));
}

/** Descriptive supply band for a system this tick — binned from Provision, plus one survival
 *  punch-through. Gates no rate or effect (see foldSupplyState); a display quantity only. */
export type SupplyRegime = "supplied" | "strained" | "rationing" | "deprived" | "famine";

/**
 * The system's supply reading. `regime` is a coarse rendering of Provision for display — it drives
 * no rate or effect. `survivalShortfall`, `criticalWeight` and `emptyBasket` ride alongside it
 * because none is inferrable back from the label: a Famine carries the survival bit
 * that a low-Provision Deprived world does not, two systems banded identically (both Strained, say)
 * can carry very different critical-good weight, and an emptying world's Provision-1 reading is
 * indistinguishable by value from a genuinely well-fed one. `supplyUnrestTerm` is the one place
 * `survivalShortfall` and `criticalWeight` compose into a severity; `emptyBasket` instead tells the
 * population processor's expectation update to skip this cycle rather than normalise toward a
 * denominator artifact.
 */
export interface SupplyState {
  regime: SupplyRegime;
  /** A demanded survival good (water/food) is below SHORTAGE_SATISFACTION. Promotes `regime` to
   *  Famine outright, whatever Provision says. */
  survivalShortfall: boolean;
  /** The critical-good override's weight: Σ necessity × demand share over demanded goods below
   *  CRITICAL_SATISFACTION and at or above BAND_MIN_DEMAND_SHARE (see `supplyUnrestTerm`). Never
   *  moves `regime` — a binary promotion was measured and rejected, so this is carried purely for
   *  the crisis-term side. Always finite and non-negative. */
  criticalWeight: number;
  /** True when Σ goodWeight over the basket is ≤ 0 — the same sum provision() folds over. An
   *  emptying world (or one with no demanded-and-necessary goods at all) reads Provision = 1 as a
   *  denominator artifact, not an experience anyone had; the persisted expectation memory reads this
   *  bit to skip its update for the cycle rather than normalise toward that artifact. */
  emptyBasket: boolean;
}

/**
 * Is a demanded survival good below the famine line? The one starvation test — the supply-regime
 * fold and the build planner's housing gate both read it, so "this world cannot feed its people"
 * means the same thing on both sides. A good nobody here demands is not scored.
 */
export function hasSurvivalShortfall(goods: GoodSatisfaction[]): boolean {
  for (const g of goods) {
    if (g.demanded <= 0 || !SURVIVAL_GOODS.includes(g.goodId)) continue;
    if (clamp(g.satisfaction, 0, 1) < SHORTAGE_SATISFACTION) return true;
  }
  return false;
}

/**
 * The critical-good override's weight: Σ necessity × demand share over demanded goods below
 * CRITICAL_SATISFACTION and at or above BAND_MIN_DEMAND_SHARE. Mirrors worstDemandedGoods()'s
 * demand-only share (Σ demanded over demanded goods) rather than re-deriving it, so eligibility and
 * the worst-good tail can never read demand share differently. The demand-share floor is eligibility
 * only — it never changes what band the system reads.
 */
function criticalGoodWeight(goods: GoodSatisfaction[]): number {
  let weight = 0;
  for (const r of worstDemandedGoods(goods, goods.length)) {
    if (r.satisfaction < CRITICAL_SATISFACTION && r.demandShare >= BAND_MIN_DEMAND_SHARE) {
      weight += r.necessity * r.demandShare;
    }
  }
  return Number.isFinite(weight) ? weight : 0;
}

/**
 * The SYSTEM-level supply band:
 *  - famine    — a demanded survival good below SHORTAGE_SATISFACTION, whatever Provision says. The
 *                one punch-through: famine is a step, not an average, so it owns no span of the
 *                Provision axis and can read at any Provision value, high ones included.
 *  - supplied  — Provision at or above SUPPLIED_PROVISION.
 *  - strained  — Provision at or above RATIONING_PROVISION, below SUPPLIED_PROVISION.
 *  - rationing — Provision at or above DEPRIVED_PROVISION, below RATIONING_PROVISION.
 *  - deprived  — Provision below DEPRIVED_PROVISION.
 * Every Provision edge is inclusive on the low side of the HIGHER band, one convention across all
 * three, so a value sitting exactly on an edge always reads the better word.
 * Provision is computed here from `goods` directly (via `provisionFromWeight`, `provision()`'s own
 * shared core), not passed in, so the band and the number it renders cannot drift apart — one
 * implementation, not a re-derived mean. The total basket weight is computed once here and handed
 * to `provisionFromWeight` rather than calling `provision(goods)` (which would re-sum it): this fold
 * already needs the total for `emptyBasket`, so re-deriving it a second time inside `provision()`
 * would sum the same basket twice for one call. `criticalWeight` rides on the returned state for
 * `supplyUnrestTerm` to read; it never moves the band. `emptyBasket` is Σ goodWeight ≤ 0 — the same
 * sum provision() folds over — computed here because only this fold sees the raw weights; the
 * Provision-1 reading alone cannot distinguish an empty basket from a genuinely well-fed one. This
 * label is about the whole system; the per-good chips read stock cover and are a different
 * labelling entirely.
 */
export function foldSupplyState(goods: GoodSatisfaction[]): SupplyState {
  const survivalShortfall = hasSurvivalShortfall(goods);
  const criticalWeight = criticalGoodWeight(goods);
  const totalWeight = totalGoodWeight(goods);
  const emptyBasket = totalWeight <= 0;
  if (survivalShortfall) return { regime: "famine", survivalShortfall, criticalWeight, emptyBasket };
  const p = provisionFromWeight(goods, totalWeight);
  const regime: SupplyRegime =
    p >= SUPPLIED_PROVISION ? "supplied"
      : p >= RATIONING_PROVISION ? "strained"
        : p >= DEPRIVED_PROVISION ? "rationing"
          : "deprived";
  return { regime, survivalShortfall, criticalWeight, emptyBasket };
}

export interface UnrestParams {
  /** Settled unrest ABOVE the standing floor, per unit of grievance — one flat exchange rate, no
   *  escalation ramp. Window from the guarantees: ≥ 1.3 (a fully-accustomed world losing half of
   *  what it is used to must reach strike at any tax) and < 2.08 (a quarter-dip must never collapse
   *  or tear down, even at the max standing floor); no longer bounded by founding — the newborn's
   *  memory seeds from its own opening state (not from perfection), but the read-side floor still
   *  applies on top of that seed: grievance = max(0, floor − opening P), zero above a 0.5 opening
   *  and up to 0.5 in the measured tail — well short of what founding used to need protecting from,
   *  so that window dissolves. */
  slopeBase: number;
  /** …and for the absolute crisis term (famine, critical-good collapse). Strictly above slopeBase. */
  slopeShortage: number;
  /** Relaxation rate toward the standing-pressure floor — the single rate, whatever the label. */
  decay: number;
}

/**
 * The expectation-relative shortfall a population is grieving: how much worse today's delivery is
 * than what it has grown accustomed to. `clamp(expectation − provision, 0, 1)` — zero once delivery
 * matches or exceeds memory, whatever the absolute level; 1 only if memory is perfect and delivery is
 * nothing. `expectation` is the read-side effective value (`readExpectation`'s output, already
 * floored), never the raw stored memory.
 */
export function grievanceShortfall(expectation: number, provision: number): number {
  return clamp(expectation - provision, 0, 1);
}

/**
 * The supply term `accumulateUnrest` integrates: whichever reads larger of a memory-relative
 * grievance reading and an absolute crisis reading (max, not sum — a world in famine that also
 * dropped below its own memory must not count the same missing goods twice; famine dominates rather
 * than composing).
 *  - Grievance (relative): `slopeBase × grievance` — flat, no ramp. Judges delivery against what
 *    this population has grown accustomed to, not against perfection.
 *  - Crisis (absolute): fires only in the severe absolute states, reading the absolute shortfall
 *    `d`. A survival shortfall reads `slopeShortage × d` outright — famine in water or food is
 *    famine whatever a population is used to. Otherwise a non-zero critical-good weight reads the
 *    shipped override arithmetic on the absolute scale: `min(slopeShortage, slopeBase +
 *    criticalWeight × (slopeShortage − slopeBase)) × d` — the base slope always applies once any
 *    critical weight is present, escalating toward famine weight and capped there. Absent both a
 *    survival shortfall and any critical weight, the crisis reading is exactly 0: an ordinary
 *    shortfall with no severe absolute signal answers to memory alone, which is what keeps the
 *    grievance term meaningful under the max() — a crisis floor that fired on every shortfall would
 *    make the whole term absolute again and erase the point of reading memory at all.
 * Total and finite for any input (grievance and d clamped into [0,1]; a negative criticalWeight
 * reads as 0 rather than propagating).
 */
export function supplyUnrestTerm(
  grievance: number,
  d: number,
  supply: SupplyState,
  params: UnrestParams,
): number {
  const g = clamp(grievance, 0, 1);
  const dd = clamp(d, 0, 1);
  const grievanceTerm = params.slopeBase * g;
  const criticalWeight = Math.max(0, supply.criticalWeight);
  const crisisTerm = supply.survivalShortfall
    ? params.slopeShortage * dd
    : criticalWeight > 0
      ? Math.min(params.slopeShortage, params.slopeBase + criticalWeight * (params.slopeShortage - params.slopeBase)) * dd
      : 0;
  return Math.max(grievanceTerm, crisisTerm);
}

/**
 * Relaxes unrest toward its standing-pressure floor and integrates the supply term on top:
 *   unrest <- clamp(floor + (1 - k)*(unrest - floor) + term*k, 0, 1)
 * where k = clamp(decay, 0, 1) and `term` is `supplyUnrestTerm(grievance, d, supply, params)`,
 * already the full settled-unrest contribution above the floor — not a rate to be multiplied by D
 * again here.
 *
 * Because the gain is `term × k` rather than an independent number, the fixed point is
 * `min(1, floor + term)` for ANY relaxation rate — so equilibrium, recovery speed and the tick's
 * catch-up factor are fully decoupled. `floor` is the standing pressure (tax + crowding), clamped to
 * [0,1] by the caller; at term = 0 unrest settles exactly at `floor`.
 *
 * The `min` is load-bearing, not defensive: unrest is a [0,1] state while `term` can itself exceed 1
 * (slopeShortage alone does, and the flat grievance slope is cut to reach strike from grievance
 * alone — see the guarantees). Under the re-cut slope the ceiling is reachable from deep grievance
 * on its own, not only from the combined extreme corner of tax, crowding and famine together — the
 * graduated response holds up to that reachable point and saturates beyond it.
 *
 * Catastrophe still lives in the integral — one bad cycle is recoverable, chronic shortage climbs
 * toward the settled level. The caller pre-scales decay by the catch-up factor (never the slopes
 * that feed `term`); k is clamped after scaling, so a large catch-up can never flip the relaxation
 * term and overshoot below the floor.
 */
export function accumulateUnrest(
  unrest: number,
  supplyTerm: number,
  floor: number,
  params: UnrestParams,
): number {
  const k = clamp(params.decay, 0, 1);
  const relaxed = floor + (1 - k) * (unrest - floor);
  return clamp(relaxed + supplyTerm * k, 0, 1);
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
 *   growth  = growthRate * pop * crowdFactor(pop, popCap, crowdBrakeEnd) * (1 - D) * quality
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
 *
 * `quality` (the fill-best-first habitability read, `lib/engine/habitability.ts`) multiplies
 * the GROWTH term ONLY — decline and death read raw `population`/`unrest` untouched, so a
 * marginal-land world doesn't die faster, it merely grows slower. A world whose
 * `quality × crowdFactor × (1 − d)` sits below `unrest` nets negative even at full satisfaction
 * and zero crowding: hard worlds are fragile by design, and the exit is abandonment
 * (`ABANDON_POP_FLOOR`, `lib/constants/population.ts`), not a floor inside this formula.
 */
export function populationDelta(
  population: number,
  popCap: number,
  d: number,
  unrest: number,
  params: PopulationParams,
  quality: number,
): number {
  const satisfactionFactor = clamp(1 - d, 0, 1);
  const growth =
    params.growthRate * population * crowdFactor(population, popCap, params.crowdBrakeEnd)
    * satisfactionFactor * quality;
  const decline = params.declineRate * population * clamp(unrest, 0, 1);
  const death =
    unrest > params.overshootDeathUnrestGate
      ? params.overshootDeathRate * Math.max(0, population - popCap) * clamp(unrest, 0, 1)
      : 0;
  return growth - decline - death;
}
