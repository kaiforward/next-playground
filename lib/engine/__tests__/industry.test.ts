import { describe, it, expect } from "vitest";
import {
  labourDemand,
  labourFulfilment,
  housingPopCap,
  buildingProduction,
  capacityGoodRates,
  inputDemandForGood,
  inputDemandFromProduction,
  buildIndustryReadout,
  buildingStorageForGood,
  extractorsByResource,
  summariseDeposits,
  summariseSpace,
  industryLandUsed,
  industryHealth,
  buildingHealth,
  computeLabourState,
  effectiveFulfilment,
  skill1Demand,
  skill2Demand,
  skill1Cap,
  skill2Cap,
  perGradeStaffing,
  computeLabourAllocation,
  skillLicensing,
  familyAnchorBuff,
  familyThroughput,
  complexUsed,
  computeSystemLabourSnapshot,
  labourParts,
  labourStateFromParts,
  buildingUsed,
  computeUtilisation,
  housingUsed,
} from "@/lib/engine/industry";
import type { IndustryHealth, LabourState, GradeStaffing, LabourParts, UtilisationContext } from "@/lib/engine/industry";
import {
  DEFAULT_SPACE_COST,
  POP_CENTRE_DENSITY,
  OUTPUT_PER_UNIT,
  HOUSING_TYPE,
  EXTRACTOR_STORAGE_PER_UNIT,
  PRODUCTION_STORAGE_PER_UNIT,
  POP_CENTRE_STORAGE,
  POP_CENTRE_STORAGE_DEFAULT,
  BUILDING_TYPES,
  PRODUCTION_BUILDING_TYPES,
  labourTotal,
  SKILL1_PER_SCHOOL,
  SKILL2_PER_INSTITUTE,
  INPUT_DEMAND_MULTIPLIER,
  SPECIALISATION_FAMILIES,
  ANCHOR_RATED_COVERAGE,
  CONSTRUCTION_CENTRE_TYPE,
} from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { ECONOMY_CONSTANTS, ECONOMY_SIM_PARAMS } from "@/lib/constants/economy";
import { USED_SLACK } from "@/lib/constants/infrastructure";
import { brakeKnee, productionCeiling } from "@/lib/engine/tick";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { unitResourceVector, makeResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import { HEAVY_INDUSTRY_COMPLEX } from "@/lib/constants/industry";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
import { SKILL1_CONSUMPTION, SKILL2_CONSUMPTION } from "@/lib/constants/physical-economy";

/** A fully-staffed labour state — headcount and both skill ceilings unconstrained. */
const FULL: LabourState = { labourFulfil: 1, skill1Fulfil: 1, skill2Fulfil: 1 };
/** Half-staffed on headcount only; skill ceilings unconstrained. */
const half: LabourState = { labourFulfil: 0.5, skill1Fulfil: 1, skill2Fulfil: 1 };

/** A stock just past the brake's ramp end for `good` at this built base — the brake fully shut.
 *  Computed from the same knee the readout derives (use term 2.5 × 40 = 100, real capacity), so
 *  fixtures track the geometry whatever OUTPUT_PER_UNIT resolves to. */
const shutStock = (buildings: Record<string, number>, pop: number, good = "metals", useRate = 2.5): number =>
  brakeKnee(
    {
      useRate,
      capacityProduction: buildingProduction(buildings, good, computeLabourState(buildings, pop), unitResourceVector()),
      anchorMult: 1,
    },
    ECONOMY_SIM_PARAMS,
  ).rampEnd + 1;

describe("labour vector", () => {
  it("every production type carries a 3-grade labour vector whose shares partition a positive total", () => {
    for (const good of PRODUCTION_BUILDING_TYPES) {
      const v = BUILDING_TYPES[good]?.labour;
      expect(v, good).toBeDefined();
      if (!v) continue;
      expect(v.unskilled, good).toBeGreaterThanOrEqual(0);
      expect(v.skill1, good).toBeGreaterThanOrEqual(0);
      expect(v.skill2, good).toBeGreaterThanOrEqual(0);
      expect(labourTotal(v), good).toBeGreaterThan(0);
      expect(labourTotal(v), good).toBeCloseTo(v.unskilled + v.skill1 + v.skill2, 9);
    }
  });

  it("tier-0 extractors are unskilled-only; tier-2 draws all three grades", () => {
    for (const good of PRODUCTION_BUILDING_TYPES) {
      const v = BUILDING_TYPES[good]!.labour!;
      if (GOOD_TIER_BY_KEY[good] === 0) {
        expect(v.skill1, good).toBe(0);
        expect(v.skill2, good).toBe(0);
      }
      if (GOOD_TIER_BY_KEY[good] === 2) {
        expect(v.skill1, good).toBeGreaterThan(0);
        expect(v.skill2, good).toBeGreaterThan(0);
      }
    }
  });

  it("labourDemand sums labourTotal across production types; housing demands none", () => {
    // ore tier-0 total 10, metals tier-1 total 25 → 5*10 + 2*25 = 100; housing adds 0.
    const demand = labourDemand({ ore: 5, metals: 2, housing: 3 });
    expect(demand).toBeCloseTo(5 * labourTotal(BUILDING_TYPES.ore!.labour!) + 2 * labourTotal(BUILDING_TYPES.metals!.labour!), 6);
  });
});

describe("labourDemand", () => {
  it("ignores buildings with a non-positive count", () => {
    expect(labourDemand({ ore: -2, metals: 3 })).toBeCloseTo(3 * labourTotal(BUILDING_TYPES.metals!.labour!), 6);
  });
});

describe("labourFulfilment", () => {
  it("is 1 when no labour is demanded", () => {
    expect(labourFulfilment(0, 0)).toBe(1);
  });
  it("is min(1, population / demand)", () => {
    expect(labourFulfilment(100, 50)).toBe(1);
    expect(labourFulfilment(50, 100)).toBeCloseTo(0.5, 6);
  });
});

describe("housingPopCap", () => {
  it("returns housing.count × POP_CENTRE_DENSITY; zero pop-centres → floor is 0", () => {
    expect(housingPopCap({ [HOUSING_TYPE]: 5, ore: 3 })).toBeCloseTo(5 * POP_CENTRE_DENSITY, 6);
    expect(housingPopCap({ [HOUSING_TYPE]: 3 })).toBeCloseTo(3 * POP_CENTRE_DENSITY, 6);
    expect(housingPopCap({ ore: 3 })).toBe(0);
  });
});

describe("buildingProduction", () => {
  it("is count × outputPerUnit × fulfillment for the matching production type (unit yields)", () => {
    const buildings = { ore: 5 };
    const yields = unitResourceVector();
    expect(buildingProduction(buildings, "ore", FULL, yields)).toBeCloseTo(5 * OUTPUT_PER_UNIT["ore"], 6);
    expect(buildingProduction(buildings, "ore", half, yields)).toBeCloseTo(5 * OUTPUT_PER_UNIT["ore"] * 0.5, 6);
  });
  it("is 0 for a good with no buildings", () => {
    expect(buildingProduction({ ore: 5 }, "metals", FULL, unitResourceVector())).toBe(0);
  });
  it("multiplies tier-0 output by yields[resource] for ore (resource=ore)", () => {
    const buildings = { ore: 4 };
    const yields = makeResourceVector({ ore: 2.0 });
    // ore is tier-0; its resource is "ore"
    const base = buildingProduction(buildings, "ore", FULL, unitResourceVector());
    const boosted = buildingProduction(buildings, "ore", FULL, yields);
    expect(boosted).toBeCloseTo(base * 2.0, 6);
  });
  it("tier-1 good (metals) is NOT affected by yields regardless of ore yield", () => {
    const buildings = { metals: 3 };
    const yields = makeResourceVector({ ore: 5.0 });
    const base = buildingProduction(buildings, "metals", FULL, unitResourceVector());
    const withYield = buildingProduction(buildings, "metals", FULL, yields);
    expect(withYield).toBeCloseTo(base, 6);
  });

  it("defaults extractionEff to a neutral 1.0 vector when omitted", () => {
    const buildings = { ore: 4 };
    const withoutArg = buildingProduction(buildings, "ore", FULL, unitResourceVector());
    const withUnitEff = buildingProduction(buildings, "ore", FULL, unitResourceVector(), unitResourceVector());
    expect(withoutArg).toBeCloseTo(withUnitEff, 10);
  });

  it("Proves (5): an extractionModifier-style efficiency of 0.5 halves tier-0 output", () => {
    const buildings = { ore: 4 };
    const yields = unitResourceVector();
    const fullEff = unitResourceVector();
    const halfEff = makeResourceVector({ ore: 0.5 });
    const base = buildingProduction(buildings, "ore", FULL, yields, fullEff);
    const halved = buildingProduction(buildings, "ore", FULL, yields, halfEff);
    expect(halved).toBeCloseTo(base * 0.5, 6);
  });

  it("Proves (5): the same 0.5 efficiency leaves tier-1+ output untouched", () => {
    const buildings = { metals: 3 };
    const halfOreEff = makeResourceVector({ ore: 0.5 });
    const base = buildingProduction(buildings, "metals", FULL, unitResourceVector(), unitResourceVector());
    const withHalvedOreEff = buildingProduction(buildings, "metals", FULL, unitResourceVector(), halfOreEff);
    expect(withHalvedOreEff).toBeCloseTo(base, 6);
  });
});

describe("capacityGoodRates", () => {
  it("returns one entry per good with capacity production and population consumption", () => {
    const rates = capacityGoodRates({ ore: 4 }, 1000, unitResourceVector());
    const ore = rates.find((r) => r.goodId === "ore")!;
    const food = rates.find((r) => r.goodId === "food")!;
    expect(ore.production).toBeGreaterThan(0);
    expect(ore.consumption).toBeGreaterThan(0); // everyone consumes ore a little
    expect(food.production).toBe(0); // no food buildings
    expect(food.consumption).toBeGreaterThan(0);
  });
  it("applies the tier-0 yield multiplier to ore production", () => {
    const base = capacityGoodRates({ ore: 4 }, 1000, unitResourceVector());
    const boosted = capacityGoodRates({ ore: 4 }, 1000, makeResourceVector({ ore: 3.0 }));
    const oreBase = base.find((r) => r.goodId === "ore")!.production;
    const oreBoosted = boosted.find((r) => r.goodId === "ore")!.production;
    expect(oreBoosted).toBeCloseTo(oreBase * 3.0, 6);
  });

  it("a developed system consumes more basket goods than an academy-less one at equal population", () => {
    // electronics factories demand skilled heads; academies licence them.
    const developed = { electronics: 6, vocational_school: 3, research_institute: 2 };
    const frontier = {};
    const pop = 2000;
    const devRates = capacityGoodRates(developed, pop, unitResourceVector());
    const froRates = capacityGoodRates(frontier, pop, unitResourceVector());
    const get = (rates: SubstrateGoodRate[], id: string) => rates.find((r) => r.goodId === id)!;
    expect(get(devRates, "luxuries").consumption).toBeGreaterThan(get(froRates, "luxuries").consumption);
    expect(get(devRates, "consumer_goods").consumption).toBeGreaterThan(get(froRates, "consumer_goods").consumption);
    // non-basket goods stay population-only
    expect(get(devRates, "food").consumption).toBeCloseTo(get(froRates, "food").consumption, 10);
  });
});

describe("inputDemandForGood", () => {
  it("computes ore demand from a smelter (metals) building", () => {
    // metals recipe = { ore: 1 }. One metals building, fully staffed + fully licensed
    // (one vocational_school easily covers 4 metals buildings' skill1 demand: 4×7=28 ≪ 150).
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings); // exactly staffs them ⇒ labourFulfil 1
    const state = computeLabourState(buildings, pop);
    const yields = unitResourceVector();
    const metalsCapacity = 4 * OUTPUT_PER_UNIT["metals"] * effectiveFulfilment(state, GOOD_TIER_BY_KEY["metals"]);
    const expectedOreDemand = metalsCapacity * GOOD_RECIPES["metals"]["ore"] * INPUT_DEMAND_MULTIPLIER;
    expect(inputDemandForGood(buildings, "ore", state, yields)).toBeCloseTo(expectedOreDemand, 6);
  });

  it("returns 0 for a good nothing consumes as an input", () => {
    expect(inputDemandForGood({ metals: 4 }, "luxuries", FULL, unitResourceVector())).toBe(0);
  });

  it("sums across multiple consumers of the same input", () => {
    // minerals feeds chemicals, alloys, components.
    const buildings = { chemicals: 2, alloys: 2, components: 2 };
    const f = FULL;
    const yields = unitResourceVector();
    const direct =
      inputDemandForGood({ chemicals: 2 }, "minerals", f, yields) +
      inputDemandForGood({ alloys: 2 }, "minerals", f, yields) +
      inputDemandForGood({ components: 2 }, "minerals", f, yields);
    expect(inputDemandForGood(buildings, "minerals", f, yields)).toBeCloseTo(direct, 6);
  });
});

