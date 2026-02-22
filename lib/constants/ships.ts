// ── Ship size and role types ──────────────────────────────────────

export type ShipSize = "small" | "medium" | "large";
export type ShipRole = "trade" | "combat" | "scout" | "stealth" | "support";
export type UpgradeSlotType = "engine" | "cargo" | "defence" | "systems";

export interface SlotLayout {
  engine: number;
  cargo: number;
  defence: number;
  systems: number;
}

export interface ShipTypeDefinition {
  id: ShipTypeId;
  name: string;
  description: string;
  size: ShipSize;
  role: ShipRole;
  fuel: number;
  cargo: number;
  speed: number;
  hullMax: number;
  shieldMax: number;
  firepower: number;
  evasion: number;
  stealth: number;
  sensors: number;
  crewCapacity: number;
  slotLayout: SlotLayout;
  /** Price in credits. 0 = starter only, not purchasable. */
  price: number;
}

export type ShipTypeId =
  | "shuttle"
  | "light_freighter"
  | "interceptor"
  | "scout_skiff"
  | "bulk_freighter"
  | "corvette"
  | "blockade_runner"
  | "survey_vessel"
  | "heavy_freighter"
  | "frigate"
  | "stealth_transport"
  | "command_vessel";

export const SHIP_TYPES: Record<ShipTypeId, ShipTypeDefinition> = {
  // ── Small ships ──────────────────────────────────────────────────

  shuttle: {
    id: "shuttle",
    name: "Shuttle",
    description: "A nimble starter craft with balanced fuel and cargo capacity.",
    size: "small",
    role: "trade",
    fuel: 100,
    cargo: 50,
    speed: 5,
    hullMax: 40,
    shieldMax: 10,
    firepower: 2,
    evasion: 6,
    stealth: 3,
    sensors: 4,
    crewCapacity: 2,
    slotLayout: { engine: 1, cargo: 1, defence: 0, systems: 0 },
    price: 0,
  },

  light_freighter: {
    id: "light_freighter",
    name: "Light Freighter",
    description: "A reliable hauler with expanded cargo bays at the cost of speed.",
    size: "small",
    role: "trade",
    fuel: 90,
    cargo: 80,
    speed: 4,
    hullMax: 50,
    shieldMax: 10,
    firepower: 2,
    evasion: 4,
    stealth: 2,
    sensors: 3,
    crewCapacity: 3,
    slotLayout: { engine: 1, cargo: 1, defence: 0, systems: 0 },
    price: 3000,
  },

  interceptor: {
    id: "interceptor",
    name: "Interceptor",
    description: "A fast strike craft built for hit-and-run engagements.",
    size: "small",
    role: "combat",
    fuel: 80,
    cargo: 15,
    speed: 8,
    hullMax: 35,
    shieldMax: 20,
    firepower: 10,
    evasion: 9,
    stealth: 4,
    sensors: 5,
    crewCapacity: 2,
    slotLayout: { engine: 1, cargo: 0, defence: 1, systems: 0 },
    price: 4000,
  },

  scout_skiff: {
    id: "scout_skiff",
    name: "Scout Skiff",
    description: "A lightweight pathfinder with advanced scanners and impressive agility.",
    size: "small",
    role: "scout",
    fuel: 120,
    cargo: 10,
    speed: 7,
    hullMax: 25,
    shieldMax: 10,
    firepower: 1,
    evasion: 8,
    stealth: 5,
    sensors: 10,
    crewCapacity: 1,
    slotLayout: { engine: 1, cargo: 0, defence: 0, systems: 1 },
    price: 2500,
  },

  // ── Medium ships ─────────────────────────────────────────────────

  bulk_freighter: {
    id: "bulk_freighter",
    name: "Bulk Freighter",
    description: "A workhorse hauler with massive cargo bays but sluggish engines.",
    size: "medium",
    role: "trade",
    fuel: 120,
    cargo: 200,
    speed: 3,
    hullMax: 80,
    shieldMax: 15,
    firepower: 2,
    evasion: 2,
    stealth: 1,
    sensors: 3,
    crewCapacity: 6,
    slotLayout: { engine: 1, cargo: 2, defence: 1, systems: 0 },
    price: 12000,
  },

  corvette: {
    id: "corvette",
    name: "Corvette",
    description: "A balanced combat vessel with enough cargo space for opportunistic trading.",
    size: "medium",
    role: "combat",
    fuel: 100,
    cargo: 40,
    speed: 6,
    hullMax: 70,
    shieldMax: 30,
    firepower: 12,
    evasion: 5,
    stealth: 3,
    sensors: 6,
    crewCapacity: 8,
    slotLayout: { engine: 1, cargo: 0, defence: 2, systems: 1 },
    price: 15000,
  },

  blockade_runner: {
    id: "blockade_runner",
    name: "Blockade Runner",
    description: "A swift smuggler's vessel with stealth plating and hidden compartments.",
    size: "medium",
    role: "stealth",
    fuel: 110,
    cargo: 60,
    speed: 7,
    hullMax: 50,
    shieldMax: 20,
    firepower: 4,
    evasion: 7,
    stealth: 10,
    sensors: 5,
    crewCapacity: 4,
    slotLayout: { engine: 1, cargo: 1, defence: 1, systems: 1 },
    price: 18000,
  },

  survey_vessel: {
    id: "survey_vessel",
    name: "Survey Vessel",
    description: "A versatile support ship outfitted with long-range sensors and modular bays.",
    size: "medium",
    role: "support",
    fuel: 130,
    cargo: 50,
    speed: 5,
    hullMax: 60,
    shieldMax: 20,
    firepower: 3,
    evasion: 4,
    stealth: 3,
    sensors: 12,
    crewCapacity: 6,
    slotLayout: { engine: 1, cargo: 1, defence: 0, systems: 2 },
    price: 10000,
  },

  // ── Large ships ──────────────────────────────────────────────────

  heavy_freighter: {
    id: "heavy_freighter",
    name: "Heavy Freighter",
    description: "A colossal cargo platform that dominates trade lanes but needs escort.",
    size: "large",
    role: "trade",
    fuel: 150,
    cargo: 400,
    speed: 2,
    hullMax: 120,
    shieldMax: 20,
    firepower: 2,
    evasion: 1,
    stealth: 0,
    sensors: 3,
    crewCapacity: 10,
    slotLayout: { engine: 1, cargo: 3, defence: 1, systems: 1 },
    price: 35000,
  },

  frigate: {
    id: "frigate",
    name: "Frigate",
    description: "A heavily armed warship ideal for escorting trade convoys.",
    size: "large",
    role: "combat",
    fuel: 120,
    cargo: 30,
    speed: 4,
    hullMax: 120,
    shieldMax: 50,
    firepower: 18,
    evasion: 3,
    stealth: 1,
    sensors: 7,
    crewCapacity: 15,
    slotLayout: { engine: 1, cargo: 0, defence: 3, systems: 2 },
    price: 45000,
  },

  stealth_transport: {
    id: "stealth_transport",
    name: "Stealth Transport",
    description: "A large cargo vessel with advanced cloaking systems for covert operations.",
    size: "large",
    role: "stealth",
    fuel: 130,
    cargo: 150,
    speed: 4,
    hullMax: 80,
    shieldMax: 25,
    firepower: 3,
    evasion: 4,
    stealth: 12,
    sensors: 6,
    crewCapacity: 8,
    slotLayout: { engine: 1, cargo: 2, defence: 1, systems: 2 },
    price: 40000,
  },

  command_vessel: {
    id: "command_vessel",
    name: "Command Vessel",
    description: "A large multi-role platform with superb sensors and crew facilities.",
    size: "large",
    role: "support",
    fuel: 140,
    cargo: 80,
    speed: 4,
    hullMax: 100,
    shieldMax: 35,
    firepower: 8,
    evasion: 3,
    stealth: 2,
    sensors: 14,
    crewCapacity: 20,
    slotLayout: { engine: 2, cargo: 1, defence: 1, systems: 2 },
    price: 50000,
  },
};

/** Ship types available for purchase at shipyards. */
export const PURCHASABLE_SHIP_TYPES: ShipTypeDefinition[] = Object.values(
  SHIP_TYPES,
).filter((t) => t.price > 0);

/** Reference speed used for travel time calculations — Shuttle's speed. */
export const REFERENCE_SPEED = SHIP_TYPES.shuttle.speed;

/** Total upgrade slots for a ship type. */
export function totalSlots(layout: SlotLayout): number {
  return layout.engine + layout.cargo + layout.defence + layout.systems;
}
