/**
 * Pure refuel validation engine.
 * No database dependency — operates entirely on passed-in values.
 */

import type { ShipStatus } from "../types/game";

export interface RefuelParams {
  fuel: number;
  maxFuel: number;
  shipStatus: ShipStatus;
  amount: number;
  playerCredits: number;
  costPerUnit: number;
}

export type RefuelValidationResult =
  | { ok: true; data: { fuelToAdd: number; totalCost: number } }
  | { ok: false; error: string };

export function validateRefuel(params: RefuelParams): RefuelValidationResult {
  const { fuel, maxFuel, shipStatus, amount, playerCredits, costPerUnit } = params;

  if (shipStatus !== "docked") {
    return { ok: false, error: "Ship must be docked to refuel." };
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: "Amount must be a positive integer." };
  }

  const fuelNeeded = maxFuel - fuel;
  if (amount > fuelNeeded) {
    return {
      ok: false,
      error: `Cannot add ${amount} fuel. Tank only needs ${fuelNeeded} more.`,
    };
  }

  const totalCost = amount * costPerUnit;
  if (totalCost > playerCredits) {
    return {
      ok: false,
      error: `Not enough credits. Need ${totalCost}, have ${playerCredits}.`,
    };
  }

  return { ok: true, data: { fuelToAdd: amount, totalCost } };
}
