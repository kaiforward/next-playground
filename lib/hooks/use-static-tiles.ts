"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import { frustumToTiles } from "@/lib/engine/tiles";
import type { ViewportBounds, StaticTileSystem } from "@/lib/types/game";

/** Zoom threshold: start fetching tiles when system objects become active. */
const NAME_ZOOM_THRESHOLD = 0.28;

/** Debounce viewport updates to avoid 60fps React state churn during zoom. */
const DEBOUNCE_MS = 100;

/**
 * Fetches static tile data (system names + economy types) for tiles visible
 * in the current camera frustum. Only active when zoomed in enough to show
 * system labels. Uses immutable TanStack Query caching — tiles are never
 * refetched once loaded.
 *
 * Returns an `onViewportChange` callback matching the PixiMapCanvas contract.
 */
export function useStaticTiles() {
  const [viewport, setViewport] = useState<ViewportBounds | null>(null);
  const [zoom, setZoom] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const onViewportChange = useCallback(
    (bounds: ViewportBounds, z: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setViewport(bounds);
        setZoom(z);
      }, DEBOUNCE_MS);
    },
    [],
  );

  const active = viewport !== null && zoom >= NAME_ZOOM_THRESHOLD;

  const visibleTiles = useMemo(
    () => (active ? frustumToTiles(viewport) : []),
    [active, viewport],
  );

  const queries = useQueries({
    queries: visibleTiles.map((tile) => ({
      queryKey: queryKeys.staticTile(tile.col, tile.row),
      queryFn: () =>
        apiFetch<{ systems: StaticTileSystem[] }>(
          `/api/game/systems/tile/static?col=${tile.col}&row=${tile.row}`,
        ),
      staleTime: Infinity,
      gcTime: Infinity,
      enabled: active,
    })),
  });

  const systems = useMemo(() => {
    const result: StaticTileSystem[] = [];
    for (const query of queries) {
      if (query.data) {
        result.push(...query.data.systems);
      }
    }
    return result;
  }, [queries]);

  return { systems, onViewportChange };
}
