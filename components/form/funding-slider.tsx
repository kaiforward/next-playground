"use client";

import { useEffect, useRef, useState } from "react";
import { formSlots } from "./form-slots";
import { fractionPct } from "@/lib/utils/format";

export interface FundingSliderProps {
  label: string;
  /** Player-set funding fraction (0-1) — drawn as the thumb position. */
  set: number;
  /** Latched effective fraction from the last settlement (0-1) — drawn as the fill. */
  runs: number;
  /** Un-slidable lower bound (0-1) — hatched zone; drags below it pin here (e.g. maintenance 0.5). */
  floor?: number;
  /** Sliders render but don't respond on AI factions. */
  interactive: boolean;
  /** Fired once on release (pointer up / key up) with the new fraction. */
  onCommit: (value: number) => void;
}

/**
 * One budget band's funding bar: copper fill = what actually runs (last
 * settlement's paid fraction), thumb = the set slider. The two diverge only
 * when the settlement ladder shorts the band — tagged explicitly, since the
 * divergence is the insolvency signal.
 */
export function FundingSlider({ label, set, runs, floor = 0, interactive, onCommit }: FundingSliderProps) {
  // Draft holds the thumb during a drag; the server value re-adopts on refresh.
  const [draft, setDraft] = useState<number | null>(null);
  // Dedupes the release events (pointerup/keyup/blur can all fire for one gesture)
  // without clearing `draft` early — clearing on commit would snap the thumb back
  // to the stale server value until the next tick's `set` round-trips.
  const lastSent = useRef<number | null>(null);
  useEffect(() => {
    setDraft(null);
    lastSent.current = null;
  }, [set]);

  const floorPct = fractionPct(floor);
  const thumb = draft ?? fractionPct(set);
  const shorted = fractionPct(runs) < fractionPct(set);

  const commit = () => {
    if (draft !== null && draft !== fractionPct(set) && draft !== lastSent.current) {
      lastSent.current = draft;
      onCommit(draft / 100);
    }
  };

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className={formSlots.label}>{label}</span>
        <span className="font-mono text-xs text-text-secondary">
          set {thumb}% ·{" "}
          <span className={shorted ? "text-status-amber-light" : "text-text-primary"}>
            runs {fractionPct(runs)}%{shorted && " — shorted"}
          </span>
        </span>
      </div>
      <div className="relative h-2 bg-surface-active">
        {floor > 0 && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(45deg,var(--color-border),var(--color-border)_3px,transparent_3px,transparent_6px)]"
            style={{ width: `${floorPct}%` }}
          />
        )}
        <span aria-hidden className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${fractionPct(runs)}%` }} />
        {/* The input stays on the full 0-100 scale so the thumb's position lines up
            with the fill and hatch painted underneath (a floored `min` would compress
            min..100 onto the whole track and skew the geometry); the floor is enforced
            by clamping the draft instead — drags into the hatched zone pin at it. */}
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={thumb}
          disabled={!interactive}
          aria-label={`${label} funding`}
          aria-valuemin={floorPct}
          onChange={(e) => setDraft(Math.max(floorPct, Number(e.target.value)))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default
            [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-text-primary
            [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-[10px] [&::-moz-range-thumb]:border
            [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-text-primary [&::-moz-range-thumb]:rounded-none"
        />
      </div>
    </div>
  );
}
