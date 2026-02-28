/**
 * In-memory economy tick simulation.
 * Mirrors the real tick processors (events → economy) but operates on SimWorld.
 */

import { simulateEconomyTick, type MarketTickEntry, type EconomySimParams } from "@/lib/engine/tick";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { GOVERNMENT_TYPES, adjustEquilibriumSpread } from "@/lib/constants/government";
import { GOODS } from "@/lib/constants/goods";
import { computeTraitProductionBonus, computeTraitDanger } from "@/lib/engine/trait-gen";
import { toTraitId, toQualityTier } from "@/lib/types/guards";
import {
  aggregateDangerLevel,
  rollCargoLoss,
  rollHazardIncidents,
  applyImportDuty,
  rollContrabandInspection,
  DANGER_CONSTANTS,
} from "@/lib/engine/danger";
import {
  checkPhaseTransition,
  buildModifiersForPhase,
  buildShocksForPhase,
  evaluateSpreadTargets,
  selectEventToSpawn,
  rollPhaseDuration,
  aggregateModifiers,
  type EventSnapshot,
  type SystemSnapshot,
  type ModifierRow,
  type NeighborSnapshot,
} from "@/lib/engine/events";
import type { RNG } from "@/lib/engine/universe-gen";
import type { SimConstants } from "./constants";
import type {
  SimWorld,
  SimEvent,
  SimMarketEntry,
  SimRunContext,
  InjectionTarget,
} from "./types";

/**
 * Build EconomySimParams from resolved constants.
 */
