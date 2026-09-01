/**
 * Galaxy-shape authoring engine (spec `docs/planned/logistics-lanes.md` §5): a coarse density grid
 * over the map, the cluster seeds that author it, and the corridor plan connecting those seeds.
 * Pure — no fs/process.env/Date.now/Math.random, and no import that reaches
 * `lib/constants/economy-scale` (the preview surface renders this on the main thread,
 * `client/worker/boot.ts` — kept reachable only via the dependency-free `generation-primitives.ts`,
 * never via `universe-gen.ts`, whose import graph reaches `economy-scale` through the homeworld
 * prefab/industry chain). System placement consumes the density grid; lane realisation consumes
 * the corridor plan's style marks; this module consumes nothing.
 *
 * Authoring model: noise never authors the map — placed, countable objects do. Cluster seeds are
 * the placed objects (position, size, ellipse shape); the density grid is their strongest-influence
 * footprint under distance falloff; two noise layers only roughen edges and add texture on top.
 */

import { genConfigForSystemCount } from "@/lib/constants/universe-gen";
import { distance, kruskalMST, mulberry32, type RNG } from "./generation-primitives";

// ── Output types ────────────────────────────────────────────────

/** Structure knobs authoring one galaxy's shape (New Game preview surface, spec §5). */
export interface GalaxyShapeKnobs {
  /** Number of cluster seeds to place. */
  clusterCount: number;
  /** 0 = every cluster rolls the same size; higher skews toward a few large, many small. */
  sizeSkew: number;
  /** Minimum distance enforced between two cluster seed centers. */
  clusterSpacing: number;
  /** Density-grid cells below this value become true void (exactly 0). */
  voidFloor: number;
  /** Extra corridor pairs beyond the connectivity-guaranteeing MST, per cluster seed. */
  corridorsPerCluster: number;
  /** Bias, 0–1, on the void-fraction threshold that decides whether a corridor pair's measured
   *  seed-to-seed line reads as a crossing (mostly true void — the wormhole case) or a band (mostly
   *  populated). 0 pins every pair to band regardless of what the line measures; 1 pins every pair
   *  to crossing; between the extremes it lowers (toward 1) or raises (toward 0) how void a line
   *  must read to tip into crossing — see `corridorStyleFor` in `density-field.ts`. */
  corridorStyle: number;
  /** How wildly per-cluster peak density swings between clusters, 0–1: 0 = every cluster's peak
   *  density multiplier is exactly 1 (uniform peaks); higher values dampen some clusters toward
   *  diffuse while others stay full. Rolled from a stream derived from each seed's own placement,
   *  never the main `rng` draw sequence — so this can never perturb cluster positions, corridor
   *  planning, or grid noise (see `rollPeakMultiplier` below). */
  clusterTurbulence: number;
}

/** One placed cluster: an elliptical density footprint at (x, y). */
export interface ClusterSeed {
  x: number;
  y: number;
  /** Influence radius along the seed's un-stretched axis. */
  size: number;
  /** Ellipse elongation factor along the seed's oriented axis (1 = circular). */
  stretch: number;
  /** Ellipse orientation, radians. */
  angle: number;
  /** Peak-density multiplier rolled by `clusterTurbulence` — 1 when turbulence is 0, dampened
   *  toward 0 for a seed the turbulence roll disfavours. */
  peakMultiplier: number;
}

/** Coarse density field over the map: a flat, JSON-serialisable row-major array of 0–1 values. */
export interface DensityGrid {
  /** Cells per side — the grid is `resolution` × `resolution`. */
  resolution: number;
  /** Row-major flat array, length `resolution * resolution`. */
  cells: number[];
}

/** Which cluster-seed pairs connect, and how each connection is realised as an actual lane. */
export interface CorridorPlan {
  pairs: Array<{ a: number; b: number; style: "band" | "crossing" }>;
}

export interface GalaxyShape {
  grid: DensityGrid;
  seeds: ClusterSeed[];
  corridors: CorridorPlan;
}

// ── Tuning constants (proposals — Gate A owner-eyeball settles the shipped defaults) ────

/** Cells per side of the authored density grid — coarse by design, consumed only by placement. */
const DENSITY_GRID_RESOLUTION = 128;

/** Rejection-sampling placement mirrors `generateRegions`' padding fraction. */
const SEED_PLACEMENT_PADDING_FRACTION = 0.1;

