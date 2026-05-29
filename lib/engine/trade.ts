/**
 * Pure trade validation and calculation engine.
 * No database dependency — operates entirely on passed-in values.
 *
 * Stock model: a trade moves a single `stockDelta` (buy: -qty, sell: +qty).
 * Buys are capped at floor(stock - stockMin) (the market keeps a reserve);
 * sells at floor(stockMax - stock) (can't sell into a full warehouse). The
 * `totalPrice` is computed by the caller via quoteTrade (integrated slippage +
 * spread), so this engine never sees a flat per-unit price.
 */

import type { ShipStatus } from "../types/game";

export interface TradeDelta {
  creditsDelta: number; // positive = player gains credits (sell), negative = player spends (buy)
  cargoQuantityDelta: number; // positive = player gains cargo (buy), negative = player loses (sell)
  stockDelta: number; // negative = stock removed (buy), positive = stock added (sell)
  totalPrice: number; // absolute price of the trade
}

export interface TradeParams {
  type: "buy" | "sell";
  quantity: number;
  /** Precomputed total (quoteTrade.totalPrice, after spread + any rep multiplier). */
  totalPrice: number;
  playerCredits: number;
  currentCargoUsed: number;
  cargoMax: number;
  currentStock: number;
  stockMin: number;
  stockMax: number;
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
    totalPrice,
    playerCredits,
    currentCargoUsed,
    cargoMax,
    currentStock,
    stockMin,
    stockMax,
    currentGoodQuantityInCargo,
  } = params;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "Quantity must be a positive integer." };
  }

  if (type === "buy") {
    if (totalPrice > playerCredits) {
      return {
        ok: false,
        error: `Not enough credits. Need ${totalPrice}, have ${playerCredits}.`,
      };
    }

    if (currentCargoUsed + quantity > cargoMax) {
      return {
        ok: false,
        error: `Not enough cargo space. Need ${quantity} slots, have ${cargoMax - currentCargoUsed} available.`,
      };
    }

    const available = Math.floor(currentStock - stockMin);
    if (quantity > available) {
      return {
        ok: false,
        error: `Not enough available to buy. Requested ${quantity}, available ${Math.max(0, available)}.`,
      };
    }

    return {
      ok: true,
      delta: {
        creditsDelta: -totalPrice,
        cargoQuantityDelta: quantity,
        stockDelta: -quantity,
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

  const capacity = Math.floor(stockMax - currentStock);
  if (quantity > capacity) {
    return {
      ok: false,
      error: `The market can't absorb that much. Sellable ${Math.max(0, capacity)}.`,
    };
  }

  return {
    ok: true,
    delta: {
      creditsDelta: totalPrice,
      cargoQuantityDelta: -quantity,
      stockDelta: quantity,
      totalPrice,
    },
  };
}

// ── Fleet-aware trade validation ────────────────────────────────

export interface FleetTradeParams extends TradeParams {
  shipStatus: ShipStatus;
}

export function validateFleetTrade(
  params: FleetTradeParams,
): TradeValidationResult {
  const { shipStatus, ...tradeParams } = params;

  if (shipStatus !== "docked") {
    return { ok: false, error: "Ship must be docked to trade." };
  }

  return validateAndCalculateTrade(tradeParams);
}
