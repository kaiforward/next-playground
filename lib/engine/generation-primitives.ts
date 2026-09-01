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
