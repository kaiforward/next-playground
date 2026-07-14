import { describe, it, expect } from "vitest";
import {
  developmentPoints,
  developmentPotential,
  DEVELOPMENT_POINTS,
  type DevelopmentPointsInput,
  type DevelopmentPotentialInput,
} from "@/lib/engine/development-points";

/**
 * Fixture: a system's development-points inputs. Defaults are empty (no pop, no buildings) so each
 * test opts into only the fields it exercises.
 */
function pointsInput(partial: Partial<DevelopmentPointsInput>): DevelopmentPointsInput {
  return { buildings: {}, population: 0, ...partial };
}

describe("developmentPoints — map-only raw tier-weighted score", () => {
  it("scores a staffed tier-2 + complex system higher than a same-population tier-0-only system", () => {
    const population = 170; // enough to fully staff both fixtures below
    const advanced = developmentPoints(
      pointsInput({
        population,
        buildings: {
          electronics: 2, // tier-2 producer
          vocational_school: 1, // licenses skill-1
          research_institute: 1, // licenses skill-2
          electronics_complex: 1, // specialisation complex
        },
      }),
    );
    const basic = developmentPoints(
      pointsInput({
        population,
        buildings: { ore: 2 }, // tier-0 extractor only
      }),
    );
    expect(advanced).toBeGreaterThan(basic);
  });

  it("scores a licensed-and-staffed tier-2 producer higher than a tier-0 producer of the same count and population", () => {
    const population = 100;
    const tier2 = developmentPoints(
      pointsInput({
        population,
        buildings: { electronics: 1, vocational_school: 1, research_institute: 1 },
      }),
    );
    const tier0 = developmentPoints(pointsInput({ population, buildings: { ore: 1 } }));
    expect(tier2).toBeGreaterThan(tier0);
  });

  it("scores a licensed-and-staffed tier-1 producer above the same producer with no academy to license it", () => {
    // `fuel` is a tier-1 good — its jobs need skill-1 (technicians), which only exist where a
    // vocational school licenses them. With the licence, the tier-1 industry term (TIER_WEIGHT[1])
    // turns on and the filled technicians add a skilled-population uplift; without it the tier-1
    // fulfilment is gated to 0 and the factories contribute nothing. This exercises the tier-1 path
    // that the tier-0/tier-2 cases don't touch.
    const population = 200;
    const licensed = developmentPoints(pointsInput({ population, buildings: { fuel: 2, vocational_school: 1 } }));
    const unlicensed = developmentPoints(pointsInput({ population, buildings: { fuel: 2 } }));
    expect(licensed).toBeGreaterThan(unlicensed);
  });

  it("adds ~0 industry points for skilled production with no academy to license it (fulfilment gated to 0)", () => {
    // Skill-1/skill-2 jobs exist only where an academy licenses them (skill1Cap/skill2Cap = 0 here), so
    // effectiveFulfilment for a tier-2 good is gated to 0 regardless of headcount — the electronics
    // factories contribute nothing to the industry term. The score should equal the same system with the
    // unstaffable factories removed entirely (complex + population terms only).
    const withIdleFactories = developmentPoints(
      pointsInput({
        population: 50,
        buildings: { electronics: 2, heavy_industry_complex: 1 }, // no academies
      }),
    );
    const withoutFactories = developmentPoints(
      pointsInput({ population: 50, buildings: { heavy_industry_complex: 1 } }),
    );
    expect(withIdleFactories).toBeCloseTo(withoutFactories, 6);
  });

  it("a system with only a complex (no producers) still scores the complex points as a fixed bump", () => {
    const population = 50;
    const withComplex = developmentPoints(pointsInput({ population, buildings: { heavy_industry_complex: 1 } }));
    const withoutComplex = developmentPoints(pointsInput({ population, buildings: {} }));
    expect(withComplex - withoutComplex).toBeCloseTo(DEVELOPMENT_POINTS.COMPLEX_POINTS, 6);
  });

  it("caps the complex bump at one per system even with multiple complexes built", () => {
    // The industrial pinnacle is worth a single fixed bump regardless of how many complexes a system
    // stacks (Math.min(1, complexCount)). Two different complex families in one system still add exactly
    // one COMPLEX_POINTS over the no-complex baseline — not two.
    const population = 50;
    const twoComplexes = developmentPoints(
      pointsInput({ population, buildings: { heavy_industry_complex: 1, electronics_complex: 1 } }),
    );
    const noComplex = developmentPoints(pointsInput({ population, buildings: {} }));
    expect(twoComplexes - noComplex).toBeCloseTo(DEVELOPMENT_POINTS.COMPLEX_POINTS, 6);
  });

  it("a system with present population and staffed industry scores from industry (not merely population)", () => {
    const population = 100;
    const withIndustry = developmentPoints(pointsInput({ population, buildings: { ore: 4 } }));
    const populationOnly = developmentPoints(pointsInput({ population, buildings: {} }));
    expect(withIndustry).toBeGreaterThan(populationOnly);
  });

  it("is exactly 0 for an empty frontier (no population, no buildings)", () => {
    expect(developmentPoints(pointsInput({}))).toBe(0);
  });

  it("stays finite and non-negative for a large, heavily built system", () => {
    const dev = developmentPoints(
      pointsInput({
        population: 100_000,
        buildings: { ore: 500, electronics: 50, vocational_school: 10, research_institute: 10, electronics_complex: 1 },
      }),
    );
    expect(Number.isFinite(dev)).toBe(true);
    expect(dev).toBeGreaterThanOrEqual(0);
  });

  it("clamps a negative population to 0 rather than going negative", () => {
    const dev = developmentPoints(pointsInput({ population: -50, buildings: { ore: 2 } }));
    expect(Number.isFinite(dev)).toBe(true);
    expect(dev).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Fixture: a system's static substrate — the full-build-out ceiling inputs. Defaults are a barren,
 * empty frontier (no habitable land, no deposit slots, no general space) so each test opts into only
 * the fields it exercises.
 */
function potentialInput(partial: Partial<DevelopmentPotentialInput>): DevelopmentPotentialInput {
  return { habitableSpace: 0, depositSlots: 0, generalSpace: 0, ...partial };
}

describe("developmentPotential — full-build-out dev-points ceiling", () => {
  it("exceeds a partially-built real system's developmentPoints (pct sits in a legible 0-100 band)", () => {
    // A moderately built (not maxed) system: some housing, some staffed tier-0 extraction, well short
    // of the habitable land / deposit slots / general space it could theoretically fill.
    const population = 300;
    const currentPoints = developmentPoints(pointsInput({ population, buildings: { ore: 10 } }));
    const potential = developmentPotential(
      potentialInput({ habitableSpace: 400, depositSlots: 20, generalSpace: 100 }),
    );
    expect(potential).toBeGreaterThan(currentPoints);
  });

  it("is exactly 0 for a system with no habitable land, no deposit slots, and no general space", () => {
    expect(developmentPotential(potentialInput({}))).toBe(0);
  });

  it("rises with habitableSpace (monotonic)", () => {
    const base = { depositSlots: 5, generalSpace: 10 };
    const small = developmentPotential(potentialInput({ ...base, habitableSpace: 100 }));
    const large = developmentPotential(potentialInput({ ...base, habitableSpace: 200 }));
    expect(large).toBeGreaterThan(small);
  });

  it("rises with depositSlots (monotonic)", () => {
    const base = { habitableSpace: 100, generalSpace: 10 };
    const few = developmentPotential(potentialInput({ ...base, depositSlots: 2 }));
    const many = developmentPotential(potentialInput({ ...base, depositSlots: 20 }));
    expect(many).toBeGreaterThan(few);
  });

  it("rises with generalSpace (monotonic)", () => {
    const base = { habitableSpace: 100, depositSlots: 5 };
    const small = developmentPotential(potentialInput({ ...base, generalSpace: 5 }));
    const large = developmentPotential(potentialInput({ ...base, generalSpace: 50 }));
    expect(large).toBeGreaterThan(small);
  });

  it("stays finite and non-negative for a huge, fully substrate-rich system", () => {
    const potential = developmentPotential(
      potentialInput({ habitableSpace: 1_000_000, depositSlots: 10_000, generalSpace: 100_000 }),
    );
    expect(Number.isFinite(potential)).toBe(true);
    expect(potential).toBeGreaterThanOrEqual(0);
  });

  it("clamps negative/degenerate inputs to 0 rather than going negative or non-finite", () => {
    const potential = developmentPotential(
      potentialInput({ habitableSpace: -100, depositSlots: -5, generalSpace: -10 }),
    );
    expect(Number.isFinite(potential)).toBe(true);
    expect(potential).toBeGreaterThanOrEqual(0);
    expect(potential).toBe(0);
  });
});
