"use client";

import type { ShipState, RegionInfo, TradeMissionInfo } from "@/lib/types/game";
import { getCargoUsed } from "@/lib/utils/cargo";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EconomyBadge } from "@/components/ui/economy-badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { useDialog } from "@/components/ui/dialog";
import { ShipTransitIndicator } from "./ship-transit-indicator";
import { RefuelDialog } from "./refuel-dialog";
import { RepairDialog } from "./repair-dialog";
import { UpgradeSlot } from "./upgrade-slot";
import { DeliverableMissionsCard } from "@/components/missions/deliverable-missions-card";

import { ROLE_COLORS } from "@/lib/constants/ships";

interface ShipDetailPanelProps {
  ship: ShipState;
  currentTick: number;
  regions?: RegionInfo[];
  playerCredits?: number;
  deliverableMissions?: TradeMissionInfo[];
  /** When the ship is in a convoy, display name and disable Navigate. */
  convoyName?: string;
}

export function ShipDetailPanel({ ship, currentTick, regions, playerCredits, deliverableMissions, convoyName }: ShipDetailPanelProps) {
  const fuelPercent = ship.maxFuel > 0 ? (ship.fuel / ship.maxFuel) * 100 : 0;
  const cargoUsed = getCargoUsed(ship.cargo);
  const cargoPercent = ship.cargoMax > 0 ? (cargoUsed / ship.cargoMax) * 100 : 0;
  const isDocked = ship.status === "docked";
  const onMission = ship.activeMission?.status === "in_progress";
  const needsFuel = isDocked && ship.fuel < ship.maxFuel;
  const isDamaged = ship.hullCurrent < ship.hullMax;
  const hullPercent = ship.hullMax > 0 ? (ship.hullCurrent / ship.hullMax) * 100 : 100;
  const shieldPercent = ship.shieldMax > 0 ? (ship.shieldCurrent / ship.shieldMax) * 100 : 100;

  const refuelDialog = useDialog();
  const repairDialog = useDialog();

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
              <span className="capitalize text-text-muted">{ship.size}</span>
            </span>
          }
        />
        <CardContent className="space-y-4">
          <StatList>
            <StatRow label="Status">
              {ship.disabled ? (
                <Badge color="red">Disabled</Badge>
              ) : ship.activeMission?.status === "in_progress" ? (
                <Badge color="cyan">On Mission</Badge>
              ) : (
                <Badge color={isDocked ? "green" : "amber"}>
                  {isDocked ? "Docked" : "In Transit"}
                </Badge>
              )}
            </StatRow>

            {convoyName && (
              <StatRow label="Convoy">
                <span className="text-sm text-cyan-300">{convoyName}</span>
              </StatRow>
            )}

            <StatRow label="Location">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-white">{ship.system.name}</span>
                <EconomyBadge economyType={ship.system.economyType} />
                {regions && (
                  <span className="text-xs text-text-muted">
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
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <StatPair label="Speed" value={ship.speed} />
            <StatPair label="Firepower" value={ship.firepower} />
            <StatPair label="Evasion" value={ship.evasion} />
            <StatPair label="Stealth" value={ship.stealth} />
            <StatPair label="Sensors" value={ship.sensors} />
            <StatPair label="Crew" value={ship.crewCapacity} />
          </div>
        </CardContent>
      </Card>

      {/* Upgrade slots (read-only) */}
      {ship.upgradeSlots.length > 0 && (
        <Card variant="bordered" padding="md">
          <CardHeader title="Upgrade Slots" subtitle={`${ship.upgradeSlots.filter((s) => s.moduleId).length} / ${ship.upgradeSlots.length} installed`} />
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {ship.upgradeSlots.map((slot) => (
                <UpgradeSlot
                  key={slot.id}
                  slot={slot}
                  readOnly
                />
              ))}
            </div>
            {isDocked && !ship.disabled && (
              <Button
                href={`/system/${ship.systemId}/shipyard/upgrades`}
                variant="ghost"
                size="sm"
              >
                Manage at Upgrade Bay &rarr;
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cargo hold card */}
      <Card variant="bordered" padding="md">
        <CardHeader title="Cargo Hold" subtitle={`${cargoUsed} / ${ship.cargoMax} units`} />
        <CardContent>
          {ship.cargo.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-text-faint text-sm">Cargo hold is empty</p>
              <p className="text-white/20 text-xs mt-1">Visit a station market to buy goods</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {ship.cargo.map((item) => (
                <li
                  key={item.goodId}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface"
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
        <div className="flex gap-3 flex-wrap">
          {!ship.disabled && !onMission && (
            <>
              <Button
                href={`/system/${ship.systemId}/market?shipId=${ship.id}`}
                variant="action"
                color="green"
                className="flex-1"
              >
                Market
              </Button>
              {convoyName ? (
                <Button
                  variant="action"
                  color="indigo"
                  className="flex-1 opacity-50 cursor-not-allowed"
                  disabled
                  title="Navigate via convoy"
                >
                  Navigate via convoy
                </Button>
              ) : (
                <Button
                  href={`/map?shipId=${ship.id}`}
                  variant="action"
                  color="indigo"
                  className="flex-1"
                >
                  Navigate
                </Button>
              )}
            </>
          )}
          {needsFuel && !ship.disabled && !onMission && playerCredits != null && (
            <Button
              variant="pill"
              color="cyan"
              size="md"
              onClick={refuelDialog.onOpen}
            >
              Refuel
            </Button>
          )}
          {isDamaged && !onMission && playerCredits != null && (
            <Button
              variant="pill"
              color="green"
              size="md"
              onClick={repairDialog.onOpen}
            >
              Repair
            </Button>
          )}
        </div>
      )}

      {/* Deliverable missions */}
      {isDocked && !ship.disabled && deliverableMissions && deliverableMissions.length > 0 && (
        <DeliverableMissionsCard missions={deliverableMissions} ship={ship} />
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

      {/* Repair dialog */}
      {isDamaged && playerCredits != null && (
        <RepairDialog
          ship={ship}
          playerCredits={playerCredits}
          open={repairDialog.open}
          onClose={repairDialog.onClose}
        />
      )}

    </div>
  );
}

function StatPair({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-sm text-text-tertiary">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}
