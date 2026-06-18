/**
 * RelationsWorld — data interface for the relations processor.
 *
 * Adapters in `lib/tick/adapters/{prisma,memory}/relations.ts` implement it.
 * See `docs/design/active/processor-architecture.md` for the broader pattern.
 *
 * Pair convention: unordered pairs are stored with `factionAId < factionBId`.
 * Both the Prisma adapter and the memory adapter enforce this on every read
 * and write; callers see the same canonical ordering everywhere.
 */

import type { Doctrine, FactionStatus, GovernmentType } from "@/lib/types/game";
import type { EventTypeId } from "@/lib/constants/events";

// ── Views ────────────────────────────────────────────────────────

/** Faction + derived territory size, used by the drift drivers. */
export interface FactionView {
  id: string;
  name: string;
  governmentType: GovernmentType;
  doctrine: Doctrine;
  /** System count (drives status and dominance heuristics). */
  territorySize: number;
  /** Status derived from territorySize via `deriveFactionStatus`. */
  status: FactionStatus;
}

/** One row from FactionRelation, with canonical pair ordering. */
export interface FactionPairView {
  factionAId: string;
  factionBId: string;
  score: number;
  /** JSON ring buffer (decoded) of recent drift drivers — for UI/debug. */
  history: RelationHistoryEntry[];
  updatedAtTick: number;
}

/** One ring-buffer entry — short, human-readable. */
export interface RelationHistoryEntry {
  tick: number;
  delta: number;
  /** Compact summary, e.g. `"border-friction:-0.04, alliance:+0.15"`. */
  drivers: string;
}

/** Active alliance pact between two factions. */
export interface AlliancePactView {
  factionAId: string;
  factionBId: string;
  formedAtTick: number;
  pendingDissolutionAtTick: number | null;
}

/**
 * Bulk score write. Adapter clamps to the legal range and appends to the
 * history ring buffer; callers don't manage clamping or history themselves.
 */
export interface RelationUpdate {
  factionAId: string;
  factionBId: string;
  newScore: number;
  delta: number;
  drivers: string;
  tick: number;
}

// ── Events created by the relations processor ────────────────────

/**
 * Subset of EventCreate fields needed for relations-spawned events.
 *
 * The metadata payload carries the participant pair so the UI and any
 * downstream logic can resolve the event back to its two factions without
 * re-querying.
 */
export interface RelationEventCreate {
  type: EventTypeId;
  phase: string;
  systemId: string | null;
  regionId: string | null;
  phaseDuration: number;
  severity: number;
  metadata: RelationEventMetadata;
}

export interface RelationEventMetadata {
  factionAId: string;
  factionBId: string;
  /**
   * Window end tick — informational only. The events processor handles
   * border_conflict expiry via phaseDuration; for pact_under_negotiation
   * and alliance_dissolved the relations processor owns expiry.
   */
  expiresAtTick: number;
}

/** Live snapshot of a relations-spawned event still in the GameEvent table. */
export interface RelationEventView {
  id: string;
  type: EventTypeId;
  phaseStartTick: number;
  phaseDuration: number;
  metadata: RelationEventMetadata;
}

// ── Trade volume by faction pair ────────────────────────────────

export type FactionPairKey = string;

/**
 * Build the canonical key for a faction pair. Sorts ids so `(A,B)` and
 * `(B,A)` collide on the same key.
 */
export function pairKey(a: string, b: string): FactionPairKey {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ── The world interface ─────────────────────────────────────────

export interface RelationsWorld {
  /** All factions with derived territorySize and status. */
  getFactions(): Promise<FactionView[]>;

  /** All unordered relation rows (one per pair). */
  getFactionRelations(): Promise<FactionPairView[]>;

  /** All active alliance pacts. */
  getActiveAlliances(): Promise<AlliancePactView[]>;

  /**
   * Shared jump-lane count between each faction pair — derived from
   * `SystemConnection` rows where the two endpoints belong to different
   * factions. Keyed by `pairKey(a, b)`.
   */
  getBorderLengthsBetween(): Promise<Map<FactionPairKey, number>>;

  /**
   * Sum of TradeFlow quantities between each faction pair since `sinceTick`,
   * resolved via the from/to system's owning faction. Keyed by `pairKey`.
   */
  getTradeVolumeBetween(sinceTick: number): Promise<Map<FactionPairKey, number>>;

  /**
   * For each active border-conflict pair: a representative shared-border
   * systemId on the lower-score faction's side. Used when creating new
   * border_conflict events.
   */
  pickBorderConflictSystems(
    pairs: { factionAId: string; factionBId: string }[],
  ): Promise<Map<FactionPairKey, { systemId: string; regionId: string }>>;

  /** All active relations-spawned events (border_conflict, pact, dissolution). */
  getActiveRelationEvents(): Promise<RelationEventView[]>;

  /** Bulk apply pair score updates. Clamps + history append handled by adapter. */
  applyRelationUpdates(updates: RelationUpdate[]): Promise<void>;

  /**
   * Create relations-spawned events with metadata. `currentTick` becomes both
   * `startTick` and `phaseStartTick` on the new rows. Returns assigned ids.
   */
  createRelationEvents(
    creates: RelationEventCreate[],
    currentTick: number,
  ): Promise<string[]>;

  /** Delete relations-spawned events (used when resolving negotiations). */
  expireRelationEvents(eventIds: string[]): Promise<void>;

  /** Insert a new AlliancePact for the pair (canonical ordering enforced). */
  formAlliance(factionAId: string, factionBId: string, tick: number): Promise<void>;

  /** Delete the AlliancePact for the pair, if any. */
  dissolveAlliance(factionAId: string, factionBId: string): Promise<void>;
}

// ── Per-tick params ─────────────────────────────────────────────

export interface RelationsProcessorParams {
  /**
   * Window (in ticks) over which `getTradeVolumeBetween` aggregates — should
   * match `RELATIONS_FREQUENCY` so each pair-tick counts only the last batch
   * of trades.
   */
  tradeWindowTicks: number;
  /**
   * RNG source for event-template windows (negotiation duration, border
   * conflict phase rolls). Defaults to `Math.random` in the live wrapper;
   * tests and the simulator inject a seeded source for determinism.
   */
  rng?: () => number;
  /**
   * Hook for the war system: contributes positive deltas to in-flight
   * negotiation windows from diplomatic missions. Not yet wired up.
   */
  pendingAllianceInfluence?: (
    pairs: { factionAId: string; factionBId: string }[],
  ) => Map<FactionPairKey, number>;
}
