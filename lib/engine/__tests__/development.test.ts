import { describe, it, expect } from "vitest";
import {
  systemDevelopment,
  developmentRefs,
  habitablePotentialPop,
  industryPotential,
  type DevelopmentInput,
  type DevelopmentRefs,
} from "@/lib/engine/development";
import { HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, POP_CENTRE_DENSITY, effectiveSpaceCost } from "@/lib/constants/industry";
import { DEVELOPMENT } from "@/lib/constants/development";
import { labourDemand, labourFulfilment } from "@/lib/engine/industry";

/**
 * Fixture: a system's development inputs. Defaults are a barren, empty frontier
 * (no pop, no buildings, no habitable land) so each test opts into only the
 * fields it exercises.
 */
function devInput(partial: Partial<DevelopmentInput>): DevelopmentInput {
  return { buildings: {}, population: 0, peopleLand: 0, ...partial };
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
  it("is zero with no deposits", () => {
    expect(industryPotential(0)).toBe(0);
  });

  it("is every deposit slot worked — extraction-only, factories bill no land", () => {
    expect(industryPotential(10)).toBeCloseTo(10, 6);
  });

  it("rises with deposit slots", () => {
    expect(industryPotential(10)).toBeGreaterThan(industryPotential(4));
  });
});

describe("developmentRefs — universe-wide max potential", () => {
  it("takes the largest pop and industry potential across all systems", () => {
    const refs = developmentRefs([
      { peopleLand: 20, depositCounts: 2 },
      { peopleLand: 200, depositCounts: 1 }, // biggest pop potential
      { peopleLand: 5, depositCounts: 30 }, // biggest industry potential
    ]);
    expect(refs.popRef).toBeCloseTo(habitablePotentialPop(200), 6);
    expect(refs.industryRef).toBeCloseTo(industryPotential(30), 6);
  });

  it("is zero for an empty universe", () => {
    expect(developmentRefs([])).toEqual({ popRef: 0, industryRef: 0 });
  });
});

