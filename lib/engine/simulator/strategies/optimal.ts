/**
 * Optimal strategy: 2-leg look-ahead.
 * Evaluates selling at a destination, then buying + selling on a second leg
 * to maximize total profit per total ticks.
 */

import type { TradeStrategy, TradeDecision } from "./types";
import {
  getReachable,
  findOpportunities,
  getMarkets,
  getPrice,
  getCargoUsed,
} from "./helpers";
import { findReachableSystems } from "@/lib/engine/pathfinding";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import type { SimPlayer, SimShip, SimWorld } from "../types";

export function createOptimalStrategy(): TradeStrategy {
  return {
    name: "optimal",
    evaluate(player: SimPlayer, ship: SimShip, world: SimWorld): TradeDecision | null {
      const reachable = getReachable(world, ship);
      if (reachable.size === 0) return null;

      const firstLeg = findOpportunities(world, ship, reachable, player.credits);
      if (firstLeg.length === 0) return null;

      let bestScore = -Infinity;
      let bestDecision: TradeDecision | null = null;

      for (const leg1 of firstLeg) {
        // Estimate credits after selling at leg1 target
        const creditsAfterLeg1 = player.credits - leg1.buyCost + leg1.sellRevenue;
        const fuelAfterLeg1 = ship.fuel - leg1.fuelCost;

        // Score leg1 alone
        const leg1Score = leg1.profit / Math.max(1, leg1.travelDuration);

        if (leg1Score > bestScore) {
          bestScore = leg1Score;
          bestDecision = {
            buyGoodId: leg1.goodId,
            buyQuantity: leg1.buyQuantity,
            targetSystemId: leg1.targetSystemId,
          };
        }

        // Look ahead: what trades are available from the destination?
        if (fuelAfterLeg1 > 0) {
          const connections: ConnectionInfo[] = world.connections;
          const leg2Reachable = findReachableSystems(
            leg1.targetSystemId,
            fuelAfterLeg1,
            connections,
          );

          if (leg2Reachable.size > 0) {
            // Simulate having full cargo capacity and credits from leg1
            const virtualShip: SimShip = {
              ...ship,
              systemId: leg1.targetSystemId,
              fuel: fuelAfterLeg1,
            };

            const leg2Ops = findOpportunities(
              world,
              virtualShip,
              leg2Reachable,
              creditsAfterLeg1,
            );

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
        }
      }

      return bestDecision;
    },
  };
}
