/**
 * Bot strategy interface.
 * Strategies evaluate the world and decide what to buy and where to go.
 */

import type { SimWorld, SimPlayer, SimShip } from "../types";

export interface TradeDecision {
  /** Good to buy at current system. */
  buyGoodId: string;
  /** Quantity to buy. */
  buyQuantity: number;
  /** System to travel to for selling. */
  targetSystemId: string;
}

export interface TradeStrategy {
  name: string;
  /** Evaluate the world and return a trade decision, or null if no good trade found. */
  evaluate(player: SimPlayer, ship: SimShip, world: SimWorld): TradeDecision | null;
}
