import type { EconomySimParams } from "@/lib/engine/tick";

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
 * denominated in the use figure and the system's own output (`BRAKE_USE_COVER` /
 * `BRAKE_RAMP` / `BRAKE_OUTPUT_COVER` below), and warehouse/logistics policy in
 * cycles of real demand by its own constants (`EXPORT_RESERVE_COVER`,
 * `WAREHOUSE_COVER`, `DONOR_RESERVE_COVER`, `FOUNDING_STOCK_COVER`) — held
 * equal to or authored against this value where noted in their docstrings,
 * never derived from it.
 */
export const TARGET_COVER = 40;

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
   * to 0 at BRAKE_RAMP × knee. No price-anchor quantity and no storage term —
   * the deceleration zone that absorbs shocks; a self-supplier with margin
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
export const ECONOMY_SIM_PARAMS: Readonly<EconomySimParams> = {
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
 * Provision shortfall (`1 − provision()`, a linear mean — a partial shortfall reads its own size, not
 * its square) at or above which the unrest slope BEGINS ramping from `slopeRationing` toward
 * `slopeShortage` (full Shortage weight lands at cut + blend = 0.90). Its only consumer is
 * `unrestSlope` — the band bins Provision directly and never reads this cut — which is why it is
 * authored as ESCALATION-ONLY: it does not separate ambient scarcity from famine (the
 * survival floor already does that job outright), it only decides when the ramp engages. Set well
 * above every measured founding shortfall (p10 0.59, mean 0.27 — equilibrium founding cohort,
 * n = 562, docs/planned/supply-response.md) so a newborn colony's own worst reading never engages it.
 * The old gap-1/squared-scale anchors (≈0.14 ambient, ≈0.37 water, as D values on the squared fold)
 * carried no information about the linear scale and are retired rather than restated. Re-derive
 * rather than nudge if the founding shortfall distribution moves
 * (lib/constants/__tests__/band-constants.test.ts pins it above the measured p10).
 */
export const D_SHORTAGE_CUT = 0.65;

/**
 * Width of the D band above the cut across which the unrest slope ramps from the Rationing value to
 * the Shortage one — full Shortage weight lands at shortfall 0.90. The ramp starts AT the cut and
 * never below it, so no system takes a hard step in settled unrest for an arbitrarily small change in
 * delivered goods. Escalation-only, like the cut it extends: it no longer marks where a band boundary
 * sits (the band bins Provision directly instead), only how fast the ramp climbs once above it.
 */
export const D_SHORTAGE_BLEND = 0.25;

/**
 * Provision at or above which a system bands Supplied — the healthiest of the four descriptive
 * bands (Supplied / Strained / Rationing / Shortage). A legibility line only: no gameplay effect
 * reads the band (effects that scale with supply read Provision or the shortfall directly instead),
 * so moving this edge is a display decision, not a balance one. Inclusive: Provision exactly at this
 * value still bands Supplied. Set from the measured distribution: the mature galaxy reads ~92-96%
 * Supplied at this edge (7.9% below it at 10k ticks, 4.0% at 12k), the young galaxy 80/8/12 across
 * the three Provision bands (19.8% below this edge, 11.9% below RATIONING_PROVISION at 1k ticks) —
 * healthy reads healthy, founding stress stays visible.
 */
export const SUPPLIED_PROVISION = 0.9;

/**
 * Provision below which a system bands Rationing rather than Strained — the boundary between "worth
 * watching" and "actively short". Also a legibility line only, for the same reason as
 * SUPPLIED_PROVISION. Exclusive on the low side: Provision exactly at this value still bands
 * Strained, the low edge of the Strained band rather than the high edge of Rationing.
 */
export const RATIONING_PROVISION = 0.7;

/**
 * Civilian satisfaction below which a demanded good counts toward the critical-good override's
 * weight (see `unrestSlope`) — a good under a quarter met is critical. Its own constant, not
 * SHORTAGE_SATISFACTION: the famine line and the criticality line must be able to move
 * independently, and extending SHORTAGE_SATISFACTION to a third meaning would fuse them
 * permanently. Set at half of SHORTAGE_SATISFACTION (0.5) — "collapsed" is a distinctly worse state
 * than shortage-grade. The measured per-good satisfaction distribution is a cliff (goods delivered
 * in full or not at all), so any line strictly between 0 and 0.5 catches the same worlds today; this
 * value binds only on future partial-satisfaction states, which is why it is authored as a rule
 * rather than tuned to a fit. A strict `<` boundary: exactly this level does not count.
 */
export const CRITICAL_SATISFACTION = 0.25;

/**
 * A demanded good's minimum share of a world's total civilian demand (the same demand-only share
 * `worstDemandedGoods` computes) to be eligible for the critical-good override's weight — override
 * eligibility only. There is no band-level demand floor: the band bins Provision directly, and
 * Provision's own weighting (`demanded × necessity`) already discounts negligible demand on its own.
 * Below 1% of a world's demand basket a good is a trace entry, not a real need: this excludes
 * exactly the epsilon skilled-basket goods (measured shares 0.005-0.010) while a good genuinely held
 * at 1-5% of the basket (e.g. medicine, necessity 0.8) still counts. Survival goods are immune to
 * this floor by construction — the survival step promotes the whole system to Shortage regardless of
 * demand share. Re-check this value if a high-necessity good is ever deliberately authored at a
 * trace demand share.
 */
export const BAND_MIN_DEMAND_SHARE = 0.01;
