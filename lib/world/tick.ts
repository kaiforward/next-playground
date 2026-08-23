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
 * → treasury → relations. Economy signals flow between stages via the
 * in-memory `TickContext.results` map; treasury also reads the work
 * directed-logistics and directed-build each performed this tick.
 *
 * Only ship-arrivals and events run every tick. Everything from economy to
 * directed-build resolves on the cycle start (`isCycleStart`), and its setup is
 * gated on that same predicate rather than built and discarded — the bodies bail
 * internally too, so the gate is an optimisation, not the rule. Treasury settles
 * on the same cycle start but also runs mid-cycle to accrue work performed by
 * directed-logistics/directed-build's own (finer) cadences. Relations keeps its
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
import { ECONOMY_SIM_PARAMS } from "@/lib/constants/economy";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import { STRIKE_PARAMS, UNREST_PARAMS, POPULATION_PARAMS, EXPECTATION_PARAMS, MIGRATION_PARAMS, COLONY_DELIVERY_PARAMS } from "@/lib/constants/population";
import { MIN_DEMAND } from "@/lib/constants/market-economy";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import { INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { CYCLE_LENGTH, CONSTRUCTION_INTERVAL, LOGISTICS_INTERVAL, type TickCadence } from "@/lib/constants/tick-cadence";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { CONSTRUCTION } from "@/lib/constants/construction";
import { EXPANSION } from "@/lib/constants/expansion";
import { RELATIONS_FREQUENCY } from "@/lib/constants/relations";
import { depositCountsOf, yieldsOf, effOf, RESOURCE_TYPES } from "@/lib/engine/resources";
import { BODY_ARCHETYPES, HABITABILITY_THRESHOLD } from "@/lib/constants/bodies";
import { hopRouteCost, type ColonyEstablishCandidate } from "@/lib/engine/directed-build";
import type { ClaimCandidate } from "@/lib/engine/expansion";
import { housingPopCap } from "@/lib/engine/industry";
import { HOUSING_TYPE, effectiveSpaceCost } from "@/lib/constants/industry";
import { COLONISATION } from "@/lib/constants/colonisation";
import { computeBoundedHopDistances } from "@/lib/engine/pathfinding";
import { isEconomicallyActive } from "@/lib/engine/control";
import { ECONOMY_SCALE } from "@/lib/constants/economy-scale";
import { TREASURY, REFERENCE_VALUE, TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { maintenanceOutputMalus, maintenanceBufferScale } from "@/lib/engine/treasury";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";
import type { EdgeView } from "@/lib/tick/world/trade-flow-topology";
import type { ReachableSystemIds, RouteCost } from "@/lib/engine/directed-logistics";
import type { EventDefinition, EventPhaseDefinition, EventTypeId } from "@/lib/constants/events";
import { buildModifiersForPhase } from "@/lib/engine/events";
import type { GovernmentType } from "@/lib/types/game";

import { runShipArrivalsProcessor } from "@/lib/tick/processors/ship-arrivals";
import { runEventsProcessor } from "@/lib/tick/processors/events";
import { runEconomyProcessor, economyMidCyclePayload } from "@/lib/tick/processors/economy";
import { runInfrastructureDecayProcessor } from "@/lib/tick/processors/infrastructure-decay";
import { runPopulationProcessor } from "@/lib/tick/processors/population";
import { runMigrationProcessor } from "@/lib/tick/processors/migration";
import { runDirectedLogisticsProcessor } from "@/lib/tick/processors/directed-logistics";
import type { DrawBrakeCeiling } from "@/lib/tick/processors/good-market-state";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { createSystemMarkets } from "@/lib/world/markets";
import { runRelationsProcessor } from "@/lib/tick/processors/relations";
import { runTreasuryProcessor } from "@/lib/tick/processors/treasury";

import { InMemoryShipArrivalsWorld } from "@/lib/tick/adapters/memory/ship-arrivals";
import { InMemoryEventsWorld } from "@/lib/tick/adapters/memory/events";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { InMemoryInfrastructureWorld } from "@/lib/tick/adapters/memory/infrastructure";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import { InMemoryMigrationWorld } from "@/lib/tick/adapters/memory/migration";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import { InMemoryRelationsWorld } from "@/lib/tick/adapters/memory/relations";
import { InMemoryTreasuryWorld } from "@/lib/tick/adapters/memory/treasury";

import { mergeGlobalEvents } from "@/lib/tick/helpers";
import { referenceMaintenanceBill } from "@/lib/engine/founding-cost";
import { isCycleStart, catchUpFactor } from "@/lib/tick/shard";
import type {
  TickContext,
  TickBroadcastRaw,
  GlobalEventMap,
  EconomySignals,
  TickInstrumentation,
} from "@/lib/tick/types";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import type { SystemLogisticsRow } from "@/lib/tick/world/directed-logistics-world";
import type {
  SystemBuildRow,
  BuildBuildingUpdate,
  SystemClaim,
  SystemDevelopment,
  FoundingStagingDraw,
  BuildBlockedUpdate,
  BuildOpportunityUpdate,
  ColonyOpportunityUpdate,
} from "@/lib/tick/world/directed-build-world";

import type {
  TickConnection,
  TickSystem,
} from "@/lib/tick/rows";
import type {
  World,
  WorldBuilding,
  WorldConstructionProject,
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
 * tick-row views its (pre-existing) health analysers read.
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

  // One pass over the flat building rows builds each system's roster: the count plus the per-type
  // idle countdown, keyed together so a system is resolved with a single map lookup. The
  // unrest-collapse debt is per system, not per type, and rides the system row instead.
  const rosterBySystem = new Map<
    string,
    { counts: Record<string, number>; idleCycles: Record<string, number> }
  >();
  for (const b of world.buildings) {
    let roster = rosterBySystem.get(b.systemId);
    if (!roster) {
      roster = { counts: {}, idleCycles: {} };
      rosterBySystem.set(b.systemId, roster);
    }
    roster.counts[b.buildingType] = b.count;
    roster.idleCycles[b.buildingType] = b.idleCycles;
  }

  // Per-system {score, peopleLand} breakdown for the fill-best-first quality fold
  // (lib/engine/habitability.ts) — the population processor's only reader. Same unlocked/
  // above-threshold filter substrateAggregates (lib/engine/body-gen.ts) uses to build the
  // peopleLand aggregate, but here the PER-BODY rows survive instead of collapsing into a sum.
  const habitabilityBodiesBySystem = new Map<string, { score: number; peopleLand: number }[]>();
  for (const b of world.bodies) {
    const arch = BODY_ARCHETYPES[b.bodyType];
    if (arch.techLocked || arch.scores.default < HABITABILITY_THRESHOLD) continue;
    const entry = { score: arch.scores.default, peopleLand: b.peopleLand };
    const list = habitabilityBodiesBySystem.get(b.systemId);
    if (list) list.push(entry);
    else habitabilityBodiesBySystem.set(b.systemId, [entry]);
  }

  return world.systems.map((s) => {
    const roster = rosterBySystem.get(s.id);
    return {
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
      buildings: roster?.counts ?? {},
      buildingIdleCycles: roster?.idleCycles ?? {},
      collapseDebt: s.collapseDebt ?? 0,
      // Deliberately NOT `?? 0` (contrast collapseDebt just above): absence is the lazy-seed marker
      // `readExpectation` (lib/engine/expectation.ts) relies on to seed from this cycle's Provision.
      // Coercing it here would make an old save — or any system never yet touched — read as
      // "remembers 0" (the floor) instead of "never measured", silently defeating the seed.
      provisionExpectation: s.provisionExpectation,
      // Same pass-through-uncoerced treatment as provisionExpectation just above: a fresh
      // per-cycle reading, so there is no "seed" concern, but absence must still mean "never
      // assessed" rather than becoming a coerced 0/"supplied" default (lib/world/types.ts).
      provision: s.provision,
      supplyBand: s.supplyBand,
      criticalWeight: s.criticalWeight,
      // Same pass-through-uncoerced treatment: nothing in this join computes it, the tick body
      // writes it directly after the migration stage (see the field's own docstring,
      // lib/world/types.ts), so this row purely carries forward whatever the previous World held.
      populationChange: s.populationChange,
      // Same pass-through-uncoerced treatment: nothing in this join computes it, the directed-build
      // processor's world adapter writes it directly (see the field's own docstring,
      // lib/world/types.ts), so this row purely carries forward whatever the previous World held.
      buildBlocked: s.buildBlocked,
      // Same pass-through-uncoerced treatment, same reason, written by the directed-build processor's
      // own applyBuildOpportunityUpdates/applyColonyOpportunityUpdates (see the fields' own docstrings,
      // lib/world/types.ts).
      buildOpportunity: s.buildOpportunity,
      colonyOpportunity: s.colonyOpportunity,
      habitabilityBodies: habitabilityBodiesBySystem.get(s.id) ?? [],
      // Same pass-through-uncoerced treatment as provision/supplyBand/criticalWeight above: written
      // directly by the population processor's world adapter via the generic row-mutation path
      // (see the field's own docstring, lib/world/types.ts).
      habitabilityQuality: s.habitabilityQuality,
      yields: yieldsOf(s),
      extractionEff: effOf(s),
      depositCounts: depositCountsOf(s),
      industryLand: s.industryLand,
      peopleLand: s.peopleLand,
    };
  });
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
    const merged: WorldSystem = {
      ...s,
      factionId: tickSystem.factionId,
      control: tickSystem.control,
      population: tickSystem.population,
      popCap: tickSystem.popCap,
      unrest: tickSystem.unrest,
      collapseDebt: tickSystem.collapseDebt,
    };
    // Written via delete/assign rather than `provisionExpectation: tickSystem.provisionExpectation`
    // in the object literal above: the latter would leave the KEY present with value `undefined`
    // for a never-seeded system (JSON.stringify drops it either way, but the in-memory row would
    // then differ from a system that never had the key at all — see the join's departure from the
    // collapseDebt precedent above for why that absence must stay a true absence).
    if (tickSystem.provisionExpectation === undefined) delete merged.provisionExpectation;
    else merged.provisionExpectation = tickSystem.provisionExpectation;
    // Same delete/assign treatment, same reason: a true absence (never assessed) must not become
    // a present key holding `undefined`.
    if (tickSystem.provision === undefined) delete merged.provision;
    else merged.provision = tickSystem.provision;
    if (tickSystem.supplyBand === undefined) delete merged.supplyBand;
    else merged.supplyBand = tickSystem.supplyBand;
    if (tickSystem.criticalWeight === undefined) delete merged.criticalWeight;
    else merged.criticalWeight = tickSystem.criticalWeight;
    // Same delete/assign treatment, same reason: written directly onto `tickSystem` by the tick
    // body after the migration stage, never by a processor — a true absence (never assessed this
    // cycle, or cleared by abandonment/redevelopment) must not become a present key holding
    // `undefined`.
    if (tickSystem.populationChange === undefined) delete merged.populationChange;
    else merged.populationChange = tickSystem.populationChange;
    // Same delete/assign treatment, same reason: written directly onto `tickSystem` by
    // `applyBuildBlockedUpdates` below (the directed-build processor's world adapter), never by a
    // processor via the generic row-mutation path — a true absence (never assessed this run, or
    // cleared by abandonment/redevelopment) must not become a present key holding `undefined`.
    if (tickSystem.buildBlocked === undefined) delete merged.buildBlocked;
    else merged.buildBlocked = tickSystem.buildBlocked;
    // Same delete/assign treatment, same reason, for the two other directed-build side-channel
    // writes — independent guards so a system whose only change was one of these three fields never
    // has the other two stamped as a present key holding `undefined`.
    if (tickSystem.buildOpportunity === undefined) delete merged.buildOpportunity;
    else merged.buildOpportunity = tickSystem.buildOpportunity;
    if (tickSystem.colonyOpportunity === undefined) delete merged.colonyOpportunity;
    else merged.colonyOpportunity = tickSystem.colonyOpportunity;
    // Same delete/assign treatment, same reason: written directly onto this row by the population
    // processor's world adapter via the generic row-mutation path (applyPopulationUpdates,
    // lib/tick/adapters/memory/population.ts) — a true absence (never assessed) must not become a
    // present key holding `undefined`.
    if (tickSystem.habitabilityQuality === undefined) delete merged.habitabilityQuality;
    else merged.habitabilityQuality = tickSystem.habitabilityQuality;
    return merged;
  });
}

