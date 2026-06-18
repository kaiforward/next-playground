import {
  spotPrice,
  quoteTrade,
  curveForGood,
  type MarketCurve,
} from "@/lib/engine/market-pricing";
import { getSpread, STOCK_MIN } from "@/lib/constants/market-economy";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import type { GovernmentDefinition } from "@/lib/constants/government";
import type { MarketEntry } from "@/lib/types/game";

/** Minimal good shape needed to price a market row. */
export interface PricedGood {
  name: string;
  basePrice: number;
  priceFloor: number;
  priceCeiling: number;
}

/** Resolve the canonical good key + price curve for a DB good row. */
export function curveForGoodRow(
  good: PricedGood,
  demandRate: number,
  anchorMult: number = 1,
): { goodKey: string; curve: MarketCurve } {
  const goodKey = GOOD_NAME_TO_KEY.get(good.name) ?? good.name;
  return {
    goodKey,
    curve: curveForGood(good.basePrice, good.priceFloor, good.priceCeiling, demandRate, anchorMult),
  };
}

/**
 * Build a display MarketEntry from a market row's stock + good. The single-unit
 * buy/sell prices use the bid-ask spread for the system's government; the
 * integrated-slippage total for a real trade is computed separately in
 * executeTrade. `stock` is floored so the player never sees fractional goods.
 *
 * `demandRate` is the market row's stored days-of-supply denominator; `anchorMult`
 * its stored anchor-shift multiplier (default 1). The resulting `targetStock` is
 * the per-system reference, exposed on the entry so the client reproduces the
 * exact curve for quote previews.
 */
export function buildMarketEntry(
  goodId: string,
  good: PricedGood,
  stock: number,
  demandRate: number,
  govDef?: GovernmentDefinition,
  anchorMult: number = 1,
): MarketEntry {
  const { curve } = curveForGoodRow(good, demandRate, anchorMult);
  const spread = getSpread(govDef);
  return {
    goodId,
    goodName: good.name,
    basePrice: good.basePrice,
    currentPrice: spotPrice(curve, stock),
    buyPrice: quoteTrade(curve, stock, 1, "buy", spread).totalPrice,
    sellPrice: quoteTrade(curve, stock, 1, "sell", spread).totalPrice,
    stock: Math.floor(stock),
    // Curve inputs for client-side quote previews (trade form).
    priceFloor: good.priceFloor,
    priceCeiling: good.priceCeiling,
    targetStock: curve.targetStock,
    spread,
  };
}

export { STOCK_MIN };
