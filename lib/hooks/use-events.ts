"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { ActiveEvent } from "@/lib/types/game";

export function useEvents() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.events,
    queryFn: () => apiFetch<ActiveEvent[]>("/api/game/events"),
  });

  return { events: data };
}
