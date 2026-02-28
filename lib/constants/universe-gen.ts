

/** Tuneable universe generation parameters. */
export const UNIVERSE_GEN = {
  SEED: 42,
  REGION_COUNT: 24,
  TOTAL_SYSTEMS: 600,
  MAP_SIZE: 7000,
  MAP_PADDING: 0.10,
  POISSON_MIN_DISTANCE: 180,
  POISSON_K_CANDIDATES: 30,
  REGION_MIN_DISTANCE: 800,
  INTRA_REGION_EXTRA_EDGES: 0.5,
  GATEWAY_FUEL_MULTIPLIER: 2.5,
  GATEWAYS_PER_BORDER: 3,
  INTRA_REGION_BASE_FUEL: 8,
  /** Max rejection sampling attempts before falling back to grid-jitter. */
  MAX_PLACEMENT_ATTEMPTS: 500,
} as const;

/** Flat pool of generic space region names (24 + 4 extras for collision fallback). */
export const REGION_NAMES: string[] = [
  "Arcturus",
  "Meridian",
  "Vanguard",
  "Horizon",
  "Zenith",
  "Solace",
  "Pinnacle",
  "Tempest",
  "Bastion",
  "Frontier",
  "Aegis",
  "Nebula",
  "Eclipse",
  "Sentinel",
  "Cascade",
  "Vertex",
  "Rift",
  "Threshold",
  "Citadel",
  "Expanse",
  "Dominion",
  "Prism",
  "Crucible",
  "Nexus",
  "Forge",
  "Drift",
  "Axiom",
  "Haven",
];

/** Trait count range — uniform for all systems. */
export const TRAIT_COUNT = { min: 2, max: 4 } as const;
