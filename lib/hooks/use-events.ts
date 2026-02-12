"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { ActiveEvent } from "@/lib/types/game";

export function useEvents() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.events,
    queryFn: () => apiFetch<ActiveEvent[]>("/api/game/events"),
  });

  return {
    events: data ?? [],
    loading: isLoading,
  };
}
