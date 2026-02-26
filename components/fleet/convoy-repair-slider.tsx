"use client";

import { useState, useMemo } from "react";
import type { ConvoyState } from "@/lib/types/game";
import { computeConvoyRepairPlan } from "@/lib/engine/convoy-repair";
import { useConvoyRepairMutation } from "@/lib/hooks/use-convoy";
import { formatCredits } from "@/lib/utils/format";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RangeInput } from "@/components/form/range-input";

interface ConvoyRepairSliderProps {
  convoy: ConvoyState;
  playerCredits: number;
  open: boolean;
  onClose: () => void;
}

export function ConvoyRepairSlider({
  convoy,
  playerCredits,
  open,
  onClose,
}: ConvoyRepairSliderProps) {
  const [percent, setPercent] = useState(100);
  const mutation = useConvoyRepairMutation(convoy.id);

  const fraction = percent / 100;

  const plan = useMemo(
    () => computeConvoyRepairPlan(convoy.members, fraction),
    [convoy.members, fraction],
  );

  const canAfford = playerCredits >= plan.totalCost;
  const hasRepairs = plan.totalCost > 0;

  const handleRepair = async () => {
    await mutation.mutateAsync(fraction);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      modal
      size="sm"
    >
      <h2 className="text-lg font-bold text-white mb-1">
        Repair Convoy
      </h2>
      <p className="text-xs text-text-muted mb-5">
        {convoy.name ?? "Convoy"} &mdash; {convoy.members.length} ships
      </p>

      <div className="space-y-4">
        <RangeInput
          id="convoy-repair-percent"
          label="Repair Amount"
          valueLabel={`${percent}%`}
          size="md"
          min={0}
          max={100}
          step={5}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
        />

        {/* Per-ship preview */}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {plan.ships.map((sp) => {
            if (sp.healAmount <= 0) return null;
            const ship = convoy.members.find((m) => m.id === sp.shipId)!;
            return (
              <div key={sp.shipId} className="py-1.5 px-3 rounded bg-surface">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-white font-medium">{sp.shipName}</span>
                  <span className="text-[10px] text-text-muted">
                    +{sp.healAmount} hull &middot; {formatCredits(sp.cost)}
                  </span>
                </div>
                <ProgressBar
                  label="Hull"
                  value={sp.hullAfter}
                  max={ship.hullMax}
                  color={sp.hullAfter / ship.hullMax < 0.3 ? "red" : "green"}
                  size="sm"
                />
              </div>
            );
          })}
        </div>

        {/* Totals */}
        <div className="flex items-center justify-between text-sm border-t border-border pt-3">
          <span className="text-white/60">Total repair</span>
          <span className="text-white font-medium">
            +{plan.totalHealed} hull &middot; {formatCredits(plan.totalCost)}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Balance</span>
          <span className={!canAfford && hasRepairs ? "text-red-400" : ""}>
            {formatCredits(playerCredits)}
          </span>
        </div>

        {mutation.error && (
          <p className="text-xs text-red-400">{mutation.error.message}</p>
        )}

        <div className="flex gap-2">
          <Button
            variant="action"
            color="green"
            size="md"
            className="flex-1"
            onClick={handleRepair}
            disabled={!canAfford || !hasRepairs || mutation.isPending}
          >
            {mutation.isPending ? "Repairing..." : `Repair ${formatCredits(plan.totalCost)}`}
          </Button>
          <Button variant="ghost" size="md" onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
