"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemVitalsData } from "@/lib/types/api";

/**
 * Dynamic vitals snapshot (stability, development-vs-own-potential, population composition)
 * for one system's overview vital tiles. Changes every economy tick — so, unlike the static
 * substrate read, it uses the default staleTime and is tick-invalidated (see
 * useTickInvalidation). Visibility-gated server-side.
 */
export function useSystemVitals(systemId: string): SystemVitalsData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemVitals(systemId),
    queryFn: () => apiFetch<SystemVitalsData>(`/api/game/systems/${systemId}/vitals`),
  });
  return data;
}
