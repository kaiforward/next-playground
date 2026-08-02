/** Cycles of total local demand held at the price/base reserve anchor. */
export const TARGET_COVER = 40;

/** Economy simulation constants — used by the economy tick. */
export const ECONOMY_CONSTANTS = {
  /**
   * Operating-ceiling cover: a producer holds up to HOLD_COVER × the cycles-of-supply
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
   *
   * The gap between the logistics deficit signal (0.8 × the 40-cycle WAREHOUSE_COVER, denominated
   * in real demand) and this knee is roughly 30 logistics cycles, and logistics resolves every
   * cycle — a system that starves never ran out of warning, it ran out of supply or of budget to
   * move it. Widening this buffer is never the fix for a starving galaxy; the early warning belongs
   * in the UI, not in unrest.
   */
  RATION_COVER: 2,
} as const;

/**
 * Civilian satisfaction (delivered/demanded) below which a demanded good counts as a Shortage rather
 * than mere Rationing. Its live consumer is the survival-good floor (`foldSupplyState`): water or food
 * below this level selects Shortage for the whole system whatever the fold says. A strict `<`
 * boundary: exactly this level is still Rationing.
 */
export const SHORTAGE_SATISFACTION = 0.5;

/**
 * System dissatisfaction D at or above which the supply regime reads Shortage rather than Rationing.
 * Cut against the measured 26-good basket under GOOD_NECESSITY: the ambient barren-galaxy deficit
 * (every tier-1 and tier-2 good empty) folds to ≈0.14 while a total water failure folds to ≈0.37, so
 * any cut in (0.141, 0.319] grades famine as Shortage and ambient scarcity as Rationing. Both
 * endpoints are scenario values, not constants — moving any necessity weight moves them, so re-derive
 * rather than nudge (lib/constants/__tests__/band-constants.test.ts asserts the separation holds).
 * First cut; the simulator owns the final.
 */
export const D_SHORTAGE_CUT = 0.25;

/**
 * Width of the D band above the cut across which the unrest slope ramps from the Rationing value to
 * the Shortage one. The ramp starts AT the cut and never below it, so the Rationing containment
 * guarantee (sustained Rationing cannot reach collapse at any tax) holds across the whole Rationing
 * range; a hard branch here would instead double a system's settled unrest for an arbitrarily small
 * change in delivered goods, and land that step across strike onset. Narrow enough that a total food
 * failure still reaches the full Shortage slope — asserted from the constants, not assumed.
 */
export const D_SHORTAGE_BLEND = 0.05;
