/**
 * Universe-generation invariants — multi-seed statistical validation.
 *
 * Validates substrate-era (economy-simulation SP1) invariants across many seeds:
 * 1. Feature quality tiers match rarity targets (50% tier 1, 35% tier 2, 15% tier 3).
 * 2. All six economy types appear and none dominates — the "coherent + healthy"
 *    bar. Economy types now derive from the physical substrate, so an even split
 *    is neither expected nor wanted (cores/extraction are pluralities).
 * 3. The trait catalog keeps a balanced strong-affinity spread (catalog data;
 *    affinities are retired in a later PR).
 *
 * Tests run full universe generation across multiple seeds for statistical confidence.
 */

import { describe, it, expect } from "vitest";
import {
  generateUniverse,
  type GenParams,
  type GeneratedUniverse,
} from "../universe-gen";
import { UNIVERSE_GEN, REGION_NAMES } from "@/lib/constants/universe-gen";
import type { EconomyType, QualityTier } from "@/lib/types/game";

// ── Helpers ─────────────────────────────────────────────────────

function makeParams(seed: number): GenParams {
  return {
    seed,
    regionCount: UNIVERSE_GEN.REGION_COUNT,
    totalSystems: UNIVERSE_GEN.TOTAL_SYSTEMS,
    mapSize: UNIVERSE_GEN.MAP_SIZE,
    mapPadding: UNIVERSE_GEN.MAP_PADDING,
    poissonMinDistance: UNIVERSE_GEN.POISSON_MIN_DISTANCE,
    poissonKCandidates: UNIVERSE_GEN.POISSON_K_CANDIDATES,
    regionMinDistance: UNIVERSE_GEN.REGION_MIN_DISTANCE,
    extraEdgeFraction: UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES,
    gatewayFuelMultiplier: UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER,
    gatewaysPerBorder: UNIVERSE_GEN.GATEWAYS_PER_BORDER,
    intraRegionBaseFuel: UNIVERSE_GEN.INTRA_REGION_BASE_FUEL,
    maxPlacementAttempts: UNIVERSE_GEN.MAX_PLACEMENT_ATTEMPTS,
    minorFactionCount: UNIVERSE_GEN.MINOR_FACTION_COUNT,
  };
}

const TEST_SEEDS = [42, 123, 7, 999, 2024, 31415, 271828, 1337, 8675309, 54321];

function generateAll(): GeneratedUniverse[] {
  return TEST_SEEDS.map((seed) => generateUniverse(makeParams(seed), REGION_NAMES));
}

// Pre-generate all universes once (shared across tests in this file)
const universes = generateAll();

// ── 1. Trait Quality Distributions ──────────────────────────────

describe("Trait quality distributions across seeds", () => {
  it("aggregate distribution matches rarity targets (50/35/15 ±5%)", () => {
    const tierCounts: Record<QualityTier, number> = { 1: 0, 2: 0, 3: 0 };
    let totalTraits = 0;

    for (const universe of universes) {
      for (const system of universe.systems) {
        for (const trait of system.traits) {
          tierCounts[trait.quality]++;
          totalTraits++;
        }
      }
    }

    const pct1 = tierCounts[1] / totalTraits;
    const pct2 = tierCounts[2] / totalTraits;
    const pct3 = tierCounts[3] / totalTraits;

    // Allow ±5% tolerance from targets
    expect(pct1).toBeGreaterThan(0.45);
    expect(pct1).toBeLessThan(0.55);
    expect(pct2).toBeGreaterThan(0.30);
    expect(pct2).toBeLessThan(0.40);
    expect(pct3).toBeGreaterThan(0.10);
    expect(pct3).toBeLessThan(0.20);
  });

  it("every individual seed stays within ±8% of rarity targets", () => {
    for (const universe of universes) {
      const tierCounts: Record<QualityTier, number> = { 1: 0, 2: 0, 3: 0 };
      let totalTraits = 0;

      for (const system of universe.systems) {
        for (const trait of system.traits) {
          tierCounts[trait.quality]++;
          totalTraits++;
        }
      }

      const pct1 = tierCounts[1] / totalTraits;
      const pct2 = tierCounts[2] / totalTraits;
      const pct3 = tierCounts[3] / totalTraits;

      // Wider tolerance per-seed (smaller sample) but still meaningful
      expect(pct1).toBeGreaterThan(0.42);
      expect(pct1).toBeLessThan(0.58);
      expect(pct2).toBeGreaterThan(0.27);
      expect(pct2).toBeLessThan(0.43);
      expect(pct3).toBeGreaterThan(0.07);
      expect(pct3).toBeLessThan(0.23);
    }
  });
});

// ── 2. Economy Type Spread ──────────────────────────────────────

const ALL_ECONOMY_TYPES: EconomyType[] = [
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
];

describe("Economy type distribution across seeds", () => {
  it("all 6 economy types present in every seed", () => {
    for (const universe of universes) {
      const types = new Set(universe.systems.map((s) => s.economyType));
      for (const econ of ALL_ECONOMY_TYPES) {
        expect(types.has(econ), `Missing economy type: ${econ}`).toBe(true);
      }
    }
  });

  it("no economy type dominates (>50%) in any seed", () => {
    // Substrate-era bar: types derive from physical substrate, so an even split
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
        expect(
          share,
          `${econ} at ${(share * 100).toFixed(1)}% — dominates (>50%)`,
        ).toBeLessThan(0.5);
      }
    }
  });
});

