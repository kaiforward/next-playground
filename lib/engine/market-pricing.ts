import { DEFAULT_ELASTICITY } from "@/lib/constants/market-economy";

/**
 * A good's price curve at one station. Price is a function of a single
 * `stock` value relative to `targetStock` (the anchor where price ===
 * basePrice). See the stock-based market economy design spec.
 */
export interface MarketCurve {
  basePrice: number;
  /** Stock level where the mid price equals basePrice. */
  targetStock: number;
  /** Elasticity exponent. Defaults to DEFAULT_ELASTICITY (1). */
  k?: number;
  /** Minimum price as a multiple of basePrice (price ceiling on stock). */
  floorMult: number;
  /** Maximum price as a multiple of basePrice (price ceiling on price). */
  ceilingMult: number;
}

/**
 * Instantaneous (spot) mid price at a given stock level, clamped to the good's
 * floor/ceiling. Returns an UNROUNDED value so it can be summed without
 * compounding rounding error. Stock at/below zero returns the ceiling.
 *
 *   mid = basePrice * (targetStock / stock) ^ k
 */
export function midPriceAt(curve: MarketCurve, stock: number): number {
  const { basePrice, targetStock, floorMult, ceilingMult } = curve;
  const k = curve.k ?? DEFAULT_ELASTICITY;
  const min = floorMult * basePrice;
  const max = ceilingMult * basePrice;
  if (stock <= 0) return max;
  const raw = basePrice * (targetStock / stock) ** k;
  return Math.max(min, Math.min(max, raw));
}

/** Rounded spot price, for display. */
export function spotPrice(curve: MarketCurve, stock: number): number {
  return Math.round(midPriceAt(curve, stock));
}

/**
 * Average mid price per unit for a trade of `quantity` units, integrating the
 * price curve over the stock range the trade moves (slippage). Each unit is
 * priced at the midpoint of the stock step it causes, so a buy and an immediate
 * sell-back traverse the identical price points — that symmetry is what makes
 * the round-trip exploit unprofitable.
 *
 *  - buy:  stock decreases; units priced at stock-0.5, stock-1.5, ...
 *  - sell: stock increases; units priced at stock+0.5, stock+1.5, ...
 */
export function tradeAvgMidPrice(
  curve: MarketCurve,
  stock: number,
  quantity: number,
  type: "buy" | "sell",
): number {
  if (quantity <= 0) return 0;
  let total = 0;
  for (let i = 0; i < quantity; i++) {
    const level = type === "buy" ? stock - i - 0.5 : stock + i + 0.5;
    total += midPriceAt(curve, level);
  }
  return total / quantity;
}

export interface TradeQuote {
  /** Pre-spread average mid price per unit. */
  avgMidUnit: number;
  /** Post-spread average price per unit (buy: above mid, sell: below mid). */
  avgUnitPrice: number;
  /** Integer total the player pays (buy) or receives (sell). */
  totalPrice: number;
}

/**
 * Full price quote for a trade: integrated slippage (tradeAvgMidPrice) plus the
 * bid-ask spread. `spread` is the half-spread (e.g. 0.05). Only the grand total
 * is rounded, so per-unit rounding never compounds across the quantity.
 */
export function quoteTrade(
  curve: MarketCurve,
  stock: number,
  quantity: number,
  type: "buy" | "sell",
  spread: number,
): TradeQuote {
  const avgMidUnit = tradeAvgMidPrice(curve, stock, quantity, type);
  const spreadMult = type === "buy" ? 1 + spread : 1 - spread;
  const avgUnitPrice = avgMidUnit * spreadMult;
  const totalPrice = Math.round(avgUnitPrice * quantity);
  return { avgMidUnit, avgUnitPrice, totalPrice };
}
