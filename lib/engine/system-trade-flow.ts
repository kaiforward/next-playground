/**
 * Pure aggregation helpers for the per-system trade-flow detail surface.
 * The service in `lib/services/trade-flow.ts` loads raw `TradeFlow` rows
 * from Prisma and feeds them through these helpers to produce the
 * panel-facing shape.
 *
 * Pure: no Prisma, no I/O. Safe to import from anywhere and unit-test
 * directly against an in-memory array of rows.
 */

import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import type { TradeFlowVolumeBucket } from "@/lib/types/api";

/** Minimal flow row shape consumed by the aggregation helpers. */
export interface SystemFlowRow {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}

/** Sparkline bucket count — the FLOW_HISTORY_TICKS window is split across this many buckets. */
export const VOLUME_HISTORY_BUCKETS = 20;

/**
 * Bucketize flows by tick into a fixed-length sparkline window. Buckets are
 * sized so the full window spans `FLOW_HISTORY_TICKS`; older flows fall off
 * the front, newer flows land in the last bucket.
 *
 * Each bucket's `tick` is its right edge (inclusive) so the chart's X axis
 * reads "ticks ago" naturally.
 */
export function bucketizeVolumeHistory(
  flows: ReadonlyArray<SystemFlowRow>,
  systemId: string,
  currentTick: number,
): TradeFlowVolumeBucket[] {
  const windowSize = TRADE_SIMULATION.FLOW_HISTORY_TICKS;
  // ceil keeps the full window covered when it isn't evenly divisible.
  const bucketSize = Math.max(
    1,
    Math.ceil(windowSize / VOLUME_HISTORY_BUCKETS),
  );
  const startTick = currentTick - bucketSize * VOLUME_HISTORY_BUCKETS + 1;

  const buckets: TradeFlowVolumeBucket[] = Array.from(
    { length: VOLUME_HISTORY_BUCKETS },
    (_, i) => ({
      tick: startTick + (i + 1) * bucketSize - 1,
      importVolume: 0,
      exportVolume: 0,
    }),
  );

  for (const f of flows) {
    const offset = f.tick - startTick;
    if (offset < 0) continue;
    const idx = Math.min(
      Math.floor(offset / bucketSize),
      VOLUME_HISTORY_BUCKETS - 1,
    );
    if (f.toSystemId === systemId) buckets[idx].importVolume += f.quantity;
    else if (f.fromSystemId === systemId)
      buckets[idx].exportVolume += f.quantity;
  }

  return buckets;
}
