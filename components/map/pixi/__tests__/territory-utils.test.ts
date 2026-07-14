import { describe, it, expect } from "vitest";
import { Delaunay } from "d3-delaunay";
import {
  computeTerritoryPolygons,
  clipPolygonToDisc,
} from "@/components/map/pixi/territory-utils";

describe("computeTerritoryPolygons (per-system Voronoi grouping)", () => {
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

  it("clips a cell to a disc, bounding every output vertex within the radius", () => {
    // A 1000×1000 square fully contains a small disc at its centre, so the
    // intersection is the disc n-gon itself — every vertex sits within `radius`.
    const square: [number, number][] = [
      [0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0],
    ];
    const result = clipPolygonToDisc(square, 500, 500, 100, 24);

    const verts = result.flat(2);
    expect(verts.length).toBeGreaterThanOrEqual(3);
    for (const [x, y] of verts) {
      expect(Math.hypot(x - 500, y - 500)).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it("clips edge cells so territory never reaches the far box corners", () => {
    // A 5×5 grid clustered in the centre of a large box. Without edge clipping,
    // the perimeter cells extend all the way to the box corners (0,0)/(10000,
    // 10000) as boxy spurs. With clipping they round off near the systems.
    const pts: [number, number][] = [];
    const ids: string[] = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        pts.push([4000 + c * 500, 4000 + r * 500]);
        ids.push(`s${r}-${c}`);
      }
    }
    const voronoi = Delaunay.from(pts).voronoi([0, 0, 10000, 10000]);
    const cells = computeTerritoryPolygons(pts.length, voronoi, (i) => ids[i]);

    // Median nearest-neighbour spacing is 500; with any sane radius factor the
    // clipped territory stays well inside this window and clear of the corners.
    const verts = [...cells.values()].flat(3);
    expect(verts.length).toBeGreaterThan(0);
    for (const [x, y] of verts) {
      expect(x).toBeGreaterThan(1500);
      expect(x).toBeLessThan(8500);
      expect(y).toBeGreaterThan(1500);
      expect(y).toBeLessThan(8500);
    }
  });

  it("clips an interior cell that balloons into a sparse void without ever touching the box", () => {
    // A tight 3×3 grid (spacing 50) plus one lone site ~8000 units to the right, all well inside a large
    // box. The grid's middle-right cell balloons rightward toward the lone site's bisector (~3900 units
    // away) with NO vertex anywhere near the box — the exact case the old box-vertex-only clip test
    // missed. The extent-based clip (any vertex past ~DISC_RADIUS_FACTOR × the median nearest-neighbour
    // spacing) trims it, so every output vertex stays within the clip radius of its own site. Un-clipped,
    // that vertex would sit ~3900 units out; here it must land within ~1.25× the 50-unit spacing.
    const SPACING = 50;
    const CLIP_RADIUS = 1.25 * SPACING; // DISC_RADIUS_FACTOR × median nearest-neighbour spacing
    const pts: [number, number][] = [];
    const ids: string[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        pts.push([50000 + c * SPACING, 50000 + r * SPACING]);
        ids.push(`g${r}-${c}`);
      }
    }
    pts.push([58000, 50000]); // lone site — the void the grid balloons into (median NN stays 50)
    ids.push("lone");

    const voronoi = Delaunay.from(pts).voronoi([0, 0, 100000, 100000]);
    const cells = computeTerritoryPolygons(pts.length, voronoi, (i) => ids[i]);

    for (let i = 0; i < pts.length; i++) {
      const [sx, sy] = pts[i];
      const poly = cells.get(ids[i]);
      expect(poly).toBeDefined();
      if (!poly) continue;
      for (const [x, y] of poly.flat(2)) {
        expect(Math.hypot(x - sx, y - sy)).toBeLessThan(CLIP_RADIUS * 1.5);
      }
    }
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
