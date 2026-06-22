import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";

export interface ShardWindow { start: number; end: number; }

/**
 * Half-open window [start, end) of a stably-sorted item list to process on
 * `tick`, given `interval` ticks to cover the whole list once. Group
 * `tick % interval` of an even split — across any `interval` consecutive ticks
 * every index is covered exactly once. Decouples performance sharding from any
 * gameplay/topology concept.
 */
export function shardRange(total: number, tick: number, interval: number): ShardWindow {
  if (total <= 0) return { start: 0, end: 0 };
  const iv = Math.max(1, Math.floor(interval));
  const g = ((tick % iv) + iv) % iv; // non-negative group index
  return { start: Math.floor((g * total) / iv), end: Math.floor(((g + 1) * total) / iv) };
}

/**
 * Rate multiplier so a sharded processor applies "elapsed-ticks worth" per run:
 * interval / REFERENCE_INTERVAL. At the reference interval it is 1 (calibrated
 * magnitudes unchanged); tuning the interval changes only granularity, not the
 * wall-clock rate. Keep production and consumption scaled symmetrically.
 */
export function catchUpFactor(interval: number): number {
  return interval / REFERENCE_INTERVAL;
}
