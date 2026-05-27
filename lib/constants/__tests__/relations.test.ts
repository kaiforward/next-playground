import { describe, it, expect } from "vitest";
import { getRelationTier, RELATION_TIERS } from "../relations";

describe("getRelationTier — integer boundary values", () => {
  const cases: ReadonlyArray<[number, string]> = [
    [100, "allied"],
    [75, "allied"],
    [74, "friendly"],
    [25, "friendly"],
    [24, "neutral"],
    [0, "neutral"],
    [-24, "neutral"],
    [-25, "unfriendly"],
    [-74, "unfriendly"],
    [-75, "hostile"],
    [-100, "hostile"],
  ];

  for (const [score, expected] of cases) {
    it(`score ${score} → ${expected}`, () => {
      expect(getRelationTier(score)).toBe(expected);
    });
  }

  it("clamps scores above +100", () => {
    expect(getRelationTier(999)).toBe("allied");
  });

  it("clamps scores below -100", () => {
    expect(getRelationTier(-999)).toBe("hostile");
  });
});

// FactionRelation.score is `Float`, so the drift produces values like 24.25
// that fall between integer tier boundaries. The earlier inclusive-range
// match threw on these; this regression keeps the tier resolution gap-free.
describe("getRelationTier — half-integer scores resolve to lower-min tier", () => {
  const cases: ReadonlyArray<[number, string]> = [
    [74.999, "friendly"],
    [25.5, "friendly"],
    [24.999, "neutral"],
    [24.25, "neutral"],
    [-24.5, "unfriendly"],
    [-74.5, "hostile"],
  ];
  for (const [score, expected] of cases) {
    it(`score ${score} → ${expected}`, () => {
      expect(getRelationTier(score)).toBe(expected);
    });
  }
});

describe("RELATION_TIERS", () => {
  it("is ordered highest-min-first (required by getRelationTier matching)", () => {
    for (let i = 1; i < RELATION_TIERS.length; i++) {
      expect(RELATION_TIERS[i].minScore).toBeLessThan(RELATION_TIERS[i - 1].minScore);
    }
  });

  it("lowest tier's minScore equals the clamp floor (-100)", () => {
    const sorted = [...RELATION_TIERS].sort((a, b) => a.minScore - b.minScore);
    expect(sorted[0].minScore).toBe(-100);
  });
});
