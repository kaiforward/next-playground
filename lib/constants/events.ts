import type { EconomyType } from "@/lib/types/game";
import { summarizePhaseEffects } from "@/lib/utils/event-effects";

// ── Event type union ────────────────────────────────────────────

export type EventTypeId =
  | "inner_system_conflict"
  | "plague"
  | "trade_festival"
  | "conflict_spillover"
  | "plague_risk"
  | "mining_boom"
  | "ore_glut"
  | "supply_shortage"
  | "pirate_raid"
  | "solar_storm"
  | "refugee_crisis"
  | "trade_embargo"
  | "tech_breakthrough"
  | "asteroid_strike";

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
  value: number;  // Absolute delta or percentage fraction, scaled by severity
  /** "absolute" = raw delta (default), "percentage" = fraction of current value (e.g. -0.3 = -30%). */
  mode?: "absolute" | "percentage";
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
export const EVENT_SPAWN_INTERVAL = 5;

/** Max concurrent events at a single system. */
export const MAX_EVENTS_PER_SYSTEM = 3;

/**
 * Base max concurrent events globally (for 600 systems).
 * Actual cap is derived at runtime: TOTAL_SYSTEMS * EVENT_COVERAGE_TARGET.
 */
export const MAX_EVENTS_GLOBAL = 150;

/** Target fraction of systems with active events. Used to scale caps by universe size. */
export const EVENT_COVERAGE_TARGET = 0.25;

/** Safety caps for aggregated modifier values. */
export const MODIFIER_CAPS = {
  /** Minimum equilibrium target multiplier (never fully zero out targets). */
  minTargetMult: 0.1,
  /** Maximum equilibrium target multiplier. */
  maxTargetMult: 4.0,
  /** Minimum rate multiplier (never fully zero out production). */
  minMultiplier: 0.1,
  /** Maximum rate multiplier. */
  maxMultiplier: 3.0,
  /** Minimum reversion multiplier (reversion always wins). */
  minReversionMult: 0.2,
} as const;

// ── Event definitions ───────────────────────────────────────────
// NOTE: equilibrium_shift values are MULTIPLIERS (1.0 = no change, 2.0 = double target, 0.5 = halve).
// danger_level values remain additive (directly added to base danger).

const innerSystemConflict: EventDefinition = {
  type: "inner_system_conflict",
  name: "Inner System Conflict",
  description: "Military conflict erupts, disrupting production and spiking demand for fuel and machinery.",
  targetFilter: { economyTypes: ["industrial", "tech", "extraction", "core"] },
  cooldown: 80,
  maxActive: 30,
  weight: 10,
  phases: [
    {
      name: "tensions",
      displayName: "Tensions Rising",
      durationRange: [30, 60],
      notification: "Tensions are rising at {systemName}. Fuel and machinery demand increasing.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 1.4 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 1.5 },
      ],
    },
    {
      name: "escalation",
      displayName: "Escalation",
      durationRange: [20, 40],
      notification: "Conflict escalates at {systemName}. Production declining.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 1.8 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 1.8 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.5 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.08 },
      ],
    },
    {
      name: "active",
      displayName: "Active Conflict",
      durationRange: [80, 150],
      notification: "Conflict rages at {systemName}! Heavy production disruption.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 2.5 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 2.0 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.2 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.3 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.2 },
      ],
      shocks: [
        { target: "system", goodId: "fuel", parameter: "supply", value: -0.3, mode: "percentage" },
        { target: "system", goodId: "machinery", parameter: "supply", value: -0.2, mode: "percentage" },
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
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "electronics", parameter: "demand_target", value: 1.8 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 1.6 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.5 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.05 },
      ],
    },
    {
      name: "recovery",
      displayName: "Recovery",
      durationRange: [40, 80],
      notification: "{systemName} is recovering from the conflict.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "electronics", parameter: "demand_target", value: 1.2 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 1.15 },
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
  maxActive: 20,
  weight: 10,
  phases: [
    {
      name: "outbreak",
      displayName: "Outbreak",
      durationRange: [20, 40],
      notification: "A blight has broken out at {systemName}! Food production plummeting.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.15 },
      ],
      shocks: [
        { target: "system", goodId: "food", parameter: "supply", value: -0.8, mode: "percentage" },
      ],
    },
    {
      name: "spreading",
      displayName: "Spreading",
      durationRange: [40, 80],
      notification: "The plague spreads at {systemName}. Medical supplies desperately needed.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.1 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "medicine", parameter: "demand_target", value: 2.0 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.05 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.5 },
      ],
      shocks: [
        { target: "system", goodId: "food", parameter: "supply", value: -0.5, mode: "percentage" },
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
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.4 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "medicine", parameter: "demand_target", value: 1.6 },
      ],
    },
    {
      name: "recovery",
      displayName: "Recovery",
      durationRange: [40, 60],
      notification: "{systemName} is recovering from the plague.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.7 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.5 },
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
  maxActive: 30,
  weight: 8,
  phases: [
    {
      name: "festival",
      displayName: "Trade Festival",
      durationRange: [40, 80],
      notification: "A trade festival begins at {systemName}! Luxury and food demand surging.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "luxuries", parameter: "demand_target", value: 2.0 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 1.4 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "demand_target", value: 1.2 },
      ],
    },
  ],
};

