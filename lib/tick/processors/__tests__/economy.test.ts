/**
 * Economy processor unit tests (memory-adapter, DB-free).
 *
 * Covers two behaviors:
 *   1. Strike suppression: high unrest reduces post-tick stock for producers.
 *   2. Dissatisfaction signal: the returned `economySignals.dissatisfactionBySystem`
 *      reflects demand satisfaction from post-tick stock.
 */

import { describe, it, expect } from "vitest";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { DEFAULT_SIM_CONSTANTS } from "@/lib/engine/simulator/constants";
import { mulberry32 } from "@/lib/engine/universe-gen";
import { makeResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { TickContext } from "@/lib/tick/types";
import type { SimMarketEntry, SimRegion, SimSystem } from "@/lib/engine/simulator/types";

const MIN = DEFAULT_SIM_CONSTANTS.economy.minLevel;
const MAX = DEFAULT_SIM_CONSTANTS.economy.maxLevel;

const ECON_PARAMS = {
  simParams: {
    noiseAmplitude: 0, // deterministic — no noise
    minLevel: MIN,
    maxLevel: MAX,
  },
  modifierCaps: DEFAULT_SIM_CONSTANTS.events.modifierCaps,
  strikeParams: STRIKE_PARAMS,
};

const REGION: SimRegion = { id: "r1", name: "Test Region" };

function makeCtx(tick = 0): TickContext {
  return { tx: undefined as never, tick, results: new Map() };
}

/**
 * Producer system: arable-rich, low population. Produces food, minimal consumption.
 * Consumer system: arable-barren, large population. Consumes food, no production.
 */
function makeProducerSystem(id: string, unrest: number): SimSystem {
  return {
    id,
    name: id,
    economyType: "agricultural",
    regionId: "r1",
    factionId: "f1",
    governmentType: "federation",
    aggregate: makeResourceVector({ arable: 16 }),
    population: 50,
    popCap: 1000,
    traits: [],
    bodyDanger: 0,
    unrest,
    buildings: { food: 2 },
  };
}

function makeConsumerSystem(id: string, unrest: number): SimSystem {
  return {
    id,
    name: id,
    economyType: "tech",
    regionId: "r1",
    factionId: "f1",
    governmentType: "federation",
    aggregate: emptyResourceVector(),
    population: 1000,
    popCap: 2000,
    traits: [],
    bodyDanger: 0,
    unrest,
    buildings: {},
  };
}

function makeMarket(systemId: string, goodId: string, stock: number): SimMarketEntry {
  return {
    systemId,
    goodId,
    basePrice: 50,
    stock,
    anchorMult: 1,
    demandRate: 1,
    priceFloor: 0.2,
    priceCeiling: 5.0,
  };
}

// ── Strike suppression ────────────────────────────────────────────

describe("economy processor: strike suppression", () => {
  it("high unrest (≥ threshold) produces lower post-tick stock than unrest=0", async () => {
    const goodId = "food";
    const midStock = (MIN + MAX) / 2;

    // Run with unrest=0 (no strike).
    const calmSystem = makeProducerSystem("sys-calm", 0);
    const calmWorld = new InMemoryEconomyWorld(
      { systems: [calmSystem], markets: [makeMarket("sys-calm", goodId, midStock)], modifiers: [] },
      [REGION],
    );
    await runEconomyProcessor(calmWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const calmStock = calmWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Run with unrest well above the strike threshold (0.5).
    const strikeSystem = makeProducerSystem("sys-strike", 0.9);
    const strikeWorld = new InMemoryEconomyWorld(
      { systems: [strikeSystem], markets: [makeMarket("sys-strike", goodId, midStock)], modifiers: [] },
      [REGION],
    );
    await runEconomyProcessor(strikeWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const strikeStock = strikeWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Production is suppressed so the struck producer accumulates less stock.
    expect(strikeStock).toBeLessThan(calmStock);
  });

  it("unrest below threshold leaves production unchanged", async () => {
    const goodId = "food";
    const midStock = (MIN + MAX) / 2;

    const calmSystem = makeProducerSystem("sys-calm", 0);
    const calmWorld = new InMemoryEconomyWorld(
      { systems: [calmSystem], markets: [makeMarket("sys-calm", goodId, midStock)], modifiers: [] },
      [REGION],
    );
    await runEconomyProcessor(calmWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const calmStock = calmWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Unrest just below threshold — should behave like unrest=0.
    const belowSystem = makeProducerSystem("sys-below", STRIKE_PARAMS.threshold - 0.01);
    const belowWorld = new InMemoryEconomyWorld(
      { systems: [belowSystem], markets: [makeMarket("sys-below", goodId, midStock)], modifiers: [] },
      [REGION],
    );
    await runEconomyProcessor(belowWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const belowStock = belowWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // No suppression applied — both stocks should match.
    expect(belowStock).toBeCloseTo(calmStock, 5);
  });

  it("strike does NOT suppress consumption (consumers drain stock regardless)", async () => {
    const goodId = "food";
    const highStock = MAX - 10;

    // Consumer with unrest=0 vs unrest=0.9 — consumption should be identical.
    const calmConsumer = makeConsumerSystem("c-calm", 0);
    const calmConsWorld = new InMemoryEconomyWorld(
      { systems: [calmConsumer], markets: [makeMarket("c-calm", goodId, highStock)], modifiers: [] },
      [REGION],
    );
    await runEconomyProcessor(calmConsWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const calmConsStock = calmConsWorld.markets.find((m) => m.goodId === goodId)!.stock;

    const strikeConsumer = makeConsumerSystem("c-strike", 0.9);
    const strikeConsWorld = new InMemoryEconomyWorld(
      { systems: [strikeConsumer], markets: [makeMarket("c-strike", goodId, highStock)], modifiers: [] },
      [REGION],
    );
    await runEconomyProcessor(strikeConsWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const strikeConsStock = strikeConsWorld.markets.find((m) => m.goodId === goodId)!.stock;

    expect(strikeConsStock).toBeCloseTo(calmConsStock, 5);
  });
});

// ── Dissatisfaction signal ────────────────────────────────────────

describe("economy processor: dissatisfaction signal", () => {
  it("returns economySignals with dissatisfactionBySystem", async () => {
    const consumer = makeConsumerSystem("sys-c", 0);
    const world = new InMemoryEconomyWorld(
      { systems: [consumer], markets: [makeMarket("sys-c", "food", (MIN + MAX) / 2)], modifiers: [] },
      [REGION],
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    expect(result.economySignals).toBeDefined();
    expect(result.economySignals!.dissatisfactionBySystem).toBeInstanceOf(Map);
  });

  it("D > 0 for a starved consumer system (stock pinned near minLevel)", async () => {
    const consumer = makeConsumerSystem("sys-starved", 0);
    // Pin stock just above the floor so it's in the low-satisfaction zone.
    const world = new InMemoryEconomyWorld(
      { systems: [consumer], markets: [makeMarket("sys-starved", "food", MIN + 1)], modifiers: [] },
      [REGION],
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const d = result.economySignals!.dissatisfactionBySystem.get("sys-starved") ?? 0;
    expect(d).toBeGreaterThan(0);
  });

  it("D ≈ 0 for a well-fed consumer system (stock near maxLevel)", async () => {
    const consumer = makeConsumerSystem("sys-fed", 0);
    // Pin stock near the ceiling so satisfaction is very high.
    const world = new InMemoryEconomyWorld(
      { systems: [consumer], markets: [makeMarket("sys-fed", "food", MAX - 1)], modifiers: [] },
      [REGION],
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const d = result.economySignals!.dissatisfactionBySystem.get("sys-fed") ?? 1;
    expect(d).toBeLessThan(0.1);
  });

  it("starved system has higher D than well-fed system", async () => {
    const starved = makeConsumerSystem("sys-s", 0);
    const starvedWorld = new InMemoryEconomyWorld(
      { systems: [starved], markets: [makeMarket("sys-s", "food", MIN + 1)], modifiers: [] },
      [REGION],
    );
    const starvedResult = await runEconomyProcessor(starvedWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const dStarved = starvedResult.economySignals!.dissatisfactionBySystem.get("sys-s") ?? 0;

    const fed = makeConsumerSystem("sys-f", 0);
    const fedWorld = new InMemoryEconomyWorld(
      { systems: [fed], markets: [makeMarket("sys-f", "food", MAX - 1)], modifiers: [] },
      [REGION],
    );
    const fedResult = await runEconomyProcessor(fedWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const dFed = fedResult.economySignals!.dissatisfactionBySystem.get("sys-f") ?? 0;

    expect(dStarved).toBeGreaterThan(dFed);
  });

  it("producer system with stock near max has very low D", async () => {
    // Producers also consume at per-capita rates but with small population;
    // when stock is near the ceiling, satisfaction is near 1, so D ≈ 0.
    const producer = makeProducerSystem("sys-p", 0);
    const world = new InMemoryEconomyWorld(
      { systems: [producer], markets: [makeMarket("sys-p", "food", MAX - 1)], modifiers: [] },
      [REGION],
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const d = result.economySignals!.dissatisfactionBySystem.get("sys-p") ?? 1;
    expect(d).toBeLessThan(0.05);
  });
});