describe("inputDemandFromProduction", () => {
  it("equals inputDemandForGood when fed the production rates capacityGoodRates computes", () => {
    // A forge world drawing ore + minerals. The production-map path must equal the recompute path
    // good-for-good — same fulfillment/yields are baked into capacityGoodRates's production rates.
    const buildings = { metals: 4, alloys: 2 };
    const yields = unitResourceVector();
    const pop = labourDemand(buildings); // population == labour demand ⇒ labourFulfil 1
    const state = computeLabourState(buildings, pop);
    const productionByGood = new Map(
      capacityGoodRates(buildings, pop, yields).map((g) => [g.goodId, g.production]),
    );
    for (const goodId of ["ore", "minerals", "luxuries"]) {
      expect(inputDemandFromProduction(goodId, productionByGood)).toBeCloseTo(
        inputDemandForGood(buildings, goodId, state, yields),
        6,
      );
    }
  });

  it("returns 0 for a good nothing consumes as an input", () => {
    expect(inputDemandFromProduction("luxuries", new Map([["metals", 4]]))).toBe(0);
  });
});

describe("industryLandUsed", () => {
  it("sums factory footprint; excludes tier-0 extractors (deposit land) and housing (people land)", () => {
    // ore is a tier-0 extractor (sits on a deposit slot); housing sits on the people-land budget;
    // only metals sits on industry land.
    expect(industryLandUsed({ ore: 4, metals: 2, [HOUSING_TYPE]: 5 }))
      .toBeCloseTo(2 * DEFAULT_SPACE_COST, 6);
  });
  it("ignores non-positive counts", () => {
    expect(industryLandUsed({ metals: -3, fuel: 2 })).toBeCloseTo(2 * DEFAULT_SPACE_COST, 6);
  });
  it("reads identically whether or not housing is built — housing never touches industry land (Proves 3/4)", () => {
    expect(industryLandUsed({ metals: 3 }))
      .toBeCloseTo(industryLandUsed({ metals: 3, [HOUSING_TYPE]: 500 }), 6);
  });
});

