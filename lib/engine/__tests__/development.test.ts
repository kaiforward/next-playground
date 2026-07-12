import { describe, it, expect } from "vitest";
import {
  systemDevelopment,
  developmentRefs,
  habitablePotentialPop,
  industryPotential,
  type DevelopmentInput,
  type DevelopmentRefs,
} from "@/lib/engine/development";
import { HOUSING_TYPE, POP_CENTRE_DENSITY, effectiveSpaceCost } from "@/lib/constants/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

/**
 * Fixture: a system's development inputs. Defaults are a barren, empty frontier
 * (no pop, no buildings, no habitable land) so each test opts into only the
 * fields it exercises.
 */
function devInput(partial: Partial<DevelopmentInput>): DevelopmentInput {
  return { buildings: {}, population: 0, habitableSpace: 0, ...partial };
}

/**
 * A universe reference big enough that ordinary systems read low against it — a stand-in for the
 * galaxy's biggest natural potential. The relational tests only need a fixed, generous reference.
 */
const REFS: DevelopmentRefs = { popRef: 600, industryRef: 40 };

describe("habitablePotentialPop — the pop a system's habitable land could ever house", () => {
  it("is zero with no habitable land and rises with it", () => {
    expect(habitablePotentialPop(0)).toBe(0);
    expect(habitablePotentialPop(100)).toBeGreaterThan(habitablePotentialPop(50));
  });

  it("is habitable land packed with housing at full occupancy", () => {
    const hab = 200;
    const expected = (hab / effectiveSpaceCost(HOUSING_TYPE)) * POP_CENTRE_DENSITY;
    expect(habitablePotentialPop(hab)).toBeCloseTo(expected, 6);
  });
});

describe("industryPotential — the staffed-industry footprint a system could ever host", () => {
  it("is zero with no deposits and no general space", () => {
    expect(industryPotential(0, 0)).toBe(0);
  });

  it("is every deposit slot worked plus all general space as factory", () => {
    expect(industryPotential(10, 5)).toBeCloseTo(10 * SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT + 5, 6);
  });

  it("rises with both deposit slots and general space", () => {
    expect(industryPotential(10, 5)).toBeGreaterThan(industryPotential(4, 5));
    expect(industryPotential(4, 8)).toBeGreaterThan(industryPotential(4, 5));
  });
});

describe("developmentRefs — universe-wide max potential", () => {
  it("takes the largest pop and industry potential across all systems", () => {
    const refs = developmentRefs([
      { habitableSpace: 20, generalSpace: 10, depositSlots: 2 },
      { habitableSpace: 200, generalSpace: 4, depositSlots: 1 }, // biggest pop potential
      { habitableSpace: 5, generalSpace: 80, depositSlots: 30 }, // biggest industry potential
    ]);
    expect(refs.popRef).toBeCloseTo(habitablePotentialPop(200), 6);
    expect(refs.industryRef).toBeCloseTo(industryPotential(30, 80), 6);
  });

  it("is zero for an empty universe", () => {
    expect(developmentRefs([])).toEqual({ popRef: 0, industryRef: 0 });
  });
});

