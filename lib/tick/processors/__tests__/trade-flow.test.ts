import { describe, it, expect } from "vitest";
import { runTradeFlowProcessor } from "../trade-flow";
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
import type { TradeFlowProcessorParams } from "@/lib/tick/world/trade-flow-world";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";
import type { TickContext } from "@/lib/tick/types";
import type {
  SimConnection,
  SimFlowEvent,
  SimMarketEntry,
  SimSystem,
} from "@/lib/engine/simulator/types";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";

const PARAMS: TradeFlowProcessorParams = {
  interval: REFERENCE_INTERVAL, // catch-up factor 1 → calibrated per-edge magnitudes
  flowBudget: 8,
  gradientThreshold: 0.05,
  gradientSensitivity: 1.0,
  flowHistoryTicks: 200,
  distanceDecay: 0,
};

// A single-edge world has its lone edge in the LAST shard group at the reference
// interval, so process it on that tick (catch-up = 1 → full per-edge amounts).
const EDGE_TICK = REFERENCE_INTERVAL - 1;

function sys(id: string, factionId: string | null, regionId = "r1"): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId, factionId,
    governmentType: "federation",
    population: 1000, popCap: 2000, traits: [], unrest: 0, buildings: {},
    yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
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
}) {
  return new InMemoryTradeFlowWorld(
    { systems: opts.systems, markets: opts.markets, flowEvents: opts.flowEvents ?? [] },
    opts.connections,
  );
}

describe("trade-flow: faction-bounded topology", () => {
  it("flows between same-faction systems across region lines", async () => {
    // a (region r1) and b (region r2) share faction f1 — must flow despite different regions.
    const systems = [sys("a", "f1", "r1"), sys("b", "f1", "r2")];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(EDGE_TICK), PARAMS);

    const a = world.markets.find((m) => m.systemId === "a")!;
    const b = world.markets.find((m) => m.systemId === "b")!;
    expect(a.stock).toBeLessThan(150); // surplus drained
    expect(b.stock).toBeGreaterThan(20); // shortage fed
  });

  it("does NOT flow across a faction border", async () => {
    const systems = [sys("a", "f1"), sys("b", "f2")]; // different factions
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(EDGE_TICK), PARAMS);

    expect(world.markets.find((m) => m.systemId === "a")!.stock).toBe(150);
    expect(world.markets.find((m) => m.systemId === "b")!.stock).toBe(20);
    expect(world.flowEvents.length).toBe(0);
  });

  it("flows between two adjacent independent systems (null === null)", async () => {
    const systems = [sys("a", null), sys("b", null)];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(EDGE_TICK), PARAMS);

    expect(world.flowEvents.length).toBe(1);
  });

  it("does NOT flow between an independent and a faction system", async () => {
    const systems = [sys("a", null), sys("b", "f1")];
    const markets = [market("a", "food", 150), market("b", "food", 20)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(EDGE_TICK), PARAMS);

    expect(world.flowEvents.length).toBe(0);
  });
});