/** Rejection sampling attempts before falling back to grid-jitter (mirrors `generateRegions`). */
const MAX_PLACEMENT_ATTEMPTS = 500;

/** Cluster seed influence radius, as a fraction of map size, at the narrow/wide ends of the roll. */
const MIN_SEED_SIZE_FRACTION = 0.04;
const MAX_SEED_SIZE_FRACTION = 0.14;

/** `rollClusterSize`'s skew-to-power scale: sizeSkew 0 → power 1 (uniform), 1 → power 5. */
const SKEW_POWER_SCALE = 4;

/** Ellipse stretch roll bounds (1 = circular). */
const STRETCH_MIN = 1;
const STRETCH_MAX = 2.2;

/** Large-scale warp noise: lattice resolution and its multiplicative effect on seed edge radius. */
const LARGE_NOISE_LATTICE = 9;
const LARGE_NOISE_AMPLITUDE = 0.35;

/** Small-scale texture noise: lattice resolution and its additive effect on cell density. */
const SMALL_NOISE_LATTICE = 33;
const SMALL_NOISE_AMPLITUDE = 0.12;

/**
 * Waypoint-band corridor density sits `BAND_ABOVE_FLOOR_MARGIN` above whichever `voidFloor` the
 * knobs set (never a fixed absolute — a high void floor must not silently erase the band), capped
 * at `BAND_DENSITY_CEILING` so it stays low relative to cluster cores — "a thin raised-density band
 * (a sparse chain of waypoint stars)" (spec §5). Both Gate-A-sweepable, like the noise/skew
 * constants above.
 */
const BAND_ABOVE_FLOOR_MARGIN = 0.1;
const BAND_DENSITY_CEILING = 0.5;

/** Band half-width, in grid cells either side of the seed-to-seed line. Gate-A-sweepable. */
const BAND_HALF_WIDTH_CELLS = 1.5;

// ── Knob defaults ────────────────────────────────────────────────

/**
 * Shape-knob defaults for a given system count, derived the same way region count is today
 * (`genConfigForSystemCount` / `interpolateBySqrtN`, `lib/constants/universe-gen.ts`).
 */
export function defaultGalaxyShapeKnobs(systemCount: number): GalaxyShapeKnobs {
  const config = genConfigForSystemCount(systemCount);
  return {
    clusterCount: config.CLUSTER_COUNT,
    sizeSkew: config.CLUSTER_SIZE_SKEW,
    clusterSpacing: config.CLUSTER_SPACING,
    voidFloor: config.VOID_FLOOR,
    corridorsPerCluster: config.CORRIDORS_PER_CLUSTER,
    corridorStyle: config.CORRIDOR_STYLE_MIX,
    clusterTurbulence: config.CLUSTER_TURBULENCE,
  };
}

// ── Cluster seed placement ──────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

/**
 * Roll one cluster's influence-radius size from a skewed distribution: `rng()` raised to a power
 * derived from `sizeSkew` biases draws toward the low end, so most rolls come out small and only
 * occasional draws reach the large end — "a few big, many small" (spec §5), not uniform.
 */
function rollClusterSize(rng: RNG, sizeSkew: number, mapSize: number): number {
  const minSize = mapSize * MIN_SEED_SIZE_FRACTION;
  const maxSize = mapSize * MAX_SEED_SIZE_FRACTION;
  const power = 1 + Math.max(0, sizeSkew) * SKEW_POWER_SCALE;
  const t = Math.pow(rng(), power);
  return minSize + t * (maxSize - minSize);
}

/**
 * Place `knobs.clusterCount` seed centers by rejection sampling (minimum `clusterSpacing` apart),
 * falling back to grid-jitter placement when rejection sampling can't find room — mirrors
 * `generateRegions`' two-phase placement (`lib/engine/universe-gen.ts`) so a degenerate knob set
 * (spacing too large for the map, or a single cluster) still yields every requested seed rather
 * than crashing or silently placing fewer.
 */
