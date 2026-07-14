"use client";

import { Pause, FastForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { useSpeedMutation } from "@/lib/hooks/use-game-lifecycle";
import type { Speed } from "@/lib/world/tick-loop";

const SPEED_OPTIONS: { value: Speed; label: React.ReactNode; title: string }[] = [
  { value: "paused", label: <Pause className="w-3.5 h-3.5" />, title: "Pause" },
  { value: 1, label: "1×", title: "1 tick per second" },
  { value: 5, label: "5×", title: "5 ticks per second" },
  { value: "max", label: <FastForward className="w-3.5 h-3.5" />, title: "Max speed" },
];

interface SpeedControlsProps {
  /**
   * "vertical" (default) stacks the button row above a "TPS <n>" line, for
   * narrow columns. "horizontal" renders just the button row inline, for the
   * topbar — the caller renders its own combined tick/tps readout alongside.
   */
  layout?: "vertical" | "horizontal";
}

/**
 * Simulation speed picker, driven by the SSE payload (current speed) and the
 * speed mutation.
 */
export function SpeedControls({ layout = "vertical" }: SpeedControlsProps) {
  const { speed, achievedTps } = useTickContext();
  const speedMutation = useSpeedMutation();

  const buttons = (
    <div className={`flex gap-1 ${layout === "vertical" ? "" : "shrink-0"}`}>
      {SPEED_OPTIONS.map((option) => (
        <Button
          key={String(option.value)}
          variant={speed === option.value ? "primary" : "ghost"}
          size="xs"
          className={layout === "vertical" ? "flex-1 px-0" : "px-0 w-7"}
          title={option.title}
          // Icon-only options (Pause/FastForward) have no visible text, so give
          // them an accessible name; the "1×"/"5×" options already read fine.
          aria-label={typeof option.label === "string" ? undefined : option.title}
          aria-pressed={speed === option.value}
          disabled={speedMutation.isPending}
          onClick={() => speedMutation.mutate(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );

  if (layout === "horizontal") {
    return buttons;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {buttons}
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">TPS</span>
        <span className="font-mono text-text-primary">{achievedTps}</span>
      </div>
    </div>
  );
}