describe("buildIndustryReadout", () => {
  // 3 metals buildings (recipe: { ore: 1 }), 5 housing, 1 vocational_school (licenses the
  // metals buildings' skill1 demand: 3×7=21 ≪ 150) so metals' tier-1 supply-chain isn't
  // skill-gated to zero — these tests are about input-gate throttling, not skill-gating.
  const buildings = { metals: 3, [HOUSING_TYPE]: 5, vocational_school: 1 };
  // Population exactly staffs the metals buildings (+ the school).
  const pop = labourDemand(buildings);
  // The emergency ration threshold (RATION_COVER × demand rate) sits above the low input
  // stocks these tests use, so a scarce input lands on the scarcity ramp rather than at a
  // reserve floor. The use rate feeds only the selling factor's knee (inert here — output
  // goods hold no stock in these fixtures), the demand rate only the ration threshold.
  const honestUseRateOf = (): number => 2.5;
  const one = (): number => 1;
  const demandRateOf = (): number => 2.5;

  it("labourFulfilment matches the helper formula", () => {
    const readout = buildIndustryReadout(buildings, pop, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const demand = labourDemand(buildings);
    const expected = labourFulfilment(pop, demand);
    expect(readout.labourFulfilment).toBeCloseTo(expected, 6);
  });

  it("housing appears with tier -1 and no outputGood", () => {
    const readout = buildIndustryReadout(buildings, pop, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing).toBeDefined();
    expect(housing.tier).toBe(-1);
    expect(housing.outputGood).toBeUndefined();
    expect(housing.count).toBe(5);
  });

  it("production buildings have outputGood and correct tier", () => {
    const readout = buildIndustryReadout(buildings, pop, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals).toBeDefined();
    expect(metals.outputGood).toBe("metals");
    expect(metals.tier).toBe(1); // metals is tier-1
    expect(metals.count).toBe(3);
  });

  it("supplyChain entry is throttled (inputGate < 1) inside the ration zone", () => {
    // Ore stock strictly below the ration threshold (RATION_COVER × 2.5 = 5) makes the ramp bite.
    const marketStock = { ore: 2 };
    const readout = buildIndustryReadout(buildings, pop, marketStock, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const entry = readout.supplyChain.find((e) => e.goodId === "metals")!;
    expect(entry).toBeDefined();
    expect(entry.inputGate).toBeLessThan(1);
    expect(entry.throttledBy).toContain("ore");
  });

  it("supplyChain entry is unthrottled (inputGate === 1) when input stock is ample", () => {
    // Ore stock above both the ration threshold and one tick's draw → the ramp does not bind.
    const fullyStaffedProduction = buildingProduction(buildings, "metals", FULL, unitResourceVector());
    const oreNeeded = fullyStaffedProduction * GOOD_RECIPES["metals"]["ore"];
    const marketStock = { ore: oreNeeded * 10 };
    const ampleDemand = (): number => oreNeeded / 40; // ration threshold oreNeeded/20 — far below the ample stock
    const readout = buildIndustryReadout(buildings, pop, marketStock, unitResourceVector(), { demandRateOf: ampleDemand, honestUseRateOf, anchorMultOf: one });
    const entry = readout.supplyChain.find((e) => e.goodId === "metals")!;
    expect(entry).toBeDefined();
    expect(entry.inputGate).toBeCloseTo(1, 6);
    expect(entry.throttledBy).toHaveLength(0);
  });

  it("gates a producer's displayed output on the scarcity ramp, not a reserve floor", () => {
    // ore stock = 2: below the legacy reserve floor (which gated output to zero) but > 0. On the
    // shared ramp a starved producer still draws toward empty, so its displayed output stays > 0.
    const producer = { metals: 3, vocational_school: 1 };
    const producerPop = labourDemand(producer);
    const readout = buildIndustryReadout(producer, producerPop, { ore: 2 }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    const gross = buildingProduction(producer, "metals", computeLabourState(producer, producerPop), unitResourceVector());
    const out = metals.output;
    expect(out).toBeDefined();
    expect(out).toBeGreaterThan(0); // not floored to zero
    expect(out).toBeLessThan(gross); // but the ramp still throttles
  });

  it("marks throttledBy only when the scarcity ramp binds, not at a fixed floor", () => {
    const producer = { metals: 3, vocational_school: 1 };
    const producerPop = labourDemand(producer);
    const gross = buildingProduction(producer, "metals", FULL, unitResourceVector());
    const oreDraw = gross * GOOD_RECIPES["metals"]["ore"];
    const rampDemand = (): number => oreDraw / 40; // ration threshold oreDraw/20 — never the binding line here
    const ample = buildIndustryReadout(producer, producerPop, { ore: oreDraw * 2 }, unitResourceVector(), { demandRateOf: rampDemand, honestUseRateOf, anchorMultOf: one });
    expect(ample.supplyChain.find((e) => e.goodId === "metals")!.throttledBy).toHaveLength(0);
    // Input below comfort ⇒ the ramp binds even though stock > 0.
    const scarce = buildIndustryReadout(producer, producerPop, { ore: oreDraw * 0.3 }, unitResourceVector(), { demandRateOf: rampDemand, honestUseRateOf, anchorMultOf: one });
    expect(scarce.supplyChain.find((e) => e.goodId === "metals")!.throttledBy).toContain("ore");
  });

  it("rations input draws on the caller's demand rate, never a rate recovered from the pricing band", () => {
    // The role-separation premise itself, as a failing test for its reversal. The band's anchor is
    // 100, so a threshold recovered from the band (RATION_COVER × 100 / the 40-cycle anchor = 5)
    // reads this stock as comfortably supplied — while the caller's stated demand rate puts the
    // genuine threshold at RATION_COVER × stock, well above it. The gate must read the ramp value
    // sqrt(1 / RATION_COVER), which it only does if the threshold comes from `demandRateOf`.
    const gross = buildingProduction(buildings, "metals", computeLabourState(buildings, pop), unitResourceVector());
    const oreDraw = gross * GOOD_RECIPES["metals"]["ore"];
    const stock = oreDraw * 2; // covers the draw, so availability never binds — the ramp alone decides
    expect(stock).toBeGreaterThan(5); // strictly above the band-derived threshold: the old rule reads 1 here
    const readout = buildIndustryReadout(buildings, pop, { ore: stock }, unitResourceVector(), { demandRateOf: () => stock, honestUseRateOf, anchorMultOf: one });
    const entry = readout.supplyChain.find((e) => e.goodId === "metals")!;
    expect(entry.inputGate).toBeCloseTo(Math.sqrt(1 / ECONOMY_CONSTANTS.RATION_COVER), 6);
    expect(entry.throttledBy).toContain("ore");
  });

  it("tier-0 goods (no recipe) are absent from supplyChain", () => {
    const readout = buildIndustryReadout({ ore: 5 }, 1000, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    expect(readout.supplyChain.find((e) => e.goodId === "ore")).toBeUndefined();
  });

  it("supplyChain is sorted by inputGate ascending (most-throttled first)", () => {
    // Two producers: metals (ore below comfort → throttled) and fuel (gas ample → unthrottled).
    // Both are tier-1 (skill1-gated); 1 vocational_school covers metals+fuel's combined
    // skill1 demand (3×7 + 2×7 = 35 ≪ 150) so neither is skill-gated to zero.
    const gasFuelProduction = buildingProduction({ fuel: 2 }, "fuel", FULL, unitResourceVector());
    const gasNeeded = gasFuelProduction * GOOD_RECIPES["fuel"]["gas"];
    const stock = { ore: 5, gas: gasNeeded * 10 };
    // gas's ration threshold sits below its ample stock; ore's (5) far above its stock (5 → ramp).
    const sortDemand = (g: string): number => (g === "gas" ? gasNeeded : 100) / 40;
    const sortBuildings = { metals: 3, fuel: 2, [HOUSING_TYPE]: 1, vocational_school: 1 };
    const readout = buildIndustryReadout(
      sortBuildings,
      pop + 2 * labourTotal(BUILDING_TYPES.fuel!.labour!) + labourTotal(BUILDING_TYPES.vocational_school!.labour!),
      stock,
      unitResourceVector(),
      { demandRateOf: sortDemand, honestUseRateOf, anchorMultOf: one },
    );
    const gates = readout.supplyChain.map((e) => e.inputGate);
    for (let i = 1; i < gates.length; i++) {
      expect(gates[i]).toBeGreaterThanOrEqual(gates[i - 1]);
    }
  });

});

describe("buildIndustryReadout — per-building used + idleReason", () => {
  const MIN = 5;
  // useRate 2.5 puts the knee's use term at 100; the output term can exceed it, so tests
  // that need a shut brake compute the stop from the same knee the readout derives.
  // Stock 5 is always inside the full-rate zone. The ration threshold is irrelevant to
  // used/idleReason.
  const honestUseRateOf = (): number => 2.5;
  const one = (): number => 1;
  const demandRateOf = (): number => 2.5;
  // Recipe-input stock comfortably above both the ration threshold (RATION_COVER × 2.5 = 5) and any
  // single-tick draw these small fixtures can make — isolates each test's own binding constraint
  // (labour/skill/selling) from the input gate this task adds. Every fixture below that builds a
  // "metals" or "electronics" producer must supply its own recipe inputs at this level, or the gate
  // silently becomes the binding constraint instead of the one the test names.
  const AMPLE = 1_000_000;

  it("housing used = occupancy (population / POP_CENTRE_DENSITY); 'occupancy' when under-filled", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 10 }, 6 * POP_CENTRE_DENSITY, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing.used).toBeCloseTo(6.6, 6);
    expect(housing.idleReason).toBe("occupancy");
  });

  it("producer used = count × min(effectiveFulfilment, sellingFactor); 'labour' when headcount binds", () => {
    // vocational_school licenses far more skill1 than 4 metals buildings demand (4×7=28 ≪ 150),
    // so skill1Fulfil stays 1 regardless of headcount — isolates the headcount gate.
    const buildings = { metals: 4, vocational_school: 1 };
    const demand = labourDemand(buildings);
    const pop = demand * 0.5; // labour fulfillment 0.5
    // Stock below the anchor sells freely (factor 1), so labour is the binding constraint.
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN, ore: AMPLE }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4 * 0.5, 6);
    expect(metals.idleReason).toBe("labour");
  });

  it("'skill1' when a tier-2 building is fully staffed but no academy licenses its skilled work", () => {
    // electronics (tier-2) demands skill1 + skill2; no vocational_school/research_institute
    // built → both skill ceilings are 0, dragging effectiveFulfilment below labourFulfil even
    // though headcount is fully staffed. Stock below the anchor keeps selling from confounding it.
    const buildings = { electronics: 4 };
    const pop = labourDemand(buildings); // headcount fully staffed
    const readout = buildIndustryReadout(buildings, pop, { electronics: MIN, components: AMPLE, chemicals: AMPLE }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const electronics = readout.buildings.find((b) => b.buildingType === "electronics")!;
    expect(electronics.used).toBeLessThan(4);
    expect(electronics.idleReason).toBe("skill1"); // neither academy → lower grade wins the tie
  });

  it("'selling' when selling factor binds (stock past the brake's stop)", () => {
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings); // fully staffed
    // stock past the ramp end → output piling up (factor 0), so selling is the binding constraint.
    const readout = buildIndustryReadout(buildings, pop, { metals: shutStock(buildings, pop), ore: AMPLE }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeLessThan(4 * 0.2);
    expect(metals.idleReason).toBe("selling");
  });

  it("funding-bound readout keeps a glutted producer fully used", () => {
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(
      buildings,
      pop,
      { metals: shutStock(buildings, pop), ore: AMPLE },
      unitResourceVector(),
      { demandRateOf, honestUseRateOf, anchorMultOf: one, logisticsFundingBoundOf: (goodId) => goodId === "metals" },
    );
    const metals = readout.buildings.find((building) => building.buildingType === "metals")!;
    expect(metals.used).toBe(4);
    expect(metals.idleReason).toBeUndefined();
  });

  it("no idleReason when fully staffed and selling", () => {
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN, ore: AMPLE }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4, 6);
    expect(metals.idleReason).toBeUndefined();
  });

  it("sells freely at an empty yard even with no stated use (knee from the output term alone)", () => {
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    // demandRateOf → 0 makes the ration threshold 0 too, so a positive ore stock alone (not
    // "ample" relative to a threshold that no longer exists) is what keeps the gate open — see
    // consumptionFactor's rationStock <= 0 branch (lib/engine/tick.ts:80).
    const readout = buildIndustryReadout(buildings, pop, { ore: AMPLE }, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4, 6); // selling factor 1, headcount + skill1 both fulfilled
  });

  it("fully staffed, freely selling producer reads idle with reason 'inputs' when its recipe input never arrived", () => {
    // Same fully-staffed, freely-selling fixture as "no idleReason when fully staffed and selling"
    // above, minus the ore stock: ore defaults to 0, so the gate — not labour or selling — is what
    // now binds. Proves entry 1.
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(0, 6);
    expect(metals.idleReason).toBe("inputs");
  });

  it("reports 'inputs', not 'labour', when the input gate binds tighter than an also-short labour pool", () => {
    // Half-staffed (fulfil 0.5) AND no ore at all (gate 0) — gate is the strict global minimum, so
    // it must be named over the also-real labour shortfall. Proves entry 3, the inputs-bind case.
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings) * 0.5;
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.idleReason).toBe("inputs");
  });

  it("reports 'labour', not 'inputs', when labour binds tighter than an unthrottled input gate", () => {
    // Half-staffed (fulfil 0.5) with ample ore (gate ≈ 1) — labour is the strict global minimum
    // here, well below the gate. Proves entry 3, the labour-binds case.
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings) * 0.5;
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN, ore: AMPLE }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    const gate = readout.supplyChain.find((e) => e.goodId === "metals")!.inputGate;
    expect(gate).toBeGreaterThan(0.5); // looser than the 0.5 labour floor
    expect(metals.idleReason).toBe("labour");
  });

  // A PARTIALLY throttled gate. Every fixture above reaches the input gate only at its two extremes
  // — 0 (no ore at all) or 1 (ample ore) — so the whole open interval, which is where the gate
  // actually lives in a running economy, is untested. Widening ore's own demand rate lifts its
  // ration threshold well above the stock supplied, putting the draw on the scarcity ramp:
  // consumptionFactor(500, RATION_COVER × 1000) = sqrt(500 / 2000) = 0.5.
  const ORE_DEMAND_RATE = 1000;
  const partialGateDemandRateOf = (goodId: string): number => (goodId === "ore" ? ORE_DEMAND_RATE : 2.5);
  const RAMPED_ORE_STOCK = 0.25 * ECONOMY_CONSTANTS.RATION_COVER * ORE_DEMAND_RATE; // cf = sqrt(0.25) = 0.5

  it("reports 'inputs' on a PARTIALLY throttled gate, not only a shut one", () => {
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings); // fully staffed: labour cannot be the binding constraint
    const readout = buildIndustryReadout(
      buildings, pop,
      { metals: MIN, ore: RAMPED_ORE_STOCK }, // metals at floor ⇒ sells freely, so selling cannot bind
      unitResourceVector(),
      { demandRateOf: partialGateDemandRateOf, honestUseRateOf, anchorMultOf: one },
    );
    const gate = readout.supplyChain.find((e) => e.goodId === "metals")!.inputGate;
    // The premise this fixture exists for, measured: a gate strictly inside (0, 1).
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(1);
    expect(gate).toBeCloseTo(0.5, 6);

    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4 * gate, 6); // the gate, not labour or selling, sets `used`
    expect(metals.idleReason).toBe("inputs");
  });

  it("reports 'selling', not 'inputs', when the selling allowance binds tighter than a partially throttled gate", () => {
    // canSell < gate < fulfil — the ordering case no existing fixture reaches, because every one of
    // them has the gate at an extreme. A glutted yard puts the selling factor at 0, so canSell is
    // USED_SLACK (0.15), below the 0.5 gate, which is itself below the fully staffed fulfil of 1.
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const glutted = shutStock(buildings, pop);
    const readout = buildIndustryReadout(
      buildings, pop,
      { metals: glutted, ore: RAMPED_ORE_STOCK },
      unitResourceVector(),
      { demandRateOf: partialGateDemandRateOf, honestUseRateOf, anchorMultOf: one },
    );
    const gate = readout.supplyChain.find((e) => e.goodId === "metals")!.inputGate;
    expect(gate).toBeCloseTo(0.5, 6);
    expect(gate).toBeGreaterThan(USED_SLACK); // canSell is exactly USED_SLACK at a shut brake
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.staffedFraction).toBeCloseTo(1, 6); // fulfil = 1, so canSell < gate < fulfil holds
    expect(metals.idleReason).toBe("selling");

    // Non-vacuous on the ORDERING, not just on this fixture: hold the glut and take the ore away,
    // so the gate drops below the same canSell, and the reason flips to "inputs". The chain really
    // is naming the strict minimum rather than preferring one cause outright.
    const starved = buildIndustryReadout(
      buildings, pop,
      { metals: glutted },
      unitResourceVector(),
      { demandRateOf: partialGateDemandRateOf, honestUseRateOf, anchorMultOf: one },
    );
    expect(starved.supplyChain.find((e) => e.goodId === "metals")!.inputGate).toBe(0);
    expect(starved.buildings.find((b) => b.buildingType === "metals")!.idleReason).toBe("inputs");
  });

  it("a tier-0 extractable never reports 'inputs' — it has no recipe to gate", () => {
    // ore is tier-0: GOOD_RECIPES has no entry for it, so inputGate is forced to 1 regardless of any
    // market state. Half-staffed to also confirm the extractor still reports its real (labour)
    // reason rather than silently going idle-with-no-reason. Proves entry 4.
    expect(GOOD_RECIPES["ore"]).toBeUndefined();
    const buildings = { ore: 4 };
    const pop = labourDemand(buildings) * 0.5;
    const readout = buildIndustryReadout(buildings, pop, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const ore = readout.buildings.find((b) => b.buildingType === "ore")!;
    expect(ore.idleReason).not.toBe("inputs");
    expect(ore.idleReason).toBe("labour");
  });

  it("a strict tie between the selling allowance and labour fulfilment falls to the labour/skill split, not 'selling'", () => {
    // The chain reads "selling" only on `canSell < fulfil` (lib/engine/industry.ts) — on an exact
    // tie it must cascade to the skill/labour split below, the same "ties fall to the next check"
    // convention the gate check above it already uses (proven directional, not at the tie itself, by
    // the two tests above). No existing fixture reaches the tie: every one sits strictly on one side.
    // Engineer canSell to land on fulfil exactly via the same brakeKnee/productionCeiling closed form
    // buildIndustryReadout itself uses to derive the selling factor.
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings) * 0.5; // labourFulfil 0.5; skill1Fulfil 1 (ample licence) ⇒ fulfil 0.5
    const state = computeLabourState(buildings, pop);
    const knee = brakeKnee(
      {
        useRate: 2.5,
        capacityProduction: buildingProduction(buildings, "metals", state, unitResourceVector()),
        anchorMult: 1,
      },
      ECONOMY_SIM_PARAMS,
    );
    const targetSellingFactor = 0.5 - USED_SLACK; // canSell = min(1, factor + USED_SLACK) = 0.5 = fulfil
    const metalsStock = knee.rampEnd - targetSellingFactor * (knee.rampEnd - knee.knee);
    // Premise: the inversion actually lands the selling factor where intended, not near it.
    expect(productionCeiling(metalsStock, knee)).toBeCloseTo(targetSellingFactor, 9);

    const readout = buildIndustryReadout(
      buildings, pop,
      { metals: metalsStock, ore: AMPLE }, // ample ore ⇒ gate ≈ 1, well clear of the tie
      unitResourceVector(),
      { demandRateOf, honestUseRateOf, anchorMultOf: one },
    );
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    // Premise: the tie is real (fulfil = 0.5), not a rounding coincidence on one side.
    expect(metals.staffedFraction).toBeCloseTo(0.5, 6);
    expect(readout.supplyChain.find((e) => e.goodId === "metals")!.inputGate).toBeCloseTo(1, 6);
    expect(metals.idleReason).toBe("labour");
  });
});

