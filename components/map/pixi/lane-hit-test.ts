/**
 * Pure lane click hit-testing — no Pixi import, `.test.ts`-able from node. Selection today is
 * Voronoi-cell only (`voronoi-cache.ts`, consumed in `interactions.ts`); a lane is a segment between
 * two system points, which no existing hit-test shape fits, hence this new module.
 */

export interface Point {
  x: number;
  y: number;
}

/** The minimal lane shape a hit-test needs — deliberately narrower than `LaneStateRow`/`ConnectionData`. */
export interface LaneHitTestLane {
  key: string;
  aId: string;
  bId: string;
}

/** The minimal system shape a hit-test needs. */
export interface LaneHitTestSystem {
  id: string;
  x: number;
  y: number;
}

/** Index systems by id for `findLaneAt` — built once per systems change by the caller, never per
 *  call: the hover path calls `findLaneAt` every frame the pointer moves. */
export function indexSystemsById(systems: readonly LaneHitTestSystem[]): Map<string, LaneHitTestSystem> {
  const byId = new Map<string, LaneHitTestSystem>();
  for (const s of systems) byId.set(s.id, s);
  return byId;
}

/** Shortest distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * The lane key whose (gap-shortened) segment lies within `tolerance` world units of `point`, or
 * null. Every lane ends on a star, so the segment is pulled in by `endGap` world units at each end
 * before the distance test — a click at a star's centre must resolve to the cell, not to whichever
 * lane happens to end there (docs/active/engineering/map-rendering.md → Selection precedence). A
 * lane shorter than `2 * endGap` has no segment left to test and is skipped entirely. Every lane
 * whose bounding box (padded by `tolerance`) is near the point is checked by exact point-to-segment
 * distance; the closest lane within tolerance wins. Endpoints missing from `systemsById` are skipped
 * (never thrown) — the same "stale id reads as absent" convention the rest of the map hit-testing
 * uses.
 */
export function findLaneAt(
  point: Point,
  lanes: readonly LaneHitTestLane[],
  systemsById: ReadonlyMap<string, LaneHitTestSystem>,
  tolerance: number,
  endGap: number,
): string | null {
  let bestKey: string | null = null;
  let bestDist = tolerance;

  for (const lane of lanes) {
    const a = systemsById.get(lane.aId);
    const b = systemsById.get(lane.bId);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= endGap * 2) continue;

    const ux = dx / length;
    const uy = dy / length;
    const ga = { x: a.x + ux * endGap, y: a.y + uy * endGap };
    const gb = { x: b.x - ux * endGap, y: b.y - uy * endGap };

    const minX = Math.min(ga.x, gb.x) - tolerance;
    const maxX = Math.max(ga.x, gb.x) + tolerance;
    const minY = Math.min(ga.y, gb.y) - tolerance;
    const maxY = Math.max(ga.y, gb.y) + tolerance;
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) continue;

    const dist = distanceToSegment(point, ga, gb);
    if (dist <= bestDist) {
      bestDist = dist;
      bestKey = lane.key;
    }
  }

  return bestKey;
}

/** One stage-click hit-test outcome, in the precedence order `resolveMapClick` applies. */
export type MapClickResult =
  | { kind: "faction"; factionId: string }
  | { kind: "system"; systemId: string }
  | { kind: "lane"; laneKey: string }
  | { kind: "empty" };

/**
 * Resolves a stage click against every precomputed hit-test input, in the stated precedence
 * (docs/active/engineering/map-rendering.md → Selection precedence):
 *
 *   1. faction (only when zoomed out into faction-select range and a faction hit exists)
 *   2. lane, when the point lies within tolerance of a lane segment (`findLaneAt`)
 *   3. system, via the ordinary Voronoi cell hit-test (`SystemCells.findSystemAt`)
 *   4. empty
 *
 * There is no star-radius step: every lane ends on a star, and `findLaneAt`'s own end gap is what
 * lets a precise click on a star fall through to the cell instead of the lane, so this function
 * only ever has to choose between a lane and a cell.
 */
export function resolveMapClick(inputs: {
  factionHit: string | null;
  laneAt: string | null;
  cellSystemId: string | null;
}): MapClickResult {
  if (inputs.factionHit != null) return { kind: "faction", factionId: inputs.factionHit };
  if (inputs.laneAt != null) return { kind: "lane", laneKey: inputs.laneAt };
  if (inputs.cellSystemId != null) return { kind: "system", systemId: inputs.cellSystemId };
  return { kind: "empty" };
}
