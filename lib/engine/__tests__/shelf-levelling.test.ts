import { describe, expect, it } from "vitest";
import { raiseFor, solveWaterLevel, type LevelWorld } from "../shelf-levelling";

function totalWant(worlds: readonly LevelWorld[]): number {
  return worlds.reduce((sum, w) => sum + raiseFor(w, Math.max(...worlds.map((x) => x.targetCover))), 0);
}

describe("solveWaterLevel", () => {
  it("returns the largest target and every raise equals that world's full want when supply is at or above every world's full want", () => {
    const worlds: LevelWorld[] = [
      { id: "a", levelCover: 1, targetCover: 40, demand: 10 },
      { id: "b", levelCover: 5, targetCover: 30, demand: 4 },
      { id: "c", levelCover: 20, targetCover: 40, demand: 2 },
    ];
    const fullWant = totalWant(worlds);
    const level = solveWaterLevel(worlds, fullWant);
    expect(level).toBe(40);
    for (const w of worlds) {
      const expectedRaise = (Math.min(w.targetCover, 40) - w.levelCover) * w.demand;
      expect(raiseFor(w, level)).toBeCloseTo(expectedRaise, 9);
    }
  });

  it("returns the lowest cover and every raise is 0 when supply is 0", () => {
    const worlds: LevelWorld[] = [
      { id: "a", levelCover: 3, targetCover: 40, demand: 5 },
      { id: "b", levelCover: 1, targetCover: 40, demand: 2 },
      { id: "c", levelCover: 7, targetCover: 40, demand: 1 },
    ];
    const level = solveWaterLevel(worlds, 0);
    expect(level).toBe(1);
    for (const w of worlds) {
      expect(raiseFor(w, level)).toBe(0);
    }
  });

  it("conserves tonnage: raises sum to min(supply, total want), for a short supply and for an ample one", () => {
    const worlds: LevelWorld[] = [
      { id: "a", levelCover: 1, targetCover: 40, demand: 6 },
      { id: "b", levelCover: 4, targetCover: 40, demand: 3 },
      { id: "c", levelCover: 10, targetCover: 40, demand: 8 },
      { id: "d", levelCover: 20, targetCover: 20, demand: 5 },
    ];
    const fullWant = totalWant(worlds);

    const shortSupply = fullWant * 0.3;
    const shortLevel = solveWaterLevel(worlds, shortSupply);
    const shortSum = worlds.reduce((sum, w) => sum + raiseFor(w, shortLevel), 0);
    expect(shortSum).toBeCloseTo(Math.min(shortSupply, fullWant), 6);

    const ampleSupply = fullWant * 5;
    const ampleLevel = solveWaterLevel(worlds, ampleSupply);
    const ampleSum = worlds.reduce((sum, w) => sum + raiseFor(w, ampleLevel), 0);
    expect(ampleSum).toBeCloseTo(Math.min(ampleSupply, fullWant), 6);
  });

  it("returns 0 for an empty list", () => {
    expect(solveWaterLevel([], 100)).toBe(0);
  });

  it("gives 0 to a world starting above the returned level and a positive raise to a world below it, even when the above-level world has the larger demand", () => {
    const worlds: LevelWorld[] = [
      { id: "above", levelCover: 30, targetCover: 40, demand: 50 },
      { id: "below", levelCover: 2, targetCover: 40, demand: 1 },
    ];
    // Small supply: only the below-level world can be raised meaningfully.
    const supply = 5;
    const level = solveWaterLevel(worlds, supply);
    const above = worlds[0];
    const below = worlds[1];
    expect(level).toBeLessThan(above.levelCover);
    expect(raiseFor(above, level)).toBe(0);
    expect(raiseFor(below, level)).toBeGreaterThan(0);
  });

  it("stops a world at its target while the level rises past it, for worlds with differing targetCover", () => {
    const worlds: LevelWorld[] = [
      { id: "lowTarget", levelCover: 1, targetCover: 10, demand: 4 },
      { id: "highTarget", levelCover: 1, targetCover: 40, demand: 4 },
    ];
    const fullWant = totalWant(worlds);
    // Ample supply drives the level past the low target.
    const level = solveWaterLevel(worlds, fullWant);
    expect(level).toBeGreaterThan(worlds[0].targetCover);
    expect(raiseFor(worlds[0], level)).toBeCloseTo(
      (worlds[0].targetCover - worlds[0].levelCover) * worlds[0].demand,
      9,
    );
    expect(raiseFor(worlds[1], level)).toBeCloseTo((level - worlds[1].levelCover) * worlds[1].demand, 9);
  });

  it("vacuity: a solver that returns any constant fails the conservation property on at least one of these fixtures", () => {
    const worlds: LevelWorld[] = [
      { id: "a", levelCover: 1, targetCover: 40, demand: 6 },
      { id: "b", levelCover: 4, targetCover: 40, demand: 3 },
      { id: "c", levelCover: 10, targetCover: 40, demand: 8 },
    ];
    const fullWant = totalWant(worlds);
    const shortSupply = fullWant * 0.3;
    const ampleSupply = fullWant * 5;

    const conservedByConstant = (level: number): boolean => {
      const shortSum = worlds.reduce((sum, w) => sum + raiseFor(w, level), 0);
      const ampleSum = worlds.reduce((sum, w) => sum + raiseFor(w, level), 0);
      return (
        Math.abs(shortSum - Math.min(shortSupply, fullWant)) < 1e-6 &&
        Math.abs(ampleSum - Math.min(ampleSupply, fullWant)) < 1e-6
      );
    };

    // No single constant level can satisfy conservation for both a short and an ample supply
    // at once, since the required total raise differs between them.
    const candidateLevels = [0, worlds[0].levelCover, worlds[1].levelCover, worlds[2].levelCover, 40, 1000];
    for (const level of candidateLevels) {
      expect(conservedByConstant(level)).toBe(false);
    }

    // The real solver, unlike any constant, satisfies conservation at both supplies.
    const shortLevel = solveWaterLevel(worlds, shortSupply);
    const ampleLevel = solveWaterLevel(worlds, ampleSupply);
    const shortSum = worlds.reduce((sum, w) => sum + raiseFor(w, shortLevel), 0);
    const ampleSum = worlds.reduce((sum, w) => sum + raiseFor(w, ampleLevel), 0);
    expect(shortSum).toBeCloseTo(Math.min(shortSupply, fullWant), 6);
    expect(ampleSum).toBeCloseTo(Math.min(ampleSupply, fullWant), 6);
  });
});

describe("raiseFor", () => {
  it("is 0 when the world is already at or above the level, and positive otherwise", () => {
    const world: LevelWorld = { id: "w", levelCover: 10, targetCover: 40, demand: 3 };
    expect(raiseFor(world, 5)).toBe(0);
    expect(raiseFor(world, 10)).toBe(0);
    expect(raiseFor(world, 20)).toBeCloseTo(10 * 3, 9);
  });

  it("caps at the target even when the level exceeds it", () => {
    const world: LevelWorld = { id: "w", levelCover: 5, targetCover: 20, demand: 2 };
    expect(raiseFor(world, 100)).toBeCloseTo((20 - 5) * 2, 9);
  });
});
