import { describe, it, expect } from "vitest";
import { buildFlowEdges, type RawFlowRow } from "@/lib/engine/trade-flow-edges";

const VISIBLE = new Set(["A", "B", "C"]);

function row(p: Partial<RawFlowRow> & Pick<RawFlowRow, "fromSystemId" | "toSystemId">): RawFlowRow {
  return { goodId: "food", quantity: 10, ...p };
}

describe("buildFlowEdges", () => {
  it("collapses multiple goods on one endpoint pair into a single edge, keyed by the dominant good", () => {
    const edges = buildFlowEdges(
      [
        row({ fromSystemId: "A", toSystemId: "B", goodId: "food", quantity: 12 }),
        row({ fromSystemId: "A", toSystemId: "B", goodId: "alloys", quantity: 20 }),
      ],
      VISIBLE,
      5,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].dominantGoodId).toBe("alloys");
    expect(edges[0].totalVolume).toBe(32);
  });

  it("drops an edge below the render floor and keeps one at or above it", () => {
    expect(buildFlowEdges([row({ fromSystemId: "A", toSystemId: "B", quantity: 2 })], VISIBLE, 5)).toHaveLength(0);
    expect(buildFlowEdges([row({ fromSystemId: "A", toSystemId: "B", quantity: 6 })], VISIBLE, 5)).toHaveLength(1);
  });

  it("orients the edge from→to by the dominant good's net direction", () => {
    // Net flow B→A dominates, so the edge points B→A even though A<B canonically.
    const edges = buildFlowEdges(
      [
        row({ fromSystemId: "B", toSystemId: "A", quantity: 30 }),
        row({ fromSystemId: "A", toSystemId: "B", quantity: 5 }),
      ],
      VISIBLE,
      5,
    );
    expect(edges[0].fromSystemId).toBe("B");
    expect(edges[0].toSystemId).toBe("A");
    expect(edges[0].totalVolume).toBe(35);
  });

  it("drops an edge with no visible endpoint", () => {
    const edges = buildFlowEdges([row({ fromSystemId: "X", toSystemId: "Y", quantity: 50 })], VISIBLE, 5);
    expect(edges).toHaveLength(0);
  });

  it("ignores rows with non-positive quantity", () => {
    const edges = buildFlowEdges(
      [
        row({ fromSystemId: "A", toSystemId: "B", quantity: 0 }),
        row({ fromSystemId: "A", toSystemId: "B", quantity: -5 }),
        row({ fromSystemId: "A", toSystemId: "B", quantity: 10 }),
      ],
      VISIBLE,
      5,
    );
    // The 0 and -5 rows are dropped by the `quantity <= 0` guard, so the edge's
    // volume is 10 — not 5 (which is what counting the -5 row would give).
    expect(edges).toHaveLength(1);
    expect(edges[0].totalVolume).toBe(10);
  });

  it("falls back to canonical order when the dominant good's net flow is balanced", () => {
    // Equal forward/reverse on the dominant good → dominantNet === 0 → A→B.
    const edges = buildFlowEdges(
      [
        row({ fromSystemId: "A", toSystemId: "B", quantity: 10 }),
        row({ fromSystemId: "B", toSystemId: "A", quantity: 10 }),
      ],
      VISIBLE,
      5,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].fromSystemId).toBe("A");
    expect(edges[0].toSystemId).toBe("B");
    expect(edges[0].totalVolume).toBe(20);
  });
});
