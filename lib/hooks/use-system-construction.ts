"use client";

import { useDetailEntry } from "@/lib/hooks/detail-read";
import type { SystemConstructionData } from "@/lib/types/api";

/** `SystemConstructionData` has no `unknown` visibility arm (it isn't fog-of-war gated) — its own
 *  "nothing to show" arm is `{ visibility: "hidden" }`, reused here for an absent id the same way
 *  the other per-system hooks reuse their own type's existing fallback. */
const NOT_FOUND: SystemConstructionData = { visibility: "hidden" };

/** In-flight construction for one system — read from the store's `systemConstruction` slice,
 *  tick-current by construction. An absent id renders `{ visibility: "hidden" }` — for either of
 *  two reasons: the id doesn't exist, or it exists but isn't in the current interest set yet (see
 *  `lib/hooks/detail-read.ts`). Telling those apart is the panel root's job (`system-panel.tsx`'s
 *  presence gate), not this hook's. */
export function useSystemConstruction(systemId: string): SystemConstructionData {
  return (
    useDetailEntry(
      (slices) => slices.systemConstruction?.[systemId],
      "systemConstruction",
      systemId,
      "system",
    ) ?? NOT_FOUND
  );
}
