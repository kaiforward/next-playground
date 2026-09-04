import { getWorld } from "@/lib/world/store";
import { laneCapacity, laneInvestor, type LaneEndpointOwner } from "@/lib/engine/lanes";
import type { LaneStateRow } from "@/lib/types/api";

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
