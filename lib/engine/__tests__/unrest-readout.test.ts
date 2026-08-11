import { describe, it, expect } from "vitest";
import { unrestContributors, unrestTrend, type UnrestContributorInput } from "@/lib/engine/unrest-readout";
import { accumulateUnrest, type SupplyState } from "@/lib/engine/population";
import { UNREST_PARAMS, CROWDING, POPULATION_PARAMS, STRIKE_PARAMS } from "@/lib/constants/population";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";

const benignSupply: SupplyState = {
  regime: "rationing", survivalShortfall: false, criticalWeight: 0, emptyBasket: false,
};

function baseInput(overrides: Partial<UnrestContributorInput> = {}): UnrestContributorInput {
  return {
    grievance: 0,
    d: 0,
    supply: benignSupply,
    taxPressure: 0,
    population: 500,
    popCap: 1000,
    crowdBrakeEnd: POPULATION_PARAMS.crowdBrakeEnd,
    unrest: UNREST_PARAMS,
    ...overrides,
  };
}

describe("unrestContributors", () => {
  it("sums to the settled unrest accumulateUnrest relaxes toward, for the same inputs — entry 1", () => {
    // A realistic mixed fixture: nonzero grievance, an absolute shortfall, AND a critical-good
    // weight, at a real tax level and an overcrowded population — every term nonzero at once, so
    // the identity is not trivially satisfied by a single-term case.
    const input = baseInput({
      grievance: 0.3,
      d: 0.2,
      supply: { regime: "rationing", survivalShortfall: false, criticalWeight: 0.15, emptyBasket: false },
      taxPressure: TAX_LEVEL_UNREST_PRESSURE.high,
      population: 1200,
      popCap: 1000,
    });
    const { goods, tax, crowding } = unrestContributors(input);
    const settled = goods + tax + crowding;

    // The fixed point accumulateUnrest relaxes toward is `floor + term`, independent of the
    // relaxation rate and of the starting unrest (UnrestParams docstring). Feeding the sum back in
    // as the current unrest must therefore leave it unmoved...
    expect(accumulateUnrest(settled, goods, tax + crowding, input.unrest)).toBeCloseTo(settled, 10);
    // ...and an arbitrary starting unrest must relax toward that same sum, not some other value —
    // ties the identity to the tick's own relaxation function, not just hand arithmetic.
    const fromElsewhere = accumulateUnrest(0.9, goods, tax + crowding, input.unrest);
    const closerToSettled = Math.abs(fromElsewhere - settled) < Math.abs(0.9 - settled);
    expect(closerToSettled).toBe(true);
  });

  it("reads zero tax for a system with no owning faction rather than falling back to a default level — entry 2 arm at the pure-function boundary: tax is a resolved pressure the caller supplies, so 0 in means 0 out, never a substituted level", () => {
    const { tax } = unrestContributors(baseInput({ taxPressure: 0 }));
    expect(tax).toBe(0);
  });

  it("reads zero crowding at or below the crowding onset and never exceeds CROWDING.PRESSURE_MAX, however overcrowded — entry 3", () => {
    expect(unrestContributors(baseInput({ population: 800, popCap: 1000 })).crowding).toBe(0);
    expect(unrestContributors(baseInput({ population: 1000, popCap: 1000 })).crowding).toBe(0);

    const farOvercrowded = unrestContributors(baseInput({ population: 1e9, popCap: 1000 })).crowding;
    expect(farOvercrowded).toBeLessThanOrEqual(CROWDING.PRESSURE_MAX);
    expect(farOvercrowded).toBeCloseTo(CROWDING.PRESSURE_MAX, 9);
    // A fully overcrowded world still cannot strike on crowding alone.
    expect(farOvercrowded).toBeLessThan(STRIKE_PARAMS.threshold);
  });
});

describe("unrestTrend", () => {
  it("reports rising when the settled target sits above current, and recovering when below — entry 4, both arms", () => {
    expect(unrestTrend(0.3, 0.5)).toBe("rising");
    expect(unrestTrend(0.5, 0.3)).toBe("recovering");
  });

  it("reports a defined arm with no stored history — a fresh world at zero unrest still lands on stable, not undefined — entry 5", () => {
    expect(unrestTrend(0, 0)).toBe("stable");
  });

  it("lands on stable exactly where settled equals current, rather than leaving a float-equality gap between rising and recovering", () => {
    expect(unrestTrend(0.42, 0.42)).toBe("stable");
  });
});
