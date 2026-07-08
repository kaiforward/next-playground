import { getWorld } from "@/lib/world/store";
import { buildingsBySystem, flowEventsBySystem, systemNameById } from "@/lib/services/world-index";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import { bucketizeVolumeHistory } from "@/lib/engine/system-trade-flow";
import { buildFlowEdges, type RawFlowRow } from "@/lib/engine/trade-flow-edges";
import type {
  TradeFlowEdges,
  SystemLogisticsData,
} from "@/lib/types/api";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { capacityGoodRates, inputDemandFromProduction } from "@/lib/engine/industry";
import {
  aggregateLogisticsFlows,
  buildLogisticsRows,
  type LogisticsFlowRow,
} from "@/lib/engine/logistics";

/**
 * Returns the directed-logistics map-overlay edge set, aggregated over the last
 * `FLOW_HISTORY_TICKS`.
 */
export function getTradeFlowEdges(): TradeFlowEdges {
  const world = getWorld();
  const minTick = world.meta.currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  // Group by (from, to, good, flowType) summing quantity over the window.
  const grouped = new Map<string, RawFlowRow>();
  for (const f of world.flowEvents) {
    if (f.tick <= minTick || f.quantity <= 0) continue;
    const key = `${f.fromSystemId}|${f.toSystemId}|${f.goodId}|${f.flowType}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += f.quantity;
    } else {
      grouped.set(key, {
        fromSystemId: f.fromSystemId,
        toSystemId: f.toSystemId,
        goodId: f.goodId,
        quantity: f.quantity,
        flowType: f.flowType,
      });
    }
  }

  const allSystemIds = new Set(world.systems.map((s) => s.id));
  const { logisticsEdges } = buildFlowEdges(
    [...grouped.values()],
    allSystemIds,
    TRADE_SIMULATION.ROUTE_INFERENCE_FLOOR,
    TRADE_SIMULATION.LOGISTICS_ROUTE_FLOOR,
  );
  return { logisticsEdges };
}

/**
 * Per-system Logistics tab data: internal production/consumption rates +
 * external imports/exports (split by flow type) + the volume-over-time series.
 */
export function getSystemLogistics(systemId: string): SystemLogisticsData {
  const world = getWorld();
  const currentTick = world.meta.currentTick;
  const minTick = currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  const system = world.systems.find((s) => s.id === systemId);
  if (!system) return { visibility: "unknown" };

  const flows = (flowEventsBySystem().get(systemId) ?? []).filter((f) => f.tick > minTick);

  const buildings: Record<string, number> = buildingsBySystem().get(systemId) ?? {};
  const yields = resourceVectorFromColumns(
    {
      yieldGas: system.yieldGas, yieldMinerals: system.yieldMinerals, yieldOre: system.yieldOre,
      yieldBiomass: system.yieldBiomass, yieldArable: system.yieldArable,
      yieldWater: system.yieldWater, yieldRadioactive: system.yieldRadioactive,
    },
    "yield",
  );
  const prodCon = capacityGoodRates(buildings, system.population, yields);
  // Manufacturing input demand per good (recipe draw from local factories) — also local
  // consumption, but distinct from the civilian per-capita need carried in prodCon.consumption.
  // Each input's draw is its consumer goods' production, which capacityGoodRates already computed,
  // so read those rates back rather than recomputing buildingProduction per consumer.
  const productionByGood = new Map(prodCon.map((g) => [g.goodId, g.production]));
  const inputDemandByGood = new Map<string, number>();
  for (const g of prodCon) {
    const d = inputDemandFromProduction(g.goodId, productionByGood);
    if (d > 0) inputDemandByGood.set(g.goodId, d);
  }

  const nameById = systemNameById();
  const resolveName = (id: string): string => nameById.get(id) ?? "Unknown System";

  const flowRows: LogisticsFlowRow[] = flows;
  const flowsByGood = aggregateLogisticsFlows(flowRows, systemId, resolveName);
  // Imports/exports are summed over the FLOW_HISTORY_TICKS window; normalise to a
  // per-economy-cycle rate so they share units with the production/consumption rates.
  const cyclesInWindow = TRADE_SIMULATION.FLOW_HISTORY_TICKS / ECONOMY_UPDATE_INTERVAL;
  const model = buildLogisticsRows(prodCon, flowsByGood, cyclesInWindow, inputDemandByGood);

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
