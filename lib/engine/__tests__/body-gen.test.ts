import { describe, it, expect } from "vitest";
import { mulberry32 } from "../universe-gen";
import { generateSubstrate, substrateAggregates, type GeneratedBody } from "../body-gen";
import {
  SUN_CLASSES, BODY_ARCHETYPES, HABITABILITY_THRESHOLD, HABITABLE_COUNT_DAMPING,
} from "@/lib/constants/bodies";
import { RESOURCE_TYPES } from "../resources";
import type { BodyArchetypeId } from "@/lib/types/game";

function sample(n: number) {
  const rng = mulberry32(42);
  return Array.from({ length: n }, () => generateSubstrate(rng));
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
});

describe("generateSubstrate — per-body budgets", () => {
  it("every body's peopleLand/industryLand fall within its archetype's authored range", () => {
    for (const s of sample(300)) {
      for (const b of s.bodies) {
        const arch = BODY_ARCHETYPES[b.bodyType];
        expect(b.peopleLand).toBeGreaterThanOrEqual(arch.peopleLand.min);
        expect(b.peopleLand).toBeLessThanOrEqual(arch.peopleLand.max);
        expect(b.industryLand).toBeGreaterThanOrEqual(arch.industryLand.min);
        expect(b.industryLand).toBeLessThanOrEqual(arch.industryLand.max);
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
  it("a tech-locked class contributes zero counts, zero extractionEfficiency weight and zero industry land", () => {
    // volcanic_world and gas_giant are the two tech-locked classes (bodies.ts).
    const locked: GeneratedBody = {
      bodyType: "volcanic_world",
      size: 1,
      peopleLand: 0,
      industryLand: 999, // would inflate generalSpace if the lock were not respected
      counts: { gas: 5, minerals: 5, ore: 5, biomass: 0, arable: 0, water: 0, radioactive: 5 },
      quality: { gas: 1, minerals: 1, ore: 1, biomass: 0, arable: 0, water: 0, radioactive: 1 },
    };
    const agg = substrateAggregates([locked]);
    expect(agg.generalSpace).toBe(0);
    expect(agg.slotCap.gas).toBe(0);
    expect(agg.slotCap.minerals).toBe(0);
    expect(agg.slotCap.ore).toBe(0);
    expect(agg.slotCap.radioactive).toBe(0);
    // No counts reach the aggregate ⇒ the neutral default, not a weighted mean including the locked body.
    expect(agg.extractionEfficiency.gas).toBe(1);
    expect(agg.extractionEfficiency.radioactive).toBe(1);
    // Body danger is unaffected by the lock — a locked volcanic world is still dangerous ground.
    expect(agg.bodyDanger).toBeCloseTo(BODY_ARCHETYPES.volcanic_world.dangerBaseline, 10);
  });
});

describe("substrateAggregates — Proves (2): arid/tundra dark land", () => {
  it("arid/tundra contribute 0 to system people land while their peopleLand stays visible per-body, and their deposits count", () => {
    const arid: GeneratedBody = {
      bodyType: "arid_world",
      size: 1,
      peopleLand: 200, // authored, dark — below threshold, never reaches habitableSpace
      industryLand: 100,
      counts: { gas: 0, minerals: 3, ore: 3, biomass: 0, arable: 8, water: 0, radioactive: 3 },
      quality: { gas: 0, minerals: 1, ore: 1, biomass: 0, arable: 1, water: 0, radioactive: 1 },
    };
    expect(BODY_ARCHETYPES.arid_world.scores.default).toBeLessThan(HABITABILITY_THRESHOLD);
    // Per-body value stays visible — the budget was authored, never deleted.
    expect(arid.peopleLand).toBe(200);

    const agg = substrateAggregates([arid]);
    expect(agg.habitableSpace).toBe(0); // below threshold ⇒ never reaches the system aggregate
    expect(agg.generalSpace).toBe(100); // industry land is unconditional on score
    expect(agg.slotCap.minerals).toBe(3);
    expect(agg.slotCap.arable).toBe(8);
  });
});

describe("substrateAggregates — Proves (4): extractionEfficiency defaults to 1.0 where no counts", () => {
  it("a resource with zero counts across every body reads extractionEfficiency 1.0 (no NaN)", () => {
    const noWater: GeneratedBody = {
      bodyType: "temperate_world",
      size: 1,
      peopleLand: 500,
      industryLand: 200,
      counts: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 10, water: 0, radioactive: 0 },
      quality: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 1, water: 0, radioactive: 0 },
    };
    const agg = substrateAggregates([noWater]);
    expect(agg.extractionEfficiency.water).toBe(1);
    expect(Number.isNaN(agg.extractionEfficiency.water)).toBe(false);
  });

  it("with counts present, extractionEfficiency is the deposit-count-weighted mean extractionModifier", () => {
    const a: GeneratedBody = {
      bodyType: "temperate_world", // extractionModifier 1.0
      size: 1, peopleLand: 0, industryLand: 0,
      counts: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 6, radioactive: 0 },
      quality: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 1, radioactive: 0 },
    };
    const b: GeneratedBody = {
      bodyType: "frozen_world", // extractionModifier 0.6
      size: 1, peopleLand: 0, industryLand: 0,
      counts: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 2, radioactive: 0 },
      quality: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 1, radioactive: 0 },
    };
    // (6*1.0 + 2*0.6) / 8 = 0.9
    const agg = substrateAggregates([a, b]);
    expect(agg.extractionEfficiency.water).toBeCloseTo((6 * 1.0 + 2 * 0.6) / 8, 10);
  });
});

describe("substrateAggregates — availableSpace transitional identity", () => {
  it("equals Σ(peopleLand + industryLand + Σcounts × DEPOSIT_SLOT_FOOTPRINT) over ALL bodies", () => {
    for (const s of sample(100)) {
      const expected = s.bodies.reduce((sum, b) => {
        const countFootprint = RESOURCE_TYPES.reduce((t, r) => t + b.counts[r], 0);
        return sum + b.peopleLand + b.industryLand + countFootprint; // DEPOSIT_SLOT_FOOTPRINT === 1.0
      }, 0);
      expect(s.availableSpace).toBeCloseTo(expected, 6);
    }
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
      expect(maxAboveThreshold).toBeLessThanOrEqual(3);
      expect(sawDeadRolled).toBe(true);
    } finally {
      SUN_CLASSES.yellow.archetypeWeights = original;
    }
  });

  it("the ladder's terminal entry is exactly 0 — a 4th above-threshold body is impossible by table", () => {
    expect(HABITABLE_COUNT_DAMPING[3]).toBe(0);
  });
});
