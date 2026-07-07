import { getWorld } from "@/lib/world/store";
import { EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";
import type { DynamicTileSystem } from "@/lib/types/game";
import type { EventTypeId } from "@/lib/constants/events";

/**
 * Returns dynamic game state (events, danger) for ALL systems. No viewport
 * filtering — the full set is small enough to return in one response.
 * Consumers do viewport culling client-side.
 */
export function getDynamicData(): { systems: DynamicTileSystem[] } {
  const world = getWorld();

  const eventsPerSystem = new Map<string, Set<EventTypeId>>();
  for (const event of world.events) {
    if (!event.systemId) continue;
    let eventSet = eventsPerSystem.get(event.systemId);
    if (!eventSet) {
      eventSet = new Set();
      eventsPerSystem.set(event.systemId, eventSet);
    }
    eventSet.add(event.type);
  }

  const systems: DynamicTileSystem[] = world.systems.map((s) => {
    const eventTypeIds = eventsPerSystem.get(s.id);
    const typeArray = eventTypeIds ? [...eventTypeIds] : [];
    const danger = typeArray.length > 0
      ? Math.max(...typeArray.map((t) => EVENT_TYPE_DANGER_PRIORITY[t]))
      : 0;

    return {
      id: s.id,
      eventTypeIds: typeArray,
      hasPlayerShips: false,
      danger,
    };
  });

  return { systems };
}
