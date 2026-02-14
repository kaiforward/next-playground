import type { EconomyType, GovernmentType, RegionIdentity } from "@/lib/types/game";

/** Tuneable universe generation parameters. */
export const UNIVERSE_GEN = {
  SEED: 42,
  REGION_COUNT: 8,
  SYSTEMS_PER_REGION: 25,
  MAP_SIZE: 4000,
  REGION_MIN_DISTANCE: 800,
  SYSTEM_SCATTER_RADIUS: 875,
  SYSTEM_MIN_DISTANCE: 158,
  INTRA_REGION_EXTRA_EDGES: 0.5,
  GATEWAY_FUEL_MULTIPLIER: 2.5,
  INTRA_REGION_BASE_FUEL: 8,
  /** Max rejection sampling attempts before falling back to grid-jitter. */
  MAX_PLACEMENT_ATTEMPTS: 500,
} as const;

/** Economic identity for each of the 8 regions (cycling through identities). */
export const REGION_IDENTITIES: RegionIdentity[] = [
  "trade_hub",
  "resource_rich",
  "industrial",
  "tech",
  "agricultural",
  "trade_hub",
  "resource_rich",
  "industrial",
];

/** Thematic name prefixes per region identity. */
export const REGION_NAME_PREFIXES: Record<RegionIdentity, string[]> = {
  trade_hub: ["Nexus", "Haven", "Crossroads", "Confluence"],
  resource_rich: ["Forge", "Quarry", "Vein", "Lode"],
  industrial: ["Foundry", "Crucible", "Anvil", "Mill"],
  tech: ["Circuit", "Cipher", "Vertex", "Prism"],
  agricultural: ["Verdant", "Harvest", "Meadow", "Pastoral"],
};

/** Economy type distribution weights per region identity.
 *  Order: [extraction, agricultural, refinery, industrial, tech, core] */
export const ECONOMY_TYPE_WEIGHTS: Record<RegionIdentity, Record<EconomyType, number>> = {
  resource_rich: { extraction: 30, agricultural: 15, refinery: 15, industrial: 15, tech: 10, core: 15 },
  agricultural:  { extraction: 10, agricultural: 35, refinery: 10, industrial: 15, tech: 15, core: 15 },
  industrial:    { extraction: 10, agricultural: 10, refinery: 20, industrial: 30, tech: 15, core: 15 },
  tech:          { extraction: 10, agricultural: 10, refinery: 10, industrial: 15, tech: 35, core: 20 },
  trade_hub:     { extraction: 10, agricultural: 10, refinery: 10, industrial: 15, tech: 15, core: 40 },
};

/** Government type distribution weights per region identity. */
export const GOVERNMENT_TYPE_WEIGHTS: Record<RegionIdentity, Record<GovernmentType, number>> = {
  resource_rich: { frontier: 40, corporate: 30, federation: 20, authoritarian: 10 },
  tech:          { corporate: 40, federation: 30, authoritarian: 20, frontier: 10 },
  industrial:    { corporate: 30, authoritarian: 30, federation: 25, frontier: 15 },
  agricultural:  { federation: 40, frontier: 25, corporate: 20, authoritarian: 15 },
  trade_hub:     { corporate: 35, federation: 35, frontier: 20, authoritarian: 10 },
};
