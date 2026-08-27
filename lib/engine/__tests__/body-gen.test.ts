import { describe, it, expect } from "vitest";
import { mulberry32, type RNG } from "../universe-gen";
import { generateSubstrate, substrateAggregates, type GeneratedBody } from "../body-gen";
import {
  SUN_CLASSES, BODY_ARCHETYPES, HABITABILITY_THRESHOLD, HABITABLE_COUNT_LADDER,
} from "@/lib/constants/bodies";
import { RESOURCE_TYPES } from "../resources";
import type { BodyArchetypeId } from "@/lib/types/game";

function sample(n: number) {
  const rng = mulberry32(42);
  return Array.from({ length: n }, () => generateSubstrate(rng));
}

/**
 * Draws `n` systems off one continuous seeded stream and, for every system where both archetypes
 * co-occur, records whether `typeB` landed outward of `typeA` (higher orbitIndex). Used to check
 * the ring roll's bias tendency in aggregate, never per-instance.
 */
function collectPairOutcomes(rng: RNG, n: number, typeA: BodyArchetypeId, typeB: BodyArchetypeId) {
  let coOccurrences = 0;
  let bOutward = 0;
  for (let i = 0; i < n; i++) {
    const s = generateSubstrate(rng);
    const a = s.bodies.find((b) => b.bodyType === typeA);
    const b = s.bodies.find((b) => b.bodyType === typeB);
    if (a !== undefined && b !== undefined) {
      coOccurrences++;
      if (b.orbitIndex > a.orbitIndex) bOutward++;
    }
  }
  return { coOccurrences, bOutward };
}

