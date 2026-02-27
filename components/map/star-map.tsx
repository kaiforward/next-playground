"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import type { UniverseData, ShipState, ConvoyState, ActiveEvent } from "@/lib/types/game";
import type { NavigableUnit } from "@/lib/types/navigable";
import { shipToNavigableUnit, convoyToNavigableUnit } from "@/lib/types/navigable";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { SystemDetailPanel } from "@/components/map/system-detail-panel";
import { Button } from "@/components/ui/button";
import { RoutePreviewPanel } from "@/components/map/route-preview-panel";
import { PixiMapCanvas } from "@/components/map/pixi/pixi-map-canvas";
import { useNavigationState } from "@/lib/hooks/use-navigation-state";
import { useMapViewState } from "@/lib/hooks/use-map-view-state";
import { useMapData } from "@/lib/hooks/use-map-data";
import { buildSystemRegionMap } from "@/lib/utils/region";

interface StarMapProps {
  universe: UniverseData;
  ships: ShipState[];
  convoys: ConvoyState[];
  currentTick: number;
  onNavigateShip: (shipId: string, route: string[]) => Promise<void>;
  onNavigateConvoy?: (convoyId: string, route: string[]) => Promise<void>;
  initialSelectedShipId?: string;
  initialSelectedConvoyId?: string;
  initialSelectedSystemId?: string;
  events?: ActiveEvent[];
}

