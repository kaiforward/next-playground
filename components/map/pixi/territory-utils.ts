import { union, setPrecision } from "polyclip-ts";
import type { Voronoi } from "d3-delaunay";

type Ring = [number, number][];
type MultiPolygon = Ring[][];

// Set precision for polyclip-ts to handle floating-point edge cases
setPrecision(1e-6);

/**
 * Group Voronoi cells by a key function and union them into territory polygons.
 * Pure function — reusable for regions, factions, or any grouping.
 *
 * @param systemCount - number of systems (matches Voronoi cell indices)
 * @param voronoi - d3-delaunay Voronoi diagram
 * @param getGroupKey - returns group key for system at index i, or null to skip
 * @returns Map of group key → unioned MultiPolygon
 */
export function computeTerritoryPolygons(
  systemCount: number,
  voronoi: Voronoi<Float64Array>,
  getGroupKey: (index: number) => string | null,
): Map<string, MultiPolygon> {
  // Collect cells per group
  const groups = new Map<string, Ring[]>();

  for (let i = 0; i < systemCount; i++) {
    const key = getGroupKey(i);
    if (key === null) continue;

    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;

    const ring = voronoiCellToRing(cell);
    if (ring.length < 4) continue; // need at least a triangle (3 + closing point)

    let rings = groups.get(key);
    if (!rings) {
      rings = [];
      groups.set(key, rings);
    }
    rings.push(ring);
  }

  // Union cells per group
  const result = new Map<string, MultiPolygon>();

  for (const [key, rings] of groups) {
    if (rings.length === 0) continue;

    if (rings.length === 1) {
      // Single cell — wrap as MultiPolygon (one poly, one exterior ring, no holes)
      result.set(key, [[rings[0]]]);
      continue;
    }

    // Union all cells: each ring is a simple polygon [exteriorRing]
    const polys = rings.map((ring) => [ring]);
    try {
      const merged = union(polys[0], ...polys.slice(1));
      if (merged.length > 0) {
        result.set(key, merged);
      }
    } catch {
      // Fallback: render cells individually if union fails (rare edge case)
      result.set(key, polys);
    }
  }

  return result;
}

/**
 * Convert a d3-delaunay cell polygon to a polyclip-ts Ring.
 * d3-delaunay returns `[number, number][]` (closed, first = last).
 */
function voronoiCellToRing(cell: ArrayLike<[number, number]>): Ring {
  const ring: Ring = [];
  for (let i = 0; i < cell.length; i++) {
    ring.push([cell[i][0], cell[i][1]]);
  }
  return ring;
}
