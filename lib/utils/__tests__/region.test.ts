import { describe, it, expect } from "vitest";
import { deriveRegionDominantFaction } from "../region";

describe("deriveRegionDominantFaction", () => {
  const names = new Map([
    ["fed", "Federation"],
    ["corp", "Corporate"],
    ["aut", "Autocracy"],
  ]);

  it("returns null for empty input", () => {
    expect(deriveRegionDominantFaction([], names)).toBeNull();
  });

  it("returns the only faction when input has one entry", () => {
    expect(deriveRegionDominantFaction(["fed"], names)).toBe("fed");
  });

  it("returns the majority faction id", () => {
    expect(
      deriveRegionDominantFaction(["fed", "fed", "corp"], names),
    ).toBe("fed");
  });

  it("breaks ties alphabetically by faction name (not by id)", () => {
    // fed and corp both appear twice; "Corporate" sorts before "Federation".
    expect(
      deriveRegionDominantFaction(["fed", "fed", "corp", "corp"], names),
    ).toBe("corp");
  });

  it("breaks three-way ties alphabetically by name", () => {
    // All three appear once; "Autocracy" sorts first.
    expect(
      deriveRegionDominantFaction(["fed", "corp", "aut"], names),
    ).toBe("aut");
  });

  it("falls back to the id when name is missing from the map", () => {
    // Tied counts; the lookup map has no entry for "zzz", so "zzz" is
    // compared by its raw id ("zzz"). "fed" sorts before "zzz" lexically.
    expect(
      deriveRegionDominantFaction(["fed", "zzz"], names),
    ).toBe("fed");
  });

  it("is deterministic regardless of input order", () => {
    const a = ["fed", "corp", "fed"];
    const b = ["corp", "fed", "fed"];
    expect(deriveRegionDominantFaction(a, names)).toBe(
      deriveRegionDominantFaction(b, names),
    );
  });
});
