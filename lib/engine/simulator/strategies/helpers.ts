/**
 * Shared helpers for bot strategies.
 */

import { calculatePrice } from "@/lib/engine/pricing";
import { findReachableSystems, type ReachableSystem } from "@/lib/engine/pathfinding";
import { findReachableSystemsCached } from "../pathfinding-cache";
import type { SimAdjacencyList } from "../pathfinding-cache";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { HAZARD_CONSTANTS, LEGALITY_CONSTANTS } from "@/lib/engine/danger";
import { GOODS } from "@/lib/constants/goods";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import type { SimWorld, SimShip, SimMarketEntry } from "../types";

/** Get the current price for a market entry. */
export function getPrice(m: SimMarketEntry): number {
  return calculatePrice(m.basePrice, m.supply, m.demand, m.priceFloor, m.priceCeiling);
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
    return findReachableSystemsCached(ship.systemId, ship.fuel, adj);
  }
  const connections: ConnectionInfo[] = world.connections;
  return findReachableSystems(ship.systemId, ship.fuel, connections);
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
  return calculatePrice(market.basePrice, market.supply, market.demand, market.priceFloor, market.priceCeiling) * quantity;
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
  if (market.supply < quantity) return Infinity;
  return calculatePrice(market.basePrice, market.supply, market.demand, market.priceFloor, market.priceCeiling) * quantity;
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
      if (buyMarket.supply <= 0) continue;

      const buyPrice = getPrice(buyMarket);
      const sellMarket = world.markets.find(
        (m) => m.systemId === targetId && m.goodId === buyMarket.goodId,
      );
      if (!sellMarket) continue;

      const sellPrice = getPrice(sellMarket);
      if (sellPrice <= buyPrice) continue;

      const maxByCredits = Math.floor(maxCredits / buyPrice);
      const maxBySupply = buyMarket.supply;
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

/**
 * Estimate survival fraction for a good arriving at a target system.
 * Returns 0–1 where 1 = no expected losses, 0 = total expected loss.
 *
 * survival = (1 - hazardExpectedLoss) × (1 - taxRate) × (1 - contrabandExpectedLoss)
 */
export function getRiskMultiplier(
  goodId: string,
  targetSystemId: string,
  world: SimWorld,
  dangerLevel?: number,
): number {
  const goodDef = GOODS[goodId];
  const targetSystem = world.systems.find((s) => s.id === targetSystemId);
  const targetRegion = targetSystem
    ? world.regions.find((r) => r.id === targetSystem.regionId)
    : undefined;
  const govDef = targetRegion
    ? GOVERNMENT_TYPES[targetRegion.governmentType]
    : undefined;

  const danger = dangerLevel ?? 0;

  // Hazard expected loss
  let hazardExpectedLoss = 0;
  if (goodDef && goodDef.hazard !== "none") {
    const baseChance = goodDef.hazard === "high"
      ? HAZARD_CONSTANTS.HIGH_BASE_CHANCE
      : HAZARD_CONSTANTS.LOW_BASE_CHANCE;
    const effectiveChance = baseChance + danger * HAZARD_CONSTANTS.DANGER_SCALING;
    const minLoss = goodDef.hazard === "high"
      ? HAZARD_CONSTANTS.HIGH_MIN_LOSS
      : HAZARD_CONSTANTS.LOW_MIN_LOSS;
    const maxLoss = goodDef.hazard === "high"
      ? HAZARD_CONSTANTS.HIGH_MAX_LOSS
      : HAZARD_CONSTANTS.LOW_MAX_LOSS;
    const avgLoss = (minLoss + maxLoss) / 2;
    hazardExpectedLoss = effectiveChance * avgLoss;
  }

  // Tax rate at destination
  let taxRate = 0;
  if (govDef && govDef.taxRate > 0 && govDef.taxed.includes(goodId)) {
    taxRate = govDef.taxRate;
  }

  // Contraband expected loss (full confiscation × catch probability)
  let contrabandExpectedLoss = 0;
  if (govDef && govDef.inspectionModifier > 0 && govDef.contraband.includes(goodId)) {
    contrabandExpectedLoss = LEGALITY_CONSTANTS.BASE_INSPECTION_CHANCE * govDef.inspectionModifier;
  }

  return (1 - hazardExpectedLoss) * (1 - taxRate) * (1 - contrabandExpectedLoss);
}
