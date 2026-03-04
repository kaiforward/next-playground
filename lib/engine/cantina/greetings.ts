import type { NpcArchetype } from "@/lib/engine/mini-games/voids-gambit";
import type { CantinaNpcType } from "@/lib/constants/cantina-npcs";
import {
  BARTENDER_GREETINGS,
  PATRON_GREETINGS,
  type GreetingSet,
} from "@/lib/constants/cantina-npcs";

/**
 * Get a visit-count-aware greeting for an NPC.
 * Pure function — no DB.
 *
 * @param npcType - "bartender" or an NpcArchetype string
 * @param visitCount - number of prior visits (0 = first visit)
 */
export function getGreeting(npcType: CantinaNpcType, visitCount: number): string {
  const greetings: GreetingSet =
    npcType === "bartender"
      ? BARTENDER_GREETINGS
      : PATRON_GREETINGS[npcType as NpcArchetype];

  const bucket =
    visitCount === 0
      ? greetings.first
      : visitCount < 5
        ? greetings.returning
        : greetings.regular;

  return bucket[Math.floor(Math.random() * bucket.length)];
}
