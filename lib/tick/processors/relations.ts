import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
} from "../types";
import {
  ALLIANCE,
  RELATIONS_FREQUENCY,
} from "@/lib/constants/relations";
import {
  allianceDissolvedTemplate,
  applyDriftToPair,
  borderConflictTemplate,
  computeConflictCounts,
  computeRelationDrift,
  eventLookupKey,
  indexAlliances,
  indexPairs,
  indexRelationEvents,
  pactNegotiationTemplate,
} from "@/lib/engine/relations";
import type {
  AlliancePactView,
  RelationEventCreate,
  RelationUpdate,
  RelationsProcessorParams,
  RelationsWorld,
} from "@/lib/tick/world/relations-world";
import { pairKey } from "@/lib/tick/world/relations-world";
import { PrismaRelationsWorld } from "@/lib/tick/adapters/prisma/relations";

/**
 * Pure processor body. Same logic runs against the Prisma adapter (live game)
 * and the in-memory adapter (unit tests). All knobs that vary come in via
 * `params`.
 *
 * Per-tick sequence:
 *   1. Snapshot factions / pairs / alliances / events / borders / trade.
 *   2. Apply drift to every pair via `computeRelationDrift`.
 *   3. Detect threshold crossings → spawn border_conflict / pact / dissolution events.
 *   4. Resolve relations-owned event windows: form/dissolve alliances and expire events.
 *
 * `border_conflict` events are owned by the events processor (multi-phase,
 * danger + production modifiers). `pact_under_negotiation` and
 * `alliance_dissolved` are owned by this processor (single-phase,
 * informational, expiry resolved here via metadata.expiresAtTick).
 */
