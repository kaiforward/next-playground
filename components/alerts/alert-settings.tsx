"use client";

import { PopoverContent } from "@/components/ui/popover";
import { CheckboxInput } from "@/components/form/checkbox-input";
import { TermLabel } from "@/components/ui/term-label";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import { ALERT_CATEGORY_IDS, type AlertCategoryId, type AlertTier } from "@/lib/types/alerts";
import type { AlertCategorySettings } from "@/lib/types/alerts";

const TIER_ORDER: readonly AlertTier[] = ["critical", "important", "info"];

const TIER_HEADING: Record<AlertTier, string> = {
  critical: "Critical",
  important: "Important",
  info: "Opportunities",
};

/** Shown next to each tier heading — states the two ways a category can be missing a checkbox
 *  (locked on, or self-gated on automation) so the panel never looks like it dropped a category. */
const TIER_NOTE: Record<AlertTier, string | null> = {
  critical: "cannot be turned off",
  important: null,
  info: "hidden while that domain's automation is on",
};

/**
 * The category ids belonging to one tier, in the registry's own authored `order` — read off
 * `ALERT_CATEGORIES` rather than restated as a second hand-kept list, so this panel and
 * `lib/services/alerts.ts` (which sorts the emitted categories on the same two fields) cannot drift
 * apart, and a seventeenth category cannot ship with no checkbox at all.
 *
 * `ALERT_CATEGORY_IDS` (`lib/types/alerts.ts`) is what makes that possible without an `as` cast:
 * `Object.entries`/`Object.keys` widen a `Record<AlertCategoryId, …>`'s keys back to a bare `string`
 * (a standing TypeScript limitation on `Record`), which could not then be handed to
 * `onChangeCategory(id: AlertCategoryId, …)` below. The `filter` copies before the sort, so nothing
 * mutates a shared array during render.
 */
function categoryIdsInTier(tier: AlertTier): AlertCategoryId[] {
  return ALERT_CATEGORY_IDS.filter((id) => ALERT_CATEGORIES[id].tier === tier).sort(
    (a, b) => ALERT_CATEGORIES[a].order - ALERT_CATEGORIES[b].order,
  );
}

export interface AlertSettingsProps {
  /** Every category's current checkbox state — `AlertData.categorySettings`, owned by the caller
   *  (mirrors `TrackerSettingsProps`'s own `sections` prop) rather than read by this component
   *  itself, so it stays a pure render of whatever state its owner hands it. */
  categories: AlertCategorySettings;
  onChangeCategory: (id: AlertCategoryId, on: boolean) => void;
}

/**
 * The alert bar's settings panel, opened from the gear control at the start of the run
 * (`components/alerts/alert-run.tsx`) — a checkbox per HIDEABLE category, grouped by tier, plus a
 * locked row (no control at all) for each of the four critical categories: rendering a disabled
 * checkbox there would still suggest the set is negotiable, which it isn't.
 *
 * A `PopoverContent`, exactly like `AlertFlyout` — see that component's own docstring for what the
 * primitive (`components/ui/popover.tsx`) now supplies for free: the keyboard convention, the
 * one-open-at-a-time registry (shared across every `Popover` instance, this one included — opening
 * this panel closes whatever category flyout was open, and vice versa, with no code in this file or
 * `alert-run.tsx` coordinating it), outside-click dismissal, and the `dialog` role. This component's
 * caller wraps it in `<Popover align="start" pointerInert>`; `align="start"` is what keeps this
 * panel growing right from the gear's own left edge — the gear is always the FIRST item in the run,
 * so that stays inside the run's own reserved span without the `collisionBoundary` `AlertFlyout`
 * needs (a category chip can sit anywhere in a packed run, not always at its left end).
 *
 * Toggling a checkbox does not close the panel: nothing in this component calls anything that would
 * — there is no `onClose` here to call — and a click on a checkbox is an interaction INSIDE the
 * content, which Radix's own dismissal layer never treats as a reason to close (see `AlertFlyout`'s
 * own docstring for how that was verified).
 */
export function AlertSettings({ categories, onChangeCategory }: AlertSettingsProps) {
  return (
    <PopoverContent aria-label="Alert settings" className="flex w-[330px] flex-col">
      <header className="shrink-0 border-b border-border px-2.5 py-2">
        <h3 className="font-display text-xs uppercase tracking-wider text-text-secondary">Alerts</h3>
        <p className="text-xs text-text-tertiary">What appears on the bar</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {TIER_ORDER.map((tier) => {
          const ids = categoryIdsInTier(tier);
          const note = TIER_NOTE[tier];
          return (
            <section key={tier} className="border-b border-border py-1.5 last:border-b-0">
              <h4 className="flex items-baseline gap-2 px-2.5 pb-1 font-display text-xs uppercase tracking-[0.1em] text-text-tertiary">
                {/* The scale's own term links once, on its first (Critical) heading — Important and
                    Opportunities share the same "critical, important, informational" definition, and
                    a trigger on every heading would repeat one term three times over on a single
                    surface. */}
                {tier === "critical" ? (
                  <TermLabel id="alertTiers">{TIER_HEADING[tier]}</TermLabel>
                ) : (
                  TIER_HEADING[tier]
                )}
                {note && <span className="normal-case tracking-normal opacity-85">{note}</span>}
              </h4>
              <div role="group" aria-label={`${TIER_HEADING[tier]} alert categories`}>
                {ids.map((id) => {
                  const def = ALERT_CATEGORIES[id];
                  if (!def.hideable) {
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-2 px-2.5 py-1 text-xs text-text-primary opacity-75"
                      >
                        <span className="truncate">{def.label}</span>
                        <span className="ml-auto font-mono text-xs text-text-tertiary">always on</span>
                      </div>
                    );
                  }
                  return (
                    <CheckboxInput
                      key={id}
                      label={def.label}
                      checked={categories[id]}
                      onChange={(on) => onChangeCategory(id, on)}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </PopoverContent>
  );
}
