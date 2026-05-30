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
      // single cell wrapped as one MultiPolygon (one poly, one exterior ring)
      expect(poly!.length).toBe(1);
      expect(poly![0][0].length).toBeGreaterThanOrEqual(3);
    }
  });
});
