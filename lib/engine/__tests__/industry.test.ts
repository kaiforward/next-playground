import { describe, it, expect } from "vitest";
import {
  labourDemand,
  labourFulfillment,
  housingPopCap,
  buildingProduction,
  capacityGoodRates,
  inputDemandForGood,
  inputDemandFromProduction,
  buildIndustryReadout,
  facilityStorageForGood,
  extractorsByResource,
  summariseDeposits,
  summariseSpace,
  generalSpaceUsed,
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
} from "@/lib/engine/industry";
import type { IndustryHealth, LabourState, GradeStaffing, LabourParts } from "@/lib/engine/industry";
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
} from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { unitResourceVector, makeResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import { HEAVY_INDUSTRY_COMPLEX } from "@/lib/constants/industry";

/** A fully-staffed labour state — headcount and both skill ceilings unconstrained. */
const FULL: LabourState = { labourFulfil: 1, skill1Fulfil: 1, skill2Fulfil: 1 };
/** Half-staffed on headcount only; skill ceilings unconstrained. */
const half: LabourState = { labourFulfil: 0.5, skill1Fulfil: 1, skill2Fulfil: 1 };

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

describe("labourFulfillment", () => {
  it("is 1 when no labour is demanded", () => {
    expect(labourFulfillment(0, 0)).toBe(1);
  });
  it("is min(1, population / demand)", () => {
    expect(labourFulfillment(100, 50)).toBe(1);
    expect(labourFulfillment(50, 100)).toBeCloseTo(0.5, 6);
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

describe("generalSpaceUsed", () => {
  it("sums factory + housing footprint; excludes tier-0 extractors (deposit land)", () => {
    // ore is a tier-0 extractor (sits on a deposit slot); metals + housing sit on general space.
    expect(generalSpaceUsed({ ore: 4, metals: 2, [HOUSING_TYPE]: 5 }))
      .toBeCloseTo((2 + 5) * DEFAULT_SPACE_COST, 6);
  });
  it("ignores non-positive counts", () => {
    expect(generalSpaceUsed({ metals: -3, fuel: 2 })).toBeCloseTo(2 * DEFAULT_SPACE_COST, 6);
  });
});

describe("buildIndustryReadout", () => {
  const MIN = 5;
  // 3 metals buildings (recipe: { ore: 1 }), 5 housing, 1 vocational_school (licenses the
  // metals buildings' skill1 demand: 3×7=21 ≪ 150) so metals' tier-1 supply-chain isn't
  // skill-gated to zero — these tests are about input-gate throttling, not skill-gating.
  const buildings = { metals: 3, [HOUSING_TYPE]: 5, vocational_school: 1 };
  // Population exactly staffs the metals buildings (+ the school).
  const pop = labourDemand(buildings);

  it("labourFulfillment matches the helper formula", () => {
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());
    const demand = labourDemand(buildings);
    const expected = labourFulfillment(pop, demand);
    expect(readout.labourFulfillment).toBeCloseTo(expected, 6);
  });

  it("housing appears with tier -1 and no outputGood", () => {
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing).toBeDefined();
    expect(housing.tier).toBe(-1);
    expect(housing.outputGood).toBeUndefined();
    expect(housing.count).toBe(5);
  });

  it("production buildings have outputGood and correct tier", () => {
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals).toBeDefined();
    expect(metals.outputGood).toBe("metals");
    expect(metals.tier).toBe(1); // metals is tier-1
    expect(metals.count).toBe(3);
  });

  it("supplyChain entry is throttled (inputGate < 1) when ore stock is at floor", () => {
    // ore stock = MIN (nothing drawable above floor)
    const marketStock = { ore: MIN };
    const readout = buildIndustryReadout(buildings, pop, marketStock, () => MIN, unitResourceVector());
    const entry = readout.supplyChain.find((e) => e.goodId === "metals")!;
    expect(entry).toBeDefined();
    expect(entry.inputGate).toBeLessThan(1);
    expect(entry.throttledBy).toContain("ore");
  });

  it("supplyChain entry is unthrottled (inputGate === 1) when ore stock is ample", () => {
    // ore stock far above what 3 metals buildings can draw in one tick
    const fullyStaffedProduction = buildingProduction(buildings, "metals", FULL, unitResourceVector());
    const oreNeeded = fullyStaffedProduction * GOOD_RECIPES["metals"]["ore"];
    const marketStock = { ore: MIN + oreNeeded * 10 };
    const readout = buildIndustryReadout(buildings, pop, marketStock, () => MIN, unitResourceVector());
    const entry = readout.supplyChain.find((e) => e.goodId === "metals")!;
    expect(entry).toBeDefined();
    expect(entry.inputGate).toBeCloseTo(1, 6);
    expect(entry.throttledBy).toHaveLength(0);
  });

  it("tier-0 goods (no recipe) are absent from supplyChain", () => {
    const readout = buildIndustryReadout({ ore: 5 }, 1000, {}, () => MIN, unitResourceVector());
    expect(readout.supplyChain.find((e) => e.goodId === "ore")).toBeUndefined();
  });

  it("supplyChain is sorted by inputGate ascending (most-throttled first)", () => {
    // Two producers: metals (ore recipe, stock at floor) and fuel (gas recipe, ample gas).
    // Both are tier-1 (skill1-gated); 1 vocational_school covers metals+fuel's combined
    // skill1 demand (3×7 + 2×7 = 35 ≪ 150) so neither is skill-gated to zero.
    const gasFuelProduction = buildingProduction({ fuel: 2 }, "fuel", FULL, unitResourceVector());
    const gasNeeded = gasFuelProduction * GOOD_RECIPES["fuel"]["gas"];
    const stock = { ore: MIN, gas: MIN + gasNeeded * 10 };
    const sortBuildings = { metals: 3, fuel: 2, [HOUSING_TYPE]: 1, vocational_school: 1 };
    const readout = buildIndustryReadout(
      sortBuildings,
      pop + 2 * labourTotal(BUILDING_TYPES.fuel!.labour!) + labourTotal(BUILDING_TYPES.vocational_school!.labour!),
      stock,
      () => MIN,
      unitResourceVector(),
    );
    const gates = readout.supplyChain.map((e) => e.inputGate);
    for (let i = 1; i < gates.length; i++) {
      expect(gates[i]).toBeGreaterThanOrEqual(gates[i - 1]);
    }
  });

});

describe("buildIndustryReadout — per-building used + idleReason", () => {
  const MIN = 5;
  const MAX = 100;
  const MAXBAND = () => MAX;

  it("housing used = occupancy (population / POP_CENTRE_DENSITY); 'occupancy' when under-filled", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 10 }, 6 * POP_CENTRE_DENSITY, {}, () => MIN, unitResourceVector(), MAXBAND);
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing.used).toBeCloseTo(6, 6);
    expect(housing.idleReason).toBe("occupancy");
  });

  it("producer used = count × min(effectiveFulfilment, outputUptake); 'labour' when headcount binds", () => {
    // vocational_school licenses far more skill1 than 4 metals buildings demand (4×7=28 ≪ 150),
    // so skill1Fulfil stays 1 regardless of headcount — isolates the headcount gate.
    const buildings = { metals: 4, vocational_school: 1 };
    const demand = labourDemand(buildings);
    const pop = demand * 0.5; // labour fulfillment 0.5
    // stock at the floor → output sells freely (uptake ≈ 1), so labour is the binding constraint.
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4 * 0.5, 6);
    expect(metals.idleReason).toBe("labour");
  });

  it("'skill1' when a tier-2 building is fully staffed but no academy licenses its skilled work", () => {
    // electronics (tier-2) demands skill1 + skill2; no vocational_school/research_institute
    // built → both skill ceilings are 0, dragging effectiveFulfilment below labourFulfil even
    // though headcount is fully staffed. Stock at the floor keeps selling from confounding it.
    const buildings = { electronics: 4 };
    const pop = labourDemand(buildings); // headcount fully staffed
    const readout = buildIndustryReadout(buildings, pop, { electronics: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    const electronics = readout.buildings.find((b) => b.buildingType === "electronics")!;
    expect(electronics.used).toBeLessThan(4);
    expect(electronics.idleReason).toBe("skill1"); // neither academy → lower grade wins the tie
  });

  it("'selling' when output uptake binds (stock pinned at the ceiling)", () => {
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings); // fully staffed
    // stock at the ceiling → output piling up (uptake ≈ 0), so selling is the binding constraint.
    const readout = buildIndustryReadout(buildings, pop, { metals: MAX }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeLessThan(4 * 0.2);
    expect(metals.idleReason).toBe("selling");
  });

  it("no idleReason when fully staffed and selling", () => {
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4, 6);
    expect(metals.idleReason).toBeUndefined();
  });

  it("defaults output uptake to 1 when no maxStock band is supplied (sells freely)", () => {
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4, 6); // uptake 1, headcount + skill1 both fulfilled
  });
});

