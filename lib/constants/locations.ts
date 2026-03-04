import type { TraitId, QualityTier } from "@/lib/types/game";
import type { EnrichedTrait } from "@/lib/utils/traits";

// ── Location type IDs ───────────────────────────────────────────

export type LocationTypeId =
  // Station (always present)
  | "cantina"
  | "docking_bay"
  | "market_hall"
  | "repair_bay"
  // System (trait-derived)
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
  /** Trait categories that map to this location. Null for station locations. */
  traitRequirement: TraitId[] | null;
}

// ── Derived location (returned by deriveSystemLocations) ────────

export interface DerivedLocation extends LocationDefinition {
  /** Quality tier of the matched trait (highest if multiple match). Null for station locations. */
  quality: QualityTier | null;
  /** Display label for the quality tier. Null for station locations. */
  qualityLabel: string | null;
  /** The enriched description from the matched trait. Null for station locations. */
  traitDescription: string | null;
  /** The trait that matched this location. Null for station locations. */
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
    traitRequirement: null,
  },
  docking_bay: {
    id: "docking_bay",
    name: "Docking Bay",
    category: "station",
    description: "Berths for ships of all sizes. Maintenance crews bustle between hulls.",
    icon: "\uD83D\uDE80",
    available: false,
    traitRequirement: null,
  },
  market_hall: {
    id: "market_hall",
    name: "Market Hall",
    category: "station",
    description: "The station's commercial heart where merchants haggle over bulk contracts.",
    icon: "\uD83C\uDFEA",
    available: false,
    traitRequirement: null,
  },
  repair_bay: {
    id: "repair_bay",
    name: "Repair Bay",
    category: "station",
    description: "Welding sparks and the hiss of hydraulics. Ships come out better than new.",
    icon: "\uD83D\uDD27",
    available: false,
    traitRequirement: null,
  },

  // ── System Locations (trait-derived) ──────────────────────────

  planet_surface: {
    id: "planet_surface",
    name: "Planet Surface",
    category: "system",
    description: "Landfall on the primary world. What you find depends on the terrain.",
    icon: "\uD83C\uDF0D",
    available: false,
    traitRequirement: [
      "habitable_world",
      "ocean_world",
      "volcanic_world",
      "frozen_world",
      "tidally_locked_world",
      "desert_world",
      "jungle_world",
      "fertile_lowlands",
      "coral_archipelago",
    ],
  },
  asteroid_field: {
    id: "asteroid_field",
    name: "Asteroid Field",
    category: "system",
    description: "Dense rock and ice. Prospectors, miners, and the occasional pirate.",
    icon: "\u2604\uFE0F",
    available: false,
    traitRequirement: [
      "asteroid_belt",
      "ring_system",
      "ancient_minefield",
      "captured_rogue_body",
    ],
  },
  gas_harvesting_platform: {
    id: "gas_harvesting_platform",
    name: "Gas Harvesting Platform",
    category: "system",
    description: "Orbital skimmers dip into the giant's atmosphere to collect fuel.",
    icon: "\uD83C\uDF2C\uFE0F",
    available: false,
    traitRequirement: ["gas_giant", "hydrocarbon_seas", "helium3_reserves"],
  },
  orbital_platform: {
    id: "orbital_platform",
    name: "Orbital Platform",
    category: "system",
    description: "A constellation of platforms at stable Lagrange points.",
    icon: "\uD83D\uDEF0\uFE0F",
    available: false,
    traitRequirement: [
      "lagrange_stations",
      "deep_space_beacon",
      "orbital_ring_remnant",
    ],
  },
  mining_outpost: {
    id: "mining_outpost",
    name: "Mining Outpost",
    category: "system",
    description: "Heavy machinery and hard workers extracting riches from the rock.",
    icon: "\u26CF\uFE0F",
    available: false,
    traitRequirement: [
      "mineral_rich_moons",
      "rare_earth_deposits",
      "heavy_metal_veins",
      "crystalline_formations",
      "superdense_core",
      "glacial_aquifer",
      "tectonic_forge",
      "geothermal_vents",
      "radioactive_deposits",
      "organic_compounds",
    ],
  },
  research_station: {
    id: "research_station",
    name: "Research Station",
    category: "system",
    description: "Scientists probe the unknown. Discoveries here reshape what's possible.",
    icon: "\uD83D\uDD2C",
    available: false,
    traitRequirement: [
      "exotic_matter_traces",
      "gravitational_anomaly",
      "signal_anomaly",
      "xenobiology_preserve",
      "bioluminescent_ecosystem",
      "pulsar_proximity",
    ],
  },
  ruins_expedition: {
    id: "ruins_expedition",
    name: "Ruins Expedition",
    category: "system",
    description: "Ancient structures from a civilization lost to time. Handle with care.",
    icon: "\uD83C\uDFDB\uFE0F",
    available: false,
    traitRequirement: ["precursor_ruins", "colonial_capital", "seed_vault"],
  },
  salvage_yard: {
    id: "salvage_yard",
    name: "Salvage Yard",
    category: "system",
    description: "Hulks and debris fields. One pilot's wreckage is another's treasure.",
    icon: "\u2699\uFE0F",
    available: false,
    traitRequirement: [
      "generation_ship_wreckage",
      "derelict_fleet",
      "abandoned_station",
      "shipbreaking_yards",
    ],
  },
  anomaly_site: {
    id: "anomaly_site",
    name: "Anomaly Site",
    category: "system",
    description: "Reality bends here. Sensors glitch and compasses spin.",
    icon: "\uD83C\uDF00",
    available: false,
    traitRequirement: [
      "subspace_rift",
      "nebula_proximity",
      "dark_nebula",
      "ion_storm_corridor",
      "solar_flare_activity",
      "binary_star",
    ],
  },
  smuggler_den: {
    id: "smuggler_den",
    name: "Smuggler's Den",
    category: "system",
    description: "If you know the right people, anything can be arranged.",
    icon: "\uD83D\uDC7E",
    available: false,
    traitRequirement: [
      "pirate_stronghold",
      "smuggler_haven",
      "ancient_trade_route",
      "free_port_declaration",
    ],
  },
};

