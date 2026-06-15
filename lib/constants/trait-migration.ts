import type { BodyArchetypeId, RichnessModifierId, TraitId } from "@/lib/types/game";

/** How an old trait is reclassified in the substrate rebuild. */
export type TraitMigration =
  | { kind: "archetype"; archetype: BodyArchetypeId }
  | { kind: "richness"; modifier: RichnessModifierId }
  | { kind: "feature" };

/**
 * The full reclassification of the legacy 52-trait catalog (SP1 spec §4.1).
 * - archetype: trait was a world/body type → becomes a body archetype (trait disappears).
 * - richness:  trait was "abundant resource X" → becomes a richness modifier (trait disappears).
 * - feature:   trait was narrative → survives in SystemTrait, economy fields retired (PR3).
 *
 * Override: every SURVEY/SALVAGE/RECON-eligible trait is a feature (else its missions break) —
 * this is why crystalline_formations & tidally_locked_world are features, not richness/archetype.
 */
export const TRAIT_MIGRATION: Record<TraitId, TraitMigration> = {
  // ── Archetypes (8) — world/body types ──
  habitable_world: { kind: "archetype", archetype: "garden_world" },
  ocean_world: { kind: "archetype", archetype: "ocean_world" },
  jungle_world: { kind: "archetype", archetype: "jungle_world" },
  desert_world: { kind: "archetype", archetype: "arid_world" },
  volcanic_world: { kind: "archetype", archetype: "volcanic_world" },
  frozen_world: { kind: "archetype", archetype: "frozen_world" },
  gas_giant: { kind: "archetype", archetype: "gas_giant" },
  asteroid_belt: { kind: "archetype", archetype: "asteroid_belt" },

  // ── Richness modifiers (13) — abundance of one tier-0 resource ──
  hydrocarbon_seas: { kind: "richness", modifier: "hydrocarbon_deposits" },
  fertile_lowlands: { kind: "richness", modifier: "fertile_soil" },
  coral_archipelago: { kind: "richness", modifier: "coral_reefs" },
  tectonic_forge: { kind: "richness", modifier: "tectonic_concentration" },
  mineral_rich_moons: { kind: "richness", modifier: "mineral_moons" },
  ring_system: { kind: "richness", modifier: "ice_rings" },
  rare_earth_deposits: { kind: "richness", modifier: "rare_earth" },
  heavy_metal_veins: { kind: "richness", modifier: "heavy_metals" },
  organic_compounds: { kind: "richness", modifier: "organic_compounds" },
  helium3_reserves: { kind: "richness", modifier: "helium3" },
  radioactive_deposits: { kind: "richness", modifier: "radioactive_lode" },
  superdense_core: { kind: "richness", modifier: "superdense" },
  glacial_aquifer: { kind: "richness", modifier: "glacial_aquifer" },

  // ── Features (31) — narrative survivors (incl. mission-eligible overrides) ──
  tidally_locked_world: { kind: "feature" },   // override: survey-eligible
  crystalline_formations: { kind: "feature" }, // override: survey-eligible
  geothermal_vents: { kind: "feature" },
  exotic_matter_traces: { kind: "feature" },
  binary_star: { kind: "feature" },
  lagrange_stations: { kind: "feature" },
  captured_rogue_body: { kind: "feature" },
  deep_space_beacon: { kind: "feature" },
  nebula_proximity: { kind: "feature" },
  solar_flare_activity: { kind: "feature" },
  gravitational_anomaly: { kind: "feature" },
  dark_nebula: { kind: "feature" },
  precursor_ruins: { kind: "feature" },
  subspace_rift: { kind: "feature" },
  pulsar_proximity: { kind: "feature" },
  ion_storm_corridor: { kind: "feature" },
  bioluminescent_ecosystem: { kind: "feature" },
  signal_anomaly: { kind: "feature" },
  xenobiology_preserve: { kind: "feature" },
  ancient_minefield: { kind: "feature" },
  pirate_stronghold: { kind: "feature" },
  ancient_trade_route: { kind: "feature" },
  generation_ship_wreckage: { kind: "feature" },
  orbital_ring_remnant: { kind: "feature" },
  seed_vault: { kind: "feature" },
  colonial_capital: { kind: "feature" },
  free_port_declaration: { kind: "feature" },
  shipbreaking_yards: { kind: "feature" },
  derelict_fleet: { kind: "feature" },
  abandoned_station: { kind: "feature" },
  smuggler_haven: { kind: "feature" },
};
