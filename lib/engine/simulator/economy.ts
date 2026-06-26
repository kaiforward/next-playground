/**
 * In-memory world tick orchestration. Ship arrivals stay here; events and
 * the economy run through unified processors against in-memory adapters.
 * See `docs/design/active/processor-architecture.md`.
 */

import { type EconomySimParams } from "@/lib/engine/tick";
import { scaleEventCaps } from "@/lib/constants/events";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GOODS } from "@/lib/constants/goods";
import { computeTraitDanger } from "@/lib/engine/trait-gen";
import { toTraitId, toQualityTier, toHazard } from "@/lib/types/guards";
import {
  computeSystemDanger,
  rollCargoLoss,
  rollHazardIncidents,
  applyImportDuty,
  rollContrabandInspection,
} from "@/lib/engine/danger";
import type { RNG } from "@/lib/engine/universe-gen";
import { runEventsProcessor } from "@/lib/tick/processors/events";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { runInfrastructureDecayProcessor } from "@/lib/tick/processors/infrastructure-decay";
import { runPopulationProcessor } from "@/lib/tick/processors/population";
import { runMigrationProcessor } from "@/lib/tick/processors/migration";
import { runTradeFlowProcessor } from "@/lib/tick/processors/trade-flow";
import { runDirectedLogisticsProcessor } from "@/lib/tick/processors/directed-logistics";
import { InMemoryEventsWorld } from "@/lib/tick/adapters/memory/events";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { InMemoryInfrastructureWorld } from "@/lib/tick/adapters/memory/infrastructure";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import { InMemoryMigrationWorld } from "@/lib/tick/adapters/memory/migration";
import { InMemoryTradeFlowWorld } from "@/lib/tick/adapters/memory/trade-flow";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { computeBoundedHopDistances } from "@/lib/engine/pathfinding";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import type { InjectionRequest } from "@/lib/tick/world/events-world";
import type { EconomySignals, TickContext } from "@/lib/tick/types";
import type { SimConstants } from "./constants";
import type {
  SimWorld,
  SimRunContext,
  InjectionTarget,
} from "./types";

const SCALED = scaleEventCaps(UNIVERSE_GEN.TOTAL_SYSTEMS);
const EVENT_DEFINITIONS = SCALED.definitions;

function buildSimParams(constants: SimConstants): EconomySimParams {
  return {
    noiseFraction: constants.economy.noiseFraction,
  };
}

/** Resolve an injection target to a system ID. */
function resolveInjectionTarget(
  target: InjectionTarget,
  systems: { id: string; economyType: string }[],
): string | null {
  if ("systemIndex" in target) {
    return systems[target.systemIndex]?.id ?? null;
  }
  const matches = systems
    .filter((s) => s.economyType === target.economyType)
    .sort((a, b) => a.id.localeCompare(b.id));
  return matches[target.nth ?? 0]?.id ?? null;
}

// ── Ship arrivals ───────────────────────────────────────────────

