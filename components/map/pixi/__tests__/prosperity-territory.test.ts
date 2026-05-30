import { describe, it, expect } from "vitest";
import { Delaunay } from "d3-delaunay";
import { computeTerritoryPolygons } from "@/components/map/pixi/territory-utils";

describe("per-system Voronoi grouping (prosperity choropleth geometry)", () => {
  it("produces one polygon group per system when keyed by id", () => {
    const pts: [number, number][] = [
      [100, 100], [900, 100], [500, 900], [500, 500],
    ];
    const ids = ["a", "b", "c", "d"];
    const voronoi = Delaunay.from(pts).voronoi([0, 0, 1000, 1000]);
    const cells = computeTerritoryPolygons(pts.length, voronoi, (i) => ids[i]);
    expect(cells.size).toBe(4);
    for (const id of ids) {
      const poly = cells.get(id);
      expect(poly).toBeDefined();
      if (!poly) continue;
      // single cell wrapped as one MultiPolygon (one poly, one exterior ring)
      expect(poly.length).toBe(1);
      // a closed Voronoi ring has ≥3 distinct vertices plus a closing point
      expect(poly[0][0].length).toBeGreaterThanOrEqual(4);
    }
  });

  it("unions adjacent cells that share a group key into one territory", () => {
    // Two left points share key "left"; two right points share key "right".
    // Each side's cells are adjacent, so the union path (rings.length > 1)
    // merges them into a single contiguous polygon per group.
    const pts: [number, number][] = [
      [200, 300], [200, 700], [800, 300], [800, 700],
    ];
    const keys = ["left", "left", "right", "right"];
    const voronoi = Delaunay.from(pts).voronoi([0, 0, 1000, 1000]);
    const cells = computeTerritoryPolygons(pts.length, voronoi, (i) => keys[i]);

    expect(cells.size).toBe(2);
    const left = cells.get("left");
    const right = cells.get("right");
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (!left || !right) return;
    // Merged: each group is one polygon (a single exterior ring), not two cells.
    expect(left.length).toBe(1);
    expect(right.length).toBe(1);
    expect(left[0][0].length).toBeGreaterThanOrEqual(4);
  });

  it("skips systems whose group key is null", () => {
    const pts: [number, number][] = [
      [100, 100], [900, 100], [500, 900],
    ];
    const keys = ["a", null, "c"];
    const voronoi = Delaunay.from(pts).voronoi([0, 0, 1000, 1000]);
    const cells = computeTerritoryPolygons(pts.length, voronoi, (i) => keys[i]);

    // The middle system (null key) is excluded; only "a" and "c" produce groups.
    expect(cells.size).toBe(2);
    expect(cells.has("a")).toBe(true);
    expect(cells.has("c")).toBe(true);
    expect(cells.has("b")).toBe(false);
  });
});
