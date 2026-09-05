import { getWorld } from "@/lib/world/store";
import { buildingsBySystem, flowEventsBySystem, laneFuelCost, marketsBySystem, systemNameById } from "@/lib/services/world-index";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";
import { bucketVolumeHistory } from "@/lib/engine/system-trade-flow";
import { buildLaneFlowEdges, type LaneFlowRow } from "@/lib/engine/trade-flow-edges";
import { isEconomicallyActive } from "@/lib/engine/control";
import { LANES } from "@/lib/constants/lanes";
import { GOODS } from "@/lib/constants/goods";
import type {
  TradeFlowEdges,
  SystemLogisticsData,
  TransitRow,
} from "@/lib/types/api";
import type { World } from "@/lib/world/types";
import { yieldsOf, effOf } from "@/lib/engine/resources";
import { capacityGoodRates } from "@/lib/engine/industry";
import { useRatesByGood } from "@/lib/engine/honest-demand";
import {
  aggregateLogisticsFlows,
  buildLogisticsRows,
} from "@/lib/engine/logistics-readout";

/**
 * Returns the directed-logistics map-overlay edge set: one edge per (lane, direction) PHYSICALLY
 * carrying freight right now, read straight from the scheduled-freight ledger (`WorldPendingArrival`)
 * — a haul contributes to the one hop it's currently crossing, not a window-summed chord between its
 * origin and destination, and not every lane its route will ever touch. A ledger with nothing in
 * flight reads as zero edges.
 */
export function getTradeFlowEdges(): TradeFlowEdges {
  const world = getWorld();
  const hopFuelCostsOf = (row: LaneFlowRow): number[] => row.routeEdges.map(laneFuelCost);
  const logisticsEdges = buildLaneFlowEdges(
    world.pendingArrivals,
    TRADE_SIMULATION.LOGISTICS_ROUTE_FLOOR,
    world.meta.currentTick,
    hopFuelCostsOf,
    LANES.FREIGHT_SPEED,
  );
  return { logisticsEdges };
}

/**
 * Freight in flight to/from `systemId` right now, split by direction — present only while
 * `arrivalTick > currentTick` (docs/active/gameplay/logistics-lanes.md §6): a row disappears the tick the
 * goods-arrivals stage credits it, never filtered by this function's caller. Read straight off the
 * scheduled-freight ledger (`WorldPendingArrival`), not a window sum.
 */
function buildTransitRows(
  world: World,
  systemId: string,
  currentTick: number,
  resolveName: (id: string) => string,
): { inbound: TransitRow[]; outbound: TransitRow[] } {
  const inbound: TransitRow[] = [];
  const outbound: TransitRow[] = [];
  for (const arrival of world.pendingArrivals) {
    if (arrival.arrivalTick <= currentTick) continue;
    if (arrival.toSystemId === systemId) {
      inbound.push({
        goodId: arrival.goodId,
        goodName: GOODS[arrival.goodId]?.name ?? arrival.goodId,
        quantity: arrival.quantity,
        otherSystemId: arrival.fromSystemId,
        otherSystemName: resolveName(arrival.fromSystemId),
        arrivalTick: arrival.arrivalTick,
      });
    } else if (arrival.fromSystemId === systemId) {
      outbound.push({
        goodId: arrival.goodId,
        goodName: GOODS[arrival.goodId]?.name ?? arrival.goodId,
        quantity: arrival.quantity,
        otherSystemId: arrival.toSystemId,
        otherSystemName: resolveName(arrival.toSystemId),
        arrivalTick: arrival.arrivalTick,
      });
    }
  }
  return { inbound, outbound };
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
  const extractionEff = effOf(system);
  // The strike × maintenance scalar the economy persisted on the system's rows (all carry the
  // same one; absent reads as unsuppressed). Production and the recipe draw below both carry it,
  // so every term of a row's internalNet describes the same operating state — a striking world
  // must not show full output beside a quarter of the input draw that output implies.
  const marketRows = marketsBySystem().get(systemId) ?? [];
  const productionSuppress = marketRows.find((m) => typeof m.productionSuppressRate === "number")
    ?.productionSuppressRate ?? 1;
  const rates = capacityGoodRates(buildings, system.population, yields, extractionEff);
  const prodCon = rates.map((r) => ({ ...r, production: r.production * productionSuppress }));
  // Manufacturing input demand per good (recipe draw from local factories) — also local
  // consumption, but distinct from the civilian per-capita need carried in prodCon.consumption.
  // This is the same USE figure the logistics matcher and the build planner size against, from the
  // one shared function: a second capacity computation living here is how the panel and the network
  // come to disagree about what a world draws.
  const inputDemandByGood = new Map<string, number>();
  for (const [goodId, use] of useRatesByGood({
    buildings, population: system.population, yields, extractionEff, productionSuppress, rates,
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
    volumeHistory: bucketVolumeHistory(flows, systemId, currentTick),
    transit: buildTransitRows(world, systemId, currentTick, resolveName),
  };
}
