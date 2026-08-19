/**
 * Calibration anchor — NOT a knob. The divisor in `catchUpFactor`; frozen at the
 * cadence the economy was tuned at, so the reference config is behaviour-identical
 * and needs no re-tune. Turn the knobs below, never this.
 *
 * Because every rate in the game is denominated against it, it is also the only
 * correct denominator for normalising a window-summed quantity into a rate
 * comparable with those rates — see `buildLogisticsRows`. A cadence knob is not:
 * it agrees only while it happens to equal this value.
 */
export const REFERENCE_INTERVAL = 24;

/**
 * One "cycle" = the societal resolution period, in ticks. Economy, population,
 * infrastructure-decay, and migration resolve for the whole galaxy on the cycle's
 * first tick (`tick % CYCLE_LENGTH === 0`). A real knob: every rider scales by
 * `catchUpFactor`, so tuning it changes the resolution granularity — the pacing of
 * every cycle-denominated rate. It is no longer true that this leaves wall-clock
 * rates untouched: a cycle's in-world length is DERIVED as
 * `CYCLE_LENGTH × HOURS_PER_TICK`, so retuning `CYCLE_LENGTH` also changes how many
 * in-world hours a "week" spans — it changes the length of the week, never the tick.
 */
export const CYCLE_LENGTH = 24;

/**
 * One tick = this many in-world hours. Calendar anchor, not a pacing knob: it defines what a
 * tick MEANS in in-world time, independent of `CYCLE_LENGTH` (the societal resolution period)
 * and `REFERENCE_INTERVAL` (the rate-calibration anchor) — neither of those is the calendar.
 * External anchor: Victoria 3 runs 4 ticks/day, so 24 ÷ 4 = 6 in-world hours per tick.
 *
 * Derived language (use `ticksToHours`, `lib/utils/math.ts`, for the conversion): 4 ticks/day;
 * cycle = `CYCLE_LENGTH × HOURS_PER_TICK` = 24 × 6 = 144 h = 6 in-world days (a fictional
 * "week"); ≈60.9 cycles/year (365.25 days ÷ 6-day cycle); 1 year ≈ 1,461 ticks (365.25 days ×
 * 4 ticks/day). A cycle's in-world length is always DERIVED from `CYCLE_LENGTH ×
 * HOURS_PER_TICK`, never a second literal — retuning `CYCLE_LENGTH` changes the week's length,
 * never the tick.
 *
 * Documentation-of-meaning plus a conversion helper for future display work (player-facing
 * fictional-date rendering) — no processor reads this constant this pass.
 */
export const HOURS_PER_TICK = 6;

/** The construction cycle, in ticks. Independent of CYCLE_LENGTH — relative pacing knob. */
export const CONSTRUCTION_INTERVAL = 24;

/** The logistics cycle, in ticks. Independent of CYCLE_LENGTH — relative pacing knob. */
export const LOGISTICS_INTERVAL = 24;

/** Per-run cadence override (dev/test surface — the live loop always uses the constants). */
export interface TickCadence {
  cycle: number;
  construction: number;
  logistics: number;
}
