import { describe, it, expect } from "vitest";
import {
  mulberry32,
  distance,
  randInt,
  weightedPick,
  UnionFind,
  generateRegions,
  generateSystems,
  generateConnections,
  selectStartingSystem,
  generateUniverse,
  type GenParams,
  type RNG,
} from "../universe-gen";
import {
  UNIVERSE_GEN,
  REGION_THEMES,
  REGION_NAME_PREFIXES,
  GOVERNMENT_TYPE_WEIGHTS,
} from "@/lib/constants/universe-gen";
import type { GovernmentType, RegionTheme } from "@/lib/types/game";

// ── Helpers ─────────────────────────────────────────────────────

function defaultParams(): GenParams {
  return {
    seed: UNIVERSE_GEN.SEED,
    regionCount: UNIVERSE_GEN.REGION_COUNT,
    systemsPerRegion: UNIVERSE_GEN.SYSTEMS_PER_REGION,
    mapSize: UNIVERSE_GEN.MAP_SIZE,
    regionMinDistance: UNIVERSE_GEN.REGION_MIN_DISTANCE,
    systemScatterRadius: UNIVERSE_GEN.SYSTEM_SCATTER_RADIUS,
    systemMinDistance: UNIVERSE_GEN.SYSTEM_MIN_DISTANCE,
    extraEdgeFraction: UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES,
    gatewayFuelMultiplier: UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER,
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
    const weights = { a: 90, b: 10 } as Record<string, number>;
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

// ── Region generation ───────────────────────────────────────────

describe("generateRegions", () => {
  it("generates the correct number of regions", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES);
    expect(regions).toHaveLength(params.regionCount);
  });

  it("places regions within map bounds", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES);
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
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES);
    const names = regions.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("assigns identities from the provided array", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES);
    for (let i = 0; i < regions.length; i++) {
      expect(regions[i].identity).toBe(REGION_THEMES[i % REGION_THEMES.length]);
    }
  });

  it("assigns a valid government type when weights are provided", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES, GOVERNMENT_TYPE_WEIGHTS);
    const validGovTypes: GovernmentType[] = ["federation", "corporate", "authoritarian", "frontier"];
    for (const r of regions) {
      expect(validGovTypes).toContain(r.governmentType);
    }
  });

  it("defaults government type to federation when no weights provided", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES);
    for (const r of regions) {
      expect(r.governmentType).toBe("federation");
    }
  });
});

// ── System generation ───────────────────────────────────────────

