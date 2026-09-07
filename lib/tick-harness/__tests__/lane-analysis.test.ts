import { describe, it, expect } from "vitest";
import {
  newLaneRunAccumulator, sampleLaneUtilisation, sampleInTransitVolume, sampleLaneOccupancy, sampleLaneDispatch,
  recordLogisticsBlocked, recordOvershootVolume, recordBudgetSkipped, recordLogisticsWork,
  recordDeliveredQuantity, sampleReleasedTonnage, computeReleasedByGood, summariseLanes,
} from "../lane-analysis";
import { laneCapacity } from "@/lib/engine/lanes";
import type { WorldLane, WorldMarket, WorldPendingArrival, WorldConstructionProject } from "@/lib/world/types";
import type { LogisticsTargetInfo } from "../cohort-analysis";
import type { LogisticsRole } from "@/lib/engine/directed-logistics";

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
    expect(summary.inTransitVolume).toEqual({ mean: 0, max: 0, topLanes: [] });
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
      { factionKey: "f1", laneKey: "a|b", quantity: 10, foreignShare: 0.5 },
      { factionKey: "f1", laneKey: "a|b", quantity: 4, foreignShare: 1 },
      { factionKey: null, laneKey: "a|b", quantity: 2, foreignShare: 0 },
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

function dispatchRow(
  toSystemId: string,
  goodId: string,
  quantity: number,
  dispatchTick: number,
  arrivalTick: number,
): WorldPendingArrival {
  return {
    id: `${toSystemId}-${goodId}-${arrivalTick}`, factionId: "f1", fromSystemId: "origin",
    toSystemId, goodId, quantity, dispatchTick, arrivalTick, routeEdges: [], leg: "outbound",
  };
}

function target(role: LogisticsRole, lateInboundShare?: number): LogisticsTargetInfo {
  return {
    logisticsTarget: 0, donorReserve: 0, marginFree: false, demand: 0, production: 0,
    productionSuppressed: false, role, capacityProduction: 0, consumerDeepLine: 0, lateInboundShare,
  };
}

const NO_OWNER = (): null => null;

describe("summariseLanes — inboundLatency (the re-measure metric)", () => {
  it("reproduces temp/depot-diag.ts's Claim-1 arithmetic: mean latency per sink, share strictly over 24 ticks", () => {
    // Three served sinks, one haul each, exactly the fixture the falsifier's vacuity check names:
    // 24 ticks (not over), 25 ticks (over), 12 ticks (not over) — depot-diag's own definition,
    // written out here rather than imported: sink mean = Σ latency×qty ÷ Σqty, share = sinks with
    // mean > 24 ÷ served sinks.
    const acc = newLaneRunAccumulator(25);
    const rows = [
      dispatchRow("at-line", "water", 10, 0, 24),
      dispatchRow("over-line", "water", 10, 0, 25),
      dispatchRow("well-under", "water", 10, 0, 12),
    ];
    sampleLaneDispatch(acc, rows, new Map(), NO_OWNER);

    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.inboundLatency.servedSinks).toBe(3);
    expect(summary.inboundLatency.shareOver24Ticks).toBeCloseTo(1 / 3, 9);
  });

  it("keeps a haul of exactly 24 ticks out of the over-24 population — the boundary is strict", () => {
    const acc = newLaneRunAccumulator(24);
    sampleLaneDispatch(acc, [dispatchRow("s1", "water", 10, 0, 24)], new Map(), NO_OWNER);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.inboundLatency.shareOver24Ticks).toBe(0);
  });

  it("only retains rows whose arrivalTick falls in the ten cycles before the accumulator's horizon", () => {
    const acc = newLaneRunAccumulator(1000);
    // Outside the 240-tick window before tick 1000 (arrivalTick 700 ⇒ 1000-700=300 > 240).
    sampleLaneDispatch(acc, [dispatchRow("outside", "water", 10, 680, 700)], new Map(), NO_OWNER);
    // Inside it.
    sampleLaneDispatch(acc, [dispatchRow("inside", "water", 10, 900, 950)], new Map(), NO_OWNER);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.inboundLatency.servedSinks).toBe(1);
  });

  it("the treated-cohort share reads only supplier/idle sinks, and gate-excluded is only the late-share cohort", () => {
    const acc = newLaneRunAccumulator(30);
    sampleLaneDispatch(
      acc,
      [
        dispatchRow("treated-over", "water", 5, 0, 30), // supplier, over 24
        dispatchRow("consumer-over", "water", 5, 0, 30), // consumer, over 24, unmeasured late share
        dispatchRow("gate-excluded", "water", 5, 0, 10), // consumer, late share over the constant
        dispatchRow("treated-under", "water", 5, 0, 5), // idle, under 24
      ],
      new Map(),
      NO_OWNER,
    );
    const targetsByKey = new Map<string, LogisticsTargetInfo>([
      ["treated-over|water", target("supplier")],
      ["consumer-over|water", target("consumer")],
      ["gate-excluded|water", target("consumer", 0.5)],
      ["treated-under|water", target("idle")],
    ]);

    const summary = summariseLanes(acc, [], new Set(), [], targetsByKey);
    const latency = summary.inboundLatency;
    expect(latency.servedSinks).toBe(4);
    expect(latency.shareOver24Ticks).toBeCloseTo(0.5, 9); // treated-over, consumer-over
    expect(latency.treatedSinks).toBe(2); // treated-over, treated-under
    expect(latency.shareOver24TreatedCohort).toBeCloseTo(0.5, 9); // only treated-over is over 24
    expect(latency.gateExcludedSinks).toBe(1); // gate-excluded only — never consumer-over
    expect(latency.gateExcludedShare).toBeCloseTo(0.25, 9);
  });

  it("reports the guards beside the metric: median raise size, hauls per sink, per-haul latency quantiles", () => {
    const acc = newLaneRunAccumulator(50);
    sampleLaneDispatch(
      acc,
      [
        dispatchRow("s1", "water", 10, 0, 10),
        dispatchRow("s1", "water", 20, 10, 30),
        dispatchRow("s2", "water", 30, 0, 40),
      ],
      new Map(),
      NO_OWNER,
    );
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.inboundLatency.haulsPerServedSink).toBeCloseTo(3 / 2, 9);
    expect(summary.inboundLatency.medianRaiseSize).toBe(20);
  });

  it("reports zeroes, never NaN, when nothing was dispatched inside the window", () => {
    const summary = summariseLanes(newLaneRunAccumulator(1000), [], new Set(), []);
    expect(summary.inboundLatency).toEqual({
      servedSinks: 0, shareOver24Ticks: 0, shareOver24TreatedCohort: 0, treatedSinks: 0,
      gateExcludedShare: 0, gateExcludedSinks: 0, medianRaiseSize: 0, haulsPerServedSink: 0,
      perHaulLatencyP50: 0, perHaulLatencyP90: 0,
    });
  });
});

