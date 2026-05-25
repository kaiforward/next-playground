import { prisma } from "@/lib/prisma";
import { getPlayerVisibility } from "./visibility-cache";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import {
  bucketizeVolumeHistory,
  rankGoodFlows,
} from "@/lib/engine/system-trade-flow";
import type {
  SystemTradeFlowData,
  TradeFlowEdgeInfo,
} from "@/lib/types/api";

interface DirectionalGoodTally {
  /** Volume in canonical-from → canonical-to direction. */
  forward: number;
  /** Volume in canonical-to → canonical-from direction. */
  reverse: number;
}

/**
 * Returns aggregate trade flow per edge over the last `FLOW_HISTORY_TICKS`,
 * filtered to edges where at least one endpoint is in the player's
 * visibility set. Filtering happens server-side so we never leak galaxy-wide
 * commerce intel via the network response.
 */
export async function getTradeFlowEdges(
  playerId: string,
): Promise<{ edges: TradeFlowEdgeInfo[] }> {
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

  // Collapse to undirected edges keyed by sorted endpoint pair, but preserve
  // per-direction tallies so we can recover net flow direction below.
  interface EdgeAgg {
    canonicalFrom: string;
    canonicalTo: string;
    perGood: Map<string, DirectionalGoodTally>;
  }
  const byEdge = new Map<string, EdgeAgg>();

  for (const row of grouped) {
    const qty = row._sum.quantity ?? 0;
    if (qty <= 0) continue;

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
    if (isForward) tally.forward += qty;
    else tally.reverse += qty;
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

    if (totalVolume < TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR) continue;

    // Net direction is taken from the dominant good. Ties (perfect balance) fall
    // back to canonical orientation rather than blinking direction over time.
    const fromSystemId = dominantNet >= 0 ? canonicalFrom : canonicalTo;
    const toSystemId = dominantNet >= 0 ? canonicalTo : canonicalFrom;

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

// ── Per-system trade flow detail (PR 3) ──────────────────────────

/**
 * Returns top imports / exports and a bucketed volume sparkline for one
 * system. Visibility-gated: an invisible system returns empty data instead
 * of leaking activity intel.
 */
export async function getSystemTradeFlow(
  playerId: string,
  systemId: string,
): Promise<SystemTradeFlowData> {
  const { visibleSet, currentTick } = await getPlayerVisibility(playerId);

  const EMPTY: SystemTradeFlowData = {
    topImports: [],
    topExports: [],
    volumeHistory: bucketizeVolumeHistory([], systemId, currentTick),
  };

  if (!visibleSet.has(systemId)) return EMPTY;

  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  const flows = await prisma.tradeFlow.findMany({
    where: {
      tick: { gt: minTick },
      OR: [{ fromSystemId: systemId }, { toSystemId: systemId }],
    },
    select: {
      tick: true,
      fromSystemId: true,
      toSystemId: true,
      goodId: true,
      quantity: true,
    },
  });

  if (flows.length === 0) return EMPTY;

  // Resolve partner system names in one batched query so the rendered
  // imports/exports lists can show real names without N+1 lookups.
  const partnerIds = new Set<string>();
  for (const f of flows) {
    partnerIds.add(f.fromSystemId === systemId ? f.toSystemId : f.fromSystemId);
  }
  const partnerRows = await prisma.starSystem.findMany({
    where: { id: { in: [...partnerIds] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(partnerRows.map((r) => [r.id, r.name]));
  const resolveName = (id: string): string => nameById.get(id) ?? id;

  return {
    topImports: rankGoodFlows(
      flows.filter((f) => f.toSystemId === systemId),
      (f) => f.fromSystemId,
      resolveName,
    ),
    topExports: rankGoodFlows(
      flows.filter((f) => f.fromSystemId === systemId),
      (f) => f.toSystemId,
      resolveName,
    ),
    volumeHistory: bucketizeVolumeHistory(flows, systemId, currentTick),
  };
}
