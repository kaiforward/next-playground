import { describe, it, expect } from "vitest";
import { runTradeFlowProcessor } from "../trade-flow";
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
import type { TradeFlowProcessorParams } from "@/lib/tick/world/trade-flow-world";
import type { TickContext } from "@/lib/tick/types";
import type {
  SimConnection,
  SimFlowEvent,
  SimMarketEntry,
  SimRegion,
  SimSystem,
} from "@/lib/engine/simulator/types";

function makeCtx(tick: number): TickContext {
  return { tx: undefined as never, tick, results: new Map() };
}

function makeParams(
  overrides: Partial<TradeFlowProcessorParams> = {},
): TradeFlowProcessorParams {
  return {
    processEveryNTicks: 1,
    flowBudget: 8,
    gradientThreshold: 0.05,
    gradientSensitivity: 1.0,
    flowHistoryTicks: 200,
    playerDisplacementFactor: 2.0,
    prosperityTargetVolume: 50,
    minLevel: 5,
    maxLevel: 200,
    ...overrides,
  };
}

const region: SimRegion = {
  id: "r1",
  name: "Test Region",
};

function makeSystem(id: string): SimSystem {
  return {
    id,
    name: id.toUpperCase(),
    economyType: "extraction",
    regionId: "r1",
    governmentType: "federation",
    produces: {},
    consumes: {},
    traits: [],
    prosperity: 0,
    tradeVolumeAccum: 0,
  };
}

/** A market priced purely off `stock` (higher stock → cheaper). */
function makeMarket(
  systemId: string,
  goodId: string,
  stock: number,
): SimMarketEntry {
  return {
    systemId,
    goodId,
    basePrice: 100,
    stock,
    anchorMult: 1,
    priceFloor: 0.2,
    priceCeiling: 5.0,
  };
}

function makeWorld(opts: {
  systems: SimSystem[];
  connections: SimConnection[];
  markets: SimMarketEntry[];
  flowEvents?: SimFlowEvent[];
  playerVolumeByRegion?: Map<string, number>;
}) {
  return new InMemoryTradeFlowWorld(
    {
      systems: opts.systems,
      markets: opts.markets,
      flowEvents: opts.flowEvents ?? [],
    },
    [region],
    opts.connections,
    opts.playerVolumeByRegion,
  );
}

