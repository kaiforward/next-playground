/**
 * Procedural universe generation — pure functions, zero DB dependency.
 * Deterministic given a seed value via mulberry32 PRNG.
 */

import type { EconomyType, GovernmentType } from "@/lib/types/game";
import { ALL_GOVERNMENT_TYPES } from "@/lib/types/guards";
import type { GeneratedTrait } from "./trait-gen";
import { generateSystemTraits, deriveEconomyType } from "./trait-gen";

// ── Output types ────────────────────────────────────────────────

export interface GeneratedRegion {
  index: number;
  name: string;
  governmentType: GovernmentType;
  x: number;
  y: number;
}

export interface GeneratedSystem {
  index: number;
  name: string;
  economyType: EconomyType;
  traits: GeneratedTrait[];
  x: number;
  y: number;
  regionIndex: number;
  isGateway: boolean;
  description: string;
}

export interface GeneratedConnection {
  fromSystemIndex: number;
  toSystemIndex: number;
  fuelCost: number;
  isGateway: boolean;
}

export interface GeneratedUniverse {
  regions: GeneratedRegion[];
  systems: GeneratedSystem[];
  connections: GeneratedConnection[];
  startingSystemIndex: number;
}

// ── Generation parameters ───────────────────────────────────────

export interface GenParams {
  seed: number;
  regionCount: number;
  systemsPerRegion: number;
  mapSize: number;
  regionMinDistance: number;
  systemScatterRadius: number;
  systemMinDistance: number;
  extraEdgeFraction: number;
  gatewayFuelMultiplier: number;
  intraRegionBaseFuel: number;
  maxPlacementAttempts: number;
}

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

// ── Utility functions ───────────────────────────────────────────

export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function randInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function weightedPick<T extends string>(
  rng: RNG,
  weights: Record<T, number>,
): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
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

// ── Region generation ───────────────────────────────────────────

export function generateRegions(
  rng: RNG,
  params: GenParams,
  names: string[],
): GeneratedRegion[] {
  const { regionCount, mapSize, regionMinDistance, maxPlacementAttempts } = params;
  const padding = mapSize * 0.15;
  const regions: GeneratedRegion[] = [];

  // Track used names to avoid duplicates
  const usedNames = new Set<string>();

  for (let i = 0; i < regionCount; i++) {
    let placed = false;

    // Rejection sampling: try random positions until one fits
    for (let attempt = 0; attempt < maxPlacementAttempts; attempt++) {
      const x = padding + rng() * (mapSize - 2 * padding);
      const y = padding + rng() * (mapSize - 2 * padding);

      const tooClose = regions.some(
        (r) => distance(x, y, r.x, r.y) < regionMinDistance,
      );
      if (tooClose) continue;

      // Pick a name sequentially from the flat pool
      let name = names[i % names.length];
      if (usedNames.has(name)) {
        name = `${name}-${i + 1}`;
      }
      usedNames.add(name);

      // Uniform government: 25% each
      const governmentType = weightedPick(rng, {
        federation: 1,
        corporate: 1,
        authoritarian: 1,
        frontier: 1,
      } as Record<GovernmentType, number>) as GovernmentType;
      regions.push({ index: i, name, governmentType, x, y });
      placed = true;
      break;
    }

    // Fallback: grid-jitter placement if rejection sampling failed
    if (!placed) {
      const cols = Math.ceil(Math.sqrt(regionCount));
      const cellSize = (mapSize - 2 * padding) / cols;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = padding + col * cellSize + cellSize / 2 + (rng() - 0.5) * cellSize * 0.3;
      const y = padding + row * cellSize + cellSize / 2 + (rng() - 0.5) * cellSize * 0.3;

      let name = names[i % names.length];
      if (usedNames.has(name)) {
        name = `${name}-${i + 1}`;
      }
      usedNames.add(name);

      const governmentType = weightedPick(rng, {
        federation: 1,
        corporate: 1,
        authoritarian: 1,
        frontier: 1,
      } as Record<GovernmentType, number>) as GovernmentType;
      regions.push({ index: i, name, governmentType, x, y });
    }
  }

  // Government coverage guarantee: ensure every government type appears at least once
  const allGovTypes = ALL_GOVERNMENT_TYPES;
  const present = new Set(regions.map((r) => r.governmentType));
  const missing = allGovTypes.filter((g) => !present.has(g));

  for (const missingGov of missing) {
    // Count how many regions have each government type
    const govCounts = new Map<string, number>();
    for (const r of regions) {
      govCounts.set(r.governmentType, (govCounts.get(r.governmentType) ?? 0) + 1);
    }

    // Only consider regions whose government type is duplicated (count > 1)
    const candidates = regions.filter(
      (r) => (govCounts.get(r.governmentType) ?? 0) > 1,
    );

    if (candidates.length === 0) continue; // safety: can't swap without duplicates

    // Pick a random candidate to swap
    const swapIdx = Math.floor(rng() * candidates.length);
    candidates[swapIdx].governmentType = missingGov;
  }

  return regions;
}

