"use client";

import type { ConvoyState, ShipState } from "@/lib/types/game";
import {
  useDisbandConvoyMutation,
  useConvoyMemberMutations,
} from "@/lib/hooks/use-convoy";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Disclosure } from "@/components/ui/disclosure";
import { useDialog } from "@/components/ui/dialog";
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
  const { removeMember } = useConvoyMemberMutations(convoy.id);
  const repairDialog = useDialog();
  const refuelDialog = useDialog();
  const addDialog = useDialog();
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
    <Card variant="bordered" padding="md">
      <CardHeader
        title={convoy.name ?? "Convoy"}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge color={isDocked ? "green" : "amber"}>
              {isDocked ? "Docked" : "In Transit"}
            </Badge>
            <span className="text-white/40">{convoy.system.name}</span>
          </span>
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
                <div key={ship.id} className="flex items-center gap-2 py-1.5 px-3 rounded bg-white/5">
                  <span className="text-sm text-white font-medium">{ship.name}</span>
                  <Badge color="slate">{ship.role}</Badge>
                  {ship.disabled && <Badge color="red">Disabled</Badge>}
                </div>
              ))}
            </div>
          </Disclosure>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Members ({members.length})
            </p>
            {members.map((ship) => {
              const hullPct = ship.hullMax > 0 ? (ship.hullCurrent / ship.hullMax) * 100 : 100;
              const shieldPct = ship.shieldMax > 0 ? (ship.shieldCurrent / ship.shieldMax) * 100 : 100;

              return (
                <div key={ship.id} className="py-2 px-3 rounded bg-white/5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{ship.name}</span>
                      <Badge color="slate">{ship.role}</Badge>
                      {ship.disabled && <Badge color="red">Disabled</Badge>}
                    </div>
                    {isDocked && (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-red-400 hover:text-red-300"
                        disabled={removeMember.isPending}
                        onClick={() => removeMember.mutate(ship.id)}
                      >
                        Remove
                      </Button>
                    )}
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

        {removeMember.error && (
          <p className="text-sm text-red-400">{removeMember.error.message}</p>
        )}

        {/* Actions */}
        {isDocked && (
          <div className="flex gap-2 pt-1 flex-wrap">
            <Button
              href={`/system/${convoy.systemId}/market?convoyId=${convoy.id}`}
              variant="action"
              color="green"
              size="sm"
              className="flex-1"
            >
              Trade
            </Button>
            <Button
              href={`/map?convoyId=${convoy.id}`}
              variant="action"
              color="indigo"
              size="sm"
              className="flex-1"
            >
              Navigate
            </Button>
            {availableForAdd.length > 0 && (
              <Button
                variant="pill"
                color="blue"
                size="sm"
                onClick={addDialog.onOpen}
              >
                Add Ships
              </Button>
            )}
            {hasDamage && (
              <Button
                variant="pill"
                color="green"
                size="sm"
                onClick={repairDialog.onOpen}
              >
                Repair All
              </Button>
            )}
            {needsFuel && (
              <Button
                variant="pill"
                color="blue"
                size="sm"
                onClick={refuelDialog.onOpen}
              >
                Refuel
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-300"
              disabled={disbandMutation.isPending}
              onClick={() => disbandMutation.mutate(convoy.id)}
            >
              {disbandMutation.isPending ? "Disbanding..." : "Disband"}
            </Button>
            {variant === "summary" && (
              <Button
                href={`/convoy/${convoy.id}`}
                variant="ghost"
                size="sm"
              >
                Details &rarr;
              </Button>
            )}
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

      {/* Add ships dialog */}
      {isDocked && availableForAdd.length > 0 && (
        <ConvoyShipDialog
          open={addDialog.open}
          onClose={addDialog.onClose}
          availableShips={availableForAdd}
          mode="add"
          convoyId={convoy.id}
          convoyName={convoy.name ?? "Convoy"}
        />
      )}
    </Card>
  );
}
