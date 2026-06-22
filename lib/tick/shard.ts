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
 * Inverse of {@link shardRange}: the group `[0, interval)` whose window contains
 * `index` in a stably-sorted list of `total` items — i.e. the shard that processes
 * that item. A system at sorted index `i` updates on ticks where `tick % interval`
 * equals this group. Used to derive a per-system "next update" countdown for display.
 */
export function shardGroupForIndex(index: number, total: number, interval: number): number {
  if (total <= 0) return 0;
  const iv = Math.max(1, Math.floor(interval));
  // shardRange boundary is floor(g·total/iv); the largest g with floor(g·total/iv) ≤ index
  // is ceil((index+1)·iv/total) − 1. Clamp guards float edges at the ends.
  const g = Math.ceil(((index + 1) * iv) / total) - 1;
  return Math.min(iv - 1, Math.max(0, g));
}

/**
 * Ticks until the shard `group` next runs, given the current `tick` — `0` on the
 * tick it runs. Pure clock math (no fetch): pair with a static per-system shard
 * group and a live tick to render a smoothly-counting "next economy update" display.
 */
export function ticksUntilShard(group: number, tick: number, interval: number): number {
  const iv = Math.max(1, Math.floor(interval));
  const current = ((tick % iv) + iv) % iv;
  const g = ((group % iv) + iv) % iv;
  return (((g - current) % iv) + iv) % iv;
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
