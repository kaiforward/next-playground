import { DEFAULT_ELASTICITY, TARGET_COVER } from "@/lib/constants/market-economy";

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

export interface MarketBandInput {
  demandRate: number;
  storageCapacity: number;
  priceFloor: number;    // good.priceFloor (min price multiple)
  priceCeiling: number;  // good.priceCeiling (max price multiple)
  k?: number;
  anchorMult?: number;
}
export interface MarketBand { targetStock: number; minStock: number; maxStock: number; }

/**
 * Per-market stock band. Demand sets the price anchor (`targetStock`) and the
 * scarcity reserve (`minStock`); built infrastructure (`storageCapacity`) sets
 * the depth (`maxStock`). `maxStock > minStock` holds structurally because
 * priceFloor < priceCeiling. Callers pass an already-floored demandRate
 * (StationMarket.demandRate is floored at seed). See
 * docs/active/gameplay/economy.md (pricing band).
 */
export function marketBand(input: MarketBandInput): MarketBand {
  const k = input.k ?? DEFAULT_ELASTICITY;
  const anchorMult = input.anchorMult ?? 1;
  const targetStock = TARGET_COVER * Math.max(0, input.demandRate) * anchorMult;
  const minStock = targetStock / input.priceCeiling ** (1 / k);
  const maxStock = targetStock / input.priceFloor ** (1 / k) + Math.max(0, input.storageCapacity);
  return { targetStock, minStock, maxStock };
}

/**
 * Convenience adapter: derive the per-market band from a row that carries
 * `demandRate`, `storageCapacity`, and `anchorMult` alongside a good's
 * `priceFloor`/`priceCeiling`. Use this everywhere a full market row is
 * available so the band object literal is never repeated.
 */
export function marketBandForRow(
  row: { demandRate: number; storageCapacity: number; anchorMult?: number },
  good: { priceFloor: number; priceCeiling: number },
): MarketBand {
  return marketBand({
    demandRate: row.demandRate,
    storageCapacity: row.storageCapacity,
    priceFloor: good.priceFloor,
    priceCeiling: good.priceCeiling,
    anchorMult: row.anchorMult ?? 1,
  });
}

/**
 * Build a MarketCurve for a good from its DB/definition fields. The reference
 * stock (where mid === basePrice) is the per-system days-of-supply anchor:
 * `TARGET_COVER × demandRate × anchorMult`. `demandRate` is the market's stored
 * local demand rate (civilian demand — per-capita baseline + skilled baskets —
 * floored); `anchorMult` (default 1) carries active anchor_shift events. See
 * docs/active/gameplay/economy.md (pricing reference).
 */
export function curveForGood(
  basePrice: number,
  floorMult: number,
  ceilingMult: number,
  demandRate: number,
  anchorMult: number = 1,
): MarketCurve {
  return {
    basePrice,
    targetStock: TARGET_COVER * demandRate * anchorMult,
    k: DEFAULT_ELASTICITY,
    floorMult,
    ceilingMult,
  };
}

/**
 * Convenience adapter: derive the price curve from a market row plus its good's
 * catalog entry — the curve counterpart to `marketBandForRow`, and the same
 * reason to exist (the five-argument call is never repeated).
 */
export function curveForRow(
  row: { demandRate: number; anchorMult?: number },
  good: { basePrice: number; priceFloor: number; priceCeiling: number },
): MarketCurve {
  return curveForGood(
    good.basePrice,
    good.priceFloor,
    good.priceCeiling,
    row.demandRate,
    row.anchorMult ?? 1,
  );
}
