/**
 * Pure relations engine — deterministic drift math and event templates.
 * No DB or Prisma dependency. All inputs come in as plain views/maps.
 */

import {
  ALLIANCE,
  DOCTRINE_COMPATIBILITY,
  DRIFT_COEFFICIENTS,
  RELATION_HISTORY_MAX,
  clampRelationScore,
  getGovernmentOpposition,
  getRelationTier,
  type RelationTier,
} from "@/lib/constants/relations";
import type {
  AlliancePactView,
  FactionPairKey,
  FactionPairView,
  FactionView,
  RelationEventCreate,
  RelationEventMetadata,
  RelationEventView,
  RelationHistoryEntry,
} from "@/lib/tick/world/relations-world";
import { pairKey } from "@/lib/tick/world/relations-world";

// ── Drift computation ───────────────────────────────────────────

export interface DriftInput {
  pair: FactionPairView;
  factionA: FactionView;
  factionB: FactionView;
  borderCount: number;
  tradeVolume: number;
  hasAlliance: boolean;
  /** Count of common enemies (third-party factions hostile to both A and B). */
  commonEnemyCount: number;
  /** Count of cross-pair situations where A's ally is B's enemy or vice versa. */
  allianceWithEnemyCount: number;
}

export interface DriftResult {
  delta: number;
  /** Compact comma-separated driver summary, e.g. `"baseline:-0.05,border:-0.04"`. */
  drivers: string;
}

/**
 * Sum every driver into a single tick delta and emit a human-readable driver
 * trace. Magnitudes mirror `DRIFT_COEFFICIENTS` and the doctrine/government
 * tables — small, so visible movement takes 100s of ticks.
 */
export function computeRelationDrift(input: DriftInput): DriftResult {
  const {
    factionA,
    factionB,
    borderCount,
    tradeVolume,
    hasAlliance,
    commonEnemyCount,
    allianceWithEnemyCount,
  } = input;

  const parts: { name: string; value: number }[] = [];

  parts.push({ name: "baseline", value: DRIFT_COEFFICIENTS.baselineBias });

  if (borderCount > 0) {
    parts.push({
      name: "border",
      value: DRIFT_COEFFICIENTS.perBorderFriction * borderCount,
    });
  }

  const doctrine = DOCTRINE_COMPATIBILITY[factionA.doctrine][factionB.doctrine];
  if (doctrine !== 0) parts.push({ name: "doctrine", value: doctrine });

  const govOpp = getGovernmentOpposition(
    factionA.governmentType,
    factionB.governmentType,
  );
  if (govOpp !== 0) parts.push({ name: "gov-opp", value: govOpp });

  if (hasAlliance) {
    parts.push({ name: "alliance", value: DRIFT_COEFFICIENTS.alliancePresent });
  }

  if (commonEnemyCount > 0) {
    parts.push({
      name: "common-enemy",
      value: DRIFT_COEFFICIENTS.perCommonEnemy * commonEnemyCount,
    });
  }

  if (allianceWithEnemyCount > 0) {
    parts.push({
      name: "ally-of-enemy",
      value: DRIFT_COEFFICIENTS.allianceWithEnemy * allianceWithEnemyCount,
    });
  }

  if (tradeVolume > 0) {
    const raw = DRIFT_COEFFICIENTS.perTradeUnit * tradeVolume;
    const capped = Math.min(raw, DRIFT_COEFFICIENTS.maxTradeBonus);
    parts.push({ name: "trade", value: capped });
  }

  const delta = parts.reduce((s, p) => s + p.value, 0);
  const drivers = parts
    .map((p) => `${p.name}:${p.value >= 0 ? "+" : ""}${p.value.toFixed(3)}`)
    .join(",");

  return { delta, drivers };
}

/**
 * Apply a drift result to a pair's current score: clamp and append to the
 * history ring buffer. The adapter persists the result; this is the pure
 * piece both adapters share.
 */
export function applyDriftToPair(
  current: FactionPairView,
  drift: DriftResult,
  tick: number,
): { newScore: number; newHistory: RelationHistoryEntry[] } {
  const newScore = clampRelationScore(current.score + drift.delta);
  const entry: RelationHistoryEntry = {
    tick,
    delta: Number(drift.delta.toFixed(3)),
    drivers: drift.drivers,
  };
  const newHistory = [...current.history, entry].slice(-RELATION_HISTORY_MAX);
  return { newScore, newHistory };
}

// ── Tier transition detection ───────────────────────────────────

export interface TierTransition {
  factionAId: string;
  factionBId: string;
  oldTier: RelationTier;
  newTier: RelationTier;
  oldScore: number;
  newScore: number;
}

export function detectTierTransition(
  pair: FactionPairView,
  newScore: number,
): TierTransition | null {
  const oldTier = getRelationTier(pair.score);
  const newTier = getRelationTier(newScore);
  if (oldTier === newTier) return null;
  return {
    factionAId: pair.factionAId,
    factionBId: pair.factionBId,
    oldTier,
    newTier,
    oldScore: pair.score,
    newScore,
  };
}

// ── Event templates ─────────────────────────────────────────────

/**
 * Sample a duration uniformly from `[min, max]` inclusive. Mirrors
 * `lib/engine/events.ts:rollPhaseDuration` — kept local so the relations
 * engine doesn't import event-engine internals.
 */
