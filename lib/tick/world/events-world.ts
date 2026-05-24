/**
 * EventsWorld — data interface for the events processor.
 *
 * Adapters in `lib/tick/adapters/{prisma,memory}/events.ts` implement it.
 * See `docs/design/active/processor-architecture.md` and
 * `lib/tick/world/snapshots-world.ts` for the broader pattern.
 */

import type {
  EventSnapshot,
  ModifierRow,
  NeighborSnapshot,
  SystemSnapshot,
} from "@/lib/engine/events";
import type { EventTypeId } from "@/lib/constants/events";

/** Event + denormalized system name (for notifications/logging). */
export interface EventWithName extends EventSnapshot {
  systemName: string | null;
}

/** System + name (for notifications/logging on spawn). */
export interface SystemWithName extends SystemSnapshot {
  name: string;
}

/** Neighbor + name (for spread notifications). */
export interface NeighborWithName extends NeighborSnapshot {
  name: string;
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

/** A new event to create (initial phase + initial modifiers). */
export interface EventCreate {
  type: EventTypeId;
  phase: string;
  systemId: string;
  regionId: string;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
  severity: number;
  sourceEventId: string | null;
  modifiers: ModifierRow[];
}

/** Created event — id assigned by the adapter. */
export interface EventCreateResult {
  eventId: string;
  /** System name, looked up by the adapter for notification logging. */
  systemName: string;
}

/** A market shock targeting one good in one system. */
export interface SystemShock {
  systemId: string;
  goodId: string;
  parameter: "supply" | "demand";
  value: number;
  /** "absolute" = raw delta; "percentage" = fraction of current value. */
  mode: "absolute" | "percentage";
}

export interface EventsWorld {
  /** All active events. System name attached for notifications. */
  getEvents(): Promise<EventWithName[]>;

  /** All systems eligible for event spawn selection. */
  getSystems(): Promise<SystemWithName[]>;

  /**
   * Neighbors of each given system. Bulk-fetched (single DB query in live;
   * filter+map in memory) — keyed by source systemId.
   */
  getNeighborsBySystem(
    systemIds: string[],
  ): Promise<Map<string, NeighborWithName[]>>;

  /**
   * Advance one or more events to a new phase. Replaces each event's
   * modifier rows atomically (delete prior + insert new).
   */
  advancePhases(advances: PhaseAdvance[]): Promise<void>;

  /** Delete events and cascade-delete their modifiers. */
  expireEvents(eventIds: string[]): Promise<void>;

  /**
   * Create events with their initial modifiers. Returns the assigned IDs
   * in the same order as the input array.
   */
  createEvents(creates: EventCreate[]): Promise<EventCreateResult[]>;

  /**
   * Apply shocks to station markets across multiple systems. Both modes are
   * honored (absolute and percentage). Returns the count of markets touched.
   */
  applyShocks(shocks: SystemShock[]): Promise<number>;
}

/** Per-tick params passed alongside the world. Sim and live differ here. */
export interface EventsProcessorParams {
  rng: () => number;
  /** Live: scaleEventCaps result. Sim: SimConstants.events caps. */
  caps: { maxEventsGlobal: number; maxEventsPerSystem: number };
  /** Live: scaleEventCaps result. Sim: SimConstants.events.maxBatchSpawn. */
  batchSize: number;
  /** Live: EVENT_SPAWN_INTERVAL. Sim: SimConstants.events.spawnInterval. */
  spawnInterval: number;
  /** Live: SCALED_DEFINITIONS. Sim: SCALED.definitions. */
  definitions: Record<EventTypeId, import("@/lib/constants/events").EventDefinition>;
  /** Live: true. Sim: false when disableRandomEvents is set. */
  spawnEnabled: boolean;
  /** Sim-only injections to apply this tick. Live always [] / undefined. */
  injections?: InjectionRequest[];
}

/** Sim-only request to spawn a specific event at a system this tick. */
export interface InjectionRequest {
  type: EventTypeId;
  systemId: string;
  regionId: string;
  severity: number;
}
