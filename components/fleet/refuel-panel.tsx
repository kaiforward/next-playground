"use client";

import { useState, useMemo } from "react";
import type { ShipState } from "@/lib/types/game";
import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";
import { useRefuelMutation } from "@/lib/hooks/use-refuel-mutation";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { RefuelControls } from "./refuel-controls";

interface RefuelPanelProps {
  ship: ShipState;
  playerCredits: number;
}

export function RefuelPanel({ ship, playerCredits }: RefuelPanelProps) {
  const fuelNeeded = ship.maxFuel - Math.round(ship.fuel);
  const maxAffordable = Math.floor(playerCredits / REFUEL_COST_PER_UNIT);
  const sliderMax = Math.min(fuelNeeded, maxAffordable);

  const defaultAmount = sliderMax;
  const [amount, setAmount] = useState(defaultAmount);

  // Keep amount in bounds if props change (e.g. after a partial refuel)
  const clampedAmount = useMemo(
    () => Math.max(1, Math.min(amount, sliderMax)),
    [amount, sliderMax],
  );

  const totalCost = clampedAmount * REFUEL_COST_PER_UNIT;

  const mutation = useRefuelMutation(ship.id);

  const handleRefuel = () => {
    mutation.mutate(clampedAmount);
  };

  // Don't render if tank is full or player can't afford even 1 unit
  if (fuelNeeded <= 0 || sliderMax <= 0) return null;

  return (
    <Card variant="bordered" padding="md">
      <CardHeader title="Refuel" subtitle={`${REFUEL_COST_PER_UNIT} CR per unit`} />
      <CardContent>
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
          isPending={mutation.isPending}
          error={mutation.error}
        />
      </CardContent>
    </Card>
  );
}
