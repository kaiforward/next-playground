import { prisma } from "@/lib/prisma";
import { EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";
import { toEventTypeId } from "@/lib/types/guards";
import { getPlayerVisibility } from "./visibility-cache";
import type { DynamicTileSystem } from "@/lib/types/game";
import type { EventTypeId } from "@/lib/constants/events";

/**
 * Returns dynamic game state (events, danger, ship presence) for ALL systems
 * visible to a player. No viewport filtering — the full visible set is small
 * enough to return in one response (~10-40KB for a mature player with 400
 * visible systems). Consumers do viewport culling client-side.
 */
export async function getDynamicData(
  playerId: string,
): Promise<{ systems: DynamicTileSystem[] }> {
  // 1. Get cached visibility (per-player-per-tick)
  const { visibleSet, playerSystemIds } = await getPlayerVisibility(playerId);

  const visibleIds = [...visibleSet];

  // 2. Fast path: no visible systems
  if (visibleIds.length === 0) {
    return { systems: [] };
  }

  // 3. Events by ID — direct index lookup
  const activeEvents = await prisma.gameEvent.findMany({
    where: { systemId: { in: visibleIds } },
    select: { systemId: true, type: true },
  });

  // 4. Build events-per-system map
  const eventsPerSystem = new Map<string, Set<EventTypeId>>();
  for (const event of activeEvents) {
    if (!event.systemId) continue;
    let eventSet = eventsPerSystem.get(event.systemId);
    if (!eventSet) {
      eventSet = new Set();
      eventsPerSystem.set(event.systemId, eventSet);
    }
    eventSet.add(toEventTypeId(event.type));
  }

  // 5. Build response — only visible systems
  const systems: DynamicTileSystem[] = visibleIds.map((id) => {
    const eventTypeIds = eventsPerSystem.get(id);
    const typeArray = eventTypeIds ? [...eventTypeIds] : [];
    const danger = typeArray.length > 0
      ? Math.max(...typeArray.map((t) => EVENT_TYPE_DANGER_PRIORITY[t]))
      : 0;

    return {
      id,
      eventTypeIds: typeArray,
      hasPlayerShips: playerSystemIds.has(id),
      danger,
    };
  });

  return { systems };
}
