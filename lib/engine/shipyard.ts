/**
 * Pure shipyard validation engine.
 * No database dependency — operates entirely on passed-in values.
 */

import { SHIP_TYPES, type ShipTypeId, type ShipTypeDefinition } from "../constants/ships";

export interface ShipPurchaseParams {
  shipType: string;
  playerCredits: number;
}

export type ShipPurchaseValidationResult =
  | { ok: true; data: { shipTypeDef: ShipTypeDefinition; totalCost: number } }
  | { ok: false; error: string };

export function validateShipPurchase(
  params: ShipPurchaseParams,
): ShipPurchaseValidationResult {
  const { shipType, playerCredits } = params;

  const def = SHIP_TYPES[shipType as ShipTypeId];
  if (!def) {
    return { ok: false, error: `Unknown ship type: "${shipType}".` };
  }

  if (def.price <= 0) {
    return { ok: false, error: `${def.name} is not available for purchase.` };
  }

  if (playerCredits < def.price) {
    return {
      ok: false,
      error: `Not enough credits. Need ${def.price}, have ${playerCredits}.`,
    };
  }

  return { ok: true, data: { shipTypeDef: def, totalCost: def.price } };
}
