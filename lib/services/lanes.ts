import { getWorld } from "@/lib/world/store";
import { laneCapacity, laneInvestor, type LaneEndpointOwner } from "@/lib/engine/lanes";
import { readoutForFaction } from "@/lib/services/construction";
import { GOODS } from "@/lib/constants/goods";
import type { ConstructionProjectLaneRow, FactionConstructionReadout } from "@/lib/engine/construction-readout";
import type { LaneStateRow, LaneDetailData, LaneCargoRow, LaneEndpointDetail } from "@/lib/types/api";
import type { World } from "@/lib/world/types";

/**
 * Every persisted lane's live state (docs/planned/logistics-lanes.md §1) — the map layer's lane
 * slice and the lane card's substrate. `capacity` and `investorFactionId` are derived exactly as the
 * tick body derives them (`laneCapacity`, `laneInvestor`, `lib/engine/lanes.ts`); `inFlight` sums the
 * scheduled-freight ledger's `routeEdges` (both legs — a haul in flight either direction still
 * occupies the lane); `openUpgradeLevels` sums whole levels still queued on open `lane_upgrade`
 * construction projects targeting this lane, across every faction.
 */
export function getLaneStates(): LaneStateRow[] {
  const world = getWorld();
  const systemById = new Map(world.systems.map((s) => [s.id, s]));

  const openLevelsByLane = new Map<string, number>();
  for (const project of world.constructionProjects) {
    if (project.kind !== "lane_upgrade") continue;
    openLevelsByLane.set(project.laneKey, (openLevelsByLane.get(project.laneKey) ?? 0) + project.levels);
  }

  const inFlightByLane = new Map<string, number>();
  for (const arrival of world.pendingArrivals) {
    for (const laneKey of arrival.routeEdges) {
      inFlightByLane.set(laneKey, (inFlightByLane.get(laneKey) ?? 0) + arrival.quantity);
    }
  }

  const ownerOf = (systemId: string): LaneEndpointOwner => {
    const system = systemById.get(systemId);
    return system ? { factionId: system.factionId, control: system.control } : { factionId: null, control: "unclaimed" };
  };

  return world.lanes.map((lane) => ({
    key: lane.key,
    aId: lane.aId,
    bId: lane.bId,
    level: lane.level,
    capacity: laneCapacity(lane.level),
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
 * One lane's full detail for the lane card (docs/planned/logistics-lanes.md §7) — everything
 * `LaneStateRow` doesn't carry: endpoint ownership for the invest verb's states, cargo in flight
 * (one row per ledger entry crossing this lane, not a window sum), and the open `lane_upgrade`
 * projects targeting it, enriched through the same faction readout the construction surfaces use.
 * Null when `key` names no lane in the current world — the caller (`buildStateFrame`) only invokes
 * this for keys the interest set and the world both agree exist, so null is a defensive read, not
 * an expected path.
 */
export function getLaneDetail(key: string): LaneDetailData | null {
  const world = getWorld();
  const lane = world.lanes.find((l) => l.key === key);
  if (!lane) return null;

  const systemById = new Map(world.systems.map((s) => [s.id, s]));
  const aSystem = systemById.get(lane.aId);
  const bSystem = systemById.get(lane.bId);

  const ownerOf = (systemId: string): LaneEndpointOwner => {
    const system = systemById.get(systemId);
    return system ? { factionId: system.factionId, control: system.control } : { factionId: null, control: "unclaimed" };
  };

  const connection = world.connections.find(
    (c) => (c.fromId === lane.aId && c.toId === lane.bId) || (c.fromId === lane.bId && c.toId === lane.aId),
  );

  const nameOf = (systemId: string): string => systemById.get(systemId)?.name ?? "Unknown System";
  const arrivals = world.pendingArrivals.filter((a) => a.routeEdges.includes(key));
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
    fuelCost: connection?.fuelCost ?? 0,
    a: endpointDetail(aSystem, lane.aId),
    b: endpointDetail(bSystem, lane.bId),
    level: lane.level,
    capacity: laneCapacity(lane.level),
    bookedLoad: lane.bookedLoad,
    blockedVolume: lane.blockedVolume,
    inFlight: arrivals.reduce((sum, a) => sum + a.quantity, 0),
    idleCycles: lane.idleCycles,
    investorFactionId: laneInvestor(lane, ownerOf),
    cargo,
    openProjects,
  };
}
