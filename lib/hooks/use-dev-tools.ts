"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useAdvanceTicksMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (count: number) =>
      apiMutate<{ newTick: number; elapsed: number }>("/api/dev/advance-ticks", { count }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fleet });
      qc.invalidateQueries({ queryKey: queryKeys.marketAll });
      qc.invalidateQueries({ queryKey: queryKeys.events });
      qc.invalidateQueries({ queryKey: queryKeys.devEconomy });
    },
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

export function useGiveCreditsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { playerId: string; amount: number }) =>
      apiMutate<{ credits: number }>("/api/dev/give-credits", params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useTeleportShipMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { shipId: string; systemId: string }) =>
      apiMutate<{ shipId: string; systemId: string }>("/api/dev/teleport-ship", params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useResetEconomyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiMutate<{ marketsReset: number; eventsCleared: number }>("/api/dev/reset-economy", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.marketAll });
      qc.invalidateQueries({ queryKey: queryKeys.events });
      qc.invalidateQueries({ queryKey: queryKeys.devEconomy });
    },
  });
}

export function useTickControlMutation() {
  return useMutation({
    mutationFn: (params: { action: "pause" | "resume" | "setRate"; tickRate?: number }) =>
      apiMutate<{ tickRate: number; paused: boolean }>("/api/dev/tick-control", params),
  });
}