/** Flatten each system's building Record back to World's one-row-per-(system,type) shape. */
function flattenBuildings(tickSystems: TickSystem[]): WorldBuilding[] {
  const rows: WorldBuilding[] = [];
  for (const s of tickSystems) {
    for (const [buildingType, count] of Object.entries(s.buildings)) {
      if (count > 0) {
        rows.push({
          systemId: s.id,
          buildingType,
          count,
          idleCycles: s.buildingIdleCycles[buildingType] ?? 0,
        });
      }
    }
  }
  return rows;
}

// ── Directed-logistics / directed-build row builders (per-system rows the
// two planners share) ───────────────────────────────────────────

export function marketRowsBySystem(markets: WorldMarket[]): Map<string, MarketRowForLogistics[]> {
  const bySystem = new Map<string, MarketRowForLogistics[]>();
  for (const m of markets) {
    const row: MarketRowForLogistics = {
      id: `${m.systemId}|${m.goodId}`,
      goodId: m.goodId,
      stock: m.stock,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
      honestUseRate: m.honestUseRate,
      storageCapacity: m.storageCapacity,
      satisfaction: m.satisfaction,
      realisedProductionRate: m.realisedProductionRate,
      productionSuppressed: m.productionSuppressed,
      productionSuppressRate: m.productionSuppressRate,
      productionMult: m.productionMult,
      squeezeCycles: m.squeezeCycles,
      proposalCycles: m.proposalCycles,
      logisticsFundingBound: m.logisticsFundingBound,
      unservedShortfall: m.unservedShortfall,
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
    extractionEff: s.extractionEff,
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
    buildings: s.buildings,
    yields: s.yields,
    extractionEff: s.extractionEff,
    depositCounts: s.depositCounts,
    industryLand: s.industryLand,
    peopleLand: s.peopleLand,
    markets: marketsBySystem.get(s.id) ?? [],
  }));
}

/** The three fields directed-logistics writes back, present in both market row shapes it reaches. */
interface LogisticsWritableRow {
  stock: number;
  logisticsFundingBound?: boolean;
  unservedShortfall?: number;
}

/** Clear through the constraint, so the generic patch below can delete an optional key. */
function clearUnservedShortfall(row: LogisticsWritableRow): void {
  delete row.unservedShortfall;
}

/**
 * Apply one run's directed-logistics writes to one market row, in whichever row shape holds it —
 * the persisted `WorldMarket` and the tick's `MarketRowForLogistics` view take the identical patch,
 * and this is the single place that decides it. Returns the row itself when nothing addressed it,
 * so an untouched market keeps its identity.
 *
 * stock and logisticsFundingBound stay coupled exactly as they always were: either one changing
 * rewrites both together (`?? next.field` on the untouched one), which is what stamps an
 * explicit-undefined logisticsFundingBound key onto a market whose stock alone moved. That quirk
 * predates unservedShortfall and is deliberately left alone. unservedShortfall is applied as an
 * entirely separate, independently-conditioned spread — never folded into the branch above — so a
 * market whose ONLY change this run is the shortfall does not also pick up a spurious
 * logisticsFundingBound key it never earned, and vice versa.
 */
function patchLogisticsRow<T extends LogisticsWritableRow>(
  row: T,
  key: string,
  stockUpdates: Map<string, number>,
  fundingBoundUpdates: Map<string, boolean>,
  unservedShortfallUpdates: Map<string, number>,
): T {
  const newStock = stockUpdates.get(key);
  const logisticsFundingBound = fundingBoundUpdates.get(key);
  const unservedShortfall = unservedShortfallUpdates.get(key);
  const stockOrFundingChanged = newStock !== undefined || logisticsFundingBound !== undefined;
  if (!stockOrFundingChanged && unservedShortfall === undefined) return row;
  let next: T = row;
  if (stockOrFundingChanged) {
    next = {
      ...next,
      stock: newStock ?? next.stock,
      logisticsFundingBound: logisticsFundingBound ?? next.logisticsFundingBound,
    };
  }
  if (unservedShortfall !== undefined) {
    // A positive level is the structural reading; 0 is this run saying the row is servable, which
    // deletes the key rather than persisting a zero — absence, not a falsy number, is what "not
    // unservable" looks like on a market row.
    next = { ...next };
    if (unservedShortfall > 0) next.unservedShortfall = unservedShortfall;
    else clearUnservedShortfall(next);
  }
  return next;
}

function applyLogisticsMarketUpdates(
  markets: WorldMarket[],
  stockUpdates: Map<string, number>,
  fundingBoundUpdates: Map<string, boolean>,
  unservedShortfallUpdates: Map<string, number>,
): WorldMarket[] {
  if (
    stockUpdates.size === 0
    && fundingBoundUpdates.size === 0
    && unservedShortfallUpdates.size === 0
  ) {
    return markets;
  }
  return markets.map((m) =>
    patchLogisticsRow(
      m,
      `${m.systemId}|${m.goodId}`,
      stockUpdates,
      fundingBoundUpdates,
      unservedShortfallUpdates,
    ),
  );
}

/**
 * Patch just the rows directed-logistics changed, instead of remapping every
 * market row a second time for directed-build. `updates` keys are
 * `${systemId}|${goodId}` (same composite key `marketRowsBySystem` gives each
 * row's `id`); only the handful of touched systems get a new row array —
 * every other system's array is reused by reference.
 */
