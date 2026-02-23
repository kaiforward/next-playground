import { describe, it, expect } from "vitest";
import {
  rollDamageOnArrival,
  calculateRepairCost,
  computeEscortProtection,
  DAMAGE_CONSTANTS,
} from "@/lib/engine/damage";

// Deterministic RNG helper: returns values in sequence, cycling
function makeRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

describe("rollDamageOnArrival", () => {
  it("returns no damage when danger is 0", () => {
    const result = rollDamageOnArrival(0, 20, 20, 100, 100, makeRng([0]));
    expect(result.shieldDamage).toBe(0);
    expect(result.hullDamage).toBe(0);
    expect(result.disabled).toBe(false);
  });

  it("returns no damage when roll exceeds damage chance", () => {
    // danger 0.1 → chance = 0.06, rng returns 0.5 → no damage
    const result = rollDamageOnArrival(0.1, 20, 20, 100, 100, makeRng([0.5]));
    expect(result.shieldDamage).toBe(0);
    expect(result.hullDamage).toBe(0);
  });

  it("deals damage when roll is below damage chance", () => {
    // danger 0.5 → chance = 0.3, rng returns 0.1 → damage occurs
    // second rng call: 0.5 → damageFraction = 0.10 + 0.5 * 0.25 = 0.225
    // totalPool = 120, totalDamage = ceil(120 * 0.225) = 27
    // shields absorb 20, hull takes 7
    const result = rollDamageOnArrival(0.5, 20, 20, 100, 100, makeRng([0.1, 0.5]));
    expect(result.shieldDamage).toBe(20);
    expect(result.hullDamage).toBe(7);
    expect(result.disabled).toBe(false);
  });

  it("shields absorb all damage when sufficient", () => {
    // Small damage, big shields
    // danger 0.5 → chance 0.3, rng 0.0 → damage
    // rng 0.0 → damageFraction = 0.10, pool = 150 (50+100), damage = ceil(150*0.10) = 15
    // shields = 50 → absorbs all 15
    const result = rollDamageOnArrival(0.5, 50, 50, 100, 100, makeRng([0, 0]));
    expect(result.shieldDamage).toBe(15);
    expect(result.hullDamage).toBe(0);
    expect(result.disabled).toBe(false);
  });

  it("disables ship when hull reaches 0", () => {
    // danger 0.5, hull at 1, shields at 0
    // chance = 0.3, rng 0.0 → damage
    // rng 0.0 → fraction = 0.10, pool = 100, damage = 10
    // shields absorb 0, hull takes min(10, 1) = 1, newHull = 0 → disabled
    const result = rollDamageOnArrival(0.5, 0, 0, 100, 1, makeRng([0, 0]));
    expect(result.hullDamage).toBe(1);
    expect(result.disabled).toBe(true);
  });

  it("escorts reduce damage chance and severity", () => {
    const escort = { damageChanceReduction: 0.5, damageSeverityReduction: 0.25 };
    // danger 0.5 → base chance 0.3, reduced to 0.15
    // rng 0.10 → still under 0.15 → damage
    // rng 0.5 → fraction = 0.225, reduced by 0.25 → 0.169
    // pool = 120, damage = ceil(120 * 0.169) = ceil(20.25) = 21
    // shields absorb 20, hull takes 1
    const result = rollDamageOnArrival(0.5, 20, 20, 100, 100, makeRng([0.10, 0.5]), escort);
    expect(result.shieldDamage).toBe(20);
    expect(result.hullDamage).toBe(1);
  });

  it("high escort protection prevents damage", () => {
    const escort = { damageChanceReduction: 0.9, damageSeverityReduction: 0.45 };
    // danger 0.5 → chance 0.3 * 0.1 = 0.03
    // rng 0.05 → above 0.03 → no damage
    const result = rollDamageOnArrival(0.5, 20, 20, 100, 100, makeRng([0.05]), escort);
    expect(result.shieldDamage).toBe(0);
    expect(result.hullDamage).toBe(0);
  });

  it("always deals at least 1 damage when damage occurs", () => {
    // Very low danger, minimal pool
    const result = rollDamageOnArrival(1.0, 0, 0, 5, 5, makeRng([0, 0]));
    expect(result.hullDamage).toBeGreaterThanOrEqual(1);
  });
});

describe("calculateRepairCost", () => {
  it("returns 0 for undamaged ship", () => {
    const result = calculateRepairCost(100, 100);
    expect(result.totalCost).toBe(0);
  });

  it("costs proportional to hull damage", () => {
    const result = calculateRepairCost(100, 50);
    expect(result.hullCost).toBe(50 * DAMAGE_CONSTANTS.REPAIR_COST_PER_HULL);
    expect(result.totalCost).toBe(result.hullCost);
  });

  it("full hull repair for disabled ship", () => {
    const result = calculateRepairCost(100, 0);
    expect(result.hullCost).toBe(100 * DAMAGE_CONSTANTS.REPAIR_COST_PER_HULL);
  });
});

describe("computeEscortProtection", () => {
  it("returns zero protection with zero-firepower ships", () => {
    const result = computeEscortProtection([
      { firepower: 0 },
      { firepower: 0 },
    ]);
    expect(result.damageChanceReduction).toBe(0);
    expect(result.damageSeverityReduction).toBe(0);
  });

  it("returns zero protection with empty list", () => {
    const result = computeEscortProtection([]);
    expect(result.damageChanceReduction).toBe(0);
  });

  it("single ship provides protection based on firepower", () => {
    const result = computeEscortProtection([
      { firepower: 12 },
    ]);
    // 12 / (12 + 30) = 12/42 ≈ 0.286
    expect(result.damageChanceReduction).toBeCloseTo(12 / 42);
    expect(result.damageSeverityReduction).toBeCloseTo(12 / 42 * 0.5);
  });

  it("multiple ships stack firepower", () => {
    const result = computeEscortProtection([
      { firepower: 12 },
      { firepower: 18 },
    ]);
    // 30 / (30 + 30) = 0.5
    expect(result.damageChanceReduction).toBeCloseTo(0.5);
  });

  it("caps at MAX_ESCORT_REDUCTION", () => {
    const result = computeEscortProtection([
      { firepower: 100 },
      { firepower: 100 },
    ]);
    // 200 / (200 + 30) ≈ 0.87 → capped at 0.70
    expect(result.damageChanceReduction).toBe(DAMAGE_CONSTANTS.MAX_ESCORT_REDUCTION);
  });

  it("all ships contribute regardless of firepower level", () => {
    // Low-firepower trade ships still contribute a small amount
    const withTrade = computeEscortProtection([
      { firepower: 12 },
      { firepower: 2 },
    ]);
    const withoutTrade = computeEscortProtection([
      { firepower: 12 },
    ]);
    // 14/(14+30) > 12/(12+30) — trade ship adds a small bonus
    expect(withTrade.damageChanceReduction).toBeGreaterThan(withoutTrade.damageChanceReduction);
  });
});
