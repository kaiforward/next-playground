import { prisma } from "@/lib/prisma";
import { tileBounds } from "@/lib/engine/tiles";
import { computeVisibilitySet } from "@/lib/engine/visibility";
import { getAdjacencyList } from "./adjacency";
import { SHIP_TYPES } from "@/lib/constants/ships";
import { EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";
import { isShipTypeId, toEventTypeId } from "@/lib/types/guards";
import type { ShipTypeId } from "@/lib/constants/ships";
import type { DynamicTileSystem } from "@/lib/types/game";
import type { EventTypeId } from "@/lib/constants/events";

/**
 * Dynamic tile data: visibility-gated game state (events, danger, ship presence)
 * for systems within a tile. Unlike static tiles, this data changes every tick.
 */
export async function getDynamicTile(
  playerId: string,
  col: number,
  row: number,
): Promise<{ systems: DynamicTileSystem[] }> {
  const bounds = tileBounds(col, row);

  // 1. Parallel: player ships, adjacency graph (cached), systems in tile, active events
  const [playerShips, adjacency, tileSystems, activeEvents] = await Promise.all([
    prisma.ship.findMany({
      where: { playerId },
      select: { systemId: true, shipType: true },
    }),
    getAdjacencyList(),
    prisma.starSystem.findMany({
      where: {
        x: { gte: bounds.minX, lt: bounds.maxX },
        y: { gte: bounds.minY, lt: bounds.maxY },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
    prisma.gameEvent.findMany({
      where: {
        system: {
          x: { gte: bounds.minX, lt: bounds.maxX },
          y: { gte: bounds.minY, lt: bounds.maxY },
        },
      },
      select: { systemId: true, type: true },
    }),
  ]);

  // 2. Compute visibility set
  // Filter + map in one pass to preserve type narrowing from isShipTypeId guard
  const shipPositions: Array<{ systemId: string; role: (typeof SHIP_TYPES)[ShipTypeId]["role"] }> = [];
  for (const s of playerShips) {
    if (isShipTypeId(s.shipType)) {
      shipPositions.push({ systemId: s.systemId, role: SHIP_TYPES[s.shipType].role });
    }
  }

  const visibilitySet = computeVisibilitySet(shipPositions, adjacency);

  // 3. Build events-per-system map for visible systems
  const eventsPerSystem = new Map<string, Set<EventTypeId>>();
  for (const event of activeEvents) {
    if (!event.systemId || !visibilitySet.has(event.systemId)) continue;
    let eventSet = eventsPerSystem.get(event.systemId);
    if (!eventSet) {
      eventSet = new Set();
      eventsPerSystem.set(event.systemId, eventSet);
    }
    eventSet.add(toEventTypeId(event.type));
  }

  // 4. Build player ship positions set for hasPlayerShips check
  const playerSystemIds = new Set(playerShips.map((s) => s.systemId));

  // 5. Build response
  const systems: DynamicTileSystem[] = tileSystems.map((system) => {
    if (!visibilitySet.has(system.id)) {
      return { id: system.id, visibility: "unknown" };
    }

    const eventTypeIds = eventsPerSystem.get(system.id);
    const typeArray = eventTypeIds ? [...eventTypeIds] : [];
    const danger = typeArray.length > 0
      ? Math.max(...typeArray.map((t) => EVENT_TYPE_DANGER_PRIORITY[t]))
      : 0;

    return {
      id: system.id,
      visibility: "visible",
      eventTypeIds: typeArray,
      hasPlayerShips: playerSystemIds.has(system.id),
      danger,
    };
  });

  return { systems };
}
