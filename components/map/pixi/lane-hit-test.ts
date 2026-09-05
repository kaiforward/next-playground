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
 * The lane key whose segment lies within `tolerance` world units of `point`, or null. Every lane
 * whose bounding box (padded by `tolerance`) is near the point is checked by exact point-to-segment
 * distance; the closest lane within tolerance wins. Endpoints missing from `systems` are skipped
 * (never thrown) — the same "stale id reads as absent" convention the rest of the map hit-testing
 * uses.
 */
export function findLaneAt(
  point: Point,
  lanes: readonly LaneHitTestLane[],
  systems: readonly LaneHitTestSystem[],
  tolerance: number,
): string | null {
  const posById = new Map(systems.map((s) => [s.id, s] as const));
  let bestKey: string | null = null;
  let bestDist = tolerance;

  for (const lane of lanes) {
    const a = posById.get(lane.aId);
    const b = posById.get(lane.bId);
    if (!a || !b) continue;

    const minX = Math.min(a.x, b.x) - tolerance;
    const maxX = Math.max(a.x, b.x) + tolerance;
    const minY = Math.min(a.y, b.y) - tolerance;
    const maxY = Math.max(a.y, b.y) + tolerance;
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) continue;

    const dist = distanceToSegment(point, a, b);
    if (dist <= bestDist) {
      bestDist = dist;
      bestKey = lane.key;
    }
  }

  return bestKey;
}

/** The id of the system whose exact point sits within `radius` of `point`, or null — the star's own
 *  hover radius, distinct from its (much larger) Voronoi cell. The closest system within radius
 *  wins. */
export function findSystemNear(
  point: Point,
  systems: readonly LaneHitTestSystem[],
  radius: number,
): string | null {
  let bestId: string | null = null;
  let bestDist = radius;
  for (const s of systems) {
    const dist = Math.hypot(point.x - s.x, point.y - s.y);
    if (dist <= bestDist) {
      bestDist = dist;
      bestId = s.id;
    }
  }
  return bestId;
}

/** One stage-click hit-test outcome, in the precedence order `resolveMapClick` applies. */
export type MapClickResult =
  | { kind: "faction"; factionId: string }
  | { kind: "system"; systemId: string }
  | { kind: "lane"; laneKey: string }
  | { kind: "empty" };

/**
 * Resolves a stage click against every precomputed hit-test input, in the stated precedence
 * (docs/active/engineering/map-rendering.md → Selection):
 *
 *   1. faction (only when zoomed out into faction-select range and a faction hit exists)
 *   2. system, when the point lies within the star's own hover radius (`findSystemNear`)
 *   3. lane, when the point lies within tolerance of a lane segment (`findLaneAt`)
 *   4. system, via the ordinary Voronoi cell hit-test (`SystemCells.findSystemAt`)
 *   5. empty
 *
 * A precise click on a star wins over a nearby lane even though both are geometrically close; a
 * lane click away from any star still resolves to the lane rather than falling through to whichever
 * system's cell happens to contain that point.
 */
export function resolveMapClick(inputs: {
  factionHit: string | null;
  systemNear: string | null;
  laneAt: string | null;
  cellSystemId: string | null;
}): MapClickResult {
  if (inputs.factionHit != null) return { kind: "faction", factionId: inputs.factionHit };
  if (inputs.systemNear != null) return { kind: "system", systemId: inputs.systemNear };
  if (inputs.laneAt != null) return { kind: "lane", laneKey: inputs.laneAt };
  if (inputs.cellSystemId != null) return { kind: "system", systemId: inputs.cellSystemId };
  return { kind: "empty" };
}