function patchLogisticsMarketRows(
  bySystem: Map<string, MarketRowForLogistics[]>,
  stockUpdates: Map<string, number>,
  fundingBoundUpdates: Map<string, boolean>,
  unservedShortfallUpdates: Map<string, number>,
): Map<string, MarketRowForLogistics[]> {
  if (
    stockUpdates.size === 0
    && fundingBoundUpdates.size === 0
    && unservedShortfallUpdates.size === 0
  ) {
    return bySystem;
  }
  const touchedSystems = new Set<string>();
  for (const key of stockUpdates.keys()) {
    touchedSystems.add(key.slice(0, key.indexOf("|")));
  }
  for (const key of fundingBoundUpdates.keys()) {
    touchedSystems.add(key.slice(0, key.indexOf("|")));
  }
  for (const key of unservedShortfallUpdates.keys()) {
    touchedSystems.add(key.slice(0, key.indexOf("|")));
  }
  const patched = new Map(bySystem);
  for (const systemId of touchedSystems) {
    const rows = patched.get(systemId);
    if (!rows) continue;
    patched.set(
      systemId,
      rows.map((r) =>
        patchLogisticsRow(r, r.id, stockUpdates, fundingBoundUpdates, unservedShortfallUpdates),
      ),
    );
  }
  return patched;
}

/**
 * Fold directed-build's proposal-pressure counters back into the world market rows. Changes ONLY
 * `proposalCycles` (spread preserves every field the same-tick economy and logistics stages already
 * wrote — satisfaction, squeeze, realised rate, stock, funding-bound). `updates` keys are
 * `${systemId}|${goodId}`, the same composite key the market row groups are built by. The counter is
 * fractional reference-time, so it is clamped to a finite [0,2] on the way into world state (NaN/Infinity
 * guarded like every other persisted numeric field). No-op writes (the clamped value already equals what
 * the row carries, treating a missing counter as 0) are skipped so an unchanged market keeps its identity
 * and a construction resolution only touches the rows it moved.
 */
function applyBuildMarketUpdates(markets: WorldMarket[], proposalCycleUpdates: Map<string, number>): WorldMarket[] {
  if (proposalCycleUpdates.size === 0) return markets;
  return markets.map((m) => {
    const raw = proposalCycleUpdates.get(`${m.systemId}|${m.goodId}`);
    if (raw === undefined) return m;
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(2, raw)) : 0;
    if (next === (m.proposalCycles ?? 0)) return m;
    return { ...m, proposalCycles: next };
  });
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

/**
 * The set-and-clear fold every directed-build planner report shares. `visitedSystemIds` is the
 * population the run actually considered: a visited system NOT in `updates` is CLEARED (the run
 * looked and found nothing to report for it), and a system the run never visited is left untouched,
 * carrying forward whatever reading it already had. Clearing is delete-on-a-copy, not
 * `field: undefined` in the object literal — see `mergeSystemsIntoWorld`'s own comment on the same
 * pattern for why a present key holding `undefined` is not the same thing as a true absence.
 *
 * `reads` answers "does this row already carry the field", so an unchanged row keeps its identity;
 * `writes` builds the row carrying the new reading. Both are passed explicitly rather than derived
 * from a key so each caller's own non-finite guards stay at its own site.
 */
function applyVisitedSystemReports<U extends { systemId: string }>(
  systems: TickSystem[],
  visitedSystemIds: string[],
  updates: U[],
  reads: (s: TickSystem) => boolean,
  clears: (s: TickSystem) => void,
  writes: (s: TickSystem, update: U) => TickSystem,
): TickSystem[] {
  if (visitedSystemIds.length === 0) return systems;
  const visited = new Set(visitedSystemIds);
  const bySystem = new Map(updates.map((u) => [u.systemId, u]));
  return systems.map((s): TickSystem => {
    if (!visited.has(s.id)) return s;
    const update = bySystem.get(s.id);
    if (!update) {
      if (!reads(s)) return s;
      const next = { ...s };
      clears(next);
      return next;
    }
    return writes(s, update);
  });
}

/**
 * Fold directed-build's Build blocked report back into the system rows. `visitedSystemIds` is every
 * system belonging to a due faction this run (the planner's own "visited" set, captured by the
 * processor regardless of the build-automation switch — see the processor for why): a visited system
 * NOT in `updates` is CLEARED, because nothing was dropped for it this run (it landed everything or
 * wanted nothing).
 */
export function applyBuildBlockedUpdates(
  systems: TickSystem[],
  visitedSystemIds: string[],
  updates: BuildBlockedUpdate[],
): TickSystem[] {
  return applyVisitedSystemReports(
    systems,
    visitedSystemIds,
    updates,
    (s) => s.buildBlocked !== undefined,
    (s) => { delete s.buildBlocked; },
    // An unreadable ROI reads as 0 rather than poisoning the world: `buildBlocked` is world state,
    // and `JSON.stringify` turns a NaN into null.
    (s, u) => ({
      ...s,
      buildBlocked: { reason: u.reason, droppedRoi: Number.isFinite(u.droppedRoi) ? u.droppedRoi : 0 },
    }),
  );
}

/**
 * Fold directed-build's Build opportunity report back into the system rows. Same visited/clear/set
 * contract as `applyBuildBlockedUpdates` above, over the same "every system belonging to a due
 * faction this run" set — a visited system NOT in `updates` scored nothing this run.
 */
export function applyBuildOpportunityUpdates(
  systems: TickSystem[],
  visitedSystemIds: string[],
  updates: BuildOpportunityUpdate[],
): TickSystem[] {
  return applyVisitedSystemReports(
    systems,
    visitedSystemIds,
    updates,
    (s) => s.buildOpportunity !== undefined,
    (s) => { delete s.buildOpportunity; },
    // Same non-finite guard as buildBlocked's droppedRoi: world state must never carry a
    // NaN/Infinity `JSON.stringify` would turn into null.
    (s, u) => ({
      ...s,
      buildOpportunity: { score: Number.isFinite(u.score) ? u.score : 0, goodId: u.goodId },
    }),
  );
}

/**
 * Fold directed-build's Colony opportunity report back into the system rows. Same visited/clear/set
 * contract again, but over a DIFFERENT population: `visitedSystemIds` is every colony-establish
 * CANDIDATE the colonisation planner considered this run (a candidate is a CONTROLLED,
 * not-yet-developed system), captured regardless of the colonisation-automation switch.
 */
export function applyColonyOpportunityUpdates(
  systems: TickSystem[],
  visitedSystemIds: string[],
  updates: ColonyOpportunityUpdate[],
): TickSystem[] {
  return applyVisitedSystemReports(
    systems,
    visitedSystemIds,
    updates,
    (s) => s.colonyOpportunity !== undefined,
    (s) => { delete s.colonyOpportunity; },
    (s, u) => ({
      ...s,
      colonyOpportunity: {
        value: Number.isFinite(u.value) ? u.value : 0,
        work: Number.isFinite(u.work) ? u.work : 0,
      },
    }),
  );
}

