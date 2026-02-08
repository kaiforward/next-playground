"use client";

import type { ShipState } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

interface ShipStatusProps {
  ship: ShipState;
}

export function ShipStatus({ ship }: ShipStatusProps) {
  const fuelPercent = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 0;
  const cargoUsed = ship.cargo.reduce((sum, item) => sum + item.quantity, 0);
  const cargoPercent =
    ship.cargoMax > 0 ? (cargoUsed / ship.cargoMax) * 100 : 0;

  return (
    <Card variant="bordered" padding="md">
      <CardHeader title={ship.name} subtitle="Ship Systems" />
      <CardContent className="space-y-5">
        {/* Fuel bar */}
        <div>
          <div className="flex justify-between text-xs text-white/50 mb-1">
            <span>Fuel</span>
            <span>
              {ship.fuel} / {ship.maxFuel}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
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
          <div className="flex justify-between text-xs text-white/50 mb-1">
            <span>Cargo</span>
            <span>
              {cargoUsed} / {ship.cargoMax}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                cargoPercent > 80 ? "bg-red-500" : "bg-amber-500"
              }`}
              style={{ width: `${Math.min(cargoPercent, 100)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