describe("systemDevelopment", () => {
  it("reads 0 for an empty frontier (nothing built, no people)", () => {
    expect(systemDevelopment(devInput({ habitableSpace: 10 }), REFS)).toBe(0);
  });

  it("squashes a system that is full for its OWN small size into the bottom of the board", () => {
    // The whole point of the universe-wide reference: a colony built out to its own potential (housing
    // at max, pop filled to what its habitable land supports) still has almost nothing measured against
    // the galaxy's biggest world, so it reads near the bottom. Full utilisation for its size is NOT high
    // development — only realising the universe's max potential (later: robots + special housing) is.
    const bigHab = 400;
    const smallHab = 40; // one tenth of the biggest system's habitable land
    const refs = developmentRefs([
      { habitableSpace: bigHab, generalSpace: 30, depositSlots: 20 },
      { habitableSpace: smallHab, generalSpace: 3, depositSlots: 2 },
    ]);
    // The small colony, housing maxed to its own habitable cap, barely any industry.
    const fullSmallColony = devInput({
      buildings: { [HOUSING_TYPE]: 100 },
      population: habitablePotentialPop(smallHab),
      habitableSpace: smallHab,
    });
    expect(systemDevelopment(fullSmallColony, refs)).toBeLessThan(0.2);
  });

  it("reads the biggest natural system high, but soft-saturation keeps it well under 1", () => {
    // Even the galaxy's biggest world, fully built to its natural potential, sits at the soft-saturation
    // knee (~0.63 per term), never at 1 — the top of the board is reserved for systems that later exceed
    // natural potential via robots / special housing.
    const bigHab = 400;
    const refs = developmentRefs([{ habitableSpace: bigHab, generalSpace: 60, depositSlots: 40 }]);
    const maxedCapital = devInput({
      buildings: { [HOUSING_TYPE]: 1000, ore: 40 },
      population: habitablePotentialPop(bigHab),
      habitableSpace: bigHab,
    });
    const dev = systemDevelopment(maxedCapital, refs);
    expect(dev).toBeGreaterThan(0.4);
    expect(dev).toBeLessThan(0.75);
  });

  it("reads a small full colony far BELOW the universe's largest system", () => {
    const refs = developmentRefs([
      { habitableSpace: 100, generalSpace: 40, depositSlots: 20 },
      { habitableSpace: 5, generalSpace: 2, depositSlots: 1 },
    ]);
    const small = devInput({ buildings: { housing: 1, ore: 1 }, population: 20, habitableSpace: 5 });
    const large = devInput({ buildings: { ore: 20 }, population: 240, habitableSpace: 100 });
    expect(systemDevelopment(small, refs)).toBeLessThan(systemDevelopment(large, refs));
  });

  it("rises with population (absolute — more people, more developed)", () => {
    const base = { buildings: {}, habitableSpace: 20 };
    const sparse = systemDevelopment(devInput({ ...base, population: 50 }), REFS);
    const dense = systemDevelopment(devInput({ ...base, population: 400 }), REFS);
    expect(dense).toBeGreaterThan(sparse);
  });

  it("rises with staffed industry (absolute — more built-and-worked industry, more developed)", () => {
    const base = { population: 500, habitableSpace: 100 }; // ample labour to staff either build
    const light = systemDevelopment(devInput({ ...base, buildings: { ore: 2 } }), REFS);
    const heavy = systemDevelopment(devInput({ ...base, buildings: { ore: 8 } }), REFS);
    expect(heavy).toBeGreaterThan(light);
  });

  it("counts industry by what is STAFFED, not what is built (barren isolates it)", () => {
    // Barren (no habitable land) drops the pop term, so development is industry alone — isolating
    // the used-vs-built question. Same 10 built ore extractors; only staffing differs.
    // labourDemand = 10 × 10 = 100.
    const built = { buildings: { ore: 10 }, habitableSpace: 0 };
    const staffed = systemDevelopment(devInput({ ...built, population: 100 }), REFS); // staffing 1 → used 10
    const idle = systemDevelopment(devInput({ ...built, population: 30 }), REFS); //    staffing 0.3 → used 3
    expect(staffed).toBeGreaterThan(idle);
  });

  it("does not inflate when housing is built ahead of population (housing-immune)", () => {
    const base = { population: 50, habitableSpace: 20 };
    const withoutHousing = systemDevelopment(devInput({ ...base, buildings: {} }), REFS);
    const withHousing = systemDevelopment(devInput({ ...base, buildings: { housing: 5 } }), REFS);
    expect(withHousing).toBe(withoutHousing);
  });

  it("reads a barren system on its industry alone (no habitable land)", () => {
    // No habitable land → the pop term is dropped; a built-and-staffed extraction colony still
    // reads developed via industry, and an empty barren system reads 0.
    const worked = systemDevelopment(devInput({ buildings: { ore: 6 }, population: 100, habitableSpace: 0 }), REFS);
    const empty = systemDevelopment(devInput({ buildings: {}, population: 100, habitableSpace: 0 }), REFS);
    expect(worked).toBeGreaterThan(empty);
    expect(empty).toBe(0);
  });

  it("stays within [0,1] even when massively over-populated and over-built", () => {
    const dev = systemDevelopment(
      devInput({ buildings: { ore: 500 }, population: 100_000, habitableSpace: 500 }),
      REFS,
    );
    expect(dev).toBeGreaterThanOrEqual(0);
    expect(dev).toBeLessThanOrEqual(1);
  });
});
