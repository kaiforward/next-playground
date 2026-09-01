import { describe, expect, it } from "vitest";
import {
  buildGalaxyShape,
  defaultGalaxyShapeKnobs,
  type GalaxyShapeKnobs,
} from "@/lib/engine/density-field";
import { mulberry32, UnionFind } from "@/lib/engine/generation-primitives";

const MAP_SIZE = 7000;

function knobs(overrides: Partial<GalaxyShapeKnobs> = {}): GalaxyShapeKnobs {
  return {
    clusterCount: 12,
    sizeSkew: 0.6,
    clusterSpacing: 800,
    voidFloor: 0.08,
    corridorsPerCluster: 0.3,
    corridorStyle: 0.5,
    clusterTurbulence: 0,
    ...overrides,
  };
}

describe("buildGalaxyShape", () => {
  it("floors below-threshold cells to exactly 0, never a small positive value", () => {
    const shape = buildGalaxyShape(knobs({ voidFloor: 0.5 }), MAP_SIZE, mulberry32(42));

    let sawZero = false;
    for (const cell of shape.grid.cells) {
      if (cell === 0) {
        sawZero = true;
        continue;
      }
      expect(cell).toBeGreaterThanOrEqual(0.5);
    }
    expect(sawZero).toBe(true);
  });

  it("skews cluster sizes toward small, not a uniform draw", () => {
    const many = knobs({ clusterCount: 400, clusterSpacing: 60 });
    const skewed = buildGalaxyShape({ ...many, sizeSkew: 0.9 }, MAP_SIZE, mulberry32(7));
    const uniform = buildGalaxyShape({ ...many, sizeSkew: 0 }, MAP_SIZE, mulberry32(7));

    const minSize = MAP_SIZE * 0.04;
    const maxSize = MAP_SIZE * 0.14;
    const midpoint = (minSize + maxSize) / 2;

    const fractionAboveMidpoint = (seeds: typeof skewed.seeds): number =>
      seeds.filter((s) => s.size > midpoint).length / seeds.length;

    const skewedFraction = fractionAboveMidpoint(skewed.seeds);
    const uniformFraction = fractionAboveMidpoint(uniform.seeds);

    // Uniform draws over [min, max] put ~half the seeds above the midpoint; a skewed draw
    // (few large, many small) puts a small minority there instead.
    expect(uniformFraction).toBeGreaterThan(0.35);
    expect(skewedFraction).toBeLessThan(0.25);
    expect(skewedFraction).toBeLessThan(uniformFraction);
  });

  it("connects every seed via the corridor MST, each pair carrying a band or crossing style", () => {
    const shape = buildGalaxyShape(knobs({ clusterCount: 10, corridorsPerCluster: 0 }), MAP_SIZE, mulberry32(99));

    expect(shape.corridors.pairs.length).toBe(shape.seeds.length - 1);

    const uf = new UnionFind(shape.seeds.length);
    for (const pair of shape.corridors.pairs) {
      expect(["band", "crossing"]).toContain(pair.style);
      uf.union(pair.a, pair.b);
    }

    for (let i = 1; i < shape.seeds.length; i++) {
      expect(uf.connected(0, i)).toBe(true);
    }
  });

  it("raises a thin band of cells along a band-style corridor's seed-to-seed line", () => {
    // Two clusters, spaced well beyond twice the max seed-size radius, so the corridor midpoint
    // sits in what would otherwise be true void: only band-writing can raise it.
    const shape = buildGalaxyShape(
      knobs({ clusterCount: 2, clusterSpacing: 3500, corridorsPerCluster: 0, corridorStyle: 0, voidFloor: 0.05 }),
      MAP_SIZE,
      mulberry32(5),
    );

    expect(shape.corridors.pairs.length).toBe(1);
    const [pair] = shape.corridors.pairs;
    expect(pair.style).toBe("band");

    const a = shape.seeds[pair.a];
    const b = shape.seeds[pair.b];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const resolution = shape.grid.resolution;
    const col = Math.min(resolution - 1, Math.floor((midX / MAP_SIZE) * resolution));
    const row = Math.min(resolution - 1, Math.floor((midY / MAP_SIZE) * resolution));
    const midCell = shape.grid.cells[row * resolution + col];

    expect(midCell).toBeGreaterThan(0.05);
    // Sparse chain, not another cluster core: clearly below a fully-inside-a-seed density.
    expect(midCell).toBeLessThan(0.5);
  });

  it("leaves crossing-style corridors grid-silent at the all-crossing extreme", () => {
    // Same void-spacing setup as the band test, but corridorStyle: 1 forces every pair crossing —
    // the seed-to-seed line must stay true void (0), not a raised band.
    const shape = buildGalaxyShape(
      knobs({ clusterCount: 2, clusterSpacing: 3500, corridorsPerCluster: 0, corridorStyle: 1, voidFloor: 0.05 }),
      MAP_SIZE,
      mulberry32(5),
    );

    expect(shape.corridors.pairs.length).toBe(1);
    const [pair] = shape.corridors.pairs;
    expect(pair.style).toBe("crossing");

    const a = shape.seeds[pair.a];
    const b = shape.seeds[pair.b];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const resolution = shape.grid.resolution;
    const col = Math.min(resolution - 1, Math.floor((midX / MAP_SIZE) * resolution));
    const row = Math.min(resolution - 1, Math.floor((midY / MAP_SIZE) * resolution));
    const midCell = shape.grid.cells[row * resolution + col];

    expect(midCell).toBe(0);
  });

  it("produces a byte-identical grid for the same knobs and seed", () => {
    const first = buildGalaxyShape(knobs(), MAP_SIZE, mulberry32(2024));
    const second = buildGalaxyShape(knobs(), MAP_SIZE, mulberry32(2024));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("yields a valid grid for a degenerate single-cluster knob set", () => {
    const shape = buildGalaxyShape(knobs({ clusterCount: 1 }), MAP_SIZE, mulberry32(1));

    expect(shape.seeds.length).toBe(1);
    expect(shape.corridors.pairs.length).toBe(0);
    expect(shape.grid.cells.length).toBe(shape.grid.resolution * shape.grid.resolution);
    for (const cell of shape.grid.cells) {
      expect(Number.isFinite(cell)).toBe(true);
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the grid JSON-serialisable (no NaN/Infinity survive a round trip)", () => {
    const shape = buildGalaxyShape(knobs(), MAP_SIZE, mulberry32(11));
    const roundTripped = JSON.parse(JSON.stringify(shape.grid)) as typeof shape.grid;
    expect(roundTripped).toEqual(shape.grid);
  });
});

describe("defaultGalaxyShapeKnobs", () => {
  it("derives cluster count continuously with system count, like region count today", () => {
    const small = defaultGalaxyShapeKnobs(600);
    const large = defaultGalaxyShapeKnobs(10_000);
    expect(small.clusterCount).toBeGreaterThan(0);
    expect(large.clusterCount).toBeGreaterThan(small.clusterCount);
  });
});

describe("clusterTurbulence", () => {
  // These pin the design constraint from the module docstring: turbulence rolls from a stream
  // derived from each seed's own already-rolled position, never the main `rng` passed into
  // buildGalaxyShape — so turbulence can perturb cell densities but must NEVER shift where the
  // main stream's next draw lands (seed placement, corridor planning).
  it("leaves seed positions and the corridor plan byte-identical at turbulence 0 vs 0.8 — only cell densities may differ", () => {
    const many = knobs({ clusterCount: 20, clusterSpacing: 200, corridorsPerCluster: 0.3 });
    const calm = buildGalaxyShape({ ...many, clusterTurbulence: 0 }, MAP_SIZE, mulberry32(2026));
    const turbulent = buildGalaxyShape({ ...many, clusterTurbulence: 0.8 }, MAP_SIZE, mulberry32(2026));

    // Seed positions/shape (everything but the derived peakMultiplier) are unperturbed.
    const stripMultiplier = (seeds: typeof calm.seeds) =>
      seeds.map(({ peakMultiplier: _peakMultiplier, ...rest }) => rest);
    expect(stripMultiplier(turbulent.seeds)).toEqual(stripMultiplier(calm.seeds));

    // Corridor planning consumes the main rng after placement — its draw position, and therefore
    // its output, is untouched too.
    expect(turbulent.corridors).toEqual(calm.corridors);

    // The turbulence knob does something real: cell densities actually differ somewhere.
    expect(turbulent.grid.cells).not.toEqual(calm.grid.cells);
  });

  it("holds every peak multiplier at exactly 1 when turbulence is 0", () => {
    const shape = buildGalaxyShape(knobs({ clusterCount: 30, clusterSpacing: 200, clusterTurbulence: 0 }), MAP_SIZE, mulberry32(3));
    for (const seed of shape.seeds) {
      expect(seed.peakMultiplier).toBe(1);
    }
  });

  it("produces at least two seeds with materially different peak multipliers at turbulence 0.8", () => {
    const shape = buildGalaxyShape(
      knobs({ clusterCount: 30, clusterSpacing: 200, clusterTurbulence: 0.8 }),
      MAP_SIZE,
      mulberry32(3),
    );
    const multipliers = shape.seeds.map((s) => s.peakMultiplier);
    const min = Math.min(...multipliers);
    const max = Math.max(...multipliers);
    expect(max - min).toBeGreaterThan(0.3);
  });

  it("produces a byte-identical grid for the same knobs, seed, and turbulence twice", () => {
    const t = knobs({ clusterCount: 15, clusterSpacing: 200, clusterTurbulence: 0.6 });
    const first = buildGalaxyShape(t, MAP_SIZE, mulberry32(555));
    const second = buildGalaxyShape(t, MAP_SIZE, mulberry32(555));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
