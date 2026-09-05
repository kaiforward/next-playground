import { getWorld } from "@/lib/world/store";
import { laneCapacity, laneInvestor, type LaneEndpointOwner } from "@/lib/engine/lanes";
import { currentHopIndex, laneOccupiedAt } from "@/lib/engine/freight";
import { laneFuelCost, systemById } from "@/lib/services/world-index";
import { readoutForFaction } from "@/lib/services/construction";
import { ServiceError } from "@/lib/services/errors";
import { catchUpFactor } from "@/lib/tick/shard";
import { GOODS } from "@/lib/constants/goods";
import { LANES } from "@/lib/constants/lanes";
import { LOGISTICS_INTERVAL } from "@/lib/constants/tick-cadence";
import type { ConstructionProjectLaneRow, FactionConstructionReadout } from "@/lib/engine/construction-readout";
import type { LaneStateRow, LaneDetailData, LaneCargoRow, LaneEndpointDetail } from "@/lib/types/api";
import type { World, WorldPendingArrival } from "@/lib/world/types";

/** The hop-fuel-cost array `currentHopIndex`/`laneOccupiedAt` need for one ledger row, off the
 *  per-version lane fuel-cost index. A hop naming a lane with no connection row throws
 *  (`laneFuelCost`) — that desync is an invariant break, never a free lane. */
function hopFuelCostsOf(row: Pick<WorldPendingArrival, "routeEdges">): number[] {
  return row.routeEdges.map(laneFuelCost);
}

/**
 * The capacity a lane read reports — `laneCapacity(level)` scaled by the logistics cadence's
 * catch-up factor, which is the number this run actually booked against (`decayLanes` and the
 * calibration harness scale the same way). Reporting the raw per-reference-cycle figure would make
 * every load ratio on the map and the lane card wrong by `catchUp` whenever `LOGISTICS_INTERVAL`
 * differs from `REFERENCE_INTERVAL`.
 */
function reportedCapacity(level: number): number {
  return laneCapacity(level) * catchUpFactor(LOGISTICS_INTERVAL);
}

/**
 * Every persisted lane's live state (docs/active/gameplay/logistics-lanes.md §1) — the map layer's lane
 * slice and the lane card's substrate. `capacity` and `investorFactionId` are derived exactly as the
 * tick body derives them (`laneCapacity`, `laneInvestor`, `lib/engine/lanes.ts`); `inFlight` sums the
 * scheduled-freight ledger's quantity for rows PHYSICALLY crossing this lane right now (both legs —
 * a haul in flight either direction still occupies the lane it's on), one hop of a multi-lane route
 * at a time (`laneOccupiedAt`, `lib/engine/freight.ts`) rather than every lane the route ever
 * touches; `openUpgradeLevels` sums whole levels still queued on open `lane_upgrade` construction
 * projects targeting this lane, across every faction.
 */
export function getLaneStates(): LaneStateRow[] {
  const world = getWorld();
  const systems = systemById();
  const tick = world.meta.currentTick;

  const openLevelsByLane = new Map<string, number>();
  for (const project of world.constructionProjects) {
    if (project.kind !== "lane_upgrade") continue;
    openLevelsByLane.set(project.laneKey, (openLevelsByLane.get(project.laneKey) ?? 0) + project.levels);
  }

  const inFlightByLane = new Map<string, number>();
  for (const arrival of world.pendingArrivals) {
    const hop = currentHopIndex(arrival, tick, hopFuelCostsOf(arrival), LANES.FREIGHT_SPEED);
    if (hop === null) continue;
    const laneKey = arrival.routeEdges[hop];
    inFlightByLane.set(laneKey, (inFlightByLane.get(laneKey) ?? 0) + arrival.quantity);
  }

  const ownerOf = (systemId: string): LaneEndpointOwner => {
    const system = systems.get(systemId);
    return system ? { factionId: system.factionId, control: system.control } : { factionId: null, control: "unclaimed" };
  };

  return world.lanes.map((lane) => ({
    key: lane.key,
    aId: lane.aId,
    bId: lane.bId,
    level: lane.level,
    capacity: reportedCapacity(lane.level),
    bookedLoad: lane.bookedLoad,
    blockedVolume: lane.blockedVolume,
    inFlight: inFlightByLane.get(lane.key) ?? 0,
    investorFactionId: laneInvestor(lane, ownerOf),
    openUpgradeLevels: openLevelsByLane.get(lane.key) ?? 0,
  }));
}

