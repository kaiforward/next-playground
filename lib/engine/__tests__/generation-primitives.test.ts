import { describe, it, expect } from "vitest";
import {
  mulberry32,
  relativeNeighbourhoodGraphEdges,
  relativeNeighbourhoodGraphEdgesBruteForce,
  type Edge,
} from "../generation-primitives";

/** `n` pseudo-random points over a `size` square, from a seeded stream — deterministic fixtures. */
function scatter(seed: number, n: number, size: number): { x: number; y: number }[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => ({ x: rng() * size, y: rng() * size }));
}

/** Points in a few tight blobs with empty space between them — the arrangement real placement
 *  produces, and the one where a point on a blob's rim has angular bins that stay empty. */
function clustered(seed: number, blobs: number, perBlob: number, size: number): { x: number; y: number }[] {
  const rng = mulberry32(seed);
  const points: { x: number; y: number }[] = [];
  for (let b = 0; b < blobs; b++) {
    const cx = rng() * size;
    const cy = rng() * size;
    for (let i = 0; i < perBlob; i++) {
      points.push({ x: cx + (rng() - 0.5) * size * 0.08, y: cy + (rng() - 0.5) * size * 0.08 });
    }
  }
  return points;
}

function edgeList(edges: Edge[]): string[] {
  return edges.map((e) => `${e.a}-${e.b}@${e.dist}`);
}

describe("relativeNeighbourhoodGraphEdges — grid acceleration is output-identical", () => {
  // The accelerated pass enumerates candidates per angular bin instead of over every pair. That is
  // only a valid optimisation if the edge SET and its ORDER both survive: order feeds every
  // downstream tie-break (the Kruskal replays in pruneLaneDensity and realizeBandChain).
  const fixtures: Array<{ name: string; points: { x: number; y: number }[] }> = [
    { name: "100 scattered points", points: scatter(1, 100, 5000) },
    { name: "300 scattered points", points: scatter(2, 300, 5000) },
    { name: "500 scattered points", points: scatter(3, 500, 5000) },
    { name: "500 points in a thin strip", points: scatter(4, 500, 5000).map((p) => ({ x: p.x, y: p.y * 0.02 })) },
    { name: "6 blobs of 50", points: clustered(5, 6, 50, 8000) },
    { name: "12 blobs of 40", points: clustered(6, 12, 40, 8000) },
    {
      name: "a regular lattice (every distance a tie)",
      points: Array.from({ length: 400 }, (_, i) => ({ x: (i % 20) * 100, y: Math.floor(i / 20) * 100 })),
    },
  ];

  for (const { name, points } of fixtures) {
    it(`matches the brute-force reference edge for edge: ${name}`, () => {
      const reference = relativeNeighbourhoodGraphEdgesBruteForce(points);
      const accelerated = relativeNeighbourhoodGraphEdges(points);
      expect(reference.length).toBeGreaterThan(0); // non-vacuous
      expect(edgeList(accelerated)).toEqual(edgeList(reference));
    });
  }

  it("still runs the brute-force path verbatim for a small point set", () => {
    const points = scatter(9, 20, 1000);
    expect(edgeList(relativeNeighbourhoodGraphEdges(points))).toEqual(
      edgeList(relativeNeighbourhoodGraphEdgesBruteForce(points)),
    );
  });

  it("completes a 20,000-point set far faster than the O(n^3) reference could", () => {
    // The reference is not run here — at 20,000 points it is the runaway this acceleration exists
    // to remove. This is the no-runaway bound; the identity claim is the fixtures above.
    const points = scatter(11, 20_000, 40_000);
    const start = performance.now();
    const edges = relativeNeighbourhoodGraphEdges(points);
    const elapsedMs = performance.now() - start;
    expect(edges.length).toBeGreaterThan(points.length); // a connected planar graph, not a stub
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
