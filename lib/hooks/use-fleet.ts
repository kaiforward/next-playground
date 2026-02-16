"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { FleetState } from "@/lib/types/game";

export function useFleet() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.fleet,
    queryFn: () => apiFetch<FleetState>("/api/game/fleet"),
  });

  return { fleet: data };
}