describe("trade-flow: fixed-interval edge shard", () => {
  it("processes one edge per tick at interval = edge count, wrapping each interval", async () => {
    // 3 same-faction edges sorted by key: a|b, c|d, e|f. interval = 3 → one edge/tick.
    const systems = ["a", "b", "c", "d", "e", "f"].map((id) => sys(id, "f1"));
    const markets = [
      market("a", "food", 150), market("b", "food", 20),
      market("c", "food", 150), market("d", "food", 20),
      market("e", "food", 150), market("f", "food", 20),
    ];
    const connections = [conn("a", "b"), conn("c", "d"), conn("e", "f")];
    const world = makeWorld({ systems, markets, connections });
    const p = { ...PARAMS, interval: 3 };

    // Each tick processes its shard group; assert the exact edge that flowed this
    // tick (filtering by tick isolates it from prior ticks' accumulated events).
    const flowedAt = async (tick: number) => {
      await runTradeFlowProcessor(world, ctx(tick), p);
      return world.flowEvents.filter((e) => e.tick === tick).map((e) => e.fromSystemId);
    };

    expect(await flowedAt(0)).toEqual(["a"]); // group 0 → edge a|b
    expect(await flowedAt(1)).toEqual(["c"]); // group 1 → edge c|d
    expect(await flowedAt(2)).toEqual(["e"]); // group 2 → edge e|f
    expect(await flowedAt(3)).toEqual(["a"]); // tick 3 % 3 = 0 → wraps to a|b
  });

  it("scales the per-edge moved amount by catchUpFactor(interval)", async () => {
    // Generous headroom + capacity so flowBudget binds and the scaled move is not
    // clamped; compare interval = REFERENCE (catch-up 1) vs 2×REFERENCE (catch-up 2).
    const bigMarket = (systemId: string, stock: number): SimMarketEntry => ({
      systemId, goodId: "food", basePrice: 100, stock,
      anchorMult: 1, demandRate: 40, priceFloor: 10, priceCeiling: 500, storageCapacity: 5000,
    });
    const mkWorld = () => makeWorld({
      systems: [sys("a", "f1"), sys("b", "f1")],
      markets: [bigMarket("a", 2000), bigMarket("b", 20)],
      connections: [conn("a", "b")],
    });
    const P = { ...PARAMS, flowBudget: 200 };

    const w1 = mkWorld();
    await runTradeFlowProcessor(w1, ctx(REFERENCE_INTERVAL - 1), { ...P, interval: REFERENCE_INTERVAL });
    const q1 = w1.flowEvents[0].quantity;

    const w2 = mkWorld();
    await runTradeFlowProcessor(w2, ctx(2 * REFERENCE_INTERVAL - 1), { ...P, interval: 2 * REFERENCE_INTERVAL });
    const q2 = w2.flowEvents[0].quantity;

    expect(q1).toBeGreaterThan(0);
    expect(Math.abs(q2 - 2 * q1)).toBeLessThanOrEqual(2); // doubles, modulo floor
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

    await runTradeFlowProcessor(near, ctx(EDGE_TICK), p);
    await runTradeFlowProcessor(far, ctx(EDGE_TICK), p);

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

    await runTradeFlowProcessor(world, ctx(EDGE_TICK), { ...PARAMS, gradientThreshold: 1000 });

    expect(world.flowEvents.length).toBe(0);
    expect(world.markets.find((m) => m.systemId === "a")!.stock).toBe(150);
    expect(world.markets.find((m) => m.systemId === "b")!.stock).toBe(20);
  });

  it("caps flow quantity at the flow budget", async () => {
    // Extreme gradient + large headroom/capacity so flowBudget is the binding cap.
    const systems = [sys("a", "f1"), sys("b", "f1")];
    const markets = [market("a", "food", 200), market("b", "food", 5)];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")] });

    await runTradeFlowProcessor(world, ctx(EDGE_TICK), { ...PARAMS, flowBudget: 6 });

    expect(world.flowEvents.length).toBe(1);
    expect(world.flowEvents[0].quantity).toBeGreaterThan(0);
    expect(world.flowEvents[0].quantity).toBeLessThanOrEqual(6);
  });

  it("prunes flow events older than the retention window", async () => {
    // Equal stock → no new flow, so only pruning acts on the seeded events.
    const systems = [sys("a", "f1"), sys("b", "f1")];
    const markets = [market("a", "food", 100), market("b", "food", 100)];
    const flowEvents: SimFlowEvent[] = [
      { tick: 5, fromSystemId: "a", toSystemId: "b", goodId: "food", quantity: 4, flowType: "market" },
      { tick: 95, fromSystemId: "a", toSystemId: "b", goodId: "food", quantity: 3, flowType: "market" },
    ];
    const world = makeWorld({ systems, markets, connections: [conn("a", "b")], flowEvents });

    // tick 200, flowHistoryTicks 100 → cutoff 100 → both seeded events pruned.
    await runTradeFlowProcessor(world, ctx(200), { ...PARAMS, flowHistoryTicks: 100 });

    expect(world.flowEvents.every((e) => e.tick >= 100)).toBe(true);
    expect(world.flowEvents.length).toBe(0);
  });
});
