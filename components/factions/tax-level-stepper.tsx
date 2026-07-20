"use client";

import { useRef, type KeyboardEvent } from "react";
import { ALL_TAX_LEVELS } from "@/lib/types/guards";
import { TAX_LEVEL_LABELS } from "@/lib/constants/ui";
import type { TaxLevel } from "@/lib/types/game";

export interface TaxLevelStepperProps {
  value: TaxLevel;
  /** Segments render but don't respond on AI factions. */
  interactive: boolean;
  onChange: (level: TaxLevel) => void;
}

/** Five-segment tax stance control — segments fill up to the current level. */
export function TaxLevelStepper({ value, interactive, onChange }: TaxLevelStepperProps) {
  const currentIndex = ALL_TAX_LEVELS.indexOf(value);
  const segmentRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving-tabindex arrow navigation: only the selected segment is tabbable,
  // and the arrow keys step selection + move focus onto the new segment.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextIndex = Math.min(ALL_TAX_LEVELS.length - 1, currentIndex + 1);
    }
    if (nextIndex === null || nextIndex === currentIndex) return;
    event.preventDefault();
    onChange(ALL_TAX_LEVELS[nextIndex]);
    segmentRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-text-primary">{TAX_LEVEL_LABELS[value]}</span>
      <div className="flex gap-1" role="radiogroup" aria-label="Tax level" onKeyDown={handleKeyDown}>
        {ALL_TAX_LEVELS.map((level, i) => (
          <button
            key={level}
            ref={(el) => {
              segmentRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={level === value}
            aria-label={TAX_LEVEL_LABELS[level]}
            title={TAX_LEVEL_LABELS[level]}
            disabled={!interactive}
            tabIndex={level === value ? 0 : -1}
            onClick={() => onChange(level)}
            className={`h-3 w-7 transition-colors ${i <= currentIndex ? "bg-accent" : "bg-surface-active"} ${
              interactive ? "cursor-pointer hover:opacity-80" : "cursor-default"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
