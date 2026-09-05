import { describe, it, expect } from "vitest";
import { findLaneAt, findSystemNear, resolveMapClick } from "../lane-hit-test";

const SYSTEMS = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 100, y: 0 },
  { id: "c", x: 100, y: 100 },
];

const LANES = [
  { key: "a|b", aId: "a", bId: "b" },
  { key: "b|c", aId: "b", bId: "c" },
];

describe("findLaneAt", () => {
  it("selects a lane when the point is within tolerance of its segment", () => {
    expect(findLaneAt({ x: 50, y: 2 }, LANES, SYSTEMS, 5)).toBe("a|b");
  });

  it("returns null when the point is outside tolerance of every lane", () => {
    expect(findLaneAt({ x: 50, y: 50 }, LANES, SYSTEMS, 5)).toBeNull();
  });

  it("picks the closest lane when two lanes both fall within tolerance", () => {
    // Point sits nearer to a|b (y=0 lane) than b|c (x=100 lane) at the shared corner region.
    expect(findLaneAt({ x: 98, y: 1 }, LANES, SYSTEMS, 10)).toBe("a|b");
  });

  it("skips a lane whose endpoint is missing from the systems list", () => {
    const dangling = [{ key: "a|x", aId: "a", bId: "x" }];
    expect(findLaneAt({ x: 50, y: 0 }, dangling, SYSTEMS, 5)).toBeNull();
  });
});

describe("findSystemNear", () => {
  it("selects the system whose point is within radius", () => {
    expect(findSystemNear({ x: 1, y: 1 }, SYSTEMS, 5)).toBe("a");
  });

  it("returns null when no system point is within radius", () => {
    expect(findSystemNear({ x: 50, y: 50 }, SYSTEMS, 5)).toBeNull();
  });
});

describe("resolveMapClick — precedence", () => {
  it("faction wins over everything else when present", () => {
    const result = resolveMapClick({
      factionHit: "f1",
      systemNear: "a",
      laneAt: "a|b",
      cellSystemId: "b",
    });
    expect(result).toEqual({ kind: "faction", factionId: "f1" });
  });

  it("a system within the star's hover radius wins over a lane, even when both are candidates", () => {
    const result = resolveMapClick({
      factionHit: null,
      systemNear: "a",
      laneAt: "a|b",
      cellSystemId: "b",
    });
    expect(result).toEqual({ kind: "system", systemId: "a" });
  });

  it("a lane within tolerance wins over the ordinary cell hit-test when no star is close", () => {
    const result = resolveMapClick({
      factionHit: null,
      systemNear: null,
      laneAt: "a|b",
      cellSystemId: "b",
    });
    expect(result).toEqual({ kind: "lane", laneKey: "a|b" });
  });

  it("falls back to the cell hit-test when neither a star nor a lane is close", () => {
    const result = resolveMapClick({
      factionHit: null,
      systemNear: null,
      laneAt: null,
      cellSystemId: "b",
    });
    expect(result).toEqual({ kind: "system", systemId: "b" });
  });

  it("resolves empty when nothing hits", () => {
    const result = resolveMapClick({ factionHit: null, systemNear: null, laneAt: null, cellSystemId: null });
    expect(result).toEqual({ kind: "empty" });
  });
});
