import { describe, expect, it } from "vitest";
import {
  buildAdjacencyList,
  bfsReachable,
  computeVisibilitySet,
  SENSOR_RANGE,
} from "../visibility";

// ── buildAdjacencyList ──────────────────────────────────────────

describe("buildAdjacencyList", () => {
  it("returns empty map for empty connections", () => {
    const adj = buildAdjacencyList([]);
    expect(adj.size).toBe(0);
  });

  it("creates entries for a single connection", () => {
    const adj = buildAdjacencyList([{ fromSystemId: "A", toSystemId: "B" }]);
    expect(adj.get("A")).toEqual(["B"]);
    expect(adj.get("B")).toEqual(["A"]);
  });

  it("is bidirectional", () => {
    const adj = buildAdjacencyList([{ fromSystemId: "X", toSystemId: "Y" }]);
    expect(adj.get("X")).toContain("Y");
    expect(adj.get("Y")).toContain("X");
  });

  it("handles multiple connections from a single node", () => {
    const adj = buildAdjacencyList([
      { fromSystemId: "A", toSystemId: "B" },
      { fromSystemId: "A", toSystemId: "C" },
      { fromSystemId: "A", toSystemId: "D" },
    ]);
    expect(adj.get("A")).toEqual(["B", "C", "D"]);
    expect(adj.get("B")).toEqual(["A"]);
    expect(adj.get("C")).toEqual(["A"]);
    expect(adj.get("D")).toEqual(["A"]);
  });

  it("handles chain topology", () => {
    const adj = buildAdjacencyList([
      { fromSystemId: "A", toSystemId: "B" },
      { fromSystemId: "B", toSystemId: "C" },
      { fromSystemId: "C", toSystemId: "D" },
    ]);
    expect(adj.get("A")).toEqual(["B"]);
    expect(adj.get("B")).toEqual(expect.arrayContaining(["A", "C"]));
    expect(adj.get("C")).toEqual(expect.arrayContaining(["B", "D"]));
    expect(adj.get("D")).toEqual(["C"]);
  });
});

// ── bfsReachable ────────────────────────────────────────────────

