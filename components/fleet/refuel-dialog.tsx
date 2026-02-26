"use client";

import { useState, useMemo } from "react";
import type { ShipState } from "@/lib/types/game";
import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";
import { formatCredits } from "@/lib/utils/format";
import { useRefuelMutation } from "@/lib/hooks/use-refuel-mutation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RangeInput } from "@/components/form/range-input";

interface RefuelDialogProps {
  ship: ShipState;
  playerCredits: number;
  open: boolean;
  onClose: () => void;
}

export function RefuelDialog({ ship, playerCredits, open, onClose }: RefuelDialogProps) {
  const fuelNeeded = ship.maxFuel - Math.round(ship.fuel);
  const maxAffordable = Math.floor(playerCredits / REFUEL_COST_PER_UNIT);
  const sliderMax = Math.min(fuelNeeded, maxAffordable);

  const [amount, setAmount] = useState(sliderMax);

  const clampedAmount = useMemo(
    () => Math.max(1, Math.min(amount, sliderMax)),
    [amount, sliderMax],
  );

  const totalCost = clampedAmount * REFUEL_COST_PER_UNIT;

  const mutation = useRefuelMutation(ship.id);

  const handleRefuel = async () => {
    await mutation.mutateAsync(clampedAmount);
    onClose();
  };

  const handleFillTank = async () => {
    await mutation.mutateAsync(sliderMax);
    onClose();
  };

  if (fuelNeeded <= 0 || sliderMax <= 0) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      modal
      size="sm"
    >
      <h2 className="text-lg font-bold text-white mb-1">Refuel {ship.name}</h2>
      <p className="text-xs text-text-muted mb-5">{REFUEL_COST_PER_UNIT} CR per unit</p>

      <div className="space-y-4">
        <RangeInput
          id="refuel-amount"
          label="Fuel Amount"
          valueLabel={`${clampedAmount} / ${fuelNeeded}`}
          size="md"
          min={1}
          max={sliderMax}
          step={1}
          value={clampedAmount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />

        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">
            {clampedAmount} fuel × {REFUEL_COST_PER_UNIT} CR
          </span>
          <span className="text-white font-medium">
            = {formatCredits(totalCost)}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Balance</span>
          <span>{formatCredits(playerCredits)}</span>
        </div>

        {mutation.error && (
          <p className="text-xs text-red-400">{mutation.error.message}</p>
        )}

        <div className="flex gap-2">
          <Button
            variant="action"
            color="cyan"
            size="md"
            className="flex-1"
            onClick={handleRefuel}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Refueling..." : `Refuel ${formatCredits(totalCost)}`}
          </Button>
          {clampedAmount < sliderMax && (
            <Button
              variant="pill"
              color="cyan"
              size="md"
              onClick={handleFillTank}
              disabled={mutation.isPending}
            >
              Fill Tank
            </Button>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          fullWidth
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
