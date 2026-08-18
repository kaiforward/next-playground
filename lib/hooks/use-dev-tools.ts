"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { apiFetch, apiMutate } from "@/lib/query/fetcher";
import type { EconomySnapshotSystem } from "@/lib/services/dev-tools";

// ── Economy snapshot query ──────────────────────────────────────

export function useEconomySnapshot(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.devEconomy,
    queryFn: () => apiFetch<{ systems: EconomySnapshotSystem[] }>("/api/dev/economy-snapshot"),
    enabled,
    staleTime: 10_000,
  });
}

// ── Mutations ───────────────────────────────────────────────────

/**
 * The views a dev tool moving the economy leaves stale. Both such mutations invalidate the same
 * three, so a fourth dev view is added here once rather than at each mutation that would need it.
 */
function invalidateEconomyViews(qc: QueryClient) {
  for (const queryKey of [queryKeys.marketAll, queryKeys.events, queryKeys.devEconomy]) {
    qc.invalidateQueries({ queryKey });
  }
}

export function useAdvanceTicksMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (count: number) =>
      apiMutate<{ newTick: number; elapsed: number }>("/api/dev/advance-ticks", { count }),
    onSuccess: () => invalidateEconomyViews(qc),
  });
}

export function useSpawnEventMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { systemId: string; eventType: string; severity?: number }) =>
      apiMutate<{ eventId: string; type: string; phase: string }>("/api/dev/spawn-event", params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.events });
    },
  });
}

export function useResetEconomyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiMutate<{ marketsReset: number; eventsCleared: number }>("/api/dev/reset-economy", {}),
    onSuccess: () => invalidateEconomyViews(qc),
  });
}
