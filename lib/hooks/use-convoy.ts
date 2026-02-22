"use client";

import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiMutate, apiDelete } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { ConvoyState } from "@/lib/types/game";
import type { CreateConvoyResult, ConvoyNavigateRequest } from "@/lib/types/api";

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
      return apiDelete<ConvoyState>(`/api/game/convoy/${convoyId}/members`, { shipId });
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