describe("summariseLanes — logisticsWorkPerDeliveredUnit", () => {
  it("reads 1× when total billed work equals total delivered quantity — a galaxy of only direct hauls", () => {
    const acc = newLaneRunAccumulator();
    recordLogisticsWork(acc, 400);
    recordDeliveredQuantity(acc, 400);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.logisticsWorkPerDeliveredUnit).toBeCloseTo(1, 9);
  });

  it("rises above 1× when relaying bills a second leg for the same delivered unit", () => {
    const acc = newLaneRunAccumulator();
    recordLogisticsWork(acc, 800); // two legs' worth of cost for the same tonnage
    recordDeliveredQuantity(acc, 400);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.logisticsWorkPerDeliveredUnit).toBeCloseTo(2, 9);
  });

  it("reports 0, not NaN, when nothing was delivered", () => {
    const acc = newLaneRunAccumulator();
    recordLogisticsWork(acc, 50);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.logisticsWorkPerDeliveredUnit).toBe(0);
  });
});

describe("computeReleasedByGood", () => {
  function targetFor(
    role: LogisticsRole,
    donorReserve: number,
    consumerDeepLine: number,
  ): LogisticsTargetInfo {
    return {
      logisticsTarget: 0, donorReserve, marginFree: true, demand: 1, production: 0,
      productionSuppressed: false, role, capacityProduction: 0, consumerDeepLine,
    };
  }

  it("reads 0 on a run with no role change — a consumer market contributes nothing", () => {
    // donorReserve (20) and consumerDeepLine (40) deliberately differ, so a consumer market that
    // slipped through the role filter would still show a nonzero gap — this is not vacuous on a
    // market whose two lines happen to coincide.
    const targetsByKey = new Map<string, LogisticsTargetInfo>([
      ["s1|water", targetFor("consumer", 20, 40)],
    ]);
    const marketByKey = new Map([["s1|water", { goodId: "water", stock: 60 }]]);
    const released = computeReleasedByGood(targetsByKey, marketByKey);
    expect(released.size).toBe(0);
  });

  it("credits a supplier the gap between its buffer and the deep line a consumer would have kept", () => {
    // Buffer 10, deep line 40, stock 60: drawable to 10 is 50, drawable to 40 (deep) is 20 — the
    // 30-unit gap is what became drawable ONLY because this market stopped being a consumer.
    const targetsByKey = new Map<string, LogisticsTargetInfo>([
      ["s1|water", targetFor("supplier", 10, 40)],
    ]);
    const marketByKey = new Map([["s1|water", { goodId: "water", stock: 60 }]]);
    const released = computeReleasedByGood(targetsByKey, marketByKey);
    expect(released.get("water")).toBe(30);
  });
});