describe("runTradeFlowProcessor", () => {
  it("moves goods from the high-stock (cheap) system to the low-stock (dear) neighbor", async () => {
    // A holds plenty of stock → low price. B is starved → high price.
    const systems = [makeSystem("a"), makeSystem("b")];
    const connections: SimConnection[] = [
      { fromSystemId: "a", toSystemId: "b", fuelCost: 10 },
      { fromSystemId: "b", toSystemId: "a", fuelCost: 10 },
    ];
    const markets = [
      makeMarket("a", "food", 150),
      makeMarket("b", "food", 20),
    ];
    const world = makeWorld({ systems, connections, markets });

    await runTradeFlowProcessor(world, makeCtx(0), makeParams());

    expect(world.flowEvents).toHaveLength(1);
    const flow = world.flowEvents[0];
    expect(flow.fromSystemId).toBe("a");
    expect(flow.toSystemId).toBe("b");
    expect(flow.goodId).toBe("food");
    expect(flow.quantity).toBeGreaterThan(0);

    const marketA = world.markets.find(
      (m) => m.systemId === "a" && m.goodId === "food",
    )!;
    const marketB = world.markets.find(
      (m) => m.systemId === "b" && m.goodId === "food",
    )!;
    // Cheaper (higher-stock) source loses stock; dearer (lower-stock) dest gains.
    expect(marketA.stock).toBe(150 - flow.quantity);
    expect(marketB.stock).toBe(20 + flow.quantity);

    // tradeVolumeAccum updated on both endpoints (mirrors player-trade bookkeeping).
    const sysA = world.systems.find((s) => s.id === "a")!;
    const sysB = world.systems.find((s) => s.id === "b")!;
    expect(sysA.tradeVolumeAccum).toBe(flow.quantity);
    expect(sysB.tradeVolumeAccum).toBe(flow.quantity);
  });

  it("does not flow when the price gradient is below threshold", async () => {
    const systems = [makeSystem("a"), makeSystem("b")];
    const connections: SimConnection[] = [
      { fromSystemId: "a", toSystemId: "b", fuelCost: 10 },
    ];
    // Nearly identical stock → sub-threshold gradient.
    const markets = [
      makeMarket("a", "food", 80),
      makeMarket("b", "food", 79),
    ];
    const world = makeWorld({ systems, connections, markets });

    await runTradeFlowProcessor(
      world,
      makeCtx(0),
      makeParams({ gradientThreshold: 0.5 }),
    );

    expect(world.flowEvents).toHaveLength(0);
    // Markets unchanged.
    const marketA = world.markets.find(
      (m) => m.systemId === "a" && m.goodId === "food",
    )!;
    expect(marketA.stock).toBe(80);
  });

  it("caps flow quantity at the flow budget regardless of gradient", async () => {
    const systems = [makeSystem("a"), makeSystem("b")];
    const connections: SimConnection[] = [
      { fromSystemId: "a", toSystemId: "b", fuelCost: 10 },
    ];
    // Maximum gradient — A drowning in stock, B starving.
    const markets = [
      makeMarket("a", "food", 200),
      makeMarket("b", "food", 5),
    ];
    const world = makeWorld({ systems, connections, markets });

    await runTradeFlowProcessor(
      world,
      makeCtx(0),
      makeParams({ flowBudget: 6 }),
    );

    expect(world.flowEvents).toHaveLength(1);
    expect(world.flowEvents[0].quantity).toBeLessThanOrEqual(6);
  });

  it("throttles flow to zero under high player pressure", async () => {
    const systems = [makeSystem("a"), makeSystem("b")];
    const connections: SimConnection[] = [
      { fromSystemId: "a", toSystemId: "b", fuelCost: 10 },
    ];
    const markets = [
      makeMarket("a", "food", 150),
      makeMarket("b", "food", 20),
    ];
    const playerVolumeByRegion = new Map([["r1", 200]]);
    const world = makeWorld({
      systems,
      connections,
      markets,
      playerVolumeByRegion,
    });

    // displacement = clamp(200/50 * 2.0, 0, 1) = 1.0 → no flow.
    await runTradeFlowProcessor(world, makeCtx(0), makeParams());

    expect(world.flowEvents).toHaveLength(0);
  });

  it("only processes ticks where (tick % processEveryNTicks === 0)", async () => {
    const systems = [makeSystem("a"), makeSystem("b")];
    const connections: SimConnection[] = [
      { fromSystemId: "a", toSystemId: "b", fuelCost: 10 },
    ];
    const markets = [
      makeMarket("a", "food", 150),
      makeMarket("b", "food", 20),
    ];
    const world = makeWorld({ systems, connections, markets });

    // tick=1 with processEvery=4 → skipped.
    await runTradeFlowProcessor(
      world,
      makeCtx(1),
      makeParams({ processEveryNTicks: 4 }),
    );
    expect(world.flowEvents).toHaveLength(0);

    // tick=4 → active.
    await runTradeFlowProcessor(
      world,
      makeCtx(4),
      makeParams({ processEveryNTicks: 4 }),
    );
    expect(world.flowEvents).toHaveLength(1);
  });

  it("prunes flow events older than the retention window", async () => {
    const systems = [makeSystem("a"), makeSystem("b")];
    const connections: SimConnection[] = [
      { fromSystemId: "a", toSystemId: "b", fuelCost: 10 },
    ];
    const markets = [makeMarket("a", "food", 80), makeMarket("b", "food", 80)];
    const oldEvents: SimFlowEvent[] = [
      { tick: 10, fromSystemId: "a", toSystemId: "b", goodId: "food", quantity: 4 },
      { tick: 95, fromSystemId: "a", toSystemId: "b", goodId: "food", quantity: 3 },
    ];
    const world = makeWorld({
      systems,
      connections,
      markets,
      flowEvents: oldEvents,
    });

    // ctx.tick=200, flowHistoryTicks=100 → cutoff=100 → tick=10 pruned, tick=95 pruned.
    await runTradeFlowProcessor(
      world,
      makeCtx(200),
      makeParams({ flowHistoryTicks: 100, gradientThreshold: 0.5 }),
    );

    expect(world.flowEvents.every((e) => e.tick >= 100)).toBe(true);
    expect(world.flowEvents.some((e) => e.tick === 10)).toBe(false);
  });

  it("skips inter-region edges (PR 1 processes intra-region only)", async () => {
    const otherRegion: SimRegion = {
      id: "r2",
      name: "Other Region",
    };
    const sysA = makeSystem("a"); // in r1
    const sysB: SimSystem = { ...makeSystem("b"), regionId: "r2" }; // in r2
    const connections: SimConnection[] = [
      { fromSystemId: "a", toSystemId: "b", fuelCost: 10 },
    ];
    const markets = [
      makeMarket("a", "food", 150),
      makeMarket("b", "food", 20),
    ];
    const world = new InMemoryTradeFlowWorld(
      { systems: [sysA, sysB], markets, flowEvents: [] },
      [region, otherRegion],
      connections,
    );

    await runTradeFlowProcessor(world, makeCtx(0), makeParams());

    // No intra-region edges in either region → no flow.
    expect(world.flowEvents).toHaveLength(0);
  });
});
