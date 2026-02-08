import type { EconomyType } from "@/lib/types/game";

export interface SystemDefinition {
  name: string;
  economyType: EconomyType;
  x: number;
  y: number;
  description: string;
  stationName: string;
}

// Production/consumption rules per economy type
export const ECONOMY_PRODUCTION: Record<EconomyType, string[]> = {
  agricultural: ["food"],
  mining: ["ore"],
  industrial: ["fuel", "ship_parts"],
  tech: ["electronics"],
  core: ["luxuries"],
};

export const ECONOMY_CONSUMPTION: Record<EconomyType, string[]> = {
  agricultural: ["electronics"],
  mining: ["food"],
  industrial: ["ore"],
  tech: ["ore", "ship_parts"],
  core: ["food", "ore", "fuel", "electronics", "ship_parts"],
};

export const SYSTEMS: Record<string, SystemDefinition> = {
  sol: {
    name: "Sol",
    economyType: "core",
    x: 400,
    y: 300,
    description: "Humanity's birthplace. A bustling hub of commerce and culture.",
    stationName: "Earth Station",
  },
  alpha_centauri: {
    name: "Alpha Centauri",
    economyType: "tech",
    x: 600,
    y: 200,
    description: "A cutting-edge research colony pushing the boundaries of science.",
    stationName: "Centauri Labs",
  },
  kepler: {
    name: "Kepler",
    economyType: "mining",
    x: 250,
    y: 150,
    description: "Rich asteroid belts provide an endless supply of raw ore.",
    stationName: "Kepler Depot",
  },
  vega: {
    name: "Vega",
    economyType: "agricultural",
    x: 200,
    y: 350,
    description: "Lush terraformed worlds produce food for the sector.",
    stationName: "Vega Farms",
  },
  sirius: {
    name: "Sirius",
    economyType: "industrial",
    x: 550,
    y: 420,
    description: "Massive orbital factories churn out fuel and ship components.",
    stationName: "Sirius Forge",
  },
  proxima: {
    name: "Proxima",
    economyType: "mining",
    x: 700,
    y: 350,
    description: "A remote but mineral-rich frontier outpost.",
    stationName: "Proxima Mine",
  },
  arcturus: {
    name: "Arcturus",
    economyType: "core",
    x: 350,
    y: 480,
    description: "A wealthy trade nexus connecting the outer colonies.",
    stationName: "Arcturus Hub",
  },
  barnard: {
    name: "Barnard",
    economyType: "agricultural",
    x: 500,
    y: 100,
    description: "Quiet farming communities among gentle rolling hills.",
    stationName: "Barnard Homestead",
  },
};

// Connections are bidirectional — seed script creates both directions
export const CONNECTIONS: [string, string, number][] = [
  ["sol", "alpha_centauri", 10],
  ["sol", "kepler", 8],
  ["sol", "vega", 8],
  ["sol", "sirius", 10],
  ["sol", "arcturus", 7],
  ["alpha_centauri", "barnard", 6],
  ["alpha_centauri", "proxima", 9],
  ["kepler", "vega", 7],
  ["kepler", "barnard", 8],
  ["sirius", "proxima", 7],
  ["sirius", "arcturus", 8],
  ["arcturus", "vega", 6],
];

export const STARTING_SYSTEM = "sol";
