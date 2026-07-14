import { union, intersection, setPrecision } from "polyclip-ts";
import type { Delaunay, Voronoi } from "d3-delaunay";

export type Ring = [number, number][];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

/**
 * Edge-cell rounding. Cells whose site is on the convex hull are clipped by
 * d3-delaunay to the bounding box, producing large boxy spurs out toward empty
 * space. We round those off by clipping each to a disc around its own site,
 * radius = `DISC_RADIUS_FACTOR` × the universe's median nearest-neighbour
 * spacing (so it auto-scales with universe size). Interior cells are bounded by
 * their neighbours and never touch the box, so they're left untouched.
 *
 * The radius is kept near ~1× spacing so a hull cell caps to roughly interior-cell
 * size instead of ballooning out toward the box. It is the primary smoke knob:
 * lower → tighter edge cells, but too low starts clipping a hull cell's genuine
 * shared boundary with an interior neighbour (whose vertex can sit past 1× spacing
 * on a sliver-shaped cell), opening a gap — so it trades edge tightness against
 * that floor.
 */
const DISC_RADIUS_FACTOR = 1.25;
const DISC_SEGMENTS = 24;

let precisionSet = false;

/**
 * Set polyclip precision once. Not done at import time to avoid side effects
 * during module loading; every entry point that runs a boolean op calls this.
 */
function ensurePrecision() {
  if (!precisionSet) {
    setPrecision(1e-6);
    precisionSet = true;
  }
}

/**
 * Clip a polygon ring to a disc (approximated by an `segments`-gon inscribed in
 * the circle, so every output vertex lies within `radius` of the centre). Used
 * to round off the unbounded edge cells of a Voronoi diagram — see
 * computeTerritoryPolygons. Returns a MultiPolygon (the intersection can in
 * principle split, though a convex disc rarely does).
 */
export function clipPolygonToDisc(
  ring: Ring,
  cx: number,
  cy: number,
  radius: number,
  segments: number,
): MultiPolygon {
  ensurePrecision();
  return intersection([ring], [discRing(cx, cy, radius, segments)]);
}

/** Build a closed regular-polygon ring inscribed in a circle of `radius`. */
function discRing(cx: number, cy: number, radius: number, segments: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    ring.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  ring.push([ring[0][0], ring[0][1]]); // close the ring
  return ring;
}

/**
 * Group Voronoi cells by a key function and union them into territory polygons.
 * Pure function — reusable for regions, factions, or any grouping.
 *
 * Hull cells (which d3 clips to the bounding box) are rounded off to a disc
 * around their site so territories close off gracefully at the galaxy edge
 * instead of shooting out to the box corners — see DISC_RADIUS_FACTOR.
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
  ensurePrecision();

  const { delaunay } = voronoi;
  const points = delaunay.points;
  const clipRadius = clipRadiusForDelaunay(delaunay);
  const clipEnabled = Number.isFinite(clipRadius) && clipRadius > 0;
  const clipRadiusSq = clipRadius * clipRadius;

  // Collect (possibly disc-clipped) polygons per group
  const groups = new Map<string, Polygon[]>();

  for (let i = 0; i < systemCount; i++) {
    const key = getGroupKey(i);
    if (key === null) continue;

    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;

    const ring = voronoiCellToRing(cell);
    if (ring.length < 4) continue; // need at least a triangle (3 + closing point)

    // Clip any cell that stretches past the radius — a box-clipped hull cell, OR a cell that balloons
    // toward an internal sparse region / the galaxy's irregular boundary (both missed by the old
    // box-vertex-only test). A small interior cell (every vertex within the radius) is left untouched,
    // so no gaps open between neighbours.
    const sx = points[2 * i];
    const sy = points[2 * i + 1];
    const needsClip =
      clipEnabled && ring.some(([x, y]) => (x - sx) ** 2 + (y - sy) ** 2 > clipRadiusSq);
    const polygons: MultiPolygon = needsClip
      ? clipPolygonToDisc(ring, sx, sy, clipRadius, DISC_SEGMENTS)
      : [[ring]];

    let collected = groups.get(key);
    if (!collected) {
      collected = [];
      groups.set(key, collected);
    }
    for (const polygon of polygons) collected.push(polygon);
  }

  // Union polygons per group
  const result = new Map<string, MultiPolygon>();

  for (const [key, polygons] of groups) {
    if (polygons.length === 0) continue;

    if (polygons.length === 1) {
      // Single polygon — already a valid one-poly MultiPolygon.
      result.set(key, [polygons[0]]);
      continue;
    }

    try {
      const merged = union(polygons[0], ...polygons.slice(1));
      if (merged.length > 0) {
        result.set(key, merged);
      }
    } catch {
      // Fallback: render polygons individually if union fails (rare edge case)
      result.set(key, polygons);
    }
  }

  return result;
}

/**
 * Median distance from each system to its nearest Delaunay neighbour. Drives the
 * edge-cell clip radius so it tracks actual system spacing across universe scales
 * (no fixed magic number). Returns 0 when there are no neighbours to measure.
 */
function medianNearestNeighbor(delaunay: Delaunay<Float64Array>): number {
  const points = delaunay.points;
  const count = points.length / 2;
  const distances: number[] = [];

  for (let i = 0; i < count; i++) {
    const xi = points[2 * i];
    const yi = points[2 * i + 1];
    let min = Infinity;
    for (const j of delaunay.neighbors(i)) {
      const d = Math.hypot(xi - points[2 * j], yi - points[2 * j + 1]);
      if (d < min) min = d;
    }
    if (Number.isFinite(min)) distances.push(min);
  }

  if (distances.length === 0) return 0;
  distances.sort((a, b) => a - b);
  return distances[Math.floor(distances.length / 2)];
}

/**
 * The disc-clip radius applied to over-large Voronoi cells for this triangulation
 * (`DISC_RADIUS_FACTOR × median nearest-neighbour spacing`). A cell is visually
 * contained within a disc of this radius around its site. Exported so the shared
 * cell cache hit-tests against the SAME radius the cells are trimmed to — otherwise
 * a click in a trimmed-away (visually empty) region still resolves to the nearest
 * site. Returns 0 when there is no spacing to measure (clipping is then disabled).
 */
export function clipRadiusForDelaunay(delaunay: Delaunay<Float64Array>): number {
  return medianNearestNeighbor(delaunay) * DISC_RADIUS_FACTOR;
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
