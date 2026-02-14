import type { GovernmentType } from "@/lib/types/game";

export interface GovernmentDefinition {
  name: string;
  description: string;
  /** Good IDs that cannot be freely traded in this government type's regions. */
  tradeRestrictions: string[];
  /** Multiplier on per-good volatility. < 1 dampens swings, > 1 amplifies them. */
  volatilityModifier: number;
  /** Additive danger baseline for transit in this government type's regions. */
  dangerBaseline: number;
  /** Percentage adjustment to equilibrium spread. Negative = tighter margins. */
  equilibriumSpreadPct: number;
  /** Event type weight adjustments. Positive = more likely, negative = less likely. */
  eventWeights: Record<string, number>;
  /** Additional consumption applied to all systems in this government type's regions. */
  consumptionBoosts: Record<string, number>;
}

/**
 * Adjust equilibrium supply/demand targets by a spread percentage.
 * Positive spreadPct widens the gap (frontier), negative tightens it (authoritarian).
 */
export function adjustEquilibriumSpread(
  target: { supply: number; demand: number },
  spreadPct: number,
): { supply: number; demand: number } {
  const mid = (target.supply + target.demand) / 2;
  const halfSpread = (target.supply - target.demand) / 2;
  const scaled = halfSpread * (1 + spreadPct / 100);
  return {
    supply: Math.round(mid + scaled),
    demand: Math.round(mid - scaled),
  };
}

/** Government type definitions. */
export const GOVERNMENT_TYPES: Record<GovernmentType, GovernmentDefinition> = {
  federation: {
    name: "Federation",
    description: "Democratic, regulated, stable. Rule of law and consumer protections.",
    tradeRestrictions: ["weapons"],
    volatilityModifier: 0.8,
    dangerBaseline: 0.0,
    equilibriumSpreadPct: -10,
    eventWeights: { trade_festival: 5 },
    consumptionBoosts: { medicine: 1 },
  },
  corporate: {
    name: "Corporate",
    description: "Profit-driven, competitive, efficient. Megacorp governance.",
    tradeRestrictions: [],
    volatilityModifier: 0.9,
    dangerBaseline: 0.02,
    equilibriumSpreadPct: -5,
    eventWeights: { trade_festival: 5, war: -3 },
    consumptionBoosts: { luxuries: 1 },
  },
  authoritarian: {
    name: "Authoritarian",
    description: "Military governance, controlled markets, strong security.",
    tradeRestrictions: ["weapons", "chemicals"],
    volatilityModifier: 0.7,
    dangerBaseline: 0.0,
    equilibriumSpreadPct: -15,
    eventWeights: { war: 5, plague: -3 },
    consumptionBoosts: { weapons: 1, fuel: 1 },
  },
  frontier: {
    name: "Frontier",
    description: "Lawless, dangerous, unregulated. No central authority.",
    tradeRestrictions: [],
    volatilityModifier: 1.5,
    dangerBaseline: 0.1,
    equilibriumSpreadPct: 20,
    eventWeights: { war: 5, plague: 3, trade_festival: -5 },
    consumptionBoosts: {},
  },
};
