import {
  spotPrice,
  curveForRow,
  type MarketCurve,
} from "@/lib/engine/market-pricing";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
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
    curve: curveForRow({ demandRate, anchorMult }, good),
  };
}

/**
 * Build a display MarketEntry from a market row's stock + good. Price is the
 * derived spot readout; `stock` is floored so the player never sees fractional
 * goods. `demandRate` is the market row's days-of-supply denominator and
 * `anchorMult` (default 1) its stored anchor-shift multiplier — together they
 * centre the pricing curve.
 */
export function buildMarketEntry(
  goodId: string,
  good: PricedGood,
  stock: number,
  demandRate: number,
  anchorMult: number = 1,
): MarketEntry {
  const { curve } = curveForGoodRow(good, demandRate, anchorMult);
  return {
    goodId,
    goodName: good.name,
    basePrice: good.basePrice,
    currentPrice: spotPrice(curve, stock),
    stock: Math.floor(stock),
  };
}
