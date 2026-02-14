/**
 * Random strategy: pick a random reachable system and random affordable good.
 */

import type { RNG } from "@/lib/engine/universe-gen";
import type { TradeStrategy, TradeDecision } from "./types";
import { getReachable, getMarkets, getCargoUsed, getPrice } from "./helpers";
import type { SimAdjacencyList } from "../pathfinding-cache";
import type { SimPlayer, SimShip, SimWorld } from "../types";

export function createRandomStrategy(rng: RNG): TradeStrategy {
  return {
    name: "random",
    evaluate(player: SimPlayer, ship: SimShip, world: SimWorld, adj?: SimAdjacencyList): TradeDecision | null {
      const reachable = getReachable(world, ship, adj);
      if (reachable.size === 0) return null;

      // Pick random target
      const targets = [...reachable.keys()];
      const targetSystemId = targets[Math.floor(rng() * targets.length)];

      // Pick random affordable good at current system
      const currentMarkets = getMarkets(world, ship.systemId);
      const availableCargo = ship.cargoMax - getCargoUsed(ship);
      if (availableCargo <= 0) return null;

      const affordable = currentMarkets.filter((m) => {
        const price = getPrice(m);
        return m.supply > 0 && price <= player.credits && price > 0;
      });

      if (affordable.length === 0) return null;

      const market = affordable[Math.floor(rng() * affordable.length)];
      const price = getPrice(market);
      const maxByCredits = Math.floor(player.credits / price);
      const quantity = Math.min(maxByCredits, market.supply, availableCargo);

      if (quantity <= 0) return null;

      return { buyGoodId: market.goodId, buyQuantity: quantity, targetSystemId };
    },
  };
}