function processSimShipArrivals(world: SimWorld, rng: RNG): SimWorld {
  const ships = world.ships.map((ship) => {
    if (
      ship.status !== "in_transit" ||
      ship.arrivalTick === null ||
      ship.arrivalTick > world.tick
    ) {
      return ship;
    }

    const destSystemId = ship.destinationSystemId;
    if (!destSystemId) return ship;
    let cargo = [...(ship.cargo ?? []).map((c) => ({ ...c }))];

    const destSystem = world.systems.find((s) => s.id === destSystemId);
    const govDef = destSystem
      ? GOVERNMENT_TYPES[destSystem.governmentType]
      : undefined;

    const navMods = world.modifiers.filter(
      (m) => m.domain === "navigation" && m.targetType === "system" && m.targetId === destSystemId,
    );
    const govBaseline = govDef?.dangerBaseline ?? 0;
    const traitDanger = destSystem
      ? computeTraitDanger(destSystem.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })))
      : 0;
    const danger = computeSystemDanger(navMods, govBaseline, traitDanger, destSystem?.bodyDanger ?? 0);

    // Stage 1: Hazard incidents
    const enriched = cargo
      .filter((c) => c.quantity > 0)
      .map((c) => ({
        goodId: c.goodId,
        quantity: c.quantity,
        hazard: toHazard(GOODS[c.goodId]?.hazard ?? "none"),
      }));
    const hazardLosses = rollHazardIncidents(enriched, danger, rng);
    for (const inc of hazardLosses) {
      const item = cargo.find((c) => c.goodId === inc.goodId);
      if (item) item.quantity = inc.remaining;
    }

    // Stage 2: Import duty
    if (govDef && govDef.taxed.length > 0 && govDef.taxRate > 0) {
      const duties = applyImportDuty(
        cargo.filter((c) => c.quantity > 0),
        govDef.taxed,
        govDef.taxRate,
      );
      for (const duty of duties) {
        const item = cargo.find((c) => c.goodId === duty.goodId);
        if (item) item.quantity = duty.remaining;
      }
    }

    // Stage 3: Contraband inspection
    if (govDef && govDef.contraband.length > 0 && govDef.inspectionModifier > 0) {
      const seized = rollContrabandInspection(
        cargo.filter((c) => c.quantity > 0),
        govDef.contraband,
        govDef.inspectionModifier,
        rng,
      );
      for (const s of seized) {
        const item = cargo.find((c) => c.goodId === s.goodId);
        if (item) item.quantity = 0;
      }
    }

    // Stage 4: Existing event-based danger
    if (danger > 0) {
      const remaining = cargo.filter((c) => c.quantity > 0);
      const losses = rollCargoLoss(danger, remaining, rng);
      for (const loss of losses) {
        const item = cargo.find((c) => c.goodId === loss.goodId);
        if (item) item.quantity = loss.remaining;
      }
    }

    cargo = cargo.filter((c) => c.quantity > 0);

    return {
      ...ship,
      status: "docked" as const,
      systemId: destSystemId,
      destinationSystemId: null,
      arrivalTick: null,
      cargo,
    };
  });
  return { ...world, ships };
}

// ── Event lifecycle (delegates to the unified processor) ─────────

async function processSimEvents(
  world: SimWorld,
  rng: RNG,
  ctx: SimRunContext,
): Promise<SimWorld> {
  // Resolve injection targets *outside* the processor body (sim concern).
  const injections: InjectionRequest[] = [];
  for (const inj of ctx.eventInjections.filter((i) => i.tick === world.tick)) {
    const targetId = resolveInjectionTarget(inj.target, world.systems);
    if (!targetId) continue;
    const sys = world.systems.find((s) => s.id === targetId);
    if (!sys) continue;
    injections.push({
      type: inj.eventType,
      systemId: targetId,
      regionId: sys.regionId,
      severity: inj.severity ?? 1.0,
    });
  }

  const eventsWorld = new InMemoryEventsWorld(
    {
      events: world.events,
      modifiers: world.modifiers,
      markets: world.markets,
      nextId: world.nextId,
    },
    world.systems,
    world.connections,
    EVENT_DEFINITIONS,
  );

  const tickCtx: TickContext = {
    // Processor body never reads `tx` — the in-memory adapter handles
    // mutation. Cast via never so we don't have to stub TxClient.
    tx: undefined as never,
    tick: world.tick,
    results: new Map(),
  };

  await runEventsProcessor(eventsWorld, tickCtx, {
    rng,
    caps: {
      maxEventsGlobal: ctx.constants.events.maxGlobal,
      maxEventsPerSystem: ctx.constants.events.maxPerSystem,
    },
    batchSize: ctx.constants.events.maxBatchSpawn,
    spawnInterval: ctx.constants.events.spawnInterval,
    definitions: EVENT_DEFINITIONS,
    spawnEnabled: !ctx.disableRandomEvents,
    injections,
  });

  return {
    ...world,
    events: eventsWorld.events,
    modifiers: eventsWorld.modifiers,
    markets: eventsWorld.markets,
    nextId: eventsWorld.nextId,
  };
}

