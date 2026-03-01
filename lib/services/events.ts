import { prisma } from "@/lib/prisma";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { toEventTypeId } from "@/lib/types/guards";
import type { ActiveEvent } from "@/lib/types/game";

/**
 * Get all active events with display-friendly fields.
 * Joins system name and resolves phase display names from EVENT_DEFINITIONS.
 */
export async function getActiveEvents(): Promise<ActiveEvent[]> {
  const [world, dbEvents] = await Promise.all([
    prisma.gameWorld.findFirstOrThrow({ select: { currentTick: true } }),
    prisma.gameEvent.findMany({
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
    }),
  ]);

  return dbEvents.map((e) => {
    const eventType = toEventTypeId(e.type);
    const def = EVENT_DEFINITIONS[eventType];
    const phaseDef = def?.phases.find((p) => p.name === e.phase);

    return {
      id: e.id,
      type: eventType,
      name: def?.name ?? e.type,
      phase: e.phase,
      phaseDisplayName: phaseDef?.displayName ?? e.phase,
      systemId: e.systemId,
      systemName: e.system?.name ?? null,
      regionId: e.regionId,
      startTick: e.startTick,
      phaseStartTick: e.phaseStartTick,
      phaseDuration: e.phaseDuration,
      ticksRemaining: Math.max(0, e.phaseStartTick + e.phaseDuration - world.currentTick),
      severity: e.severity,
    };
  });
}
