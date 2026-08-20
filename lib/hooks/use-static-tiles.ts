"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_UNIVERSE } from "./empty-slices";
import { frustumToTiles, tileBounds } from "@/lib/engine/tiles";
import type { ViewportBounds, StaticTileSystem } from "@/lib/types/game";

/** Zoom threshold: start fetching tiles before names appear (0.45) but after universe view. */
const NAME_ZOOM_THRESHOLD = 0.35;

/** Leading-edge throttle: fire immediately, then suppress for this duration. */
const THROTTLE_MS = 150;

/**
 * System names + economy types for tiles visible in the current camera frustum. Activates before
 * system labels appear (0.35) so data is ready by the time names render (0.45).
 *
 * A pure client-side filter of the store's `universe` slice (`getStaticTile`'s own selection —
 * `lib/services/static-tiles.ts` — filtered by `x`/`y` within `tileBounds`) rather than a fetch:
 * the store already carries every system's name/economyType/x/y at all times (client-runtime build
 * plan Task 7's derivation ledger), so there is nothing to cache-and-fetch that isn't already held.
 *
 * Returns an `onViewportChange` callback matching the PixiMapCanvas contract.
 */
export function useStaticTiles(mapSize: number) {
  const universeSystems = useGameSlice(
    (state) => state.slices.universe?.systems ?? EMPTY_UNIVERSE.systems,
  );

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
    () => (active && viewport ? frustumToTiles(viewport, mapSize) : []),
    [active, viewport, mapSize],
  );

  const systems = useMemo(() => {
    if (visibleTiles.length === 0) return [];
    const result: StaticTileSystem[] = [];
    for (const tile of visibleTiles) {
      const bounds = tileBounds(tile.col, tile.row, mapSize);
      for (const s of universeSystems) {
        if (s.x >= bounds.minX && s.x < bounds.maxX && s.y >= bounds.minY && s.y < bounds.maxY) {
          result.push({ id: s.id, name: s.name, economyType: s.economyType });
        }
      }
    }
    return result;
  }, [visibleTiles, mapSize, universeSystems]);

  // `zoom` is the throttled camera zoom (leading + trailing edge above). Exposed
  // so consumers — e.g. the dev zoom-debug overlay — can read it without adding
  // a second 60fps Pixi→React state path.
  return { systems, onViewportChange, active, zoom };
}
