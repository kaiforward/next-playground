import type { GovernmentType } from "@/lib/types/game";

export interface GovernmentDefinition {
  name: string;
  description: string;
  /** Additive danger baseline for transit in this government type's regions. */
  dangerBaseline: number;
}

/** Government type definitions. */
export const GOVERNMENT_TYPES: Record<GovernmentType, GovernmentDefinition> = {
  federation: {
    name: "Federation",
    description: "Democratic, regulated, stable. Rule of law and consumer protections.",
    dangerBaseline: 0.0,
  },
  corporate: {
    name: "Corporate",
    description: "Profit-driven, competitive, efficient. Megacorp governance.",
    dangerBaseline: 0.02,
  },
  authoritarian: {
    name: "Authoritarian",
    description: "Military governance, controlled markets, strong security.",
    dangerBaseline: 0.0,
  },
  frontier: {
    name: "Frontier",
    description: "Lawless, dangerous, unregulated. No central authority.",
    dangerBaseline: 0.1,
  },
  cooperative: {
    name: "Cooperative",
    description: "Worker-owned, egalitarian, community-focused. Rock-solid consistency, low margins.",
    dangerBaseline: 0.0,
  },
  technocratic: {
    name: "Technocratic",
    description: "Innovation-driven, high-tier specialisation. Premium prices on advanced goods.",
    dangerBaseline: 0.01,
  },
  militarist: {
    name: "Militarist",
    description: "War economy, resource-hungry, mobilized. Volatile and starved for strategic goods.",
    dangerBaseline: 0.05,
  },
  theocratic: {
    name: "Theocratic",
    description: "Ideological, community-driven, insular. Pays premium for basics, vice banned.",
    dangerBaseline: 0.03,
  },
};
