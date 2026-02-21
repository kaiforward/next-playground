"use client";

import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { tv } from "tailwind-variants";
import type { EconomyType, RegionTheme } from "@/lib/types/game";

export type RegionNavigationState = "origin" | "reachable" | "unreachable";

export interface RegionNodeData {
  label: string;
  identity: RegionTheme;
  dominantEconomy?: EconomyType;
  systemCount: number;
  shipCount: number;
  navigationState?: RegionNavigationState;
  [key: string]: unknown;
}

const regionNode = tv({
  base: "relative rounded-xl border-2 px-5 py-4 text-center min-w-[180px] cursor-pointer transition-all hover:scale-105",
  variants: {
    identity: {
      garden_heartland: "bg-green-900/50 border-green-500/70 text-green-100",
      mineral_frontier: "bg-amber-900/50 border-amber-500/70 text-amber-100",
      industrial_corridor: "bg-slate-700/50 border-slate-400/70 text-slate-100",
      research_cluster: "bg-blue-900/50 border-blue-500/70 text-blue-100",
      energy_belt: "bg-cyan-900/50 border-cyan-500/70 text-cyan-100",
      trade_nexus: "bg-purple-900/50 border-purple-500/70 text-purple-100",
      contested_frontier: "bg-red-900/50 border-red-500/70 text-red-100",
      frontier_wilds: "bg-amber-950/50 border-amber-600/70 text-amber-200",
    },
    navigationState: {
      origin: "ring-2 ring-cyan-400 ring-offset-2 ring-offset-gray-950",
      reachable: "ring-2 ring-white/60 ring-offset-2 ring-offset-gray-950",
      unreachable: "opacity-40 grayscale cursor-not-allowed hover:scale-100",
    },
  },
});

const identityLabel = tv({
  base: "text-[10px] font-semibold uppercase tracking-wider opacity-80",
  variants: {
    identity: {
      garden_heartland: "text-green-300",
      mineral_frontier: "text-amber-300",
      industrial_corridor: "text-slate-300",
      research_cluster: "text-blue-300",
      energy_belt: "text-cyan-300",
      trade_nexus: "text-purple-300",
      contested_frontier: "text-red-300",
      frontier_wilds: "text-amber-400",
    },
  },
});

const pulseRing = tv({
  base: "absolute -inset-3 rounded-2xl border-2 animate-ping opacity-40",
  variants: {
    identity: {
      garden_heartland: "border-green-400",
      mineral_frontier: "border-amber-400",
      industrial_corridor: "border-slate-300",
      research_cluster: "border-blue-400",
      energy_belt: "border-cyan-400",
      trade_nexus: "border-purple-400",
      contested_frontier: "border-red-400",
      frontier_wilds: "border-amber-500",
    },
  },
});

export function RegionNode({ data }: NodeProps<Node<RegionNodeData>>) {
  const { label, identity, dominantEconomy, systemCount, shipCount, navigationState } = data;
  const hasShips = shipCount > 0;
  // Hide pulse ring during navigation mode to avoid visual noise
  const showPulse = hasShips && !navigationState;

  return (
    <div className="relative">
      {showPulse && <div className={pulseRing({ identity })} />}

      <Handle
        type="target"
        position={Position.Top}
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-transparent !border-0 !w-0 !h-0"
      />

      <div className={regionNode({ identity, navigationState })}>
        <div className="text-base font-bold leading-tight">{label}</div>
        <div className={identityLabel({ identity })}>
          {identity.replace(/_/g, " ")}
          {dominantEconomy && (
            <span className="text-white/40"> &middot; {dominantEconomy}</span>
          )}
        </div>
        <div className="text-[11px] mt-1 text-white/50">
          {systemCount} system{systemCount !== 1 ? "s" : ""}
        </div>
        {hasShips && (
          <div className="text-[10px] mt-0.5 text-yellow-300 font-medium">
            {shipCount} SHIP{shipCount !== 1 ? "S" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