function placeClusterSeeds(rng: RNG, knobs: GalaxyShapeKnobs, mapSize: number): ClusterSeed[] {
  const { clusterCount, sizeSkew, clusterSpacing } = knobs;
  const padding = mapSize * SEED_PLACEMENT_PADDING_FRACTION;
  const centers: Point[] = [];

  for (let i = 0; i < clusterCount; i++) {
    let placed = false;

    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
      const x = padding + rng() * (mapSize - 2 * padding);
      const y = padding + rng() * (mapSize - 2 * padding);
      const tooClose = centers.some((c) => distance(x, y, c.x, c.y) < clusterSpacing);
      if (tooClose) continue;

      centers.push({ x, y });
      placed = true;
      break;
    }

    if (!placed) {
      const cols = Math.max(1, Math.ceil(Math.sqrt(clusterCount)));
      const cellSize = (mapSize - 2 * padding) / cols;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = padding + col * cellSize + cellSize / 2 + (rng() - 0.5) * cellSize * 0.3;
      const y = padding + row * cellSize + cellSize / 2 + (rng() - 0.5) * cellSize * 0.3;
      centers.push({ x, y });
    }
  }

  return centers.map((c, index) => {
    const x = c.x;
    const y = c.y;
    return {
      x,
      y,
      size: rollClusterSize(rng, sizeSkew, mapSize),
      stretch: STRETCH_MIN + rng() * (STRETCH_MAX - STRETCH_MIN),
      angle: rng() * Math.PI * 2,
      peakMultiplier: rollPeakMultiplier(x, y, index, knobs.clusterTurbulence),
    };
  });
}

/**
 * Roll one seed's peak-density multiplier from a stream seeded by a deterministic mix of that
 * seed's own already-rolled position and its index — never a draw from the main `rng` passed into
 * `buildGalaxyShape`, so consuming this stream cannot shift where the main stream's next draw
 * lands (placement, corridor planning, and grid noise all read the main stream at the same
 * position regardless of `turbulence`). `1 - turbulence * roll` (roll in [0, 1)): at turbulence 0
 * the multiplier is exactly 1 for every seed, since the roll is multiplied away; higher turbulence
 * dampens some seeds toward diffuse while others (a low roll) stay close to full.
 */
function rollPeakMultiplier(x: number, y: number, index: number, turbulence: number): number {
  const mix =
    Math.imul(Math.round(x) ^ index, 0x9e3779b1) ^
    Math.imul(Math.round(y) ^ (index * 0x1000193), 0x85ebca6b) ^
    Math.imul(index + 1, 0xc2b2ae35);
  const roll = mulberry32(mix | 0)();
  return 1 - Math.max(0, turbulence) * roll;
}

// ── Density grid ─────────────────────────────────────────────────

/** Build an `size` × `size` lattice of `rng()` values in [-1, 1), sampled by `sampleLattice`. */
function buildNoiseLattice(rng: RNG, size: number): number[] {
  const lattice = new Array<number>(size * size);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng() * 2 - 1;
  return lattice;
}

