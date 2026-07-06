/**
 * Shared helpers for bot strategies.
 */

import { spotPrice, curveForGood, marketBand } from "@/lib/engine/market-pricing";
import { findReachableSystems, type ReachableSystem } from "@/lib/engine/pathfinding";
import { findReachableSystemsCached } from "../pathfinding-cache";
import type { SimAdjacencyList } from "../pathfinding-cache";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import type { SimWorld, SimShip, SimMarketEntry } from "../types";

/** Get the current price for a market entry. */
export function getPrice(m: SimMarketEntry): number {
  return spotPrice(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock);
}

/** Get market entries for a specific system. */
export function getMarkets(world: SimWorld, systemId: string): SimMarketEntry[] {
  return world.markets.filter((m) => m.systemId === systemId);
}

/** Get the cargo used by a ship. */
export function getCargoUsed(ship: SimShip): number {
  return ship.cargo.reduce((sum, c) => sum + c.quantity, 0);
}

/** Get reachable systems for a ship at its current location. */
export function getReachable(
  world: SimWorld,
  ship: SimShip,
  adj?: SimAdjacencyList,
): Map<string, ReachableSystem> {
  if (adj) {
    return findReachableSystemsCached(ship.systemId, ship.fuel, adj, ship.speed);
  }
  const connections: ConnectionInfo[] = world.connections;
  return findReachableSystems(ship.systemId, ship.fuel, connections, ship.speed);
}

/** Estimate sell revenue for a good at a target system. */
export function estimateSellPrice(
  world: SimWorld,
  targetSystemId: string,
  goodId: string,
  quantity: number,
): number {
  const market = world.markets.find(
    (m) => m.systemId === targetSystemId && m.goodId === goodId,
  );
  if (!market) return 0;
  return getPrice(market) * quantity;
}

/** Estimate buy cost for a good at the current system. */
export function estimateBuyPrice(
  world: SimWorld,
  systemId: string,
  goodId: string,
  quantity: number,
): number {
  const market = world.markets.find(
    (m) => m.systemId === systemId && m.goodId === goodId,
  );
  if (!market) return Infinity;
  const band = marketBand({ demandRate: market.demandRate, storageCapacity: market.storageCapacity, priceFloor: market.priceFloor, priceCeiling: market.priceCeiling, anchorMult: market.anchorMult });
  if (market.stock - band.minStock < quantity) return Infinity;
  return getPrice(market) * quantity;
}

export interface ProfitOpportunity {
  goodId: string;
  buyQuantity: number;
  buyCost: number;
  sellRevenue: number;
  profit: number;
  targetSystemId: string;
  travelDuration: number;
  fuelCost: number;
}

/**
 * Find all profitable trade opportunities from a ship's current system
 * to a set of target systems.
 */
export function findOpportunities(
  world: SimWorld,
  ship: SimShip,
  reachable: Map<string, ReachableSystem>,
  maxCredits: number,
): ProfitOpportunity[] {
  const currentMarkets = getMarkets(world, ship.systemId);
  const availableCargo = ship.cargoMax - getCargoUsed(ship);
  const opportunities: ProfitOpportunity[] = [];

  for (const [targetId, target] of reachable) {
    for (const buyMarket of currentMarkets) {
      const buyBand = marketBand({ demandRate: buyMarket.demandRate, storageCapacity: buyMarket.storageCapacity, priceFloor: buyMarket.priceFloor, priceCeiling: buyMarket.priceCeiling, anchorMult: buyMarket.anchorMult });
      if (buyMarket.stock - buyBand.minStock <= 0) continue;

      const buyPrice = getPrice(buyMarket);
      const sellMarket = world.markets.find(
        (m) => m.systemId === targetId && m.goodId === buyMarket.goodId,
      );
      if (!sellMarket) continue;

      const sellPrice = getPrice(sellMarket);
      if (sellPrice <= buyPrice) continue;

      const maxByCredits = Math.floor(maxCredits / buyPrice);
      const maxBySupply = Math.floor(buyMarket.stock - buyBand.minStock);
      const quantity = Math.min(maxByCredits, maxBySupply, availableCargo);
      if (quantity <= 0) continue;

      const buyCost = buyPrice * quantity;
      const sellRevenue = sellPrice * quantity;
      const profit = sellRevenue - buyCost;

      opportunities.push({
        goodId: buyMarket.goodId,
        buyQuantity: quantity,
        buyCost,
        sellRevenue,
        profit,
        targetSystemId: targetId,
        travelDuration: target.travelDuration,
        fuelCost: target.fuelCost,
      });
    }
  }

  return opportunities;
}
