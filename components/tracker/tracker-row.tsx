"use client";

import type { ReactNode } from "react";
import { RichCard, RichCardContent, RichCardTrigger } from "@/components/ui/rich-card";
import { clamp } from "@/lib/utils/math";

/** One icon-plus-number figure on a row — population's person icon, stability's colour swatch
 *  beside its value. `label` never renders visibly (the row stays one line); it exists so the
 *  figure's meaning reaches the row's accessible name as real text, not a swatch colour alone. */
export interface TrackerFigure {
  /** Population's person icon. Omitted for a figure that carries a `swatchColor` instead
   *  (stability) — the row's spec pairs each figure with exactly one of the two. */
  icon?: ReactNode;
  label: string;
  value: string;
  /** Stability's small colour swatch. Always paired with `value` — colour is never the only
   *  signal, per the design spec. */
  swatchColor?: string;
}

const TONE_COLOR: Record<"build" | "colony", string> = {
  build: "var(--color-accent)",
  colony: "var(--color-secondary)",
};

export interface TrackerRowProps {
  systemId: string;
  name: string;
  figures: TrackerFigure[];
  /** 0-100. Renders the progress track whenever defined, including 0 — a stalled project stays
   *  visible rather than rendering nothing. */
  progress?: number;
  /** Copper for build progress, amber for colony progress — cosmetic only. Required alongside
   *  `progress` to pick a fill colour; a `progress` with no `tone` still draws the track. */
  tone?: "build" | "colony";
  /** Flies the map to the system and opens the destination tab. Does NOT open the card — that is
   *  hover/keyboard-only here (see `disableClickOpen` on `RichCard`). */
  onActivate: () => void;
  /** Rich-card content — the system's vitals table (pinned rows) or the project's detail
   *  (build/colony rows). Supplied by the panel, not derived here. */
  card: ReactNode;
}

/**
 * One line in the Tracker: a name, at most two icon-plus-number figures, and — for build/colony
 * rows — a 2px progress track flush to the row's bottom edge, full-bleed to the panel's sides
 * (the track sits on the `<li>`, outside the padded trigger button, so it reaches both edges).
 *
 * The row's trigger is a `RichCard` with click-to-open disabled: activating the row (click or
 * Enter/Space) navigates via `onActivate`, and the card is reached only by hovering or
 * Tab-focusing the row, per the spec's split between the row's click and its card.
 */
export function TrackerRow({ systemId, name, figures, progress, tone, onActivate, card }: TrackerRowProps) {
  const fillColor = tone ? TONE_COLOR[tone] : "var(--color-accent)";

  return (
    <li className="relative border-b border-border/60 last:border-b-0" data-system-id={systemId}>
      <RichCard disableClickOpen openDelay={300} side="left" align="start">
        <RichCardTrigger>
          <button
            type="button"
            onClick={onActivate}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover"
          >
            <span className="flex-1 truncate">{name}</span>
            {figures.map((figure) => (
              <span
                key={figure.label}
                className="flex shrink-0 items-center gap-1 font-mono text-text-secondary"
              >
                {figure.icon && (
                  <span aria-hidden className="text-text-tertiary">
                    {figure.icon}
                  </span>
                )}
                {figure.swatchColor && (
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0"
                    style={{ backgroundColor: figure.swatchColor }}
                  />
                )}
                <span className="sr-only">{figure.label}</span>
                {figure.value}
              </span>
            ))}
          </button>
        </RichCardTrigger>
        <RichCardContent>{card}</RichCardContent>
      </RichCard>
      {progress !== undefined && (
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-active">
          <span
            className="block h-full"
            style={{ width: `${clamp(progress, 0, 100)}%`, backgroundColor: fillColor }}
          />
        </div>
      )}
    </li>
  );
}
