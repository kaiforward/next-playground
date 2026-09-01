/**
 * Procedural universe generation — pure functions, zero DB dependency.
 * Deterministic given a seed value via mulberry32 PRNG.
 */

import type { EconomyType } from "@/lib/types/game";
import {
  generateSubstrate, substrateAggregates, assignOrbitIndices,
  type GeneratedSubstrate,
} from "./body-gen";
import { deriveEconomyTypeLabel } from "./economy-type";
import { workedYieldVectors } from "@/lib/engine/worked-deposits";
import { computeHomeworldBuildings, HOME_SYSTEM_POP, homeworldGardenBody } from "./homeworld-prefab";
import { housingPopCap } from "./industry";
import {
  generateFactions,
  assignHomeworldOwnership,
  type GeneratedFaction,
  type PlayerFactionInput,
} from "./faction-gen";
import { distance, mulberry32, kruskalMST, UnionFind, type RNG, type Edge } from "./generation-primitives";
import { buildGalaxyShape, type GalaxyShapeKnobs, type ClusterSeed, type DensityGrid } from "./density-field";

// Re-exported so existing consumers (`@/lib/engine/universe-gen` importers throughout the tick,
// engine and test layers) keep their import path — these are dependency-free primitives that now
// live in `generation-primitives.ts` alongside the galaxy-shape engine (`density-field.ts`), which
// needs them without pulling in this module's much heavier import graph.
export { distance, mulberry32, UnionFind, type RNG };

// ── Output types ────────────────────────────────────────────────

export interface GeneratedRegion {
  index: number;
  name: string;
  x: number;
  y: number;
}

/** A placed system: its generated physical substrate plus the galaxy-level facts world-gen adds. */
export interface GeneratedSystem extends GeneratedSubstrate {
  index: number;
  name: string;
  economyType: EconomyType;
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
  factions: GeneratedFaction[];
  /** factionIndex per system (parallel to `systems` by system.index). */
  systemFactionAssignments: number[];
  /** Index into `factions` of the human player's authored faction, or null when playerless. */
  playerFactionIndex: number | null;
}

// ── Generation parameters ───────────────────────────────────────

export interface GenParams {
  seed: number;
  totalSystems: number;
  mapSize: number;
  mapPadding: number;
  poissonMinDistance: number;
  poissonKCandidates: number;
  extraEdgeFraction: number;
  gatewayFuelMultiplier: number;
  gatewaysPerBorder: number;
  intraRegionBaseFuel: number;
  /** Procedurally generated minors layered on top of the 8 majors. */
  minorFactionCount: number;
  /** Galaxy-shape structure knobs (spec §5) — consumed by `buildGalaxyShape` to author the density
   *  grid, cluster seeds and corridor plan that region/system placement read. */
  shapeKnobs: GalaxyShapeKnobs;
}

// ── Utility functions ───────────────────────────────────────────

export function randInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ── Region generation ───────────────────────────────────────────

/**
 * Take region `i`'s name sequentially from the flat pool, suffixing it when the pool wraps onto a
 * name already claimed. Records the claim in `usedNames`.
 */
function claimRegionName(names: string[], usedNames: Set<string>, i: number): string {
  let name = names[i % names.length];
  if (usedNames.has(name)) {
    name = `${name}-${i + 1}`;
  }
  usedNames.add(name);
  return name;
}

/**
 * Region rows straight from the galaxy shape's cluster seeds (spec §5: "region becomes cluster") —
 * one region per seed, center = seed position, named sequentially off the flat pool. Placement
 * itself already happened in `buildGalaxyShape` (`placeClusterSeeds`); this function only names the
 * result, so region count is exactly `seeds.length` and never drifts from the cluster structure.
 */
export function generateRegions(seeds: ClusterSeed[], names: string[]): GeneratedRegion[] {
  const usedNames = new Set<string>();
  return seeds.map((seed, i) => ({
    index: i,
    name: claimRegionName(names, usedNames, i),
    x: seed.x,
    y: seed.y,
  }));
}

// ── Bridson's Poisson disk sampling ─────────────────────────────

