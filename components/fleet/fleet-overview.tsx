"use client";

import type { ShipState, RegionInfo } from "@/lib/types/game";
import { ShipCard } from "./ship-card";

interface FleetOverviewProps {
  ships: ShipState[];
  currentTick: number;
  regions?: RegionInfo[];
}

export function FleetOverview({ ships, currentTick, regions }: FleetOverviewProps) {
  const docked = ships.filter((s) => s.status === "docked").length;
  const inTransit = ships.filter((s) => s.status === "in_transit").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Fleet</h2>
        <div className="flex gap-3 text-xs text-white/50">
          <span>{ships.length} ship{ships.length !== 1 ? "s" : ""}</span>
          <span className="text-green-400">{docked} docked</span>
          {inTransit > 0 && (
            <span className="text-amber-400">{inTransit} in transit</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ships.map((ship) => (
          <ShipCard key={ship.id} ship={ship} currentTick={currentTick} regions={regions} />
        ))}
      </div>
    </div>
  );
}
