import { describe, it, expect } from "vitest";
import { buildOpenEdges } from "../trade-flow-topology";

describe("buildOpenEdges", () => {
  it("keeps an edge between two systems of the same faction", () => {
    const sysFaction = new Map<string, string | null>([
      ["a", "f1"],
      ["b", "f1"],
    ]);
    const edges = buildOpenEdges([{ fromSystemId: "a", toSystemId: "b", fuelCost: 10 }], sysFaction);
    expect(edges).toEqual([{ aSystemId: "a", bSystemId: "b", fuelCost: 10 }]);
  });

  it("drops an edge across a faction border", () => {
    const sysFaction = new Map<string, string | null>([
      ["a", "f1"],
      ["b", "f2"],
    ]);
    const edges = buildOpenEdges([{ fromSystemId: "a", toSystemId: "b", fuelCost: 10 }], sysFaction);
    expect(edges).toEqual([]);
  });

  it("keeps an edge between two independent systems (null === null)", () => {
    const sysFaction = new Map<string, string | null>([
      ["a", null],
      ["b", null],
    ]);
    const edges = buildOpenEdges([{ fromSystemId: "a", toSystemId: "b", fuelCost: 7 }], sysFaction);
    expect(edges).toEqual([{ aSystemId: "a", bSystemId: "b", fuelCost: 7 }]);
  });

  it("drops an edge between an independent system and a faction system", () => {
    const sysFaction = new Map<string, string | null>([
      ["a", null],
      ["b", "f1"],
    ]);
    const edges = buildOpenEdges([{ fromSystemId: "a", toSystemId: "b", fuelCost: 10 }], sysFaction);
    expect(edges).toEqual([]);
  });

  it("drops a self-loop", () => {
    const sysFaction = new Map<string, string | null>([["a", "f1"]]);
    const edges = buildOpenEdges([{ fromSystemId: "a", toSystemId: "a", fuelCost: 10 }], sysFaction);
    expect(edges).toEqual([]);
  });

  it("dedupes a reciprocal pair of connections into one edge", () => {
    const sysFaction = new Map<string, string | null>([
      ["a", "f1"],
      ["b", "f1"],
    ]);
    const edges = buildOpenEdges(
      [
        { fromSystemId: "a", toSystemId: "b", fuelCost: 10 },
        { fromSystemId: "b", toSystemId: "a", fuelCost: 99 },
      ],
      sysFaction,
    );
    // One unordered edge; the first occurrence (a→b) wins.
    expect(edges).toEqual([{ aSystemId: "a", bSystemId: "b", fuelCost: 10 }]);
  });

  it("returns edges in stable sorted order by the '${a}|${b}' key", () => {
    const sysFaction = new Map<string, string | null>([
      ["a", "f1"],
      ["b", "f1"],
      ["c", "f1"],
      ["d", "f1"],
    ]);
    const edges = buildOpenEdges(
      [
        // Provide reversed/unsorted so the output ordering is a real assertion.
        { fromSystemId: "d", toSystemId: "c", fuelCost: 3 },
        { fromSystemId: "b", toSystemId: "a", fuelCost: 1 },
        { fromSystemId: "c", toSystemId: "a", fuelCost: 2 },
      ],
      sysFaction,
    );
    expect(edges.map((e) => `${e.aSystemId}|${e.bSystemId}`)).toEqual([
      "a|b",
      "a|c",
      "c|d",
    ]);
  });
});
