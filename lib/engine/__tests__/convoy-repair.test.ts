import { describe, it, expect } from "vitest";
import { computeConvoyRepairPlan, type ConvoyRepairShip } from "../convoy-repair";
import { DAMAGE_CONSTANTS } from "../damage";

const COST = DAMAGE_CONSTANTS.REPAIR_COST_PER_HULL;

function ship(overrides: Partial<ConvoyRepairShip> & { id: string }): ConvoyRepairShip {
  return {
    name: `Ship ${overrides.id}`,
    hullMax: 100,
    hullCurrent: 100,
    ...overrides,
  };
}

describe("computeConvoyRepairPlan", () => {
  it("computes 50% repair across 3 ships with varying damage", () => {
    const ships = [
      ship({ id: "s1", hullMax: 100, hullCurrent: 60 }),  // 40 damage
      ship({ id: "s2", hullMax: 80, hullCurrent: 80 }),   // 0 damage
      ship({ id: "s3", hullMax: 120, hullCurrent: 90 }),  // 30 damage
    ];

    const plan = computeConvoyRepairPlan(ships, 0.5);

    expect(plan.ships[0].healAmount).toBe(20); // ceil(40 * 0.5) = 20
    expect(plan.ships[0].hullAfter).toBe(80);
    expect(plan.ships[0].cost).toBe(20 * COST);

    expect(plan.ships[1].healAmount).toBe(0);  // no damage
    expect(plan.ships[1].cost).toBe(0);

    expect(plan.ships[2].healAmount).toBe(15); // ceil(30 * 0.5) = 15
    expect(plan.ships[2].hullAfter).toBe(105);
    expect(plan.ships[2].cost).toBe(15 * COST);

    expect(plan.totalHealed).toBe(35);
    expect(plan.totalCost).toBe(35 * COST);
  });

  it("heals fully at 100%", () => {
    const ships = [
      ship({ id: "s1", hullMax: 100, hullCurrent: 30 }),
      ship({ id: "s2", hullMax: 50, hullCurrent: 10 }),
    ];

    const plan = computeConvoyRepairPlan(ships, 1);

    expect(plan.ships[0].healAmount).toBe(70);
    expect(plan.ships[0].hullAfter).toBe(100);
    expect(plan.ships[1].healAmount).toBe(40);
    expect(plan.ships[1].hullAfter).toBe(50);
    expect(plan.totalHealed).toBe(110);
    expect(plan.totalCost).toBe(110 * COST);
  });

  it("heals nothing at 0%", () => {
    const ships = [
      ship({ id: "s1", hullMax: 100, hullCurrent: 50 }),
    ];

    const plan = computeConvoyRepairPlan(ships, 0);

    expect(plan.ships[0].healAmount).toBe(0);
    expect(plan.totalCost).toBe(0);
  });

  it("rounds up for small damage at 50%", () => {
    // 1 damage at 50% → ceil(0.5) = 1 (generous to player)
    const ships = [
      ship({ id: "s1", hullMax: 100, hullCurrent: 99 }),
    ];

    const plan = computeConvoyRepairPlan(ships, 0.5);

    expect(plan.ships[0].healAmount).toBe(1);
    expect(plan.ships[0].hullAfter).toBe(100);
  });

  it("clamps fraction to 0-1 range", () => {
    const ships = [
      ship({ id: "s1", hullMax: 100, hullCurrent: 50 }),
    ];

    const over = computeConvoyRepairPlan(ships, 1.5);
    expect(over.ships[0].healAmount).toBe(50); // clamped to 1.0

    const under = computeConvoyRepairPlan(ships, -0.5);
    expect(under.ships[0].healAmount).toBe(0); // clamped to 0
  });

  it("handles empty ship array", () => {
    const plan = computeConvoyRepairPlan([], 1);
    expect(plan.ships).toHaveLength(0);
    expect(plan.totalHealed).toBe(0);
    expect(plan.totalCost).toBe(0);
  });

  it("does not heal beyond hullMax", () => {
    const ships = [
      ship({ id: "s1", hullMax: 50, hullCurrent: 48 }),
    ];

    const plan = computeConvoyRepairPlan(ships, 1);
    expect(plan.ships[0].hullAfter).toBe(50);
    expect(plan.ships[0].healAmount).toBe(2);
  });
});
