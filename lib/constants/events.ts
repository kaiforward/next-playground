import type { EconomyType } from "@/lib/types/game";

// ── Event type union ────────────────────────────────────────────

export type EventTypeId =
  | "war"
  | "plague"
  | "trade_festival"
  | "conflict_spillover"
  | "plague_risk"
  | "mining_boom"
  | "ore_glut"
  | "supply_shortage"
  | "pirate_raid"
  | "solar_storm";

// ── Type interfaces ─────────────────────────────────────────────

export interface ModifierTemplate {
  domain: "economy" | "navigation";
  type: "equilibrium_shift" | "rate_multiplier" | "reversion_dampening";
  target: "system" | "region";
  goodId?: string | null;
  parameter: string; // "supply_target", "demand_target", "production_rate", "consumption_rate", "reversion_rate"
  value: number;     // Absolute for shifts, multiplier for rates/dampening
}

export interface ShockTemplate {
  target: "system";
  goodId: string;
  parameter: "supply" | "demand";
  value: number;  // Delta (positive or negative), scaled by severity
}

export interface SpreadRule {
  eventType: EventTypeId;
  probability: number;  // 0-1, rolled per eligible neighbor
  severity: number;     // Severity multiplier for child events
  targetFilter?: {
    sameRegion?: boolean;
    economyTypes?: EconomyType[];
  };
}

export interface EventPhaseDefinition {
  name: string;
  displayName: string;
  durationRange: [number, number];
  modifiers: ModifierTemplate[];
  notification?: string;
  shocks?: ShockTemplate[];
  spread?: SpreadRule[];
}

export interface EventDefinition {
  type: EventTypeId;
  name: string;
  description: string;
  targetFilter?: {
    economyTypes?: EconomyType[];
  };
  phases: EventPhaseDefinition[];
  cooldown: number;
  maxActive: number;
  weight: number;
}

// ── Spawn / cap constants ───────────────────────────────────────

/** Ticks between spawn attempts. */
export const EVENT_SPAWN_INTERVAL = 20;

/** Max concurrent events at a single system. */
export const MAX_EVENTS_PER_SYSTEM = 2;

/** Max concurrent events globally. */
export const MAX_EVENTS_GLOBAL = 15;

/** Safety caps for aggregated modifier values. */
export const MODIFIER_CAPS = {
  /** Max absolute shift on supply/demand targets (positive or negative). */
  maxShift: 100,
  /** Minimum rate multiplier (never fully zero out production). */
  minMultiplier: 0.1,
  /** Maximum rate multiplier. */
  maxMultiplier: 3.0,
  /** Minimum reversion multiplier (reversion always wins). */
  minReversionMult: 0.2,
} as const;

// ── Event definitions ───────────────────────────────────────────

const war: EventDefinition = {
  type: "war",
  name: "War",
  description: "Military conflict erupts, disrupting production and spiking demand for fuel and machinery.",
  targetFilter: { economyTypes: ["industrial", "tech", "extraction", "core"] },
  cooldown: 80,
  maxActive: 3,
  weight: 10,
  phases: [
    {
      name: "tensions",
      displayName: "Tensions Rising",
      durationRange: [30, 60],
      notification: "Tensions are rising at {systemName}. Fuel and machinery demand increasing.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 20 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 30 },
      ],
    },
    {
      name: "escalation",
      displayName: "Escalation",
      durationRange: [20, 40],
      notification: "Conflict escalates at {systemName}. Production declining.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 50 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 50 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.7 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.05 },
      ],
    },
    {
      name: "active",
      displayName: "Active Conflict",
      durationRange: [80, 150],
      notification: "War rages at {systemName}! Heavy production disruption.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 80 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 60 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.4 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.5 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.15 },
      ],
      spread: [
        { eventType: "conflict_spillover", probability: 0.3, severity: 0.3 },
      ],
    },
    {
      name: "aftermath",
      displayName: "Aftermath",
      durationRange: [50, 100],
      notification: "Fighting subsides at {systemName}. Rebuilding begins — electronics and food in demand.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "electronics", parameter: "demand_target", value: 50 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 40 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.7 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.03 },
      ],
    },
    {
      name: "recovery",
      displayName: "Recovery",
      durationRange: [40, 80],
      notification: "{systemName} is recovering from the conflict.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "electronics", parameter: "demand_target", value: 15 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 12 },
      ],
    },
  ],
};

