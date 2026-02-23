/**
 * Pure convoy refuel plan engine — computes per-ship fuel amounts and costs.
 * No DB dependency. Testable with Vitest.
 */

import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";

// ── Types ────────────────────────────────────────────────────────

export interface ConvoyRefuelShip {
  id: string;
  name: string;
  fuel: number;
  maxFuel: number;
}

export interface ConvoyRefuelShipPlan {
  shipId: string;
  shipName: string;
  fuelBefore: number;
  fuelAfter: number;
  fuelAmount: number;
  cost: number;
}

export interface ConvoyRefuelPlan {
  ships: ConvoyRefuelShipPlan[];
  totalFuel: number;
  totalCost: number;
}

// ── Functions ────────────────────────────────────────────────────

/**
 * Compute a refuel plan for all ships in a convoy at a given refuel fraction.
 *
 * - `fraction` is 0–1 (0% to 100% of each ship's individual missing fuel)
 * - Per-ship: fuelAmount = ceil(missingFuel * clampedFraction) — rounds up, generous to player
 * - Cost: fuelAmount * REFUEL_COST_PER_UNIT per ship
 * - Full ships get zero cost and zero fuel
 */
export function computeConvoyRefuelPlan(
  ships: ConvoyRefuelShip[],
  fraction: number,
): ConvoyRefuelPlan {
  const clampedFraction = Math.max(0, Math.min(1, fraction));

  const shipPlans: ConvoyRefuelShipPlan[] = ships.map((ship) => {
    const missing = Math.max(0, ship.maxFuel - ship.fuel);
    const fuelAmount = missing > 0 ? Math.ceil(missing * clampedFraction) : 0;
    const cost = fuelAmount * REFUEL_COST_PER_UNIT;
    const fuelAfter = Math.min(ship.maxFuel, ship.fuel + fuelAmount);

    return {
      shipId: ship.id,
      shipName: ship.name,
      fuelBefore: ship.fuel,
      fuelAfter,
      fuelAmount,
      cost,
    };
  });

  const totalFuel = shipPlans.reduce((s, p) => s + p.fuelAmount, 0);
  const totalCost = shipPlans.reduce((s, p) => s + p.cost, 0);

  return { ships: shipPlans, totalFuel, totalCost };
}
