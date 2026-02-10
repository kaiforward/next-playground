"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type ReactFlowInstance,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { UniverseData, StarSystemInfo, ShipState, RegionInfo } from "@/lib/types/game";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { SystemNode, type NavigationNodeState } from "@/components/map/system-node";
import { RegionNode } from "@/components/map/region-node";
import { SystemDetailPanel } from "@/components/map/system-detail-panel";
import { RoutePreviewPanel } from "@/components/map/route-preview-panel";
import { useNavigationState } from "@/lib/hooks/use-navigation-state";
import {
  buildSystemRegionMap,
  getIntraRegionConnections,
  getInterRegionConnections,
  getGatewayTargetRegions,
} from "@/lib/utils/region";

interface StarMapProps {
  universe: UniverseData;
  ships: ShipState[];
  currentTick: number;
  onNavigateShip: (shipId: string, route: string[]) => Promise<void>;
  initialSelectedShipId?: string;
}

type MapViewLevel =
  | { level: "region" }
  | { level: "system"; regionId: string };

// IMPORTANT: nodeTypes must be defined outside the component to prevent
// infinite re-renders. React Flow compares this by reference.
const nodeTypes = {
  systemNode: SystemNode,
  regionNode: RegionNode,
};

const EDGE_COLOR = "rgba(148, 163, 184, 0.4)";
const EDGE_DIM = "rgba(148, 163, 184, 0.12)";
const EDGE_ROUTE = "rgba(99, 179, 237, 0.9)";
const EDGE_REGION = "rgba(148, 163, 184, 0.5)";

