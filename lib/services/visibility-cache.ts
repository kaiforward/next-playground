import { prisma } from "@/lib/prisma";
import { computeVisibilitySet } from "@/lib/engine/visibility";
import { getAdjacencyList } from "./adjacency";
import { SHIP_TYPES } from "@/lib/constants/ships";
import { isShipTypeId } from "@/lib/types/guards";
import type { ShipRole } from "@/lib/constants/ships";

/**
 * Per-player-per-tick visibility cache.
 * BFS visibility is expensive but only changes when ships move (once per tick).
 * We cache the result keyed by (playerId, tick) so all viewport queries within
 * a single tick reuse the same BFS computation.
 */

interface CachedVisibility {
  tick: number;
  visibleSet: Set<string>;
  playerSystemIds: Set<string>;
}

const cache = new Map<string, CachedVisibility>();

export async function getPlayerVisibility(
  playerId: string,
): Promise<{ visibleSet: Set<string>; playerSystemIds: Set<string>; currentTick: number }> {
  // 1. Read current tick (single-row table, indexed PK)
  const world = await prisma.gameWorld.findUniqueOrThrow({
    where: { id: "world" },
    select: { currentTick: true },
  });

  // 2. Cache hit — same tick, return immediately
  const cached = cache.get(playerId);
  if (cached && cached.tick === world.currentTick) {
    return { visibleSet: cached.visibleSet, playerSystemIds: cached.playerSystemIds, currentTick: world.currentTick };
  }

  // 3. Cache miss — load ships + adjacency, compute BFS
  const [playerShips, adjacency] = await Promise.all([
    prisma.ship.findMany({
      where: { playerId },
      select: { systemId: true, shipType: true },
    }),
    getAdjacencyList(),
  ]);

  // Build ship positions with type-safe role lookup
  const shipPositions: Array<{ systemId: string; role: ShipRole }> = [];
  for (const s of playerShips) {
    if (isShipTypeId(s.shipType)) {
      shipPositions.push({ systemId: s.systemId, role: SHIP_TYPES[s.shipType].role });
    }
  }

  const visibleSet = computeVisibilitySet(shipPositions, adjacency);
  const playerSystemIds = new Set(playerShips.map((s) => s.systemId));

  // 4. Store in cache
  cache.set(playerId, {
    tick: world.currentTick,
    visibleSet,
    playerSystemIds,
  });

  return { visibleSet, playerSystemIds, currentTick: world.currentTick };
}

/** Returns just the visible system IDs as an array (for the visibility API). */
export async function getVisibleSystemIds(playerId: string): Promise<string[]> {
  const { visibleSet } = await getPlayerVisibility(playerId);
  return [...visibleSet];
}

/** Force-clear a player's cached visibility (e.g. after manual ship teleport). */
export function invalidateVisibilityCache(playerId: string): void {
  cache.delete(playerId);
}
