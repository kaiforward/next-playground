"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { TileCoord } from "@/lib/engine/tiles";
import type { DynamicTileSystem } from "@/lib/types/game";

/**
 * Fetches dynamic tile data (visibility-gated events, danger, ship presence)
 * for tiles visible in the current camera frustum. Shares viewport state with
 * useStaticTiles to avoid duplicate debounce timers.
 *
 * Unlike static tiles, dynamic tiles have short stale/gc times since the data
 * changes every tick.
 */
export function useDynamicTiles(
  visibleTiles: TileCoord[],
  active: boolean,
): { dynamicSystems: DynamicTileSystem[] } {
  const queries = useQueries({
    queries: visibleTiles.map((tile) => ({
      queryKey: queryKeys.dynamicTile(tile.col, tile.row),
      queryFn: () =>
        apiFetch<{ systems: DynamicTileSystem[] }>(
          `/api/game/systems/tile/dynamic?col=${tile.col}&row=${tile.row}`,
        ),
      staleTime: 10_000,
      gcTime: 30_000,
      enabled: active,
    })),
  });

  const dynamicSystems = useMemo(() => {
    const result: DynamicTileSystem[] = [];
    for (const query of queries) {
      if (query.data) {
        result.push(...query.data.systems);
      }
    }
    return result;
  }, [queries]);

  return { dynamicSystems };
}