/** Bilinearly sample a noise lattice at normalised coordinates `u`, `v` in [0, 1]. */
function sampleLattice(lattice: number[], size: number, u: number, v: number): number {
  const fx = u * (size - 1);
  const fy = v * (size - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = lattice[y0 * size + x0];
  const v10 = lattice[y0 * size + x1];
  const v01 = lattice[y1 * size + x0];
  const v11 = lattice[y1 * size + x1];
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Shortest distance from point (px, py) to the segment (ax, ay)–(bx, by). */
function pointSegmentDistance(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return distance(px, py, ax + t * dx, ay + t * dy);
}

/**
 * One seed's density contribution at world point (wx, wy): the point is rotated into the seed's
 * oriented ellipse frame, `warp` (the large-scale noise layer) scales the effective edge radius so
 * cluster edges bulge/shrink and occasionally merge neighbours, and density falls off quadratically
 * to exactly 0 at the ellipse's edge.
 */
function seedInfluence(seed: ClusterSeed, wx: number, wy: number, warp: number): number {
  const dx = wx - seed.x;
  const dy = wy - seed.y;
  const cosA = Math.cos(-seed.angle);
  const sinA = Math.sin(-seed.angle);
  const rx = dx * cosA - dy * sinA;
  const ry = dx * sinA + dy * cosA;
  const effectiveSize = Math.max(seed.size * warp, 1e-6);
  const d = Math.sqrt(rx * rx + (ry / seed.stretch) * (ry / seed.stretch)) / effectiveSize;
  if (d >= 1) return 0;
  const edge = 1 - d;
  return edge * edge * seed.peakMultiplier;
}

/**
 * Build the coarse BASE density grid — seed influence plus noise, floored — with no corridor
 * awareness at all: cell density is the strongest nearby seed's influence (islands of density,
 * emptiness as the complement), decorated by a large-scale warp layer (edge roughening, occasional
 * cluster merging) and a small-scale texture layer, then floored — any cell below `voidFloor` reads
 * exactly 0, true void rather than merely sparse. This is the grid `planCorridors` measures each
 * pair's seed-to-seed line against (`corridorStyleFor` below) — style must read the world as it
 * would exist with no corridors yet, not a grid corridors have already painted themselves onto.
 */
function buildBaseDensityGrid(
  seeds: ClusterSeed[],
  knobs: GalaxyShapeKnobs,
  mapSize: number,
  rng: RNG,
): DensityGrid {
  const resolution = DENSITY_GRID_RESOLUTION;
  const cellWorldSize = mapSize / resolution;
  const largeNoise = buildNoiseLattice(rng, LARGE_NOISE_LATTICE);
  const smallNoise = buildNoiseLattice(rng, SMALL_NOISE_LATTICE);
  const cells = new Array<number>(resolution * resolution);

  for (let row = 0; row < resolution; row++) {
    const v = resolution > 1 ? row / (resolution - 1) : 0;
    for (let col = 0; col < resolution; col++) {
      const u = resolution > 1 ? col / (resolution - 1) : 0;
      const wx = (col + 0.5) * cellWorldSize;
      const wy = (row + 0.5) * cellWorldSize;

      const warp = 1 + LARGE_NOISE_AMPLITUDE * sampleLattice(largeNoise, LARGE_NOISE_LATTICE, u, v);

      let density = 0;
      for (const seed of seeds) {
        const influence = seedInfluence(seed, wx, wy, warp);
        if (influence > density) density = influence;
      }

      density += SMALL_NOISE_AMPLITUDE * sampleLattice(smallNoise, SMALL_NOISE_LATTICE, u, v);
      density = clamp01(density);
      if (density < knobs.voidFloor) density = 0;

      cells[row * resolution + col] = density;
    }
  }

  return { resolution, cells };
}

/**
 * Raise a thin strip of cells to just above `voidFloor` along every band-style corridor's
 * seed-to-seed line — so system placement can follow it as a sparse chain of waypoint stars —
 * capped low relative to cluster cores so it reads as a chain, not another cluster. Crossing-style
 * pairs are deliberately grid-silent: their "mark" is the `CorridorPlan` entry itself, realised
 * directly as a single long lane, not a placement trail. Returns the input grid unchanged (no copy)
 * when there is nothing to paint.
 */
function paintCorridorBands(
  baseGrid: DensityGrid,
  seeds: ClusterSeed[],
  corridors: CorridorPlan,
  knobs: GalaxyShapeKnobs,
  mapSize: number,
): DensityGrid {
  const bandSegments = corridors.pairs
    .filter((pair) => pair.style === "band")
    .map((pair) => ({
      ax: seeds[pair.a].x, ay: seeds[pair.a].y, bx: seeds[pair.b].x, by: seeds[pair.b].y,
    }));
  if (bandSegments.length === 0) return baseGrid;

  const { resolution } = baseGrid;
  const cellWorldSize = mapSize / resolution;
  const bandHalfWidth = BAND_HALF_WIDTH_CELLS * cellWorldSize;
  const bandLevel = Math.min(knobs.voidFloor + BAND_ABOVE_FLOOR_MARGIN, BAND_DENSITY_CEILING);
  const cells = baseGrid.cells.slice();

  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const wx = (col + 0.5) * cellWorldSize;
      const wy = (row + 0.5) * cellWorldSize;
      let density = cells[row * resolution + col];

      for (const segment of bandSegments) {
        if (pointSegmentDistance(wx, wy, segment.ax, segment.ay, segment.bx, segment.by) <= bandHalfWidth) {
          density = Math.max(density, bandLevel);
        }
      }

      cells[row * resolution + col] = density;
    }
  }

  return { resolution, cells };
}

// ── Corridor planning ────────────────────────────────────────────

function edgeKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

