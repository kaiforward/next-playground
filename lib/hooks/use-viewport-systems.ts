"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { StarSystemInfo, ViewportBounds } from "@/lib/types/game";

export type { ViewportBounds };

const DEBOUNCE_MS = 200;
const VIEWPORT_BUFFER = 2; // Fetch 2x viewport size to avoid re-fetches on small pans

/** Quantize bounds to reduce unique query keys (snaps to grid of 500) */
function quantizeBounds(bounds: ViewportBounds): ViewportBounds {
  const grid = 500;
  return {
    minX: Math.floor(bounds.minX / grid) * grid,
    minY: Math.floor(bounds.minY / grid) * grid,
    maxX: Math.ceil(bounds.maxX / grid) * grid,
    maxY: Math.ceil(bounds.maxY / grid) * grid,
  };
}

function boundsToKey(bounds: ViewportBounds): string {
  return `${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`;
}

function bufferBounds(bounds: ViewportBounds): ViewportBounds {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const padW = (w * (VIEWPORT_BUFFER - 1)) / 2;
  const padH = (h * (VIEWPORT_BUFFER - 1)) / 2;
  return {
    minX: bounds.minX - padW,
    minY: bounds.minY - padH,
    maxX: bounds.maxX + padW,
    maxY: bounds.maxY + padH,
  };
}

export function useViewportSystems() {
  const [debouncedBounds, setDebouncedBounds] = useState<ViewportBounds | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const onViewportChange = useCallback((bounds: ViewportBounds) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const buffered = bufferBounds(bounds);
      const quantized = quantizeBounds(buffered);
      setDebouncedBounds(quantized);
    }, DEBOUNCE_MS);
  }, []);

  const boundsKey = debouncedBounds ? boundsToKey(debouncedBounds) : "";

  const { data: systems } = useQuery({
    queryKey: queryKeys.viewportSystems(boundsKey),
    queryFn: () =>
      apiFetch<StarSystemInfo[]>(
        `/api/game/systems/viewport?minX=${debouncedBounds!.minX}&minY=${debouncedBounds!.minY}&maxX=${debouncedBounds!.maxX}&maxY=${debouncedBounds!.maxY}`,
      ),
    enabled: debouncedBounds !== null,
    staleTime: 30_000,
  });

  return { systems: systems ?? null, onViewportChange };
}
