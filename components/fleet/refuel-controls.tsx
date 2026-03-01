import type { ShipState } from "@/lib/types/game";
import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";
import { formatCredits } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { RangeInput } from "@/components/form/range-input";

interface RefuelControlsProps {
  ship: ShipState;
  playerCredits: number;
  amount: number;
  setAmount: (value: number) => void;
  clampedAmount: number;
  totalCost: number;
  sliderMax: number;
  fuelNeeded: number;
  onRefuel: () => void;
  onFillTank?: () => void;
  isPending: boolean;
  error?: Error | null;
}

export function RefuelControls({
  playerCredits,
  amount,
  setAmount,
  clampedAmount,
  totalCost,
  sliderMax,
  fuelNeeded,
  onRefuel,
  onFillTank,
  isPending,
  error,
}: RefuelControlsProps) {
  return (
    <div className="space-y-4">
      <RangeInput
        id="refuel-amount"
        label="Fuel Amount"
        valueLabel={`${clampedAmount} / ${fuelNeeded}`}
        size="md"
        min={1}
        max={sliderMax}
        step={1}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
      />

      <div className="flex items-center justify-between text-sm">
        <span className="text-text-secondary">
          {clampedAmount} fuel × {REFUEL_COST_PER_UNIT} CR
        </span>
        <span className="text-text-primary font-medium">
          = {formatCredits(totalCost)}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>Balance</span>
        <span>{formatCredits(playerCredits)}</span>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error.message}</p>
      )}

      <div className="flex gap-2">
        <Button
          variant="action"
          color="cyan"
          size="md"
          className="flex-1"
          onClick={onRefuel}
          disabled={isPending}
        >
          {isPending ? "Refueling..." : `Refuel ${formatCredits(totalCost)}`}
        </Button>
        {onFillTank && clampedAmount < sliderMax && (
          <Button
            variant="pill"
            color="cyan"
            size="md"
            onClick={onFillTank}
            disabled={isPending}
          >
            Fill Tank
          </Button>
        )}
      </div>
    </div>
  );
}
