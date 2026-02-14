"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { EconomySnapshotSystem } from "@/lib/services/dev-tools";

// ── Helper ──────────────────────────────────────────────────────

async function devFetch<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data as T;
}

// ── Economy snapshot query ──────────────────────────────────────

export function useEconomySnapshot(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.devEconomy,
    queryFn: () => devFetch<{ systems: EconomySnapshotSystem[] }>("/api/dev/economy-snapshot"),
    enabled,
    staleTime: 10_000,
  });
}

// ── Mutations ───────────────────────────────────────────────────

export function useAdvanceTicksMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (count: number) =>
      devFetch<{ newTick: number; elapsed: number }>("/api/dev/advance-ticks", { count }),
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
      devFetch<{ eventId: string; type: string; phase: string }>("/api/dev/spawn-event", params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.events });
    },
  });
}

export function useGiveCreditsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { playerId: string; amount: number }) =>
      devFetch<{ credits: number }>("/api/dev/give-credits", params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useTeleportShipMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { shipId: string; systemId: string }) =>
      devFetch<{ shipId: string; systemId: string }>("/api/dev/teleport-ship", params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useResetEconomyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      devFetch<{ marketsReset: number; eventsCleared: number }>("/api/dev/reset-economy", {}),
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
      devFetch<{ tickRate: number; paused: boolean }>("/api/dev/tick-control", params),
  });
}
