// Shared game types — no Prisma dependency, importable everywhere

import type { ShipSize, ShipRole, UpgradeSlotType } from "@/lib/constants/ships";
import type { ModuleId } from "@/lib/constants/modules";
import type { MissionType, StatGateKey } from "@/lib/constants/missions";
import type { EnemyTier } from "@/lib/constants/combat";
import type { EventTypeId } from "@/lib/constants/events";

export type { ShipSize, ShipRole, UpgradeSlotType };

export type EconomyType =
  | "agricultural"
  | "extraction"
  | "refinery"
  | "industrial"
  | "tech"
  | "core";

// ── System trait types ────────────────────────────────────────────

// The narrative feature traits a system can have. A system's physical makeup
// lives elsewhere: world/body type as bodies (BodyArchetypeId), and per-body
// deposit slots + quality bands drive the available-space substrate.
export type TraitId =
  // Planetary (2)
  | "tidally_locked_world"
  | "geothermal_vents"
  // Orbital (4)
  | "binary_star"
  | "lagrange_stations"
  | "captured_rogue_body"
  | "deep_space_beacon"
  // Resource (2)
  | "crystalline_formations"
  | "exotic_matter_traces"
  // Phenomena & Anomalies (13)
  | "nebula_proximity"
  | "solar_flare_activity"
  | "gravitational_anomaly"
  | "dark_nebula"
  | "precursor_ruins"
  | "subspace_rift"
  | "pulsar_proximity"
  | "ion_storm_corridor"
  | "bioluminescent_ecosystem"
  | "signal_anomaly"
  | "xenobiology_preserve"
  | "ancient_minefield"
  | "pirate_stronghold"
  // Infrastructure & Legacy (10)
  | "ancient_trade_route"
  | "generation_ship_wreckage"
  | "orbital_ring_remnant"
  | "seed_vault"
  | "colonial_capital"
  | "free_port_declaration"
  | "shipbreaking_yards"
  | "derelict_fleet"
  | "abandoned_station"
  | "smuggler_haven";

export type TraitCategory =
  | "planetary"
  | "orbital"
  | "resource"
  | "phenomena"
  | "legacy";

export type QualityTier = 1 | 2 | 3;

// ── Physical substrate ────────────────────────────────────────────

/** The seven locked tier-0 resource types a body's resource base spans. */
export type ResourceType =
  | "gas"
  | "minerals"
  | "ore"
  | "biomass"
  | "arable"
  | "water"
  | "radioactive";

/** Deposit yield multiplier quality bands. */
export type QualityBandId = "poor" | "average" | "good" | "rich";

/** A magnitude per resource type. Used for body resource bases and system aggregates. */
export type ResourceVector = Record<ResourceType, number>;

/** Sun class — gates which body archetypes a system can roll. */
export type SunClass = "blue_white" | "yellow" | "orange_dwarf" | "red_dwarf";

/** Body archetype ids (one per curated world/belt kind). */
export type BodyArchetypeId =
  | "garden_world"
  | "ocean_world"
  | "jungle_world"
  | "arid_world"
  | "volcanic_world"
  | "frozen_world"
  | "barren_rock"
  | "gas_giant"
  | "asteroid_belt";

export type GovernmentType =
  | "federation"
  | "corporate"
  | "authoritarian"
  | "frontier"
  | "cooperative"
  | "technocratic"
  | "militarist"
  | "theocratic";

export type Doctrine =
  | "expansionist"
  | "protectionist"
  | "mercantile"
  | "hegemonic"
  | "opportunistic";

export type FactionStatus = "dominant" | "major" | "regional" | "minor";

export type ReputationStanding =
  | "champion"
  | "trusted"
  | "neutral"
  | "distrusted"
  | "hostile";

export type GoodTier = 0 | 1 | 2;

export type Hazard = "none" | "low" | "high";

export interface RegionInfo {
  id: string;
  name: string;
  dominantEconomy: EconomyType;
  /**
   * Most-represented faction across the region's systems, or null when no
   * systems carry a factionId (defensive — every seeded system has one).
   * Ties broken alphabetically by faction name.
   */
  dominantFactionId: string | null;
  /** Government of the dominant faction; mirrors the legacy per-region field for downstream consumers. */
  dominantGovernmentType: GovernmentType;
  x: number;
  y: number;
}

export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Lightweight system data returned by static tile endpoints (names + economy for map labels). */
export interface StaticTileSystem {
  id: string;
  name: string;
  economyType: EconomyType;
}

// ── Visibility types (fog of war) ────────────────────────────────

export type SystemVisibility = "visible" | "unknown";

