"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemConstructionData } from "@/lib/types/api";

/** In-flight construction for one system. Tick-invalidated (see useTickInvalidation). */
export function useSystemConstruction(systemId: string): SystemConstructionData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemConstruction(systemId),
    queryFn: () => apiFetch<SystemConstructionData>(`/api/game/systems/${systemId}/construction`),
  });
  return data;
}
