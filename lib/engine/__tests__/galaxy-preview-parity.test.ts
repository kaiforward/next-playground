/**
 * The determinism-seam parity proof the galaxy-preview build plan (Task 5, spec
 * `docs/planned/logistics-lanes.md` §5) actually promises: "the dots match a world generated from
 * the same inputs." `components/start/__tests__/galaxy-preview-render.test.ts` only checks
 * `buildGalaxyImpression` against a hand-reconstruction of its OWN steps (same module, hard-coded
 * to agree with itself) — that catches a regression WITHIN the preview module but says nothing
 * about whether the preview still matches the real engine's orchestration. This file runs the real
 * thing: `generateUniverse`, the same top-level entry point `generateWorld` calls.
 *
 * A `.test.ts` (node project) CAN import `lib/engine/universe-gen.ts` freely — its import graph
 * reaching `lib/constants/economy-scale` only matters for the BROWSER bundle (the preview renders
 * on the main thread, `client/worker/boot.ts`'s gotcha); under Node, `economy-scale`'s module-level
 * host-config read resolves fine. This test is intentionally NOT colocated with the preview's own
 * tests, so `components/start/`'s test files keep importing only the browser-safe graph.
 *
 * Coordinate equality is the seam: homeworld stamping (`stampHomeworldPrefabs`), faction
 * assignment and every later generation phase mutate a system's economy/population/buildings, never
 * its `x`/`y` — so `universe.systems[i].{x,y}` for i in placement order is exactly what
 * `bridsonSample` placed, unperturbed by anything downstream.
 */
import { describe, it, expect } from "vitest";
import { buildGalaxyImpression, crossingSegments } from "@/components/start/galaxy-preview-render";
import { generateUniverse } from "@/lib/engine/universe-gen";
import { buildGenParams } from "@/lib/world/gen";
import { genConfigForSystemCount, REGION_NAMES } from "@/lib/constants/universe-gen";

describe("galaxy-preview parity with the real engine orchestration (generateUniverse)", () => {
  it("places every system at exactly the coordinates buildGalaxyImpression predicts, for the same seed + systemCount", () => {
    const seed = 11;
    const systemCount = 400;
    const config = genConfigForSystemCount(systemCount);
    const params = buildGenParams(seed, config);

    const universe = generateUniverse(params, REGION_NAMES);
    const impression = buildGalaxyImpression(params.shapeKnobs, seed, systemCount);

    expect(universe.systems.length).toBe(impression.points.length);
    for (let i = 0; i < universe.systems.length; i++) {
      expect(universe.systems[i].x).toBe(impression.points[i].x);
      expect(universe.systems[i].y).toBe(impression.points[i].y);
    }
  });

  it("holds at a second, unrelated seed/systemCount pair — not a coincidence of one input", () => {
    const seed = 2026;
    const systemCount = 1200;
    const config = genConfigForSystemCount(systemCount);
    const params = buildGenParams(seed, config);

    const universe = generateUniverse(params, REGION_NAMES);
    const impression = buildGalaxyImpression(params.shapeKnobs, seed, systemCount);

    expect(universe.systems.length).toBe(impression.points.length);
    const coords = universe.systems.map((s) => ({ x: s.x, y: s.y }));
    expect(coords).toEqual(impression.points);
  });

  // New Game's placement/scale levers (`mapSizeScale`/`starSpacing`/`clusterTightness`,
  // `lib/schemas/game-setup.ts`) must agree between the preview (`buildGalaxyImpression`'s
  // `ImpressionOverrides`) and the played galaxy (`generateUniverse`'s `GenParams`) — this is the
  // seam that would silently diverge if either side's threading dropped a lever.
  it("holds with every non-default placement/scale lever set (mapSizeScale, starSpacing, clusterTightness)", () => {
    const seed = 55;
    const systemCount = 500;
    const config = genConfigForSystemCount(systemCount);
    const shape = { mapSizeScale: 1.5, starSpacing: 0.7, clusterTightness: 0.4 };
    const params = buildGenParams(seed, config, shape);

    const universe = generateUniverse(params, REGION_NAMES);
    const impression = buildGalaxyImpression(params.shapeKnobs, seed, systemCount, {
      mapSizeScale: shape.mapSizeScale,
      minDistanceScale: shape.starSpacing,
      densityRadiusExponent: shape.clusterTightness,
    });

    expect(universe.systems.length).toBe(impression.points.length);
    const coords = universe.systems.map((s) => ({ x: s.x, y: s.y }));
    expect(coords).toEqual(impression.points);
  });
});

