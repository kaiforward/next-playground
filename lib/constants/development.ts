/**
 * Per-system development stat tuning. `systemDevelopment` is an ABSOLUTE magnitude — how much a system
 * has actually built and worked — soft-saturated against the UNIVERSE-WIDE reference (the galaxy's
 * biggest natural potential, `DevelopmentRefs`), NOT a fill fraction of the system's own potential. The
 * reference is derived from static substrate at read time (`developmentRefs`), so the only tuning here
 * is the blend of the two terms. See docs/build-plans/colony-bootstrapping.md §1.
 */
export const DEVELOPMENT = {
  /** Weight on the population term (resident population soft-saturated against the universe popRef). */
  POP_WEIGHT: 0.5,
  /** Weight on the industry term (staffed industry soft-saturated against the universe industryRef). */
  INDUSTRY_WEIGHT: 0.5,
} as const;
