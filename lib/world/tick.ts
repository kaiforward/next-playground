/**
 * `runWorldTick` — the one shared tick pipeline.
 *
 * The pure processor bodies (`lib/tick/processors/*`) run here against
 * in-memory adapters (`lib/tick/adapters/memory/*`). This is the ONLY
 * tick body — the live game's tick loop (`lib/world/tick-loop.ts`) and the
 * calibration harness (`lib/tick-harness/runner.ts`) both call it.
 *
 * Stage order is the processors' dependency topological order:
 * ship-arrivals → events → economy → infrastructure-decay →
 * population → migration → directed-logistics → directed-build
 * → relations. Economy signals flow between stages via the in-memory
 * `TickContext.results` map.
 *
 * Only ship-arrivals and events run every tick. Everything from economy to
 * directed-build resolves on the monthly pulse (`isPulseTick`), and its setup is
 * gated on that same predicate rather than built and discarded — the bodies bail
 * internally too, so the gate is an optimisation, not the rule. Relations keeps its
 * own `RELATIONS_FREQUENCY` cadence.
 *
 * Some of `World`'s flat rows (`WorldSystem`, …) don't match the adapters'
 * `Tick*` row shapes field-for-field (see the join/merge helpers below) —
 * `World` is schema-faithful and omits derived data (a system's owning
 * faction's governmentType, its building roster) that the adapters expect
 * inlined. Those joins happen once per tick, from World substrate that
 * shouldn't itself be recomputed here.
 *
 * Markets are deliberately NOT among them: `WorldMarket` is already the tick's
 * market row, so the adapters read and write it directly and no per-tick join
 * or merge exists. A good's catalog constants (basePrice/priceFloor/
 * priceCeiling) are read from `GOODS[goodId]` where they're used. Joining them
 * onto every one of the galaxy's ~26 × systemCount market rows and stripping
 * them back off cost half of every tick.
 */

