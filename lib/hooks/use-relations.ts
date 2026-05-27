"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { RelationsMatrixData } from "@/lib/services/factions";

export function useRelations() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.factionRelations,
    queryFn: () =>
      apiFetch<RelationsMatrixData>("/api/game/factions/relations"),
  });

  return { relations: data };
}