/**
 * Sample count for `sampleSegmentVoidFraction`: at least `MIN_STYLE_SAMPLES` regardless of length
 * (short corridors still get a stable read), scaling up with segment length so a long corridor
 * gets roughly one sample per grid cell it crosses, capped at `MAX_STYLE_SAMPLES` so a galaxy-
 * spanning pair doesn't blow the sampling budget for a decision that only needs to be roughly
 * right. Judgement call — the spec leaves the exact sample count open.
 */
const MIN_STYLE_SAMPLES = 20;
const MAX_STYLE_SAMPLES = 200;

/**
 * Fraction of `sampleCount` evenly-spaced points along the (ax,ay)-(bx,by) segment that land on a
 * true-void cell (density exactly 0) in `grid`. Reads the grid as-is — callers are responsible for
 * passing the pre-corridor base grid when the reading must reflect the world before any corridor
 * has painted itself onto it.
 */
function sampleSegmentVoidFraction(
  grid: DensityGrid, mapSize: number, ax: number, ay: number, bx: number, by: number,
): number {
  const { resolution, cells } = grid;
  const cellWorldSize = mapSize / resolution;
  const segmentLength = distance(ax, ay, bx, by);
  const sampleCount = Math.min(
    MAX_STYLE_SAMPLES,
    Math.max(MIN_STYLE_SAMPLES, Math.ceil(segmentLength / cellWorldSize)),
  );

  let voidCount = 0;
  for (let i = 0; i < sampleCount; i++) {
    const t = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    const wx = ax + (bx - ax) * t;
    const wy = ay + (by - ay) * t;
    const col = Math.min(resolution - 1, Math.max(0, Math.floor((wx / mapSize) * resolution)));
    const row = Math.min(resolution - 1, Math.max(0, Math.floor((wy / mapSize) * resolution)));
    if (cells[row * resolution + col] === 0) voidCount++;
  }

  return voidCount / sampleCount;
}

/**
 * Decide one pair's style by measuring its seed-to-seed line against the base grid, not by rolling
 * against `corridorStyle` — a mostly-void line (the wormhole case) reads as a crossing, a
 * mostly-populated one reads as a band. `corridorStyle` biases the void-fraction threshold a
 * borderline line must clear: threshold = `1 - corridorStyle`. The extremes are pinned absolutely,
 * independent of what the line measures (spec-required: 0 never crosses, 1 always crosses) rather
 * than left to fall out of the threshold arithmetic at the boundary, which is the more legible
 * shape for an invariant the tests hold to exactly.
 */
function corridorStyleFor(voidFraction: number, corridorStyle: number): "band" | "crossing" {
  if (corridorStyle >= 1) return "crossing";
  if (corridorStyle <= 0) return "band";
  const threshold = 1 - corridorStyle;
  return voidFraction >= threshold ? "crossing" : "band";
}

/**
 * An extra corridor departing within this many radians of an already-accepted corridor at the same
 * cluster is suppressed (fan/near-parallel doubles read as noise, not route variety) — ~20°,
 * judgement call, the spec leaves the exact angle open.
 */
const FAN_SUPPRESSION_ANGLE_RAD = (20 * Math.PI) / 180;

/** Minimal angular difference between two headings (radians), always in [0, PI]. */
function angularDiff(a: number, b: number): number {
  let diff = Math.abs(a - b) % (Math.PI * 2);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  return diff;
}

/**
 * Choose which cluster-seed pairs connect: an MST over the seeds (`kruskalMST`,
 * `lib/engine/generation-primitives.ts`) guarantees every seed reachable and is never suppressed
 * (connectivity), then `corridorsPerCluster` extra pairs (nearest-first, beyond the MST) add route
 * variety — mirrors the intra-region extra-edge shape already used for lanes, except an extra is
 * dropped when it departs within `FAN_SUPPRESSION_ANGLE_RAD` of a corridor (MST or an already-
 * accepted extra) already leaving one of its two endpoint clusters — kills near-parallel doubles
 * and fans without touching connectivity. No backfill: a suppressed candidate is simply not
 * replaced by the next-nearest one, so the realised extra count can come in under
 * `corridorsPerCluster`'s target when a cluster's neighbourhood is already covered. Every pair's
 * style is measured against the base density grid (`corridorStyleFor`); the band write into the
 * density grid happens in `paintCorridorBands`, while lane rendering is a downstream
 * connection-graph concern this module never touches. Fully deterministic — no `rng` draws.
 */
