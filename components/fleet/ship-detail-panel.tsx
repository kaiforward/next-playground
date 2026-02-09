"use client";

import Link from "next/link";
import type { ShipState } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ECONOMY_BADGE_COLOR } from "@/lib/constants/ui";
import { ShipTransitIndicator } from "./ship-transit-indicator";

interface ShipDetailPanelProps {
  ship: ShipState;
  currentTick: number;
}

export function ShipDetailPanel({ ship, currentTick }: ShipDetailPanelProps) {
  const fuelPercent = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 0;
  const cargoUsed = ship.cargo.reduce((sum, item) => sum + item.quantity, 0);
  const cargoPercent = ship.cargoMax > 0 ? (cargoUsed / ship.cargoMax) * 100 : 0;
  const isDocked = ship.status === "docked";

  return (
    <div className="space-y-6">
      {/* Ship info card */}
      <Card variant="bordered" padding="md">
        <CardHeader title={ship.name} subtitle="Ship Details" />
        <CardContent className="space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/50">Status</span>
            <Badge color={isDocked ? "green" : "amber"}>
              {isDocked ? "Docked" : "In Transit"}
            </Badge>
          </div>

          {/* Location */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/50">Location</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-white">{ship.system.name}</span>
              <Badge color={ECONOMY_BADGE_COLOR[ship.system.economyType]}>
                {ship.system.economyType}
              </Badge>
            </div>
          </div>

          {/* Transit info */}
          {!isDocked && (
            <ShipTransitIndicator ship={ship} currentTick={currentTick} />
          )}

          {/* Fuel bar */}
          <div>
            <div className="flex justify-between text-xs text-white/50 mb-1">
              <span>Fuel</span>
              <span>{Math.round(ship.fuel)} / {ship.maxFuel}</span>
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
              <span>{cargoUsed} / {ship.cargoMax}</span>
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

      {/* Cargo hold card */}
      <Card variant="bordered" padding="md">
        <CardHeader title="Cargo Hold" subtitle={`${cargoUsed} / ${ship.cargoMax} units`} />
        <CardContent>
          {ship.cargo.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-white/30 text-sm">Cargo hold is empty</p>
              <p className="text-white/20 text-xs mt-1">Visit a station market to buy goods</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {ship.cargo.map((item) => (
                <li
                  key={item.goodId}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5"
                >
                  <span className="text-sm font-medium text-white">{item.goodName}</span>
                  <span className="text-sm text-white/60">x{item.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      {isDocked && (
        <div className="flex gap-3">
          <Link
            href={`/trade?shipId=${ship.id}&systemId=${ship.systemId}`}
            className="flex-1 text-center py-2.5 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-500 text-white transition-colors"
          >
            Trade at {ship.system.name}
          </Link>
          <Link
            href={`/map?shipId=${ship.id}`}
            className="flex-1 text-center py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Navigate
          </Link>
        </div>
      )}
    </div>
  );
}
