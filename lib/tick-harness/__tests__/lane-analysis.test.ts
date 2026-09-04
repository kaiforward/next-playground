import { describe, it, expect } from "vitest";
import {
  newLaneRunAccumulator, sampleLaneUtilisation, sampleInTransitVolume, sampleLaneDispatch,
  recordLogisticsBlocked, recordOvershootVolume, recordBudgetSkipped, summariseLanes,
} from "../lane-analysis";
import { laneCapacity } from "@/lib/engine/lanes";
import type { WorldLane, WorldMarket, WorldPendingArrival, WorldConstructionProject } from "@/lib/world/types";

function lane(key: string, aId: string, bId: string, level: number, bookedLoad: number, blockedVolume = 0): WorldLane {
  return { key, aId, bId, level, bookedLoad, blockedVolume, idleCycles: 0 };
}

function outboundRow(
  overrides: Partial<WorldPendingArrival> & Pick<WorldPendingArrival, "routeEdges" | "factionId" | "quantity">,
): WorldPendingArrival {
  return {
    id: "haul-1", fromSystemId: "a", toSystemId: "b", goodId: "water",
    dispatchTick: 10, arrivalTick: 12, leg: "outbound",
    ...overrides,
  };
}

describe("summariseLanes", () => {
  it("reports zeroes, never NaN, on a fresh accumulator", () => {
    const acc = newLaneRunAccumulator();
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.utilisation).toEqual({ p50: 0, p90: 0, max: 0, saturatedShare: 0 });
    expect(summary.topDecileShare).toBe(0);
    expect(summary.inTransitVolume).toEqual({ mean: 0, max: 0 });
    expect(summary.blockedVolume).toEqual({ total: 0, topLanes: [] });
    expect(summary.foreignTransitShare).toBe(0);
    expect(summary.queuedVsRealised).toEqual({ laneCount: 0, meanQueuedLevels: 0, meanUtilisation: 0 });
  });

  it("samples utilisation as booked ÷ (laneCapacity(level) × catchUp), skipping zero-capacity lanes", () => {
    const acc = newLaneRunAccumulator();
    const capacity = laneCapacity(0); // level 0
    sampleLaneUtilisation(acc, [lane("a|b", "a", "b", 0, capacity)], 1);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.utilisation.p50).toBeCloseTo(1, 9);
    expect(summary.utilisation.saturatedShare).toBe(1);
  });

  it("the trafficked cohort (nonzero booked) is a subset of every sampled lane", () => {
    const acc = newLaneRunAccumulator();
    // 9 equally-trafficked lanes plus 11 never-trafficked lanes: with the bookedSum > 0 filter,
    // topN = ceil(9 × 0.1) = 1 lane out of 9 trafficked (share 1/9); without it, the 11 zero-booked
    // lanes swell the population to 20 and topN = ceil(20 × 0.1) = 2 lanes out of 9 (share 2/9) —
    // so the filter is load-bearing on this fixture, unlike the old 1-vs-1 one.
    const trafficked = Array.from({ length: 9 }, (_, i) => lane(`t${i}|x`, "a", "b", 0, laneCapacity(0)));
    const untrafficked = Array.from({ length: 11 }, (_, i) => lane(`u${i}|x`, "c", "d", 0, 0));
    sampleLaneUtilisation(acc, [...trafficked, ...untrafficked], 1);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.topDecileShare).toBeCloseTo(1 / 9, 9);
    // But all 20 lanes contribute a utilisation sample — the trafficked cohort is smaller.
    expect(summary.utilisation.p50).toBeLessThan(1);
  });

  it("accumulates blocked volume per lane across sampled cycles and ranks topLanes", () => {
    const acc = newLaneRunAccumulator();
    sampleLaneUtilisation(acc, [lane("a|b", "a", "b", 0, 0, 10)], 1);
    sampleLaneUtilisation(acc, [lane("a|b", "a", "b", 0, 0, 5)], 1);
    sampleLaneUtilisation(acc, [lane("c|d", "c", "d", 0, 0, 1)], 1);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.blockedVolume.total).toBe(16);
    expect(summary.blockedVolume.topLanes[0]).toEqual({ laneKey: "a|b", blocked: 15 });
  });

  it("sums in-transit volume from outbound pendingArrivals only, per tick", () => {
    const acc = newLaneRunAccumulator();
    const rows: WorldPendingArrival[] = [
      { id: "1", factionId: "f1", fromSystemId: "a", toSystemId: "b", goodId: "water", quantity: 10, dispatchTick: 0, arrivalTick: 5, routeEdges: [], leg: "outbound" },
      { id: "2", factionId: "f1", fromSystemId: "b", toSystemId: "a", goodId: "water", quantity: 4, dispatchTick: 0, arrivalTick: 5, routeEdges: [], leg: "return" },
    ];
    sampleInTransitVolume(acc, rows);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.inTransitVolume.mean).toBe(10);
    expect(summary.inTransitVolume.max).toBe(10);
  });

  it("classifies a haul foreign-transit when any crossed lane has a non-hauler, non-null owner", () => {
    const acc = newLaneRunAccumulator();
    const lanesByKey = new Map([
      ["a|b", { aId: "a", bId: "b" }],
      ["b|c", { aId: "b", bId: "c" }],
    ]);
    const ownerAt = (systemId: string): string | null => (systemId === "b" ? "foreign-faction" : "f1");
    const row = outboundRow({ factionId: "f1", quantity: 20, routeEdges: ["a|b", "b|c"] });
    sampleLaneDispatch(acc, [row], lanesByKey, ownerAt);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.foreignTransitShare).toBeCloseTo(1, 9);
  });

  it("reads no foreign transit when every endpoint is the hauler's own or unclaimed", () => {
    const acc = newLaneRunAccumulator();
    const lanesByKey = new Map([["a|b", { aId: "a", bId: "b" }]]);
    const ownerAt = (systemId: string): string | null => (systemId === "a" ? "f1" : null);
    const row = outboundRow({ factionId: "f1", quantity: 20, routeEdges: ["a|b"] });
    sampleLaneDispatch(acc, [row], lanesByKey, ownerAt);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.foreignTransitShare).toBe(0);
  });

  it("folds contention shortfall as Σ blocked quantity × foreignShare, per hauling faction", () => {
    const acc = newLaneRunAccumulator();
    recordLogisticsBlocked(acc, [
      { factionKey: "f1", quantity: 10, foreignShare: 0.5 },
      { factionKey: "f1", quantity: 4, foreignShare: 1 },
      { factionKey: null, quantity: 2, foreignShare: 0 },
    ]);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.contentionShortfallByFaction).toEqual([
      { factionKey: "f1", shortfall: 9 }, // 10*0.5 + 4*1
      { factionKey: null, shortfall: 0 },
    ]);
  });

  it("sums overshoot volume and budget-skipped counts across the run", () => {
    const acc = newLaneRunAccumulator();
    recordOvershootVolume(acc, 5);
    recordOvershootVolume(acc, 3);
    recordBudgetSkipped(acc, 2);
    recordBudgetSkipped(acc, 1);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.overshootVolume).toBe(8);
    expect(summary.budgetSkipped).toBe(3);
  });

  it("reports queuedVsRealised over lanes carrying an open lane_upgrade project at run end", () => {
    const acc = newLaneRunAccumulator();
    sampleLaneUtilisation(acc, [lane("a|b", "a", "b", 0, laneCapacity(0))], 1); // util 1.0
    const projects: WorldConstructionProject[] = [
      {
        kind: "lane_upgrade", id: "p1", factionId: "f1", origin: "auto",
        workTotal: 10, workDone: 0, laneKey: "a|b", levels: 2,
      },
    ];
    const summary = summariseLanes(acc, projects, new Set(), []);
    expect(summary.queuedVsRealised.laneCount).toBe(1);
    expect(summary.queuedVsRealised.meanQueuedLevels).toBe(2);
    expect(summary.queuedVsRealised.meanUtilisation).toBeCloseTo(1, 9);
  });

  it("computes survivalStockFalling over developed systems' water/food cover at run end", () => {
    const developed = new Set(["s1", "s2"]);
    const markets: WorldMarket[] = [
      { systemId: "s1", goodId: "water", stock: 1, anchorMult: 1, demandRate: 1, storageCapacity: 0, stockChange: -1 },
      { systemId: "s2", goodId: "water", stock: 100, anchorMult: 1, demandRate: 1, storageCapacity: 0, stockChange: 1 },
      { systemId: "s3", goodId: "water", stock: 1, anchorMult: 1, demandRate: 1, storageCapacity: 0, stockChange: -1 }, // not developed
    ];
    const summary = summariseLanes(newLaneRunAccumulator(), [], developed, markets);
    expect(summary.survivalStockFalling).toEqual({ count: 1, share: 0.5 });
  });
});
