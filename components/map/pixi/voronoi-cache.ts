import { Delaunay } from "d3-delaunay";
import { clipVoronoiCells, unionCellsByGroup, ghostSites, type MultiPolygon } from "./territory-utils";
import type { AtlasSystem } from "@/lib/types/game";

export interface SystemCells {
  /** The systems the diagram was built from, in cell-index order. */
  systems: AtlasSystem[];
  cellsBySystemId: Map<string, MultiPolygon>;
  centroidBySystemId: Map<string, { x: number; y: number }>;
  findSystemAt(x: number, y: number): string | null;
  /**
   * Union the cells into territory polygons keyed by `getGroupKey(system)` — a null key drops
   * that system from every group. The per-cell geometry is computed once at build time and only
   * the union is redone per grouping, so a caller must never re-derive cells of its own.
   */
  groupBy(getGroupKey: (system: AtlasSystem) => string | null): Map<string, MultiPolygon>;
}

/**
 * The map's single Voronoi diagram. Every consumer of cell geometry reads from the object this
 * returns — per-system cells, per-system centroids, the territory layers' grouped unions, and
 * hit-testing, which is analytic: a Voronoi cell is the set of points nearest its site, so
 * `delaunay.find(x, y)` is the cell under the cursor in O(log n).
 *
 * The diagram is built over the real systems followed by invisible ghost sites (`ghostSites`) —
 * real indices first, so cell index `i < systems.length` is always a real system and every ghost
 * index is discarded here or, in `findSystemAt`, treated as an empty click.
 */
export function buildSystemCells(systems: AtlasSystem[], mapSize: number): SystemCells {
  const points: [number, number][] = systems.map((s) => [s.x, s.y]);
  const ghosts = ghostSites(points, mapSize);
  const augmentedPoints = points.concat(ghosts);
  const delaunay = Delaunay.from(augmentedPoints);
  const voronoi = delaunay.voronoi([0, 0, mapSize, mapSize]);
  const clippedCells = clipVoronoiCells(systems.length, voronoi);
  const groupBy = (getGroupKey: (system: AtlasSystem) => string | null) =>
    unionCellsByGroup(clippedCells, (i) => getGroupKey(systems[i]));
  const cellsBySystemId = groupBy((s) => s.id);
  const centroidBySystemId = new Map(systems.map((s) => [s.id, { x: s.x, y: s.y }]));

  // Seed the next hill-climb from the last cell found — during continuous hover the cursor moves
  // a little between calls, so `find` is O(1) amortised instead of re-walking from scratch. The
  // seed is always a valid index into the augmented (real + ghost) point set, whether or not the
  // last find landed on a ghost.
  let lastFound = 0;

  return {
    systems,
    cellsBySystemId,
    centroidBySystemId,
    groupBy,
    findSystemAt(x, y) {
      if (x < 0 || y < 0 || x > mapSize || y > mapSize) return null;
      const i = delaunay.find(x, y, lastFound);
      if (i < 0) return null;
      lastFound = i;
      if (i >= systems.length) return null; // a ghost site's cell — no real system there
      return systems[i].id;
    },
  };
}
