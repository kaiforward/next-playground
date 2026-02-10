/** Economy simulation constants — used by seed (initial values) and economy processor (drift). */
export const ECONOMY_CONSTANTS = {
  /** How quickly supply/demand revert to equilibrium (0-1, fraction per tick). */
  REVERSION_RATE: 0.05,
  /** Random noise amplitude (+/- units per tick). */
  NOISE_AMPLITUDE: 3,
  /** Supply/demand floor. */
  MIN_LEVEL: 5,
  /** Supply/demand ceiling. */
  MAX_LEVEL: 200,
  /** Units of supply generated per tick by producers. */
  PRODUCTION_RATE: 3,
  /** Units of supply consumed per tick by consumers. */
  CONSUMPTION_RATE: 2,
} as const;

/** Equilibrium targets by good relationship to economy type. */
export const EQUILIBRIUM_TARGETS = {
  produces: { supply: 120, demand: 40 },
  consumes: { supply: 40, demand: 120 },
  neutral: { supply: 60, demand: 60 },
} as const;
