"use client";

import type { ShipState, UpgradeSlotState } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { UpgradeSlot } from "./upgrade-slot";

import { ROLE_COLORS } from "@/lib/constants/ships";

interface SelectedShipCardProps {
  ship: ShipState;
  convoyName?: string;
  onInstall: (slot: UpgradeSlotState) => void;
  onRemove: (slotId: string) => void;
  removeError?: string;
  removePending: boolean;
}

export function SelectedShipCard({
  ship,
  convoyName,
  onInstall,
  onRemove,
  removeError,
  removePending,
}: SelectedShipCardProps) {
  return (
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
        {convoyName && (
          <p className="text-sm text-cyan-300">Part of {convoyName}</p>
        )}

        {ship.upgradeSlots.length === 0 ? (
          <p className="text-text-faint text-sm text-center py-4">
            This ship has no upgrade slots.
          </p>
        ) : (
          <div className="space-y-2">
            <SectionHeader>
              Slots ({ship.upgradeSlots.filter((s) => s.moduleId).length} / {ship.upgradeSlots.length} installed)
            </SectionHeader>
            {ship.upgradeSlots.map((slot) => (
              <UpgradeSlot
                key={slot.id}
                slot={slot}
                onInstall={onInstall}
                onRemove={onRemove}
                disabled={removePending}
              />
            ))}
          </div>
        )}

        {removeError && (
          <p className="text-sm text-red-400">{removeError}</p>
        )}
      </CardContent>
    </Card>
  );
}
