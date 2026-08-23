import { describe, it, expect } from "vitest";
import {
  BODY_ARCHETYPES, SUN_CLASSES, HABITABILITY_THRESHOLD, HABITABLE_COUNT_DAMPING,
} from "../bodies";
import type { BodyArchetypeId, SunClass } from "@/lib/types/game";

const ARCHETYPE_IDS = Object.values(BODY_ARCHETYPES).map((a) => a.id);
const SUN_CLASS_IDS = Object.values(SUN_CLASSES).map((s) => s.id);

const isAboveThreshold = (id: BodyArchetypeId) => BODY_ARCHETYPES[id].scores.default >= HABITABILITY_THRESHOLD;
const isDead = (id: BodyArchetypeId) => BODY_ARCHETYPES[id].peopleLand.max === 0;

/** Archetype ids a sun class can actually roll (positive weight). */
function rollableArchetypes(sunClass: SunClass): BodyArchetypeId[] {
  const weights = SUN_CLASSES[sunClass].archetypeWeights;
  return ARCHETYPE_IDS.filter((id) => (weights[id] ?? 0) > 0);
}

describe("BODY_ARCHETYPES — habitability-seeding budgets", () => {
  it("every sun class keeps at least one positive-weight dead class", () => {
    // Vacuity guard: fails if any sun class's rollable set is empty or contains no dead body.
    for (const sunClass of SUN_CLASS_IDS) {
      const rollable = rollableArchetypes(sunClass);
      expect(rollable.length).toBeGreaterThan(0);
      expect(rollable.some(isDead)).toBe(true);
    }
  });

  it("yellow and orange keep at least one positive-weight above-threshold class", () => {
    for (const sunClass of ["yellow", "orange_dwarf"] as const) {
      const rollable = rollableArchetypes(sunClass);
      expect(rollable.some(isAboveThreshold)).toBe(true);
    }
  });

  it("blue-white and red-dwarf carry NO above-threshold class, by design", () => {
    for (const sunClass of ["blue_white", "red_dwarf"] as const) {
      const rollable = rollableArchetypes(sunClass);
      expect(rollable.some(isAboveThreshold)).toBe(false);
    }
  });

  it("the habitable-count damping ladder's terminal entry is exactly 0 — a 4th habitable is impossible by table", () => {
    expect(HABITABLE_COUNT_DAMPING.length).toBeGreaterThanOrEqual(4);
    expect(HABITABLE_COUNT_DAMPING[3]).toBe(0);
  });

  it("the ladder's first entry is 1 — the first habitable body is never damped", () => {
    expect(HABITABLE_COUNT_DAMPING[0]).toBe(1);
  });

  it("gaia_world holds the top people-land band of every archetype", () => {
    const gaiaMax = BODY_ARCHETYPES.gaia_world.peopleLand.max;
    for (const id of ARCHETYPE_IDS) {
      if (id !== "gaia_world") {
        expect(gaiaMax).toBeGreaterThan(BODY_ARCHETYPES[id].peopleLand.max);
      }
    }
  });

  it("every authored count range (people land, industry land, deposit counts) is an integer with min <= max", () => {
    // Vacuity guard: fails outright if the table is empty or a range family is unauthored.
    expect(ARCHETYPE_IDS.length).toBeGreaterThan(0);
    for (const id of ARCHETYPE_IDS) {
      const a = BODY_ARCHETYPES[id];
      for (const range of [a.peopleLand, a.industryLand, ...Object.values(a.depositCounts)]) {
        expect(Number.isInteger(range.min)).toBe(true);
        expect(Number.isInteger(range.max)).toBe(true);
        expect(range.min).toBeLessThanOrEqual(range.max);
      }
    }
  });

  it("the water band contains the spec's anchor derivation (~35 extractors at 10,000 pops)", () => {
    const waterBands = ARCHETYPE_IDS
      .map((id) => BODY_ARCHETYPES[id].depositCounts.water)
      .filter((range): range is { min: number; max: number } => range !== undefined);
    expect(waterBands.length).toBeGreaterThan(0);
    expect(waterBands.some((range) => range.min <= 35 && 35 <= range.max)).toBe(true);
  });

  it("every archetype's default score is in [0, 1]", () => {
    for (const id of ARCHETYPE_IDS) {
      expect(BODY_ARCHETYPES[id].scores.default).toBeGreaterThanOrEqual(0);
      expect(BODY_ARCHETYPES[id].scores.default).toBeLessThanOrEqual(1);
    }
  });

  it("every archetype's extractionModifier is in (0, 1]", () => {
    for (const id of ARCHETYPE_IDS) {
      expect(BODY_ARCHETYPES[id].extractionModifier).toBeGreaterThan(0);
      expect(BODY_ARCHETYPES[id].extractionModifier).toBeLessThanOrEqual(1);
    }
  });

  it("gas_giant and volcanic_world are tech-locked; the mining-outpost backbone is not", () => {
    expect(BODY_ARCHETYPES.gas_giant.techLocked).toBe(true);
    expect(BODY_ARCHETYPES.volcanic_world.techLocked).toBe(true);
    expect(BODY_ARCHETYPES.barren_rock.techLocked).toBe(false);
    expect(BODY_ARCHETYPES.asteroid_belt.techLocked).toBe(false);
  });
});
