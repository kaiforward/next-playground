"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_TRACKER } from "./empty-slices";
import { createOverlayStore, useOverlay } from "@/lib/store/command-overlay";
import type { TrackerData } from "@/lib/types/api";
import type { TrackerSections } from "@/lib/types/tracker";

/** Single-player: there is exactly one Tracker payload, so both overlays carry one key. Exported for
 *  `use-player-pins.ts` (`pinnedSystemIdsOverlay`, whose `useSetSystemPin` is the one writer) and
 *  `use-player-settings.ts` (`trackerSectionsOverlay`, whose `useSetTrackerSection` is the one
 *  writer) — see each hook's docstring for why the overlay lives here rather than there:
 *  `useTracker` is the read every `components/` caller (`PinToggle`, `TrackerPanel`,
 *  `TrackerSettingsPanel`) already uses, so a write must merge INSIDE this hook to reach them
 *  without a component-level change. */
export const GLOBAL_TRACKER_KEY = "player";
export const pinnedSystemIdsOverlay = createOverlayStore<string[]>();
export const trackerSectionsOverlay = createOverlayStore<TrackerSections>();

/**
 * The Tracker panel roll-up (pinned systems, funded construction front, forming colonies). Read
 * from the store's `tracker` slice, which rides every state frame — no suspense, no invalidation:
 * a construction order lands on this hook the moment the worker's post-command state frame is
 * applied (`client/worker/game-worker.ts`'s `handleCommand`), and every economy tick refreshes it
 * the same way.
 *
 * `pinnedSystemIds` is overlaid with any in-flight pin write's committed id list
 * (`use-player-pins.ts`'s `useSetSystemPin`, the client-runtime in-flight rule, spec §2) — the star
 * toggle's pressed state flips on that command's own response, not on the next state frame, and it
 * never reverts mid-flight.
 */
export function useTracker(): TrackerData {
  const data = useGameSlice((state) => state.slices.tracker ?? EMPTY_TRACKER);
  const pinnedOverlay = useOverlay(pinnedSystemIdsOverlay, GLOBAL_TRACKER_KEY);
  const sectionsOverlay = useOverlay(trackerSectionsOverlay, GLOBAL_TRACKER_KEY);
  if (!pinnedOverlay && !sectionsOverlay) return data;
  return {
    ...data,
    ...(pinnedOverlay ? { pinnedSystemIds: pinnedOverlay } : null),
    ...(sectionsOverlay ? { sections: sectionsOverlay } : null),
  };
}
