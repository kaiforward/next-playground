/** Shape of tuneable universe generation parameters. */
interface UniverseGenConfig {
  SEED: number;
  TOTAL_SYSTEMS: number;
  MAP_SIZE: number;
  MAP_PADDING: number;
  POISSON_MIN_DISTANCE: number;
  POISSON_K_CANDIDATES: number;
  INTRA_REGION_EXTRA_EDGES: number;
  CROSSING_FUEL_MULTIPLIER: number;
  INTRA_REGION_BASE_FUEL: number;
  /** Minor factions seeded alongside the 8 majors. */
  MINOR_FACTION_COUNT: number;
  /** Galaxy-shape cluster seed count — a region IS a cluster (spec §5), so this is also the
   *  region count; there is no separate region knob. */
  CLUSTER_COUNT: number;
  /** Cluster size-roll skew: 0 = uniform draw, higher = a few large clusters and many small ones. */
  CLUSTER_SIZE_SKEW: number;
  /** Minimum distance enforced between two cluster seed centers. */
  CLUSTER_SPACING: number;
  /** Density-grid cells below this value read as true void (exactly 0), not merely sparse. */
  VOID_FLOOR: number;
  /** Extra corridor pairs beyond the connectivity-guaranteeing MST, per cluster seed. */
  CORRIDORS_PER_CLUSTER: number;
  /** Bias, 0–1, on the void-fraction threshold that decides whether a corridor pair's measured
   *  seed-to-seed line reads as a crossing (mostly true void) or a band (mostly populated) — not a
   *  probability. 0 pins every pair to band, 1 pins every pair to crossing; between the extremes it
   *  biases which way a borderline line tips (`corridorStyleFor`, `lib/engine/density-field.ts`). */
  CORRIDOR_STYLE_MIX: number;
  /** Per-cluster peak-density swing: 0 = every cluster's peak density reads the same; higher values
   *  dampen some clusters toward diffuse while others stay full. Never a placement/corridor knob —
   *  it rolls from a stream derived from each seed's own position, never the main draw sequence
   *  (`lib/engine/density-field.ts`). */
  CLUSTER_TURBULENCE: number;
}

// ── Anchor configs ──────────────────────────────────────────────

/** Default universe: 600 systems in a 7000×7000 map. */
const BASE_CONFIG: UniverseGenConfig = {
  SEED: 42,
  TOTAL_SYSTEMS: 600,
  MAP_SIZE: 7000,
  MAP_PADDING: 0.10,
  POISSON_MIN_DISTANCE: 180,
  POISSON_K_CANDIDATES: 30,
  INTRA_REGION_EXTRA_EDGES: 0.5,
  CROSSING_FUEL_MULTIPLIER: 2.5,
  INTRA_REGION_BASE_FUEL: 8,
  MINOR_FACTION_COUNT: 12,
  CLUSTER_COUNT: 24,
  CLUSTER_SIZE_SKEW: 0.6,
  CLUSTER_SPACING: 800,
  VOID_FLOOR: 0.08,
  CORRIDORS_PER_CLUSTER: 0.3,
  CORRIDOR_STYLE_MIX: 0.5,
  CLUSTER_TURBULENCE: 0,
};

/**
 * 10k anchor knob values, typed as concrete numbers so genConfigForSystemCount
 * can read them as interpolation anchors without a cast.
 * 10K: 10,000 systems in a 25,000×25,000 map (16×16 grid → ~39 systems/tile).
 */
const TEN_K_OVERRIDES = {
  TOTAL_SYSTEMS: 10_000,
  MAP_SIZE: 25_000,
  MINOR_FACTION_COUNT: 18,
  CLUSTER_COUNT: 60,
  CLUSTER_SPACING: 2_500,
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
    CLUSTER_COUNT: Math.max(
      1,
      Math.round(
        interpolateBySqrtN(systemCount, BASE_CONFIG.CLUSTER_COUNT, TEN_K_OVERRIDES.CLUSTER_COUNT)
      )
    ),
    CLUSTER_SPACING: Math.round(
      interpolateBySqrtN(systemCount, BASE_CONFIG.CLUSTER_SPACING, TEN_K_OVERRIDES.CLUSTER_SPACING)
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
