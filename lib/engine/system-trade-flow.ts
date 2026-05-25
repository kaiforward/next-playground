/**
 * Pure aggregation helpers for the per-system trade-flow detail surface
 * (PR 3 of the trade-flow series). The service in `lib/services/trade-flow.ts`
 * loads raw `TradeFlow` rows from Prisma and feeds them through these helpers
 * to produce the panel-facing shape.
 *
 * Pure: no Prisma, no I/O. Safe to import from anywhere and unit-test
 * directly against an in-memory array of rows.
 */

import { GOODS } from "@/lib/constants/goods";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import type {
  TradeFlowGoodSummary,
  TradeFlowVolumeBucket,
} from "@/lib/types/api";

/** Minimal flow row shape consumed by the aggregation helpers. */
export interface SystemFlowRow {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}

/** Goods shown per import/export list. */
const TOP_GOODS_PER_DIRECTION = 5;
/** Partner systems shown nested under each good. */
const TOP_PARTNERS_PER_GOOD = 3;
/** Sparkline bucket count — 200-tick window / 20 = 10-tick buckets. */
export const VOLUME_HISTORY_BUCKETS = 20;

/**
 * Aggregate flows into the top-N goods by total quantity, with the top
 * partner systems contributing to each good.
 */
export function rankGoodFlows(
  flows: ReadonlyArray<SystemFlowRow>,
  getPartnerId: (f: SystemFlowRow) => string,
  resolveName: (id: string) => string,
): TradeFlowGoodSummary[] {
  const byGood = new Map<
    string,
    { total: number; byPartner: Map<string, number> }
  >();

  for (const f of flows) {
    if (f.quantity <= 0) continue;
    let entry = byGood.get(f.goodId);
    if (!entry) {
      entry = { total: 0, byPartner: new Map() };
      byGood.set(f.goodId, entry);
    }
    entry.total += f.quantity;
    const partner = getPartnerId(f);
    entry.byPartner.set(
      partner,
      (entry.byPartner.get(partner) ?? 0) + f.quantity,
    );
  }

  return [...byGood.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, TOP_GOODS_PER_DIRECTION)
    .map(([goodId, { total, byPartner }]) => ({
      goodId,
      goodName: GOODS[goodId]?.name ?? goodId,
      totalQuantity: total,
      partners: [...byPartner.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_PARTNERS_PER_GOOD)
        .map(([partnerId, quantity]) => ({
          systemId: partnerId,
          systemName: resolveName(partnerId),
          quantity,
        })),
    }));
}

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
