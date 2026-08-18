"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiMutate, apiDelete } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";

/** Every order verb dirties the same surfaces: queues, the faction summary, feasibility, the
 *  Tracker (forming colonies / funded builds), the alert bar (a colony order consumes its Colony
 *  opportunity row, a cancel returns it), and ownership (the map's forming settlement mark).
 *  Refreshing them here is what makes a player action land on every surface immediately instead of
 *  at the next tick broadcast. */
function invalidateOrderSurfaces(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.systemConstructionAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.factionConstructionAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.systemBuildOptionsAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tracker });
  void queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
  void queryClient.invalidateQueries({ queryKey: queryKeys.ownership });
  // A colony order pays its charter at the click — the treasury's committed line moves with it.
  void queryClient.invalidateQueries({ queryKey: queryKeys.factionTreasuryAll });
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
