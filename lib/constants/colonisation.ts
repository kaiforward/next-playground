/**
 * Colonisation-cost tuning — the establish/land/saturation knobs of the pool-funded expansion model
 * (docs/planned/economy-colonisation-cost.md §1–§3). First-cut, coarse values: only the relative shape
 * matters here (home-first while there is cheap building; expansion accelerating as habitable territory
 * fills). PR4 calibrates the magnitudes in the sequenced `L·σ`-first pass. Each is a tunable *input* with
 * a clear meaning — a per-doctrine lookup feeds them later; the valuation formula never changes.
 */
export const COLONISATION = {
  /**
   * Base settle work for a colony-establish project, BEFORE the bundled seed-housing's build cost is
   * added on top (establishWork = COLONY_ESTABLISH_WORK + housingLevels × housing level-work). The
   * establish cost is paid in the currency of forgone building and spreads over pulses — that spread
   * IS the establish time. A temporary construction stand-in until a treasury prices expansion.
   */
  COLONY_ESTABLISH_WORK: 60,
  /** Value of one unit of habitable land — new habitable land → future pop → future economy. */
  LAND_PREMIUM: 3.0,
  /** Small secondary weight on fungible general space (factories, not pop). */
  LAND_GENERAL_WEIGHT: 0.5,
  /** Small secondary weight on deposit richness (Σ deposit slots). */
  LAND_DEPOSIT_WEIGHT: 4.0,
  /**
   * Share of the land value that stays live BEFORE saturation — the land-grab instinct. 0 = expand only
   * when saturated (tall/builder); →1 = grab land regardless of home state (expansionist). The primary
   * "expansionist vs not" dial (doctrine feeds it later).
   */
  SIGMA_FLOOR: 0.25,
  /**
   * Weight on the seed-population opportunity cost netted off a colony's value (§7.3). The cost is the
   * source's forgone output for the part of the seed that must come from staffed (not idle) workers,
   * so founding naturally prefers a job-short source; this dial bridges that lost-production figure into
   * the value scalar. Coarse first-cut (per-doctrine later); PR4 calibrates it against LAND_PREMIUM/σ.
   */
  SEED_POP_COST_WEIGHT: 1.0,
} as const;