import { mulberry32, type RNG } from "@/lib/engine/universe-gen";
import { scaleEventCaps, EVENT_SPAWN_INTERVAL, RELATIONS_EVENT_TYPES } from "@/lib/constants/events";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import { STRIKE_PARAMS, UNREST_PARAMS, POPULATION_PARAMS, MIGRATION_PARAMS, COLONY_DELIVERY_PARAMS } from "@/lib/constants/population";
import { INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { CONSTRUCTION } from "@/lib/constants/construction";
import { EXPANSION } from "@/lib/constants/expansion";
import { RELATIONS_FREQUENCY } from "@/lib/constants/relations";
import { resourceVectorFromColumns, RESOURCE_TYPES } from "@/lib/engine/resources";
import { hopRouteCost, type ColonyEstablishCandidate } from "@/lib/engine/directed-build";
import type { ClaimCandidate } from "@/lib/engine/expansion";
import { housingPopCap } from "@/lib/engine/industry";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { COLONISATION } from "@/lib/constants/colonisation";
import { computeBoundedHopDistances } from "@/lib/engine/pathfinding";
import { isEconomicallyActive } from "@/lib/engine/control";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";
import type { EdgeView } from "@/lib/tick/world/trade-flow-topology";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import type { EventDefinition, EventPhaseDefinition, EventTypeId } from "@/lib/constants/events";
import { buildModifiersForPhase } from "@/lib/engine/events";
import type { GovernmentType } from "@/lib/types/game";

import { runShipArrivalsProcessor } from "@/lib/tick/processors/ship-arrivals";
import { runEventsProcessor } from "@/lib/tick/processors/events";
import { runEconomyProcessor, economyOffPulsePayload } from "@/lib/tick/processors/economy";
import { runInfrastructureDecayProcessor } from "@/lib/tick/processors/infrastructure-decay";
import { runPopulationProcessor } from "@/lib/tick/processors/population";
import { runMigrationProcessor } from "@/lib/tick/processors/migration";
import { runDirectedLogisticsProcessor } from "@/lib/tick/processors/directed-logistics";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { runRelationsProcessor } from "@/lib/tick/processors/relations";

import { InMemoryShipArrivalsWorld } from "@/lib/tick/adapters/memory/ship-arrivals";
import { InMemoryEventsWorld } from "@/lib/tick/adapters/memory/events";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { InMemoryInfrastructureWorld } from "@/lib/tick/adapters/memory/infrastructure";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import { InMemoryMigrationWorld } from "@/lib/tick/adapters/memory/migration";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import { InMemoryRelationsWorld } from "@/lib/tick/adapters/memory/relations";

import { mergeGlobalEvents } from "@/lib/tick/helpers";
import { isPulseTick } from "@/lib/tick/shard";
import type {
  TickContext,
  TickBroadcastRaw,
  GlobalEventMap,
  EconomySignals,
} from "@/lib/tick/types";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import type { SystemLogisticsRow } from "@/lib/tick/world/directed-logistics-world";
import type {
  SystemBuildRow,
  BuildBuildingUpdate,
  SystemClaim,
  SystemDevelopment,
} from "@/lib/tick/world/directed-build-world";

import type {
  TickConnection,
  TickSystem,
} from "@/lib/tick/rows";
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

// ── World → tick row joins (World omits catalog/derived data the shared
// adapters expect inlined) ──────────────────────────────────────

/**
 * Exported alongside `toTickSystems` — the calibration harness
 * (`lib/tick-harness/runner.ts`) reuses these same joins to build the
 * tick-row views its (pre-existing) health analyzers read.
 */
export function toTickConnections(world: World): TickConnection[] {
  return world.connections.map((c) => ({
    fromSystemId: c.fromId,
    toSystemId: c.toId,
    fuelCost: c.fuelCost,
  }));
}

/**
 * Join a system's owning faction's governmentType and its building roster
 * (separate flat World arrays) onto one TickSystem row per system — the
 * shape the in-memory tick adapters (`lib/tick/adapters/memory/*`) expect.
 */
export function toTickSystems(world: World): TickSystem[] {
  const governmentByFaction = new Map<string, GovernmentType>(
    world.factions.map((f) => [f.id, f.governmentType]),
  );

  // One pass over the flat building rows builds both the count roster and the idle-months roster.
  const buildingsBySystem = new Map<string, Record<string, number>>();
  const idleMonthsBySystem = new Map<string, Record<string, number>>();
  for (const b of world.buildings) {
    const rec = buildingsBySystem.get(b.systemId);
    if (rec) rec[b.buildingType] = b.count;
    else buildingsBySystem.set(b.systemId, { [b.buildingType]: b.count });
    const idle = idleMonthsBySystem.get(b.systemId);
    if (idle) idle[b.buildingType] = b.idleMonths;
    else idleMonthsBySystem.set(b.systemId, { [b.buildingType]: b.idleMonths });
  }

  return world.systems.map((s) => ({
    id: s.id,
    name: s.name,
    economyType: s.economyType,
    regionId: s.regionId,
    factionId: s.factionId,
    control: s.control,
    // Every seeded system has a non-null factionId; the fallback covers a
    // mid-write gap.
    governmentType: s.factionId
      ? (governmentByFaction.get(s.factionId) ?? "frontier")
      : "frontier",
    population: s.population,
    popCap: s.popCap,
    unrest: s.unrest,
    buildings: buildingsBySystem.get(s.id) ?? {},
    buildingIdleMonths: idleMonthsBySystem.get(s.id) ?? {},
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

// ── Tick → World row merges (write only the fields tick processors mutate;
// everything else is immutable substrate) ──────────────────────

function mergeSystemsIntoWorld(worldSystems: WorldSystem[], tickSystems: TickSystem[]): WorldSystem[] {
  const byId = new Map(tickSystems.map((s) => [s.id, s]));
  return worldSystems.map((s) => {
    const tickSystem = byId.get(s.id);
    if (!tickSystem) return s;
    // factionId + control propagate so the claim/develop expansion steps persist; for every
    // unchanged system they equal the original.
    return {
      ...s,
      factionId: tickSystem.factionId,
      control: tickSystem.control,
      population: tickSystem.population,
      popCap: tickSystem.popCap,
      unrest: tickSystem.unrest,
    };
  });
}

/** Flatten each system's building Record back to World's one-row-per-(system,type) shape. */
function flattenBuildings(tickSystems: TickSystem[]): WorldBuilding[] {
  const rows: WorldBuilding[] = [];
  for (const s of tickSystems) {
    for (const [buildingType, count] of Object.entries(s.buildings)) {
      if (count > 0) {
        rows.push({ systemId: s.id, buildingType, count, idleMonths: s.buildingIdleMonths[buildingType] ?? 0 });
      }
    }
  }
  return rows;
}

// ── Directed-logistics / directed-build row builders (per-system rows the
// two planners share) ───────────────────────────────────────────

function marketRowsBySystem(markets: WorldMarket[]): Map<string, MarketRowForLogistics[]> {
  const bySystem = new Map<string, MarketRowForLogistics[]>();
  for (const m of markets) {
    const row: MarketRowForLogistics = {
      id: `${m.systemId}|${m.goodId}`,
      goodId: m.goodId,
      stock: m.stock,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
      storageCapacity: m.storageCapacity,
    };
    const list = bySystem.get(m.systemId);
    if (list) list.push(row);
    else bySystem.set(m.systemId, [row]);
  }
  return bySystem;
}

function buildLogisticsRows(
  systems: TickSystem[],
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
  systems: TickSystem[],
  marketsBySystem: Map<string, MarketRowForLogistics[]>,
): SystemBuildRow[] {
  return systems.map((s) => ({
    systemId: s.id,
    factionId: s.factionId,
    control: s.control,
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

function applyStockUpdates(markets: WorldMarket[], updates: Map<string, number>): WorldMarket[] {
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

export function applyBuildingIncreases(systems: TickSystem[], updates: BuildBuildingUpdate[]): TickSystem[] {
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
    // Completed housing must raise the population cap — popCap tracks built housing (mirrors the
    // develop-transition seed at applyDevelopments). Without this, a colony can build housing but
    // never grow into it: popCap welds to its seed level and pop caps there forever. Only recompute
    // when housing actually changed; other builds don't affect popCap. Never lowers it (decay owns that).
    const popCap = byType.has(HOUSING_TYPE) ? Math.max(s.popCap, housingPopCap(buildings)) : s.popCap;
    return { ...s, buildings, popCap };
  });
}

/** Count of resources this system has any deposit slot for — a claim/develop score input. */
function countResourceDiversity(s: TickSystem): number {
  let n = 0;
  for (const r of RESOURCE_TYPES) if (s.slotCap[r] > 0) n++;
  return n;
}

/** Apply resolved claims: the target becomes `controlled` and owned by the winning faction. The
 * `: TickSystem` return annotation contextually narrows the `"controlled"` literal to `SystemControl`
 * (no `as`). */
function applyClaims(systems: TickSystem[], claims: SystemClaim[]): TickSystem[] {
  if (claims.length === 0) return systems;
  const factionBySystem = new Map(claims.map((c) => [c.systemId, c.factionId]));
  return systems.map((s): TickSystem => {
    const factionId = factionBySystem.get(s.id);
    if (factionId === undefined) return s;
    return { ...s, factionId, control: "controlled" };
  });
}

/**
 * Apply completed colony establishments: the target flips `developed`, receives the conserved seed
 * population (capped by what its stored source can spare), and lands its bundled housing so `popCap ≥
 * seedPop` on arrival (viable by construction — docs/planned/economy-colonisation-cost.md §2). The `:
 * TickSystem` annotation narrows the `"developed"` literal. `available` tracks each source's remaining
 * spendable population across the loop so two establishments sharing a source draw from the same
 * (shrinking) balance rather than both reading the original snapshot — otherwise a shared source would
 * mint population that was never conserved. popCap is raised to the placed housing's capacity (never
 * lowered) — the same figure infrastructure-decay recomputes next tick, set here so the colony is viable
 * the instant it exists.
 */
export function applyDevelopments(systems: TickSystem[], developments: SystemDevelopment[]): TickSystem[] {
  if (developments.length === 0) return systems;
  const bySystem = new Map(systems.map((s) => [s.id, s]));
  const popDelta = new Map<string, number>();
  const developed = new Set<string>();
  const housingBySystem = new Map<string, number>();
  const available = new Map<string, number>();
  for (const d of developments) {
    const source = bySystem.get(d.sourceSystemId);
    const target = bySystem.get(d.systemId);
    if (!source || !target) continue;
    const remaining = available.get(d.sourceSystemId) ?? Math.max(0, source.population);
    const moved = Math.min(d.seedPop, remaining);
    available.set(d.sourceSystemId, remaining - moved);
    popDelta.set(d.sourceSystemId, (popDelta.get(d.sourceSystemId) ?? 0) - moved);
    popDelta.set(d.systemId, (popDelta.get(d.systemId) ?? 0) + moved);
    developed.add(d.systemId);
    housingBySystem.set(d.systemId, (housingBySystem.get(d.systemId) ?? 0) + d.housingLevels);
  }
  return systems.map((s): TickSystem => {
    const delta = popDelta.get(s.id) ?? 0;
    const nowDeveloped = developed.has(s.id);
    if (delta === 0 && !nowDeveloped) return s;
    const buildings = nowDeveloped
      ? { ...s.buildings, [HOUSING_TYPE]: (s.buildings[HOUSING_TYPE] ?? 0) + (housingBySystem.get(s.id) ?? 0) }
      : s.buildings;
    return {
      ...s,
      population: Math.max(0, s.population + delta),
      control: nowDeveloped ? "developed" : s.control,
      buildings,
      popCap: nowDeveloped ? Math.max(s.popCap, housingPopCap(buildings)) : s.popCap,
    };
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
 * → population → migration → directed-logistics →
 * directed-build → relations (gated by `RELATIONS_FREQUENCY`). Pure and
 * immutable-spread style — never mutates `world`; returns the next world plus
 * this tick's broadcast events.
 *
 * Async because the shared processor bodies are async (in-memory adapters
 * resolve immediately, but `await` still requires an async caller) — same
 * reason `simulateWorldTick` was async.
 */
/**
 * Bounded hop distances depend only on the connection graph, which never
 * changes for the life of a world (nothing in the pipeline reassigns
 * `connections` into the next World). Keyed on the connections array's
 * identity — the store version can't be the key, it bumps on every
 * `setWorld()`, i.e. every tick. A new or loaded world brings a new array
 * and recomputes.
 */
let hopsCache: { key: World["connections"]; hops: Map<string, Map<string, number>> } | null =
  null;

export async function runWorldTick(
  world: World,
): Promise<{ world: World; events: TickBroadcastRaw; markets: WorldMarket[] }> {
  const tick = world.meta.currentTick + 1;
  const rng = tickRng(world.meta.seed, tick);
  const scaled = scaleEventCaps(world.systems.length);

  const globalEvents: Partial<GlobalEventMap> = {};
  const processorsRun: string[] = [];

  let systems = toTickSystems(world);
  // Starts as `world.markets` itself — no copy. Every stage that writes markets
  // hands back fresh rows (each adapter copies on construction) rather than
  // mutating the rows it was given, so this may alias the previous world until a
  // stage replaces it, and the final array folds straight back into nextWorld.
  // A stage that mutated a row in place would corrupt the previous world.
  let markets = world.markets;
  const connections = toTickConnections(world);
  let ships = world.ships;
  let flowEvents = world.flowEvents;
  let relations = world.relations;
  let alliancePacts = world.alliancePacts;
  let constructionProjects = world.constructionProjects;
  let nextId = world.nextId;
  // Preserves each event's metadata across the events stage, whose row type
  // (`TickEvent`, lib/tick/rows.ts) has no metadata field — re-attached at the
  // WorldEvent mapping below.
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
  // Load-bearing for the market alias above (see `let markets`): this stage is
  // unconditional and the first to touch markets, and its adapter copies every
  // row on construction — so `markets` stops aliasing `world.markets` here,
  // before any stage writes. Gating this stage, or moving it after another
  // market writer, would leave the previous world's rows exposed to mutation.
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

  // ── economy (pulse-gated) ──
  // Off-pulse this stage resolves nothing, so building its adapter — which copies
  // every system row and every market row in the galaxy — only to have the body bail
  // is pure waste. The gate emits the same off-pulse broadcast the body would have,
  // so a gated tick is indistinguishable from an ungated one from the outside.
  let economySignals: EconomySignals | undefined;
  if (isPulseTick(tick, ECONOMY_UPDATE_INTERVAL)) {
    const economyWorld = new InMemoryEconomyWorld({ systems, markets, modifiers: rebuildWorldModifiers(events, scaled.definitions) });
    const economyResult = await runEconomyProcessor(economyWorld, newTickCtx(), {
      interval: ECONOMY_UPDATE_INTERVAL,
      simParams: { holdCover: ECONOMY_CONSTANTS.HOLD_COVER },
      modifierCaps: MODIFIER_CAPS,
      strikeParams: STRIKE_PARAMS,
    });
    systems = economyWorld.systems;
    markets = economyWorld.markets;
    economySignals = economyResult.economySignals;
    mergeGlobalEvents(globalEvents, economyResult);
    processorsRun.push("economy");
  } else {
    mergeGlobalEvents(globalEvents, {
      globalEvents: economyOffPulsePayload(tick, ECONOMY_UPDATE_INTERVAL),
    });
  }

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

  // ── monthly pulse: migration, directed-logistics, directed-build (pulse-gated) ──
  // Each stage below resolves on the monthly pulse and bails internally otherwise, but
  // its setup — the participation set, the open-edge graph, the per-system market row
  // groups, the ownership maps — is read by nothing else, so off-pulse it was all built
  // and thrown away. The gate stops building those inputs; the bodies are untouched.
  //
  // The condition is the disjunction of the stages' OWN pulse predicates, each built
  // from the interval that stage's body is handed below, because the setup is shared
  // and any one stage resolving is reason to build it. The three intervals alias the
  // month today but are declared separately: gating on just one of them would let a
  // retune of another silently skip that stage's pulses — a performance mechanism
  // quietly deciding a gameplay cadence. A disjunction fails the safe way, building
  // setup nobody reads rather than dropping work. (Gating on the shortest interval
  // would NOT be safe: it only covers the others when it divides them.)
  //
  // The flowEvents retention prune is deliberately NOT in here: it is cheap, and it
  // runs every tick today (see below the block).
  const migrationResolves = isPulseTick(tick, ECONOMY_UPDATE_INTERVAL);
  const logisticsResolves = isPulseTick(tick, DIRECTED_LOGISTICS.INTERVAL);
  const buildResolves = isPulseTick(tick, DIRECTED_BUILD.INTERVAL);
  if (migrationResolves || logisticsResolves || buildResolves) {
    // ── economy-participation gate (developed only) ──
    // The three economy selection paths gate through isEconomicallyActive: the economy
    // adapter's getSystemIds (which cascades to infrastructure-decay + population),
    // migration's open edges (below), and directed-logistics' participants (below).
    // directed-build keeps the full `systems` — it needs unclaimed/controlled to claim
    // and develop.
    const developedSystemIds = new Set(
      systems.filter((s) => isEconomicallyActive(s.control)).map((s) => s.id),
    );

    // ── open edges (faction-bounded, then gated to developed-both for migration) ──
    const sysFactionForEdges = new Map(systems.map((s) => [s.id, s.factionId]));
    const openEdges: EdgeView[] = buildOpenEdges(connections, sysFactionForEdges);
    const migrationEdges = openEdges.filter(
      (e) => developedSystemIds.has(e.aSystemId) && developedSystemIds.has(e.bSystemId),
    );

    // ── migration ──
    {
      const migWorld = new InMemoryMigrationWorld({ systems }, connections, migrationEdges);
      await runMigrationProcessor(migWorld, newTickCtx(), {
        interval: ECONOMY_UPDATE_INTERVAL,
        flow: MIGRATION_PARAMS,
        delivery: COLONY_DELIVERY_PARAMS,
      });
      systems = migWorld.systems;
      processorsRun.push("migration");
    }

    // directed-logistics and directed-build share one hop-BFS, run at the
    // larger of their two (independently tunable) MAX_HOPS radii — each
    // stage's routeCost closure still applies its OWN cutoff below, so a BFS
    // computed at the larger radius is a safe superset for the smaller one.
    // The BFS is computed once per world, not per tick (see hopsCache).
    if (hopsCache?.key !== world.connections) {
      hopsCache = {
        key: world.connections,
        hops: computeBoundedHopDistances(
          connections,
          Math.max(DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS, EXPANSION.REACH_JUMPS),
        ),
      };
    }
    const hops = hopsCache.hops;
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
      // Directed-logistics moves goods only between developed systems.
      const rows = buildLogisticsRows(
        systems.filter((s) => developedSystemIds.has(s.id)),
        logisticsMarketRows,
      );
      const dlWorld = new MemoryDirectedLogisticsWorld(rows);
      await runDirectedLogisticsProcessor(dlWorld, { tick }, {
        interval: DIRECTED_LOGISTICS.INTERVAL,
        routeCost,
      });
      markets = applyStockUpdates(markets, dlWorld.stockUpdates);
      dlStockUpdates = dlWorld.stockUpdates;
      const newLogisticsFlows: WorldFlowEvent[] = dlWorld.flows;
      flowEvents = [...flowEvents, ...newLogisticsFlows];
      processorsRun.push("directed-logistics");
    }

    // ── directed-build ──
    // ⚠ Splitting construction's decision cadence from its execution cadence lands
    // inside this gate: work would accrue every tick while planning stays monthly, so
    // the per-tick funding step has to be carved back out of the pulse block above.
    // Planning inputs only move on the pulse, so the gate is correct as it stands.
    {
      const routeCost = hopRouteCost(hops, DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);

      // Ownership lookups reused by both providers.
      const factionBySystem = new Map(systems.map((s) => [s.id, s.factionId]));
      const controlBySystem = new Map(systems.map((s) => [s.id, s.control]));
      const tickSystemById = new Map(systems.map((s) => [s.id, s]));

      // Reach provider: a faction's in-reach UNCLAIMED candidates (reach extends from any owned tier).
      const reachProvider = (factionId: string): ClaimCandidate[] => {
        const minHopByCandidate = new Map<string, number>();
        for (const s of systems) {
          if (s.factionId !== factionId) continue;
          const neighbours = hops.get(s.id);
          if (!neighbours) continue;
          for (const [destId, h] of neighbours) {
            if (h <= 0 || h > EXPANSION.REACH_JUMPS) continue;
            if (factionBySystem.get(destId) !== null) continue; // only unclaimed
            const prev = minHopByCandidate.get(destId);
            if (prev === undefined || h < prev) minHopByCandidate.set(destId, h);
          }
        }
        const candidates: ClaimCandidate[] = [];
        for (const [candidateId, minHops] of minHopByCandidate) {
          const cand = tickSystemById.get(candidateId);
          if (!cand) continue;
          candidates.push({
            systemId: candidateId, minHops,
            habitableSpace: cand.habitableSpace,
            resourceDiversity: countResourceDiversity(cand),
          });
        }
        return candidates;
      };

      // Colony-candidate provider: a faction's CONTROLLED systems that have a reachable developed
      // same-faction seed source, tagged with their substrate + that source. The colony planner scores
      // them via colonyValue and funds establish projects from the shared pool.
      const developProvider = (factionId: string): ColonyEstablishCandidate[] => {
        const candidates: ColonyEstablishCandidate[] = [];
        for (const s of systems) {
          if (s.factionId !== factionId || s.control !== "controlled") continue;
          const neighbours = hops.get(s.id);
          let sourceSystemId: string | null = null;
          let bestHop = Infinity;
          if (neighbours) {
            for (const [destId, h] of neighbours) {
              if (h <= 0) continue;
              if (factionBySystem.get(destId) !== factionId) continue;
              if (controlBySystem.get(destId) !== "developed") continue;
              if (h < bestHop) { bestHop = h; sourceSystemId = destId; }
            }
          }
          if (sourceSystemId === null) continue; // no developed seed source reachable → cannot establish
          candidates.push({
            systemId: s.id,
            habitableSpace: s.habitableSpace,
            generalSpace: s.generalSpace,
            slotCap: s.slotCap,
            sourceSystemId,
          });
        }
        return candidates;
      };

      const rows = buildBuildRows(systems, patchMarketRowStocks(logisticsMarketRows, dlStockUpdates));
      const dbWorld = new MemoryDirectedBuildWorld(rows, constructionProjects);
      await runDirectedBuildProcessor(dbWorld, { tick }, {
        interval: DIRECTED_BUILD.INTERVAL,
        routeCost,
        construction: {
          cap: CONSTRUCTION.PER_BUILD_ABSORPTION_CAP,
          throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP,
          floorBase: CONSTRUCTION.POOL_FLOOR_BASE,
          floorKnee: CONSTRUCTION.FLOOR_DEV_KNEE,
          // Project ids draw from the world's monotonic counter, threaded through this tick.
          mintId: () => `construction-${nextId++}`,
        },
        claim: {
          reachProvider, rng,
          params: { maxClaimsPerPulse: EXPANSION.MAX_CLAIMS_PER_PULSE, scoreFloor: EXPANSION.SCORE_FLOOR, weights: EXPANSION.SCORE_WEIGHTS },
        },
        develop: {
          candidateProvider: developProvider,
          params: {
            landPremium: COLONISATION.LAND_PREMIUM,
            landGeneralWeight: COLONISATION.LAND_GENERAL_WEIGHT,
            landDepositWeight: COLONISATION.LAND_DEPOSIT_WEIGHT,
            sigmaFloor: COLONISATION.SIGMA_FLOOR,
            establishWork: COLONISATION.COLONY_ESTABLISH_WORK,
            seedPop: EXPANSION.COLONY_SEED_POP,
            habitableFloor: EXPANSION.DEVELOP_HABITABLE_FLOOR,
            popCostWeight: COLONISATION.SEED_POP_COST_WEIGHT,
            minSettlerSupply: COLONISATION.MIN_SETTLER_SUPPLY,
            employedLeakFraction: MIGRATION_PARAMS.employedLeakFraction,
          },
        },
      });
      systems = applyBuildingIncreases(systems, dbWorld.buildingUpdates);
      systems = applyClaims(systems, dbWorld.claims);
      systems = applyDevelopments(systems, dbWorld.developments);
      constructionProjects = dbWorld.constructionProjects;
      processorsRun.push("directed-build");
    }

  } // ── end monthly pulse ──

  // Directed-logistics is the only writer of flowEvents, and it only appends on the
  // pulse — but the prune stays every-tick, outside the gate above, so the retention
  // window is enforced on the tick it expires rather than up to a month late. It is a
  // filter over an already-bounded log; the pulse gate is not worth the drift.
  const flowRetentionFloor = tick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;
  flowEvents = flowEvents.filter((f) => f.tick >= flowRetentionFloor);

  // ── relations (gated by RELATIONS_FREQUENCY, offset 0 — the one stage on its
  // own cadence rather than the monthly pulse the block above rides) ──
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
    constructionProjects,
    markets,
    events,
    modifiers: rebuildWorldModifiers(events, scaled.definitions),
    ships,
    flowEvents,
    relations,
    alliancePacts,
    nextId,
  };

  const tickEvents: TickBroadcastRaw = {
    currentTick: tick,
    events: globalEvents,
    processors: processorsRun,
  };

  // `markets` is the same array folded into nextWorld above — returned so
  // callers that want this tick's market rows (the calibration harness) can
  // take them without reaching back into the world.
  return { world: nextWorld, events: tickEvents, markets };
}
