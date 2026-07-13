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
  type GenParams,
  type GeneratedUniverse,
} from "../universe-gen";
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
        // strong, DESIGNED plurality (~65-72%) — the classifier reads slotCap ×
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

