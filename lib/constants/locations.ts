import type { TraitId, QualityTier, BodyArchetypeId } from "@/lib/types/game";
import type { EnrichedTrait } from "@/lib/utils/traits";
import type { BodyView } from "@/lib/types/api";

// ── Location type IDs ───────────────────────────────────────────

export type LocationTypeId =
  // Station (always present)
  | "cantina"
  | "docking_bay"
  | "market_hall"
  | "repair_bay"
  // System (body- and feature-derived)
  | "planet_surface"
  | "asteroid_field"
  | "gas_harvesting_platform"
  | "orbital_platform"
  | "mining_outpost"
  | "research_station"
  | "ruins_expedition"
  | "salvage_yard"
  | "anomaly_site"
  | "smuggler_den";

export type LocationCategory = "station" | "system";

// ── Location definition ─────────────────────────────────────────

export interface LocationDefinition {
  id: LocationTypeId;
  name: string;
  category: LocationCategory;
  description: string;
  icon: string;
  available: boolean;
}

// ── Derived location (returned by deriveSystemLocations) ────────

export interface DerivedLocation extends LocationDefinition {
  /** Quality tier of the matched feature. Null for station + body/richness-derived sites. */
  quality: QualityTier | null;
  /** Display label for the quality tier. Null when quality is null. */
  qualityLabel: string | null;
  /** Enriched description from the matched feature. Null for non-feature sites. */
  traitDescription: string | null;
  /** The feature trait that matched this location. Null for non-feature sites. */
  matchedTraitId: TraitId | null;
}

// ── Location catalog ────────────────────────────────────────────

export const LOCATIONS: Record<LocationTypeId, LocationDefinition> = {
  // ── Orbital Station (always present) ──────────────────────────

  cantina: {
    id: "cantina",
    name: "Station Cantina",
    category: "station",
    description: "A dimly-lit watering hole where traders swap stories and play cards.",
    icon: "\uD83C\uDF7A",
    available: true,
  },
  docking_bay: {
    id: "docking_bay",
    name: "Docking Bay",
    category: "station",
    description: "Berths for ships of all sizes. Maintenance crews bustle between hulls.",
    icon: "\uD83D\uDE80",
    available: false,
  },
  market_hall: {
    id: "market_hall",
    name: "Market Hall",
    category: "station",
    description: "The station's commercial heart where merchants haggle over bulk contracts.",
    icon: "\uD83C\uDFEA",
    available: false,
  },
  repair_bay: {
    id: "repair_bay",
    name: "Repair Bay",
    category: "station",
    description: "Welding sparks and the hiss of hydraulics. Ships come out better than new.",
    icon: "\uD83D\uDD27",
    available: false,
  },

  // ── System Locations (body- and feature-derived) ──────────────

  planet_surface: {
    id: "planet_surface",
    name: "Planet Surface",
    category: "system",
    description: "Landfall on the primary world. What you find depends on the terrain.",
    icon: "\uD83C\uDF0D",
    available: false,
  },
  asteroid_field: {
    id: "asteroid_field",
    name: "Asteroid Field",
    category: "system",
    description: "Dense rock and ice. Prospectors, miners, and the occasional pirate.",
    icon: "\u2604\uFE0F",
    available: false,
  },
  gas_harvesting_platform: {
    id: "gas_harvesting_platform",
    name: "Gas Harvesting Platform",
    category: "system",
    description: "Orbital skimmers dip into the giant's atmosphere to collect fuel.",
    icon: "\uD83C\uDF2C\uFE0F",
    available: false,
  },
  orbital_platform: {
    id: "orbital_platform",
    name: "Orbital Platform",
    category: "system",
    description: "A constellation of platforms at stable Lagrange points.",
    icon: "\uD83D\uDEF0\uFE0F",
    available: false,
  },
  mining_outpost: {
    id: "mining_outpost",
    name: "Mining Outpost",
    category: "system",
    description: "Heavy machinery and hard workers extracting riches from the rock.",
    icon: "\u26CF\uFE0F",
    available: false,
  },
  research_station: {
    id: "research_station",
    name: "Research Station",
    category: "system",
    description: "Scientists probe the unknown. Discoveries here reshape what's possible.",
    icon: "\uD83D\uDD2C",
    available: false,
  },
  ruins_expedition: {
    id: "ruins_expedition",
    name: "Ruins Expedition",
    category: "system",
    description: "Ancient structures from a civilization lost to time. Handle with care.",
    icon: "\uD83C\uDFDB\uFE0F",
    available: false,
  },
  salvage_yard: {
    id: "salvage_yard",
    name: "Salvage Yard",
    category: "system",
    description: "Hulks and debris fields. One pilot's wreckage is another's treasure.",
    icon: "\u2699\uFE0F",
    available: false,
  },
  anomaly_site: {
    id: "anomaly_site",
    name: "Anomaly Site",
    category: "system",
    description: "Reality bends here. Sensors glitch and compasses spin.",
    icon: "\uD83C\uDF00",
    available: false,
  },
  smuggler_den: {
    id: "smuggler_den",
    name: "Smuggler's Den",
    category: "system",
    description: "If you know the right people, anything can be arranged.",
    icon: "\uD83D\uDC7E",
    available: false,
  },
};

