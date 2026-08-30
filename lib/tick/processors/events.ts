import type { TickContext, TickProcessorResult } from "../types";
import type { EventPhaseDefinition, EventTypeId } from "@/lib/constants/events";
import {
  checkPhaseTransition,
  buildModifiersForPhase,
  rollPhaseDuration,
} from "@/lib/engine/events";

/**
 * Relations-spawned events whose lifecycle is owned by the relations
 * processor (single-phase, informational, expiry resolved via
 * `metadata.expiresAtTick`). The events processor skips phase transitions
 * for these; `border_conflict` is intentionally NOT in this set because it
 * has multi-phase modifiers driven by the events processor as normal.
 */
const RELATIONS_OWNED_LIFECYCLE: ReadonlySet<EventTypeId> = new Set<EventTypeId>([
  "pact_under_negotiation",
  "alliance_dissolved",
]);
import type {
  EventsProcessorParams,
  EventsWorld,
  EventWithName,
  PhaseAdvance,
} from "@/lib/tick/world/events-world";
import { resolveHostConfig } from "@/lib/constants/economy-scale";

const DEBUG = resolveHostConfig().debugEvents;

/**
 * Pure processor body, run against the in-memory adapter — the one backend.
 * The only knob the body shouldn't hard-code is RNG (phase-duration rolls)
 * and the definition table; both arrive via `params`.
 */
export async function runEventsProcessor(
  world: EventsWorld,
  ctx: TickContext,
  params: EventsProcessorParams,
): Promise<TickProcessorResult> {
  const { rng, definitions } = params;

  // ── 1. Fetch active events ────────────────────────────────────
  const events = await world.getEvents();

  // ── 2. Phase transitions ──────────────────────────────────────
  interface AdvancingEvent {
    snap: EventWithName;
    nextPhase: EventPhaseDefinition;
    duration: number;
  }
  const advancing: AdvancingEvent[] = [];
  const expiredIds: string[] = [];

  for (const ev of events) {
    const def = definitions[ev.type];
    if (!def) {
      expiredIds.push(ev.id);
      continue;
    }

    // Skip events whose lifecycle the relations processor owns. Their stored
    // phaseDuration is a sentinel (RELATIONS_PHASE_SENTINEL); never advance
    // or auto-expire them — relations resolves them via metadata.expiresAtTick.
    if (RELATIONS_OWNED_LIFECYCLE.has(ev.type)) continue;

    const result = checkPhaseTransition(ev, ctx.tick, def);
    if (result === "expire") {
      expiredIds.push(ev.id);
      if (DEBUG) {
        console.log(`[events] ${def.name} at ${ev.systemName ?? "Unknown"} has ended.`);
      }
      continue;
    }

    if (result === "advance") {
      const currentIndex = def.phases.findIndex((p) => p.name === ev.phase);
      const nextPhase = def.phases[currentIndex + 1];
      const duration = rollPhaseDuration(nextPhase.durationRange, rng);
      advancing.push({ snap: ev, nextPhase, duration });
    }
  }

  // Apply phase advances.
  if (advancing.length > 0) {
    const advances: PhaseAdvance[] = advancing.map((a) => ({
      eventId: a.snap.id,
      nextPhaseName: a.nextPhase.name,
      phaseStartTick: ctx.tick,
      phaseDuration: a.duration,
      modifiers: buildModifiersForPhase(
        a.nextPhase,
        a.snap.systemId,
        a.snap.regionId,
      ),
    }));
    await world.advancePhases(advances);

    if (DEBUG) {
      for (const { snap, nextPhase, duration } of advancing) {
        const def = definitions[snap.type];
        if (!def) continue;
        console.log(
          `[events] ${def.name} at ${snap.systemName ?? "Unknown"}: ${snap.phase} → ${nextPhase.name} (${duration} ticks)`,
        );
      }
    }
  }

  // ── 3. Expire completed events ────────────────────────────────
  if (expiredIds.length > 0) {
    await world.expireEvents(expiredIds);
    if (DEBUG) console.log(`[events] Expired ${expiredIds.length} event(s)`);
  }

  return {};
}
