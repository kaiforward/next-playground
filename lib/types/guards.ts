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
  Hazard,
  NotificationType,
  OpMissionStatus,
  BattleStatus,
  EntityRef,
} from "./game";
import type { ShipTypeId, ShipSize, ShipRole, UpgradeSlotType } from "@/lib/constants/ships";
import { MODULES, type ModuleId } from "@/lib/constants/modules";
import type { MissionType, StatGateKey } from "@/lib/constants/missions";
import type { EnemyTier } from "@/lib/constants/combat";
import { EVENT_DEFINITIONS, type EventTypeId } from "@/lib/constants/events";

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
  "signal_anomaly", "xenobiology_preserve", "ancient_minefield",
  "pirate_stronghold",
  // Infrastructure & Legacy
  "ancient_trade_route", "generation_ship_wreckage", "orbital_ring_remnant",
  "seed_vault", "colonial_capital", "free_port_declaration",
  "shipbreaking_yards", "derelict_fleet", "abandoned_station",
  "smuggler_haven",
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

export function isEconomyType(value: string): value is EconomyType {
  return ECONOMY_TYPES.has(value);
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

// ── Additional guards (modules, missions, combat, notifications) ─

const MODULE_IDS: ReadonlySet<string> = new Set(Object.keys(MODULES));

const MISSION_TYPES: ReadonlySet<string> = new Set<MissionType>([
  "patrol", "survey", "bounty", "salvage", "recon",
]);

const STAT_GATE_KEYS: ReadonlySet<string> = new Set<StatGateKey>([
  "firepower", "sensors", "hullMax", "stealth",
]);

const ENEMY_TIER_VALUES: ReadonlySet<string> = new Set<EnemyTier>([
  "weak", "moderate", "strong",
]);

const HAZARD_VALUES: ReadonlySet<string> = new Set<Hazard>([
  "none", "low", "high",
]);

const NOTIFICATION_TYPES: ReadonlySet<string> = new Set<NotificationType>([
  "ship_arrived", "ship_damaged", "ship_disabled",
  "mission_completed", "mission_expired",
  "battle_round", "battle_won", "battle_lost",
  "cargo_lost", "hazard_incident",
  "import_duty", "contraband_seized",
]);

const OP_MISSION_STATUSES: ReadonlySet<string> = new Set<OpMissionStatus>([
  "available", "accepted", "in_progress", "completed", "failed",
]);

const BATTLE_STATUSES: ReadonlySet<string> = new Set<BattleStatus>([
  "active", "player_victory", "player_defeat", "player_retreat", "enemy_retreat",
]);

export function isModuleId(value: string): value is ModuleId {
  return MODULE_IDS.has(value);
}

export function toModuleId(value: string): ModuleId {
  if (!MODULE_IDS.has(value)) {
    throw new Error(`Invalid module id: "${value}"`);
  }
  return value as ModuleId;
}

export function toMissionType(value: string): MissionType {
  if (!MISSION_TYPES.has(value)) {
    throw new Error(`Invalid mission type: "${value}"`);
  }
  return value as MissionType;
}

export function isMissionType(value: string): value is MissionType {
  return MISSION_TYPES.has(value);
}

export function toStatGateKey(value: string): StatGateKey {
  if (!STAT_GATE_KEYS.has(value)) {
    throw new Error(`Invalid stat gate key: "${value}"`);
  }
  return value as StatGateKey;
}

export function isStatGateKey(value: string): value is StatGateKey {
  return STAT_GATE_KEYS.has(value);
}

export function toEnemyTier(value: string): EnemyTier {
  if (!ENEMY_TIER_VALUES.has(value)) {
    throw new Error(`Invalid enemy tier: "${value}"`);
  }
  return value as EnemyTier;
}

export function isEnemyTier(value: string): value is EnemyTier {
  return ENEMY_TIER_VALUES.has(value);
}

export function toHazard(value: string): Hazard {
  if (!HAZARD_VALUES.has(value)) {
    throw new Error(`Invalid hazard level: "${value}"`);
  }
  return value as Hazard;
}

export function toNotificationType(value: string): NotificationType {
  if (!NOTIFICATION_TYPES.has(value)) {
    throw new Error(`Invalid notification type: "${value}"`);
  }
  return value as NotificationType;
}

export function toOpMissionStatus(value: string): OpMissionStatus {
  if (!OP_MISSION_STATUSES.has(value)) {
    throw new Error(`Invalid op mission status: "${value}"`);
  }
  return value as OpMissionStatus;
}

export function toBattleStatus(value: string): BattleStatus {
  if (!BATTLE_STATUSES.has(value)) {
    throw new Error(`Invalid battle status: "${value}"`);
  }
  return value as BattleStatus;
}

export function toEventTypeId(value: string): EventTypeId {
  if (!(value in EVENT_DEFINITIONS)) {
    throw new Error(`Invalid event type: "${value}"`);
  }
  return value as EventTypeId;
}

// ── Constant arrays (avoids Object.keys() + as casts) ───────────

export const ALL_GOVERNMENT_TYPES: readonly GovernmentType[] = [
  "federation", "corporate", "authoritarian", "frontier",
];

export const ALL_QUALITY_TIERS: readonly QualityTier[] = [1, 2, 3];

// ── Template literal guards ───────────────────────────────────

export function isStatGateMessage(value: string): value is `STAT_GATE:${string}` {
  return value.startsWith("STAT_GATE:");
}

// ── JSON boundary guards ────────────────────────────────────────

/** Parse a JSON stat requirements string into a typed record. Invalid keys/values are dropped. */
export function toStatRequirements(json: string): Partial<Record<StatGateKey, number>> {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return {}; }
  if (typeof parsed !== "object" || parsed === null) return {};
  const result: Partial<Record<StatGateKey, number>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isStatGateKey(key) && typeof value === "number") {
      result[key] = value;
    }
  }
  return result;
}

/** Parse a JSON entity refs string into a typed record. Invalid entries are dropped. */
export function toEntityRefs(json: string): Partial<Record<string, EntityRef>> {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return {}; }
  if (typeof parsed !== "object" || parsed === null) return {};
  const result: Partial<Record<string, EntityRef>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (
      typeof value === "object" && value !== null &&
      "id" in value && typeof value.id === "string" &&
      "label" in value && typeof value.label === "string"
    ) {
      result[key] = { id: value.id, label: value.label };
    }
  }
  return result;
}

