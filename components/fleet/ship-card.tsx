"use client";

import Link from "next/link";
import type { ShipState, RegionInfo } from "@/lib/types/game";
import { getCargoUsed } from "@/lib/utils/cargo";
import { ROLE_COLORS } from "@/lib/constants/ships";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useDialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { HiEllipsisVertical } from "react-icons/hi2";
import { RefuelDialog } from "./refuel-dialog";
import { RepairDialog } from "./repair-dialog";
import { ShipTransitIndicator } from "./ship-transit-indicator";

interface ShipCardProps {
  ship: ShipState;
  currentTick: number;
  regions?: RegionInfo[];
  /** When set, ship detail links include ?from={backTo} for contextual back navigation. */
  backTo?: string;
  /** Required for refuel dialog. */
  playerCredits?: number;
  /** Whether this ship is currently in an active battle. */
  inBattle?: boolean;
}

export function ShipCard({ ship, currentTick, regions, backTo, playerCredits, inBattle }: ShipCardProps) {
  const fuelPercent = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 0;
  const cargoUsed = getCargoUsed(ship.cargo);
  const cargoPercent = ship.cargoMax > 0 ? (cargoUsed / ship.cargoMax) * 100 : 0;
  const isDocked = ship.status === "docked";
  const onMission = ship.activeMission?.status === "in_progress";
  const needsFuel = isDocked && ship.fuel < ship.maxFuel;
  const hullPercent = ship.hullMax > 0 ? (ship.hullCurrent / ship.hullMax) * 100 : 100;
  const isDamaged = ship.hullCurrent < ship.hullMax;

  const detailHref = backTo ? `/ship/${ship.id}?from=${backTo}` : `/ship/${ship.id}`;
  const refuelDialog = useDialog();
  const repairDialog = useDialog();

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
          <div className="flex items-center gap-2 shrink-0">
            {ship.disabled ? (
              <Badge color="red">Disabled</Badge>
            ) : inBattle ? (
              <Badge color="purple">In Battle</Badge>
            ) : ship.activeMission?.status === "in_progress" ? (
              <Badge color="cyan">On Mission</Badge>
            ) : (
              <Badge color={isDocked ? "green" : "amber"}>
                {isDocked ? "Docked" : "In Transit"}
              </Badge>
            )}
            <Button href={detailHref} variant="ghost" size="xs">
              Details &rarr;
            </Button>
          </div>
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
        {isDocked && (
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              {!ship.disabled && !onMission && (
                <Button
                  href={`/system/${ship.systemId}/market?shipId=${ship.id}`}
                  variant="action"
                  color="green"
                  size="sm"
                >
                  Trade
                </Button>
              )}
              {!ship.disabled && !ship.convoyId && !onMission && (
                <Button
                  href={`/map?shipId=${ship.id}`}
                  variant="action"
                  color="indigo"
                  size="sm"
                >
                  Navigate
                </Button>
              )}
            </div>

            {/* Overflow menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="px-2">
                  <span className="sr-only">More actions</span>
                  <HiEllipsisVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!needsFuel || ship.disabled || playerCredits == null}
                  onSelect={refuelDialog.onOpen}
                >
                  Refuel
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!isDamaged || ship.disabled || playerCredits == null}
                  onSelect={repairDialog.onOpen}
                >
                  Repair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
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

      {/* Repair dialog */}
      {isDamaged && !ship.disabled && playerCredits != null && (
        <RepairDialog
          ship={ship}
          playerCredits={playerCredits}
          open={repairDialog.open}
          onClose={repairDialog.onClose}
        />
      )}
    </Card>
  );
}
