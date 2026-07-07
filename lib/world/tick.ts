/**
 * `runWorldTick` — the one shared tick pipeline.
 *
 * The pure processor bodies (`lib/tick/processors/*`) run here against
 * in-memory adapters (`lib/tick/adapters/memory/*`). This is the ONLY
 * tick body — the live game's tick loop (`lib/world/tick-loop.ts`) and the
 * calibration harness (`lib/engine/simulator/runner.ts`) both call it.
 *
 * Stage order is the processors' dependency topological order:
 * ship-arrivals → events → economy → infrastructure-decay →
 * population → migration → trade-flow → directed-logistics → directed-build
 * → relations. Economy signals flow between stages via the in-memory
 * `TickContext.results` map.
 *
 * `World`'s flat rows (`WorldSystem`, `WorldMarket`, …) don't match the
 * adapters' `Sim*` row shapes field-for-field (see the join/merge helpers
 * below) — `World` is schema-faithful and omits catalog data (goods'
 * basePrice/floor/ceiling, a system's owning faction's governmentType) that
 * the adapters expect inlined. Those joins happen once per tick, from World
 * substrate that shouldn't itself be recomputed here.
 */

import { mulberry32, type RNG } from "@/lib/engine/universe-gen";
import { GOODS } from "@/lib/constants/goods";
import { scaleEventCaps, EVENT_SPAWN_INTERVAL, RELATIONS_EVENT_TYPES } from "@/lib/constants/events";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import { STRIKE_PARAMS, UNREST_PARAMS, POPULATION_PARAMS, MIGRATION_PARAMS } from "@/lib/constants/population";
import { INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { RELATIONS_FREQUENCY } from "@/lib/constants/relations";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { computeBoundedHopDistances } from "@/lib/engine/pathfinding";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import type { EventDefinition, EventPhaseDefinition, EventTypeId } from "@/lib/constants/events";
import { buildModifiersForPhase } from "@/lib/engine/events";
import type { GovernmentType } from "@/lib/types/game";

import { runShipArrivalsProcessor } from "@/lib/tick/processors/ship-arrivals";
import { runEventsProcessor } from "@/lib/tick/processors/events";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { runInfrastructureDecayProcessor } from "@/lib/tick/processors/infrastructure-decay";
import { runPopulationProcessor } from "@/lib/tick/processors/population";
import { runMigrationProcessor } from "@/lib/tick/processors/migration";
import { runTradeFlowProcessor } from "@/lib/tick/processors/trade-flow";
import { runDirectedLogisticsProcessor } from "@/lib/tick/processors/directed-logistics";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { runRelationsProcessor } from "@/lib/tick/processors/relations";

import { InMemoryShipArrivalsWorld } from "@/lib/tick/adapters/memory/ship-arrivals";
import { InMemoryEventsWorld } from "@/lib/tick/adapters/memory/events";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { InMemoryInfrastructureWorld } from "@/lib/tick/adapters/memory/infrastructure";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import { InMemoryMigrationWorld } from "@/lib/tick/adapters/memory/migration";
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import { InMemoryRelationsWorld } from "@/lib/tick/adapters/memory/relations";

import { mergeGlobalEvents } from "@/lib/tick/helpers";
import type {
  TickContext,
  TickEventRaw,
  GlobalEventMap,
} from "@/lib/tick/types";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import type { SystemLogisticsRow } from "@/lib/tick/world/directed-logistics-world";
import type { SystemBuildRow, BuildBuildingUpdate } from "@/lib/tick/world/directed-build-world";

import type {
  SimConnection,
  SimMarketEntry,
  SimSystem,
} from "@/lib/engine/simulator/types";
import type {
  World,
  WorldBuilding,
  WorldEvent,
  WorldEventMetadata,
  WorldEventModifier,
  WorldFlowEvent,
  WorldMarket,
  WorldSystem,
} from "./types";

// ── Per-tick RNG ────────────────────────────────────────────────

/**
 * Deterministic per-tick RNG stream — no hidden state to persist across
 * save/load. `tick` should be the NEW tick number (post-increment), so tick 0
 * (the freshly generated world, never ticked) never collides with tick 1's
 * stream.
 */
export function tickRng(seed: number, tick: number): RNG {
  return mulberry32((seed ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0);
}

// ── World → Sim row joins (World omits catalog/derived data the shared
// adapters expect inlined) ──────────────────────────────────────

/**
 * Exported alongside `toSimSystems`/`toSimMarkets` — the calibration harness
 * (`lib/engine/simulator/runner.ts`) reuses these same joins to build the
 * Sim-shaped views its (pre-existing) health analyzers read.
 */
export function toSimConnections(world: World): SimConnection[] {
  return world.connections.map((c) => ({
    fromSystemId: c.fromId,
    toSystemId: c.toId,
    fuelCost: c.fuelCost,
  }));
}

/**
 * Join a system's owning faction's governmentType, its traits, and its
 * building roster (all separate flat World arrays) onto one SimSystem row per
 * system — mirroring how `lib/tick/adapters/prisma/economy.ts` joins the same
 * data from relational tables.
 */
export function toSimSystems(world: World): SimSystem[] {
  const governmentByFaction = new Map<string, GovernmentType>(
    world.factions.map((f) => [f.id, f.governmentType]),
  );

  const traitsBySystem = new Map<string, { traitId: string; quality: number }[]>();
  for (const t of world.traits) {
    const list = traitsBySystem.get(t.systemId);
    const entry = { traitId: t.traitId, quality: t.quality };
    if (list) list.push(entry);
    else traitsBySystem.set(t.systemId, [entry]);
  }

  const buildingsBySystem = new Map<string, Record<string, number>>();
  for (const b of world.buildings) {
    const rec = buildingsBySystem.get(b.systemId);
    if (rec) rec[b.buildingType] = b.count;
    else buildingsBySystem.set(b.systemId, { [b.buildingType]: b.count });
  }

  return world.systems.map((s) => ({
    id: s.id,
    name: s.name,
    economyType: s.economyType,
    regionId: s.regionId,
    factionId: s.factionId,
    // Every seeded system has a non-null factionId; the fallback covers the
    // same edge case the Prisma adapter guards (a mid-write gap).
    governmentType: s.factionId
      ? (governmentByFaction.get(s.factionId) ?? "frontier")
      : "frontier",
    population: s.population,
    popCap: s.popCap,
    traits: traitsBySystem.get(s.id) ?? [],
    unrest: s.unrest,
    buildings: buildingsBySystem.get(s.id) ?? {},
    yields: resourceVectorFromColumns(
      {
        yieldGas: s.yieldGas, yieldMinerals: s.yieldMinerals, yieldOre: s.yieldOre,
        yieldBiomass: s.yieldBiomass, yieldArable: s.yieldArable,
        yieldWater: s.yieldWater, yieldRadioactive: s.yieldRadioactive,
      },
      "yield",
    ),
    slotCap: resourceVectorFromColumns(
      {
        slotGas: s.slotGas, slotMinerals: s.slotMinerals, slotOre: s.slotOre,
        slotBiomass: s.slotBiomass, slotArable: s.slotArable,
        slotWater: s.slotWater, slotRadioactive: s.slotRadioactive,
      },
      "slot",
    ),
    generalSpace: s.generalSpace,
    habitableSpace: s.habitableSpace,
  }));
}

/** Join each market row's good-catalog data (basePrice/floor/ceiling — code constants, not World state). */
export function toSimMarkets(world: World): SimMarketEntry[] {
  return world.markets.map((m) => {
    const good = GOODS[m.goodId];
    return {
      systemId: m.systemId,
      goodId: m.goodId,
      basePrice: good.basePrice,
      stock: m.stock,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
      priceFloor: good.priceFloor,
      priceCeiling: good.priceCeiling,
      storageCapacity: m.storageCapacity,
    };
  });
}

// ── Sim → World row merges (write only the fields tick processors mutate;
// everything else is immutable substrate) ──────────────────────

function mergeSystemsIntoWorld(worldSystems: WorldSystem[], simSystems: SimSystem[]): WorldSystem[] {
  const byId = new Map(simSystems.map((s) => [s.id, s]));
  return worldSystems.map((s) => {
    const sim = byId.get(s.id);
    if (!sim) return s;
    return { ...s, population: sim.population, popCap: sim.popCap, unrest: sim.unrest };
  });
}

/** Flatten each system's building Record back to World's one-row-per-(system,type) shape. */
function flattenBuildings(simSystems: SimSystem[]): WorldBuilding[] {
  const rows: WorldBuilding[] = [];
  for (const s of simSystems) {
    for (const [buildingType, count] of Object.entries(s.buildings)) {
      if (count > 0) rows.push({ systemId: s.id, buildingType, count });
    }
  }
  return rows;
}

function mergeMarketsIntoWorld(worldMarkets: WorldMarket[], simMarkets: SimMarketEntry[]): WorldMarket[] {
  const byKey = new Map(simMarkets.map((m) => [`${m.systemId}|${m.goodId}`, m]));
  return worldMarkets.map((m) => {
    const sim = byKey.get(`${m.systemId}|${m.goodId}`);
    if (!sim) return m;
    return { ...m, stock: sim.stock, anchorMult: sim.anchorMult, demandRate: sim.demandRate };
  });
}

// ── Directed-logistics / directed-build row builders (per-system rows the
// two planners share) ───────────────────────────────────────────

function marketRowsBySystem(markets: SimMarketEntry[]): Map<string, MarketRowForLogistics[]> {
  const bySystem = new Map<string, MarketRowForLogistics[]>();
  for (const m of markets) {
    const row: MarketRowForLogistics = {
      id: `${m.systemId}|${m.goodId}`,
      goodId: m.goodId,
      stock: m.stock,
      basePrice: m.basePrice,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
      priceFloor: m.priceFloor,
      priceCeiling: m.priceCeiling,
      storageCapacity: m.storageCapacity,
    };
    const list = bySystem.get(m.systemId);
    if (list) list.push(row);
    else bySystem.set(m.systemId, [row]);
  }
  return bySystem;
}

function buildLogisticsRows(
  systems: SimSystem[],
  marketsBySystem: Map<string, MarketRowForLogistics[]>,
): SystemLogisticsRow[] {
  return systems.map((s) => ({
    systemId: s.id,
    factionId: s.factionId,
    population: s.population,
    buildings: s.buildings,
    yields: s.yields,
    markets: marketsBySystem.get(s.id) ?? [],
  }));
}

function buildBuildRows(
  systems: SimSystem[],
  marketsBySystem: Map<string, MarketRowForLogistics[]>,
): SystemBuildRow[] {
  return systems.map((s) => ({
    systemId: s.id,
    factionId: s.factionId,
    population: s.population,
    unrest: s.unrest,
    buildings: s.buildings,
    yields: s.yields,
    slotCap: s.slotCap,
    generalSpace: s.generalSpace,
    habitableSpace: s.habitableSpace,
    markets: marketsBySystem.get(s.id) ?? [],
  }));
}

function applyStockUpdates(markets: SimMarketEntry[], updates: Map<string, number>): SimMarketEntry[] {
  if (updates.size === 0) return markets;
  return markets.map((m) => {
    const newStock = updates.get(`${m.systemId}|${m.goodId}`);
    return newStock !== undefined ? { ...m, stock: newStock } : m;
  });
}

/**
 * Patch just the rows directed-logistics changed, instead of remapping every
 * market row a second time for directed-build. `updates` keys are
 * `${systemId}|${goodId}` (same composite key `marketRowsBySystem` gives each
 * row's `id`); only the handful of touched systems get a new row array —
 * every other system's array is reused by reference.
 */
function patchMarketRowStocks(
  bySystem: Map<string, MarketRowForLogistics[]>,
  updates: Map<string, number>,
): Map<string, MarketRowForLogistics[]> {
  if (updates.size === 0) return bySystem;
  const touchedSystems = new Set<string>();
  for (const key of updates.keys()) {
    touchedSystems.add(key.slice(0, key.indexOf("|")));
  }
  const patched = new Map(bySystem);
  for (const systemId of touchedSystems) {
    const rows = patched.get(systemId);
    if (!rows) continue;
    patched.set(
      systemId,
      rows.map((r) => {
        const newStock = updates.get(r.id);
        return newStock !== undefined ? { ...r, stock: newStock } : r;
      }),
    );
  }
  return patched;
}

function applyBuildingIncreases(systems: SimSystem[], updates: BuildBuildingUpdate[]): SimSystem[] {
  if (updates.length === 0) return systems;
  const bySystem = new Map<string, Map<string, number>>();
  for (const u of updates) {
    const byType = bySystem.get(u.systemId) ?? new Map<string, number>();
    byType.set(u.buildingType, u.count);
    bySystem.set(u.systemId, byType);
  }
  return systems.map((s) => {
    const byType = bySystem.get(s.id);
    if (!byType) return s;
    const buildings = { ...s.buildings };
    for (const [type, count] of byType) buildings[type] = count;
    return { ...s, buildings };
  });
}

// ── Relations-owned events (border_conflict, pact_under_negotiation,
// alliance_dissolved) — the only WorldEvent rows carrying metadata ─────

const RELATIONS_OWNED_TYPES: ReadonlySet<EventTypeId> = new Set<EventTypeId>(
  RELATIONS_EVENT_TYPES,
);

function isRelationsOwnedEvent(
  e: WorldEvent,
): e is WorldEvent & { metadata: WorldEventMetadata } {
  return RELATIONS_OWNED_TYPES.has(e.type) && e.metadata !== null;
}

/**
 * Rebuild `world.modifiers` fresh from the final per-tick event list — the
 * same "derive modifiers from active events' current phase" approach
 * `InMemoryEventsWorld` uses internally (see its doc comment), just done here
 * with `eventId` attached (the in-memory events adapter doesn't track it;
 * `World`'s modifier rows are schema-faithful and require it).
 */
function rebuildWorldModifiers(
  events: WorldEvent[],
  definitions: Record<EventTypeId, EventDefinition>,
): WorldEventModifier[] {
  const out: WorldEventModifier[] = [];
  for (const e of events) {
    const def = definitions[e.type];
    if (!def) continue;
    const phase: EventPhaseDefinition | undefined = def.phases.find((p) => p.name === e.phase);
    if (!phase) continue;
    for (const row of buildModifiersForPhase(phase, e.systemId, e.regionId, e.severity)) {
      out.push({ eventId: e.id, ...row });
    }
  }
  return out;
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Run one world tick: ship-arrivals → events → economy → infrastructure-decay
 * → population → migration → trade-flow → directed-logistics →
 * directed-build → relations (gated by `RELATIONS_FREQUENCY`). Pure and
 * immutable-spread style — never mutates `world`; returns the next world plus
 * this tick's broadcast events.
 *
 * Async because the shared processor bodies are async (in-memory adapters
 * resolve immediately, but `await` still requires an async caller) — same
 * reason `simulateWorldTick` was async.
 */
export async function runWorldTick(
  world: World,
): Promise<{ world: World; events: TickEventRaw; markets: SimMarketEntry[] }> {
  const tick = world.meta.currentTick + 1;
  const rng = tickRng(world.meta.seed, tick);
  const scaled = scaleEventCaps(world.systems.length);

  const globalEvents: Partial<GlobalEventMap> = {};
  const processorsRun: string[] = [];

  let systems = toSimSystems(world);
  let markets = toSimMarkets(world);
  const connections = toSimConnections(world);
  let ships = world.ships;
  let flowEvents = world.flowEvents;
  let relations = world.relations;
  let alliancePacts = world.alliancePacts;
  let nextId = world.nextId;
  // Tracks each event's metadata across the events stage (SimEvent has no
  // metadata field — see lib/engine/simulator/types.ts's doc comment).
  const metadataByEventId = new Map(world.events.map((e) => [e.id, e.metadata]));
  let events: WorldEvent[] = world.events;

  const newTickCtx = (): TickContext => ({ tick, results: new Map() });

  // ── ship-arrivals ──
  {
    const shipsWorld = new InMemoryShipArrivalsWorld({ ships }, systems);
    const result = await runShipArrivalsProcessor(shipsWorld, { tick });
    ships = shipsWorld.ships;
    mergeGlobalEvents(globalEvents, result);
    processorsRun.push("ship-arrivals");
  }

  // ── events ──
  {
    const eventsWorld = new InMemoryEventsWorld(
      { events, modifiers: [], markets, nextId },
      systems,
      connections,
      scaled.definitions,
    );
    const result = await runEventsProcessor(eventsWorld, newTickCtx(), {
      rng,
      caps: { maxEventsGlobal: scaled.maxEventsGlobal, maxEventsPerSystem: scaled.maxEventsPerSystem },
      batchSize: scaled.batchSize,
      spawnInterval: EVENT_SPAWN_INTERVAL,
      definitions: scaled.definitions,
      spawnEnabled: true,
    });
    markets = eventsWorld.markets;
    nextId = eventsWorld.nextId;
    events = eventsWorld.events.map((e) => ({
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
      metadata: metadataByEventId.get(e.id) ?? null,
    }));
    mergeGlobalEvents(globalEvents, result);
    processorsRun.push("events");
  }

  // ── economy ──
  const economyWorld = new InMemoryEconomyWorld({ systems, markets, modifiers: rebuildWorldModifiers(events, scaled.definitions) });
  const economyResult = await runEconomyProcessor(economyWorld, newTickCtx(), {
    rng,
    interval: ECONOMY_UPDATE_INTERVAL,
    simParams: { noiseFraction: ECONOMY_CONSTANTS.NOISE_FRACTION, holdCover: ECONOMY_CONSTANTS.HOLD_COVER },
    modifierCaps: MODIFIER_CAPS,
    strikeParams: STRIKE_PARAMS,
  });
  systems = economyWorld.systems;
  markets = economyWorld.markets;
  const economySignals = economyResult.economySignals;
  mergeGlobalEvents(globalEvents, economyResult);
  processorsRun.push("economy");

  // ── infrastructure-decay ──
  if (economySignals) {
    const decayWorld = new InMemoryInfrastructureWorld({ systems });
    await runInfrastructureDecayProcessor(
      decayWorld,
      { tick, results: new Map([["economy", { economySignals }]]) },
      { decay: INFRASTRUCTURE_DECAY_PARAMS },
    );
    systems = decayWorld.systems;
    processorsRun.push("infrastructure-decay");
  }

  // ── population ──
  if (economySignals) {
    const popWorld = new InMemoryPopulationWorld({ systems, markets });
    await runPopulationProcessor(
      popWorld,
      { tick, results: new Map([["economy", { economySignals }]]) },
      { unrest: UNREST_PARAMS, population: POPULATION_PARAMS },
    );
    systems = popWorld.systems;
    markets = popWorld.markets;
    processorsRun.push("population");
  }

  // ── migration & trade-flow share one open-edges computation — faction
  // ownership doesn't change between these two stages within a tick, so the
  // same-faction edge set migration computes is still valid for trade-flow ──
  const sysFactionForEdges = new Map(systems.map((s) => [s.id, s.factionId]));
  const openEdges: EdgeView[] = buildOpenEdges(connections, sysFactionForEdges);

  // ── migration ──
  {
    const migWorld = new InMemoryMigrationWorld({ systems }, connections, openEdges);
    await runMigrationProcessor(migWorld, newTickCtx(), {
      interval: ECONOMY_UPDATE_INTERVAL,
      flow: MIGRATION_PARAMS,
    });
    systems = migWorld.systems;
    processorsRun.push("migration");
  }

  // ── trade-flow ──
  {
    const flowWorld = new InMemoryTradeFlowWorld({ systems, markets, flowEvents }, connections, openEdges);
    await runTradeFlowProcessor(flowWorld, newTickCtx(), {
      interval: ECONOMY_UPDATE_INTERVAL,
      flowBudget: TRADE_SIMULATION.FLOW_BUDGET,
      gradientThreshold: TRADE_SIMULATION.GRADIENT_THRESHOLD,
      gradientSensitivity: TRADE_SIMULATION.GRADIENT_SENSITIVITY,
      flowHistoryTicks: TRADE_SIMULATION.FLOW_HISTORY_TICKS,
      distanceDecay: TRADE_SIMULATION.DISTANCE_DECAY,
    });
    markets = flowWorld.markets;
    // flowType now round-trips structurally through SimFlowEvent (no more
    // object-identity side channel — see FlowEventInsert/SimFlowEvent).
    flowEvents = flowWorld.flowEvents.map((f) => ({
      tick: f.tick,
      fromSystemId: f.fromSystemId,
      toSystemId: f.toSystemId,
      goodId: f.goodId,
      quantity: f.quantity,
      flowType: f.flowType,
    }));
    processorsRun.push("trade-flow");
  }

  // directed-logistics and directed-build share one hop-BFS per tick, run at
  // the larger of their two (independently tunable) MAX_HOPS radii — each
  // stage's routeCost closure still applies its OWN cutoff below, so a BFS
  // computed at the larger radius is a safe superset for the smaller one.
  const hops = computeBoundedHopDistances(
    connections,
    Math.max(DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS),
  );
  // Per-system market row groups, built once and shared: directed-build
  // patches just the stock deltas directed-logistics applied instead of
  // remapping every market row a second time (see patchMarketRowStocks).
  const logisticsMarketRows = marketRowsBySystem(markets);
  let dlStockUpdates: Map<string, number> = new Map();

  // ── directed-logistics ──
  {
    const routeCost: RouteCost = (f, t) => {
      const h = hops.get(f)?.get(t);
      return h === undefined || h > DIRECTED_LOGISTICS.MAX_HOPS ? null : h * DIRECTED_LOGISTICS.HOP_WEIGHT;
    };
    const rows = buildLogisticsRows(systems, logisticsMarketRows);
    const dlWorld = new MemoryDirectedLogisticsWorld(rows);
    await runDirectedLogisticsProcessor(dlWorld, { tick }, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost,
    });
    markets = applyStockUpdates(markets, dlWorld.stockUpdates);
    dlStockUpdates = dlWorld.stockUpdates;
    const newLogisticsFlows: WorldFlowEvent[] = dlWorld.flows.map((f) => ({ ...f, flowType: "logistics" }));
    flowEvents = [...flowEvents, ...newLogisticsFlows];
    processorsRun.push("directed-logistics");
  }

  // ── directed-build ──
  {
    const routeCost: RouteCost = (f, t) => {
      const h = hops.get(f)?.get(t);
      return h === undefined || h > DIRECTED_BUILD.MAX_HOPS ? null : h * DIRECTED_BUILD.HOP_WEIGHT;
    };
    const rows = buildBuildRows(systems, patchMarketRowStocks(logisticsMarketRows, dlStockUpdates));
    const dbWorld = new MemoryDirectedBuildWorld(rows);
    await runDirectedBuildProcessor(dbWorld, { tick }, {
      interval: DIRECTED_BUILD.INTERVAL,
      routeCost,
    });
    systems = applyBuildingIncreases(systems, dbWorld.buildingUpdates);
    processorsRun.push("directed-build");
  }

  // ── relations (gated by RELATIONS_FREQUENCY, offset 0 — the one
  // processor that runs every Nth tick rather than every tick) ──
  if (world.factions.length >= 2 && tick % RELATIONS_FREQUENCY === 0) {
    const territoryByFaction = new Map<string, Set<string>>();
    for (const s of world.systems) {
      if (!s.factionId) continue;
      const set = territoryByFaction.get(s.factionId);
      if (set) set.add(s.id);
      else territoryByFaction.set(s.factionId, new Set([s.id]));
    }

    const relationsWorld = new InMemoryRelationsWorld({
      factions: world.factions.map((f) => ({
        id: f.id,
        name: f.name,
        governmentType: f.governmentType,
        doctrine: f.doctrine,
        territory: territoryByFaction.get(f.id) ?? new Set<string>(),
      })),
      relations,
      alliances: alliancePacts,
      systems: world.systems.map((s) => ({ id: s.id, regionId: s.regionId, factionId: s.factionId ?? "" })),
      connections: world.connections.map((c) => ({ fromSystemId: c.fromId, toSystemId: c.toId })),
      tradeFlows: flowEvents.map((f) => ({
        tick: f.tick, fromSystemId: f.fromSystemId, toSystemId: f.toSystemId, quantity: f.quantity,
      })),
      events: events.filter(isRelationsOwnedEvent),
      nextId,
    });

    await runRelationsProcessor(relationsWorld, newTickCtx(), { tradeWindowTicks: RELATIONS_FREQUENCY, rng });

    relations = relationsWorld.relations;
    alliancePacts = relationsWorld.alliances;
    nextId = relationsWorld.nextId;

    const updatedRelationsEvents: WorldEvent[] = relationsWorld.events.map((e) => ({
      id: e.id,
      type: e.type,
      phase: e.phase ?? "",
      systemId: e.systemId ?? null,
      regionId: e.regionId ?? null,
      startTick: e.startTick ?? tick,
      phaseStartTick: e.phaseStartTick,
      phaseDuration: e.phaseDuration,
      severity: e.severity ?? 1,
      sourceEventId: e.sourceEventId ?? null,
      metadata: e.metadata,
    }));
    events = [...events.filter((e) => !RELATIONS_OWNED_TYPES.has(e.type)), ...updatedRelationsEvents];
    processorsRun.push("relations");
  }

  // ── assemble the next World ──
  const nextWorld: World = {
    ...world,
    meta: { ...world.meta, currentTick: tick },
    systems: mergeSystemsIntoWorld(world.systems, systems),
    buildings: flattenBuildings(systems),
    markets: mergeMarketsIntoWorld(world.markets, markets),
    events,
    modifiers: rebuildWorldModifiers(events, scaled.definitions),
    ships,
    flowEvents,
    relations,
    alliancePacts,
    nextId,
  };

  const tickEvents: TickEventRaw = {
    currentTick: tick,
    events: globalEvents,
    processors: processorsRun,
  };

  // `markets` is already this tick's final Sim-shaped join (same one folded
  // into nextWorld above) — returned so callers that need the Sim view (the
  // calibration harness) don't have to re-run toSimMarkets(nextWorld) right
  // after we just built it.
  return { world: nextWorld, events: tickEvents, markets };
}
