import { describe, it, expect } from "vitest";
import { FACTION_ROSTER, MINOR_ARCHETYPE_DISTRIBUTION } from "../factions";
import { ALL_GOVERNMENT_TYPES, isDoctrine } from "@/lib/types/guards";

describe("FACTION_ROSTER", () => {
  it("contains exactly 8 majors", () => {
    expect(FACTION_ROSTER).toHaveLength(8);
  });

  it("covers every government type exactly once", () => {
    const governments = FACTION_ROSTER.map((f) => f.governmentType).sort();
    const expected = [...ALL_GOVERNMENT_TYPES].sort();
    expect(governments).toEqual(expected);
  });

  it("has unique keys, names, and colors", () => {
    const keys = FACTION_ROSTER.map((f) => f.key);
    const names = FACTION_ROSTER.map((f) => f.name);
    const colors = FACTION_ROSTER.map((f) => f.color);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("uses valid doctrine values", () => {
    for (const f of FACTION_ROSTER) {
      expect(isDoctrine(f.doctrine)).toBe(true);
    }
  });

  it("color values are hex with leading #", () => {
    for (const f of FACTION_ROSTER) {
      expect(f.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("MINOR_ARCHETYPE_DISTRIBUTION", () => {
  it("declares the four archetypes in the expected order", () => {
    const archetypes = MINOR_ARCHETYPE_DISTRIBUTION.map((a) => a.archetype);
    expect(archetypes).toEqual(["buffer", "frontier", "enclave", "cluster"]);
  });

  it("cluster absorbs the remainder (declared proportion is 0)", () => {
    const cluster = MINOR_ARCHETYPE_DISTRIBUTION.find((a) => a.archetype === "cluster");
    expect(cluster?.proportion).toBe(0);
  });

  it("non-cluster proportions sum to less than 1.0 so cluster gets a real share", () => {
    const sum = MINOR_ARCHETYPE_DISTRIBUTION
      .filter((a) => a.archetype !== "cluster")
      .reduce((acc, a) => acc + a.proportion, 0);
    expect(sum).toBeLessThan(1.0);
  });
});
