import { describe, it, expect } from "vitest";
import {
  freightArrivalTick, hopCrossingTicks, scheduledInbound, flowsCrossingEdge,
  currentHopIndex, laneOccupiedAt,
} from "@/lib/engine/freight";
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

describe("hopCrossingTicks", () => {
  it("starts hop 0 at dispatchTick and each later hop at the cumulative fuel of hops before it", () => {
    // Hops of fuel 10, 5, 20 at speed 5: hop0 starts at +0, hop1 at round(10/5)=2,
    // hop2 at round((10+5)/5)=3.
    expect(hopCrossingTicks(100, [10, 5, 20], 5)).toEqual([100, 102, 103]);
  });

  it("a straddling crossing is charged to the window it STARTS in — the start tick, not the end", () => {
    // A single hop of fuel 48 at speed 1 spans ticks 100..148 — straddling a 24-tick window
    // boundary at 124 — but hopCrossingTicks reports only its start (100), which is what the
    // booker buckets by window.
    expect(hopCrossingTicks(100, [48], 1)).toEqual([100]);
  });

  it("at a very large freightSpeed every hop starts at dispatchTick — the zero-latency fallback", () => {
    expect(hopCrossingTicks(100, [10, 5, 20], 1_000_000)).toEqual([100, 100, 100]);
  });

  it("returns one entry per hop, empty for an empty route", () => {
    expect(hopCrossingTicks(100, [], 5)).toEqual([]);
  });

  it("clamps a hop that would start AT arrivalTick back to arrivalTick - 1, so its window is never empty", () => {
    // Hops of fuel 10 then 0 at speed 5: arrival is round(10/5) = tick 102, and hop 1's own start
    // rounds to 102 as well — the same tick the row is drained on. Unclamped, hop 1's half-open
    // window [102, 102) is empty and the last lane is occupied nowhere.
    expect(hopCrossingTicks(100, [10, 0], 5, 102)).toEqual([100, 101]);
    // A last hop short enough to round away does the same: 2 fuel at speed 10 adds nothing to
    // either the arrival tick or the hop start.
    expect(hopCrossingTicks(100, [20, 2], 10, 102)).toEqual([100, 101]);
  });

  it("leaves the starts alone when arrivalTick is not after dispatchTick — a same-tick arrival occupies nothing", () => {
    expect(hopCrossingTicks(100, [10, 0], 1_000_000, 100)).toEqual([100, 100]);
  });
});

describe("currentHopIndex / laneOccupiedAt", () => {
  // Two hops, fuel [10, 5] at speed 5: hop0 starts at 0, hop1 at round(10/5)=2, arrival at
  // round(15/5)=3.
  const row = arrival({
    id: "two-hop", dispatchTick: 0, arrivalTick: 3, routeEdges: ["a|b", "b|c"],
  });
  const hopFuelCosts = [10, 5];

  it("is on hop 0 (lane a|b) before hop 1 starts", () => {
    expect(currentHopIndex(row, 1, hopFuelCosts, 5)).toBe(0);
    expect(laneOccupiedAt(row, "a|b", 1, hopFuelCosts, 5)).toBe(true);
    expect(laneOccupiedAt(row, "b|c", 1, hopFuelCosts, 5)).toBe(false);
  });

  it("is on hop 1 (lane b|c) once its crossing tick starts", () => {
    expect(currentHopIndex(row, 2, hopFuelCosts, 5)).toBe(1);
    expect(laneOccupiedAt(row, "b|c", 2, hopFuelCosts, 5)).toBe(true);
    expect(laneOccupiedAt(row, "a|b", 2, hopFuelCosts, 5)).toBe(false);
  });

  it("occupies neither lane at arrivalTick — drained this tick", () => {
    expect(currentHopIndex(row, 3, hopFuelCosts, 5)).toBeNull();
    expect(laneOccupiedAt(row, "a|b", 3, hopFuelCosts, 5)).toBe(false);
    expect(laneOccupiedAt(row, "b|c", 3, hopFuelCosts, 5)).toBe(false);
  });

  it("occupies nothing before dispatch", () => {
    expect(currentHopIndex(row, -1, hopFuelCosts, 5)).toBeNull();
  });

  it("occupies its final lane for at least one tick when that hop's fuel rounds away", () => {
    // Zero-fuel last hop: arrival is round(10/5) = 2, and hop 1's unclamped start is 2 as well.
    const zeroFuelLast = arrival({
      id: "zero-fuel-last", dispatchTick: 0, arrivalTick: 2, routeEdges: ["a|b", "b|c"],
    });
    expect(currentHopIndex(zeroFuelLast, 1, [10, 0], 5)).toBe(1);
    expect(laneOccupiedAt(zeroFuelLast, "b|c", 1, [10, 0], 5)).toBe(true);

    // Same shape from rounding rather than a zero cost: 2 fuel at speed 10 rounds away.
    const roundedAwayLast = arrival({
      id: "rounded-away-last", dispatchTick: 0, arrivalTick: 2, routeEdges: ["a|b", "b|c"],
    });
    expect(currentHopIndex(roundedAwayLast, 1, [20, 2], 10)).toBe(1);
    expect(laneOccupiedAt(roundedAwayLast, "b|c", 1, [20, 2], 10)).toBe(true);
  });

  it("at a huge freight speed every hop collapses to dispatchTick, which equals arrivalTick — occupies no lane", () => {
    const zeroLatency = arrival({
      id: "fast", dispatchTick: 10, arrivalTick: 10, routeEdges: ["a|b", "b|c"],
    });
    expect(currentHopIndex(zeroLatency, 10, [10, 5], 1_000_000)).toBeNull();
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
