"use client";

import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiMutate, apiDelete } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { ConvoyState } from "@/lib/types/game";
import type { CreateConvoyResult, ConvoyNavigateRequest, ConvoyRepairResult, ConvoyRefuelResult } from "@/lib/types/api";

export function useConvoys() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.convoys,
    queryFn: () => apiFetch<ConvoyState[]>("/api/game/convoy"),
  });

  return { convoys: data };
}

export function useCreateConvoyMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { shipIds: string[]; name?: string }) => {
      return apiMutate<CreateConvoyResult>("/api/game/convoy", params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useDisbandConvoyMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (convoyId: string) => {
      return apiDelete<{ convoyId: string }>(`/api/game/convoy/${convoyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useAddMembersBatchMutation(convoyId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shipIds: string[]) => {
      return apiMutate<ConvoyState>(`/api/game/convoy/${convoyId}/members/batch`, { shipIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useRemoveMembersBatchMutation(convoyId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shipIds: string[]) => {
      return apiMutate<ConvoyState>(`/api/game/convoy/${convoyId}/members/batch-remove`, { shipIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useConvoyMemberMutations(convoyId: string | null) {
  const queryClient = useQueryClient();

  const addMember = useMutation({
    mutationFn: async (shipId: string) => {
      if (!convoyId) throw new Error("Missing convoyId");
      return apiMutate<ConvoyState>(`/api/game/convoy/${convoyId}/members`, { shipId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });

  const removeMember = useMutation({
    mutationFn: async (shipId: string) => {
      if (!convoyId) throw new Error("Missing convoyId");
      const res = await fetch(`/api/game/convoy/${convoyId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipId }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      // Returns ConvoyState on normal remove, { disbanded: true } on auto-disband
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });

  return { addMember, removeMember };
}

export function useConvoyNavigateMutation(convoyId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (route: string[]) => {
      if (!convoyId) throw new Error("Missing convoyId");
      return apiMutate<{ convoy: ConvoyState; fuelUsed: number; travelDuration: number }>(
        `/api/game/convoy/${convoyId}/navigate`,
        { route } satisfies ConvoyNavigateRequest,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

/** Flexible mutation that accepts convoyId + route. Used by the map where any convoy can be navigated. */
export function useConvoyNavigateByIdMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ convoyId, route }: { convoyId: string; route: string[] }) => {
      return apiMutate<{ convoy: ConvoyState; fuelUsed: number; travelDuration: number }>(
        `/api/game/convoy/${convoyId}/navigate`,
        { route } satisfies ConvoyNavigateRequest,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useConvoyRepairMutation(convoyId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fraction: number) => {
      return apiMutate<ConvoyRepairResult>(
        `/api/game/convoy/${convoyId}/repair`,
        { fraction },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useConvoyRefuelMutation(convoyId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fraction: number) => {
      return apiMutate<ConvoyRefuelResult>(
        `/api/game/convoy/${convoyId}/refuel`,
        { fraction },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