describe("generateSubstrate", () => {
  it("rolls a valid sun class and at least one body", () => {
    for (const s of sample(200)) {
      expect(SUN_CLASSES[s.sunClass]).toBeDefined();
      expect(s.bodies.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("only rolls archetypes the sun class permits", () => {
    for (const s of sample(200)) {
      const weights = SUN_CLASSES[s.sunClass].archetypeWeights;
      for (const b of s.bodies) expect(weights[b.bodyType] ?? 0).toBeGreaterThan(0);
    }
  });

  it("bare substrate: no seeded industry or population — every system starts an empty deposit field", () => {
    for (const s of sample(50)) {
      expect(s.population).toBe(0);
      expect(s.popCap).toBe(0);
      expect(Object.keys(s.buildings)).toHaveLength(0);
    }
  });

  it("bodyDanger sums the body archetype danger baselines over ALL bodies, locked or not", () => {
    for (const s of sample(300)) {
      const expected = s.bodies.reduce(
        (sum, b) => sum + BODY_ARCHETYPES[b.bodyType].dangerBaseline,
        0,
      );
      expect(s.bodyDanger).toBeCloseTo(expected, 6);
      const hasVolcanic = s.bodies.some((b) => b.bodyType === "volcanic_world");
      if (hasVolcanic) expect(s.bodyDanger).toBeGreaterThan(0);
      else expect(s.bodyDanger).toBe(0);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = generateSubstrate(mulberry32(7));
    const b = generateSubstrate(mulberry32(7));
    expect(a).toEqual(b);
  });

  it("rolls the same orbitIndex sequence on a second run with an identical seed", () => {
    // A dedicated pin on the ring roll specifically (rather than generateSubstrate as a whole):
    // this fails if the roll ever drew from anything other than the threaded seeded RNG.
    const a = generateSubstrate(mulberry32(2024));
    const b = generateSubstrate(mulberry32(2024));
    expect(b.bodies.map((x) => x.orbitIndex)).toEqual(a.bodies.map((x) => x.orbitIndex));
  });
});

describe("generateSubstrate — orbital ring roll", () => {
  it("assigns orbitIndex as a permutation of 1..n over each system's bodies — no gap, no duplicate", () => {
    for (const s of sample(500)) {
      const indices = s.bodies.map((b) => b.orbitIndex).sort((x, y) => x - y);
      expect(indices).toEqual(Array.from({ length: s.bodies.length }, (_, i) => i + 1));
    }
  });

  it("never reorders the bodies array — most multi-body systems are NOT already in ascending orbitIndex order", () => {
    const systems = sample(500).filter((s) => s.bodies.length >= 2);
    let notMonotonic = 0;
    for (const s of systems) {
      const alreadyRingOrdered = s.bodies.every(
        (b, i) => i === 0 || s.bodies[i - 1].orbitIndex < b.orbitIndex,
      );
      if (!alreadyRingOrdered) notMonotonic++;
    }
    // orbitIndex is rolled from bias+noise, independent of a body's position in the array, so a
    // system's array is already in ring order only by chance: P(sorted) = 1/n! for n bodies (worst
    // case n=2 gives 1/2! = 0.5; every larger n is far below that). Across a mixed sample of n=2..8
    // systems the true sorted share sits well under 0.3. An implementation that actually SORTS
    // bodies into ring order would instead make every system monotonic (notMonotonic === 0), so
    // this bound is unreachable by a real sort and comfortably clears the worst-case chance rate.
    expect(systems.length).toBeGreaterThan(50); // non-vacuous
    expect(notMonotonic).toBeGreaterThan(systems.length * 0.5);
  });

  it("a near-bias-gap pair (gap < 2×ORBIT_ROLL_SPREAD) lands outward more often than not, but not always", () => {
    // arid_world (orbitalBias 0.14) vs barren_rock (0.22): gap 0.08, well inside the swappable
    // zone (2×ORBIT_ROLL_SPREAD = 0.5). Key difference D = noiseB − noiseA is Triangular(−2s, 2s, 0)
    // for half-width s = ORBIT_ROLL_SPREAD = 0.25; for a gap Δ in [0, 2s],
    // P(barren outward of arid) = P(D > −Δ) = 1/2 + Δ/(2s) − Δ²/(8s²) = 0.5 + 0.16 − 0.0128 ≈ 0.647.
    // A real majority, nowhere near the 1.0 a hard sort (or Δ ≥ 2s) would force, and nowhere near
    // 0.5, which is what a bias-blind (pure-random) roll would produce.
    const { coOccurrences, bOutward } = collectPairOutcomes(
      mulberry32(90210), 20000, "arid_world", "barren_rock",
    );
    expect(coOccurrences).toBeGreaterThan(200); // non-vacuous
    const p = bOutward / coOccurrences;
    expect(p).toBeGreaterThan(0.55);
    expect(p).toBeLessThan(0.9);
  });

  it("a far-bias-gap pair (gap ≥ 2×ORBIT_ROLL_SPREAD) never swaps — the hard bound the noise can't cross", () => {
    // arid_world (0.14) vs asteroid_belt (0.88): gap 0.74. |noiseB − noiseA| can never exceed
    // 2×ORBIT_ROLL_SPREAD = 0.5 (the sum of two independent ±0.25 draws), so 0.74 > 0.5 makes a
    // swap mathematically impossible, not merely statistically rare — the hard-sort guarantee the
    // spec makes for classes far apart on the axis.
    const { coOccurrences, bOutward } = collectPairOutcomes(
      mulberry32(778899), 20000, "arid_world", "asteroid_belt",
    );
    expect(coOccurrences).toBeGreaterThan(200); // non-vacuous
    expect(bOutward).toBe(coOccurrences); // absolute — zero exceptions
  });
});

describe("generateSubstrate — per-body budgets", () => {
  it("every body's peopleLand falls within its archetype's authored range", () => {
    for (const s of sample(300)) {
      for (const b of s.bodies) {
        const arch = BODY_ARCHETYPES[b.bodyType];
        expect(b.peopleLand).toBeGreaterThanOrEqual(arch.peopleLand.min);
        expect(b.peopleLand).toBeLessThanOrEqual(arch.peopleLand.max);
      }
    }
  });

  it("every body's deposit counts are integers within the archetype's authored range; absent ranges read count 0", () => {
    for (const s of sample(200)) {
      for (const b of s.bodies) {
        const arch = BODY_ARCHETYPES[b.bodyType];
        for (const r of RESOURCE_TYPES) {
          const range = arch.depositCounts[r];
          if (range === undefined) {
            expect(b.counts[r]).toBe(0);
            expect(b.quality[r]).toBe(0);
            continue;
          }
          expect(Number.isInteger(b.counts[r])).toBe(true);
          expect(b.counts[r]).toBeGreaterThanOrEqual(range.min);
          expect(b.counts[r]).toBeLessThanOrEqual(range.max);
        }
      }
    }
  });

  it("quality[r] > 0 only where counts[r] > 0", () => {
    for (const s of sample(200)) {
      for (const b of s.bodies) {
        for (const r of RESOURCE_TYPES) {
          if (b.counts[r] > 0) expect(b.quality[r]).toBeGreaterThan(0);
          else expect(b.quality[r]).toBe(0);
        }
      }
    }
  });

  it("body size is a display-only value in the cosmetic band, uncorrelated with any budget", () => {
    for (const s of sample(100)) {
      for (const b of s.bodies) {
        expect(b.size).toBeGreaterThanOrEqual(0.5);
        expect(b.size).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

describe("substrateAggregates — Proves (1): tech-locked classes contribute zero to every aggregate", () => {
  it("a tech-locked class contributes zero counts and zero extractionEfficiency weight", () => {
    // volcanic_world and gas_giant are the two tech-locked classes (bodies.ts).
    const locked: GeneratedBody = {
      bodyType: "volcanic_world",
      size: 1,
      peopleLand: 0,
      counts: { gas: 5, minerals: 5, ore: 5, biomass: 0, arable: 0, water: 0, radioactive: 5 },
      quality: { gas: 1, minerals: 1, ore: 1, biomass: 0, arable: 0, water: 0, radioactive: 1 },
      orbitIndex: 1,
    };
    const agg = substrateAggregates([locked]);
    expect(agg.depositCounts.gas).toBe(0);
    expect(agg.depositCounts.minerals).toBe(0);
    expect(agg.depositCounts.ore).toBe(0);
    expect(agg.depositCounts.radioactive).toBe(0);
    // No counts reach the aggregate ⇒ the neutral default, not a weighted mean including the locked body.
    expect(agg.potentialExtractionEfficiency.gas).toBe(1);
    expect(agg.potentialExtractionEfficiency.radioactive).toBe(1);
    // Body danger is unaffected by the lock — a locked volcanic world is still dangerous ground.
    expect(agg.bodyDanger).toBeCloseTo(BODY_ARCHETYPES.volcanic_world.dangerBaseline, 10);
  });
});

describe("substrateAggregates — Proves (2): arid/tundra dark land", () => {
  it("arid/tundra contribute 0 to system people land while their peopleLand stays visible per-body, and their deposits count", () => {
    const arid: GeneratedBody = {
      bodyType: "arid_world",
      size: 1,
      peopleLand: 200, // authored, dark — below threshold, never reaches peopleLand
      counts: { gas: 0, minerals: 3, ore: 3, biomass: 0, arable: 8, water: 0, radioactive: 3 },
      quality: { gas: 0, minerals: 1, ore: 1, biomass: 0, arable: 1, water: 0, radioactive: 1 },
      orbitIndex: 1,
    };
    expect(BODY_ARCHETYPES.arid_world.scores.default).toBeLessThan(HABITABILITY_THRESHOLD);
    // Per-body value stays visible — the budget was authored, never deleted.
    expect(arid.peopleLand).toBe(200);

    const agg = substrateAggregates([arid]);
    expect(agg.peopleLand).toBe(0); // below threshold ⇒ never reaches the system aggregate
    expect(agg.depositCounts.minerals).toBe(3);
    expect(agg.depositCounts.arable).toBe(8);
  });
});

describe("substrateAggregates — Proves (4): potentialExtractionEfficiency defaults to 1.0 where no counts", () => {
  it("a resource with zero counts across every body reads potentialExtractionEfficiency 1.0 (no NaN)", () => {
    const noWater: GeneratedBody = {
      bodyType: "temperate_world",
      size: 1,
      peopleLand: 500,
      counts: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 10, water: 0, radioactive: 0 },
      quality: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 1, water: 0, radioactive: 0 },
      orbitIndex: 1,
    };
    const agg = substrateAggregates([noWater]);
    expect(agg.potentialExtractionEfficiency.water).toBe(1);
    expect(Number.isNaN(agg.potentialExtractionEfficiency.water)).toBe(false);
  });

  it("with counts present, potentialExtractionEfficiency is the deposit-count-weighted mean extractionModifier", () => {
    const a: GeneratedBody = {
      bodyType: "temperate_world", // extractionModifier 1.0
      size: 1, peopleLand: 0,      counts: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 6, radioactive: 0 },
      quality: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 1, radioactive: 0 },
      orbitIndex: 1,
    };
    const b: GeneratedBody = {
      bodyType: "frozen_world", // extractionModifier 0.6
      size: 1, peopleLand: 0,      counts: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 2, radioactive: 0 },
      quality: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 1, radioactive: 0 },
      orbitIndex: 2,
    };
    // (6*1.0 + 2*0.6) / 8 = 0.9
    const agg = substrateAggregates([a, b]);
    expect(agg.potentialExtractionEfficiency.water).toBeCloseTo((6 * 1.0 + 2 * 0.6) / 8, 10);
  });
});

describe("generateSubstrate — damping ladder: Proves (3)", () => {
  it("with a forced all-above-threshold table, a system never carries a 4th above-threshold body, and dead classes stay rollable at every ladder step", () => {
    const original = SUN_CLASSES.yellow.archetypeWeights;
    const DEAD: BodyArchetypeId = "barren_rock";
    // Every candidate weight above threshold, plus one dead anchor kept alive at low weight so the
    // "dead classes remain rollable" half of the claim has something to observe.
    SUN_CLASSES.yellow.archetypeWeights = {
      temperate_world: 100, gaia_world: 100, ocean_world: 100, jungle_world: 100, boreal_world: 100,
      [DEAD]: 1,
    };
    try {
      const rng = mulberry32(555);
      let sawDeadRolled = false;
      let maxAboveThreshold = 0;
      let yellowSystemsSeen = 0;
      for (let i = 0; i < 4000; i++) {
        const s = generateSubstrate(rng);
        if (s.sunClass !== "yellow") continue;
        yellowSystemsSeen++;
        const aboveCount = s.bodies.filter(
          (b) => BODY_ARCHETYPES[b.bodyType].scores.default >= HABITABILITY_THRESHOLD,
        ).length;
        maxAboveThreshold = Math.max(maxAboveThreshold, aboveCount);
        if (s.bodies.some((b) => b.bodyType === DEAD)) sawDeadRolled = true;
      }
      expect(yellowSystemsSeen).toBeGreaterThan(0); // non-vacuous
      // Measured at seed 555 / 4000 draws: the forced all-above-threshold table actually reaches
      // the index-2 ladder step (weight 0.3, never 0), so the upper bound alone can't fail if a
      // future change collapsed index 2 to 0 and made 3-body systems impossible.
      expect(maxAboveThreshold).toBe(3);
      expect(sawDeadRolled).toBe(true);
    } finally {
      SUN_CLASSES.yellow.archetypeWeights = original;
    }
  });

  it("the ladder's terminal entry is exactly 0 — a 4th above-threshold body is impossible by table", () => {
    expect(HABITABLE_COUNT_LADDER[3]).toBe(0);
  });
});
