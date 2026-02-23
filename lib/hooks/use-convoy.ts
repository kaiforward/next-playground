"use client";

import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiMutate, apiDelete } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { ConvoyState } from "@/lib/types/game";
import type { CreateConvoyResult, ConvoyNavigateRequest, ConvoyRepairResult, ConvoyTradeResult, ShipTradeRequest } from "@/lib/types/api";
import type { MarketEntry, TradeType } from "@/lib/types/game";

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

interface ConvoyTradeRequest {
  goodId: string;
  quantity: number;
  type: TradeType;
}

export function useConvoyTradeMutation({
  convoyId,
  stationId,
  systemId,
}: {
  convoyId: string | null;
  stationId: string | null;
  systemId: string | null;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: ConvoyTradeRequest) => {
      if (!convoyId || !stationId) throw new Error("Missing convoyId or stationId");
      return apiMutate<ConvoyTradeResult>(
        `/api/game/convoy/${convoyId}/trade`,
        { ...request, stationId } satisfies ShipTradeRequest,
      );
    },
    onSuccess: (data) => {
      // Instant UI update: patch the market cache with the updated entry
      if (systemId && data.updatedMarket) {
        queryClient.setQueryData(
          queryKeys.market(systemId),
          (old: { stationId: string; entries: MarketEntry[] } | undefined) => {
            if (!old) return old;
            return {
              ...old,
              entries: old.entries.map((e) =>
                e.goodId === data.updatedMarket.goodId
                  ? data.updatedMarket
                  : e,
              ),
            };
          },
        );
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
      queryClient.invalidateQueries({ queryKey: queryKeys.convoys });
      if (systemId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.tradeHistory(systemId) });
      }
    },
  });
}
