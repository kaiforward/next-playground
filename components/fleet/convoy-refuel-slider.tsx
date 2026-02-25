"use client";

import { useState, useMemo } from "react";
import type { ConvoyState } from "@/lib/types/game";
import { computeConvoyRefuelPlan } from "@/lib/engine/convoy-refuel";
import { useConvoyRefuelMutation } from "@/lib/hooks/use-convoy";
import { formatCredits } from "@/lib/utils/format";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RangeInput } from "@/components/form/range-input";

interface ConvoyRefuelSliderProps {
  convoy: ConvoyState;
  playerCredits: number;
  open: boolean;
  onClose: () => void;
}

export function ConvoyRefuelSlider({
  convoy,
  playerCredits,
  open,
  onClose,
}: ConvoyRefuelSliderProps) {
  const [percent, setPercent] = useState(100);
  const mutation = useConvoyRefuelMutation(convoy.id);

  const fraction = percent / 100;

  const plan = useMemo(
    () => computeConvoyRefuelPlan(convoy.members, fraction),
    [convoy.members, fraction],
  );

  const canAfford = playerCredits >= plan.totalCost;
  const hasRefuels = plan.totalCost > 0;

  const handleRefuel = async () => {
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
        Refuel Convoy
      </h2>
      <p className="text-xs text-text-muted mb-5">
        {convoy.name ?? "Convoy"} &mdash; {convoy.members.length} ships
      </p>

      <div className="space-y-4">
        <RangeInput
          id="convoy-refuel-percent"
          label="Refuel Amount"
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
            if (sp.fuelAmount <= 0) return null;
            const ship = convoy.members.find((m) => m.id === sp.shipId)!;
            return (
              <div key={sp.shipId} className="py-1.5 px-3 rounded bg-surface">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-white font-medium">{sp.shipName}</span>
                  <span className="text-[10px] text-text-muted">
                    +{sp.fuelAmount} fuel &middot; {formatCredits(sp.cost)}
                  </span>
                </div>
                <ProgressBar
                  label="Fuel"
                  value={sp.fuelAfter}
                  max={ship.maxFuel}
                  color={sp.fuelAfter / ship.maxFuel < 0.3 ? "red" : "blue"}
                  size="sm"
                />
              </div>
            );
          })}
        </div>

        {/* Totals */}
        <div className="flex items-center justify-between text-sm border-t border-border pt-3">
          <span className="text-white/60">Total fuel</span>
          <span className="text-white font-medium">
            +{plan.totalFuel} fuel &middot; {formatCredits(plan.totalCost)}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Balance</span>
          <span className={!canAfford && hasRefuels ? "text-red-400" : ""}>
            {formatCredits(playerCredits)}
          </span>
        </div>

        {mutation.error && (
          <p className="text-xs text-red-400">{mutation.error.message}</p>
        )}

        <div className="flex gap-2">
          <Button
            variant="action"
            color="blue"
            size="md"
            className="flex-1"
            onClick={handleRefuel}
            disabled={!canAfford || !hasRefuels || mutation.isPending}
          >
            {mutation.isPending ? "Refueling..." : `Refuel ${formatCredits(plan.totalCost)}`}
          </Button>
          <Button variant="ghost" size="md" onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
