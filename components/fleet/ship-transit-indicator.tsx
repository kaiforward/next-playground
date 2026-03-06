"use client";

import type { ShipState } from "@/lib/types/game";
import { ProgressBar } from "@/components/ui/progress-bar";

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
        <span className="text-text-tertiary">{ship.system.name}</span>
        <span className="text-text-tertiary">→</span>
        <span className="text-text-secondary">{ship.destinationSystem.name}</span>
      </div>

      <ProgressBar
        label={`${Math.round(progress * 100)}%`}
        value={Math.round(progress * 100)}
        max={100}
        color="amber"
        size="sm"
        ariaLabel={`Transit progress: ${Math.round(progress * 100)}%`}
      />

      <div className="text-[10px] text-text-secondary text-right">
        ETA: {ticksRemaining} tick{ticksRemaining !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
