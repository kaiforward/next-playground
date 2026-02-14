/**
 * Greedy strategy: best profit-per-tick across all reachable systems.
 */

import type { TradeStrategy, TradeDecision } from "./types";
import { getReachable, findOpportunities } from "./helpers";
import type { SimPlayer, SimShip, SimWorld } from "../types";

export function createGreedyStrategy(): TradeStrategy {
  return {
    name: "greedy",
    evaluate(player: SimPlayer, ship: SimShip, world: SimWorld): TradeDecision | null {
      const reachable = getReachable(world, ship);
      if (reachable.size === 0) return null;

      const opportunities = findOpportunities(world, ship, reachable, player.credits);
      if (opportunities.length === 0) return null;

      // Best profit per tick (account for travel time)
      const best = opportunities.reduce((a, b) => {
        const aRate = a.profit / Math.max(1, a.travelDuration);
        const bRate = b.profit / Math.max(1, b.travelDuration);
        return bRate > aRate ? b : a;
      });

      return {
        buyGoodId: best.goodId,
        buyQuantity: best.buyQuantity,
        targetSystemId: best.targetSystemId,
      };
    },
  };
}
