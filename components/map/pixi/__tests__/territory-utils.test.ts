import { describe, it, expect } from "vitest";
import { Delaunay } from "d3-delaunay";
import { clipVoronoiCells, unionCellsByGroup, ghostSites } from "@/components/map/pixi/territory-utils";

describe("Voronoi cell clipping and grouping", () => {
  it("produces one polygon group per system when keyed by id", () => {
    const pts: [number, number][] = [
      [100, 100], [900, 100], [500, 900], [500, 500],
    ];
    const ids = ["a", "b", "c", "d"];
    const voronoi = Delaunay.from(pts).voronoi([0, 0, 1000, 1000]);
    const cells = unionCellsByGroup(clipVoronoiCells(pts.length, voronoi), (i) => ids[i]);
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
    const cells = unionCellsByGroup(clipVoronoiCells(pts.length, voronoi), (i) => keys[i]);

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
    const cells = unionCellsByGroup(clipVoronoiCells(pts.length, voronoi), (i) => keys[i]);

    // The middle system (null key) is excluded; only "a" and "c" produce groups.
    expect(cells.size).toBe(2);
    expect(cells.has("a")).toBe(true);
    expect(cells.has("c")).toBe(true);
    expect(cells.has("b")).toBe(false);
  });

  it("leaves the clipped cells intact so one set backs several groupings", () => {
    // One clipped-cell set feeds every grouping on the map (ids, regions, factions). If a union
    // wrote back into its inputs, whichever grouping ran second would union corrupted geometry.
    const pts: [number, number][] = [
      [200, 300], [200, 700], [800, 300], [800, 700],
    ];
    const ids = ["a", "b", "c", "d"];
    const voronoi = Delaunay.from(pts).voronoi([0, 0, 1000, 1000]);
    const clipped = clipVoronoiCells(pts.length, voronoi);
    const before = JSON.stringify(clipped);

    const firstPass = unionCellsByGroup(clipped, (i) => (i < 2 ? "left" : "right"));
    unionCellsByGroup(clipped, (i) => ids[i]);
    const secondPass = unionCellsByGroup(clipped, (i) => (i < 2 ? "left" : "right"));

    expect(JSON.stringify(clipped)).toBe(before);
    expect(JSON.stringify([...secondPass])).toBe(JSON.stringify([...firstPass]));
  });
});

describe("ghostSites", () => {
  const MAP = 1000;

  it("closes the rim with straight edges — no real cell reaches the bounding box", () => {
    // A tight cluster near the centre, leaving most of a large box empty. Without rim ghosts, the
    // hull cells (d3's own box clip) shoot out to the box corners.
    const pts: [number, number][] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        pts.push([450 + c * 30, 450 + r * 30]);
      }
    }
    const ghosts = ghostSites(pts, MAP);
    expect(ghosts.length).toBeGreaterThan(0);

    const augmented = pts.concat(ghosts);
    const voronoi = Delaunay.from(augmented).voronoi([0, 0, MAP, MAP]);
    const cells = clipVoronoiCells(pts.length, voronoi);

    for (const cell of cells) {
      for (const [x, y] of cell.flat(2)) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(MAP);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(MAP);
      }
    }
  });

  it("bounds every real cell's vertices near its own site, at the rim and across an interior gap", () => {
    // Two dense clusters (spacing 20) separated by a wide empty gap — the interior-gap case the
    // rim ghosts alone can't help with.
    const pts: [number, number][] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        pts.push([100 + c * 20, 100 + r * 20]);
        pts.push([700 + c * 20, 700 + r * 20]);
      }
    }
    const SPACING = 20;
    const BOUND = SPACING * 2;

    const ghosts = ghostSites(pts, MAP);
    const augmented = pts.concat(ghosts);
    const voronoi = Delaunay.from(augmented).voronoi([0, 0, MAP, MAP]);
    const cells = clipVoronoiCells(pts.length, voronoi);

    for (let i = 0; i < pts.length; i++) {
      const [sx, sy] = pts[i];
      for (const [x, y] of cells[i].flat(2)) {
        expect(Math.hypot(x - sx, y - sy)).toBeLessThanOrEqual(BOUND);
      }
    }
  });

  it("terminates within the iteration cap on a pathological input", () => {
    // A dense 5x5 grid (spacing 30) plus one distant outlier: the triangles bridging the grid to
    // the outlier are so much larger than the grid's own spacing that closing them spawns new
    // ghosts whose own triangles are still over threshold, cascading for many iterations before
    // naturally settling near iteration 19 with thousands of ghosts (measured directly against this
    // module's own circumcircle/threshold logic, without the cap). The cap must cut this off far
    // earlier — a low three-figure ghost count, not four.
    const MAP2 = 2000;
    const pts: [number, number][] = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) pts.push([100 + c * 30, 100 + r * 30]);
    }
    pts.push([1500, 115]);

    const ghosts = ghostSites(pts, MAP2);
    expect(ghosts.length).toBeLessThan(2500);
  });
});
