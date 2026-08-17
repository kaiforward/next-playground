"use client";

import { useEffect, useRef } from "react";
import { CheckboxInput } from "@/components/form/checkbox-input";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import type { AlertCategoryId, AlertTier } from "@/lib/types/alerts";
import type { AlertCategorySettings } from "@/lib/hooks/use-alert-categories";

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
 * All sixteen category ids, tier-grouped and in the registry's own authored `order` within each
 * tier — hand-mirrored here the same way `tracker-settings.tsx`'s own `SECTION_ORDER` mirrors its
 * panel's section order, rather than derived with `Object.entries(ALERT_CATEGORIES)`:
 * `Object.entries`/`Object.keys` widen a `Record<AlertCategoryId, …>`'s keys back to a bare
 * `string` (a standing TypeScript limitation on `Record`), which would need an `as` cast to hand an
 * id to `onChangeCategory(id: AlertCategoryId, …)` below — the one thing AGENTS.md forbids.
 */
const CATEGORY_ORDER: readonly AlertCategoryId[] = [
  "famine",
  "strike",
  "maintenance_unfunded",
  "crisis",
  "deprived_worlds",
  "unrest_rising",
  "survival_stock_falling",
  "demand_unservable",
  "overcrowded",
  "no_housing_headroom",
  "build_blocked",
  "industry_idle",
  "disruption",
  "build_opportunity",
  "colony_opportunity",
  "windfall",
];

export interface AlertSettingsProps {
  /** Every category's current checkbox state — `useAlertCategories()`'s own `categories`, owned by
   *  the caller (mirrors `TrackerSettingsProps`'s own `sections` prop) rather than read by this
   *  component itself, so it stays a pure render of whatever state its owner hands it. */
  categories: AlertCategorySettings;
  onChangeCategory: (id: AlertCategoryId, on: boolean) => void;
  /** Called on Escape and on an outside click — never on a checkbox toggle, which is the whole
   *  point of the panel: trying combinations one after another would be unusable if every click
   *  closed it. */
  onClose: () => void;
}

/**
 * The alert bar's settings panel, opened from the gear control at the end of the run
 * (`components/alerts/alert-run.tsx`) — a checkbox per HIDEABLE category, grouped by tier, plus a
 * locked row (no control at all) for each of the four critical categories: rendering a disabled
 * checkbox there would still suggest the set is negotiable, which it isn't.
 *
 * A floating popover anchored under its own trigger, not a persistent rail sibling like
 * `TrackerSettings` — the prototype's own `settings-flyout` class shares the exact same anchoring
 * rules as a category's `AlertFlyout`, not the Tracker's fixed-width row-mate. It reimplements
 * `AlertFlyout`'s own non-modal popover mechanics by hand (manual Escape listener, outside-click
 * listener, focus captured on mount and restored on unmount) for the same reason that component
 * gives for not using `Dialog`: this project's pinned jsdom implements no `show`/`showModal`/`close`
 * on `HTMLDialogElement` at all, so a `Dialog`-based implementation could not be tested here either.
 * `AlertFlyout` is not reused directly since it renders one category's instances, not a settings
 * form — the shared mechanics are duplicated rather than factored out, a known, deliberately booked
 * gap (see `alert-run.tsx`'s own settings-control docstring for why the fix is out of this task's
 * file scope).
 *
 * Anchored `right-0` rather than `left-0`: the gear is always the LAST item in the run, so a panel
 * growing left from its right edge stays inside the run's own reserved span without needing
 * `AlertFlyout`'s `runRef` horizontal-clamp effect (which exists precisely because a category chip
 * can sit anywhere in a packed run, not always at its right end).
 */
export function AlertSettings({ categories, onChangeCategory, onClose }: AlertSettingsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const active = document.activeElement;
    previousFocusRef.current = active instanceof HTMLElement ? active : null;
    const firstControl = containerRef.current?.querySelector<HTMLElement>('input[type="checkbox"]');
    firstControl?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [onClose]);

  // `pointer-events-auto` is load-bearing here for the same reason it is on `AlertFlyout` — this
  // panel is a sibling of the settings trigger button inside the run's own `pointer-events-none`
  // wrapper, so without it every row inside is dead to the mouse in a real browser while jsdom,
  // which dispatches events straight at the element, would never catch the difference.
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Alert settings"
      className="pointer-events-auto absolute right-0 top-[calc(100%+5px)] z-20 flex w-[330px] flex-col border border-border-strong bg-surface shadow-[0_18px_40px_rgba(0,0,0,0.6)]"
    >
      <header className="shrink-0 border-b border-border px-2.5 py-2">
        <h3 className="font-display text-xs uppercase tracking-wider text-text-secondary">Alerts</h3>
        <p className="text-[11px] text-text-tertiary">What appears on the bar</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {TIER_ORDER.map((tier) => {
          const ids = CATEGORY_ORDER.filter((id) => ALERT_CATEGORIES[id].tier === tier);
          const note = TIER_NOTE[tier];
          return (
            <section key={tier} className="border-b border-border py-1.5 last:border-b-0">
              <h4 className="flex items-baseline gap-2 px-2.5 pb-1 font-display text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                {TIER_HEADING[tier]}
                {note && <span className="normal-case tracking-normal opacity-85">{note}</span>}
              </h4>
              <div role="group" aria-label={`${TIER_HEADING[tier]} alert categories`}>
                {ids.map((id) => {
                  const def = ALERT_CATEGORIES[id];
                  if (!def.hideable) {
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-2 px-2.5 py-1 text-[12px] text-text-primary opacity-75"
                      >
                        <span className="truncate">{def.label}</span>
                        <span className="ml-auto font-mono text-[9px] text-text-tertiary">always on</span>
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
    </div>
  );
}
