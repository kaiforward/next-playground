import type { EconomyType } from "@/lib/types/game";

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
  eventType: string;
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
  type: string;
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
  description: "Military conflict erupts, disrupting production and spiking demand for fuel and ship parts.",
  targetFilter: { economyTypes: ["industrial", "tech", "mining", "core"] },
  cooldown: 100,
  maxActive: 3,
  weight: 10,
  phases: [
    {
      name: "tensions",
      displayName: "Tensions Rising",
      durationRange: [30, 60],
      notification: "Tensions are rising at {systemName}. Fuel and ship parts demand increasing.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 20 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ship_parts", parameter: "demand_target", value: 30 },
      ],
    },
    {
      name: "escalation",
      displayName: "Escalation",
      durationRange: [20, 40],
      notification: "Conflict escalates at {systemName}. Production declining.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 50 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ship_parts", parameter: "demand_target", value: 50 },
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
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ship_parts", parameter: "demand_target", value: 60 },
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
  cooldown: 120,
  maxActive: 2,
  weight: 8,
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
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "electronics", parameter: "demand_target", value: 40 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.03 },
      ],
      spread: [
        {
          eventType: "plague_risk",
          probability: 0.4,
          severity: 0.3,
          targetFilter: { sameRegion: true, economyTypes: ["agricultural"] },
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
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "electronics", parameter: "demand_target", value: 20 },
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
  cooldown: 80,
  maxActive: 3,
  weight: 12,
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
  description: "Nearby conflict disrupts trade routes, increasing demand for fuel and ship parts.",
  cooldown: 80,
  maxActive: 5,
  weight: 0, // Never spawned randomly — only via spread
  phases: [
    {
      name: "spillover",
      displayName: "Conflict Spillover",
      durationRange: [40, 80],
      notification: "Conflict spills over to {systemName}. Fuel and parts demand rising.",
      modifiers: [
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "fuel", parameter: "demand_target", value: 25 },
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "ship_parts", parameter: "demand_target", value: 20 },
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
  targetFilter: { economyTypes: ["agricultural"] },
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
        { domain: "economy", type: "equilibrium_shift", target: "system", goodId: "electronics", parameter: "demand_target", value: 15 },
      ],
    },
  ],
};

/** All registered event definitions, keyed by type. */
export const EVENT_DEFINITIONS: Record<string, EventDefinition> = {
  war,
  plague,
  trade_festival: tradeFestival,
  conflict_spillover: conflictSpillover,
  plague_risk: plagueRisk,
};
