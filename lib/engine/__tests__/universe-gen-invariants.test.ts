/**
 * Universe-generation invariants — multi-seed statistical validation.
 *
 * Validates physical-substrate invariants across many seeds: the
 * substrate-driven economy types appear and none dominates — the
 * "coherent + healthy" bar. Economy types derive from the physical substrate,
 * so an even split is neither expected nor wanted (extraction/agricultural are
 * pluralities); the population-gated 'industrial'/'tech' types are sparse until
 * P4 calibration lifts the population magnitude.
 *
 * Tests run full universe generation across multiple seeds for statistical confidence.
 */

import { describe, it, expect } from "vitest";
import {
  generateUniverse,
  generateConnections,
  type GenParams,
  type GeneratedUniverse,
  type GeneratedRegion,
  type GeneratedSystem,
} from "../universe-gen";
import type { CorridorPlan, DensityGrid } from "../density-field";
import { emptyResourceVector } from "../resources";
import {
  genConfigForSystemCount,
  DEFAULT_SYSTEM_COUNT,
  REGION_NAMES,
} from "@/lib/constants/universe-gen";
import { buildGenParams } from "@/lib/world/gen";
import type { EconomyType } from "@/lib/types/game";

// ── Helpers ─────────────────────────────────────────────────────

const DEFAULT_GEN_CONFIG = genConfigForSystemCount(DEFAULT_SYSTEM_COUNT);

function makeParams(seed: number): GenParams {
  return buildGenParams(seed, DEFAULT_GEN_CONFIG);
}

const TEST_SEEDS = [42, 123, 7, 999, 2024, 31415, 271828, 1337, 8675309, 54321];

function generateAll(): GeneratedUniverse[] {
  return TEST_SEEDS.map((seed) => generateUniverse(makeParams(seed), REGION_NAMES));
}

// Pre-generate all universes once (shared across tests in this file)
const universes = generateAll();

// ── Economy Type Spread ──────────────────────────────────────────

const ALL_ECONOMY_TYPES: EconomyType[] = [
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
];

// The four substrate-driven base types appear in every seed. The population-gated
// 'industrial'/'tech' types are sparse-to-absent pre-calibration: full-fold
// population currently peaks ~1065 (below the ECON_POP_HIGH=1000 / 0.6 gate for
// most systems), so across the test seeds 'industrial' shows up in a single seed
// (~0.2%) and 'tech' never. Restoring the full 6-type spread is a P4 calibration
// target (lift the population magnitude / lower the gate).
const BASE_ECONOMY_TYPES: EconomyType[] = ["agricultural", "extraction", "refinery", "core"];

describe("Economy type distribution across seeds", () => {
  it("the four substrate-driven economy types are present in every seed", () => {
    for (const universe of universes) {
      const types = new Set(universe.systems.map((s) => s.economyType));
      for (const econ of BASE_ECONOMY_TYPES) {
        expect(types.has(econ), `Missing economy type: ${econ}`).toBe(true);
      }
    }
  });

  it("no economy type runs away with the galaxy in any seed", () => {
    // Physical-substrate bar: types derive from physical substrate, so an even split
    // is not expected. The invariant is "all present" (covered above) + "none
    // runs away with the galaxy". Matches the generateSystems distribution test.
    for (const universe of universes) {
      const counts: Record<string, number> = {};
      for (const econ of ALL_ECONOMY_TYPES) counts[econ] = 0;
      for (const system of universe.systems) {
        counts[system.economyType]++;
      }

      const total = universe.systems.length;
      for (const econ of ALL_ECONOMY_TYPES) {
        const share = counts[econ] / total;
        // ≤ 0.80: a realistic galaxy is mostly mining worlds, so 'extraction' is a
        // strong, DESIGNED plurality (~65-72%) — the classifier reads depositCounts ×
        // yieldMult (raw deposit potential) and most systems are barren. This guard
        // only catches one type reaching near-total takeover, not the intended
        // extraction-dominance.
        expect(
          share,
          `${econ} at ${(share * 100).toFixed(1)}% — runs away with the galaxy`,
        ).toBeLessThanOrEqual(0.80);
      }
    }
  });
});

// ── Band cross-wiring guard ────────────────────────────────────────
//
// No other test catches a band waypoint realized into the WRONG pair's chain when two band
// corridors run geometrically close — a single-
// waypoint-per-chain fixture (`realizeCorridors` tests, `universe-gen.test.ts`) can only ever prove
// "this one interior point didn't wander", never that a MULTI-stop chain's waypoints land in the
// right consecutive order. `connectRemainingComponents`'s `repairLaneCount` cannot see this either:
// a cross-wired waypoint lane still leaves every anchor connected (through the wrong neighbour), so
// the repair pass — the only other whole-graph provenance signal generation exposes — reads 0
// whether the chains are wired correctly or not.
//
// No provenance export was needed: the fixture below controls every system index directly, so each
// system's true chain membership is known from how the fixture was built, not inferred from
// generation output.

/** Minimal `GeneratedSystem` — only position/index/region matter for corridor realisation. */
function bandFixtureSystem(index: number, regionIndex: number, x: number, y: number): GeneratedSystem {
  return {
    index, regionIndex, x, y,
    name: `s${index}`, economyType: "extraction", sunClass: "yellow",
    bodies: [], popCap: 0, population: 0, bodyDanger: 0, buildings: {}, peopleLand: 0,
    depositCounts: emptyResourceVector(), yieldMult: emptyResourceVector(),
    extractionEfficiency: emptyResourceVector(),
    potentialYieldMult: emptyResourceVector(), potentialExtractionEfficiency: emptyResourceVector(),
    isGateway: false, description: "",
  };
}

function bandFixtureRegion(index: number, x: number, y: number): GeneratedRegion {
  return { index, name: `r${index}`, x, y };
}

