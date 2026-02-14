/**
 * Greedy strategy: best profit-per-tick across all reachable systems.
 */

import type { TradeStrategy, TradeDecision } from "./types";
import { getReachable, findOpportunities, getRiskMultiplier } from "./helpers";
import type { SimAdjacencyList } from "../pathfinding-cache";
import type { SimPlayer, SimShip, SimWorld } from "../types";

export function createGreedyStrategy(): TradeStrategy {
  return {
    name: "greedy",
    evaluate(player: SimPlayer, ship: SimShip, world: SimWorld, adj?: SimAdjacencyList): TradeDecision | null {
      const reachable = getReachable(world, ship, adj);
      if (reachable.size === 0) return null;

      const raw = findOpportunities(world, ship, reachable, player.credits);
      if (raw.length === 0) return null;

      // Adjust profits for arrival risk (hazard, tax, contraband)
      const opportunities = raw
        .map((opp) => ({
          ...opp,
          profit: opp.profit * getRiskMultiplier(opp.goodId, opp.targetSystemId, world),
        }))
        .filter((opp) => opp.profit > 0);
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
