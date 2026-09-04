"use client";

import { useDetailEntry } from "@/lib/hooks/detail-read";
import type { LaneDetailData } from "@/lib/types/api";

/** One lane's full detail (the lane card's substrate) — interest-keyed, read from the store's
 *  `laneDetail` slice. `undefined` while the panel's `useInterest("lane", key)` registration hasn't
 *  landed a frame yet, or the key names no lane in the current world; the lane panel's own presence
 *  gate (mirroring `system-panel.tsx`) tells those two apart, not this hook. */
export function useLaneDetail(key: string): LaneDetailData | undefined {
  return useDetailEntry("laneDetail", key, "lane");
}
