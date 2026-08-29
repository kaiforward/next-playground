"use client";

import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { tv } from "tailwind-variants";
import { TERMS, type TermId } from "@/lib/glossary/terms";
import { Popover, PopoverContent, PopoverHeader, PopoverTrigger } from "./popover";
import { triggerLabelStyles } from "./tooltip";

/**
 * The copper second tier `theme.md` reserves for a term that opens its own definition — one
 * level above `TooltipTriggerLabel`'s dotted-grey "explanation, not navigation" affordance. Built
 * on `triggerLabelStyles` (`components/ui/tooltip.tsx`) rather than a second copy of it, per
 * AGENTS.md's second-occurrence rule: the shared base (layout, underline shape, hover-solid) stays
 * one definition, and this only overrides the colour tier on top of it.
 */
const termLabelStyles = tv({
  base: twMerge(
    triggerLabelStyles({}),
    "decoration-accent/75 text-accent hover:decoration-accent",
  ),
});

/**
 * A definition's body, rendered one level at a time. Each term reference inside `TERMS[id].body`
 * becomes its own `TermLabel`, whose own body is a `<TermBody>` nested inside ITS `PopoverContent`
 * — not evaluated here. `PopoverContent` only mounts its children once its own popover opens
 * (Radix's Presence unmounts a closed popover's content entirely, not merely hides it), so a body
 * that is part of a cycle (`family` names `specialisation complex`, which names `family` back)
 * never recurses at render time: reaching it again just opens another `TermLabel` trigger, whose
 * own body waits for that popover's own open.
 */
function TermBody({ id }: { id: TermId }) {
  const definition = TERMS[id];
  return (
    <p className="text-text-secondary">
      {definition.body.map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <TermLabel key={index} id={segment.id}>
            {segment.label}
          </TermLabel>
        ),
      )}
    </p>
  );
}

export interface TermLabelProps {
  id: TermId;
  /** Overrides the trigger's label text — the glossary body's own inflection ("resources",
   *  "body's") rather than the term's dictionary name. Defaults to `TERMS[id].term`. */
  children?: ReactNode;
}

/**
 * The word that opens its own definition — the copper-underlined term trigger `theme.md:227`
 * reserved copper for. Renders the trigger plus its `Popover` in `dwell` mode: cursor-anchored,
 * fills before it can be entered, and — because `Popover` claims its own depth off
 * `usePopoverDepth()` — nests inside an ancestor `TermLabel`'s own popover rather than closing it.
 */
export function TermLabel({ id, children }: TermLabelProps) {
  const definition = TERMS[id];
  return (
    <Popover dwell>
      <PopoverTrigger>
        <button type="button" className={termLabelStyles({})}>
          {children ?? definition.term}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={definition.term}>
        <PopoverHeader title={definition.term} />
        <TermBody id={id} />
      </PopoverContent>
    </Popover>
  );
}
