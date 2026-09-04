/**
 * Pure aggregation for the directed-logistics MAP OVERLAY. The service in
 * `lib/services/trade-flow.ts` reads the scheduled-freight ledger (`WorldPendingArrival`) and feeds
 * it here to produce the per-lane directed edge set the Pixi layer renders.
 *
 * Unlike the retired chord builder (one row per system PAIR, aggregated from window-summed flow
 * events), a haul's route is a list of lane hops (`routeEdges`) and this module walks each row's
 * hops individually — a haul crossing three lanes contributes to three edges, not one chord between
 * its origin and destination. Pure: no I/O. Unit-tested against in-memory rows.
 */

import { laneEndpoints } from "@/lib/engine/lanes";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/** The one shape this module needs from a `WorldPendingArrival` ledger row. */
export interface LaneFlowRow {
  fromSystemId: string;
  goodId: string;
  /** In-flight magnitude (rows with quantity <= 0 are ignored). */
  quantity: number;
  /** Ordered lane-key hops the haul crosses, `fromSystemId` → its eventual destination. */
  routeEdges: string[];
}

interface DirectedEdgeAgg {
  fromSystemId: string;
  toSystemId: string;
  perGood: Map<string, number>;
  total: number;
}

/**
 * Collapse in-flight ledger rows into one edge per (lane, direction), keyed by
 * `${laneKey}|${fromSystemId}`. Each row's hop sequence is reconstructed by walking `routeEdges` in
 * order from `fromSystemId`: a lane key names its two endpoints (`laneEndpoints`), and the endpoint
 * NOT equal to the current position is the hop's destination, which becomes the current position for
 * the next hop. Drops edges below `floor` cumulative volume.
 */
export function buildLaneFlowEdges(
  rows: ReadonlyArray<LaneFlowRow>,
  floor: number,
): TradeFlowEdgeInfo[] {
  const byEdge = new Map<string, DirectedEdgeAgg>();

  for (const row of rows) {
    if (row.quantity <= 0) continue;

    let current = row.fromSystemId;
    for (const laneKey of row.routeEdges) {
      const [a, b] = laneEndpoints(laneKey);
      const next = current === a ? b : a;
      const key = `${laneKey}|${current}`;

      let entry = byEdge.get(key);
      if (!entry) {
        entry = { fromSystemId: current, toSystemId: next, perGood: new Map(), total: 0 };
        byEdge.set(key, entry);
      }
      entry.perGood.set(row.goodId, (entry.perGood.get(row.goodId) ?? 0) + row.quantity);
      entry.total += row.quantity;

      current = next;
    }
  }

  const edges: TradeFlowEdgeInfo[] = [];
  for (const [key, agg] of byEdge) {
    if (agg.total < floor) continue;
    const laneKey = key.slice(0, key.lastIndexOf("|"));

    let dominantGoodId = "";
    let dominantMagnitude = 0;
    for (const [goodId, magnitude] of agg.perGood) {
      if (magnitude > dominantMagnitude) {
        dominantMagnitude = magnitude;
        dominantGoodId = goodId;
      }
    }

    edges.push({
      laneKey,
      fromSystemId: agg.fromSystemId,
      toSystemId: agg.toSystemId,
      totalVolume: agg.total,
      dominantGoodId,
    });
  }
  return edges;
}
