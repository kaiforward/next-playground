/**
 * Dev tools service — server-side manipulation of game state.
 * Only usable in development mode.
 */

import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import { tickLoop } from "@/lib/world/tick-loop";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { getInitialStock } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import { buildModifiersForPhase, rollPhaseDuration } from "@/lib/engine/events";
import { spotPrice, curveForRow } from "@/lib/engine/market-pricing";
import { yieldsOf } from "@/lib/engine/resources";
import { isEventTypeId } from "@/lib/types/guards";
import type { World, WorldEvent, WorldEventModifier } from "@/lib/world/types";

// ── Result types ────────────────────────────────────────────────

type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Advance ticks ───────────────────────────────────────────────

/**
 * Runs `count` ticks through `TickLoop.runTicks` — the real loop's own `tickOnce`/`emit` path
 * (build plan Task 13) — rather than looping `runWorldTick` locally and committing once at the
 * end. Every tick's own `setWorld` and subscriber notification fire exactly as they do for a paced
 * tick, so a worker (or any other `tickLoop.subscribe` consumer) sees the batch's progress the same
 * way it sees ordinary ticks — the store is never left stale until the whole batch finishes.
 */
export async function advanceTicks(count: number): Promise<ServiceResult<{ newTick: number; elapsed: number }>> {
  if (count < 1 || count > 1000) {
    return { ok: false, error: "Count must be between 1 and 1000." };
  }
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded." };
  }

  const start = performance.now();
  await tickLoop.runTicks(count);

  return {
    ok: true,
    data: {
      newTick: getWorld().meta.currentTick,
      elapsed: Math.round(performance.now() - start),
    },
  };
}

// ── Spawn event ─────────────────────────────────────────────────

export function spawnEvent(params: {
  systemId: string;
  eventType: string;
  severity?: number;
}): ServiceResult<{ eventId: string; type: string; phase: string }> {
  if (!isEventTypeId(params.eventType)) {
    return { ok: false, error: `Unknown event type: ${params.eventType}` };
  }
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded." };
  }
  const def = EVENT_DEFINITIONS[params.eventType];

  const world = getWorld();
  const system = world.systems.find((s) => s.id === params.systemId);
  if (!system) {
    return { ok: false, error: `System not found: ${params.systemId}` };
  }

  const severity = params.severity ?? 1.0;
  const firstPhase = def.phases[0];
  // Dev tool — outside the deterministic tick path, so Math.random is fine here.
  const duration = rollPhaseDuration(firstPhase.durationRange, Math.random);
  const tick = world.meta.currentTick;

  // Same id namespace the in-memory events adapter mints from.
  const eventId = `event-${world.nextId}`;
  const event: WorldEvent = {
    id: eventId,
    type: params.eventType,
    phase: firstPhase.name,
    systemId: system.id,
    regionId: system.regionId,
    startTick: tick,
    phaseStartTick: tick,
    phaseDuration: duration,
    severity,
    sourceEventId: null,
    metadata: null,
  };

  const modifiers: WorldEventModifier[] = buildModifiersForPhase(
    firstPhase,
    system.id,
    system.regionId,
    severity,
  ).map((row) => ({ eventId, ...row }));

  setWorld({
    ...world,
    events: [...world.events, event],
    modifiers: [...world.modifiers, ...modifiers],
    nextId: world.nextId + 1,
  });

  return {
    ok: true,
    data: { eventId, type: event.type, phase: event.phase },
  };
}

// ── Economy snapshot ────────────────────────────────────────────

export interface EconomySnapshotSystem {
  systemId: string;
  systemName: string;
  economyType: string;
  markets: {
    goodId: string;
    goodName: string;
    stock: number;
    price: number;
  }[];
}

