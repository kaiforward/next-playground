import { prisma } from "@/lib/prisma";
import { getPlayerVisibility } from "./visibility-cache";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import {
  bucketizeVolumeHistory,
  rankGoodFlows,
} from "@/lib/engine/system-trade-flow";
import { buildFlowEdges, type RawFlowRow } from "@/lib/engine/trade-flow-edges";
import type {
  SystemTradeFlowData,
  TradeFlowEdges,
} from "@/lib/types/api";

/**
 * Returns the two map-overlay edge sets (market diffusion + directed logistics)
 * aggregated over the last `FLOW_HISTORY_TICKS`, filtered to edges with at
 * least one endpoint in the player's visibility set. Filtering is server-side
 * so we never leak galaxy-wide commerce intel over the wire.
 */
export async function getTradeFlowEdges(playerId: string): Promise<TradeFlowEdges> {
  const { visibleSet, currentTick } = await getPlayerVisibility(playerId);

  if (visibleSet.size === 0) {
    return { marketEdges: [], logisticsEdges: [] };
  }

  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  // One indexed groupBy, now split by flowType so the two overlays render apart.
  const grouped = await prisma.tradeFlow.groupBy({
    by: ["fromSystemId", "toSystemId", "goodId", "flowType"],
    where: { tick: { gt: minTick } },
    _sum: { quantity: true },
  });

  const rows: RawFlowRow[] = [];
  for (const row of grouped) {
    const qty = row._sum.quantity ?? 0;
    if (qty <= 0) continue;
    rows.push({
      fromSystemId: row.fromSystemId,
      toSystemId: row.toSystemId,
      goodId: row.goodId,
      quantity: qty,
      flowType: row.flowType,
    });
  }

  return buildFlowEdges(
    rows,
    visibleSet,
    TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR,
    TRADE_SIMULATION.LOGISTICS_ROUTE_FLOOR,
  );
}

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
  const resolveName = (id: string): string => nameById.get(id) ?? "Unknown System";

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
