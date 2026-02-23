"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type NodeMouseHandler,
  type ReactFlowInstance,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { UniverseData, ShipState, ConvoyState, ActiveEvent } from "@/lib/types/game";
import type { NavigableUnit } from "@/lib/types/navigable";
import { shipToNavigableUnit, convoyToNavigableUnit } from "@/lib/types/navigable";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { SystemNode } from "@/components/map/system-node";
import { RegionNode } from "@/components/map/region-node";
import { SystemDetailPanel } from "@/components/map/system-detail-panel";
import { Button } from "@/components/ui/button";
import { RoutePreviewPanel } from "@/components/map/route-preview-panel";
import { useNavigationState } from "@/lib/hooks/use-navigation-state";
import { useMapViewState } from "@/lib/hooks/use-map-view-state";
import { useMapGraph } from "@/lib/hooks/use-map-graph";
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

// IMPORTANT: nodeTypes must be defined outside the component to prevent
// infinite re-renders. React Flow compares this by reference.
const nodeTypes = {
  systemNode: SystemNode,
  regionNode: RegionNode,
};

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
  const rfInstance = useRef<ReactFlowInstance | null>(null);

  // ── Foundation memos (stable across renders) ──────────────────
  const systemRegionMap = useMemo(
    () => buildSystemRegionMap(universe.systems),
    [universe.systems],
  );

  const regionMap = useMemo(
    () => new Map(universe.regions.map((r) => [r.id, r])),
    [universe.regions],
  );

  // ── All connections (needed by both navigation and graph hooks) ─
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
    initialSelectedShipId: initialSelectedShipId ?? initialSelectedConvoyId,
    initialSelectedSystemId,
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

  // ── Derived graph data (nodes, edges, detail panel) ───────────
  const graph = useMapGraph({
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
    // Only run on mount / when the prop changes
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
    // Only run on mount / when the prop changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedConvoyId]);

  // ── fitView on view level transitions ─────────────────────────
  const prevViewLevelRef = useRef(view.viewLevel);
  useEffect(() => {
    if (prevViewLevelRef.current !== view.viewLevel) {
      prevViewLevelRef.current = view.viewLevel;
      const timer = setTimeout(() => {
        rfInstance.current?.fitView({ padding: 0.3, duration: 300 });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [view.viewLevel]);

  // ── Destructure stable references for callback deps ──────────
  const {
    viewLevel, selectedSystem, drillIntoRegion, selectSystem,
    closeSystem, setMapReady, initialSelectedSystem,
  } = view;
  const { activeRegionSystems, regionNavigationStates } = graph;

  // ── Click handlers ────────────────────────────────────────────
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // Region view — click drills into that region
      if (viewLevel.level === "region") {
        if (isNavigationActive && regionNavigationStates.get(node.id) === "unreachable") {
          return;
        }
        drillIntoRegion(node.id);
        return;
      }

      // System view — navigation logic
      if (mode.phase === "unit_selected") {
        if (!mode.reachable.has(node.id) && node.id !== mode.unit.systemId) {
          return;
        }
        if (node.id === mode.unit.systemId) {
          navigation.cancel();
          return;
        }
        const system = activeRegionSystems.find((s) => s.id === node.id);
        if (system) {
          navigation.selectDestination(system);
        }
        return;
      }

      if (mode.phase === "route_preview") return;

      // Default mode — open system detail panel
      const system = activeRegionSystems.find((s) => s.id === node.id);
      if (system) {
        selectSystem(system);
      }
    },
    [viewLevel, drillIntoRegion, selectSystem, activeRegionSystems, regionNavigationStates, mode, navigation, isNavigationActive],
  );

  const handleSelectUnitForNavigation = useCallback(
    (unit: NavigableUnit) => {
      closeSystem();
      navigation.selectUnit(unit);
    },
    [closeSystem, navigation],
  );

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    rfInstance.current = instance;

    if (initialSelectedSystem) {
      const { x, y } = initialSelectedSystem;
      instance.setCenter(x, y, { zoom: 1.2, duration: 0 });
      setMapReady();
    }
  }, [initialSelectedSystem, setMapReady]);

  return (
    <div className={`relative h-full w-full ${view.mapReady ? "opacity-100" : "opacity-0"}`}>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onInit={handleInit}
        fitView={!view.needsInitialCenter}
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-gray-950"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgba(148, 163, 184, 0.08)"
        />
        <Controls
          className="!bg-gray-800 !border-gray-700 !rounded-lg !shadow-lg [&>button]:!bg-gray-800 [&>button]:!border-gray-700 [&>button]:!text-gray-300 [&>button:hover]:!bg-gray-700"
          showInteractive={false}
        />
      </ReactFlow>

      {/* Back to regions button (system view only) */}
      {viewLevel.level === "system" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={view.backToRegions}
          className="absolute top-4 left-4 z-50 gap-2 rounded-lg border border-white/10 bg-gray-900/90 backdrop-blur py-2 text-sm text-white/70 hover:bg-gray-800/90 shadow-lg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          {graph.activeRegion?.name ?? "Regions"}
        </Button>
      )}

      {/* Region view hint (only when not navigating) */}
      {viewLevel.level === "region" && !isNavigationActive && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-lg border border-white/10 bg-gray-900/90 backdrop-blur px-4 py-2 shadow-lg">
            <span className="text-sm text-white/60">
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
            <span className="text-sm text-white">
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

      {/* Detail panel overlay (hidden during navigation mode, system view only) */}
      {viewLevel.level === "system" && !isNavigationActive && (
        <SystemDetailPanel
          system={selectedSystem}
          shipsHere={graph.shipsAtSelected}
          convoysHere={graph.convoysAtSelected}
          currentTick={currentTick}
          regionName={graph.selectedRegionName}
          gatewayTargetRegions={graph.selectedGatewayTargets}
          activeEvents={graph.eventsAtSelected}
          onSelectUnitForNavigation={handleSelectUnitForNavigation}
          onJumpToRegion={view.jumpToRegion}
          onClose={closeSystem}
        />
      )}
    </div>
  );
}
