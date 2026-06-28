/**
 * Pure 2-D geometry for flow-overlay particle paths. No Pixi imports — testable
 * in isolation. A "path" is a polyline (≥ 2 points); particles advance along it
 * by arc-length so on-screen speed is constant regardless of curvature.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Sample a quadratic bezier between two points into a polyline. The arc bows
 * perpendicular to the chord, always to the LEFT of the from→to vector, by
 * `min(maxBow, bowFraction × chordLength)` — so parallel hauls fan apart and the
 * curve direction reads consistently. Returns `segments + 1` points; degenerates
 * to `[from, to]` when the endpoints coincide.
 */
export function arcPolyline(
  from: Point,
  to: Point,
  bowFraction: number,
  maxBow: number,
  segments: number,
): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [from, to];

  const bow = Math.min(maxBow, bowFraction * length);
  // Unit normal to the LEFT of travel in screen coordinates (y-down).
  // 90° clockwise rotation of the direction vector: (dy, -dx) / length.
  const nx = dy / length;
  const ny = -dx / length;
  const cx = (from.x + to.x) / 2 + nx * bow;
  const cy = (from.y + to.y) / 2 + ny * bow;

  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const mt = 1 - u;
    pts.push({
      x: mt * mt * from.x + 2 * mt * u * cx + u * u * to.x,
      y: mt * mt * from.y + 2 * mt * u * cy + u * u * to.y,
    });
  }
  return pts;
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

/** Point at fractional arc-length `u` (0..1) along the polyline. */
export function pointAtFraction(
  points: ReadonlyArray<Point>,
  cum: ReadonlyArray<number>,
  total: number,
  u: number,
): Point {
  if (points.length < 2 || total === 0) return points[0];
  const d = u * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (d - cum[i - 1]) / seg;
  return {
    x: points[i - 1].x + (points[i].x - points[i - 1].x) * f,
    y: points[i - 1].y + (points[i].y - points[i - 1].y) * f,
  };
}
