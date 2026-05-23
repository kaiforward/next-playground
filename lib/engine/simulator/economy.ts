/**
 * In-memory economy tick simulation. Ship arrivals and economy still live
 * here; events now run through the unified `runEventsProcessor` (Phase 2 of
 * the processor refactor — `docs/design/planned/processor-architecture.md`).
 */

import {
  simulateEconomyTick,
  updateProsperity,
  type MarketTickEntry,
  type EconomySimParams,
  type ProsperityParams,
} from "@/lib/engine/tick";
import { scaleEventCaps } from "@/lib/constants/events";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GOODS } from "@/lib/constants/goods";
import { resolveMarketTickEntry } from "@/lib/engine/market-tick-builder";
import { computeTraitDanger } from "@/lib/engine/trait-gen";
import { toTraitId, toQualityTier, toHazard } from "@/lib/types/guards";
import {
  computeSystemDanger,
  rollCargoLoss,
  rollHazardIncidents,
  applyImportDuty,
  rollContrabandInspection,
} from "@/lib/engine/danger";
import type { ModifierRow } from "@/lib/engine/events";
import type { RNG } from "@/lib/engine/universe-gen";
import { runEventsProcessor } from "@/lib/tick/processors/events";
import { InMemoryEventsWorld } from "@/lib/tick/adapters/memory/events";
import type { InjectionRequest } from "@/lib/tick/world/events-world";
import type { TickContext } from "@/lib/tick/types";
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
    reversionRate: constants.economy.reversionRate,
    noiseAmplitude: constants.economy.noiseAmplitude,
    noiseReferenceLevel: constants.economy.noiseReferenceLevel,
    minLevel: constants.economy.minLevel,
    maxLevel: constants.economy.maxLevel,
    equilibrium: constants.equilibrium,
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
    const destRegion = destSystem
      ? world.regions.find((r) => r.id === destSystem.regionId)
      : undefined;
    const govDef = destRegion
      ? GOVERNMENT_TYPES[destRegion.governmentType]
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
    const danger = computeSystemDanger(navMods, govBaseline, traitDanger);

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
    {
      minLevel: ctx.constants.economy.minLevel,
      maxLevel: ctx.constants.economy.maxLevel,
    },
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

// ── Economy simulation ──────────────────────────────────────────

function processSimEconomy(world: SimWorld, rng: RNG, constants: SimConstants): SimWorld {
  const regionNames = [...world.regions].sort((a, b) => a.name.localeCompare(b.name));
  if (regionNames.length === 0) return world;

  const regionIndex = world.tick % regionNames.length;
  const targetRegion = regionNames[regionIndex];

  const regionSystemIds = new Set(
    world.systems
      .filter((s) => s.regionId === targetRegion.id)
      .map((s) => s.id),
  );

  const regionMarkets = world.markets.filter((m) => regionSystemIds.has(m.systemId));
  if (regionMarkets.length === 0) return world;

  const regionMods = world.modifiers.filter(
    (m) => m.domain === "economy" && m.targetType === "region" && m.targetId === targetRegion.id,
  );
  const systemMods = world.modifiers.filter(
    (m) => m.domain === "economy" && m.targetType === "system" && m.targetId && regionSystemIds.has(m.targetId),
  );

  const modsBySystem = new Map<string, ModifierRow[]>();
  for (const sysId of regionSystemIds) {
    modsBySystem.set(sysId, [...regionMods]);
  }
  for (const mod of systemMods) {
    modsBySystem.get(mod.targetId!)?.push(mod);
  }

  const modifierCaps = constants.events.modifierCaps;
  const govDef = GOVERNMENT_TYPES[targetRegion.governmentType];

  const prosperityParams: ProsperityParams = constants.prosperity;
  const prosperityBySystem = new Map<string, number>();

  for (const sysId of regionSystemIds) {
    const sys = world.systems.find((s) => s.id === sysId)!;
    const newProsperity = updateProsperity(
      sys.prosperity,
      sys.tradeVolumeAccum,
      prosperityParams,
    );
    prosperityBySystem.set(sysId, newProsperity);
  }

  const tickEntries: MarketTickEntry[] = regionMarkets.map((m) => {
    const sys = world.systems.find((s) => s.id === m.systemId)!;

    return resolveMarketTickEntry({
      goodId: m.goodId,
      supply: m.supply,
      demand: m.demand,
      basePrice: m.basePrice,
      economyType: sys.economyType,
      produces: Object.keys(sys.produces),
      consumes: Object.keys(sys.consumes),
      baseProductionRate: sys.produces[m.goodId],
      baseConsumptionRate: sys.consumes[m.goodId],
      govDef: govDef ?? undefined,
      traits: sys.traits.map((t) => ({
        traitId: toTraitId(t.traitId),
        quality: toQualityTier(t.quality),
      })),
      prosperity: prosperityBySystem.get(m.systemId) ?? 0,
      modifiers: modsBySystem.get(m.systemId) ?? [],
      modifierCaps,
    }, prosperityParams);
  });

  const simParams = buildSimParams(constants);
  const simulated = simulateEconomyTick(tickEntries, simParams, rng);

  const regionMarketKeys = new Set(
    regionMarkets.map((m) => `${m.systemId}:${m.goodId}`),
  );

  const updatedMarkets = world.markets.map((m) => {
    const key = `${m.systemId}:${m.goodId}`;
    if (!regionMarketKeys.has(key)) return m;
    const idx = regionMarkets.findIndex(
      (rm) => rm.systemId === m.systemId && rm.goodId === m.goodId,
    );
    if (idx < 0) return m;
    return { ...m, supply: simulated[idx].supply, demand: simulated[idx].demand };
  });

  const updatedSystems = world.systems.map((s) => {
    const newProsperity = prosperityBySystem.get(s.id);
    if (newProsperity === undefined) return s;
    return { ...s, prosperity: newProsperity, tradeVolumeAccum: 0 };
  });

  return { ...world, systems: updatedSystems, markets: updatedMarkets };
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Simulate one world tick: ship arrivals → events → economy.
 * Returns a new SimWorld. Async because the unified events processor
 * is async (the in-memory adapter resolves immediately, but `await`
 * still requires an async caller).
 */
export async function simulateWorldTick(
  world: SimWorld,
  rng: RNG,
  ctx: SimRunContext,
): Promise<SimWorld> {
  let w = { ...world, tick: world.tick + 1 };
  w = processSimShipArrivals(w, rng);
  w = await processSimEvents(w, rng, ctx);
  w = processSimEconomy(w, rng, ctx.constants);
  return w;
}
