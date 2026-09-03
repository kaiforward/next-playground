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

/**
 * Every candidate pair from `pointsInSet` (brute-force O(n²) candidates, each an O(n) empty-region
 * test — O(n³) total) that passes the relative-neighbourhood test. The reference implementation:
 * `relativeNeighbourhoodGraphEdges` below is the one production calls, and is required to return a
 * byte-identical edge list (`lib/engine/__tests__/generation-primitives.test.ts` pins that against
 * this function on random fixtures).
 */
export function relativeNeighbourhoodGraphEdgesBruteForce(pointsInSet: { x: number; y: number }[]): Edge[] {
  const n = pointsInSet.length;
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!isRelativeNeighbourEdge(pointsInSet, i, j)) continue;
      edges.push({ a: i, b: j, dist: distance(pointsInSet[i].x, pointsInSet[i].y, pointsInSet[j].x, pointsInSet[j].y) });
    }
  }
  return edges;
}

// ── Spatial acceleration for the relative-neighbourhood graph ────

/** Below this point count the brute-force pass costs less than building a grid for it. */
const NEIGHBOURHOOD_BRUTE_FORCE_MAX_POINTS = 32;

/** Points per cell the uniform grid aims for — small enough that a neighbourhood query touches few
 *  points, large enough that cell bookkeeping doesn't dominate. */
const GRID_TARGET_POINTS_PER_CELL = 2;

/**
 * Angular bins the candidate enumeration splits the plane into, from each point. Eight (45° each)
 * rather than the minimum six the proof below tolerates: at 45° the blocking margin is a
 * comfortable fraction of the edge length rather than vanishing at the bin boundary, so the only
 * arrangement the enumeration could miss is two points closer together than the float tolerance.
 */
const CANDIDATE_CONE_COUNT = 8;

/** Uniform bucket grid over a point set — the acceleration structure both passes share. */
interface PointGrid {
  cellSize: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  /** Point indices per cell, row-major (`row * cols + col`). */
  cells: number[][];
}

function buildPointGrid(points: { x: number; y: number }[]): PointGrid {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  // The second term caps the grid at ~4n cells however degenerate the distribution is (collinear
  // points would otherwise drive the area-derived cell size to nothing and the column count to
  // millions); the third keeps a zero-extent set from producing a zero cell size.
  const maxSide = Math.max(1, Math.ceil(Math.sqrt(points.length)) * 2);
  const cellSize = Math.max(
    Math.sqrt((Math.max(width * height, 1) * GRID_TARGET_POINTS_PER_CELL) / points.length),
    Math.max(width, height) / maxSide,
    1e-9,
  );
  const cols = Math.floor(width / cellSize) + 1;
  const rows = Math.floor(height / cellSize) + 1;
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  const grid: PointGrid = { cellSize, minX, minY, cols, rows, cells };
  for (let i = 0; i < points.length; i++) {
    cells[gridRow(grid, points[i].y) * cols + gridCol(grid, points[i].x)].push(i);
  }
  return grid;
}

function gridCol(grid: PointGrid, x: number): number {
  return Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.minX) / grid.cellSize)));
}

function gridRow(grid: PointGrid, y: number): number {
  return Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.minY) / grid.cellSize)));
}

/** Which angular bin the direction (dx, dy) falls in. */
function coneIndexOf(dx: number, dy: number): number {
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI * 2;
  const index = Math.floor((angle / (Math.PI * 2)) * CANDIDATE_CONE_COUNT);
  return index >= CANDIDATE_CONE_COUNT ? CANDIDATE_CONE_COUNT - 1 : index;
}

/**
 * Add every pair (a, ·) that could possibly be a relative-neighbourhood edge to `candidates`,
 * keyed as `min * n + max`.
 *
 * The enumeration is complete, not a heuristic. If some point C shares A's angular bin with B and
 * sits closer to A (`x = d(A,C) < D = d(A,B)`), then the angle θ between them is at most 45°, so
 * `d(B,C)² = x² + D² − 2xD·cos θ ≤ D² − x(√2·D − x) < D²` — C blocks the edge (A,B) under exactly
 * the test `isRelativeNeighbourEdge` applies. So the only pair per bin that can survive is the
 * nearest one, and near-ties within the float tolerance are all kept rather than resolved here.
 * The one arrangement this misses is two points closer together than that tolerance, which
 * placement (a Poisson-disk minimum distance) cannot produce.
 *
 * The ring search stops as soon as every bin's best is closer than the radius the scanned block
 * guarantees; a bin that stays empty (a point on the set's boundary) keeps the search expanding
 * until the grid is exhausted, which is what makes the result independent of scan order.
 */