// ── Economy (delegates to the unified processor) ────────────────

async function processSimEconomy(
  world: SimWorld,
  rng: RNG,
  constants: SimConstants,
): Promise<{ world: SimWorld; signals: EconomySignals | undefined }> {
  const economyWorld = new InMemoryEconomyWorld({
    systems: world.systems,
    markets: world.markets,
    modifiers: world.modifiers,
  });

  const tickCtx: TickContext = {
    tx: undefined as never,
    tick: world.tick,
    results: new Map(),
  };

  const result = await runEconomyProcessor(economyWorld, tickCtx, {
    rng,
    interval: constants.economy.interval,
    simParams: buildSimParams(constants),
    modifierCaps: constants.events.modifierCaps,
    strikeParams: constants.population.strike,
  });

  return {
    world: { ...world, systems: economyWorld.systems, markets: economyWorld.markets },
    signals: result.economySignals,
  };
}

async function processSimInfrastructureDecay(
  world: SimWorld,
  signals: EconomySignals | undefined,
  constants: SimConstants,
): Promise<SimWorld> {
  if (!signals) return world;
  const decayWorld = new InMemoryInfrastructureWorld({ systems: world.systems });
  const tickCtx: TickContext = {
    tx: undefined as never,
    tick: world.tick,
    results: new Map([["economy", { economySignals: signals }]]),
  };
  await runInfrastructureDecayProcessor(decayWorld, tickCtx, {
    decay: {
      disuseRate: constants.infrastructure.disuseRate,
      unrestRate: constants.infrastructure.unrestRate,
      unrestThreshold: constants.infrastructure.unrestThreshold,
    },
  });
  return { ...world, systems: decayWorld.systems };
}

async function processSimPopulation(
  world: SimWorld,
  signals: EconomySignals | undefined,
  constants: SimConstants,
): Promise<SimWorld> {
  if (!signals) return world;
  const popWorld = new InMemoryPopulationWorld({ systems: world.systems, markets: world.markets });
  const tickCtx: TickContext = {
    tx: undefined as never,
    tick: world.tick,
    results: new Map([["economy", { economySignals: signals }]]),
  };
  await runPopulationProcessor(popWorld, tickCtx, {
    unrest: constants.population.unrest,
    population: constants.population.dynamics,
  });
  return { ...world, systems: popWorld.systems, markets: popWorld.markets };
}

// ── Migration (delegates to the unified processor) ──────────────

async function processSimMigration(world: SimWorld, constants: SimConstants): Promise<SimWorld> {
  const migWorld = new InMemoryMigrationWorld({ systems: world.systems }, world.connections);
  const tickCtx: TickContext = { tx: undefined as never, tick: world.tick, results: new Map() };
  await runMigrationProcessor(migWorld, tickCtx, {
    // Flow + migration share the economy's clock (one coupled-economy cadence).
    interval: constants.economy.interval,
    flow: {
      weights: constants.migration.weights,
      maxOutflowFraction: constants.migration.maxOutflowFraction,
      gradientThreshold: constants.migration.gradientThreshold,
      distanceDecay: constants.migration.distanceDecay,
    },
  });
  return { ...world, systems: migWorld.systems };
}

// ── Trade flow (delegates to the unified processor) ─────────────

async function processSimTradeFlow(
  world: SimWorld,
  constants: SimConstants,
): Promise<SimWorld> {
  const flowWorld = new InMemoryTradeFlowWorld(
    {
      systems: world.systems,
      markets: world.markets,
      flowEvents: world.flowEvents,
    },
    world.connections,
  );

  const tickCtx: TickContext = {
    tx: undefined as never,
    tick: world.tick,
    results: new Map(),
  };

  await runTradeFlowProcessor(flowWorld, tickCtx, {
    // Flow + migration share the economy's clock (one coupled-economy cadence).
    interval: constants.economy.interval,
    flowBudget: constants.tradeFlow.flowBudget,
    gradientThreshold: constants.tradeFlow.gradientThreshold,
    gradientSensitivity: constants.tradeFlow.gradientSensitivity,
    flowHistoryTicks: constants.tradeFlow.flowHistoryTicks,
    playerDisplacementFactor: constants.tradeFlow.playerDisplacementFactor,
    distanceDecay: constants.tradeFlow.distanceDecay,
    playerVolumeTarget: constants.tradeFlow.playerVolumeTarget,
  });

  return {
    ...world,
    systems: flowWorld.systems,
    markets: flowWorld.markets,
    flowEvents: flowWorld.flowEvents,
  };
}

