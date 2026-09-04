import { describe, it, expect } from "vitest";
import { runGoodsArrivalsProcessor } from "../goods-arrivals";
import { InMemoryGoodsArrivalsWorld } from "@/lib/tick/adapters/memory/goods-arrivals";
import type { WorldMarket, WorldPendingArrival } from "@/lib/world/types";
import type { TickContext } from "@/lib/tick/types";

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
