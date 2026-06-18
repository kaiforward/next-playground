import type { Doctrine } from "@/lib/types/game";

export interface DoctrineDefinition {
  name: string;
  description: string;
  /**
   * Multiplier on baseline war-declaration probability. The relations processor
   * reads this to bias the alliance-negotiation outcome (higher = harder to ally
   * with); the war system will use it directly for the declaration roll.
   */
  declarationModifier: number;
  /**
   * Stub for the war system: multiplier on per-tick war exhaustion accrual.
   * Lower = doctrine sustains long wars better. Not yet read.
   */
  exhaustionMultiplier: number;
}

/**
 * All factions are warlike — the spread between doctrines is intentionally narrow.
 * Numbers cluster near 1.0 so doctrine biases behavior without dominating it.
 */
export const DOCTRINES: Record<Doctrine, DoctrineDefinition> = {
  expansionist: {
    name: "Expansionist",
    description: "Looks for justifications to push borders. Most likely to declare war, by a small margin.",
    declarationModifier: 1.2,
    exhaustionMultiplier: 1.0,
  },
  protectionist: {
    name: "Protectionist",
    description: "Rarely starts wars, but responds with overwhelming force and aggressive reclamation.",
    declarationModifier: 0.7,
    exhaustionMultiplier: 0.8,
  },
  mercantile: {
    name: "Mercantile",
    description: "Fights when trade is threatened. Prefers embargoes and proxy wars to direct conflict.",
    declarationModifier: 0.9,
    exhaustionMultiplier: 1.2,
  },
  hegemonic: {
    name: "Hegemonic",
    description: "Pressures weaker neighbors into submission. Avoids wars with equal powers.",
    declarationModifier: 1.0,
    exhaustionMultiplier: 1.0,
  },
  opportunistic: {
    name: "Opportunistic",
    description: "Strikes when others are distracted or weakened. Cuts losses quickly when conditions reverse.",
    declarationModifier: 1.0,
    exhaustionMultiplier: 1.1,
  },
};
