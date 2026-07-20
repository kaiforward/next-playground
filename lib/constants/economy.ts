/** Economy simulation constants — used by the economy tick. */
export const ECONOMY_CONSTANTS = {
  /**
   * Operating-ceiling cover: a producer holds up to HOLD_COVER × the days-of-supply
   * anchor (targetStock) before idling spare capacity. The production ceiling factor
   * runs at full rate to the anchor, then ramps linearly to 0 over
   * [targetStock, HOLD_COVER × targetStock] instead of at the storage ceiling, so
   * equilibrium stock rests just above the anchor (price near base) rather than at
   * maxStock (price floored). Calibrated against the simulator's coarse health
   * bar: 1.3 lifts the galaxy-wide price median to ~1.08x base (from a floored ~0.63x),
   * keeps an up-the-chain spread (advanced goods dear, raws near base), no ceiling
   * pinning, with population growth and unrest sane. See experiments/examples/equilibrium-calibration.yaml.
   */
  HOLD_COVER: 1.3,
  /**
   * Comfort knee as a fraction of the days-of-supply anchor: full civilian
   * delivery and full industrial input draws at/above COMFORT_COVER ×
   * targetStock; the shared scarcity ramp runs below it. One constant shared
   * by the sim, the seed clamp, the planners, and the regime classification so
   * mechanics and UI cannot disagree about where "comfortable" ends.
   */
  COMFORT_COVER: 0.75,
} as const;
