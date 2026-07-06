"use client";

import type { ShipState } from "@/lib/types/game";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROLE_COLORS } from "@/lib/constants/ships";

export interface CompactShipCardProps {
  ship: ShipState;
  systemId: string;
  /** Triggered when the user clicks Navigate. Receives the ship state. */
  onNavigate: (ship: ShipState) => void;
}

export function CompactShipCard({ ship, systemId, onNavigate }: CompactShipCardProps) {
  return (
    <div className="bg-surface border border-border border-l-2 border-l-cyan-500 px-2.5 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">{ship.name}</span>
          <Badge color={ROLE_COLORS[ship.role] ?? "slate"}>{ship.role}</Badge>
        </div>
        <span className="text-xs text-text-tertiary shrink-0">Docked</span>
      </div>
      <div className="flex gap-1">
        <Button
          onClick={() => onNavigate(ship)}
          variant="action"
          color="accent"
          size="xs"
          className="flex-1"
        >
          Navigate
        </Button>
        <Button
          href={`/system/${systemId}/market`}
          variant="ghost"
          size="xs"
          className="flex-1"
        >
          Market
        </Button>
      </div>
    </div>
  );
}
