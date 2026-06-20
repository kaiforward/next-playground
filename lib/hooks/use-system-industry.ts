"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemIndustryData } from "@/lib/types/api";

/**
 * Industrial base and supply-chain state for one system. Changes every economy
 * tick — tick-invalidated (see useTickInvalidation). Visibility-gated
 * server-side.
 */
export function useSystemIndustry(systemId: string): SystemIndustryData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemIndustry(systemId),
    queryFn: () =>
      apiFetch<SystemIndustryData>(`/api/game/systems/${systemId}/industry`),
  });
  return data;
}
