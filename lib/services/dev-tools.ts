/**
 * Dev tools service — server-side manipulation of game state.
 * Only usable in development mode.
 */

import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import { runWorldTick } from "@/lib/world/tick";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { getInitialStock } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import { buildModifiersForPhase, rollPhaseDuration } from "@/lib/engine/events";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { isEventTypeId } from "@/lib/types/guards";
import type { WorldEvent, WorldEventModifier } from "@/lib/world/types";

// ── Result types ────────────────────────────────────────────────

type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Advance ticks ───────────────────────────────────────────────

export async function advanceTicks(count: number): Promise<ServiceResult<{ newTick: number; elapsed: number }>> {
  if (count < 1 || count > 1000) {
    return { ok: false, error: "Count must be between 1 and 1000." };
  }
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded." };
  }

  const start = performance.now();

  let world = getWorld();
  for (let i = 0; i < count; i++) {
    const result = await runWorldTick(world);
    world = result.world;
  }
  setWorld(world);

  return {
    ok: true,
    data: {
      newTick: world.meta.currentTick,
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
  const eventId = `sim-${world.nextId}`;
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
      price: spotPrice(
        curveForGood(good.basePrice, good.priceFloor, good.priceCeiling, m.demandRate, m.anchorMult),
        m.stock,
      ),
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

  // Reset every market to its capacity-driven seed stock. anchorMult resets to
  // 1 alongside stock: all events (and their anchor_shift modifiers) are being
  // cleared, so the neutral anchor is the correct clean-slate value.
  const markets = world.markets.map((m) => {
    const sys = systemById.get(m.systemId);
    if (!sys) return m;
    const yields = resourceVectorFromColumns(
      {
        yieldGas: sys.yieldGas, yieldMinerals: sys.yieldMinerals, yieldOre: sys.yieldOre,
        yieldBiomass: sys.yieldBiomass, yieldArable: sys.yieldArable,
        yieldWater: sys.yieldWater, yieldRadioactive: sys.yieldRadioactive,
      },
      "yield",
    );
    const buildings = buildingsBySystem.get(sys.id) ?? {};
    return {
      ...m,
      stock: getInitialStock(buildings, yields, sys.population, m.goodId),
      anchorMult: 1,
    };
  });

  setWorld({ ...world, markets, events: [], modifiers: [] });

  return { ok: true, data: { marketsReset: markets.length, eventsCleared } };
}
