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
  RegionTheme,
  ShipStatus,
  TradeType,
  TraitId,
} from "./game";
import type { ShipTypeId } from "@/lib/constants/ships";

// ── Lookup sets (built once) ────────────────────────────────────

const ECONOMY_TYPES: ReadonlySet<string> = new Set<EconomyType>([
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
]);

const GOVERNMENT_TYPES: ReadonlySet<string> = new Set<GovernmentType>([
  "federation", "corporate", "authoritarian", "frontier",
]);

const REGION_THEMES: ReadonlySet<string> = new Set<RegionTheme>([
  "garden_heartland", "mineral_frontier", "industrial_corridor",
  "research_cluster", "energy_belt", "trade_nexus",
  "contested_frontier", "frontier_wilds",
]);

const QUALITY_TIERS: ReadonlySet<number> = new Set<QualityTier>([1, 2, 3]);

const TRAIT_IDS: ReadonlySet<string> = new Set<TraitId>([
  // Planetary Bodies
  "habitable_world", "ocean_world", "volcanic_world", "frozen_world",
  "tidally_locked_world", "desert_world", "jungle_world",
  // Orbital Features
  "asteroid_belt", "gas_giant", "mineral_rich_moons", "ring_system",
  "binary_star", "lagrange_stations", "captured_rogue_body",
  // Resource Deposits
  "rare_earth_deposits", "heavy_metal_veins", "organic_compounds",
  "crystalline_formations", "helium3_reserves", "exotic_matter_traces",
  "radioactive_deposits",
  // Phenomena & Anomalies
  "nebula_proximity", "solar_flare_activity", "gravitational_anomaly",
  "dark_nebula", "precursor_ruins", "subspace_rift", "pulsar_proximity",
  // Infrastructure & Legacy
  "ancient_trade_route", "generation_ship_wreckage", "orbital_ring_remnant",
  "seed_vault",
]);

const SHIP_STATUSES: ReadonlySet<string> = new Set<ShipStatus>([
  "docked", "in_transit",
]);

const TRADE_TYPES: ReadonlySet<string> = new Set<TradeType>([
  "buy", "sell",
]);

const SHIP_TYPE_IDS: ReadonlySet<string> = new Set<ShipTypeId>([
  "shuttle", "freighter",
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

export function toRegionTheme(value: string): RegionTheme {
  if (!REGION_THEMES.has(value)) {
    throw new Error(`Invalid region theme: "${value}"`);
  }
  return value as RegionTheme;
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

// ── Constant arrays (avoids Object.keys() + as casts) ───────────

export const ALL_GOVERNMENT_TYPES: readonly GovernmentType[] = [
  "federation", "corporate", "authoritarian", "frontier",
];

export const ALL_REGION_THEMES: readonly RegionTheme[] = [
  "garden_heartland", "mineral_frontier", "industrial_corridor",
  "research_cluster", "energy_belt", "trade_nexus",
  "contested_frontier", "frontier_wilds",
];
