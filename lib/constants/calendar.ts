import { HOURS_PER_TICK } from "./tick-cadence";

/**
 * The fictional display calendar. Every unit here derives from the tick via `HOURS_PER_TICK`
 * (the calendar anchor) and deliberately NOT from `CYCLE_LENGTH`: the economic cycle is a pacing
 * knob, and retuning it must never move a rendered date. Display-only — nothing in the tick or
 * save reads any of these.
 *
 * The year is a clean fictional 360 days (12 × 30-day months = 1,440 ticks), distinct from the
 * ~1,461-tick real-unit year (365.25 days) that rate-calibration math uses. Rates stay anchored
 * to real units; the calendar the player reads is the fictional one.
 */
export const EPOCH_YEAR = 2350;

/** 24 in-world hours ÷ 6 hours per tick = 4 ticks per day. */
export const TICKS_PER_DAY = 24 / HOURS_PER_TICK;

export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;

export const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * MONTHS_PER_YEAR;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
