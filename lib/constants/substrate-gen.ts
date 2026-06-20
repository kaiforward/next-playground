import type { QualityBandId } from "@/lib/types/game";

/**
 * Tunable parameters for substrate generation.
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
  /** Physical space (surface/volume units) per body size point. */
  SPACE_PER_SIZE: 40,
  /** Footprint consumed by one deposit extraction slot. */
  DEPOSIT_SLOT_FOOTPRINT: 1.0,
  /** Probability a body rolls deposit volatility. */
  VOLATILITY_CHANCE: 0.04,
  /** Volatility spike multiplier on affected deposits. */
  VOLATILITY_SPIKE: 6,
  /** Population baseline floor per body. */
  POP_BASELINE_FLOOR: 0,
} as const;

export interface QualityBand {
  id: QualityBandId;
  min: number;
  max: number;
  weight: number;
}

/** Deposit yield multiplier bands — first-draft; calibrated Phase 4. */
export const QUALITY_BANDS: readonly QualityBand[] = [
  { id: "poor", min: 0.4, max: 0.7, weight: 25 },
  { id: "average", min: 0.8, max: 1.3, weight: 45 },
  { id: "good", min: 1.4, max: 1.8, weight: 22 },
  { id: "rich", min: 1.9, max: 2.5, weight: 8 },
] as const;
