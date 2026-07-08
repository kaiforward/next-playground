import { describe, it, expect } from "vitest";
import { FACTION_ROSTER } from "../factions";
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
