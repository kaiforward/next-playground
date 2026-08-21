"use client";

import { useDetailEntry } from "@/lib/hooks/detail-read";
import type { SystemIndustryData } from "@/lib/types/api";

/** See `use-system-substrate.ts`'s NOT_FOUND docstring — same reasoning, this type's own arm. */
const NOT_FOUND: SystemIndustryData = { visibility: "unknown" };

/**
 * Industrial base and supply-chain state for one system — read from the store's `systemIndustry`
 * slice, tick-current by construction. Visibility-gated in the slice itself; an absent id renders
 * the same `visibility: "unknown"` state — for either of two reasons: the id doesn't exist, or it
 * exists but isn't in the current interest set yet (see `lib/hooks/detail-read.ts`). Telling those
 * apart is the panel root's job (`system-panel.tsx`'s presence gate), not this hook's.
 */
export function useSystemIndustry(systemId: string): SystemIndustryData {
  return (
    useDetailEntry(
      (slices) => slices.systemIndustry?.[systemId],
      "systemIndustry",
      systemId,
      "system",
    ) ??
    NOT_FOUND
  );
}
