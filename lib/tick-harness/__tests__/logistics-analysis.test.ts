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

describe("summarizeLogistics", () => {
  it("reports a silent run as zeroes, not NaN", () => {
    // The failure this metric exists to catch: directed-logistics ran every tick
    // and moved nothing (the Math.floor bug quantized every transfer to 0). The
    // mean must not divide by zero — JSON.stringify renders NaN as null, which
    // would read as "not measured" rather than "measured, and it is broken".
    const summary = summarizeLogistics([]);

    expect(summary.transferCount).toBe(0);
    expect(summary.activeTicks).toBe(0);
    expect(summary.totalQuantity).toBe(0);
    expect(summary.meanTransferSize).toBe(0);
    expect(summary.participatingSystems).toBe(0);
    expect(summary.byGood).toEqual([]);
  });

  it("totals transfer count, quantity, and mean size across the run", () => {
    const summary = summarizeLogistics([
      flow(24, "a", "b", "water", 10),
      flow(48, "a", "b", "water", 30),
    ]);

    expect(summary.transferCount).toBe(2);
    expect(summary.totalQuantity).toBe(40);
    expect(summary.meanTransferSize).toBe(20);
  });

  it("counts ticks that carried a transfer, not transfers", () => {
    // Logistics resolves on a monthly pulse, so a healthy run shows a recurring
    // rhythm. Three flows across two ticks is two active ticks.
    const summary = summarizeLogistics([
      flow(24, "a", "b", "water", 5),
      flow(24, "c", "d", "fuel", 5),
      flow(48, "a", "b", "water", 5),
    ]);

    expect(summary.activeTicks).toBe(2);
  });

  it("counts each participating system once, whether it sent or received", () => {
    // "b" both receives and sends: a→b, b→c is three distinct systems, not four.
    const summary = summarizeLogistics([
      flow(24, "a", "b", "water", 5),
      flow(48, "b", "c", "water", 5),
    ]);

    expect(summary.participatingSystems).toBe(3);
  });

  it("aggregates per good, heaviest first, omitting goods that never moved", () => {
    const summary = summarizeLogistics([
      flow(24, "a", "b", "water", 5),
      flow(24, "a", "b", "fuel", 100),
      flow(48, "a", "b", "water", 5),
    ]);

    expect(summary.byGood).toEqual([
      { goodId: "fuel", transferCount: 1, quantity: 100 },
      { goodId: "water", transferCount: 2, quantity: 10 },
    ]);
  });
});
