import { prisma } from "@/lib/prisma";
import { EVENT_DEFINITIONS, getPhaseEffectSummary } from "@/lib/constants/events";
import { toEventTypeId } from "@/lib/types/guards";
import { getPlayerVisibility } from "./visibility-cache";
import type { ActiveEvent } from "@/lib/types/game";

/**
 * Get active events visible to a specific player.
 * Filters by the player's visible system set and resolves display-friendly fields.
 */
export async function getActiveEvents(playerId: string): Promise<ActiveEvent[]> {
  const { visibleSet, currentTick } = await getPlayerVisibility(playerId);

  // NOTE: Filters by systemId only — region-level events (systemId=null) are excluded.
  // All current event definitions target systems, so this is safe for now.
  const dbEvents = await prisma.gameEvent.findMany({
    where: {
      systemId: { in: [...visibleSet] },
    },
    select: {
      id: true,
      type: true,
      phase: true,
      systemId: true,
      regionId: true,
      startTick: true,
      phaseStartTick: true,
      phaseDuration: true,
      severity: true,
      system: { select: { name: true } },
    },
  });

  return dbEvents.map((e) => {
    const eventType = toEventTypeId(e.type);
    const def = EVENT_DEFINITIONS[eventType];
    const phaseDef = def?.phases.find((p) => p.name === e.phase);

    return {
      id: e.id,
      type: eventType,
      name: def?.name ?? e.type,
      description: def?.description ?? "",
      phase: e.phase,
      phaseDisplayName: phaseDef?.displayName ?? e.phase,
      effects: getPhaseEffectSummary(eventType, e.phase),
      systemId: e.systemId,
      systemName: e.system?.name ?? null,
      regionId: e.regionId,
      startTick: e.startTick,
      phaseStartTick: e.phaseStartTick,
      phaseDuration: e.phaseDuration,
      ticksRemaining: Math.max(0, e.phaseStartTick + e.phaseDuration - currentTick),
      severity: e.severity,
    };
  });
}