function buildSimParams(constants: SimConstants): EconomySimParams {
  return {
    reversionRate: constants.economy.reversionRate,
    noiseAmplitude: constants.economy.noiseAmplitude,
    minLevel: constants.economy.minLevel,
    maxLevel: constants.economy.maxLevel,
    productionRate: constants.economy.productionRate,
    consumptionRate: constants.economy.consumptionRate,
    equilibrium: constants.equilibrium,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function toEventSnapshot(e: SimEvent): EventSnapshot {
  return {
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
  };
}

function applyShocksToMarkets(
  markets: SimMarketEntry[],
  shocks: { goodId: string; parameter: "supply" | "demand"; value: number }[],
  systemId: string,
  constants: SimConstants,
): SimMarketEntry[] {
  if (shocks.length === 0) return markets;

  const { minLevel, maxLevel } = constants.economy;
  return markets.map((m) => {
    if (m.systemId !== systemId) return m;
    const shock = shocks.find((s) => s.goodId === m.goodId);
    if (!shock) return m;
    const current = shock.parameter === "supply" ? m.supply : m.demand;
    const newValue = Math.max(minLevel, Math.min(maxLevel, current + shock.value));
    return { ...m, [shock.parameter]: newValue };
  });
}

/**
 * Resolve an injection target to a system ID.
 */
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

    const destSystemId = ship.destinationSystemId!;
    let cargo = [...(ship.cargo ?? []).map((c) => ({ ...c }))];

    // Look up destination system → region → government
    const destSystem = world.systems.find((s) => s.id === destSystemId);
    const destRegion = destSystem
      ? world.regions.find((r) => r.id === destSystem.regionId)
      : undefined;
    const govDef = destRegion
      ? GOVERNMENT_TYPES[destRegion.governmentType]
      : undefined;

    // Compute danger level from navigation modifiers + government baseline + trait modifiers
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
    const danger = Math.max(0, Math.min(
      aggregateDangerLevel(navMods) + govBaseline + traitDanger,
      DANGER_CONSTANTS.MAX_DANGER,
    ));

    // Stage 1: Hazard incidents
    const enriched = cargo
      .filter((c) => c.quantity > 0)
      .map((c) => ({
        goodId: c.goodId,
        quantity: c.quantity,
        hazard: (GOODS[c.goodId]?.hazard ?? "none") as "none" | "low" | "high",
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

    // Remove empty cargo stacks
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

// ── Event lifecycle ─────────────────────────────────────────────

function processSimEvents(world: SimWorld, rng: RNG, ctx: SimRunContext): SimWorld {
  const snapshots = world.events.map(toEventSnapshot);
  let events = [...world.events];
  let modifiers = [...world.modifiers];
  let markets = [...world.markets];
  let nextId = world.nextId;

  const { constants } = ctx;
  const expiredIds: string[] = [];
  const newEvents: SimEvent[] = [];

  // Phase transitions
  for (const snap of snapshots) {
    const def = EVENT_DEFINITIONS[snap.type];
    if (!def) {
      expiredIds.push(snap.id);
      continue;
    }

    const result = checkPhaseTransition(snap, world.tick, def);

    if (result === "expire") {
      expiredIds.push(snap.id);
      continue;
    }

    if (result === "advance") {
      const currentIndex = def.phases.findIndex((p) => p.name === snap.phase);
      const nextPhase = def.phases[currentIndex + 1];
      const duration = rollPhaseDuration(nextPhase.durationRange, rng);

      // Update the event in-place
      const eventIdx = events.findIndex((e) => e.id === snap.id);
      if (eventIdx >= 0) {
        events[eventIdx] = {
          ...events[eventIdx],
          phase: nextPhase.name,
          phaseStartTick: world.tick,
          phaseDuration: duration,
        };
      }

      // Apply shocks for the new phase
      const shocks = buildShocksForPhase(nextPhase, snap.severity);
      markets = applyShocksToMarkets(markets, shocks, snap.systemId!, constants);

      // Spread: spawn child events at neighboring systems
      if (nextPhase.spread && nextPhase.spread.length > 0 && !snap.sourceEventId) {
        const neighbors = getNeighbors(world, snap.systemId!);
        const currentSnapshots = events.map(toEventSnapshot);

        const spreadDecisions = evaluateSpreadTargets(
          nextPhase.spread,
          snap,
          neighbors,
          currentSnapshots,
          { maxEventsGlobal: constants.events.maxGlobal, maxEventsPerSystem: constants.events.maxPerSystem },
          EVENT_DEFINITIONS,
          rng,
        );

        for (const decision of spreadDecisions) {
          const childId = `sim-${nextId++}`;
          newEvents.push({
            id: childId,
            type: decision.type,
            phase: decision.phase,
            systemId: decision.systemId,
            regionId: decision.regionId,
            startTick: world.tick,
            phaseStartTick: world.tick,
            phaseDuration: decision.phaseDuration,
            severity: decision.severity,
            sourceEventId: snap.id,
          });

          // Apply first-phase shocks for child
          const childDef = EVENT_DEFINITIONS[decision.type]!;
          const childShocks = buildShocksForPhase(childDef.phases[0], decision.severity);
          markets = applyShocksToMarkets(markets, childShocks, decision.systemId, constants);
        }
      }
    }
  }

  // Remove expired events
  events = events.filter((e) => !expiredIds.includes(e.id));

  // Add new spread events
  events = [...events, ...newEvents];

  // Process event injections for this tick
  const tickInjections = ctx.eventInjections.filter((inj) => inj.tick === world.tick);
  for (const inj of tickInjections) {
    const targetId = resolveInjectionTarget(inj.target, world.systems);
    if (!targetId) continue;

    const def = EVENT_DEFINITIONS[inj.eventType];
    if (!def) continue;

    const system = world.systems.find((s) => s.id === targetId);
    if (!system) continue;

    const firstPhase = def.phases[0];
    const duration = rollPhaseDuration(firstPhase.durationRange, rng);
    const eventId = `sim-${nextId++}`;
    const severity = inj.severity ?? 1.0;

    events.push({
      id: eventId,
      type: inj.eventType,
      phase: firstPhase.name,
      systemId: targetId,
      regionId: system.regionId,
      startTick: world.tick,
      phaseStartTick: world.tick,
      phaseDuration: duration,
      severity,
      sourceEventId: null,
    });

    // Apply first-phase shocks
    const shocks = buildShocksForPhase(firstPhase, severity);
    markets = applyShocksToMarkets(markets, shocks, targetId, constants);
  }

  // Spawn new events on spawn ticks (gated by disableRandomEvents)
  if (!ctx.disableRandomEvents && world.tick % constants.events.spawnInterval === 0) {
    const currentSnapshots = events.map(toEventSnapshot);
    const systemSnapshots: SystemSnapshot[] = world.systems.map((s) => ({
      id: s.id,
      economyType: s.economyType,
      regionId: s.regionId,
    }));

    const decision = selectEventToSpawn(
      EVENT_DEFINITIONS,
      currentSnapshots,
      systemSnapshots,
      world.tick,
      { maxEventsGlobal: constants.events.maxGlobal, maxEventsPerSystem: constants.events.maxPerSystem },
      rng,
    );

    if (decision) {
      const eventId = `sim-${nextId++}`;
      events.push({
        id: eventId,
        type: decision.type,
        phase: decision.phase,
        systemId: decision.systemId,
        regionId: decision.regionId,
        startTick: world.tick,
        phaseStartTick: world.tick,
        phaseDuration: decision.phaseDuration,
        severity: decision.severity,
        sourceEventId: null,
      });

      // Apply first-phase shocks
      const def = EVENT_DEFINITIONS[decision.type]!;
      const shocks = buildShocksForPhase(def.phases[0], decision.severity);
      markets = applyShocksToMarkets(markets, shocks, decision.systemId, constants);
    }
  }

  // Rebuild all modifiers from active events
  modifiers = [];
  for (const event of events) {
    const def = EVENT_DEFINITIONS[event.type];
    if (!def) continue;
    const phase = def.phases.find((p) => p.name === event.phase);
    if (!phase) continue;
    const rows = buildModifiersForPhase(phase, event.systemId, event.regionId, event.severity);
    modifiers.push(...rows);
  }

  return { ...world, events, modifiers, markets, nextId };
}

function getNeighbors(world: SimWorld, systemId: string): NeighborSnapshot[] {
  return world.connections
    .filter((c) => c.fromSystemId === systemId)
    .map((c) => {
      const sys = world.systems.find((s) => s.id === c.toSystemId)!;
      return { id: sys.id, economyType: sys.economyType, regionId: sys.regionId };
    });
}

// ── Economy simulation ──────────────────────────────────────────

function processSimEconomy(world: SimWorld, rng: RNG, constants: SimConstants): SimWorld {
  const regionNames = [...world.regions].sort((a, b) => a.name.localeCompare(b.name));
  if (regionNames.length === 0) return world;

  // Round-robin: one region per tick (matches real processor)
  const regionIndex = world.tick % regionNames.length;
  const targetRegion = regionNames[regionIndex];

  // Get systems in this region
  const regionSystemIds = new Set(
    world.systems
      .filter((s) => s.regionId === targetRegion.id)
      .map((s) => s.id),
  );

  // Filter markets to this region
  const regionMarkets = world.markets.filter((m) => regionSystemIds.has(m.systemId));
  if (regionMarkets.length === 0) return world;

  // Index modifiers by system
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

  // Look up government modifiers for this region
  const govDef = GOVERNMENT_TYPES[targetRegion.governmentType];

  // Build tick entries
  const tickEntries: MarketTickEntry[] = regionMarkets.map((m) => {
    const sys = world.systems.find((s) => s.id === m.systemId)!;
    const sysMods = modsBySystem.get(m.systemId) ?? [];
    const agg = sysMods.length > 0
      ? aggregateModifiers(sysMods, m.goodId, modifierCaps)
      : undefined;

    const goodConst = constants.goods[m.goodId];

    // Government: scale volatility
    const baseVolatility = goodConst?.volatility ?? 1;
    const volatility = govDef
      ? baseVolatility * govDef.volatilityModifier
      : baseVolatility;

    // Government: adjust equilibrium spread
    let equilibriumProduces = goodConst?.equilibrium.produces;
    let equilibriumConsumes = goodConst?.equilibrium.consumes;
    if (govDef && govDef.equilibriumSpreadPct !== 0) {
      if (equilibriumProduces) {
        equilibriumProduces = adjustEquilibriumSpread(equilibriumProduces, govDef.equilibriumSpreadPct);
      }
      if (equilibriumConsumes) {
        equilibriumConsumes = adjustEquilibriumSpread(equilibriumConsumes, govDef.equilibriumSpreadPct);
      }
    }

    // Government: boost consumption
    const baseConsumption = sys.consumes[m.goodId];
    const govBoost = govDef?.consumptionBoosts[m.goodId] ?? 0;
    const consumptionRate = baseConsumption != null
      ? baseConsumption + govBoost
      : govBoost > 0 ? govBoost : undefined;

    // Trait production bonus: effectiveRate = baseRate × (1 + traitBonus)
    const baseProductionRate = sys.produces[m.goodId];
    const validatedTraits = sys.traits.map((t) => ({
      traitId: toTraitId(t.traitId),
      quality: toQualityTier(t.quality),
    }));
    const traitBonus = computeTraitProductionBonus(validatedTraits, m.goodId);
    const productionRate = baseProductionRate != null
      ? baseProductionRate * (1 + traitBonus)
      : undefined;

    return {
      goodId: m.goodId,
      supply: m.supply,
      demand: m.demand,
      basePrice: m.basePrice,
      economyType: sys.economyType,
      produces: Object.keys(sys.produces),
      consumes: Object.keys(sys.consumes),
      productionRate,
      consumptionRate,
      volatility,
      equilibriumProduces,
      equilibriumConsumes,
      ...(agg && {
        supplyTargetShift: agg.supplyTargetShift,
        demandTargetShift: agg.demandTargetShift,
        productionMult: agg.productionMult,
        consumptionMult: agg.consumptionMult,
        reversionMult: agg.reversionMult,
      }),
    };
  });

  // Run simulation
  const simParams = buildSimParams(constants);
  const simulated = simulateEconomyTick(tickEntries, simParams, rng);

  // Patch markets with new values
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

  return { ...world, markets: updatedMarkets };
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Simulate one world tick: ship arrivals → events → economy.
 * Returns a new SimWorld (immutable).
 */
export function simulateWorldTick(world: SimWorld, rng: RNG, ctx: SimRunContext): SimWorld {
  let w = { ...world, tick: world.tick + 1 };
  w = processSimShipArrivals(w, rng);
  w = processSimEvents(w, rng, ctx);
  w = processSimEconomy(w, rng, ctx.constants);
  return w;
}
