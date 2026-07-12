/**
 * Per-system development stat tuning. First-draft; per-doctrine-ready, calibrated
 * against the simulator. `systemDevelopment` blends population-fill and
 * industry-fill against each system's own fixed physical potential.
 * See docs/planned/economy-colony-bootstrapping.md §7.7b.
 */
export const DEVELOPMENT = {
  /** Weight on the population-fill term (population ÷ habitable-potential pop). */
  POP_WEIGHT: 0.5,
  /** Weight on the industry-fill term (staffed industry ÷ industry potential). */
  INDUSTRY_WEIGHT: 0.5,
} as const;