describe("bfsReachable", () => {
  // A -- B -- C -- D -- E (linear chain)
  const chainAdj = buildAdjacencyList([
    { fromSystemId: "A", toSystemId: "B" },
    { fromSystemId: "B", toSystemId: "C" },
    { fromSystemId: "C", toSystemId: "D" },
    { fromSystemId: "D", toSystemId: "E" },
  ]);

  it("depth 0 returns only start system", () => {
    const result = bfsReachable("A", chainAdj, 0);
    expect(result).toEqual(new Set(["A"]));
  });

  it("depth 1 returns start + immediate neighbors", () => {
    const result = bfsReachable("B", chainAdj, 1);
    expect(result).toEqual(new Set(["B", "A", "C"]));
  });

  it("depth 2 on linear chain reaches 2 hops out", () => {
    const result = bfsReachable("A", chainAdj, 2);
    expect(result).toEqual(new Set(["A", "B", "C"]));
  });

  it("depth 3 on linear chain reaches 3 hops out", () => {
    const result = bfsReachable("A", chainAdj, 3);
    expect(result).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("handles star topology", () => {
    //   B
    //   |
    // C-A-D
    //   |
    //   E
    const starAdj = buildAdjacencyList([
      { fromSystemId: "A", toSystemId: "B" },
      { fromSystemId: "A", toSystemId: "C" },
      { fromSystemId: "A", toSystemId: "D" },
      { fromSystemId: "A", toSystemId: "E" },
    ]);
    const result = bfsReachable("A", starAdj, 1);
    expect(result).toEqual(new Set(["A", "B", "C", "D", "E"]));
  });

  it("handles cycle without infinite loop", () => {
    // A -- B -- C -- A (triangle)
    const cycleAdj = buildAdjacencyList([
      { fromSystemId: "A", toSystemId: "B" },
      { fromSystemId: "B", toSystemId: "C" },
      { fromSystemId: "C", toSystemId: "A" },
    ]);
    const result = bfsReachable("A", cycleAdj, 1);
    expect(result).toEqual(new Set(["A", "B", "C"]));
  });

  it("disconnected systems are not reached", () => {
    // A -- B    C -- D (two separate components)
    const adj = buildAdjacencyList([
      { fromSystemId: "A", toSystemId: "B" },
      { fromSystemId: "C", toSystemId: "D" },
    ]);
    const result = bfsReachable("A", adj, 10);
    expect(result).toEqual(new Set(["A", "B"]));
    expect(result.has("C")).toBe(false);
    expect(result.has("D")).toBe(false);
  });

  it("returns empty set for unknown start system", () => {
    const result = bfsReachable("UNKNOWN", chainAdj, 5);
    expect(result).toEqual(new Set());
  });

  it("large depth on small graph returns all connected nodes", () => {
    const result = bfsReachable("A", chainAdj, 100);
    expect(result).toEqual(new Set(["A", "B", "C", "D", "E"]));
  });
});

// ── computeVisibilitySet ────────────────────────────────────────

describe("computeVisibilitySet", () => {
  // A -- B -- C -- D -- E -- F -- G (linear chain)
  const adj = buildAdjacencyList([
    { fromSystemId: "A", toSystemId: "B" },
    { fromSystemId: "B", toSystemId: "C" },
    { fromSystemId: "C", toSystemId: "D" },
    { fromSystemId: "D", toSystemId: "E" },
    { fromSystemId: "E", toSystemId: "F" },
    { fromSystemId: "F", toSystemId: "G" },
  ]);

  it("returns empty set for no ships", () => {
    const result = computeVisibilitySet([], adj);
    expect(result.size).toBe(0);
  });

  it("scout sees 3 hops (SENSOR_RANGE.scout)", () => {
    expect(SENSOR_RANGE.scout).toBe(3);
    const result = computeVisibilitySet(
      [{ systemId: "A", role: "scout" }],
      adj,
    );
    expect(result).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("trade sees 2 hops (SENSOR_RANGE.trade)", () => {
    expect(SENSOR_RANGE.trade).toBe(2);
    const result = computeVisibilitySet(
      [{ systemId: "A", role: "trade" }],
      adj,
    );
    expect(result).toEqual(new Set(["A", "B", "C"]));
  });

  it("combat sees 1 hop (SENSOR_RANGE.combat)", () => {
    expect(SENSOR_RANGE.combat).toBe(1);
    const result = computeVisibilitySet(
      [{ systemId: "A", role: "combat" }],
      adj,
    );
    expect(result).toEqual(new Set(["A", "B"]));
  });

  it("multiple ships produce a union of their ranges", () => {
    const result = computeVisibilitySet(
      [
        { systemId: "A", role: "combat" },  // sees A, B
        { systemId: "G", role: "combat" },  // sees G, F
      ],
      adj,
    );
    expect(result).toEqual(new Set(["A", "B", "F", "G"]));
  });

  it("overlapping ranges are deduplicated", () => {
    const result = computeVisibilitySet(
      [
        { systemId: "C", role: "trade" },  // sees A,B,C,D,E
        { systemId: "D", role: "trade" },  // sees B,C,D,E,F
      ],
      adj,
    );
    // Union: A through F
    expect(result).toEqual(new Set(["A", "B", "C", "D", "E", "F"]));
  });

  it("ships at same system don't double-count", () => {
    const result = computeVisibilitySet(
      [
        { systemId: "A", role: "combat" },
        { systemId: "A", role: "scout" },
      ],
      adj,
    );
    // Combat: A,B. Scout: A,B,C,D. Union: A,B,C,D
    expect(result).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("mixed roles use per-ship range", () => {
    const result = computeVisibilitySet(
      [
        { systemId: "A", role: "stealth" },  // 1 hop: A,B
        { systemId: "G", role: "support" },  // 2 hops: G,F,E
      ],
      adj,
    );
    expect(result).toEqual(new Set(["A", "B", "E", "F", "G"]));
  });
});
