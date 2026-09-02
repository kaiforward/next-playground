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
import {
  distance, mulberry32, kruskalMST, relativeNeighbourhoodGraphEdges, UnionFind, type RNG, type Edge,
} from "./generation-primitives";
import {
  buildGalaxyShape, crossingShouldDemote, crossingDemotionThresholds,
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
  /** The extent every coordinate in `systems`/`regions` was actually placed over —
   *  `GenParams.mapSize × GenParams.mapSizeScale`, not the raw config value. The single source of
   *  truth for the map's extent: `world.meta.mapSize` is written from this, and every consumer that
   *  divides a coordinate by the map extent (tile bounds, the Voronoi cache) reads it from there. */
  mapSize: number;
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
  /** Fraction (0–1) of the local-lane graph's CYCLE edges — edges whose removal keeps every system
   *  in its cluster connected, never a bridge — to prune, longest-first, after the neighbourhood-
   *  graph criterion selects the base graph (spec §5A). Formerly `INTRA_REGION_EXTRA_EDGES`/
   *  `extraEdgeFraction`, which added random extra edges on top of an MST; repurposed rather than
   *  retired because the shape (a density knob on top of a structurally-connected graph) still
   *  applies, just in the opposite direction — the neighbourhood graph already supplies more lanes
   *  than the old MST did, so this now trims rather than adds. Default 0: measured relative-
   *  neighbourhood-graph density already lands in the ~1.3–1.6 lanes/system target band (spec §5A)
   *  without pruning; Gate-A may raise it if the shipped default reads too dense. */
  lanePruneFraction: number;
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
 * Prunes a `pruneFraction` (0–1) share of `edges`' CYCLE edges — never a bridge — from a graph
 * already known connected over `pointCount` local-index points (spec §5A: the neighbourhood-graph
 * criterion already guarantees this before pruning ever runs). A spanning tree is picked by
 * replaying Kruskal's algorithm (nearest-first) over exactly this edge set — not a fresh MST over
 * all possible pairs, which could pick an edge this graph never offered — and every edge Kruskal
 * accepts is a tree edge, kept unconditionally; every edge it rejects (would have closed a cycle)
 * is prunable. Longest-first pruning: the longest cycle edges are the least-useful shortcuts, so
 * they go first, deterministically (no `rng` draw — same edge set always prunes the same way).
 */
function pruneLaneDensity(edges: Edge[], pointCount: number, pruneFraction: number): Edge[] {
  if (pruneFraction <= 0 || edges.length === 0) return edges;
  const byDistAscending = [...edges].sort((a, b) => a.dist - b.dist);
  const uf = new UnionFind(pointCount);
  const treeEdges: Edge[] = [];
  const cycleEdges: Edge[] = []; // collected in ascending-distance order
  for (const e of byDistAscending) {
    if (uf.union(e.a, e.b)) treeEdges.push(e);
    else cycleEdges.push(e);
  }
  const pruneCount = Math.floor(cycleEdges.length * Math.min(1, Math.max(0, pruneFraction)));
  const kept = pruneCount === 0 ? cycleEdges : cycleEdges.slice(0, cycleEdges.length - pruneCount);
  return [...treeEdges, ...kept];
}

/**
 * True iff segment (ax1,ay1)-(ax2,ay2) and segment (bx1,by1)-(bx2,by2) cross at a point interior
 * to BOTH segments — an exact orientation test (Cormen et al.'s standard four-orientation check),
 * not a distance heuristic. Sharing an endpoint (including sharing a system) is never a proper
 * crossing: two lanes fanning out from the same star are not "crossing lanes" in the visual sense
 * the map cares about, only a lane cutting across another lane's open middle is. Used ONLY by
 * `wouldCrossAcceptedLane` below — the per-cluster and per-corridor neighbourhood graphs are each
 * individually planar (spec §5A/§5B), but planarity is a per-graph guarantee, not a cross-graph
 * one: two DIFFERENT corridors' band chains can still cross each other (measured: rare, but real —
 * the PROOF intersection instrument found one at clusterCount=100).
 */
function segmentsProperlyIntersect(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number,
): boolean {
  const EPS = 1e-9;
  const sameSystem = (px: number, py: number, qx: number, qy: number): boolean =>
    Math.abs(px - qx) < EPS && Math.abs(py - qy) < EPS;
  if (
    sameSystem(ax1, ay1, bx1, by1) || sameSystem(ax1, ay1, bx2, by2)
    || sameSystem(ax2, ay2, bx1, by1) || sameSystem(ax2, ay2, bx2, by2)
  ) return false;

  const orientation = (ox: number, oy: number, px: number, py: number, qx: number, qy: number): number => {
    const val = (py - oy) * (qx - px) - (px - ox) * (qy - py);
    if (Math.abs(val) < EPS) return 0;
    return val > 0 ? 1 : -1;
  };

  const o1 = orientation(ax1, ay1, ax2, ay2, bx1, by1);
  const o2 = orientation(ax1, ay1, ax2, ay2, bx2, by2);
  const o3 = orientation(bx1, by1, bx2, by2, ax1, ay1);
  const o4 = orientation(bx1, by1, bx2, by2, ax2, ay2);

  // Collinear/touching cases (any orientation exactly 0) are deliberately excluded rather than
  // resolved by an on-segment check: with shared systems already ruled out above, a zero
  // orientation here means one segment's line merely grazes the other's endpoint or overlaps
  // collinearly — never the "cuts across the open middle" shape the map report describes.
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

/** One accepted lane's endpoints, as the crossing check reads them. */
interface LaneSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * Every accepted lane, bucketed by the coarse grid cells its bounding box covers, so the crossing
 * check reads only lanes that could actually reach the candidate rather than every lane accepted so
 * far. A lane whose box spans more cells than `LANE_INDEX_MAX_CELLS` goes into `overflow` instead of
 * being smeared across hundreds of buckets — those are always scanned, and there are very few of
 * them (a corridor spanning a large fraction of the map).
 */
interface AcceptedLaneIndex {
  cellSize: number;
  buckets: Map<string, LaneSegment[]>;
  overflow: LaneSegment[];
}

/** Cells a lane's bounding box may cover before it is filed as overflow instead. */
const LANE_INDEX_MAX_CELLS = 256;

/** Bucket side, as a multiple of the galaxy's own Poisson minimum distance — a few typical hops, so
 *  an ordinary lane lands in a handful of buckets and a query reads a handful of lanes. */
const LANE_INDEX_CELL_MULTIPLE = 4;

function newLaneIndex(poissonMinDistance: number): AcceptedLaneIndex {
  return {
    cellSize: Math.max(poissonMinDistance * LANE_INDEX_CELL_MULTIPLE, 1e-6),
    buckets: new Map(),
    overflow: [],
  };
}

/** The grid cells (inclusive column/row ranges) a segment's bounding box covers. */
function laneCellRange(
  index: AcceptedLaneIndex, ax: number, ay: number, bx: number, by: number,
): { colLo: number; colHi: number; rowLo: number; rowHi: number; cells: number } {
  const colLo = Math.floor(Math.min(ax, bx) / index.cellSize);
  const colHi = Math.floor(Math.max(ax, bx) / index.cellSize);
  const rowLo = Math.floor(Math.min(ay, by) / index.cellSize);
  const rowHi = Math.floor(Math.max(ay, by) / index.cellSize);
  return { colLo, colHi, rowLo, rowHi, cells: (colHi - colLo + 1) * (rowHi - rowLo + 1) };
}

function addAcceptedLane(
  index: AcceptedLaneIndex, ax: number, ay: number, bx: number, by: number,
): void {
  const segment: LaneSegment = { ax, ay, bx, by };
  const range = laneCellRange(index, ax, ay, bx, by);
  if (range.cells > LANE_INDEX_MAX_CELLS) {
    index.overflow.push(segment);
    return;
  }
  for (let row = range.rowLo; row <= range.rowHi; row++) {
    for (let col = range.colLo; col <= range.colHi; col++) {
      const key = `${col}:${row}`;
      const bucket = index.buckets.get(key);
      if (bucket) bucket.push(segment);
      else index.buckets.set(key, [segment]);
    }
  }
}

/**
 * True iff the candidate lane (ax,ay)-(bx,by) properly crosses any lane already accepted into
 * `index` (each undirected lane recorded once — `pushLane` writes both directed rows but the index
 * holds one segment). Only `realizeBandChain`'s CYCLE edges (beyond its own chain's spanning tree)
 * are ever checked against this — a chain's tree edges are its own required connectivity (never
 * gated, same rule Phase 1's neighbourhood graph and every other lane-selection path already follow)
 * and every OTHER lane-selection path (Phase 1 intra-cluster, a crossing-style single lane) is
 * empirically safe without this check (the PROOF intersection instrument measured zero
 * intra×anything and crossing×anything crossings across every sampled seed) — only two different
 * corridors' band chains, which the per-graph planarity guarantee says nothing about each other, can
 * cross. Two segments can only properly intersect where their bounding boxes overlap, so reading
 * just the candidate's own cells (plus the overflow list) is exact, not an approximation.
 */
function wouldCrossAcceptedLane(
  ax: number, ay: number, bx: number, by: number,
  index: AcceptedLaneIndex,
): boolean {
  for (const s of index.overflow) {
    if (segmentsProperlyIntersect(ax, ay, bx, by, s.ax, s.ay, s.bx, s.by)) return true;
  }

  const range = laneCellRange(index, ax, ay, bx, by);
  const checked = new Set<LaneSegment>();
  for (let row = range.rowLo; row <= range.rowHi; row++) {
    for (let col = range.colLo; col <= range.colHi; col++) {
      const bucket = index.buckets.get(`${col}:${row}`);
      if (!bucket) continue;
      for (const s of bucket) {
        if (checked.has(s)) continue;
        checked.add(s);
        if (segmentsProperlyIntersect(ax, ay, bx, by, s.ax, s.ay, s.bx, s.by)) return true;
      }
    }
  }
  return false;
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

/** Canonical key for an undirected system pair — the identity the duplicate-lane guard below
 *  dedupes on, independent of which direction a phase happens to realise the lane in. */
function laneKey(aIndex: number, bIndex: number): string {
  return aIndex < bIndex ? `${aIndex}-${bIndex}` : `${bIndex}-${aIndex}`;
}

/** What corridor realisation has already accepted: which system pairs carry a lane, and where those
 *  lanes run. Threaded through the whole pass so both the duplicate-pair guard and the crossing
 *  check read the same ledger. */
interface AcceptedLanes {
  pairs: Set<string>;
  index: AcceptedLaneIndex;
}

/**
 * `pushLane` guarded against realising a system pair that already carries a lane, recording the
 * lane's geometry for the crossing check as it goes. A band chain draws waypoints from the WHOLE
 * galaxy, so a waypoint is routinely already a Phase 1 intra-cluster neighbour of the anchor it
 * chains to — pushing again would leave one physical lane holding four directed rows, which every
 * per-row consumer (border lengths, relations' lane census) reads as two lanes.
 */
function pushLaneOnce(
  connections: GeneratedConnection[],
  accepted: AcceptedLanes,
  from: GeneratedSystem,
  to: GeneratedSystem,
  fuelCost: number,
  isCrossing: boolean,
): void {
  const key = laneKey(from.index, to.index);
  if (accepted.pairs.has(key)) return;
  accepted.pairs.add(key);
  addAcceptedLane(accepted.index, from.x, from.y, to.x, to.y);
  pushLane(connections, from.index, to.index, fuelCost, isCrossing);
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
 * Realises a band-style corridor's own lanes: the neighbourhood-graph criterion (spec §5A) over
 * exactly {anchorA, anchorB, waypoints} — planar and MST-containing over that set, so anchorA and
 * anchorB always end up connected (through the waypoints when there are any, directly when there
 * are none — no separate direct-lane fallback needed, a 2-point set has no third point to fail
 * either empty-region test). A per-graph planarity guarantee says nothing about two DIFFERENT
 * corridors' band chains crossing EACH OTHER (measured rare but real), so this chain's own
 * connectivity is built by a planarity-AWARE Kruskal replay: an edge that would join two still-
 * separate components is drawn immediately when it doesn't cross an already-accepted (foreign)
 * lane, deferred when it does (tried again only once nothing better is left, and accepted then only
 * if the chain would otherwise stay disconnected — a genuine two-corridor conflict with no
 * alternative route), and any edge left over once the chain is fully connected (pure route-variety
 * redundancy) is dropped outright on ANY crossing, never forced. Every edge realises at the intra
 * rate; `isGateway` is the caller's job (marks only the two anchors, never an interior waypoint).
 */
function realizeBandChain(
  anchorA: GeneratedSystem,
  anchorB: GeneratedSystem,
  waypoints: GeneratedSystem[],
  avgIntraDist: number,
  params: CorridorRealisationParams,
  connections: GeneratedConnection[],
  accepted: AcceptedLanes,
): void {
  const chainSystems = [anchorA, anchorB, ...waypoints];
  const edges = relativeNeighbourhoodGraphEdges(chainSystems);
  const byDistAscending = [...edges].sort((a, b) => a.dist - b.dist);
  const crosses = (edge: Edge): boolean => {
    const from = chainSystems[edge.a];
    const to = chainSystems[edge.b];
    return wouldCrossAcceptedLane(from.x, from.y, to.x, to.y, accepted.index);
  };

  // A planarity-aware Kruskal replay: Pass 1 builds the chain's spanning tree preferring edges
  // that DON'T cross an already-accepted (foreign, different-corridor) lane, deferring any that do
  // — so connectivity between two components routes around a conflict whenever this chain's own
  // edge set offers an alternative. Pass 2 only spends a deferred (crossing) edge when nothing else
  // in Pass 1 already joined the same two components — a genuine two-corridor conflict with no
  // alternative route, accepted rather than leaving the chain disconnected. Every edge neither pass
  // needed for connectivity is pure route-variety cycle redundancy, dropped on ANY crossing.
  const uf = new UnionFind(chainSystems.length);
  const drawn: Edge[] = [];
  const deferred: Edge[] = [];
  const cycleCandidates: Edge[] = [];
  for (const e of byDistAscending) {
    if (uf.connected(e.a, e.b)) {
      cycleCandidates.push(e);
      continue;
    }
    if (crosses(e)) {
      deferred.push(e);
      continue;
    }
    uf.union(e.a, e.b);
    drawn.push(e);
  }
  for (const e of deferred) {
    if (uf.connected(e.a, e.b)) {
      cycleCandidates.push(e); // no longer needed once Pass 1 connected it another way
      continue;
    }
    uf.union(e.a, e.b); // genuinely required — no crossing-free alternative existed
    drawn.push(e);
  }

  const realize = (edge: Edge): void => {
    const from = chainSystems[edge.a];
    const to = chainSystems[edge.b];
    pushLaneOnce(
      connections, accepted, from, to,
      laneFuelCost(edge.dist, avgIntraDist, params.intraRegionBaseFuel, 1),
      false,
    );
  };

  for (const edge of drawn) realize(edge);
  for (const edge of cycleCandidates) {
    if (crosses(edge)) continue;
    realize(edge);
  }
}

/**
 * Realise one chosen cluster-seed pair (spec §5) as actual lanes. A crossing-style pair becomes a
 * single lane, at the crossing multiplier, between the two systems nearest-facing each other's
 * cluster — UNLESS the realised anchor-to-anchor line no longer reads as genuine emptiness
 * (`crossingShouldDemote`, spec §5C: the line clips band-raised/populated grid beyond tolerance,
 * or runs close to some third placed system), in which case it demotes to band-style realisation
 * using the same waypoint chain a planned band pair would. A band-style pair (or a demoted
 * crossing) chains through whatever waypoint stars the corridor's band placed, via
 * `realizeBandChain` — when the band placed zero waypoint systems (a low-density knob set can do
 * this), that chain degrades to the direct anchor-to-anchor lane on its own (spec §5A: no third
 * point, no special case needed). `isGateway` marks exactly the two anchors — "the system at each
 * end where a corridor meets a cluster" (spec §5) — never an interior waypoint. A cluster with no
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
  grid: DensityGrid,
  mapSize: number,
  accepted: AcceptedLanes,
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

  const anchorAT = projectOntoLine(anchorA.x, anchorA.y, seedA.x, seedA.y, seedB.x, seedB.y);
  const anchorBT = projectOntoLine(anchorB.x, anchorB.y, seedA.x, seedA.y, seedB.x, seedB.y);
  const waypoints = waypointsAlongCorridor(
    allSystems, seedA.x, seedA.y, seedB.x, seedB.y,
    new Set([anchorA.index, anchorB.index]),
    params.poissonMinDistance * BAND_WAYPOINT_MAX_PERP_DISTANCE_MULTIPLE,
    Math.min(anchorAT, anchorBT), Math.max(anchorAT, anchorBT),
  );

  if (pair.style === "crossing") {
    const thirdSystems = allSystems.filter((s) => s.index !== anchorA.index && s.index !== anchorB.index);
    const demoted = crossingShouldDemote(
      grid, mapSize, anchorA.x, anchorA.y, anchorB.x, anchorB.y,
      thirdSystems, crossingDemotionThresholds(params.poissonMinDistance),
    );
    if (!demoted) {
      pushLaneOnce(
        connections, accepted, anchorA, anchorB,
        laneFuelCost(
          distance(anchorA.x, anchorA.y, anchorB.x, anchorB.y),
          avgIntraDist, params.intraRegionBaseFuel, params.crossingFuelMultiplier,
        ),
        true,
      );
      return;
    }
  }

  realizeBandChain(anchorA, anchorB, waypoints, avgIntraDist, params, connections, accepted);
}

/**
 * Realise every chosen corridor (spec §5): clones `systems` (so callers keep their own,
 * unflagged copy — mirrors the old gateway-designation phase this replaces), marks each
 * corridor's two anchors `isGateway`, and returns the lanes each pair added. `grid`/`mapSize` are
 * the fully-painted post-corridor density field the crossing-demotion check reads (spec §5C).
 * `existingConnections` (default none — every direct/fixture caller keeps today's isolated
 * behaviour) seeds two things over Phase 1's already-placed intra-cluster lanes, without those
 * lanes being duplicated into this call's own returned `connections`: the ONLY crossing-rejection
 * check remaining (`wouldCrossAcceptedLane`, run solely against a band chain's own cycle edges,
 * `realizeBandChain`), and the duplicate-pair guard (`pushLaneOnce`) that keeps a band chain from
 * re-realising a pair Phase 1 already drew. Everywhere else, the neighbourhood-graph criterion is planar and
 * MST-containing over each corridor's own {anchorA, anchorB, waypoints} set on its own — no
 * crossing check needed against other lanes.
 */
export function realizeCorridors(
  systems: GeneratedSystem[],
  regions: GeneratedRegion[],
  corridors: CorridorPlan,
  avgIntraDist: number,
  params: CorridorRealisationParams,
  grid: DensityGrid,
  mapSize: number,
  existingConnections: GeneratedConnection[] = [],
): { connections: GeneratedConnection[]; systems: GeneratedSystem[] } {
  const updatedSystems = systems.map((s) => ({ ...s }));
  const systemsByRegion = new Map<number, GeneratedSystem[]>();
  for (const sys of updatedSystems) {
    const list = systemsByRegion.get(sys.regionIndex);
    if (list) list.push(sys);
    else systemsByRegion.set(sys.regionIndex, [sys]);
  }
  const coordByIndex = new Map(updatedSystems.map((s) => [s.index, { x: s.x, y: s.y }]));

  const connections: GeneratedConnection[] = [...existingConnections];
  const startLength = connections.length;
  // Seeded from the caller's already-realised lanes so a corridor never re-realises a pair Phase 1
  // already drew and every band chain sees Phase 1's geometry, then grown as this pass accepts
  // lanes of its own.
  const accepted: AcceptedLanes = { pairs: new Set(), index: newLaneIndex(params.poissonMinDistance) };
  for (const c of existingConnections) {
    const key = laneKey(c.fromSystemIndex, c.toSystemIndex);
    if (accepted.pairs.has(key)) continue;
    accepted.pairs.add(key);
    const p = coordByIndex.get(c.fromSystemIndex);
    const q = coordByIndex.get(c.toSystemIndex);
    if (p && q) addAcceptedLane(accepted.index, p.x, p.y, q.x, q.y);
  }

  for (const pair of corridors.pairs) {
    realizeCorridorPair(
      pair, systemsByRegion, updatedSystems, regions, avgIntraDist, params, connections, grid, mapSize,
      accepted,
    );
  }

  return { connections: connections.slice(startLength), systems: updatedSystems };
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
  systems: GeneratedSystem[],
  regions: GeneratedRegion[],
  corridors: CorridorPlan,
  params: GenParams,
  grid: DensityGrid,
  mapSize: number,
): { connections: GeneratedConnection[]; systems: GeneratedSystem[]; repairLaneCount: number } {
  const { lanePruneFraction, intraRegionBaseFuel } = params;
  const connections: GeneratedConnection[] = [];

  // Group systems by region
  const regionSystems: Map<number, GeneratedSystem[]> = new Map();
  for (const region of regions) {
    regionSystems.set(region.index, []);
  }
  for (const sys of systems) {
    regionSystems.get(sys.regionIndex)!.push(sys);
  }

  // Compute average intra-region distance for fuel normalisation (replaces the old fixed
  // systemScatterRadius divisor) — the MST's own average hop is still the right "typical hop"
  // proxy for normalisation, independent of which edges Phase 1 actually realises as lanes.
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

  // ── Phase 1: Intra-cluster connections — the neighbourhood-graph criterion (spec §5A) replaces
  // the old per-region MST + random extra edges entirely. The relative-neighbourhood graph is
  // planar (no two of its own edges ever cross) and provably contains the Euclidean MST (so every
  // cluster with ≥ 2 systems stays connected) — no separate MST pass, no crossing-rejection gate,
  // no `rng` draw. `lanePruneFraction` (formerly `INTRA_REGION_EXTRA_EDGES`/`extraEdgeFraction`,
  // repurposed) optionally trims surplus cycle edges afterward; default 0 (measured graph density
  // already lands in the target band, see the field's own docstring). ──
  for (const [, regionSys] of regionSystems) {
    if (regionSys.length < 2) continue;

    const edges = pruneLaneDensity(relativeNeighbourhoodGraphEdges(regionSys), regionSys.length, lanePruneFraction);
    for (const edge of edges) {
      pushLane(
        connections,
        regionSys[edge.a].index,
        regionSys[edge.b].index,
        laneFuelCost(edge.dist, avgIntraDist, intraRegionBaseFuel, 1),
        false,
      );
    }
  }

  // ── Phase 2: Corridor realisation (spec §5) — replaces the old region-centre MST + gateway
  // crossing phases entirely; between-cluster lanes now exist ONLY along the plan's corridors. ──
  const { connections: corridorConnections, systems: updatedSystems } = realizeCorridors(
    systems, regions, corridors, avgIntraDist, params, grid, mapSize, connections,
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
    rawSystems, regions, shape.corridors, effectiveParams, shape.grid, effectiveMapSize,
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
    mapSize: effectiveMapSize,
    regions,
    systems,
    connections,
    factions,
    systemFactionAssignments,
    playerFactionIndex,
  };
}
