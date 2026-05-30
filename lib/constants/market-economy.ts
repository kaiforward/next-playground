/**
 * Constants for the stock-based market economy. See
 * docs/planned/stock-based-market-economy.md.
 */

import { ECONOMY_CONSTANTS, getConsumeEquilibrium } from "@/lib/constants/economy";
import { GOODS } from "@/lib/constants/goods";
import { getProducedGoods, getConsumedGoods } from "@/lib/constants/universe";
import type { GovernmentDefinition } from "@/lib/constants/government";
import type { EconomyType } from "@/lib/types/game";

/** Price-curve elasticity. k=1 reproduces the legacy demand/supply hyperbola. */
export const DEFAULT_ELASTICITY = 1;

/** Default bid-ask half-spread: buy = mid*(1+s), sell = mid*(1-s). */
export const DEFAULT_SPREAD = 0.05;

/** Global stock bounds — reuse the legacy supply floor/ceiling. */
export const STOCK_MIN = ECONOMY_CONSTANTS.MIN_LEVEL;
export const STOCK_MAX = ECONOMY_CONSTANTS.MAX_LEVEL;

/**
 * Calibrated pricing anchors (PR 3). The pricing anchor is the stock level where
 * mid price === basePrice. For most goods the legacy supply-band midpoint already
 * matches where the universe settles, but goods touched by every economy type
 * (no neutral markets to hold the average up) settle well below that midpoint —
 * so their anchor is pinned to the measured equilibrium instead. Measured via
 * the simulator; see scripts/balance-analysis.ts and docs/active/gameplay/economy.md.
 */
const CALIBRATED_TARGET_STOCK: Record<string, number> = {
  water: 116,
  food: 111,
  ore: 129,
  textiles: 124,
  chemicals: 73,
};

/**
 * Pricing anchor: the stock level where the mid price equals basePrice. Uses a
 * calibrated per-good value where one exists, falling back to the legacy
 * supply-band midpoint (which already matches equilibrium for the rest).
 */
export function getTargetStock(goodId: string): number {
  const calibrated = CALIBRATED_TARGET_STOCK[goodId];
  if (calibrated != null) return calibrated;
  const eq = GOODS[goodId]?.equilibrium;
  if (!eq) return Math.round((STOCK_MIN + STOCK_MAX) / 2);
  return Math.round((eq.produces + eq.consumes) / 2);
}

/**
 * Initial stock for a market at seed/reset time, by the system's relationship
 * to the good. Producers start above target (cheap), consumers below (expensive,
 * blended by self-sufficiency), neutrals at target (price == base).
 */
export function getInitialStock(economyType: EconomyType, goodId: string): number {
  const eq = GOODS[goodId]?.equilibrium;
  if (!eq) return getTargetStock(goodId);
  if (getProducedGoods(economyType).includes(goodId)) return eq.produces;
  if (getConsumedGoods(economyType).includes(goodId)) {
    return getConsumeEquilibrium(economyType, goodId, eq);
  }
  return getTargetStock(goodId);
}

/**
 * Bid-ask half-spread scaled by government margin policy. Repurposes the
 * government's `equilibriumSpreadPct` (frontier wide, authoritarian tight) to
 * scale the market spread now that the dual supply/demand band is gone.
 */
export function getSpread(govDef?: GovernmentDefinition): number {
  if (!govDef) return DEFAULT_SPREAD;
  return Math.max(0, DEFAULT_SPREAD * (1 + govDef.equilibriumSpreadPct / 100));
}
