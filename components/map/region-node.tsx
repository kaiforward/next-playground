"use client";

import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { tv } from "tailwind-variants";
import type { EconomyType } from "@/lib/types/game";

export type RegionNavigationState = "origin" | "reachable" | "unreachable";

export interface RegionNodeData {
  label: string;
  dominantEconomy?: EconomyType;
  systemCount: number;
  shipCount: number;
  navigationState?: RegionNavigationState;
  [key: string]: unknown;
}

const regionNode = tv({
  base: "relative rounded-xl border-2 px-5 py-4 text-center min-w-[180px] cursor-pointer transition-all hover:scale-105 bg-slate-800/60 border-slate-500/50 text-slate-100",
  variants: {
    navigationState: {
      origin: "ring-2 ring-cyan-400 ring-offset-2 ring-offset-gray-950",
      reachable: "ring-2 ring-white/60 ring-offset-2 ring-offset-gray-950",
      unreachable: "opacity-40 grayscale cursor-not-allowed hover:scale-100",
    },
  },
});

/** Economy type → Tailwind text color for the small economy label. */
const ECONOMY_LABEL_COLOR: Record<EconomyType, string> = {
  agricultural: "text-green-400",
  extraction: "text-amber-400",
  refinery: "text-cyan-400",
  industrial: "text-slate-300",
  tech: "text-blue-400",
  core: "text-purple-400",
};

export function RegionNode({ data }: NodeProps<Node<RegionNodeData>>) {
  const { label, dominantEconomy, systemCount, shipCount, navigationState } = data;
  const hasShips = shipCount > 0;
  // Hide pulse ring during navigation mode to avoid visual noise
  const showPulse = hasShips && !navigationState;

  return (
    <div className="relative">
      {showPulse && <div className="absolute -inset-3 rounded-2xl border-2 animate-ping opacity-40 border-cyan-400" />}

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

      <div className={regionNode({ navigationState })}>
        <div className="text-base font-bold leading-tight">{label}</div>
        {dominantEconomy && (
          <div className={`text-[10px] font-semibold uppercase tracking-wider opacity-80 ${ECONOMY_LABEL_COLOR[dominantEconomy]}`}>
            {dominantEconomy}
          </div>
        )}
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
