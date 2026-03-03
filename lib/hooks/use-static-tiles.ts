"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import { frustumToTiles } from "@/lib/engine/tiles";
import { ACTIVE_SCALE } from "@/lib/constants/universe-gen";
import type { ViewportBounds, StaticTileSystem } from "@/lib/types/game";

/** Zoom threshold: start fetching tiles before names appear (0.45) but after universe view. */
const NAME_ZOOM_THRESHOLD = 0.35;

/** Leading-edge throttle: fire immediately, then suppress for this duration. */
const THROTTLE_MS = 150;

/**
 * Fetches static tile data (system names + economy types) for tiles visible
 * in the current camera frustum. Activates before system labels appear (0.35)
 * so data is ready by the time names render (0.45). Uses immutable TanStack
 * Query caching — tiles are never refetched once loaded.
 *
 * Returns an `onViewportChange` callback matching the PixiMapCanvas contract.
 */
export function useStaticTiles() {
  const [viewport, setViewport] = useState<ViewportBounds | null>(null);
  const [zoom, setZoom] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const pendingRef = useRef<{ bounds: ViewportBounds; zoom: number } | null>(null);

  const onViewportChange = useCallback(
    (bounds: ViewportBounds, z: number) => {
      if (!timerRef.current) {
        // Leading edge: fire immediately, start cooldown
        setViewport(bounds);
        setZoom(z);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          // Trailing edge: flush the most recent suppressed value so we
          // never lose the final viewport state when zoom/pan stops
          if (pendingRef.current) {
            const { bounds: b, zoom: pz } = pendingRef.current;
            pendingRef.current = null;
            setViewport(b);
            setZoom(pz);
          }
        }, THROTTLE_MS);
      } else {
        // Suppressed: store latest value for trailing edge
        pendingRef.current = { bounds, zoom: z };
      }
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
      queryKey: queryKeys.staticTile(tile.col, tile.row, ACTIVE_SCALE),
      queryFn: () =>
        apiFetch<{ systems: StaticTileSystem[] }>(
          `/api/game/systems/tile/static?col=${tile.col}&row=${tile.row}&scale=${ACTIVE_SCALE}`,
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

  return { systems, onViewportChange, active };
}
