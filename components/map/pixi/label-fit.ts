/**
 * Pure cell-fit test for a system's name label — no Pixi import, `.test.ts`-able from node. A
 * Voronoi cell clipped to a disc (`territory-utils.ts`) is convex, so a label box fits inside it
 * exactly when all four of the box's corners lie inside the cell's exterior ring; there is no
 * concave case to trip up corner-only containment.
 */

import type { Point } from "./lane-hit-test";
import type { MultiPolygon, Ring } from "./territory-utils";

/** Tolerance for the boundary-inclusive containment test — floats off by less than this count as
 *  exactly on the edge, so a snug fit (corner touching the cell boundary) still shows. */
const EPS = 1e-9;

/**
 * True when `point` lies inside (or exactly on the boundary of) the convex ring, using the
 * consistent-cross-product-sign test. The ring's winding direction is irrelevant — the sign of
 * the first non-degenerate edge fixes which sign "inside" is, and every other edge must agree
 * with (or lie on) it.
 */
function pointInConvexRing(point: Point, ring: Ring): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    const cross = (bx - ax) * (point.y - ay) - (by - ay) * (point.x - ax);
    if (cross < -EPS) {
      if (sign > 0) return false;
      sign = -1;
    } else if (cross > EPS) {
      if (sign < 0) return false;
      sign = 1;
    }
    // cross within [-EPS, EPS]: point lies on this edge's line — boundary inclusive, no rejection.
  }
  return true;
}

/**
 * True when a label box centred at `center`, with the given half-width/half-height (world units),
 * lies entirely inside `cell`'s first polygon's exterior ring. Boundary inclusive, so a corner
 * exactly on the cell edge still counts as fitting. `cell` is a `MultiPolygon` (per
 * `SystemCells.cellsBySystemId`) — only its first polygon's exterior ring (index 0) is tested, per
 * the one-cell-per-system convention every other cell consumer relies on.
 */
export function labelFitsCell(center: Point, halfW: number, halfH: number, cell: MultiPolygon): boolean {
  const exterior = cell[0]?.[0];
  if (!exterior || exterior.length < 3) return false;

  const corners: Point[] = [
    { x: center.x - halfW, y: center.y - halfH },
    { x: center.x + halfW, y: center.y - halfH },
    { x: center.x + halfW, y: center.y + halfH },
    { x: center.x - halfW, y: center.y + halfH },
  ];
  return corners.every((corner) => pointInConvexRing(corner, exterior));
}
