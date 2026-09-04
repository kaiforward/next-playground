import { describe, it, expect } from "vitest";
import { freightArrivalTick, scheduledInbound, flowsCrossingEdge } from "@/lib/engine/freight";
import type { WorldPendingArrival } from "@/lib/world/types";

function arrival(over: Partial<WorldPendingArrival> & { id: string }): WorldPendingArrival {
  return {
    factionId: null,
    fromSystemId: "donor",
    toSystemId: "sink",
    goodId: "water",
    quantity: 10,
    dispatchTick: 0,
    arrivalTick: 5,
    routeEdges: ["donor|sink"],
    leg: "outbound",
    ...over,
  };
}

describe("freightArrivalTick", () => {
  it("adds the rounded fuel/speed delay to now", () => {
    // 17 / 5 = 3.4 -> rounds to 3
    expect(freightArrivalTick(100, 17, 5)).toBe(103);
  });

  it("at a large enough speed returns now — the zero-latency fallback is reachable", () => {
    expect(freightArrivalTick(100, 8.5, 1_000_000)).toBe(100);
  });

  it("never returns a tick before now (max(0, ...))", () => {
    // A pathological negative fuel total (never produced by real routing) must not schedule
    // arrival before dispatch.
    expect(freightArrivalTick(100, -50, 5)).toBe(100);
  });
});

describe("scheduledInbound", () => {
  it("sums outbound legs by \"toSystemId|goodId\"", () => {
    const ledger = [
      arrival({ id: "a", toSystemId: "sink", goodId: "water", quantity: 10 }),
      arrival({ id: "b", toSystemId: "sink", goodId: "water", quantity: 5 }),
      arrival({ id: "c", toSystemId: "sink", goodId: "food", quantity: 3 }),
    ];
    const inbound = scheduledInbound(ledger);
    expect(inbound.get("sink|water")).toBe(15);
    expect(inbound.get("sink|food")).toBe(3);
  });

  it("excludes return legs — they are not inbound supply the destination should stop ordering against", () => {
    const ledger = [
      arrival({ id: "a", toSystemId: "sink", goodId: "water", quantity: 10, leg: "outbound" }),
      arrival({ id: "b", toSystemId: "sink", goodId: "water", quantity: 100, leg: "return" }),
    ];
    const inbound = scheduledInbound(ledger);
    expect(inbound.get("sink|water")).toBe(10);
  });
});

describe("flowsCrossingEdge", () => {
  it("returns exactly the rows whose window overlaps and whose route holds the edge", () => {
    const inWindowOnEdge = arrival({
      id: "hit", dispatchTick: 2, arrivalTick: 8, routeEdges: ["a|b", "b|c"],
    });
    const onEdgeButOutsideWindow = arrival({
      id: "miss-window", dispatchTick: 20, arrivalTick: 25, routeEdges: ["a|b"],
    });
    const inWindowButOffEdge = arrival({
      id: "miss-edge", dispatchTick: 2, arrivalTick: 8, routeEdges: ["x|y"],
    });
    const ledger = [inWindowOnEdge, onEdgeButOutsideWindow, inWindowButOffEdge];

    const hits = flowsCrossingEdge(ledger, "a|b", 5, 10);

    expect(hits.map((r) => r.id)).toEqual(["hit"]);
  });

  it("treats a window that only just touches the transit span as overlapping (inclusive bounds)", () => {
    const row = arrival({ id: "touching", dispatchTick: 0, arrivalTick: 5, routeEdges: ["a|b"] });
    expect(flowsCrossingEdge([row], "a|b", 5, 10).map((r) => r.id)).toEqual(["touching"]);
    expect(flowsCrossingEdge([row], "a|b", -10, 0).map((r) => r.id)).toEqual(["touching"]);
  });
});
