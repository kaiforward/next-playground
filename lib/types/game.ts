// Shared game types — no Prisma dependency, importable everywhere

import type { ShipSize, ShipRole } from "@/lib/constants/ships";
import type { EventTypeId } from "@/lib/constants/events";
import type { WorldMeta } from "@/lib/world/types";
import type { Speed } from "@/lib/world/tick-loop";

export type { ShipSize, ShipRole };

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

export type GoodTier = 0 | 1 | 2;

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

/** Dynamic system data — events and danger for visible systems. */
export interface DynamicTileSystem {
  id: string;
  eventTypeIds: EventTypeId[];
  danger: number;
}

export type ShipStatus = "docked" | "in_transit";

export interface GameWorldState {
  meta: WorldMeta;
  speed: Speed;
  achievedTps: number;
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
  /** True when the system is developed (control === 'developed'). Undeveloped
   *  systems have a substrate economy-type label but no open build-gate. Loaded
   *  by the atlas/map path; absent on lighter paths that don't query control. */
  developed?: boolean;
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

/** Per-system unrest reading for the stability choropleth overlay. */
export interface StabilityEntry {
  systemId: string;
  unrest: number;
}

/** Per-system population reading for the population choropleth overlay. */
export interface PopulationEntry {
  systemId: string;
  population: number;
}

/** Per-system ownership reading for the political territory + system markers. Tick-scoped: ownership
 *  changes on the monthly claim/develop pulse, so this rides a tick-invalidated path (not the static atlas). */
export interface OwnershipEntry {
  systemId: string;
  factionId: string | null;
  /** True when the system's control tier is `developed` (an open build-gate / filled marker). */
  developed: boolean;
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
  /** True when the system is developed (control === 'developed'). Undeveloped systems
   *  carry a substrate-derived economy-type label but remain unopened — the map draws
   *  them as a hollow marker. */
  developed: boolean;
}

/** Lightweight faction row included alongside atlas data for political-map rendering. */
export interface AtlasFaction {
  id: string;
  name: string;
  color: string;
}

export interface AtlasData {
  /** World identity + extent — the client derives tile geometry from mapSize. */
  meta: { mapSize: number; systemCount: number; seed: number };
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

