"use client";

import { useCallback, useMemo, useState } from "react";
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

import type { UniverseData, StarSystemInfo } from "@/lib/types/game";
import { SystemNode } from "@/components/map/system-node";
import { SystemDetailPanel } from "@/components/map/system-detail-panel";

interface StarMapProps {
  universe: UniverseData;
  initialPlayerSystemId: string;
  onNavigate?: (targetSystemId: string) => Promise<void>;
}

// IMPORTANT: nodeTypes must be defined outside the component to prevent
// infinite re-renders. React Flow compares this by reference.
const nodeTypes = {
  systemNode: SystemNode,
};

// Color mapping for edges based on a subtle glow
const EDGE_COLOR = "rgba(148, 163, 184, 0.4)"; // slate-400 with opacity

export function StarMap({ universe, initialPlayerSystemId, onNavigate }: StarMapProps) {
  const [playerSystemId, setPlayerSystemId] = useState(initialPlayerSystemId);
  const [selectedSystem, setSelectedSystem] = useState<StarSystemInfo | null>(
    null
  );

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
          isPlayerHere: system.id === playerSystemId,
        },
      })),
    [universe.systems, playerSystemId]
  );

  // Convert connections to ReactFlow edges (deduplicated: only use one direction)
  const edges: Edge[] = useMemo(() => {
    // Deduplicate connections: only keep one edge per pair
    const seen = new Set<string>();
    const dedupedEdges: Edge[] = [];

    for (const conn of universe.connections) {
      const pairKey = [conn.fromSystemId, conn.toSystemId].sort().join("--");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      dedupedEdges.push({
        id: conn.id,
        source: conn.fromSystemId,
        target: conn.toSystemId,
        style: {
          stroke: EDGE_COLOR,
          strokeWidth: 1.5,
          strokeDasharray: "6 4",
        },
        animated: false,
        label: `${conn.fuelCost} fuel`,
        labelStyle: {
          fill: "rgba(148, 163, 184, 0.6)",
          fontSize: 10,
          fontWeight: 500,
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
  }, [universe.connections]);

  // Handle node click to select a system
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const system = universe.systems.find((s) => s.id === node.id);
      if (system) {
        setSelectedSystem(system);
      }
    },
    [universe.systems]
  );

  // Handle navigation
  const handleNavigate = useCallback(async () => {
    if (selectedSystem && selectedSystem.id !== playerSystemId) {
      if (onNavigate) {
        await onNavigate(selectedSystem.id);
      }
      setPlayerSystemId(selectedSystem.id);
    }
  }, [selectedSystem, playerSystemId, onNavigate]);

  // Handle panel close
  const handleClose = useCallback(() => {
    setSelectedSystem(null);
  }, []);

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

      {/* Detail panel overlay */}
      <SystemDetailPanel
        system={selectedSystem}
        isPlayerHere={selectedSystem?.id === playerSystemId}
        onNavigate={handleNavigate}
        onClose={handleClose}
      />
    </div>
  );
}
