"use client";

import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { triggerLabelStyles } from "./tooltip";

export interface PopoverTriggerLabelProps {
  /** The trigger's own label — the visible text a player reads before opening the popover. */
  children: ReactNode;
  /** The popover's body. Unlike `TermLabel`, whose content is always the same fixed glossary
   *  definition (`TERMS[id].body`), this is arbitrary per-call-site content the caller supplies —
   *  a row's own yield breakdown, a building's own staffing, a pop's own shortage. */
  content: ReactNode;
  /** Passed straight through to `PopoverContent`'s own `title` — the header region itself is
   *  structural (every `dwell` popover reserves the pin's gutter), this is only the optional
   *  heading inside it. */
  title?: ReactNode;
  /** Passed straight through to `PopoverContent`'s own `titleMeta`. */
  titleMeta?: ReactNode;
  /** Extra classes on the trigger button — merged onto `triggerLabelStyles`, the dotted-grey
   *  trigger-label base this shares with `TermLabel` (`components/ui/tooltip.tsx`). */
  className?: string;
}

/**
 * A label that opens a dwell popover carrying arbitrary content — a plain hover tooltip's
 * equivalent for content that has to be enterable, keyboard-reachable and ancestor-stack-aware
 * (via `Popover`'s `dwell` mode).
 *
 * Distinct from its sibling `TermLabel` (`components/ui/term-label.tsx`), which always opens the
 * same fixed glossary definition for a given `TermId`: a `PopoverTriggerLabel`'s popover is THIS
 * call site's own data — a deposit row's yield breakdown, a building's own staffing, a pop's own
 * shortage — not a definition. Both are dwell popovers; they differ only in where the content
 * comes from. The two are siblings: both wear `triggerLabelStyles` and take the same `className` +
 * label-as-children shape, and differ only in where their popover's content comes from.
 *
 * Extracted per `AGENTS.md`'s second-occurrence rule: this shell is what
 * `components/system/industry-panel.tsx`, `components/panels/system-astrography.tsx`,
 * `components/system/population-panel.tsx` and `components/system/potential-yield-table.tsx` would
 * otherwise each hand-roll as `<Popover dwell><PopoverTrigger><button
 * className={triggerLabelStyles(...)}>`.
 */
export function PopoverTriggerLabel({
  children,
  content,
  title,
  titleMeta,
  className,
}: PopoverTriggerLabelProps) {
  return (
    <Popover dwell>
      <PopoverTrigger>
        <button type="button" className={triggerLabelStyles({ className })}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent title={title} titleMeta={titleMeta}>
        {content}
      </PopoverContent>
    </Popover>
  );
}
