"use client";

import Link from "next/link";
import type { ShipState } from "@/lib/types/game";
import { getCargoUsed } from "@/lib/utils/cargo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ShipTransitIndicator } from "./ship-transit-indicator";

interface ShipCardProps {
  ship: ShipState;
  currentTick: number;
}

export function ShipCard({ ship, currentTick }: ShipCardProps) {
  const fuelPercent = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 0;
  const cargoUsed = getCargoUsed(ship.cargo);
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

        <ProgressBar
          label="Fuel"
          value={Math.round(ship.fuel)}
          max={ship.maxFuel}
          color={fuelPercent < 20 ? "red" : "blue"}
        />
        <ProgressBar
          label="Cargo"
          value={cargoUsed}
          max={ship.cargoMax}
          color={cargoPercent > 80 ? "red" : "amber"}
        />

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button href={`/ship/${ship.id}`} variant="ghost" size="sm" className="flex-1 bg-white/5 text-white/60 hover:bg-white/10">
            Details
          </Button>
          {isDocked && (
            <Button href={`/trade?shipId=${ship.id}&systemId=${ship.systemId}`} variant="pill" color="indigo" size="sm" className="flex-1">
              Trade
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
