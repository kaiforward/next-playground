"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiMutate, apiDelete } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";

/** Every order verb dirties the same three surfaces: queues, the faction summary, and feasibility. */
function invalidateOrderSurfaces(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.systemConstructionAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.factionConstructionAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.systemBuildOptionsAll });
}

/** Queue a build/upgrade order for one building type at a system (`POST .../build-orders`). */
export function useOrderBuild(systemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { buildingType: string; levels: number }) =>
      apiMutate<{ projectId: string; levels: number }>(`/api/game/systems/${systemId}/build-orders`, input),
    onSuccess: () => invalidateOrderSurfaces(queryClient),
  });
}

/** Queue a colony-founding order for a system (`POST .../colony-orders`). */
export function useOrderColony(systemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiMutate<{ projectId: string }>(`/api/game/systems/${systemId}/colony-orders`),
    onSuccess: () => invalidateOrderSurfaces(queryClient),
  });
}

/** Cancel a queued construction project (`DELETE /api/game/construction-orders/[projectId]`). */
export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string }) =>
      apiDelete<{ projectId: string }>(`/api/game/construction-orders/${input.projectId}`),
    onSuccess: () => invalidateOrderSurfaces(queryClient),
  });
}

/** Toggle player automation for build/colonisation orders (`POST /api/game/player/automation`). */
export function useSetAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { build: boolean; colonisation: boolean }) =>
      apiMutate<{ build: boolean; colonisation: boolean }>(`/api/game/player/automation`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.factionConstructionAll });
    },
  });
}
