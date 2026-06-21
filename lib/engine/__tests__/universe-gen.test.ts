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
  generateUniverse,
  type GenParams,
  type GeneratedRegion,
} from "../universe-gen";
import {
  UNIVERSE_GEN,
  REGION_NAMES,
} from "@/lib/constants/universe-gen";
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { ALL_TRAIT_IDS } from "@/lib/constants/traits";

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
    minorFactionCount: UNIVERSE_GEN.MINOR_FACTION_COUNT,
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

  it("rolls 0–2 features per system, all narrative survivors", () => {
    const { systems } = makeRegionsAndSystems();
    for (const sys of systems) {
      expect(sys.traits.length).toBeGreaterThanOrEqual(0);
      expect(sys.traits.length).toBeLessThanOrEqual(2);
      for (const t of sys.traits) expect(ALL_TRAIT_IDS).toContain(t.traitId);
    }
  });

  it("derives the substrate-driven economy types, none dominating", () => {
    const { systems } = makeRegionsAndSystems();
    const econCounts = new Map<string, number>();
    for (const sys of systems) {
      econCounts.set(sys.economyType, (econCounts.get(sys.economyType) ?? 0) + 1);
    }
    // The four substrate-driven base types are always present; the population-gated
    // 'industrial'/'tech' types are sparse-to-absent until P4 calibration lifts the
    // population magnitude (full-fold population currently peaks ~1065, below the
    // ECON_POP_HIGH=1000 / 0.6 gate for most systems). Assert the reliable floor.
    for (const econ of ["agricultural", "extraction", "refinery", "core"]) {
      expect(econCounts.get(econ) ?? 0, econ).toBeGreaterThan(0);
    }
    for (const [, count] of econCounts) {
      // ≤ 0.80: a realistic galaxy is mostly mining worlds, so 'extraction' is a
      // strong, DESIGNED plurality (~65-72%) — the classifier reads slotCap ×
      // yieldMult (raw deposit potential) and most systems are barren. This guard
      // only catches one type reaching near-total takeover, not the intended
      // extraction-dominance.
      expect(count / systems.length).toBeLessThanOrEqual(0.80);
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
  it("places the player in Federation-major territory", () => {
    const params = defaultParams();
    const universe = generateUniverse(params, REGION_NAMES);
    const startFactionIdx = universe.systemFactionAssignments[universe.startingSystemIndex];
    const startFaction = universe.factions[startFactionIdx];
    expect(startFaction.isMajor).toBe(true);
    expect(startFaction.governmentType).toBe("federation");
  });

  it("prefers a core-type system within Federation territory when available", () => {
    const params = defaultParams();
    const universe = generateUniverse(params, REGION_NAMES);
    const startSys = universe.systems[universe.startingSystemIndex];

    // Find the federation major; if it owns any core systems, the start must be core.
    const fedFaction = universe.factions.find(
      (f) => f.isMajor && f.governmentType === "federation",
    )!;
    const fedOwnedSystems = universe.systems.filter(
      (s) => universe.systemFactionAssignments[s.index] === fedFaction.index,
    );
    const fedCoreSystems = fedOwnedSystems.filter((s) => s.economyType === "core");
    if (fedCoreSystems.length > 0) {
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
    expect(u1.factions).toEqual(u2.factions);
    expect(u1.systemFactionAssignments).toEqual(u2.systemFactionAssignments);
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

  it("every system is assigned to some faction", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);
    expect(u.systemFactionAssignments).toHaveLength(u.systems.length);
    for (const idx of u.systemFactionAssignments) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(u.factions.length);
    }
  });

  it("every minor faction holds at least 5 systems (minimum floor)", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);
    const sizeByFaction = new Map<number, number>();
    for (const f of u.systemFactionAssignments) {
      sizeByFaction.set(f, (sizeByFaction.get(f) ?? 0) + 1);
    }
    for (const f of u.factions) {
      if (f.isMajor) continue;
      const size = sizeByFaction.get(f.index) ?? 0;
      expect(size).toBeGreaterThanOrEqual(5);
    }
  });

  it("minor archetypes total to the configured count", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);
    const minors = u.factions.filter((f) => !f.isMajor);
    expect(minors.length).toBe(params.minorFactionCount);
    for (const m of minors) {
      expect(m.archetype).not.toBeNull();
    }
  });

  it("frontier minors are placed near the map edge", () => {
    const params = defaultParams();
    const u = generateUniverse(params, REGION_NAMES);
    const center = params.mapSize / 2;
    const frontierMinors = u.factions.filter(
      (f) => !f.isMajor && f.archetype === "frontier",
    );
    // Each frontier minor's homeworld lies in the outer 40% of map radius —
    // the placement algorithm samples from the top-20% distance-from-center pool.
    for (const fm of frontierMinors) {
      const hw = u.systems[fm.homeworldSystemIndex];
      const d = distance(hw.x, hw.y, center, center);
      expect(d).toBeGreaterThan(center * 0.4);
    }
  });
});