describe("buildIndustryReadout — skill idle reason split", () => {
  const MIN = 5;
  // Stock-at-floor goods sell freely (well under the knee/storage stop), isolating the skill gate.
  const honestUseRateOf = (): number => 2.5;
  const one = (): number => 1;
  const demandRateOf = (): number => 2.5;
  // See the sibling describe block above for why every metals/electronics fixture needs this.
  const AMPLE = 1_000_000;

  it("'skill1' when a tier-1 good is fully staffed but no school licenses it", () => {
    const buildings = { metals: 4 }; // tier-1 needs skill1; no vocational_school
    const pop = labourDemand(buildings); // headcount fully staffed
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN, ore: AMPLE }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    expect(readout.buildings.find((b) => b.buildingType === "metals")!.idleReason).toBe("skill1");
  });

  it("'skill2' when a tier-2 good has skill1 licensed but no institute", () => {
    // enough schools to cover skill1 demand, zero institutes → skill2 is the binding pool.
    const buildings = { electronics: 1, vocational_school: 5 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { electronics: MIN, components: AMPLE, chemicals: AMPLE }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    expect(readout.buildings.find((b) => b.buildingType === "electronics")!.idleReason).toBe("skill2");
  });

  it("'skill1' on a tier-2 good with neither academy (lower grade wins the tie)", () => {
    const buildings = { electronics: 4 }; // skill1Fulfil === skill2Fulfil === 0
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { electronics: MIN, components: AMPLE, chemicals: AMPLE }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    expect(readout.buildings.find((b) => b.buildingType === "electronics")!.idleReason).toBe("skill1");
  });
});

