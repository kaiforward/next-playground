"use client";

import Link from "next/link";
import type { ShipState } from "@/lib/types/game";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShipTransitIndicator } from "./ship-transit-indicator";

interface ShipCardProps {
  ship: ShipState;
  currentTick: number;
}

export function ShipCard({ ship, currentTick }: ShipCardProps) {
  const fuelPercent = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 0;
  const cargoUsed = ship.cargo.reduce((sum, item) => sum + item.quantity, 0);
  const cargoPercent = ship.cargoMax > 0 ? (cargoUsed / ship.cargoMax) * 100 : 0;
  const isDocked = ship.status === "docked";

  return (
    <Card variant="bordered" padding="sm">
      <CardContent className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link
            href={`/ship/${ship.id}`}
            className="text-sm font-bold text-white hover:text-blue-300 transition-colors"
          >
            {ship.name}
          </Link>
          <Badge color={isDocked ? "green" : "amber"}>
            {isDocked ? "Docked" : "In Transit"}
          </Badge>
        </div>

        {/* Location */}
        {isDocked ? (
          <div className="text-xs text-white/50">
            <span className="text-white/70">{ship.system.name}</span>
            {" — "}
            {ship.system.economyType}
          </div>
        ) : (
          <ShipTransitIndicator ship={ship} currentTick={currentTick} />
        )}

        {/* Fuel bar */}
        <div>
          <div className="flex justify-between text-[10px] text-white/40 mb-0.5">
            <span>Fuel</span>
            <span>{Math.round(ship.fuel)} / {ship.maxFuel}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                fuelPercent < 20 ? "bg-red-500" : "bg-blue-500"
              }`}
              style={{ width: `${Math.min(fuelPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Cargo bar */}
        <div>
          <div className="flex justify-between text-[10px] text-white/40 mb-0.5">
            <span>Cargo</span>
            <span>{cargoUsed} / {ship.cargoMax}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                cargoPercent > 80 ? "bg-red-500" : "bg-amber-500"
              }`}
              style={{ width: `${Math.min(cargoPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Link
            href={`/ship/${ship.id}`}
            className="flex-1 text-center py-1.5 rounded-md text-xs font-medium bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            Details
          </Link>
          {isDocked && (
            <Link
              href={`/trade?shipId=${ship.id}&systemId=${ship.systemId}`}
              className="flex-1 text-center py-1.5 rounded-md text-xs font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors"
            >
              Trade
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
