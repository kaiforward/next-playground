import { describe, it, expect } from "vitest";
import { buildGalaxyImpression, crossingSegments, renderDensityField, worldToCanvas } from "../galaxy-impression";
import { genConfigForSystemCount } from "@/lib/constants/universe-gen";
import { mulberry32 } from "@/lib/engine/generation-primitives";
import { buildGalaxyShape, type GalaxyShapeKnobs } from "@/lib/engine/density-field";
import { bridsonSample } from "@/lib/engine/system-placement";

function knobs(overrides: Partial<GalaxyShapeKnobs> = {}): GalaxyShapeKnobs {
  return {
    clusterCount: 8,
    sizeSkew: 0.6,
    clusterSpacing: 400,
    voidFloor: 0.08,
    corridorsPerCluster: 0.3,
    corridorStyle: 0.5,
    clusterTurbulence: 0,
    ...overrides,
  };
}

describe("buildGalaxyImpression", () => {
  it("renders an identical impression twice for the same inputs", () => {
    const a = buildGalaxyImpression(knobs(), 42, 300);
    const b = buildGalaxyImpression(knobs(), 42, 300);
    expect(a.mapSize).toBe(b.mapSize);
    expect(a.shape.grid.cells).toEqual(b.shape.grid.cells);
    expect(a.shape.seeds).toEqual(b.shape.seeds);
    expect(a.points).toEqual(b.points);
  });

  // NOT the determinism-seam parity proof — this hand-reconstructs buildGalaxyImpression's OWN
  // steps (same module agreeing with itself), so it only pins internal self-consistency: it would
  // catch this module's own maths silently reordering, but a drift in the REAL engine's
  // orchestration (an rng draw generateUniverse inserts, GenParams-derived padding diverging from
  // genConfigForSystemCount, etc.) would sail through untouched. The authoritative cross-check
  // against the real `generateUniverse` orchestration lives in
  // `lib/engine/__tests__/galaxy-preview-parity.test.ts` (a node test, so it can import
  // `universe-gen.ts` freely — that module's economy-scale import graph only matters for the
  // browser bundle this preview itself renders in).
  it("reconstructs the same points as its own internal step sequence (self-consistency pin, not engine parity)", () => {
    const seed = 7;
    const systemCount = 250;
    const impression = buildGalaxyImpression(knobs(), seed, systemCount);

    // The internal path buildGalaxyImpression runs: mulberry32(seed) -> buildGalaxyShape ->
    // bridsonSample seeded by cluster centers, off genConfigForSystemCount's derived params.
    const config = genConfigForSystemCount(systemCount);
    const rng = mulberry32(seed);
    const shape = buildGalaxyShape(knobs(), config.MAP_SIZE, rng);
    const points = bridsonSample(
      rng,
      config.MAP_SIZE,
      config.MAP_SIZE,
      config.POISSON_MIN_DISTANCE,
      config.POISSON_K_CANDIDATES,
      config.MAP_SIZE * config.MAP_PADDING,
      config.TOTAL_SYSTEMS,
      shape.grid,
      shape.seeds.map((s) => ({ x: s.x, y: s.y })),
    );

    expect(impression.points).toEqual(points);
    expect(impression.shape.seeds).toEqual(shape.seeds);
    expect(impression.shape.grid.cells).toEqual(shape.grid.cells);
  });

  it("renders without crashing at extreme knobs (void floor 1.0, single cluster)", () => {
    const extreme = knobs({ voidFloor: 1.0, clusterCount: 1 });
    expect(() => buildGalaxyImpression(extreme, 1, 200)).not.toThrow();
    const impression = buildGalaxyImpression(extreme, 1, 200);
    expect(impression.shape.grid.cells.length).toBe(
      impression.shape.grid.resolution * impression.shape.grid.resolution,
    );
    expect(Array.isArray(impression.points)).toBe(true);
  });

  it("with the override omitted, produces a byte-identical impression to an explicit mapSizeScale of 1 — the parity default", () => {
    const omitted = buildGalaxyImpression(knobs(), 42, 300);
    const explicitDefault = buildGalaxyImpression(knobs(), 42, 300, { mapSizeScale: 1 });
    expect(omitted.mapSize).toBe(explicitDefault.mapSize);
    expect(omitted.shape.grid.cells).toEqual(explicitDefault.shape.grid.cells);
    expect(omitted.points).toEqual(explicitDefault.points);
  });

  it("scales the effective map extent by mapSizeScale, before shape authoring and placement read it", () => {
    const config = genConfigForSystemCount(300);
    const scaled = buildGalaxyImpression(knobs(), 42, 300, { mapSizeScale: 2 });
    expect(scaled.mapSize).toBe(config.MAP_SIZE * 2);
    // Every placed point must fall within the scaled map, not the unscaled one — proves placement
    // itself read the scaled size, not just the reported mapSize field.
    for (const point of scaled.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(scaled.mapSize);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(scaled.mapSize);
    }
  });

  // The paint effect (`components/start/galaxy-preview.tsx`) runs this whole chain synchronously
  // on the main thread every time a knob settles, so the interactive budget is the WHOLE chain,
  // not just placement. What this cannot cover is the canvas half — putImageData plus one fillRect
  // per system — which needs a real 2D context and so has no node equivalent; those two calls sit
  // downstream of the work bracketed here.
  it("completes the whole 20,000-system regeneration chain — placement, raster and crossing segments — within an interactive bound", () => {
    const start = performance.now();
    const impression = buildGalaxyImpression(knobs({ clusterCount: 60 }), 99, 20_000);
    const bytes = renderDensityField(impression.shape.grid, 900, 900);
    const segments = crossingSegments(impression);
    const elapsedMs = performance.now() - start;

    expect(impression.points.length).toBeGreaterThan(0);
    expect(bytes.length).toBe(900 * 900 * 4);
    expect(Array.isArray(segments)).toBe(true);
    expect(elapsedMs).toBeLessThan(8000);
  });

  it("completes a 20,000-system impression within an interactive bound", () => {
    // Generous ceiling (flagged at review): 5s wall-clock for the largest system count the New
    // Game screen exposes. A slider drag debounces regeneration (galaxy-preview.tsx), so this
    // isn't the steady-state interaction cost, just the no-runaway guarantee.
    const start = performance.now();
    const impression = buildGalaxyImpression(knobs({ clusterCount: 60 }), 99, 20_000);
    const elapsedMs = performance.now() - start;
    expect(impression.points.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(5000);
  });
});

describe("renderDensityField", () => {
  it("produces a byte-identical array for the same grid twice", () => {
    const shape = buildGalaxyShape(knobs(), 4000, mulberry32(3));
    const a = renderDensityField(shape.grid, 64, 64);
    const b = renderDensityField(shape.grid, 64, 64);
    expect(a).toEqual(b);
  });

  it("sizes the output to width * height * 4 RGBA bytes, fully opaque", () => {
    const shape = buildGalaxyShape(knobs(), 4000, mulberry32(3));
    const bytes = renderDensityField(shape.grid, 32, 20);
    expect(bytes.length).toBe(32 * 20 * 4);
    for (let i = 3; i < bytes.length; i += 4) expect(bytes[i]).toBe(255);
  });

  it("paints a true-void cell (density 0) as the background color, not the peak color", () => {
    const grid = { resolution: 2, cells: [0, 0, 0, 0] };
    const bytes = renderDensityField(grid, 8, 8);
    // background token #0e1117 = (14, 17, 23)
    expect(bytes[0]).toBe(14);
    expect(bytes[1]).toBe(17);
    expect(bytes[2]).toBe(23);
  });

  it("paints a maximum-density cell measurably lighter than a void cell", () => {
    const grid = { resolution: 2, cells: [0, 0, 0, 1] };
    const bytes = renderDensityField(grid, 8, 8);
    const voidIndex = (0 * 8 + 0) * 4; // top-left quadrant -> cell (row 0, col 0), density 0
    const denseIndex = (7 * 8 + 7) * 4; // bottom-right quadrant -> cell (row 1, col 1), density 1
    expect(bytes[denseIndex]).toBeGreaterThan(bytes[voidIndex]);
  });
});

describe("worldToCanvas", () => {
  it("projects world coordinates linearly onto the canvas pixel space", () => {
    expect(worldToCanvas(0, 0, 1000, 500, 500)).toEqual({ x: 0, y: 0 });
    expect(worldToCanvas(1000, 1000, 1000, 500, 500)).toEqual({ x: 500, y: 500 });
    expect(worldToCanvas(500, 250, 1000, 500, 500)).toEqual({ x: 250, y: 125 });
  });
});