// ── Directed logistics (delegates to the unified processor) ─────

async function processSimDirectedLogistics(
  world: SimWorld,
  constants: SimConstants,
): Promise<SimWorld> {
  // Group markets by systemId for row construction.
  const marketsBySystem = new Map<string, typeof world.markets>();
  for (const m of world.markets) {
    const list = marketsBySystem.get(m.systemId) ?? [];
    list.push(m);
    marketsBySystem.set(m.systemId, list);
  }

  // Build SystemLogisticsRow[] — give each market a synthetic id (SimMarketEntry has none).
  const rows = world.systems.map((s) => ({
    systemId: s.id,
    factionId: s.factionId,
    population: s.population,
    buildings: s.buildings,
    yields: s.yields,
    markets: (marketsBySystem.get(s.id) ?? []).map((m) => ({
      id: `${m.systemId}|${m.goodId}`,
      goodId: m.goodId,
      stock: m.stock,
      basePrice: m.basePrice,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
      priceFloor: m.priceFloor,
      priceCeiling: m.priceCeiling,
      storageCapacity: m.storageCapacity,
    })),
  }));

  // Build bounded hop distances from the sim connection graph (SimConnection ≡ ConnectionInfo).
  const hops = computeBoundedHopDistances(world.connections, DIRECTED_LOGISTICS.MAX_HOPS);
  const routeCost: RouteCost = (f, t) => {
    const h = hops.get(f)?.get(t);
    return h === undefined || h > DIRECTED_LOGISTICS.MAX_HOPS ? null : h * DIRECTED_LOGISTICS.HOP_WEIGHT;
  };

  const dlWorld = new MemoryDirectedLogisticsWorld(rows);

  // Live INTERVAL = 2 × economy clock; preserve that relationship under sim overrides.
  await runDirectedLogisticsProcessor(dlWorld, { tick: world.tick }, {
    interval: 2 * constants.economy.interval,
    routeCost,
  });

  // Write captured stock updates back into the sim world.
  const updatedMarkets = world.markets.map((m) => {
    const newStock = dlWorld.stockUpdates.get(`${m.systemId}|${m.goodId}`);
    return newStock !== undefined ? { ...m, stock: newStock } : m;
  });

  // LogisticsFlowInsert ≡ SimFlowEvent — shapes match directly.
  const updatedFlowEvents = [...world.flowEvents, ...dlWorld.flows];

  return { ...world, markets: updatedMarkets, flowEvents: updatedFlowEvents };
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Simulate one world tick: ship arrivals → events → economy → population → migration → trade flow → directed logistics.
 * Returns a new SimWorld. Async because the unified processors are async
 * (the in-memory adapters resolve immediately, but `await` still requires
 * an async caller).
 */
export async function simulateWorldTick(
  world: SimWorld,
  rng: RNG,
  ctx: SimRunContext,
): Promise<SimWorld> {
  let w = { ...world, tick: world.tick + 1 };
  w = processSimShipArrivals(w, rng);
  w = await processSimEvents(w, rng, ctx);
  const eco = await processSimEconomy(w, rng, ctx.constants);
  w = await processSimInfrastructureDecay(eco.world, eco.signals, ctx.constants);
  w = await processSimPopulation(w, eco.signals, ctx.constants);
  w = await processSimMigration(w, ctx.constants);
  w = await processSimTradeFlow(w, ctx.constants);
  w = await processSimDirectedLogistics(w, ctx.constants);
  return w;
}