export function rollWindow(range: readonly [number, number], rng: () => number): number {
  const [min, max] = range;
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function borderConflictTemplate(
  factionAId: string,
  factionBId: string,
  systemId: string,
  regionId: string,
  rng: () => number,
): RelationEventCreate {
  // First phase duration comes from the event definition's tension phase;
  // duplicated here as a fallback so the engine stays pure (no event-def import).
  // Range matches lib/constants/events.ts:borderConflict.phases[0].durationRange.
  const phaseDuration = rollWindow([15, 25], rng);
  return {
    type: "border_conflict",
    phase: "tension",
    systemId,
    regionId,
    phaseDuration,
    severity: 1,
    metadata: {
      factionAId,
      factionBId,
      // Border conflicts are owned by the events processor; expiresAtTick is
      // only meaningful for relations-owned events. Set to a sentinel so the
      // relations processor never tries to resolve them.
      expiresAtTick: Number.MAX_SAFE_INTEGER,
    },
  };
}

export function pactNegotiationTemplate(
  factionAId: string,
  factionBId: string,
  currentTick: number,
  rng: () => number,
): RelationEventCreate {
  const window = rollWindow(ALLIANCE.negotiationWindow, rng);
  return {
    type: "pact_under_negotiation",
    phase: "negotiation",
    systemId: null,
    regionId: null,
    // Never auto-expired by events processor; relations owns the lifecycle.
    phaseDuration: Number.MAX_SAFE_INTEGER,
    severity: 1,
    metadata: {
      factionAId,
      factionBId,
      expiresAtTick: currentTick + window,
    },
  };
}

export function allianceDissolvedTemplate(
  factionAId: string,
  factionBId: string,
  currentTick: number,
): RelationEventCreate {
  return {
    type: "alliance_dissolved",
    phase: "dissolving",
    systemId: null,
    regionId: null,
    phaseDuration: Number.MAX_SAFE_INTEGER,
    severity: 1,
    metadata: {
      factionAId,
      factionBId,
      expiresAtTick: currentTick + ALLIANCE.dissolutionWindow,
    },
  };
}

// ── Pair indexing helpers ───────────────────────────────────────

/**
 * Index relation pairs by canonical pairKey. Pairs are assumed to already
 * be in canonical form (factionAId < factionBId) — adapters guarantee this.
 */
export function indexPairs(
  pairs: readonly FactionPairView[],
): Map<FactionPairKey, FactionPairView> {
  const m = new Map<FactionPairKey, FactionPairView>();
  for (const p of pairs) m.set(pairKey(p.factionAId, p.factionBId), p);
  return m;
}

/** Index active alliances by canonical pairKey. */
export function indexAlliances(
  alliances: readonly AlliancePactView[],
): Map<FactionPairKey, AlliancePactView> {
  const m = new Map<FactionPairKey, AlliancePactView>();
  for (const a of alliances) m.set(pairKey(a.factionAId, a.factionBId), a);
  return m;
}

/** Group active relations events by `(type, pairKey)` for quick membership checks. */
export function indexRelationEvents(
  events: readonly RelationEventView[],
): Map<string, RelationEventView> {
  const m = new Map<string, RelationEventView>();
  for (const e of events) {
    const key = `${e.type}|${pairKey(e.metadata.factionAId, e.metadata.factionBId)}`;
    m.set(key, e);
  }
  return m;
}

export function eventLookupKey(
  type: RelationEventView["type"],
  factionAId: string,
  factionBId: string,
): string {
  return `${type}|${pairKey(factionAId, factionBId)}`;
}

// ── Common-enemy / ally-of-enemy precomputation ─────────────────

const HOSTILE_THRESHOLD = -25; // top of the unfriendly band; see RELATION_TIERS

export interface ConflictCounts {
  commonEnemyCount: number;
  allianceWithEnemyCount: number;
}

/**
 * For a single pair, count common enemies and ally-of-enemy entanglements.
 *
 * - commonEnemy: third-party faction X where pair(A,X) and pair(B,X) are both
 *   in the unfriendly/hostile band (score < HOSTILE_THRESHOLD).
 * - allianceWithEnemy: third-party X where A is allied to X and pair(B,X) is
 *   hostile (or symmetric: B allied to X and pair(A,X) hostile).
 */
export function computeConflictCounts(
  factionAId: string,
  factionBId: string,
  factionIds: readonly string[],
  pairIndex: Map<FactionPairKey, FactionPairView>,
  allianceIndex: Map<FactionPairKey, AlliancePactView>,
): ConflictCounts {
  let commonEnemyCount = 0;
  let allianceWithEnemyCount = 0;

  for (const x of factionIds) {
    if (x === factionAId || x === factionBId) continue;

    const ax = pairIndex.get(pairKey(factionAId, x));
    const bx = pairIndex.get(pairKey(factionBId, x));
    const axHostile = !!ax && ax.score < HOSTILE_THRESHOLD;
    const bxHostile = !!bx && bx.score < HOSTILE_THRESHOLD;

    if (axHostile && bxHostile) commonEnemyCount++;

    const aAlliedX = allianceIndex.has(pairKey(factionAId, x));
    const bAlliedX = allianceIndex.has(pairKey(factionBId, x));
    if ((aAlliedX && bxHostile) || (bAlliedX && axHostile)) {
      allianceWithEnemyCount++;
    }
  }

  return { commonEnemyCount, allianceWithEnemyCount };
}

// ── Metadata parsing ────────────────────────────────────────────

/**
 * Validate JSON parsed from `GameEvent.metadata` against the relations event
 * shape. Returns null if any field is missing or wrongly typed — caller
 * should drop the event.
 */
export function parseRelationEventMetadata(
  raw: unknown,
): RelationEventMetadata | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (!("factionAId" in raw) || typeof raw.factionAId !== "string") return null;
  if (!("factionBId" in raw) || typeof raw.factionBId !== "string") return null;
  if (!("expiresAtTick" in raw) || typeof raw.expiresAtTick !== "number") return null;
  return {
    factionAId: raw.factionAId,
    factionBId: raw.factionBId,
    expiresAtTick: raw.expiresAtTick,
  };
}
