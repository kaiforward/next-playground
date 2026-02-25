// Shared game types — no Prisma dependency, importable everywhere

import type { ShipSize, ShipRole, UpgradeSlotType } from "@/lib/constants/ships";

export type { ShipSize, ShipRole, UpgradeSlotType };

export type EconomyType =
  | "agricultural"
  | "extraction"
  | "refinery"
  | "industrial"
  | "tech"
  | "core";

// ── System trait types ────────────────────────────────────────────

export type TraitId =
  // Planetary Bodies (12)
  | "habitable_world"
  | "ocean_world"
  | "volcanic_world"
  | "frozen_world"
  | "tidally_locked_world"
  | "desert_world"
  | "jungle_world"
  | "geothermal_vents"
  | "hydrocarbon_seas"
  | "fertile_lowlands"
  | "coral_archipelago"
  | "tectonic_forge"
  // Orbital Features (8)
  | "asteroid_belt"
  | "gas_giant"
  | "mineral_rich_moons"
  | "ring_system"
  | "binary_star"
  | "lagrange_stations"
  | "captured_rogue_body"
  | "deep_space_beacon"
  // Resource Deposits (9)
  | "rare_earth_deposits"
  | "heavy_metal_veins"
  | "organic_compounds"
  | "crystalline_formations"
  | "helium3_reserves"
  | "exotic_matter_traces"
  | "radioactive_deposits"
  | "superdense_core"
  | "glacial_aquifer"
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

export type GovernmentType =
  | "federation"
  | "corporate"
  | "authoritarian"
  | "frontier";

export type GoodTier = 0 | 1 | 2;

export type Hazard = "none" | "low" | "high";

export interface RegionInfo {
  id: string;
  name: string;
  dominantEconomy: EconomyType;
  governmentType?: GovernmentType;
  x: number;
  y: number;
}

export type TradeType = "buy" | "sell";

export type ShipStatus = "docked" | "in_transit";

export interface UpgradeSlotState {
  id: string;
  slotType: UpgradeSlotType;
  slotIndex: number;
  moduleId: string | null;
  moduleTier: number | null;
}

export interface ShipActiveMission {
  id: string;
  type: string;
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
  isGateway: boolean;
  traits?: SystemTraitInfo[];
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
  currentPrice: number;
  supply: number;
  demand: number;
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

export interface UniverseData {
  regions: RegionInfo[];
  systems: StarSystemInfo[];
  connections: SystemConnectionInfo[];
}

export interface ActiveEvent {
  id: string;
  type: string;
  name: string;
  phase: string;
  phaseDisplayName: string;
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
  type: string; // "patrol" | "survey" | "bounty"
  systemId: string;
  systemName: string;
  targetSystemId: string;
  targetSystemName: string;
  reward: number;
  deadlineTick: number;
  ticksRemaining: number;
  durationTicks: number | null;
  enemyTier: string | null;
  statRequirements: Record<string, number>;
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
  enemyTier: string;
  roundsCompleted: number;
  roundHistory: BattleRoundResult[];
  createdAtTick: number;
  resolvedAtTick: number | null;
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

export interface EntityRef {
  id: string;
  label: string;
}

export interface GameNotification {
  /** Client-side sequence number, used as React key. */
  id: number;
  message: string;
  type: string;
  refs: Partial<Record<string, EntityRef>>;
  /** Date.now() when received client-side. */
  receivedAt: number;
}
