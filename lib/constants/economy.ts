/** Days of total local demand held at the price/base reserve anchor. */
export const TARGET_COVER = 40;

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
   * Emergency stock cover in demand cycles. Civilian delivery and industrial
   * input draws remain full while stock covers at least this many cycles of
   * total local demand; below it, explicit rationing ramps toward zero at empty.
   * Deliberately independent of the 40-cycle pricing/reserve anchor: an
   * underfilled strategic reserve is not itself an unmet current need.
   */
  RATION_COVER: 2,
} as const;
