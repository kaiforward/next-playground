export const PRICE_RAMP_STOPS = {
  deepBargain: "#3ec775",
  bargain: "#7dd97f",
  neutral: "#d9c95d",
  premium: "#dc7b4a",
  deepPremium: "#c84545",
} as const;

export type PriceRampColor = (typeof PRICE_RAMP_STOPS)[keyof typeof PRICE_RAMP_STOPS];

/**
 * Map (currentPrice / basePrice) to a discrete color stop.
 * Returns null when basePrice is non-positive.
 */
export function priceRampColor(
  currentPrice: number,
  basePrice: number,
): PriceRampColor | null {
  if (basePrice <= 0) return null;
  const ratio = currentPrice / basePrice;
  if (ratio <= 0.6) return PRICE_RAMP_STOPS.deepBargain;
  if (ratio <= 0.85) return PRICE_RAMP_STOPS.bargain;
  if (ratio < 1.15) return PRICE_RAMP_STOPS.neutral;
  if (ratio < 1.4) return PRICE_RAMP_STOPS.premium;
  return PRICE_RAMP_STOPS.deepPremium;
}

/**
 * Hex string (#rrggbb) to a numeric color for Pixi tinting.
 */
export function priceRampColorPixi(currentPrice: number, basePrice: number): number | null {
  const color = priceRampColor(currentPrice, basePrice);
  if (!color) return null;
  return parseInt(color.slice(1), 16);
}