// ── Helpers ─────────────────────────────────────────────────────

const STATION_LOCATIONS: LocationDefinition[] = Object.values(LOCATIONS).filter(
  (l) => l.category === "station",
);

const SYSTEM_LOCATIONS: LocationDefinition[] = Object.values(LOCATIONS).filter(
  (l) => l.category === "system",
);

/** Build a lookup from TraitId → LocationDefinition for system locations. */
function buildTraitToLocationMap(): Map<TraitId, LocationDefinition> {
  const map = new Map<TraitId, LocationDefinition>();
  for (const loc of SYSTEM_LOCATIONS) {
    if (loc.traitRequirement) {
      for (const traitId of loc.traitRequirement) {
        map.set(traitId, loc);
      }
    }
  }
  return map;
}

const TRAIT_TO_LOCATION = buildTraitToLocationMap();

// ── Derivation engine ───────────────────────────────────────────

/**
 * Derive available locations for a system based on its traits.
 *
 * Returns station locations (always present) + system locations
 * matching the system's traits. Deduplicates: if multiple traits
 * map to the same location, the highest-quality trait wins.
 */
export function deriveSystemLocations(
  traits: EnrichedTrait[],
): DerivedLocation[] {
  // Station locations (always returned)
  const stationResults: DerivedLocation[] = STATION_LOCATIONS.map((loc) => ({
    ...loc,
    quality: null,
    qualityLabel: null,
    traitDescription: null,
    matchedTraitId: null,
  }));

  // System locations — deduplicate by location ID, keep highest quality
  const bestByLocation = new Map<
    LocationTypeId,
    { loc: LocationDefinition; trait: EnrichedTrait }
  >();

  for (const trait of traits) {
    const loc = TRAIT_TO_LOCATION.get(trait.traitId);
    if (!loc) continue;

    const existing = bestByLocation.get(loc.id);
    if (!existing || trait.quality > existing.trait.quality) {
      bestByLocation.set(loc.id, { loc, trait });
    }
  }

  const systemResults: DerivedLocation[] = [...bestByLocation.values()].map(
    ({ loc, trait }) => ({
      ...loc,
      quality: trait.quality,
      qualityLabel: trait.qualityLabel,
      traitDescription: trait.description,
      matchedTraitId: trait.traitId,
    }),
  );

  return [...stationResults, ...systemResults];
}