export function getEconomySnapshot(): ServiceResult<{ systems: EconomySnapshotSystem[] }> {
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded." };
  }
  const world = getWorld();

  const marketsBySystem = new Map<string, EconomySnapshotSystem["markets"]>();
  for (const m of world.markets) {
    const good = GOODS[m.goodId];
    const list = marketsBySystem.get(m.systemId) ?? [];
    list.push({
      goodId: m.goodId,
      goodName: good.name,
      stock: m.stock,
      price: spotPrice(curveForRow(m, good), m.stock),
    });
    marketsBySystem.set(m.systemId, list);
  }

  const systems: EconomySnapshotSystem[] = [...world.systems]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((sys) => ({
      systemId: sys.id,
      systemName: sys.name,
      economyType: sys.economyType,
      markets: marketsBySystem.get(sys.id) ?? [],
    }));

  return { ok: true, data: { systems } };
}

// ── Reset economy ───────────────────────────────────────────────

/**
 * Reset every market to its fresh-world state and clear all events/modifiers. Each row returns to its
 * capacity-driven seed stock with a neutral anchor, and the tick-persisted flow-state fields are returned
 * to their world-gen seed: satisfaction 1, the squeeze/proposal persistence counters 0, and the realised
 * rate, suppression and logistics-binding flags dropped (so the row reads exactly as a freshly generated
 * market). anchorMult resets to 1 alongside stock: all events (and their anchor_shift modifiers) are being
 * cleared, so the neutral anchor is the correct clean-slate value.
 */
export function resetEconomy(): ServiceResult<{ marketsReset: number; eventsCleared: number }> {
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded." };
  }
  const world = getWorld();
  const eventsCleared = world.events.length;

  const buildingsBySystem = new Map<string, Record<string, number>>();
  for (const b of world.buildings) {
    const bag = buildingsBySystem.get(b.systemId) ?? {};
    bag[b.buildingType] = b.count;
    buildingsBySystem.set(b.systemId, bag);
  }
  const systemById = new Map(world.systems.map((s) => [s.id, s]));

  const markets = world.markets.map((m) => {
    const sys = systemById.get(m.systemId);
    if (!sys) return m;
    const yields = yieldsOf(sys);
    const buildings = buildingsBySystem.get(sys.id) ?? {};
    return {
      systemId: m.systemId,
      goodId: m.goodId,
      stock: getInitialStock(buildings, yields, sys.population, m.goodId),
      anchorMult: 1,
      demandRate: m.demandRate,
      storageCapacity: m.storageCapacity,
      satisfaction: 1,
      squeezeCycles: 0,
      proposalCycles: 0,
    };
  });

  setWorld({ ...world, markets, events: [], modifiers: [] });

  return { ok: true, data: { marketsReset: markets.length, eventsCleared } };
}

// ── Inspect world ───────────────────────────────────────────────

/**
 * A whole-world summary for console inspection (client-runtime spec §10: "Dev inspection of the
 * world — today possible by poking the server process — is a dev-only command exposing the current
 * snapshot"). Counts rather than full arrays deliberately — the point is a cheap at-a-glance shape
 * check from the browser console, not a second `saveGame`/export path (those already move the raw
 * world).
 */
export interface WorldInspection {
  meta: World["meta"];
  counts: {
    regions: number;
    systems: number;
    bodies: number;
    buildings: number;
    constructionProjects: number;
    connections: number;
    markets: number;
    factions: number;
    relations: number;
    alliancePacts: number;
    treasuries: number;
    events: number;
    modifiers: number;
    ships: number;
    flowEvents: number;
  };
  nextId: number;
}

export function inspectWorld(): ServiceResult<WorldInspection> {
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded." };
  }
  const world = getWorld();
  return {
    ok: true,
    data: {
      meta: world.meta,
      counts: {
        regions: world.regions.length,
        systems: world.systems.length,
        bodies: world.bodies.length,
        buildings: world.buildings.length,
        constructionProjects: world.constructionProjects.length,
        connections: world.connections.length,
        markets: world.markets.length,
        factions: world.factions.length,
        relations: world.relations.length,
        alliancePacts: world.alliancePacts.length,
        treasuries: world.treasuries.length,
        events: world.events.length,
        modifiers: world.modifiers.length,
        ships: world.ships.length,
        flowEvents: world.flowEvents.length,
      },
      nextId: world.nextId,
    },
  };
}
