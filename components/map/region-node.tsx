"use client";

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { tv } from "tailwind-variants";
import type { RegionIdentity } from "@/lib/types/game";

export interface RegionNodeData {
  label: string;
  identity: RegionIdentity;
  systemCount: number;
  shipCount: number;
  [key: string]: unknown;
}

const regionNode = tv({
  base: "relative rounded-xl border-2 px-5 py-4 text-center min-w-[180px] cursor-pointer transition-all hover:scale-105",
  variants: {
    identity: {
      resource_rich: "bg-amber-900/50 border-amber-500/70 text-amber-100",
      agricultural: "bg-green-900/50 border-green-500/70 text-green-100",
      industrial: "bg-slate-700/50 border-slate-400/70 text-slate-100",
      tech: "bg-blue-900/50 border-blue-500/70 text-blue-100",
      trade_hub: "bg-purple-900/50 border-purple-500/70 text-purple-100",
    },
  },
});

const identityLabel = tv({
  base: "text-[10px] font-semibold uppercase tracking-wider opacity-80",
  variants: {
    identity: {
      resource_rich: "text-amber-300",
      agricultural: "text-green-300",
      industrial: "text-slate-300",
      tech: "text-blue-300",
      trade_hub: "text-purple-300",
    },
  },
});

const pulseRing = tv({
  base: "absolute -inset-3 rounded-2xl border-2 animate-ping opacity-40",
  variants: {
    identity: {
      resource_rich: "border-amber-400",
      agricultural: "border-green-400",
      industrial: "border-slate-300",
      tech: "border-blue-400",
      trade_hub: "border-purple-400",
    },
  },
});

export function RegionNode({ data }: NodeProps) {
  const nodeData = data as RegionNodeData;
  const { label, identity, systemCount, shipCount } = nodeData;
  const hasShips = shipCount > 0;

  return (
    <div className="relative">
      {hasShips && <div className={pulseRing({ identity })} />}

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

      <div className={regionNode({ identity })}>
        <div className="text-base font-bold leading-tight">{label}</div>
        <div className={identityLabel({ identity })}>
          {identity.replace("_", " ")}
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