// ── Site derivation maps ────────────────────────────────────────
//
// Exploration sites derive from the physical substrate: each body archetype
// opens one site, any richness modifier opens an extraction site, and narrative
// feature traits open their thematic site.

/** Each of the 9 body archetypes surfaces one exploration site. */
const BODY_ARCHETYPE_TO_LOCATION: Record<BodyArchetypeId, LocationTypeId> = {
  garden_world: "planet_surface",
  ocean_world: "planet_surface",
  jungle_world: "planet_surface",
  arid_world: "planet_surface",
  volcanic_world: "planet_surface",
  frozen_world: "planet_surface",
  barren_rock: "planet_surface",
  gas_giant: "gas_harvesting_platform",
  asteroid_belt: "asteroid_field",
};

/** Any richness modifier on a body opens an extraction site. */
const RICHNESS_LOCATION: LocationTypeId = "mining_outpost";

/** Each narrative feature trait maps to its thematic exploration site. */
const FEATURE_TO_LOCATION: Partial<Record<TraitId, LocationTypeId>> = {
  // planetary
  tidally_locked_world: "planet_surface",
  // asteroid
  ancient_minefield: "asteroid_field",
  captured_rogue_body: "asteroid_field",
  // mining
  crystalline_formations: "mining_outpost",
  geothermal_vents: "mining_outpost",
  // orbital
  lagrange_stations: "orbital_platform",
  deep_space_beacon: "orbital_platform",
  orbital_ring_remnant: "orbital_platform",
  // research
  exotic_matter_traces: "research_station",
  gravitational_anomaly: "research_station",
  signal_anomaly: "research_station",
  xenobiology_preserve: "research_station",
  bioluminescent_ecosystem: "research_station",
  pulsar_proximity: "research_station",
  // ruins
  precursor_ruins: "ruins_expedition",
  colonial_capital: "ruins_expedition",
  seed_vault: "ruins_expedition",
  // salvage
  generation_ship_wreckage: "salvage_yard",
  derelict_fleet: "salvage_yard",
  abandoned_station: "salvage_yard",
  shipbreaking_yards: "salvage_yard",
  // anomaly
  subspace_rift: "anomaly_site",
  nebula_proximity: "anomaly_site",
  dark_nebula: "anomaly_site",
  ion_storm_corridor: "anomaly_site",
  solar_flare_activity: "anomaly_site",
  binary_star: "anomaly_site",
  // smuggler
  pirate_stronghold: "smuggler_den",
  smuggler_haven: "smuggler_den",
  ancient_trade_route: "smuggler_den",
  free_port_declaration: "smuggler_den",
};

// ── Helpers ─────────────────────────────────────────────────────

const STATION_LOCATIONS: LocationDefinition[] = Object.values(LOCATIONS).filter(
  (l) => l.category === "station",
);

/** A site with no quality tier — bodies and richness modifiers carry no tier. */
function bodyDerived(locId: LocationTypeId): DerivedLocation {
  return {
    ...LOCATIONS[locId],
    quality: null,
    qualityLabel: null,
    traitDescription: null,
    matchedTraitId: null,
  };
}

// ── Derivation engine ───────────────────────────────────────────

/**
 * Derive available locations for a system from its bodies + feature traits.
 *
 * Returns station locations (always present) + system locations from the
 * substrate: body archetypes, richness modifiers, and feature traits.
 * Deduplicates by location id — a quality-bearing feature outranks a
 * body/richness-derived site of the same type, the highest-quality feature
 * wins among features, and ties keep the first seen.
 */
export function deriveSystemLocations(
  bodies: BodyView[],
  features: EnrichedTrait[],
): DerivedLocation[] {
  const stationResults: DerivedLocation[] = STATION_LOCATIONS.map((loc) => ({
    ...loc,
    quality: null,
    qualityLabel: null,
    traitDescription: null,
    matchedTraitId: null,
  }));

  const bestByLocation = new Map<LocationTypeId, DerivedLocation>();

  const consider = (candidate: DerivedLocation) => {
    const existing = bestByLocation.get(candidate.id);
    if (!existing || (candidate.quality ?? 0) > (existing.quality ?? 0)) {
      bestByLocation.set(candidate.id, candidate);
    }
  };

  // Bodies → archetype site + (when enriched) an extraction site. No quality tier.
  for (const body of bodies) {
    consider(bodyDerived(BODY_ARCHETYPE_TO_LOCATION[body.bodyType]));
    if (body.richness.length > 0) {
      consider(bodyDerived(RICHNESS_LOCATION));
    }
  }

  // Features → thematic site, carrying the feature's quality + description.
  for (const feature of features) {
    const locId = FEATURE_TO_LOCATION[feature.traitId];
    if (!locId) continue;
    consider({
      ...LOCATIONS[locId],
      quality: feature.quality,
      qualityLabel: feature.qualityLabel,
      traitDescription: feature.description,
      matchedTraitId: feature.traitId,
    });
  }

  return [...stationResults, ...bestByLocation.values()];
}
