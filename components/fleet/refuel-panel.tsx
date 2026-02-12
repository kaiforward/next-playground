"use client";

import { useState, useMemo } from "react";
import type { ShipState } from "@/lib/types/game";
import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";
import { formatCredits } from "@/lib/utils/format";
import { useRefuelMutation } from "@/lib/hooks/use-refuel-mutation";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RangeInput } from "@/components/form/range-input";

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
      <CardContent className="space-y-4">
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

        <div className="flex items-center justify-between text-xs text-white/40">
          <span>Balance</span>
          <span>{formatCredits(playerCredits)}</span>
        </div>

        {mutation.error && (
          <p className="text-xs text-red-400">{mutation.error.message}</p>
        )}

        <Button
          variant="action"
          color="cyan"
          className="w-full"
          onClick={handleRefuel}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Refueling..." : `Refuel for ${formatCredits(totalCost)}`}
        </Button>
      </CardContent>
    </Card>
  );
}
