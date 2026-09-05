import { getWorld } from "@/lib/world/store";
import { laneCapacity, laneInvestor, laneKey as laneKeyOf, type LaneEndpointOwner } from "@/lib/engine/lanes";
import { currentHopIndex, laneOccupiedAt } from "@/lib/engine/freight";
import { readoutForFaction } from "@/lib/services/construction";
import { GOODS } from "@/lib/constants/goods";
import { LANES } from "@/lib/constants/lanes";
import type { ConstructionProjectLaneRow, FactionConstructionReadout } from "@/lib/engine/construction-readout";
import type { LaneStateRow, LaneDetailData, LaneCargoRow, LaneEndpointDetail } from "@/lib/types/api";
import type { World, WorldPendingArrival } from "@/lib/world/types";

/**
 * laneKey → fuel cost of crossing it, read straight off `world.connections` — the same static
 * lookup the booker builds (`buildLaneNetwork`, `lib/engine/lane-routing.ts`), rebuilt here rather
 * than shared because a route service has no `LaneNetwork` of its own to reuse. Fuel costs never
 * change once generated, so callers build this once per read, never once per ledger row.
 */
function fuelCostLookup(world: World): ReadonlyMap<string, number> {
  const costs = new Map<string, number>();
  for (const c of world.connections) {
    costs.set(laneKeyOf(c.fromId, c.toId), c.fuelCost);
  }
  return costs;
}

/** The hop-fuel-cost array `laneOccupiedAt` needs for one ledger row, from the fuel-cost lookup
 *  built once per call. A hop with no matching connection reads as 0 fuel — matches the booker's
 *  own `?? 0` fallback (`lane-routing.ts:299`). */
function hopFuelCostsOf(row: Pick<WorldPendingArrival, "routeEdges">, fuelCosts: ReadonlyMap<string, number>): number[] {
  return row.routeEdges.map((key) => fuelCosts.get(key) ?? 0);
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
  const systemById = new Map(world.systems.map((s) => [s.id, s]));
  const tick = world.meta.currentTick;
  const fuelCosts = fuelCostLookup(world);

  const openLevelsByLane = new Map<string, number>();
  for (const project of world.constructionProjects) {
    if (project.kind !== "lane_upgrade") continue;
    openLevelsByLane.set(project.laneKey, (openLevelsByLane.get(project.laneKey) ?? 0) + project.levels);
  }

  const inFlightByLane = new Map<string, number>();
  for (const arrival of world.pendingArrivals) {
    const hop = currentHopIndex(arrival, tick, hopFuelCostsOf(arrival, fuelCosts), LANES.FREIGHT_SPEED);
    if (hop === null) continue;
    const laneKey = arrival.routeEdges[hop];
    inFlightByLane.set(laneKey, (inFlightByLane.get(laneKey) ?? 0) + arrival.quantity);
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
 * One lane's full detail for the lane card (docs/active/gameplay/logistics-lanes.md §7) — everything
 * `LaneStateRow` doesn't carry: endpoint ownership for the invest verb's states, cargo PHYSICALLY
 * crossing this lane right now (one row per ledger entry currently on this hop, not every ledger
 * entry whose route ever touches it), and the open `lane_upgrade` projects targeting it, enriched
 * through the same faction readout the construction surfaces use. Null when `key` names no lane in
 * the current world — the caller (`buildStateFrame`) only invokes this for keys the interest set
 * and the world both agree exist, so null is a defensive read, not an expected path.
 */
export function getLaneDetail(key: string): LaneDetailData | null {
  const world = getWorld();
  const lane = world.lanes.find((l) => l.key === key);
  if (!lane) return null;

  const systemById = new Map(world.systems.map((s) => [s.id, s]));
  const aSystem = systemById.get(lane.aId);
  const bSystem = systemById.get(lane.bId);
  const tick = world.meta.currentTick;
  const fuelCosts = fuelCostLookup(world);

  const ownerOf = (systemId: string): LaneEndpointOwner => {
    const system = systemById.get(systemId);
    return system ? { factionId: system.factionId, control: system.control } : { factionId: null, control: "unclaimed" };
  };

  const connection = world.connections.find(
    (c) => (c.fromId === lane.aId && c.toId === lane.bId) || (c.fromId === lane.bId && c.toId === lane.aId),
  );

  const nameOf = (systemId: string): string => systemById.get(systemId)?.name ?? "Unknown System";
  const arrivals = world.pendingArrivals.filter((a) =>
    laneOccupiedAt(a, key, tick, hopFuelCostsOf(a, fuelCosts), LANES.FREIGHT_SPEED),
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
