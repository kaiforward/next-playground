import { describe, it, expect } from "vitest";
import {
  mulberry32,
  distance,
  randInt,
  UnionFind,
  bridsonSample,
  assignRegions,
  generateRegions,
  generateSystems,
  generateConnections,
  generateUniverse,
  stampHomeworldPrefabs,
  realizeCorridors,
  type GenParams,
  type GeneratedRegion,
  type GeneratedSystem,
} from "../universe-gen";
import {
  buildGalaxyShape,
  type DensityGrid, type ClusterSeed, type CorridorPlan,
} from "@/lib/engine/density-field";
import { HOME_SYSTEM_PREFAB } from "@/lib/engine/homeworld-prefab";
import { emptyResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import {
  genConfigForSystemCount,
  DEFAULT_SYSTEM_COUNT,
  REGION_NAMES,
} from "@/lib/constants/universe-gen";
import { buildGenParams } from "@/lib/world/gen";
import { SUN_CLASSES, BODY_ARCHETYPES } from "@/lib/constants/bodies";
import { generateSubstrate, type GeneratedBody } from "@/lib/engine/body-gen";
import type { BodyArchetypeId } from "@/lib/types/game";
import { depositSlotOrder, workedYieldFold, workedYieldVectors } from "@/lib/engine/worked-deposits";
import { deriveEconomyTypeLabel } from "@/lib/engine/economy-type";

// ── Helpers ─────────────────────────────────────────────────────

const DEFAULT_GEN_CONFIG = genConfigForSystemCount(DEFAULT_SYSTEM_COUNT);

function defaultParams(): GenParams {
  return buildGenParams(DEFAULT_GEN_CONFIG.SEED, DEFAULT_GEN_CONFIG);
}

/** A fully nonzero-density grid, resolution `n` — bridsonSample degrades to the old fixed-radius
 *  behaviour whenever every cell reads 1 (max density everywhere). */
function uniformGrid(n = 4): DensityGrid {
  return { resolution: n, cells: new Array(n * n).fill(1) };
}

/** Same lookup `densityAt` (universe-gen.ts, not exported) performs — a test-only oracle so tests
 *  can check placement against the grid without widening the module's public surface. */
function densityAtForTest(grid: DensityGrid, mapSize: number, x: number, y: number): number {
  const cellSize = mapSize / grid.resolution;
  const col = Math.min(grid.resolution - 1, Math.max(0, Math.floor(x / cellSize)));
  const row = Math.min(grid.resolution - 1, Math.max(0, Math.floor(y / cellSize)));
  return grid.cells[row * grid.resolution + col];
}

/** Reconstructs the exact `GalaxyShape` `generateUniverse` builds internally: `buildGalaxyShape` is
 *  the first rng-consuming call off a freshly-seeded PRNG, so replaying that same first call from
 *  the same seed reproduces byte-identical seeds/grid/corridors. */
function shapeFor(params: GenParams) {
  const rng = mulberry32(params.seed);
  return buildGalaxyShape(params.shapeKnobs, params.mapSize, rng);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Nearest-neighbour distance from `sys` to any other system in `systems`. */
function nearestNeighbourDistance(sys: { x: number; y: number }, systems: { x: number; y: number }[]): number {
  let best = Infinity;
  for (const other of systems) {
    if (other === sys) continue;
    const d = distance(sys.x, sys.y, other.x, other.y);
    if (d < best) best = d;
  }
  return best;
}

/** Minimal GeneratedSystem for unit tests — only the fields under test matter; rest are inert defaults. */
function mkSys(p: Partial<GeneratedSystem> & { index: number }): GeneratedSystem {
  return {
    name: `s${p.index}`, economyType: "extraction", sunClass: "yellow",
    bodies: [], popCap: 0, population: 0, bodyDanger: 0, buildings: {},
 peopleLand: 0,
    depositCounts: emptyResourceVector(), yieldMult: emptyResourceVector(),
    extractionEfficiency: emptyResourceVector(),
    potentialYieldMult: emptyResourceVector(), potentialExtractionEfficiency: emptyResourceVector(),
    x: 0, y: 0, regionIndex: 0, isGateway: false, description: "",
    ...p,
  };
}

/** BFS reachability from a start node in a directed adjacency list. */
function bfsReachable(adj: Map<number, number[]>, start: number): Set<number> {
  const visited = new Set<number>();
  const queue = [start];
  visited.add(start);
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const neighbor of adj.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

// ── PRNG ────────────────────────────────────────────────────────

describe("mulberry32 PRNG", () => {
  it("produces deterministic sequences from the same seed", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    const seq1 = Array.from({ length: 100 }, () => rng1());
    const seq2 = Array.from({ length: 100 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces different sequences for different seeds", () => {
    const rng1 = mulberry32(1);
    const rng2 = mulberry32(2);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).not.toEqual(seq2);
  });
});

// ── Utility functions ───────────────────────────────────────────

describe("distance", () => {
  it("computes Euclidean distance", () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(distance(1, 1, 1, 1)).toBe(0);
  });
});

describe("randInt", () => {
  it("returns integers within range", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = randInt(rng, 5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

// ── UnionFind ───────────────────────────────────────────────────

describe("UnionFind", () => {
  it("tracks connected components", () => {
    const uf = new UnionFind(5);
    expect(uf.connected(0, 1)).toBe(false);
    uf.union(0, 1);
    expect(uf.connected(0, 1)).toBe(true);
    uf.union(2, 3);
    expect(uf.connected(0, 3)).toBe(false);
    uf.union(1, 3);
    expect(uf.connected(0, 3)).toBe(true);
  });

  it("union returns false for already-connected nodes", () => {
    const uf = new UnionFind(3);
    expect(uf.union(0, 1)).toBe(true);
    expect(uf.union(0, 1)).toBe(false);
  });
});

// ── Bridson's Poisson disk sampling ──────────────────────────────

describe("bridsonSample", () => {
  it("generates well-spaced points with guaranteed minimum distance under a uniform (max-density) grid", () => {
    const rng = mulberry32(42);
    const minDist = 250;
    const points = bridsonSample(rng, 7000, 7000, minDist, 30, 700, 600, uniformGrid());

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = distance(points[i].x, points[i].y, points[j].x, points[j].y);
        // Allow tiny floating point tolerance
        expect(d).toBeGreaterThanOrEqual(minDist - 0.01);
      }
    }
  });

  it("respects maxPoints limit", () => {
    const rng = mulberry32(42);
    const points = bridsonSample(rng, 7000, 7000, 250, 30, 700, 100, uniformGrid());
    expect(points.length).toBeLessThanOrEqual(100);
    expect(points.length).toBeGreaterThan(0);
  });

  it("places all points within padded bounds", () => {
    const rng = mulberry32(42);
    const padding = 700;
    const size = 7000;
    const points = bridsonSample(rng, size, size, 250, 30, padding, 600, uniformGrid());

    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(padding);
      expect(p.x).toBeLessThan(size - padding);
      expect(p.y).toBeGreaterThanOrEqual(padding);
      expect(p.y).toBeLessThan(size - padding);
    }
  });

  it("is deterministic with the same RNG seed", () => {
    const p1 = bridsonSample(mulberry32(42), 7000, 7000, 250, 30, 700, 600, uniformGrid());
    const p2 = bridsonSample(mulberry32(42), 7000, 7000, 250, 30, 700, 600, uniformGrid());
    expect(p1).toEqual(p2);
  });

  it("never places a point in a zero-density cell", () => {
    // Left half of the grid is true void (0), right half is at max density (1).
    const resolution = 8;
    const cells = new Array(resolution * resolution).fill(0).map((_, i) => {
      const col = i % resolution;
      return col < resolution / 2 ? 0 : 1;
    });
    const grid: DensityGrid = { resolution, cells };
    const size = 7000;
    const points = bridsonSample(mulberry32(7), size, size, 200, 30, 700, 400, grid);

    expect(points.length).toBeGreaterThan(0); // non-vacuous: the right half did get placed
    for (const p of points) {
      expect(densityAtForTest(grid, size, p.x, p.y)).toBeGreaterThan(0);
      expect(p.x).toBeGreaterThanOrEqual(size / 2);
    }
  });
});

// ── Region generation ───────────────────────────────────────────

describe("generateRegions", () => {
  function fakeSeeds(n: number): ClusterSeed[] {
    return Array.from({ length: n }, (_, i) => ({
      x: i * 100, y: i * 200, size: 500, stretch: 1, angle: 0, peakMultiplier: 1,
    }));
  }

  it("region becomes cluster: one region per seed, center = seed position", () => {
    const seeds = fakeSeeds(5);
    const regions = generateRegions(seeds, REGION_NAMES);
    expect(regions).toHaveLength(seeds.length);
    regions.forEach((r, i) => {
      expect(r.x).toBe(seeds[i].x);
      expect(r.y).toBe(seeds[i].y);
      expect(r.index).toBe(i);
    });
  });

  it("assigns unique names to all regions", () => {
    const params = defaultParams();
    const regions = generateRegions(shapeFor(params).seeds, REGION_NAMES);
    const names = regions.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names past 28 clusters via the wrap path without collision", () => {
    // REGION_NAMES has exactly 28 entries — 30 seeds forces the pool to wrap twice.
    expect(REGION_NAMES.length).toBe(28);
    const regions = generateRegions(fakeSeeds(30), REGION_NAMES);
    const names = regions.map((r) => r.name);
    expect(new Set(names).size).toBe(30);
    // The wrapped names must be visibly distinct from (not silently equal to) the names they wrap onto.
    expect(regions[28].name).not.toBe(regions[0].name);
    expect(regions[29].name).not.toBe(regions[1].name);
  });
});

// ── System generation ───────────────────────────────────────────

describe("generateSystems", () => {
  const params = defaultParams();

  function makeRegionsAndSystems() {
    const rng = mulberry32(params.seed);
    const shape = buildGalaxyShape(params.shapeKnobs, params.mapSize, rng);
    const regions = generateRegions(shape.seeds, REGION_NAMES);
    const systems = generateSystems(rng, regions, params, shape.grid);
    return { regions, systems, grid: shape.grid };
  }

  it("no system lands in a zero-density cell", () => {
    const { systems, grid } = makeRegionsAndSystems();
    expect(systems.length).toBeGreaterThan(0); // non-vacuous
    for (const s of systems) {
      expect(densityAtForTest(grid, params.mapSize, s.x, s.y)).toBeGreaterThan(0);
    }
  });

  it("median nearest-neighbour distance is tighter in a high-density region than a low-density one (density actually modulates the radius)", () => {
    // Two full, equal-area 2D halves of the map at different (both nonzero) density — not a
    // cluster-core-vs-thin-corridor-band split — so packing geometry (a strip has fewer neighbour
    // directions than an open area) can't confound the read: only the density->radius mapping can
    // explain a spacing difference between two halves shaped identically.
    const resolution = 8;
    const highDensity = 0.9;
    const lowDensity = 0.15;
    const cells = new Array(resolution * resolution).fill(0).map((_, i) => {
      const col = i % resolution;
      return col < resolution / 2 ? highDensity : lowDensity;
    });
    const grid: DensityGrid = { resolution, cells };
    const size = 4000;
    const rng = mulberry32(42);
    const points = bridsonSample(rng, size, size, 60, 30, 200, 2000, grid);

    const highHalf = points.filter((p) => p.x < size / 2);
    const lowHalf = points.filter((p) => p.x >= size / 2);
    expect(highHalf.length).toBeGreaterThan(20); // non-vacuous: both halves are real cohorts
    expect(lowHalf.length).toBeGreaterThan(20);

    const highMedian = median(highHalf.map((p) => nearestNeighbourDistance(p, points)));
    const lowMedian = median(lowHalf.map((p) => nearestNeighbourDistance(p, points)));
    expect(highMedian).toBeLessThan(lowMedian);
  });

  it("every system's region is its nearest seed", () => {
    const { regions, systems } = makeRegionsAndSystems();
    for (const s of systems) {
      let bestIdx = 0;
      let bestDist = distance(s.x, s.y, regions[0].x, regions[0].y);
      for (let i = 1; i < regions.length; i++) {
        const d = distance(s.x, s.y, regions[i].x, regions[i].y);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      expect(s.regionIndex).toBe(bestIdx);
    }
  });

  it("generates approximately the target number of systems", () => {
    const { systems } = makeRegionsAndSystems();
    // Density-shaped placement deliberately leaves void (and a cluster's own low-density rim)
    // unfilled (spec §5), so the floor is far looser than the old near-uniform guarantee — the
    // shipped default knobs are Gate-A-tunable proposals, not a target this task calibrates. The
    // ceiling (never overshoot the requested count) still holds exactly.
    expect(systems.length).toBeGreaterThanOrEqual(params.totalSystems * 0.2);
    expect(systems.length).toBeLessThanOrEqual(params.totalSystems);
  });

  it("every system is assigned to a valid region", () => {
    const { regions, systems } = makeRegionsAndSystems();
    const regionIndices = new Set(regions.map((r) => r.index));
    for (const sys of systems) {
      expect(regionIndices.has(sys.regionIndex)).toBe(true);
    }
  });

  it("all systems maintain minimum Poisson distance", () => {
    const { systems } = makeRegionsAndSystems();
    for (let i = 0; i < systems.length; i++) {
      for (let j = i + 1; j < systems.length; j++) {
        const d = distance(systems[i].x, systems[i].y, systems[j].x, systems[j].y);
        expect(d).toBeGreaterThanOrEqual(params.poissonMinDistance - 0.01);
      }
    }
  });

  it("assigns every system a sun class and at least one body", () => {
    const { systems } = makeRegionsAndSystems();
    for (const sys of systems) {
      expect(SUN_CLASSES[sys.sunClass]).toBeDefined();
      expect(sys.bodies.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("seeds population between 0 and pop cap", () => {
    const { systems } = makeRegionsAndSystems();
    for (const sys of systems) {
      expect(sys.population).toBeGreaterThanOrEqual(0);
      expect(sys.population).toBeLessThanOrEqual(sys.popCap);
    }
  });

  it("derives the substrate-driven economy types, none dominating", () => {
    const { systems } = makeRegionsAndSystems();
    const econCounts = new Map<string, number>();
    for (const sys of systems) {
      econCounts.set(sys.economyType, (econCounts.get(sys.economyType) ?? 0) + 1);
    }
    // generateSystems produces BARE substrate (population 0), so the economy label here is purely
    // deposit-driven — the three resource-based types always appear. The population-gated types
    // (core / industrial / tech) come only from the stamped faction capitals (generateUniverse).
    for (const econ of ["agricultural", "extraction", "refinery"]) {
      expect(econCounts.get(econ) ?? 0, econ).toBeGreaterThan(0);
    }
    for (const [, count] of econCounts) {
      // ≤ 0.80 catches a near-total takeover only, never the designed extraction plurality —
      // rationale in universe-gen-invariants.test.ts, which holds the same bar across seeds.
      expect(count / systems.length).toBeLessThanOrEqual(0.80);
    }
  });

  it("assigns unique global indices", () => {
    const { systems } = makeRegionsAndSystems();
    const indices = systems.map((s) => s.index);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("every occupied (nonzero-density) location is near some system — void points are exempt by design", () => {
    const { systems, grid } = makeRegionsAndSystems();
    const rng = mulberry32(999);
    const padding = params.mapSize * params.mapPadding;
    // The local radius can be as sparse as the sampler's density-radius cap (6x baseMinDistance);
    // allow a further factor of 2 for the annulus growth step's own reach beyond that.
    const maxGap = params.poissonMinDistance * 12;
    let checked = 0;
    for (let i = 0; i < 1000 && checked < 100; i++) {
      const tx = padding + rng() * (params.mapSize - 2 * padding);
      const ty = padding + rng() * (params.mapSize - 2 * padding);
      if (densityAtForTest(grid, params.mapSize, tx, ty) <= 0) continue; // true void — no guarantee
      checked++;
      let minDist = Infinity;
      for (const s of systems) {
        const d = distance(tx, ty, s.x, s.y);
        if (d < minDist) minDist = d;
      }
      expect(minDist).toBeLessThan(maxGap);
    }
    expect(checked).toBeGreaterThan(50); // non-vacuous: plenty of nonzero-density samples were tested
  });
});

// ── Region assignment ───────────────────────────────────────────

describe("assignRegions", () => {
  it("assigns each point to the nearest region center", () => {
    const regions: GeneratedRegion[] = [
      { index: 0, name: "A", x: 100, y: 100 },
      { index: 1, name: "B", x: 900, y: 900 },
    ];
    const points = [
      { x: 150, y: 150 }, // closest to A
      { x: 800, y: 800 }, // closest to B
      { x: 500, y: 500 }, // equidistant, should pick one consistently
    ];
    const assignments = assignRegions(points, regions);
    expect(assignments[0]).toBe(0);
    expect(assignments[1]).toBe(1);
  });
});

// ── Connection generation ───────────────────────────────────────

describe("generateConnections", () => {
  const params = defaultParams();

  function makeFullUniverse() {
    const rng = mulberry32(params.seed);
    const shape = buildGalaxyShape(params.shapeKnobs, params.mapSize, rng);
    const regions = generateRegions(shape.seeds, REGION_NAMES);
    const rawSystems = generateSystems(rng, regions, params, shape.grid);
    const result = generateConnections(rng, rawSystems, regions, shape.corridors, params);
    return { regions, corridors: shape.corridors, ...result };
  }

  /** Union-find over every undirected lane in `connections`, indexed by `systems` array position
   *  (not `GeneratedSystem.index`, which the caller's own local slice may not start at 0). */
  function connectivityComponents(
    systems: GeneratedSystem[], connections: { fromSystemIndex: number; toSystemIndex: number }[],
  ): UnionFind {
    const posByIndex = new Map<number, number>();
    systems.forEach((s, pos) => posByIndex.set(s.index, pos));
    const uf = new UnionFind(systems.length);
    for (const c of connections) {
      const a = posByIndex.get(c.fromSystemIndex);
      const b = posByIndex.get(c.toSystemIndex);
      if (a !== undefined && b !== undefined) uf.union(a, b);
    }
    return uf;
  }

  it("all intra-region systems are connected (BFS)", () => {
    const { regions, systems, connections } = makeFullUniverse();

    for (const region of regions) {
      const regionSys = systems.filter((s) => s.regionIndex === region.index);
      if (regionSys.length < 2) continue;

      // Build adjacency list for this region's systems
      const regionIndices = new Set(regionSys.map((s) => s.index));
      const adj = new Map<number, number[]>();
      for (const s of regionSys) adj.set(s.index, []);

      for (const conn of connections) {
        if (regionIndices.has(conn.fromSystemIndex) && regionIndices.has(conn.toSystemIndex)) {
          adj.get(conn.fromSystemIndex)!.push(conn.toSystemIndex);
        }
      }

      const reachable = bfsReachable(adj, regionSys[0].index);
      expect(reachable.size).toBe(regionSys.length);
    }
  });

  // ── Proves: "the finished lane graph is fully connected" ──
  it("the finished lane graph is fully connected — every system reachable from every other (union-find over lanes)", () => {
    const { systems, connections } = makeFullUniverse();
    expect(systems.length).toBeGreaterThan(1); // non-vacuous

    const uf = connectivityComponents(systems, connections);
    const root = uf.find(0);
    for (let pos = 1; pos < systems.length; pos++) {
      expect(uf.find(pos), `system ${systems[pos].index} unreachable from system ${systems[0].index}`).toBe(root);
    }
  });

  it("connections are bidirectional", () => {
    const { connections } = makeFullUniverse();
    const edgeSet = new Set(connections.map((c) => `${c.fromSystemIndex}-${c.toSystemIndex}`));
    for (const conn of connections) {
      expect(edgeSet.has(`${conn.toSystemIndex}-${conn.fromSystemIndex}`)).toBe(true);
    }
  });

  // ── Proves: "no cross-cluster lane exists outside a corridor pair the plan chose" ──
  it("isCrossing lanes exist exactly one per crossing-style corridor pair with both sides populated", () => {
    const { systems, connections, corridors } = makeFullUniverse();
    const crossingPairsWithSystems = corridors.pairs.filter(
      (p) => p.style === "crossing"
        && systems.some((s) => s.regionIndex === p.a)
        && systems.some((s) => s.regionIndex === p.b),
    );
    expect(crossingPairsWithSystems.length).toBeGreaterThan(0); // non-vacuous — default corridorStyle mix

    // Undirected count: pushLane always writes both directed rows.
    const crossingLaneCount = connections.filter((c) => c.isCrossing).length / 2;
    expect(crossingLaneCount).toBe(crossingPairsWithSystems.length);
  });

  it("no isCrossing lane connects two systems whose regions aren't a crossing-style corridor pair", () => {
    const { systems, connections, corridors } = makeFullUniverse();
    const crossingRegionPairs = new Set(
      corridors.pairs.filter((p) => p.style === "crossing").map((p) => `${Math.min(p.a, p.b)}-${Math.max(p.a, p.b)}`),
    );
    const byIndex = new Map(systems.map((s) => [s.index, s]));
    let sawCrossing = false;
    for (const conn of connections) {
      if (!conn.isCrossing) continue;
      sawCrossing = true;
      const fromRegion = byIndex.get(conn.fromSystemIndex)!.regionIndex;
      const toRegion = byIndex.get(conn.toSystemIndex)!.regionIndex;
      const key = `${Math.min(fromRegion, toRegion)}-${Math.max(fromRegion, toRegion)}`;
      expect(crossingRegionPairs.has(key)).toBe(true);
    }
    expect(sawCrossing).toBe(true); // non-vacuous
  });

  it("marks isGateway on at least the anchors realizeCorridors itself designates, for every non-empty region touched by a corridor with a non-empty partner", () => {
    const { systems, corridors, regions } = makeFullUniverse();
    const avgIntraDistProxy = params.poissonMinDistance; // only relative fuel cost matters here, not read
    const replay = realizeCorridors(systems, regions, corridors, avgIntraDistProxy, params);
    const gatewaysFromReplay = new Set(replay.systems.filter((s) => s.isGateway).map((s) => s.index));
    const gatewaysFromFullRun = new Set(systems.filter((s) => s.isGateway).map((s) => s.index));
    // generateConnections calls realizeCorridors internally with the same corridor plan — its
    // gateway set must match a direct replay exactly (a regression guard on that wiring); the
    // exact "isGateway holds only on anchors, never a waypoint" claim is proven at the fixture
    // level below, where the anchor/waypoint set is known by construction.
    expect(gatewaysFromFullRun).toEqual(gatewaysFromReplay);
    expect(gatewaysFromFullRun.size).toBeGreaterThan(0); // non-vacuous
  });

  it("fuel costs are positive", () => {
    const { connections } = makeFullUniverse();
    for (const conn of connections) {
      expect(conn.fuelCost).toBeGreaterThanOrEqual(1);
    }
  });

  it("a map with corridorStyle at each extreme (all-band / all-crossing) generates validly, stays fully connected, and actually dispatches by style", () => {
    for (const corridorStyle of [0, 1]) {
      const config = genConfigForSystemCount(300);
      const extremeParams: GenParams = {
        ...buildGenParams(11, config),
        shapeKnobs: { ...buildGenParams(11, config).shapeKnobs, corridorStyle },
      };
      const rng = mulberry32(extremeParams.seed);
      const shape = buildGalaxyShape(extremeParams.shapeKnobs, extremeParams.mapSize, rng);
      const regions = generateRegions(shape.seeds, REGION_NAMES);
      const rawSystems = generateSystems(rng, regions, extremeParams, shape.grid);
      const { systems, connections } = generateConnections(rng, rawSystems, regions, shape.corridors, extremeParams);

      expect(systems.length).toBeGreaterThan(1); // non-vacuous
      const uf = connectivityComponents(systems, connections);
      const root = uf.find(0);
      for (let pos = 1; pos < systems.length; pos++) {
        expect(uf.find(pos)).toBe(root);
      }

      // Style dispatch itself, not just connectivity — a swapped `pair.style === "crossing"`
      // branch (crossing realised as a chain, band realised as a single lane) still connects
      // everything and would pass the connectivity check above alone.
      const byIndex = new Map(systems.map((s) => [s.index, s]));
      const populatedPairs = shape.corridors.pairs.filter(
        (p) => systems.some((s) => s.regionIndex === p.a) && systems.some((s) => s.regionIndex === p.b),
      );
      expect(populatedPairs.length).toBeGreaterThan(0); // non-vacuous

      if (corridorStyle === 1) {
        // All-crossing: every corridor pair realises as exactly one isCrossing lane between its
        // two regions — no waypoint chain (which would add extra connections and non-isCrossing
        // hops between the same two regions).
        for (const pair of populatedPairs) {
          const acrossPair = connections.filter((c) => {
            const fr = byIndex.get(c.fromSystemIndex)!.regionIndex;
            const tr = byIndex.get(c.toSystemIndex)!.regionIndex;
            return (fr === pair.a && tr === pair.b) || (fr === pair.b && tr === pair.a);
          });
          expect(acrossPair.length).toBe(2); // one undirected lane, two directed rows
          expect(acrossPair.every((c) => c.isCrossing)).toBe(true);
        }
      } else {
        // All-band: no isCrossing lane exists anywhere in the realised graph.
        expect(connections.some((c) => c.isCrossing)).toBe(false);
      }
    }
  });
});

// ── Corridor realisation (spec §5) ───────────────────────────────

describe("realizeCorridors", () => {
  const crossingParams = { intraRegionBaseFuel: 8, crossingFuelMultiplier: 2.5, poissonMinDistance: 100 };

  function region(index: number, x: number, y: number): GeneratedRegion {
    return { index, name: `r${index}`, x, y };
  }

  it("a crossing pair produces a single lane between the two nearest-facing anchors, both marked isGateway", () => {
    const regions = [region(0, 0, 0), region(1, 1000, 0)];
    const systems = [
      mkSys({ index: 0, regionIndex: 0, x: 0, y: 0 }),
      mkSys({ index: 1, regionIndex: 0, x: 400, y: 0 }), // nearer region 1 — the anchor
      mkSys({ index: 2, regionIndex: 1, x: 600, y: 0 }), // nearer region 0 — the anchor
      mkSys({ index: 3, regionIndex: 1, x: 1000, y: 0 }),
    ];
    const corridors: CorridorPlan = { pairs: [{ a: 0, b: 1, style: "crossing" }] };

    const { connections, systems: out } = realizeCorridors(systems, regions, corridors, 100, crossingParams);

    expect(connections).toHaveLength(2); // one undirected lane, two directed rows
    const [c1] = connections;
    expect(new Set([c1.fromSystemIndex, c1.toSystemIndex])).toEqual(new Set([1, 2]));
    expect(c1.isCrossing).toBe(true);
    expect(out.find((s) => s.index === 1)!.isGateway).toBe(true);
    expect(out.find((s) => s.index === 2)!.isGateway).toBe(true);
    expect(out.find((s) => s.index === 0)!.isGateway).toBe(false);
    expect(out.find((s) => s.index === 3)!.isGateway).toBe(false);
  });

  it("a band pair with waypoint systems on the line chains anchor -> waypoints (nearest-first) -> anchor, all at intra rate, isGateway only on the two anchors", () => {
    // Waypoints are region 2 — a third cluster, not either corridor endpoint. This isn't
    // incidental: a waypoint assigned to region 0 or 1 itself would compete for that region's own
    // anchor slot (nearestSystemTowardSeed picks the single closest-to-the-other-seed system in
    // each region), so a genuine multi-stop chain can only be built from systems outside both
    // endpoint clusters — exactly the case spec §5 flags as possible.
    const regions = [region(0, 0, 0), region(1, 1000, 0), region(2, 500, 500)];
    const systems = [
      mkSys({ index: 0, regionIndex: 0, x: 0, y: 0 }), // anchor A (only system in region 0)
      mkSys({ index: 1, regionIndex: 1, x: 1000, y: 0 }), // anchor B (only system in region 1)
      mkSys({ index: 2, regionIndex: 2, x: 700, y: 0 }), // waypoint, nearer B — placed second in the array on purpose
      mkSys({ index: 3, regionIndex: 2, x: 300, y: 0 }), // waypoint, nearer A
    ];
    const corridors: CorridorPlan = { pairs: [{ a: 0, b: 1, style: "band" }] };

    const { connections, systems: out } = realizeCorridors(systems, regions, corridors, 100, crossingParams);

    // Chain: 0 -> 3 -> 2 -> 1 (ordered by projection along the corridor), 3 lanes, 6 directed rows.
    expect(connections).toHaveLength(6);
    for (const c of connections) expect(c.isCrossing).toBe(false);
    const undirectedPairs = new Set(
      connections.map((c) => `${Math.min(c.fromSystemIndex, c.toSystemIndex)}-${Math.max(c.fromSystemIndex, c.toSystemIndex)}`),
    );
    expect(undirectedPairs).toEqual(new Set(["0-3", "2-3", "1-2"]));

    expect(out.find((s) => s.index === 0)!.isGateway).toBe(true);
    expect(out.find((s) => s.index === 1)!.isGateway).toBe(true);
    expect(out.find((s) => s.index === 2)!.isGateway).toBe(false);
    expect(out.find((s) => s.index === 3)!.isGateway).toBe(false);
  });

  it("a band pair with zero waypoint systems degrades to a single direct anchor-to-anchor lane", () => {
    const regions = [region(0, 0, 0), region(1, 1000, 0)];
    const systems = [
      mkSys({ index: 0, regionIndex: 0, x: 0, y: 0 }),
      mkSys({ index: 1, regionIndex: 1, x: 1000, y: 0 }),
    ];
    const corridors: CorridorPlan = { pairs: [{ a: 0, b: 1, style: "band" }] };

    const { connections } = realizeCorridors(systems, regions, corridors, 100, crossingParams);
    expect(connections).toHaveLength(2);
    expect(new Set([connections[0].fromSystemIndex, connections[0].toSystemIndex])).toEqual(new Set([0, 1]));
  });

  it("a waypoint far off the corridor line (beyond the perpendicular-distance threshold) is excluded from the chain", () => {
    const regions = [region(0, 0, 0), region(1, 1000, 0)];
    const systems = [
      mkSys({ index: 0, regionIndex: 0, x: 0, y: 0 }),
      mkSys({ index: 1, regionIndex: 1, x: 1000, y: 0 }),
      mkSys({ index: 2, regionIndex: 0, x: 500, y: 100_000 }), // far off the line
    ];
    const corridors: CorridorPlan = { pairs: [{ a: 0, b: 1, style: "band" }] };

    const { connections, systems: out } = realizeCorridors(systems, regions, corridors, 100, crossingParams);
    expect(connections).toHaveLength(2); // direct anchor-to-anchor, system 2 excluded
    expect(out.find((s) => s.index === 2)!.isGateway).toBe(false);
  });

  it("a cluster with zero placed systems anchors nothing on either of its corridor pairs, and does not throw", () => {
    const regions = [region(0, 0, 0), region(1, 1000, 0), region(2, 2000, 0)];
    const systems = [
      mkSys({ index: 0, regionIndex: 0, x: 0, y: 0 }),
      // region 1 has no placed systems at all
      mkSys({ index: 1, regionIndex: 2, x: 2000, y: 0 }),
    ];
    const corridors: CorridorPlan = {
      pairs: [{ a: 0, b: 1, style: "band" }, { a: 1, b: 2, style: "crossing" }],
    };

    const { connections, systems: out } = realizeCorridors(systems, regions, corridors, 100, crossingParams);
    expect(connections).toHaveLength(0);
    expect(out.every((s) => !s.isGateway)).toBe(true);
  });

  it("two corridors sharing an endpoint each anchor independently — a cluster of one system serves both", () => {
    const regions = [region(0, 0, 0), region(1, -1000, 0), region(2, 1000, 0)];
    const systems = [
      mkSys({ index: 0, regionIndex: 0, x: 0, y: 0 }), // the shared cluster's only system
      mkSys({ index: 1, regionIndex: 1, x: -1000, y: 0 }),
      mkSys({ index: 2, regionIndex: 2, x: 1000, y: 0 }),
    ];
    const corridors: CorridorPlan = {
      pairs: [{ a: 0, b: 1, style: "crossing" }, { a: 0, b: 2, style: "crossing" }],
    };

    const { connections, systems: out } = realizeCorridors(systems, regions, corridors, 100, crossingParams);
    expect(connections).toHaveLength(4); // two undirected crossing lanes
    expect(out.find((s) => s.index === 0)!.isGateway).toBe(true);
    const uf = new UnionFind(3);
    for (const c of connections) uf.union(c.fromSystemIndex, c.toSystemIndex);
    expect(uf.connected(0, 1)).toBe(true);
    expect(uf.connected(0, 2)).toBe(true);
  });

  // ── Proves: "a crossing lane costs more than an intra lane of the same length" ──
  it("a crossing lane costs strictly more than a band-realized lane over the same distance", () => {
    const regions = [region(0, 0, 0), region(1, 1000, 0)];
    const sameDistanceSystems = [
      mkSys({ index: 0, regionIndex: 0, x: 0, y: 0 }),
      mkSys({ index: 1, regionIndex: 1, x: 1000, y: 0 }),
    ];

    const crossing = realizeCorridors(
      sameDistanceSystems, regions, { pairs: [{ a: 0, b: 1, style: "crossing" }] }, 100, crossingParams,
    );
    const band = realizeCorridors(
      sameDistanceSystems, regions, { pairs: [{ a: 0, b: 1, style: "band" }] }, 100, crossingParams,
    );

    expect(crossing.connections[0].fuelCost).toBeGreaterThan(band.connections[0].fuelCost);
  });

  it("no cross-cluster lane exists outside a corridor pair the plan chose", () => {
    // Three clusters, but the plan connects only (0,1) — cluster 2 is deliberately excluded.
    const regions = [region(0, 0, 0), region(1, 1000, 0), region(2, 2000, 1000)];
    const systems = [
      mkSys({ index: 0, regionIndex: 0, x: 0, y: 0 }),
      mkSys({ index: 1, regionIndex: 1, x: 1000, y: 0 }),
      mkSys({ index: 2, regionIndex: 2, x: 2000, y: 1000 }),
      mkSys({ index: 3, regionIndex: 2, x: 2100, y: 1000 }),
    ];
    const corridors: CorridorPlan = { pairs: [{ a: 0, b: 1, style: "crossing" }] };

    const { connections } = realizeCorridors(systems, regions, corridors, 100, crossingParams);
    const touchedIndices = new Set(connections.flatMap((c) => [c.fromSystemIndex, c.toSystemIndex]));
    expect(touchedIndices.has(2)).toBe(false);
    expect(touchedIndices.has(3)).toBe(false);
  });
});

// ── Corridor provenance: the repair pass is a safety net, never routine ─────

describe("generateConnections — repair-pass provenance", () => {
  // isCrossing alone can't see a repair lane: connectRemainingComponents deliberately writes
  // isCrossing: false on the lanes it adds (they aren't the plan's own crossing class), so a
  // check that only filters on isCrossing is blind to them — this is the gap the review found.
  // repairLaneCount is generateConnections' own direct count of what connectRemainingComponents
  // added, so "the repair pass fired zero times" is asserted from that count, not inferred.
  function realGeneration(systemCount: number, seed: number) {
    const config = genConfigForSystemCount(systemCount);
    const params = buildGenParams(seed, config);
    const rng = mulberry32(params.seed);
    const shape = buildGalaxyShape(params.shapeKnobs, params.mapSize, rng);
    const regions = generateRegions(shape.seeds, REGION_NAMES);
    const rawSystems = generateSystems(rng, regions, params, shape.grid);
    return { regions, corridors: shape.corridors, ...generateConnections(rng, rawSystems, regions, shape.corridors, params) };
  }

  const cases: { systemCount: number; seed: number }[] = [
    ...[1, 2, 3, 42, 43, 44].map((seed) => ({ systemCount: 600, seed })),
    // 28 and 49 are load-bearing: without the per-cluster placement guarantee
    // (`generateSystems`'s `bridsonSample` seeding, spec §5), these two roll a NON-leaf empty
    // cluster in the corridor MST and the repair pass fires — the red-proof for this test.
    ...[1, 2, 3, 28, 49].map((seed) => ({ systemCount: 60, seed })),
  ];

  it("the repair pass fires zero times at default knobs, across seeds at 600 and 60 systems (every cluster seed placement guarantees a system to anchor its corridors)", () => {
    for (const { systemCount, seed } of cases) {
      const { regions, systems, repairLaneCount } = realGeneration(systemCount, seed);
      const emptyRegionCount = regions.filter((r) => !systems.some((s) => s.regionIndex === r.index)).length;
      expect(
        repairLaneCount,
        `systemCount=${systemCount} seed=${seed}: repair pass added ${repairLaneCount} unplanned lane(s) — emptyRegionCount=${emptyRegionCount}`,
      ).toBe(0);
    }
  });

  it("every crossing-style lane's region pair is a corridor the plan chose (unambiguous provenance — a band chain's interior waypoints may legitimately belong to neither endpoint's own cluster, so this checks only the lane class the plan pins to an exact pair)", () => {
    for (const { systemCount, seed } of cases) {
      const { systems, connections, corridors } = realGeneration(systemCount, seed);
      const byIndex = new Map(systems.map((s) => [s.index, s]));
      const plannedCrossingPairs = new Set(
        corridors.pairs.filter((p) => p.style === "crossing").map((p) => `${Math.min(p.a, p.b)}-${Math.max(p.a, p.b)}`),
      );
      for (const conn of connections) {
        if (!conn.isCrossing) continue;
        const fromRegion = byIndex.get(conn.fromSystemIndex)!.regionIndex;
        const toRegion = byIndex.get(conn.toSystemIndex)!.regionIndex;
        const key = `${Math.min(fromRegion, toRegion)}-${Math.max(fromRegion, toRegion)}`;
        expect(
          plannedCrossingPairs.has(key),
          `systemCount=${systemCount} seed=${seed}: isCrossing lane ${conn.fromSystemIndex}->${conn.toSystemIndex} crosses regions ${fromRegion}-${toRegion}, not a planned crossing-style pair`,
        ).toBe(true);
      }
    }
  });
});

// ── Emergent starting condition (home-system prefab) ────────────

describe("stampHomeworldPrefabs", () => {
  it("stamps the home-system prefab onto a temperate body for each homeworld, leaves the rest bare", () => {
    const systems = [
      mkSys({ index: 0, population: 0, buildings: {} }),
      mkSys({ index: 1, population: 0, buildings: {} }),
    ];
    const homeworldBodiesBefore = systems[0].bodies.length;

    stampHomeworldPrefabs(systems, new Set([0]), mulberry32(1));

    // Homeworld: stamped with the prefab, on a prepended guaranteed temperate body.
    expect(systems[0].buildings).toEqual(HOME_SYSTEM_PREFAB.buildings);
    expect(systems[0].population).toBe(HOME_SYSTEM_PREFAB.population);
    expect(systems[0].popCap).toBe(HOME_SYSTEM_PREFAB.population); // housing sized so popCap == residents
    expect(systems[0].bodies.length).toBe(homeworldBodiesBefore + 1);
    expect(systems[0].bodies[0].bodyType).toBe("temperate_world");
    expect(systems[0].peopleLand).toBeGreaterThan(0);
    // Recomputed label: the stamped capital's population clears the developed gate, so it lands on one of
    // the population-gated developed types (never a bare deposit-driven one).
    expect(["core", "industrial", "tech"]).toContain(systems[0].economyType);
    // Non-homeworld: an empty deposit field.
    expect(systems[1].population).toBe(0);
    expect(systems[1].buildings).toEqual({});
  });
});

describe("stampHomeworldPrefabs — ring roll", () => {
  /** A minimal procedural body of the given archetype, pre-stamp orbitIndex is irrelevant — the
   *  stamp rolls a fresh one over the whole combined set. */
  function procedural(archId: BodyArchetypeId, orbitIndex: number): GeneratedBody {
    const arch = BODY_ARCHETYPES[archId];
    return {
      bodyType: archId,
      size: 1,
      peopleLand: arch.peopleLand.min,
      counts: emptyResourceVector(),
      quality: emptyResourceVector(),
      orbitIndex,
    };
  }

  function capitalWithNeighbours(rng: ReturnType<typeof mulberry32>): GeneratedSystem[] {
    // jungle (0.34), ocean (0.46), boreal (0.58) sit within ORBIT_ROLL_SPREAD (0.25) of the garden's
    // own temperate_world bias (0.40) — bias gaps of 0.06/0.06/0.18, all under the 2×spread = 0.5
    // swap ceiling — so every one of them can land on either side of the garden across seeds.
    const systems = [
      mkSys({
        index: 0, population: 0, buildings: {},
        bodies: [
          procedural("jungle_world", 1),
          procedural("ocean_world", 2),
          procedural("boreal_world", 3),
        ],
      }),
    ];
    stampHomeworldPrefabs(systems, new Set([0]), rng);
    return systems;
  }

  it("the garden body rolls its ring like any other temperate world — not always seated innermost", () => {
    // Derived from the authored bias arithmetic (system-view.md → "Which ring a body gets"), not
    // from observed output: with every neighbour's bias gap to the garden's 0.40 under the 0.5 swap
    // ceiling, the garden landing anywhere but ring 1 — and outward of at least one procedural body
    // — must show up across a seed sample if the roll is real rather than a fixed ring-1 seat.
    let sawGardenNotInnermost = false;
    let sawGardenOutwardOfAProcedural = false;
    const seenGardenRings = new Set<number>();
    for (let seed = 0; seed < 300; seed++) {
      const systems = capitalWithNeighbours(mulberry32(seed));
      const garden = systems[0].bodies.find((b) => b.bodyType === "temperate_world")!;
      seenGardenRings.add(garden.orbitIndex);
      if (garden.orbitIndex !== 1) sawGardenNotInnermost = true;
      if (systems[0].bodies.some((b) => b.bodyType !== "temperate_world" && b.orbitIndex < garden.orbitIndex)) {
        sawGardenOutwardOfAProcedural = true;
      }
    }
    expect(sawGardenNotInnermost).toBe(true);
    expect(sawGardenOutwardOfAProcedural).toBe(true);
    expect(seenGardenRings.size).toBeGreaterThan(1); // a real spread of rings, not one fixed alternate seat
  });

  it("orbitIndex over a capital's bodies is exactly a 1..n permutation — no gap, no duplicate", () => {
    for (let seed = 0; seed < 100; seed++) {
      const systems = capitalWithNeighbours(mulberry32(seed));
      const indices = systems[0].bodies.map((b) => b.orbitIndex).sort((x, y) => x - y);
      expect(indices).toEqual(Array.from({ length: systems[0].bodies.length }, (_, i) => i + 1));
    }
  });
});

// ── Generation switch: potential/worked separation ─────

describe("generation switch — potential/worked separation", () => {
  it("a homeworld's columns fold against its stamped buildings, not against zero", () => {
    // Two extra procedural bodies with very different ore ground values, on top of the
    // garden body stampHomeworldPrefabs prepends. If the fold ran BEFORE buildings is
    // stamped (today's named bug), it would fold against {} — n=0 on every resource,
    // reading only the single best slot — regardless of the real built extractor count.
    const highOre: GeneratedBody = {
      bodyType: "temperate_world", size: 1, peopleLand: 0,
      counts: { ...emptyResourceVector(), ore: 3 },
      quality: { ...emptyResourceVector(), ore: 5 }, // groundValue 5.0 (modifier 1.0)
      orbitIndex: 1,
    };
    const lowOre: GeneratedBody = {
      bodyType: "asteroid_belt", size: 1, peopleLand: 0,
      counts: { ...emptyResourceVector(), ore: 200 },
      quality: { ...emptyResourceVector(), ore: 1 }, // groundValue 0.6 (modifier 0.6)
      orbitIndex: 2,
    };
    const systems = [mkSys({ index: 0, population: 0, buildings: {}, bodies: [highOre, lowOre] })];
    stampHomeworldPrefabs(systems, new Set([0]), mulberry32(2));
    const stamped = systems[0];

    const foldAgainstReal = workedYieldVectors(stamped.bodies, stamped.buildings);
    const foldAgainstZero = workedYieldVectors(stamped.bodies, {});

    expect(stamped.yieldMult).toEqual(foldAgainstReal.yieldMult);
    expect(stamped.extractionEfficiency).toEqual(foldAgainstReal.eff);
    // Guard: the two folds must actually diverge on ore, else this test would pass
    // vacuously even under the old (fold-against-zero) code.
    expect(foldAgainstReal.yieldMult.ore).not.toBeCloseTo(foldAgainstZero.yieldMult.ore, 6);
    expect(stamped.yieldMult.ore).not.toBeCloseTo(foldAgainstZero.yieldMult.ore, 6);
  });

  it("a bare system's columns read its best slot per resource", () => {
    const rng = mulberry32(3);
    let sawDeposits = false;
    for (let i = 0; i < 50; i++) {
      const s = generateSubstrate(rng);
      for (const r of RESOURCE_TYPES) {
        const slots = depositSlotOrder(s.bodies, r);
        if (slots.length === 0) continue;
        sawDeposits = true;
        const fold = workedYieldFold(slots, 0); // bare substrate: buildings = {} ⇒ n = 0
        expect(s.yieldMult[r]).toBeCloseTo(fold.yieldMult, 10);
        expect(s.extractionEfficiency[r]).toBeCloseTo(fold.eff, 10);
        // The best-slot rule: equals the single highest ground-value slot's own values.
        expect(s.extractionEfficiency[r]).toBeCloseTo(slots[0].modifier, 10);
      }
    }
    expect(sawDeposits).toBe(true); // non-vacuous
  });

  it("on a fixture where worked and potential vectors differ, the economy-type label matches the potential computation", () => {
    // A real bare galaxy: every system's worked vector (best-slot-first, n=0 — no extractors
    // built yet) and potential vector (mean over all unlocked bodies) generically differ
    // whenever a resource spans bodies of different ground value. Assert the wiring holds for
    // EVERY system, and guard that the fixture space actually contains at least one system
    // where the two vectors would classify differently — so wiring the label to the worked
    // vector instead would fail this test, not pass it vacuously.
    const params = defaultParams();
    const rng = mulberry32(123);
    const shape = buildGalaxyShape(params.shapeKnobs, params.mapSize, rng);
    const regions = generateRegions(shape.seeds, REGION_NAMES);
    const systems = generateSystems(rng, regions, params, shape.grid);

    let sawDivergentLabel = false;
    for (const s of systems) {
      const potentialLabel = deriveEconomyTypeLabel(s.depositCounts, s.potentialYieldMult, s.population);
      const workedLabel = deriveEconomyTypeLabel(s.depositCounts, s.yieldMult, s.population);
      if (workedLabel !== potentialLabel) sawDivergentLabel = true;
      expect(s.economyType).toBe(potentialLabel);
    }
    expect(sawDivergentLabel).toBe(true); // non-vacuous: divergence actually occurs
  });

  it("a tech-locked body contributes to neither potential nor worked", () => {
    const lockedBody: GeneratedBody = {
      bodyType: "volcanic_world", size: 1, peopleLand: 0,
      counts: { ...emptyResourceVector(), radioactive: 50 },
      quality: { ...emptyResourceVector(), radioactive: 1 },
      orbitIndex: 1,
    };
    const withLocked = [mkSys({ index: 0, population: 0, buildings: {}, bodies: [lockedBody] })];
    const withoutLocked = [mkSys({ index: 0, population: 0, buildings: {}, bodies: [] })];
    stampHomeworldPrefabs(withLocked, new Set([0]), mulberry32(4));
    stampHomeworldPrefabs(withoutLocked, new Set([0]), mulberry32(5));

    expect(withLocked[0].depositCounts).toEqual(withoutLocked[0].depositCounts);
    expect(withLocked[0].potentialYieldMult).toEqual(withoutLocked[0].potentialYieldMult);
    expect(withLocked[0].potentialExtractionEfficiency).toEqual(withoutLocked[0].potentialExtractionEfficiency);
    expect(withLocked[0].yieldMult).toEqual(withoutLocked[0].yieldMult);
    expect(withLocked[0].extractionEfficiency).toEqual(withoutLocked[0].extractionEfficiency);
    // The locked body is still physically present — dark ground, not deleted.
    expect(withLocked[0].bodies.some((b) => b.bodyType === "volcanic_world")).toBe(true);
  });
});

// ── Full generation determinism ─────────────────────────────────

describe("generateUniverse", () => {
  it("produces identical output for the same seed", () => {
    const params = defaultParams();
    const u1 = generateUniverse(params, REGION_NAMES);
    const u2 = generateUniverse(params, REGION_NAMES);

    expect(u1.regions).toEqual(u2.regions);
    expect(u1.systems).toEqual(u2.systems);
    expect(u1.connections).toEqual(u2.connections);
    expect(u1.factions).toEqual(u2.factions);
    expect(u1.systemFactionAssignments).toEqual(u2.systemFactionAssignments);
  });

  it("returns a valid playerFactionIndex pointing at the authored faction when one is supplied", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES, {
      name: "Aurelian League",
      governmentType: "technocratic",
      doctrine: "mercantile",
    });
    expect(u.playerFactionIndex).not.toBeNull();
    const idx = u.playerFactionIndex;
    if (idx === null) throw new Error("expected a player faction index");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(u.factions.length);
    const player = u.factions[idx];
    expect(player.key).toBe("player");
    expect(player.name).toBe("Aurelian League");
    expect(player.isMajor).toBe(true);
  });

  it("is null for a playerless universe and deterministic with an authored player", () => {
    const params = defaultParams();
    expect(generateUniverse(params, REGION_NAMES).playerFactionIndex).toBeNull();
    const a = generateUniverse(params, REGION_NAMES, {
      name: "Seat",
      governmentType: "cooperative",
      doctrine: "protectionist",
    });
    const b = generateUniverse(params, REGION_NAMES, {
      name: "Seat",
      governmentType: "cooperative",
      doctrine: "protectionist",
    });
    expect(a.playerFactionIndex).toBe(b.playerFactionIndex);
    expect(a.factions).toEqual(b.factions);
  });

  it("produces different output for different seeds", () => {
    const p1 = { ...defaultParams(), seed: 42 };
    const p2 = { ...defaultParams(), seed: 99 };
    const u1 = generateUniverse(p1, REGION_NAMES);
    const u2 = generateUniverse(p2, REGION_NAMES);

    expect(u1.systems).not.toEqual(u2.systems);
  });

  it("generates the expected counts", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);

    expect(u.regions).toHaveLength(params.shapeKnobs.clusterCount);
    // Density-shaped placement deliberately leaves void (and a cluster's own low-density rim)
    // unfilled (spec §5) — the old near-uniform floor no longer holds, and the shipped default
    // knobs are Gate-A-tunable proposals, not a target this task calibrates.
    expect(u.systems.length).toBeGreaterThanOrEqual(params.totalSystems * 0.2);
    expect(u.systems.length).toBeLessThanOrEqual(params.totalSystems);
    // At minimum MST edges (bidirectional) per region
    expect(u.connections.length).toBeGreaterThan(500);
  });

  it("same {systemCount, seed} produces a byte-identical world (determinism contract)", () => {
    const config = genConfigForSystemCount(300);
    const params = buildGenParams(7, config);
    const u1 = generateUniverse(params, REGION_NAMES);
    const u2 = generateUniverse(params, REGION_NAMES);
    expect(JSON.stringify(u1)).toBe(JSON.stringify(u2));
  });
});

// ── Faction generation + system ownership ───────────────────────

describe("faction generation", () => {
  it("seeds 8 majors plus the configured minor count", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);
    const majors = u.factions.filter((f) => f.isMajor);
    const minors = u.factions.filter((f) => !f.isMajor);
    expect(majors).toHaveLength(8);
    expect(minors).toHaveLength(params.minorFactionCount);
  });

  it("majors cover all 8 government types exactly once", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);
    const majorGovs = u.factions.filter((f) => f.isMajor).map((f) => f.governmentType);
    expect(new Set(majorGovs).size).toBe(8);
  });

  it("every faction has a distinct homeworld system", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);
    const homeworlds = u.factions.map((f) => f.homeworldSystemIndex);
    expect(new Set(homeworlds).size).toBe(homeworlds.length);
  });

  it("every faction has a unique name", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);
    const names = u.factions.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("owns only faction homeworlds; every other system is unclaimed (-1)", () => {
    const u = generateUniverse(defaultParams(), REGION_NAMES);
    const homeworlds = new Set(u.factions.map((f) => f.homeworldSystemIndex));
    for (let i = 0; i < u.systems.length; i++) {
      if (homeworlds.has(i)) expect(u.systemFactionAssignments[i]).toBeGreaterThanOrEqual(0);
      else expect(u.systemFactionAssignments[i]).toBe(-1);
    }
    const owned = u.systemFactionAssignments.filter((a) => a >= 0).length;
    expect(owned).toBe(u.factions.length); // exactly one owned system per faction
  });

  it("leaves every non-homeworld system unpopulated & unbuilt", () => {
    const u = generateUniverse(defaultParams(), REGION_NAMES);
    const homeworlds = new Set(u.factions.map((f) => f.homeworldSystemIndex));
    for (const s of u.systems) {
      if (homeworlds.has(s.index)) continue;
      expect(s.population).toBe(0);
      expect(Object.keys(s.buildings)).toHaveLength(0);
    }
  });

  it("stamps every homeworld with the self-sufficient prefab on a clustered map (stampHomeworldPrefabs exercised, not modified)", () => {
    const u = generateUniverse(defaultParams(), REGION_NAMES);
    const homeworlds = new Set(u.factions.map((f) => f.homeworldSystemIndex));
    expect(homeworlds.size).toBeGreaterThan(0); // non-vacuous
    for (const s of u.systems) {
      if (!homeworlds.has(s.index)) continue;
      expect(s.population).toBe(HOME_SYSTEM_PREFAB.population);
      expect(Object.keys(s.buildings).length).toBeGreaterThan(0);
    }
  });
});
