import { describe, it, expect } from "vitest";
import { runGoodsArrivalsProcessor } from "../goods-arrivals";
import { InMemoryGoodsArrivalsWorld } from "@/lib/tick/adapters/memory/goods-arrivals";
import type { WorldMarket, WorldPendingArrival } from "@/lib/world/types";
import type { TickContext } from "@/lib/tick/types";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";

const MAX_LATENCY_TICKS = DIRECTED_LOGISTICS.SUPPLIER_MAX_LATENCY_CYCLES * CYCLE_LENGTH;

const ctx = (tick: number): TickContext => ({ tick, results: new Map() });

let nextId = 0;
function mintId(): string {
  return `arrival-${nextId++}`;
}

function market(over: Partial<WorldMarket> & { systemId: string; goodId: string }): WorldMarket {
  return {
    stock: 0,
    anchorMult: 1,
    demandRate: 100,
    storageCapacity: 0,
    ...over,
  };
}

function pending(
  over: Partial<WorldPendingArrival> & { id: string },
): WorldPendingArrival {
  return {
    factionId: "faction-1",
    fromSystemId: "donor",
    toSystemId: "sink",
    goodId: "water",
    quantity: 10,
    dispatchTick: 0,
    arrivalTick: 10,
    routeEdges: ["donor|sink"],
    leg: "outbound",
    ...over,
  };
}

