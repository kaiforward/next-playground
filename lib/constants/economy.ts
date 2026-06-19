/** Economy simulation constants — used by seed (initial stock) and the economy tick (noise + bounds). */
export const ECONOMY_CONSTANTS = {
  /** Random noise amplitude (+/- units per tick). */
  NOISE_AMPLITUDE: 3,
  /** Stock floor. */
  MIN_LEVEL: 5,
  /** Stock ceiling. */
  MAX_LEVEL: 200,
} as const;