describe("industryHealth", () => {
  const T = 0.75; // unrestDecayThreshold
  it("is 'collapsing' when unrest is above the decay threshold (teardown)", () => {
    expect(industryHealth({ unrest: 0.8, idleLevels: 0, idleOnlyLevels: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("collapsing");
  });
  it("is 'contracting' when at least one whole level is idle for a decay-visible reason and unrest is calm", () => {
    expect(industryHealth({ unrest: 0.1, idleLevels: 3, idleOnlyLevels: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("contracting");
  });
  it("is 'stable' when no whole level is idle and unrest is calm", () => {
    expect(industryHealth({ unrest: 0.1, idleLevels: 0, idleOnlyLevels: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("stable");
  });
  it("does not fire at exactly the threshold (mirrors the engine's strictly-above teardown)", () => {
    expect(industryHealth({ unrest: T, idleLevels: 0, idleOnlyLevels: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("stable");
  });
  it("is 'idle' when a whole level is idle only for want of recipe inputs and no decay-visible idle level exists", () => {
    expect(industryHealth({ unrest: 0.1, idleLevels: 0, idleOnlyLevels: 2, unrestDecayThreshold: T })).toBe<IndustryHealth>("idle");
  });
  it("orders 'idle' below 'contracting': any decay-visible idle level wins even alongside input-only idle levels", () => {
    expect(industryHealth({ unrest: 0.1, idleLevels: 1, idleOnlyLevels: 5, unrestDecayThreshold: T })).toBe<IndustryHealth>("contracting");
  });
  it("orders 'collapsing' above both: unrest teardown wins even with input-only idle levels present", () => {
    expect(industryHealth({ unrest: 0.8, idleLevels: 0, idleOnlyLevels: 5, unrestDecayThreshold: T })).toBe<IndustryHealth>("collapsing");
  });
});

describe("buildingHealth (per-building)", () => {
  const T = 0.75; // unrestDecayThreshold

  it("is 'collapsing' when unrest is above the decay threshold (teardown, even in use)", () => {
    expect(buildingHealth({ used: 10, built: 10, unrest: 0.8, unrestDecayThreshold: T, idleReason: undefined })).toBe<IndustryHealth>("collapsing");
  });
  it("is 'collapsing' even when the whole idle level is input-starved — unrest teardown wins over everything", () => {
    expect(buildingHealth({ used: 0.9, built: 2, unrest: 0.8, unrestDecayThreshold: T, idleReason: "inputs" })).toBe<IndustryHealth>("collapsing");
  });
  it("is 'contracting' when a whole level is idle for a decay-visible reason — 0.9/2.0 → floor(1.1) = 1 idle level, reason 'labour'", () => {
    expect(buildingHealth({ used: 0.9, built: 2, unrest: 0, unrestDecayThreshold: T, idleReason: "labour" })).toBe<IndustryHealth>("contracting");
  });
  it("is 'idle', not 'contracting', when the same whole idle level is bound only by recipe inputs", () => {
    expect(buildingHealth({ used: 0.9, built: 2, unrest: 0, unrestDecayThreshold: T, idleReason: "inputs" })).toBe<IndustryHealth>("idle");
  });
  it("is 'stable' when understaffed by less than a whole unit — 1.5/2.0", () => {
    expect(buildingHealth({ used: 1.5, built: 2, unrest: 0, unrestDecayThreshold: T, idleReason: "inputs" })).toBe<IndustryHealth>("stable");
  });
  it("is 'stable' at 1.9/2.0 — the engine never sheds a sub-unit idle gap", () => {
    expect(buildingHealth({ used: 1.9, built: 2, unrest: 0, unrestDecayThreshold: T, idleReason: undefined })).toBe<IndustryHealth>("stable");
  });
  it("does not treat housing overshoot (used > built) as decay — it's a population sink, not infra", () => {
    expect(buildingHealth({ used: 12, built: 10, unrest: 0, unrestDecayThreshold: T, idleReason: undefined })).toBe<IndustryHealth>("stable");
  });
  it("is 'stable' when nothing is built (no base to decay)", () => {
    expect(buildingHealth({ used: 0, built: 0, unrest: 1, unrestDecayThreshold: T, idleReason: undefined })).toBe<IndustryHealth>("stable");
  });
});

describe("buildingHealth — reads 'idle' off a real buildIndustryReadout entry, never off an extractor", () => {
  const MIN = 5;
  const AMPLE = 1_000_000;
  const honestUseRateOf = (): number => 2.5;
  const one = (): number => 1;
  const demandRateOf = (): number => 2.5;
  const T = 0.75;

  it("a fully staffed, freely selling producer idle only for want of recipe inputs reads 'idle'", () => {
    // Same fixture as "reads idle with reason 'inputs'" above: fully staffed, freely selling, ore
    // stock 0 — the recipe gate is the only thing binding.
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.idleReason).toBe("inputs");
    expect(buildingHealth({ used: metals.used, built: metals.count, unrest: 0, unrestDecayThreshold: T, idleReason: metals.idleReason })).toBe<IndustryHealth>("idle");
  });

  it("a labour-bound producer still reads 'contracting' — decay can see a labour shortfall", () => {
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings) * 0.5;
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN, ore: AMPLE }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.idleReason).toBe("labour");
    expect(buildingHealth({ used: metals.used, built: metals.count, unrest: 0, unrestDecayThreshold: T, idleReason: metals.idleReason })).toBe<IndustryHealth>("contracting");
  });

  it("a tier-0 extractor never reads 'idle' — it has no recipe to be input-starved on", () => {
    expect(GOOD_RECIPES["ore"]).toBeUndefined();
    const buildings = { ore: 4 };
    const pop = labourDemand(buildings) * 0.5;
    const readout = buildIndustryReadout(buildings, pop, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const ore = readout.buildings.find((b) => b.buildingType === "ore")!;
    expect(ore.idleReason).toBe("labour");
    expect(buildingHealth({ used: ore.used, built: ore.count, unrest: 0, unrestDecayThreshold: T, idleReason: ore.idleReason })).toBe<IndustryHealth>("contracting");
  });
});

describe("perGradeStaffing", () => {
  const V = BUILDING_TYPES.electronics!.labour!; // tier-2: unskilled 30, skill1 20, skill2 10

  it("emits only the grades the tier draws on", () => {
    const s: LabourState = { labourFulfil: 1, skill1Fulfil: 1, skill2Fulfil: 1 };
    expect(perGradeStaffing(BUILDING_TYPES.ore!.labour!, 2, 0, s).map((g) => g.grade)).toEqual(["unskilled"]);
    expect(perGradeStaffing(BUILDING_TYPES.metals!.labour!, 2, 1, s).map((g) => g.grade)).toEqual(["unskilled", "skill1"]);
    expect(perGradeStaffing(V, 2, 2, s).map((g) => g.grade)).toEqual(["unskilled", "skill1", "skill2"]);
  });

  it("needed = built × vector share; filled = needed × grade fulfil", () => {
    const s: LabourState = { labourFulfil: 0.5, skill1Fulfil: 0.25, skill2Fulfil: 1 };
    const rows: GradeStaffing[] = perGradeStaffing(V, 3, 2, s);
    const u = rows.find((r) => r.grade === "unskilled")!;
    const t = rows.find((r) => r.grade === "skill1")!;
    expect(u.needed).toBeCloseTo(3 * 30, 6);
    expect(u.filled).toBeCloseTo(3 * 30 * 0.5, 6);
    expect(t.needed).toBeCloseTo(3 * 20, 6);
    expect(t.filled).toBeCloseTo(3 * 20 * 0.25, 6);
  });

  it("flags the binding (min-fulfil) grade as the wall", () => {
    const s: LabourState = { labourFulfil: 0.9, skill1Fulfil: 0.25, skill2Fulfil: 0.6 };
    const rows: GradeStaffing[] = perGradeStaffing(V, 1, 2, s);
    expect(rows.find((r) => r.wall)!.grade).toBe("skill1");
    expect(rows.filter((r) => r.wall)).toHaveLength(1);
  });

  it("breaks a min-fulfil tie toward the lower grade (skill1 over an equally-starved skill2)", () => {
    const s: LabourState = { labourFulfil: 0.9, skill1Fulfil: 0.25, skill2Fulfil: 0.25 };
    const rows: GradeStaffing[] = perGradeStaffing(V, 1, 2, s);
    expect(rows.find((r) => r.wall)!.grade).toBe("skill1"); // strict < keeps the earlier/lower grade on a tie
    expect(rows.filter((r) => r.wall)).toHaveLength(1);
  });
});

describe("buildingStorageForGood", () => {
  it("extractor stores its own resource good; factory stores its output", () => {
    expect(buildingStorageForGood({ ore: 3 }, "ore")).toBe(3 * EXTRACTOR_STORAGE_PER_UNIT);
    expect(buildingStorageForGood({ metals: 2 }, "metals")).toBe(2 * PRODUCTION_STORAGE_PER_UNIT);
    expect(buildingStorageForGood({ ore: 3 }, "metals")).toBe(0); // ore extractor doesn't store metals
  });
  it("population centres hold nominal-broad storage, generous on consumer goods", () => {
    expect(buildingStorageForGood({ [HOUSING_TYPE]: 5 }, "consumer_goods")).toBe(5 * POP_CENTRE_STORAGE.consumer_goods);
    expect(buildingStorageForGood({ [HOUSING_TYPE]: 5 }, "ore")).toBe(5 * POP_CENTRE_STORAGE_DEFAULT); // consumed staple, default
  });
  it("a population centre stores nothing for a good no one consumes", () => {
    // Every real good has a GOOD_CONSUMPTION entry, so this guards the defensive
    // zero-branch: an unknown / non-consumed good gets no pop-centre storage.
    expect(buildingStorageForGood({ [HOUSING_TYPE]: 5 }, "unobtainium")).toBe(0);
  });
  it("sums across a mixed build-out", () => {
    expect(buildingStorageForGood({ ore: 2, [HOUSING_TYPE]: 4 }, "ore"))
      .toBe(2 * EXTRACTOR_STORAGE_PER_UNIT + 4 * POP_CENTRE_STORAGE_DEFAULT);
  });
});

describe("extractorsByResource", () => {
  it("sums tier-0 extractor counts by their deposit resource; ignores factories and housing", () => {
    // ore → ore; food + textiles both → arable (shared deposit); metals is tier-1; housing has no resource.
    const v = extractorsByResource({ ore: 3, food: 1, textiles: 2, metals: 5, [HOUSING_TYPE]: 9 });
    expect(v.ore).toBe(3);
    expect(v.arable).toBe(3);
    expect(v.gas).toBe(0);
  });
  it("ignores non-positive counts", () => {
    expect(extractorsByResource({ ore: -2, gas: 4 }).ore).toBe(0);
    expect(extractorsByResource({ ore: -2, gas: 4 }).gas).toBe(4);
  });
});

describe("summariseSpace", () => {
  it("computes three independent used/total pairs: people (housing), industry (factories), deposit (extractor levels)", () => {
    // peopleLand 10, industryLand 40, deposit counts ore 20 + gas 5 = 25 total.
    // ore×4 extractors work deposit slots; metals×2 sits on industry land; housing×5 sits on people land.
    const counts = makeResourceVector({ ore: 20, gas: 5 });
    const space = summariseSpace(10, 40, counts, { ore: 4, metals: 2, [HOUSING_TYPE]: 5 });
    expect(space.people).toEqual({ used: 5 * DEFAULT_SPACE_COST, total: 10 });
    expect(space.industry).toEqual({ used: 2 * DEFAULT_SPACE_COST, total: 40 });
    expect(space.deposit).toEqual({ used: 4, total: 25 });
  });
  it("reads zero used across all three budgets when nothing is built", () => {
    const space = summariseSpace(10, 40, emptyResourceVector(), {});
    expect(space.people.used).toBe(0);
    expect(space.industry.used).toBe(0);
    expect(space.deposit.used).toBe(0);
  });
  it("a housing-full system reads full industry-land headroom untouched (Proves 1/3: disjoint budgets)", () => {
    // People land exhausted by housing; industry land carries no buildings at all.
    const space = summariseSpace(5, 100, emptyResourceVector(), { [HOUSING_TYPE]: 5 });
    expect(space.people.used).toBeCloseTo(space.people.total, 6);
    expect(space.industry.used).toBe(0);
  });
});

describe("summariseDeposits", () => {
  it("summarises present deposits: slot cap, worked slots, effective yield + its band", () => {
    const depositCounts = makeResourceVector({ ore: 12, gas: 2 });
    const worked = makeResourceVector({ ore: 5, gas: 0 });
    const yields = makeResourceVector({ ore: 1.55, gas: 1 }); // ore 1.55 → "good"; gas unworked 1.0 → "average"
    const deposits = summariseDeposits(depositCounts, worked, yields);
    // Only ore + gas have slots; sorted by depositCounts descending → ore first.
    expect(deposits.map((d) => d.resource)).toEqual(["ore", "gas"]);
    const ore = deposits[0];
    expect(ore.depositCounts).toBe(12);
    expect(ore.worked).toBe(5);
    expect(ore.yieldMult).toBeCloseTo(1.55, 6);
    expect(ore.band).toBe("good"); // 1.55 ≤ 1.8
    // Gas: unworked, neutral yield 1.0 → "average".
    expect(deposits[1].worked).toBe(0);
    expect(deposits[1].band).toBe("average");
  });
  it("excludes resources with no deposit slots", () => {
    expect(summariseDeposits(emptyResourceVector(), emptyResourceVector(), unitResourceVector())).toEqual([]);
  });
});

describe("skill gates", () => {
  const huge = 10_000_000; // population large enough that labourFulfil = 1

  it("a frontier world with no academies cannot run any tier-1+ production", () => {
    const buildings = { metals: 2, electronics: 2, ore: 2, components: 2 };
    const state = computeLabourState(buildings, huge);
    expect(state.skill1Fulfil).toBe(0);
    expect(state.skill2Fulfil).toBe(0);
    expect(buildingProduction(buildings, "metals", state, unitResourceVector())).toBe(0);      // tier-1 gated by skill1
    expect(buildingProduction(buildings, "electronics", state, unitResourceVector())).toBe(0); // tier-2 gated by skill1+2
    expect(buildingProduction(buildings, "ore", state, unitResourceVector())).toBeGreaterThan(0); // tier-0 ungated
  });

  it("schools without an institute run tier-1 but still block tier-2", () => {
    // enough schools to license the skill1 demand, zero institutes.
    const buildings = { metals: 1, electronics: 1, components: 1, vocational_school: 5 };
    const state = computeLabourState(buildings, huge);
    expect(state.skill1Fulfil).toBe(1);
    expect(state.skill2Fulfil).toBe(0);
    expect(buildingProduction(buildings, "metals", state, unitResourceVector())).toBeGreaterThan(0);
    expect(buildingProduction(buildings, "electronics", state, unitResourceVector())).toBe(0);
  });

  it("skill demand sums shares across all goods; cap sums academy licensing", () => {
    const buildings = { metals: 2, electronics: 3, vocational_school: 2, research_institute: 1 };
    // metals skill1 7×2=14; electronics tier-2 default skill1 20×3=60 → 74
    expect(skill1Demand(buildings)).toBeCloseTo(2 * 7 + 3 * 20, 6);
    expect(skill2Demand(buildings)).toBeCloseTo(3 * 10, 6);
    expect(skill1Cap(buildings)).toBeCloseTo(2 * SKILL1_PER_SCHOOL, 6);
    expect(skill2Cap(buildings)).toBeCloseTo(1 * SKILL2_PER_INSTITUTE, 6);
  });

  it("effectiveFulfilment applies the tier-appropriate pools", () => {
    const s = { labourFulfil: 0.9, skill1Fulfil: 0.5, skill2Fulfil: 0.2 };
    expect(effectiveFulfilment(s, 0)).toBe(0.9);
    expect(effectiveFulfilment(s, 1)).toBe(0.5);
    expect(effectiveFulfilment(s, 2)).toBe(0.2);
  });
});

describe("buildIndustryReadout — labour block", () => {
  it("reports workforce/skill1/skill2 supply, demand and fulfil", () => {
    // 3 electronics (tier-2: unskilled 30, skill1 20, skill2 10) + 1 school + 1 institute.
    const buildings = { electronics: 3, vocational_school: 1, research_institute: 1 };
    const pop = 100;
    const readout = buildIndustryReadout(buildings, pop, {}, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });

    const demand = labourDemand(buildings);
    expect(readout.labour.workforce.have).toBeCloseTo(pop, 6);
    expect(readout.labour.workforce.need).toBeCloseTo(demand, 6);
    expect(readout.labour.workforce.fulfil).toBeCloseTo(labourFulfilment(pop, demand), 6);

    expect(readout.labour.skill1.have).toBeCloseTo(skill1Cap(buildings), 6);
    expect(readout.labour.skill1.need).toBeCloseTo(skill1Demand(buildings), 6);
    expect(readout.labour.skill1.fulfil).toBeCloseTo(computeLabourState(buildings, pop).skill1Fulfil, 6);

    expect(readout.labour.skill2.have).toBeCloseTo(skill2Cap(buildings), 6);
    expect(readout.labour.skill2.need).toBeCloseTo(skill2Demand(buildings), 6);
    expect(readout.labour.skill2.fulfil).toBeCloseTo(computeLabourState(buildings, pop).skill2Fulfil, 6);
  });

  it("a demand-with-zero-cap skill pool reads fulfil 0 (no academy)", () => {
    const buildings = { metals: 2 }; // tier-1 needs skill1; no school built
    const readout = buildIndustryReadout(buildings, 1000, {}, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });
    expect(readout.labour.skill1.need).toBeGreaterThan(0);
    expect(readout.labour.skill1.have).toBe(0);
    expect(readout.labour.skill1.fulfil).toBe(0);
  });
});

describe("buildIndustryReadout — staffedFraction + output", () => {
  const MIN = 5;
  // Same brake fixture as the used+idleReason suite (use term 100, shut stocks computed via
  // shutStock); the ration threshold (RATION_COVER × demand rate) sits above the low input
  // stocks these tests use.
  const honestUseRateOf = (): number => 2.5;
  const one = (): number => 1;
  const demandRateOf = (): number => 2.5;

  it("producer staffedFraction = effectiveFulfilment(tier), independent of selling", () => {
    // fully staffed + licensed, but stock pinned past the brake's stop (not selling).
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { metals: shutStock(buildings, pop) }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.staffedFraction).toBeCloseTo(1, 6); // pure staffing full even though used (selling) is ~0
    expect(metals.used).toBeLessThan(4 * 0.2);         // used still folds the selling factor (unchanged)
  });

  it("housing staffedFraction stays literal while used includes vacancy protection", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 10 }, 6 * POP_CENTRE_DENSITY, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing.used).toBeCloseTo(6.6, 6);
    expect(housing.staffedFraction).toBeCloseTo(0.6, 6);
  });

  it("output = buildingProduction × inputGate (input-throttled reads low even when fully staffed)", () => {
    const buildings = { metals: 3, vocational_school: 1 };
    const pop = labourDemand(buildings);
    // ore below comfort → inputGate < 1; metals fully staffed.
    const readout = buildIndustryReadout(buildings, pop, { ore: MIN }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    const gate = readout.supplyChain.find((e) => e.goodId === "metals")!.inputGate;
    const gross = buildingProduction(buildings, "metals", computeLabourState(buildings, pop), unitResourceVector());
    expect(gate).toBeLessThan(1);
    expect(metals.output!).toBeCloseTo(gross * gate, 6);
  });

  it("output is 0 for a tier-1 good with no academy (skill-gated to zero)", () => {
    const buildings = { metals: 4 }; // no school → skill1Fulfil 0 → production 0
    const readout = buildIndustryReadout(buildings, labourDemand(buildings), { metals: MIN }, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    expect(readout.buildings.find((b) => b.buildingType === "metals")!.output).toBe(0);
  });

  it("housing and academies carry no output", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 3, vocational_school: 1 }, 100, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    expect(readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!.output).toBeUndefined();
    expect(readout.buildings.find((b) => b.buildingType === "vocational_school")!.output).toBeUndefined();
  });

  it("reads an over-licensed academy as idle (licence-draw), like a complex not a producer", () => {
    // 1 metals fab demands skill1 = 7; the school licenses SKILL1_PER_SCHOOL (150) ≫ that, so most of
    // its licensing sits idle — the readout must match decay (licence-draw), not the old staffing proxy.
    const buildings = { metals: 1, vocational_school: 1 };
    const pop = labourDemand(buildings) * 10; // plentiful → fully staffed on headcount
    const readout = buildIndustryReadout(buildings, pop, {}, unitResourceVector(), { demandRateOf, honestUseRateOf, anchorMultOf: one });
    const school = readout.buildings.find((b) => b.buildingType === "vocational_school")!;
    const s1 = BUILDING_TYPES.metals!.labour!.skill1;
    // used = 1 × min(1, skill1Demand / skill1Cap): mostly idle, well below the built count of 1.
    expect(school.used).toBeCloseTo(Math.min(1, s1 / SKILL1_PER_SCHOOL), 6);
    expect(school.used).toBeLessThan(0.2);
    // staffedFraction is the utilisation bar (used / count), matching housing/complex — not staffing.
    expect(school.staffedFraction).toBeCloseTo(school.used, 6);
  });
});

describe("computeLabourAllocation", () => {
  // parts: demand is total heads (unskilled + skill1 + skill2); unskilled jobs are the remainder.
  const parts = (p: Partial<LabourParts>): LabourParts => ({
    demand: 0, skill1Demand: 0, skill1Cap: 0, skill2Demand: 0, skill2Cap: 0, ...p,
  });

  it("decomposes a labour-surplus system into disjoint role buckets + unemployed summing to population", () => {
    // unskilled jobs = 177 - 26 - 11 = 140; caps exceed skill demand (idle seats live in skillLicensing).
    const a = computeLabourAllocation(
      parts({ demand: 177, skill1Demand: 26, skill1Cap: 27, skill2Demand: 11, skill2Cap: 11.5 }),
      183,
    );
    expect(a.population).toBe(183);
    expect(a.unskilled).toBeCloseTo(140, 6);
    expect(a.technicians).toBeCloseTo(26, 6);
    expect(a.engineers).toBeCloseTo(11, 6);
    expect(a.unemployed).toBeCloseTo(6, 6);
    expect(a.unskilled + a.technicians + a.engineers + a.unemployed).toBeCloseTo(183, 6);
  });

  it("puts the whole population in unemployed when nothing demands labour", () => {
    const a = computeLabourAllocation(parts({ demand: 0 }), 100);
    expect(a).toEqual({ population: 100, unskilled: 0, technicians: 0, engineers: 0, unemployed: 100 });
  });

  it("caps a skilled bucket at its licence ceiling — unlicensable jobs don't become skilled workers", () => {
    // skill2Cap 12 < skill2Demand 20: only 12 engineers exist; the 8 unlicensed jobs stay unfilled.
    const a = computeLabourAllocation(
      parts({ demand: 100, skill1Demand: 20, skill1Cap: 20, skill2Demand: 20, skill2Cap: 12 }),
      200,
    );
    expect(a.engineers).toBeCloseTo(12, 6);
    expect(a.technicians).toBeCloseTo(20, 6);
    expect(a.unskilled).toBeCloseTo(60, 6); // unskilled jobs = 100 - 20 - 20 = 60
    expect(a.unemployed).toBeCloseTo(108, 6);
  });

  it("fills scarce population skilled-first so segments never exceed population", () => {
    // pop 50 < total heads 100: engineers (20) + technicians (20) exhaust 40, unskilled gets the last 10, none idle.
    const a = computeLabourAllocation(
      parts({ demand: 100, skill1Demand: 20, skill1Cap: 20, skill2Demand: 20, skill2Cap: 20 }),
      50,
    );
    expect(a.engineers).toBeCloseTo(20, 6);
    expect(a.technicians).toBeCloseTo(20, 6);
    expect(a.unskilled).toBeCloseTo(10, 6);
    expect(a.unemployed).toBe(0);
    expect(a.unskilled + a.technicians + a.engineers).toBeCloseTo(50, 6);
  });

  it("treats a non-positive population as fully empty", () => {
    expect(computeLabourAllocation(parts({ demand: 50, skill1Demand: 10, skill1Cap: 10 }), 0))
      .toEqual({ population: 0, unskilled: 0, technicians: 0, engineers: 0, unemployed: 0 });
  });
});

describe("skillLicensing", () => {
  it("shows idle academy seats when licences exceed jobs — bar fills to working over the full ceiling", () => {
    const l = skillLicensing(11.5, 11);
    expect(l).toMatchObject({ jobs: 11, licensed: 11.5, working: 11, idleSeats: 0.5, unlicensedJobs: 0, full: 11.5 });
  });

  it("reads fully matched when licences equal jobs", () => {
    expect(skillLicensing(18, 18)).toMatchObject({ working: 18, idleSeats: 0, unlicensedJobs: 0, full: 18 });
  });

  it("flags unlicensed jobs when the academy is the wall — full width is the jobs, not the licences", () => {
    const l = skillLicensing(6, 9);
    expect(l).toMatchObject({ working: 6, idleSeats: 0, unlicensedJobs: 3, full: 9 });
  });
});

describe("buildIndustryReadout labourAllocation", () => {
  it("surfaces the population decomposition alongside the labour pools", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 5 }, 100, {}, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });
    // Housing-only system: no jobs, so everyone is unemployed and the buckets are empty.
    expect(readout.labourAllocation).toEqual({
      population: 100, unskilled: 0, technicians: 0, engineers: 0, unemployed: 100,
    });
  });
});

