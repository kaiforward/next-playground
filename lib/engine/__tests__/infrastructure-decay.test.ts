import { describe, it, expect } from "vitest";
import {
  housingUsed,
  idleLevels,
  computeSystemDecay,
  type DecayParams,
} from "@/lib/engine/infrastructure-decay";
import {
  HOUSING_TYPE,
  POP_CENTRE_DENSITY,
  BUILDING_TYPES,
  labourTotal,
  VOCATIONAL_SCHOOL_TYPE,
  HEAVY_INDUSTRY_COMPLEX,
} from "@/lib/constants/industry";

const ORE_LABOUR = labourTotal(BUILDING_TYPES.ore!.labour!);

/** Buffered decay: a level must sit idle 3 runs before the marginal level sheds; θ_decay 0.75. */
const PARAMS: DecayParams = { idleBufferMonths: 3, unrestThreshold: 0.75 };
/** Never sheds — for asserting "no-op" paths. */
const NO_DECAY: DecayParams = { idleBufferMonths: 9999, unrestThreshold: 1 };

const noUptake = () => 1;

describe("housingUsed", () => {
  it("is population / POP_CENTRE_DENSITY (housing the current pop fills)", () => {
    expect(housingUsed(200)).toBeCloseTo(200 / POP_CENTRE_DENSITY, 6);
    expect(housingUsed(0)).toBe(0);
    expect(housingUsed(-50)).toBe(0);
  });
});

describe("idleLevels", () => {
  it("is the whole levels of unused capacity (floor of count − used)", () => {
    expect(idleLevels(5, 3.2)).toBe(1); // 1.8 idle → one whole idle level
    expect(idleLevels(5, 4.9)).toBe(0); // 0.1 idle → not a whole level
    expect(idleLevels(5, 5)).toBe(0);
  });

  it("is negative (never idle) when utilization exceeds count — housing over-crowding", () => {
    expect(idleLevels(3, 5)).toBe(-2);
  });
});

describe("computeSystemDecay — whole-level buffered contraction", () => {
  it("does not shed a viable system (built = used, calm) and leaves idle countdowns at 0", () => {
    const result = computeSystemDecay(
      {
        buildings: { [HOUSING_TYPE]: 5, ore: 2 },
        buildingIdleMonths: {},
        population: 100, // fills 5 housing exactly; 2 ore fully staffed + selling
        unrest: 0,
        outputUptake: noUptake,
      },
      PARAMS,
    );
    expect(result.newCounts).toEqual({});
    expect(result.newIdleMonths).toEqual({});
    expect(result.popCap).toBeCloseTo(5 * POP_CENTRE_DENSITY, 6);
  });

  it("counts an idle building's buffer up without shedding below the threshold", () => {
    // 3 ore, population 0 → used 0 → all 3 levels idle. Countdown 1 → 2, no removal (buffer 3).
    const result = computeSystemDecay(
      { buildings: { ore: 3 }, buildingIdleMonths: { ore: 1 }, population: 0, unrest: 0, outputUptake: noUptake },
      PARAMS,
    );
    expect(result.newCounts).toEqual({});
    expect(result.newIdleMonths.ore).toBe(2);
  });

  it("sheds exactly one whole level at the buffer and resets the countdown", () => {
    const result = computeSystemDecay(
      { buildings: { ore: 3 }, buildingIdleMonths: { ore: 2 }, population: 0, unrest: 0, outputUptake: noUptake },
      PARAMS,
    );
    expect(result.newCounts.ore).toBe(2); // one level torn down; count stays integer
    expect(Number.isInteger(result.newCounts.ore)).toBe(true);
    expect(result.newIdleMonths.ore).toBe(0); // countdown reset after shedding
  });

  it("resets the countdown when a level refills, without shedding (hysteresis)", () => {
    // Fully staffed + selling now → no idle level, so a mid-countdown building recovers for free.
    const result = computeSystemDecay(
      {
        buildings: { ore: 3 },
        buildingIdleMonths: { ore: 2 },
        population: 3 * ORE_LABOUR,
        unrest: 0,
        outputUptake: noUptake,
      },
      PARAMS,
    );
    expect(result.newCounts).toEqual({});
    expect(result.newIdleMonths.ore).toBe(0);
  });

  it("tears down a whole level immediately when unrest exceeds the threshold (discrete collapse)", () => {
    // 2 ore fully staffed + selling (not idle), but unrest 1 > 0.75 → one level torn down anyway.
    const result = computeSystemDecay(
      { buildings: { ore: 2 }, buildingIdleMonths: {}, population: 2 * ORE_LABOUR, unrest: 1, outputUptake: noUptake },
      PARAMS,
    );
    expect(result.newCounts.ore).toBe(1);
    expect(Number.isInteger(result.newCounts.ore)).toBe(true);
  });

  it("recomputes popCap from the surviving housing when a housing level sheds", () => {
    const result = computeSystemDecay(
      { buildings: { [HOUSING_TYPE]: 5 }, buildingIdleMonths: { [HOUSING_TYPE]: 2 }, population: 0, unrest: 0, outputUptake: noUptake },
      PARAMS,
    );
    expect(result.newCounts[HOUSING_TYPE]).toBe(4);
    expect(result.popCap).toBeCloseTo(4 * POP_CENTRE_DENSITY, 6);
  });

  it("is a no-op under a never-expiring buffer and sub-threshold unrest", () => {
    const result = computeSystemDecay(
      { buildings: { [HOUSING_TYPE]: 3, ore: 1 }, buildingIdleMonths: {}, population: 0, unrest: 0.7, outputUptake: () => 0 },
      NO_DECAY,
    );
    expect(result.newCounts).toEqual({});
    // Idle countdowns still advance (they just never reach the never-expiring buffer).
    expect(result.newIdleMonths[HOUSING_TYPE]).toBe(1);
    expect(result.newIdleMonths.ore).toBe(1);
  });
});

describe("computeSystemDecay — every output kind sheds whole levels uniformly", () => {
  it("sheds an over-licensed academy level at the buffer (capacity output)", () => {
    // 2 vocational schools license far more skill-1 than one metals fab demands → ≥1 idle level.
    const buildings = { metals: 1, [VOCATIONAL_SCHOOL_TYPE]: 2, [HOUSING_TYPE]: 100 };
    const result = computeSystemDecay(
      { buildings, buildingIdleMonths: { [VOCATIONAL_SCHOOL_TYPE]: 2 }, population: 100000, unrest: 0, outputUptake: noUptake },
      PARAMS,
    );
    expect(result.newCounts[VOCATIONAL_SCHOOL_TYPE]).toBe(1);
  });

  it("sheds an orphaned specialisation complex at the buffer (modifier output)", () => {
    // No family factories → the complex buffs nothing → one whole idle level → sheds at the buffer.
    const result = computeSystemDecay(
      { buildings: { [HEAVY_INDUSTRY_COMPLEX]: 1 }, buildingIdleMonths: { [HEAVY_INDUSTRY_COMPLEX]: 2 }, population: 1e9, unrest: 0, outputUptake: noUptake },
      PARAMS,
    );
    expect(result.newCounts[HEAVY_INDUSTRY_COMPLEX]).toBe(0);
  });
});
