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
import {
  buildGalaxyShape,
  type GalaxyShapeKnobs, type DensityGrid, type CorridorPlan,
} from "./density-field";
import {
  generateRegions, bridsonSample, assignRegions, type GeneratedRegion,
} from "./system-placement";

// Re-exported so existing consumers (`@/lib/engine/universe-gen` importers throughout the tick,
// engine and test layers) keep their import path — these are dependency-free primitives that now
// live in `generation-primitives.ts` alongside the galaxy-shape engine (`density-field.ts`), which
// needs them without pulling in this module's much heavier import graph. `generateRegions`/
// `bridsonSample`/`assignRegions` similarly now live in `system-placement.ts` — the galaxy-preview
// surface (`components/start/galaxy-preview.tsx`) needs real placement without pulling in
// `economy-scale` through this module's homeworld-prefab/industry imports.
export { distance, mulberry32, UnionFind, type RNG };
export { generateRegions, bridsonSample, assignRegions, type GeneratedRegion };

// ── Output types ────────────────────────────────────────────────

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
  /** True exactly for a corridor's single crossing-style lane (spec §5) — priced through
   *  `laneFuelCost`'s multiplier, the crossing class. False for every intra-cluster lane AND
   *  every band-style corridor's chain link, even one that crosses a cluster boundary: crossing
   *  the map's regions and being priced as the expensive "crossing" class are separate facts. The
   *  cosmetic, persisted `isGateway` flag lives on the SYSTEM instead (`GeneratedSystem.isGateway`
   *  / `WorldSystem.isGateway`, `lib/world/types.ts:107`) — a corridor-endpoint system, not a
   *  connection-level concept. */
  isCrossing: boolean;
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
  /** Crossing-class multiplier: prices a corridor's crossing-style lane above the intra-cluster
   *  baseline. The only lane class this pass has — no separate "gateways per border" knob (the old
   *  region-adjacency phase this replaced had one; corridor count is `shapeKnobs.corridorsPerCluster`
   *  now, spec §5). */
  crossingFuelMultiplier: number;
  intraRegionBaseFuel: number;
  /** Procedurally generated minors layered on top of the 8 majors. */
  minorFactionCount: number;
  /** Galaxy-shape structure knobs (spec §5) — consumed by `buildGalaxyShape` to author the density
   *  grid, cluster seeds and corridor plan that region/system placement read. */
  shapeKnobs: GalaxyShapeKnobs;
  /** Multiplies `mapSize` before padding, shape authoring (`buildGalaxyShape`) and placement all
   *  read it — the New Game "Map size" lever. 1 reproduces today's config-derived extent exactly. */
  mapSizeScale: number;
  /** Multiplies `poissonMinDistance` — the New Game "Star spacing" lever: below 1 places stars
   *  closer together everywhere, above 1 sparser. 1 reproduces today's spacing exactly. */
  minDistanceScale: number;
  /** Passed straight through to `bridsonSample`'s `densityRadiusExponent` — the New Game "Cluster
   *  tightness" lever, the core-vs-band spacing contrast. Defaults to `DENSITY_RADIUS_EXPONENT`
   *  (`system-placement.ts`), reproducing today's placement exactly. */
  densityRadiusExponent: number;
}

/** Every galaxy-shape lever a caller may override, flattened: the seven `GalaxyShapeKnobs` fields
 *  plus the three placement/scale levers above. All optional — an omitted field keeps
 *  `buildGenParams`'s (`lib/world/gen.ts`) engine default, which is what keeps a knob-free
 *  `newGame` byte-identical to today's world. Field names here match the New Game schema
 *  (`lib/schemas/game-setup.ts`'s `galaxyShapeSchema`), not `GenParams`'s own — `starSpacing`/
 *  `clusterTightness` are the player-facing names for `minDistanceScale`/`densityRadiusExponent`. */
export type GalaxyShapeInput = Partial<GalaxyShapeKnobs> & {
  starSpacing?: number;
  clusterTightness?: number;
  mapSizeScale?: number;
};

