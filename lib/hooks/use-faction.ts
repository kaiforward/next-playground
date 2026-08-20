"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { FactionDetail } from "@/lib/services/factions";

/**
 * `useFaction`'s only callers today are the (Next-router, pre-Task-9) faction panel pages under
 * `app/(game)/@panel/factions/[factionId]/**`, all rewritten by Task 9 — so unlike
 * `useFactionVitals`/`useFactionConstruction` (whose permanent `components/` callers this task must
 * not touch), this hook can carry a genuine discriminated not-found: a faction id absent from the
 * snapshot (a stale panel URL after new game/load, or a bad direct navigation) returns `{ found:
 * false }` instead of throwing. The four current callers were given a minimal early-return guard
 * (`if (!result.found) return null;`) as part of this change, since it is otherwise a stranded
 * compile break in files this task's diff already has to reason about.
 */
export type FactionResult = { found: true; faction: FactionDetail } | { found: false };

export function useFaction(factionId: string): FactionResult {
  const faction = useGameSlice((state) => state.slices.factionDetail?.[factionId]);
  return faction ? { found: true, faction } : { found: false };
}
