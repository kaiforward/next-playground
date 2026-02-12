import type { EconomyType, RegionIdentity } from "@/lib/types/game";

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
 *  Order: [mining, agricultural, industrial, tech, core] */
export const ECONOMY_TYPE_WEIGHTS: Record<RegionIdentity, Record<EconomyType, number>> = {
  resource_rich: { mining: 40, agricultural: 20, industrial: 20, tech: 10, core: 10 },
  agricultural: { mining: 15, agricultural: 45, industrial: 15, tech: 15, core: 10 },
  industrial: { mining: 20, agricultural: 10, industrial: 40, tech: 20, core: 10 },
  tech: { mining: 10, agricultural: 10, industrial: 20, tech: 45, core: 15 },
  trade_hub: { mining: 15, agricultural: 15, industrial: 20, tech: 15, core: 35 },
};
