import { describe, it, expect } from "vitest";
import { systemDevelopment, type DevelopmentInput } from "@/lib/engine/development";
import { emptyResourceVector, makeResourceVector } from "@/lib/engine/resources";

/**
 * Fixture: a system's development inputs. Defaults are a barren, empty frontier
 * (no pop, no buildings, no land) so each test opts into only the fields it
 * exercises.
 */
function devInput(partial: Partial<DevelopmentInput>): DevelopmentInput {
  return {
    buildings: {},
    population: 0,
    slotCap: emptyResourceVector(),
    generalSpace: 0,
    habitableSpace: 0,
    ...partial,
  };
}

describe("systemDevelopment", () => {
  it("reads 0 for an empty frontier with unbuilt potential", () => {
    // Lots of land/slots but nothing built and no people → nothing is developed.
    const sys = devInput({
      habitableSpace: 10,
      generalSpace: 20,
      slotCap: makeResourceVector({ ore: 10 }),
    });
    expect(systemDevelopment(sys)).toBe(0);
  });

  it("reads 0 for a system with no physical potential at all", () => {
    // No habitable land, no general space, no slots → no potential; guard against NaN (0/0).
    expect(systemDevelopment(devInput({ population: 100 }))).toBe(0);
  });

  it("blends population-fill and industry-fill against fixed geographic potential", () => {
    // habitablePotentialPop = (10 / 1) × 20 = 200; pop 100 → popFill 0.5.
    // ore: 4 built extractors staffed by pop 100 (demand 40, labourFulfil 1) → used 4.
    // industryPotential = slots(10×1) + generalSpace(20) = 30 → industryFill 4/30.
    // development = 0.5·0.5 + 0.5·(4/30).
    const sys = devInput({
      habitableSpace: 10,
      generalSpace: 20,
      slotCap: makeResourceVector({ ore: 10 }),
      population: 100,
      buildings: { ore: 4 },
    });
    expect(systemDevelopment(sys)).toBeCloseTo(0.5 * 0.5 + 0.5 * (4 / 30), 5);
  });

  it("rises with population (more people, more settled and more staffed)", () => {
    const base = {
      habitableSpace: 10,
      generalSpace: 20,
      slotCap: makeResourceVector({ ore: 10 }),
      buildings: { ore: 4 },
    };
    const sparse = systemDevelopment(devInput({ ...base, population: 20 }));
    const dense = systemDevelopment(devInput({ ...base, population: 100 }));
    expect(dense).toBeGreaterThan(sparse);
  });

  it("counts industry by what is STAFFED, not what is built (idle capacity reads low)", () => {
    // Barren (no habitable land) so the pop term drops out and industry carries the whole
    // reading — isolating the used-vs-built question. Both systems have 4 built ore extractors
    // over 10 slots; the only difference is whether the population can staff them.
    // demand = 4 × 10 = 40.
    const built = {
      slotCap: makeResourceVector({ ore: 10 }),
      buildings: { ore: 4 },
    };
    // pop 100 → labourFulfil 1 → used 4 → industryFill 4/10 = 0.4.
    const staffed = systemDevelopment(devInput({ ...built, population: 100 }));
    // pop 20 → labourFulfil 0.5 → used 2 → industryFill 2/10 = 0.2.
    const idle = systemDevelopment(devInput({ ...built, population: 20 }));
    expect(staffed).toBeCloseTo(0.4, 5);
    expect(idle).toBeCloseTo(0.2, 5);
  });

  it("does not inflate when housing is built ahead of population (housing-immune)", () => {
    const base = {
      habitableSpace: 10,
      generalSpace: 20,
      slotCap: makeResourceVector({ ore: 10 }),
      population: 50,
    };
    const withoutHousing = systemDevelopment(devInput({ ...base, buildings: {} }));
    // 5 empty housing levels (popCap 100) but population still 50.
    const withHousing = systemDevelopment(devInput({ ...base, buildings: { housing: 5 } }));
    expect(withHousing).toBe(withoutHousing);
  });

  it("stays within [0,1] even when over-built and over-populated", () => {
    const sys = devInput({
      habitableSpace: 10, // potential pop 200
      generalSpace: 20,
      slotCap: makeResourceVector({ ore: 10 }),
      population: 5000, // far past the ceiling → popFill clamps to 1
      buildings: { ore: 40 }, // far past the 10 slots → industryFill clamps to 1
    });
    const dev = systemDevelopment(sys);
    expect(dev).toBeGreaterThanOrEqual(0);
    expect(dev).toBeLessThanOrEqual(1);
  });
});
