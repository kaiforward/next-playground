/**
 * Procedural universe generation — pure functions, zero DB dependency.
 * Deterministic given a seed value via mulberry32 PRNG.
 */

import type { EconomyType, GovernmentType } from "@/lib/types/game";
import { ALL_GOVERNMENT_TYPES, toGovernmentType } from "@/lib/types/guards";
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
  totalSystems: number;
  mapSize: number;
  mapPadding: number;
  poissonMinDistance: number;
  poissonKCandidates: number;
  regionMinDistance: number;
  extraEdgeFraction: number;
  gatewayFuelMultiplier: number;
  gatewaysPerBorder: number;
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

export function weightedPick(
  rng: RNG,
  weights: Record<string, number>,
): string {
  const entries = Object.entries(weights);
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
  const { regionCount, mapSize, mapPadding, regionMinDistance, maxPlacementAttempts } = params;
  const padding = mapSize * mapPadding;
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
      const governmentType = toGovernmentType(weightedPick(rng, {
        federation: 1,
        corporate: 1,
        authoritarian: 1,
        frontier: 1,
      }));
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

      const governmentType = toGovernmentType(weightedPick(rng, {
        federation: 1,
        corporate: 1,
        authoritarian: 1,
        frontier: 1,
      }));
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

// ── Bridson's Poisson disk sampling ─────────────────────────────

interface Point {
  x: number;
  y: number;
}

/**
 * Bridson's algorithm for Poisson disk sampling.
 * O(n) — generates well-spaced points with guaranteed minimum distance.
 * Uses a seeded RNG for determinism.
 */
export function bridsonSample(
  rng: RNG,
  width: number,
  height: number,
  minDistance: number,
  kCandidates: number,
  padding: number,
  maxPoints: number,
): Point[] {
  const cellSize = minDistance / Math.SQRT2;
  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;
  const gridW = Math.ceil(innerW / cellSize);
  const gridH = Math.ceil(innerH / cellSize);
  const grid: (number | null)[] = new Array(gridW * gridH).fill(null);
  const points: Point[] = [];
  const active: number[] = [];

  function gridIndex(x: number, y: number): number {
    const col = Math.floor((x - padding) / cellSize);
    const row = Math.floor((y - padding) / cellSize);
    return row * gridW + col;
  }

  function inBounds(x: number, y: number): boolean {
    return x >= padding && x < width - padding && y >= padding && y < height - padding;
  }

  function tooClose(x: number, y: number): boolean {
    const col = Math.floor((x - padding) / cellSize);
    const row = Math.floor((y - padding) / cellSize);
    // Check 5x5 neighborhood
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r2 = row + dr;
        const c2 = col + dc;
        if (r2 < 0 || r2 >= gridH || c2 < 0 || c2 >= gridW) continue;
        const idx = grid[r2 * gridW + c2];
        if (idx === null) continue;
        const p = points[idx];
        if (distance(x, y, p.x, p.y) < minDistance) return true;
      }
    }
    return false;
  }

  // Seed with first point
  const x0 = padding + rng() * innerW;
  const y0 = padding + rng() * innerH;
  points.push({ x: x0, y: y0 });
  grid[gridIndex(x0, y0)] = 0;
  active.push(0);

  while (active.length > 0 && points.length < maxPoints) {
    // Pick a random active point
    const activeIdx = Math.floor(rng() * active.length);
    const ptIdx = active[activeIdx];
    const pt = points[ptIdx];
    let found = false;

    for (let k = 0; k < kCandidates; k++) {
      // Random point in annulus [minDistance, 2*minDistance]
      const angle = rng() * Math.PI * 2;
      const r = minDistance + rng() * minDistance;
      const cx = pt.x + Math.cos(angle) * r;
      const cy = pt.y + Math.sin(angle) * r;

      if (!inBounds(cx, cy) || tooClose(cx, cy)) continue;

      const newIdx = points.length;
      points.push({ x: cx, y: cy });
      grid[gridIndex(cx, cy)] = newIdx;
      active.push(newIdx);
      found = true;

      if (points.length >= maxPoints) break;
    }

    if (!found) {
      // Remove from active list (swap with last for O(1))
      active[activeIdx] = active[active.length - 1];
      active.pop();
    }
  }

  return points;
}

// ── Voronoi region assignment ───────────────────────────────────

/**
 * Assign each system to its nearest region center (Voronoi partition).
 */
