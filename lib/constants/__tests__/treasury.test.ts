import { describe, it, expect } from "vitest";
import { GOOD_NAMES, GOODS } from "@/lib/constants/goods";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import {
  REFERENCE_VALUE,
  TREASURY,
  TAX_LEVEL_RATE_MULT,
  DEFAULT_TAX_LEVEL,
} from "@/lib/constants/treasury";
import { ALL_TAX_LEVELS } from "@/lib/types/guards";
import { ALL_GOVERNMENT_TYPES } from "@/lib/types/guards";

describe("reference values", () => {
  it("covers every good with a positive, finite, S-invariant value", () => {
    for (const goodId of GOOD_NAMES) {
      const v = REFERENCE_VALUE[goodId];
      expect(v, goodId).toBeGreaterThan(0);
      expect(Number.isFinite(v), goodId).toBe(true);
    }
  });

  it("values downstream goods as value-added, not turnover (alloys < basePrice)", () => {
    // alloys has a recipe — its reference value must be net of input base prices,
    // floored at REFERENCE_VALUE_FLOOR_SHARE of its own basePrice.
    const recipe = GOOD_RECIPES["alloys"];
    expect(recipe).toBeDefined();
    expect(REFERENCE_VALUE["alloys"]).toBeLessThan(GOODS["alloys"].basePrice);
    expect(REFERENCE_VALUE["alloys"]).toBeGreaterThanOrEqual(
      TREASURY.REFERENCE_VALUE_FLOOR_SHARE * GOODS["alloys"].basePrice,
    );
  });

  it("keeps tier-0 goods at full base price (no inputs)", () => {
    expect(REFERENCE_VALUE["ore"]).toBe(GOODS["ore"].basePrice);
  });
});

describe("tax level tables", () => {
  it("has a rate multiplier and a government default for every level/government", () => {
    for (const level of ALL_TAX_LEVELS) {
      expect(TAX_LEVEL_RATE_MULT[level]).toBeGreaterThan(0);
    }
    expect(TAX_LEVEL_RATE_MULT["normal"]).toBe(1);
    for (const gov of ALL_GOVERNMENT_TYPES) {
      expect(ALL_TAX_LEVELS).toContain(DEFAULT_TAX_LEVEL[gov]);
    }
  });

  it("pins each government's intended default stance", () => {
    // The specific mapping is the design, not just membership — a swapped or
    // homogenised table must fail here.
    expect(DEFAULT_TAX_LEVEL).toEqual({
      federation: "normal",
      corporate: "low",
      authoritarian: "high",
      frontier: "low",
      cooperative: "normal",
      technocratic: "normal",
      militarist: "high",
      theocratic: "normal",
    });
  });
});