// ── Utility functions ───────────────────────────────────────────

export function randInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// Region naming, density-aware Poisson-disk placement (`bridsonSample`) and Voronoi region
// assignment (`assignRegions`) live in `system-placement.ts`, re-exported above.

// ── System generation ───────────────────────────────────────────

export function generateSystems(
  rng: RNG,
  regions: GeneratedRegion[],
  params: GenParams,
  grid: DensityGrid,
): GeneratedSystem[] {
  const {
    totalSystems, mapSize, mapPadding, poissonMinDistance, poissonKCandidates, densityRadiusExponent,
  } = params;
  const padding = mapSize * mapPadding;

  // Step 1: Scatter systems by local density — tight in clusters, sparse on corridor bands,
  // nothing in true void (spec §5). `regions` are the cluster seeds themselves (one center per
  // region, `generateRegions`) — passing their positions guarantees every cluster places at least
  // one system, so every corridor has real systems to anchor (spec §5's connectivity requirement;
  // `connectRemainingComponents`, `generateConnections`, stays a pure safety net for the
  // degenerate cases this can't reach, not the routine mechanism).
  const points = bridsonSample(
    rng, mapSize, mapSize, poissonMinDistance, poissonKCandidates, padding, totalSystems, grid,
    regions.map((r) => ({ x: r.x, y: r.y })),
    densityRadiusExponent,
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
  isCrossing: boolean,
): void {
  connections.push({ fromSystemIndex: aIndex, toSystemIndex: bIndex, fuelCost, isCrossing });
  connections.push({ fromSystemIndex: bIndex, toSystemIndex: aIndex, fuelCost, isCrossing });
}

/** The subset of `GenParams` corridor realisation needs — kept small so fixture tests don't have
 *  to construct a full `GenParams` (shape knobs, map size, etc.) just to exercise this phase. */
type CorridorRealisationParams = Pick<
  GenParams, "intraRegionBaseFuel" | "crossingFuelMultiplier" | "poissonMinDistance"
>;

/** The system in `candidates` nearest world point (targetX, targetY) — the corridor-anchoring
 *  rule (judgement call, not spec-mandated): each side's corridor endpoint is whichever placed
 *  system in that cluster reaches furthest toward the OTHER cluster's seed. `candidates` must be
 *  non-empty. */
function nearestSystemTowardSeed(
  candidates: GeneratedSystem[],
  targetX: number,
  targetY: number,
): GeneratedSystem {
  let best = candidates[0];
  let bestDist = distance(best.x, best.y, targetX, targetY);
  for (let i = 1; i < candidates.length; i++) {
    const d = distance(candidates[i].x, candidates[i].y, targetX, targetY);
    if (d < bestDist) {
      bestDist = d;
      best = candidates[i];
    }
  }
  return best;
}

/** How far (world units) a system may sit from the direct seed-to-seed line and still count as a
 *  band waypoint — a multiple of the Poisson minimum distance so it scales with the galaxy's own
 *  spacing, Gate-A-sweepable like the rest of §5's tuning constants. Judgement call: a fixed
 *  multiplier of the placement radius, independent of `density-field.ts`'s own (private) band
 *  width — the two need not agree; this one only decides which ALREADY-PLACED systems get pulled
 *  into the chain, not where band density gets raised. */
const BAND_WAYPOINT_MAX_PERP_DISTANCE_MULTIPLE = 3;

/** Normalised projection of (px, py) onto the line through (ax, ay) and (bx, by): 0 at the first
 *  point, 1 at the second, negative/greater-than-1 beyond either end. Degenerate (coincident)
 *  line reads every point as 0. */
function projectOntoLine(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  return lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
}

/**
 * Placed systems, from the WHOLE galaxy (judgement call, and a necessary one: restricting the
 * pool to the corridor's own two clusters was tried first and rejected — a region's own second-
 * best candidate is, by construction, always on the far side of its anchor from the corridor
 * (closer to its own seed), never between the two anchors, so a same-cluster-only pool can never
 * populate a multi-stop chain; real waypoint stars a band's raised density places overwhelmingly
 * fall inside a DIFFERENT cluster's Voronoi cell than either endpoint — exactly what spec §5 flags
 * as possible), that sit near the direct seed-to-seed line and strictly between the two anchors'
 * OWN projected positions (`tLow`/`tHigh`, not a hardcoded [0,1] — the nearest-facing anchor rule
 * does not guarantee an anchor sits exactly at its cluster's seed) — the sparse chain of waypoint
 * stars a band-style corridor's raised density placed (`paintCorridorBands`'s band strip,
 * `lib/engine/density-field.ts`). The "no lane outside the plan" guarantee still holds: this only
 * ever links a waypoint into THIS pair's own chain, never opens a lane belonging to some other
 * corridor.
 */
function waypointsAlongCorridor(
  candidateSystems: GeneratedSystem[],
  ax: number, ay: number, bx: number, by: number,
  excludeIndices: Set<number>,
  maxPerpDistance: number,
  tLow: number,
  tHigh: number,
): GeneratedSystem[] {
  const dx = bx - ax;
  const dy = by - ay;
  const result: GeneratedSystem[] = [];

  for (const s of candidateSystems) {
    if (excludeIndices.has(s.index)) continue;
    const t = projectOntoLine(s.x, s.y, ax, ay, bx, by);
    if (t <= tLow || t >= tHigh) continue; // strictly between the two anchors, never beyond either
    const px = ax + t * dx;
    const py = ay + t * dy;
    if (distance(s.x, s.y, px, py) > maxPerpDistance) continue;
    result.push(s);
  }

  return result;
}

/**
 * Realise one chosen cluster-seed pair (spec §5) as actual lanes. A crossing-style pair becomes a
 * single lane, at the crossing multiplier, between the two systems nearest-facing each other's
 * cluster. A band-style pair chains through whatever waypoint stars the band placed, at intra
 * rates, in corridor order (anchorA, waypoints and anchorB all sorted by their own projection
 * along the seed-to-seed line — the nearest-facing anchor rule does not guarantee anchorA/anchorB
 * sit at the chain's extreme ends, so the whole chain is sorted together rather than assuming
 * it) — when the band placed zero waypoint systems (a low-density knob set can do this), the chain
 * is just [anchorA, anchorB]: a direct lane, the same fallback the crossing style always uses,
 * needing no special case. `isGateway` marks exactly the two anchors — "the system at each end
 * where a corridor meets a cluster" (spec §5) — never an interior waypoint. A cluster with no
 * placed systems on either side anchors nothing and is skipped: there is nothing there to connect
 * (§8's `connectRemainingComponents` repairs any resulting stranding at the whole-graph level).
 */
function realizeCorridorPair(
  pair: CorridorPlan["pairs"][number],
  systemsByRegion: Map<number, GeneratedSystem[]>,
  allSystems: GeneratedSystem[],
  regions: GeneratedRegion[],
  avgIntraDist: number,
  params: CorridorRealisationParams,
  connections: GeneratedConnection[],
): void {
  const sysA = systemsByRegion.get(pair.a) ?? [];
  const sysB = systemsByRegion.get(pair.b) ?? [];
  if (sysA.length === 0 || sysB.length === 0) return;

  const seedA = regions[pair.a];
  const seedB = regions[pair.b];
  const anchorA = nearestSystemTowardSeed(sysA, seedB.x, seedB.y);
  const anchorB = nearestSystemTowardSeed(sysB, seedA.x, seedA.y);

  anchorA.isGateway = true;
  anchorB.isGateway = true;

  if (pair.style === "crossing") {
    pushLane(
      connections, anchorA.index, anchorB.index,
      laneFuelCost(
        distance(anchorA.x, anchorA.y, anchorB.x, anchorB.y),
        avgIntraDist, params.intraRegionBaseFuel, params.crossingFuelMultiplier,
      ),
      true,
    );
    return;
  }

  const anchorAT = projectOntoLine(anchorA.x, anchorA.y, seedA.x, seedA.y, seedB.x, seedB.y);
  const anchorBT = projectOntoLine(anchorB.x, anchorB.y, seedA.x, seedA.y, seedB.x, seedB.y);
  const waypoints = waypointsAlongCorridor(
    allSystems, seedA.x, seedA.y, seedB.x, seedB.y,
    new Set([anchorA.index, anchorB.index]),
    params.poissonMinDistance * BAND_WAYPOINT_MAX_PERP_DISTANCE_MULTIPLE,
    Math.min(anchorAT, anchorBT), Math.max(anchorAT, anchorBT),
  );

  const chain = [anchorA, anchorB, ...waypoints].sort(
    (p, q) =>
      projectOntoLine(p.x, p.y, seedA.x, seedA.y, seedB.x, seedB.y)
      - projectOntoLine(q.x, q.y, seedA.x, seedA.y, seedB.x, seedB.y),
  );
  for (let i = 0; i < chain.length - 1; i++) {
    pushLane(
      connections, chain[i].index, chain[i + 1].index,
      laneFuelCost(
        distance(chain[i].x, chain[i].y, chain[i + 1].x, chain[i + 1].y),
        avgIntraDist, params.intraRegionBaseFuel, 1,
      ),
      false,
    );
  }
}

/**
 * Realise every chosen corridor (spec §5): clones `systems` (so callers keep their own,
 * unflagged copy — mirrors the old gateway-designation phase this replaces), marks each
 * corridor's two anchors `isGateway`, and returns the lanes each pair added.
 */
export function realizeCorridors(
  systems: GeneratedSystem[],
  regions: GeneratedRegion[],
  corridors: CorridorPlan,
  avgIntraDist: number,
  params: CorridorRealisationParams,
): { connections: GeneratedConnection[]; systems: GeneratedSystem[] } {
  const updatedSystems = systems.map((s) => ({ ...s }));
  const systemsByRegion = new Map<number, GeneratedSystem[]>();
  for (const sys of updatedSystems) {
    const list = systemsByRegion.get(sys.regionIndex);
    if (list) list.push(sys);
    else systemsByRegion.set(sys.regionIndex, [sys]);
  }

  const connections: GeneratedConnection[] = [];
  for (const pair of corridors.pairs) {
    realizeCorridorPair(pair, systemsByRegion, updatedSystems, regions, avgIntraDist, params, connections);
  }

  return { connections, systems: updatedSystems };
}

/**
 * Last-resort connectivity repair: corridor realisation can strand a whole branch of clusters
 * when a corridor's anchor region rolled zero placed systems (spec-flagged failure mode, §5) —
 * every individual cluster stays internally connected, but the branch beyond the empty one never
 * gets a lane in. `generateSystems` seeding a system at every cluster center (spec §5's
 * connectivity requirement) is expected to make this path routinely unreachable — this function is
 * a pure safety net, never the mechanism connectivity is supposed to run through; its return value
 * (repair lanes added) is exactly what lets a test prove that, rather than inferring it indirectly.
 * Union-finds the graph built so far; for every extra component beyond the first, adds one direct
 * lane to the globally nearest system outside that component (an MST over components, not a
 * planned corridor) and repeats until one component remains. Priced at the crossing rate — an
 * unplanned trans-void link is not a cheap intra hop — but never marked `isGateway`: it is not a
 * plan-authored corridor endpoint. Mutates `connections` in place.
 */
function connectRemainingComponents(
  systems: GeneratedSystem[],
  connections: GeneratedConnection[],
  avgIntraDist: number,
  params: CorridorRealisationParams,
): number {
  if (systems.length < 2) return 0;

  const posByIndex = new Map<number, number>();
  systems.forEach((s, pos) => posByIndex.set(s.index, pos));

  const uf = new UnionFind(systems.length);
  for (const c of connections) {
    const posA = posByIndex.get(c.fromSystemIndex);
    const posB = posByIndex.get(c.toSystemIndex);
    if (posA === undefined || posB === undefined) continue;
    uf.union(posA, posB);
  }

  let repairLaneCount = 0;
  for (;;) {
    const root = uf.find(0);
    const stranded: number[] = [];
    for (let pos = 0; pos < systems.length; pos++) {
      if (uf.find(pos) !== root) stranded.push(pos);
    }
    if (stranded.length === 0) return repairLaneCount;

    const compRoot = uf.find(stranded[0]);
    const compPositions = stranded.filter((pos) => uf.find(pos) === compRoot);

    let bestFrom = compPositions[0];
    let bestTo = -1;
    let bestDist = Infinity;
    for (const from of compPositions) {
      for (let to = 0; to < systems.length; to++) {
        if (uf.find(to) === compRoot) continue; // still-stranded — pick a bridge OUT of this component
        const d = distance(systems[from].x, systems[from].y, systems[to].x, systems[to].y);
        if (d < bestDist) {
          bestDist = d;
          bestFrom = from;
          bestTo = to;
        }
      }
    }

    pushLane(
      connections, systems[bestFrom].index, systems[bestTo].index,
      laneFuelCost(bestDist, avgIntraDist, params.intraRegionBaseFuel, params.crossingFuelMultiplier),
      false,
    );
    uf.union(bestFrom, bestTo);
    repairLaneCount++;
  }
}

export function generateConnections(
  rng: RNG,
  systems: GeneratedSystem[],
  regions: GeneratedRegion[],
  corridors: CorridorPlan,
  params: GenParams,
): { connections: GeneratedConnection[]; systems: GeneratedSystem[]; repairLaneCount: number } {
  const { extraEdgeFraction, intraRegionBaseFuel } = params;
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

  // ── Phase 1: Intra-cluster connections (per-region MST + extra edges) ──
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

  // ── Phase 2: Corridor realisation (spec §5) — replaces the old region-centre MST + gateway
  // crossing phases entirely; between-cluster lanes now exist ONLY along the plan's corridors. ──
  const { connections: corridorConnections, systems: updatedSystems } = realizeCorridors(
    systems, regions, corridors, avgIntraDist, params,
  );
  connections.push(...corridorConnections);

  // ── Phase 3: Connectivity repair (rare) ──
  const repairLaneCount = connectRemainingComponents(updatedSystems, connections, avgIntraDist, params);

  return { connections, systems: updatedSystems, repairLaneCount };
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

  // Map-size/spacing scale levers (New Game "Map size"/"Star spacing") apply once, here, before
  // padding, shape authoring or placement read either quantity — every later phase reads the
  // scaled values off `effectiveParams`, never the raw config-derived ones. 1/1 reproduces
  // `params.mapSize`/`params.poissonMinDistance` exactly (the back-compat pin).
  const effectiveMapSize = params.mapSize * params.mapSizeScale;
  const effectiveParams: GenParams = {
    ...params,
    mapSize: effectiveMapSize,
    poissonMinDistance: params.poissonMinDistance * params.minDistanceScale,
  };

  // The galaxy shape (density grid, cluster seeds, corridor plan) is authored once, up front, off
  // the same draw sequence every other generation step shares — region and system placement both
  // read its output, never re-derive structure of their own (density-field.ts's authoring model).
  const shape = buildGalaxyShape(params.shapeKnobs, effectiveMapSize, rng);

  const regions = generateRegions(shape.seeds, names);
  const rawSystems = generateSystems(rng, regions, effectiveParams, shape.grid);
  const { connections, systems } = generateConnections(
    rng, rawSystems, regions, shape.corridors, effectiveParams,
  );

  const factions = generateFactions(rng, systems, {
    minorFactionCount: params.minorFactionCount,
    mapSize: effectiveMapSize,
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
