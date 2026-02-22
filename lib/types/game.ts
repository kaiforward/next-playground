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
  // Phenomena & Anomalies (9)
  | "nebula_proximity"
  | "solar_flare_activity"
  | "gravitational_anomaly"
  | "dark_nebula"
  | "precursor_ruins"
  | "subspace_rift"
  | "pulsar_proximity"
  | "ion_storm_corridor"
  | "bioluminescent_ecosystem"
  // Infrastructure & Legacy (7)
  | "ancient_trade_route"
  | "generation_ship_wreckage"
  | "orbital_ring_remnant"
  | "seed_vault"
  | "colonial_capital"
  | "free_port_declaration"
  | "shipbreaking_yards";

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
