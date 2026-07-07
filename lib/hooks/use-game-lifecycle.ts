"use client";

import { useMutation } from "@tanstack/react-query";
import { apiMutate } from "@/lib/query/fetcher";
import type { Speed } from "@/lib/world/tick-loop";

/** Save the current world under a player-chosen name (`POST /api/game/saves`). */
export function useSaveGameMutation() {
  return useMutation({
    mutationFn: (name: string) =>
      apiMutate<{ name: string; tick: number }>("/api/game/saves", { name }),
  });
}

/**
 * Set the tick-loop speed (`POST /api/game/speed`). No cache invalidation —
 * the loop always broadcasts on a speed change, so the SSE stream carries the
 * new speed back to `useTick` consumers.
 */
export function useSpeedMutation() {
  return useMutation({
    mutationFn: (speed: Speed) => apiMutate<{ speed: Speed }>("/api/game/speed", { speed }),
  });
}
