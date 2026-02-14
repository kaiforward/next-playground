/**
 * Optimal strategy: 2-leg look-ahead.
 * Evaluates selling at a destination, then buying + selling on a second leg
 * to maximize total profit per total ticks.
 */

import type { TradeStrategy, TradeDecision } from "./types";
import {
  getReachable,
  findOpportunities,
  getRiskMultiplier,
} from "./helpers";
import { findReachableSystemsCached } from "../pathfinding-cache";
import type { SimAdjacencyList } from "../pathfinding-cache";
import type { SimPlayer, SimShip, SimWorld } from "../types";

/** Only run the expensive leg2 expansion for the top N leg1 candidates. */
const LEG2_CANDIDATE_CAP = 10;

export function createOptimalStrategy(): TradeStrategy {
  return {
    name: "optimal",
    evaluate(player: SimPlayer, ship: SimShip, world: SimWorld, adj?: SimAdjacencyList): TradeDecision | null {
      const reachable = getReachable(world, ship, adj);
      if (reachable.size === 0) return null;

      const rawFirstLeg = findOpportunities(world, ship, reachable, player.credits);
      if (rawFirstLeg.length === 0) return null;

      // Adjust leg1 profits for arrival risk
      const firstLeg = rawFirstLeg
        .map((opp) => ({
          ...opp,
          profit: opp.profit * getRiskMultiplier(opp.goodId, opp.targetSystemId, world),
        }))
        .filter((opp) => opp.profit > 0);
      if (firstLeg.length === 0) return null;

      let bestScore = -Infinity;
      let bestDecision: TradeDecision | null = null;

      // Score all leg1 candidates on their own merit
      for (const leg1 of firstLeg) {
        const leg1Score = leg1.profit / Math.max(1, leg1.travelDuration);

        if (leg1Score > bestScore) {
          bestScore = leg1Score;
          bestDecision = {
            buyGoodId: leg1.goodId,
            buyQuantity: leg1.buyQuantity,
            targetSystemId: leg1.targetSystemId,
          };
        }
      }

      // Sort by profit/tick descending, only expand leg2 for top candidates
      const sorted = [...firstLeg].sort((a, b) => {
        const aRate = a.profit / Math.max(1, a.travelDuration);
        const bRate = b.profit / Math.max(1, b.travelDuration);
        return bRate - aRate;
      });
      const topCandidates = sorted.slice(0, LEG2_CANDIDATE_CAP);

      for (const leg1 of topCandidates) {
        const creditsAfterLeg1 = player.credits - leg1.buyCost + leg1.sellRevenue;
        const fuelAfterLeg1 = ship.fuel - leg1.fuelCost;

        if (fuelAfterLeg1 <= 0 || !adj) continue;

        const leg2Reachable = findReachableSystemsCached(
          leg1.targetSystemId,
          fuelAfterLeg1,
          adj,
        );

        if (leg2Reachable.size === 0) continue;

        const virtualShip: SimShip = {
          ...ship,
          systemId: leg1.targetSystemId,
          fuel: fuelAfterLeg1,
        };

        const rawLeg2Ops = findOpportunities(
          world,
          virtualShip,
          leg2Reachable,
          creditsAfterLeg1,
        );

        // Adjust leg2 profits for arrival risk
        const leg2Ops = rawLeg2Ops
          .map((opp) => ({
            ...opp,
            profit: opp.profit * getRiskMultiplier(opp.goodId, opp.targetSystemId, world),
          }))
          .filter((opp) => opp.profit > 0);

        for (const leg2 of leg2Ops) {
          const totalProfit = leg1.profit + leg2.profit;
          const totalTicks = leg1.travelDuration + leg2.travelDuration;
          const combinedScore = totalProfit / Math.max(1, totalTicks);

          if (combinedScore > bestScore) {
            bestScore = combinedScore;
            bestDecision = {
              buyGoodId: leg1.goodId,
              buyQuantity: leg1.buyQuantity,
              targetSystemId: leg1.targetSystemId,
            };
          }
        }
      }

      return bestDecision;
    },
  };
}