function endpointDetail(system: World["systems"][number] | undefined, systemId: string): LaneEndpointDetail {
  return {
    systemId,
    systemName: system?.name ?? "Unknown System",
    factionId: system?.factionId ?? null,
    unclaimed: system === undefined || system.control === "unclaimed",
  };
}

/**
 * One lane's full detail for the lane card (docs/active/gameplay/logistics-lanes.md §6) — everything
 * `LaneStateRow` doesn't carry: endpoint ownership for the invest verb's states, cargo PHYSICALLY
 * crossing this lane right now (one row per ledger entry currently on this hop, not every ledger
 * entry whose route ever touches it), and the open `lane_upgrade` projects targeting it, enriched
 * through the same faction readout the construction surfaces use. Throws `not_found` when `key`
 * names no lane in the current world, like every sibling detail service in the same
 * `buildStateFrame` loop — the frame builder's own `existingLaneKeys` pre-filter is the only place a
 * stale interest id is skipped.
 */
export function getLaneDetail(key: string): LaneDetailData {
  const world = getWorld();
  const lane = world.lanes.find((l) => l.key === key);
  if (!lane) throw new ServiceError(`Lane ${key} not found.`, "not_found");

  const systems = systemById();
  const aSystem = systems.get(lane.aId);
  const bSystem = systems.get(lane.bId);
  const tick = world.meta.currentTick;

  const ownerOf = (systemId: string): LaneEndpointOwner => {
    const system = systems.get(systemId);
    return system ? { factionId: system.factionId, control: system.control } : { factionId: null, control: "unclaimed" };
  };

  const nameOf = (systemId: string): string => systems.get(systemId)?.name ?? "Unknown System";
  const arrivals = world.pendingArrivals.filter((a) =>
    laneOccupiedAt(a, key, tick, hopFuelCostsOf(a), LANES.FREIGHT_SPEED),
  );
  const cargo: LaneCargoRow[] = arrivals.map((a) => ({
    goodId: a.goodId,
    goodName: GOODS[a.goodId]?.name ?? a.goodId,
    quantity: a.quantity,
    fromSystemId: a.fromSystemId,
    fromSystemName: nameOf(a.fromSystemId),
    toSystemId: a.toSystemId,
    toSystemName: nameOf(a.toSystemId),
    arrivalTick: a.arrivalTick,
  }));

  const readoutCache = new Map<string, FactionConstructionReadout>();
  const openProjects: ConstructionProjectLaneRow[] = [];
  for (const project of world.constructionProjects) {
    if (project.kind !== "lane_upgrade" || project.laneKey !== key) continue;
    let readout = readoutCache.get(project.factionId);
    if (!readout) {
      readout = readoutForFaction(project.factionId);
      readoutCache.set(project.factionId, readout);
    }
    const row = readout.all.find(
      (r): r is ConstructionProjectLaneRow => r.kind === "lane_upgrade" && r.id === project.id,
    );
    if (row) openProjects.push(row);
  }

  return {
    key: lane.key,
    fuelCost: laneFuelCost(lane.key),
    a: endpointDetail(aSystem, lane.aId),
    b: endpointDetail(bSystem, lane.bId),
    level: lane.level,
    capacity: reportedCapacity(lane.level),
    bookedLoad: lane.bookedLoad,
    blockedVolume: lane.blockedVolume,
    inFlight: arrivals.reduce((sum, a) => sum + a.quantity, 0),
    idleCycles: lane.idleCycles,
    investorFactionId: laneInvestor(lane, ownerOf),
    cargo,
    openProjects,
  };
}
