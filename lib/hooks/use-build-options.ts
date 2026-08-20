"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import type { SystemBuildOptionsData } from "@/lib/types/api";

/** `SystemBuildOptionsData`'s own "nothing to build here" arm — reused for an absent id, same
 *  pattern as the other per-system hooks. */
const NOT_FOUND: SystemBuildOptionsData = { mode: "none" };

/** The player's build surface for one system (verbs + feasibility) — read from the store's
 *  `systemBuildOptions` slice, tick-current by construction. An absent id renders `{ mode:
 *  "none" }`. */
export function useSystemBuildOptions(systemId: string): SystemBuildOptionsData {
  return useGameSlice((state) => state.slices.systemBuildOptions?.[systemId] ?? NOT_FOUND);
}
