"use client";

import { use, useState, useMemo } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { useUpgradeMutations } from "@/lib/hooks/use-upgrade-mutations";
import type { UpgradeSlotState } from "@/lib/types/game";
import { SelectInput, type SelectOption } from "@/components/form/select-input";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { TabList, Tab } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { ShipyardPanel } from "@/components/shipyard/shipyard-panel";
import { useDialog } from "@/components/ui/dialog";
import { UpgradeInstallDialog } from "@/components/fleet/upgrade-install-dialog";
import { SelectedShipCard } from "@/components/fleet/selected-ship-card";

type ShipyardTab = "purchase" | "upgrades";

function PurchaseContent({ systemId }: { systemId: string }) {
  const { fleet } = useFleet();
  return <ShipyardPanel systemId={systemId} playerCredits={fleet.credits} />;
}

function UpgradesContent({ systemId }: { systemId: string }) {
  const { fleet } = useFleet();
  const { convoys } = useConvoys();
  const [selectedShipId, setSelectedShipId] = useState<string>("");
  const [installSlot, setInstallSlot] = useState<UpgradeSlotState | null>(null);
  const upgradeDialog = useDialog();

  const eligibleShips = useMemo(() => {
    return fleet.ships.filter(
      (s) =>
        s.systemId === systemId &&
        s.status === "docked" &&
        !s.disabled,
    );
  }, [fleet.ships, systemId]);

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

  function handleInstallClick(slot: UpgradeSlotState) {
    setInstallSlot(slot);
    upgradeDialog.onOpen();
  }

  function handleInstallClose() {
    setInstallSlot(null);
    upgradeDialog.onClose();
  }

  if (eligibleShips.length === 0) {
    return (
      <EmptyState
        message="No eligible ships at this system. Ships must be docked and not disabled to install upgrades."
        className="py-12"
      />
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

function ShipyardContent({ systemId }: { systemId: string }) {
  const [tab, setTab] = useState<ShipyardTab>("purchase");

  return (
    <>
      <TabList className="mb-4" aria-label="Shipyard sections">
        <Tab active={tab === "purchase"} onClick={() => setTab("purchase")}>
          Ship Dealer
        </Tab>
        <Tab active={tab === "upgrades"} onClick={() => setTab("upgrades")}>
          Upgrade Bay
        </Tab>
      </TabList>

      {tab === "purchase" && <PurchaseContent systemId={systemId} />}
      {tab === "upgrades" && <UpgradesContent systemId={systemId} />}
    </>
  );
}

export default function ShipyardPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <ShipyardContent systemId={systemId} />
    </QueryBoundary>
  );
}