/** Dynamic system data — events, danger, and ship presence for visible systems. */
export interface DynamicTileSystem {
  id: string;
  eventTypeIds: EventTypeId[];
  hasPlayerShips: boolean;
  danger: number;
}

export type TradeType = "buy" | "sell";

export type ShipStatus = "docked" | "in_transit";

export interface UpgradeSlotState {
  id: string;
  slotType: UpgradeSlotType;
  slotIndex: number;
  moduleId: ModuleId | null;
  moduleTier: number | null;
}

export interface ShipActiveMission {
  id: string;
  type: MissionType;
  status: OpMissionStatus;
}

export interface ShipState {
  id: string;
  name: string;
  shipType: string;
  size: ShipSize;
  role: ShipRole;
  fuel: number;
  maxFuel: number;
  cargoMax: number;
  speed: number;
  hullMax: number;
  hullCurrent: number;
  shieldMax: number;
  shieldCurrent: number;
  firepower: number;
  evasion: number;
  stealth: number;
  sensors: number;
  crewCapacity: number;
  disabled: boolean;
  cargo: CargoItemState[];
  upgradeSlots: UpgradeSlotState[];
  status: ShipStatus;
  systemId: string;
  system: StarSystemInfo;
  destinationSystemId: string | null;
  destinationSystem: StarSystemInfo | null;
  departureTick: number | null;
  arrivalTick: number | null;
  convoyId: string | null;
  activeMission: ShipActiveMission | null;
}

export type ConvoyStatus = "docked" | "in_transit";

export interface ConvoyState {
  id: string;
  playerId: string;
  name: string | null;
  systemId: string;
  system: StarSystemInfo;
  status: ConvoyStatus;
  destinationSystemId: string | null;
  destinationSystem: StarSystemInfo | null;
  departureTick: number | null;
  arrivalTick: number | null;
  members: ShipState[];
  combinedCargoMax: number;
  combinedCargoUsed: number;
}

export interface FleetState {
  id: string;
  userId: string;
  credits: number;
  ships: ShipState[];
}

export interface GameWorldState {
  currentTick: number;
  tickRate: number;
  startingSystemId: string | null;
}

export interface CargoItemState {
  goodId: string;
  goodName: string;
  quantity: number;
}

export interface SystemTraitInfo {
  traitId: TraitId;
  quality: QualityTier;
}

export interface StarSystemInfo {
  id: string;
  name: string;
  economyType: EconomyType;
  x: number;
  y: number;
  description: string;
  regionId: string;
  /** Owning faction (null only in the transient seed state before factions are assigned). */
  factionId: string | null;
  isGateway: boolean;
  traits?: SystemTraitInfo[];
}

/** Lightweight faction shape returned alongside universe data for client lookup. */
export interface FactionInfo {
  id: string;
  name: string;
  color: string;
  // Nullable so atlas-derived shapes (which only carry id/name/color) can
  // satisfy this type without inventing a stub value. The server-side
  // `/api/game/systems` route always populates this; consumers must handle
  // null when reading factions from the locally-derived universe in star-map.
  governmentType: GovernmentType | null;
}

export interface SystemConnectionInfo {
  id: string;
  fromSystemId: string;
  toSystemId: string;
  fuelCost: number;
}

export interface StationInfo {
  id: string;
  name: string;
  systemId: string;
}

export interface GoodInfo {
  id: string;
  name: string;
  basePrice: number;
  tier: GoodTier;
}

export interface MarketEntry {
  goodId: string;
  goodName: string;
  basePrice: number;
  /** Mid (spot) price — used for trend vs basePrice and price history. */
  currentPrice: number;
  /** Per-unit buy price (mid × (1 + spread)), rounded. */
  buyPrice: number;
  /** Per-unit sell price (mid × (1 − spread)), rounded. */
  sellPrice: number;
  /** Units in stock (floored for display). */
  stock: number;
  // ── Price-curve inputs (so clients can reproduce the server's integrated
  // slippage quote via quoteTrade, e.g. the trade-form total preview). ──
  /** Min price as a multiple of basePrice (the good's floorMult). */
  priceFloor: number;
  /** Max price as a multiple of basePrice (the good's ceilingMult). */
  priceCeiling: number;
  /** Stock level where the mid price equals basePrice. */
  targetStock: number;
  /** Government bid-ask half-spread applied to this station's quotes. */
  spread: number;
}

export interface MarketComparisonEntry {
  systemId: string;
  basePrice: number;
  currentPrice: number;
  /** Units in stock (floored). */
  stock: number;
}

export interface TradeHistoryEntry {
  id: string;
  stationId: string;
  goodId: string;
  goodName: string;
  price: number;
  quantity: number;
  type: TradeType;
  createdAt: string;
}

/** Per-system unrest reading for the stability choropleth overlay. */
export interface StabilityEntry {
  systemId: string;
  unrest: number;
}

