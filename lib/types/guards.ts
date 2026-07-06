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
  Doctrine,
  FactionStatus,
  QualityTier,
  ShipStatus,
  TraitId,
  SunClass,
  BodyArchetypeId,
} from "./game";
import type { ShipTypeId, ShipSize, ShipRole } from "@/lib/constants/ships";
import { EVENT_DEFINITIONS, type EventTypeId } from "@/lib/constants/events";
import type { UniverseScale } from "@/lib/constants/universe-gen";
import type { CantinaNpcType } from "@/lib/constants/cantina-npcs";
import { SUN_CLASSES, BODY_ARCHETYPES } from "@/lib/constants/bodies";

// ── Lookup sets (built once) ────────────────────────────────────

const ECONOMY_TYPES: ReadonlySet<string> = new Set<EconomyType>([
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
]);

const GOVERNMENT_TYPES: ReadonlySet<string> = new Set<GovernmentType>([
  "federation", "corporate", "authoritarian", "frontier",
  "cooperative", "technocratic", "militarist", "theocratic",
]);

const DOCTRINES: ReadonlySet<string> = new Set<Doctrine>([
  "expansionist", "protectionist", "mercantile", "hegemonic", "opportunistic",
]);

const FACTION_STATUSES: ReadonlySet<string> = new Set<FactionStatus>([
  "dominant", "major", "regional", "minor",
]);

const QUALITY_TIERS: ReadonlySet<number> = new Set<QualityTier>([1, 2, 3]);

const TRAIT_IDS: ReadonlySet<string> = new Set<TraitId>([
  // Planetary
  "tidally_locked_world", "geothermal_vents",
  // Orbital
  "binary_star", "lagrange_stations", "captured_rogue_body", "deep_space_beacon",
  // Resource
  "crystalline_formations", "exotic_matter_traces",
  // Phenomena & Anomalies
  "nebula_proximity", "solar_flare_activity", "gravitational_anomaly",
  "dark_nebula", "precursor_ruins", "subspace_rift", "pulsar_proximity",
  "ion_storm_corridor", "bioluminescent_ecosystem", "signal_anomaly",
  "xenobiology_preserve", "ancient_minefield", "pirate_stronghold",
  // Infrastructure & Legacy
  "ancient_trade_route", "generation_ship_wreckage", "orbital_ring_remnant",
  "seed_vault", "colonial_capital", "free_port_declaration",
  "shipbreaking_yards", "derelict_fleet", "abandoned_station", "smuggler_haven",
]);