export function StarMap({
  universe,
  ships,
  convoys,
  currentTick,
  onNavigateShip,
  onNavigateConvoy,
  initialSelectedShipId,
  initialSelectedConvoyId,
  initialSelectedSystemId,
  events = [],
}: StarMapProps) {
  // ── Foundation memos (stable across renders) ──────────────────
  const systemRegionMap = useMemo(
    () => buildSystemRegionMap(universe.systems),
    [universe.systems],
  );

  const regionMap = useMemo(
    () => new Map(universe.regions.map((r) => [r.id, r])),
    [universe.regions],
  );

  // ── All connections (needed by both navigation and data hooks) ─
  const allConnections = useMemo(
    (): ConnectionInfo[] =>
      universe.connections.map((c) => ({
        fromSystemId: c.fromSystemId,
        toSystemId: c.toSystemId,
        fuelCost: c.fuelCost,
      })),
    [universe.connections],
  );

  // ── View state (level, selection, session persistence) ────────
  const view = useMapViewState({
    universe,
    ships,
    systemRegionMap,
    initialSelectedShipId,
    initialSelectedSystemId: initialSelectedSystemId ?? (initialSelectedConvoyId
      ? convoys.find((c) => c.id === initialSelectedConvoyId)?.systemId
      : undefined),
  });

  // ── Navigation state ──────────────────────────────────────────
  const navigation = useNavigationState({
    connections: allConnections,
    systems: universe.systems,
    onNavigateShip,
    onNavigateConvoy,
  });

  const { mode } = navigation;
  const isNavigationActive = mode.phase !== "default";

  // Hide tier-1 quick-preview when a tier-2 panel route is active
  const pathname = usePathname();
  const isPanelOpen = pathname !== "/";

  // ── Derived map data (replaces useMapGraph) ────────────────────
  const mapData = useMapData({
    universe,
    ships,
    convoys,
    events,
    viewLevel: view.viewLevel,
    selectedSystem: view.selectedSystem,
    navigationMode: mode,
    isNavigationActive,
    systemRegionMap,
    regionMap,
  });

  // ── Auto-select ship from URL query param on mount ────────────
  useEffect(() => {
    if (!initialSelectedShipId) return;
    if (view.viewLevel.level !== "system") return;
    const ship = ships.find(
      (s) => s.id === initialSelectedShipId && s.status === "docked",
    );
    if (ship) {
      navigation.selectUnit(shipToNavigableUnit(ship));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedShipId]);

  // ── Auto-select convoy from URL query param on mount ──────────
  useEffect(() => {
    if (!initialSelectedConvoyId) return;
    if (view.viewLevel.level !== "system") return;
    const convoy = convoys.find(
      (c) => c.id === initialSelectedConvoyId && c.status === "docked",
    );
    if (convoy) {
      navigation.selectUnit(convoyToNavigableUnit(convoy));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedConvoyId]);

  // ── fitView trigger — incremented on view level changes ───────
  const [fitViewTrigger, setFitViewTrigger] = useState(0);
  const prevViewLevelRef = useRef(view.viewLevel);
  useEffect(() => {
    if (prevViewLevelRef.current !== view.viewLevel) {
      prevViewLevelRef.current = view.viewLevel;
      setFitViewTrigger((n) => n + 1);
    }
  }, [view.viewLevel]);

  // ── Destructure stable references for callback deps ──────────
  const {
    viewLevel, selectedSystem, drillIntoRegion, selectSystem,
    closeSystem, setMapReady, initialSelectedSystem,
  } = view;
  const { regionNavigationStates } = mapData;

  // ── Click handlers ────────────────────────────────────────────
  const onSystemClick = useCallback(
    (system: { id: string }) => {
      // Navigation logic
      if (mode.phase === "unit_selected") {
        if (!mode.reachable.has(system.id) && system.id !== mode.unit.systemId) {
          return;
        }
        if (system.id === mode.unit.systemId) {
          navigation.cancel();
          return;
        }
        const fullSystem = mapData.activeRegionSystems.find((s) => s.id === system.id);
        if (fullSystem) {
          navigation.selectDestination(fullSystem);
        }
        return;
      }

      if (mode.phase === "route_preview") return;

      // Default mode — open system detail panel
      const fullSystem = mapData.activeRegionSystems.find((s) => s.id === system.id);
      if (fullSystem) {
        selectSystem(fullSystem);
      }
    },
    [mode, navigation, mapData.activeRegionSystems, selectSystem],
  );

  const onRegionClick = useCallback(
    (regionId: string) => {
      if (isNavigationActive && regionNavigationStates.get(regionId) === "unreachable") {
        return;
      }
      drillIntoRegion(regionId);
    },
    [drillIntoRegion, isNavigationActive, regionNavigationStates],
  );

  const onEmptyClick = useCallback(() => {
    if (mode.phase === "default") {
      closeSystem();
    }
  }, [mode.phase, closeSystem]);

  const handleSelectUnitForNavigation = useCallback(
    (unit: NavigableUnit) => {
      closeSystem();
      navigation.selectUnit(unit);
    },
    [closeSystem, navigation],
  );

  // ── Center target (for initial system focus) ──────────────────
  const centerTarget = useMemo(() => {
    if (!initialSelectedSystem) return undefined;
    return { x: initialSelectedSystem.x, y: initialSelectedSystem.y, zoom: 1.2 };
  }, [initialSelectedSystem]);

  const handleReady = useCallback(() => {
    setMapReady();
  }, [setMapReady]);

  return (
    <div className={`relative h-full w-full ${view.mapReady ? "opacity-100" : "opacity-0"}`}>
      <PixiMapCanvas
        mapData={mapData}
        viewLevel={viewLevel}
        selectedSystem={selectedSystem}
        navigationMode={mode}
        onSystemClick={onSystemClick}
        onRegionClick={onRegionClick}
        onEmptyClick={onEmptyClick}
        fitViewTrigger={fitViewTrigger}
        centerTarget={centerTarget}
        onReady={handleReady}
      />

      {/* Back to regions button (system view only) */}
      {viewLevel.level === "system" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={view.backToRegions}
          className="absolute top-4 left-4 z-50 gap-2 rounded-lg border border-border bg-gray-900/90 backdrop-blur py-2 text-sm text-text-secondary hover:bg-gray-800/90 shadow-lg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          {mapData.activeRegion?.name ?? "Regions"}
        </Button>
      )}

      {/* Region view hint (only when not navigating) */}
      {viewLevel.level === "region" && !isNavigationActive && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-lg border border-border bg-gray-900/90 backdrop-blur px-4 py-2 shadow-lg">
            <span className="text-sm text-text-secondary">
              Click a region to explore its systems
            </span>
          </div>
        </div>
      )}

      {/* Navigation mode banner (shown on both region and system views) */}
      {mode.phase === "unit_selected" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 rounded-lg border border-cyan-500/30 bg-gray-900/90 backdrop-blur px-4 py-2 shadow-lg">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-sm text-text-primary">
              Select a destination for <span className="font-semibold text-cyan-300">{mode.unit.name}</span>
              {mode.unit.kind === "convoy" && (
                <span className="text-cyan-300/60 ml-1">({mode.unit.convoy.members.length} ships)</span>
              )}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={navigation.cancel}
              className="ml-2"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Route preview panel */}
      {mode.phase === "route_preview" && (
        <RoutePreviewPanel
          unit={mode.unit}
          destination={mode.destination}
          route={mode.route}
          connections={allConnections}
          systems={universe.systems}
          isNavigating={navigation.isNavigating}
          onConfirm={navigation.confirmNavigation}
          onCancel={navigation.cancel}
        />
      )}

      {/* Detail panel overlay (hidden during navigation mode, when a panel route is open, or on region view) */}
      {viewLevel.level === "system" && !isNavigationActive && !isPanelOpen && (
        <SystemDetailPanel
          system={selectedSystem}
          shipsHere={mapData.shipsAtSelected}
          convoysHere={mapData.convoysAtSelected}
          currentTick={currentTick}
          regionName={mapData.selectedRegionName}
          gatewayTargetRegions={mapData.selectedGatewayTargets}
          activeEvents={mapData.eventsAtSelected}
          onSelectUnitForNavigation={handleSelectUnitForNavigation}
          onJumpToRegion={view.jumpToRegion}
          onClose={closeSystem}
        />
      )}
    </div>
  );
}
