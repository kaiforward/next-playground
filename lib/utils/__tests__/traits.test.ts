import { describe, it, expect } from "vitest";
import { isFeatureTrait, getFeatureTraits } from "../traits";
import { ALL_TRAIT_IDS } from "@/lib/constants/traits";
import type { TraitId, QualityTier } from "@/lib/types/game";

// ── isFeatureTrait ───────────────────────────────────────────────

describe("isFeatureTrait", () => {
  it("returns true for narrative-feature traits", () => {
    expect(isFeatureTrait("pirate_stronghold")).toBe(true);
    expect(isFeatureTrait("binary_star")).toBe(true);
    // Mission-eligible overrides are features even though they read planetary/resource.
    expect(isFeatureTrait("tidally_locked_world")).toBe(true);
    expect(isFeatureTrait("crystalline_formations")).toBe(true);
  });

  it("returns false for archetype (world/body-type) traits", () => {
    expect(isFeatureTrait("volcanic_world")).toBe(false);
    expect(isFeatureTrait("habitable_world")).toBe(false);
    expect(isFeatureTrait("asteroid_belt")).toBe(false);
    expect(isFeatureTrait("gas_giant")).toBe(false);
  });

  it("returns false for richness (abundant-resource) traits", () => {
    expect(isFeatureTrait("radioactive_deposits")).toBe(false);
    expect(isFeatureTrait("rare_earth_deposits")).toBe(false);
    expect(isFeatureTrait("ring_system")).toBe(false);
  });
});

// ── getFeatureTraits ─────────────────────────────────────────────

function makeTrait(traitId: TraitId, quality: QualityTier = 1) {
  return { traitId, quality };
}

describe("getFeatureTraits", () => {
  it("keeps feature traits and drops archetype/richness traits", () => {
    const traits = [
      makeTrait("pirate_stronghold"),
      makeTrait("volcanic_world"), // archetype → dropped
      makeTrait("binary_star"),
      makeTrait("radioactive_deposits"), // richness → dropped
    ];
    expect(getFeatureTraits(traits).map((t) => t.traitId)).toEqual([
      "pirate_stronghold",
      "binary_star",
    ]);
  });

  it("preserves input order of the kept traits", () => {
    const traits = [
      makeTrait("subspace_rift"),
      makeTrait("habitable_world"), // dropped
      makeTrait("ancient_minefield"),
      makeTrait("dark_nebula"),
    ];
    expect(getFeatureTraits(traits).map((t) => t.traitId)).toEqual([
      "subspace_rift",
      "ancient_minefield",
      "dark_nebula",
    ]);
  });

  it("preserves the full shape of kept entries (generic over T)", () => {
    const traits = [makeTrait("binary_star", 3), makeTrait("gas_giant", 2)];
    expect(getFeatureTraits(traits)).toEqual([{ traitId: "binary_star", quality: 3 }]);
  });

  it("returns an empty array for an empty input", () => {
    expect(getFeatureTraits([])).toEqual([]);
  });

  it("returns an empty array when no traits are features", () => {
    const traits = [makeTrait("volcanic_world"), makeTrait("ring_system")];
    expect(getFeatureTraits(traits)).toEqual([]);
  });

  it("filters the full catalog down to exactly the 31 feature survivors", () => {
    // Identity guard, not just count: a TRAIT_MIGRATION edit that swaps a feature for
    // an archetype/richness trait keeps the total at 31, so a length-only check would
    // pass silently. Listed in catalog order; both sides sorted before comparison.
    const expectedFeatures: TraitId[] = [
      "tidally_locked_world", "crystalline_formations", "geothermal_vents",
      "exotic_matter_traces", "binary_star", "lagrange_stations", "captured_rogue_body",
      "deep_space_beacon", "nebula_proximity", "solar_flare_activity", "gravitational_anomaly",
      "dark_nebula", "precursor_ruins", "subspace_rift", "pulsar_proximity",
      "ion_storm_corridor", "bioluminescent_ecosystem", "signal_anomaly", "xenobiology_preserve",
      "ancient_minefield", "pirate_stronghold", "ancient_trade_route", "generation_ship_wreckage",
      "orbital_ring_remnant", "seed_vault", "colonial_capital", "free_port_declaration",
      "shipbreaking_yards", "derelict_fleet", "abandoned_station", "smuggler_haven",
    ];
    const all = ALL_TRAIT_IDS.map((id) => makeTrait(id));
    expect(getFeatureTraits(all).map((t) => t.traitId).sort()).toEqual(
      [...expectedFeatures].sort(),
    );
  });
});
