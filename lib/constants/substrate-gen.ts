import type { QualityBandId } from "@/lib/types/game";

/**
 * Tunable parameters for substrate generation.
 * First-draft defaults; calibrated via `npm run simulate` + scripts/substrate-coherence.ts.
 */
export const SUBSTRATE_GEN = {
  /** Body size multiplier band, uniform. */
  SIZE_MIN: 0.5,
  SIZE_MAX: 1.5,
  /** Narrative feature count per system, uniform inclusive. */
  FEATURE_COUNT: { min: 0, max: 2 },
  /** Economy-type classifier thresholds (see lib/engine/economy-type.ts). */
  ECON_POP_HIGH: 7000,        // population reference for "high population"
  ECON_POP_HIGH_FRAC: 0.6,    // popNorm ≥ this → developed economy
  ECON_RAW_DOMINANT: 0.5,     // raw share ≥ this → extraction / industrial
  ECON_FOOD_DOMINANT: 0.35,   // food share ≥ this → agricultural
  ECON_RAW_MIXED: 0.3,        // below this raw share + high pop → tech
  /** Physical space (surface/volume units) per body size point. Sized so a developed system supports
   * billions of people — a spacefaring civilisation's core, not a town. Scales all physical capacity
   * (deposit slots, general + habitable space) uniformly, so every economic ratio is preserved. */
  SPACE_PER_SIZE: 400,
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