function planCorridors(seeds: ClusterSeed[], knobs: GalaxyShapeKnobs, baseGrid: DensityGrid, mapSize: number): CorridorPlan {
  if (seeds.length < 2) return { pairs: [] };

  const styleForPair = (a: number, b: number): "band" | "crossing" => {
    const voidFraction = sampleSegmentVoidFraction(baseGrid, mapSize, seeds[a].x, seeds[a].y, seeds[b].x, seeds[b].y);
    return corridorStyleFor(voidFraction, knobs.corridorStyle);
  };

  // Departure headings (radians) of every accepted corridor at each cluster, MST first — extras
  // are checked against this set and add to it only when accepted.
  const departureAngles = new Map<number, number[]>();
  const recordDeparture = (a: number, b: number): void => {
    const angleAtA = Math.atan2(seeds[b].y - seeds[a].y, seeds[b].x - seeds[a].x);
    const angleAtB = Math.atan2(seeds[a].y - seeds[b].y, seeds[a].x - seeds[b].x);
    for (const [cluster, angle] of [[a, angleAtA], [b, angleAtB]] as const) {
      const existing = departureAngles.get(cluster);
      if (existing) existing.push(angle);
      else departureAngles.set(cluster, [angle]);
    }
  };

  const mst = kruskalMST(seeds);
  const pairs: CorridorPlan["pairs"] = mst.map((edge) => {
    recordDeparture(edge.a, edge.b);
    return { a: edge.a, b: edge.b, style: styleForPair(edge.a, edge.b) };
  });

  const extraCount = Math.round(seeds.length * Math.max(0, knobs.corridorsPerCluster));
  if (extraCount > 0) {
    const inMst = new Set(mst.map((e) => edgeKey(e.a, e.b)));
    const candidates: Array<{ a: number; b: number; dist: number }> = [];
    for (let i = 0; i < seeds.length; i++) {
      for (let j = i + 1; j < seeds.length; j++) {
        if (inMst.has(edgeKey(i, j))) continue;
        candidates.push({
          a: i,
          b: j,
          dist: distance(seeds[i].x, seeds[i].y, seeds[j].x, seeds[j].y),
        });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    for (let k = 0; k < Math.min(extraCount, candidates.length); k++) {
      const { a, b } = candidates[k];
      const angleAtA = Math.atan2(seeds[b].y - seeds[a].y, seeds[b].x - seeds[a].x);
      const angleAtB = Math.atan2(seeds[a].y - seeds[b].y, seeds[a].x - seeds[b].x);
      const fansAtA = (departureAngles.get(a) ?? []).some((existing) => angularDiff(existing, angleAtA) < FAN_SUPPRESSION_ANGLE_RAD);
      const fansAtB = (departureAngles.get(b) ?? []).some((existing) => angularDiff(existing, angleAtB) < FAN_SUPPRESSION_ANGLE_RAD);
      if (fansAtA || fansAtB) continue;

      recordDeparture(a, b);
      pairs.push({ a, b, style: styleForPair(a, b) });
    }
  }

  return { pairs };
}

// ── Top-level entry point ───────────────────────────────────────

/**
 * Author one galaxy's shape from structure knobs: place cluster seeds, build the base density grid
 * (seed influence plus noise, no corridor awareness), plan which seed pairs corridors connect —
 * each pair's style measured against that base grid — then raise band-style corridors' own strip of
 * cells on top (§5: the grid is fully authored by this function; system placement consumes it
 * purely by reading cell density, never by re-deriving structure). Corridor planning itself draws
 * nothing from `rng` — style is measured, not rolled — so only seed placement and the two base-grid
 * noise lattices consume the stream. Pure and deterministic: identical `knobs` + `mapSize` + an
 * `rng` at the same draw position always produce a byte-identical result.
 */
export function buildGalaxyShape(knobs: GalaxyShapeKnobs, mapSize: number, rng: RNG): GalaxyShape {
  const seeds = placeClusterSeeds(rng, knobs, mapSize);
  const baseGrid = buildBaseDensityGrid(seeds, knobs, mapSize, rng);
  const corridors = planCorridors(seeds, knobs, baseGrid, mapSize);
  const grid = paintCorridorBands(baseGrid, seeds, corridors, knobs, mapSize);
  return { grid, seeds, corridors };
}
