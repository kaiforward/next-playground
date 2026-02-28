"use client";

import type { ConvoyState, ShipState } from "@/lib/types/game";
import { useDisbandConvoyMutation } from "@/lib/hooks/use-convoy";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Disclosure } from "@/components/ui/disclosure";
import { SectionHeader } from "@/components/ui/section-header";
import { useDialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { HiEllipsisVertical } from "react-icons/hi2";
import { ConvoyRepairSlider } from "./convoy-repair-slider";
import { ConvoyRefuelSlider } from "./convoy-refuel-slider";
import { ConvoyShipDialog } from "./convoy-ship-dialog";

interface ConvoyDetailCardProps {
  convoy: ConvoyState;
  playerCredits: number;
  /** All player ships — used to compute which ships can be added to the convoy. */
  ships?: ShipState[];
  /** "summary" for compact list view, "full" for detail page. Defaults to "full". */
  variant?: "summary" | "full";
}

export function ConvoyDetailCard({ convoy, playerCredits, ships, variant = "full" }: ConvoyDetailCardProps) {
  const disbandMutation = useDisbandConvoyMutation();
  const repairDialog = useDialog();
  const refuelDialog = useDialog();
  const manageDialog = useDialog();
  const isDocked = convoy.status === "docked";

  // Ships eligible to be added: docked, at same system, not in any convoy, not disabled
  const availableForAdd = ships?.filter(
    (s) =>
      s.status === "docked" &&
      s.systemId === convoy.systemId &&
      !s.convoyId &&
      !s.disabled,
  ) ?? [];

  const members = convoy.members;
  const minFuel = members.length > 0 ? Math.min(...members.map((m) => m.fuel)) : 0;
  const minMaxFuel = members.length > 0 ? Math.min(...members.map((m) => m.maxFuel)) : 0;
  const hasDamage = members.some((m) => m.hullCurrent < m.hullMax);
  const needsFuel = members.some((m) => m.fuel < m.maxFuel);

  return (
    <Card variant="bordered" padding="md" className="max-w-2xl">
      <CardHeader
        title={convoy.name ?? "Convoy"}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge color={isDocked ? "green" : "amber"}>
              {isDocked ? "Docked" : "In Transit"}
            </Badge>
            <span className="text-text-muted">{convoy.system.name}</span>
          </span>
        }
        action={
          variant === "summary" ? (
            <Button
              href={`/convoy/${convoy.id}`}
              variant="ghost"
              size="xs"
            >
              Details &rarr;
            </Button>
          ) : undefined
        }
      />
      <CardContent className="space-y-4">
        {/* Fleet fuel (min across members) */}
        <ProgressBar
          label="Fleet Fuel"
          value={Math.round(minFuel)}
          max={minMaxFuel}
          color={minMaxFuel > 0 && minFuel / minMaxFuel < 0.2 ? "red" : "blue"}
        />

        {/* Combined cargo */}
        <ProgressBar
          label="Combined Cargo"
          value={convoy.combinedCargoUsed}
          max={convoy.combinedCargoMax}
          color="amber"
        />

        {/* Per-ship breakdown */}
        {variant === "summary" ? (
          <Disclosure
            summary="Members"
            count={members.length}
            defaultOpen={members.length <= 3}
          >
            <div className="space-y-1.5">
              {members.map((ship) => (
                <div key={ship.id} className="flex items-center gap-2 px-3 py-2.5 rounded bg-surface">
                  <span className="text-sm text-text-primary font-medium">{ship.name}</span>
                  <Badge color="slate">{ship.role}</Badge>
                  {ship.disabled && <Badge color="red">Disabled</Badge>}
                </div>
              ))}
            </div>
          </Disclosure>
        ) : (
          <div className="space-y-2">
            <SectionHeader>Members ({members.length})</SectionHeader>
            {members.map((ship) => {
              const hullPct = ship.hullMax > 0 ? (ship.hullCurrent / ship.hullMax) * 100 : 100;
              const shieldPct = ship.shieldMax > 0 ? (ship.shieldCurrent / ship.shieldMax) * 100 : 100;

              return (
                <div key={ship.id} className="px-3 py-2.5 rounded bg-surface space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary font-medium">{ship.name}</span>
                    <Badge color="slate">{ship.role}</Badge>
                    {ship.disabled && <Badge color="red">Disabled</Badge>}
                  </div>

                  {/* Compact hull/shield bars */}
                  <ProgressBar
                    label="Hull"
                    value={ship.hullCurrent}
                    max={ship.hullMax}
                    color={hullPct < 30 ? "red" : "green"}
                    size="sm"
                  />
                  {ship.shieldMax > 0 && (
                    <ProgressBar
                      label="Shields"
                      value={ship.shieldCurrent}
                      max={ship.shieldMax}
                      color={shieldPct < 30 ? "red" : "purple"}
                      size="sm"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Actions */}
        {isDocked && (
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Button
                href={`/system/${convoy.systemId}/market?tradeConvoyId=${convoy.id}`}
                variant="action"
                color="green"
                size="sm"
              >
                Trade
              </Button>
              <Button
                href={`/?navigateConvoyId=${convoy.id}`}
                variant="action"
                color="indigo"
                size="sm"
              >
                Navigate
              </Button>
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
                <DropdownMenuItem onSelect={manageDialog.onOpen}>
                  Manage Ships
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!hasDamage} onSelect={repairDialog.onOpen}>
                  Repair All
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!needsFuel} onSelect={refuelDialog.onOpen}>
                  Refuel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  disabled={disbandMutation.isPending}
                  onSelect={() => disbandMutation.mutate(convoy.id)}
                >
                  {disbandMutation.isPending ? "Disbanding..." : "Disband"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {disbandMutation.error && (
          <p className="text-sm text-red-400">{disbandMutation.error.message}</p>
        )}
      </CardContent>

      {/* Convoy repair slider dialog */}
      {hasDamage && isDocked && (
        <ConvoyRepairSlider
          convoy={convoy}
          playerCredits={playerCredits}
          open={repairDialog.open}
          onClose={repairDialog.onClose}
        />
      )}

      {/* Convoy refuel slider dialog */}
      {needsFuel && isDocked && (
        <ConvoyRefuelSlider
          convoy={convoy}
          playerCredits={playerCredits}
          open={refuelDialog.open}
          onClose={refuelDialog.onClose}
        />
      )}

      {/* Manage ships dialog */}
      {isDocked && (
        <ConvoyShipDialog
          open={manageDialog.open}
          onClose={manageDialog.onClose}
          availableShips={availableForAdd}
          mode="manage"
          convoyId={convoy.id}
          convoyName={convoy.name ?? "Convoy"}
          members={members}
        />
      )}
    </Card>
  );
}