describe("systemDevelopment", () => {
  it("reads 0 for an empty frontier (nothing built, no people)", () => {
    expect(systemDevelopment(devInput({ peopleLand: 10 }), REFS)).toBe(0);
  });

  it("squashes a system that is full for its OWN small size into the bottom of the board", () => {
    // The whole point of the universe-wide reference: a colony built out to its own potential (housing
    // at max, pop filled to what its habitable land supports) still has almost nothing measured against
    // the galaxy's biggest world, so it reads near the bottom. Full utilisation for its size is NOT high
    // development — only realising the universe's max potential (later: robots + special housing) is.
    const bigHab = 400;
    const smallHab = 40; // one tenth of the biggest system's habitable land
    const refs = developmentRefs([
      { peopleLand: bigHab, depositCounts: 20 },
      { peopleLand: smallHab, depositCounts: 2 },
    ]);
    // The small colony, housing maxed to its own habitable cap, barely any industry.
    const fullSmallColony = devInput({
      buildings: { [HOUSING_TYPE]: 100 },
      population: habitablePotentialPop(smallHab),
      peopleLand: smallHab,
    });
    expect(systemDevelopment(fullSmallColony, refs)).toBeLessThan(0.2);
  });

  it("reads the biggest natural system high, but soft-saturation keeps it well under 1", () => {
    // Even the galaxy's biggest world, fully built to its natural potential, sits at the soft-saturation
    // knee (~0.63 per term), never at 1 — the top of the board is reserved for systems that later exceed
    // natural potential via robots / special housing.
    const bigHab = 400;
    const refs = developmentRefs([{ peopleLand: bigHab, depositCounts: 40 }]);
    const maxedCapital = devInput({
      buildings: { [HOUSING_TYPE]: 1000, ore: 40 },
      population: habitablePotentialPop(bigHab),
      peopleLand: bigHab,
    });
    const dev = systemDevelopment(maxedCapital, refs);
    expect(dev).toBeGreaterThan(0.4);
    expect(dev).toBeLessThan(0.75);
  });

  it("reads a small full colony far BELOW the universe's largest system", () => {
    const refs = developmentRefs([
      { peopleLand: 100, depositCounts: 20 },
      { peopleLand: 5, depositCounts: 1 },
    ]);
    const small = devInput({ buildings: { housing: 1, ore: 1 }, population: 20, peopleLand: 5 });
    const large = devInput({ buildings: { ore: 20 }, population: 240, peopleLand: 100 });
    expect(systemDevelopment(small, refs)).toBeLessThan(systemDevelopment(large, refs));
  });

  it("rises with population (absolute — more people, more developed)", () => {
    const base = { buildings: {}, peopleLand: 20 };
    const sparse = systemDevelopment(devInput({ ...base, population: 50 }), REFS);
    const dense = systemDevelopment(devInput({ ...base, population: 400 }), REFS);
    expect(dense).toBeGreaterThan(sparse);
  });

  it("rises with staffed industry (absolute — more built-and-worked industry, more developed)", () => {
    const base = { population: 500, peopleLand: 100 }; // ample labour to staff either build
    const light = systemDevelopment(devInput({ ...base, buildings: { ore: 2 } }), REFS);
    const heavy = systemDevelopment(devInput({ ...base, buildings: { ore: 8 } }), REFS);
    expect(heavy).toBeGreaterThan(light);
  });

  it("does not count non-extractor buildings — extraction-only, no static land number to normalise factories against", () => {
    // Habitability-seeding deleted the industry-land budget entirely, so factories, academies and
    // complexes bill no land and are NOT counted in staffedIndustry at all — the old `factory` =
    // industryLandUsed term is gone outright, not merely relaxed. A vocational school (no deposit
    // `resource`, so never an extractor) is a pure factory-term case: it reads the same zero built
    // or not.
    const barren = { peopleLand: 0 };
    const empty = systemDevelopment(devInput({ ...barren, population: 1000, buildings: {} }), REFS);
    const built = systemDevelopment(
      devInput({ ...barren, population: 1000, buildings: { [VOCATIONAL_SCHOOL_TYPE]: 6 } }),
      REFS,
    );
    expect(empty).toBe(0);
    expect(built).toBe(0);
  });

  it("counts industry by what is STAFFED, not what is built (barren isolates it)", () => {
    // Barren (no habitable land) drops the pop term, so development is industry alone — isolating
    // the used-vs-built question. Same 10 built ore extractors; only staffing differs.
    // labourDemand = 10 × 10 = 100.
    const built = { buildings: { ore: 10 }, peopleLand: 0 };
    const staffed = systemDevelopment(devInput({ ...built, population: 100 }), REFS); // staffing 1 → used 10
    const idle = systemDevelopment(devInput({ ...built, population: 30 }), REFS); //    staffing 0.3 → used 3
    expect(staffed).toBeGreaterThan(idle);
  });

  it("does not inflate when housing is built ahead of population (housing-immune)", () => {
    const base = { population: 50, peopleLand: 20 };
    const withoutHousing = systemDevelopment(devInput({ ...base, buildings: {} }), REFS);
    const withHousing = systemDevelopment(devInput({ ...base, buildings: { housing: 5 } }), REFS);
    expect(withHousing).toBe(withoutHousing);
  });

  // Housing is still excluded from staffedIndustry (unchanged): adding it to a mixed build must not
  // move the reading, whether or not the (now zero-contributing) factory term is also present.
  it("housing never moves the industry reading on a MIXED build (extractor + factory + housing)", () => {
    const factoryOnly = { ore: 4, [VOCATIONAL_SCHOOL_TYPE]: 3 };
    const mixedWithHousing = { ...factoryOnly, housing: 7 };
    const barren = { peopleLand: 0, population: 1000 };
    const devFactoryOnly = systemDevelopment(devInput({ ...barren, buildings: factoryOnly }), REFS);
    const devMixed = systemDevelopment(devInput({ ...barren, buildings: mixedWithHousing }), REFS);
    expect(devMixed).toBe(devFactoryOnly);
  });

  it("reads a barren system on its industry alone (no habitable land)", () => {
    // No habitable land → the pop term is dropped; a built-and-staffed extraction colony still
    // reads developed via industry, and an empty barren system reads 0.
    const worked = systemDevelopment(devInput({ buildings: { ore: 6 }, population: 100, peopleLand: 0 }), REFS);
    const empty = systemDevelopment(devInput({ buildings: {}, population: 100, peopleLand: 0 }), REFS);
    expect(worked).toBeGreaterThan(empty);
    expect(empty).toBe(0);
  });

  it("stays within [0,1] even when massively over-populated and over-built", () => {
    const dev = systemDevelopment(
      devInput({ buildings: { ore: 500 }, population: 100_000, peopleLand: 500 }),
      REFS,
    );
    expect(dev).toBeGreaterThanOrEqual(0);
    expect(dev).toBeLessThanOrEqual(1);
  });

  // Reads non-degenerate on a capital-scale fixture, pinned against a
  // hand-computed value from the documented softSaturate formula — not just asserted "> 0".
  it("pins a hand-computed value for a capital-scale fixture (non-degenerate, no NaN/zero-pinning)", () => {
    const buildings = { ore: 40 };
    const population = 4000;
    const peopleLand = 400;
    const refs: DevelopmentRefs = { popRef: 34_500, industryRef: 1100 }; // hardcoded, not derived via industryPotential

    const extraction = 40; // extractorLevels: only `ore` has a deposit `resource`
    const staffing = labourFulfilment(population, labourDemand(buildings));
    const expectedIndTerm = 1 - Math.exp((-extraction * staffing) / refs.industryRef);
    const expectedPopTerm = 1 - Math.exp(-population / refs.popRef);
    const expected = DEVELOPMENT.POP_WEIGHT * expectedPopTerm + DEVELOPMENT.INDUSTRY_WEIGHT * expectedIndTerm;

    const dev = systemDevelopment(devInput({ buildings, population, peopleLand }), refs);
    expect(dev).toBeCloseTo(expected, 10);
    expect(Number.isFinite(dev)).toBe(true);
    expect(dev).not.toBe(0);
    expect(dev).toBeGreaterThan(0.05);
    expect(dev).toBeLessThan(0.2);
  });

  it("reads 0 against a degenerate zero reference (empty universe), never NaN/Infinity", () => {
    // developmentRefs([]) yields { popRef: 0, industryRef: 0 }; softSaturate's `ref <= 0` guard must
    // floor both terms to 0 rather than divide by zero, keeping the reading finite — the codebase bars
    // NaN/Infinity from reaching derived/world state.
    const zeroRefs: DevelopmentRefs = { popRef: 0, industryRef: 0 };
    const dev = systemDevelopment(
      devInput({ buildings: { ore: 10, [HOUSING_TYPE]: 5 }, population: 200, peopleLand: 100 }),
      zeroRefs,
    );
    expect(dev).toBe(0);
    expect(Number.isFinite(dev)).toBe(true);
  });
});

