/**
 * Per-system development stat tuning. First-draft, grounded in observed simulator magnitudes;
 * per-doctrine-ready, calibrated in PR4. `systemDevelopment` is an ABSOLUTE magnitude — how much a
 * system has actually built and worked — soft-saturated against a fixed reference, NOT a fill
 * fraction of the system's own potential (a tiny full colony must read low, a large capital high).
 * See docs/planned/economy-colony-bootstrapping.md §7.7b.
 */
export const DEVELOPMENT = {
  /** Weight on the population term (resident population soft-saturated against POP_REF). */
  POP_WEIGHT: 0.5,
  /** Weight on the industry term (staffed industry soft-saturated against INDUSTRY_REF). */
  INDUSTRY_WEIGHT: 0.5,
  /**
   * Reference population of a "fully developed" system: the population at which the pop term reaches
   * 1 − 1/e ≈ 0.63. Sim p90 homeworld ≈ 240, median colony ≈ 52, so this puts capitals high and
   * colonies low. Calibration knob.
   */
  POP_REF: 150,
  /**
   * Reference staffed-industry magnitude (deposit-slot + general-space units) of a "fully developed"
   * system: the level at which the industry term reaches ≈ 0.63. Sim p90 homeworld ≈ 22, median
   * colony ≈ 1, so a bare colony reads near zero and a built-out capital high. Calibration knob.
   */
  INDUSTRY_REF: 12,
} as const;