export function assignRegions(
  points: Point[],
  regionCenters: GeneratedRegion[],
): number[] {
  return points.map((p) => {
    let bestIdx = 0;
    let bestDist = distance(p.x, p.y, regionCenters[0].x, regionCenters[0].y);
    for (let i = 1; i < regionCenters.length; i++) {
      const d = distance(p.x, p.y, regionCenters[i].x, regionCenters[i].y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  });
}

// ── System generation ───────────────────────────────────────────

export function generateSystems(
  rng: RNG,
  regions: GeneratedRegion[],
  params: GenParams,
): GeneratedSystem[] {
  const { totalSystems, mapSize, mapPadding, poissonMinDistance, poissonKCandidates } = params;
  const padding = mapSize * mapPadding;

  // Step 1: Scatter all systems uniformly via Poisson disk sampling
  const points = bridsonSample(
    rng, mapSize, mapSize, poissonMinDistance, poissonKCandidates, padding, totalSystems,
  );

  // Step 2: Assign each point to its nearest region center
  const regionAssignments = assignRegions(points, regions);

  // Track per-region system count for naming
  const regionLocalCount: number[] = new Array(regions.length).fill(0);

  // Step 3: Build GeneratedSystem for each point
  const systems: GeneratedSystem[] = [];
  for (let i = 0; i < points.length; i++) {
    const traits = generateSystemTraits(rng);
    const economyType = deriveEconomyType(traits, rng);
    const regionIndex = regionAssignments[i];
    const localIndex = regionLocalCount[regionIndex]++;

    systems.push({
      index: i,
      name: `${regions[regionIndex].name}-${localIndex + 1}`,
      economyType,
      traits,
      x: points[i].x,
      y: points[i].y,
      regionIndex,
      isGateway: false,
      description: "",
    });
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
  const { extraEdgeFraction, gatewayFuelMultiplier, gatewaysPerBorder, intraRegionBaseFuel } = params;
  const connections: GeneratedConnection[] = [];

  // Group systems by region
  const regionSystems: Map<number, GeneratedSystem[]> = new Map();
  for (const region of regions) {
    regionSystems.set(region.index, []);
  }
  for (const sys of systems) {
    regionSystems.get(sys.regionIndex)!.push(sys);
  }

  // Compute average intra-region distance for fuel normalization
  // (replaces the old fixed systemScatterRadius divisor)
  let totalIntraDist = 0;
  let totalIntraEdges = 0;
  for (const [, regionSys] of regionSystems) {
    if (regionSys.length < 2) continue;
    const mst = kruskalMST(regionSys);
    for (const e of mst) {
      totalIntraDist += e.dist;
      totalIntraEdges++;
    }
  }
  const avgIntraDist = totalIntraEdges > 0 ? totalIntraDist / totalIntraEdges : params.poissonMinDistance;

  // ── Phase 1: Intra-region connections ──
  for (const [, regionSys] of regionSystems) {
    if (regionSys.length < 2) continue;

    const mstEdges = kruskalMST(regionSys);

    // MST edges (guaranteed connectivity)
    for (const edge of mstEdges) {
      const fuel = Math.round(
        (edge.dist / avgIntraDist) * intraRegionBaseFuel * 10,
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
        (edge.dist / avgIntraDist) * intraRegionBaseFuel * 10,
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

    // Build all cross-region pairs sorted by distance
    const crossPairs: { sa: GeneratedSystem; sb: GeneratedSystem; dist: number }[] = [];
    for (const sa of sysA) {
      for (const sb of sysB) {
        crossPairs.push({ sa, sb, dist: distance(sa.x, sa.y, sb.x, sb.y) });
      }
    }
    crossPairs.sort((a, b) => a.dist - b.dist);

    // Pick up to gatewaysPerBorder pairs, ensuring distinct systems on each side
    // so crossing points are geographically spread out
    const usedA = new Set<number>();
    const usedB = new Set<number>();
    let picked = 0;

    for (const cp of crossPairs) {
      if (picked >= gatewaysPerBorder) break;
      if (usedA.has(cp.sa.index) || usedB.has(cp.sb.index)) continue;

      usedA.add(cp.sa.index);
      usedB.add(cp.sb.index);
      picked++;

      // Mark as gateways
      cp.sa.isGateway = true;
      cp.sb.isGateway = true;

      // Inter-region connection with higher fuel cost
      const fuel = Math.round(
        (cp.dist / avgIntraDist) * intraRegionBaseFuel * gatewayFuelMultiplier * 10,
      ) / 10;
      connections.push({
        fromSystemIndex: cp.sa.index,
        toSystemIndex: cp.sb.index,
        fuelCost: Math.max(1, fuel),
        isGateway: true,
      });
      connections.push({
        fromSystemIndex: cp.sb.index,
        toSystemIndex: cp.sa.index,
        fuelCost: Math.max(1, fuel),
        isGateway: true,
      });
    }
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
