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
import { distance, kruskalMST, type RNG } from "./generation-primitives";

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
  /** Fraction of corridor pairs realised as a single crossing lane rather than a waypoint band. */
  corridorStyle: number;
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

  return centers.map((c) => ({
    x: c.x,
    y: c.y,
    size: rollClusterSize(rng, sizeSkew, mapSize),
    stretch: STRETCH_MIN + rng() * (STRETCH_MAX - STRETCH_MIN),
    angle: rng() * Math.PI * 2,
  }));
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
  return edge * edge;
}

/**
 * Build the coarse density grid: cell density is the strongest nearby seed's influence (islands of
 * density, emptiness as the complement), decorated by a large-scale warp layer (edge roughening,
 * occasional cluster merging) and a small-scale texture layer, then floored — any cell below
 * `voidFloor` reads exactly 0, true void rather than merely sparse. Waypoint-band corridors
 * (`corridors.pairs` entries with `style: "band"`) then raise a thin strip of cells along their
 * seed-to-seed line to just above `voidFloor` — so system placement can follow it as a sparse
 * chain of waypoint stars — capped low relative to cluster cores so it reads as a chain, not
 * another cluster. Crossing-style pairs are deliberately grid-silent: their "mark" is the
 * `CorridorPlan` entry itself, realised directly as a single long lane, not a placement trail.
 */
function buildDensityGrid(
  seeds: ClusterSeed[],
  corridors: CorridorPlan,
  knobs: GalaxyShapeKnobs,
  mapSize: number,
  rng: RNG,
): DensityGrid {
  const resolution = DENSITY_GRID_RESOLUTION;
  const cellWorldSize = mapSize / resolution;
  const largeNoise = buildNoiseLattice(rng, LARGE_NOISE_LATTICE);
  const smallNoise = buildNoiseLattice(rng, SMALL_NOISE_LATTICE);
  const cells = new Array<number>(resolution * resolution);
  const bandHalfWidth = BAND_HALF_WIDTH_CELLS * cellWorldSize;
  const bandLevel = Math.min(knobs.voidFloor + BAND_ABOVE_FLOOR_MARGIN, BAND_DENSITY_CEILING);
  const bandSegments = corridors.pairs
    .filter((pair) => pair.style === "band")
    .map((pair) => ({
      ax: seeds[pair.a].x, ay: seeds[pair.a].y, bx: seeds[pair.b].x, by: seeds[pair.b].y,
    }));

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
 * Choose which cluster-seed pairs connect: an MST over the seeds (`kruskalMST`,
 * `lib/engine/generation-primitives.ts`) guarantees every seed reachable, then `corridorsPerCluster`
 * extra pairs (nearest-first, beyond the MST) add route variety — mirrors the intra-region
 * extra-edge shape already used for lanes. Each pair's style rolls against `corridorStyle`
 * (fraction realised as a crossing lane vs a waypoint band); the band write into the density grid
 * happens in `buildDensityGrid` above, while lane rendering is a downstream connection-graph
 * concern this module never touches.
 */
function planCorridors(seeds: ClusterSeed[], knobs: GalaxyShapeKnobs, rng: RNG): CorridorPlan {
  if (seeds.length < 2) return { pairs: [] };

  const mst = kruskalMST(seeds);
  const styleFor = (): "band" | "crossing" => (rng() < knobs.corridorStyle ? "crossing" : "band");

  const pairs: CorridorPlan["pairs"] = mst.map((edge) => ({
    a: edge.a,
    b: edge.b,
    style: styleFor(),
  }));

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
      pairs.push({ a: candidates[k].a, b: candidates[k].b, style: styleFor() });
    }
  }

  return { pairs };
}

// ── Top-level entry point ───────────────────────────────────────

/**
 * Author one galaxy's shape from structure knobs: place cluster seeds, plan which seed pairs
 * corridors connect, then derive the density grid — seed influence plus noise, with band-style
 * corridors additionally raising their own strip of cells (§5: the grid is fully authored by this
 * function; system placement consumes it purely by reading cell density, never by re-deriving
 * structure). Pure and deterministic: identical `knobs` + `mapSize` + an `rng` at the same draw
 * position always produce a byte-identical result.
 */
export function buildGalaxyShape(knobs: GalaxyShapeKnobs, mapSize: number, rng: RNG): GalaxyShape {
  const seeds = placeClusterSeeds(rng, knobs, mapSize);
  const corridors = planCorridors(seeds, knobs, rng);
  const grid = buildDensityGrid(seeds, corridors, knobs, mapSize, rng);
  return { grid, seeds, corridors };
}
