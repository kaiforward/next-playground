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

/**
 * Simulation speed picker (button row), driven by the SSE payload (current
 * speed) and the speed mutation. The topbar renders the tick/TPS readout
 * alongside it.
 */
export function SpeedControls() {
  const { speed } = useTickContext();
  const speedMutation = useSpeedMutation();

  return (
    <div className="flex gap-1 shrink-0">
      {SPEED_OPTIONS.map((option) => (
        <Button
          key={String(option.value)}
          variant={speed === option.value ? "primary" : "ghost"}
          size="xs"
          className="px-0 w-7"
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
}
