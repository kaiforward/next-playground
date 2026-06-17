/**
 * Tunable parameters for substrate generation (economy-simulation SP1 PR3a).
 * First-draft defaults; calibrated via `npm run simulate` + scripts/substrate-coherence.ts.
 */
export const SUBSTRATE_GEN = {
  /** Body size multiplier band, uniform. */
  SIZE_MIN: 0.5,
  SIZE_MAX: 1.5,
  /** Per-resource magnitude jitter: base × (1 ± RESOURCE_JITTER). */
  RESOURCE_JITTER: 0.25,
  /** Probability a body rolls one richness modifier. */
  RICHNESS_CHANCE: 0.18,
  /** Abstract population scale: popCap = Σ(body popCapWeight × size) × POP_SCALE. */
  POP_SCALE: 100,
  /** Reference popCap treated as "fully developed" for the seed-fill curve. */
  POP_REF: 2000,
  /** Seed-fill curve: fill = BASE + SLOPE·popNorm + (rng−0.5)·JITTER, clamped [MIN, MAX]. */
  POP_FILL_BASE: 0.1,
  POP_FILL_SLOPE: 0.6,
  POP_FILL_JITTER: 0.2,
  POP_FILL_MIN: 0.05,
  POP_FILL_MAX: 0.9,
  /** Narrative feature count per system, uniform inclusive. */
  FEATURE_COUNT: { min: 0, max: 2 },
  /** Economy-type classifier thresholds (see lib/engine/economy-type.ts). */
  ECON_POP_HIGH: 1000,        // population reference for "high population"
  ECON_POP_HIGH_FRAC: 0.6,    // popNorm ≥ this → developed economy
  ECON_RAW_DOMINANT: 0.5,     // raw share ≥ this → extraction / industrial
  ECON_FOOD_DOMINANT: 0.35,   // food share ≥ this → agricultural
  ECON_RAW_MIXED: 0.3,        // below this raw share + high pop → tech
} as const;
