"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMutate } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { PinInput } from "@/lib/schemas/player-pins";
import type { TrackerData } from "@/lib/types/api";

/** Pin or unpin a system on the player's Tracker list (`POST /api/game/player/pins`). */
export function useSetSystemPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PinInput) => apiMutate<string[]>(`/api/game/player/pins`, input),
    onSuccess: (pinnedSystemIds) => {
      // Write the authoritative post-write id list into the cache immediately so the star toggle's
      // pressed state flips on this response, not on the next refetch — `pinnedSystemIds` is exactly
      // the field `PinToggle` joins against (see its own docstring on why: the unfiltered id list,
      // never the display-filtered `pinned` rows). The rest of `TrackerData` (rows, building,
      // colonising) still comes from the invalidation below; this is not a full server response.
      queryClient.setQueryData<TrackerData>(queryKeys.tracker, (old) =>
        old ? { ...old, pinnedSystemIds } : old,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracker });
    },
  });
}
