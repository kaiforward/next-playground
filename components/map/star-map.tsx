"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { UniverseData, StarSystemInfo, ShipState } from "@/lib/types/game";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { SystemNode, type NavigationNodeState } from "@/components/map/system-node";
import { SystemDetailPanel } from "@/components/map/system-detail-panel";
import { RoutePreviewPanel } from "@/components/map/route-preview-panel";
import { useNavigationState } from "@/lib/hooks/use-navigation-state";

interface StarMapProps {
  universe: UniverseData;
  ships: ShipState[];
  currentTick: number;
  onNavigateShip: (shipId: string, route: string[]) => Promise<void>;
  initialSelectedShipId?: string;
}

// IMPORTANT: nodeTypes must be defined outside the component to prevent
// infinite re-renders. React Flow compares this by reference.
const nodeTypes = {
  systemNode: SystemNode,
};

const EDGE_COLOR = "rgba(148, 163, 184, 0.4)";
const EDGE_DIM = "rgba(148, 163, 184, 0.12)";
const EDGE_ROUTE = "rgba(99, 179, 237, 0.9)";

export function StarMap({
  universe,
  ships,
  currentTick,
  onNavigateShip,
  initialSelectedShipId,
}: StarMapProps) {
  const [selectedSystem, setSelectedSystem] = useState<StarSystemInfo | null>(null);

  // Convert universe connections to engine ConnectionInfo format
  const connectionInfos: ConnectionInfo[] = useMemo(
    () =>
      universe.connections.map((c) => ({
        fromSystemId: c.fromSystemId,
        toSystemId: c.toSystemId,
        fuelCost: c.fuelCost,
      })),
    [universe.connections],
  );

  const navigation = useNavigationState({
    connections: connectionInfos,
    systems: universe.systems,
    onNavigateShip,
  });

  const { mode } = navigation;
  const isNavigationActive = mode.phase !== "default";

  // Auto-select ship from URL query param on mount
  useEffect(() => {
    if (!initialSelectedShipId) return;
    const ship = ships.find(
      (s) => s.id === initialSelectedShipId && s.status === "docked",
    );
    if (ship) {
      navigation.selectShip(ship);
    }
    // Only run on mount / when the prop changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedShipId]);

  // Compute ship counts per system (docked ships only)
  const shipsAtSystem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ship of ships) {
      if (ship.status === "docked") {
        map[ship.systemId] = (map[ship.systemId] ?? 0) + 1;
      }
    }
    return map;
  }, [ships]);

  // Ships docked at the selected system
  const shipsAtSelected = useMemo(
    () =>
      selectedSystem
        ? ships.filter((s) => s.status === "docked" && s.systemId === selectedSystem.id)
        : [],
    [selectedSystem, ships],
  );

  // Compute navigation state for each node
  const nodeNavigationStates = useMemo((): Map<string, NavigationNodeState> => {
    const states = new Map<string, NavigationNodeState>();

    if (mode.phase === "ship_selected") {
      const originId = mode.ship.systemId;
      for (const system of universe.systems) {
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

      for (const system of universe.systems) {
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
  }, [mode, universe.systems]);

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

  // Convert universe data to ReactFlow nodes
  const nodes: Node[] = useMemo(
    () =>
      universe.systems.map((system) => ({
        id: system.id,
        type: "systemNode",
        position: { x: system.x, y: system.y },
        data: {
          label: system.name,
          economyType: system.economyType,
          shipCount: shipsAtSystem[system.id] ?? 0,
          navigationState: nodeNavigationStates.get(system.id),
        },
      })),
    [universe.systems, shipsAtSystem, nodeNavigationStates],
  );

  // Convert connections to ReactFlow edges (deduplicated)
  const edges: Edge[] = useMemo(() => {
    const seen = new Set<string>();
    const dedupedEdges: Edge[] = [];

    for (const conn of universe.connections) {
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
  }, [universe.connections, routeEdgeSet, isNavigationActive]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // In ship_selected phase, clicking a node selects it as destination
      if (mode.phase === "ship_selected") {
        // Clicking unreachable = no-op
        if (!mode.reachable.has(node.id) && node.id !== mode.ship.systemId) {
          return;
        }
        // Clicking origin = cancel navigation
        if (node.id === mode.ship.systemId) {
          navigation.cancel();
          return;
        }
        const system = universe.systems.find((s) => s.id === node.id);
        if (system) {
          navigation.selectDestination(system);
        }
        return;
      }

      // In route_preview phase, clicks are ignored (use panel buttons)
      if (mode.phase === "route_preview") return;

      // Default mode — open system detail panel
      const system = universe.systems.find((s) => s.id === node.id);
      if (system) {
        setSelectedSystem(system);
      }
    },
    [universe.systems, mode, navigation],
  );

  const handleClose = useCallback(() => {
    setSelectedSystem(null);
  }, []);

  // When entering navigation mode, close the detail panel
  const handleSelectShipForNavigation = useCallback(
    (ship: ShipState) => {
      setSelectedSystem(null);
      navigation.selectShip(ship);
    },
    [navigation],
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
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
            return economyColors[(node.data as { economyType?: string })?.economyType ?? ""] ?? "#6b7280";
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
          className="!bg-gray-900/90 !border-gray-700 !rounded-lg"
        />
      </ReactFlow>

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
          connections={connectionInfos}
          systems={universe.systems}
          isNavigating={navigation.isNavigating}
          onConfirm={navigation.confirmNavigation}
          onCancel={navigation.cancel}
        />
      )}

      {/* Detail panel overlay (hidden during navigation mode) */}
      {!isNavigationActive && (
        <SystemDetailPanel
          system={selectedSystem}
          shipsHere={shipsAtSelected}
          currentTick={currentTick}
          onSelectShipForNavigation={handleSelectShipForNavigation}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
