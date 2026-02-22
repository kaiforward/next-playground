"use client";

import { useState } from "react";
import type { UpgradeSlotState } from "@/lib/types/game";
import { getModulesForSlot, type ModuleDefinition, type TierBonus } from "@/lib/constants/modules";
import { useUpgradeMutations } from "@/lib/hooks/use-upgrade-mutations";
import { formatCredits } from "@/lib/utils/format";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface UpgradeInstallDialogProps {
  shipId: string;
  slot: UpgradeSlotState | null;
  playerCredits: number;
  open: boolean;
  onClose: () => void;
}

export function UpgradeInstallDialog({
  shipId,
  slot,
  playerCredits,
  open,
  onClose,
}: UpgradeInstallDialogProps) {
  const { install } = useUpgradeMutations(shipId);
  const [selected, setSelected] = useState<{ mod: ModuleDefinition; tier: TierBonus } | null>(null);

  if (!slot) return null;

  const modules = getModulesForSlot(slot.slotType);

  const handleInstall = async () => {
    if (!selected) return;
    await install.mutateAsync({
      slotId: slot.id,
      moduleId: selected.mod.id,
      tier: selected.tier.tier,
    });
    setSelected(null);
    onClose();
  };

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} modal className="bg-slate-900 rounded-xl p-6 w-96 max-h-[80vh] overflow-y-auto">
      <h3 className="text-lg font-semibold text-white mb-1">Install Module</h3>
      <p className="text-xs text-white/40 mb-4 capitalize">{slot.slotType} slot</p>

      <div className="space-y-3 mb-4">
        {modules.map((mod) => (
          <ModuleOption
            key={mod.id}
            mod={mod}
            playerCredits={playerCredits}
            selected={selected?.mod.id === mod.id ? selected.tier.tier : null}
            onSelect={(tier) => setSelected({ mod, tier })}
          />
        ))}
      </div>

      {install.error && (
        <p className="text-sm text-red-400 mb-3">{install.error.message}</p>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={handleClose} className="flex-1">
          Cancel
        </Button>
        <Button
          variant="action"
          color="green"
          size="sm"
          className="flex-1"
          disabled={!selected || playerCredits < (selected?.tier.cost ?? Infinity) || install.isPending}
          onClick={handleInstall}
        >
          {install.isPending
            ? "Installing..."
            : selected
              ? `Install (${formatCredits(selected.tier.cost)})`
              : "Select a module"}
        </Button>
      </div>
    </Dialog>
  );
}

interface ModuleOptionProps {
  mod: ModuleDefinition;
  playerCredits: number;
  selected: number | null;
  onSelect: (tier: TierBonus) => void;
}

function ModuleOption({ mod, playerCredits, selected, onSelect }: ModuleOptionProps) {
  return (
    <div className="rounded-lg bg-white/5 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-white">{mod.name}</span>
        <Badge color={mod.category === "tiered" ? "blue" : "purple"}>
          {mod.category === "tiered" ? "Tiered" : "Capability"}
        </Badge>
      </div>
      <p className="text-xs text-white/40 mb-2">{mod.description}</p>
      <div className="flex gap-1.5">
        {mod.tiers.map((tier) => {
          const canAfford = playerCredits >= tier.cost;
          const isSelected = selected === tier.tier;
          return (
            <button
              key={tier.tier}
              onClick={() => onSelect(tier)}
              disabled={!canAfford}
              className={`flex-1 rounded px-2 py-1.5 text-xs transition-colors ${
                isSelected
                  ? "bg-blue-500/30 text-blue-300 ring-1 ring-blue-500/50"
                  : canAfford
                    ? "bg-white/5 text-white/60 hover:bg-white/10"
                    : "bg-white/5 text-white/20 cursor-not-allowed"
              }`}
            >
              <div className="font-medium">
                {tier.label || "Install"}
              </div>
              <div className="text-[10px] opacity-70">
                {formatCredits(tier.cost)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
