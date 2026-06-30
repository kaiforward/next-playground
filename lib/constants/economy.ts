/** Economy simulation constants — used by the economy tick. */
export const ECONOMY_CONSTANTS = {
  /** Noise as a fraction of the per-entry band width (used by the relative-noise tick). */
  NOISE_FRACTION: 0.02,
  /**
   * Operating-ceiling cover: a producer holds up to HOLD_COVER × the days-of-supply
   * anchor (targetStock) before idling spare capacity. The production self-limiting
   * factor runs over [minStock, HOLD_COVER × targetStock] instead of the storage
   * ceiling, so equilibrium stock rests just above the anchor (price near base) rather
   * than at maxStock (price floored). First-draft 1.3 — calibrated via the simulator.
   */
  HOLD_COVER: 1.3,
} as const;