// ── System generation ───────────────────────────────────────────

export function generateSystems(
  rng: RNG,
  regions: GeneratedRegion[],
  params: GenParams,
): GeneratedSystem[] {
  const { systemsPerRegion, systemScatterRadius, systemMinDistance, maxPlacementAttempts } = params;
  const systems: GeneratedSystem[] = [];
  let globalIndex = 0;

  for (const region of regions) {
    const regionSystems: GeneratedSystem[] = [];
    let localIndex = 0;

    for (let s = 0; s < systemsPerRegion; s++) {
      const traits = generateSystemTraits(rng);
      const economyType = deriveEconomyType(traits, rng);

      let placed = false;
      for (let attempt = 0; attempt < maxPlacementAttempts; attempt++) {
        // Random point within scatter radius (uniform in circle via rejection)
        const dx = (rng() * 2 - 1) * systemScatterRadius;
        const dy = (rng() * 2 - 1) * systemScatterRadius;
        if (dx * dx + dy * dy > systemScatterRadius * systemScatterRadius) continue;

        const x = region.x + dx;
        const y = region.y + dy;

        const tooClose = regionSystems.some(
          (sys) => distance(x, y, sys.x, sys.y) < systemMinDistance,
        );
        if (tooClose) continue;

        regionSystems.push({
          index: globalIndex,
          name: `${region.name}-${localIndex + 1}`,
          economyType,
          traits,
          x,
          y,
          regionIndex: region.index,
          isGateway: false,
          description: "",
        });
        localIndex++;
        globalIndex++;
        placed = true;
        break;
      }

      // If we couldn't place, just skip (rare with proper params)
      if (!placed) {
        // Force-place with jitter to not lose systems
        const angle = (s / systemsPerRegion) * Math.PI * 2;
        const r = systemScatterRadius * 0.5 + rng() * systemScatterRadius * 0.4;
        regionSystems.push({
          index: globalIndex,
          name: `${region.name}-${localIndex + 1}`,
          economyType,
          traits,
          x: region.x + Math.cos(angle) * r,
          y: region.y + Math.sin(angle) * r,
          regionIndex: region.index,
          isGateway: false,
          description: "",
        });
        localIndex++;
        globalIndex++;
      }
    }

    systems.push(...regionSystems);
  }

  return systems;
}

// ── Connection generation ───────────────────────────────────────

interface Edge {
  a: number; // local index within a set
  b: number;
  dist: number;
}

/**
 * Build MST edges using Kruskal's algorithm within a set of systems.
 * Returns local-index edges (indices into the provided array).
 */
