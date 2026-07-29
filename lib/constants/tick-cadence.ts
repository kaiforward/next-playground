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
 * `catchUpFactor`, so tuning it changes granularity, not wall-clock rates.
 */
export const CYCLE_LENGTH = 24;

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
