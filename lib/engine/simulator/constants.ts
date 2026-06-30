/**
 * Simulator constants — captures every tunable constant that affects simulation.
 * resolveConstants() builds a complete snapshot from imported defaults + optional overrides.
 */

import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import { GOODS } from "@/lib/constants/goods";
import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";
import {
  EVENT_SPAWN_INTERVAL,
  MODIFIER_CAPS,
  scaleEventCaps,
} from "@/lib/constants/events";
import { SHIP_TYPES } from "@/lib/constants/ships";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";
import { type ModifierCaps } from "@/lib/engine/events";
import { UNREST_PARAMS, STRIKE_PARAMS, POPULATION_PARAMS, MIGRATION_PARAMS } from "@/lib/constants/population";
import { INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { scaleValue } from "@/lib/constants/economy-scale";

// ── Types ────────────────────────────────────────────────────────

export interface SimConstants {
  economy: {
    noiseFraction: number;
    /** Operating-ceiling cover multiple (produce throttle saturates at holdCover × anchor). */
    holdCover: number;
    /** Ticks for the system shard to refresh every system once. */
    interval: number;
  };
  /** Read-only snapshot of pricing clamps (not overridable in v1). */
  pricing: {
    minMultiplier: number;
    maxMultiplier: number;
  };
  goods: Record<string, {
    basePrice: number;
    tier: number;
    volume: number;
    mass: number;
    volatility: number;
    hazard: string;
    priceFloor: number;
    priceCeiling: number;
  }>;
  fuel: {
    refuelCostPerUnit: number;
  };
  events: {
    spawnInterval: number;
    maxPerSystem: number;
    maxGlobal: number;
    maxBatchSpawn: number;
    modifierCaps: ModifierCaps;
  };
  ships: Record<string, { fuel: number; cargo: number; speed: number; hullMax: number; shieldMax: number; firepower: number; evasion: number; stealth: number; price: number }>;
  universe: {
    regionCount: number;
    totalSystems: number;
    intraRegionBaseFuel: number;
    gatewayFuelMultiplier: number;
    gatewaysPerBorder: number;
    intraRegionExtraEdges: number;
  };
  tradeFlow: {
    distanceDecay: number;
    flowBudget: number;
    gradientThreshold: number;
    gradientSensitivity: number;
    flowHistoryTicks: number;
    playerDisplacementFactor: number;
    playerVolumeTarget: number;
  };
  population: {
    unrest: { gain: number; decay: number };
    dynamics: { growthRate: number; declineRate: number; overshootDeathRate: number };
    strike: { threshold: number; floorMultiplier: number };
  };
  infrastructure: {
    disuseRate: number;
    unrestRate: number;
    unrestThreshold: number;
  };
  migration: {
    weights: { contentment: number; headroom: number };
    maxOutflowFraction: number;
    gradientThreshold: number;
    distanceDecay: number;
  };
  bots: {
    startingCredits: number;
    refuelThreshold: number;
    tradeImpactFactor: number;
  };
}

/** Deep-partial version for overrides — every leaf is optional. */
export type SimConstantOverrides = {
  economy?: Partial<SimConstants["economy"]>;
  pricing?: Partial<SimConstants["pricing"]>;
  goods?: Record<string, Partial<SimConstants["goods"][string]>>;
  fuel?: Partial<SimConstants["fuel"]>;
  events?: Partial<Omit<SimConstants["events"], "modifierCaps">> & {
    modifierCaps?: Partial<SimConstants["events"]["modifierCaps"]>;
  };
  ships?: Record<string, Partial<SimConstants["ships"][string]>>;
  universe?: Partial<SimConstants["universe"]>;
  tradeFlow?: Partial<SimConstants["tradeFlow"]>;
  population?: {
    unrest?: Partial<SimConstants["population"]["unrest"]>;
    dynamics?: Partial<SimConstants["population"]["dynamics"]>;
    strike?: Partial<SimConstants["population"]["strike"]>;
  };
  infrastructure?: Partial<SimConstants["infrastructure"]>;
  migration?: Partial<Omit<SimConstants["migration"], "weights">> & {
    weights?: Partial<SimConstants["migration"]["weights"]>;
  };
  bots?: Partial<SimConstants["bots"]>;
};

// ── Resolution ───────────────────────────────────────────────────

function buildDefaults(): SimConstants {
  const goods: SimConstants["goods"] = {};
  for (const [key, def] of Object.entries(GOODS)) {
    goods[key] = {
      basePrice: def.basePrice,
      tier: def.tier,
      volume: def.volume,
      mass: def.mass,
      volatility: def.volatility,
      hazard: def.hazard,
      priceFloor: def.priceFloor,
      priceCeiling: def.priceCeiling,
    };
  }

  const ships: SimConstants["ships"] = {};
  for (const [key, def] of Object.entries(SHIP_TYPES)) {
    ships[key] = {
      fuel: def.fuel,
      cargo: def.cargo,
      speed: def.speed,
      hullMax: def.hullMax,
      shieldMax: def.shieldMax,
      firepower: def.firepower,
      evasion: def.evasion,
      stealth: def.stealth,
      price: def.price,
    };
  }

  return {
    economy: {
      noiseFraction: ECONOMY_CONSTANTS.NOISE_FRACTION,
      holdCover: ECONOMY_CONSTANTS.HOLD_COVER,
      interval: ECONOMY_UPDATE_INTERVAL,
    },
    pricing: {
      minMultiplier: 0.5,
      maxMultiplier: 3.0,
    },
    goods,
    fuel: {
      refuelCostPerUnit: REFUEL_COST_PER_UNIT,
    },
    events: (() => {
      const scaled = scaleEventCaps(UNIVERSE_GEN.TOTAL_SYSTEMS);
      return {
        spawnInterval: EVENT_SPAWN_INTERVAL,
        maxPerSystem: scaled.maxEventsPerSystem,
        maxGlobal: scaled.maxEventsGlobal,
        maxBatchSpawn: scaled.batchSize,
        modifierCaps: { ...MODIFIER_CAPS },
      };
    })(),
    ships,
    universe: {
      regionCount: UNIVERSE_GEN.REGION_COUNT,
      totalSystems: UNIVERSE_GEN.TOTAL_SYSTEMS,
      intraRegionBaseFuel: UNIVERSE_GEN.INTRA_REGION_BASE_FUEL,
      gatewayFuelMultiplier: UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER,
      gatewaysPerBorder: UNIVERSE_GEN.GATEWAYS_PER_BORDER,
      intraRegionExtraEdges: UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES,
    },
    tradeFlow: {
      distanceDecay: TRADE_SIMULATION.DISTANCE_DECAY,
      flowBudget: TRADE_SIMULATION.FLOW_BUDGET,
      gradientThreshold: TRADE_SIMULATION.GRADIENT_THRESHOLD,
      gradientSensitivity: TRADE_SIMULATION.GRADIENT_SENSITIVITY,
      flowHistoryTicks: TRADE_SIMULATION.FLOW_HISTORY_TICKS,
      playerDisplacementFactor: TRADE_SIMULATION.PLAYER_DISPLACEMENT_FACTOR,
      playerVolumeTarget: TRADE_SIMULATION.PLAYER_VOLUME_TARGET,
    },
    population: {
      unrest: { ...UNREST_PARAMS },
      dynamics: { ...POPULATION_PARAMS },
      strike: { ...STRIKE_PARAMS },
    },
    infrastructure: { ...INFRASTRUCTURE_DECAY_PARAMS },
    migration: {
      weights: { ...MIGRATION_PARAMS.weights },
      maxOutflowFraction: MIGRATION_PARAMS.maxOutflowFraction,
      gradientThreshold: MIGRATION_PARAMS.gradientThreshold,
      distanceDecay: MIGRATION_PARAMS.distanceDecay,
    },
    bots: {
      startingCredits: scaleValue(500),
      refuelThreshold: 0.5,
      tradeImpactFactor: 0.5,
    },
  };
}

/**
 * Build a complete SimConstants snapshot from defaults + optional overrides.
 * Overrides are shallow-merged per section; goods/ships merge per key.
 */
export function resolveConstants(overrides?: SimConstantOverrides): SimConstants {
  const base = buildDefaults();
  if (!overrides) return base;

  return {
    economy: { ...base.economy, ...overrides.economy },
    pricing: base.pricing, // read-only, not overridable
    goods: mergeRecord(base.goods, overrides.goods),
    fuel: { ...base.fuel, ...overrides.fuel },
    events: mergeEvents(base.events, overrides.events),
    ships: mergeRecord(base.ships, overrides.ships),
    universe: { ...base.universe, ...overrides.universe },
    tradeFlow: { ...base.tradeFlow, ...overrides.tradeFlow },
    population: {
      unrest: { ...base.population.unrest, ...overrides.population?.unrest },
      dynamics: { ...base.population.dynamics, ...overrides.population?.dynamics },
      strike: { ...base.population.strike, ...overrides.population?.strike },
    },
    infrastructure: { ...base.infrastructure, ...overrides.infrastructure },
    migration: {
      weights: { ...base.migration.weights, ...overrides.migration?.weights },
      maxOutflowFraction: overrides.migration?.maxOutflowFraction ?? base.migration.maxOutflowFraction,
      gradientThreshold: overrides.migration?.gradientThreshold ?? base.migration.gradientThreshold,
      distanceDecay: overrides.migration?.distanceDecay ?? base.migration.distanceDecay,
    },
    bots: { ...base.bots, ...overrides.bots },
  };
}

function mergeEvents(
  base: SimConstants["events"],
  overrides?: SimConstantOverrides["events"],
): SimConstants["events"] {
  if (!overrides) return base;
  const { modifierCaps, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    modifierCaps: { ...base.modifierCaps, ...modifierCaps },
  };
}

/** Merge a Record<string, T> with partial overrides per key.
 *  Existing keys are shallow-merged; new keys are ignored (only base keys are valid). */
function mergeRecord<T extends object>(
  base: Record<string, T>,
  overrides?: Record<string, Partial<T>>,
): Record<string, T> {
  if (!overrides) return base;
  const result = structuredClone(base);
  for (const [key, partial] of Object.entries(overrides)) {
    if (key in result) {
      Object.assign(result[key], partial);
    } else {
      console.warn(`[simulator] Unknown override key "${key}" — only existing keys can be overridden`);
    }
  }
  return result;
}

/** Default constants for use in tests. */
export const DEFAULT_SIM_CONSTANTS = resolveConstants();
