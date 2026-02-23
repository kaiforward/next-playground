"use client";

import { useMemo } from "react";
import type { ShipState, RegionInfo } from "@/lib/types/game";
import { ShipCard } from "./ship-card";

interface FleetOverviewProps {
  ships: ShipState[];
  currentTick: number;
  regions?: RegionInfo[];
  playerCredits?: number;
}

export function FleetOverview({ ships, currentTick, regions, playerCredits }: FleetOverviewProps) {
  const soloShips = useMemo(() => ships.filter((s) => !s.convoyId), [ships]);
  const convoyCount = useMemo(() => ships.filter((s) => s.convoyId).length, [ships]);

  const docked = useMemo(() => soloShips.filter((s) => s.status === "docked").length, [soloShips]);
  const inTransit = useMemo(() => soloShips.filter((s) => s.status === "in_transit").length, [soloShips]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Fleet</h2>
        <div className="flex gap-3 text-xs text-white/50">
          <span>
            {soloShips.length} ship{soloShips.length !== 1 ? "s" : ""}
            {convoyCount > 0 && (
              <span className="text-white/30"> ({convoyCount} in convoys)</span>
            )}
          </span>
          <span className="text-green-400">{docked} docked</span>
          {inTransit > 0 && (
            <span className="text-amber-400">{inTransit} in transit</span>
          )}
        </div>
      </div>

      {soloShips.length === 0 ? (
        <p className="text-sm text-white/30 py-4">All ships are in convoys.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {soloShips.map((ship) => (
            <ShipCard key={ship.id} ship={ship} currentTick={currentTick} regions={regions} playerCredits={playerCredits} />
          ))}
        </div>
      )}
    </div>
  );
}
