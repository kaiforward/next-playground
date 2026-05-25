import { describe, it, expect } from "vitest";
import {
  bucketizeVolumeHistory,
  rankGoodFlows,
  type SystemFlowRow,
} from "@/lib/engine/system-trade-flow";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

const SYS = "sys-self";
const A = "sys-A";
const B = "sys-B";
const C = "sys-C";

function inbound(goodId: string, partner: string, qty: number, tick = 100): SystemFlowRow {
  return { tick, goodId, quantity: qty, fromSystemId: partner, toSystemId: SYS };
}
function outbound(goodId: string, partner: string, qty: number, tick = 100): SystemFlowRow {
  return { tick, goodId, quantity: qty, fromSystemId: SYS, toSystemId: partner };
}
const resolveName = (id: string) => `Name(${id})`;

// ── rankGoodFlows ─────────────────────────────────────────────

describe("rankGoodFlows", () => {
  it("returns empty when no flows", () => {
    expect(rankGoodFlows([], (f) => f.fromSystemId, resolveName)).toEqual([]);
  });

  it("aggregates per good and sorts by total quantity descending", () => {
    const flows = [
      inbound("food", A, 10),
      inbound("food", B, 5),
      inbound("metals", A, 20),
      inbound("water", A, 100),
    ];
    const ranked = rankGoodFlows(flows, (f) => f.fromSystemId, resolveName);
    expect(ranked.map((g) => g.goodId)).toEqual(["water", "metals", "food"]);
    expect(ranked.map((g) => g.totalQuantity)).toEqual([100, 20, 15]);
  });

  it("ranks partner systems within each good", () => {
    const flows = [
      inbound("food", A, 30),
      inbound("food", B, 10),
      inbound("food", C, 50),
    ];
    const [food] = rankGoodFlows(flows, (f) => f.fromSystemId, resolveName);
    expect(food.partners.map((p) => p.systemId)).toEqual([C, A, B]);
    expect(food.partners.map((p) => p.quantity)).toEqual([50, 30, 10]);
  });

  it("resolves partner names from the provided lookup", () => {
    const flows = [inbound("food", A, 1)];
    const [food] = rankGoodFlows(flows, (f) => f.fromSystemId, resolveName);
    expect(food.partners[0].systemName).toBe("Name(sys-A)");
  });

  it("populates goodName from the GOODS constant", () => {
    const flows = [inbound("food", A, 1)];
    const [food] = rankGoodFlows(flows, (f) => f.fromSystemId, resolveName);
    expect(food.goodName).toBe("Food");
  });

  it("falls back to goodId when the constant is unknown", () => {
    const flows = [inbound("zorblax", A, 1)];
    const [zorb] = rankGoodFlows(flows, (f) => f.fromSystemId, resolveName);
    expect(zorb.goodName).toBe("zorblax");
  });

  it("uses the partner-id selector to differentiate import vs export", () => {
    // Outbound flows: partner is the destination (toSystemId), not fromSystemId.
    const flows = [outbound("food", A, 40), outbound("food", B, 10)];
    const ranked = rankGoodFlows(flows, (f) => f.toSystemId, resolveName);
    expect(ranked[0].partners.map((p) => p.systemId)).toEqual([A, B]);
  });

  it("caps at top 5 goods", () => {
    const flows: SystemFlowRow[] = [
      "food",
      "water",
      "ore",
      "metals",
      "fuel",
      "chemicals",
      "medicine",
    ].map((g, i) => inbound(g, A, 100 - i));
    const ranked = rankGoodFlows(flows, (f) => f.fromSystemId, resolveName);
    expect(ranked).toHaveLength(5);
  });

  it("caps at top 3 partners per good", () => {
    const flows = [
      inbound("food", "p1", 50),
      inbound("food", "p2", 40),
      inbound("food", "p3", 30),
      inbound("food", "p4", 20),
      inbound("food", "p5", 10),
    ];
    const [food] = rankGoodFlows(flows, (f) => f.fromSystemId, resolveName);
    expect(food.partners).toHaveLength(3);
    expect(food.partners.map((p) => p.systemId)).toEqual(["p1", "p2", "p3"]);
  });

  it("ignores zero or negative quantities", () => {
    const flows = [
      inbound("food", A, 0),
      inbound("food", B, -5),
      inbound("food", C, 7),
    ];
    const ranked = rankGoodFlows(flows, (f) => f.fromSystemId, resolveName);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].totalQuantity).toBe(7);
    expect(ranked[0].partners.map((p) => p.systemId)).toEqual([C]);
  });
});

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
