"use client";

import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { tv } from "tailwind-variants";
import type { EconomyType } from "@/lib/types/game";
import { EventIcon } from "@/components/events/event-icon";

export type NavigationNodeState =
  | "origin"
  | "reachable"
  | "unreachable"
  | "route_hop"
  | "destination";

export interface SystemEventInfo {
  type: string;
  color: "red" | "amber" | "purple" | "green" | "blue" | "slate";
  priority: number;
}

export interface SystemNodeData {
  label: string;
  economyType: EconomyType;
  shipCount: number;
  isGateway?: boolean;
  navigationState?: NavigationNodeState;
  activeEvents?: SystemEventInfo[];
  [key: string]: unknown;
}

const systemNode = tv({
  base: "relative rounded-lg border-2 px-3 py-2 text-center min-w-[120px] cursor-pointer transition-all",
  variants: {
    economyType: {
      agricultural: "bg-green-900/60 border-green-500 text-green-100",
      extraction: "bg-amber-900/60 border-amber-500 text-amber-100",
      refinery: "bg-cyan-900/60 border-cyan-500 text-cyan-100",
      industrial: "bg-slate-700/60 border-slate-400 text-slate-100",
      tech: "bg-blue-900/60 border-blue-500 text-blue-100",
      core: "bg-purple-900/60 border-purple-500 text-purple-100",
    },
    navigationState: {
      origin: "!border-cyan-400 ring-2 ring-cyan-400/40 scale-105",
      reachable: "!border-white/60 ring-1 ring-white/20 hover:scale-105",
      unreachable: "opacity-30 grayscale cursor-not-allowed",
      route_hop: "!border-sky-400 ring-2 ring-sky-400/30",
      destination: "!border-emerald-400 ring-2 ring-emerald-400/40 scale-105",
    },
    eventColor: {
      red: "!border-red-500 shadow-lg shadow-red-500/40",
      amber: "!border-amber-500 shadow-lg shadow-amber-500/40",
      purple: "!border-purple-500 shadow-lg shadow-purple-500/40",
      green: "!border-green-400 shadow-lg shadow-green-400/40",
      blue: "!border-blue-500 shadow-lg shadow-blue-500/40",
      slate: "!border-slate-400 shadow-lg shadow-slate-400/40",
    },
  },
});

const economyLabel = tv({
  base: "text-[10px] font-semibold uppercase tracking-wider opacity-80",
  variants: {
    economyType: {
      agricultural: "text-green-300",
      extraction: "text-amber-300",
      refinery: "text-cyan-300",
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
      extraction: "border-amber-400",
      refinery: "border-cyan-400",
      industrial: "border-slate-300",
      tech: "border-blue-400",
      core: "border-purple-400",
    },
  },
});

const BADGE_BG: Record<string, string> = {
  red: "bg-red-600",
  amber: "bg-amber-600",
  purple: "bg-purple-600",
  green: "bg-green-600",
  blue: "bg-blue-600",
  slate: "bg-slate-600",
};

export function SystemNode({ data }: NodeProps<Node<SystemNodeData>>) {
  const { label, economyType, shipCount, isGateway, navigationState, activeEvents } = data;
  const hasShips = shipCount > 0;

  // Determine dominant event color (highest priority) — only when not navigating
  const sortedEvents = activeEvents
    ? [...activeEvents].sort((a, b) => b.priority - a.priority)
    : [];
  const dominantColor = !navigationState && sortedEvents.length > 0
    ? sortedEvents[0].color
    : undefined;

  return (
    <div className="relative">
      {/* Pulsing ring when player has ships here (only in default mode) */}
      {hasShips && !navigationState && (
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
      <div className={systemNode({ economyType, navigationState, eventColor: dominantColor })}>
        {/* Gateway indicator */}
        {isGateway && (
          <div
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 border border-amber-300 flex items-center justify-center"
            title="Gateway system"
          >
            <span className="text-[8px] font-bold text-amber-950">G</span>
          </div>
        )}
        <div className="text-sm font-bold leading-tight">{label}</div>
        <div className={economyLabel({ economyType })}>
          {economyType}
        </div>
        {hasShips && (
          <div className="text-[9px] mt-0.5 text-yellow-300 font-medium">
            {shipCount} SHIP{shipCount !== 1 ? "S" : ""}
          </div>
        )}
      </div>

      {/* Event icon badges */}
      {sortedEvents.length > 0 && navigationState !== "unreachable" && (
        <div className="absolute -bottom-2.5 -right-2 flex -space-x-1.5">
          {sortedEvents.slice(0, 3).map((evt) => (
            <div
              key={evt.type}
              className={`w-6 h-6 rounded-full ${BADGE_BG[evt.color] ?? "bg-slate-600"} border border-gray-900 flex items-center justify-center`}
              title={evt.type.replace(/_/g, " ")}
            >
              <EventIcon eventType={evt.type} className="w-3.5 h-3.5 text-white" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
