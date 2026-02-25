"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemAllMissionsData } from "@/lib/types/api";
import type { MissionInfo } from "@/lib/types/game";

export function useSystemAllMissions(systemId: string) {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemAllMissions(systemId),
    queryFn: () => apiFetch<SystemAllMissionsData>(`/api/game/op-missions?systemId=${systemId}`),
  });

  return data;
}

export function usePlayerOpMissions() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.playerOpMissions,
    queryFn: () => apiFetch<MissionInfo[]>("/api/game/op-missions"),
  });

  return { missions: data };
}
