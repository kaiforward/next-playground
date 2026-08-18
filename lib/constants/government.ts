import type { GovernmentType } from "@/lib/types/game";

export interface GovernmentDefinition {
  name: string;
  description: string;
  /** Additive danger baseline for transit in this government type's regions. */
  dangerBaseline: number;
  /** Event type weight adjustments. Positive = more likely, negative = less likely. */
  eventWeights: Record<string, number>;
}

/** Government type definitions. */
export const GOVERNMENT_TYPES: Record<GovernmentType, GovernmentDefinition> = {
  federation: {
    name: "Federation",
    description: "Democratic, regulated, stable. Rule of law and consumer protections.",
    dangerBaseline: 0.0,
    eventWeights: { trade_festival: 5 },
  },
  corporate: {
    name: "Corporate",
    description: "Profit-driven, competitive, efficient. Megacorp governance.",
    dangerBaseline: 0.02,
    eventWeights: { trade_festival: 5 },
  },
  authoritarian: {
    name: "Authoritarian",
    description: "Military governance, controlled markets, strong security.",
    dangerBaseline: 0.0,
    eventWeights: { plague: -3 },
  },
  frontier: {
    name: "Frontier",
    description: "Lawless, dangerous, unregulated. No central authority.",
    dangerBaseline: 0.1,
    eventWeights: { plague: 3, trade_festival: -5 },
  },
  cooperative: {
    name: "Cooperative",
    description: "Worker-owned, egalitarian, community-focused. Rock-solid consistency, low margins.",
    dangerBaseline: 0.0,
    eventWeights: { trade_festival: 3 },
  },
  technocratic: {
    name: "Technocratic",
    description: "Innovation-driven, high-tier specialisation. Premium prices on advanced goods.",
    dangerBaseline: 0.01,
    eventWeights: { tech_breakthrough: 5 },
  },
  militarist: {
    name: "Militarist",
    description: "War economy, resource-hungry, mobilized. Volatile and starved for strategic goods.",
    dangerBaseline: 0.05,
    eventWeights: { trade_festival: -3 },
  },
  theocratic: {
    name: "Theocratic",
    description: "Ideological, community-driven, insular. Pays premium for basics, vice banned.",
    dangerBaseline: 0.03,
    eventWeights: { plague: -3 },
  },
};
