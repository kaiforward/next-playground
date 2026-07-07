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
  /** Minor factions seeded alongside the 8 majors. */
  MINOR_FACTION_COUNT: number;
}

// ── Anchor configs ──────────────────────────────────────────────

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
  MINOR_FACTION_COUNT: 12,
};

/**
 * 10k anchor knob values, typed as concrete numbers so genConfigForSystemCount
 * can read them as interpolation anchors without a cast.
 * 10K: 10,000 systems in a 25,000×25,000 map (16×16 grid → ~39 systems/tile).
 */
const TEN_K_OVERRIDES = {
  TOTAL_SYSTEMS: 10_000,
  MAP_SIZE: 25_000,
  REGION_COUNT: 60,
  REGION_MIN_DISTANCE: 2_500,
  MINOR_FACTION_COUNT: 18,
} as const;

/**
 * Default system count for a new game — the BASE_CONFIG anchor. Start-screen
 * default, simulator default, and calibration instruments all key off this.
 */
export const DEFAULT_SYSTEM_COUNT = BASE_CONFIG.TOTAL_SYSTEMS;

// ── Continuous generation config (arbitrary system count) ──────

/** √N anchor points: the two known presets used to derive every scale-dependent knob. */
const SQRT_ANCHOR_600 = Math.sqrt(BASE_CONFIG.TOTAL_SYSTEMS);
const SQRT_ANCHOR_10K = Math.sqrt(TEN_K_OVERRIDES.TOTAL_SYSTEMS);

/**
 * Linear interpolation in √N space, anchored at (600, valueAt600) and (10_000, valueAt10k):
 * value(N) = a + b·√N, where b = (valueAt10k − valueAt600) / (√10000 − √600)
 * and a = valueAt600 − b·√600. Extrapolates for N outside [600, 10_000].
 */
function interpolateBySqrtN(systemCount: number, valueAt600: number, valueAt10k: number): number {
  const slope = (valueAt10k - valueAt600) / (SQRT_ANCHOR_10K - SQRT_ANCHOR_600);
  const intercept = valueAt600 - slope * SQRT_ANCHOR_600;
  return intercept + slope * Math.sqrt(systemCount);
}

/**
 * Derives a full UniverseGenConfig for an arbitrary system count (50–20,000 in practice).
 * Every knob SCALE_OVERRIDES["10k"] overrides is interpolated continuously in √N space,
 * anchored at the 600-system and 10,000-system presets (see interpolateBySqrtN); knobs the
 * 10k preset doesn't touch stay at their BASE_CONFIG constant. TOTAL_SYSTEMS is the input
 * itself, not a formula. Region/faction counts are floored at 1 so extreme low N can't
 * produce a degenerate 0-region or 0-minor-faction universe.
 */
export function genConfigForSystemCount(systemCount: number): UniverseGenConfig {
  return {
    ...BASE_CONFIG,
    TOTAL_SYSTEMS: Math.round(systemCount),
    MAP_SIZE: Math.round(
      interpolateBySqrtN(systemCount, BASE_CONFIG.MAP_SIZE, TEN_K_OVERRIDES.MAP_SIZE)
    ),
    REGION_COUNT: Math.max(
      1,
      Math.round(
        interpolateBySqrtN(systemCount, BASE_CONFIG.REGION_COUNT, TEN_K_OVERRIDES.REGION_COUNT)
      )
    ),
    REGION_MIN_DISTANCE: Math.round(
      interpolateBySqrtN(
        systemCount,
        BASE_CONFIG.REGION_MIN_DISTANCE,
        TEN_K_OVERRIDES.REGION_MIN_DISTANCE
      )
    ),
    MINOR_FACTION_COUNT: Math.max(
      1,
      Math.round(
        interpolateBySqrtN(
          systemCount,
          BASE_CONFIG.MINOR_FACTION_COUNT,
          TEN_K_OVERRIDES.MINOR_FACTION_COUNT
        )
      )
    ),
  };
}

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
