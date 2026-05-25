import { prisma } from "@/lib/prisma";
import { getPlayerVisibility } from "./visibility-cache";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

/**
 * Aggregated trade flow on one edge over the rolling history window.
 *
 * Edges are undirected for visualization — particles flowing both ways on
 * the same connection collapse into a single entry. `totalVolume` is the
 * sum of all quantities regardless of direction; `dominantGoodId` is the
 * highest-volume good across both directions. `perGood` exposes the full
 * breakdown so the UI can colour or filter without a second query.
 */
export interface TradeFlowEdge {
  /** Lexicographically smaller endpoint id (canonical orientation). */
  fromSystemId: string;
  /** Lexicographically larger endpoint id. */
  toSystemId: string;
  totalVolume: number;
  dominantGoodId: string;
  perGood: Record<string, number>;
}

export interface TradeFlowData {
  edges: TradeFlowEdge[];
}

/**
 * Returns aggregate trade flow per edge over the last `FLOW_HISTORY_TICKS`,
 * filtered to edges where at least one endpoint is in the player's
 * visibility set. Filtering happens server-side so we never leak galaxy-wide
 * commerce intel via the network response.
 */
export async function getTradeFlowEdges(
  playerId: string,
): Promise<TradeFlowData> {
  const { visibleSet, currentTick } = await getPlayerVisibility(playerId);

  if (visibleSet.size === 0) {
    return { edges: [] };
  }

  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  // One indexed groupBy. (tick, fromSystemId/toSystemId, goodId) covers the
  // window scan; aggregation per (from, to, good) is the smallest unit we need
  // before collapsing to undirected edges in JS.
  const grouped = await prisma.tradeFlow.groupBy({
    by: ["fromSystemId", "toSystemId", "goodId"],
    where: { tick: { gt: minTick } },
    _sum: { quantity: true },
  });

  // Collapse to undirected edges keyed by sorted endpoint pair.
  const byEdge = new Map<
    string,
    {
      fromSystemId: string;
      toSystemId: string;
      perGood: Map<string, number>;
    }
  >();

  for (const row of grouped) {
    const qty = row._sum.quantity ?? 0;
    if (qty <= 0) continue;

    const [a, b] =
      row.fromSystemId < row.toSystemId
        ? [row.fromSystemId, row.toSystemId]
        : [row.toSystemId, row.fromSystemId];

    // Visibility gate: at least one endpoint must be visible.
    if (!visibleSet.has(a) && !visibleSet.has(b)) continue;

    const key = `${a}|${b}`;
    let entry = byEdge.get(key);
    if (!entry) {
      entry = { fromSystemId: a, toSystemId: b, perGood: new Map() };
      byEdge.set(key, entry);
    }
    entry.perGood.set(
      row.goodId,
      (entry.perGood.get(row.goodId) ?? 0) + qty,
    );
  }

  const edges: TradeFlowEdge[] = [];
  for (const { fromSystemId, toSystemId, perGood } of byEdge.values()) {
    let totalVolume = 0;
    let dominantGoodId = "";
    let dominantVolume = 0;
    const perGoodObj: Record<string, number> = {};
    for (const [goodId, vol] of perGood) {
      totalVolume += vol;
      perGoodObj[goodId] = vol;
      if (vol > dominantVolume) {
        dominantVolume = vol;
        dominantGoodId = goodId;
      }
    }
    if (totalVolume < TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR) continue;
    edges.push({
      fromSystemId,
      toSystemId,
      totalVolume,
      dominantGoodId,
      perGood: perGoodObj,
    });
  }

  return { edges };
}