export function StarMap({
  universe,
  ships,
  currentTick,
  onNavigateShip,
  initialSelectedShipId,
}: StarMapProps) {
  const [selectedSystem, setSelectedSystem] = useState<StarSystemInfo | null>(null);
  const rfInstance = useRef<ReactFlowInstance | null>(null);

  // ── Region map (stable memo) ────────────────────────────────────
  const systemRegionMap = useMemo(
    () => buildSystemRegionMap(universe.systems),
    [universe.systems],
  );

  const regionMap = useMemo(
    () => new Map(universe.regions.map((r) => [r.id, r])),
    [universe.regions],
  );

  // ── Auto-focus: start in player's region or region overview ─────
  const initialViewLevel = useMemo((): MapViewLevel => {
    const dockedShip = initialSelectedShipId
      ? ships.find((s) => s.id === initialSelectedShipId && s.status === "docked")
      : ships.find((s) => s.status === "docked");

    if (dockedShip) {
      const regionId = systemRegionMap.get(dockedShip.systemId);
      if (regionId) return { level: "system", regionId };
    }
    return { level: "region" };
    // Only compute on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [viewLevel, setViewLevel] = useState<MapViewLevel>(initialViewLevel);

  // ── Intra-region connections for system view ────────────────────
  const activeRegionConnections = useMemo((): ConnectionInfo[] => {
    if (viewLevel.level !== "system") return [];
    return getIntraRegionConnections(
      viewLevel.regionId,
      universe.connections,
      systemRegionMap,
    ).map((c) => ({
      fromSystemId: c.fromSystemId,
      toSystemId: c.toSystemId,
      fuelCost: c.fuelCost,
    }));
  }, [viewLevel, universe.connections, systemRegionMap]);

  // ── Active region systems ───────────────────────────────────────
  const activeRegionSystems = useMemo((): StarSystemInfo[] => {
    if (viewLevel.level !== "system") return [];
    return universe.systems.filter((s) => s.regionId === viewLevel.regionId);
  }, [viewLevel, universe.systems]);

  // ── Navigation hook — scoped to active region ───────────────────
  const navigation = useNavigationState({
    connections: activeRegionConnections,
    systems: activeRegionSystems,
    onNavigateShip,
  });

  const { mode } = navigation;
  const isNavigationActive = mode.phase !== "default";

  // Auto-select ship from URL query param on mount
  useEffect(() => {
    if (!initialSelectedShipId) return;
    if (viewLevel.level !== "system") return;
    const ship = ships.find(
      (s) => s.id === initialSelectedShipId && s.status === "docked",
    );
    if (ship) {
      navigation.selectShip(ship);
    }
    // Only run on mount / when the prop changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedShipId]);

  // ── fitView on view level transitions ───────────────────────────
  const prevViewLevelRef = useRef(viewLevel);
  useEffect(() => {
    if (prevViewLevelRef.current !== viewLevel) {
      prevViewLevelRef.current = viewLevel;
      // Short delay to let React Flow render new nodes before fitting
      const timer = setTimeout(() => {
        rfInstance.current?.fitView({ padding: 0.3, duration: 300 });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [viewLevel]);

  // ── Compute ship counts per system (docked ships only) ──────────
  const shipsAtSystem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ship of ships) {
      if (ship.status === "docked") {
        map[ship.systemId] = (map[ship.systemId] ?? 0) + 1;
      }
    }
    return map;
  }, [ships]);

  // ── Ships per region ────────────────────────────────────────────
  const shipsPerRegion = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ship of ships) {
      if (ship.status === "docked") {
        const regionId = systemRegionMap.get(ship.systemId);
        if (regionId) {
          map[regionId] = (map[regionId] ?? 0) + 1;
        }
      }
    }
    return map;
  }, [ships, systemRegionMap]);

  // ── Systems per region ──────────────────────────────────────────
  const systemsPerRegion = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of universe.systems) {
      map[s.regionId] = (map[s.regionId] ?? 0) + 1;
    }
    return map;
  }, [universe.systems]);

  // Ships docked at the selected system
  const shipsAtSelected = useMemo(
    () =>
      selectedSystem
        ? ships.filter((s) => s.status === "docked" && s.systemId === selectedSystem.id)
        : [],
    [selectedSystem, ships],
  );

  // ── Navigation state per node (system view only) ────────────────
  const nodeNavigationStates = useMemo((): Map<string, NavigationNodeState> => {
    const states = new Map<string, NavigationNodeState>();
    if (viewLevel.level !== "system") return states;

    if (mode.phase === "ship_selected") {
      const originId = mode.ship.systemId;
      for (const system of activeRegionSystems) {
        if (system.id === originId) {
          states.set(system.id, "origin");
        } else if (mode.reachable.has(system.id)) {
          states.set(system.id, "reachable");
        } else {
          states.set(system.id, "unreachable");
        }
      }
    } else if (mode.phase === "route_preview") {
      const originId = mode.ship.systemId;
      const destId = mode.destination.id;
      const routeSet = new Set(mode.route.path);

      for (const system of activeRegionSystems) {
        if (system.id === originId) {
          states.set(system.id, "origin");
        } else if (system.id === destId) {
          states.set(system.id, "destination");
        } else if (routeSet.has(system.id)) {
          states.set(system.id, "route_hop");
        } else if (mode.reachable.has(system.id)) {
          states.set(system.id, "reachable");
        } else {
          states.set(system.id, "unreachable");
        }
      }
    }

    return states;
  }, [mode, activeRegionSystems, viewLevel]);

  // Route edges set (for highlighting)
  const routeEdgeSet = useMemo((): Set<string> => {
    if (mode.phase !== "route_preview") return new Set();
    const set = new Set<string>();
    for (let i = 0; i < mode.route.path.length - 1; i++) {
      const key = [mode.route.path[i], mode.route.path[i + 1]].sort().join("--");
      set.add(key);
    }
    return set;
  }, [mode]);

  // ── Inter-region edges (for region view) ────────────────────────
  const interRegionEdges = useMemo((): Edge[] => {
    const crossConns = getInterRegionConnections(universe.connections, systemRegionMap);
    const seen = new Set<string>();
    const edges: Edge[] = [];

    for (const c of crossConns) {
      const rFrom = systemRegionMap.get(c.fromSystemId)!;
      const rTo = systemRegionMap.get(c.toSystemId)!;
      const pairKey = [rFrom, rTo].sort().join("--");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      edges.push({
        id: `region-${pairKey}`,
        source: rFrom,
        target: rTo,
        style: {
          stroke: EDGE_REGION,
          strokeWidth: 3,
          strokeDasharray: "8 4",
        },
      });
    }
    return edges;
  }, [universe.connections, systemRegionMap]);

  // ── Nodes & edges based on view level ───────────────────────────
  const nodes: Node[] = useMemo(() => {
    if (viewLevel.level === "region") {
      return universe.regions.map((region) => ({
        id: region.id,
        type: "regionNode",
        position: { x: region.x, y: region.y },
        data: {
          label: region.name,
          identity: region.identity,
          systemCount: systemsPerRegion[region.id] ?? 0,
          shipCount: shipsPerRegion[region.id] ?? 0,
        },
      }));
    }

    // System view — only systems in active region
    return activeRegionSystems.map((system) => ({
      id: system.id,
      type: "systemNode",
      position: { x: system.x, y: system.y },
      data: {
        label: system.name,
        economyType: system.economyType,
        shipCount: shipsAtSystem[system.id] ?? 0,
        isGateway: system.isGateway,
        navigationState: nodeNavigationStates.get(system.id),
      },
    }));
  }, [
    viewLevel,
    universe.regions,
    activeRegionSystems,
    systemsPerRegion,
    shipsPerRegion,
    shipsAtSystem,
    nodeNavigationStates,
  ]);

  const edges: Edge[] = useMemo(() => {
    if (viewLevel.level === "region") return interRegionEdges;

    // System view — intra-region connections
    const regionConns = getIntraRegionConnections(
      viewLevel.regionId,
      universe.connections,
      systemRegionMap,
    );
    const seen = new Set<string>();
    const dedupedEdges: Edge[] = [];

    for (const conn of regionConns) {
      const pairKey = [conn.fromSystemId, conn.toSystemId].sort().join("--");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const isRouteEdge = routeEdgeSet.has(pairKey);
      const isNavActive = isNavigationActive;

      dedupedEdges.push({
        id: conn.id,
        source: conn.fromSystemId,
        target: conn.toSystemId,
        style: {
          stroke: isRouteEdge ? EDGE_ROUTE : isNavActive ? EDGE_DIM : EDGE_COLOR,
          strokeWidth: isRouteEdge ? 2.5 : 1.5,
          strokeDasharray: isRouteEdge ? undefined : "6 4",
        },
        animated: isRouteEdge,
        label: `${conn.fuelCost} fuel`,
        labelStyle: {
          fill: isRouteEdge
            ? "rgba(99, 179, 237, 0.9)"
            : "rgba(148, 163, 184, 0.6)",
          fontSize: 10,
          fontWeight: isRouteEdge ? 600 : 500,
        },
        labelBgStyle: {
          fill: "rgba(15, 23, 42, 0.8)",
          fillOpacity: 0.8,
        },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
      });
    }

    return dedupedEdges;
  }, [
    viewLevel,
    universe.connections,
    systemRegionMap,
    interRegionEdges,
    routeEdgeSet,
    isNavigationActive,
  ]);

  // ── Gateway target regions for detail panel ─────────────────────
  const selectedGatewayTargets = useMemo(() => {
    if (!selectedSystem?.isGateway) return [];
    const targetRegionIds = getGatewayTargetRegions(
      selectedSystem.id,
      universe.connections,
      systemRegionMap,
    );
    return targetRegionIds
      .map((rid) => {
        const region = regionMap.get(rid);
        return region ? { regionId: rid, regionName: region.name } : null;
      })
      .filter((t): t is { regionId: string; regionName: string } => t !== null);
  }, [selectedSystem, universe.connections, systemRegionMap, regionMap]);

  // ── Active region info for back button ──────────────────────────
  const activeRegion: RegionInfo | undefined =
    viewLevel.level === "system" ? regionMap.get(viewLevel.regionId) : undefined;

  // ── Selected system region name ─────────────────────────────────
  const selectedRegionName = selectedSystem
    ? regionMap.get(selectedSystem.regionId)?.name
    : undefined;

  // ── Click handlers ──────────────────────────────────────────────
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // Region view — click drills into that region
      if (viewLevel.level === "region") {
        setViewLevel({ level: "system", regionId: node.id });
        return;
      }

      // System view — navigation logic
      if (mode.phase === "ship_selected") {
        if (!mode.reachable.has(node.id) && node.id !== mode.ship.systemId) {
          return;
        }
        if (node.id === mode.ship.systemId) {
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
        setSelectedSystem(system);
      }
    },
    [viewLevel, activeRegionSystems, mode, navigation],
  );

  const handleClose = useCallback(() => {
    setSelectedSystem(null);
  }, []);

  const handleSelectShipForNavigation = useCallback(
    (ship: ShipState) => {
      setSelectedSystem(null);
      navigation.selectShip(ship);
    },
    [navigation],
  );

  const handleBackToRegions = useCallback(() => {
    navigation.cancel();
    setSelectedSystem(null);
    setViewLevel({ level: "region" });
  }, [navigation]);

  const handleJumpToRegion = useCallback((regionId: string) => {
    setSelectedSystem(null);
    setViewLevel({ level: "system", regionId });
  }, []);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    rfInstance.current = instance;
  }, []);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onInit={handleInit}
        fitView
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
        <MiniMap
          nodeColor={(node) => {
            const economyColors: Record<string, string> = {
              agricultural: "#22c55e",
              mining: "#f59e0b",
              industrial: "#94a3b8",
              tech: "#3b82f6",
              core: "#a855f7",
            };
            const identityColors: Record<string, string> = {
              resource_rich: "#f59e0b",
              agricultural: "#22c55e",
              industrial: "#94a3b8",
              tech: "#3b82f6",
              trade_hub: "#a855f7",
            };
            const data = node.data as Record<string, unknown>;
            if (data.economyType) {
              return economyColors[data.economyType as string] ?? "#6b7280";
            }
            if (data.identity) {
              return identityColors[data.identity as string] ?? "#6b7280";
            }
            return "#6b7280";
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
          className="!bg-gray-900/90 !border-gray-700 !rounded-lg"
        />
      </ReactFlow>

      {/* Back to regions button (system view only) */}
      {viewLevel.level === "system" && !isNavigationActive && (
        <button
          onClick={handleBackToRegions}
          className="absolute top-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/90 backdrop-blur px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-gray-800/90 transition-colors shadow-lg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          {activeRegion?.name ?? "Regions"}
        </button>
      )}

      {/* Region view hint */}
      {viewLevel.level === "region" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-lg border border-white/10 bg-gray-900/90 backdrop-blur px-4 py-2 shadow-lg">
            <span className="text-sm text-white/60">
              Click a region to explore its systems
            </span>
          </div>
        </div>
      )}

      {/* Navigation mode banner */}
      {mode.phase === "ship_selected" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 rounded-lg border border-cyan-500/30 bg-gray-900/90 backdrop-blur px-4 py-2 shadow-lg">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-sm text-white">
              Select a destination for <span className="font-semibold text-cyan-300">{mode.ship.name}</span>
            </span>
            <button
              onClick={navigation.cancel}
              className="ml-2 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Route preview panel */}
      {mode.phase === "route_preview" && (
        <RoutePreviewPanel
          ship={mode.ship}
          destination={mode.destination}
          route={mode.route}
          connections={activeRegionConnections}
          systems={activeRegionSystems}
          isNavigating={navigation.isNavigating}
          onConfirm={navigation.confirmNavigation}
          onCancel={navigation.cancel}
        />
      )}

      {/* Detail panel overlay (hidden during navigation mode, system view only) */}
      {viewLevel.level === "system" && !isNavigationActive && (
        <SystemDetailPanel
          system={selectedSystem}
          shipsHere={shipsAtSelected}
          currentTick={currentTick}
          regionName={selectedRegionName}
          gatewayTargetRegions={selectedGatewayTargets}
          onSelectShipForNavigation={handleSelectShipForNavigation}
          onJumpToRegion={handleJumpToRegion}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
