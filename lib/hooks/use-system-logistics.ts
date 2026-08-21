"use client";

import { useDetailEntry } from "@/lib/hooks/detail-read";
import type { SystemLogisticsData } from "@/lib/types/api";

/** See `use-system-substrate.ts`'s NOT_FOUND docstring — same reasoning, this type's own arm. */
const NOT_FOUND: SystemLogisticsData = { visibility: "unknown" };

/**
 * Per-system logistics (prod/con + imports/exports) for the Logistics tab — read from the store's
 * `systemLogistics` slice, tick-current by construction. Visibility-gated in the slice itself; an
 * absent id renders the same `visibility: "unknown"` state — for either of two reasons: the id
 * doesn't exist, or it exists but isn't in the current interest set yet (see
 * `lib/hooks/detail-read.ts`). Telling those apart is the panel root's job (`system-panel.tsx`'s
 * presence gate), not this hook's.
 */
export function useSystemLogistics(systemId: string): SystemLogisticsData {
  return useDetailEntry("systemLogistics", systemId, "system") ?? NOT_FOUND;
}
