import { getWorld } from "@/lib/world/store";
import { systemNameById } from "@/lib/services/world-index";
import { EVENT_DEFINITIONS, getPhaseEffectSummary } from "@/lib/constants/events";
import { RELATIONS_PHASE_SENTINEL } from "@/lib/constants/relations";
import type { ActiveEvent } from "@/lib/types/game";

/**
 * Get all active events with display-friendly fields resolved.
 */
export function getActiveEvents(): ActiveEvent[] {
  const world = getWorld();
  const currentTick = world.meta.currentTick;
  const nameById = systemNameById();

  return world.events.map((e) => {
    const def = EVENT_DEFINITIONS[e.type];
    const phaseDef = def?.phases.find((p) => p.name === e.phase);

    // border_conflict drives its own expiry from phaseStartTick + phaseDuration (multi-phase,
    // owned by the events processor). The two relations-lifecycle types instead carry a sentinel
    // phaseDuration (lib/constants/relations.ts) and expire on metadata.expiresAtTick, resolved
    // by the relations processor — so that's the real countdown for those.
    const ticksRemaining =
      e.phaseDuration === RELATIONS_PHASE_SENTINEL && e.metadata
        ? Math.max(0, e.metadata.expiresAtTick - currentTick)
        : Math.max(0, e.phaseStartTick + e.phaseDuration - currentTick);

    return {
      id: e.id,
      type: e.type,
      name: def?.name ?? e.type,
      description: def?.description ?? "",
      phase: e.phase,
      phaseDisplayName: phaseDef?.displayName ?? e.phase,
      effects: getPhaseEffectSummary(e.type, e.phase),
      systemId: e.systemId,
      systemName: e.systemId ? nameById.get(e.systemId) ?? null : null,
      regionId: e.regionId,
      startTick: e.startTick,
      phaseStartTick: e.phaseStartTick,
      phaseDuration: e.phaseDuration,
      ticksRemaining,
    };
  });
}
