/**
 * TradeMissionsWorld — data interface for the trade-missions processor.
 *
 * No sim counterpart yet — the abstraction is in place so future sim
 * integration (or in-memory unit tests) drops in cleanly.
 *
 * See `docs/design/active/processor-architecture.md` for the broader pattern.
 */

import type { EventTypeId } from "@/lib/constants/events";
import type { PlayerEventMap } from "@/lib/tick/types";

/** Accepted mission that just expired — denormalized for notification rendering. */
export interface AcceptedMissionView {
  id: string;
  playerId: string;
  quantity: number;
  destinationId: string;
  goodName: string;
  destinationName: string;
}

/** Active event with a non-null systemId (the selector filters those out anyway). */
export interface ActiveEventView {
  id: string;
  type: EventTypeId;
  systemId: string;
}

/** One mission to insert. `goodId` is the DB good ID, not the canonical key. */
export interface MissionCreate {
  systemId: string;
  destinationId: string;
  goodId: string;
  quantity: number;
  reward: number;
  deadlineTick: number;
  eventId: string | null;
  createdAtTick: number;
}

export interface TradeMissionsWorld {
  /** Delete unclaimed missions whose deadline has passed. Returns count. */
  expireUnclaimedMissions(currentTick: number): Promise<number>;

  /** Fetch (but don't delete) accepted missions past deadline. */
  getExpiredAcceptedMissions(currentTick: number): Promise<AcceptedMissionView[]>;

  /** Delete missions by id. */
  deleteMissions(ids: string[]): Promise<void>;

  /** Active events with a non-null systemId. */
  getActiveEvents(): Promise<ActiveEventView[]>;

  /** Existing available-mission counts per origin station/system. */
  getAvailableMissionCountsByStation(): Promise<Map<string, number>>;

  /** Canonical good key → DB good ID, for translating engine output to inserts. */
  resolveGoodIds(): Promise<Map<string, string>>;

  /** Batch-insert generated missions. */
  createMissions(rows: MissionCreate[]): Promise<void>;

  /** Persist accumulated player notifications for this tick. */
  persistNotifications(
    events: Map<string, Partial<PlayerEventMap>>,
    tick: number,
  ): Promise<void>;
}
