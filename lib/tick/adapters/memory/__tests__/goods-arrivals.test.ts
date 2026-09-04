import { describe, it, expect } from "vitest";
import { InMemoryGoodsArrivalsWorld } from "@/lib/tick/adapters/memory/goods-arrivals";
import type { WorldMarket, WorldPendingArrival } from "@/lib/world/types";

function market(over: Partial<WorldMarket> & { systemId: string; goodId: string }): WorldMarket {
  return { stock: 0, anchorMult: 1, demandRate: 100, storageCapacity: 0, ...over };
}

function pending(over: Partial<WorldPendingArrival> & { id: string }): WorldPendingArrival {
  return {
    factionId: null,
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

describe("InMemoryGoodsArrivalsWorld", () => {
  it("getDueArrivals returns only rows whose arrivalTick has come due (<=, not ==)", async () => {
    const due = pending({ id: "due", arrivalTick: 10 });
    const overdue = pending({ id: "overdue", arrivalTick: 5 });
    const future = pending({ id: "future", arrivalTick: 20 });
    const world = new InMemoryGoodsArrivalsWorld({ markets: [], pendingArrivals: [due, overdue, future] });

    const arriving = await world.getDueArrivals(10);

    expect(arriving.map((a) => a.id).sort()).toEqual(["due", "overdue"]);
  });

  it("getMarketCaps returns band figures only for markets among the requested keys", async () => {
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [
        market({ systemId: "sink", goodId: "water", stock: 5, demandRate: 1, storageCapacity: 0 }),
        market({ systemId: "sink", goodId: "food", stock: 0 }),
      ],
      pendingArrivals: [],
    });

    const caps = await world.getMarketCaps(["sink|water"]);

    expect(caps.has("sink|food")).toBe(false);
    const cap = caps.get("sink|water")!;
    expect(cap.stock).toBe(5);
    expect(cap.maxStock).toBeGreaterThan(0);
    expect(cap.targetStock).toBeGreaterThan(0);
  });

  it("creditMarkets writes absolute stock to the named market and leaves every other row untouched", async () => {
    const other = market({ systemId: "sink", goodId: "food", stock: 3 });
    const world = new InMemoryGoodsArrivalsWorld({
      markets: [market({ systemId: "sink", goodId: "water", stock: 0 }), other],
      pendingArrivals: [],
    });

    await world.creditMarkets([{ id: "sink|water", stock: 25 }]);

    expect(world.markets.find((m) => m.goodId === "water")!.stock).toBe(25);
    expect(world.markets.find((m) => m.goodId === "food")).toEqual(other);
  });

  it("settleArrivals drains settled rows and appends minted return legs", async () => {
    const row = pending({ id: "row-1" });
    const world = new InMemoryGoodsArrivalsWorld({ markets: [], pendingArrivals: [row] });

    const returned = pending({ id: "return-1", leg: "return", fromSystemId: "sink", toSystemId: "donor" });
    await world.settleArrivals([{ id: "row-1", credited: 5, returned }]);

    expect(world.pendingArrivals).toEqual([returned]);
  });

  it("appendFlows accumulates onto the public flows field", async () => {
    const world = new InMemoryGoodsArrivalsWorld({ markets: [], pendingArrivals: [] });
    await world.appendFlows([{ tick: 1, fromSystemId: "a", toSystemId: "b", goodId: "water", quantity: 3 }]);
    await world.appendFlows([{ tick: 2, fromSystemId: "a", toSystemId: "b", goodId: "water", quantity: 4 }]);
    expect(world.flows).toHaveLength(2);
  });
});
