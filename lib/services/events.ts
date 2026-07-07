import { getWorld } from "@/lib/world/store";
import { EVENT_DEFINITIONS, getPhaseEffectSummary } from "@/lib/constants/events";
import type { ActiveEvent } from "@/lib/types/game";

/**
 * Get all active events with display-friendly fields resolved.
 */
export function getActiveEvents(): ActiveEvent[] {
  const world = getWorld();
  const currentTick = world.meta.currentTick;
  const systemNameById = new Map(world.systems.map((s) => [s.id, s.name]));

  // NOTE: Filters by systemId only — region-level events (systemId=null) are excluded.
  // All current event definitions target systems, so this is safe for now.
  return world.events
    .filter((e) => e.systemId !== null)
    .map((e) => {
      const def = EVENT_DEFINITIONS[e.type];
      const phaseDef = def?.phases.find((p) => p.name === e.phase);

      return {
        id: e.id,
        type: e.type,
        name: def?.name ?? e.type,
        description: def?.description ?? "",
        phase: e.phase,
        phaseDisplayName: phaseDef?.displayName ?? e.phase,
        effects: getPhaseEffectSummary(e.type, e.phase),
        systemId: e.systemId,
        systemName: e.systemId ? systemNameById.get(e.systemId) ?? null : null,
        regionId: e.regionId,
        startTick: e.startTick,
        phaseStartTick: e.phaseStartTick,
        phaseDuration: e.phaseDuration,
        ticksRemaining: Math.max(0, e.phaseStartTick + e.phaseDuration - currentTick),
        severity: e.severity,
      };
    });
}
