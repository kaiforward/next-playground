"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { AtlasData } from "@/lib/types/game";

export function useAtlas() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.atlas,
    queryFn: () => apiFetch<AtlasData>("/api/game/atlas"),
    staleTime: Infinity, // static data — never refetch
  });

  return { atlas: data };
}