export async function runRelationsProcessor(
  world: RelationsWorld,
  ctx: TickContext,
  params: RelationsProcessorParams,
): Promise<TickProcessorResult> {
  const factions = await world.getFactions();
  if (factions.length < 2) {
    return {};
  }
  const factionIds = factions.map((f) => f.id);
  const factionById = new Map(factions.map((f) => [f.id, f]));

  const pairs = await world.getFactionRelations();
  const alliances = await world.getActiveAlliances();
  const borderLengths = await world.getBorderLengthsBetween();
  const tradeVolumes = await world.getTradeVolumeBetween(
    ctx.tick - params.tradeWindowTicks,
  );
  const activeEvents = await world.getActiveRelationEvents();

  const pairIndex = indexPairs(pairs);
  const allianceIndex = indexAlliances(alliances);
  const eventIndex = indexRelationEvents(activeEvents);

  // ── 1. Drift every pair ──────────────────────────────────────
  const updates: RelationUpdate[] = [];
  const newScoreByPair = new Map<string, number>();

  for (const pair of pairs) {
    const a = factionById.get(pair.factionAId);
    const b = factionById.get(pair.factionBId);
    if (!a || !b) continue;

    const key = pairKey(pair.factionAId, pair.factionBId);
    const borderCount = borderLengths.get(key) ?? 0;
    const tradeVolume = tradeVolumes.get(key) ?? 0;
    const hasAlliance = allianceIndex.has(key);
    const { commonEnemyCount, allianceWithEnemyCount } = computeConflictCounts(
      pair.factionAId,
      pair.factionBId,
      factionIds,
      pairIndex,
      allianceIndex,
    );

    const drift = computeRelationDrift({
      pair,
      factionA: a,
      factionB: b,
      borderCount,
      tradeVolume,
      hasAlliance,
      commonEnemyCount,
      allianceWithEnemyCount,
    });

    const { newScore } = applyDriftToPair(pair, drift, ctx.tick);
    newScoreByPair.set(key, newScore);
    updates.push({
      factionAId: pair.factionAId,
      factionBId: pair.factionBId,
      newScore,
      delta: drift.delta,
      drivers: drift.drivers,
      tick: ctx.tick,
    });
  }

  if (updates.length > 0) {
    await world.applyRelationUpdates(updates);
  }

  // ── 2. Threshold-driven event spawns ─────────────────────────
  const eventCreates: RelationEventCreate[] = [];
  const borderConflictCandidates: { factionAId: string; factionBId: string }[] = [];

  for (const pair of pairs) {
    const key = pairKey(pair.factionAId, pair.factionBId);
    const nextScore = newScoreByPair.get(key);
    if (nextScore === undefined) continue;

    const hasBorderConflict = eventIndex.has(
      eventLookupKey("border_conflict", pair.factionAId, pair.factionBId),
    );
    const hasNegotiation = eventIndex.has(
      eventLookupKey("pact_under_negotiation", pair.factionAId, pair.factionBId),
    );
    const hasDissolution = eventIndex.has(
      eventLookupKey("alliance_dissolved", pair.factionAId, pair.factionBId),
    );
    const allianceActive = allianceIndex.has(key);

    // Pair entering the unfriendly band (≤ -25) without an active conflict.
    // Skip if already at war / already conflict-active — events processor
    // owns multi-phase border_conflict lifecycle.
    if (nextScore <= -25 && pair.score > -25 && !hasBorderConflict) {
      borderConflictCandidates.push({
        factionAId: pair.factionAId,
        factionBId: pair.factionBId,
      });
    }

    // Pair crossing alliance negotiation threshold (≥ +75).
    if (
      nextScore >= ALLIANCE.negotiationThreshold &&
      pair.score < ALLIANCE.negotiationThreshold &&
      !hasNegotiation &&
      !allianceActive
    ) {
      eventCreates.push(
        pactNegotiationTemplate(pair.factionAId, pair.factionBId, ctx.tick, Math.random),
      );
    }

    // Pair with an active alliance dropping below the dissolution threshold.
    if (
      allianceActive &&
      nextScore < ALLIANCE.dissolutionThreshold &&
      !hasDissolution
    ) {
      eventCreates.push(
        allianceDissolvedTemplate(pair.factionAId, pair.factionBId, ctx.tick),
      );
    }
  }

  // Resolve border-conflict system targets once, in bulk.
  if (borderConflictCandidates.length > 0) {
    const sysByPair = await world.pickBorderConflictSystems(borderConflictCandidates);
    for (const { factionAId, factionBId } of borderConflictCandidates) {
      const target = sysByPair.get(pairKey(factionAId, factionBId));
      if (!target) continue; // No shared-border system found — skip this spawn.
      eventCreates.push(
        borderConflictTemplate(
          factionAId,
          factionBId,
          target.systemId,
          target.regionId,
          Math.random,
        ),
      );
    }
  }

  if (eventCreates.length > 0) {
    await world.createRelationEvents(eventCreates, ctx.tick);
  }

  // ── 3. Resolve relations-owned event windows ─────────────────
  const toExpire: string[] = [];
  const toFormAlliance: AlliancePactView[] = [];
  const toDissolveAlliance: { factionAId: string; factionBId: string }[] = [];

  const pendingInfluence = params.pendingAllianceInfluence
    ? params.pendingAllianceInfluence(
        activeEvents
          .filter((e) => e.type === "pact_under_negotiation")
          .map((e) => ({
            factionAId: e.metadata.factionAId,
            factionBId: e.metadata.factionBId,
          })),
      )
    : new Map<string, number>();

  for (const ev of activeEvents) {
    if (ev.type === "border_conflict") continue; // events processor owns expiry

    const windowOver = ev.metadata.expiresAtTick <= ctx.tick;
    if (!windowOver) continue;

    const key = pairKey(ev.metadata.factionAId, ev.metadata.factionBId);

    if (ev.type === "pact_under_negotiation") {
      const baseScore = newScoreByPair.get(key) ?? 0;
      const influencedScore = baseScore + (pendingInfluence.get(key) ?? 0);
      if (influencedScore >= ALLIANCE.holdThreshold) {
        toFormAlliance.push({
          factionAId: ev.metadata.factionAId,
          factionBId: ev.metadata.factionBId,
          formedAtTick: ctx.tick,
          pendingDissolutionAtTick: null,
        });
      }
      toExpire.push(ev.id);
    } else if (ev.type === "alliance_dissolved") {
      toDissolveAlliance.push({
        factionAId: ev.metadata.factionAId,
        factionBId: ev.metadata.factionBId,
      });
      toExpire.push(ev.id);
    }
  }

  for (const f of toFormAlliance) {
    await world.formAlliance(f.factionAId, f.factionBId, ctx.tick);
  }
  for (const d of toDissolveAlliance) {
    await world.dissolveAlliance(d.factionAId, d.factionBId);
  }
  if (toExpire.length > 0) {
    await world.expireRelationEvents(toExpire);
  }

  return {};
}

// ── Live-game wiring ──────────────────────────────────────────────

export const relationsProcessor: TickProcessor = {
  name: "relations",
  frequency: RELATIONS_FREQUENCY,
  dependsOn: ["events"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaRelationsWorld(ctx.tx);
    return runRelationsProcessor(world, ctx, {
      tradeWindowTicks: RELATIONS_FREQUENCY,
    });
  },
};