interface Point {
  x: number;
  y: number;
}

/**
 * Sparse-band cap on the local placement radius, as a multiple of `baseMinDistance` (the tightest,
 * max-density spacing) — bounds how far a near-void cell (density just above `voidFloor`) can push
 * the local minimum distance, so an extreme knob set (a `voidFloor` near 0) can't blow the radius up
 * toward `Infinity` (which would violate the World's JSON-serialisability rule downstream).
 */
const MAX_DENSITY_RADIUS_MULTIPLIER = 6;

/** Random rejection-sampled attempts used to seed active points across every density island before
 *  the annulus-growth phase runs — without this, growth from a single seed point could never reach
 *  a separate cluster on the other side of a void (growth only ever steps within `[r, 2r]` of an
 *  existing point, so it can't cross a gap wider than that). Scales with `maxPoints` so a small
 *  galaxy doesn't over-sample and a large one still covers every island with reasonable odds. */
function initialSeedAttempts(maxPoints: number): number {
  return Math.min(4000, Math.max(64, maxPoints));
}

/** Density at world point (x, y), read from the coarse grid (`buildGalaxyShape`'s output) — nearest
 *  cell, clamped to the grid's own bounds so a point exactly on the map edge still resolves. */
function densityAt(grid: DensityGrid, mapSize: number, x: number, y: number): number {
  const cellSize = mapSize / grid.resolution;
  const col = Math.min(grid.resolution - 1, Math.max(0, Math.floor(x / cellSize)));
  const row = Math.min(grid.resolution - 1, Math.max(0, Math.floor(y / cellSize)));
  return grid.cells[row * grid.resolution + col];
}

/**
 * The local minimum spacing at a point of the given density: tight (down to `baseMinDistance`
 * itself) where density is highest (cluster cores), sparse (up to the capped multiple) where
 * density is low but nonzero (corridor bands) — "tight in clusters, sparse on corridors, nothing in
 * voids" (spec §5). Callers must check `density > 0` first; a zero-density point is true void and
 * never gets a radius at all.
 *
 * A cluster's density falls off quadratically from its core (`seedInfluence`'s `edge * edge`), so
 * most of a cluster's nonzero-density footprint sits at low-to-mid density, not near 1 — a straight
 * inverse (`baseMinDistance / density`) would read almost all of that footprint as corridor-sparse,
 * leaving true cluster interiors looking like a pinprick. Raising density to `DENSITY_RADIUS_EXPONENT`
 * (< 1) before inverting compresses that falloff back toward the tight end, so a cluster reads tight
 * across most of its footprint and only its rim — genuinely near the void floor — reads sparse.
 */
const DENSITY_RADIUS_EXPONENT = 0.05;

function radiusFromDensity(density: number, baseMinDistance: number): number {
  const raw = baseMinDistance / Math.pow(density, DENSITY_RADIUS_EXPONENT);
  return Math.min(Math.max(raw, baseMinDistance), baseMinDistance * MAX_DENSITY_RADIUS_MULTIPLIER);
}

/**
 * Bridson's algorithm for Poisson disk sampling, variable-radius variant: the local minimum
 * distance at each point comes from `grid`'s density there instead of one fixed value, so placement
 * runs tight inside clusters, sparse along corridor bands, and never lands in a true-void cell
 * (`densityAt` reading exactly 0). Multi-seeded (`initialSeedAttempts`) so growth reaches every
 * density island, not just the one the first random point happens to land in.
 * Uses a seeded RNG throughout for determinism.
 */
