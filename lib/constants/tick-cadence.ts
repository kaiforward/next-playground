/**
 * Calibration anchor — NOT a knob. The divisor in `catchUpFactor`; frozen at the
 * cadence the economy was tuned at, so the reference config is behaviour-identical
 * and needs no re-tune. Turn the knobs below, never this.
 */
export const REFERENCE_INTERVAL = 24;

/**
 * One "month" = the societal resolution-pulse period, in ticks. Economy,
 * population, infrastructure-decay, and migration resolve for the whole galaxy on
 * ticks where `tick % MONTH_LENGTH === 0`. A real knob: every rider scales by
 * `catchUpFactor`, so tuning it changes granularity, not wall-clock rates.
 */
export const MONTH_LENGTH = 24;

/** Directed-build's resolution pulse, in ticks. Independent of MONTH_LENGTH — relative pacing knob. */
export const CONSTRUCTION_INTERVAL = 24;

/** Directed-logistics' resolution pulse, in ticks. Independent of MONTH_LENGTH — relative pacing knob. */
export const LOGISTICS_INTERVAL = 24;
