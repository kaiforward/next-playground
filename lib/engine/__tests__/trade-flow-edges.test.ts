import { describe, it, expect } from "vitest";
import { buildLaneFlowEdges, type LaneFlowRow } from "@/lib/engine/trade-flow-edges";

function row(p: Partial<LaneFlowRow> & Pick<LaneFlowRow, "fromSystemId" | "routeEdges">): LaneFlowRow {
  return { goodId: "food", quantity: 10, ...p };
}

describe("buildLaneFlowEdges", () => {
  it("reads zero edges from an empty ledger", () => {
    expect(buildLaneFlowEdges([], 1)).toHaveLength(0);
  });

  it("emits one directed edge per lane crossed by a single-hop haul", () => {
    const edges = buildLaneFlowEdges(
      [row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: 12 })],
      5,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ laneKey: "A|B", fromSystemId: "A", toSystemId: "B", totalVolume: 12 });
  });

  it("emits one edge PER LANE for a multi-hop route — no chord between origin and destination", () => {
    // A -> B -> C, over lanes A|B and B|C.
    const edges = buildLaneFlowEdges(
      [row({ fromSystemId: "A", routeEdges: ["A|B", "B|C"], quantity: 10 })],
      1,
    );
    expect(edges).toHaveLength(2);
    const byLane = new Map(edges.map((e) => [e.laneKey, e]));
    expect(byLane.get("A|B")).toMatchObject({ fromSystemId: "A", toSystemId: "B", totalVolume: 10 });
    expect(byLane.get("B|C")).toMatchObject({ fromSystemId: "B", toSystemId: "C", totalVolume: 10 });
    // Never a chord A->C.
    expect(byLane.has("A|C")).toBe(false);
  });

  it("sums multiple hauls crossing the same lane in the same direction", () => {
    const edges = buildLaneFlowEdges(
      [
        row({ fromSystemId: "A", routeEdges: ["A|B"], goodId: "food", quantity: 12 }),
        row({ fromSystemId: "A", routeEdges: ["A|B"], goodId: "alloys", quantity: 20 }),
      ],
      1,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].totalVolume).toBe(32);
    expect(edges[0].dominantGoodId).toBe("alloys");
  });

  it("keeps opposite directions over the same lane as separate edges", () => {
    const edges = buildLaneFlowEdges(
      [
        row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: 10 }),
        row({ fromSystemId: "B", routeEdges: ["A|B"], quantity: 4 }),
      ],
      1,
    );
    expect(edges).toHaveLength(2);
    const forward = edges.find((e) => e.fromSystemId === "A");
    const reverse = edges.find((e) => e.fromSystemId === "B");
    expect(forward).toMatchObject({ toSystemId: "B", totalVolume: 10 });
    expect(reverse).toMatchObject({ toSystemId: "A", totalVolume: 4 });
  });

  it("drops an edge below the render floor and keeps one at or above it", () => {
    expect(buildLaneFlowEdges([row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: 2 })], 5)).toHaveLength(0);
    expect(buildLaneFlowEdges([row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: 6 })], 5)).toHaveLength(1);
  });

  it("ignores rows with non-positive quantity", () => {
    const edges = buildLaneFlowEdges(
      [
        row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: 0 }),
        row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: -5 }),
        row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: 10 }),
      ],
      1,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].totalVolume).toBe(10);
  });
});
