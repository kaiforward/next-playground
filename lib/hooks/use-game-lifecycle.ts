"use client";

import { useMutation } from "@tanstack/react-query";
import { apiMutate } from "@/lib/query/fetcher";

/** Save the current world under a player-chosen name (`POST /api/game/saves`). */
export function useSaveGameMutation() {
  return useMutation({
    mutationFn: (name: string) =>
      apiMutate<{ name: string; tick: number }>("/api/game/saves", { name }),
  });
}