const SHIP_STATUSES: ReadonlySet<string> = new Set<ShipStatus>([
  "docked", "in_transit",
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

export function isGovernmentType(value: string): value is GovernmentType {
  return GOVERNMENT_TYPES.has(value);
}

export function toDoctrine(value: string): Doctrine {
  if (!DOCTRINES.has(value)) {
    throw new Error(`Invalid doctrine: "${value}"`);
  }
  return value as Doctrine;
}

export function isDoctrine(value: string): value is Doctrine {
  return DOCTRINES.has(value);
}

export function toFactionStatus(value: string): FactionStatus {
  if (!FACTION_STATUSES.has(value)) {
    throw new Error(`Invalid faction status: "${value}"`);
  }
  return value as FactionStatus;
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

export function isEventTypeId(value: string): value is EventTypeId {
  return value in EVENT_DEFINITIONS;
}

export function toEventTypeId(value: string): EventTypeId {
  if (!isEventTypeId(value)) {
    throw new Error(`Invalid event type: "${value}"`);
  }
  return value;
}

const UNIVERSE_SCALES: ReadonlySet<string> = new Set<UniverseScale>([
  "default", "10k",
]);

const CANTINA_NPC_TYPES: ReadonlySet<string> = new Set<CantinaNpcType>([
  "bartender", "cautious_trader", "frontier_gambler", "sharp_smuggler", "station_regular",
]);

const SUN_CLASS_IDS: ReadonlySet<string> = new Set(Object.keys(SUN_CLASSES));
const BODY_ARCHETYPE_IDS: ReadonlySet<string> = new Set(Object.keys(BODY_ARCHETYPES));

export function isCantinaNpcType(value: string): value is CantinaNpcType {
  return CANTINA_NPC_TYPES.has(value);
}

export function isSunClass(value: string): value is SunClass {
  return SUN_CLASS_IDS.has(value);
}
export function toSunClass(value: string): SunClass {
  if (!SUN_CLASS_IDS.has(value)) {
    throw new Error(`Invalid sun class: "${value}"`);
  }
  return value as SunClass;
}

export function isBodyArchetypeId(value: string): value is BodyArchetypeId {
  return BODY_ARCHETYPE_IDS.has(value);
}
export function toBodyArchetypeId(value: string): BodyArchetypeId {
  if (!BODY_ARCHETYPE_IDS.has(value)) {
    throw new Error(`Invalid body archetype id: "${value}"`);
  }
  return value as BodyArchetypeId;
}


export function toUniverseScale(value: string): UniverseScale {
  if (!UNIVERSE_SCALES.has(value)) {
    const valid = [...UNIVERSE_SCALES].join(", ");
    throw new Error(`Invalid universe scale: "${value}". Valid values: ${valid}`);
  }
  return value as UniverseScale;
}

// ── Constant arrays (avoids Object.keys() + as casts) ───────────

export const ALL_GOVERNMENT_TYPES: readonly GovernmentType[] = [
  "federation", "corporate", "authoritarian", "frontier",
  "cooperative", "technocratic", "militarist", "theocratic",
];

export const ALL_DOCTRINES: readonly Doctrine[] = [
  "expansionist", "protectionist", "mercantile", "hegemonic", "opportunistic",
];

export const ALL_FACTION_STATUSES: readonly FactionStatus[] = [
  "dominant", "major", "regional", "minor",
];

export const ALL_QUALITY_TIERS: readonly QualityTier[] = [1, 2, 3];

// ── Faction status derivation (hysteresis) ───────────────────────

/**
 * Per faction-system.md §1. Thresholds are expressed as a fraction of the
 * total system pool so a status tier means "controls a meaningful share of
 * the galaxy" rather than "clears an absolute floor". At the default
 * 600-system scale these match the prior 80/40/15/1 absolute values
 * (0.133 × 600 = 80, etc.); at 10k they scale up automatically, so the
 * 1200-system giant is dominant while the 90-system minor is not.
 *
 * Hysteresis prevents flickering at boundaries: a faction that grew into
 * a tier keeps the tier until its share drops below the (smaller) lose
 * threshold.
 */
const FACTION_STATUS_TIERS = [
  { status: "dominant" as const, gainPct: 0.133, losePct: 0.10  },
  { status: "major"    as const, gainPct: 0.066, losePct: 0.041 },
  { status: "regional" as const, gainPct: 0.025, losePct: 0.016 },
  { status: "minor"    as const, gainPct: 0,     losePct: 0     },
];

/**
 * Derive a faction's status from its territory size relative to the total
 * pool of factioned systems, applying hysteresis when the previous status
 * is known. With no previous status, fall back to gain thresholds (used
 * at seed time).
 *
 * A faction with zero systems is destroyed — callers should handle that
 * upstream; this helper returns "minor" for any positive territory.
 */
export function deriveFactionStatus(
  territorySize: number,
  totalSystems: number,
  currentStatus?: FactionStatus,
): FactionStatus {
  if (territorySize <= 0) return "minor";
  if (totalSystems <= 0) return "minor";

  const pct = territorySize / totalSystems;

  // Highest tier the share qualifies for by gain threshold alone.
  // FACTION_STATUS_TIERS is ordered highest-first, so findIndex returns the top match.
  const naturalIdx = FACTION_STATUS_TIERS.findIndex((t) => pct >= t.gainPct);
  const natural: FactionStatus = naturalIdx === -1 ? "minor" : FACTION_STATUS_TIERS[naturalIdx].status;

  if (!currentStatus) return natural;

  // Hysteresis: hold the current tier only if it outranks the natural one
  // AND share is still at or above its lose threshold. Otherwise the
  // natural tier wins (covers both promotion and demotion).
  const currentIdx = FACTION_STATUS_TIERS.findIndex((t) => t.status === currentStatus);
  const currentTier = FACTION_STATUS_TIERS[currentIdx];
  const outranksNatural = naturalIdx === -1 || currentIdx < naturalIdx;
  if (outranksNatural && pct >= currentTier.losePct) return currentStatus;
  return natural;
}


