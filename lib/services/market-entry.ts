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
export function curveForGoodRow(good: PricedGood): { goodKey: string; curve: MarketCurve } {
  const goodKey = GOOD_NAME_TO_KEY.get(good.name) ?? good.name;
  return {
    goodKey,
    curve: curveForGood(goodKey, good.basePrice, good.priceFloor, good.priceCeiling),
  };
}

/**
 * Build a display MarketEntry from a market row's stock + good. The single-unit
 * buy/sell prices use the bid-ask spread for the system's government; the
 * integrated-slippage total for a real trade is computed separately in
 * executeTrade. `stock` is floored so the player never sees fractional goods.
 */
export function buildMarketEntry(
  goodId: string,
  good: PricedGood,
  stock: number,
  govDef?: GovernmentDefinition,
): MarketEntry {
  const { curve } = curveForGoodRow(good);
  const spread = getSpread(govDef);
  return {
    goodId,
    goodName: good.name,
    basePrice: good.basePrice,
    currentPrice: spotPrice(curve, stock),
    buyPrice: quoteTrade(curve, stock, 1, "buy", spread).totalPrice,
    sellPrice: quoteTrade(curve, stock, 1, "sell", spread).totalPrice,
    stock: Math.floor(stock),
  };
}

export { STOCK_MIN };