const conflictSpillover: EventDefinition = {
  type: "conflict_spillover",
  name: "Conflict Spillover",
  description: "Nearby conflict disrupts trade routes, increasing demand for fuel and machinery.",
  cooldown: 80,
  maxActive: 50,
  weight: 0, // Never spawned randomly — only via spread
  phases: [
    {
      name: "spillover",
      displayName: "Conflict Spillover",
      durationRange: [40, 80],
      notification: "Conflict spills over to {systemName}. Fuel and machinery demand rising.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 1.4 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 1.3 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.8 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.08 },
      ],
    },
  ],
};

const plagueRisk: EventDefinition = {
  type: "plague_risk",
  name: "Plague Risk",
  description: "A neighboring blight threatens local food production.",
  cooldown: 60,
  maxActive: 50,
  weight: 0, // Never spawned randomly — only via spread
  phases: [
    {
      name: "risk",
      displayName: "Plague Risk",
      durationRange: [30, 60],
      notification: "Plague risk at {systemName}. Food production threatened.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "food", parameter: "production_rate", value: 0.6 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "medicine", parameter: "demand_target", value: 1.3 },
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
  maxActive: 20,
  weight: 10,
  phases: [
    {
      name: "discovery",
      displayName: "Discovery",
      durationRange: [20, 30],
      notification: "A rich mineral deposit has been found at {systemName}! Ore production ramping up.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "supply_target", value: 1.8 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "ore", parameter: "production_rate", value: 1.5 },
      ],
    },
    {
      name: "boom",
      displayName: "Boom",
      durationRange: [60, 100],
      notification: "Mining boom at {systemName}! Ore floods the market, settlers demand food and luxuries.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "supply_target", value: 2.5 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "ore", parameter: "production_rate", value: 2.0 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 1.4 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "luxuries", parameter: "demand_target", value: 1.5 },
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
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 1.6 },
      ],
    },
    {
      name: "depletion",
      displayName: "Depletion",
      durationRange: [60, 100],
      notification: "Mineral deposits at {systemName} running thin. Ore production declining.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "ore", parameter: "production_rate", value: 0.5 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "supply_target", value: 0.7 },
      ],
    },
  ],
};

const oreGlut: EventDefinition = {
  type: "ore_glut",
  name: "Ore Glut",
  description: "Excess ore from a nearby mining boom depresses local prices.",
  cooldown: 80,
  maxActive: 50,
  weight: 0, // Never spawned randomly — only via spread
  phases: [
    {
      name: "glut",
      displayName: "Ore Glut",
      durationRange: [30, 50],
      notification: "Ore surplus from nearby mining boom depresses prices at {systemName}.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "supply_target", value: 1.6 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ore", parameter: "demand_target", value: 0.8 },
      ],
    },
  ],
};

const supplyShortage: EventDefinition = {
  type: "supply_shortage",
  name: "Supply Shortage",
  description: "A supply chain disruption causes widespread scarcity.",
  cooldown: 80,
  maxActive: 30,
  weight: 8,
  phases: [
    {
      name: "shortage",
      displayName: "Supply Shortage",
      durationRange: [30, 60],
      notification: "Supply shortage at {systemName}! Prices rising across the board.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "supply_target", value: 0.5 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "demand_target", value: 1.5 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.5 },
      ],
      shocks: [
        { target: "system", goodId: "food", parameter: "supply", value: -0.5, mode: "percentage" },
        { target: "system", goodId: "fuel", parameter: "supply", value: -0.5, mode: "percentage" },
      ],
    },
  ],
};

