

/** Shape of tuneable universe generation parameters. */
interface UniverseGenConfig {
  SEED: number;
  REGION_COUNT: number;
  TOTAL_SYSTEMS: number;
  MAP_SIZE: number;
  MAP_PADDING: number;
  POISSON_MIN_DISTANCE: number;
  POISSON_K_CANDIDATES: number;
  REGION_MIN_DISTANCE: number;
  INTRA_REGION_EXTRA_EDGES: number;
  GATEWAY_FUEL_MULTIPLIER: number;
  GATEWAYS_PER_BORDER: number;
  INTRA_REGION_BASE_FUEL: number;
  /** Max rejection sampling attempts before falling back to grid-jitter. */
  MAX_PLACEMENT_ATTEMPTS: number;
}

// ── Scale presets ───────────────────────────────────────────────

/** Default universe: 600 systems in a 7000×7000 map. */
const BASE_CONFIG: UniverseGenConfig = {
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
  MAX_PLACEMENT_ATTEMPTS: 500,
};

export type UniverseScale = "default" | "10k";

/**
 * Scale preset overrides. Each key maps to fields that differ from BASE_CONFIG.
 * 10K: 10,000 systems in a 25,000×25,000 map (16×16 grid → ~39 systems/tile).
 */
const SCALE_OVERRIDES: Record<UniverseScale, Partial<UniverseGenConfig>> = {
  default: {},
  "10k": {
    TOTAL_SYSTEMS: 10_000,
    MAP_SIZE: 25_000,
    REGION_COUNT: 60,
    REGION_MIN_DISTANCE: 2_500,
  },
};

function resolveScale(): UniverseScale {
  const env = process.env.UNIVERSE_SCALE ?? "default";
  if (env in SCALE_OVERRIDES) return env as UniverseScale;
  const valid = Object.keys(SCALE_OVERRIDES).join(", ");
  throw new Error(`Invalid UNIVERSE_SCALE="${env}". Valid values: ${valid}`);
}

/** Active scale preset, resolved from UNIVERSE_SCALE env var. */
export const ACTIVE_SCALE: UniverseScale = resolveScale();

/** Tuneable universe generation parameters (merged with active scale preset). */
export const UNIVERSE_GEN: UniverseGenConfig = {
  ...BASE_CONFIG,
  ...SCALE_OVERRIDES[ACTIVE_SCALE],
};

/** Flat pool of generic space region names (28 names, cycled with suffix for >28 regions). */
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