describe("generateConnections — band cross-wiring guard (two close, parallel multi-waypoint chains)", () => {
  // Two parallel horizontal band corridors, 400 world units apart (well past the default
  // perpendicular-distance tolerance of `poissonMinDistance` 100 × 3 = 300), each with TWO
  // collinear waypoints — a genuine chain, not just an anchor-waypoint-anchor triple, so the
  // "consecutive waypoints of the same pair's chain" claim is actually exercised (a one-waypoint
  // chain has no waypoint-to-waypoint edge to get wrong).
  //
  // Corridor A (pair a=0,b=1): anchor 0 (0,0) — waypoint 2 (400,0) — waypoint 3 (800,0) — anchor 1
  // (1200,0). Corridor B (pair a=2,b=3): anchor 4 (0,400) — waypoint 6 (400,400) — waypoint 7
  // (800,400) — anchor 5 (1200,400). Each waypoint sits in its own third-region (never its
  // corridor's endpoint region — see `universe-gen.test.ts`'s band-chain fixtures for why: a
  // waypoint assigned to an endpoint region would compete for that region's own anchor slot).
  const CHAIN_A = new Set([0, 1, 2, 3]);
  const CHAIN_B = new Set([4, 5, 6, 7]);

  const regions: GeneratedRegion[] = [
    bandFixtureRegion(0, 0, 0), bandFixtureRegion(1, 1200, 0),     // corridor A's anchor clusters
    bandFixtureRegion(2, 0, 400), bandFixtureRegion(3, 1200, 400), // corridor B's anchor clusters
    bandFixtureRegion(4, 400, 0), bandFixtureRegion(5, 800, 0),     // corridor A's waypoint clusters
    bandFixtureRegion(6, 400, 400), bandFixtureRegion(7, 800, 400), // corridor B's waypoint clusters
  ];
  const systems: GeneratedSystem[] = [
    bandFixtureSystem(0, 0, 0, 0),
    bandFixtureSystem(1, 1, 1200, 0),
    bandFixtureSystem(2, 4, 400, 0),
    bandFixtureSystem(3, 5, 800, 0),
    bandFixtureSystem(4, 2, 0, 400),
    bandFixtureSystem(5, 3, 1200, 400),
    bandFixtureSystem(6, 6, 400, 400),
    bandFixtureSystem(7, 7, 800, 400),
  ];
  // A third corridor — a plain crossing lane bridging the two chains' far anchors (region 1 to
  // region 3) — keeps the whole fixture one connected component so `connectRemainingComponents`
  // never fires (`repairLaneCount` stays 0 on its own terms, not because the fixture cheats by
  // leaving the graph disconnected). It realizes at the crossing fuel class (`isCrossing: true`),
  // so it is trivially distinguishable from a band chain's own lanes in every assertion below.
  const corridors: CorridorPlan = {
    pairs: [
      { a: 0, b: 1, style: "band" },
      { a: 2, b: 3, style: "band" },
      { a: 1, b: 3, style: "crossing" },
    ],
  };
  const grid: DensityGrid = { resolution: 1, cells: [0] };
  const mapSize = 200_000;

  function fullParams(): GenParams {
    return {
      ...buildGenParams(1, genConfigForSystemCount(DEFAULT_SYSTEM_COUNT)),
      poissonMinDistance: 100,
      intraRegionBaseFuel: 8,
      crossingFuelMultiplier: 2.5,
      lanePruneFraction: 0,
    };
  }

  function undirectedKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  it("every band lane joins consecutive waypoints of ITS OWN chain — never a system from the other chain", () => {
    const { connections, repairLaneCount } = generateConnections(
      systems, regions, corridors, fullParams(), grid, mapSize,
    );

    // The repair pass is not the instrument: a cross-wired chain still leaves every anchor
    // connected (through the wrong neighbour), so `repairLaneCount` reads 0 in both the correct
    // and the cross-wired case — asserted here so nobody mistakes it for the proof below.
    expect(repairLaneCount).toBe(0);

    const bandLanes = connections.filter((c) => !c.isCrossing);
    const crossingLanes = connections.filter((c) => c.isCrossing);

    expect(bandLanes.length, "12 directed rows — 6 undirected band lanes, two 4-point chains").toBe(12);
    expect(crossingLanes.length, "2 directed rows — the one bridging crossing lane").toBe(2);
    expect(new Set(crossingLanes.map((c) => undirectedKey(c.fromSystemIndex, c.toSystemIndex))))
      .toEqual(new Set(["1-5"]));

    const undirectedBandPairs = new Set(
      bandLanes.map((c) => undirectedKey(c.fromSystemIndex, c.toSystemIndex)),
    );
    // The exact collinear chain each corridor must realize: anchor-to-nearest-waypoint,
    // waypoint-to-waypoint (the "consecutive waypoints" claim), waypoint-to-far-anchor.
    expect(undirectedBandPairs).toEqual(new Set([
      "0-2", "2-3", "1-3", // chain A: 0 — 2 — 3 — 1
      "4-6", "6-7", "5-7", // chain B: 4 — 6 — 7 — 5
    ]));

    // No BAND lane bridges the two chains — the cross-wiring shape this guard exists to catch.
    // (The deliberate crossing bridge above is excluded — it isn't a band chain's own lane.)
    for (const c of bandLanes) {
      const fromChain = CHAIN_A.has(c.fromSystemIndex) ? CHAIN_A : CHAIN_B;
      const toChain = CHAIN_A.has(c.toSystemIndex) ? CHAIN_A : CHAIN_B;
      expect(
        fromChain === toChain,
        `band lane ${c.fromSystemIndex}-${c.toSystemIndex} crosses between chain A and chain B`,
      ).toBe(true);
    }
  });
});