const pirateRaid: EventDefinition = {
  type: "pirate_raid",
  name: "Pirate Raid",
  description: "Pirates raid local shipping lanes, disrupting supply and threatening navigation.",
  cooldown: 80,
  maxActive: 30,
  weight: 8,
  phases: [
    {
      name: "raiding",
      displayName: "Raiding",
      durationRange: [40, 80],
      notification: "Pirates raid shipping lanes near {systemName}! Navigation hazardous.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "supply_target", value: 0.6 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "weapons", parameter: "demand_target", value: 2.0 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.2 },
      ],
      shocks: [
        { target: "system", goodId: "electronics", parameter: "supply", value: -0.25, mode: "percentage" },
      ],
    },
    {
      name: "crackdown",
      displayName: "Crackdown",
      durationRange: [20, 40],
      notification: "Crackdown on pirates near {systemName}. Machinery needed for repairs.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 1.6 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.05 },
      ],
    },
  ],
};

const solarStorm: EventDefinition = {
  type: "solar_storm",
  name: "Solar Storm",
  description: "Intense solar activity disrupts all production and navigation.",
  cooldown: 40,
  maxActive: 20,
  weight: 6,
  phases: [
    {
      name: "storm",
      displayName: "Solar Storm",
      durationRange: [15, 30],
      notification: "Solar storm hits {systemName}! Production halted, navigation extremely dangerous.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.05 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.3 },
      ],
      shocks: [
        { target: "system", goodId: "electronics", parameter: "supply", value: -0.5, mode: "percentage" },
      ],
    },
    {
      name: "clearing",
      displayName: "Clearing",
      durationRange: [10, 20],
      notification: "Solar storm at {systemName} subsiding. Production slowly resuming.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.3 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.3 },
      ],
    },
  ],
};

// ── Phase 3: New event types ────────────────────────────────────

const refugeeCrisis: EventDefinition = {
  type: "refugee_crisis",
  name: "Refugee Crisis",
  description: "Mass displacement strains food and medical supplies as settlers flood into the system.",
  targetFilter: { economyTypes: ["core", "agricultural"] },
  cooldown: 100,
  maxActive: 25,
  weight: 8,
  phases: [
    {
      name: "influx",
      displayName: "Influx",
      durationRange: [20, 40],
      notification: "Refugees flood into {systemName}. Food and medicine in high demand.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 1.6 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "medicine", parameter: "demand_target", value: 1.4 },
      ],
      shocks: [
        { target: "system", goodId: "food", parameter: "supply", value: -0.3, mode: "percentage" },
      ],
    },
    {
      name: "overcrowding",
      displayName: "Overcrowding",
      durationRange: [40, 80],
      notification: "Overcrowding at {systemName}. Food and medicine critically short.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 2.0 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "medicine", parameter: "demand_target", value: 1.8 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.7 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.08 },
      ],
      spread: [
        {
          eventType: "plague_risk",
          probability: 0.3,
          severity: 0.25,
          targetFilter: { sameRegion: true, economyTypes: ["agricultural"] },
        },
      ],
    },
    {
      name: "settlement",
      displayName: "Settlement",
      durationRange: [30, 60],
      notification: "Refugees at {systemName} beginning to settle. Demand easing.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "food", parameter: "demand_target", value: 1.3 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "medicine", parameter: "demand_target", value: 1.15 },
      ],
    },
  ],
};

const tradeEmbargo: EventDefinition = {
  type: "trade_embargo",
  name: "Trade Embargo",
  description: "Political tensions cut off trade routes, creating severe shortages.",
  targetFilter: { economyTypes: ["core", "industrial"] },
  cooldown: 120,
  maxActive: 15,
  weight: 6,
  phases: [
    {
      name: "imposed",
      displayName: "Imposed",
      durationRange: [20, 40],
      notification: "Trade embargo imposed at {systemName}! Supply lines severed.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "supply_target", value: 0.6 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "demand_target", value: 1.4 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.7 },
      ],
    },
    {
      name: "enforcement",
      displayName: "Enforcement",
      durationRange: [40, 80],
      notification: "Embargo enforcement tightens at {systemName}. Shortages worsen.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "supply_target", value: 0.4 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "demand_target", value: 1.7 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.5 },
        { domain: "economy", type: "reversion_dampening", target: "system", goodId: null, parameter: "reversion_rate", value: 0.4 },
      ],
      shocks: [
        { target: "system", goodId: "electronics", parameter: "supply", value: -0.5, mode: "percentage" },
        { target: "system", goodId: "machinery", parameter: "supply", value: -0.5, mode: "percentage" },
      ],
    },
    {
      name: "easing",
      displayName: "Easing",
      durationRange: [30, 60],
      notification: "Embargo at {systemName} is being eased. Trade resuming slowly.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "supply_target", value: 0.8 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: null, parameter: "demand_target", value: 1.2 },
      ],
    },
  ],
};

