"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import type { UniverseData, ShipState, ConvoyState, ActiveEvent } from "@/lib/types/game";
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

  const regionInfos = useMemo(
    () => universe.regions.map((r) => ({ id: r.id, name: r.name })),
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

  // ── View state (selection, session persistence) ────────────────
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

  // ── Derived map data ────────────────────────────────────────────
  const mapData = useMapData({
    universe,
    ships,
    convoys,
    events,
    selectedSystem: view.selectedSystem,
    navigationMode: mode,
    isNavigationActive,
    systemRegionMap,
    regionMap,
  });

  // ── Auto-select ship/convoy from URL query param on mount ────────
  useEffect(() => {
    if (!initialSelectedShipId) return;
    const ship = ships.find(
      (s) => s.id === initialSelectedShipId && s.status === "docked",
    );
    if (ship) {
      navigation.selectUnit(shipToNavigableUnit(ship));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedShipId]);

  useEffect(() => {
    if (!initialSelectedConvoyId) return;
    const convoy = convoys.find(
      (c) => c.id === initialSelectedConvoyId && c.status === "docked",
    );
    if (convoy) {
      navigation.selectUnit(convoyToNavigableUnit(convoy));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedConvoyId]);

  // ── Destructure stable references for callback deps ──────────
  const {
    selectedSystem, selectSystem,
    closeSystem, setMapReady,
  } = view;

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
        const fullSystem = universe.systems.find((s) => s.id === system.id);
        if (fullSystem) {
          navigation.selectDestination(fullSystem);
        }
        return;
      }

      if (mode.phase === "route_preview") return;

      // Default mode — open system detail panel
      const fullSystem = universe.systems.find((s) => s.id === system.id);
      if (fullSystem) {
        selectSystem(fullSystem);
      }
    },
    [mode, navigation, universe.systems, selectSystem],
  );

  const onEmptyClick = useCallback(() => {
    if (mode.phase === "default") {
      closeSystem();
    }
  }, [mode.phase, closeSystem]);

  // ── Center target (reactive — responds to systemId URL changes) ──
  type CenterTarget = { x: number; y: number; zoom: number };
  const [centerTarget, setCenterTarget] = useState<CenterTarget | undefined>(() => {
    if (!view.initialSelectedSystem) return undefined;
    return { x: view.initialSelectedSystem.x, y: view.initialSelectedSystem.y, zoom: 1.2 };
  });
  const prevSystemIdRef = useRef(initialSelectedSystemId);

  useEffect(() => {
    if (initialSelectedSystemId === prevSystemIdRef.current) return;
    prevSystemIdRef.current = initialSelectedSystemId;
    if (!initialSelectedSystemId) return;
    const system = universe.systems.find((s) => s.id === initialSelectedSystemId);
    if (system) {
      selectSystem(system);
      setCenterTarget({ x: system.x, y: system.y, zoom: 1.2 });
    }
  }, [initialSelectedSystemId, universe.systems, selectSystem]);

  const handleReady = useCallback(() => {
    setMapReady();
  }, [setMapReady]);

  return (
    <div className={`relative h-full w-full ${view.mapReady ? "opacity-100" : "opacity-0"}`}>
      <PixiMapCanvas
        mapData={mapData}
        selectedSystem={selectedSystem}
        navigationMode={mode}
        onSystemClick={onSystemClick}
        onEmptyClick={onEmptyClick}
        centerTarget={centerTarget}
        onReady={handleReady}
        regionInfos={regionInfos}
      />

      {/* Navigation mode banner */}
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

      {/* Detail panel overlay (hidden during navigation mode or when a panel route is open) */}
      {!isNavigationActive && !isPanelOpen && (
        <SystemDetailPanel
          system={selectedSystem}
          shipsHere={mapData.shipsAtSelected}
          convoysHere={mapData.convoysAtSelected}
          regionName={mapData.selectedRegionName}
          gatewayTargetRegions={mapData.selectedGatewayTargets}
          activeEvents={mapData.eventsAtSelected}
          onClose={closeSystem}
        />
      )}
    </div>
  );
}