export interface UniverseData {
  regions: RegionInfo[];
  systems: StarSystemInfo[];
  connections: SystemConnectionInfo[];
  factions: FactionInfo[];
}

// ── Atlas (lightweight map data) ──────────────────────────────────

export interface AtlasSystem {
  id: string;
  x: number;
  y: number;
  regionId: string;
  /** Owning faction. Null only in the transient seed state before factions are assigned. */
  factionId: string | null;
  economyType: EconomyType;
  isGateway: boolean;
}

/** Lightweight faction row included alongside atlas data for political-map rendering. */
export interface AtlasFaction {
  id: string;
  name: string;
  color: string;
}

export interface AtlasData {
  regions: RegionInfo[];
  systems: AtlasSystem[];
  connections: SystemConnectionInfo[];
  factions: AtlasFaction[];
}

export interface ActiveEvent {
  id: string;
  type: EventTypeId;
  name: string;
  description: string;
  phase: string;
  phaseDisplayName: string;
  effects: string;
  systemId: string | null;
  systemName: string | null;
  regionId: string | null;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
  ticksRemaining: number;
  severity: number;
}

// ── Trade mission types ─────────────────────────────────────────

export interface TradeMissionInfo {
  id: string;
  systemId: string;
  systemName: string;
  destinationId: string;
  destinationName: string;
  goodId: string;
  goodName: string;
  quantity: number;
  reward: number;
  estimatedGoodsValue: number;
  deadlineTick: number;
  ticksRemaining: number;
  hops: number;
  isImport: boolean;
  isExport: boolean;
  eventId: string | null;
  playerId: string | null;
  acceptedAtTick: number | null;
}

// ── Operational mission types ────────────────────────────────────

export type OpMissionStatus = "available" | "accepted" | "in_progress" | "completed" | "failed";

export interface MissionInfo {
  id: string;
  type: MissionType;
  systemId: string;
  systemName: string;
  targetSystemId: string;
  targetSystemName: string;
  reward: number;
  deadlineTick: number;
  ticksRemaining: number;
  durationTicks: number | null;
  enemyTier: EnemyTier | null;
  statRequirements: Partial<Record<StatGateKey, number>>;
  status: OpMissionStatus;
  playerId: string | null;
  shipId: string | null;
  acceptedAtTick: number | null;
  startedAtTick: number | null;
  completedAtTick: number | null;
}

// ── Battle types ────────────────────────────────────────────────

export type BattleStatus =
  | "active"
  | "player_victory"
  | "player_defeat"
  | "player_retreat"
  | "enemy_retreat";

export interface BattleRoundResult {
  round: number;
  playerDamageDealt: number;
  enemyDamageDealt: number;
  playerStrengthAfter: number;
  enemyStrengthAfter: number;
  playerMoraleAfter: number;
  enemyMoraleAfter: number;
}

export interface BattleInfo {
  id: string;
  type: string;
  systemId: string;
  systemName: string;
  missionId: string | null;
  shipId: string | null;
  shipName: string | null;
  status: BattleStatus;
  playerStrength: number;
  playerMorale: number;
  playerMaxStrength: number;
  enemyStrength: number;
  enemyMorale: number;
  enemyMaxStrength: number;
  enemyType: string;
  enemyTier: EnemyTier;
  roundsCompleted: number;
  roundHistory: BattleRoundResult[];
  createdAtTick: number;
  resolvedAtTick: number | null;
}

export interface BattleShipStats {
  hullMax: number;
  hullCurrent: number;
  shieldMax: number;
  shieldCurrent: number;
  firepower: number;
  evasion: number;
}

export interface BattleDetailInfo extends BattleInfo {
  shipStats: BattleShipStats | null;
}

// ── Price history types ─────────────────────────────────────────

export interface PriceSnapshotPoint {
  tick: number;
  price: number;
}

export interface SystemPriceHistory {
  goodId: string;
  goodName: string;
  points: PriceSnapshotPoint[];
}

// ── Notification types ──────────────────────────────────────────

export type NotificationType =
  | "ship_arrived"
  | "ship_damaged"
  | "ship_disabled"
  | "mission_completed"
  | "mission_expired"
  | "battle_round"
  | "battle_won"
  | "battle_lost"
  | "cargo_lost"
  | "hazard_incident"
  | "import_duty"
  | "contraband_seized";

export interface EntityRef {
  id: string;
  label: string;
}

/** Server-persisted notification (returned from API). */
export interface PlayerNotificationInfo {
  id: string;
  type: NotificationType;
  message: string;
  refs: Partial<Record<string, EntityRef>>;
  tick: number;
  read: boolean;
  createdAt: string;
}
