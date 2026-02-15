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
