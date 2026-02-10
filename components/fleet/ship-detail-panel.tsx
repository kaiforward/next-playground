"use client";

import type { ShipState, RegionInfo } from "@/lib/types/game";
import { getCargoUsed } from "@/lib/utils/cargo";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { ECONOMY_BADGE_COLOR } from "@/lib/constants/ui";
import { ShipTransitIndicator } from "./ship-transit-indicator";

interface ShipDetailPanelProps {
  ship: ShipState;
  currentTick: number;
  regions?: RegionInfo[];
}

export function ShipDetailPanel({ ship, currentTick, regions }: ShipDetailPanelProps) {
  const fuelPercent = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 0;
  const cargoUsed = getCargoUsed(ship.cargo);
  const cargoPercent = ship.cargoMax > 0 ? (cargoUsed / ship.cargoMax) * 100 : 0;
  const isDocked = ship.status === "docked";

  return (
    <div className="space-y-6">
      {/* Ship info card */}
      <Card variant="bordered" padding="md">
        <CardHeader title={ship.name} subtitle="Ship Details" />
        <CardContent className="space-y-4">
          <StatList>
            <StatRow label="Status">
              <Badge color={isDocked ? "green" : "amber"}>
                {isDocked ? "Docked" : "In Transit"}
              </Badge>
            </StatRow>

            <StatRow label="Location">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-white">{ship.system.name}</span>
                <Badge color={ECONOMY_BADGE_COLOR[ship.system.economyType]}>
                  {ship.system.economyType}
                </Badge>
                {regions && (
                  <span className="text-xs text-white/40">
                    {regions.find((r) => r.id === ship.system.regionId)?.name}
                  </span>
                )}
              </div>
            </StatRow>
          </StatList>

          {/* Transit info */}
          {!isDocked && (
            <ShipTransitIndicator ship={ship} currentTick={currentTick} />
          )}

          <ProgressBar
            label="Fuel"
            value={Math.round(ship.fuel)}
            max={ship.maxFuel}
            color={fuelPercent < 20 ? "red" : "blue"}
            size="md"
          />
          <ProgressBar
            label="Cargo"
            value={cargoUsed}
            max={ship.cargoMax}
            color={cargoPercent > 80 ? "red" : "amber"}
            size="md"
          />
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
          <Button
            href={`/trade?shipId=${ship.id}&systemId=${ship.systemId}`}
            variant="action"
            color="green"
            className="flex-1"
          >
            Trade at {ship.system.name}
          </Button>
          <Button
            href={`/map?shipId=${ship.id}`}
            variant="action"
            color="indigo"
            className="flex-1"
          >
            Navigate
          </Button>
        </div>
      )}
    </div>
  );
}
