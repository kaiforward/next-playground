"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemMissionsData } from "@/lib/types/api";

export function useSystemMissions(systemId: string) {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemMissions(systemId),
    queryFn: () => apiFetch<SystemMissionsData>(`/api/game/missions?systemId=${systemId}`),
  });

  return {
    available: data.available,
    active: data.active,
  };
}
