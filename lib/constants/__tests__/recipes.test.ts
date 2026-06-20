import { describe, it, expect } from "vitest";
import { GOOD_RECIPES, PRODUCTION_GOOD_ORDER, GOOD_RECIPE_CONSUMERS } from "@/lib/constants/recipes";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";

describe("GOOD_RECIPES integrity", () => {
  it("has a recipe for every tier-1+ good and none for tier-0 goods", () => {
    for (const goodId of GOOD_NAMES) {
      const tier = GOOD_TIER_BY_KEY[goodId];
      if (tier === 0) {
        expect(GOOD_RECIPES[goodId], `tier-0 good must have no recipe: ${goodId}`).toBeUndefined();
      } else {
        expect(GOOD_RECIPES[goodId], `tier-${tier} good must have a recipe: ${goodId}`).toBeDefined();
      }
    }
  });

  it("references only real goods, with positive input quantities", () => {
    const known = new Set(GOOD_NAMES);
    for (const [output, inputs] of Object.entries(GOOD_RECIPES)) {
      expect(known.has(output), `recipe key is a real good: ${output}`).toBe(true);
      for (const [input, qty] of Object.entries(inputs)) {
        expect(known.has(input), `input is a real good: ${input} (in ${output})`).toBe(true);
        expect(qty, `positive input qty: ${input} in ${output}`).toBeGreaterThan(0);
      }
    }
  });

  it("only consumes inputs of equal or lower tier", () => {
    for (const [output, inputs] of Object.entries(GOOD_RECIPES)) {
      const outTier = GOOD_TIER_BY_KEY[output];
      for (const input of Object.keys(inputs)) {
        expect(GOOD_TIER_BY_KEY[input], `${input} tier <= ${output} tier`).toBeLessThanOrEqual(outTier);
      }
    }
  });

  it("is acyclic (a valid DAG so a consumer can topologically order production)", () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const cyclic: string[] = [];
    const visit = (good: string): void => {
      if (done.has(good)) return;
      if (visiting.has(good)) {
        cyclic.push(good);
        return;
      }
      visiting.add(good);
      for (const input of Object.keys(GOOD_RECIPES[good] ?? {})) visit(input);
      visiting.delete(good);
      done.add(good);
    };
    for (const good of Object.keys(GOOD_RECIPES)) visit(good);
    expect(cyclic, `cycle detected through: ${cyclic.join(", ")}`).toEqual([]);
  });
});

describe("PRODUCTION_GOOD_ORDER", () => {
  it("includes every good exactly once", () => {
    expect([...PRODUCTION_GOOD_ORDER].sort()).toEqual([...GOOD_NAMES].sort());
  });

  it("places every good after all of its recipe inputs", () => {
    const pos = new Map(PRODUCTION_GOOD_ORDER.map((g, i) => [g, i]));
    for (const [good, recipe] of Object.entries(GOOD_RECIPES)) {
      for (const input of Object.keys(recipe)) {
        expect(pos.get(input)!).toBeLessThan(pos.get(good)!);
      }
    }
  });

  it("orders the metals→alloys→hull_plating intra-tier chain correctly", () => {
    const pos = new Map(PRODUCTION_GOOD_ORDER.map((g, i) => [g, i]));
    expect(pos.get("metals")!).toBeLessThan(pos.get("alloys")!);
    expect(pos.get("alloys")!).toBeLessThan(pos.get("hull_plating")!);
  });
});

describe("GOOD_RECIPE_CONSUMERS", () => {
  it("lists metals as consumed by alloys at its recipe quantity", () => {
    const consumers = GOOD_RECIPE_CONSUMERS["metals"] ?? [];
    const alloys = consumers.find((c) => c.goodId === "alloys");
    expect(alloys?.perOutput).toBe(GOOD_RECIPES["alloys"]["metals"]);
  });
});
