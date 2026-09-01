/**
 * Pure maths behind the galaxy-preview canvas (spec `docs/planned/logistics-lanes.md` §5): builds
 * one galaxy's density grid + star placement from structure knobs, and rasterises the density grid
 * into an RGBA byte array a canvas can paint directly. No DOM/canvas API anywhere in this module —
 * it is exercised in node tests, with `galaxy-preview.tsx` supplying the actual `<canvas>` element
 * and `ImageData` wrapper.
 *
 * Placement parity: `buildGalaxyImpression` reproduces exactly the draw sequence
 * `generateUniverse` runs before it starts consuming substrate RNG draws — `mulberry32(seed)` →
 * `buildGalaxyShape` → `bridsonSample` seeded by the cluster centers — so the star positions this
 * renders are byte-identical to the ones `generateWorld` would place for the same
 * `{ knobs, seed, systemCount }`. Deliberately does NOT import `lib/engine/universe-gen.ts`: that
 * module's import graph reaches `lib/constants/economy-scale` through the homeworld-prefab/industry
 * chain, which must never load on the main thread (AGENTS gotcha) — this renders in the New Game
 * dialog, not the worker. `bridsonSample` lives in `lib/engine/system-placement.ts` precisely so
 * this module can reach it without that graph.
 */

import { genConfigForSystemCount } from "@/lib/constants/universe-gen";
import { mulberry32 } from "@/lib/engine/generation-primitives";
import { buildGalaxyShape, type GalaxyShape, type GalaxyShapeKnobs } from "@/lib/engine/density-field";
import { bridsonSample } from "@/lib/engine/system-placement";

export interface Point {
  x: number;
  y: number;
}

/** One authored galaxy impression: the shape (density grid, cluster seeds, corridor plan) plus the
 *  star positions real placement would put there, in placement order. */
export interface GalaxyImpression {
  shape: GalaxyShape;
  /** Side length of the square map these coordinates are authored over. */
  mapSize: number;
  points: Point[];
}

/**
 * Author one galaxy impression from structure knobs + seed + system count — the same draw sequence
 * `generateUniverse` runs for the galaxy-shape and placement phases (see module docstring). Pure and
 * deterministic: identical inputs always produce a byte-identical result.
 */
export function buildGalaxyImpression(
  knobs: GalaxyShapeKnobs,
  seed: number,
  systemCount: number,
): GalaxyImpression {
  const config = genConfigForSystemCount(systemCount);
  const mapSize = config.MAP_SIZE;
  const padding = mapSize * config.MAP_PADDING;

  const rng = mulberry32(seed);
  const shape = buildGalaxyShape(knobs, mapSize, rng);
  const points = bridsonSample(
    rng,
    mapSize,
    mapSize,
    config.POISSON_MIN_DISTANCE,
    config.POISSON_K_CANDIDATES,
    padding,
    config.TOTAL_SYSTEMS,
    shape.grid,
    shape.seeds.map((s) => ({ x: s.x, y: s.y })),
  );

  return { shape, mapSize, points };
}

// ── Rasterisation ────────────────────────────────────────────────

/** Background at zero density — the Foundry `background` token (`#0e1117`). */
const FIELD_LOW = [14, 17, 23] as const;
/** Peak-density luminance — the Foundry `surface-active` token (`#242a33`): a subtle steel
 *  highlight, never bright enough to compete with the star dots painted over it. */
const FIELD_HIGH = [36, 42, 51] as const;

/**
 * Rasterise a density grid into an RGBA byte array (`ImageData`-compatible: `width * height * 4`
 * bytes, row-major, no premultiplication) sized to the requested pixel dimensions — nearest-cell
 * sampling, since the grid (128×128, `DENSITY_GRID_RESOLUTION`) is coarser than any reasonable
 * preview canvas and interpolation would just blur an already-smoothed field. Density lerps
 * linearly from `FIELD_LOW` (void) to `FIELD_HIGH` (cluster core) — "density as subtle luminance"
 * (spec §5's preview brief), never a saturated color, so star dots painted on top stay legible.
 */
export function renderDensityField(
  grid: GalaxyShape["grid"],
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const bytes = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const { resolution, cells } = grid;

  for (let py = 0; py < height; py++) {
    const row = Math.min(resolution - 1, Math.floor((py / height) * resolution));
    for (let px = 0; px < width; px++) {
      const col = Math.min(resolution - 1, Math.floor((px / width) * resolution));
      const density = cells[row * resolution + col];
      const i = (py * width + px) * 4;
      bytes[i] = FIELD_LOW[0] + (FIELD_HIGH[0] - FIELD_LOW[0]) * density;
      bytes[i + 1] = FIELD_LOW[1] + (FIELD_HIGH[1] - FIELD_LOW[1]) * density;
      bytes[i + 2] = FIELD_LOW[2] + (FIELD_HIGH[2] - FIELD_LOW[2]) * density;
      bytes[i + 3] = 255;
    }
  }

  return bytes;
}

/** Project a world-space coordinate (authored over `mapSize` × `mapSize`) onto a `canvasWidth` ×
 *  `canvasHeight` pixel canvas. Shared by dot placement and corridor-line endpoints so both read
 *  off the same projection. */
export function worldToCanvas(
  x: number,
  y: number,
  mapSize: number,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  return { x: (x / mapSize) * canvasWidth, y: (y / mapSize) * canvasHeight };
}
