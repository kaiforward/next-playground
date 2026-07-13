import { Delaunay } from "d3-delaunay";
import { computeTerritoryPolygons, type MultiPolygon } from "./territory-utils";
import type { AtlasSystem } from "@/lib/types/game";

export interface SystemCells {
  cellsBySystemId: Map<string, MultiPolygon>;
  centroidBySystemId: Map<string, { x: number; y: number }>;
  findSystemAt(x: number, y: number): string | null;
}

/**
 * Build the Voronoi ONCE from the system point set and hand per-system cells to every consumer,
 * replacing the five independent triangulations. Hit-testing is analytic: a Voronoi cell is the set
 * of points nearest its site, so `delaunay.find(x, y)` is the cell under the cursor in O(log n).
 */
export function buildSystemCells(systems: AtlasSystem[], mapSize: number): SystemCells {
  const points: [number, number][] = systems.map((s) => [s.x, s.y]);
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi([0, 0, mapSize, mapSize]);
  const cellsBySystemId = computeTerritoryPolygons(systems.length, voronoi, (i) => systems[i].id);
  const centroidBySystemId = new Map(systems.map((s) => [s.id, { x: s.x, y: s.y }]));

  // Seed the next hill-climb from the last cell found — during continuous hover the cursor moves
  // a little between calls, so `find` is O(1) amortised instead of re-walking from scratch.
  let lastFound = 0;

  return {
    cellsBySystemId,
    centroidBySystemId,
    findSystemAt(x, y) {
      if (x < 0 || y < 0 || x > mapSize || y > mapSize) return null;
      const i = delaunay.find(x, y, lastFound);
      if (i < 0 || i >= systems.length) return null;
      lastFound = i;
      return systems[i].id;
    },
  };
}
