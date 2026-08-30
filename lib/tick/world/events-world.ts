/**
 * EventsWorld — data interface for the events processor.
 *
 * The in-memory adapter in `lib/tick/adapters/memory/events.ts` implements it.
 * See `docs/active/engineering/processor-architecture.md` and
 * `lib/tick/world/migration-world.ts` for the broader pattern.
 */

import type { EventSnapshot, ModifierRow } from "@/lib/engine/events";
import type { EventTypeId } from "@/lib/constants/events";

/** Event + denormalised system name (for logging). */
export interface EventWithName extends EventSnapshot {
  systemName: string | null;
}

/** One advancing event — phase transition + modifier replacement. */
export interface PhaseAdvance {
  eventId: string;
  nextPhaseName: string;
  phaseStartTick: number;
  phaseDuration: number;
  /** Replacement modifier rows for this event (replaces any prior rows). */
  modifiers: ModifierRow[];
}

export interface EventsWorld {
  /** All active events. System name attached for logging. */
  getEvents(): Promise<EventWithName[]>;

  /**
   * Advance one or more events to a new phase. Replaces each event's
   * modifier rows atomically (delete prior + insert new).
   */
  advancePhases(advances: PhaseAdvance[]): Promise<void>;

  /** Delete events and cascade-delete their modifiers. */
  expireEvents(eventIds: string[]): Promise<void>;
}

/** Per-tick params passed alongside the world, all sourced by `runWorldTick`. */
export interface EventsProcessorParams {
  rng: () => number;
  /** Event definitions, keyed by type. */
  definitions: Record<EventTypeId, import("@/lib/constants/events").EventDefinition>;
}
