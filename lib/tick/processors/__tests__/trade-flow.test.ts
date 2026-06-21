import { describe, it, expect } from "vitest";
import { runTradeFlowProcessor } from "../trade-flow";
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
import type { TradeFlowProcessorParams } from "@/lib/tick/world/trade-flow-world";
import type { TickContext } from "@/lib/tick/types";
import type {
  SimConnection,
  SimFlowEvent,
  SimMarketEntry,
  SimSystem,
} from "@/lib/engine/simulator/types";
import { unitResourceVector } from "@/lib/engine/resources";

const PARAMS: TradeFlowProcessorParams = {
  edgesPerTick: 100,
  flowBudget: 8,
  gradientThreshold: 0.05,
  gradientSensitivity: 1.0,
  flowHistoryTicks: 200,
  playerDisplacementFactor: 2.0,
  playerVolumeTarget: 50,
  distanceDecay: 0,
};

function sys(id: string, factionId: string | null, regionId = "r1"): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId, factionId,
    governmentType: "federation",
    population: 1000, popCap: 2000, traits: [], bodyDanger: 0, unrest: 0, buildings: {},
    yields: unitResourceVector(),
  };
}

function market(systemId: string, goodId: string, stock: number): SimMarketEntry {
  return {
    systemId, goodId, basePrice: 100, stock,
    anchorMult: 1, demandRate: 40, priceFloor: 10, priceCeiling: 500, storageCapacity: 0,
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
  flowEvents?: SimFlowEvent[];
  playerVolumeBySystem?: Map<string, number>;
}) {
  return new InMemoryTradeFlowWorld(
    { systems: opts.systems, markets: opts.markets, flowEvents: opts.flowEvents ?? [] },
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
  it("processes exactly one edge per tick and wraps the cursor", async () => {
    // 3 same-faction edges sorted by key: a|b, c|d, e|f. edgesPerTick = 1.
    const systems = ["a", "b", "c", "d", "e", "f"].map((id) => sys(id, "f1"));
    const markets = [
      market("a", "food", 150), market("b", "food", 20),
      market("c", "food", 150), market("d", "food", 20),
      market("e", "food", 150), market("f", "food", 20),
    ];
    const connections = [conn("a", "b"), conn("c", "d"), conn("e", "f")];
    const world = makeWorld({ systems, markets, connections });
    const p = { ...PARAMS, edgesPerTick: 1 };

    // Each tick advances the cursor by one edge; assert the exact edge that flowed
    // this tick (filtering by tick isolates it from prior ticks' accumulated events).
    const flowedAt = async (tick: number) => {
      await runTradeFlowProcessor(world, ctx(tick), p);
      return world.flowEvents.filter((e) => e.tick === tick).map((e) => e.fromSystemId);
    };

    expect(await flowedAt(0)).toEqual(["a"]); // start 0 → edge a|b
    expect(await flowedAt(1)).toEqual(["c"]); // start 1 → edge c|d
    expect(await flowedAt(2)).toEqual(["e"]); // start 2 → edge e|f
    expect(await flowedAt(3)).toEqual(["a"]); // start (3 % 3) = 0 → wraps to a|b
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

describe("trade-flow: flow controls", () => {
  it("does NOT flow when the price gradient is below threshold", async () => {
    // Real gradient (150 vs 20), but threshold set above any achievable gradient
    // so the gradient guard suppresses flow.
    const systems = [sys("a", "f1"), sys("b", "f1")];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), { ...PARAMS, gradientThreshold: 1000 });

    expect(world.flowEvents.length).toBe(0);
    expect(world.markets.find((m) => m.systemId === "a")!.stock).toBe(150);
    expect(world.markets.find((m) => m.systemId === "b")!.stock).toBe(20);
  });

  it("caps flow quantity at the flow budget", async () => {
    // Extreme gradient + large headroom/capacity so flowBudget is the binding cap.
    const systems = [sys("a", "f1"), sys("b", "f1")];
    const markets = [market("a", "food", 200), market("b", "food", 5)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(0), { ...PARAMS, flowBudget: 6 });

    expect(world.flowEvents.length).toBe(1);
    expect(world.flowEvents[0].quantity).toBeGreaterThan(0);
    expect(world.flowEvents[0].quantity).toBeLessThanOrEqual(6);
  });

  it("throttles flow to zero under high player pressure", async () => {
    // edgeVolume = 200 + 200 = 400; pressure = 400 / 50 = 8;
    // displacement = clamp(8 * 2, 0, 1) = 1 → edgeBudget = flowBudget * 0 = 0 → no flow.
    const systems = [sys("a", "f1"), sys("b", "f1")];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const playerVolumeBySystem = new Map([
      ["a", 200],
      ["b", 200],
    ]);
    const world = makeWorld({
      systems,
      markets,
      connections: [conn("a", "b")],
      playerVolumeBySystem,
    });

    await runTradeFlowProcessor(world, ctx(0), PARAMS);

    expect(world.flowEvents.length).toBe(0);
    expect(world.markets.find((m) => m.systemId === "a")!.stock).toBe(150);
    expect(world.markets.find((m) => m.systemId === "b")!.stock).toBe(20);
  });

  it("prunes flow events older than the retention window", async () => {
    // Equal stock → no new flow, so only pruning acts on the seeded events.
    const systems = [sys("a", "f1"), sys("b", "f1")];
    const markets = [market("a", "food", 100), market("b", "food", 100)];
    const flowEvents: SimFlowEvent[] = [
      { tick: 5, fromSystemId: "a", toSystemId: "b", goodId: "food", quantity: 4 },
      { tick: 95, fromSystemId: "a", toSystemId: "b", goodId: "food", quantity: 3 },
    ];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")], flowEvents });

    // tick 200, flowHistoryTicks 100 → cutoff 100 → both seeded events pruned.
    await runTradeFlowProcessor(world, ctx(200), { ...PARAMS, flowHistoryTicks: 100 });

    expect(world.flowEvents.every((e) => e.tick >= 100)).toBe(true);
    expect(world.flowEvents.length).toBe(0);
  });
});
