/**
 * Cycles of cover (stock ÷ local demand rate) at which a good's mid price equals
 * its basePrice — the pricing reference (`targetStock = TARGET_COVER × demandRate
 * × anchorMult`). The single global reference that replaces the per-good anchor
 * table — per-good market depth emerges from per-good demand rates.
 *
 * The single global cover lever for the 26-good roster: at 40, every good keeps
 * non-trivial cross-system price dispersion, so staples (deep cover) and advanced
 * goods (thin cover) are both tradeable at once. Lower values pin advanced goods
 * to the price floor (cheap everywhere); higher values pin staples to the ceiling.
 * Per-good imbalances are tuned via each good's production coeff / per-capita need
 * (see physical-economy.ts); this stays the whole-roster knob.
 *
 * A PRICING constant, with no physical rider: the production brake is
 * denominated in the use figure and physical storage (`BRAKE_USE_COVER` /
 * `BRAKE_RAMP` / `BRAKE_OUTPUT_COVER` below), and warehouse/logistics policy in
 * cycles of real demand by its own constants (`EXPORT_RESERVE_COVER`,
 * `WAREHOUSE_COVER`, `DONOR_RESERVE_COVER`, `FOUNDING_STOCK_COVER`) — held
 * equal to or authored against this value where noted in their docstrings,
 * never derived from it.
 */
export const TARGET_COVER = 40;

import type { EconomySimParams } from "@/lib/engine/tick";

/** Economy simulation constants — used by the economy tick. */
export const ECONOMY_CONSTANTS = {
  /**
   * Cycles of the USE figure (`honestUseRate` — what this system's population
   * and industry draw when running) the brake knee's warehousing term covers:
   * `knee ≥ BRAKE_USE_COVER × honestUseRate × anchorMult`. With BRAKE_RAMP it
   * preserves the retired anchor brake's geometry exactly on markets where the
   * use figure equals the old floored `demandRate` — the deliberate no-op
   * anchor for the brake's move off the price curve.
   */
  BRAKE_USE_COVER: 40,
  /**
   * Taper width: production runs at full rate to the knee, then ramps linearly
   * to 0 at BRAKE_RAMP × knee — capped by physical built storage
   * (`facilityStorageForGood`), never by any price-anchor quantity. The
   * deceleration zone that absorbs shocks; a self-supplier with margin
   * capacity rests just above its knee.
   */
  BRAKE_RAMP: 1.3,
  /**
   * Cycles of reference-cycle capacity the knee's working-inventory term
   * covers: `knee ≥ BRAKE_OUTPUT_COVER × capacityProduction`. The answer to
   * the pure-exporter trap — a producer with negligible local use keeps a
   * working yard sized to its own output instead of a near-zero knee. A
   * FIRST-CUT HYPOTHESIS: tuned only by the stage-3 A/B (the per-good
   * knee-binding-term table is the evidence it is tuned on).
   */
  BRAKE_OUTPUT_COVER: 8,
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
 * ECONOMY_CONSTANTS in the engine's param shape — the one definition every live
 * brake call site (the tick, the decay/selling signal, the Industry readout,
 * the draw figure's brake pass) passes to `brakeKnee`, so they cannot disagree
 * about where a producer idles.
 */
export const ECONOMY_SIM_PARAMS: EconomySimParams = {
  brakeUseCover: ECONOMY_CONSTANTS.BRAKE_USE_COVER,
  brakeRamp: ECONOMY_CONSTANTS.BRAKE_RAMP,
  brakeOutputCover: ECONOMY_CONSTANTS.BRAKE_OUTPUT_COVER,
  rationCover: ECONOMY_CONSTANTS.RATION_COVER,
};

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
