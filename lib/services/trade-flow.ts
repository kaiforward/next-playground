import { getWorld } from "@/lib/world/store";
import { buildingsBySystem, flowEventsBySystem, marketsBySystem, systemNameById } from "@/lib/services/world-index";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";
import { bucketizeVolumeHistory } from "@/lib/engine/system-trade-flow";
import { buildFlowEdges, type RawFlowRow } from "@/lib/engine/trade-flow-edges";
import { isEconomicallyActive } from "@/lib/engine/control";
import type {
  TradeFlowEdges,
  SystemLogisticsData,
} from "@/lib/types/api";
import { yieldsOf } from "@/lib/engine/resources";
import { capacityGoodRates } from "@/lib/engine/industry";
import { useRatesByGood } from "@/lib/engine/honest-demand";
import {
  aggregateLogisticsFlows,
  buildLogisticsRows,
} from "@/lib/engine/logistics";

/**
 * Returns the directed-logistics map-overlay edge set, aggregated over the last
 * `FLOW_HISTORY_TICKS`.
 */
export function getTradeFlowEdges(): TradeFlowEdges {
  const world = getWorld();
  const minTick = world.meta.currentTick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;

  // Group by (from, to, good) summing quantity over the window.
  const grouped = new Map<string, RawFlowRow>();
  for (const f of world.flowEvents) {
    if (f.tick <= minTick || f.quantity <= 0) continue;
    const key = `${f.fromSystemId}|${f.toSystemId}|${f.goodId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += f.quantity;
    } else {
      grouped.set(key, {
        fromSystemId: f.fromSystemId,
        toSystemId: f.toSystemId,
        goodId: f.goodId,
        quantity: f.quantity,
      });
    }
  }

  const allSystemIds = new Set(world.systems.map((s) => s.id));
  const logisticsEdges = buildFlowEdges(
    [...grouped.values()],
    allSystemIds,
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
  if (!system || !isEconomicallyActive(system.control)) return { visibility: "unknown" };

  const flows = (flowEventsBySystem().get(systemId) ?? []).filter((f) => f.tick > minTick);

  const buildings: Record<string, number> = buildingsBySystem().get(systemId) ?? {};
  const yields = yieldsOf(system);
  // The strike × maintenance scalar the economy persisted on the system's rows (all carry the
  // same one; absent reads as unsuppressed). Production and the recipe draw below both carry it,
  // so every term of a row's internalNet describes the same operating state — a striking world
  // must not show full output beside a quarter of the input draw that output implies.
  const marketRows = marketsBySystem().get(systemId) ?? [];
  const productionSuppress = marketRows.find((m) => typeof m.productionSuppressRate === "number")
    ?.productionSuppressRate ?? 1;
  const rates = capacityGoodRates(buildings, system.population, yields);
  const prodCon = rates.map((r) => ({ ...r, production: r.production * productionSuppress }));
  // Manufacturing input demand per good (recipe draw from local factories) — also local
  // consumption, but distinct from the civilian per-capita need carried in prodCon.consumption.
  // This is the same USE figure the logistics matcher and the build planner size against, from the
  // one shared function: a second capacity computation living here is how the panel and the network
  // come to disagree about what a world draws.
  const inputDemandByGood = new Map<string, number>();
  for (const [goodId, use] of useRatesByGood({
    buildings, population: system.population, yields, productionSuppress, rates,
  })) {
    if (use.industrial > 0) inputDemandByGood.set(goodId, use.industrial);
  }

  const nameById = systemNameById();
  const resolveName = (id: string): string => nameById.get(id) ?? "Unknown System";

  const flowsByGood = aggregateLogisticsFlows(flows, systemId, resolveName);
  // Imports/exports are summed over the FLOW_HISTORY_TICKS window; normalise to a
  // per-REFERENCE_INTERVAL rate so they share units with the production/consumption
  // rates, which are `capacityGoodRates` values (production suppress-scaled above) the
  // economy applies scaled by catchUpFactor — one rate per reference interval whatever
  // CYCLE_LENGTH is.
  // Dividing by the logistics (or economy) cycle count instead is correct only while
  // that cadence equals REFERENCE_INTERVAL. See buildLogisticsRows' docstring.
  const referenceCyclesInWindow = TRADE_SIMULATION.FLOW_HISTORY_TICKS / REFERENCE_INTERVAL;
  const model = buildLogisticsRows(prodCon, flowsByGood, referenceCyclesInWindow, inputDemandByGood);

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
