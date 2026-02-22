/**
 * Runtime type guards for Prisma boundary values.
 *
 * Prisma stores union-typed fields as plain strings. These guards validate
 * at the DB boundary so downstream code can use the proper union types
 * without unsafe `as` casts.
 */

import type {
  EconomyType,
  GovernmentType,
  QualityTier,
  ShipStatus,
  TradeType,
  TraitId,
  ConvoyStatus,
} from "./game";
import type { ShipTypeId, ShipSize, ShipRole, UpgradeSlotType } from "@/lib/constants/ships";

// ── Lookup sets (built once) ────────────────────────────────────

const ECONOMY_TYPES: ReadonlySet<string> = new Set<EconomyType>([
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
]);

const GOVERNMENT_TYPES: ReadonlySet<string> = new Set<GovernmentType>([
  "federation", "corporate", "authoritarian", "frontier",
]);

const QUALITY_TIERS: ReadonlySet<number> = new Set<QualityTier>([1, 2, 3]);

const TRAIT_IDS: ReadonlySet<string> = new Set<TraitId>([
  // Planetary Bodies
  "habitable_world", "ocean_world", "volcanic_world", "frozen_world",
  "tidally_locked_world", "desert_world", "jungle_world",
  "geothermal_vents", "hydrocarbon_seas", "fertile_lowlands",
  "coral_archipelago", "tectonic_forge",
  // Orbital Features
  "asteroid_belt", "gas_giant", "mineral_rich_moons", "ring_system",
  "binary_star", "lagrange_stations", "captured_rogue_body",
  "deep_space_beacon",
  // Resource Deposits
  "rare_earth_deposits", "heavy_metal_veins", "organic_compounds",
  "crystalline_formations", "helium3_reserves", "exotic_matter_traces",
  "radioactive_deposits", "superdense_core", "glacial_aquifer",
  // Phenomena & Anomalies
  "nebula_proximity", "solar_flare_activity", "gravitational_anomaly",
  "dark_nebula", "precursor_ruins", "subspace_rift", "pulsar_proximity",
  "ion_storm_corridor", "bioluminescent_ecosystem",
  // Infrastructure & Legacy
  "ancient_trade_route", "generation_ship_wreckage", "orbital_ring_remnant",
  "seed_vault", "colonial_capital", "free_port_declaration",
  "shipbreaking_yards",
]);

const SHIP_STATUSES: ReadonlySet<string> = new Set<ShipStatus>([
  "docked", "in_transit",
]);

const TRADE_TYPES: ReadonlySet<string> = new Set<TradeType>([
  "buy", "sell",
]);

const SHIP_TYPE_IDS: ReadonlySet<string> = new Set<ShipTypeId>([
  "shuttle", "light_freighter", "interceptor", "scout_skiff",
  "bulk_freighter", "corvette", "blockade_runner", "survey_vessel",
  "heavy_freighter", "frigate", "stealth_transport", "command_vessel",
]);

const SHIP_SIZES: ReadonlySet<string> = new Set<ShipSize>([
  "small", "medium", "large",
]);

const SHIP_ROLES: ReadonlySet<string> = new Set<ShipRole>([
  "trade", "combat", "scout", "stealth", "support",
]);

const UPGRADE_SLOT_TYPES: ReadonlySet<string> = new Set<UpgradeSlotType>([
  "engine", "cargo", "defence", "systems",
]);

const CONVOY_STATUSES: ReadonlySet<string> = new Set<ConvoyStatus>([
  "docked", "in_transit",
]);

// ── Validated converters ────────────────────────────────────────

export function toEconomyType(value: string): EconomyType {
  if (!ECONOMY_TYPES.has(value)) {
    throw new Error(`Invalid economy type: "${value}"`);
  }
  return value as EconomyType;
}

export function toGovernmentType(value: string): GovernmentType {
  if (!GOVERNMENT_TYPES.has(value)) {
    throw new Error(`Invalid government type: "${value}"`);
  }
  return value as GovernmentType;
}

export function toQualityTier(value: number): QualityTier {
  if (!QUALITY_TIERS.has(value)) {
    throw new Error(`Invalid quality tier: ${value}`);
  }
  return value as QualityTier;
}

export function toTraitId(value: string): TraitId {
  if (!TRAIT_IDS.has(value)) {
    throw new Error(`Invalid trait id: "${value}"`);
  }
  return value as TraitId;
}

export function toShipStatus(value: string): ShipStatus {
  if (!SHIP_STATUSES.has(value)) {
    throw new Error(`Invalid ship status: "${value}"`);
  }
  return value as ShipStatus;
}

export function toTradeType(value: string): TradeType {
  if (!TRADE_TYPES.has(value)) {
    throw new Error(`Invalid trade type: "${value}"`);
  }
  return value as TradeType;
}

export function isShipTypeId(value: string): value is ShipTypeId {
  return SHIP_TYPE_IDS.has(value);
}

export function toShipSize(value: string): ShipSize {
  if (!SHIP_SIZES.has(value)) {
    throw new Error(`Invalid ship size: "${value}"`);
  }
  return value as ShipSize;
}

export function toShipRole(value: string): ShipRole {
  if (!SHIP_ROLES.has(value)) {
    throw new Error(`Invalid ship role: "${value}"`);
  }
  return value as ShipRole;
}

export function toUpgradeSlotType(value: string): UpgradeSlotType {
  if (!UPGRADE_SLOT_TYPES.has(value)) {
    throw new Error(`Invalid upgrade slot type: "${value}"`);
  }
  return value as UpgradeSlotType;
}

export function toConvoyStatus(value: string): ConvoyStatus {
  if (!CONVOY_STATUSES.has(value)) {
    throw new Error(`Invalid convoy status: "${value}"`);
  }
  return value as ConvoyStatus;
}

// ── Constant arrays (avoids Object.keys() + as casts) ───────────

export const ALL_GOVERNMENT_TYPES: readonly GovernmentType[] = [
  "federation", "corporate", "authoritarian", "frontier",
];
