"use client";

import Link from "next/link";
import type { ShipState, RegionInfo } from "@/lib/types/game";
import { getCargoUsed } from "@/lib/utils/cargo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useDialog } from "@/components/ui/dialog";
import { RefuelDialog } from "./refuel-dialog";
import { ShipTransitIndicator } from "./ship-transit-indicator";

const ROLE_COLORS: Record<string, "blue" | "red" | "cyan" | "purple" | "green"> = {
  trade: "blue",
  combat: "red",
  scout: "cyan",
  stealth: "purple",
  support: "green",
};

interface ShipCardProps {
  ship: ShipState;
  currentTick: number;
  regions?: RegionInfo[];
  /** When set, ship detail links include ?from={backTo} for contextual back navigation. */
  backTo?: string;
  /** Required for refuel dialog. */
  playerCredits?: number;
}

export function ShipCard({ ship, currentTick, regions, backTo, playerCredits }: ShipCardProps) {
  const fuelPercent = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 0;
  const cargoUsed = getCargoUsed(ship.cargo);
  const cargoPercent = ship.cargoMax > 0 ? (cargoUsed / ship.cargoMax) * 100 : 0;
  const isDocked = ship.status === "docked";
  const needsFuel = isDocked && ship.fuel < ship.maxFuel;
  const hullPercent = ship.hullMax > 0 ? (ship.hullCurrent / ship.hullMax) * 100 : 100;
  const isDamaged = ship.hullCurrent < ship.hullMax;

  const detailHref = backTo ? `/ship/${ship.id}?from=${backTo}` : `/ship/${ship.id}`;
  const refuelDialog = useDialog();

  return (
    <Card variant="bordered" padding="sm" className={ship.disabled ? "opacity-60" : undefined}>
      <CardContent className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href={detailHref}
              className="text-sm font-bold text-white hover:text-blue-300 transition-colors truncate"
            >
              {ship.name}
            </Link>
            <Badge color={ROLE_COLORS[ship.role] ?? "slate"}>
              {ship.role}
            </Badge>
          </div>
          {ship.disabled ? (
            <Badge color="red">Disabled</Badge>
          ) : (
            <Badge color={isDocked ? "green" : "amber"}>
              {isDocked ? "Docked" : "In Transit"}
            </Badge>
          )}
        </div>

        {/* Location */}
        {isDocked ? (
          <div className="text-xs text-white/50">
            <span className="text-white/70">{ship.system.name}</span>
            {" — "}
            {ship.system.economyType}
            {regions && (
              <span className="text-white/30">
                {" "}({regions.find((r) => r.id === ship.system.regionId)?.name})
              </span>
            )}
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

        {/* Hull/Shield — only show when damaged or when hull < max */}
        {(isDamaged || ship.disabled) && (
          <ProgressBar
            label="Hull"
            value={ship.hullCurrent}
            max={ship.hullMax}
            color={hullPercent < 30 ? "red" : "green"}
          />
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button href={detailHref} variant="ghost" size="sm" className="flex-1 bg-white/5 text-white/60 hover:bg-white/10">
            Details
          </Button>
          {isDocked && !ship.disabled && (
            <Button href={`/system/${ship.systemId}/market?shipId=${ship.id}`} variant="pill" color="indigo" size="sm" className="flex-1">
              Trade
            </Button>
          )}
          {needsFuel && !ship.disabled && playerCredits != null && (
            <Button variant="pill" color="cyan" size="sm" onClick={refuelDialog.onOpen}>
              Refuel
            </Button>
          )}
        </div>
      </CardContent>

      {/* Refuel dialog */}
      {needsFuel && !ship.disabled && playerCredits != null && (
        <RefuelDialog
          ship={ship}
          playerCredits={playerCredits}
          open={refuelDialog.open}
          onClose={refuelDialog.onClose}
        />
      )}
    </Card>
  );
}
