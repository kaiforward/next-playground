"use client";

import { use, useState, useMemo } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { useUpgradeMutations } from "@/lib/hooks/use-upgrade-mutations";
import type { ShipState, UpgradeSlotState } from "@/lib/types/game";
import { SelectInput, type SelectOption } from "@/components/form/select-input";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useDialog } from "@/components/ui/dialog";
import { UpgradeSlot } from "@/components/fleet/upgrade-slot";
import { UpgradeInstallDialog } from "@/components/fleet/upgrade-install-dialog";

import { ROLE_COLORS } from "@/lib/constants/ships";

function UpgradesContent({ systemId }: { systemId: string }) {
  const { fleet } = useFleet();
  const { convoys } = useConvoys();
  const [selectedShipId, setSelectedShipId] = useState<string>("");
  const [installSlot, setInstallSlot] = useState<UpgradeSlotState | null>(null);
  const upgradeDialog = useDialog();

  // All docked, non-disabled ships at this system (solo + convoy members)
  const eligibleShips = useMemo(() => {
    return fleet.ships.filter(
      (s) =>
        s.systemId === systemId &&
        s.status === "docked" &&
        !s.disabled,
    );
  }, [fleet.ships, systemId]);

  // Build dropdown options — convoy members labeled as "Ship Name (Convoy Name)"
  const shipOptions: SelectOption<string>[] = useMemo(() => {
    return eligibleShips.map((ship) => {
      const convoy = ship.convoyId
        ? convoys.find((c) => c.id === ship.convoyId)
        : undefined;
      const label = convoy
        ? `${ship.name} (${convoy.name ?? "Convoy"})`
        : ship.name;
      return { value: ship.id, label };
    });
  }, [eligibleShips, convoys]);

  const selectedShip = eligibleShips.find((s) => s.id === selectedShipId) ?? null;
  const selectedConvoy = selectedShip?.convoyId
    ? convoys.find((c) => c.id === selectedShip.convoyId)
    : undefined;

  const { remove: removeUpgrade } = useUpgradeMutations(selectedShipId || null);

  const handleInstallClick = (slot: UpgradeSlotState) => {
    setInstallSlot(slot);
    upgradeDialog.onOpen();
  };

  const handleInstallClose = () => {
    setInstallSlot(null);
    upgradeDialog.onClose();
  };

  if (eligibleShips.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/40 text-sm">No eligible ships at this system.</p>
        <p className="text-white/20 text-xs mt-1">
          Ships must be docked and not disabled to install upgrades.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SelectInput
        label="Select Ship"
        options={shipOptions}
        value={selectedShipId}
        onChange={setSelectedShipId}
        placeholder="Choose a ship to upgrade..."
        size="md"
      />

      {selectedShip && (
        <SelectedShipCard
          ship={selectedShip}
          convoyName={selectedConvoy?.name ?? (selectedConvoy ? "Convoy" : undefined)}
          playerCredits={fleet.credits}
          onInstall={handleInstallClick}
          onRemove={(slotId) => removeUpgrade.mutate(slotId)}
          removeError={removeUpgrade.error?.message}
          removePending={removeUpgrade.isPending}
        />
      )}

      {selectedShipId && (
        <UpgradeInstallDialog
          shipId={selectedShipId}
          slot={installSlot}
          playerCredits={fleet.credits}
          open={upgradeDialog.open}
          onClose={handleInstallClose}
        />
      )}
    </div>
  );
}

function SelectedShipCard({
  ship,
  convoyName,
  playerCredits,
  onInstall,
  onRemove,
  removeError,
  removePending,
}: {
  ship: ShipState;
  convoyName?: string;
  playerCredits: number;
  onInstall: (slot: UpgradeSlotState) => void;
  onRemove: (slotId: string) => void;
  removeError?: string;
  removePending: boolean;
}) {
  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title={ship.name}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge color={ROLE_COLORS[ship.role] ?? "slate"}>
              {ship.role}
            </Badge>
            <span className="capitalize text-white/40">{ship.size}</span>
          </span>
        }
      />
      <CardContent className="space-y-4">
        {convoyName && (
          <p className="text-sm text-cyan-300">Part of {convoyName}</p>
        )}

        {ship.upgradeSlots.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-4">
            This ship has no upgrade slots.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Slots ({ship.upgradeSlots.filter((s) => s.moduleId).length} / {ship.upgradeSlots.length} installed)
            </p>
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

export default function ShipyardUpgradesPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <UpgradesContent systemId={systemId} />
    </QueryBoundary>
  );
}
