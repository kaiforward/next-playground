"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_ALERTS } from "./empty-slices";
import { createOverlayStore, useOverlay } from "@/lib/store/command-overlay";
import type { AlertData } from "@/lib/types/api";
import type { AlertCategorySettings } from "@/lib/types/alerts";

/** Single-player: there is exactly one alert-category settings record, so the overlay carries one
 *  key. Exported for `use-player-settings.ts`'s `useSetAlertCategory` — see that hook's docstring. */
export const GLOBAL_ALERTS_KEY = "player";
export const alertCategoriesOverlay = createOverlayStore<AlertCategorySettings>();

/**
 * The alert bar's whole read — all sixteen categories. Read from the store's `alerts` slice, which
 * rides every state frame: every category refreshes together on the tick that changed it, with no
 * separate invalidation wiring.
 *
 * `categorySettings` is overlaid with any in-flight category write's committed record
 * (`use-player-settings.ts`'s `useSetAlertCategory`, the client-runtime in-flight rule, spec §2) —
 * a checkbox flips on that command's own response, never mid-flight reverting.
 */
export function useAlerts(): AlertData {
  const data = useGameSlice((state) => state.slices.alerts ?? EMPTY_ALERTS);
  const overlay = useOverlay(alertCategoriesOverlay, GLOBAL_ALERTS_KEY);
  return overlay ? { ...data, categorySettings: overlay } : data;
}
