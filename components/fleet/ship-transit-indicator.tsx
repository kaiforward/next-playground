"use client";

import type { ShipState } from "@/lib/types/game";

interface ShipTransitIndicatorProps {
  ship: ShipState;
  currentTick: number;
}

export function ShipTransitIndicator({ ship, currentTick }: ShipTransitIndicatorProps) {
  if (ship.status !== "in_transit" || !ship.departureTick || !ship.arrivalTick || !ship.destinationSystem) {
    return null;
  }

  const totalDuration = ship.arrivalTick - ship.departureTick;
  const elapsed = currentTick - ship.departureTick;
  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, elapsed / totalDuration)) : 0;
  const ticksRemaining = Math.max(0, ship.arrivalTick - currentTick);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-white/50">{ship.system.name}</span>
        <span className="text-white/30">→</span>
        <span className="text-white/70">{ship.destinationSystem.name}</span>
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 rounded-full bg-white/10 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Transit progress: ${Math.round(progress * 100)}%`}
      >
        <div
          className="h-full rounded-full bg-amber-500 transition-all duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex justify-between text-[10px] text-white/40">
        <span>{Math.round(progress * 100)}%</span>
        <span>
          ETA: {ticksRemaining} tick{ticksRemaining !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
