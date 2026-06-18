/**
 * OpMissionsWorld — data interface for the operational-missions processor.
 *
 * No sim counterpart yet. See `docs/design/active/processor-architecture.md`
 * for the broader pattern.
 */

import type { EventTypeId } from "@/lib/constants/events";
import type { GovernmentType } from "@/lib/types/game";
import type { ModifierRow } from "@/lib/engine/events";
import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import type { PlayerEventMap } from "@/lib/tick/types";

/** Region row used purely for round-robin selection — government is per-system now. */
export interface RegionView {
  id: string;
  name: string;
}

/** System + traits + government (from owning faction) for danger + candidate generation. */
export interface SystemTraitView {
  id: string;
  name: string;
  governmentType: GovernmentType;
  traits: GeneratedTrait[];
  /** Σ body-archetype danger baselines for this system. */
  bodyDanger: number;
}

/** Mission that's eligible to be completed this tick (duration elapsed). */
export interface CompletableMissionView {
  id: string;
  type: string;
  reward: number;
  playerId: string | null;
  shipId: string | null;
  startedAtTick: number;
  durationTicks: number;
  targetSystemId: string;
  targetSystemName: string;
  shipName: string | null;
}

/** Accepted mission past its deadline (failed). */
export interface FailedMissionView {
  id: string;
  type: string;
  playerId: string | null;
  shipId: string | null;
  targetSystemId: string;
  targetSystemName: string;
  shipName: string | null;
}

/** Active event in a target system used by event-driven mission selection. */
export interface EventContextView {
  id: string;
  type: EventTypeId;
  systemId: string;
  severity: number;
}

/** One mission to insert. */
export interface MissionCreate {
  type: string;
  systemId: string;
  targetSystemId: string;
  reward: number;
  deadlineTick: number;
  durationTicks: number | null;
  enemyTier: string | null;
  /** Pre-serialized JSON string (DB stores it as text). */
  statRequirements: string;
  createdAtTick: number;
  eventId: string | null;
}

export interface OpMissionsWorld {
  /** Delete `available` missions whose deadline passed. Returns count. */
  expireUnclaimedMissions(currentTick: number): Promise<number>;

  /** In-progress timed missions whose duration has elapsed by `currentTick`. */
  getCompletableTimedMissions(
    currentTick: number,
  ): Promise<CompletableMissionView[]>;

  /** Mark missions completed and free the ship. */
  completeMissions(ids: string[], currentTick: number): Promise<void>;

  /** Add per-player reward credits in a single bulk write. */
  creditPlayers(rewardsByPlayer: Map<string, number>): Promise<void>;

  /** Accepted missions past their deadline (never started). */
  getFailedAcceptedMissions(
    currentTick: number,
  ): Promise<FailedMissionView[]>;

  /** Mark missions failed and free the ship. */
  failMissions(ids: string[]): Promise<void>;

  /** Regions ordered alphabetically (round-robin source). */
  getRegions(): Promise<RegionView[]>;

  /** Systems (with traits) in one region. */
  getSystemsInRegion(regionId: string): Promise<SystemTraitView[]>;

  /** Navigation-domain modifiers targeting the given systems. */
  getNavModifiersForSystems(systemIds: string[]): Promise<ModifierRow[]>;

  /** Active events located in the given systems. */
  getActiveEventsForSystems(
    systemIds: string[],
  ): Promise<EventContextView[]>;

  /** Existing `available` mission counts per origin system. */
  getMissionCountsBySystem(systemIds: string[]): Promise<Map<string, number>>;

  /** Batch-insert generated missions. */
  createMissions(rows: MissionCreate[]): Promise<void>;

  /** Persist accumulated player notifications. */
  persistNotifications(
    events: Map<string, Partial<PlayerEventMap>>,
    tick: number,
  ): Promise<void>;
}
