"use client";

import { useDetailEntry } from "@/lib/hooks/detail-read";
import type { SystemBuildOptionsData } from "@/lib/types/api";

/** `SystemBuildOptionsData`'s own "nothing to build here" arm — reused for an absent id, same
 *  pattern as the other per-system hooks. */
const NOT_FOUND: SystemBuildOptionsData = { mode: "none" };

/** The player's build surface for one system (verbs + feasibility) — read from the store's
 *  `systemBuildOptions` slice, tick-current by construction. An absent id renders `{ mode:
 *  "none" }` — for either of two reasons: the id doesn't exist, or it exists but isn't in the
 *  current interest set yet (see `lib/hooks/detail-read.ts`). Telling those apart is the panel
 *  root's job (`system-panel.tsx`'s presence gate), not this hook's. */
export function useSystemBuildOptions(systemId: string): SystemBuildOptionsData {
  return (
    useDetailEntry(
      (slices) => slices.systemBuildOptions?.[systemId],
      "systemBuildOptions",
      systemId,
      "system",
    ) ?? NOT_FOUND
  );
}
