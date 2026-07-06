"use client";

import type { ShipState, RegionInfo } from "@/lib/types/game";
import { getShipDerivedState } from "@/lib/utils/ship";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EconomyBadge } from "@/components/ui/economy-badge";
import { ShipStatusBadge } from "./ship-status-badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { useDialog } from "@/components/ui/dialog";
import { ShipTransitIndicator } from "./ship-transit-indicator";
import { RefuelDialog } from "./refuel-dialog";

import { ROLE_COLORS } from "@/lib/constants/ships";

interface ShipDetailPanelProps {
  ship: ShipState;
  currentTick: number;
  regions?: RegionInfo[];
  playerCredits?: number;
}

export function ShipDetailPanel({ ship, currentTick, regions, playerCredits }: ShipDetailPanelProps) {
  const { fuelPercent, hullPercent, shieldPercent, isDocked, needsFuel } = getShipDerivedState(ship);

  const refuelDialog = useDialog();

  return (
    <div className="space-y-6">
      {/* Ship info card */}
      <Card variant="bordered" padding="md">
        <CardHeader
          title={ship.name}
          subtitle={
            <span className="inline-flex items-center gap-2">
              <Badge color={ROLE_COLORS[ship.role] ?? "slate"}>
                {ship.role}
              </Badge>
              <span className="capitalize text-text-secondary">{ship.size}</span>
            </span>
          }
        />
        <CardContent className="space-y-4">
          <StatList>
            <StatRow label="Status">
              <ShipStatusBadge ship={ship} />
            </StatRow>

            <StatRow label="Location">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-text-primary">{ship.system.name}</span>
                <EconomyBadge economyType={ship.system.economyType} />
                {regions && (
                  <span className="text-xs text-text-secondary">
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
            label="Hull"
            value={ship.hullCurrent}
            max={ship.hullMax}
            color={hullPercent < 30 ? "red" : "green"}
            size="md"
          />
          {ship.shieldMax > 0 && (
            <ProgressBar
              label="Shields"
              value={ship.shieldCurrent}
              max={ship.shieldMax}
              color={shieldPercent < 30 ? "red" : "purple"}
              size="md"
            />
          )}
        </CardContent>
      </Card>

      {/* Ship stats card */}
      <Card variant="bordered" padding="md">
        <CardHeader title="Ship Stats" />
        <CardContent>
          <StatList className="grid grid-cols-2 gap-x-6 gap-y-2">
            <StatRow label="Speed"><span>{ship.speed}</span></StatRow>
            <StatRow label="Firepower"><span>{ship.firepower}</span></StatRow>
            <StatRow label="Evasion"><span>{ship.evasion}</span></StatRow>
            <StatRow label="Stealth"><span>{ship.stealth}</span></StatRow>
            <StatRow label="Sensors"><span>{ship.sensors}</span></StatRow>
            <StatRow label="Crew"><span>{ship.crewCapacity}</span></StatRow>
          </StatList>
        </CardContent>
      </Card>

      {/* Actions */}
      {isDocked && (
        <div className="flex gap-3 flex-wrap">
          {!ship.disabled && (
            <>
              <Button
                href={`/system/${ship.systemId}/market`}
                variant="action"
                color="green"
                className="flex-1"
              >
                Market
              </Button>
              <Button
                href={`/?navigateShipId=${ship.id}`}
                variant="action"
                color="accent"
                className="flex-1"
              >
                Navigate
              </Button>
            </>
          )}
          {needsFuel && !ship.disabled && playerCredits != null && (
            <Button
              variant="pill"
              color="cyan"
              size="md"
              onClick={refuelDialog.onOpen}
            >
              Refuel
            </Button>
          )}
        </div>
      )}

      {/* Refuel dialog */}
      {needsFuel && !ship.disabled && playerCredits != null && (
        <RefuelDialog
          ship={ship}
          playerCredits={playerCredits}
          open={refuelDialog.open}
          onClose={refuelDialog.onClose}
        />
      )}
    </div>
  );
}