describe("buildIndustryReadout skillBaskets", () => {
  it("technicians and engineers baskets are non-empty, sorted descending by perHead, and drawn from the matching constant", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 5 }, 100, {}, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });
    const { technicians, engineers } = readout.skillBaskets;

    expect(technicians.length).toBeGreaterThan(0);
    expect(engineers.length).toBeGreaterThan(0);

    for (const entries of [technicians, engineers]) {
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].perHead).toBeLessThanOrEqual(entries[i - 1].perHead);
      }
    }

    for (const entry of technicians) expect(SKILL1_CONSUMPTION[entry.goodId]).toBe(entry.perHead);
    for (const entry of engineers) expect(SKILL2_CONSUMPTION[entry.goodId]).toBe(entry.perHead);
  });

  it("skillBaskets are the same for every readout (static per-grade catalogue, not system-dependent)", () => {
    const a = buildIndustryReadout({ [HOUSING_TYPE]: 5 }, 100, {}, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });
    const b = buildIndustryReadout({ metals: 3, [HOUSING_TYPE]: 5, vocational_school: 1 }, 1000, {}, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });
    expect(a.skillBaskets).toEqual(b.skillBaskets);
  });
});

describe("familyAnchorBuff", () => {
  it("is 1 for a tier-0 (un-familied) good regardless of complexes", () => {
    expect(familyAnchorBuff({ [HEAVY_INDUSTRY_COMPLEX]: 1 }, "water")).toBe(1);
  });
  it("is 1 when the family's complex is absent", () => {
    expect(familyAnchorBuff({ metals: 5 }, "metals")).toBe(1);
  });
  it("reaches the family's full multiplier at count = 1, scaling linearly below", () => {
    expect(familyAnchorBuff({ [HEAVY_INDUSTRY_COMPLEX]: 1 }, "metals")).toBeCloseTo(1.4);
    expect(familyAnchorBuff({ [HEAVY_INDUSTRY_COMPLEX]: 0.5 }, "metals")).toBeCloseTo(1.2);
  });
  it("caps at count = 1 (never runs away)", () => {
    expect(familyAnchorBuff({ [HEAVY_INDUSTRY_COMPLEX]: 3 }, "metals")).toBeCloseTo(1.4);
  });
});

