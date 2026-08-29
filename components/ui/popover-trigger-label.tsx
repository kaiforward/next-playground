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
  /** Extra classes on the trigger button — merged onto `triggerLabelStyles` the same way
   *  `TooltipTriggerLabel`'s own `className` prop is. */
  className?: string;
  /** Extra classes on the popover body — sizing (`w-56`, `w-80`, ...), the same passthrough
   *  `TooltipContent`'s own `className` prop gives a `Tooltip` consumer. */
  contentClassName?: string;
}

/**
 * A label that opens a dwell popover carrying arbitrary content — the `TooltipTriggerLabel` +
 * `TooltipContent` pairing's dwell-popover equivalent (enterable, keyboard-reachable,
 * ancestor-stack-aware via `Popover`'s `dwell` mode) rather than a plain hover tooltip.
 *
 * Distinct from its sibling `TermLabel` (`components/ui/term-label.tsx`), which always opens the
 * same fixed glossary definition for a given `TermId`: a `PopoverTriggerLabel`'s popover is THIS
 * call site's own data — a deposit row's yield breakdown, a building's own staffing, a pop's own
 * shortage — not a definition. Both are dwell popovers; they differ only in where the content
 * comes from. Named to mirror `TooltipTriggerLabel` exactly, since the two otherwise take the same
 * `className` + label-as-children shape and differ only in which popover kind backs them.
 *
 * Extracted per `AGENTS.md`'s second-occurrence rule: this shell is what
 * `components/system/industry-panel.tsx`, `components/panels/system-astrography.tsx`,
 * `components/system/population-panel.tsx` and `components/system/potential-yield-table.tsx` would
 * otherwise each hand-roll as `<Popover dwell><PopoverTrigger><button
 * className={triggerLabelStyles(...)}>`.
 */
export function PopoverTriggerLabel({ children, content, className, contentClassName }: PopoverTriggerLabelProps) {
  return (
    <Popover dwell>
      <PopoverTrigger>
        <button type="button" className={triggerLabelStyles({ className })}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className={contentClassName}>{content}</PopoverContent>
    </Popover>
  );
}
