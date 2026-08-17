"use client";

import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { progressWidthPct, projectedWidthPct } from "@/lib/utils/math";

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
  /** Fraction in [0,1] — matches `progressOf` (`lib/engine/construction-readout.ts`) and every
   *  other progress consumer in the codebase; the ×100 conversion happens at render time via
   *  `progressWidthPct`. Renders the progress track whenever defined, including 0 — a stalled
   *  project stays visible rather than rendering nothing. */
  progress?: number;
  /** What the coming cycle adds, in `progress`'s units — drawn as a dimmer extension of the fill,
   *  matching the system construction screen's projected segment. Omitted (or 0) draws nothing,
   *  which is what a project the pool cannot reach this cycle reads. */
  nextCycleProgress?: number;
  /** Copper for build progress, amber for colony progress — cosmetic only. Required alongside
   *  `progress` to pick a fill colour; a `progress` with no `tone` still draws the track. */
  tone?: "build" | "colony";
  /** Flies the map to the system and opens the destination tab. Does NOT open the popover — that is
   *  hover/keyboard-only here (see `disableClickOpen` on `Popover`). */
  onActivate: () => void;
  /** The popover's content — the system's vitals table (pinned rows) or the project's detail
   *  (build/colony rows), rendered as a card. Supplied by the panel, not derived here. */
  card: ReactNode;
  /** The popover's accessible name. The popover is a `dialog`, and ArrowDown puts a screen-reader
   *  user inside it — unnamed, all they would hear is "dialog". Required rather than optional:
   *  every row's popover has a subject, and a default derived from `name` would go stale silently
   *  for the build rows, whose `name` already carries the project. */
  cardLabel: string;
}

/**
 * One line in the Tracker: a name, at most two icon-plus-number figures, and — for build/colony
 * rows — a 2px progress track flush to the row's bottom edge, full-bleed to the panel's sides
 * (the track sits on the `<li>`, outside the padded trigger button, so it reaches both edges). The
 * track carries the coming cycle's gain as a dimmer segment ahead of the fill, so a row shows both
 * where a project stands and how fast it is moving without opening its card.
 *
 * The row's trigger is a `Popover` with click-to-open disabled: activating the row (click or
 * Enter/Space) navigates via `onActivate`, and the card is reached only by hovering or
 * Tab-focusing the row, per the spec's split between the row's click and its card. Neither opening
 * path moves focus off the row, so Tab keeps walking the list; ArrowDown enters the popover and
 * Escape comes back — the keyboard convention shared by every popover in the game.
 */
export function TrackerRow({
  systemId,
  name,
  figures,
  progress,
  nextCycleProgress,
  tone,
  onActivate,
  card,
  cardLabel,
}: TrackerRowProps) {
  const fillColor = tone ? TONE_COLOR[tone] : "var(--color-accent)";
  const projectedPct =
    progress !== undefined && nextCycleProgress !== undefined
      ? projectedWidthPct(progress, nextCycleProgress)
      : 0;

  return (
    <li className="relative border-b border-border/60 last:border-b-0" data-system-id={systemId}>
      <Popover disableClickOpen openDelay={300} side="left" align="start">
        <PopoverTrigger>
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
        </PopoverTrigger>
        <PopoverContent aria-label={cardLabel}>{card}</PopoverContent>
      </Popover>
      {progress !== undefined && (
        <div aria-hidden className="absolute inset-x-0 bottom-0 flex h-0.5 bg-surface-active">
          <span
            className="block h-full"
            style={{ width: `${progressWidthPct(progress)}%`, backgroundColor: fillColor }}
          />
          {/* The coming cycle's gain, in the fill's own colour at half strength — a forecast, not
              work already done. Half rather than the construction screen's 40%: this track is 2px
              against that screen's 6px, and at that height a fainter segment stops reading. */}
          {projectedPct > 0 && (
            <span
              className="block h-full"
              style={{ width: `${projectedPct}%`, backgroundColor: fillColor, opacity: 0.5 }}
            />
          )}
        </div>
      )}
    </li>
  );
}
