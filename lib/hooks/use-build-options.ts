"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemBuildOptionsData } from "@/lib/types/api";

/** The player's build surface for one system (verbs + feasibility). Tick-invalidated. */
export function useSystemBuildOptions(systemId: string): SystemBuildOptionsData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemBuildOptions(systemId),
    queryFn: () => apiFetch<SystemBuildOptionsData>(`/api/game/systems/${systemId}/build-options`),
  });
  return data;
}
