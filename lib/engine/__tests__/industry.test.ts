import { describe, it, expect } from "vitest";
import {
  bodyBuildSpace,
  labourDemand,
  labourFulfillment,
  buildSpaceUsed,
  housingPopCap,
  buildingProduction,
  capacityGoodRates,
  inputDemandForGood,
  buildIndustryReadout,
} from "@/lib/engine/industry";
import {
  BASE_SPACE,
  DEFAULT_LABOUR_PER_UNIT,
  HOUSING_POP_PROVIDED,
  OUTPUT_PER_UNIT,
  HOUSING_TYPE,
} from "@/lib/constants/industry";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";

describe("bodyBuildSpace", () => {
  it("scales with size and habitability", () => {
    expect(bodyBuildSpace(1, true)).toBeCloseTo(BASE_SPACE, 6);
    expect(bodyBuildSpace(2, true)).toBeCloseTo(BASE_SPACE * 2, 6);
    expect(bodyBuildSpace(1, false)).toBeLessThan(bodyBuildSpace(1, true));
  });
});

describe("labourDemand", () => {
  it("sums count × labourPerUnit across production types; housing demands none", () => {
    const buildings = { ore: 4, metals: 2, [HOUSING_TYPE]: 10 };
    expect(labourDemand(buildings)).toBeCloseTo(6 * DEFAULT_LABOUR_PER_UNIT, 6);
  });
  it("ignores buildings with a non-positive count", () => {
    expect(labourDemand({ ore: -2, metals: 3 })).toBeCloseTo(3 * DEFAULT_LABOUR_PER_UNIT, 6);
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

describe("buildSpaceUsed", () => {
  it("sums count × effectiveSpaceCost across all building types incl. housing", () => {
    const buildings = { ore: 3, [HOUSING_TYPE]: 5 };
    expect(buildSpaceUsed(buildings)).toBeCloseTo(8, 6); // default spaceCost 1.0
  });
  it("ignores buildings with a non-positive count", () => {
    expect(buildSpaceUsed({ ore: 3, [HOUSING_TYPE]: -5 })).toBeCloseTo(3, 6); // default spaceCost 1.0
  });
});

describe("housingPopCap", () => {
  it("returns housing.count × popProvided", () => {
    expect(housingPopCap({ [HOUSING_TYPE]: 5, ore: 3 })).toBeCloseTo(5 * HOUSING_POP_PROVIDED, 6);
    expect(housingPopCap({ ore: 3 })).toBe(0);
  });
});

describe("buildingProduction", () => {
  it("is count × outputPerUnit × fulfillment for the matching production type", () => {
    const buildings = { ore: 5 };
    expect(buildingProduction(buildings, "ore", 1)).toBeCloseTo(5 * OUTPUT_PER_UNIT["ore"], 6);
    expect(buildingProduction(buildings, "ore", 0.5)).toBeCloseTo(5 * OUTPUT_PER_UNIT["ore"] * 0.5, 6);
  });
  it("is 0 for a good with no buildings", () => {
    expect(buildingProduction({ ore: 5 }, "metals", 1)).toBe(0);
  });
});

describe("capacityGoodRates", () => {
  it("returns one entry per good with capacity production and population consumption", () => {
    const rates = capacityGoodRates({ ore: 4 }, 1000);
    const ore = rates.find((r) => r.goodId === "ore")!;
    const food = rates.find((r) => r.goodId === "food")!;
    expect(ore.production).toBeGreaterThan(0);
    expect(ore.consumption).toBeGreaterThan(0); // everyone consumes ore a little
    expect(food.production).toBe(0); // no food buildings
    expect(food.consumption).toBeGreaterThan(0);
  });
});

describe("inputDemandForGood", () => {
  it("computes ore demand from a smelter (metals) building", () => {
    // metals recipe = { ore: 1 }. One metals building, fully staffed.
    const buildings = { metals: 4 };
    const pop = labourDemand(buildings); // exactly staffs them ⇒ fulfillment 1
    const f = labourFulfillment(pop, labourDemand(buildings));
    const metalsCapacity = 4 * OUTPUT_PER_UNIT["metals"] * f;
    const expectedOreDemand = metalsCapacity * GOOD_RECIPES["metals"]["ore"];
    expect(inputDemandForGood(buildings, "ore", f)).toBeCloseTo(expectedOreDemand, 6);
  });

  it("returns 0 for a good nothing consumes as an input", () => {
    expect(inputDemandForGood({ metals: 4 }, "luxuries", 1)).toBe(0);
  });

  it("sums across multiple consumers of the same input", () => {
    // minerals feeds chemicals, alloys, components.
    const buildings = { chemicals: 2, alloys: 2, components: 2 };
    const f = 1;
    const direct =
      inputDemandForGood({ chemicals: 2 }, "minerals", f) +
      inputDemandForGood({ alloys: 2 }, "minerals", f) +
      inputDemandForGood({ components: 2 }, "minerals", f);
    expect(inputDemandForGood(buildings, "minerals", f)).toBeCloseTo(direct, 6);
  });
});

describe("buildIndustryReadout", () => {
  const MIN = ECONOMY_CONSTANTS.MIN_LEVEL;
  // One habitable size-1 body + one uninhabitable size-2 body.
  const bodies = [
    { size: 1, habitable: true },
    { size: 2, habitable: false },
  ];
  // 3 metals buildings (recipe: { ore: 1 }), 5 housing.
  const buildings = { metals: 3, [HOUSING_TYPE]: 5 };
  // Population exactly staffs the metals buildings.
  const pop = labourDemand(buildings);

  it("buildSpace.total and buildSpace.used match the helper formulas", () => {
    const readout = buildIndustryReadout(buildings, bodies, pop, {}, MIN);
    const expectedTotal = bodies.reduce((s, b) => s + bodyBuildSpace(b.size, b.habitable), 0);
    const expectedUsed = buildSpaceUsed(buildings);
    expect(readout.buildSpace.total).toBeCloseTo(expectedTotal, 6);
    expect(readout.buildSpace.used).toBeCloseTo(expectedUsed, 6);
  });

  it("labourFulfillment matches the helper formula", () => {
    const readout = buildIndustryReadout(buildings, bodies, pop, {}, MIN);
    const demand = labourDemand(buildings);
    const expected = labourFulfillment(pop, demand);
    expect(readout.labourFulfillment).toBeCloseTo(expected, 6);
  });

  it("housing appears with tier -1 and no outputGood", () => {
    const readout = buildIndustryReadout(buildings, bodies, pop, {}, MIN);
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing).toBeDefined();
    expect(housing.tier).toBe(-1);
    expect(housing.outputGood).toBeUndefined();
    expect(housing.count).toBe(5);
  });

  it("production buildings have outputGood and correct tier", () => {
    const readout = buildIndustryReadout(buildings, bodies, pop, {}, MIN);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals).toBeDefined();
    expect(metals.outputGood).toBe("metals");
    expect(metals.tier).toBe(1); // metals is tier-1
    expect(metals.count).toBe(3);
  });

  it("supplyChain entry is throttled (inputGate < 1) when ore stock is at floor", () => {
    // ore stock = MIN (nothing drawable above floor)
    const marketStock = { ore: MIN };
    const readout = buildIndustryReadout(buildings, bodies, pop, marketStock, MIN);
    const entry = readout.supplyChain.find((e) => e.goodId === "metals")!;
    expect(entry).toBeDefined();
    expect(entry.inputGate).toBeLessThan(1);
    expect(entry.throttledBy).toContain("ore");
  });

  it("supplyChain entry is unthrottled (inputGate === 1) when ore stock is ample", () => {
    // ore stock far above what 3 metals buildings can draw in one tick
    const fullyStaffedProduction = buildingProduction(buildings, "metals", 1);
    const oreNeeded = fullyStaffedProduction * GOOD_RECIPES["metals"]["ore"];
    const marketStock = { ore: MIN + oreNeeded * 10 };
    const readout = buildIndustryReadout(buildings, bodies, pop, marketStock, MIN);
    const entry = readout.supplyChain.find((e) => e.goodId === "metals")!;
    expect(entry).toBeDefined();
    expect(entry.inputGate).toBeCloseTo(1, 6);
    expect(entry.throttledBy).toHaveLength(0);
  });

  it("tier-0 goods (no recipe) are absent from supplyChain", () => {
    const readout = buildIndustryReadout({ ore: 5 }, bodies, 1000, {}, MIN);
    expect(readout.supplyChain.find((e) => e.goodId === "ore")).toBeUndefined();
  });

  it("supplyChain is sorted by inputGate ascending (most-throttled first)", () => {
    // Two producers: metals (ore recipe, stock at floor) and fuel (gas recipe, ample gas).
    const gasFuelProduction = buildingProduction({ fuel: 2 }, "fuel", 1);
    const gasNeeded = gasFuelProduction * GOOD_RECIPES["fuel"]["gas"];
    const stock = { ore: MIN, gas: MIN + gasNeeded * 10 };
    const readout = buildIndustryReadout(
      { metals: 3, fuel: 2, [HOUSING_TYPE]: 1 },
      bodies,
      pop + 2 * DEFAULT_LABOUR_PER_UNIT,
      stock,
      MIN,
    );
    const gates = readout.supplyChain.map((e) => e.inputGate);
    for (let i = 1; i < gates.length; i++) {
      expect(gates[i]).toBeGreaterThanOrEqual(gates[i - 1]);
    }
  });
});
