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
  RELATIONS_MAX,
  RELATIONS_MIN,
  RELATION_HISTORY_MAX,
} from "@/lib/constants/relations";
import { deriveFactionStatus } from "@/lib/types/guards";

interface MemoryFaction {
  id: string;
  name: string;
  governmentType: FactionView["governmentType"];
  doctrine: FactionView["doctrine"];
  /** Set of systemIds owned by this faction (drives territorySize). */
  territory: Set<string>;
}

interface MemoryRelation {
  factionAId: string;
  factionBId: string;
  score: number;
  history: RelationHistoryEntry[];
  updatedAtTick: number;
}

interface MemoryConnection {
  fromSystemId: string;
  toSystemId: string;
}

interface MemorySystem {
  id: string;
  regionId: string;
  factionId: string;
}

interface MemoryTradeFlow {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  quantity: number;
}

interface MemoryRelationEvent {
  id: string;
  type: RelationEventView["type"];
  phaseStartTick: number;
  phaseDuration: number;
  metadata: RelationEventView["metadata"];
}

/**
 * In-memory adapter for the relations processor. Built for unit and
 * integration tests of the processor body; SimWorld doesn't model factions
 * directly today (PR 3 doesn't extend the simulator), so callers construct
 * this adapter with explicit fixtures.
 *
 * Pair convention: factionAId < factionBId. Stored canonical; reads/writes
 * normalize input on every call.
 */
export class InMemoryRelationsWorld implements RelationsWorld {
  factions: MemoryFaction[];
  relations: MemoryRelation[];
  alliances: AlliancePactView[];
  systems: MemorySystem[];
  connections: MemoryConnection[];
  tradeFlows: MemoryTradeFlow[];
  events: MemoryRelationEvent[];
  private nextId: number;

  constructor(initial: {
    factions: MemoryFaction[];
    relations?: MemoryRelation[];
    alliances?: AlliancePactView[];
    systems?: MemorySystem[];
    connections?: MemoryConnection[];
    tradeFlows?: MemoryTradeFlow[];
    events?: MemoryRelationEvent[];
    nextId?: number;
  }) {
    this.factions = initial.factions.map((f) => ({
      ...f,
      territory: new Set(f.territory),
    }));
    this.relations = (initial.relations ?? []).map((r) => {
      const [a, b] = r.factionAId < r.factionBId ? [r.factionAId, r.factionBId] : [r.factionBId, r.factionAId];
      return {
        factionAId: a,
        factionBId: b,
        score: r.score,
        history: [...r.history],
        updatedAtTick: r.updatedAtTick,
      };
    });
    this.alliances = (initial.alliances ?? []).map((a) => {
      const [aId, bId] = a.factionAId < a.factionBId ? [a.factionAId, a.factionBId] : [a.factionBId, a.factionAId];
      return { ...a, factionAId: aId, factionBId: bId };
    });
    this.systems = (initial.systems ?? []).map((s) => ({ ...s }));
    this.connections = (initial.connections ?? []).map((c) => ({ ...c }));
    this.tradeFlows = (initial.tradeFlows ?? []).map((t) => ({ ...t }));
    this.events = (initial.events ?? []).map((e) => ({
      ...e,
      metadata: { ...e.metadata },
    }));
    this.nextId = initial.nextId ?? 1;
  }

  getFactions(): Promise<FactionView[]> {
    const totalSystems = this.factions.reduce((sum, f) => sum + f.territory.size, 0);
    return Promise.resolve(
      this.factions.map((f) => ({
        id: f.id,
        name: f.name,
        governmentType: f.governmentType,
        doctrine: f.doctrine,
        territorySize: f.territory.size,
        status: deriveFactionStatus(f.territory.size, totalSystems),
      })),
    );
  }

  getFactionRelations(): Promise<FactionPairView[]> {
    return Promise.resolve(
      this.relations.map((r) => ({
        factionAId: r.factionAId,
        factionBId: r.factionBId,
        score: r.score,
        history: [...r.history],
        updatedAtTick: r.updatedAtTick,
      })),
    );
  }

  getActiveAlliances(): Promise<AlliancePactView[]> {
    return Promise.resolve(this.alliances.map((a) => ({ ...a })));
  }

