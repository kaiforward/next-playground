"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMutate } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";

/** Pin or unpin a system on the player's Tracker list (`POST /api/game/player/pins`). */
export function useSetSystemPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { systemId: string; pinned: boolean }) =>
      apiMutate<string[]>(`/api/game/player/pins`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracker });
    },
  });
}
