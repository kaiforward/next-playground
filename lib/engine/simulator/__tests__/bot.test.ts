/**
 * Bot executor — per-market band integration.
 *
 * Verifies that bot buys respect each market's own per-band scarcity reserve
 * and each sell respects its own per-band storage ceiling, not the old global
 * STOCK_MIN / STOCK_MAX constants.
 */

import { describe, it, expect } from "vitest";
import { executeBotTick } from "@/lib/engine/simulator/bot";
import { marketBand } from "@/lib/engine/market-pricing";
import { resolveConstants } from "@/lib/engine/simulator/constants";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { SimWorld, SimMarketEntry, SimPlayer, SimShip, SimRunContext } from "@/lib/engine/simulator/types";
import type { TradeStrategy } from "@/lib/engine/simulator/strategies/types";

const constants = resolveConstants();

function makeCtx(overrides?: Partial<SimRunContext>): SimRunContext {
  return {
    constants,
    disableRandomEvents: true,
    eventInjections: [],
    adjacencyList: new Map(),
    systemToGov: new Map(),
    ...overrides,
  };
}

function makeMarket(
  systemId: string,
  goodId: string,
  stock: number,
  demandRate: number,
  storageCapacity: number,
  priceFloor = 0.2,
  priceCeiling = 5.0,
): SimMarketEntry {
  return {
    systemId,
    goodId,
    basePrice: 100,
    stock,
    anchorMult: 1,
    demandRate,
    priceFloor,
    priceCeiling,
    storageCapacity,
  };
}

function makePlayer(id: string, credits: number): SimPlayer {
  return { id, name: id, credits, strategy: "greedy" };
}

function makeShip(playerId: string, systemId: string, cargoMax = 50): SimShip {
  return {
    id: `ship-${playerId}`,
    playerId,
    shipType: "shuttle",
    fuel: 100,
    maxFuel: 100,
    cargo: [],
    cargoMax,
    speed: 5,
    hullMax: 40,
    hullCurrent: 40,
    shieldMax: 10,
    firepower: 2,
    evasion: 6,
    stealth: 3,
    disabled: false,
    status: "docked",
    systemId,
    destinationSystemId: null,
    arrivalTick: null,
  };
}

function baseWorld(
  players: SimPlayer[],
  ships: SimShip[],
  markets: SimMarketEntry[],
): SimWorld {
  return {
    tick: 0,
    regions: [{ id: "r1", name: "Test" }],
    systems: [{ id: "sys-a", name: "A", economyType: "extraction", regionId: "r1", factionId: "f1", governmentType: "federation", population: 100, popCap: 200, traits: [], unrest: 0, buildings: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0 }],
    connections: [],
    markets,
    events: [],
    modifiers: [],
    ships,
    players,
    flowEvents: [],
    nextId: 0,
  };
}

/** A no-op "strategy" that tries to buy `qty` of `goodId` at the current system. */
const buyStrategy = (qty: number, goodId: string): TradeStrategy => ({
  name: "test-buy",
  evaluate: () => ({
    buyGoodId: goodId,
    buyQuantity: qty,
    targetSystemId: "sys-a", // stay put
  }),
});

const noopStrategy: TradeStrategy = {
  name: "test-noop",
  evaluate: () => null,
};