describe("buildingProduction with a complex", () => {
  it("multiplies a family good's output by the buff", () => {
    const base = buildingProduction({ metals: 2 }, "metals", FULL, unitResourceVector());
    const buffed = buildingProduction({ metals: 2, [HEAVY_INDUSTRY_COMPLEX]: 1 }, "metals", FULL, unitResourceVector());
    expect(buffed / base).toBeCloseTo(1.4);
  });
  it("flows into input-demand (a buffed consumer draws more of its input)", () => {
    // metals ← ore; a Heavy complex buffs metals output → ore input-demand rises in step.
    const base = inputDemandForGood({ metals: 2 }, "ore", FULL, unitResourceVector());
    const buffed = inputDemandForGood({ metals: 2, [HEAVY_INDUSTRY_COMPLEX]: 1 }, "ore", FULL, unitResourceVector());
    expect(buffed / base).toBeCloseTo(1.4);
  });
});

const HEAVY = SPECIALISATION_FAMILIES.find((f) => f.complexType === HEAVY_INDUSTRY_COMPLEX)!;

describe("familyThroughput / complexUsed", () => {
  it("sums the family's factory output capacity (unbuffed)", () => {
    const one = familyThroughput({ metals: 1 }, HEAVY);
    expect(familyThroughput({ metals: 2 }, HEAVY)).toBeCloseTo(2 * one);
    expect(familyThroughput({}, HEAVY)).toBe(0);
  });
  it("holds a complex fully used when throughput ≥ its rated coverage", () => {
    expect(complexUsed(1, ANCHOR_RATED_COVERAGE * 2, ANCHOR_RATED_COVERAGE)).toBeCloseTo(1);
  });
  it("drops a complex's used toward throughput/rated when the family is thin", () => {
    expect(complexUsed(1, ANCHOR_RATED_COVERAGE * 0.25, ANCHOR_RATED_COVERAGE)).toBeCloseTo(0.25);
  });
  it("is 0 for an orphaned complex (no family production)", () => {
    expect(complexUsed(1, 0, ANCHOR_RATED_COVERAGE)).toBe(0);
  });
});

