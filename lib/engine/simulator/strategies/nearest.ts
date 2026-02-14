/**
 * Nearest strategy: best profit within 1-2 hops (travel ≤ 2 ticks).
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

      // Filter to systems within 2 ticks travel
      const nearby = new Map(
        [...reachable].filter(([, r]) => r.travelDuration <= 2),
      );

      if (nearby.size === 0) return null;

      const opportunities = findOpportunities(world, ship, nearby, player.credits);
      if (opportunities.length === 0) return null;

      // Pick highest raw profit
      const best = opportunities.reduce((a, b) => (b.profit > a.profit ? b : a));

      return {
        buyGoodId: best.goodId,
        buyQuantity: best.buyQuantity,
        targetSystemId: best.targetSystemId,
      };
    },
  };
}
