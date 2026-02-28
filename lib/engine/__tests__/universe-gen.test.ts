import { describe, it, expect } from "vitest";
import {
  mulberry32,
  distance,
  randInt,
  weightedPick,
  UnionFind,
  bridsonSample,
  assignRegions,
  generateRegions,
  generateSystems,
  generateConnections,
  selectStartingSystem,
  generateUniverse,
  type GenParams,
  type GeneratedRegion,
} from "../universe-gen";
import {
  UNIVERSE_GEN,
  REGION_NAMES,
} from "@/lib/constants/universe-gen";
import type { GovernmentType } from "@/lib/types/game";

// ── Helpers ─────────────────────────────────────────────────────

function defaultParams(): GenParams {
  return {
    seed: UNIVERSE_GEN.SEED,
    regionCount: UNIVERSE_GEN.REGION_COUNT,
    totalSystems: UNIVERSE_GEN.TOTAL_SYSTEMS,
    mapSize: UNIVERSE_GEN.MAP_SIZE,
    mapPadding: UNIVERSE_GEN.MAP_PADDING,
    poissonMinDistance: UNIVERSE_GEN.POISSON_MIN_DISTANCE,
    poissonKCandidates: UNIVERSE_GEN.POISSON_K_CANDIDATES,
    regionMinDistance: UNIVERSE_GEN.REGION_MIN_DISTANCE,
    extraEdgeFraction: UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES,
    gatewayFuelMultiplier: UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER,
    gatewaysPerBorder: UNIVERSE_GEN.GATEWAYS_PER_BORDER,
    intraRegionBaseFuel: UNIVERSE_GEN.INTRA_REGION_BASE_FUEL,
    maxPlacementAttempts: UNIVERSE_GEN.MAX_PLACEMENT_ATTEMPTS,
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

describe("weightedPick", () => {
  it("respects weight distribution", () => {
    const rng = mulberry32(42);
    const weights: Record<string, number> = { a: 90, b: 10 };
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[weightedPick(rng, weights)]++;
    }
    // With 90/10 weights over 1000 trials, "a" should dominate
    expect(counts.a).toBeGreaterThan(700);
    expect(counts.b).toBeGreaterThan(0);
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
  it("generates well-spaced points with guaranteed minimum distance", () => {
    const rng = mulberry32(42);
    const minDist = 250;
    const points = bridsonSample(rng, 7000, 7000, minDist, 30, 700, 600);

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
    const points = bridsonSample(rng, 7000, 7000, 250, 30, 700, 100);
    expect(points.length).toBeLessThanOrEqual(100);
    expect(points.length).toBeGreaterThan(0);
  });

  it("places all points within padded bounds", () => {
    const rng = mulberry32(42);
    const padding = 700;
    const size = 7000;
    const points = bridsonSample(rng, size, size, 250, 30, padding, 600);

    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(padding);
      expect(p.x).toBeLessThan(size - padding);
      expect(p.y).toBeGreaterThanOrEqual(padding);
      expect(p.y).toBeLessThan(size - padding);
    }
  });

  it("is deterministic with the same RNG seed", () => {
    const p1 = bridsonSample(mulberry32(42), 7000, 7000, 250, 30, 700, 600);
    const p2 = bridsonSample(mulberry32(42), 7000, 7000, 250, 30, 700, 600);
    expect(p1).toEqual(p2);
  });
});

// ── Region generation ───────────────────────────────────────────

describe("generateRegions", () => {
  it("generates the correct number of regions", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_NAMES);
    expect(regions).toHaveLength(params.regionCount);
  });

  it("places regions within map bounds", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_NAMES);
    for (const r of regions) {
      expect(r.x).toBeGreaterThan(0);
      expect(r.x).toBeLessThan(params.mapSize);
      expect(r.y).toBeGreaterThan(0);
      expect(r.y).toBeLessThan(params.mapSize);
    }
  });

  it("assigns unique names to all regions", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_NAMES);
    const names = regions.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("assigns a valid government type to every region", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_NAMES);
    const validGovTypes: GovernmentType[] = ["federation", "corporate", "authoritarian", "frontier"];
    for (const r of regions) {
      expect(validGovTypes).toContain(r.governmentType);
    }
  });

  it("ensures all 4 government types are present", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_NAMES);
    const govTypes = new Set(regions.map((r) => r.governmentType));
    expect(govTypes.size).toBe(4);
  });
});

// ── System generation ───────────────────────────────────────────

