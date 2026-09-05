import { Delaunay } from "d3-delaunay";
import { union, setPrecision } from "polyclip-ts";
import type { Voronoi } from "d3-delaunay";

export type Ring = [number, number][];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

/**
 * The multiple of median nearest-neighbour spacing above which a Delaunay triangle's circumradius
 * is considered a "gap" that needs an interior ghost site to break it up (see `ghostSites`). Kept
 * near ~1x spacing so a gap-closing bisector lands close to real-cell size instead of leaving a
 * cell free to balloon toward a distant neighbour or the map's edge.
 */
const GAP_RADIUS_FACTOR = 1.25;

/**
 * Cap on how many times `ghostSites` re-triangulates while closing interior gaps. Each pass can
 * turn one over-large triangle into several smaller ones, but a pathological input (e.g. points
 * nearly collinear, producing slivers whose circumradius stays large no matter how they're split)
 * could in principle never fully settle — the cap guarantees termination at the cost of leaving a
 * handful of rare, small gaps unclosed rather than looping.
 */
const MAX_GAP_ITERATIONS = 6;

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
 * The drawable geometry of one Voronoi cell, indexed by system index. Empty when the
 * cell is missing or degenerate.
 */
export type ClippedCells = MultiPolygon[];

/**
 * Turn a Voronoi diagram into per-cell drawable polygons — the expensive half of building
 * territories, and the half every grouping shares. The diagram is expected to have been built
 * over the real systems followed by ghost sites (`ghostSites`), with `systemCount` the count of
 * real systems only, so every emitted cell already ends in a genuine straight bisector — against a
 * real neighbour, or against a ghost that has since been discarded here. No further clipping is
 * needed.
 *
 * @param systemCount - number of real systems (the first `systemCount` cell indices in the diagram)
 * @param voronoi - d3-delaunay Voronoi diagram, built over real systems + ghost sites
 * @returns per-index polygons, aligned with the diagram's cell indices
 */
export function clipVoronoiCells(
  systemCount: number,
  voronoi: Voronoi<Float64Array>,
): ClippedCells {
  const cells: ClippedCells = [];

  for (let i = 0; i < systemCount; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell) {
      cells.push([]);
      continue;
    }

    const ring = voronoiCellToRing(cell);
    if (ring.length < 4) {
      cells.push([]); // need at least a triangle (3 + closing point)
      continue;
    }

    cells.push([[ring]]);
  }

  return cells;
}

/**
 * Group already-clipped cells by a key function and union each group into a territory polygon.
 * Pure function — reusable for regions, factions, or any grouping. Cell polygons are read, never
 * mutated, so one `ClippedCells` safely backs several groupings.
 *
 * @param cells - per-index cell polygons from clipVoronoiCells
 * @param getGroupKey - returns group key for the cell at index i, or null to skip
 * @returns Map of group key → unioned MultiPolygon
 */
export function unionCellsByGroup(
  cells: ClippedCells,
  getGroupKey: (index: number) => string | null,
): Map<string, MultiPolygon> {
  ensurePrecision();

  const groups = new Map<string, Polygon[]>();

  for (let i = 0; i < cells.length; i++) {
    const key = getGroupKey(i);
    if (key === null) continue;

    const polygons = cells[i];
    if (polygons.length === 0) continue;

    let collected = groups.get(key);
    if (!collected) {
      collected = [];
      groups.set(key, collected);
    }
    for (const polygon of polygons) collected.push(polygon);
  }

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
 * Median distance from each point to its nearest Delaunay neighbour. Drives ghost-site placement
 * so it tracks actual system spacing across universe scales (no fixed magic number). Returns 0
 * when there are no neighbours to measure.
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

/** `v` scaled to unit length; the zero vector maps to itself rather than dividing by zero. */
function normalize(v: [number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / len, v[1] / len];
}

/**
 * Unit outward normal of the edge `a -> b`, where "outward" means pointing away from `centroid`
 * (the mean of the real points). Working from the centroid rather than trusting the hull's winding
 * direction keeps this correct regardless of which way `Delaunay.hull` happens to wind.
 */
function outwardNormal(
  a: [number, number],
  b: [number, number],
  centroid: [number, number],
): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let normal = normalize([dy, -dx]);
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const towardMid: [number, number] = [mid[0] - centroid[0], mid[1] - centroid[1]];
  if (normal[0] * towardMid[0] + normal[1] * towardMid[1] < 0) {
    normal = [-normal[0], -normal[1]];
  }
  return normal;
}

/**
 * One ghost per hull vertex, pushed outward by `spacing` along the average of its two adjacent
 * hull-edge outward normals, plus extra ghosts along any hull edge longer than `spacing`, spaced
 * roughly `spacing` apart and offset outward the same way. These give every rim cell a genuine
 * straight bisector against an invisible neighbour instead of running unbounded to the map's box.
 */
