/**
 * System-placement engine: cluster-seed naming (region rows), density-aware Poisson-disk
 * scattering (Bridson's algorithm, variable radius), and Voronoi region assignment. Pure — no
 * fs/process.env/Date.now/Math.random, and no import that reaches `lib/constants/economy-scale`
 * (the galaxy-preview surface renders this on the main thread, `client/worker/boot.ts`). Extracted
 * out of `universe-gen.ts` (which re-exports everything here for its existing callers) because that
 * module's import graph reaches `economy-scale` through the homeworld prefab/industry chain —
 * `bridsonSample`/`assignRegions`/`generateRegions` themselves never needed any of that, only the
 * substrate generation `universe-gen.ts` interleaves around them.
 */

import { distance, type RNG } from "./generation-primitives";
import type { ClusterSeed, DensityGrid } from "./density-field";

// ── Output types ────────────────────────────────────────────────

export interface GeneratedRegion {
  index: number;
  name: string;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

// ── Region naming ────────────────────────────────────────────────

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
export const DENSITY_RADIUS_EXPONENT = 0.05;

function radiusFromDensity(
  density: number,
  baseMinDistance: number,
  exponent: number,
): number {
  const raw = baseMinDistance / Math.pow(density, exponent);
  return Math.min(Math.max(raw, baseMinDistance), baseMinDistance * MAX_DENSITY_RADIUS_MULTIPLIER);
}

/**
 * Bridson's algorithm for Poisson disk sampling, variable-radius variant: the local minimum
 * distance at each point comes from `grid`'s density there instead of one fixed value, so placement
 * runs tight inside clusters, sparse along corridor bands, and never lands in a true-void cell
 * (`densityAt` reading exactly 0). Multi-seeded (`initialSeedAttempts`) so growth reaches every
 * density island, not just the one the first random point happens to land in. `clusterSeedPoints`
 * (default none — every other caller of this function is a raw-grid unit test with no cluster
 * structure of its own) are placed FIRST, before the random seeding phase: a cluster seed's own
 * center is where its density is highest, so this is expected to always succeed — the guarantee
 * this exists for is "every cluster gets at least one placed system," which corridor realisation
 * (`realizeCorridorPair`, spec §5) depends on to anchor every planned corridor without falling back
 * to the whole-graph repair pass. Consumes no RNG draws of its own (`tryAddPoint` is pure geometry),
 * so it does not shift what `rng()` returns to the random phases that follow — only how many of
 * their draws land, which output already varies by seed.
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
  clusterSeedPoints: Point[] = [],
  densityRadiusExponent: number = DENSITY_RADIUS_EXPONENT,
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
    const r = radiusFromDensity(density, baseMinDistance, densityRadiusExponent);
    if (tooClose(x, y, r)) return null;

    const idx = points.length;
    points.push({ x, y });
    radii.push(r);
    accel[accelIndex(x, y)] = idx;
    return idx;
  }

  // Phase 0: guarantee every cluster seed places at least one system, at (or as near as the
  // density/bounds checks allow to) its own center — before any random point exists, so this can
  // only ever be blocked by two cluster seeds sitting closer together than their own placement
  // radius (a degenerate knob configuration) or a seed sitting exactly on the padding boundary.
  for (const sp of clusterSeedPoints) {
    if (points.length >= maxPoints) break;
    const idx = tryAddPoint(sp.x, sp.y);
    if (idx !== null) active.push(idx);
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
