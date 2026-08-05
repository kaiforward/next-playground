import { describe, it, expect } from "vitest";
import { summarizeLogistics } from "../logistics-analysis";
import type { WorldFlowEvent } from "@/lib/world/types";

const flow = (
  tick: number,
  fromSystemId: string,
  toSystemId: string,
  goodId: string,
  quantity: number,
): WorldFlowEvent => ({ tick, fromSystemId, toSystemId, goodId, quantity });

// Neutral budget/flag inputs for tests exercising only the flow-derived counters.
const NO_BUDGET = { total: 0, spent: 0, fundingBoundEvents: 0 };
const NO_FLAGS = { flagged: 0, marketCount: 0 };

describe("summarizeLogistics", () => {
  it("reports a silent run as zeroes, not NaN", () => {
    // The failure this metric exists to catch: directed-logistics ran every tick
    // and moved nothing (the Math.floor bug quantized every transfer to 0). The
    // mean must not divide by zero — JSON.stringify renders NaN as null, which
    // would read as "not measured" rather than "measured, and it is broken".
    const summary = summarizeLogistics([], NO_BUDGET, NO_FLAGS);

    expect(summary.transferCount).toBe(0);
    expect(summary.activeTicks).toBe(0);
    expect(summary.totalQuantity).toBe(0);
    expect(summary.meanTransferSize).toBe(0);
    expect(summary.participatingSystems).toBe(0);
    expect(summary.byGood).toEqual([]);
    expect(summary.budgetSpentFrac).toBe(0);
    expect(summary.fundingBoundEvents).toBe(0);
    expect(summary.fundingBoundFlagSetRate).toBe(0);
    expect(summary.flowRowsPerCycle).toBe(0);
  });

  it("totals transfer count, quantity, and mean size across the run", () => {
    const summary = summarizeLogistics(
      [flow(24, "a", "b", "water", 10), flow(48, "a", "b", "water", 30)],
      NO_BUDGET,
      NO_FLAGS,
    );

    expect(summary.transferCount).toBe(2);
    expect(summary.totalQuantity).toBe(40);
    expect(summary.meanTransferSize).toBe(20);
  });

  it("counts ticks that carried a transfer, not transfers", () => {
    // Logistics resolves on a cycle start, so a healthy run shows a recurring
    // rhythm. Three flows across two ticks is two active ticks.
    const summary = summarizeLogistics(
      [
        flow(24, "a", "b", "water", 5),
        flow(24, "c", "d", "fuel", 5),
        flow(48, "a", "b", "water", 5),
      ],
      NO_BUDGET,
      NO_FLAGS,
    );

    expect(summary.activeTicks).toBe(2);
  });

  it("counts each participating system once, whether it sent or received", () => {
    // "b" both receives and sends: a→b, b→c is three distinct systems, not four.
    const summary = summarizeLogistics(
      [flow(24, "a", "b", "water", 5), flow(48, "b", "c", "water", 5)],
      NO_BUDGET,
      NO_FLAGS,
    );

    expect(summary.participatingSystems).toBe(3);
  });

  it("aggregates per good, heaviest first, omitting goods that never moved", () => {
    const summary = summarizeLogistics(
      [
        flow(24, "a", "b", "water", 5),
        flow(24, "a", "b", "fuel", 100),
        flow(48, "a", "b", "water", 5),
      ],
      NO_BUDGET,
      NO_FLAGS,
    );

    expect(summary.byGood).toEqual([
      { goodId: "fuel", transferCount: 1, quantity: 100 },
      { goodId: "water", transferCount: 2, quantity: 10 },
    ]);
  });

  it("reports budget spend as a whole-run fraction, with flag rate and rows per cycle", () => {
    // The budget ledger is accumulated by the runner across ticks; this only divides.
    // 16 spent of 200 total → 6 ticks of history is irrelevant to the fraction; 5 of
    // 50 developed-system markets flagged funding-bound at run end → 0.1; 3 flow rows
    // over 2 active ticks → 1.5 rows per resolving cycle (the flow-volume canary).
    const summary = summarizeLogistics(
      [
        flow(24, "a", "b", "water", 5),
        flow(24, "c", "d", "fuel", 5),
        flow(48, "a", "b", "water", 5),
      ],
      { total: 200, spent: 16, fundingBoundEvents: 3 },
      { flagged: 5, marketCount: 50 },
    );

    expect(summary.budgetSpentFrac).toBeCloseTo(0.08, 9);
    expect(summary.fundingBoundEvents).toBe(3);
    expect(summary.fundingBoundFlagSetRate).toBeCloseTo(0.1, 9);
    expect(summary.flowRowsPerCycle).toBeCloseTo(1.5, 9);
  });
});