describe("buildIndustryReadout — skill idle reason split", () => {
  const MIN = 5;
  const MAXBAND = () => 100;

  it("'skill1' when a tier-1 good is fully staffed but no school licenses it", () => {
    const buildings = { metals: 4 }; // tier-1 needs skill1; no vocational_school
    const pop = labourDemand(buildings); // headcount fully staffed
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === "metals")!.idleReason).toBe("skill1");
  });

  it("'skill2' when a tier-2 good has skill1 licensed but no institute", () => {
    // enough schools to cover skill1 demand, zero institutes → skill2 is the binding pool.
    const buildings = { electronics: 1, vocational_school: 5 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { electronics: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === "electronics")!.idleReason).toBe("skill2");
  });

  it("'skill1' on a tier-2 good with neither academy (lower grade wins the tie)", () => {
    const buildings = { electronics: 4 }; // skill1Fulfil === skill2Fulfil === 0
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { electronics: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === "electronics")!.idleReason).toBe("skill1");
  });
});

describe("industryHealth", () => {
  const T = 0.75; // unrestDecayThreshold
  it("is 'declining' when unrest is at/above the decay threshold (snowball)", () => {
    expect(industryHealth({ labourFulfillment: 1, unrest: 0.8, idleFraction: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("declining");
  });
  it("is 'coasting' when idle capacity is meaningful but unrest is calm", () => {
    expect(industryHealth({ labourFulfillment: 0.5, unrest: 0.1, idleFraction: 0.4, unrestDecayThreshold: T })).toBe<IndustryHealth>("coasting");
  });
  it("is 'thriving' when built ≈ used and unrest is calm", () => {
    expect(industryHealth({ labourFulfillment: 1, unrest: 0.1, idleFraction: 0.02, unrestDecayThreshold: T })).toBe<IndustryHealth>("thriving");
  });
});

describe("buildingHealth (per-building)", () => {
  const T = 0.75; // unrestDecayThreshold

  it("is 'declining' when used exceeds built (housing overshoot)", () => {
    expect(buildingHealth({ used: 12, built: 10, unrest: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("declining");
  });
  it("is 'declining' when unrest is at/above the decay threshold (teardown)", () => {
    expect(buildingHealth({ used: 10, built: 10, unrest: 0.8, unrestDecayThreshold: T })).toBe<IndustryHealth>("declining");
  });
  it("is 'declining' when idle capacity is severe (≥ IDLE_COLLAPSING_FRACTION)", () => {
    expect(buildingHealth({ used: 3, built: 10, unrest: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("declining"); // idle 0.7
  });
  it("is 'coasting' when idle is past the deadband but not severe", () => {
    expect(buildingHealth({ used: 8, built: 10, unrest: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("coasting"); // idle 0.2
  });
  it("is 'thriving' when in use within the slack deadband and calm", () => {
    expect(buildingHealth({ used: 9.5, built: 10, unrest: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("thriving"); // idle 0.05
  });
  it("is 'thriving' when nothing is built (no base to decay)", () => {
    expect(buildingHealth({ used: 0, built: 0, unrest: 1, unrestDecayThreshold: T })).toBe<IndustryHealth>("thriving");
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

describe("facilityStorageForGood", () => {
  it("extractor stores its own resource good; factory stores its output", () => {
    expect(facilityStorageForGood({ ore: 3 }, "ore")).toBe(3 * EXTRACTOR_STORAGE_PER_UNIT);
    expect(facilityStorageForGood({ metals: 2 }, "metals")).toBe(2 * PRODUCTION_STORAGE_PER_UNIT);
    expect(facilityStorageForGood({ ore: 3 }, "metals")).toBe(0); // ore extractor doesn't store metals
  });
  it("population centres hold nominal-broad storage, generous on consumer goods", () => {
    expect(facilityStorageForGood({ [HOUSING_TYPE]: 5 }, "consumer_goods")).toBe(5 * POP_CENTRE_STORAGE.consumer_goods);
    expect(facilityStorageForGood({ [HOUSING_TYPE]: 5 }, "ore")).toBe(5 * POP_CENTRE_STORAGE_DEFAULT); // consumed staple, default
  });
  it("a population centre stores nothing for a good no one consumes", () => {
    // Every real good has a GOOD_CONSUMPTION entry, so this guards the defensive
    // zero-branch: an unknown / non-consumed good gets no pop-centre storage.
    expect(facilityStorageForGood({ [HOUSING_TYPE]: 5 }, "unobtainium")).toBe(0);
  });
  it("sums across a mixed build-out", () => {
    expect(facilityStorageForGood({ ore: 2, [HOUSING_TYPE]: 4 }, "ore"))
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
  it("partitions available into deposit/general/habitable and tracks built land per partition", () => {
    // available 100, general 40 → deposit 60; habitable 10.
    // ore×4 extractors sit on deposit land; metals×2 factories + housing×5 sit on general; housing also on habitable.
    const space = summariseSpace(100, 40, 10, { ore: 4, metals: 2, [HOUSING_TYPE]: 5 });
    expect(space.available).toBe(100);
    expect(space.general).toBe(40);
    expect(space.habitable).toBe(10);
    expect(space.deposit).toBe(60);
    expect(space.depositWorked).toBeCloseTo(4 * SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT, 6);
    expect(space.generalUsed).toBeCloseTo((2 + 5) * DEFAULT_SPACE_COST, 6);
    expect(space.habitableUsed).toBeCloseTo(5 * DEFAULT_SPACE_COST, 6);
  });
  it("clamps deposit to zero when general exceeds available (degenerate input)", () => {
    expect(summariseSpace(10, 40, 5, {}).deposit).toBe(0);
  });
});

describe("summariseDeposits", () => {
  it("summarises present deposits: slot cap, worked slots, effective yield + its band", () => {
    const slotCap = makeResourceVector({ ore: 12, gas: 2 });
    const worked = makeResourceVector({ ore: 5, gas: 0 });
    const yields = makeResourceVector({ ore: 1.55, gas: 1 }); // ore 1.55 → "good"; gas unworked 1.0 → "average"
    const deposits = summariseDeposits(slotCap, worked, yields);
    // Only ore + gas have slots; sorted by slotCap descending → ore first.
    expect(deposits.map((d) => d.resource)).toEqual(["ore", "gas"]);
    const ore = deposits[0];
    expect(ore.slotCap).toBe(12);
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
  const MIN = 5;
  it("reports workforce/skill1/skill2 supply, demand and fulfil", () => {
    // 3 electronics (tier-2: unskilled 30, skill1 20, skill2 10) + 1 school + 1 institute.
    const buildings = { electronics: 3, vocational_school: 1, research_institute: 1 };
    const pop = 100;
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());

    const demand = labourDemand(buildings);
    expect(readout.labour.workforce.have).toBeCloseTo(pop, 6);
    expect(readout.labour.workforce.need).toBeCloseTo(demand, 6);
    expect(readout.labour.workforce.fulfil).toBeCloseTo(labourFulfillment(pop, demand), 6);

    expect(readout.labour.skill1.have).toBeCloseTo(skill1Cap(buildings), 6);
    expect(readout.labour.skill1.need).toBeCloseTo(skill1Demand(buildings), 6);
    expect(readout.labour.skill1.fulfil).toBeCloseTo(computeLabourState(buildings, pop).skill1Fulfil, 6);

    expect(readout.labour.skill2.have).toBeCloseTo(skill2Cap(buildings), 6);
    expect(readout.labour.skill2.need).toBeCloseTo(skill2Demand(buildings), 6);
    expect(readout.labour.skill2.fulfil).toBeCloseTo(computeLabourState(buildings, pop).skill2Fulfil, 6);
  });

  it("a demand-with-zero-cap skill pool reads fulfil 0 (no academy)", () => {
    const buildings = { metals: 2 }; // tier-1 needs skill1; no school built
    const readout = buildIndustryReadout(buildings, 1000, {}, () => MIN, unitResourceVector());
    expect(readout.labour.skill1.need).toBeGreaterThan(0);
    expect(readout.labour.skill1.have).toBe(0);
    expect(readout.labour.skill1.fulfil).toBe(0);
  });
});

describe("buildIndustryReadout — staffedFraction + output", () => {
  const MIN = 5;
  const MAXBAND = () => 100;

  it("producer staffedFraction = effectiveFulfilment(tier), independent of selling", () => {
    // fully staffed + licensed, but stock pinned at the ceiling (not selling).
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { metals: 100 }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.staffedFraction).toBeCloseTo(1, 6); // pure staffing full even though used (selling) is ~0
    expect(metals.used).toBeLessThan(4 * 0.2);         // used still folds uptake (unchanged)
  });

  it("housing staffedFraction = occupancy (used / count)", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 10 }, 6 * POP_CENTRE_DENSITY, {}, () => MIN, unitResourceVector(), MAXBAND);
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing.staffedFraction).toBeCloseTo(0.6, 6);
  });

  it("output = buildingProduction × inputGate (input-throttled reads low even when fully staffed)", () => {
    const buildings = { metals: 3, vocational_school: 1 };
    const pop = labourDemand(buildings);
    // ore at floor → inputGate < 1; metals fully staffed.
    const readout = buildIndustryReadout(buildings, pop, { ore: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    const gate = readout.supplyChain.find((e) => e.goodId === "metals")!.inputGate;
    const gross = buildingProduction(buildings, "metals", computeLabourState(buildings, pop), unitResourceVector());
    expect(gate).toBeLessThan(1);
    expect(metals.output!).toBeCloseTo(gross * gate, 6);
  });

  it("output is 0 for a tier-1 good with no academy (skill-gated to zero)", () => {
    const buildings = { metals: 4 }; // no school → skill1Fulfil 0 → production 0
    const readout = buildIndustryReadout(buildings, labourDemand(buildings), { metals: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === "metals")!.output).toBe(0);
  });

  it("housing and academies carry no output", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 3, vocational_school: 1 }, 100, {}, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!.output).toBeUndefined();
    expect(readout.buildings.find((b) => b.buildingType === "vocational_school")!.output).toBeUndefined();
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
  const MIN = 5;
  const MAXBAND = () => 100;

  it("surfaces the population decomposition alongside the labour pools", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 5 }, 100, {}, () => MIN, unitResourceVector(), MAXBAND);
    // Housing-only system: no jobs, so everyone is unemployed and the buckets are empty.
    expect(readout.labourAllocation).toEqual({
      population: 100, unskilled: 0, technicians: 0, engineers: 0, unemployed: 100,
    });
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
    const r = buildIndustryReadout(buildings, 1e9, {}, () => 0, unitResourceVector());
    const row = r.buildings.find((b) => b.buildingType === HEAVY_INDUSTRY_COMPLEX)!;
    expect(row.used).toBe(0);            // orphaned → 0, despite population being huge
    expect(row.output).toBeUndefined();  // produces no good
  });
});
