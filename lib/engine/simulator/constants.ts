/**
 * Simulator constants — captures every tunable constant that affects simulation.
 * resolveConstants() builds a complete snapshot from imported defaults + optional overrides.
 */

import { ECONOMY_CONSTANTS, EQUILIBRIUM_TARGETS } from "@/lib/constants/economy";
import { GOODS } from "@/lib/constants/goods";
import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";
import {
  EVENT_SPAWN_INTERVAL,
  MAX_EVENTS_PER_SYSTEM,
  MAX_EVENTS_GLOBAL,
  MODIFIER_CAPS,
} from "@/lib/constants/events";
import { SHIP_TYPES } from "@/lib/constants/ships";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";

// ── Types ────────────────────────────────────────────────────────

export interface SimConstants {
  economy: {
    reversionRate: number;
    noiseAmplitude: number;
    minLevel: number;
    maxLevel: number;
    productionRate: number;
    consumptionRate: number;
  };
  equilibrium: {
    produces: { supply: number; demand: number };
    consumes: { supply: number; demand: number };
    neutral: { supply: number; demand: number };
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
    equilibrium: { produces: { supply: number; demand: number }; consumes: { supply: number; demand: number } };
  }>;
  fuel: {
    refuelCostPerUnit: number;
  };
  events: {
    spawnInterval: number;
    maxPerSystem: number;
    maxGlobal: number;
    modifierCaps: {
      maxShift: number;
      minMultiplier: number;
      maxMultiplier: number;
      minReversionMult: number;
    };
  };
  ships: Record<string, { fuel: number; cargo: number; speed: number; hullMax: number; shieldMax: number; firepower: number; evasion: number; stealth: number; price: number }>;
  universe: {
    regionCount: number;
    systemsPerRegion: number;
    intraRegionBaseFuel: number;
    gatewayFuelMultiplier: number;
    intraRegionExtraEdges: number;
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
  equilibrium?: {
    produces?: Partial<SimConstants["equilibrium"]["produces"]>;
    consumes?: Partial<SimConstants["equilibrium"]["consumes"]>;
    neutral?: Partial<SimConstants["equilibrium"]["neutral"]>;
  };
  pricing?: Partial<SimConstants["pricing"]>;
  goods?: Record<string, Partial<SimConstants["goods"][string]>>;
  fuel?: Partial<SimConstants["fuel"]>;
  events?: Partial<Omit<SimConstants["events"], "modifierCaps">> & {
    modifierCaps?: Partial<SimConstants["events"]["modifierCaps"]>;
  };
  ships?: Record<string, Partial<SimConstants["ships"][string]>>;
  universe?: Partial<SimConstants["universe"]>;
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
      equilibrium: { produces: { ...def.equilibrium.produces }, consumes: { ...def.equilibrium.consumes } },
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
      reversionRate: ECONOMY_CONSTANTS.REVERSION_RATE,
      noiseAmplitude: ECONOMY_CONSTANTS.NOISE_AMPLITUDE,
      minLevel: ECONOMY_CONSTANTS.MIN_LEVEL,
      maxLevel: ECONOMY_CONSTANTS.MAX_LEVEL,
      productionRate: ECONOMY_CONSTANTS.PRODUCTION_RATE,
      consumptionRate: ECONOMY_CONSTANTS.CONSUMPTION_RATE,
    },
    equilibrium: {
      produces: { ...EQUILIBRIUM_TARGETS.produces },
      consumes: { ...EQUILIBRIUM_TARGETS.consumes },
      neutral: { ...EQUILIBRIUM_TARGETS.neutral },
    },
    pricing: {
      minMultiplier: 0.2,
      maxMultiplier: 5.0,
    },
    goods,
    fuel: {
      refuelCostPerUnit: REFUEL_COST_PER_UNIT,
    },
    events: {
      spawnInterval: EVENT_SPAWN_INTERVAL,
      maxPerSystem: MAX_EVENTS_PER_SYSTEM,
      maxGlobal: MAX_EVENTS_GLOBAL,
      modifierCaps: { ...MODIFIER_CAPS },
    },
    ships,
    universe: {
      regionCount: UNIVERSE_GEN.REGION_COUNT,
      systemsPerRegion: UNIVERSE_GEN.SYSTEMS_PER_REGION,
      intraRegionBaseFuel: UNIVERSE_GEN.INTRA_REGION_BASE_FUEL,
      gatewayFuelMultiplier: UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER,
      intraRegionExtraEdges: UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES,
    },
    bots: {
      startingCredits: 500,
      refuelThreshold: 0.5,
      tradeImpactFactor: 0.1,
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
    equilibrium: {
      produces: { ...base.equilibrium.produces, ...overrides.equilibrium?.produces },
      consumes: { ...base.equilibrium.consumes, ...overrides.equilibrium?.consumes },
      neutral: { ...base.equilibrium.neutral, ...overrides.equilibrium?.neutral },
    },
    pricing: base.pricing, // read-only, not overridable
    goods: mergeRecord(base.goods, overrides.goods),
    fuel: { ...base.fuel, ...overrides.fuel },
    events: mergeEvents(base.events, overrides.events),
    ships: mergeRecord(base.ships, overrides.ships),
    universe: { ...base.universe, ...overrides.universe },
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

/** Merge a Record<string, T> with partial overrides per key. */
function mergeRecord<T extends Record<string, unknown>>(
  base: Record<string, T>,
  overrides?: Record<string, Partial<T>>,
): Record<string, T> {
  if (!overrides) return base;
  const result = { ...base };
  for (const [key, partial] of Object.entries(overrides)) {
    result[key] = { ...(result[key] ?? ({} as T)), ...partial } as T;
  }
  return result;
}

/** Default constants for use in tests. */
export const DEFAULT_SIM_CONSTANTS = resolveConstants();
