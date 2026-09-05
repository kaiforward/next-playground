import { describe, it, expect } from "vitest";
import { buildLaneFlowEdges, type LaneFlowRow } from "@/lib/engine/trade-flow-edges";

function row(
  p: Partial<LaneFlowRow> & Pick<LaneFlowRow, "fromSystemId" | "routeEdges">,
): LaneFlowRow {
  return { goodId: "food", quantity: 10, dispatchTick: 0, arrivalTick: 100, ...p };
}

/** Every fixture row above dispatches at 0 and arrives at 100 — at `tick: 0` with zero fuel cost
 *  per hop, `currentHopIndex` reports hop 0 for any route, so a single call to this helper is
 *  the right "read it now" point for every existing-behaviour test below. */
function build(rows: ReadonlyArray<LaneFlowRow>, floor: number, tick = 0) {
  return buildLaneFlowEdges(rows, floor, tick, (r) => r.routeEdges.map(() => 0), 1);
}

describe("buildLaneFlowEdges", () => {
  it("reads zero edges from an empty ledger", () => {
    expect(build([], 1)).toHaveLength(0);
  });

  it("emits one directed edge per lane crossed by a single-hop haul", () => {
    const edges = build(
      [row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: 12 })],
      5,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ laneKey: "A|B", fromSystemId: "A", toSystemId: "B", totalVolume: 12 });
  });

  it("emits an edge only on the CURRENT hop of a multi-hop route — never every lane it will cross", () => {
    // A -> B -> C, over lanes A|B and B|C, each hop costing 10 fuel at speed 1: hop0 starts at
    // dispatch (tick 0), hop1 starts at tick 10, arrival at tick 20.
    const haul = row({
      fromSystemId: "A", routeEdges: ["A|B", "B|C"], quantity: 10, dispatchTick: 0, arrivalTick: 20,
    });
    const hopFuelCostsOf = () => [10, 10];

    const beforeSecondHop = buildLaneFlowEdges([haul], 1, 5, hopFuelCostsOf, 1);
    expect(beforeSecondHop).toHaveLength(1);
    expect(beforeSecondHop[0]).toMatchObject({ laneKey: "A|B", fromSystemId: "A", toSystemId: "B", totalVolume: 10 });

    const onSecondHop = buildLaneFlowEdges([haul], 1, 12, hopFuelCostsOf, 1);
    expect(onSecondHop).toHaveLength(1);
    expect(onSecondHop[0]).toMatchObject({ laneKey: "B|C", fromSystemId: "B", toSystemId: "C", totalVolume: 10 });

    // Never a chord A->C, and never both hops lit at once.
    expect(onSecondHop.some((e) => e.laneKey === "A|C")).toBe(false);
  });

  it("emits nothing for a row that has already been drained (tick at or past arrivalTick)", () => {
    const haul = row({ fromSystemId: "A", routeEdges: ["A|B", "B|C"], quantity: 10, arrivalTick: 20 });
    expect(buildLaneFlowEdges([haul], 1, 20, () => [10, 10], 10)).toHaveLength(0);
  });

  it("sums multiple hauls crossing the same lane in the same direction", () => {
    const edges = build(
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
    const edges = build(
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
    expect(build([row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: 2 })], 5)).toHaveLength(0);
    expect(build([row({ fromSystemId: "A", routeEdges: ["A|B"], quantity: 6 })], 5)).toHaveLength(1);
  });

  it("ignores rows with non-positive quantity", () => {
    const edges = build(
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

  it("emits nothing for a discontiguous route rather than an edge pointing the wrong way", () => {
    // Hops A|B then C|D share no endpoint: after crossing A|B the haul stands at B, which is
    // neither end of C|D. The walk falls off the route, so the row contributes nothing — it must
    // never resolve to C and emit a C -> D edge for a haul that is nowhere near it.
    const haul = row({
      fromSystemId: "A", routeEdges: ["A|B", "C|D"], quantity: 10, dispatchTick: 0, arrivalTick: 20,
    });
    expect(buildLaneFlowEdges([haul], 1, 12, () => [10, 10], 1)).toHaveLength(0);
  });

  it("emits nothing when the CURRENT hop does not touch the walked-to position", () => {
    // A single-hop route the row does not start on: `fromSystemId` X is neither end of A|B.
    const haul = row({ fromSystemId: "X", routeEdges: ["A|B"], quantity: 10 });
    expect(build([haul], 1)).toHaveLength(0);
  });

  it("at a huge freight speed a fresh row arrives immediately and reads on no lane", () => {
    const haul = row({ fromSystemId: "A", routeEdges: ["A|B", "B|C"], quantity: 10, dispatchTick: 0, arrivalTick: 0 });
    expect(buildLaneFlowEdges([haul], 1, 0, () => [10, 10], 1_000_000)).toHaveLength(0);
  });
});
