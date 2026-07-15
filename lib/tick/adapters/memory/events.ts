import type {
  EventCreate,
  EventCreateResult,
  EventsWorld,
  EventWithName,
  NeighborWithName,
  PhaseAdvance,
  SystemShock,
  SystemWithName,
} from "@/lib/tick/world/events-world";
import { buildModifiersForPhase, type ModifierRow } from "@/lib/engine/events";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { isEconomicallyActive } from "@/lib/engine/control";
import type { EventDefinition, EventTypeId } from "@/lib/constants/events";
import type {
  SimConnection,
  SimEvent,
  SimMarketEntry,
  SimSystem,
} from "@/lib/engine/simulator/types";

/**
 * In-memory adapter. Owns mutable slices of the simulator's world for the
 * duration of one `runEventsProcessor` call; the caller reads the final
 * state via the public arrays after the processor returns.
 *
 * Modifiers in SimWorld don't carry an eventId, so when an event advances
 * or expires we rebuild the modifier set from the remaining active events.
 * Matches Prisma's `onDelete: Cascade` semantics for free and avoids the
 * sim's previous end-of-tick "rebuild all modifiers" pass.
 */
export class InMemoryEventsWorld implements EventsWorld {
  events: SimEvent[];
  modifiers: ModifierRow[];
  markets: SimMarketEntry[];
  nextId: number;

  constructor(
    initial: {
      events: SimEvent[];
      modifiers: ModifierRow[];
      markets: SimMarketEntry[];
      nextId: number;
    },
    private readonly systems: SimSystem[],
    private readonly connections: SimConnection[],
    private readonly definitions: Record<EventTypeId, EventDefinition>,
  ) {
    this.events = [...initial.events];
    this.modifiers = [...initial.modifiers];
    this.markets = initial.markets.map((m) => ({ ...m }));
    this.nextId = initial.nextId;
  }

  getEvents(): Promise<EventWithName[]> {
    const nameById = new Map(this.systems.map((s) => [s.id, s.name]));
    return Promise.resolve(
      this.events.map((e) => ({
        id: e.id,
        type: e.type,
        phase: e.phase,
        systemId: e.systemId,
        regionId: e.regionId,
        startTick: e.startTick,
        phaseStartTick: e.phaseStartTick,
        phaseDuration: e.phaseDuration,
        severity: e.severity,
        sourceEventId: e.sourceEventId,
        systemName: e.systemId ? (nameById.get(e.systemId) ?? null) : null,
      })),
    );
  }

  getSystems(): Promise<SystemWithName[]> {
    return Promise.resolve(
      this.systems.map((s) => ({
        id: s.id,
        name: s.name,
        economyType: s.economyType,
        regionId: s.regionId,
      })),
    );
  }

  getNeighborsBySystem(
    systemIds: string[],
  ): Promise<Map<string, NeighborWithName[]>> {
    const idSet = new Set(systemIds);
    const sysById = new Map(this.systems.map((s) => [s.id, s]));
    const result = new Map<string, NeighborWithName[]>();
    for (const c of this.connections) {
      if (!idSet.has(c.fromSystemId)) continue;
      const target = sysById.get(c.toSystemId);
      if (!target) continue;
      let list = result.get(c.fromSystemId);
      if (!list) {
        list = [];
        result.set(c.fromSystemId, list);
      }
      list.push({
        id: target.id,
        name: target.name,
        economyType: target.economyType,
        regionId: target.regionId,
      });
    }
    return Promise.resolve(result);
  }

  advancePhases(advances: PhaseAdvance[]): Promise<void> {
    if (advances.length === 0) return Promise.resolve();
    const byId = new Map(advances.map((a) => [a.eventId, a]));

    this.events = this.events.map((e) => {
      const adv = byId.get(e.id);
      if (!adv) return e;
      return {
        ...e,
        phase: adv.nextPhaseName,
        phaseStartTick: adv.phaseStartTick,
        phaseDuration: adv.phaseDuration,
      };
    });

    const advancingIds = new Set(byId.keys());
    this.modifiers = this.rebuildModifiersExcept(advancingIds);
    for (const adv of advances) {
      this.modifiers.push(...adv.modifiers);
    }
    return Promise.resolve();
  }

  expireEvents(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return Promise.resolve();
    const removeSet = new Set(eventIds);
    this.events = this.events.filter((e) => !removeSet.has(e.id));
    this.modifiers = this.rebuildModifiersExcept(new Set());
    return Promise.resolve();
  }

  createEvents(creates: EventCreate[]): Promise<EventCreateResult[]> {
    if (creates.length === 0) return Promise.resolve([]);

    const nameById = new Map(this.systems.map((s) => [s.id, s.name]));
    const results: EventCreateResult[] = [];

    for (const c of creates) {
      const id = `sim-${this.nextId++}`;
      this.events.push({
        id,
        type: c.type,
        phase: c.phase,
        systemId: c.systemId,
        regionId: c.regionId,
        startTick: c.startTick,
        phaseStartTick: c.phaseStartTick,
        phaseDuration: c.phaseDuration,
        severity: c.severity,
        sourceEventId: c.sourceEventId,
      });
      this.modifiers.push(...c.modifiers);
      results.push({
        eventId: id,
        systemName: nameById.get(c.systemId) ?? "Unknown",
      });
    }
    return Promise.resolve(results);
  }

  applyShocks(shocks: SystemShock[]): Promise<number> {
    if (shocks.length === 0) return Promise.resolve(0);

    const marketByKey = new Map<string, SimMarketEntry>();
    for (const m of this.markets) {
      marketByKey.set(`${m.systemId}|${m.goodId}`, m);
    }
    // A shock is a market-economic disruption; it only applies where an economy
    // runs. Non-developed systems are economically inert (their markets freeze),
    // so a shock targeting one is skipped — events still spawn galaxy-wide as
    // ambient flavour, but they can't unfreeze an inert market.
    const controlBySystem = new Map(this.systems.map((s) => [s.id, s.control]));

    const touched = new Set<SimMarketEntry>();
    for (const shock of shocks) {
      const control = controlBySystem.get(shock.systemId);
      if (control === undefined || !isEconomicallyActive(control)) continue;
      const market = marketByKey.get(`${shock.systemId}|${shock.goodId}`);
      if (!market) continue;
      if (!isFinite(shock.value)) continue;
      const delta =
        shock.mode === "percentage"
          ? market.stock * shock.value // continuous goods delta — no rounding (rounding breaks scale-invariance)
          : shock.value;
      // Single-stock model: a "supply" shock moves stock directly; a "demand"
      // shock moves it inversely (more demand → scarcer → lower stock).
      const signed = shock.parameter === "supply" ? delta : -delta;
      // Accumulate unclamped, then clamp once below — parity with the Prisma
      // adapter, which only clamps at write time. Clamping per-shock here would
      // diverge when ≥2 shocks hit the same market in one tick.
      market.stock += signed;
      touched.add(market);
    }
    for (const market of touched) {
      const band = marketBandForRow(market, market);
      market.stock = Math.max(band.minStock, Math.min(band.maxStock, market.stock));
    }
    return Promise.resolve(touched.size);
  }

  private rebuildModifiersExcept(exclude: Set<string>): ModifierRow[] {
    const out: ModifierRow[] = [];
    for (const e of this.events) {
      if (exclude.has(e.id)) continue;
      const def = this.definitions[e.type];
      if (!def) continue;
      const phase = def.phases.find((p) => p.name === e.phase);
      if (!phase) continue;
      out.push(
        ...buildModifiersForPhase(phase, e.systemId, e.regionId, e.severity),
      );
    }
    return out;
  }
}
