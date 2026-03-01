"use client";

import { useState, useMemo } from "react";
import type { ShipState } from "@/lib/types/game";
import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";
import { useRefuelMutation } from "@/lib/hooks/use-refuel-mutation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefuelControls } from "./refuel-controls";

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
      <h2 className="text-lg font-bold text-text-primary mb-1">Refuel {ship.name}</h2>
      <p className="text-xs text-text-muted mb-5">{REFUEL_COST_PER_UNIT} CR per unit</p>

      <RefuelControls
        ship={ship}
        playerCredits={playerCredits}
        amount={clampedAmount}
        setAmount={setAmount}
        clampedAmount={clampedAmount}
        totalCost={totalCost}
        sliderMax={sliderMax}
        fuelNeeded={fuelNeeded}
        onRefuel={handleRefuel}
        onFillTank={handleFillTank}
        isPending={mutation.isPending}
        error={mutation.error}
      />

      <Button
        variant="ghost"
        size="sm"
        fullWidth
        onClick={onClose}
        className="mt-4"
      >
        Cancel
      </Button>
    </Dialog>
  );
}