describe("computeSystemLabourSnapshot", () => {
  it("bundles the same state and allocation the standalone helpers produce", () => {
    const buildings = { electronics: 4, vocational_school: 2, research_institute: 1 };
    const snap = computeSystemLabourSnapshot(buildings, 500);
    const parts = labourParts(buildings);
    expect(snap.state).toEqual(labourStateFromParts(parts, 500));
    const alloc = computeLabourAllocation(parts, 500);
    expect(snap.basis.population).toBe(alloc.population);
    expect(snap.basis.technicians).toBe(alloc.technicians);
    expect(snap.basis.engineers).toBe(alloc.engineers);
  });
});

describe("buildIndustryReadout — complex row", () => {
  it("emits a complex entry with family-utilisation used (not labour-based)", () => {
    const buildings = { [HEAVY_INDUSTRY_COMPLEX]: 1 }; // orphaned: no metals factories
    const r = buildIndustryReadout(buildings, 1e9, {}, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });
    const row = r.buildings.find((b) => b.buildingType === HEAVY_INDUSTRY_COMPLEX)!;
    expect(row.used).toBe(0);            // orphaned → 0, despite population being huge
    expect(row.output).toBeUndefined();  // produces no good
  });
});

describe("buildIndustryReadout — support row (kind 'none')", () => {
  it("emits a fully-staffed centre entry shaped like an academy: tier 0, no output, used = count × labourFulfil", () => {
    const buildings = { [CONSTRUCTION_CENTRE_TYPE]: 2 };
    const pop = labourDemand(buildings); // exactly enough heads to fully staff it
    const readout = buildIndustryReadout(buildings, pop, {}, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });
    const centre = readout.buildings.find((b) => b.buildingType === CONSTRUCTION_CENTRE_TYPE)!;
    expect(centre.tier).toBe(0);
    expect(centre.outputGood).toBeUndefined();
    expect(centre.output).toBeUndefined();
    expect(centre.used).toBeCloseTo(2, 6);
    expect(centre.staffedFraction).toBeCloseTo(1, 6);
  });

  it("staffedFraction tracks labour fulfilment, not a producer's effectiveFulfilment, when understaffed", () => {
    const buildings = { [CONSTRUCTION_CENTRE_TYPE]: 4 };
    const pop = labourDemand(buildings) / 2; // half the required heads
    const readout = buildIndustryReadout(buildings, pop, {}, unitResourceVector(), { demandRateOf: () => 0, honestUseRateOf: () => 0, anchorMultOf: () => 1 });
    const centre = readout.buildings.find((b) => b.buildingType === CONSTRUCTION_CENTRE_TYPE)!;
    expect(centre.used).toBeCloseTo(2, 6); // count × labourFulfil = 4 × 0.5
    expect(centre.staffedFraction).toBeCloseTo(0.5, 6);
  });
});

describe("buildingUsed + computeUtilisation (unified per-output-kind utilisation)", () => {
  // One mixed base exercised across every output kind. Each expectation is computed from the SAME
  // helpers the old per-type branches used, so these are coherence witnesses, not magic numbers.
  const buildings: Record<string, number> = {
    ore: 5, // tier-0 extractor (market_good)
    metals: 3, // tier-1 producer (market_good), heavy-industry family
    housing: 4, // capacity/pop_cap
    vocational_school: 1, // capacity/skill1_licence
    research_institute: 1, // capacity/skill2_licence
    [HEAVY_INDUSTRY_COMPLEX]: 0.5, // modifier
  };
  const population = 100;
  const parts = labourParts(buildings);
  const state = labourStateFromParts(parts, population);
  const sellingFactors: Record<string, number> = { ore: 0.8, metals: 0.6 };
  const ctx: UtilisationContext = {
    buildings,
    population,
    parts,
    state,
    sellingFactor: (g) => sellingFactors[g] ?? 1,
  };

  it("market_good used = count × min(effectiveFulfilment(tier), selling factor)", () => {
    expect(buildingUsed("metals", 3, ctx)).toBeCloseTo(
      3 * Math.min(effectiveFulfilment(state, 1), 0.6 + 0.15),
      9,
    );
    expect(buildingUsed("ore", 5, ctx)).toBeCloseTo(
      5 * Math.min(effectiveFulfilment(state, 0), 0.8 + 0.15),
      9,
    );
  });

  it("market_good with no selling-factor entry sells freely (selling factor 1)", () => {
    expect(buildingUsed("metals", 3, { ...ctx, sellingFactor: () => 1 })).toBeCloseTo(
      3 * effectiveFulfilment(state, 1),
      9,
    );
  });

  it("funding-bound protection treats reachable demand as fully selling", () => {
    expect(buildingUsed("metals", 3, {
      ...ctx,
      sellingFactor: () => 0,
      logisticsFundingBound: () => true,
    })).toBeCloseTo(3 * effectiveFulfilment(state, 1), 9);
  });

  it("funding-bound protection does not hide staffing shortages", () => {
    const scarceState = labourStateFromParts(parts, parts.demand * 0.25);
    expect(buildingUsed("ore", 5, {
      ...ctx,
      state: scarceState,
      sellingFactor: () => 0,
      logisticsFundingBound: () => true,
    })).toBeCloseTo(5 * effectiveFulfilment(scarceState, 0), 9);
  });

  it("capacity/pop_cap used = occupancy, and may exceed count (overshoot)", () => {
    expect(buildingUsed("housing", 4, ctx)).toBe(4);
    expect(housingUsed(population)).toBeGreaterThan(4); // 100/20 = 5 > 4 built
    expect(computeUtilisation("housing", 4, ctx)).toBe(1); // clamped, despite overshoot
  });

  it("housingUsed remains literal occupancy", () => {
    expect(housingUsed(9.2 * POP_CENTRE_DENSITY)).toBeCloseTo(9.2);
  });

  it("buildingUsed grants housing the 10% vacancy allowance", () => {
    expect(buildingUsed("housing", 10, {
      ...ctx,
      population: 9.2 * POP_CENTRE_DENSITY,
    })).toBe(10);
  });

  it("genuine emptying still leaves a whole idle housing level", () => {
    const used = buildingUsed("housing", 10, {
      ...ctx,
      population: 8 * POP_CENTRE_DENSITY,
    });
    expect(Math.floor(10 - used)).toBe(1);
  });

  it("the pressure-relief target is inside the vacancy allowance", () => {
    expect(0.92 * 1.10).toBeGreaterThanOrEqual(1);
  });

  it("capacity/skill1_licence used = count × min(1, skill1Demand/skill1Cap)", () => {
    const expected = 1 * (parts.skill1Cap > 0 ? Math.min(1, parts.skill1Demand / parts.skill1Cap) : 0);
    expect(buildingUsed("vocational_school", 1, ctx)).toBeCloseTo(expected, 9);
    expect(expected).toBeGreaterThan(0); // metals demands skill-1, school licenses it
  });

  it("capacity/skill2_licence used = 0 when nothing demands skill-2", () => {
    expect(parts.skill2Demand).toBe(0); // no tier-2 producer in this base
    expect(buildingUsed("research_institute", 1, ctx)).toBe(0);
    expect(computeUtilisation("research_institute", 1, ctx)).toBe(0);
  });

  it("modifier used = complexUsed(count, familyThroughput, ANCHOR_RATED_COVERAGE)", () => {
    const family = SPECIALISATION_FAMILIES.find((f) => f.complexType === HEAVY_INDUSTRY_COMPLEX)!;
    const expected = complexUsed(0.5, familyThroughput(buildings, family), ANCHOR_RATED_COVERAGE);
    expect(buildingUsed(HEAVY_INDUSTRY_COMPLEX, 0.5, ctx)).toBeCloseTo(expected, 9);
  });

  it("none (unrecognised type, no catalog output) used = count × labourFulfil", () => {
    // A key absent from BUILDING_TYPES falls through to the `none` fallback (every real catalog
    // entry has a non-none output), so it is measured by headcount staffing alone.
    expect(buildingUsed("nonexistent_type", 3, ctx)).toBeCloseTo(3 * state.labourFulfil, 9);
    expect(computeUtilisation("nonexistent_type", 3, ctx)).toBeCloseTo(Math.min(1, state.labourFulfil), 9);
  });

  it("computeUtilisation = min(1, buildingUsed/count), and 0 at count 0", () => {
    for (const type of ["ore", "metals", "vocational_school", HEAVY_INDUSTRY_COMPLEX]) {
      const count = buildings[type];
      expect(computeUtilisation(type, count, ctx)).toBeCloseTo(
        Math.min(1, buildingUsed(type, count, ctx) / count),
        9,
      );
    }
    expect(computeUtilisation("metals", 0, ctx)).toBe(0);
  });
});
