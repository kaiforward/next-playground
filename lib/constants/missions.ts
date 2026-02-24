// ── Operational mission types ─────────────────────────────────────

export type MissionType = "patrol" | "survey" | "bounty";

export type StatGateKey = "firepower" | "sensors" | "hullMax" | "stealth";

export interface MissionTypeDef {
  name: string;
  description: string;
  /** Ship stats that must meet or exceed the given values. */
  statGate: Partial<Record<StatGateKey, number>>;
  /** Tick duration for timed missions [min, max]. Null for battle-driven. */
  durationTicks: [min: number, max: number] | null;
  /** Base reward range in credits [min, max]. */
  rewardRange: [min: number, max: number];
  /** Danger threshold for candidate generation. */
  dangerThreshold: number;
}

export const MISSION_TYPE_DEFS: Record<MissionType, MissionTypeDef> = {
  patrol: {
    name: "Patrol",
    description: "Patrol a dangerous system to suppress pirate activity.",
    statGate: { firepower: 5 },
    durationTicks: [15, 25],
    rewardRange: [200, 500],
    dangerThreshold: 0.15,
  },
  survey: {
    name: "Survey",
    description: "Survey anomalous phenomena or precursor ruins for scientific data.",
    statGate: { sensors: 6 },
    durationTicks: [10, 15],
    rewardRange: [150, 400],
    dangerThreshold: 0, // survey uses traits, not danger
  },
  bounty: {
    name: "Bounty",
    description: "Hunt down and eliminate a pirate band threatening the system.",
    statGate: { firepower: 4, hullMax: 30 },
    durationTicks: null, // battle-driven, no fixed duration
    rewardRange: [300, 800],
    dangerThreshold: 0.20,
  },
};

/** Traits that make a system eligible for survey missions. */
export const SURVEY_ELIGIBLE_TRAITS = [
  "precursor_ruins",
  "gravitational_anomaly",
  "binary_star",
  "dark_nebula",
  "subspace_rift",
  "bioluminescent_ecosystem",
] as const;

/** Max available operational missions per system. */
export const OP_MISSION_CAP_PER_SYSTEM = 4;

/** Deadline ticks for operational missions (ticks until expiry from board). */
export const OP_MISSION_DEADLINE_TICKS = 200;

// ── Trade mission constants ─────────────────────────────────────

export const MISSION_CONSTANTS = {
  MAX_ACTIVE_PER_PLAYER: 10,
  MAX_AVAILABLE_PER_STATION: 8,
  HIGH_PRICE_THRESHOLD: 2.0,     // price/basePrice ratio -> import mission
  LOW_PRICE_THRESHOLD: 0.5,      // price/basePrice ratio -> export mission
  ECONOMY_GEN_PROBABILITY: 0.08, // per qualifying market per generation tick
  DEADLINE_TICKS: 300,
  QUANTITY_RANGE: [20, 60] as const,
  REWARD_PER_UNIT: 3,
  REWARD_DISTANCE_MULT: 1.25,    // compounding per hop
  REWARD_TIER_MULT: { 0: 1.0, 1: 4.0, 2: 12.0 } as Record<number, number>,
  REWARD_EVENT_MULT: 1.5,
  REWARD_MIN: 50,
  MAX_EXPORT_DISTANCE: 3,        // hops
} as const;
