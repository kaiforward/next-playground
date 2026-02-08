"use client";

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { tv } from "tailwind-variants";
import type { EconomyType } from "@/lib/types/game";

export interface SystemNodeData {
  label: string;
  economyType: EconomyType;
  isPlayerHere: boolean;
  [key: string]: unknown;
}

const systemNode = tv({
  base: "relative rounded-lg border-2 px-3 py-2 text-center min-w-[120px] cursor-pointer transition-all",
  variants: {
    economyType: {
      agricultural: "bg-green-900/60 border-green-500 text-green-100",
      mining: "bg-amber-900/60 border-amber-500 text-amber-100",
      industrial: "bg-slate-700/60 border-slate-400 text-slate-100",
      tech: "bg-blue-900/60 border-blue-500 text-blue-100",
      core: "bg-purple-900/60 border-purple-500 text-purple-100",
    },
  },
});

const economyLabel = tv({
  base: "text-[10px] font-semibold uppercase tracking-wider opacity-80",
  variants: {
    economyType: {
      agricultural: "text-green-300",
      mining: "text-amber-300",
      industrial: "text-slate-300",
      tech: "text-blue-300",
      core: "text-purple-300",
    },
  },
});

const pulseRing = tv({
  base: "absolute -inset-2 rounded-xl border-2 animate-ping opacity-40",
  variants: {
    economyType: {
      agricultural: "border-green-400",
      mining: "border-amber-400",
      industrial: "border-slate-300",
      tech: "border-blue-400",
      core: "border-purple-400",
    },
  },
});

export function SystemNode({ data }: NodeProps) {
  const nodeData = data as SystemNodeData;
  const { label, economyType, isPlayerHere } = nodeData;

  return (
    <div className="relative">
      {/* Pulsing ring for player's current location */}
      {isPlayerHere && (
        <div className={pulseRing({ economyType })} />
      )}

      {/* Handles for edges */}
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

      {/* Node content */}
      <div className={systemNode({ economyType })}>
        <div className="text-sm font-bold leading-tight">{label}</div>
        <div className={economyLabel({ economyType })}>
          {economyType}
        </div>
        {isPlayerHere && (
          <div className="text-[9px] mt-0.5 text-yellow-300 font-medium">
            YOU ARE HERE
          </div>
        )}
      </div>
    </div>
  );
}
