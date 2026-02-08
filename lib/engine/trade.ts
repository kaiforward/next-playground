/**
 * Pure trade validation and calculation engine.
 * No database dependency — operates entirely on passed-in values.
 */

export interface TradeDelta {
  creditsDelta: number; // positive = player gains credits (sell), negative = player spends (buy)
  cargoQuantityDelta: number; // positive = player gains cargo (buy), negative = player loses (sell)
  supplyDelta: number; // positive = supply increases (sell adds supply), negative (buy removes supply)
  demandDelta: number; // positive = demand increases (buy increases demand), negative (sell decreases)
  totalPrice: number; // absolute price of the trade
}

export interface TradeParams {
  type: "buy" | "sell";
  quantity: number;
  unitPrice: number;
  playerCredits: number;
  currentCargoUsed: number;
  cargoMax: number;
  currentSupply: number;
  currentGoodQuantityInCargo: number;
}

export type TradeValidationResult =
  | { ok: true; delta: TradeDelta }
  | { ok: false; error: string };

export function validateAndCalculateTrade(
  params: TradeParams,
): TradeValidationResult {
  const {
    type,
    quantity,
    unitPrice,
    playerCredits,
    currentCargoUsed,
    cargoMax,
    currentSupply,
    currentGoodQuantityInCargo,
  } = params;

  if (quantity <= 0) {
    return { ok: false, error: "Quantity must be greater than zero." };
  }

  const totalPrice = quantity * unitPrice;

  if (type === "buy") {
    // Validate: player can afford it
    if (totalPrice > playerCredits) {
      return {
        ok: false,
        error: `Not enough credits. Need ${totalPrice}, have ${playerCredits}.`,
      };
    }

    // Validate: cargo space available
    if (currentCargoUsed + quantity > cargoMax) {
      return {
        ok: false,
        error: `Not enough cargo space. Need ${quantity} slots, have ${cargoMax - currentCargoUsed} available.`,
      };
    }

    // Validate: station has enough supply
    if (quantity > currentSupply) {
      return {
        ok: false,
        error: `Not enough supply at station. Requested ${quantity}, available ${currentSupply}.`,
      };
    }

    return {
      ok: true,
      delta: {
        creditsDelta: -totalPrice,
        cargoQuantityDelta: quantity,
        supplyDelta: -quantity,
        demandDelta: Math.round(quantity * 0.1),
        totalPrice,
      },
    };
  }

  // type === "sell"
  if (quantity > currentGoodQuantityInCargo) {
    return {
      ok: false,
      error: `Not enough in cargo. Want to sell ${quantity}, have ${currentGoodQuantityInCargo}.`,
    };
  }

  return {
    ok: true,
    delta: {
      creditsDelta: totalPrice,
      cargoQuantityDelta: -quantity,
      supplyDelta: quantity,
      demandDelta: -Math.round(quantity * 0.1),
      totalPrice,
    },
  };
}