describe("galaxy-preview crossing-set parity with the engine's realised isCrossing lanes (spec §5C)", () => {
  /** The set of undirected coordinate-pair keys the engine actually realised as isCrossing lanes —
   *  coordinates, not indices, because `stampHomeworldPrefabs`/faction assignment renumber nothing
   *  but do run after connection generation, and coordinates are the seam the module docstring
   *  already establishes as stable end-to-end. */
  function engineCrossingPairKeys(universe: ReturnType<typeof generateUniverse>): Set<string> {
    const byIndex = new Map(universe.systems.map((s) => [s.index, s]));
    const keys = new Set<string>();
    for (const c of universe.connections) {
      if (!c.isCrossing) continue;
      const from = byIndex.get(c.fromSystemIndex)!;
      const to = byIndex.get(c.toSystemIndex)!;
      const a = `${from.x},${from.y}`;
      const b = `${to.x},${to.y}`;
      keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
    return keys;
  }

  function previewCrossingPairKeys(
    impression: ReturnType<typeof buildGalaxyImpression>,
  ): Set<string> {
    const keys = new Set<string>();
    for (const seg of crossingSegments(impression)) {
      const a = `${seg.a.x},${seg.a.y}`;
      const b = `${seg.b.x},${seg.b.y}`;
      keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
    return keys;
  }

  it("matches exactly at a seed where demotion never fires (every planned crossing pair survives realisation)", () => {
    // Measured: systemCount=600 seed=42 (default knobs) — all 5 planned crossing pairs stay
    // crossings at realisation (no demotion), per the density-field diagnostics this build's
    // demotion thresholds were calibrated against.
    const seed = 42;
    const systemCount = 600;
    const config = genConfigForSystemCount(systemCount);
    const params = buildGenParams(seed, config);
    const universe = generateUniverse(params, REGION_NAMES);
    const impression = buildGalaxyImpression(params.shapeKnobs, seed, systemCount);

    const engineKeys = engineCrossingPairKeys(universe);
    const previewKeys = previewCrossingPairKeys(impression);
    expect(engineKeys.size).toBeGreaterThan(0); // non-vacuous
    expect(previewKeys).toEqual(engineKeys);
  });

  it("matches exactly at a seed where demotion DOES fire (some planned crossing pairs demote to band)", () => {
    // Measured: systemCount=600 seed=43 — 2 of 7 planned crossing pairs demote (their realised
    // anchor-to-anchor line reads mostly populated or runs close to a third system); the preview
    // must exclude exactly those two, not just draw every planned pair.
    const seed = 43;
    const systemCount = 600;
    const config = genConfigForSystemCount(systemCount);
    const params = buildGenParams(seed, config);
    const universe = generateUniverse(params, REGION_NAMES);
    const impression = buildGalaxyImpression(params.shapeKnobs, seed, systemCount);

    const engineKeys = engineCrossingPairKeys(universe);
    const previewKeys = previewCrossingPairKeys(impression);
    expect(engineKeys.size).toBeGreaterThan(0); // non-vacuous
    // Fewer real crossings than planned pairs — proves this seed actually exercises demotion,
    // not just that the two sides happen to agree on an empty set.
    const plannedCrossingCount = impression.shape.corridors.pairs.filter((p) => p.style === "crossing").length;
    expect(engineKeys.size).toBeLessThan(plannedCrossingCount);
    expect(previewKeys).toEqual(engineKeys);
  });
});
