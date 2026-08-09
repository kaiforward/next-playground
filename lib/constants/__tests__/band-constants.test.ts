import { describe, it, expect } from "vitest";
import {
  ECONOMY_CONSTANTS,
  TARGET_COVER,
  SHORTAGE_SATISFACTION,
  D_SHORTAGE_CUT,
  D_SHORTAGE_BLEND,
  RATIONING_PROVISION,
  CRITICAL_SATISFACTION,
} from "@/lib/constants/economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { EXPANSION } from "@/lib/constants/expansion";
import { GOODS } from "@/lib/constants/goods";
import { COLONISATION } from "@/lib/constants/colonisation";
import { INITIAL_RESERVE_ANCHOR_FRAC } from "@/lib/constants/market-economy";
import { STRIKE_PARAMS, POPULATION_PARAMS, CROWDING, UNREST_PARAMS } from "@/lib/constants/population";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { VACANCY_SLACK, INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { BUILDING_TYPES, HOUSING_TYPE, POP_CENTRE_DENSITY, INPUT_DEMAND_MULTIPLIER } from "@/lib/constants/industry";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { GOOD_NECESSITY, SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { consumptionRate } from "@/lib/engine/physical-economy";
import {
  unrestSlope,
  dissatisfaction,
  hasSurvivalShortfall,
  accumulateUnrest,
  type GoodSatisfaction,
  type SupplyState,
} from "@/lib/engine/population";
import { sizeColonyEstablish, fed, type BuildSystemState } from "@/lib/engine/directed-build";
import { housingUsed, idleLevels } from "@/lib/engine/infrastructure-decay";
import { emptyResourceVector } from "@/lib/engine/resources";

/** A minimal buildable system carrying just the market readings the fed gate looks at. */
function sysWithGoods(readings: GoodSatisfaction[]): BuildSystemState {
  return {
    systemId: "s1", factionId: "f1", control: "developed", population: 20,
    buildings: {}, slotCap: emptyResourceVector(),
    generalSpace: 10, habitableSpace: 10,
    goods: readings.map((r) => ({
      goodId: r.goodId, stock: 0, demand: r.demanded, civilianDemand: r.demanded,
      capacityProduction: 0, satisfaction: r.satisfaction,
    })),
  };
}

describe("band constant dependencies", () => {
  it("starts logistics replenishment well before emergency rationing", () => {
    // Imports must arrive before rationing starts. The deficit threshold is a fraction of the
    // WAREHOUSING target — `WAREHOUSE_COVER × real demand`, what classifyMarketState measures
    // against — so it is already in demand cycles and compares directly with the independently
    // defined ration threshold. Reading TARGET_COVER here instead would leave this invariant
    // green while a lowered WAREHOUSE_COVER put the deficit signal below the rationing knee.
    expect(DIRECTED_LOGISTICS.DEFICIT_FRACTION * DIRECTED_LOGISTICS.WAREHOUSE_COVER)
      .toBeGreaterThan(ECONOMY_CONSTANTS.RATION_COVER);
  });
  it("leaves a donor drawn to its reserve above the line that would make it a sink", () => {
    // The two ends of one match, in the same demand cycles. A donor stops at DONOR_RESERVE_COVER;
    // it reads as a deficit again below WAREHOUSE_COVER × DEFICIT_FRACTION. Let the reserve fall
    // under that line and every donation immediately makes the donor a sink to be refilled — a
    // drain/refill loop across the galaxy rather than the dead-band the two thresholds are for.
    expect(DIRECTED_LOGISTICS.DONOR_RESERVE_COVER)
      .toBeGreaterThanOrEqual(DIRECTED_LOGISTICS.WAREHOUSE_COVER * DIRECTED_LOGISTICS.DEFICIT_FRACTION);
  });
  it("holds the warehousing target equal to the price anchor", () => {
    // Stated, not assumed. The two are free to diverge by design — how much a warehouse holds is
    // a different question from where a good prices at par — but while they are equal, the split
    // introduced by the demand-denominator change is confined to markets whose real demand sits
    // under MIN_DEMAND. Moving one without the other is a deliberate act that should land here.
    expect(DIRECTED_LOGISTICS.WAREHOUSE_COVER).toBe(TARGET_COVER);
  });
  it("keeps the production brake's ceiling at or below the donation line", () => {
    // The dead zone between them is chosen conservatism: a self-supplier whose stock lands between
    // the brake ceiling (production halted) and the donation line (giving refused) can only drain
    // back down — a world that produces less than it uses should not dump stock it cannot replace.
    // Flip the two lines and every self-sufficient world becomes a continuous exporter instead.
    // Both sides are now cycles of the same use figure (BRAKE_RAMP × BRAKE_USE_COVER = 52 vs
    // SURPLUS_MARGIN × DONOR_RESERVE_COVER = 56, on the knee's use term): moving either constant
    // across the other should land here.
    expect(ECONOMY_CONSTANTS.BRAKE_RAMP * ECONOMY_CONSTANTS.BRAKE_USE_COVER)
      .toBeLessThanOrEqual(DIRECTED_LOGISTICS.SURPLUS_MARGIN * DIRECTED_LOGISTICS.DONOR_RESERVE_COVER);
  });
  it("holds the founding endowment at world-gen's reserve share of a full anchor cover", () => {
    // Stated, not assumed — the docstring's authorship claim, pinned. The founding manifest opens
    // a colony at the same share of a full cycles-of-supply cover that world-gen's initial reserve
    // keeps of the price anchor; each is free to move (a founder's willingness to part with stock
    // is a different question from how full a generated market starts), but moving one without the
    // other is a deliberate act that should land here.
    expect(COLONISATION.FOUNDING_STOCK_COVER).toBe(INITIAL_RESERVE_ANCHOR_FRAC * TARGET_COVER);
  });
  it("keeps rationing close to empty and the brake's taper past its knee", () => {
    expect(ECONOMY_CONSTANTS.RATION_COVER).toBeLessThan(TARGET_COVER);
    // A ramp at or below 1 would stop production AT the knee (or before it) — the
    // deceleration zone that absorbs shocks would not exist.
    expect(ECONOMY_CONSTANTS.BRAKE_RAMP).toBeGreaterThan(1);
  });
  it("keeps the shortage line a proper interior satisfaction level", () => {
    expect(SHORTAGE_SATISFACTION).toBeGreaterThan(0);
    expect(SHORTAGE_SATISFACTION).toBeLessThan(1);
  });
  it("pins the input-demand magnitude knob at neutral", () => {
    // Both honest demand figures multiply their industrial term by this knob, while the
    // physical input draw (lib/engine/supply-chain.ts) does not — so "what this industry
    // would actually pull" and "what the demand figures claim" are the same quantity only
    // at exactly 1.0. Turning the knob requires threading it into the physical draw too;
    // this pin makes that a deliberate act rather than a silent divergence.
    expect(INPUT_DEMAND_MULTIPLIER).toBe(1);
  });
});

describe("population / unrest constant dependencies", () => {
  it("gates overshoot death on the strike threshold", () => {
    // The overshoot-death term is the collapse regime — it must fire on the same
    // unrest at which production strikes, not a separately drifting number.
    expect(POPULATION_PARAMS.overshootDeathUnrestGate).toBe(STRIKE_PARAMS.threshold);
  });
  it("shares one brake-end between the growth brake and the crowding pressure ramp", () => {
    expect(POPULATION_PARAMS.crowdBrakeEnd).toBe(CROWDING.BRAKE_END);
  });
  it("cannot strike-spiral off crowding pressure alone", () => {
    // Even a fully overcrowded world adds only PRESSURE_MAX to the standing floor,
    // which must stay well under the strike threshold.
    expect(CROWDING.PRESSURE_MAX).toBeLessThan(STRIKE_PARAMS.threshold);
  });
});

/**
 * Each good's weighted share of the ordinary unskilled basket — exactly the quantity the fold
 * divides by, rebuilt from the shipped tables so a weight change moves these numbers instead of
 * silently invalidating them. Unskilled: the basket is population-proportional, so the shares are
 * the same at any population.
 */
function weightedShares(): Map<string, number> {
  const basis = { population: 1000, technicians: 0, engineers: 0 };
  const raw = new Map<string, number>();
  let total = 0;
  for (const goodId of GOOD_NAMES) {
    const w = consumptionRate(goodId, basis) * GOOD_NECESSITY[goodId];
    raw.set(goodId, w);
    total += w;
  }
  const shares = new Map<string, number>();
  for (const [goodId, w] of raw) shares.set(goodId, w / total);
  return shares;
}

/** D when `empty` are at satisfaction 0 and everything else is fully delivered. */
function dFor(empty: readonly string[]): number {
  const shares = weightedShares();
  let d = 0;
  for (const goodId of empty) d += shares.get(goodId) ?? 0;
  return d;
}

/**
 * Every good in the table at the SAME satisfaction level. Weight-independent: for a uniform gap the
 * weighted mean equals that gap exactly, whatever the necessity/demand weights are — so D = 1 −
 * satisfaction here, regardless of the fold. This is the shape dFor() cannot express (dFor always
 * puts named goods at satisfaction 0, gap = 1, identical under the squared and linear folds) and the
 * only shape that can distinguish them: at satisfaction 0.83 the linear fold reads ~0.17, the squared
 * one ~0.0289.
 */
function uniformBasket(satisfaction: number): GoodSatisfaction[] {
  return GOOD_NAMES.map((goodId) => ({ goodId, satisfaction, demanded: 1 }));
}

/** Equilibrium unrest under sustained D at a given standing floor: floor + slope(D) × D. */
function settled(d: number, floor: number, survivalShortfall = false, criticalWeight = 0): number {
  const supply: SupplyState = { regime: "rationing", survivalShortfall, criticalWeight };
  return floor + unrestSlope(d, supply, UNREST_PARAMS) * d;
}

const MAX_FLOOR = Math.max(...Object.values(TAX_LEVEL_UNREST_PRESSURE)) + CROWDING.PRESSURE_MAX;
const COLLAPSE = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold;
const TIER1PLUS2 = GOOD_NAMES.filter((g) => (GOOD_TIER_BY_KEY[g] ?? 0) > 0);

/** Measured founding shortfall distribution (equilibrium founding cohort, n = 562) — see
 *  docs/planned/supply-response.md, "The guarantees, restated on Provision". Not a code constant: it
 *  is what the founding cohort was measured at, not a value the sim reads. */
const FOUNDING_SHORTFALL_P10 = 0.59;

/** Frontier default tax stance, no crowding — the floor a newborn colony can actually occupy (never
 *  the worst tax-and-crowding floor, which no founding colony occupies). */
const FOUNDING_FLOOR = TAX_LEVEL_UNREST_PRESSURE.low;

describe("the linear fold — the shape a gap-1 scenario can't see", () => {
  it("reads a uniform partial shortfall as its own size, not its square", () => {
    // Every dFor() scenario puts named goods at satisfaction 0 (gap = 1), where gap = gap², so the
    // shipped suite could not tell the squared fold from the linear one at all. A uniform PARTIAL
    // shortfall is the only shape that can: it is weight-independent (every term of the weighted mean
    // carries the same gap), so D = 1 − satisfaction exactly, under the linear fold only. The squared
    // fold would read (1 − satisfaction)² here instead — 0.17 vs ≈0.0289 — so this fails outright if
    // dissatisfaction() is reverted to the squared shape.
    const shortfall = 0.17;
    expect(dissatisfaction(uniformBasket(1 - shortfall))).toBeCloseTo(shortfall, 9);
  });

  it("still returns the fold's complement on a partial basket, both directions", () => {
    // provision() and dissatisfaction() must not drift on a scenario dFor() cannot express.
    const basket = uniformBasket(0.62);
    expect(dissatisfaction(basket)).toBeCloseTo(1 - 0.62, 9);
  });
});

describe("shortage cut and blend — escalation-only now, not a band boundary", () => {
  it("grades a total water or food failure above the ambient barren-galaxy deficit", () => {
    // The whole point of the weight. Unweighted, the ambient deficit scored 2.2x a total water
    // failure, so no cut could separate them; weighted, the ordering inverts. Unaffected by the fold
    // or the cut/blend re-cut — dFor() always reads gap = 1, so this separation held before this task
    // and still holds after it.
    const ambient = dFor(TIER1PLUS2);
    expect(dFor(["water"])).toBeGreaterThan(ambient * 2);
    expect(dFor(["food"])).toBeGreaterThan(ambient * 2);
  });

  it("no longer separates ambient scarcity from famine — it only decides when escalation engages", () => {
    // D_SHORTAGE_CUT is no longer a band boundary — the band bins Provision directly instead
    // (foldSupplyState) — the survival floor is the only thing that still grades famine outright. The cut's one
    // remaining job is to stay above every measured founding shortfall, so a newborn colony's own
    // worst reading never engages the ramp, and to reach full Shortage weight at shortfall 0.90.
    expect(D_SHORTAGE_CUT).toBeGreaterThan(FOUNDING_SHORTFALL_P10);
    expect(D_SHORTAGE_CUT + D_SHORTAGE_BLEND).toBeCloseTo(0.9, 10);
  });
});

describe("unrest containment — the guarantees the two slopes carry", () => {
  /** A SupplyState carrying only the survival bit — zero override weight, so these fixtures
   *  isolate the D-ramp/survival-step pair from the critical-good composition tested separately. */
  const supplyOf = (survivalShortfall: boolean): SupplyState => ({
    regime: "rationing",
    survivalShortfall,
    criticalWeight: 0,
  });

  it("keeps the Shortage slope strictly above the Rationing one", () => {
    expect(UNREST_PARAMS.slopeShortage).toBeGreaterThan(UNREST_PARAMS.slopeRationing);
  });

  // "Never lets sustained Rationing reach collapse, at any tax" is RETIRED, not restated: at
  // D_SHORTAGE_CUT − ε (now 0.65) and MAX_FLOOR, settled = 0.23 + 0.95 × 0.65 ≈ 0.85 — already past
  // the 0.75 line. The wider cut makes a D-cut-based Rationing ceiling false; containment is
  // re-authored on the Provision band instead (see "collapse containment to the Shortage band"
  // below), which is the guarantee that actually holds.

  it("lets a total failure of EITHER survival good collapse, even at zero tax", () => {
    // A survival good's total failure reaches the Shortage slope through hasSurvivalShortfall's
    // promotion, NOT through the D-ramp: each good's own weighted share sits deep inside Rationing
    // territory under the new cut (0.65) and would never reach the ramp on D alone. Passing
    // survivalShortfall = true is what the real foldSupplyState/accumulateUnrest pair does for any
    // demanded survival good below SHORTAGE_SATISFACTION, whatever D says.
    //
    // Food is the weaker basket weight (~0.32 vs water's ~0.37) and the binding case: the owner
    // decided slopeShortage must clear BOTH goods, not just the heavier one — the first linear cut
    // (2.1, sized to water alone) left food (~0.67) short of the 0.75 line. 2.4 was chosen for real
    // margin on food, not a knife edge.
    for (const good of ["water", "food"]) {
      expect(settled(dFor([good]), 0, true), good).toBeGreaterThan(COLLAPSE);
    }
  });

  it("lets a total failure of EITHER survival good drive net decline at every tax level", () => {
    // An uncrowded system declines when unrest > 1 − D (growth and decline share a rate). Both goods
    // now clear this at every tax level, including zero — food no longer sits just under the line the
    // way it did under the 2.1 cut.
    for (const good of ["water", "food"]) {
      const d = dFor([good]);
      for (const pressure of Object.values(TAX_LEVEL_UNREST_PRESSURE)) {
        expect(settled(d, pressure, true), `${good} @ ${pressure}`).toBeGreaterThan(1 - d);
      }
    }
  });

  it("lets no non-survival good, alone, reach the strike threshold at any tax", () => {
    // The guarantee the deleted per-good contribution cap was meant to carry. It is a claim about
    // the constants, so it is a test rather than a runtime min() that can only cause harm when it fires.
    for (const goodId of GOOD_NAMES) {
      if (SURVIVAL_GOODS.includes(goodId)) continue;
      const d = dFor([goodId]);
      expect(settled(d, MAX_FLOOR), goodId).toBeLessThan(STRIKE_PARAMS.threshold);
    }
  });

  it("still lets a broad shortage strike under overcrowding and very-high tax, below collapse — the 0.84 lower bound", () => {
    // "Only famine collapses" must not become "nothing but famine ever strikes". Fixed at a broad
    // Shortage-band shortfall (d = 0.5, not the cut — D_SHORTAGE_CUT − ε now sits ABOVE collapse at
    // MAX_FLOOR, see the retired test above) on the base ramp alone.
    const worstBroadShortfall = settled(0.5, MAX_FLOOR);
    expect(worstBroadShortfall).toBeGreaterThanOrEqual(STRIKE_PARAMS.threshold);
    expect(worstBroadShortfall).toBeLessThan(COLLAPSE);

    const lowerBound = (STRIKE_PARAMS.threshold - MAX_FLOOR) / 0.5;
    expect(lowerBound).toBeCloseTo(0.84, 2);
    expect(UNREST_PARAMS.slopeRationing).toBeGreaterThanOrEqual(lowerBound);
  });

  it("settles the founding cohort's p10 shortfall below the strike threshold at the founding-realistic floor — the 1.07 upper bound", () => {
    // The new invariant (spec, "the guarantees, restated on Provision"): the founding cohort is the
    // modal world and opens at the galaxy's worst supply state, so it must not open inside production
    // suppression. Read at the founding-realistic floor (frontier default tax, no crowding) — the
    // worst tax-and-crowding floor collides with the lower bound above and is not a state any
    // founding colony occupies.
    expect(settled(FOUNDING_SHORTFALL_P10, FOUNDING_FLOOR)).toBeLessThan(STRIKE_PARAMS.threshold);

    const upperBound = (STRIKE_PARAMS.threshold - FOUNDING_FLOOR) / FOUNDING_SHORTFALL_P10;
    expect(upperBound).toBeCloseTo(1.07, 2);
    expect(UNREST_PARAMS.slopeRationing).toBeLessThanOrEqual(upperBound);
  });

  it("bounds slopeRationing from both ends at once — a value satisfying one guarantee and breaking the other must fail", () => {
    const lowerBound = (STRIKE_PARAMS.threshold - MAX_FLOOR) / 0.5;
    const upperBound = (STRIKE_PARAMS.threshold - FOUNDING_FLOOR) / FOUNDING_SHORTFALL_P10;
    expect(lowerBound).toBeLessThan(upperBound);
    expect(UNREST_PARAMS.slopeRationing).toBeGreaterThanOrEqual(lowerBound);
    expect(UNREST_PARAMS.slopeRationing).toBeLessThanOrEqual(upperBound);
  });

  it("blends the slope across the cut instead of switching it", () => {
    const below = unrestSlope(D_SHORTAGE_CUT - 1e-6, supplyOf(false), UNREST_PARAMS);
    const above = unrestSlope(D_SHORTAGE_CUT + 1e-6, supplyOf(false), UNREST_PARAMS);
    expect(Math.abs(above - below)).toBeLessThan(1e-4);
    expect(below).toBe(UNREST_PARAMS.slopeRationing);
    expect(unrestSlope(D_SHORTAGE_CUT + D_SHORTAGE_BLEND, supplyOf(false), UNREST_PARAMS))
      .toBeCloseTo(UNREST_PARAMS.slopeShortage, 10);
  });

  it("holds the Rationing slope across the whole Rationing range", () => {
    // The ramp starts AT the cut, never below it — otherwise the containment guarantee above
    // would only hold at the bottom of the band.
    for (const d of [0, 0.05, 0.1, 0.2, D_SHORTAGE_CUT - 1e-9]) {
      expect(unrestSlope(d, supplyOf(false), UNREST_PARAMS), `D=${d}`).toBe(UNREST_PARAMS.slopeRationing);
    }
  });

  it("promotes a survival shortfall to the Shortage slope at any D", () => {
    expect(unrestSlope(0.05, supplyOf(true), UNREST_PARAMS)).toBe(UNREST_PARAMS.slopeShortage);
  });

  it("refuses housing on exactly the systems the survival floor calls starving", () => {
    // The fed gate reads the survival floor itself, so the two cannot drift: a world below the
    // shortage line on a staple never stands up new housing.
    const starving = SURVIVAL_GOODS.map((goodId) => ({
      goodId, satisfaction: SHORTAGE_SATISFACTION - 0.01, demanded: 1,
    }));
    expect(hasSurvivalShortfall(starving)).toBe(true);
    expect(fed(sysWithGoods(starving))).toBe(false);

    // The ambient barren-galaxy basket: staples fully delivered, an unmakeable tier-1 good at zero.
    // Its necessity-weighted fold clears the shortage cut yet exceeds a 0.20 basket-wide gate — the
    // band in which a fed world used to be refused its own housing.
    const ambient = [
      ...SURVIVAL_GOODS.map((goodId) => ({ goodId, satisfaction: 1, demanded: 1 })),
      { goodId: "medicine", satisfaction: 0, demanded: 0.7 },
    ];
    const ambientD = dissatisfaction(ambient);
    expect(ambientD).toBeGreaterThan(0.2);
    expect(ambientD).toBeLessThan(D_SHORTAGE_CUT);
    expect(hasSurvivalShortfall(ambient)).toBe(false);
    expect(fed(sysWithGoods(ambient))).toBe(true);
  });
});

describe("collapse containment — Supplied and Strained worlds never collapse", () => {
  const RATIONING_SHORTFALL = 1 - RATIONING_PROVISION;

  it("keeps every Strained-or-better world (Provision >= RATIONING_PROVISION) below collapse at the worst tax, crowding and override composition", () => {
    // Not "shortfall ≤ 0.5 never collapses" (measured false under the override, and not to
    // be resurrected) — the guarantee is edge-of-band, computed from the constants so it recomputes
    // if a bin edge or slope moves. Maximum criticalWeight compatible with a FIXED total shortfall of
    // RATIONING_SHORTFALL: critical goods sit just under the criticality line (gap → 1 − CRITICAL_SATISFACTION)
    // so the same total shortfall budget buys the most possible critical-flagged weight.
    const maxCriticalWeight = RATIONING_SHORTFALL / (1 - CRITICAL_SATISFACTION);
    // Route through the real unrestSlope rather than re-deriving its cap/override composition here —
    // otherwise this test keeps passing if that composition drifts. RATIONING_SHORTFALL (0.3) sits
    // below D_SHORTAGE_CUT (0.65), so the D-ramp term clamps to 0 and contributes nothing: the
    // override alone (criticalWeight × (slopeShortage − slopeRationing)) drives the slope here, which
    // is exactly the edge-of-band case this test is proving contained.
    const worstSupply: SupplyState = { regime: "rationing", survivalShortfall: false, criticalWeight: maxCriticalWeight };
    const worstSlope = unrestSlope(RATIONING_SHORTFALL, worstSupply, UNREST_PARAMS);
    const worstCase = MAX_FLOOR + worstSlope * RATIONING_SHORTFALL;
    expect(worstCase).toBeCloseTo(0.689, 3);
    expect(worstCase).toBeLessThan(COLLAPSE);
  });
});

describe("transient event shocks — a shock's duration, not just its magnitude, keeps it contained", () => {
  it("keeps a solar storm's peak unrest below collapse while active, on a Rationing world, and trending down once it expires", () => {
    // The event hits every good system-wide (goodId: null), including the survival goods, at
    // production_rate × 0.05 — modelled conservatively as every demanded good crashing to that
    // satisfaction level for the shock's duration (worse than reality, which has stock buffers).
    // "Whole cycles": the population processor runs once per CYCLE_LENGTH ticks, so the shock's
    // effect is applied as that many whole accumulateUnrest steps, rounding its duration UP.
    // This margin is thin — the peak clears 0.75 by ~0.0028 at the current constants — and erodes
    // further if `decay` rises, the storm phase's duration range is widened, or its production
    // multiplier is lowered (any of which raises how far unrest closes toward the shocked settled
    // value before the shock ends); a change to any of those three should re-run this test, not
    // assume it still holds.
    const stormPhase = EVENT_DEFINITIONS.solar_storm.phases.find((p) => p.name === "storm")!;
    const productionMultiplier = stormPhase.modifiers.find((m) => m.parameter === "production_rate")!.value;
    const eventCycles = Math.ceil(stormPhase.durationRange[1] / CYCLE_LENGTH);

    const eventGoods = uniformBasket(productionMultiplier);
    const eventD = dissatisfaction(eventGoods);
    const eventSurvival = hasSurvivalShortfall(eventGoods);
    expect(eventSurvival).toBe(true); // the system-wide modifier crashes water/food too

    // A Rationing world sitting at the band edge (worst tax and crowding, no override, no famine) —
    // its own pre-event equilibrium.
    const baseD = 0.3; // RATIONING_SHORTFALL, matching the containment describe above
    const floor = MAX_FLOOR;
    let unrest = settled(baseD, floor);

    for (let cycle = 1; cycle <= eventCycles; cycle++) {
      unrest = accumulateUnrest(
        unrest, eventD, floor,
        { regime: "shortage", survivalShortfall: eventSurvival, criticalWeight: 0 },
        UNREST_PARAMS,
      );
      expect(unrest, `cycle ${cycle}`).toBeLessThan(COLLAPSE);
    }

    const afterExpiry = accumulateUnrest(
      unrest, baseD, floor,
      { regime: "rationing", survivalShortfall: false, criticalWeight: 0 },
      UNREST_PARAMS,
    );
    expect(afterExpiry).toBeLessThan(unrest); // already heading back toward its own settled value
  });
});

describe("housing containment — both directed-build sizing sites land inside the decay slack", () => {
  // The two sites the build planner sizes housing at: the relief valve (below) and colony establish.
  // Both must land the result inside the vacancy allowance decay reads, or the sizing commits exactly
  // the levels decay then tears down — the treadmill this band is meant to make structurally
  // impossible. (World-gen's homeworld prefab sizes housing too, but against labour demand rather
  // than residents, and is not part of this invariant.)
  it("opens a colony with no level the idle channel would immediately read as spare", () => {
    // Seeds swept across and around whole-level boundaries: the +1 headroom level this sizing used
    // to bundle put a fresh colony a whole level above its own occupancy, which reads idle from the
    // moment it lands. The `min(count, …)` here is the decay engine's own clamp (capacityUsed
    // "pop_cap" in lib/engine/industry.ts) — without it the proxy reads negative at boundary seeds
    // and the assertion would be testing a quantity decay never computes.
    const ampleLand = 1e6; // never the binding constraint here — the seed is
    for (const seedPop of [1, 2, 19, 20, 21, 40, 41]) {
      const sizing = sizeColonyEstablish(ampleLand, { seedPop, establishWork: 0 });
      expect(sizing).not.toBeNull();
      if (sizing === null) continue;
      expect(sizing.seedPop).toBe(seedPop);
      // Viable by construction: the landed colony can house everyone it was seeded with.
      expect(sizing.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(seedPop);
      // …and carries no whole level decay would reclaim (the trigger is `idleLevels >= 1`).
      const used = Math.min(sizing.housingLevels, housingUsed(seedPop) * (1 + VACANCY_SLACK));
      expect(idleLevels(sizing.housingLevels, used)).toBe(0);
    }
  });

  it("keeps the relief vacancy inside the decay slack", () => {
    // Housing decay reads levels as fully used while count ≤ housingUsed(pop) × (1 + VACANCY_SLACK)
    // (capacityUsed "pop_cap" in lib/engine/industry.ts). At occupancy r that is r × (1 + VACANCY_SLACK)
    // ≥ 1, so relief must size back to a target the slack still covers — otherwise the valve commits
    // exactly the levels decay then tears down. The two are fractions of DIFFERENT denominators (the
    // slack of used housing, 1 − RELIEF_TARGET of built popCap), so comparing them directly would
    // admit targets that break containment.
    expect(DIRECTED_BUILD.RELIEF_TARGET * (1 + VACANCY_SLACK)).toBeGreaterThanOrEqual(1);
  });

  it("binds the two housing-capacity readings to one density", () => {
    // Occupancy is read two ways: housingUsed(pop) divides by POP_CENTRE_DENSITY, housingPopCap()
    // multiplies by the housing type's popProvided. The decay-containment invariant above compares
    // fractions derived from both, so it only means anything while the two agree — a divergence
    // would silently shift the r the relief valve targets away from the r decay measures.
    expect(BUILDING_TYPES[HOUSING_TYPE].popProvided).toBe(POP_CENTRE_DENSITY);
  });

  it("triggers relief above the occupancy it sizes back to", () => {
    // The trigger/target pair is a hysteresis band: a target at or above the trigger would make the
    // sized want non-positive at the moment the valve opens, silently disabling relief entirely.
    expect(DIRECTED_BUILD.RELIEF_TRIGGER).toBeGreaterThan(DIRECTED_BUILD.RELIEF_TARGET);
  });
});

describe("mutation-acceptance premises — when one of these fails, re-sweep the named scope", () => {
  // Each assertion below is a premise a 2026-08-09 mutation-sweep acceptance rests on (batch
  // ledger). They are not design constraints: changing one is allowed, but it silently turns
  // accepted survivors live, and the incremental sweep will NOT re-run them (the mutants sit in
  // files a constants change does not touch). The failure message names the re-sweep owed.

  it("the shared BFS radius is the logistics hop cap — else world/tick.ts's h > MAX_HOPS arm goes live", () => {
    // runWorldTick's hop map is bounded by max(logistics, build, expansion reach); while that max
    // IS the logistics cap, no hop beyond it exists and the route-cost guard's far arm is dead.
    // Raise build/expansion reach past it and the arm becomes reachable: re-sweep lib/world/tick.ts.
    expect(Math.max(DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS, EXPANSION.REACH_JUMPS))
      .toBe(DIRECTED_LOGISTICS.MAX_HOPS);
  });

  it("logistics HOP_WEIGHT is exactly 1 — else hop-cost arithmetic acceptances go live", () => {
    // At 1.0, h * HOP_WEIGHT and h / HOP_WEIGHT coincide, and several route-cost mutants were
    // accepted as equivalent on that basis. Any other value: re-sweep lib/world/tick.ts.
    expect(DIRECTED_LOGISTICS.HOP_WEIGHT).toBe(1.0);
  });

  it("every good carries a positive basePrice — else unitValue/spent guards go live", () => {
    // Acceptances in the economy/directed-build processors treat `unitValue > 0` and the
    // `spent > 0` family as always-true because no catalog good prices at 0. A zero-priced good:
    // re-sweep lib/tick/processors/{economy,directed-build}.ts.
    for (const [goodId, def] of Object.entries(GOODS)) {
      expect(def.basePrice, `basePrice of ${goodId}`).toBeGreaterThan(0);
    }
  });
});