/** Count of resources this system has any deposit slot for — a claim/develop score input. */
function countResourceDiversity(s: TickSystem): number {
  let n = 0;
  for (const r of RESOURCE_TYPES) if (s.depositCounts[r] > 0) n++;
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
 * The resettlement rule, in one place: a reading from a system's PREVIOUS life must not survive into
 * its new one. Every optional per-life reading a system row carries clears together — the stored
 * Provision memory, this cycle's Provisioned reading, its band and its critical-good weight, the
 * realised population change, and directed-build's three planner readings. Only the expectation is a
 * memory; the rest are fresh readings, but a stale reading from a previous life is exactly as false
 * as a stale expectation would be, so they clear the same way: absent reads as "not yet assessed in
 * this life", never as a lie.
 *
 * Deleted, never assigned `undefined` — a present key holding `undefined` is not a true absence (see
 * `mergeSystemsIntoWorld`). Both life transitions clear the identical set, a colony being founded
 * (`applyDevelopments`) and one dying (`applyAbandonments`), so a new per-life reading added to
 * `TickSystem` is cleared on both or on neither.
 */
function clearPreviousLifeReadings(next: TickSystem): void {
  delete next.provisionExpectation;
  delete next.provision;
  delete next.supplyBand;
  delete next.criticalWeight;
  delete next.populationChange;
  delete next.buildBlocked;
  delete next.buildOpportunity;
  delete next.colonyOpportunity;
  delete next.habitabilityQuality;
}

/**
 * Apply completed colony establishments: the target flips `developed`, receives the conserved seed
 * population (capped by what its stored source can spare), and lands its bundled housing so `popCap ≥
 * seedPop` on arrival (viable by construction — docs/active/gameplay/colonisation.md). The `:
 * TickSystem` annotation narrows the `"developed"` literal. `available` tracks each source's remaining
 * spendable population across the loop so two establishments sharing a source draw from the same
 * (shrinking) balance rather than both reading the original snapshot — otherwise a shared source would
 * mint population that was never conserved. popCap is raised to the placed housing's capacity (never
 * lowered) — the same figure infrastructure-decay recomputes next tick, set here so the colony is viable
 * the instant it exists. Also clears any stored `provisionExpectation` on a system flipping to
 * `developed` — the resettlement rule: a system re-founded after a previous life (today only a
 * fresh colony, but the same rule covers a future un-develop/re-develop) seeds its memory from its
 * own opening state exactly as a first-time colony does, rather than carrying in a drifted-to-1
 * baseline from before — the mirror image of `addMarketsForSettledSystems`'s "keeps its warehouses"
 * below: the market rows survive redevelopment, the expectation memory deliberately does not.
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
    const next: TickSystem = {
      ...s,
      population: Math.max(0, s.population + delta),
      control: nowDeveloped ? "developed" : s.control,
      buildings,
      popCap: nowDeveloped ? Math.max(s.popCap, housingPopCap(buildings)) : s.popCap,
    };
    // The resettlement rule (`clearPreviousLifeReadings`): every reading on this row belongs to the
    // colony that just ended, not the one that just started. The three planner readings were already
    // cleared earlier in this same tick — a system still `controlled` when directed-build captured
    // its visited set can only have been cleared there, never freshly assigned, and a just-developed
    // system is no longer a colony candidate — but they clear here too, so a system that survives
    // untouched to a LATER run is covered as well.
    if (nowDeveloped) clearPreviousLifeReadings(next);
    return next;
  });
}

/**
 * Abandonment's death line (docs/active/gameplay/colonisation.md, "A colony is allowed to die"):
 * reset each system the
 * population processor reported (famine AND post-delta population below `ABANDON_POP_FLOOR`) back
 * to unclaimed, factionless frontier — a genuine reset, not a mothballing. Population, unrest and
 * collapse debt zero; the stored Provision memory, this cycle's Provisioned reading, its band and
 * its critical-good weight are all deleted (the same resettlement rule `applyDevelopments`
 * observes above — a previous life's readings must not survive into the next one); buildings and
 * their idle-cycle state are
 * cleared and popCap drops to 0 — infrastructure
 * decay runs only on developed systems, so left standing they would freeze forever and hand any
 * resettler a free, fully-built colony. Ordinary claimable frontier again via the existing claim
 * (`applyClaims`) and colony-candidate (the directed-build `develop` provider) paths — no new
 * resettlement machinery. Market rows and construction-project drops are separate applications
 * (`resetAbandonedMarkets`, `dropAbandonedBuildProjects`) — this function owns the system row only.
 */
export function applyAbandonments(systems: TickSystem[], abandonedSystemIds: string[]): TickSystem[] {
  if (abandonedSystemIds.length === 0) return systems;
  const abandoned = new Set(abandonedSystemIds);
  return systems.map((s): TickSystem => {
    if (!abandoned.has(s.id)) return s;
    const next: TickSystem = {
      ...s,
      population: 0,
      popCap: 0,
      unrest: 0,
      collapseDebt: 0,
      factionId: null,
      control: "unclaimed",
      buildings: {},
      buildingIdleCycles: {},
    };
    // The resettlement rule (`clearPreviousLifeReadings`). Two of the fields it clears carry weight
    // at this site in particular:
    //  • populationChange — the tick body writes it AFTER this function runs (post-migration), so
    //    without the clear a naive later write would re-populate a stale reading on the system this
    //    same cycle just reset; see the write site below for how that's avoided. The clear is the
    //    defense that matters once the system survives untouched to a LATER cycle instead.
    //  • the three planner readings — this is the ONLY thing that ever clears them for an abandoned
    //    system, and the reason is the opposite of what it looks like. An abandoned system flips to
    //    `unclaimed` above, so `isEconomicallyActive` drops it out of the planner's working set and
    //    it is never VISITED again — and the clear-visited-then-assign writes below
    //    (`applyBuildBlockedUpdates` and its two siblings) only touch systems inside their visited
    //    set, by design, because set-and-clear says an entity a run did not visit keeps its previous
    //    value. So "the write path naturally excludes it" is precisely why clearing here is
    //    load-bearing rather than a backstop: without it a dead colony would advertise its last
    //    blocked build and its last opportunity indefinitely, which is the present-but-false reading
    //    the absence convention exists to prevent.
    clearPreviousLifeReadings(next);
    return next;
  });
}

/**
 * Abandonment Rule 2's market-side application: an abandoned system keeps its market rows (the
 * warehouses affordance is real — a resettler inherits real stock), but the demand-derived fields
 * reset with the system, so a resettled colony does not spend its first cycle priced and rationed
 * as the dead world it replaced. Stock is left untouched. `honestUseRate`, `squeezeCycles` and
 * `logisticsFundingBound` are all optional fields whose absence already reads as "not yet
 * assessed" — cleared (deleted) rather than zeroed, exactly as a freshly-created market row would
 * be. `productionSuppressed` has no such absent-reads-as-fresh convention, so it is explicitly set
 * false, mirroring `collapseDebt`'s explicit zero in `applyAbandonments` above. `stockChange` joins
 * the same clear for the same reason as `logisticsFundingBound`: it is a reading from a previous
 * life and must not survive into the next — a re-founded colony's warehouse is real, but its
 * predecessor's drain rate is not. `unservedShortfall` joins the same clear for the same reason: a
 * structural reading names a shortfall THIS colony's donors and production could not close, and a
 * resettled colony has neither yet — its own local-supply story starts over.
 */
export function resetAbandonedMarkets(markets: WorldMarket[], abandonedSystemIds: string[]): WorldMarket[] {
  if (abandonedSystemIds.length === 0) return markets;
  const abandoned = new Set(abandonedSystemIds);
  return markets.map((m): WorldMarket => {
    if (!abandoned.has(m.systemId)) return m;
    const next: WorldMarket = { ...m, demandRate: MIN_DEMAND, productionSuppressed: false };
    delete next.honestUseRate;
    delete next.squeezeCycles;
    delete next.logisticsFundingBound;
    delete next.stockChange;
    delete next.unservedShortfall;
    return next;
  });
}

/**
 * Abandonment Rule 2's construction-side application: an open `build` project targeting a system
 * that just died would otherwise keep funding invisible construction on a world its former owner
 * lost — the UI hides it the moment `factionId` is null, but the pool would keep absorbing work
 * into it regardless. Scoped to `kind: "build"` only: a `colony_establish` project never targets an
 * already-developed system (its target is still `controlled`, which is never in survival shortfall
 * — the economy only classifies developed systems), so it is out of scope by construction.
 */
export function dropAbandonedBuildProjects(
  projects: WorldConstructionProject[], abandonedSystemIds: string[],
): WorldConstructionProject[] {
  if (abandonedSystemIds.length === 0) return projects;
  const abandoned = new Set(abandonedSystemIds);
  return projects.filter((p) => !(p.kind === "build" && abandoned.has(p.systemId)));
}

/**
 * Give each newly settled system its market rows, opening EMPTY. World-gen builds markets only for
 * systems that are already developed — an unclaimed rock holds nothing — so a colony has no market at
 * all until this runs, and the founder's endowment is the first stock it ever holds. Must therefore
 * run before `applyStagedManifestDelivery`, whose credits land on these rows.
 *
 * Goods the system already has a row for are left alone, so redeveloping a system that was settled
 * before keeps its warehouses rather than resetting them.
 */
export function addMarketsForSettledSystems(
  markets: WorldMarket[],
  systems: TickSystem[],
  developments: SystemDevelopment[],
): WorldMarket[] {
  if (developments.length === 0) return markets;
  const bySystem = new Map(systems.map((s) => [s.id, s]));
  const existing = new Set(markets.map((m) => `${m.systemId}|${m.goodId}`));
  const added: WorldMarket[] = [];
  for (const d of developments) {
    const sys = bySystem.get(d.systemId);
    if (!sys) continue;
    const rows = createSystemMarkets({
      systemId: sys.id,
      buildings: sys.buildings,
      yields: sys.yields,
      population: sys.population,
      seedStock: false,
    });
    for (const row of rows) {
      const key = `${row.systemId}|${row.goodId}`;
      if (existing.has(key)) continue;
      existing.add(key);
      added.push(row);
    }
  }
  return added.length > 0 ? [...markets, ...added] : markets;
}

/**
 * Land each new colony's staged manifest on its own market rows — a delivery, not a transfer.
 *
 * The goods left their founder cycle by cycle as the establish was built and paid for
 * (`applyFoundingStagingDraws`), and have been in-transit inventory in the project's ledger ever
 * since, in no market row at either end. This is where they arrive, so the pass is CREDIT-ONLY:
 * touching the source again would take the same goods a second time and hand the colony only what
 * the founder still happened to hold — possibly nothing.
 *
 * Conservation is therefore a property of the pair, not of this function alone: every quantity
 * credited here was debited when it was staged. The staging plan is bounded by the same live market
 * row the debit reads (`planStagingDraw`, lib/tick/processors/directed-build.ts), and
 * `applyFoundingStagingDraws` throws rather than shorten a draw — so a ledger line that was never
 * paid for cannot reach this function to be minted.
 *
 * Credits land only on rows the colony already has — `addMarketsForSettledSystems` must run first, or
 * a colony has no row to receive anything. Non-finite or non-positive lines are skipped rather than
 * trusted: stock is world state, and `JSON.stringify` turns a NaN into null.
 */
export function applyStagedManifestDelivery(
  markets: WorldMarket[],
  developments: SystemDevelopment[],
): WorldMarket[] {
  if (developments.length === 0) return markets;
  const credit = new Map<string, number>();
  for (const d of developments) {
    for (const line of d.stockManifest) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
      const key = `${d.systemId}|${line.goodId}`;
      credit.set(key, (credit.get(key) ?? 0) + line.quantity);
    }
  }
  if (credit.size === 0) return markets;
  return markets.map((m) => {
    const change = credit.get(`${m.systemId}|${m.goodId}`);
    if (change === undefined) return m;
    return { ...m, stock: m.stock + change };
  });
}