  getBorderLengthsBetween(): Promise<Map<FactionPairKey, number>> {
    const factionBySystem = new Map(this.systems.map((s) => [s.id, s.factionId]));
    const out = new Map<FactionPairKey, number>();
    for (const c of this.connections) {
      const a = factionBySystem.get(c.fromSystemId);
      const b = factionBySystem.get(c.toSystemId);
      if (!a || !b || a === b) continue;
      const key = pairKey(a, b);
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    return Promise.resolve(out);
  }

  getTradeVolumeBetween(sinceTick: number): Promise<Map<FactionPairKey, number>> {
    const factionBySystem = new Map(this.systems.map((s) => [s.id, s.factionId]));
    const out = new Map<FactionPairKey, number>();
    for (const f of this.tradeFlows) {
      if (f.tick < sinceTick) continue;
      const a = factionBySystem.get(f.fromSystemId);
      const b = factionBySystem.get(f.toSystemId);
      if (!a || !b || a === b) continue;
      const key = pairKey(a, b);
      out.set(key, (out.get(key) ?? 0) + f.quantity);
    }
    return Promise.resolve(out);
  }

  pickBorderConflictSystems(
    pairs: { factionAId: string; factionBId: string }[],
  ): Promise<Map<FactionPairKey, { systemId: string; regionId: string }>> {
    const sysById = new Map(this.systems.map((s) => [s.id, s]));
    const factionBySystem = new Map(this.systems.map((s) => [s.id, s.factionId]));
    const out = new Map<FactionPairKey, { systemId: string; regionId: string }>();
    for (const { factionAId, factionBId } of pairs) {
      for (const c of this.connections) {
        const fA = factionBySystem.get(c.fromSystemId);
        const fB = factionBySystem.get(c.toSystemId);
        if (!fA || !fB || fA === fB) continue;
        // Either endpoint belongs to one of the two factions and the other to the other.
        const matches =
          (fA === factionAId && fB === factionBId) ||
          (fA === factionBId && fB === factionAId);
        if (!matches) continue;
        const pickSys = sysById.get(c.toSystemId);
        if (!pickSys) continue;
        out.set(pairKey(factionAId, factionBId), {
          systemId: pickSys.id,
          regionId: pickSys.regionId,
        });
        break;
      }
    }
    return Promise.resolve(out);
  }

  getActiveRelationEvents(): Promise<RelationEventView[]> {
    return Promise.resolve(
      this.events.map((e) => ({
        id: e.id,
        type: e.type,
        phaseStartTick: e.phaseStartTick,
        phaseDuration: e.phaseDuration,
        metadata: { ...e.metadata },
      })),
    );
  }

  applyRelationUpdates(updates: RelationUpdate[]): Promise<void> {
    const byPair = new Map(
      this.relations.map((r) => [pairKey(r.factionAId, r.factionBId), r]),
    );
    for (const u of updates) {
      const row = byPair.get(pairKey(u.factionAId, u.factionBId));
      if (!row) continue;
      const clamped = Math.max(RELATIONS_MIN, Math.min(RELATIONS_MAX, u.newScore));
      row.score = clamped;
      row.updatedAtTick = u.tick;
      row.history = [
        ...row.history,
        { tick: u.tick, delta: Number(u.delta.toFixed(3)), drivers: u.drivers },
      ].slice(-RELATION_HISTORY_MAX);
    }
    return Promise.resolve();
  }

  createRelationEvents(
    creates: RelationEventCreate[],
    currentTick: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const c of creates) {
      const id = `mem-rel-${this.nextId++}`;
      ids.push(id);
      this.events.push({
        id,
        type: c.type,
        // Mirror Prisma adapter: startTick == phaseStartTick on create.
        phaseStartTick: currentTick,
        phaseDuration: c.phaseDuration,
        metadata: { ...c.metadata },
      });
    }
    return Promise.resolve(ids);
  }

  expireRelationEvents(eventIds: string[]): Promise<void> {
    const set = new Set(eventIds);
    this.events = this.events.filter((e) => !set.has(e.id));
    return Promise.resolve();
  }

  formAlliance(
    factionAId: string,
    factionBId: string,
    tick: number,
  ): Promise<void> {
    const [a, b] = factionAId < factionBId ? [factionAId, factionBId] : [factionBId, factionAId];
    const existing = this.alliances.find(
      (x) => x.factionAId === a && x.factionBId === b,
    );
    if (existing) {
      existing.formedAtTick = tick;
      existing.pendingDissolutionAtTick = null;
    } else {
      this.alliances.push({
        factionAId: a,
        factionBId: b,
        formedAtTick: tick,
        pendingDissolutionAtTick: null,
      });
    }
    return Promise.resolve();
  }

  dissolveAlliance(
    factionAId: string,
    factionBId: string,
  ): Promise<void> {
    const [a, b] = factionAId < factionBId ? [factionAId, factionBId] : [factionBId, factionAId];
    this.alliances = this.alliances.filter(
      (x) => !(x.factionAId === a && x.factionBId === b),
    );
    return Promise.resolve();
  }
}