export function bridsonSample(
  rng: RNG,
  width: number,
  height: number,
  baseMinDistance: number,
  kCandidates: number,
  padding: number,
  maxPoints: number,
  grid: DensityGrid,
): Point[] {
  const mapSize = width; // the density grid is authored over a square map, width === height in practice
  const cellSize = baseMinDistance / Math.SQRT2; // finest possible spacing, at max density
  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;
  const gridW = Math.ceil(innerW / cellSize);
  const gridH = Math.ceil(innerH / cellSize);
  const accel: (number | null)[] = new Array(gridW * gridH).fill(null);
  const points: Point[] = [];
  const radii: number[] = []; // local radius at placement time, parallel to `points`
  const active: number[] = [];

  const maxRadius = baseMinDistance * MAX_DENSITY_RADIUS_MULTIPLIER;
  const searchCells = Math.max(2, Math.ceil(maxRadius / cellSize) + 1);

  function accelIndex(x: number, y: number): number {
    const col = Math.floor((x - padding) / cellSize);
    const row = Math.floor((y - padding) / cellSize);
    return row * gridW + col;
  }

  function inBounds(x: number, y: number): boolean {
    return x >= padding && x < width - padding && y >= padding && y < height - padding;
  }

  /** True when (x, y) sits closer than either its own or a neighbour's local radius allows. */
  function tooClose(x: number, y: number, r: number): boolean {
    const col = Math.floor((x - padding) / cellSize);
    const row = Math.floor((y - padding) / cellSize);
    for (let dr = -searchCells; dr <= searchCells; dr++) {
      for (let dc = -searchCells; dc <= searchCells; dc++) {
        const r2 = row + dr;
        const c2 = col + dc;
        if (r2 < 0 || r2 >= gridH || c2 < 0 || c2 >= gridW) continue;
        const idx = accel[r2 * gridW + c2];
        if (idx === null) continue;
        const p = points[idx];
        if (distance(x, y, p.x, p.y) < Math.max(r, radii[idx])) return true;
      }
    }
    return false;
  }

  /** Accept (x, y) as a new point iff in bounds, over nonzero density, and not too close to an
   *  existing point — returns its index, or null when rejected. */
  function tryAddPoint(x: number, y: number): number | null {
    if (!inBounds(x, y)) return null;
    const density = densityAt(grid, mapSize, x, y);
    if (density <= 0) return null; // true void — never place here
    const r = radiusFromDensity(density, baseMinDistance);
    if (tooClose(x, y, r)) return null;

    const idx = points.length;
    points.push({ x, y });
    radii.push(r);
    accel[accelIndex(x, y)] = idx;
    return idx;
  }

  // Phase 1: rejection-sample initial active points broadly across the map, so every density
  // island (cluster, corridor band) gets at least a chance of its own starting point.
  for (let i = 0; i < initialSeedAttempts(maxPoints) && points.length < maxPoints; i++) {
    const x = padding + rng() * innerW;
    const y = padding + rng() * innerH;
    const idx = tryAddPoint(x, y);
    if (idx !== null) active.push(idx);
  }

  // Phase 2: standard Bridson growth from every active point, using ITS OWN local radius for the
  // candidate annulus — so a sparse corridor point spawns sparse neighbours, a tight cluster point
  // spawns tight ones.
  while (active.length > 0 && points.length < maxPoints) {
    const activeIdx = Math.floor(rng() * active.length);
    const ptIdx = active[activeIdx];
    const pt = points[ptIdx];
    const ptRadius = radii[ptIdx];
    let found = false;

    for (let k = 0; k < kCandidates; k++) {
      const angle = rng() * Math.PI * 2;
      const r = ptRadius + rng() * ptRadius;
      const cx = pt.x + Math.cos(angle) * r;
      const cy = pt.y + Math.sin(angle) * r;

      const newIdx = tryAddPoint(cx, cy);
      if (newIdx !== null) {
        active.push(newIdx);
        found = true;
        if (points.length >= maxPoints) break;
      }
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
  grid: DensityGrid,
): GeneratedSystem[] {
  const { totalSystems, mapSize, mapPadding, poissonMinDistance, poissonKCandidates } = params;
  const padding = mapSize * mapPadding;

  // Step 1: Scatter systems by local density — tight in clusters, sparse on corridor bands,
  // nothing in true void (spec §5).
  const points = bridsonSample(
    rng, mapSize, mapSize, poissonMinDistance, poissonKCandidates, padding, totalSystems, grid,
  );

  // Step 2: Assign each point to its nearest region center
  const regionAssignments = assignRegions(points, regions);

  // Track per-region system count for naming
  const regionLocalCount: number[] = new Array(regions.length).fill(0);

  // Step 3: Build GeneratedSystem for each point from its physical substrate
  const systems: GeneratedSystem[] = [];
  for (let i = 0; i < points.length; i++) {
    const substrate = generateSubstrate(rng);
    const economyType = deriveEconomyTypeLabel(
      substrate.depositCounts, substrate.potentialYieldMult, substrate.population,
    );
    const regionIndex = regionAssignments[i];
    const localIndex = regionLocalCount[regionIndex]++;

    systems.push({
      index: i,
      name: `${regions[regionIndex].name}-${localIndex + 1}`,
      economyType,
      sunClass: substrate.sunClass,
      bodies: substrate.bodies,
      popCap: substrate.popCap,
      population: substrate.population,
      bodyDanger: substrate.bodyDanger,
      buildings: substrate.buildings,
      peopleLand: substrate.peopleLand,
      depositCounts: substrate.depositCounts,
      potentialYieldMult: substrate.potentialYieldMult,
      potentialExtractionEfficiency: substrate.potentialExtractionEfficiency,
      yieldMult: substrate.yieldMult,
      extractionEfficiency: substrate.extractionEfficiency,
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

/**
 * Candidate extra edges for route variety: every local-index pair NOT already joined by `mst`,
 * nearest first.
 */
function extraEdgeCandidates(points: { x: number; y: number }[], mst: Edge[]): Edge[] {
  const inMst = new Set(mst.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`));
  const candidates: Edge[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (inMst.has(`${i}-${j}`)) continue;
      candidates.push({
        a: i,
        b: j,
        dist: distance(points[i].x, points[i].y, points[j].x, points[j].y),
      });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates;
}

/**
 * Fuel cost of one lane, normalised against the average intra-region hop and rounded to 0.1.
 * `multiplier` prices a lane class above the intra-region baseline (gateways cost more).
 */
function laneFuelCost(
  dist: number,
  avgIntraDist: number,
  baseFuel: number,
  multiplier: number,
): number {
  return Math.max(1, Math.round((dist / avgIntraDist) * baseFuel * multiplier * 10) / 10);
}

/** Record a lane as the two directed rows the connection table stores it as. */
function pushLane(
  connections: GeneratedConnection[],
  aIndex: number,
  bIndex: number,
  fuelCost: number,
  isGateway: boolean,
): void {
  connections.push({ fromSystemIndex: aIndex, toSystemIndex: bIndex, fuelCost, isGateway });
  connections.push({ fromSystemIndex: bIndex, toSystemIndex: aIndex, fuelCost, isGateway });
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

  // Compute average intra-region distance for fuel normalisation
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
    /** An intra-region lane at the baseline fuel rate, between two systems of THIS region. */
    const addIntraLane = (edge: Edge): void =>
      pushLane(
        connections,
        regionSys[edge.a].index,
        regionSys[edge.b].index,
        laneFuelCost(edge.dist, avgIntraDist, intraRegionBaseFuel, 1),
        false,
      );

    // MST edges (guaranteed connectivity)
    for (const edge of mstEdges) addIntraLane(edge);

    // Extra edges for route variety
    const extraCount = Math.floor(mstEdges.length * extraEdgeFraction);
    const candidates = extraEdgeCandidates(regionSys, mstEdges);

    // Pick random extras from the shorter-distance candidates
    const pool = candidates.slice(0, Math.min(candidates.length, extraCount * 3));
    const picked = new Set<number>();
    let added = 0;
    while (added < extraCount && picked.size < pool.length) {
      const idx = randInt(rng, 0, pool.length - 1);
      if (picked.has(idx)) continue;
      picked.add(idx);
      addIntraLane(pool[idx]);
      added++;
    }
  }

  // ── Phase 2: Region adjacency (MST on region centers + extras) ──
  const regionMST = kruskalMST(regions);

  // Add ~2 extra inter-region edges for variety
  const regionExtras = extraEdgeCandidates(regions, regionMST);
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
      pushLane(
        connections,
        cp.sa.index,
        cp.sb.index,
        laneFuelCost(cp.dist, avgIntraDist, intraRegionBaseFuel, gatewayFuelMultiplier),
        true,
      );
    }
  }

  return { connections, systems: updatedSystems };
}

// ── Emergent starting condition ─────────────────────────────────

/**
 * Apply the emergent starting condition to the freshly-scattered (bare) systems: each faction homeworld
 * is stamped with the self-sufficient home-system prefab sized to its government's demand, on a guaranteed
 * garden body sized to fit it; every other system stays an empty deposit field that expansion colonises
 * into. The garden body is prepended to the homeworld's procedural bodies (kept as scenery), and the
 * space/slot/yield aggregates + economy label are recomputed to match. `homeworldIndices` holds the
 * system index of every faction capital. Mutates `systems` in place.
 */
export function stampHomeworldPrefabs(
  systems: GeneratedSystem[],
  homeworldIndices: Set<number>,
  rng: RNG,
): void {
  for (const s of systems) {
    if (!homeworldIndices.has(s.index)) {
      s.population = 0; // already bare from generateSubstrate — belt-and-braces
      s.buildings = {};
      s.popCap = 0;
      continue;
    }
    // The garden body is prepended to the procedural bodies (existing behaviour, unchanged —
    // array order is a live contract, see body-gen.ts), then the WHOLE combined set is rolled for
    // ring assignment exactly as a normal system is: the garden body is a temperate-class world and
    // takes temperate_world's orbitalBias + noise like any other, so it lands where its key falls
    // rather than always innermost.
    const bodies = assignOrbitIndices(rng, [homeworldGardenBody(), ...s.bodies]);
    const agg = substrateAggregates(bodies);
    s.bodies = bodies;
    s.depositCounts = agg.depositCounts;
    s.peopleLand = agg.peopleLand;
    s.potentialYieldMult = agg.potentialYieldMult;
    s.potentialExtractionEfficiency = agg.potentialExtractionEfficiency;
    s.bodyDanger = agg.bodyDanger;
    s.buildings = computeHomeworldBuildings(HOME_SYSTEM_POP);
    s.population = HOME_SYSTEM_POP;
    s.popCap = housingPopCap(s.buildings);
    // The worked fold must run AFTER buildings is stamped above — folding against the
    // pre-stamp {} would credit the capital's extractors with zero worked slots.
    const worked = workedYieldVectors(bodies, s.buildings);
    s.yieldMult = worked.yieldMult;
    s.extractionEfficiency = worked.eff;
    s.economyType = deriveEconomyTypeLabel(s.depositCounts, s.potentialYieldMult, s.population);
  }
}

// ── Top-level generation ────────────────────────────────────────

export function generateUniverse(
  params: GenParams,
  names: string[],
  playerFaction?: PlayerFactionInput,
): GeneratedUniverse {
  const rng = mulberry32(params.seed);

  // The galaxy shape (density grid, cluster seeds, corridor plan) is authored once, up front, off
  // the same draw sequence every other generation step shares — region and system placement both
  // read its output, never re-derive structure of their own (density-field.ts's authoring model).
  const shape = buildGalaxyShape(params.shapeKnobs, params.mapSize, rng);

  const regions = generateRegions(shape.seeds, names);
  const rawSystems = generateSystems(rng, regions, params, shape.grid);
  const { connections, systems } = generateConnections(rng, rawSystems, regions, params);

  const factions = generateFactions(rng, systems, {
    minorFactionCount: params.minorFactionCount,
    mapSize: params.mapSize,
    playerFaction,
  });

  stampHomeworldPrefabs(systems, new Set(factions.map((f) => f.homeworldSystemIndex)), rng);

  const systemFactionAssignments = assignHomeworldOwnership(systems.length, factions);

  const playerFactionIndex = playerFaction
    ? factions.findIndex((f) => f.key === "player")
    : null;

  return {
    regions,
    systems,
    connections,
    factions,
    systemFactionAssignments,
    playerFactionIndex,
  };
}
