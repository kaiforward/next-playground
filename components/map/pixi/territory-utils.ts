import { union, intersection, setPrecision } from "polyclip-ts";
import type { Delaunay, Voronoi } from "d3-delaunay";

type Ring = [number, number][];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

/**
 * Edge-cell rounding. Cells whose site is on the convex hull are clipped by
 * d3-delaunay to the bounding box, producing large boxy spurs out toward empty
 * space. We round those off by clipping each to a disc around its own site,
 * radius = `DISC_RADIUS_FACTOR` × the universe's median nearest-neighbour
 * spacing (so it auto-scales with universe size). Interior cells are bounded by
 * their neighbours and never touch the box, so they're left untouched — there's
 * no risk of gaps between adjacent territories. Both values are smoke-tunable.
 */
const DISC_RADIUS_FACTOR = 2.5;
const DISC_SEGMENTS = 20;

/** Tolerance for treating a cell vertex as lying on the Voronoi bounding box. */
const BOX_EPSILON = 1e-6;

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
  const clipRadius = medianNearestNeighbor(delaunay) * DISC_RADIUS_FACTOR;
  const clipEnabled = Number.isFinite(clipRadius) && clipRadius > 0;

  // A cell got box-clipped iff one of its vertices sits on the bounding box.
  const onBox = (x: number, y: number): boolean =>
    Math.abs(x - voronoi.xmin) < BOX_EPSILON ||
    Math.abs(x - voronoi.xmax) < BOX_EPSILON ||
    Math.abs(y - voronoi.ymin) < BOX_EPSILON ||
    Math.abs(y - voronoi.ymax) < BOX_EPSILON;

  // Collect (possibly disc-clipped) polygons per group
  const groups = new Map<string, Polygon[]>();

  for (let i = 0; i < systemCount; i++) {
    const key = getGroupKey(i);
    if (key === null) continue;

    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;

    const ring = voronoiCellToRing(cell);
    if (ring.length < 4) continue; // need at least a triangle (3 + closing point)

    const polygons: MultiPolygon =
      clipEnabled && ring.some(([x, y]) => onBox(x, y))
        ? clipPolygonToDisc(ring, points[2 * i], points[2 * i + 1], clipRadius, DISC_SEGMENTS)
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
