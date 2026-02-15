"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { UniverseData } from "@/lib/types/game";

export function useUniverse() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.universe,
    queryFn: () => apiFetch<UniverseData>("/api/game/systems"),
    staleTime: Infinity, // static data — never refetch
  });

  return { data };
}
