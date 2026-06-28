import { describe, it, expect } from "vitest";
import {
  bucketizeVolumeHistory,
  type SystemFlowRow,
} from "@/lib/engine/system-trade-flow";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

const SYS = "sys-self";
const A = "sys-A";
const B = "sys-B";

// ── bucketizeVolumeHistory ────────────────────────────────────

describe("bucketizeVolumeHistory", () => {
  const W = TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  it("produces exactly 20 buckets covering the FLOW_HISTORY_TICKS window", () => {
    const buckets = bucketizeVolumeHistory([], SYS, 1000);
    expect(buckets).toHaveLength(20);
    // First bucket's right edge is one bucketSize below the second's, etc.
    const bucketSize = Math.ceil(W / 20);
    expect(buckets[1].tick - buckets[0].tick).toBe(bucketSize);
    // Last bucket's right edge should be at or just past currentTick.
    expect(buckets.at(-1)!.tick).toBeGreaterThanOrEqual(1000);
  });

  it("places imports and exports in their correct buckets", () => {
    const currentTick = 1000;
    const flows: SystemFlowRow[] = [
      // Newest tick — last bucket
      { tick: 1000, goodId: "food", quantity: 5, fromSystemId: A, toSystemId: SYS },
      // Newest tick — last bucket, outbound
      { tick: 999, goodId: "food", quantity: 3, fromSystemId: SYS, toSystemId: A },
    ];
    const buckets = bucketizeVolumeHistory(flows, SYS, currentTick);
    expect(buckets.at(-1)!.importVolume).toBe(5);
    expect(buckets.at(-1)!.exportVolume).toBe(3);
  });

  it("ignores flows older than the window", () => {
    const currentTick = 1000;
    const flows: SystemFlowRow[] = [
      { tick: 1000 - W - 50, goodId: "food", quantity: 99, fromSystemId: A, toSystemId: SYS },
    ];
    const buckets = bucketizeVolumeHistory(flows, SYS, currentTick);
    const totalImports = buckets.reduce((s, b) => s + b.importVolume, 0);
    expect(totalImports).toBe(0);
  });

  it("ignores flows where the system is neither endpoint", () => {
    const flows: SystemFlowRow[] = [
      { tick: 1000, goodId: "food", quantity: 99, fromSystemId: A, toSystemId: B },
    ];
    const buckets = bucketizeVolumeHistory(flows, SYS, 1000);
    const total = buckets.reduce(
      (s, b) => s + b.importVolume + b.exportVolume,
      0,
    );
    expect(total).toBe(0);
  });

  it("distributes flows across multiple buckets", () => {
    const currentTick = 1000;
    const bucketSize = Math.ceil(W / 20);
    const flows: SystemFlowRow[] = [];
    // One inbound flow per bucket, increasing quantity, at the bucket's right edge.
    for (let i = 0; i < 20; i++) {
      const bucketRightEdge = currentTick - bucketSize * (19 - i);
      flows.push({
        tick: bucketRightEdge,
        goodId: "food",
        quantity: i + 1,
        fromSystemId: A,
        toSystemId: SYS,
      });
    }
    const buckets = bucketizeVolumeHistory(flows, SYS, currentTick);
    expect(buckets.map((b) => b.importVolume)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it("returns zero-filled buckets when no flows occurred", () => {
    const buckets = bucketizeVolumeHistory([], SYS, 1000);
    for (const b of buckets) {
      expect(b.importVolume).toBe(0);
      expect(b.exportVolume).toBe(0);
    }
  });
});