// DEPOSIT_SLOT_FOOTPRINT and the industry-land budget it converted are deleted (habitability-seeding
// amendment) — `industryPotential` is worked deposit slots alone, extraction-only. The proves below
// pin the structural guarantees (finite, no NaN, no crash on an empty galaxy) that survive the
// coefficient's deletion; the old coefficient-specific "Prove 2" (extractor-heavy vs factory-heavy
// commensurability at 4.5) has no coefficient left to be about — factories are out of this axis
// entirely now, not merely re-weighted.
describe("industryPotential — structural guarantees that survive DEPOSIT_SLOT_FOOTPRINT's deletion", () => {
  it("the industry-only arm stays finite in [0,1) for a zero-people-land system under real-scale refs", () => {
    // Realistic galaxy-scale refs (census order of magnitude: depositCounts system sums ~30-190) —
    // not the small fixed REFS the other tests use.
    const realisticRefs: DevelopmentRefs = {
      popRef: 34_500,
      industryRef: industryPotential(1100),
    };
    const dev = systemDevelopment(
      devInput({ buildings: { ore: 12, minerals: 8 }, population: 400, peopleLand: 0 }),
      realisticRefs,
    );
    expect(Number.isFinite(dev)).toBe(true);
    expect(dev).toBeGreaterThan(0); // the industry-only arm must actually fire, not just fail to crash
    expect(dev).toBeLessThan(1);
  });

  it("empty-galaxy refs still read zero without NaN", () => {
    const emptyRefs = developmentRefs([]);
    expect(emptyRefs).toEqual({ popRef: 0, industryRef: 0 });
    expect(industryPotential(0)).toBe(0);
    const dev = systemDevelopment(
      devInput({ buildings: { ore: 5, [HOUSING_TYPE]: 3 }, population: 50, peopleLand: 20 }),
      emptyRefs,
    );
    expect(dev).toBe(0);
    expect(Number.isFinite(dev)).toBe(true);
    expect(Number.isNaN(dev)).toBe(false);
  });
});