function collectConeCandidates(
  points: { x: number; y: number }[],
  grid: PointGrid,
  a: number,
  candidates: Set<number>,
): void {
  const { cellSize, cols, rows, cells } = grid;
  const n = points.length;
  const ax = points[a].x;
  const ay = points[a].y;
  const aCol = gridCol(grid, ax);
  const aRow = gridRow(grid, ay);
  const bestDist = new Array<number>(CANDIDATE_CONE_COUNT).fill(Infinity);
  const nearest: number[][] = Array.from({ length: CANDIDATE_CONE_COUNT }, () => []);
  const maxRing = Math.max(cols, rows);

  for (let ring = 0; ring <= maxRing; ring++) {
    for (let row = aRow - ring; row <= aRow + ring; row++) {
      if (row < 0 || row >= rows) continue;
      const onRingRow = row === aRow - ring || row === aRow + ring;
      for (let col = aCol - ring; col <= aCol + ring; col++) {
        if (col < 0 || col >= cols) continue;
        if (!onRingRow && col !== aCol - ring && col !== aCol + ring) continue;
        for (const i of cells[row * cols + col]) {
          if (i === a) continue;
          const dx = points[i].x - ax;
          const dy = points[i].y - ay;
          const d = Math.sqrt(dx * dx + dy * dy);
          const cone = coneIndexOf(dx, dy);
          if (d < bestDist[cone] - NEIGHBOURHOOD_EPS) {
            bestDist[cone] = d;
            nearest[cone] = [i];
          } else if (d <= bestDist[cone] + NEIGHBOURHOOD_EPS) {
            if (d < bestDist[cone]) bestDist[cone] = d;
            nearest[cone].push(i);
          }
        }
      }
    }
    // Anything still unscanned sits at least `ring * cellSize` away, so a bin whose best already
    // beats that radius can gain nothing by expanding further.
    const guaranteedRadius = ring * cellSize;
    let settled = true;
    for (let cone = 0; cone < CANDIDATE_CONE_COUNT; cone++) {
      if (bestDist[cone] > guaranteedRadius - NEIGHBOURHOOD_EPS) {
        settled = false;
        break;
      }
    }
    if (settled) break;
  }

  for (const bin of nearest) {
    for (const i of bin) candidates.add(a < i ? a * n + i : i * n + a);
  }
}

/**
 * `isRelativeNeighbourEdge` for one candidate pair, restricted to the grid cells that could hold a
 * blocker. A blocker satisfies both `d(C,A) < d(A,B)` and `d(C,B) < d(A,B)`, so it lies inside both
 * discs of radius `d(A,B)`; scanning the box those two discs share is exactly equivalent to the
 * whole-set scan, never an approximation of it.
 */
function isRelativeNeighbourEdgeLocal(
  points: { x: number; y: number }[],
  grid: PointGrid,
  a: number,
  b: number,
): boolean {
  const ax = points[a].x;
  const ay = points[a].y;
  const bx = points[b].x;
  const by = points[b].y;
  const ab = distance(ax, ay, bx, by);

  const colLo = gridCol(grid, Math.max(ax, bx) - ab);
  const colHi = gridCol(grid, Math.min(ax, bx) + ab);
  const rowLo = gridRow(grid, Math.max(ay, by) - ab);
  const rowHi = gridRow(grid, Math.min(ay, by) + ab);

  for (let row = rowLo; row <= rowHi; row++) {
    for (let col = colLo; col <= colHi; col++) {
      for (const k of grid.cells[row * grid.cols + col]) {
        if (k === a || k === b) continue;
        const ak = distance(ax, ay, points[k].x, points[k].y);
        const bk = distance(bx, by, points[k].x, points[k].y);
        if (Math.max(ak, bk) < ab - NEIGHBOURHOOD_EPS) return false;
      }
    }
  }
  return true;
}

/** The relative-neighbourhood graph (RNG) over `pointsInSet`: local-index edges, always connected
 *  and planar, sparser than the Gabriel graph. This is the base local-lane graph (spec §5 rework —
 *  chosen over Gabriel by measured lanes/system, see `density-field.ts`/`universe-gen.ts` callers).
 *  Edges come back ordered by `(a, b)` ascending, the order the brute-force reference produces, so
 *  every downstream tie-break (Kruskal replays, longest-first pruning) reads the same sequence.
 *  Consumes no RNG draws — the graph is pure geometry. */
export function relativeNeighbourhoodGraphEdges(pointsInSet: { x: number; y: number }[]): Edge[] {
  const n = pointsInSet.length;
  if (n < 2) return [];
  if (n <= NEIGHBOURHOOD_BRUTE_FORCE_MAX_POINTS) return relativeNeighbourhoodGraphEdgesBruteForce(pointsInSet);

  const grid = buildPointGrid(pointsInSet);
  const candidates = new Set<number>();
  for (let a = 0; a < n; a++) collectConeCandidates(pointsInSet, grid, a, candidates);

  const edges: Edge[] = [];
  for (const key of candidates) {
    const a = Math.floor(key / n);
    const b = key % n;
    if (!isRelativeNeighbourEdgeLocal(pointsInSet, grid, a, b)) continue;
    edges.push({ a, b, dist: distance(pointsInSet[a].x, pointsInSet[a].y, pointsInSet[b].x, pointsInSet[b].y) });
  }
  edges.sort((x, y) => x.a - y.a || x.b - y.b);
  return edges;
}
