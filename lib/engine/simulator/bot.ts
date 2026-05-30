/**
 * Bot executor — runs one bot's decision loop for a single tick.
 * Handles: refuel → sell cargo → evaluate strategy → buy + navigate.
 */

import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { STOCK_MIN, STOCK_MAX } from "@/lib/constants/market-economy";

import { findShortestPathCached } from "./pathfinding-cache";
import type { TradeStrategy } from "./strategies/types";
import type { SimWorld, SimRunContext, TickMetrics, GoodTradeRecord } from "./types";
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

    const price = spotPrice(curveForGood(market.goodId, market.basePrice, market.priceFloor, market.priceCeiling, market.anchorMult), market.stock);
    const revenue = price * cargo.quantity;
    player = { ...player, credits: player.credits + revenue };

    // Selling adds stock at the destination.
    markets = markets.map((m) =>
      m === market
        ? { ...m, stock: Math.min(STOCK_MAX, m.stock + cargo.quantity) }
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
      const price = spotPrice(curveForGood(buyMarket.goodId, buyMarket.basePrice, buyMarket.priceFloor, buyMarket.priceCeiling, buyMarket.anchorMult), buyMarket.stock);
      const totalCost = price * decision.buyQuantity;

      if (totalCost <= player.credits && buyMarket.stock - STOCK_MIN >= decision.buyQuantity) {
        player = { ...player, credits: player.credits - totalCost };
        ship = {
          ...ship,
          cargo: [
            ...ship.cargo,
            { goodId: decision.buyGoodId, quantity: decision.buyQuantity },
          ],
        };

        // Buying removes stock at the source.
        markets = markets.map((m) =>
          m === buyMarket
            ? { ...m, stock: Math.max(STOCK_MIN, m.stock - decision.buyQuantity) }
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

  // Track trade volume on the system where the bot is docked
  const totalTraded = goodsTraded.reduce((sum, g) => sum + g.bought + g.sold, 0);
  const updatedSystems = totalTraded > 0
    ? world.systems.map((s) =>
        s.id === ship.systemId
          ? { ...s, tradeVolumeAccum: s.tradeVolumeAccum + totalTraded }
          : s,
      )
    : world.systems;

  // Build updated world
  const updatedWorld: SimWorld = {
    ...world,
    players: world.players.map((p) => (p.id === playerId ? player : p)),
    ships: world.ships.map((s) => (s.playerId === playerId ? ship : s)),
    markets,
    systems: updatedSystems,
  };

  return {
    world: updatedWorld,
    metrics: recordTickMetrics(player, world.tick, tradeCount, tradeProfitSum, fuelSpent, goodsTraded, ship.systemId, idle),
  };
}
