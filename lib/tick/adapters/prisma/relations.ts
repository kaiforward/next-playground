import type { TxClient } from "@/lib/tick/types";
import type {
  AlliancePactView,
  FactionPairKey,
  FactionPairView,
  FactionView,
  RelationEventCreate,
  RelationEventView,
  RelationHistoryEntry,
  RelationUpdate,
  RelationsWorld,
} from "@/lib/tick/world/relations-world";
import { pairKey } from "@/lib/tick/world/relations-world";
import {
  RELATIONS_MIN,
  RELATIONS_MAX,
  RELATION_HISTORY_MAX,
} from "@/lib/constants/relations";
import { parseRelationEventMetadata } from "@/lib/engine/relations";
import { buildModifiersForPhase } from "@/lib/engine/events";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import {
  deriveFactionStatus,
  toDoctrine,
  toGovernmentType,
  toEventTypeId,
} from "@/lib/types/guards";

/** Canonical ordering: factionAId < factionBId. */
function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function parseHistory(json: string): RelationHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const out: RelationHistoryEntry[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" && item !== null &&
        typeof (item as { tick?: unknown }).tick === "number" &&
        typeof (item as { delta?: unknown }).delta === "number" &&
        typeof (item as { drivers?: unknown }).drivers === "string"
      ) {
        const e = item as { tick: number; delta: number; drivers: string };
        out.push({ tick: e.tick, delta: e.delta, drivers: e.drivers });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function clampScore(score: number): number {
  // PostgreSQL rejects NaN/Infinity in double precision[] params and aborts
  // the transaction. Guard at the boundary even though drift math should
  // never produce non-finite values today.
  if (!Number.isFinite(score)) return 0;
  return Math.max(RELATIONS_MIN, Math.min(RELATIONS_MAX, score));
}

/**
 * Live-game adapter. Bulk-writes via `unnest()` follow the events adapter
 * pattern. Border-length and trade-volume queries fan out wide but only run
 * every `RELATIONS_FREQUENCY` ticks, so latency budget is comfortable.
 */
export class PrismaRelationsWorld implements RelationsWorld {
  constructor(private tx: TxClient) {}

  async getFactions(): Promise<FactionView[]> {
    // Single query: factions + per-faction system count via _count relation.
    const rows = await this.tx.faction.findMany({
      select: {
        id: true,
        name: true,
        governmentType: true,
        doctrine: true,
        _count: { select: { territory: true } },
      },
    });
    return rows.map((r) => {
      const territorySize = r._count.territory;
      return {
        id: r.id,
        name: r.name,
        governmentType: toGovernmentType(r.governmentType),
        doctrine: toDoctrine(r.doctrine),
        territorySize,
        status: deriveFactionStatus(territorySize),
      };
    });
  }

  async getFactionRelations(): Promise<FactionPairView[]> {
    const rows = await this.tx.factionRelation.findMany({
      select: {
        factionAId: true,
        factionBId: true,
        score: true,
        historyJson: true,
        updatedAtTick: true,
      },
    });
    return rows.map((r) => ({
      factionAId: r.factionAId,
      factionBId: r.factionBId,
      score: r.score,
      history: parseHistory(r.historyJson),
      updatedAtTick: r.updatedAtTick,
    }));
  }

  async getActiveAlliances(): Promise<AlliancePactView[]> {
    const rows = await this.tx.alliancePact.findMany({
      select: {
        factionAId: true,
        factionBId: true,
        formedAtTick: true,
        pendingDissolutionAtTick: true,
      },
    });
    return rows.map((r) => ({
      factionAId: r.factionAId,
      factionBId: r.factionBId,
      formedAtTick: r.formedAtTick,
      pendingDissolutionAtTick: r.pendingDissolutionAtTick,
    }));
  }

  async getBorderLengthsBetween(): Promise<Map<FactionPairKey, number>> {
    // A "border lane" is a SystemConnection whose two endpoints belong to
    // different factions. Group counts per unordered (factionA, factionB).
    const rows = await this.tx.systemConnection.findMany({
      select: {
        fromSystem: { select: { factionId: true } },
        toSystem: { select: { factionId: true } },
      },
    });
    const out = new Map<FactionPairKey, number>();
    for (const c of rows) {
      const a = c.fromSystem.factionId;
      const b = c.toSystem.factionId;
      if (!a || !b || a === b) continue;
      const key = pairKey(a, b);
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  }

  async getTradeVolumeBetween(
    sinceTick: number,
  ): Promise<Map<FactionPairKey, number>> {
    // Aggregate quantity by (from-faction, to-faction) across recent TradeFlow rows.
    // The join is large; restrict by tick first via the TradeFlow index.
    const rows = await this.tx.tradeFlow.findMany({
      where: { tick: { gte: sinceTick } },
      select: {
        quantity: true,
        fromSystem: { select: { factionId: true } },
        toSystem: { select: { factionId: true } },
      },
    });
    const out = new Map<FactionPairKey, number>();
    for (const f of rows) {
      const a = f.fromSystem.factionId;
      const b = f.toSystem.factionId;
      if (!a || !b || a === b) continue;
      const key = pairKey(a, b);
      out.set(key, (out.get(key) ?? 0) + f.quantity);
    }
    return out;
  }

  async pickBorderConflictSystems(
    pairs: { factionAId: string; factionBId: string }[],
  ): Promise<Map<FactionPairKey, { systemId: string; regionId: string }>> {
    if (pairs.length === 0) return new Map();

    // Collect all faction ids referenced; fetch border connections once.
    const refs = new Set<string>();
    for (const p of pairs) {
      refs.add(p.factionAId);
      refs.add(p.factionBId);
    }
    const refList = [...refs];

    const conns = await this.tx.systemConnection.findMany({
      where: {
        fromSystem: { factionId: { in: refList } },
        toSystem: { factionId: { in: refList } },
      },
      select: {
        fromSystem: {
          select: { id: true, factionId: true, regionId: true },
        },
        toSystem: {
          select: { id: true, factionId: true, regionId: true },
        },
      },
    });

    // Bucket border systems by canonical pair: { from: [], to: [] }.
    // We pick a system on each side of the border and resolve later via score.
    interface BorderEndpoint {
      systemId: string;
      regionId: string;
      factionId: string;
    }
    const byPair = new Map<FactionPairKey, BorderEndpoint[]>();
    for (const c of conns) {
      const fA = c.fromSystem.factionId;
      const fB = c.toSystem.factionId;
      if (!fA || !fB || fA === fB) continue;
      const key = pairKey(fA, fB);
      let list = byPair.get(key);
      if (!list) {
        list = [];
        byPair.set(key, list);
      }
      // Push the "to" endpoint — the system that sits on the other side of the lane.
      list.push({
        systemId: c.toSystem.id,
        regionId: c.toSystem.regionId,
        factionId: fB,
      });
    }

    const out = new Map<FactionPairKey, { systemId: string; regionId: string }>();
    for (const { factionAId, factionBId } of pairs) {
      const key = pairKey(factionAId, factionBId);
      const candidates = byPair.get(key);
      if (!candidates || candidates.length === 0) continue;
      // Pick deterministically: first candidate. Refining to "lower-score
      // faction's side of the densest segment" is a future polish item — for
      // Foundation any shared-border system is acceptable.
      const pick = candidates[0];
      out.set(key, { systemId: pick.systemId, regionId: pick.regionId });
    }
    return out;
  }

  async getActiveRelationEvents(): Promise<RelationEventView[]> {
    const rows = await this.tx.gameEvent.findMany({
      where: {
        type: { in: ["border_conflict", "pact_under_negotiation", "alliance_dissolved"] },
      },
      select: {
        id: true,
        type: true,
        phaseStartTick: true,
        phaseDuration: true,
        metadata: true,
      },
    });
    const out: RelationEventView[] = [];
    for (const r of rows) {
      let parsedMeta: unknown;
      try {
        parsedMeta = JSON.parse(r.metadata);
      } catch {
        continue;
      }
      const metadata = parseRelationEventMetadata(parsedMeta);
      if (!metadata) continue;
      out.push({
        id: r.id,
        type: toEventTypeId(r.type),
        phaseStartTick: r.phaseStartTick,
        phaseDuration: r.phaseDuration,
        metadata,
      });
    }
    return out;
  }

  async applyRelationUpdates(updates: RelationUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    const canonicalUpdates = updates.map((u) => {
      const [a, b] = canonical(u.factionAId, u.factionBId);
      return { ...u, factionAId: a, factionBId: b };
    });

    // Refetch current history so we append rather than overwrite.
    const currentRows = await this.tx.factionRelation.findMany({
      where: {
        OR: canonicalUpdates.map((u) => ({
          factionAId: u.factionAId,
          factionBId: u.factionBId,
        })),
      },
      select: { factionAId: true, factionBId: true, historyJson: true },
    });

    const historyByPair = new Map<FactionPairKey, RelationHistoryEntry[]>();
    for (const row of currentRows) {
      historyByPair.set(
        pairKey(row.factionAId, row.factionBId),
        parseHistory(row.historyJson),
      );
    }

    const aIds: string[] = [];
    const bIds: string[] = [];
    const scores: number[] = [];
    const historyJsons: string[] = [];
    const ticks: number[] = [];
    for (const u of canonicalUpdates) {
      const prior = historyByPair.get(pairKey(u.factionAId, u.factionBId)) ?? [];
      const next: RelationHistoryEntry[] = [
        ...prior,
        { tick: u.tick, delta: Number(u.delta.toFixed(3)), drivers: u.drivers },
      ].slice(-RELATION_HISTORY_MAX);
      aIds.push(u.factionAId);
      bIds.push(u.factionBId);
      scores.push(clampScore(u.newScore));
      historyJsons.push(JSON.stringify(next));
      ticks.push(u.tick);
    }

    await this.tx.$executeRaw`
      UPDATE "FactionRelation" AS fr
      SET "score" = batch."score",
          "historyJson" = batch."historyJson",
          "updatedAtTick" = batch."updatedAtTick"
      FROM unnest(
        ${aIds}::text[],
        ${bIds}::text[],
        ${scores}::double precision[],
        ${historyJsons}::text[],
        ${ticks}::int[]
      ) AS batch("factionAId", "factionBId", "score", "historyJson", "updatedAtTick")
      WHERE fr."factionAId" = batch."factionAId" AND fr."factionBId" = batch."factionBId"`;
  }

  async createRelationEvents(
    creates: RelationEventCreate[],
    currentTick: number,
  ): Promise<string[]> {
    if (creates.length === 0) return [];

    const created = await this.tx.gameEvent.createManyAndReturn({
      data: creates.map((c) => ({
        type: c.type,
        phase: c.phase,
        systemId: c.systemId,
        regionId: c.regionId,
        startTick: currentTick,
        phaseStartTick: currentTick,
        phaseDuration: c.phaseDuration,
        severity: c.severity,
        sourceEventId: null,
        metadata: JSON.stringify(c.metadata),
      })),
      select: { id: true },
    });

    // Materialize modifier rows for border_conflict — the only relations
    // event with phase modifiers. Pact / dissolution events carry empty
    // phases (purely informational, render on the political map).
    const modifierRows: {
      eventId: string;
      domain: string;
      type: string;
      targetType: string;
      targetId: string | null;
      goodId: string | null;
      parameter: string;
      value: number;
    }[] = [];
    for (let i = 0; i < created.length; i++) {
      const c = creates[i];
      if (c.type !== "border_conflict") continue;
      const def = EVENT_DEFINITIONS[c.type];
      const phase = def.phases.find((p) => p.name === c.phase);
      if (!phase) continue;
      const rows = buildModifiersForPhase(phase, c.systemId, c.regionId, c.severity);
      for (const m of rows) {
        modifierRows.push({ eventId: created[i].id, ...m });
      }
    }
    if (modifierRows.length > 0) {
      await this.tx.eventModifier.createMany({ data: modifierRows });
    }

    return created.map((r) => r.id);
  }

  async expireRelationEvents(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    // Modifiers cascade via the schema's onDelete: Cascade.
    await this.tx.gameEvent.deleteMany({ where: { id: { in: eventIds } } });
  }

  async formAlliance(
    factionAId: string,
    factionBId: string,
    tick: number,
  ): Promise<void> {
    const [a, b] = canonical(factionAId, factionBId);
    // upsert in case a stale row lingers — keeps the unique constraint happy.
    await this.tx.alliancePact.upsert({
      where: { factionAId_factionBId: { factionAId: a, factionBId: b } },
      create: {
        factionAId: a,
        factionBId: b,
        formedAtTick: tick,
        pendingDissolutionAtTick: null,
      },
      update: { formedAtTick: tick, pendingDissolutionAtTick: null },
    });
  }

  async dissolveAlliance(
    factionAId: string,
    factionBId: string,
  ): Promise<void> {
    const [a, b] = canonical(factionAId, factionBId);
    await this.tx.alliancePact.deleteMany({
      where: { factionAId: a, factionBId: b },
    });
  }
}
