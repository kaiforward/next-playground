import type { QualityBandId } from "@/lib/types/game";

/**
 * Tunable parameters for substrate generation.
 * First-draft defaults; calibrated via `npm run simulate` + scripts/substrate-coherence.ts.
 */
export const SUBSTRATE_GEN = {
  /** Economy-type classifier thresholds (see lib/engine/economy-type.ts). */
  ECON_POP_HIGH: 7000,        // population reference for "high population"
  ECON_POP_HIGH_FRAC: 0.6,    // popNorm ≥ this → developed economy
  ECON_RAW_DOMINANT: 0.5,     // raw share ≥ this → extraction / industrial
  ECON_FOOD_DOMINANT: 0.35,   // food share ≥ this → agricultural
  ECON_RAW_MIXED: 0.3,        // below this raw share + high pop → tech
  /**
   * Land-equivalent of one authored deposit count — the deposit→land conversion `industryPotential`
   * (`lib/engine/development.ts`) uses to keep authored deposit counts (~5-45 per resource per body,
   * summing to a system-level total) and authored industry land (per-body 40-300, summing to a
   * system-level total) commensurable in one additive formula. The surface-partition geometry this
   * coefficient once fed (SIZE_MIN/MAX, SPACE_PER_SIZE) died with `partitionBody`; it now exists
   * solely as this one conversion, read nowhere else (`npm run impact -- DEPOSIT_SLOT_FOOTPRINT`).
   *
   * Derived from the ratio of a system's total industry land to its total deposit-count sum, over
   * `scripts/substrate-coherence.ts`'s natural-gen census (6 seeds × 600 systems, n=3600):
   * industryLand median 436 (p10 174, p90 755) vs depositCounts-sum median 102 (p10 33, p90 185) →
   * ratio median 4.3, mean 4.6 (p10 3.1, p90 6.4). 4.5 sits at the median/mean and is the value
   * authored here — one deposit count is "worth" 4.5 land units of industry footprint, so an
   * extractor-heavy system's worked slots and a factory-heavy system's industry land read as
   * comparable footprint at equal converted magnitude.
   */
  DEPOSIT_SLOT_FOOTPRINT: 4.5,
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
