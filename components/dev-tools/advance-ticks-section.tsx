"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { useAdvanceTicksMutation, useInspectWorldMutation } from "@/lib/hooks/use-dev-tools";

/**
 * Synchronously advance N ticks — useful while the loop is paused. Pacing
 * (pause/1×/5×/max) lives in the topbar's SpeedControls, not here.
 */
export function AdvanceTicksSection() {
  const [advanceCount, setAdvanceCount] = useState(10);
  const advanceMutation = useAdvanceTicksMutation();
  const inspectMutation = useInspectWorldMutation();

  // The console IS the affordance (spec §10: "exposing the current snapshot" for console
  // inspection) — logged as a side effect of a successful fetch, not inline in the click handler,
  // so a re-render never re-logs a stale `data` from a PRIOR click.
  useEffect(() => {
    if (inspectMutation.data) console.log("[dev-tools] inspectWorld:", inspectMutation.data);
  }, [inspectMutation.data]);

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

      <div className="border-t border-border pt-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => inspectMutation.mutate()}
          disabled={inspectMutation.isPending}
        >
          {inspectMutation.isPending ? "Inspecting..." : "Inspect World (console)"}
        </Button>

        {inspectMutation.data && (
          <p className="text-xs text-text-secondary mt-1">
            Tick {inspectMutation.data.meta.currentTick} — {inspectMutation.data.counts.systems} systems, logged
            to console
          </p>
        )}

        {inspectMutation.error && (
          <p className="text-xs text-red-400">{inspectMutation.error.message}</p>
        )}
      </div>
    </div>
  );
}
