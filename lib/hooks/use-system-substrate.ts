"use client";

import { useDetailEntry } from "@/lib/hooks/detail-read";
import type { SystemSubstrateData } from "@/lib/types/api";

/** `systemSubstrate` is now interest-keyed (frame-architecture spec): a frame carries an entry only
 *  for a system in the current interest set, not every system in the world. `NOT_FOUND` therefore
 *  fires for either of two reasons: a systemId absent from the world entirely (a stale panel URL),
 *  or a real systemId that simply isn't subscribed yet (see `lib/hooks/detail-read.ts`). Reuses the
 *  type's own fog-of-war fallback arm rather than adding a new discriminant — `visibility:
 *  "unknown"` already means "nothing to show for this id" to every existing reader; telling the two
 *  reasons apart is the panel root's job (`system-panel.tsx`'s presence gate), not this hook's. */
const NOT_FOUND: SystemSubstrateData = { visibility: "unknown" };

/**
 * Physical substrate (sun class, population, bodies) for one system — read from the store's
 * `systemSubstrate` slice. Visibility-gated: unsurveyed systems carry `{ visibility: "unknown" }`
 * in the slice itself, and an id absent from the slice renders the same state (see `NOT_FOUND`'s
 * docstring for the two reasons that can mean).
 */
export function useSystemSubstrate(systemId: string): SystemSubstrateData {
  return useDetailEntry("systemSubstrate", systemId, "system") ?? NOT_FOUND;
}