const techBreakthrough: EventDefinition = {
  type: "tech_breakthrough",
  name: "Tech Breakthrough",
  description: "A technological innovation boosts electronics production and drives machinery demand.",
  targetFilter: { economyTypes: ["tech"] },
  cooldown: 120,
  maxActive: 15,
  weight: 7,
  phases: [
    {
      name: "discovery",
      displayName: "Discovery",
      durationRange: [15, 30],
      notification: "Breakthrough research at {systemName}! Electronics production surging.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "electronics", parameter: "production_rate", value: 1.5 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 1.4 },
      ],
    },
    {
      name: "innovation",
      displayName: "Innovation",
      durationRange: [40, 80],
      notification: "Innovation wave at {systemName}. Electronics output at record levels.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "electronics", parameter: "production_rate", value: 2.5 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "electronics", parameter: "supply_target", value: 1.8 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 1.8 },
      ],
    },
    {
      name: "adoption",
      displayName: "Adoption",
      durationRange: [30, 60],
      notification: "New technology from {systemName} spreading across the sector.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: "electronics", parameter: "production_rate", value: 1.5 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "electronics", parameter: "supply_target", value: 1.3 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 1.2 },
      ],
    },
  ],
};

const asteroidStrike: EventDefinition = {
  type: "asteroid_strike",
  name: "Asteroid Strike",
  description: "An asteroid impact devastates extraction infrastructure.",
  targetFilter: { economyTypes: ["extraction"] },
  cooldown: 80,
  maxActive: 15,
  weight: 5,
  phases: [
    {
      name: "impact",
      displayName: "Impact",
      durationRange: [10, 20],
      notification: "Asteroid strike at {systemName}! Production halted, massive damage.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.05 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.25 },
      ],
      shocks: [
        { target: "system", goodId: "ore", parameter: "supply", value: -0.7, mode: "percentage" },
        { target: "system", goodId: "fuel", parameter: "supply", value: -0.5, mode: "percentage" },
      ],
    },
    {
      name: "aftermath",
      displayName: "Aftermath",
      durationRange: [40, 80],
      notification: "Aftermath of asteroid strike at {systemName}. Rebuilding underway.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.3 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "machinery", parameter: "demand_target", value: 1.8 },
      ],
    },
    {
      name: "recovery",
      displayName: "Recovery",
      durationRange: [30, 60],
      notification: "{systemName} recovering from asteroid impact.",
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.7 },
      ],
    },
  ],
};

// ── Event → mission theme mapping ──────────────────────────────

export const EVENT_MISSION_GOODS: Partial<Record<EventTypeId, { goods: string[]; isImport: boolean }>> = {
  inner_system_conflict: { goods: ["weapons", "fuel", "machinery"], isImport: true },
  plague:                { goods: ["medicine", "food"],              isImport: true },
  trade_festival:        { goods: ["luxuries", "food"],              isImport: true },
  mining_boom:           { goods: ["machinery", "food"],             isImport: true },
  supply_shortage:       { goods: ["food", "fuel", "medicine"],      isImport: true },
  pirate_raid:           { goods: ["weapons", "machinery"],          isImport: true },
  solar_storm:           { goods: ["electronics", "fuel"],           isImport: true },
  refugee_crisis:        { goods: ["food", "medicine"],              isImport: true },
  trade_embargo:         { goods: ["electronics", "machinery", "food"], isImport: true },
  tech_breakthrough:     { goods: ["machinery", "electronics"],      isImport: true },
  asteroid_strike:       { goods: ["machinery", "ore", "fuel"],      isImport: true },
};

// ── Event → operational mission mapping ─────────────────────────

import type { MissionType } from "./missions";

export interface EventOpMissionConfig {
  /** Mission types this event can spawn. */
  types: MissionType[];
  /** Base probability of spawning per mission type (scaled by severity). */
  spawnProbability: number;
  /** Multiplier on base reward for event-spawned missions. */
  rewardMult: number;
}

