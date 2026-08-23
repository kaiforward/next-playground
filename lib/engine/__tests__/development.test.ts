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
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

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
      { peopleLand: 20, industryLand: 10, depositCounts: 2 },
      { peopleLand: 200, industryLand: 4, depositCounts: 1 }, // biggest pop potential
      { peopleLand: 5, industryLand: 80, depositCounts: 30 }, // biggest industry potential
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
      { peopleLand: bigHab, industryLand: 30, depositCounts: 20 },
      { peopleLand: smallHab, industryLand: 3, depositCounts: 2 },
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
    const refs = developmentRefs([{ peopleLand: bigHab, industryLand: 60, depositCounts: 40 }]);
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
      { peopleLand: 100, industryLand: 40, depositCounts: 20 },
      { peopleLand: 5, industryLand: 2, depositCounts: 1 },
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

  it("counts non-extractor industry-land buildings (the factory term), staffed not just built", () => {
    // Extractors sit on deposit slots; factories, academies and complexes sit on industry land and feed
    // development through the `factory` = industryLandUsed term (housing is excluded outright, never
    // netted out). A vocational school is such an industry-land building (no deposit `resource`), so it
    // exercises that term with no extractor present. Barren land isolates industry as the whole reading.
    const barren = { peopleLand: 0 };
    const empty = systemDevelopment(devInput({ ...barren, population: 1000, buildings: {} }), REFS);
    const built = systemDevelopment(
      devInput({ ...barren, population: 1000, buildings: { [VOCATIONAL_SCHOOL_TYPE]: 6 } }),
      REFS,
    );
    expect(empty).toBe(0);
    expect(built).toBeGreaterThan(0);

    // ...and it counts what is STAFFED: the same buildings understaffed read lower.
    const idle = systemDevelopment(
      devInput({ ...barren, population: 5, buildings: { [VOCATIONAL_SCHOOL_TYPE]: 6 } }),
      REFS,
    );
    expect(built).toBeGreaterThan(idle);
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

  // Proves (5): the factory term is unchanged by deleting the manual housingSpace net-out — a
  // contradiction check. The OLD formula computed factory = max(0, generalSpaceUsed(buildings) −
  // housingSpace), where generalSpaceUsed included housing; that is the algebraic identity
  // (industryLandUsed + housingSpace) − housingSpace = industryLandUsed. On a MIXED build
  // (extractor + factory + housing together, not just housing alone), the barren-isolated
  // (industry-only) development reading must be identical whether or not housing is in the mix.
  it("factory term on a MIXED build (extractor + factory + housing) matches the old subtract-housingSpace formula", () => {
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

// DEPOSIT_SLOT_FOOTPRINT is calibrated against the count scale (~5-45 per resource per body,
// system-level sums median ~102) so it stays commensurable with industry land (system-level sums
// median ~436). Proves below pin the recalibrated coefficient's behaviour under realistic magnitudes.
describe("recalibrated DEPOSIT_SLOT_FOOTPRINT — count/land commensurability", () => {
  it("Prove 1: the industry-only arm stays finite in [0,1) for a zero-people-land system under real-scale refs", () => {
    // Realistic galaxy-scale refs (census order of magnitude: industryLand ~40-300/body,
    // depositCounts system sums ~30-190) — not the small fixed REFS the other tests use.
    const realisticRefs: DevelopmentRefs = {
      popRef: 34_500,
      industryRef: industryPotential(320, 1100), // ≈ a natural system's converted footprint
    };
    const dev = systemDevelopment(
      devInput({ buildings: { ore: 12, minerals: 8 }, population: 400, peopleLand: 0 }),
      realisticRefs,
    );
    expect(Number.isFinite(dev)).toBe(true);
    expect(dev).toBeGreaterThan(0); // the industry-only arm must actually fire, not just fail to crash
    expect(dev).toBeLessThan(1);
  });

  it("Prove 2: an extractor-heavy and a factory-heavy system of equal converted footprint read comparable industryPotential", () => {
    // Deliberately hardcodes the authored coefficient (4.5, not read from SUBSTRATE_GEN) so this test
    // pins the CURRENT calibration: it must fail if the coefficient is dropped (reverted to 1.0), left
    // vestigial (multiplied by nothing), or a second, disagreeing constant is used for one arm only.
    const AUTHORED_FOOTPRINT = 4.5;
    const extractorHeavy = { depositCounts: 100, industryLand: 50 }; // 100×4.5 + 50 = 500
    const factoryHeavy = { depositCounts: 20, industryLand: 410 }; // 20×4.5 + 410 = 500
    expect(extractorHeavy.depositCounts * AUTHORED_FOOTPRINT + extractorHeavy.industryLand).toBeCloseTo(500, 6);
    expect(factoryHeavy.depositCounts * AUTHORED_FOOTPRINT + factoryHeavy.industryLand).toBeCloseTo(500, 6);
    expect(industryPotential(extractorHeavy.depositCounts, extractorHeavy.industryLand)).toBeCloseTo(
      industryPotential(factoryHeavy.depositCounts, factoryHeavy.industryLand),
      6,
    );
  });

  it("Prove 4: empty-galaxy refs still read zero without NaN under the recalibrated coefficient", () => {
    const emptyRefs = developmentRefs([]);
    expect(emptyRefs).toEqual({ popRef: 0, industryRef: 0 });
    expect(industryPotential(0, 0)).toBe(0);
    const dev = systemDevelopment(
      devInput({ buildings: { ore: 5, [HOUSING_TYPE]: 3 }, population: 50, peopleLand: 20 }),
      emptyRefs,
    );
    expect(dev).toBe(0);
    expect(Number.isFinite(dev)).toBe(true);
    expect(Number.isNaN(dev)).toBe(false);
  });
});