describe("runGoodsArrivalsProcessor", () => {
  it("credits a row due this tick and removes it from the ledger", async () => {
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [market({ systemId: "sink", goodId: "water", stock: 0 })],
      pendingArrivals: [pending({ id: "row-1", quantity: 10, arrivalTick: 10 })],
    });

    const result = await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    expect(world.pendingArrivals).toEqual([]);
    expect(world.markets.find((m) => m.systemId === "sink")!.stock).toBe(10);
    expect(result.goodsArrivals.credited).toBe(10);
    expect(result.goodsArrivals.returned).toBe(0);
  });

  it("leaves a row due next tick untouched in the ledger", async () => {
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [market({ systemId: "sink", goodId: "water", stock: 0 })],
      pendingArrivals: [pending({ id: "row-1", quantity: 10, arrivalTick: 11 })],
    });

    const result = await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    expect(world.pendingArrivals).toEqual([pending({ id: "row-1", quantity: 10, arrivalTick: 11 })]);
    expect(world.markets.find((m) => m.systemId === "sink")!.stock).toBe(0);
    expect(result.goodsArrivals.credited).toBe(0);
  });

  it("stops crediting at the band cap and returns the excess as one return row toward the donor with the edges reversed", async () => {
    // demandRate 1, priceFloor 0.5, priceCeiling 2, storageCapacity 0 -> a small, known maxStock.
    const good = { priceFloor: 0.5, priceCeiling: 2 };
    const row = market({ systemId: "sink", goodId: "water", stock: 0, demandRate: 1, storageCapacity: 0 });
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [row],
      pendingArrivals: [
        pending({
          id: "row-1", quantity: 1000, arrivalTick: 10, dispatchTick: 4,
          routeEdges: ["donor|mid", "mid|sink"],
        }),
      ],
    });

    const result = await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    const settledMarket = world.markets.find((m) => m.systemId === "sink")!;
    // The whole point of this fixture is that stock ends up capped well below the dispatched 1000.
    expect(settledMarket.stock).toBeLessThan(1000);
    expect(settledMarket.stock).toBeGreaterThan(0);
    void good; // documents the band inputs this fixture relies on

    expect(world.pendingArrivals).toHaveLength(1);
    const returnRow = world.pendingArrivals[0];
    expect(returnRow.leg).toBe("return");
    expect(returnRow.fromSystemId).toBe("sink");
    expect(returnRow.toSystemId).toBe("donor");
    expect(returnRow.routeEdges).toEqual(["mid|sink", "donor|mid"]);
    // Same delay as the outbound leg (10 - 4 = 6), dispatched this tick.
    expect(returnRow.dispatchTick).toBe(10);
    expect(returnRow.arrivalTick).toBe(16);
    expect(returnRow.quantity).toBe(1000 - result.goodsArrivals.credited);
    expect(result.goodsArrivals.returned).toBe(returnRow.quantity);
    expect(result.goodsArrivals.returnedRows).toBe(1);
  });

  it("a return leg landing on the donor credits in full, uncapped", async () => {
    // maxStock would be tiny for this row, but a return leg must ignore the cap entirely.
    const row = market({ systemId: "donor", goodId: "water", stock: 0, demandRate: 1, storageCapacity: 0 });
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [row],
      pendingArrivals: [
        pending({ id: "return-1", leg: "return", fromSystemId: "sink", toSystemId: "donor", quantity: 5000, arrivalTick: 10 }),
      ],
    });

    const result = await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    expect(world.markets.find((m) => m.systemId === "donor")!.stock).toBe(5000);
    expect(world.pendingArrivals).toEqual([]);
    expect(result.goodsArrivals.credited).toBe(5000);
    expect(result.goodsArrivals.returned).toBe(0);
  });

  it("the flow row carries the credited quantity, not the dispatched one", async () => {
    const row = market({ systemId: "sink", goodId: "water", stock: 0, demandRate: 1, storageCapacity: 0 });
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [row],
      pendingArrivals: [pending({ id: "row-1", quantity: 1000, arrivalTick: 10 })],
    });

    const result = await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    expect(world.flows).toHaveLength(1);
    expect(world.flows[0].quantity).toBe(result.goodsArrivals.credited);
    expect(world.flows[0].quantity).toBeLessThan(1000);
  });

  it("a return leg writes no flow row", async () => {
    const row = market({ systemId: "donor", goodId: "water", stock: 0 });
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [row],
      pendingArrivals: [
        pending({ id: "return-1", leg: "return", fromSystemId: "sink", toSystemId: "donor", quantity: 50, arrivalTick: 10 }),
      ],
    });

    await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    expect(world.flows).toEqual([]);
  });

  it("leaves a return leg unsettled, crediting nothing, when its destination has no market row at all", async () => {
    // A return leg's destination (the original donor) has no market row — unreachable in live play
    // (market rows are never deleted, only reset), but `creditMarkets` writes nothing for an id it
    // finds no row for, so crediting this key into `runningStock` would mint units the credit write
    // silently drops. The row must instead stay in the ledger, untouched, to retry next tick.
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [],
      pendingArrivals: [
        pending({ id: "return-1", leg: "return", fromSystemId: "sink", toSystemId: "ghost-donor", quantity: 50, arrivalTick: 10 }),
      ],
    });

    const result = await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    expect(result.goodsArrivals.credited).toBe(0);
    expect(world.pendingArrivals).toHaveLength(1);
    expect(world.pendingArrivals[0].id).toBe("return-1");
  });

  it("a return leg credits stock but moves neither the inbound nor the late-inbound accumulator", async () => {
    const row = market({ systemId: "donor", goodId: "water", stock: 0 });
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [row],
      pendingArrivals: [
        pending({ id: "return-1", leg: "return", fromSystemId: "sink", toSystemId: "donor", quantity: 50, arrivalTick: 10 }),
      ],
    });

    await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    const settled = world.markets.find((m) => m.systemId === "donor")!;
    expect(settled.stock).toBe(50);
    expect(settled.inboundSinceFold ?? 0).toBe(0);
    expect(settled.lateInboundSinceFold ?? 0).toBe(0);
  });

  it("a fully-returned outbound row (zero room) moves neither accumulator", async () => {
    // maxStock is already at (or below) the pre-credit stock, so `room` is 0 and the whole
    // quantity returns — the `credited > 0` block never runs for this row.
    const row = market({ systemId: "sink", goodId: "water", stock: 0, demandRate: 1, storageCapacity: 0 });
    // First saturate the market to its band cap with a real outbound credit, then send a second
    // row that finds zero room.
    const capWorld = new InMemoryGoodsArrivalsWorld({
      markets: [row],
      pendingArrivals: [pending({ id: "fill", quantity: 100000, arrivalTick: 10 })],
    });
    await runGoodsArrivalsProcessor(capWorld, ctx(10), { mintId });
    const saturated = capWorld.markets.find((m) => m.systemId === "sink")!;

    const secondWorld = new InMemoryGoodsArrivalsWorld({
      markets: [saturated],
      pendingArrivals: [pending({ id: "row-2", quantity: 50, arrivalTick: 20 })],
    });
    const before = secondWorld.markets.find((m) => m.systemId === "sink")!;
    const beforeInbound = before.inboundSinceFold ?? 0;
    const beforeLate = before.lateInboundSinceFold ?? 0;

    const result = await runGoodsArrivalsProcessor(secondWorld, ctx(20), { mintId });

    expect(result.goodsArrivals.credited).toBe(0);
    const after = secondWorld.markets.find((m) => m.systemId === "sink")!;
    expect(after.inboundSinceFold ?? 0).toBe(beforeInbound);
    expect(after.lateInboundSinceFold ?? 0).toBe(beforeLate);
  });

  it("a row exactly at the latency limit counts as on-time; one tick over counts as late", async () => {
    const onTimeRow = market({ systemId: "sink", goodId: "water", stock: 0, demandRate: 1000, storageCapacity: 1000 });
    const onTimeWorld = new InMemoryGoodsArrivalsWorld({
      markets: [onTimeRow],
      pendingArrivals: [
        pending({ id: "on-time", quantity: 10, dispatchTick: 0, arrivalTick: MAX_LATENCY_TICKS }),
      ],
    });
    await runGoodsArrivalsProcessor(onTimeWorld, ctx(MAX_LATENCY_TICKS), { mintId });
    const onTimeSettled = onTimeWorld.markets.find((m) => m.systemId === "sink")!;
    expect(onTimeSettled.inboundSinceFold).toBe(10);
    expect(onTimeSettled.lateInboundSinceFold ?? 0).toBe(0);

    const lateRow = market({ systemId: "sink", goodId: "water", stock: 0, demandRate: 1000, storageCapacity: 1000 });
    const lateWorld = new InMemoryGoodsArrivalsWorld({
      markets: [lateRow],
      pendingArrivals: [
        pending({ id: "late", quantity: 10, dispatchTick: 0, arrivalTick: MAX_LATENCY_TICKS + 1 }),
      ],
    });
    await runGoodsArrivalsProcessor(lateWorld, ctx(MAX_LATENCY_TICKS + 1), { mintId });
    const lateSettled = lateWorld.markets.find((m) => m.systemId === "sink")!;
    expect(lateSettled.inboundSinceFold).toBe(10);
    expect(lateSettled.lateInboundSinceFold).toBe(10);
  });

  it("two credits in consecutive ticks sum onto the accumulator rather than overwriting it", async () => {
    const row = market({ systemId: "sink", goodId: "water", stock: 0, demandRate: 1000, storageCapacity: 1000 });
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [row],
      pendingArrivals: [
        pending({ id: "first", quantity: 10, dispatchTick: 0, arrivalTick: 10 }),
      ],
    });
    await runGoodsArrivalsProcessor(world, ctx(10), { mintId });
    const afterFirst = world.markets.find((m) => m.systemId === "sink")!;
    expect(afterFirst.inboundSinceFold).toBe(10);

    const secondWorld = new InMemoryGoodsArrivalsWorld({
      markets: [afterFirst],
      pendingArrivals: [pending({ id: "second", quantity: 7, dispatchTick: 11, arrivalTick: 20 })],
    });
    await runGoodsArrivalsProcessor(secondWorld, ctx(20), { mintId });
    const afterSecond = secondWorld.markets.find((m) => m.systemId === "sink")!;
    expect(afterSecond.inboundSinceFold).toBe(17);
  });

  it("the appliedCreditTotal conservation term is unchanged by the new accumulator fields", async () => {
    const row = market({ systemId: "sink", goodId: "water", stock: 0, demandRate: 1000, storageCapacity: 1000 });
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [row],
      pendingArrivals: [pending({ id: "row-1", quantity: 10, arrivalTick: 10 })],
    });

    const result = await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    expect(world.appliedCreditTotal).toBe(result.goodsArrivals.credited);
  });

  it("returns the whole quantity when the destination has no market row at all", async () => {
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [],
      pendingArrivals: [pending({ id: "row-1", quantity: 42, arrivalTick: 10, routeEdges: ["donor|ghost"] })],
    });

    const result = await runGoodsArrivalsProcessor(world, ctx(10), { mintId });

    expect(result.goodsArrivals.credited).toBe(0);
    expect(result.goodsArrivals.returned).toBe(42);
    expect(world.pendingArrivals).toHaveLength(1);
    expect(world.pendingArrivals[0].leg).toBe("return");
  });
});
