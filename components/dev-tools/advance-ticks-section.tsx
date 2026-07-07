"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { useAdvanceTicksMutation } from "@/lib/hooks/use-dev-tools";

/**
 * Synchronously advance N ticks — useful while the loop is paused. Pacing
 * (pause/1×/5×/max) lives in the sidebar SpeedControls, not here.
 */
export function AdvanceTicksSection() {
  const [advanceCount, setAdvanceCount] = useState(10);
  const advanceMutation = useAdvanceTicksMutation();

  return (
    <div className="space-y-3">
      <Button
        variant="primary"
        size="xs"
        onClick={() => advanceMutation.mutate(1)}
        disabled={advanceMutation.isPending}
      >
        Step 1
      </Button>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <NumberInput
            label="Advance N ticks"
            value={advanceCount}
            onChange={(e) => setAdvanceCount(Number(e.target.value))}
            min={1}
            max={1000}
          />
        </div>
        <Button
          variant="primary"
          size="xs"
          onClick={() => advanceMutation.mutate(advanceCount)}
          disabled={advanceMutation.isPending}
        >
          {advanceMutation.isPending ? "Running..." : "Go"}
        </Button>
      </div>

      {advanceMutation.data && (
        <p className="text-xs text-text-secondary">
          Tick {advanceMutation.data.newTick} ({advanceMutation.data.elapsed}ms)
        </p>
      )}

      {advanceMutation.error && (
        <p className="text-xs text-red-400">{advanceMutation.error.message}</p>
      )}
    </div>
  );
}
