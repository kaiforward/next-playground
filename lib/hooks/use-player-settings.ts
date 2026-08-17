"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMutate } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { AlertCategoryInput, TrackerSectionInput } from "@/lib/schemas/player-settings";
import type { AlertData, TrackerData } from "@/lib/types/api";
import type { AlertCategorySettings } from "@/lib/types/alerts";
import type { TrackerSections } from "@/lib/types/tracker";

/**
 * Turn one alert category on or off (`POST /api/game/player/alerts`).
 *
 * Both hooks here follow `useSetSystemPin`'s pattern: write the authoritative post-write record into
 * the cache on success so the checkbox flips on this response rather than on the next refetch, then
 * invalidate for the rest of the payload. Without the immediate cache write the box would visibly
 * lag a round trip, since the settings ride a payload that is otherwise only refetched on a tick.
 */
export function useSetAlertCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AlertCategoryInput) =>
      apiMutate<AlertCategorySettings>(`/api/game/player/alerts`, input),
    onSuccess: (categorySettings) => {
      queryClient.setQueryData<AlertData>(queryKeys.alerts, (old) =>
        old ? { ...old, categorySettings } : old,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
    },
  });
}

/** Show or hide one Tracker section (`POST /api/game/player/tracker`). */
export function useSetTrackerSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TrackerSectionInput) =>
      apiMutate<TrackerSections>(`/api/game/player/tracker`, input),
    onSuccess: (sections) => {
      queryClient.setQueryData<TrackerData>(queryKeys.tracker, (old) =>
        old ? { ...old, sections } : old,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracker });
    },
  });
}
