/**
 * Deterministic math primitives shared by every procedural-generation consumer: a seeded PRNG,
 * plane geometry, and minimum-spanning-tree construction. Zero imports — kept dependency-free on
 * purpose so anything that needs only these primitives (the galaxy-shape preview included, which
 * renders on the main thread) can use them without pulling in the rest of world generation.
 */

// ── PRNG (mulberry32) ───────────────────────────────────────────

export type RNG = () => number;

/** Create a seeded PRNG returning values in [0, 1). */
export function mulberry32(seed: number): RNG {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Plane geometry ───────────────────────────────────────────────

export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Union-Find (for Kruskal's MST) ─────────────────────────────

export class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
    return true;
  }

  connected(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }
}

// ── Minimum spanning tree (Kruskal) ─────────────────────────────

export interface Edge {
  a: number; // local index within a set
  b: number;
  dist: number;
}

/**
 * Build MST edges using Kruskal's algorithm within a set of points.
 * Returns local-index edges (indices into the provided array).
 */
export function kruskalMST(pointsInSet: { x: number; y: number }[]): Edge[] {
  const n = pointsInSet.length;
  if (n < 2) return [];

  // Build all possible edges sorted by distance
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({
        a: i,
        b: j,
        dist: distance(pointsInSet[i].x, pointsInSet[i].y, pointsInSet[j].x, pointsInSet[j].y),
      });
    }
  }
  edges.sort((a, b) => a.dist - b.dist);

  const uf = new UnionFind(n);
  const mst: Edge[] = [];
  for (const edge of edges) {
    if (uf.union(edge.a, edge.b)) {
      mst.push(edge);
      if (mst.length === n - 1) break;
    }
  }

  return mst;
}

// ── Neighbourhood graphs (empty-region criteria) ────────────────

/** Tolerance for the strict inequalities the empty-region tests use — without it, a system
 *  exactly on a circle boundary or exactly equidistant (both realistic with grid-ish placement)
 *  could flip either way under float rounding. */
const NEIGHBOURHOOD_EPS = 1e-9;

/**
 * True iff no third point of `points` sits strictly inside the circle having (a,b) as diameter —
 * the Gabriel-graph test. A planar, MST-containing criterion: local, three-point, no global sort
 * or triangulation needed.
 */
function isGabrielEdge(points: { x: number; y: number }[], a: number, b: number): boolean {
  const ax = points[a].x, ay = points[a].y, bx = points[b].x, by = points[b].y;
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  const radiusSq = ((ax - bx) * (ax - bx) + (ay - by) * (ay - by)) / 4;
  for (let k = 0; k < points.length; k++) {
    if (k === a || k === b) continue;
    const dx = points[k].x - cx;
    const dy = points[k].y - cy;
    if (dx * dx + dy * dy < radiusSq - NEIGHBOURHOOD_EPS) return false;
  }
  return true;
}

/**
 * True iff no third point C has BOTH d(A,C) and d(B,C) shorter than d(A,B) — the relative-
 * neighbourhood-graph (RNG) test. Sparser than Gabriel (RNG ⊆ Gabriel ⊆ Delaunay) while staying
 * planar and MST-containing.
 */
function isRelativeNeighbourEdge(points: { x: number; y: number }[], a: number, b: number): boolean {
  const ab = distance(points[a].x, points[a].y, points[b].x, points[b].y);
  for (let k = 0; k < points.length; k++) {
    if (k === a || k === b) continue;
    const ak = distance(points[a].x, points[a].y, points[k].x, points[k].y);
    const bk = distance(points[b].x, points[b].y, points[k].x, points[k].y);
    if (Math.max(ak, bk) < ab - NEIGHBOURHOOD_EPS) return false;
  }
  return true;
}

/** Every candidate pair from `pointsInSet` (brute-force O(n²) candidates, each an O(n) empty-
 *  region test — O(n³) total, acceptable at generation-time cluster scale, never per-tick) that
 *  passes `test`. Both `isGabrielEdge` and `isRelativeNeighbourEdge` are planar and provably
 *  contain the Euclidean MST, so the returned edge set is always connected (when `pointsInSet` is)
 *  and never self-intersects — no separate crossing check or MST fallback is needed. */
function neighbourhoodGraphEdges(
  pointsInSet: { x: number; y: number }[],
  test: (points: { x: number; y: number }[], a: number, b: number) => boolean,
): Edge[] {
  const n = pointsInSet.length;
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!test(pointsInSet, i, j)) continue;
      edges.push({ a: i, b: j, dist: distance(pointsInSet[i].x, pointsInSet[i].y, pointsInSet[j].x, pointsInSet[j].y) });
    }
  }
  return edges;
}

/** The Gabriel graph over `pointsInSet`: local-index edges, always connected and planar. */
export function gabrielGraphEdges(pointsInSet: { x: number; y: number }[]): Edge[] {
  if (pointsInSet.length < 2) return [];
  return neighbourhoodGraphEdges(pointsInSet, isGabrielEdge);
}

/** The relative-neighbourhood graph (RNG) over `pointsInSet`: local-index edges, always connected
 *  and planar, sparser than the Gabriel graph. This is the base local-lane graph (spec §5 rework —
 *  chosen over Gabriel by measured lanes/system, see `density-field.ts`/`universe-gen.ts` callers). */
export function relativeNeighbourhoodGraphEdges(pointsInSet: { x: number; y: number }[]): Edge[] {
  if (pointsInSet.length < 2) return [];
  return neighbourhoodGraphEdges(pointsInSet, isRelativeNeighbourEdge);
}