const plague: EventDefinition = {
  type: "plague",
  name: "Plague",
  description: "A blight sweeps agricultural systems, devastating food production.",
  targetFilter: { economyTypes: ["agricultural"] },
  cooldown: 100,
  maxActive: 2,
  weight: 10,
  phases: [
    {
      name: "outbreak",
      displayName: "Outbreak",
      durationRange: [20, 40],
      notification: "A blight has broken out at {systemName}! Food production plummeting.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.3 },
      ],
      shocks: [
        { target: "system", goodId: "food", parameter: "supply", value: -30 },
      ],
    },
    {
      name: "spreading",
      displayName: "Spreading",
      durationRange: [40, 80],
      notification: "The plague spreads at {systemName}. Medical supplies desperately needed.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.2 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "medicine", parameter: "demand_target", value: 40 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.03 },
      ],
      spread: [
        {
          eventType: "plague_risk",
          probability: 0.4,
          severity: 0.3,
          targetFilter: { sameRegion: true },
        },
      ],
    },
    {
      name: "containment",
      displayName: "Containment",
      durationRange: [30, 60],
      notification: "The plague at {systemName} is being contained.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.5 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "medicine", parameter: "demand_target", value: 20 },
      ],
    },
    {
      name: "recovery",
      displayName: "Recovery",
      durationRange: [40, 60],
      notification: "{systemName} is recovering from the plague.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.8 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.6 },
      ],
    },
  ],
};

const tradeFestival: EventDefinition = {
  type: "trade_festival",
  name: "Trade Festival",
  description: "A grand trade festival boosts demand for luxuries and food.",
  targetFilter: { economyTypes: ["core"] },
  cooldown: 120,
  maxActive: 3,
  weight: 8,
  phases: [
    {
      name: "festival",
      displayName: "Trade Festival",
      durationRange: [40, 80],
      notification: "A trade festival begins at {systemName}! Luxury and food demand surging.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "luxuries", parameter: "demand_target", value: 60 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 30 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "demand_target", value: 15 },
      ],
    },
  ],
};

const conflictSpillover: EventDefinition = {
  type: "conflict_spillover",
  name: "Conflict Spillover",
  description: "Nearby conflict disrupts trade routes, increasing demand for fuel and machinery.",
  cooldown: 80,
  maxActive: 5,
  weight: 0, // Never spawned randomly — only via spread
  phases: [
    {
      name: "spillover",
      displayName: "Conflict Spillover",
      durationRange: [40, 80],
      notification: "Conflict spills over to {systemName}. Fuel and machinery demand rising.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 25 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 20 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.85 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.05 },
      ],
    },
  ],
};

const plagueRisk: EventDefinition = {
  type: "plague_risk",
  name: "Plague Risk",
  description: "A neighboring blight threatens local food production.",
  cooldown: 60,
  maxActive: 5,
  weight: 0, // Never spawned randomly — only via spread
  phases: [
    {
      name: "risk",
      displayName: "Plague Risk",
      durationRange: [30, 60],
      notification: "Plague risk at {systemName}. Food production threatened.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.7 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "medicine", parameter: "demand_target", value: 15 },
      ],
    },
  ],
};

const miningBoom: EventDefinition = {
  type: "mining_boom",
  name: "Mining Boom",
  description: "A rich mineral vein is discovered, flooding the market with ore.",
  targetFilter: { economyTypes: ["extraction"] },
  cooldown: 100,
  maxActive: 2,
  weight: 10,
  phases: [
    {
      name: "discovery",
      displayName: "Discovery",
      durationRange: [20, 30],
      notification: "A rich mineral deposit has been found at {systemName}! Ore production ramping up.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "supply_target", value: 60 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "ore", parameter: "production_rate", value: 1.5 },
      ],
    },
    {
      name: "boom",
      displayName: "Boom",
      durationRange: [60, 100],
      notification: "Mining boom at {systemName}! Ore floods the market, settlers demand food and luxuries.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "supply_target", value: 80 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "ore", parameter: "production_rate", value: 2.0 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 30 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "luxuries", parameter: "demand_target", value: 40 },
      ],
      spread: [
        {
          eventType: "ore_glut",
          probability: 0.3,
          severity: 0.4,
          targetFilter: { sameRegion: true },
        },
      ],
    },
    {
      name: "peak",
      displayName: "Peak Production",
      durationRange: [40, 60],
      notification: "Mining at {systemName} reaches peak output. Food demand surging.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "ore", parameter: "production_rate", value: 1.8 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 50 },
      ],
    },
    {
      name: "depletion",
      displayName: "Depletion",
      durationRange: [60, 100],
      notification: "Mineral deposits at {systemName} running thin. Ore production declining.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "ore", parameter: "production_rate", value: 0.6 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "supply_target", value: -20 },
      ],
    },
  ],
};

