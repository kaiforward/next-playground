"use client";

import type { ShipState } from "@/lib/types/game";
import { calculateRepairCost } from "@/lib/engine/damage";
import { useRepairMutation } from "@/lib/hooks/use-repair-mutation";
import { formatCredits } from "@/lib/utils/format";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatList, StatRow } from "@/components/ui/stat-row";

interface RepairDialogProps {
  ship: ShipState;
  playerCredits: number;
  open: boolean;
  onClose: () => void;
}

export function RepairDialog({ ship, playerCredits, open, onClose }: RepairDialogProps) {
  const repairMutation = useRepairMutation(ship.id);

  const repairResult = calculateRepairCost(ship.hullMax, ship.hullCurrent);
  const cost = repairResult.totalCost;
  const canAfford = playerCredits >= cost;

  const handleRepair = async () => {
    await repairMutation.mutateAsync();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} modal className="bg-slate-900 rounded-xl p-6 w-80">
      <h3 className="text-lg font-semibold text-white mb-4">Repair Ship</h3>

      <StatList className="mb-4">
        <StatRow label="Hull">
          <span className="text-sm text-white">
            {ship.hullCurrent} / {ship.hullMax}
          </span>
        </StatRow>
        <StatRow label="Repair cost">
          <span className={`text-sm ${canAfford ? "text-white" : "text-red-400"}`}>
            {formatCredits(cost)}
          </span>
        </StatRow>
        <StatRow label="Your balance">
          <span className="text-sm text-white/60">{formatCredits(playerCredits)}</span>
        </StatRow>
      </StatList>

      {repairMutation.error && (
        <p className="text-sm text-red-400 mb-3">{repairMutation.error.message}</p>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">
          Cancel
        </Button>
        <Button
          variant="action"
          color="green"
          size="sm"
          className="flex-1"
          disabled={!canAfford || cost === 0 || repairMutation.isPending}
          onClick={handleRepair}
        >
          {repairMutation.isPending ? "Repairing..." : "Repair"}
        </Button>
      </div>
    </Dialog>
  );
}