/**
 * Debit this cycle's colony staging draws from their founding sources' market rows.
 *
 * A debit with no matching credit: materials leave the founder the cycle they are paid for and sit in
 * the establish project's ledger — in-transit inventory, in no market row at either end — until the
 * colony opens and receives them. The founder is therefore drawn down over the life of an establish
 * instead of in one raid at completion.
 *
 * Every draw is moved in FULL or the tick fails. A draw the source cannot cover is not a cap doing
 * its job — the planner already bounds each draw by this same live market row (`planStagingDraw`)
 * and by a running per-(source, good) balance, so a short draw means the ledger recorded goods that
 * never left the founder, and `applyStagedManifestDelivery` would mint them onto the colony when it
 * opens. Clamping silently would make that a world-state corruption no test could see; throwing
 * makes it a hard pause with no broken world committed, which is what the store's tick atomicity is
 * for. Non-finite or non-positive lines are skipped rather than trusted: stock is world state, and
 * `JSON.stringify` turns a NaN into null.
 */
export function applyFoundingStagingDraws(
  markets: WorldMarket[],
  draws: FoundingStagingDraw[],
): WorldMarket[] {
  if (draws.length === 0) return markets;
  const available = new Map(markets.map((m) => [`${m.systemId}|${m.goodId}`, m.stock]));
  const delta = new Map<string, number>();
  for (const draw of draws) {
    if (!Number.isFinite(draw.quantity) || draw.quantity <= 0) continue;
    const key = `${draw.sourceSystemId}|${draw.goodId}`;
    const stock = available.get(key) ?? 0;
    if (draw.quantity > stock) {
      throw new Error(
        `Founding staging draw exceeds live stock at ${key}: drawing ${draw.quantity}, holding ${stock}`,
      );
    }
    available.set(key, stock - draw.quantity);
    delta.set(key, (delta.get(key) ?? 0) - draw.quantity);
  }
  if (delta.size === 0) return markets;
  // No `Math.max(0, …)` floor on the write, deliberately: every debit is bounded above by what its
  // own row held, so a floor here could only ever hide a draw that had escaped that bound.
  return markets.map((m) => {
    const change = delta.get(`${m.systemId}|${m.goodId}`);
    if (change === undefined || change === 0) return m;
    return { ...m, stock: m.stock + change };
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
 * directed-build → treasury → relations (gated by `RELATIONS_FREQUENCY`). Pure
 * and immutable-spread style — never mutates `world`; returns the next world
 * plus this tick's broadcast events.
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
  opts?: {
    cadence?: TickCadence;
    /** Harness-only third-arm pin for the draw figure's brake — the second per-run override
     *  channel after `cadence`. The live game never sets it (absent ⇒ "live"). */
    drawBrakeCeiling?: DrawBrakeCeiling;
  },
): Promise<{
  world: World;
  events: TickBroadcastRaw;
  markets: WorldMarket[];
  /** Calibration-only signals — never broadcast, never persisted. See `TickInstrumentation`. */
  instrumentation: TickInstrumentation;
}> {
  const cadence: TickCadence = opts?.cadence ?? {
    cycle: CYCLE_LENGTH,
    construction: CONSTRUCTION_INTERVAL,
    logistics: LOGISTICS_INTERVAL,
  };
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
  let treasuries = world.treasuries;
  let nextId = world.nextId;
  // Preserves each event's metadata across the events stage, whose row type
  // (`TickEvent`, lib/tick/rows.ts) has no metadata field — re-attached at the
  // WorldEvent mapping below.
  const metadataByEventId = new Map(world.events.map((e) => [e.id, e.metadata]));
  let events: WorldEvent[] = world.events;

  const newTickCtx = (): TickContext => ({ tick, results: new Map() });

  // ── latched treasury funding (read at tick START = last settlement's latch;
  // the treasury stage settles LAST, so every consumer below runs one cycle
  // behind — the accepted funding lag, same shape as construction's). Built
  // only when a consuming stage resolves this tick (the same gating convention
  // as the cycle-start setup below); absent it reads as fully funded downstream. ──
  const fundedByFaction =
    treasuries.length > 0 &&
    (isCycleStart(tick, cadence.cycle) ||
      isCycleStart(tick, cadence.logistics) ||
      isCycleStart(tick, cadence.construction))
      ? new Map(treasuries.map((t) => [t.factionId, t.funded]))
      : undefined;

  // Per-system effect maps for the cycle-start stages (economy malus, decay
  // buffer, unrest tax pressure). Only built when those stages resolve.
  let maintenanceMalusBySystem: Map<string, number> | undefined;
  let maintenanceBufferScaleBySystem: Map<string, number> | undefined;
  let taxPressureBySystem: Map<string, number> | undefined;
  if (isCycleStart(tick, cadence.cycle) && treasuries.length > 0) {
    const taxPressureByFaction = new Map(
      treasuries.map((t) => [t.factionId, TAX_LEVEL_UNREST_PRESSURE[t.taxLevel]]),
    );
    maintenanceMalusBySystem = new Map();
    maintenanceBufferScaleBySystem = new Map();
    taxPressureBySystem = new Map();
    for (const s of systems) {
      if (s.factionId === null) continue;
      const funded = fundedByFaction?.get(s.factionId);
      if (funded !== undefined) {
        maintenanceMalusBySystem.set(
          s.id, maintenanceOutputMalus(funded.maintenance, TREASURY.MAINTENANCE_OUTPUT_MALUS_SLOPE),
        );
        maintenanceBufferScaleBySystem.set(
          s.id, maintenanceBufferScale(funded.maintenance, TREASURY.MAINTENANCE_BUFFER_SCALE_BASE),
        );
      }
      const pressure = taxPressureByFaction.get(s.factionId);
      if (pressure !== undefined && pressure > 0) taxPressureBySystem.set(s.id, pressure);
    }
  }

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

  // ── economy (cycle-start-gated) ──
  // Mid-cycle this stage resolves nothing, so building its adapter — which copies
  // every system row and every market row in the galaxy — only to have the body bail
  // is pure waste. The gate emits the same mid-cycle broadcast the body would have,
  // so a gated tick is indistinguishable from an ungated one from the outside.
  let economySignals: EconomySignals | undefined;
  // The realised per-cycle survival-good stock change's opening snapshot — captured here, BEFORE
  // the economy processor mutates `stock` via production/consumption, so the write below (after
  // directed logistics, further down this function) reads the true cycle-start value. Scoped to
  // SURVIVAL_GOODS market rows belonging to a system that is developed AS OF THIS INSTANT — the
  // same population the economy processor's own `getSystemIds` selects
  // (`isEconomicallyActive`) — so "visited this cycle" at the write site means exactly "the economy
  // processor assessed this system", nothing more, nothing less.
  let stockAtCycleStart: Map<string, number> | undefined;
  if (isCycleStart(tick, cadence.cycle)) {
    const developedNow = new Set(
      systems.filter((s) => isEconomicallyActive(s.control)).map((s) => s.id),
    );
    stockAtCycleStart = new Map(
      markets
        .filter((m) => SURVIVAL_GOODS.includes(m.goodId) && developedNow.has(m.systemId))
        .map((m) => [`${m.systemId}|${m.goodId}`, m.stock]),
    );
    const economyWorld = new InMemoryEconomyWorld({ systems, markets, modifiers: rebuildWorldModifiers(events, scaled.definitions) });
    const economyResult = await runEconomyProcessor(economyWorld, newTickCtx(), {
      interval: cadence.cycle,
      simParams: ECONOMY_SIM_PARAMS,
      modifierCaps: MODIFIER_CAPS,
      strikeParams: STRIKE_PARAMS,
      maintenanceMalusBySystem,
    });
    systems = economyWorld.systems;
    markets = economyWorld.markets;
    economySignals = economyResult.economySignals;
    mergeGlobalEvents(globalEvents, economyResult);
    processorsRun.push("economy");
  } else {
    mergeGlobalEvents(globalEvents, {
      globalEvents: economyMidCyclePayload(tick, cadence.cycle),
    });
  }

  // ── famine inflow gate (abandonment Rule 1) ──
  // Systems currently in survival shortfall — no population inflow this cycle, either path
  // (colonist delivery or diffusion migration; see the migration call below). Empty when the
  // economy signal is absent (no cycle to gate on): delivery and economy are gated by the same
  // cycle-start predicate, so delivery can never run on a tick where this signal would be absent.
  const famineSystemIds = new Set<string>();
  if (economySignals) {
    for (const [systemId, supply] of economySignals.supplyStateBySystem) {
      if (supply.survivalShortfall) famineSystemIds.add(systemId);
    }
  }

  // ── infrastructure-decay ──
  // Calibration-only: per-cycle whole building levels torn down, keyed by system (both decay
  // channels combined). Declared here, read only by the final `instrumentation` return below.
  let teardownLevelsBySystem: TickInstrumentation["teardownLevelsBySystem"];
  if (economySignals) {
    const logisticsFundingBoundBySystem = new Map<string, Set<string>>();
    for (const market of markets) {
      if (!market.logisticsFundingBound) continue;
      const goods = logisticsFundingBoundBySystem.get(market.systemId) ?? new Set<string>();
      goods.add(market.goodId);
      logisticsFundingBoundBySystem.set(market.systemId, goods);
    }
    const decayWorld = new InMemoryInfrastructureWorld({ systems });
    const decayResult = await runInfrastructureDecayProcessor(
      decayWorld,
      { tick, results: new Map([["economy", { economySignals }]]) },
      {
        decay: INFRASTRUCTURE_DECAY_PARAMS,
        interval: cadence.cycle,
        bufferScaleBySystem: maintenanceBufferScaleBySystem,
        logisticsFundingBoundBySystem,
      },
    );
    systems = decayWorld.systems;
    teardownLevelsBySystem = decayResult.teardownLevelsBySystem;
    processorsRun.push("infrastructure-decay");
  }

  // ── population ──
  // Calibration-only: per-cycle overshoot-death amount, keyed by system. Same reason as above.
  let overshootDeathBySystem: TickInstrumentation["overshootDeathBySystem"];
  // Calibration-only: per-cycle growth-term amount, keyed by system. Same reason as above.
  let growthBySystem: TickInstrumentation["growthBySystem"];
  // Abandonment Rule 2 (the death line): systems the population processor found in famine with
  // post-delta population below ABANDON_POP_FLOOR this cycle. Applied just below, outside the
  // gate — the tick body is the sole owner of the control-flip/reset the processor only reports.
  let abandonedSystemIds: string[] = [];
  // The realised per-cycle population change's opening snapshot — captured here, BEFORE the
  // population processor mutates `population`, so the write below (after migration) reads the true
  // cycle-start value rather than an already-grown/declined one. Keyed by every system in this
  // cycle's dissatisfaction set (`signals.dissatisfactionBySystem`, the same set the population
  // processor itself iterates), so "visited this cycle" below means exactly "the population
  // processor assessed it" — nothing more, nothing less.
  let populationAtCycleStart: Map<string, number> | undefined;
  if (economySignals) {
    // Local const alias: a closure below can't see the narrowing `if (economySignals)` gives the
    // outer `let`, since it's reassigned elsewhere in this function.
    const signals = economySignals;
    populationAtCycleStart = new Map(
      systems.filter((s) => signals.dissatisfactionBySystem.has(s.id)).map((s) => [s.id, s.population]),
    );
    const popWorld = new InMemoryPopulationWorld({ systems, markets });
    const popResult = await runPopulationProcessor(
      popWorld,
      { tick, results: new Map([["economy", { economySignals }]]) },
      {
        unrest: UNREST_PARAMS,
        population: POPULATION_PARAMS,
        expectation: EXPECTATION_PARAMS,
        interval: cadence.cycle,
        taxPressureBySystem,
      },
    );
    systems = popWorld.systems;
    markets = popWorld.markets;
    overshootDeathBySystem = popResult.overshootDeathBySystem;
    growthBySystem = popResult.growthBySystem;
    abandonedSystemIds = popResult.abandonedSystems ?? [];
    processorsRun.push("population");
  }

  // ── abandonment (Rule 2 — the death line) ──
  // Applied in one pass across the three touched state slices, before the cycle-start block below
  // reads `systems`/`constructionProjects` — so a resettable frontier and a dropped project are
  // both visible to this SAME tick's claim/develop paths (same-tick re-claim is possible and
  // accepted as harmless — spec review finding 9).
  if (abandonedSystemIds.length > 0) {
    systems = applyAbandonments(systems, abandonedSystemIds);
    markets = resetAbandonedMarkets(markets, abandonedSystemIds);
    constructionProjects = dropAbandonedBuildProjects(constructionProjects, abandonedSystemIds);
  }

  // ── cycle start: migration, directed-logistics, directed-build (cycle-start-gated) ──
  // Each stage below resolves on the cycle start and bails internally otherwise, but
  // its setup — the participation set, the open-edge graph, the per-system market row
  // groups, the ownership maps — is read by nothing else, so mid-cycle it was all built
  // and thrown away. The gate stops building those inputs; the bodies are untouched.
  //
  // The condition is the disjunction of the stages' OWN cycle-start predicates, each built
  // from the interval that stage's body is handed below, because the setup is shared
  // and any one stage resolving is reason to build it. The three intervals are three
  // independent knobs (migration rides the cycle; build and logistics have their own):
  // gating on just one of them would let a retune of another silently skip that stage's
  // resolutions — a performance mechanism quietly deciding a gameplay cadence. A disjunction
  // fails the safe way, building setup nobody reads rather than dropping work. (Gating
  // on the shortest interval would NOT be safe: it only covers the others when it
  // divides them.)
  //
  // The flowEvents retention prune is deliberately NOT in here: it is cheap, and it
  // runs every tick today (see below the block).
  //
  // The two work maps are declared here (outside the block) rather than as locals inside
  // it, because the treasury stage below reads them after the block closes.
  let constructionWorkByFaction: Map<string, number> | undefined;
  let foundingDebitsByFaction: Map<string, number> | undefined;
  let logisticsWorkByFaction: Map<string, number> | undefined;
  // Calibration-only: directed-build's per-cycle new autonomic production-good levels, by good.
  // Declared here (not a local inside the block) purely to survive past the block's close, mirroring
  // the two work maps above — read only by the final `instrumentation` return, never by treasury.
  let buildCommitmentsByGood: Map<string, number> | undefined;
  // Calibration-only: migration's per-cycle people-moved totals (colonist delivery + edge
  // diffusion). Declared here for the same reason as buildCommitmentsByGood above.
  let migrationMoved: TickInstrumentation["migrationMoved"];
  // Calibration-only: what each founding-stock manifest cost its founder. Same reason.
  let foundingManifests: TickInstrumentation["foundingManifests"];
  // Calibration-only: what held each in-flight colony back this cycle. Same reason.
  let foundingStalls: TickInstrumentation["foundingStalls"];
  // Calibration-only: directed-logistics' per-faction haul-budget ledger. Same reason.
  let logisticsBudget: TickInstrumentation["logisticsBudget"];
  // Calibration-only: directed-build's per-cycle strikeExplains-suppressed proposal resolution. Same reason.
  let strikeSuppressedProposals: TickInstrumentation["strikeSuppressedProposals"];
  const migrationResolves = isCycleStart(tick, cadence.cycle);
  const logisticsResolves = isCycleStart(tick, cadence.logistics);
  const buildResolves = isCycleStart(tick, cadence.construction);
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
      const migResult = await runMigrationProcessor(migWorld, newTickCtx(), {
        interval: cadence.cycle,
        flow: MIGRATION_PARAMS,
        delivery: COLONY_DELIVERY_PARAMS,
        inflowBlockedSystemIds: famineSystemIds,
      });
      systems = migWorld.systems;
      migrationMoved = migResult.migrationMoved;
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
    let dlFundingBoundUpdates: Map<string, boolean> = new Map();
    let dlUnservedShortfallUpdates: Map<string, number> = new Map();

    // ── directed-logistics ──
    {
      const routeCost: RouteCost = (f, t) => {
        const h = hops.get(f)?.get(t);
        return h === undefined || h > DIRECTED_LOGISTICS.MAX_HOPS ? null : h * DIRECTED_LOGISTICS.HOP_WEIGHT;
      };
      const reachableSystemIds: ReachableSystemIds = (systemId) =>
        hops.get(systemId)?.keys() ?? [];
      // Directed-logistics moves goods only between developed systems.
      const rows = buildLogisticsRows(
        systems.filter((s) => developedSystemIds.has(s.id)),
        logisticsMarketRows,
      );
      const dlWorld = new MemoryDirectedLogisticsWorld(rows);
      const dlResult = await runDirectedLogisticsProcessor(dlWorld, { tick }, {
        interval: cadence.logistics,
        routeCost,
        reachableSystemIds,
        fundingByFaction:
          fundedByFaction && new Map([...fundedByFaction].map(([id, f]) => [id, f.logistics])),
        drawBrakeCeiling: opts?.drawBrakeCeiling,
      });
      markets = applyLogisticsMarketUpdates(
        markets,
        dlWorld.stockUpdates,
        dlWorld.fundingBoundUpdates,
        dlWorld.unservedShortfallUpdates,
      );
      dlStockUpdates = dlWorld.stockUpdates;
      dlFundingBoundUpdates = dlWorld.fundingBoundUpdates;
      dlUnservedShortfallUpdates = dlWorld.unservedShortfallUpdates;
      const newLogisticsFlows: WorldFlowEvent[] = dlWorld.flows;
      flowEvents = [...flowEvents, ...newLogisticsFlows];
      logisticsWorkByFaction = dlResult.workPerformedByFaction;
      logisticsBudget = dlResult.logisticsBudget;
      processorsRun.push("directed-logistics");
    }

    // ── directed-build ──
    // ⚠ Splitting construction's decision cadence from its execution cadence lands
    // inside this gate: work would accrue every tick while planning stays per-cycle, so
    // the per-tick funding step has to be carved back out of the cycle-start block above.
    // Planning inputs only move on the cycle start, so the gate is correct as it stands.
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
            peopleLand: cand.peopleLand,
            resourceDiversity: countResourceDiversity(cand),
          });
        }
        return candidates;
      };

      // Colony-candidate provider: a faction's CONTROLLED systems that have a reachable developed
      // same-faction seed source, tagged with their substrate + that source. The colony planner scores
      // them via colonyValue and funds establish projects from the shared pool.
      // Ties on hop count keep the first system this iteration reaches (strict `<` below), whereas
      // the player's own verb (`findSeedSource`, lib/services/colony-eligibility.ts) breaks ties to
      // the smallest id — so on an exact tie the two can name different sources. Both are
      // deterministic and a tie is rare; see that function for why they are left unaligned.
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
            peopleLand: s.peopleLand,
            industryLand: s.industryLand,
            depositCounts: s.depositCounts,
            sourceSystemId,
          });
        }
        return candidates;
      };

      const rows = buildBuildRows(
        systems,
        patchLogisticsMarketRows(
          logisticsMarketRows,
          dlStockUpdates,
          dlFundingBoundUpdates,
          dlUnservedShortfallUpdates,
        ),
      );
      const dbWorld = new MemoryDirectedBuildWorld(rows, constructionProjects);
      const dbResult = await runDirectedBuildProcessor(dbWorld, { tick }, {
        interval: cadence.construction,
        routeCost,
        construction: {
          cap: CONSTRUCTION.PER_BUILD_ABSORPTION_CAP,
          throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP,
          floorBase: CONSTRUCTION.POOL_FLOOR_BASE,
          floorKnee: CONSTRUCTION.FLOOR_DEV_KNEE,
          pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL,
          paybackHorizon: CONSTRUCTION.PAYBACK_HORIZON,
          backlogWindow: CONSTRUCTION.BACKLOG_WINDOW,
          // Project ids draw from the world's monotonic counter, threaded through this tick.
          mintId: () => `construction-${nextId++}`,
        },
        claim: {
          reachProvider, rng,
          params: { maxClaimsPerCycle: EXPANSION.MAX_CLAIMS_PER_CYCLE, scoreFloor: EXPANSION.SCORE_FLOOR, weights: EXPANSION.SCORE_WEIGHTS },
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
            habitableFloor: effectiveSpaceCost(HOUSING_TYPE),
            popCostWeight: COLONISATION.SEED_POP_COST_WEIGHT,
            minSettlerSupply: COLONISATION.MIN_SETTLER_SUPPLY,
            employedLeakFraction: MIGRATION_PARAMS.employedLeakFraction,
            charterMult: COLONISATION.CHARTER_FEE_SPEND_MULT,
            charterMin: COLONISATION.CHARTER_FEE_MIN,
            gateHeadroom: COLONISATION.FOUNDING_GATE_HEADROOM,
            foundingStockCover: COLONISATION.FOUNDING_STOCK_COVER,
            economyScale: ECONOMY_SCALE,
          },
        },
        player: world.player
          ? { factionId: world.player.controlledFactionId, automation: world.player.automation }
          : undefined,
        fundingByFaction:
          fundedByFaction && new Map([...fundedByFaction].map(([id, f]) => [id, f.construction])),
        // The purse founding is committed against. Read at tick start like the funding latch, so a
        // faction commits against the balance its last settlement left it, minus what it has already
        // committed since. No maintenance bill yet (pre-first-settlement) reads as 0 — the charter
        // floor is what prices a colony then.
        //
        // The bill is de-scaled back to a REFERENCE cycle (see `referenceMaintenanceBill`), the same
        // way the player's colony verb quotes it.
        treasuryByFaction:
          treasuries.length > 0
            ? new Map(
                treasuries.map((t) => [
                  t.factionId,
                  {
                    balance: t.balance,
                    pendingFounding: t.pendingFounding,
                    maintenanceBill: referenceMaintenanceBill(
                      t.lastSettlement?.maintenanceBill, cadence.cycle,
                    ),
                  },
                ]),
              )
            : undefined,
      });
      systems = applyBuildingIncreases(systems, dbWorld.buildingUpdates);
      systems = applyClaims(systems, dbWorld.claims);
      // Before applyDevelopments: a system founded this very run was still `controlled` when
      // directed-build's own visited set was captured, so it is cleared here (nothing dropped for a
      // system that was never economically active) rather than picking up a fresh reading.
      systems = applyBuildBlockedUpdates(systems, dbWorld.buildBlockedVisitedSystemIds, dbWorld.buildBlockedUpdates);
      // Same ordering reason as buildBlocked directly above — both must land before applyDevelopments
      // so a system founded this very run clears rather than picking up a fresh reading.
      systems = applyBuildOpportunityUpdates(systems, dbWorld.buildOpportunityVisitedSystemIds, dbWorld.buildOpportunityUpdates);
      systems = applyColonyOpportunityUpdates(systems, dbWorld.colonyOpportunityVisitedSystemIds, dbWorld.colonyOpportunityUpdates);
      systems = applyDevelopments(systems, dbWorld.developments);
      constructionProjects = dbWorld.constructionProjects;
      // Persist the construction proposal-pressure counters into the market rows (proposalCycles only —
      // the same-tick economy/logistics writes on these rows are preserved by the spread inside).
      markets = applyBuildMarketUpdates(markets, dbWorld.proposalCycleUpdates);
      // This cycle's staged materials leave their founders before anything else touches the markets:
      // they are paid for and out of the world's markets from the moment they are drawn.
      markets = applyFoundingStagingDraws(markets, dbWorld.foundingStagingDraws);
      // Each new colony gets its (empty) market rows, then the manifest it staged over the whole
      // establish is delivered onto them — the first goods the system has ever held, and already out
      // of the founder's markets. Order matters: the delivery lands on these rows.
      markets = addMarketsForSettledSystems(markets, systems, dbWorld.developments);
      markets = applyStagedManifestDelivery(markets, dbWorld.developments);
      constructionWorkByFaction = dbResult.workPerformedByFaction;
      foundingDebitsByFaction = dbResult.foundingDebitsByFaction;
      buildCommitmentsByGood = dbResult.buildCommitmentsByGood;
      foundingManifests = dbResult.foundingManifests;
      foundingStalls = dbResult.foundingStalls;
      strikeSuppressedProposals = dbResult.strikeSuppressedProposals;
      processorsRun.push("directed-build");
    }

    // ── realised per-cycle survival-good stock change (persisted; read by nothing else in the
    // tick) ── Written HERE — after directed logistics has applied its own stock updates AND after
    // directed-build's founding staging draws and staged manifest delivery above, still inside this
    // outer cycle-start block. The interface is the realised change across the whole cycle: a
    // founding donor's survival-good draw (`applyFoundingStagingDraws`) leaves its warehouse exactly
    // as really as consumption does, so it belongs inside this figure rather than after it — and the
    // polarity makes that load-bearing rather than cosmetic. The one reader divides `stock` by
    // `−stockChange` for a cycles-to-empty countdown, so a drain left outside the figure reports a
    // longer runway than the donor actually has: the reading would err toward reassurance on exactly
    // the system that just gave its stores away. A donor that stages a manifest this cycle therefore
    // reads more pessimistic for this one cycle than a mid-cycle read would show — accepted, the same
    // way `populationChange` below accepts it, and it self-corrects next cycle from a fresh baseline.
    //
    // Gated on `stockAtCycleStart`: absent whenever this tick was not an economy-cycle boundary
    // (the snapshot is only taken then), so this skips cleanly on a tick where only logistics
    // or build resolves, rather than diffing against a stale or absent snapshot.
    //
    // Cadence caveat (see the field's own docstring, lib/world/types.ts): directed logistics runs
    // on its OWN independently-tunable cadence (`cadence.logistics`). While it coincides with
    // `cadence.cycle` — the live game's constants always do — this write captures the full
    // production-minus-consumption-net-of-hauls figure the interface describes. If the two cadences
    // are retuned apart, this only ever captures a logistics application that happens to land on
    // THIS tick; a haul on any other tick is folded into `stock` without ever appearing in a
    // reported change, and a cycle boundary with no coincident logistics run reports
    // production-minus-consumption alone. Accepted rather than solved: capturing every haul
    // regardless of cadence alignment needs a cross-tick accumulator carrying its own persisted
    // baseline, which is a larger shape than this reading is worth.
    //
    // Placement is safe against resurrecting a row a colony founding just created or cleared, for
    // the mirror of `populationChange`'s reason below. A founding TARGET is `controlled` right up to
    // `applyDevelopments` this same run, so none of its rows are in `stockAtCycleStart` (keyed by
    // the systems that were developed when the snapshot was taken) — its fresh rows from
    // `addMarketsForSettledSystems`, and the manifest `applyStagedManifestDelivery` lands on them,
    // are left untouched at `before === undefined`, absent as a never-assessed row should be. A
    // founding SOURCE is `developed` throughout, so it was already in the snapshot and simply reads
    // its post-draw `stock` here instead of its pre-draw one.
    //
    // Abandoned systems are excluded even though their survival-good rows sit in the snapshot:
    // `resetAbandonedMarkets` already cleared this field above (before migration ran), and this
    // system's control just flipped away from "developed" — writing a computed reading here would
    // silently undo that clear with a stale figure from a colony that, as of this tick, no longer
    // exists.
    if (stockAtCycleStart) {
      const snapshot = stockAtCycleStart;
      const cycleCatchUp = catchUpFactor(cadence.cycle);
      const abandonedThisCycle = new Set(abandonedSystemIds);
      markets = markets.map((m): WorldMarket => {
        if (abandonedThisCycle.has(m.systemId)) return m;
        const before = snapshot.get(`${m.systemId}|${m.goodId}`);
        if (before === undefined) return m;
        return { ...m, stockChange: (m.stock - before) / cycleCatchUp };
      });
    }

    // ── realised per-cycle population change (persisted; read by nothing else in the tick) ──
    // Written HERE — after directed-build's `applyDevelopments` above, still inside this outer
    // cycle-start block — because the interface is the realised change across the whole cycle,
    // "including migration and colony-founding transfers": a colony founding's source-system debit
    // (`applyDevelopments`, `popDelta.set(d.sourceSystemId, … − moved)` above) is exactly as real a
    // population loss for the donor as migration is, so it must land inside this figure, not after
    // it. A donor that founds a colony this cycle therefore reads more pessimistic for this one
    // cycle than a mid-cycle read would show — accepted: the field means realised change, and this
    // reading self-corrects next cycle once the donor's own population processor run picks a fresh
    // baseline.
    //
    // Placement is still safe against resurrecting a value `applyDevelopments` just deleted: a
    // colony-founding TARGET is always a `controlled` system immediately before this run
    // (`lib/engine/directed-build.ts:1141`), never `developed`, so it can never be a key in
    // `populationAtCycleStart` (keyed by `economySignals.dissatisfactionBySystem`, developed systems
    // only) — the map below leaves it untouched (`before === undefined`), so `applyDevelopments`'
    // own delete of a fresh target's `populationChange` stands. A colony-founding SOURCE is always a
    // `developed` system throughout (`lib/engine/directed-build.ts:1189-1192` — it stays the seed
    // source, never flips status), so it was already in the snapshot and simply reads its post-drain
    // `population` here instead of its pre-drain one.
    //
    // Gated on `economySignals` (equivalently `migrationResolves`, since both share
    // `isCycleStart(tick, cadence.cycle)`): this whole outer block also runs when only logistics or
    // build resolve, on a tick the population processor never touched — `populationAtCycleStart` is
    // `undefined` there, so this skips cleanly rather than dividing by a stale snapshot.
    //
    // Abandoned systems are excluded even though they sit in the cycle-start visited set:
    // `applyAbandonments` already cleared this field above (before migration ran), and this
    // system's control just flipped away from "developed" — writing a computed reading here would
    // silently undo that clear with a stale figure from a colony that, as of this tick, no longer
    // exists.
    if (economySignals && populationAtCycleStart) {
      const cycleCatchUp = catchUpFactor(cadence.cycle);
      const snapshot = populationAtCycleStart;
      const abandonedThisCycle = new Set(abandonedSystemIds);
      systems = systems.map((s): TickSystem => {
        if (abandonedThisCycle.has(s.id)) return s;
        const before = snapshot.get(s.id);
        if (before === undefined) return s;
        return { ...s, populationChange: (s.population - before) / cycleCatchUp };
      });
    }

  } // ── end cycle start ──

  // ── treasury (cycle settlement; mid-cycle it only accrues the bands' own work) ──
  {
    const treasuryResolves = isCycleStart(tick, cadence.cycle);
    // Founding debits belong in this guard alongside the two work bands: this guard decides whether
    // the processor runs AT ALL, so its own accrual guard never sees a tick this one refuses. A cycle
    // where every colony in the queue is waiting on its charter absorbs no work anywhere, which is
    // exactly the tick that commits charter money — and off a settlement tick that debit would be
    // silently dropped.
    const hasWork =
      (constructionWorkByFaction?.size ?? 0) > 0 ||
      (logisticsWorkByFaction?.size ?? 0) > 0 ||
      (foundingDebitsByFaction?.size ?? 0) > 0;
    if (treasuries.length > 0 && (treasuryResolves || hasWork)) {
      // The processor reads systems only when settling — a mid-cycle accrual
      // tick (band work without a cycle boundary) skips the O(systems) build.
      const treasuryWorld = new InMemoryTreasuryWorld({
        treasuries,
        systems: treasuryResolves
          ? systems
              .filter((s) => s.factionId !== null && isEconomicallyActive(s.control))
              .map((s) => ({
                systemId: s.id,
                factionId: s.factionId ?? "",
                population: s.population,
                buildings: s.buildings,
              }))
          : [],
      });
      await runTreasuryProcessor(
        treasuryWorld,
        {
          tick,
          results: economySignals ? new Map([["economy", { economySignals }]]) : new Map(),
        },
        {
          interval: cadence.cycle,
          economyScale: ECONOMY_SCALE,
          constructionWorkByFaction: constructionWorkByFaction ?? new Map(),
          logisticsWorkByFaction: logisticsWorkByFaction ?? new Map(),
          foundingDebitsByFaction: foundingDebitsByFaction ?? new Map(),
          rates: {
            headsTaxPerCycle: TREASURY.HEADS_TAX_PER_CYCLE,
            headsWeights: { ...TREASURY.HEADS_WEIGHTS },
            productionTaxRate: TREASURY.PRODUCTION_TAX_RATE,
            referenceValues: REFERENCE_VALUE,
            maintenanceRatePerWork: TREASURY.MAINTENANCE_RATE_PER_WORK,
            constructionRatePerWork: TREASURY.CONSTRUCTION_RATE_PER_WORK,
            logisticsRatePerWork: TREASURY.LOGISTICS_RATE_PER_WORK,
          },
        },
      );
      treasuries = treasuryWorld.treasuries;
      processorsRun.push("treasury");
    }
  }

  // Directed-logistics is the only writer of flowEvents, and it only appends on the
  // cycle start — but the prune stays every-tick, outside the gate above, so the retention
  // window is enforced on the tick it expires rather than up to a cycle late. It is a
  // filter over an already-bounded log; the cycle-start gate is not worth the drift.
  const flowRetentionFloor = tick - TRADE_SIMULATION.FLOW_HISTORY_TICKS;
  flowEvents = flowEvents.filter((f) => f.tick >= flowRetentionFloor);

  // ── relations (gated by RELATIONS_FREQUENCY, offset 0 — the one stage on its
  // own cadence rather than the cycle start the block above rides) ──
  if (world.factions.length >= 2 && tick % RELATIONS_FREQUENCY === 0) {
    const relationsWorld = new InMemoryRelationsWorld({
      factions: world.factions.map((f) => ({
        id: f.id,
        name: f.name,
        governmentType: f.governmentType,
        doctrine: f.doctrine,
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
    treasuries,
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
  //
  // `instrumentation` is calibration-only: never folded into `nextWorld`, `tickEvents`, or any
  // broadcast/SSE payload — the calibration harness is its only reader.
  return {
    world: nextWorld,
    events: tickEvents,
    markets,
    instrumentation: {
      buildCommitmentsByGood, migrationMoved, foundingManifests, foundingStalls, logisticsBudget,
      strikeSuppressedProposals, overshootDeathBySystem, growthBySystem, teardownLevelsBySystem,
    },
  };
}
