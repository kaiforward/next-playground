import type { EconomyType, GovernmentType, RegionTheme, TraitId } from "@/lib/types/game";

/** Tuneable universe generation parameters. */
export const UNIVERSE_GEN = {
  SEED: 42,
  REGION_COUNT: 8,
  SYSTEMS_PER_REGION: 25,
  MAP_SIZE: 4000,
  REGION_MIN_DISTANCE: 800,
  SYSTEM_SCATTER_RADIUS: 875,
  SYSTEM_MIN_DISTANCE: 158,
  INTRA_REGION_EXTRA_EDGES: 0.5,
  GATEWAY_FUEL_MULTIPLIER: 2.5,
  INTRA_REGION_BASE_FUEL: 8,
  /** Max rejection sampling attempts before falling back to grid-jitter. */
  MAX_PLACEMENT_ATTEMPTS: 500,
  /** Base trait weight for traits not explicitly listed in a theme. */
  BASE_TRAIT_WEIGHT: 5,
  /** Minimum region economy agreement for coherence (60%). */
  COHERENCE_THRESHOLD: 0.6,
} as const;

/** Region themes — one per region, cycling when > 8 regions. */
export const REGION_THEMES: RegionTheme[] = [
  "trade_nexus",
  "mineral_frontier",
  "industrial_corridor",
  "research_cluster",
  "garden_heartland",
  "energy_belt",
  "contested_frontier",
  "frontier_wilds",
];

/** Thematic name prefixes per region theme. */
export const REGION_NAME_PREFIXES: Record<RegionTheme, string[]> = {
  garden_heartland: ["Eden", "Verdant", "Harvest", "Pastoral"],
  mineral_frontier: ["Forge", "Quarry", "Vein", "Lode"],
  industrial_corridor: ["Foundry", "Assembly", "Crucible", "Works"],
  research_cluster: ["Prism", "Cipher", "Archive", "Axiom"],
  energy_belt: ["Helios", "Corona", "Flare", "Dynamo"],
  trade_nexus: ["Nexus", "Haven", "Crossroads", "Confluence"],
  contested_frontier: ["Rift", "Breach", "Disputed", "Fracture"],
  frontier_wilds: ["Expanse", "Drift", "Outreach", "Fringe"],
};

/** Government type distribution weights per region theme. */
export const GOVERNMENT_TYPE_WEIGHTS: Record<RegionTheme, Record<GovernmentType, number>> = {
  garden_heartland: { federation: 40, corporate: 25, frontier: 20, authoritarian: 15 },
  mineral_frontier: { frontier: 40, corporate: 30, federation: 20, authoritarian: 10 },
  industrial_corridor: { corporate: 35, authoritarian: 30, federation: 25, frontier: 10 },
  research_cluster: { corporate: 35, federation: 30, authoritarian: 20, frontier: 15 },
  energy_belt: { corporate: 30, authoritarian: 30, federation: 25, frontier: 15 },
  trade_nexus: { corporate: 35, federation: 35, authoritarian: 20, frontier: 10 },
  contested_frontier: { frontier: 40, authoritarian: 25, corporate: 20, federation: 15 },
  frontier_wilds: { frontier: 50, corporate: 20, federation: 20, authoritarian: 10 },
};

// ── Trait generation tables ───────────────────────────────────────
//
// Each theme lists elevated weights for its signature traits. Traits
// not listed get UNIVERSE_GEN.BASE_TRAIT_WEIGHT. The design doc lists
// 3-4 core traits per theme; we extend each with 1-3 additional
// thematically coherent traits for variety.

/** Per-theme elevated trait weights (unlisted traits use BASE_TRAIT_WEIGHT). */
export const REGION_THEME_TRAIT_WEIGHTS: Record<RegionTheme, Partial<Record<TraitId, number>>> = {
  garden_heartland: {
    habitable_world: 30,
    ocean_world: 25,
    seed_vault: 20,
    jungle_world: 20,
    organic_compounds: 15,
  },
  mineral_frontier: {
    asteroid_belt: 30,
    gas_giant: 25,
    mineral_rich_moons: 25,
    heavy_metal_veins: 20,
    ring_system: 15,
    frozen_world: 15,
  },
  industrial_corridor: {
    lagrange_stations: 30,
    orbital_ring_remnant: 25,
    heavy_metal_veins: 25,
    desert_world: 15,
    ancient_trade_route: 15,
  },
  research_cluster: {
    precursor_ruins: 30,
    gravitational_anomaly: 25,
    exotic_matter_traces: 25,
    crystalline_formations: 20,
    tidally_locked_world: 15,
    captured_rogue_body: 15,
  },
  energy_belt: {
    binary_star: 30,
    gas_giant: 25,
    helium3_reserves: 25,
    solar_flare_activity: 20,
    volcanic_world: 15,
  },
  trade_nexus: {
    ancient_trade_route: 30,
    habitable_world: 25,
    lagrange_stations: 25,
    orbital_ring_remnant: 15,
    organic_compounds: 10,
  },
  contested_frontier: {
    // Mixed — no single trait dominates. Slightly elevated danger/resource traits.
    dark_nebula: 20,
    radioactive_deposits: 20,
    volcanic_world: 20,
    nebula_proximity: 15,
    asteroid_belt: 15,
    heavy_metal_veins: 15,
  },
  frontier_wilds: {
    // Sparse traits (systems get fewer traits). Frontier/oddball mix.
    frozen_world: 20,
    nebula_proximity: 20,
    ring_system: 15,
    pulsar_proximity: 15,
    captured_rogue_body: 15,
  },
};

/** Trait count range per theme. Most themes 2-4; frontier_wilds 1-2 (sparse). */
export const REGION_THEME_TRAIT_COUNT: Record<RegionTheme, { min: number; max: number }> = {
  garden_heartland: { min: 2, max: 4 },
  mineral_frontier: { min: 2, max: 4 },
  industrial_corridor: { min: 2, max: 4 },
  research_cluster: { min: 2, max: 4 },
  energy_belt: { min: 2, max: 4 },
  trade_nexus: { min: 2, max: 4 },
  contested_frontier: { min: 2, max: 4 },
  frontier_wilds: { min: 1, max: 2 },
};

/**
 * Small tiebreaker bonus when a theme's natural economy matches the
 * scoring result. Only matters for exact ties in affinity scoring.
 */
export const THEME_ECONOMY_TIEBREAKER: Record<RegionTheme, Partial<Record<EconomyType, number>>> = {
  garden_heartland: { agricultural: 1 },
  mineral_frontier: { extraction: 1 },
  industrial_corridor: { industrial: 1 },
  research_cluster: { tech: 1 },
  energy_belt: { refinery: 1 },
  trade_nexus: { core: 1 },
  contested_frontier: {},
  frontier_wilds: { extraction: 1 },
};