describe("generateSystems", () => {
  const params = defaultParams();

  function makeRegionsAndSystems() {
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_NAMES);
    const systems = generateSystems(rng, regions, params);
    return { regions, systems };
  }

  it("generates approximately the target number of systems", () => {
    const { systems } = makeRegionsAndSystems();
    // Poisson sampling may produce slightly fewer than target if space fills up
    expect(systems.length).toBeGreaterThanOrEqual(params.totalSystems * 0.9);
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

  it("derives economy types from traits with no region theme bias", () => {
    const { systems } = makeRegionsAndSystems();
    // With uniform trait weights, all 6 economy types should appear
    const econCounts = new Map<string, number>();
    for (const sys of systems) {
      econCounts.set(sys.economyType, (econCounts.get(sys.economyType) ?? 0) + 1);
    }
    expect(econCounts.size).toBe(6);
    // No single type should dominate (>40% of all systems)
    for (const [, count] of econCounts) {
      expect(count / systems.length).toBeLessThan(0.4);
    }
  });

  it("every system has at least 2 traits", () => {
    const { systems } = makeRegionsAndSystems();
    for (const sys of systems) {
      expect(sys.traits.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("assigns unique global indices", () => {
    const { systems } = makeRegionsAndSystems();
    const indices = systems.map((s) => s.index);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("no large gaps — every map point is near some system", () => {
    const { systems } = makeRegionsAndSystems();
    // Sample random points and ensure they're within 2x Poisson distance of a system
    const rng = mulberry32(999);
    const padding = params.mapSize * params.mapPadding;
    const maxGap = params.poissonMinDistance * 3;
    for (let i = 0; i < 200; i++) {
      const tx = padding + rng() * (params.mapSize - 2 * padding);
      const ty = padding + rng() * (params.mapSize - 2 * padding);
      let minDist = Infinity;
      for (const s of systems) {
        const d = distance(tx, ty, s.x, s.y);
        if (d < minDist) minDist = d;
      }
      expect(minDist).toBeLessThan(maxGap);
    }
  });
});

// ── Region assignment ───────────────────────────────────────────

describe("assignRegions", () => {
  it("assigns each point to the nearest region center", () => {
    const regions: GeneratedRegion[] = [
      { index: 0, name: "A", governmentType: "federation", x: 100, y: 100 },
      { index: 1, name: "B", governmentType: "corporate", x: 900, y: 900 },
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
    const regions = generateRegions(rng, params, REGION_NAMES);
    const rawSystems = generateSystems(rng, regions, params);
    const result = generateConnections(rng, rawSystems, regions, params);
    return { regions, ...result };
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

  it("all regions are connected via gateways (BFS on region graph)", () => {
    const { regions, systems, connections } = makeFullUniverse();

    // Build region adjacency from gateway connections
    const regionAdj = new Map<number, number[]>();
    for (const r of regions) regionAdj.set(r.index, []);

    for (const conn of connections) {
      if (!conn.isGateway) continue;
      const fromRegion = systems.find((s) => s.index === conn.fromSystemIndex)!.regionIndex;
      const toRegion = systems.find((s) => s.index === conn.toSystemIndex)!.regionIndex;
      if (fromRegion !== toRegion) {
        regionAdj.get(fromRegion)!.push(toRegion);
      }
    }

    const reachable = bfsReachable(regionAdj, regions[0].index);
    expect(reachable.size).toBe(regions.length);
  });

  it("connections are bidirectional", () => {
    const { connections } = makeFullUniverse();
    const edgeSet = new Set(connections.map((c) => `${c.fromSystemIndex}-${c.toSystemIndex}`));
    for (const conn of connections) {
      expect(edgeSet.has(`${conn.toSystemIndex}-${conn.fromSystemIndex}`)).toBe(true);
    }
  });

  it("non-gateway connections only link systems in the same region", () => {
    const { systems, connections } = makeFullUniverse();
    for (const conn of connections) {
      if (conn.isGateway) continue;
      const fromRegion = systems.find((s) => s.index === conn.fromSystemIndex)!.regionIndex;
      const toRegion = systems.find((s) => s.index === conn.toSystemIndex)!.regionIndex;
      expect(fromRegion).toBe(toRegion);
    }
  });

  it("marks at least 1 gateway per region", () => {
    const { regions, systems } = makeFullUniverse();
    for (const region of regions) {
      const gateways = systems.filter(
        (s) => s.regionIndex === region.index && s.isGateway,
      );
      expect(gateways.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("fuel costs are positive and reasonable", () => {
    const { connections } = makeFullUniverse();
    for (const conn of connections) {
      expect(conn.fuelCost).toBeGreaterThanOrEqual(1);
      expect(conn.fuelCost).toBeLessThan(200);
    }
  });
});

// ── Starting system ─────────────────────────────────────────────

describe("selectStartingSystem", () => {
  it("selects a system in the region closest to map center", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_NAMES);
    const systems = generateSystems(rng, regions, params);

    const idx = selectStartingSystem(systems, regions, params.mapSize);
    const startSys = systems[idx];
    const startRegion = regions.find((r) => r.index === startSys.regionIndex)!;

    // Find the actual closest region to center
    const center = params.mapSize / 2;
    let closestRegion = regions[0];
    let closestDist = distance(closestRegion.x, closestRegion.y, center, center);
    for (const r of regions) {
      const d = distance(r.x, r.y, center, center);
      if (d < closestDist) {
        closestRegion = r;
        closestDist = d;
      }
    }

    expect(startRegion.index).toBe(closestRegion.index);
  });

  it("prefers a core-type system when available", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_NAMES);
    const systems = generateSystems(rng, regions, params);

    const idx = selectStartingSystem(systems, regions, params.mapSize);
    const startSys = systems[idx];
    const startRegion = regions.find((r) => r.index === startSys.regionIndex)!;

    // Check if there are any core systems in this region — if so, the selected should be core
    const coreSystems = systems.filter(
      (s) => s.regionIndex === startRegion.index && s.economyType === "core",
    );
    if (coreSystems.length > 0) {
      expect(startSys.economyType).toBe("core");
    }
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
    expect(u1.startingSystemIndex).toBe(u2.startingSystemIndex);
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

    expect(u.regions).toHaveLength(params.regionCount);
    // Poisson sampling may generate slightly fewer than target
    expect(u.systems.length).toBeGreaterThanOrEqual(params.totalSystems * 0.9);
    expect(u.systems.length).toBeLessThanOrEqual(params.totalSystems);
    // At minimum MST edges (bidirectional) per region
    expect(u.connections.length).toBeGreaterThan(500);
    expect(u.startingSystemIndex).toBeGreaterThanOrEqual(0);
    expect(u.startingSystemIndex).toBeLessThan(u.systems.length);
  });

  it("no region has fewer than 5 systems", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);
    const regionCounts = new Map<number, number>();
    for (const s of u.systems) {
      regionCounts.set(s.regionIndex, (regionCounts.get(s.regionIndex) ?? 0) + 1);
    }
    for (const [, count] of regionCounts) {
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });
});
