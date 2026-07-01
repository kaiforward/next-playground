import { describe, it, expect } from "vitest";
import {
  housingUsed,
  productionUsed,
  disuseDecay,
  unrestDecay,
  decayedCount,
  computeSystemDecay,
} from "@/lib/engine/infrastructure-decay";
import { HOUSING_TYPE, POP_CENTRE_DENSITY, BUILDING_TYPES, labourTotal } from "@/lib/constants/industry";

const ORE_LABOUR = labourTotal(BUILDING_TYPES.ore!.labour!);

const NO_DECAY = { disuseRate: 0, unrestRate: 0, unrestThreshold: 0.75 };

describe("housingUsed", () => {
  it("is population / POP_CENTRE_DENSITY (units of housing the current pop fills)", () => {
    expect(housingUsed(200)).toBeCloseTo(200 / POP_CENTRE_DENSITY, 6);
    expect(housingUsed(0)).toBe(0);
    expect(housingUsed(-50)).toBe(0); // negative population floors at 0
  });
});

describe("productionUsed", () => {
  it("is count × min(labourFulfillment, outputUptake)", () => {
    expect(productionUsed(10, 0.8, 0.5)).toBeCloseTo(5, 6); // uptake binds
    expect(productionUsed(10, 0.3, 0.9)).toBeCloseTo(3, 6); // labour binds
  });
});

describe("disuseDecay", () => {
  it("rots only the gap above used, scaled by the rate; zero when fully used", () => {
    expect(disuseDecay(10, 4, 0.1)).toBeCloseTo(0.1 * 6, 6);
    expect(disuseDecay(4, 10, 0.1)).toBe(0); // used ≥ count → no disuse
  });
});

describe("unrestDecay", () => {
  it("tears down working capacity only above the threshold, scaled by count and excess unrest", () => {
    expect(unrestDecay(20, 0.9, 0.02, 0.75)).toBeCloseTo(0.02 * 20 * 0.15, 6);
    expect(unrestDecay(20, 0.5, 0.02, 0.75)).toBe(0); // below threshold → no teardown
  });
});

describe("decayedCount", () => {
  it("subtracts disuse + unrest decay and never goes below 0", () => {
    const next = decayedCount(10, 4, 0.9, { disuseRate: 0.1, unrestRate: 0.02, unrestThreshold: 0.75 });
    const expected = 10 - 0.1 * 6 - 0.02 * 10 * 0.15;
    expect(next).toBeCloseTo(expected, 6);
    expect(decayedCount(0.001, 0, 1, { disuseRate: 1, unrestRate: 1, unrestThreshold: 0 })).toBe(0);
  });
});

describe("computeSystemDecay", () => {
  it("does not decay a viable system (built = used, calm) and recomputes popCap from housing", () => {
    // 5 housing → popCap 100 → population 100 exactly fills it (housingUsed = 5).
    // 2 'ore' extractors fully staffed and selling (uptake 1, labour 1) → used = 2.
    const input = {
      buildings: { [HOUSING_TYPE]: 5, ore: 2 },
      population: 100,
      unrest: 0,
      outputUptake: () => 1,
    };
    const params = { disuseRate: 0.01, unrestRate: 0.02, unrestThreshold: 0.75 };
    const result = computeSystemDecay(input, params);
    expect(result.newCounts).toEqual({}); // nothing decayed
    expect(result.popCap).toBeCloseTo(5 * POP_CENTRE_DENSITY, 6);
  });

  it("disuse-decays idle production toward used and shrinks popCap as excess housing rots", () => {
    // population = 4 × oreLabour → fulfillment 0.4 (10 ore extractors demand 10×oreLabour).
    // 10 housing → popCap 200, but population only fills population/DENSITY < 10 → housing rots too.
    const input = {
      buildings: { [HOUSING_TYPE]: 10, ore: 10 },
      population: 4 * ORE_LABOUR, // labourDemand(ore:10) = 10×oreLabour → fulfillment 0.4
      unrest: 0,
      outputUptake: () => 1,
    };
    const params = { disuseRate: 0.1, unrestRate: 0, unrestThreshold: 0.75 };
    const result = computeSystemDecay(input, params);
    expect(result.newCounts[HOUSING_TYPE]).toBeLessThan(10);
    expect(result.newCounts.ore).toBeLessThan(10);
    // popCap recomputed from the decayed housing count.
    expect(result.popCap).toBeCloseTo(result.newCounts[HOUSING_TYPE] * POP_CENTRE_DENSITY, 6);
  });

  it("unrest-decays even fully-used capacity above the threshold (the snowball)", () => {
    const input = {
      buildings: { [HOUSING_TYPE]: 5, ore: 2 },
      population: 100, // housing fully used, ore fully staffed
      unrest: 1,
      outputUptake: () => 1,
    };
    const params = { disuseRate: 0, unrestRate: 0.05, unrestThreshold: 0.75 };
    const result = computeSystemDecay(input, params);
    // Used = built, so disuse is 0; unrest tears down anyway:
    // unrestDecay = 0.05 · count · (1 − 0.75) → housing 5−0.0625, ore 2−0.025.
    expect(result.newCounts[HOUSING_TYPE]).toBeCloseTo(4.9375, 6);
    expect(result.newCounts.ore).toBeCloseTo(1.975, 6);
  });

  it("is a no-op (no writes) under zero rates", () => {
    const result = computeSystemDecay(
      { buildings: { [HOUSING_TYPE]: 3, ore: 1 }, population: 10, unrest: 1, outputUptake: () => 0 },
      NO_DECAY,
    );
    expect(result.newCounts).toEqual({});
  });
});
