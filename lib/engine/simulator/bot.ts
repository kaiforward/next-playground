/**
 * Bot executor — runs one bot's decision loop for a single tick.
 * Handles: refuel → sell cargo → evaluate strategy → buy + navigate.
 */

import { calculatePrice } from "@/lib/engine/pricing";
import { hopDuration } from "@/lib/engine/travel";
import { findShortestPathCached } from "./pathfinding-cache";
import type { TradeStrategy } from "./strategies/types";
import type { SimWorld, SimPlayer, SimShip, SimMarketEntry, SimRunContext, TickMetrics, GoodTradeRecord } from "./types";
import { recordTickMetrics } from "./metrics";

interface BotTickResult {
  world: SimWorld;
  metrics: TickMetrics;
}

/**
 * Execute one bot's turn: refuel, sell, evaluate, buy, navigate.
 * Mutates nothing — returns a new world + metrics.
 */
export function executeBotTick(
  playerId: string,
  world: SimWorld,
  strategy: TradeStrategy,
  ctx: SimRunContext,
): BotTickResult {
  const { constants, adjacencyList } = ctx;
  let player = world.players.find((p) => p.id === playerId)!;
  let ship = world.ships.find((s) => s.playerId === playerId)!;
  let markets = [...world.markets];

  let tradeCount = 0;
  let tradeProfitSum = 0;
  let fuelSpent = 0;
  const goodsTraded: GoodTradeRecord[] = [];

  // Skip if not docked
  if (ship.status !== "docked") {
    return {
      world,
      metrics: recordTickMetrics(player, world.tick, 0, 0, 0, [], null, false),
    };
  }

  // 1. Refuel if below threshold capacity
  if (ship.fuel < ship.maxFuel * constants.bots.refuelThreshold) {
    const needed = ship.maxFuel - ship.fuel;
    const cost = needed * constants.fuel.refuelCostPerUnit;
    if (cost <= player.credits) {
      player = { ...player, credits: player.credits - cost };
      ship = { ...ship, fuel: ship.maxFuel };
    }
  }

  // 2. Sell all cargo at current system
  for (const cargo of ship.cargo) {
    const market = markets.find(
      (m) => m.systemId === ship.systemId && m.goodId === cargo.goodId,
    );
    if (!market) continue;

    const price = calculatePrice(market.basePrice, market.supply, market.demand, market.priceFloor, market.priceCeiling);
    const revenue = price * cargo.quantity;
    player = { ...player, credits: player.credits + revenue };

    // Apply market impact: selling adds supply, reduces demand
    const demandDelta = -Math.round(cargo.quantity * constants.bots.tradeImpactFactor);
    markets = markets.map((m) =>
      m === market
        ? {
            ...m,
            supply: m.supply + cargo.quantity,
            demand: Math.max(5, m.demand + demandDelta),
          }
        : m,
    );

    tradeCount++;
    tradeProfitSum += revenue; // Revenue counts as profit for sell leg
    goodsTraded.push({
      goodId: cargo.goodId,
      bought: 0,
      sold: cargo.quantity,
      buyCost: 0,
      sellRevenue: revenue,
      sellGovernmentType: ctx.systemToGov.get(ship.systemId),
    });
  }

  // Clear cargo after selling
  ship = { ...ship, cargo: [] };

  // 3. Evaluate strategy
  const worldForEval: SimWorld = {
    ...world,
    players: world.players.map((p) => (p.id === playerId ? player : p)),
    ships: world.ships.map((s) => (s.playerId === playerId ? ship : s)),
    markets,
  };

  const decision = strategy.evaluate(player, ship, worldForEval, adjacencyList);
  const idle = decision === null;

  if (decision) {
    // 4. Buy goods
    const buyMarket = markets.find(
      (m) => m.systemId === ship.systemId && m.goodId === decision.buyGoodId,
    );

    if (buyMarket) {
      const price = calculatePrice(buyMarket.basePrice, buyMarket.supply, buyMarket.demand, buyMarket.priceFloor, buyMarket.priceCeiling);
      const totalCost = price * decision.buyQuantity;

      if (totalCost <= player.credits && buyMarket.supply >= decision.buyQuantity) {
        player = { ...player, credits: player.credits - totalCost };
        ship = {
          ...ship,
          cargo: [
            ...ship.cargo,
            { goodId: decision.buyGoodId, quantity: decision.buyQuantity },
          ],
        };

        // Apply market impact: buying removes supply, adds demand
        const demandDelta = Math.round(decision.buyQuantity * constants.bots.tradeImpactFactor);
        markets = markets.map((m) =>
          m === buyMarket
            ? {
                ...m,
                supply: m.supply - decision.buyQuantity,
                demand: m.demand + demandDelta,
              }
            : m,
        );

        tradeCount++;
        tradeProfitSum -= totalCost; // Subtract buy cost
        goodsTraded.push({
          goodId: decision.buyGoodId,
          bought: decision.buyQuantity,
          sold: 0,
          buyCost: totalCost,
          sellRevenue: 0,
        });
      }
    }

    // 5. Navigate to target (using ship speed for travel duration)
    const path = findShortestPathCached(ship.systemId, decision.targetSystemId, adjacencyList, ship.speed);

    if (path && path.totalFuelCost <= ship.fuel) {
      fuelSpent = path.totalFuelCost;
      ship = {
        ...ship,
        fuel: ship.fuel - path.totalFuelCost,
        status: "in_transit",
        destinationSystemId: decision.targetSystemId,
        arrivalTick: world.tick + path.totalTravelDuration,
      };
    }
  }

  // Build updated world
  const updatedWorld: SimWorld = {
    ...world,
    players: world.players.map((p) => (p.id === playerId ? player : p)),
    ships: world.ships.map((s) => (s.playerId === playerId ? ship : s)),
    markets,
  };

  return {
    world: updatedWorld,
    metrics: recordTickMetrics(player, world.tick, tradeCount, tradeProfitSum, fuelSpent, goodsTraded, ship.systemId, idle),
  };
}
