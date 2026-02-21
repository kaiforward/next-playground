import type { UniverseData } from "@/lib/types/game";

export const MOCK_UNIVERSE: UniverseData = {
  regions: [
    {
      id: "mock-region",
      name: "Mock Region",
      identity: "trade_nexus",
      x: 400,
      y: 300,
    },
  ],
  systems: [
    {
      id: "sol",
      name: "Sol",
      economyType: "core",
      x: 400,
      y: 300,
      description:
        "Humanity's birthplace. A bustling hub of commerce and culture.",
      regionId: "mock-region",
      isGateway: false,
    },
    {
      id: "alpha_centauri",
      name: "Alpha Centauri",
      economyType: "tech",
      x: 600,
      y: 200,
      description:
        "A cutting-edge research colony pushing the boundaries of science.",
      regionId: "mock-region",
      isGateway: false,
    },
    {
      id: "kepler",
      name: "Kepler",
      economyType: "extraction",
      x: 250,
      y: 150,
      description:
        "Rich asteroid belts provide an endless supply of raw ore.",
      regionId: "mock-region",
      isGateway: false,
    },
    {
      id: "vega",
      name: "Vega",
      economyType: "agricultural",
      x: 200,
      y: 350,
      description:
        "Lush terraformed worlds produce food for the sector.",
      regionId: "mock-region",
      isGateway: false,
    },
    {
      id: "sirius",
      name: "Sirius",
      economyType: "industrial",
      x: 550,
      y: 420,
      description:
        "Massive orbital factories churn out fuel and ship components.",
      regionId: "mock-region",
      isGateway: true,
    },
    {
      id: "proxima",
      name: "Proxima",
      economyType: "extraction",
      x: 700,
      y: 350,
      description: "A remote but mineral-rich frontier outpost.",
      regionId: "mock-region",
      isGateway: false,
    },
    {
      id: "arcturus",
      name: "Arcturus",
      economyType: "core",
      x: 350,
      y: 480,
      description:
        "A wealthy trade nexus connecting the outer colonies.",
      regionId: "mock-region",
      isGateway: false,
    },
    {
      id: "barnard",
      name: "Barnard",
      economyType: "agricultural",
      x: 500,
      y: 100,
      description:
        "Quiet farming communities among gentle rolling hills.",
      regionId: "mock-region",
      isGateway: false,
    },
  ],
  connections: [
    // sol <-> alpha_centauri
    { id: "conn-1", fromSystemId: "sol", toSystemId: "alpha_centauri", fuelCost: 10 },
    { id: "conn-2", fromSystemId: "alpha_centauri", toSystemId: "sol", fuelCost: 10 },
    // sol <-> kepler
    { id: "conn-3", fromSystemId: "sol", toSystemId: "kepler", fuelCost: 8 },
    { id: "conn-4", fromSystemId: "kepler", toSystemId: "sol", fuelCost: 8 },
    // sol <-> vega
    { id: "conn-5", fromSystemId: "sol", toSystemId: "vega", fuelCost: 8 },
    { id: "conn-6", fromSystemId: "vega", toSystemId: "sol", fuelCost: 8 },
    // sol <-> sirius
    { id: "conn-7", fromSystemId: "sol", toSystemId: "sirius", fuelCost: 10 },
    { id: "conn-8", fromSystemId: "sirius", toSystemId: "sol", fuelCost: 10 },
    // sol <-> arcturus
    { id: "conn-9", fromSystemId: "sol", toSystemId: "arcturus", fuelCost: 7 },
    { id: "conn-10", fromSystemId: "arcturus", toSystemId: "sol", fuelCost: 7 },
    // alpha_centauri <-> barnard
    { id: "conn-11", fromSystemId: "alpha_centauri", toSystemId: "barnard", fuelCost: 6 },
    { id: "conn-12", fromSystemId: "barnard", toSystemId: "alpha_centauri", fuelCost: 6 },
    // alpha_centauri <-> proxima
    { id: "conn-13", fromSystemId: "alpha_centauri", toSystemId: "proxima", fuelCost: 9 },
    { id: "conn-14", fromSystemId: "proxima", toSystemId: "alpha_centauri", fuelCost: 9 },
    // kepler <-> vega
    { id: "conn-15", fromSystemId: "kepler", toSystemId: "vega", fuelCost: 7 },
    { id: "conn-16", fromSystemId: "vega", toSystemId: "kepler", fuelCost: 7 },
    // kepler <-> barnard
    { id: "conn-17", fromSystemId: "kepler", toSystemId: "barnard", fuelCost: 8 },
    { id: "conn-18", fromSystemId: "barnard", toSystemId: "kepler", fuelCost: 8 },
    // sirius <-> proxima
    { id: "conn-19", fromSystemId: "sirius", toSystemId: "proxima", fuelCost: 7 },
    { id: "conn-20", fromSystemId: "proxima", toSystemId: "sirius", fuelCost: 7 },
    // sirius <-> arcturus
    { id: "conn-21", fromSystemId: "sirius", toSystemId: "arcturus", fuelCost: 8 },
    { id: "conn-22", fromSystemId: "arcturus", toSystemId: "sirius", fuelCost: 8 },
    // arcturus <-> vega
    { id: "conn-23", fromSystemId: "arcturus", toSystemId: "vega", fuelCost: 6 },
    { id: "conn-24", fromSystemId: "vega", toSystemId: "arcturus", fuelCost: 6 },
  ],
};

export const MOCK_PLAYER_SYSTEM_ID = "sol";
