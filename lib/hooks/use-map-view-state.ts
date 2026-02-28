"use client";

import { useCallback, useMemo, useState } from "react";
import type { UniverseData, StarSystemInfo } from "@/lib/types/game";
import {
  getMapSessionState,
  setMapSessionState,
} from "@/components/map/map-session";

// ── Types ───────────────────────────────────────────────────────

interface UseMapViewStateOptions {
  universe: UniverseData;
  initialSelectedSystemId?: string;
}

export interface MapViewState {
  selectedSystem: StarSystemInfo | null;
  mapReady: boolean;
  selectSystem: (system: StarSystemInfo) => void;
  closeSystem: () => void;
  setMapReady: () => void;
  needsInitialCenter: boolean;
  initialSelectedSystem: StarSystemInfo | null;
}

// ── Hook ────────────────────────────────────────────────────────

export function useMapViewState({
  universe,
  initialSelectedSystemId,
}: UseMapViewStateOptions): MapViewState {
  // Mount priority chain: query param → session storage → ship fallback
  const initialState = useMemo((): {
    selectedSystem: StarSystemInfo | null;
  } => {
    // 1. Query param — highest priority
    if (initialSelectedSystemId) {
      const system = universe.systems.find(
        (s) => s.id === initialSelectedSystemId,
      );
      if (system) {
        return { selectedSystem: system };
      }
    }

    // 2. Session storage — middle priority
    const session = getMapSessionState();
    if (session?.selectedSystemId) {
      const selectedSystem = universe.systems.find(
        (s) => s.id === session.selectedSystemId,
      ) ?? null;
      return { selectedSystem };
    }

    return { selectedSystem: null };
    // Only compute on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedSystem, setSelectedSystem] = useState<StarSystemInfo | null>(
    initialState.selectedSystem,
  );
  // Hide map until initial setCenter completes to avoid fitView → snap flash
  const [mapReady, setMapReadyState] = useState(
    !initialSelectedSystemId || !initialState.selectedSystem,
  );

  // ── Named actions (encapsulate session writes) ────────────────

  const selectSystem = useCallback(
    (system: StarSystemInfo) => {
      setSelectedSystem(system);
      setMapSessionState({ selectedSystemId: system.id });
    },
    [],
  );

  const closeSystem = useCallback(() => {
    setSelectedSystem(null);
    setMapSessionState(null);
  }, []);

  const setMapReady = useCallback(() => {
    setMapReadyState(true);
  }, []);

  const needsInitialCenter = Boolean(
    initialSelectedSystemId && initialState.selectedSystem,
  );

  return {
    selectedSystem,
    mapReady,
    selectSystem,
    closeSystem,
    setMapReady,
    needsInitialCenter,
    initialSelectedSystem: initialState.selectedSystem,
  };
}
