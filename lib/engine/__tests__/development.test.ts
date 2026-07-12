import { describe, it, expect } from "vitest";
import { systemDevelopment, type DevelopmentInput } from "@/lib/engine/development";

/**
 * Fixture: a system's development inputs. Defaults are a barren, empty frontier
 * (no pop, no buildings, no habitable land) so each test opts into only the
 * fields it exercises.
 */
function devInput(partial: Partial<DevelopmentInput>): DevelopmentInput {
  return { buildings: {}, population: 0, habitableSpace: 0, ...partial };
}

describe("systemDevelopment", () => {
  it("reads 0 for an empty frontier (nothing built, no people)", () => {
    expect(systemDevelopment(devInput({ habitableSpace: 10 }))).toBe(0);
  });

  it("reads a small full colony far BELOW a large system with more absolute industry", () => {
    // The regression that motivated the absolute model: development is a magnitude, not a fill
    // fraction. A 1-housing/1-extractor colony that is 'full' for its size must still read low
    // because it has almost nothing in absolute terms; a system with 20× the industry reads high.
    const small = devInput({ buildings: { housing: 1, ore: 1 }, population: 20, habitableSpace: 5 });
    const large = devInput({ buildings: { ore: 20 }, population: 240, habitableSpace: 100 });
    const dSmall = systemDevelopment(small);
    const dLarge = systemDevelopment(large);
    expect(dSmall).toBeLessThan(dLarge);
    // Calibration-coupled bounds (POP_REF/INDUSTRY_REF): the tiny colony reads clearly
    // undeveloped, the large system clearly developed.
    expect(dSmall).toBeLessThan(0.25);
    expect(dLarge).toBeGreaterThan(0.6);
  });

  it("rises with population (absolute — more people, more developed)", () => {
    const base = { buildings: {}, habitableSpace: 20 };
    const sparse = systemDevelopment(devInput({ ...base, population: 50 }));
    const dense = systemDevelopment(devInput({ ...base, population: 400 }));
    expect(dense).toBeGreaterThan(sparse);
  });

  it("rises with staffed industry (absolute — more built-and-worked industry, more developed)", () => {
    const base = { population: 500, habitableSpace: 100 }; // ample labour to staff either build
    const light = systemDevelopment(devInput({ ...base, buildings: { ore: 2 } }));
    const heavy = systemDevelopment(devInput({ ...base, buildings: { ore: 8 } }));
    expect(heavy).toBeGreaterThan(light);
  });

  it("counts industry by what is STAFFED, not what is built (barren isolates it)", () => {
    // Barren (no habitable land) drops the pop term, so development is industry alone — isolating
    // the used-vs-built question. Same 10 built ore extractors; only staffing differs.
    // labourDemand = 10 × 10 = 100.
    const built = { buildings: { ore: 10 }, habitableSpace: 0 };
    const staffed = systemDevelopment(devInput({ ...built, population: 100 })); // staffing 1 → used 10
    const idle = systemDevelopment(devInput({ ...built, population: 30 })); //    staffing 0.3 → used 3
    expect(staffed).toBeGreaterThan(idle);
  });

  it("does not inflate when housing is built ahead of population (housing-immune)", () => {
    const base = { population: 50, habitableSpace: 20 };
    const withoutHousing = systemDevelopment(devInput({ ...base, buildings: {} }));
    const withHousing = systemDevelopment(devInput({ ...base, buildings: { housing: 5 } }));
    expect(withHousing).toBe(withoutHousing);
  });

  it("reads a barren system on its industry alone (no habitable land)", () => {
    // No habitable land → the pop term is dropped; a built-and-staffed extraction colony still
    // reads developed via industry, and an empty barren system reads 0.
    const worked = systemDevelopment(devInput({ buildings: { ore: 6 }, population: 100, habitableSpace: 0 }));
    const empty = systemDevelopment(devInput({ buildings: {}, population: 100, habitableSpace: 0 }));
    expect(worked).toBeGreaterThan(empty);
    expect(empty).toBe(0);
  });

  it("stays within [0,1] even when massively over-populated and over-built", () => {
    const dev = systemDevelopment(devInput({ buildings: { ore: 500 }, population: 100_000, habitableSpace: 500 }));
    expect(dev).toBeGreaterThanOrEqual(0);
    expect(dev).toBeLessThanOrEqual(1);
  });
});
