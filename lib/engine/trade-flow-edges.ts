/**
 * Pure aggregation for the directed-logistics MAP OVERLAY. The service in
 * `lib/services/trade-flow.ts` reads the scheduled-freight ledger (`WorldPendingArrival`) and feeds
 * it here to produce the per-lane directed edge set the Pixi layer renders.
 *
 * Unlike the retired chord builder (one row per system PAIR, aggregated from window-summed flow
 * events), a haul's route is a list of lane hops (`routeEdges`), but this module contributes each
 * row to exactly ONE edge: the hop it is PHYSICALLY crossing at `tick` (`currentHopIndex`,
 * `lib/engine/freight.ts`) — so a haul's particles travel lane by lane along its route over time,
 * rather than lighting up every lane of the route for the haul's whole journey. Pure: no I/O.
 * Unit-tested against in-memory rows.
 */

import { laneEndpoints } from "@/lib/engine/lanes";
import { currentHopIndex } from "@/lib/engine/freight";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/** The one shape this module needs from a `WorldPendingArrival` ledger row. */
export interface LaneFlowRow {
  fromSystemId: string;
  goodId: string;
  /** In-flight magnitude (rows with quantity <= 0 are ignored). */
  quantity: number;
  /** Ordered lane-key hops the haul crosses, `fromSystemId` → its eventual destination. */
  routeEdges: string[];
  dispatchTick: number;
  arrivalTick: number;
}

interface DirectedEdgeAgg {
  fromSystemId: string;
  toSystemId: string;
  perGood: Map<string, number>;
  total: number;
}

/**
 * Collapse in-flight ledger rows into one edge per (lane, direction), keyed by
 * `${laneKey}|${fromSystemId}`. For each row, the hop it's currently on is found via
 * `currentHopIndex`; its direction is read by walking `routeEdges` in order from `fromSystemId`
 * up to that hop (a lane key names its two endpoints — the endpoint NOT equal to the current
 * position is the hop's destination, which becomes the current position for the next hop). A row
 * on no hop right now (already drained, or malformed) contributes nothing. Drops edges below
 * `floor` cumulative volume.
 *
 * `hopFuelCostsOf` must return one fuel cost per `routeEdges` hop, built once per call from the
 * lane network's static fuel costs (never persisted on the row) — see `currentHopIndex`'s own
 * build-once contract.
 */
export function buildLaneFlowEdges(
  rows: ReadonlyArray<LaneFlowRow>,
  floor: number,
  tick: number,
  hopFuelCostsOf: (row: LaneFlowRow) => readonly number[],
  freightSpeed: number,
): TradeFlowEdgeInfo[] {
  const byEdge = new Map<string, DirectedEdgeAgg>();

  for (const row of rows) {
    if (row.quantity <= 0) continue;

    const hop = currentHopIndex(row, tick, hopFuelCostsOf(row), freightSpeed);
    if (hop === null) continue;

    let current = row.fromSystemId;
    for (let i = 0; i < hop; i++) {
      const [a, b] = laneEndpoints(row.routeEdges[i]);
      current = current === a ? b : a;
    }
    const laneKey = row.routeEdges[hop];
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
