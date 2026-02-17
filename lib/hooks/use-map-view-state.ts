"use client";

import { useCallback, useMemo, useState } from "react";
import type { UniverseData, StarSystemInfo, ShipState } from "@/lib/types/game";
import {
  getMapSessionState,
  setMapSessionState,
} from "@/components/map/map-session";

// ── Types ───────────────────────────────────────────────────────

export type MapViewLevel =
  | { level: "region" }
  | { level: "system"; regionId: string };

interface UseMapViewStateOptions {
  universe: UniverseData;
  ships: ShipState[];
  systemRegionMap: Map<string, string>;
  initialSelectedShipId?: string;
  initialSelectedSystemId?: string;
}

export interface MapViewState {
  viewLevel: MapViewLevel;
  selectedSystem: StarSystemInfo | null;
  mapReady: boolean;
  drillIntoRegion: (regionId: string) => void;
  selectSystem: (system: StarSystemInfo) => void;
  closeSystem: () => void;
  backToRegions: () => void;
  jumpToRegion: (regionId: string) => void;
  setMapReady: () => void;
  needsInitialCenter: boolean;
  initialSelectedSystem: StarSystemInfo | null;
}

// ── Hook ────────────────────────────────────────────────────────

export function useMapViewState({
  universe,
  ships,
  systemRegionMap,
  initialSelectedShipId,
  initialSelectedSystemId,
}: UseMapViewStateOptions): MapViewState {
  // Mount priority chain: query param → session storage → ship fallback
  const initialState = useMemo((): {
    viewLevel: MapViewLevel;
    selectedSystem: StarSystemInfo | null;
  } => {
    // 1. Query param — highest priority
    if (initialSelectedSystemId) {
      const system = universe.systems.find(
        (s) => s.id === initialSelectedSystemId,
      );
      if (system) {
        return {
          viewLevel: { level: "system", regionId: system.regionId },
          selectedSystem: system,
        };
      }
    }

    // 2. Session storage — middle priority
    const session = getMapSessionState();
    if (session?.regionId) {
      const region = universe.regions.find((r) => r.id === session.regionId);
      if (region) {
        const selectedSystem = session.selectedSystemId
          ? (universe.systems.find((s) => s.id === session.selectedSystemId) ??
            null)
          : null;
        return {
          viewLevel: { level: "system", regionId: session.regionId },
          selectedSystem,
        };
      }
    }

    // 3. Ship-based fallback — lowest priority
    const dockedShip = initialSelectedShipId
      ? ships.find(
          (s) => s.id === initialSelectedShipId && s.status === "docked",
        )
      : ships.find((s) => s.status === "docked");

    if (dockedShip) {
      const regionId = systemRegionMap.get(dockedShip.systemId);
      if (regionId)
        return { viewLevel: { level: "system", regionId }, selectedSystem: null };
    }

    return { viewLevel: { level: "region" }, selectedSystem: null };
    // Only compute on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [viewLevel, setViewLevel] = useState<MapViewLevel>(
    initialState.viewLevel,
  );
  const [selectedSystem, setSelectedSystem] = useState<StarSystemInfo | null>(
    initialState.selectedSystem,
  );
  // Hide map until initial setCenter completes to avoid fitView → snap flash
  const [mapReady, setMapReadyState] = useState(
    !initialSelectedSystemId || !initialState.selectedSystem,
  );

  // ── Named actions (encapsulate session writes) ────────────────

  const drillIntoRegion = useCallback((regionId: string) => {
    setViewLevel({ level: "system", regionId });
    setMapSessionState({ regionId });
  }, []);

  const selectSystem = useCallback(
    (system: StarSystemInfo) => {
      setSelectedSystem(system);
      if (viewLevel.level === "system") {
        setMapSessionState({
          regionId: viewLevel.regionId,
          selectedSystemId: system.id,
        });
      }
    },
    [viewLevel],
  );

  const closeSystem = useCallback(() => {
    setSelectedSystem(null);
    if (viewLevel.level === "system") {
      setMapSessionState({ regionId: viewLevel.regionId });
    }
  }, [viewLevel]);

  const backToRegions = useCallback(() => {
    setSelectedSystem(null);
    setViewLevel({ level: "region" });
    setMapSessionState(null);
  }, []);

  const jumpToRegion = useCallback((regionId: string) => {
    setSelectedSystem(null);
    setViewLevel({ level: "system", regionId });
    setMapSessionState({ regionId });
  }, []);

  const setMapReady = useCallback(() => {
    setMapReadyState(true);
  }, []);

  const needsInitialCenter = Boolean(
    initialSelectedSystemId && initialState.selectedSystem,
  );

  return {
    viewLevel,
    selectedSystem,
    mapReady,
    drillIntoRegion,
    selectSystem,
    closeSystem,
    backToRegions,
    jumpToRegion,
    setMapReady,
    needsInitialCenter,
    initialSelectedSystem: initialState.selectedSystem,
  };
}
