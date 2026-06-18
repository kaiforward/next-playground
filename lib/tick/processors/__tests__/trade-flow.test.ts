import { describe, it, expect } from "vitest";
import { runTradeFlowProcessor } from "../trade-flow";
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
import type { TradeFlowProcessorParams } from "@/lib/tick/world/trade-flow-world";
import type { TickContext } from "@/lib/tick/types";
import type {
  SimConnection,
  SimMarketEntry,
  SimSystem,
} from "@/lib/engine/simulator/types";

const PARAMS: TradeFlowProcessorParams = {
  edgesPerTick: 100,
  flowBudget: 8,
  gradientThreshold: 0.05,
  gradientSensitivity: 1.0,
  flowHistoryTicks: 200,
  playerDisplacementFactor: 2.0,
  prosperityTargetVolume: 50,
  minLevel: 5,
  maxLevel: 200,
  distanceDecay: 0,
};

function sys(id: string, factionId: string | null, regionId = "r1"): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId, factionId,
    governmentType: "federation",
    aggregate: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    population: 1000, traits: [], bodyDanger: 0, prosperity: 0, tradeVolumeAccum: 0,
  };
}

function market(systemId: string, goodId: string, stock: number): SimMarketEntry {
  return {
    systemId, goodId, basePrice: 100, stock,
    anchorMult: 1, demandRate: 40, priceFloor: 10, priceCeiling: 500,
  };
}

function conn(a: string, b: string, fuelCost = 10): SimConnection {
  return { fromSystemId: a, toSystemId: b, fuelCost };
}

const ctx = (tick: number): TickContext => ({ tick }) as TickContext;

function makeWorld(opts: {
  systems: SimSystem[];
  markets: SimMarketEntry[];
  connections: SimConnection[];
  playerVolumeBySystem?: Map<string, number>;
}) {
  return new InMemoryTradeFlowWorld(
    { systems: opts.systems, markets: opts.markets, flowEvents: [] },
    opts.connections,
    opts.playerVolumeBySystem,
  );
}

describe("trade-flow: faction-bounded topology", () => {
  it("flows between same-faction systems across region lines", async () => {
    // a (region r1) and b (region r2) share faction f1 — must flow despite different regions.
    const systems = [sys("a", "f1", "r1"), sys("b", "f1", "r2")];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), PARAMS);

    const a = world.markets.find((m) => m.systemId === "a")!;
    const b = world.markets.find((m) => m.systemId === "b")!;
    expect(a.stock).toBeLessThan(150); // surplus drained
    expect(b.stock).toBeGreaterThan(20); // shortage fed
  });

  it("does NOT flow across a faction border", async () => {
    const systems = [sys("a", "f1"), sys("b", "f2")]; // different factions
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), PARAMS);

    expect(world.markets.find((m) => m.systemId === "a")!.stock).toBe(150);
    expect(world.markets.find((m) => m.systemId === "b")!.stock).toBe(20);
    expect(world.flowEvents.length).toBe(0);
  });

  it("flows between two adjacent independent systems (null === null)", async () => {
    const systems = [sys("a", null), sys("b", null)];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), PARAMS);

    expect(world.flowEvents.length).toBe(1);
  });

  it("does NOT flow between an independent and a faction system", async () => {
    const systems = [sys("a", null), sys("b", "f1")];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), PARAMS);

    expect(world.flowEvents.length).toBe(0);
  });
});

describe("trade-flow: work-budget slicing", () => {
  it("processes only edgesPerTick edges per tick, cycling over ticks", async () => {
    // 3 same-faction edges (a-b, c-d, e-f), edgesPerTick = 1 → one edge per tick.
    const systems = ["a", "b", "c", "d", "e", "f"].map((id) => sys(id, "f1"));
    const markets = [
      market("a", "food", 150), market("b", "food", 20),
      market("c", "food", 150), market("d", "food", 20),
      market("e", "food", 150), market("f", "food", 20),
    ];
    const connections = [conn("a", "b"), conn("c", "d"), conn("e", "f")];
    const world = makeWorld({ systems, markets, connections });
    const p = { ...PARAMS, edgesPerTick: 1 };

    // Edges are sorted by "a|b" key: a|b, c|d, e|f.
    await runTradeFlowProcessor(world, ctx(0), p); // start = 0 → edge a|b
    expect(world.flowEvents.map((e) => e.fromSystemId).sort()).toEqual(["a"]);

    await runTradeFlowProcessor(world, ctx(1), p); // start = 1 → edge c|d
    expect(world.flowEvents.some((e) => e.fromSystemId === "c")).toBe(true);
  });
});

describe("trade-flow: distance attenuation", () => {
  it("moves less over a costlier jump when distanceDecay > 0", async () => {
    const near = makeWorld({
      systems: [sys("a", "f1"), sys("b", "f1")],
      markets: [market("a", "food", 200), market("b", "food", 5)],
      connections: [conn("a", "b", 1)],
    });
    const far = makeWorld({
      systems: [sys("a", "f1"), sys("b", "f1")],
      markets: [market("a", "food", 200), market("b", "food", 5)],
      connections: [conn("a", "b", 100)],
    });
    const p = { ...PARAMS, distanceDecay: 0.1 };

    await runTradeFlowProcessor(near, ctx(0), p);
    await runTradeFlowProcessor(far, ctx(0), p);

    const nearQty = near.flowEvents[0]?.quantity ?? 0;
    const farQty = far.flowEvents[0]?.quantity ?? 0;
    expect(nearQty).toBeGreaterThan(farQty);
  });
});
