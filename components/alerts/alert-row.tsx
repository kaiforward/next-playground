"use client";

export interface AlertRowProps {
  /** The row's subject — a system's name, the faction's name (Maintenance unfunded) or the event's
   *  own name (Crisis/Disruption/Windfall). Never a placeholder for a missing system: `name` always
   *  names the actual subject, per `AlertInstance`'s own docstring. */
  name: string;
  /** The row's figure — already formatted by the read service (`lib/services/alerts.ts`), never
   *  reformatted here. */
  measure: string;
  /** Flies the map to the system and opens the destination tab, or opens the faction/events panel
   *  — resolved by the caller (`components/alerts/alert-flyout.tsx`) off the category's own
   *  destination. NEVER applies an action in place and never removes this row: nothing on the
   *  alert bar is dismissible, so a click that both acted and cleared would be indistinguishable
   *  from a dismissal, the one gesture this design deliberately does not have. */
  onActivate: () => void;
}

/**
 * One line in the alert flyout: a subject's name and its measure, nothing else. The right-hand
 * edge is left free for a later secondary action (not built here) — see
 * `components/alerts/alert-flyout.tsx`'s own docstring for the fuller reasoning.
 */
export function AlertRow({ name, measure, onActivate }: AlertRowProps) {
  return (
    <li className="border-b border-border/[0.07] last:border-b-0">
      <button
        type="button"
        onClick={onActivate}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-text-primary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover"
      >
        <span className="flex-1 truncate">{name}</span>
        <span className="shrink-0 font-mono text-text-secondary">{measure}</span>
      </button>
    </li>
  );
}
