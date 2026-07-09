/**
 * Pure aggregation for the directed-logistics MAP OVERLAY. The service in
 * `lib/services/trade-flow.ts` window-sums raw flow rows and feeds them here to
 * produce the undirected edge set the Pixi layer renders.
 *
 * Pure: no I/O. Unit-tested against in-memory rows.
 */

import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/** One window-summed flow between two systems for one good. */
export interface RawFlowRow {
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  /** Window-summed magnitude (rows with quantity <= 0 are ignored). */
  quantity: number;
}

interface DirectionalGoodTally {
  /** Volume in canonical-from → canonical-to direction. */
  forward: number;
  /** Volume in canonical-to → canonical-from direction. */
  reverse: number;
}

/**
 * Collapse window-summed flow rows into undirected edges keyed by the sorted
 * endpoint pair, recovering net direction from the dominant good. Drops edges
 * below `floor` cumulative volume and edges with no visible endpoint.
 */
export function buildFlowEdges(
  rows: ReadonlyArray<RawFlowRow>,
  visibleSet: Set<string>,
  floor: number,
): TradeFlowEdgeInfo[] {
  interface EdgeAgg {
    canonicalFrom: string;
    canonicalTo: string;
    perGood: Map<string, DirectionalGoodTally>;
  }
  const byEdge = new Map<string, EdgeAgg>();

  for (const row of rows) {
    if (row.quantity <= 0) continue;

    const isForward = row.fromSystemId < row.toSystemId;
    const [a, b] = isForward
      ? [row.fromSystemId, row.toSystemId]
      : [row.toSystemId, row.fromSystemId];

    // Visibility gate: at least one endpoint must be visible.
    if (!visibleSet.has(a) && !visibleSet.has(b)) continue;

    const key = `${a}|${b}`;
    let entry = byEdge.get(key);
    if (!entry) {
      entry = { canonicalFrom: a, canonicalTo: b, perGood: new Map() };
      byEdge.set(key, entry);
    }
    let tally = entry.perGood.get(row.goodId);
    if (!tally) {
      tally = { forward: 0, reverse: 0 };
      entry.perGood.set(row.goodId, tally);
    }
    if (isForward) tally.forward += row.quantity;
    else tally.reverse += row.quantity;
  }

  const edges: TradeFlowEdgeInfo[] = [];
  for (const { canonicalFrom, canonicalTo, perGood } of byEdge.values()) {
    let totalVolume = 0;
    let dominantGoodId = "";
    let dominantNet = 0;
    let dominantMagnitude = 0;
    const perGoodObj: Record<string, number> = {};

    for (const [goodId, tally] of perGood) {
      const magnitude = tally.forward + tally.reverse;
      totalVolume += magnitude;
      perGoodObj[goodId] = magnitude;
      if (magnitude > dominantMagnitude) {
        dominantMagnitude = magnitude;
        dominantGoodId = goodId;
        dominantNet = tally.forward - tally.reverse;
      }
    }

    if (totalVolume < floor) continue;

    // Net direction from the dominant good; ties fall back to canonical order.
    const fromSystemId = dominantNet >= 0 ? canonicalFrom : canonicalTo;
    const toSystemId = dominantNet >= 0 ? canonicalTo : canonicalFrom;
    edges.push({ fromSystemId, toSystemId, totalVolume, dominantGoodId, perGood: perGoodObj });
  }
  return edges;
}
