"use client";

import type { ShipState, StarSystemInfo } from "@/lib/types/game";
import type { PathResult } from "@/lib/engine/pathfinding";
import type { ConnectionInfo } from "@/lib/engine/navigation";

interface RoutePreviewPanelProps {
  ship: ShipState;
  destination: StarSystemInfo;
  route: PathResult;
  connections: ConnectionInfo[];
  systems: StarSystemInfo[];
  isNavigating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Fuel cost for a single hop from the connection list. */
function hopFuel(
  fromId: string,
  toId: string,
  connections: ConnectionInfo[],
): number {
  const conn = connections.find(
    (c) => c.fromSystemId === fromId && c.toSystemId === toId,
  );
  return conn?.fuelCost ?? 0;
}

export function RoutePreviewPanel({
  ship,
  destination,
  route,
  connections,
  systems,
  isNavigating,
  onConfirm,
  onCancel,
}: RoutePreviewPanelProps) {
  const systemNameMap = new Map(systems.map((s) => [s.id, s.name]));
  const getName = (id: string) => systemNameMap.get(id) ?? id;

  // Build per-hop breakdown
  const hops: { from: string; to: string; fuel: number; ticks: number }[] = [];
  for (let i = 0; i < route.path.length - 1; i++) {
    const fuel = hopFuel(route.path[i], route.path[i + 1], connections);
    hops.push({
      from: route.path[i],
      to: route.path[i + 1],
      fuel,
      ticks: Math.max(1, Math.ceil(fuel / 2)),
    });
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-[380px] max-w-[calc(100%-2rem)]">
      <div className="rounded-xl border border-white/10 bg-gray-900/95 backdrop-blur shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10">
          <h3 className="text-sm font-bold text-white">Route Preview</h3>
          <p className="text-xs text-white/40 mt-0.5">
            {ship.name} &rarr; {destination.name}
          </p>
        </div>

        {/* Route path visualization */}
        <div className="px-4 py-3 space-y-1.5">
          {route.path.map((systemId, i) => (
            <div key={systemId} className="flex items-center gap-2">
              {/* Dot + connector line */}
              <div className="flex flex-col items-center w-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full border-2 ${
                    i === 0
                      ? "border-cyan-400 bg-cyan-400/30"
                      : i === route.path.length - 1
                        ? "border-emerald-400 bg-emerald-400/30"
                        : "border-sky-400 bg-sky-400/30"
                  }`}
                />
                {i < route.path.length - 1 && (
                  <div className="w-px h-3 bg-white/20 mt-0.5" />
                )}
              </div>

              {/* System name + hop cost */}
              <div className="flex-1 flex items-center justify-between">
                <span className="text-xs text-white font-medium">
                  {getName(systemId)}
                </span>
                {i < hops.length && (
                  <span className="text-[10px] text-white/40">
                    {hops[i].fuel} fuel &middot; {hops[i].ticks}t
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="mx-4 py-2.5 border-t border-white/10 flex gap-4">
          <div className="flex-1">
            <div className="text-[10px] text-white/40 uppercase tracking-wider">
              Fuel
            </div>
            <div className="text-sm font-semibold text-white">
              {route.totalFuelCost}
              <span className="text-white/30 font-normal">
                {" "}/ {Math.round(ship.fuel)}
              </span>
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[10px] text-white/40 uppercase tracking-wider">
              Travel Time
            </div>
            <div className="text-sm font-semibold text-white">
              {route.totalTravelDuration} ticks
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-white/10 flex gap-2">
          <button
            onClick={onConfirm}
            disabled={isNavigating}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isNavigating ? "Launching..." : "Confirm"}
          </button>
          <button
            onClick={onCancel}
            disabled={isNavigating}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
