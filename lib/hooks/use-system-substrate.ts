"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { SystemSubstrateData } from "@/lib/types/api";

/** Static — every existing system carries a `systemSubstrate` entry (`buildStateFrame` walks
 *  `world.systems`), so `NOT_FOUND` fires only for a systemId absent from the world entirely (a
 *  stale panel URL). Reuses the type's own fog-of-war fallback arm rather than adding a new
 *  discriminant — `visibility: "unknown"` already means "nothing to show for this id" to every
 *  existing reader. */
const NOT_FOUND: SystemSubstrateData = { visibility: "unknown" };

/**
 * Physical substrate (sun class, population, bodies) for one system — read from the store's
 * `systemSubstrate` slice. Visibility-gated: unsurveyed systems carry `{ visibility: "unknown" }`
 * in the slice itself, and an id absent from the slice renders the same state.
 */
export function useSystemSubstrate(systemId: string): SystemSubstrateData {
  return useGameSlice((state) => state.slices.systemSubstrate?.[systemId] ?? NOT_FOUND);
}
