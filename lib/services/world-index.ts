import { getWorld, getWorldVersion } from "@/lib/world/store";
import type { World, WorldBody, WorldConnection, WorldFlowEvent, WorldMarket, WorldSystem } from "@/lib/world/types";
import type { GovernmentType, RegionInfo } from "@/lib/types/game";
import { deriveRegionDominantFaction } from "@/lib/utils/region";
import { laneKey } from "@/lib/engine/lanes";

/**
 * Lazy per-version indexes over the world store, shared by the read services.
 * Each index is rebuilt at most once per world version (the version bumps on
 * every tick and world swap), so per-request reads cost O(result) instead of a
 * full-array scan per call. Returned collections are shared caches — read-only
 * by contract; consumers must never mutate them.
 */
function versionCached<T>(build: (world: World) => T): () => T {
  let cache: { version: number; value: T } | null = null;
  return () => {
    const version = getWorldVersion();
    if (cache === null || cache.version !== version) {
      cache = { version, value: build(getWorld()) };
    }
    return cache.value;
  };
}

/** Market rows grouped by system id. */
export const marketsBySystem = versionCached((world) => {
  const map = new Map<string, WorldMarket[]>();
  for (const m of world.markets) {
    const list = map.get(m.systemId);
    if (list) list.push(m);
    else map.set(m.systemId, [m]);
  }
  return map;
});

/** Building counts per system, keyed by buildingType. */
export const buildingsBySystem = versionCached((world) => {
  const map = new Map<string, Record<string, number>>();
  for (const b of world.buildings) {
    const rec = map.get(b.systemId);
    if (rec) rec[b.buildingType] = b.count;
    else map.set(b.systemId, { [b.buildingType]: b.count });
  }
  return map;
});

/** Body rows grouped by system id — mirrors `buildingsBySystem`, so a read service that scans
 *  `world.bodies` per call (an O(galaxy-bodies) cost on every request) reads this instead. */
export const bodiesBySystem = versionCached((world) => {
  const map = new Map<string, WorldBody[]>();
  for (const b of world.bodies) {
    const list = map.get(b.systemId);
    if (list) list.push(b);
    else map.set(b.systemId, [b]);
  }
  return map;
});

/**
 * Flow events touching each system (as source or destination), original
 * append order preserved per system.
 */
export const flowEventsBySystem = versionCached((world) => {
  const map = new Map<string, WorldFlowEvent[]>();
  const push = (systemId: string, f: WorldFlowEvent): void => {
    const list = map.get(systemId);
    if (list) list.push(f);
    else map.set(systemId, [f]);
  };
  for (const f of world.flowEvents) {
    push(f.fromSystemId, f);
    if (f.toSystemId !== f.fromSystemId) push(f.toSystemId, f);
  }
  return map;
});

/** Owning government by faction id. */
export const governmentByFactionId = versionCached(
  (world) => new Map(world.factions.map((f) => [f.id, f.governmentType])),
);

/** System display names by id. */
export const systemNameById = versionCached(
  (world) => new Map(world.systems.map((s) => [s.id, s.name])),
);

/** Whole system rows by id — what a read service needs when a name alone won't do (endpoint
 *  ownership, control tier). Every lane-facing service resolves endpoints through this rather than
 *  rebuilding the same map per call. */
export const systemById = versionCached(
  (world): ReadonlyMap<string, WorldSystem> => new Map(world.systems.map((s) => [s.id, s])),
);

/** `laneKey` → the fuel cost of crossing that lane, off `world.connections` — the same static
 *  lookup the booker builds for itself (`buildLaneNetwork`, `lib/engine/lane-routing.ts`, which
 *  stays engine-pure and takes its rows as arguments). Fuel costs never change once generated, so
 *  this is a per-version index, never a per-call rebuild. */
export const laneFuelCostByKey = versionCached((world): ReadonlyMap<string, number> => {
  const costs = new Map<string, number>();
  for (const c of world.connections) costs.set(laneKey(c.fromId, c.toId), c.fuelCost);
  return costs;
});

/**
 * One lane's fuel cost. A key with no connection row is an INVARIANT BREAK, not game state: every
 * lane is minted from a connection at generation and both sides travel in the same save, so a
 * missing cost would otherwise read as a free lane (`?? 0`) and silently mis-price transit and
 * crossing times. Throws for the same reason `laneEndpoints` (`lib/engine/lanes.ts`) does.
 */
export function laneFuelCost(key: string): number {
  const cost = laneFuelCostByKey().get(key);
  if (cost === undefined) {
    throw new Error(`laneFuelCost: lane "${key}" has no connection row — lane/connection desync`);
  }
  return cost;
}

/** Connection rows touching each system, by system id (both directions appear under both
 *  endpoints) — so an adjacency read is O(neighbours) instead of a full connection scan per
 *  system. */
export const connectionsBySystem = versionCached((world): ReadonlyMap<string, WorldConnection[]> => {
  const map = new Map<string, WorldConnection[]>();
  const push = (systemId: string, c: WorldConnection): void => {
    const list = map.get(systemId);
    if (list) list.push(c);
    else map.set(systemId, [c]);
  };
  for (const c of world.connections) {
    push(c.fromId, c);
    if (c.toId !== c.fromId) push(c.toId, c);
  }
  return map;
});

/**
 * Every region with its dominant owning faction and that faction's government — derived, never
 * stored on the region row. A region with no faction-owned systems reads as "frontier".
 *
 * Cached here rather than derived per read service: the atlas and the universe both serve it, and a
 * second derivation is a second answer waiting to drift.
 */
export const regionInfos = versionCached((world): RegionInfo[] => {
  const factionNameById = new Map(world.factions.map((f) => [f.id, f.name]));
  const factionGovById = governmentByFactionId();

  const systemFactionsByRegion = new Map<string, string[]>();
  for (const s of world.systems) {
    if (!s.factionId) continue;
    const list = systemFactionsByRegion.get(s.regionId) ?? [];
    list.push(s.factionId);
    systemFactionsByRegion.set(s.regionId, list);
  }

  return world.regions.map((r) => {
    const dominantFactionId = deriveRegionDominantFaction(
      systemFactionsByRegion.get(r.id) ?? [],
      factionNameById,
    );
    const dominantGovernmentType: GovernmentType = dominantFactionId
      ? factionGovById.get(dominantFactionId) ?? "frontier"
      : "frontier";
    return {
      id: r.id,
      name: r.name,
      dominantEconomy: r.dominantEconomy,
      dominantFactionId,
      dominantGovernmentType,
      x: r.x,
      y: r.y,
    };
  });
});