describe("sampleReleasedTonnage / releasedTonnageFirstCycle", () => {
  it("reads tick null and every total 0 on a run with no role change", () => {
    // No call to sampleReleasedTonnage at all — the runner's own convention for a cycle whose
    // supplier/idle release summed to 0 (nothing crossed the deep line).
    const summary = summariseLanes(newLaneRunAccumulator(), [], new Set(), []);
    expect(summary.releasedTonnageFirstCycle).toEqual({ tick: null, total: 0, byGood: [] });
  });

  it("a released total of exactly 0 does not set the first-cycle read", () => {
    const acc = newLaneRunAccumulator();
    sampleReleasedTonnage(acc, 100, new Map([["water", 0]]));
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.releasedTonnageFirstCycle).toEqual({ tick: null, total: 0, byGood: [] });
  });

  it("records the first positive run and never overwrites it on a later positive run", () => {
    const acc = newLaneRunAccumulator();
    sampleReleasedTonnage(acc, 100, new Map([["water", 5]]));
    sampleReleasedTonnage(acc, 200, new Map([["water", 50]]));
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.releasedTonnageFirstCycle.tick).toBe(100);
    expect(summary.releasedTonnageFirstCycle.total).toBe(5);
    expect(summary.releasedTonnageFirstCycle.byGood).toEqual([{ goodId: "water", quantity: 5 }]);
  });
});

describe("summariseLanes — physicalCoverAtRationByRole / anchorEventCohort", () => {
  it("reports an empty table, never NaN, when no market carries a role at the horizon", () => {
    const markets: WorldMarket[] = [
      { systemId: "s1", goodId: "water", stock: 5, anchorMult: 1, demandRate: 1, storageCapacity: 0 },
    ];
    const summary = summariseLanes(newLaneRunAccumulator(), [], new Set(), markets);
    expect(summary.physicalCoverAtRationByRole).toEqual([]);
    // Every role still gets a zeroed row for the anchor-event cohort, never a missing entry.
    expect(summary.anchorEventCohort.every((e) => e.count === 0 && e.brakedCount === 0)).toBe(true);
    expect(summary.anchorEventCohort.length).toBeGreaterThan(0);
  });

  it("reads stock ÷ use in cycles per role, ration-flagging only markets under RATION_COVER × use", () => {
    const markets: WorldMarket[] = [
      { systemId: "s1", goodId: "water", stock: 1, anchorMult: 1, demandRate: 1, storageCapacity: 0 },
      { systemId: "s2", goodId: "water", stock: 100, anchorMult: 1, demandRate: 1, storageCapacity: 0 },
    ];
    const rolesByKey = new Map([
      ["s1|water", { role: "consumer" as const, demand: 2 }], // 0.5 cycles, well under RATION_COVER
      ["s2|water", { role: "consumer" as const, demand: 2 }], // 50 cycles
    ]);
    const summary = summariseLanes(newLaneRunAccumulator(), [], new Set(), markets, new Map(), rolesByKey);
    const entry = summary.physicalCoverAtRationByRole.find((e) => e.role === "consumer");
    expect(entry?.n).toBe(2);
    expect(entry?.underRationShare).toBeCloseTo(0.5, 9);
  });
});

describe("sampleLaneOccupancy", () => {
  it("attributes a multi-hop haul to the lane it is PHYSICALLY crossing at the sample tick, not every lane of its route", () => {
    // Two hops of fuel 10 each at speed 1: hop0 (a|b) starts at dispatch (0), hop1 (b|c) starts at 10.
    const row = outboundRow({
      factionId: "f1", quantity: 7, dispatchTick: 0, arrivalTick: 20, routeEdges: ["a|b", "b|c"],
    });
    const hopFuelCostsOf = () => [10, 10];

    const acc = newLaneRunAccumulator();
    sampleLaneOccupancy(acc, [row], 5, hopFuelCostsOf, 1);
    let summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.inTransitVolume.topLanes).toEqual([{ laneKey: "a|b", inTransit: 7 }]);

    const acc2 = newLaneRunAccumulator();
    sampleLaneOccupancy(acc2, [row], 15, hopFuelCostsOf, 1);
    summary = summariseLanes(acc2, [], new Set(), []);
    expect(summary.inTransitVolume.topLanes).toEqual([{ laneKey: "b|c", inTransit: 7 }]);
  });

  it("counts a row on no lane once it has arrived", () => {
    const row = outboundRow({
      factionId: "f1", quantity: 7, dispatchTick: 0, arrivalTick: 20, routeEdges: ["a|b", "b|c"],
    });
    const acc = newLaneRunAccumulator();
    sampleLaneOccupancy(acc, [row], 20, () => [10, 10], 1);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.inTransitVolume.topLanes).toEqual([]);
  });

  it("at a huge freight speed a fresh row reads on no lane — the zero-latency fallback", () => {
    const row = outboundRow({
      factionId: "f1", quantity: 7, dispatchTick: 10, arrivalTick: 10, routeEdges: ["a|b", "b|c"],
    });
    const acc = newLaneRunAccumulator();
    sampleLaneOccupancy(acc, [row], 10, () => [10, 10], 1_000_000);
    const summary = summariseLanes(acc, [], new Set(), []);
    expect(summary.inTransitVolume.topLanes).toEqual([]);
  });
});
