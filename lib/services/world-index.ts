import { getWorld, getWorldVersion } from "@/lib/world/store";
import type { World, WorldFlowEvent, WorldMarket } from "@/lib/world/types";

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

/** System display names by id. */
export const systemNameById = versionCached(
  (world) => new Map(world.systems.map((s) => [s.id, s.name])),
);
