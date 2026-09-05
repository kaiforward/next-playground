import { describe, it, expect } from "vitest";
import { findLaneAt, indexSystemsById, resolveMapClick } from "../lane-hit-test";

const SYSTEMS = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 100, y: 0 },
  { id: "c", x: 100, y: 100 },
];

const SYSTEMS_BY_ID = indexSystemsById(SYSTEMS);

const LANES = [
  { key: "a|b", aId: "a", bId: "b" },
  { key: "b|c", aId: "b", bId: "c" },
];

describe("findLaneAt", () => {
  it("selects a lane when the point is within tolerance of its (gap-shortened) segment", () => {
    expect(findLaneAt({ x: 50, y: 2 }, LANES, SYSTEMS_BY_ID, 5, 10)).toBe("a|b");
  });

  it("returns null when the point is outside tolerance of every lane", () => {
    expect(findLaneAt({ x: 50, y: 50 }, LANES, SYSTEMS_BY_ID, 5, 10)).toBeNull();
  });

  it("picks the closest lane when two lanes both fall within tolerance", () => {
    // Point sits nearer to a|b (y=0 lane) than b|c (x=100 lane) at the shared corner region.
    expect(findLaneAt({ x: 98, y: 1 }, LANES, SYSTEMS_BY_ID, 10, 5)).toBe("a|b");
  });

  it("skips a lane whose endpoint is missing from the systems list", () => {
    const dangling = [{ key: "a|x", aId: "a", bId: "x" }];
    expect(findLaneAt({ x: 50, y: 0 }, dangling, SYSTEMS_BY_ID, 5, 10)).toBeNull();
  });

  it("a point at a star's centre, with a lane ending there, does not hit the lane when the gap is positive", () => {
    // a|b runs from (0,0) to (100,0); a point right at system a's centre is within the gap.
    expect(findLaneAt({ x: 0, y: 0 }, LANES, SYSTEMS_BY_ID, 5, 10)).toBeNull();
  });

  it("a point just inside the end gap does not resolve to the lane", () => {
    // 8 world units from a along a|b, gap is 10 — still inside the shortened-away stretch, and
    // farther from the shortened segment's start (x=10) than the tolerance allows.
    expect(findLaneAt({ x: 8, y: 0 }, LANES, SYSTEMS_BY_ID, 1, 10)).toBeNull();
  });

  it("a point mid-lane, well past the end gap, still resolves to the lane", () => {
    expect(findLaneAt({ x: 50, y: 0 }, LANES, SYSTEMS_BY_ID, 2, 10)).toBe("a|b");
  });

  it("a lane shorter than twice the gap is never hit, anywhere along it", () => {
    const short = [{ key: "a|near", aId: "a", bId: "near" }];
    const systemsWithNear = [...SYSTEMS, { id: "near", x: 15, y: 0 }]; // length 15, gap 10 -> 2*gap = 20
    expect(findLaneAt({ x: 7, y: 0 }, short, indexSystemsById(systemsWithNear), 5, 10)).toBeNull();
  });

  it("vacuity: with the gap forced to 0, the star-centre case flips to hitting the lane", () => {
    expect(findLaneAt({ x: 0, y: 0 }, LANES, SYSTEMS_BY_ID, 5, 0)).toBe("a|b");
  });
});

describe("resolveMapClick — precedence", () => {
  it("faction wins over everything else when present", () => {
    const result = resolveMapClick({
      factionHit: "f1",
      laneAt: "a|b",
      cellSystemId: "b",
    });
    expect(result).toEqual({ kind: "faction", factionId: "f1" });
  });

  it("a lane within tolerance wins over the ordinary cell hit-test", () => {
    const result = resolveMapClick({
      factionHit: null,
      laneAt: "a|b",
      cellSystemId: "b",
    });
    expect(result).toEqual({ kind: "lane", laneKey: "a|b" });
  });

  it("falls back to the cell hit-test when no lane is close", () => {
    const result = resolveMapClick({
      factionHit: null,
      laneAt: null,
      cellSystemId: "b",
    });
    expect(result).toEqual({ kind: "system", systemId: "b" });
  });

  it("resolves empty when nothing hits", () => {
    const result = resolveMapClick({ factionHit: null, laneAt: null, cellSystemId: null });
    expect(result).toEqual({ kind: "empty" });
  });

  it("a point at a star's centre resolves to the cell, not the lane, through the full precedence", () => {
    // Mirrors findLaneAt's own gap test: at (0,0), findLaneAt returns null with a positive gap, so
    // resolveMapClick falls through to the cell hit-test's answer.
    const laneAt = findLaneAt({ x: 0, y: 0 }, LANES, SYSTEMS_BY_ID, 5, 10);
    const result = resolveMapClick({ factionHit: null, laneAt, cellSystemId: "a" });
    expect(result).toEqual({ kind: "system", systemId: "a" });
  });
});
