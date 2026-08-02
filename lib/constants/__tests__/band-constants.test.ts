import { describe, it, expect } from "vitest";
import {
  ECONOMY_CONSTANTS,
  TARGET_COVER,
  SHORTAGE_SATISFACTION,
  D_SHORTAGE_CUT,
  D_SHORTAGE_BLEND,
} from "@/lib/constants/economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { STRIKE_PARAMS, POPULATION_PARAMS, CROWDING, UNREST_PARAMS } from "@/lib/constants/population";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { VACANCY_SLACK, INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { BUILDING_TYPES, HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { GOOD_NECESSITY, SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { unrestSlope, dissatisfaction, hasSurvivalShortfall, type GoodSatisfaction } from "@/lib/engine/population";
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
      goodId: r.goodId, stock: 0, targetStock: 0, demand: r.demanded, civilianDemand: r.demanded,
      capacityProduction: 0, satisfaction: r.satisfaction,
    })),
  };
}

describe("band constant dependencies", () => {
  it("starts logistics replenishment well before emergency rationing", () => {
    // Imports must arrive before rationing starts: receivers classify as
    // The deficit threshold is an anchor fraction; convert it to demand cycles
    // before comparing it with the independently-defined ration threshold.
    expect(DIRECTED_LOGISTICS.DEFICIT_FRACTION * TARGET_COVER).toBeGreaterThan(
      ECONOMY_CONSTANTS.RATION_COVER,
    );
  });
  it("keeps rationing close to empty and the hold ceiling above the anchor", () => {
    expect(ECONOMY_CONSTANTS.RATION_COVER).toBeLessThan(TARGET_COVER);
    expect(ECONOMY_CONSTANTS.HOLD_COVER).toBeGreaterThan(1);
  });
  it("keeps the shortage line a proper interior satisfaction level", () => {
    expect(SHORTAGE_SATISFACTION).toBeGreaterThan(0);
    expect(SHORTAGE_SATISFACTION).toBeLessThan(1);
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

/** Equilibrium unrest under sustained D at a given standing floor: floor + slope(D) × D. */
function settled(d: number, floor: number, survivalShortfall = false): number {
  return floor + unrestSlope(d, survivalShortfall, UNREST_PARAMS) * d;
}

const MAX_FLOOR = Math.max(...Object.values(TAX_LEVEL_UNREST_PRESSURE)) + CROWDING.PRESSURE_MAX;
const COLLAPSE = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold;
const TIER1PLUS2 = GOOD_NAMES.filter((g) => (GOOD_TIER_BY_KEY[g] ?? 0) > 0);

describe("necessity fold — the separation the shortage cut was drawn against", () => {
  it("grades a total water or food failure above the ambient barren-galaxy deficit", () => {
    // The whole point of the weight. Unweighted, the ambient deficit scored 2.2x a total water
    // failure, so no cut could separate them; weighted, the ordering inverts.
    const ambient = dFor(TIER1PLUS2);
    expect(dFor(["water"])).toBeGreaterThan(ambient * 2);
    expect(dFor(["food"])).toBeGreaterThan(ambient * 2);
  });

  it("puts the shortage cut strictly between the two", () => {
    expect(D_SHORTAGE_CUT).toBeGreaterThan(dFor(TIER1PLUS2));
    expect(D_SHORTAGE_CUT).toBeLessThanOrEqual(dFor(["food"]));
  });
});

describe("unrest containment — the guarantees the two slopes carry", () => {
  it("keeps the Shortage slope strictly above the Rationing one", () => {
    expect(UNREST_PARAMS.slopeShortage).toBeGreaterThan(UNREST_PARAMS.slopeRationing);
  });

  it("never lets sustained Rationing reach collapse, at any tax", () => {
    // Worst sustained Rationing: D just under the cut, the highest tax stance, fully overcrowded.
    expect(settled(D_SHORTAGE_CUT - 1e-9, MAX_FLOOR)).toBeLessThan(COLLAPSE);
  });

  it("lets a total water or food failure collapse, even at zero tax", () => {
    expect(settled(dFor(["water"]), 0)).toBeGreaterThan(COLLAPSE);
    expect(settled(dFor(["food"]), 0)).toBeGreaterThan(COLLAPSE);
  });

  it("lets a total water or food failure drive net decline at every tax level", () => {
    // An uncrowded system declines when unrest > 1 − D (growth and decline share a rate).
    for (const good of ["water", "food"]) {
      const d = dFor([good]);
      for (const pressure of Object.values(TAX_LEVEL_UNREST_PRESSURE)) {
        expect(settled(d, pressure), `${good} @ ${pressure}`).toBeGreaterThan(1 - d);
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

  it("still lets a broad shortage strike under overcrowding and very-high tax, below collapse", () => {
    // "Only famine collapses" must not become "nothing but famine ever strikes".
    const worstRationing = settled(D_SHORTAGE_CUT - 1e-9, MAX_FLOOR);
    expect(worstRationing).toBeGreaterThan(STRIKE_PARAMS.threshold);
    expect(worstRationing).toBeLessThan(COLLAPSE);
  });

  it("blends the slope across the cut instead of switching it", () => {
    const below = unrestSlope(D_SHORTAGE_CUT - 1e-6, false, UNREST_PARAMS);
    const above = unrestSlope(D_SHORTAGE_CUT + 1e-6, false, UNREST_PARAMS);
    expect(Math.abs(above - below)).toBeLessThan(1e-4);
    expect(below).toBe(UNREST_PARAMS.slopeRationing);
    expect(unrestSlope(D_SHORTAGE_CUT + D_SHORTAGE_BLEND, false, UNREST_PARAMS))
      .toBeCloseTo(UNREST_PARAMS.slopeShortage, 10);
  });

  it("holds the Rationing slope across the whole Rationing range", () => {
    // The ramp starts AT the cut, never below it — otherwise the containment guarantee above
    // would only hold at the bottom of the band.
    for (const d of [0, 0.05, 0.1, 0.2, D_SHORTAGE_CUT - 1e-9]) {
      expect(unrestSlope(d, false, UNREST_PARAMS), `D=${d}`).toBe(UNREST_PARAMS.slopeRationing);
    }
  });

  it("promotes a survival shortfall to the Shortage slope at any D", () => {
    expect(unrestSlope(0.05, true, UNREST_PARAMS)).toBe(UNREST_PARAMS.slopeShortage);
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
