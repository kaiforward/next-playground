import type { GovernmentType } from "@/lib/types/game";

export interface GovernmentDefinition {
  name: string;
  description: string;
  /** Good IDs subject to import duty at arrival. */
  taxed: string[];
  /** Good IDs that are illegal — full confiscation if caught. */
  contraband: string[];
  /** Fraction of taxed goods seized as import duty (e.g. 0.12 = 12%). */
  taxRate: number;
  /** Multiplier on base inspection chance for contraband (0 = no inspections). */
  inspectionModifier: number;
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

/** Government type definitions. */
export const GOVERNMENT_TYPES: Record<GovernmentType, GovernmentDefinition> = {
  federation: {
    name: "Federation",
    description: "Democratic, regulated, stable. Rule of law and consumer protections.",
    taxed: ["chemicals"],
    contraband: ["weapons"],
    taxRate: 0.12,
    inspectionModifier: 1.2,
    volatilityModifier: 0.8,
    dangerBaseline: 0.0,
    equilibriumSpreadPct: -10,
    eventWeights: { trade_festival: 5 },
    consumptionBoosts: { medicine: 1 },
  },
  corporate: {
    name: "Corporate",
    description: "Profit-driven, competitive, efficient. Megacorp governance.",
    taxed: [],
    contraband: [],
    taxRate: 0.10,
    inspectionModifier: 0.8,
    volatilityModifier: 0.9,
    dangerBaseline: 0.02,
    equilibriumSpreadPct: -5,
    eventWeights: { trade_festival: 5 },
    consumptionBoosts: { luxuries: 1 },
  },
  authoritarian: {
    name: "Authoritarian",
    description: "Military governance, controlled markets, strong security.",
    taxed: [],
    contraband: ["weapons", "chemicals"],
    taxRate: 0.15,
    inspectionModifier: 1.5,
    volatilityModifier: 0.7,
    dangerBaseline: 0.0,
    equilibriumSpreadPct: -15,
    eventWeights: { plague: -3 },
    consumptionBoosts: { weapons: 1, fuel: 1 },
  },
  frontier: {
    name: "Frontier",
    description: "Lawless, dangerous, unregulated. No central authority.",
    taxed: [],
    contraband: [],
    taxRate: 0.0,
    inspectionModifier: 0.0,
    volatilityModifier: 1.5,
    dangerBaseline: 0.1,
    equilibriumSpreadPct: 20,
    eventWeights: { plague: 3, trade_festival: -5 },
    consumptionBoosts: {},
  },
  cooperative: {
    name: "Cooperative",
    description: "Worker-owned, egalitarian, community-focused. Rock-solid consistency, low margins.",
    taxed: [],
    contraband: ["luxuries"],
    taxRate: 0.10,
    inspectionModifier: 1.0,
    volatilityModifier: 0.7,
    dangerBaseline: 0.0,
    equilibriumSpreadPct: -10,
    eventWeights: { trade_festival: 3 },
    consumptionBoosts: { food: 1, medicine: 1 },
  },
  technocratic: {
    name: "Technocratic",
    description: "Innovation-driven, high-tier specialization. Premium prices on advanced goods.",
    taxed: ["water", "food"],
    contraband: [],
    taxRate: 0.08,
    inspectionModifier: 0.6,
    volatilityModifier: 1.0,
    dangerBaseline: 0.01,
    equilibriumSpreadPct: 5,
    eventWeights: { tech_breakthrough: 5 },
    consumptionBoosts: { electronics: 1 },
  },
  militarist: {
    name: "Militarist",
    description: "War economy, resource-hungry, mobilized. Volatile and starved for strategic goods.",
    taxed: ["electronics", "machinery"],
    contraband: [],
    taxRate: 0.10,
    inspectionModifier: 1.3,
    volatilityModifier: 1.3,
    dangerBaseline: 0.05,
    equilibriumSpreadPct: 10,
    eventWeights: { trade_festival: -3 },
    consumptionBoosts: { weapons: 1, fuel: 1, machinery: 1 },
  },
  theocratic: {
    name: "Theocratic",
    description: "Ideological, community-driven, insular. Pays premium for basics, vice banned.",
    taxed: [],
    contraband: ["weapons", "chemicals", "luxuries"],
    taxRate: 0.10,
    inspectionModifier: 1.4,
    volatilityModifier: 0.8,
    dangerBaseline: 0.03,
    equilibriumSpreadPct: -5,
    eventWeights: { plague: -3 },
    consumptionBoosts: { food: 1, medicine: 1, textiles: 1 },
  },
};
