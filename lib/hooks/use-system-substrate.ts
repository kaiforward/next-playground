"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemSubstrateData } from "@/lib/types/api";

/**
 * Physical substrate (sun class, population, bodies) for
 * one system. Static — only changes on reseed — so staleTime is Infinity and
 * it is not tick-invalidated. Visibility-gated server-side: unsurveyed systems
 * return `{ visibility: "unknown" }` so the panel renders a locked state.
 */
export function useSystemSubstrate(systemId: string): SystemSubstrateData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemSubstrate(systemId),
    queryFn: () =>
      apiFetch<SystemSubstrateData>(`/api/game/systems/${systemId}/substrate`),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data;
}
