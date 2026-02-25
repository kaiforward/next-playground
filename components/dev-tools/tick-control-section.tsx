"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { useAdvanceTicksMutation, useTickControlMutation } from "@/lib/hooks/use-dev-tools";

export function TickControlSection() {
  const [advanceCount, setAdvanceCount] = useState(10);
  const advanceMutation = useAdvanceTicksMutation();
  const tickControlMutation = useTickControlMutation();

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          variant="action"
          color="red"
          size="xs"
          onClick={() => tickControlMutation.mutate({ action: "pause" })}
          disabled={tickControlMutation.isPending}
        >
          Pause
        </Button>
        <Button
          variant="action"
          color="green"
          size="xs"
          onClick={() => tickControlMutation.mutate({ action: "resume" })}
          disabled={tickControlMutation.isPending}
        >
          Resume
        </Button>
        <Button
          variant="primary"
          size="xs"
          onClick={() => advanceMutation.mutate(1)}
          disabled={advanceMutation.isPending}
        >
          Step 1
        </Button>
      </div>

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
        <p className="text-xs text-text-muted">
          Tick {advanceMutation.data.newTick} ({advanceMutation.data.elapsed}ms)
        </p>
      )}

      {advanceMutation.error && (
        <p className="text-xs text-red-400">{advanceMutation.error.message}</p>
      )}
    </div>
  );
}