function rimGhosts(
  delaunay: Delaunay<Float64Array>,
  points: [number, number][],
  spacing: number,
): [number, number][] {
  const hull = delaunay.hull;
  const n = hull.length;
  if (n < 3) return [];

  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  const centroid: [number, number] = [cx, cy];

  const edgeNormals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = points[hull[i]];
    const b = points[hull[(i + 1) % n]];
    edgeNormals.push(outwardNormal(a, b, centroid));
  }

  const ghosts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = points[hull[i]];
    const b = points[hull[(i + 1) % n]];
    const prevNormal = edgeNormals[(i - 1 + n) % n];
    const normal = edgeNormals[i];

    const vertexNormal = normalize([prevNormal[0] + normal[0], prevNormal[1] + normal[1]]);
    ghosts.push([a[0] + vertexNormal[0] * spacing, a[1] + vertexNormal[1] * spacing]);

    const edgeLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.round(edgeLen / spacing));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const px = a[0] + (b[0] - a[0]) * t;
      const py = a[1] + (b[1] - a[1]) * t;
      ghosts.push([px + normal[0] * spacing, py + normal[1] * spacing]);
    }
  }
  return ghosts;
}

/** Circumcentre and circumradius of triangle `a`,`b`,`c`; null when the three points are collinear
 *  (or nearly so — no well-defined finite circumcircle). */
function circumcircle(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): { x: number; y: number; r: number } | null {
  const [ax, ay] = a;
  const [bx, by] = b;
  const [cx, cy] = c;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;

  const aSq = ax * ax + ay * ay;
  const bSq = bx * bx + by * by;
  const cSq = cx * cx + cy * cy;
  const ux = (aSq * (by - cy) + bSq * (cy - ay) + cSq * (ay - by)) / d;
  const uy = (aSq * (cx - bx) + bSq * (ax - cx) + cSq * (bx - ax)) / d;
  return { x: ux, y: uy, r: Math.hypot(ux - ax, uy - ay) };
}

/**
 * One ghost per Delaunay triangle whose circumradius exceeds `threshold`, placed at the
 * circumcentre — the point equidistant from all three of the triangle's sites, so a ghost there
 * gives each of them a genuine bisector across the gap instead of leaving their shared corner
 * unbounded. A circumcentre that lands outside the map box is skipped (no point placing an
 * invisible site somewhere it can never help clip a real cell).
 */
function interiorGapGhosts(
  delaunay: Delaunay<Float64Array>,
  points: [number, number][],
  threshold: number,
  mapSize: number,
): [number, number][] {
  const ghosts: [number, number][] = [];
  const triangles = delaunay.triangles;
  for (let t = 0; t < triangles.length / 3; t++) {
    const a = points[triangles[3 * t]];
    const b = points[triangles[3 * t + 1]];
    const c = points[triangles[3 * t + 2]];
    const circle = circumcircle(a, b, c);
    if (!circle || circle.r <= threshold) continue;
    if (circle.x < 0 || circle.y < 0 || circle.x > mapSize || circle.y > mapSize) continue;
    ghosts.push([circle.x, circle.y]);
  }
  return ghosts;
}

/**
 * Invisible points added around and among the real systems so every real Voronoi cell ends in a
 * genuine straight bisector, at the rim and across interior sparse gaps alike, so a cell with no
 * real neighbour on one side still closes with an edge that matches the diagram's other edges.
 *
 * Two passes, both driven by `spacing` (the real systems' own median nearest-neighbour distance,
 * so this auto-scales with universe size):
 * - **Rim**: one ghost per hull vertex plus extras along any long hull edge (`rimGhosts`).
 * - **Interior gaps**: one ghost at the circumcentre of any Delaunay triangle whose circumradius
 *   exceeds `GAP_RADIUS_FACTOR × spacing` (`interiorGapGhosts`). Adding a ghost changes the
 *   triangulation, so this rebuilds and repeats until no triangle exceeds the threshold or
 *   `MAX_GAP_ITERATIONS` is hit.
 *
 * Callers triangulate real points followed by this function's ghosts (real indices first, so cell
 * index `i < systems.length` is always a real system) and discard every cell beyond that count —
 * see `clipVoronoiCells`.
 */
export function ghostSites(points: [number, number][], mapSize: number): [number, number][] {
  if (points.length < 3) return [];

  const realDelaunay = Delaunay.from(points);
  const spacing = medianNearestNeighbor(realDelaunay);
  if (spacing <= 0) return [];
  const threshold = spacing * GAP_RADIUS_FACTOR;

  const ghosts: [number, number][] = rimGhosts(realDelaunay, points, spacing);

  for (let iteration = 0; iteration < MAX_GAP_ITERATIONS; iteration++) {
    const augmented = points.concat(ghosts);
    const delaunay = Delaunay.from(augmented);
    const newGhosts = interiorGapGhosts(delaunay, augmented, threshold, mapSize);
    if (newGhosts.length === 0) break;
    ghosts.push(...newGhosts);
  }

  return ghosts;
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
