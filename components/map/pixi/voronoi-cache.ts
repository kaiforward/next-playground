import { Delaunay } from "d3-delaunay";
import {
  clipVoronoiCells,
  unionCellsByGroup,
  clipRadiusForDelaunay,
  type MultiPolygon,
} from "./territory-utils";
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
 */
export function buildSystemCells(systems: AtlasSystem[], mapSize: number): SystemCells {
  const points: [number, number][] = systems.map((s) => [s.x, s.y]);
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi([0, 0, mapSize, mapSize]);
  const clippedCells = clipVoronoiCells(systems.length, voronoi);
  const groupBy = (getGroupKey: (system: AtlasSystem) => string | null) =>
    unionCellsByGroup(clippedCells, (i) => getGroupKey(systems[i]));
  const cellsBySystemId = groupBy((s) => s.id);
  const centroidBySystemId = new Map(systems.map((s) => [s.id, { x: s.x, y: s.y }]));

  // The same radius the cells are visually disc-clipped to, so hit-testing matches what's drawn.
  const clipRadius = clipRadiusForDelaunay(delaunay);
  const clipRadiusSq = clipRadius * clipRadius;

  // Seed the next hill-climb from the last cell found — during continuous hover the cursor moves
  // a little between calls, so `find` is O(1) amortised instead of re-walking from scratch.
  let lastFound = 0;

  return {
    systems,
    cellsBySystemId,
    centroidBySystemId,
    groupBy,
    findSystemAt(x, y) {
      if (x < 0 || y < 0 || x > mapSize || y > mapSize) return null;
      const i = delaunay.find(x, y, lastFound);
      if (i < 0 || i >= systems.length) return null;
      lastFound = i;
      // A visual cell is contained within a disc of clipRadius around its site (over-large cells are
      // trimmed to it — see clipVoronoiCells). A point beyond that radius from its nearest site
      // sits in a trimmed-away, visually-empty region, so it reads as an empty click rather than
      // selecting the site whose analytic Voronoi cell would otherwise reach it.
      if (clipRadius > 0) {
        const dx = x - systems[i].x;
        const dy = y - systems[i].y;
        if (dx * dx + dy * dy > clipRadiusSq) return null;
      }
      return systems[i].id;
    },
  };
}
