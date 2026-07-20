"use client";

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
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-text-primary">{TAX_LEVEL_LABELS[value]}</span>
      <div className="flex gap-1" role="radiogroup" aria-label="Tax level">
        {ALL_TAX_LEVELS.map((level, i) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={level === value}
            aria-label={TAX_LEVEL_LABELS[level]}
            title={TAX_LEVEL_LABELS[level]}
            disabled={!interactive}
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
