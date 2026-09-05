/**
 * Pure 2-D geometry for flow-overlay particle paths. No Pixi imports — testable
 * in isolation. A "path" is a polyline (≥ 2 points, a straight two-point segment for the
 * directed-logistics overlay); particles advance along it by arc-length so on-screen speed is
 * constant regardless of path shape.
 */

export interface Point {
  x: number;
  y: number;
}

/** Cumulative arc-length at each vertex of a polyline (array length = points). */
export function cumulativeLengths(
  points: ReadonlyArray<Point>,
): { cum: number[]; total: number } {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    cum.push(total);
  }
  return { cum, total };
}

/**
 * Point at fractional arc-length `u` (0..1) along the polyline. Allocates a
 * fresh `Point`; for per-frame hot loops use `pointAtFractionInto` instead.
 */
export function pointAtFraction(
  points: ReadonlyArray<Point>,
  cum: ReadonlyArray<number>,
  total: number,
  u: number,
): Point {
  const out = { x: 0, y: 0 };
  pointAtFractionInto(points, cum, total, u, out);
  return out;
}

/**
 * Like `pointAtFraction` but writes the result into `out` instead of allocating.
 * The particle loop calls this once per particle every frame, so reusing one
 * scratch `Point` keeps the 60fps path allocation-free.
 */
export function pointAtFractionInto(
  points: ReadonlyArray<Point>,
  cum: ReadonlyArray<number>,
  total: number,
  u: number,
  out: Point,
): void {
  if (points.length < 2 || total === 0) {
    out.x = points[0].x;
    out.y = points[0].y;
    return;
  }
  const d = u * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (d - cum[i - 1]) / seg;
  out.x = points[i - 1].x + (points[i].x - points[i - 1].x) * f;
  out.y = points[i - 1].y + (points[i].y - points[i - 1].y) * f;
}
