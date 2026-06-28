import { describe, it, expect } from "vitest";
import { buildFlowEdges, type RawFlowRow } from "@/lib/engine/trade-flow-edges";

const VISIBLE = new Set(["A", "B", "C"]);

function row(p: Partial<RawFlowRow> & Pick<RawFlowRow, "fromSystemId" | "toSystemId">): RawFlowRow {
  return { goodId: "food", quantity: 10, flowType: "market", ...p };
}

describe("buildFlowEdges", () => {
  it("partitions the same endpoint pair into separate market and logistics edges", () => {
    const { marketEdges, logisticsEdges } = buildFlowEdges(
      [
        row({ fromSystemId: "A", toSystemId: "B", flowType: "market", quantity: 12 }),
        row({ fromSystemId: "A", toSystemId: "B", flowType: "logistics", quantity: 20, goodId: "alloys" }),
      ],
      VISIBLE,
      5,
      1,
    );
    expect(marketEdges).toHaveLength(1);
    expect(logisticsEdges).toHaveLength(1);
    expect(marketEdges[0].dominantGoodId).toBe("food");
    expect(logisticsEdges[0].dominantGoodId).toBe("alloys");
  });

  it("applies the lower logistics floor — admits an edge the market floor would drop", () => {
    const rows = [row({ fromSystemId: "A", toSystemId: "B", flowType: "logistics", quantity: 2 })];
    const { logisticsEdges } = buildFlowEdges(rows, VISIBLE, 5, 1);
    expect(logisticsEdges).toHaveLength(1);
    // Same magnitude as a market flow would be dropped by the market floor of 5.
    const { marketEdges } = buildFlowEdges(
      [row({ fromSystemId: "A", toSystemId: "B", flowType: "market", quantity: 2 })],
      VISIBLE,
      5,
      1,
    );
    expect(marketEdges).toHaveLength(0);
  });

  it("orients the edge from→to by the dominant good's net direction", () => {
    // Net flow B→A dominates, so the edge points B→A even though A<B canonically.
    const { marketEdges } = buildFlowEdges(
      [
        row({ fromSystemId: "B", toSystemId: "A", quantity: 30 }),
        row({ fromSystemId: "A", toSystemId: "B", quantity: 5 }),
      ],
      VISIBLE,
      5,
      1,
    );
    expect(marketEdges[0].fromSystemId).toBe("B");
    expect(marketEdges[0].toSystemId).toBe("A");
    expect(marketEdges[0].totalVolume).toBe(35);
  });

  it("drops an edge with no visible endpoint", () => {
    const { marketEdges } = buildFlowEdges(
      [row({ fromSystemId: "X", toSystemId: "Y", quantity: 50 })],
      VISIBLE,
      5,
      1,
    );
    expect(marketEdges).toHaveLength(0);
  });
});
