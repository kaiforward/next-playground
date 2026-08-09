import { describe, it, expect } from "vitest";
import {
  ECONOMY_CONSTANTS,
  TARGET_COVER,
  SHORTAGE_SATISFACTION,
} from "@/lib/constants/economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { EXPANSION } from "@/lib/constants/expansion";
import { GOODS } from "@/lib/constants/goods";
import { COLONISATION } from "@/lib/constants/colonisation";
import { INITIAL_RESERVE_ANCHOR_FRAC } from "@/lib/constants/market-economy";
import { STRIKE_PARAMS, POPULATION_PARAMS, CROWDING, UNREST_PARAMS, EXPECTATION_PARAMS } from "@/lib/constants/population";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { VACANCY_SLACK, INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { BUILDING_TYPES, HOUSING_TYPE, POP_CENTRE_DENSITY, INPUT_DEMAND_MULTIPLIER } from "@/lib/constants/industry";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { GOOD_NECESSITY, SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { consumptionRate } from "@/lib/engine/physical-economy";
import {
  supplyUnrestTerm,
  dissatisfaction,
  provision,
  hasSurvivalShortfall,
  foldSupplyState,
  grievanceShortfall,
  accumulateUnrest,
  type GoodSatisfaction,
  type SupplyState,
} from "@/lib/engine/population";
import { readExpectation } from "@/lib/engine/expectation";
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
 * The full basket at population-proportional demand (same basis dFor() derives its shares from),
 * one good crashed to satisfaction 0 and everything else fully delivered. Unlike dFor() (which
 * returns only the resulting D), this is the actual basket — so provision()/dissatisfaction()/
 * foldSupplyState() can all read it directly and the composed reading uses the real crisis-term
 * inputs (criticalWeight, survivalShortfall) rather than a re-derived stand-in for them.
 */
function basketWithOneGoodFailing(goodId: string): GoodSatisfaction[] {
  const basis = { population: 1000, technicians: 0, engineers: 0 };
  return GOOD_NAMES.map((id) => ({
    goodId: id,
    satisfaction: id === goodId ? 0 : 1,
    demanded: consumptionRate(id, basis),
  }));
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

/**
 * Equilibrium unrest under a sustained absolute shortfall at a given standing floor:
 * floor + supplyUnrestTerm(grievance, d, supply, UNREST_PARAMS). Grievance is fixed at 0
 * (a fully-accustomed world, E = P) so every reading here isolates the CRISIS term alone — the
 * hardest case for the absolute backstops (survival, critical-good) to carry the guarantee on their
 * own, with the grievance term contributing nothing.
 */
function settled(d: number, floor: number, survivalShortfall = false, criticalWeight = 0): number {
  const supply: SupplyState = { regime: "rationing", survivalShortfall, criticalWeight, emptyBasket: false };
  return floor + supplyUnrestTerm(0, d, supply, UNREST_PARAMS);
}

const MAX_FLOOR = Math.max(...Object.values(TAX_LEVEL_UNREST_PRESSURE)) + CROWDING.PRESSURE_MAX;
const COLLAPSE = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold;

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

describe("unrest containment — the guarantees the two slopes carry", () => {
  /** An absolute-scale reference only, at the retired escalation cut's old magnitude — used below to
   *  pin that the ambient barren-galaxy fixture's shortfall stays well short of a near-total
   *  collapse. Not tied to any live mechanism boundary — unrest now reads grievance and the crisis
   *  backstops, not a D-level cut. */
  const LARGE_SHORTFALL_REFERENCE = 0.65;

  it("keeps the Shortage slope strictly above the Rationing one", () => {
    expect(UNREST_PARAMS.slopeShortage).toBeGreaterThan(UNREST_PARAMS.slopeBase);
  });

  it("lets a total failure of EITHER survival good collapse, even at zero tax", () => {
    // A survival good's total failure reaches the crisis term's slopeShortage reading through
    // hasSurvivalShortfall's promotion, absolute and expectation-independent (settled() fixes
    // grievance at 0, so this is the crisis term carrying the guarantee entirely on its own).
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

  it("lets no non-survival good, alone, reach the strike threshold on a fully-accustomed world (E = 1) — grievance composed with the restored crisis term", () => {
    // The guarantee the deleted per-good contribution cap was meant to carry, re-composed under the
    // memory-relative term: a fully-accustomed world (E = 1, the worst case — grievance = E − P is
    // maximised there) loses one non-survival good entirely. foldSupplyState() reads the real
    // crisis-term inputs (criticalWeight, survivalShortfall) off the SAME basket rather than
    // re-deriving them, so a drift in the critical-good eligibility rule shows up here too — this is
    // the composed reading, not the crisis term alone.
    for (const goodId of GOOD_NAMES) {
      if (SURVIVAL_GOODS.includes(goodId)) continue;
      const basket = basketWithOneGoodFailing(goodId);
      const d = dissatisfaction(basket);
      const supply = foldSupplyState(basket);
      const grievance = grievanceShortfall(1, provision(basket));
      const term = supplyUnrestTerm(grievance, d, supply, UNREST_PARAMS);
      expect(MAX_FLOOR + term, goodId).toBeLessThan(STRIKE_PARAMS.threshold);
    }
  });

  it("promotes a survival shortfall to the crisis reading of slopeShortage × D at any D", () => {
    expect(supplyUnrestTerm(0, 0.05, { regime: "rationing", survivalShortfall: true, criticalWeight: 0, emptyBasket: false }, UNREST_PARAMS))
      .toBeCloseTo(UNREST_PARAMS.slopeShortage * 0.05, 10);
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
    // Its necessity-weighted fold exceeds a 0.20 basket-wide gate while staying a mild shortfall — the
    // band in which a fed world used to be refused its own housing.
    const ambient = [
      ...SURVIVAL_GOODS.map((goodId) => ({ goodId, satisfaction: 1, demanded: 1 })),
      { goodId: "medicine", satisfaction: 0, demanded: 0.7 },
    ];
    const ambientD = dissatisfaction(ambient);
    expect(ambientD).toBeGreaterThan(0.2);
    expect(ambientD).toBeLessThan(LARGE_SHORTFALL_REFERENCE);
    expect(hasSurvivalShortfall(ambient)).toBe(false);
    expect(fed(sysWithGoods(ambient))).toBe(true);
  });
});

describe("promise 4 — a quarter-dip against memory never collapses or tears down, at any tax", () => {
  const benignSupply: SupplyState = { regime: "rationing", survivalShortfall: false, criticalWeight: 0, emptyBasket: false };

  it("keeps a grievance of 0.25 below the collapse/teardown line even at the max standing floor — single-constant guarantee slopeBase < (collapse − maxFloor)/0.25", () => {
    // Dip-depth containment: this is the memory-relative claim, computed from the live constants so
    // it recomputes if the collapse line or the floor moves, never a re-derived literal.
    const quarterDipTerm = supplyUnrestTerm(0.25, 0, benignSupply, UNREST_PARAMS);
    expect(MAX_FLOOR + quarterDipTerm).toBeLessThan(COLLAPSE);
    expect(UNREST_PARAMS.slopeBase).toBeLessThan((COLLAPSE - MAX_FLOOR) / 0.25);
  });

  it("does not extend to the crisis term — a memory resigned to the floor can still carry a fatal absolute shortfall, which is promise 6's job, not promise 4's", () => {
    // G ≤ 0.25 bounds only how far delivery has fallen BELOW memory; it says nothing about how low
    // memory itself has resigned. At the expectation floor (E = EXPECTATION_PARAMS.floor) a further
    // dip to P = E − 0.25 still reads G = 0.25 exactly, yet D = 1 − P is far larger — the crisis term
    // reads that absolute D unconstrained by G. A critical-good weight at or above 1 saturates the
    // override at slopeShortage × D, which clears the collapse line even at zero tax. That is
    // deliberate — promise 6 keeps the crisis backstop expectation-independent at full strength —
    // so promise 4's containment is provably a grievance-only claim, not one composed with the
    // crisis term: this is the demonstration, not just an assertion of the scoping choice.
    const grievance = 0.25;
    const worstCompatibleProvision = EXPECTATION_PARAMS.floor - grievance;
    const worstCompatibleD = 1 - worstCompatibleProvision;
    const crisisAtCeiling: SupplyState = { regime: "shortage", survivalShortfall: false, criticalWeight: 1, emptyBasket: false };
    const term = supplyUnrestTerm(grievance, worstCompatibleD, crisisAtCeiling, UNREST_PARAMS);
    expect(MAX_FLOOR + term).toBeGreaterThan(COLLAPSE);
  });
});

describe("transient event shocks — a shock's duration, not just its magnitude, keeps it contained", () => {
  it("keeps a solar storm's peak unrest below collapse while active, on a fully-accustomed world at the worst standing floor, and trending down once it expires", () => {
    // The event hits every good system-wide (goodId: null), including the survival goods, at
    // production_rate × 0.05 — modelled conservatively as every demanded good crashing to that
    // satisfaction level for the shock's duration (worse than reality, which has stock buffers).
    // "Whole cycles": the population processor runs once per CYCLE_LENGTH ticks, so the shock's
    // effect is applied as that many whole accumulateUnrest steps, rounding its duration UP.
    const stormPhase = EVENT_DEFINITIONS.solar_storm.phases.find((p) => p.name === "storm")!;
    const productionMultiplier = stormPhase.modifiers.find((m) => m.parameter === "production_rate")!.value;
    const eventCycles = Math.ceil(stormPhase.durationRange[1] / CYCLE_LENGTH);

    const eventGoods = uniformBasket(productionMultiplier);
    const eventD = dissatisfaction(eventGoods);
    const eventSurvival = hasSurvivalShortfall(eventGoods);
    expect(eventSurvival).toBe(true); // the system-wide modifier crashes water/food too

    // The pre-event world: worst standing floor (tax + crowding), and — the test's own author
    // choice, per the disposition — fully accustomed to exactly what it currently has (E = 1 via a
    // stored expectation of 1, P = 1: calm, matching its own memory). "Fully accustomed" is the
    // worst case for what the SHOCK itself produces: memory has not resigned to anything, so the
    // storm's own drop reads at its largest possible grievance.
    const floor = MAX_FLOOR;
    const fullyAccustomed = 1;
    const restedSupply: SupplyState = { regime: "supplied", survivalShortfall: false, criticalWeight: 0, emptyBasket: false };
    let unrest = floor + supplyUnrestTerm(grievanceShortfall(fullyAccustomed, 1), 0, restedSupply, UNREST_PARAMS);

    const eventSupply: SupplyState = { regime: "shortage", survivalShortfall: eventSurvival, criticalWeight: 0, emptyBasket: false };
    const eventGrievance = grievanceShortfall(fullyAccustomed, 1 - eventD);
    const term = supplyUnrestTerm(eventGrievance, eventD, eventSupply, UNREST_PARAMS);
    // The crisis-term arithmetic itself, pinned directly: a survival shortfall reads slopeShortage × D
    // outright regardless of grievance, so this catches a slopeShortage-family arithmetic revert that
    // a looser "stays below collapse" bound alone would not — the margin below is comfortable, not a
    // knife edge (the old 0.0028 margin does not carry over under the re-cut slopeBase), so a smaller
    // slope would still clear that bound without this direct pin.
    expect(term).toBeCloseTo(UNREST_PARAMS.slopeShortage * eventD, 10);

    for (let cycle = 1; cycle <= eventCycles; cycle++) {
      unrest = accumulateUnrest(unrest, term, floor, UNREST_PARAMS);
      expect(unrest, `cycle ${cycle}`).toBeLessThan(COLLAPSE);
    }

    const restedTerm = supplyUnrestTerm(grievanceShortfall(fullyAccustomed, 1), 0, restedSupply, UNREST_PARAMS);
    const afterExpiry = accumulateUnrest(unrest, restedTerm, floor, UNREST_PARAMS);
    expect(afterExpiry).toBeLessThan(unrest); // already heading back toward its own settled value
  });
});

describe("promise 3 — broad shortage on an established world strikes while its memory holds", () => {
  const benignSupply: SupplyState = { regime: "rationing", survivalShortfall: false, criticalWeight: 0, emptyBasket: false };

  it("reaches strike at zero tax when a fully-accustomed world loses half of what it is used to — single-constant guarantee slopeBase × 0.5 >= STRIKE_PARAMS.threshold", () => {
    const halfDipTerm = supplyUnrestTerm(0.5, 0, benignSupply, UNREST_PARAMS);
    expect(halfDipTerm).toBeGreaterThanOrEqual(STRIKE_PARAMS.threshold); // zero tax: settled unrest is the term itself
    expect(UNREST_PARAMS.slopeBase * 0.5).toBeGreaterThanOrEqual(STRIKE_PARAMS.threshold);
  });

  it("keeps the grievance slope flat across [0,1] — no reintroduced escalation ramp, read off the live UNREST_PARAMS", () => {
    for (const g of [0, 0.2, 0.5, 0.8, 1]) {
      expect(supplyUnrestTerm(g, 0, benignSupply, UNREST_PARAMS)).toBeCloseTo(UNREST_PARAMS.slopeBase * g, 10);
    }
    // Doubling grievance (within range) exactly doubles the term — the flat-slope signature a
    // reintroduced ramp would break.
    expect(supplyUnrestTerm(0.4, 0, benignSupply, UNREST_PARAMS))
      .toBeCloseTo(2 * supplyUnrestTerm(0.2, 0, benignSupply, UNREST_PARAMS), 10);
  });
});

describe("promise 5 — the escalation ladder is computed from the live constants, not hardcoded", () => {
  const benignSupply: SupplyState = { regime: "rationing", survivalShortfall: false, criticalWeight: 0, emptyBasket: false };
  const settledFromGrievance = (g: number, floor: number) =>
    floor + supplyUnrestTerm(g, 0, benignSupply, UNREST_PARAMS);

  it("places teardown onset exactly at (collapse − floor)/slopeBase, at the max standing floor and at zero tax", () => {
    // A hardcoded onset (e.g. asserting 0.325 as a literal) would survive INFRASTRUCTURE_DECAY_PARAMS
    // .unrestThreshold or the max floor moving out from under it — this pin recomputes the onset from
    // both live constants every run, so it moves with them instead.
    for (const floor of [MAX_FLOOR, 0]) {
      const onset = (COLLAPSE - floor) / UNREST_PARAMS.slopeBase;
      expect(settledFromGrievance(onset - 0.01, floor), `floor=${floor}`).toBeLessThan(COLLAPSE);
      expect(settledFromGrievance(onset + 0.01, floor), `floor=${floor}`).toBeGreaterThanOrEqual(COLLAPSE);
    }
  });

  it("saturates the response to the ceiling exactly at (1 − floor)/slopeBase, graduated below it", () => {
    for (const floor of [MAX_FLOOR, 0]) {
      const onset = (1 - floor) / UNREST_PARAMS.slopeBase;
      expect(settledFromGrievance(onset - 0.01, floor), `floor=${floor}`).toBeLessThan(1); // graduated, not yet the ceiling
      expect(settledFromGrievance(onset + 0.01, floor), `floor=${floor}`).toBeGreaterThanOrEqual(1); // saturates past this line
    }
  });
});

describe("promise 6 — the critical-good backstop is expectation-independent at shipped strength", () => {
  it("reads at least min(slopeShortage, slopeBase + w × span) × D whatever the stored expectation — read through readExpectation across several stored values", () => {
    const w = 0.4;
    const d = 0.5;
    const span = UNREST_PARAMS.slopeShortage - UNREST_PARAMS.slopeBase;
    const expectedFloor = Math.min(UNREST_PARAMS.slopeShortage, UNREST_PARAMS.slopeBase + w * span) * d;
    const provisionNow = 1 - d;
    for (const stored of [0, 0.3, 0.5, 0.7, 1, undefined, NaN, -1, 2]) {
      const { effective } = readExpectation(stored, provisionNow, EXPECTATION_PARAMS);
      const grievance = grievanceShortfall(effective, provisionNow);
      const supply: SupplyState = { regime: "rationing", survivalShortfall: false, criticalWeight: w, emptyBasket: false };
      const term = supplyUnrestTerm(grievance, d, supply, UNREST_PARAMS);
      expect(term, `stored=${stored}`).toBeGreaterThanOrEqual(expectedFloor - 1e-9);
    }
  });
});

describe("validity + famine dominance — composed at the guarantee-suite level", () => {
  it("reads finite unrest in [0,1] for a corrupt stored expectation, and famine still reads exactly slopeShortage × D", () => {
    // The read guard (readExpectation) treats a non-finite or out-of-range stored value as absent —
    // re-seeded from this cycle's Provision — which is also what keeps E ≤ 1, on which famine
    // dominance rests (G ≤ D always). Composed here at the guarantee-suite level: a corrupt stored
    // value must neither produce a non-finite/out-of-range unrest reading nor weaken famine.
    const d = 0.4;
    const provisionNow = 1 - d;
    const survival: SupplyState = { regime: "shortage", survivalShortfall: true, criticalWeight: 0, emptyBasket: false };
    for (const stored of [NaN, -1, 2]) {
      const { effective } = readExpectation(stored, provisionNow, EXPECTATION_PARAMS);
      expect(Number.isFinite(effective), `stored=${stored}`).toBe(true);
      expect(effective, `stored=${stored}`).toBeGreaterThanOrEqual(0);
      expect(effective, `stored=${stored}`).toBeLessThanOrEqual(1);

      const grievance = grievanceShortfall(effective, provisionNow);
      const term = supplyUnrestTerm(grievance, d, survival, UNREST_PARAMS);
      const unrest = accumulateUnrest(0, term, MAX_FLOOR, UNREST_PARAMS);
      expect(Number.isFinite(unrest), `stored=${stored}`).toBe(true);
      expect(unrest, `stored=${stored}`).toBeGreaterThanOrEqual(0);
      expect(unrest, `stored=${stored}`).toBeLessThanOrEqual(1);
      expect(term, `stored=${stored}`).toBeCloseTo(UNREST_PARAMS.slopeShortage * d, 10);
    }
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
  // Each assertion below is a premise a mutation-sweep acceptance rests on. They are not design
  // constraints: changing one is allowed, but it silently turns accepted survivors live, and the
  // incremental sweep will NOT re-run them (the mutants sit in files a constants change does not
  // touch). The failure message names the re-sweep owed.

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
