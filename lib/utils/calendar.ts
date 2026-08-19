import {
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  EPOCH_YEAR,
  TICKS_PER_DAY,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
} from "@/lib/constants/calendar";
import { HOURS_PER_TICK } from "@/lib/constants/tick-cadence";
import { ticksToHours } from "./math";

/** A moment on the fictional calendar. `month` and `day` are 1-based; `hour` is 0/6/12/18. */
export interface GameDate {
  year: number;
  month: number;
  day: number;
  hour: number;
}

/** The fictional-calendar date of a tick. Tick 0 is `EPOCH_YEAR.01.01 00:00`. */
export function tickToDate(tick: number): GameDate {
  const yearTick = tick % TICKS_PER_YEAR;
  const monthTick = yearTick % TICKS_PER_MONTH;
  return {
    year: EPOCH_YEAR + Math.floor(tick / TICKS_PER_YEAR),
    month: Math.floor(yearTick / TICKS_PER_MONTH) + 1,
    day: Math.floor(monthTick / TICKS_PER_DAY) + 1,
    hour: (monthTick % TICKS_PER_DAY) * HOURS_PER_TICK,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Stellaris-style date stamp: `2350.01.01`. The one rendering of an absolute tick. */
export function formatDate(tick: number): string {
  const d = tickToDate(tick);
  return `${d.year}.${pad2(d.month)}.${pad2(d.day)}`;
}

/** The tick's position within its day as a clock reading: `00:00` / `06:00` / `12:00` / `18:00`. */
export function formatTimeOfDay(tick: number): string {
  return `${pad2(tickToDate(tick).hour)}:00`;
}

const unit = (value: number, word: string): string =>
  `≈${value} ${word}${value === 1 ? "" : "s"}`;

/**
 * A tick count as an auto-scaled in-world duration — the one rule every duration surface shares:
 * under a day → exact hours; under 45 days → whole days; under 300 days → months (half-month
 * steps below 3); beyond → years (tenths below 3). Scaled figures carry `≈`; the hours branch is
 * exact and doesn't. Per-cycle *rates* (`/cyc`) are out of scope — the cycle stays the economic
 * unit; this converts durations only.
 */
export function formatDuration(ticks: number): string {
  const days = ticks / TICKS_PER_DAY;
  if (days < 1) return `${ticksToHours(ticks)} hours`;
  if (days < 45) return unit(Math.round(days), "day");
  if (days < 300) {
    const months = days / DAYS_PER_MONTH;
    return unit(months < 3 ? Math.round(months * 2) / 2 : Math.round(months), "month");
  }
  const years = days / DAYS_PER_YEAR;
  return unit(years < 3 ? Math.round(years * 10) / 10 : Math.round(years), "year");
}
