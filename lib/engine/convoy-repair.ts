/**
 * Pure convoy repair plan engine — computes per-ship repair amounts and costs.
 * No DB dependency. Testable with Vitest.
 */

import { DAMAGE_CONSTANTS } from "./damage";

// ── Types ────────────────────────────────────────────────────────

export interface ConvoyRepairShip {
  id: string;
  name: string;
  hullMax: number;
  hullCurrent: number;
}

export interface ConvoyRepairShipPlan {
  shipId: string;
  shipName: string;
  hullBefore: number;
  hullAfter: number;
  healAmount: number;
  cost: number;
}

export interface ConvoyRepairPlan {
  ships: ConvoyRepairShipPlan[];
  totalHealed: number;
  totalCost: number;
}

// ── Functions ────────────────────────────────────────────────────

/**
 * Compute a repair plan for all ships in a convoy at a given repair fraction.
 *
 * - `fraction` is 0–1 (0% to 100% of each ship's individual damage)
 * - Per-ship: healAmount = ceil(individualDamage * clampedFraction) — rounds up, generous to player
 * - Cost: healAmount * REPAIR_COST_PER_HULL per ship
 * - Ships with no damage get zero cost and zero heal
 */
export function computeConvoyRepairPlan(
  ships: ConvoyRepairShip[],
  fraction: number,
): ConvoyRepairPlan {
  const clampedFraction = Math.max(0, Math.min(1, fraction));

  const shipPlans: ConvoyRepairShipPlan[] = ships.map((ship) => {
    const damage = Math.max(0, ship.hullMax - ship.hullCurrent);
    const healAmount = damage > 0 ? Math.ceil(damage * clampedFraction) : 0;
    const cost = healAmount * DAMAGE_CONSTANTS.REPAIR_COST_PER_HULL;
    const hullAfter = Math.min(ship.hullMax, ship.hullCurrent + healAmount);

    return {
      shipId: ship.id,
      shipName: ship.name,
      hullBefore: ship.hullCurrent,
      hullAfter,
      healAmount,
      cost,
    };
  });

  const totalHealed = shipPlans.reduce((s, p) => s + p.healAmount, 0);
  const totalCost = shipPlans.reduce((s, p) => s + p.cost, 0);

  return { ships: shipPlans, totalHealed, totalCost };
}