const oreGlut: EventDefinition = {
  type: "ore_glut",
  name: "Ore Glut",
  description: "Excess ore from a nearby mining boom depresses local prices.",
  cooldown: 80,
  maxActive: 5,
  weight: 0, // Never spawned randomly — only via spread
  phases: [
    {
      name: "glut",
      displayName: "Ore Glut",
      durationRange: [30, 50],
      notification: "Ore surplus from nearby mining boom depresses prices at {systemName}.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "supply_target", value: 40 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "demand_target", value: -15 },
      ],
    },
  ],
};

const supplyShortage: EventDefinition = {
  type: "supply_shortage",
  name: "Supply Shortage",
  description: "A supply chain disruption causes widespread scarcity.",
  cooldown: 80,
  maxActive: 3,
  weight: 8,
  phases: [
    {
      name: "shortage",
      displayName: "Supply Shortage",
      durationRange: [30, 60],
      notification: "Supply shortage at {systemName}! Prices rising across the board.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "supply_target", value: -25 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "demand_target", value: 25 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.7 },
      ],
      shocks: [
        { target: "system", goodId: "food", parameter: "supply", value: -20 },
        { target: "system", goodId: "fuel", parameter: "supply", value: -20 },
      ],
    },
  ],
};

const pirateRaid: EventDefinition = {
  type: "pirate_raid",
  name: "Pirate Raid",
  description: "Pirates raid local shipping lanes, disrupting supply and threatening navigation.",
  cooldown: 80,
  maxActive: 3,
  weight: 8,
  phases: [
    {
      name: "raiding",
      displayName: "Raiding",
      durationRange: [40, 80],
      notification: "Pirates raid shipping lanes near {systemName}! Navigation hazardous.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "supply_target", value: -15 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "weapons", parameter: "demand_target", value: 30 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.15 },
      ],
    },
    {
      name: "crackdown",
      displayName: "Crackdown",
      durationRange: [20, 40],
      notification: "Crackdown on pirates near {systemName}. Machinery needed for repairs.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 25 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.03 },
      ],
    },
  ],
};

const solarStorm: EventDefinition = {
  type: "solar_storm",
  name: "Solar Storm",
  description: "Intense solar activity disrupts all production and navigation.",
  cooldown: 40,
  maxActive: 2,
  weight: 6,
  phases: [
    {
      name: "storm",
      displayName: "Solar Storm",
      durationRange: [15, 30],
      notification: "Solar storm hits {systemName}! Production halted, navigation extremely dangerous.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.1 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.25 },
      ],
    },
    {
      name: "clearing",
      displayName: "Clearing",
      durationRange: [10, 20],
      notification: "Solar storm at {systemName} subsiding. Production slowly resuming.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.6 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.5 },
      ],
    },
  ],
};

// ── Event → mission theme mapping ──────────────────────────────

export const EVENT_MISSION_GOODS: Record<string, { goods: string[]; isImport: boolean }> = {
  war:             { goods: ["weapons", "fuel", "machinery"], isImport: true },
  plague:          { goods: ["medicine", "food"],             isImport: true },
  trade_festival:  { goods: ["luxuries", "food"],             isImport: true },
  mining_boom:     { goods: ["machinery", "food"],            isImport: true },
  supply_shortage: { goods: ["food", "fuel", "medicine"],     isImport: true },
  pirate_raid:     { goods: ["weapons", "machinery"],         isImport: true },
  solar_storm:     { goods: ["electronics", "fuel"],          isImport: true },
};

/** All registered event definitions, keyed by type. */
const EVENT_DEFINITIONS_INTERNAL = {
  war,
  plague,
  trade_festival: tradeFestival,
  conflict_spillover: conflictSpillover,
  plague_risk: plagueRisk,
  mining_boom: miningBoom,
  ore_glut: oreGlut,
  supply_shortage: supplyShortage,
  pirate_raid: pirateRaid,
  solar_storm: solarStorm,
} as const satisfies Record<EventTypeId, EventDefinition>;

export const EVENT_DEFINITIONS: Record<string, EventDefinition> = EVENT_DEFINITIONS_INTERNAL;
