/**
 * Nearest strategy: profit-per-tick with strong proximity preference.
 * Searches all reachable systems but applies a quadratic distance penalty,
 * making it a "quick turnover, stay local" strategy.
 * No risk adjustment — simpler and more conservative than greedy.
 */

import type { TradeStrategy, TradeDecision } from "./types";
import { getReachable, findOpportunities } from "./helpers";
import type { SimAdjacencyList } from "../pathfinding-cache";
import type { SimPlayer, SimShip, SimWorld } from "../types";

export function createNearestStrategy(): TradeStrategy {
  return {
    name: "nearest",
    evaluate(player: SimPlayer, ship: SimShip, world: SimWorld, adj?: SimAdjacencyList): TradeDecision | null {
      const reachable = getReachable(world, ship, adj);
      if (reachable.size === 0) return null;

      const opportunities = findOpportunities(world, ship, reachable, player.credits);
      if (opportunities.length === 0) return null;

      // Quadratic distance penalty: strongly prefers nearby systems
      // 1 tick = /4, 2 ticks = /9, 3 ticks = /16 — fast decay
      const best = opportunities.reduce((a, b) => {
        const aScore = a.profit / ((1 + a.travelDuration) ** 2);
        const bScore = b.profit / ((1 + b.travelDuration) ** 2);
        return bScore > aScore ? b : a;
      });

      return {
        buyGoodId: best.goodId,
        buyQuantity: best.buyQuantity,
        targetSystemId: best.targetSystemId,
      };
    },
  };
}
