/**
 * Dev tools service — server-side manipulation of game state.
 * Only usable in development mode.
 */

import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import { tickLoop } from "@/lib/world/tick-loop";
import { getInitialStock } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import { spotPrice, curveForRow } from "@/lib/engine/market-pricing";
import { yieldsOf } from "@/lib/engine/resources";
import type { World } from "@/lib/world/types";

// ── Result types ────────────────────────────────────────────────

type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Advance ticks ───────────────────────────────────────────────

/**
 * Runs `count` ticks through `TickLoop.runTicks` — the real loop's own `tickOnce`/`emit`
 * path — rather than looping `runWorldTick` locally and committing once at the
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
 * Reset every market to its fresh-world state. Each row returns to its capacity-driven seed stock
 * with a neutral anchor, and the tick-persisted flow-state fields are returned to their world-gen
 * seed: satisfaction 1, the squeeze/proposal persistence counters 0, and the realised rate,
 * suppression and logistics-binding flags dropped (so the row reads exactly as a freshly generated
 * market). anchorMult resets to 1 alongside stock — there is no event-driven anchor_shift modifier
 * to reconcile it against any more.
 *
 * Does NOT touch `world.events`/`world.modifiers`: relations owns the event lifecycle now, and
 * modifiers rebuild from active events every tick (`rebuildWorldModifiers`, `lib/world/tick.ts`),
 * so clearing them here would only fight that rebuild. Deleting an active relations event
 * unconditionally would also be actively harmful — a `pact_under_negotiation` event parked above
 * the negotiation threshold can never respawn once cleared, because its spawn condition requires a
 * fresh threshold *crossing* (`lib/tick/processors/relations.ts`), permanently blocking that pair's
 * alliance.
 */
export function resetEconomy(): ServiceResult<{ marketsReset: number }> {
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded." };
  }
  const world = getWorld();

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

  setWorld({ ...world, markets });

  return { ok: true, data: { marketsReset: markets.length } };
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