describe("bot: per-market band caps", () => {
  it("sell is clamped to each market's own maxStock ceiling, not STOCK_MAX", () => {
    // A thin market with low demandRate and no infrastructure:
    //   targetStock = 40 × 0.05 = 2, maxStock = 2 / 0.2 = 10
    // A deep market with higher demandRate and infrastructure:
    //   targetStock = 40 × 5 = 200, maxStock = 200 / 0.2 + 100 = 1100
    // Both start near their ceilings minus cargo size. Selling 20 units into the
    // thin market must not exceed its maxStock=10, while into the deep market it
    // may freely add 20.
    const thinBand = marketBand({ demandRate: 0.05, storageCapacity: 0, priceFloor: 0.2, priceCeiling: 5.0 });
    const deepBand = marketBand({ demandRate: 5, storageCapacity: 100, priceFloor: 0.2, priceCeiling: 5.0 });

    // Thin: start 2 below ceiling (only 2 headroom → sell is capped).
    // Deep: start 100 below ceiling (100 headroom → full 20 units absorbed).
    const thinMarket = makeMarket("sys-a", "food", thinBand.maxStock - 2, 0.05, 0);
    const deepMarket = makeMarket("sys-a", "water", deepBand.maxStock - 100, 5, 100);

    const cargoToSell: SimShip["cargo"] = [
      { goodId: "food", quantity: 20 },
      { goodId: "water", quantity: 20 },
    ];
    const player = makePlayer("p1", 10000);
    const ship: SimShip = { ...makeShip("p1", "sys-a"), cargo: cargoToSell };
    const world = baseWorld([player], [ship], [thinMarket, deepMarket]);

    // Use a strategy that produces no buy decision so the test only observes sell.
    const { world: result } = executeBotTick("p1", world, noopStrategy, makeCtx());

    const thinAfter = result.markets.find((m) => m.goodId === "food")!.stock;
    const deepAfter = result.markets.find((m) => m.goodId === "water")!.stock;

    // Thin market: selling 20 onto (maxStock-2=8) — capped at maxStock=10, not STOCK_MAX=200.
    expect(thinAfter).toBeLessThanOrEqual(thinBand.maxStock);
    expect(thinAfter).toBeGreaterThan(thinBand.maxStock - 2); // some stock was added

    // Deep market: 20 units fit within the 100-unit headroom — full quantity absorbed.
    expect(deepAfter).toBeCloseTo(deepBand.maxStock - 100 + 20, 2);
    expect(deepAfter).toBeLessThanOrEqual(deepBand.maxStock);
  });

  it("buy gate respects each market's own minStock reserve, not global STOCK_MIN", () => {
    // A low-demand market: minStock = targetStock / priceCeiling = (40×0.1)/5 = 0.8
    // A high-demand market: minStock = (40×3)/5 = 24
    // Both start 10 units above their minStock.
    const lowDemandBand = marketBand({ demandRate: 0.1, storageCapacity: 0, priceFloor: 0.2, priceCeiling: 5.0 });
    const highDemandBand = marketBand({ demandRate: 3, storageCapacity: 0, priceFloor: 0.2, priceCeiling: 5.0 });

    // Stock = minStock + 10 for both markets.
    const lowMarket = makeMarket("sys-a", "food", lowDemandBand.minStock + 10, 0.1, 0);
    const highMarket = makeMarket("sys-a", "water", highDemandBand.minStock + 10, 3, 0);

    // Attempt to buy 10 units: low-demand market has 10 drawable → succeeds.
    // high-demand market also has 10 drawable → succeeds.
    // Attempt to buy 11 units: neither market has 11 drawable (both have exactly 10).
    const tryBuy = (qty: number, goodId: string, market: SimMarketEntry) => {
      const player = makePlayer("p2", 100_000);
      const ship = makeShip("p2", "sys-a");
      const world = baseWorld([player], [ship], [market]);
      const strategy = buyStrategy(qty, goodId);
      const { world: result } = executeBotTick("p2", world, strategy, makeCtx());
      return result.markets.find((m) => m.goodId === goodId)!.stock;
    };

    // Buy 10 from the low-demand market: stock decreases by 10.
    const lowAfter10 = tryBuy(10, "food", { ...lowMarket });
    expect(lowAfter10).toBeCloseTo(lowDemandBand.minStock, 2);

    // Buy 10 from the high-demand market: stock decreases by 10.
    const highAfter10 = tryBuy(10, "water", { ...highMarket });
    expect(highAfter10).toBeCloseTo(highDemandBand.minStock, 2);

    // Buy 11 from either: gate prevents the trade (not enough drawable).
    const lowAfter11 = tryBuy(11, "food", { ...lowMarket });
    expect(lowAfter11).toBeCloseTo(lowMarket.stock, 2); // unchanged

    const highAfter11 = tryBuy(11, "water", { ...highMarket });
    expect(highAfter11).toBeCloseTo(highMarket.stock, 2); // unchanged
  });

  it("deep market (more storageCapacity) is more liquid: larger sell allowed before hitting ceiling", () => {
    // Two markets with the same demandRate, one with storageCapacity=0, one with 200.
    // deep.maxStock ≫ thin.maxStock.
    const thinBand = marketBand({ demandRate: 1, storageCapacity: 0, priceFloor: 0.2, priceCeiling: 5.0 });
    const deepBand = marketBand({ demandRate: 1, storageCapacity: 200, priceFloor: 0.2, priceCeiling: 5.0 });

    // Both start at targetStock (priced at base). Sell 180 units into each.
    // thinBand.maxStock = 40/0.2 = 200; thin headroom = 200-40 = 160 < 180 → capped.
    // deepBand.maxStock = 40/0.2+200 = 400; deep headroom = 400-40 = 360 > 180 → not capped.
    const sellQty = 180;
    const thinMarket = makeMarket("sys-a", "food", thinBand.targetStock, 1, 0);
    const deepMarket = makeMarket("sys-a", "food", deepBand.targetStock, 1, 200);

    const doSell = (market: SimMarketEntry) => {
      const player = makePlayer("p3", 0);
      const ship: SimShip = { ...makeShip("p3", "sys-a"), cargo: [{ goodId: "food", quantity: sellQty }] };
      const world = baseWorld([player], [ship], [market]);
      const { world: result } = executeBotTick("p3", world, noopStrategy, makeCtx());
      return result.markets.find((m) => m.goodId === "food")!.stock;
    };

    const thinAfter = doSell(thinMarket);
    const deepAfter = doSell(deepMarket);

    // Deep market absorbs more stock: its ceiling is higher by 200.
    expect(deepBand.maxStock).toBeGreaterThan(thinBand.maxStock);
    expect(deepAfter).toBeGreaterThan(thinAfter);

    // Thin market must be capped at its band ceiling, not the global STOCK_MAX.
    expect(thinAfter).toBeLessThanOrEqual(thinBand.maxStock);
    expect(deepAfter).toBeLessThanOrEqual(deepBand.maxStock);
  });
});