export const EVENT_OP_MISSIONS: Partial<Record<EventTypeId, EventOpMissionConfig>> = {
  inner_system_conflict: { types: ["patrol", "bounty"],   spawnProbability: 0.6, rewardMult: 1.5 },
  pirate_raid:           { types: ["patrol", "bounty"],   spawnProbability: 0.7, rewardMult: 1.3 },
  conflict_spillover:    { types: ["patrol"],             spawnProbability: 0.3, rewardMult: 1.2 },
  solar_storm:           { types: ["salvage"],            spawnProbability: 0.4, rewardMult: 1.2 },
  supply_shortage:       { types: ["patrol"],             spawnProbability: 0.2, rewardMult: 1.1 },
  refugee_crisis:        { types: ["patrol"],             spawnProbability: 0.5, rewardMult: 1.3 },
  trade_embargo:         { types: ["recon"],              spawnProbability: 0.3, rewardMult: 1.2 },
  asteroid_strike:       { types: ["salvage", "recon"],   spawnProbability: 0.6, rewardMult: 1.4 },
};

/** All registered event definitions, keyed by type. */
const EVENT_DEFINITIONS_INTERNAL = {
  inner_system_conflict: innerSystemConflict,
  plague,
  trade_festival: tradeFestival,
  conflict_spillover: conflictSpillover,
  plague_risk: plagueRisk,
  mining_boom: miningBoom,
  ore_glut: oreGlut,
  supply_shortage: supplyShortage,
  pirate_raid: pirateRaid,
  solar_storm: solarStorm,
  refugee_crisis: refugeeCrisis,
  trade_embargo: tradeEmbargo,
  tech_breakthrough: techBreakthrough,
  asteroid_strike: asteroidStrike,
} as const satisfies Record<EventTypeId, EventDefinition>;

export const EVENT_DEFINITIONS: Record<EventTypeId, EventDefinition> = EVENT_DEFINITIONS_INTERNAL;

/** All event type IDs as a typed array. Use instead of Object.keys(EVENT_DEFINITIONS). */
export const EVENT_TYPE_IDS = [
  "inner_system_conflict", "plague", "trade_festival", "conflict_spillover",
  "plague_risk", "mining_boom", "ore_glut", "supply_shortage", "pirate_raid",
  "solar_storm", "refugee_crisis", "trade_embargo", "tech_breakthrough", "asteroid_strike",
] as const satisfies readonly EventTypeId[];

// ── Phase effect summaries ──────────────────────────────────────

/**
 * Pre-computed effect summaries for every (eventType, phaseName) pair.
 * Built once at module load — modifiers are constants so the output never changes.
 */
const PHASE_EFFECT_SUMMARIES: Record<string, string> = {};
for (const [type, def] of Object.entries(EVENT_DEFINITIONS)) {
  for (const phase of def.phases) {
    PHASE_EFFECT_SUMMARIES[`${type}:${phase.name}`] = summarizePhaseEffects(phase);
  }
}

/**
 * Get the effect summary for a specific event type and phase name.
 * Returns a short human-readable string describing the phase's impact.
 */
export function getPhaseEffectSummary(eventType: EventTypeId, phaseName: string): string {
  return PHASE_EFFECT_SUMMARIES[`${eventType}:${phaseName}`] ?? "";
}

// ── Scale-aware caps ────────────────────────────────────────────

const BASE_SYSTEMS = 600;

interface ScaledEventCaps {
  maxEventsGlobal: number;
  maxEventsPerSystem: number;
  batchSize: number;
  definitions: Record<EventTypeId, EventDefinition>;
}

/**
 * Scale event caps and per-type maxActive for a given universe size.
 * Base values are tuned for 600 systems; this multiplies proportionally.
 */
export function scaleEventCaps(totalSystems: number): ScaledEventCaps {
  const scale = totalSystems / BASE_SYSTEMS;
  const maxEventsGlobal = Math.round(totalSystems * EVENT_COVERAGE_TARGET);

  const definitions: Record<EventTypeId, EventDefinition> = { ...EVENT_DEFINITIONS };
  for (const key of EVENT_TYPE_IDS) {
    definitions[key] = {
      ...definitions[key],
      maxActive: Math.max(2, Math.round(definitions[key].maxActive * scale)),
    };
  }

  return {
    maxEventsGlobal,
    maxEventsPerSystem: MAX_EVENTS_PER_SYSTEM,
    batchSize: Math.ceil(maxEventsGlobal / 50),
    definitions,
  };
}
