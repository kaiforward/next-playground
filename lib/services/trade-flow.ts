import { prisma } from "@/lib/prisma";
import { getPlayerVisibility } from "./visibility-cache";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { bucketizeVolumeHistory } from "@/lib/engine/system-trade-flow";
import { buildFlowEdges, type RawFlowRow } from "@/lib/engine/trade-flow-edges";
import type {
  TradeFlowEdges,
  SystemLogisticsData,
} from "@/lib/types/api";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { capacityGoodRates } from "@/lib/engine/industry";
import {
  aggregateLogisticsFlows,
  buildLogisticsRows,
  type LogisticsFlowRow,
} from "@/lib/engine/logistics";

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
 * Per-system Logistics tab data: internal production/consumption rates +
 * external imports/exports (split by flow type) + the volume-over-time series.
 * Visibility-gated: an unsurveyed system returns `{ visibility: "unknown" }`.
 */
export async function getSystemLogistics(
  playerId: string,
  systemId: string,
): Promise<SystemLogisticsData> {
  const { visibleSet, currentTick } = await getPlayerVisibility(playerId);
  if (!visibleSet.has(systemId)) return { visibility: "unknown" };

  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  const [system, flows] = await Promise.all([
    prisma.starSystem.findUnique({
      where: { id: systemId },
      relationLoadStrategy: "join",
      select: {
        population: true,
        yieldGas: true, yieldMinerals: true, yieldOre: true, yieldBiomass: true,
        yieldArable: true, yieldWater: true, yieldRadioactive: true,
        buildings: { select: { buildingType: true, count: true } },
      },
    }),
    prisma.tradeFlow.findMany({
      where: {
        tick: { gt: minTick },
        OR: [{ fromSystemId: systemId }, { toSystemId: systemId }],
      },
      select: {
        tick: true, fromSystemId: true, toSystemId: true,
        goodId: true, quantity: true, flowType: true,
      },
    }),
  ]);

  if (!system) return { visibility: "unknown" };

  const buildings: Record<string, number> = {};
  for (const b of system.buildings) buildings[b.buildingType] = b.count;
  const yields = resourceVectorFromColumns(
    {
      yieldGas: system.yieldGas, yieldMinerals: system.yieldMinerals, yieldOre: system.yieldOre,
      yieldBiomass: system.yieldBiomass, yieldArable: system.yieldArable,
      yieldWater: system.yieldWater, yieldRadioactive: system.yieldRadioactive,
    },
    "yield",
  );
  const prodCon = capacityGoodRates(buildings, system.population, yields);

  // Resolve partner system names once (no N+1) for the source/destination tooltips.
  // Only name partners the player can actually see; an unsurveyed partner stays
  // anonymous ("Unknown System" fallback below) so this endpoint never discloses
  // the identity of a system the player hasn't surveyed — same server-side
  // visibility gate the map-overlay edge sets apply.
  const partnerIds = new Set<string>();
  for (const f of flows) {
    const partnerId = f.fromSystemId === systemId ? f.toSystemId : f.fromSystemId;
    if (visibleSet.has(partnerId)) partnerIds.add(partnerId);
  }
  const partnerRows = await prisma.starSystem.findMany({
    where: { id: { in: [...partnerIds] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(partnerRows.map((r) => [r.id, r.name]));
  const resolveName = (id: string): string => nameById.get(id) ?? "Unknown System";

  const flowRows: LogisticsFlowRow[] = flows;
  const flowsByGood = aggregateLogisticsFlows(flowRows, systemId, resolveName);
  const model = buildLogisticsRows(prodCon, flowsByGood);

  return {
    visibility: "visible",
    rows: model.rows,
    internalMax: model.internalMax,
    externalMax: model.externalMax,
    activeGoodCount: model.activeGoodCount,
    tradedGoodCount: model.tradedGoodCount,
    volumeHistory: bucketizeVolumeHistory(flows, systemId, currentTick),
  };
}