describe("generateSystems", () => {
  const params = defaultParams();

  function makeRegionsAndSystems() {
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES);
    const systems = generateSystems(rng, regions, params);
    return { regions, systems };
  }

  it("generates the expected total number of systems", () => {
    const { systems } = makeRegionsAndSystems();
    expect(systems).toHaveLength(params.regionCount * params.systemsPerRegion);
  });

  it("scatters systems within scatter radius of their region center", () => {
    const { regions, systems } = makeRegionsAndSystems();
    // Allow some tolerance for force-placed systems
    const tolerance = params.systemScatterRadius * 1.2;
    for (const sys of systems) {
      const region = regions.find((r) => r.index === sys.regionIndex)!;
      const d = distance(sys.x, sys.y, region.x, region.y);
      expect(d).toBeLessThan(tolerance);
    }
  });

  it("derives economy types from traits, biased by region theme", () => {
    const { regions, systems } = makeRegionsAndSystems();
    // mineral_frontier theme should produce mostly extraction economies
    const mineralRegion = regions.find((r) => r.identity === "mineral_frontier")!;
    const mineralSystems = systems.filter((s) => s.regionIndex === mineralRegion.index);
    const extractionCount = mineralSystems.filter((s) => s.economyType === "extraction").length;
    // Trait-based derivation with extraction-heavy trait weights should produce at least a few
    expect(extractionCount).toBeGreaterThanOrEqual(3);
  });

  it("every system has at least 1 trait", () => {
    const { systems } = makeRegionsAndSystems();
    for (const sys of systems) {
      expect(sys.traits.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("assigns unique global indices", () => {
    const { systems } = makeRegionsAndSystems();
    const indices = systems.map((s) => s.index);
    expect(new Set(indices).size).toBe(indices.length);
  });
});

// ── Connection generation ───────────────────────────────────────

describe("generateConnections", () => {
  const params = defaultParams();

  function makeFullUniverse() {
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES);
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

  it("gateway connections apply the fuel multiplier to distance-based cost", () => {
    const { systems, connections } = makeFullUniverse();
    const gateways = connections.filter((c) => c.isGateway);

    for (const conn of gateways) {
      const from = systems.find((s) => s.index === conn.fromSystemIndex)!;
      const to = systems.find((s) => s.index === conn.toSystemIndex)!;
      const dist = distance(from.x, from.y, to.x, to.y);

      // Expected: round((dist / scatterRadius) * baseFuel * multiplier, 1), min 1
      const expected = Math.max(
        1,
        Math.round(
          (dist / params.systemScatterRadius) * params.intraRegionBaseFuel * params.gatewayFuelMultiplier * 10,
        ) / 10,
      );
      expect(conn.fuelCost).toBe(expected);
    }
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
      // Central regions in MST may have more gateways; most have 1-3
    }
  });
});

// ── Starting system ─────────────────────────────────────────────

describe("selectStartingSystem", () => {
  it("selects a system in a trade_nexus region", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES);
    const systems = generateSystems(rng, regions, params);

    const idx = selectStartingSystem(systems, regions);
    const startSys = systems[idx];
    const region = regions.find((r) => r.index === startSys.regionIndex)!;
    expect(region.identity).toBe("trade_nexus");
  });

  it("prefers a core-type system when available", () => {
    const params = defaultParams();
    const rng = mulberry32(params.seed);
    const regions = generateRegions(rng, params, REGION_THEMES, REGION_NAME_PREFIXES);
    const systems = generateSystems(rng, regions, params);

    const idx = selectStartingSystem(systems, regions);
    const startSys = systems[idx];
    const region = regions.find((r) => r.index === startSys.regionIndex)!;

    // Check if there are any core systems in this region — if so, the selected should be core
    const coreSystems = systems.filter(
      (s) => s.regionIndex === region.index && s.economyType === "core",
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
    const u1 = generateUniverse(params, REGION_THEMES, REGION_NAME_PREFIXES);
    const u2 = generateUniverse(params, REGION_THEMES, REGION_NAME_PREFIXES);

    expect(u1.regions).toEqual(u2.regions);
    expect(u1.systems).toEqual(u2.systems);
    expect(u1.connections).toEqual(u2.connections);
    expect(u1.startingSystemIndex).toBe(u2.startingSystemIndex);
  });

  it("produces different output for different seeds", () => {
    const p1 = { ...defaultParams(), seed: 42 };
    const p2 = { ...defaultParams(), seed: 99 };
    const u1 = generateUniverse(p1, REGION_THEMES, REGION_NAME_PREFIXES);
    const u2 = generateUniverse(p2, REGION_THEMES, REGION_NAME_PREFIXES);

    expect(u1.systems).not.toEqual(u2.systems);
  });

  it("generates the expected counts", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_THEMES, REGION_NAME_PREFIXES);

    expect(u.regions).toHaveLength(params.regionCount);
    expect(u.systems).toHaveLength(params.regionCount * params.systemsPerRegion);
    // At minimum MST edges (bidirectional) per region: (25-1)*2*8 = 384
    expect(u.connections.length).toBeGreaterThan(300);
    expect(u.startingSystemIndex).toBeGreaterThanOrEqual(0);
    expect(u.startingSystemIndex).toBeLessThan(u.systems.length);
  });
});
