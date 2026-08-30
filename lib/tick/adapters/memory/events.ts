import type {
  EventsWorld,
  EventWithName,
  PhaseAdvance,
} from "@/lib/tick/world/events-world";
import { buildModifiersForPhase, type ModifierRow } from "@/lib/engine/events";
import type { EventDefinition, EventTypeId } from "@/lib/constants/events";
import type { TickEvent, TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";

/**
 * In-memory adapter. Owns mutable slices of the tick's rows for the duration of
 * one `runEventsProcessor` call; the caller reads the final state via the public
 * arrays after the processor returns.
 *
 * Modifier rows carry no eventId, so when an event advances or expires the
 * modifier set is rebuilt from the remaining active events.
 */
export class InMemoryEventsWorld implements EventsWorld {
  events: TickEvent[];
  modifiers: ModifierRow[];
  markets: WorldMarket[];

  constructor(
    initial: {
      events: TickEvent[];
      modifiers: ModifierRow[];
      markets: WorldMarket[];
    },
    private readonly systems: TickSystem[],
    private readonly definitions: Record<EventTypeId, EventDefinition>,
  ) {
    this.events = [...initial.events];
    this.modifiers = [...initial.modifiers];
    // Load-bearing de-alias: the events stage is unconditional and the first
    // to touch markets each tick (lib/world/tick.ts), so this copy is what
    // stops a later stage's writes from reaching the previous world's rows.
    this.markets = initial.markets.map((m) => ({ ...m }));
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