function kruskalMST(systemsInSet: { x: number; y: number }[]): Edge[] {
  const n = systemsInSet.length;
  if (n < 2) return [];

  // Build all possible edges sorted by distance
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({
        a: i,
        b: j,
        dist: distance(systemsInSet[i].x, systemsInSet[i].y, systemsInSet[j].x, systemsInSet[j].y),
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

export function generateConnections(
  rng: RNG,
  systems: GeneratedSystem[],
  regions: GeneratedRegion[],
  params: GenParams,
): { connections: GeneratedConnection[]; systems: GeneratedSystem[] } {
  const { extraEdgeFraction, gatewayFuelMultiplier, intraRegionBaseFuel } = params;
  const connections: GeneratedConnection[] = [];

  // Group systems by region
  const regionSystems: Map<number, GeneratedSystem[]> = new Map();
  for (const region of regions) {
    regionSystems.set(region.index, []);
  }
  for (const sys of systems) {
    regionSystems.get(sys.regionIndex)!.push(sys);
  }

  // ── Phase 1: Intra-region connections ──
  for (const [, regionSys] of regionSystems) {
    if (regionSys.length < 2) continue;

    const mstEdges = kruskalMST(regionSys);

    // MST edges (guaranteed connectivity)
    for (const edge of mstEdges) {
      const fuel = Math.round(
        (edge.dist / params.systemScatterRadius) * intraRegionBaseFuel * 10,
      ) / 10;
      // Bidirectional
      connections.push({
        fromSystemIndex: regionSys[edge.a].index,
        toSystemIndex: regionSys[edge.b].index,
        fuelCost: Math.max(1, fuel),
        isGateway: false,
      });
      connections.push({
        fromSystemIndex: regionSys[edge.b].index,
        toSystemIndex: regionSys[edge.a].index,
        fuelCost: Math.max(1, fuel),
        isGateway: false,
      });
    }

    // Extra edges for route variety
    const extraCount = Math.floor(mstEdges.length * extraEdgeFraction);
    const mstSet = new Set(
      mstEdges.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`),
    );

    // Build candidate extra edges (non-MST, sorted by distance)
    const candidates: Edge[] = [];
    for (let i = 0; i < regionSys.length; i++) {
      for (let j = i + 1; j < regionSys.length; j++) {
        const key = `${i}-${j}`;
        if (mstSet.has(key)) continue;
        candidates.push({
          a: i,
          b: j,
          dist: distance(regionSys[i].x, regionSys[i].y, regionSys[j].x, regionSys[j].y),
        });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    // Pick random extras from the shorter-distance candidates
    const pool = candidates.slice(0, Math.min(candidates.length, extraCount * 3));
    const picked = new Set<number>();
    let added = 0;
    while (added < extraCount && picked.size < pool.length) {
      const idx = randInt(rng, 0, pool.length - 1);
      if (picked.has(idx)) continue;
      picked.add(idx);
      const edge = pool[idx];
      const fuel = Math.round(
        (edge.dist / params.systemScatterRadius) * intraRegionBaseFuel * 10,
      ) / 10;
      connections.push({
        fromSystemIndex: regionSys[edge.a].index,
        toSystemIndex: regionSys[edge.b].index,
        fuelCost: Math.max(1, fuel),
        isGateway: false,
      });
      connections.push({
        fromSystemIndex: regionSys[edge.b].index,
        toSystemIndex: regionSys[edge.a].index,
        fuelCost: Math.max(1, fuel),
        isGateway: false,
      });
      added++;
    }
  }

  // ── Phase 2: Region adjacency (MST on region centers + extras) ──
  const regionMST = kruskalMST(regions);

  // Add ~2 extra inter-region edges for variety
  const regionMSTSet = new Set(
    regionMST.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`),
  );
  const regionExtras: Edge[] = [];
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const key = `${i}-${j}`;
      if (regionMSTSet.has(key)) continue;
      regionExtras.push({
        a: i,
        b: j,
        dist: distance(regions[i].x, regions[i].y, regions[j].x, regions[j].y),
      });
    }
  }
  regionExtras.sort((a, b) => a.dist - b.dist);
  const allRegionPairs = [...regionMST, ...regionExtras.slice(0, 2)];

  // ── Phase 3: Gateway designation + inter-region connections ──
  // Clone systems array so we can mark gateways
  const updatedSystems = systems.map((s) => ({ ...s }));
  const systemsByRegion: Map<number, GeneratedSystem[]> = new Map();
  for (const sys of updatedSystems) {
    if (!systemsByRegion.has(sys.regionIndex)) {
      systemsByRegion.set(sys.regionIndex, []);
    }
    systemsByRegion.get(sys.regionIndex)!.push(sys);
  }

  for (const pair of allRegionPairs) {
    const regionA = regions[pair.a];
    const regionB = regions[pair.b];
    const sysA = systemsByRegion.get(regionA.index) ?? [];
    const sysB = systemsByRegion.get(regionB.index) ?? [];

    // Find the closest pair of border systems between the two regions
    let bestDist = Infinity;
    let bestA: GeneratedSystem | null = null;
    let bestB: GeneratedSystem | null = null;

    for (const sa of sysA) {
      for (const sb of sysB) {
        const d = distance(sa.x, sa.y, sb.x, sb.y);
        if (d < bestDist) {
          bestDist = d;
          bestA = sa;
          bestB = sb;
        }
      }
    }

    if (!bestA || !bestB) continue;

    // Mark as gateways
    bestA.isGateway = true;
    bestB.isGateway = true;

    // Inter-region connection with higher fuel cost
    const fuel = Math.round(
      (bestDist / params.systemScatterRadius) * intraRegionBaseFuel * gatewayFuelMultiplier * 10,
    ) / 10;
    connections.push({
      fromSystemIndex: bestA.index,
      toSystemIndex: bestB.index,
      fuelCost: Math.max(1, fuel),
      isGateway: true,
    });
    connections.push({
      fromSystemIndex: bestB.index,
      toSystemIndex: bestA.index,
      fuelCost: Math.max(1, fuel),
      isGateway: true,
    });
  }

  return { connections, systems: updatedSystems };
}

// ── Starting system selection ───────────────────────────────────

export function selectStartingSystem(
  systems: GeneratedSystem[],
  regions: GeneratedRegion[],
  mapSize: number,
): number {
  // Find region closest to map center
  const center = mapSize / 2;
  let centralRegion = regions[0];
  let bestRegionDist = distance(centralRegion.x, centralRegion.y, center, center);
  for (const r of regions) {
    const d = distance(r.x, r.y, center, center);
    if (d < bestRegionDist) {
      centralRegion = r;
      bestRegionDist = d;
    }
  }

  // Within the central region, prefer core economy systems closest to region center
  const regionSystems = systems.filter((s) => s.regionIndex === centralRegion.index);
  const coreSystems = regionSystems.filter((s) => s.economyType === "core");
  const candidates = coreSystems.length > 0 ? coreSystems : regionSystems;

  let best = candidates[0];
  let bestDist = distance(best.x, best.y, centralRegion.x, centralRegion.y);
  for (const sys of candidates) {
    const d = distance(sys.x, sys.y, centralRegion.x, centralRegion.y);
    if (d < bestDist) {
      best = sys;
      bestDist = d;
    }
  }
  return best.index;
}

// ── Top-level generation ────────────────────────────────────────

export function generateUniverse(
  params: GenParams,
  names: string[],
): GeneratedUniverse {
  const rng = mulberry32(params.seed);

  const regions = generateRegions(rng, params, names);
  const rawSystems = generateSystems(rng, regions, params);
  const { connections, systems } = generateConnections(rng, rawSystems, regions, params);

  const startingSystemIndex = selectStartingSystem(systems, regions, params.mapSize);

  return { regions, systems, connections, startingSystemIndex };
}
