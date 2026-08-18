"use client";

import type { RefObject } from "react";
import { PopoverContent } from "@/components/ui/popover";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import { AlertRow } from "@/components/alerts/alert-row";
import { TIER_COLOR } from "@/components/alerts/alert-chip";
import { CHIP_HEIGHT, RAIL_INSET } from "@/lib/constants/layout";
import type { AlertDestinationTab } from "@/lib/types/alerts";
import type { FactionTabSegment } from "@/lib/constants/faction-tabs";
import type { AlertCategory, AlertInstance } from "@/lib/types/api";

/** The flyout's own 5px clearance below its chip — passed to `PopoverContent` as `sideOffset`
 *  (overriding its own 8px default) and reused below so the `maxHeight` derivation reads as three
 *  named pieces rather than a bare arithmetic literal. */
const FLYOUT_CLEARANCE = 5;

/** How far the flyout's own top-anchor point sits below the map's own top edge, before its own
 *  `FLYOUT_CLEARANCE`: the run's own top inset (`RAIL_INSET`, the same 8px standard used for every
 *  map overlay's inset) plus one chip's own height (`CHIP_HEIGHT`) — verbatim from the approved
 *  prototype's own `tr.bottom - fr.top + 5`. This is the room the `maxHeight` calc below subtracts. */
const FLYOUT_TOP_OFFSET = RAIL_INSET + CHIP_HEIGHT + FLYOUT_CLEARANCE;

/**
 * The footer's own count/denominator/unit line — the same branch on `AlertCategory.unit` as
 * `alert-chip.tsx`'s `unitSuffix`, but a full sentence rather than a chip suffix, EXCEPT for
 * `faction`: Maintenance unfunded's count is always 1 by construction and always the player's own
 * faction, so a stated count carries no information the player doesn't already have — there is no
 * wording for it that isn't either false precision or a bare restatement. `null` means render no
 * footer at all, the same convention `unitSuffix` already uses for the chip's own suffix.
 */
export function alertFooterText(category: AlertCategory): string | null {
  switch (category.unit) {
    case "developed_systems":
      return `${category.count} of ${category.denominator} developed systems`;
    case "controlled_systems":
      return `${category.count} of ${category.denominator} controlled systems`;
    case "events":
      return `${category.count} events`;
    case "faction":
      return null;
  }
}

/**
 * Where a row's activation resolves to — either a fly-to-system-and-open-tab (deferred to
 * `useSystemFocus()`, which needs live atlas coordinates this pure function has no access to) or a
 * tab on the PLAYER faction's panel (the caller resolves the faction id — again atlas data this
 * pure function has no access to). `tab` on the system kind carries `AlertDestinationTab`, the
 * four-tab subset `lib/types/alerts.ts` pins with `satisfies` — never the full `SystemTabSegment`,
 * which would re-widen here exactly what the destination table narrowed; on the faction kind it is
 * the two faction-panel tabs alerts actually target. `none` covers the one combination
 * the destination table never actually produces (a `system`-kind category whose instance carries no `systemId`) —
 * `AlertInstance.systemId` is typed nullable across the whole union, so this function still has to
 * return something for it rather than assume the impossible away.
 */
export type AlertNavigateTarget =
  | { kind: "system"; systemId: string; tab: AlertDestinationTab }
  | { kind: "faction"; tab: Extract<FactionTabSegment, "" | "events"> }
  | { kind: "none" };

/**
 * Resolves a row's destination off `ALERT_CATEGORIES[category.id].destination` and the specific
 * instance's own `systemId` — the per-instance decision the destination table
 * (docs/active/gameplay/alert-bar.md → "What a row click does") reserves for the three event bands
 * (system when the event has one, else the events panel) and, degenerately, for Maintenance
 * unfunded (always the faction panel, whatever `systemId` says).
 *
 * Pure and exported so the branching itself is directly testable without a router or an atlas
 * fetch in the loop. `components/alerts/alert-run.tsx`'s `ActiveAlertFlyout` is the one place that
 * turns a resolved target into an actual navigation, and only once a flyout is open — seeing this
 * file's own docstring on `AlertFlyout` for why the hook calls that need cannot live any higher.
 */
export function resolveAlertTarget(category: AlertCategory, instance: AlertInstance): AlertNavigateTarget {
  const destination = ALERT_CATEGORIES[category.id].destination;
  switch (destination.kind) {
    case "system":
      // Every system-scoped category's instances carry a systemId by construction; the null branch
      // is unreachable in practice, not a real case to route somewhere plausible-looking.
      return instance.systemId
        ? { kind: "system", systemId: instance.systemId, tab: destination.tab }
        : { kind: "none" };
    case "faction":
      // Maintenance unfunded — the player faction's Overview (where the treasury card lives),
      // whatever the instance's own systemId says (it is always null for this category: the row is
      // faction-level, not per-system).
      return { kind: "faction", tab: "" };
    case "events":
      // The three event bands: the event's own system when it has one, else the faction panel's
      // Events tab (the events feed's home since the standalone events destination folded in).
      return instance.systemId
        ? { kind: "system", systemId: instance.systemId, tab: "" }
        : { kind: "faction", tab: "events" };
  }
}

export interface AlertFlyoutProps {
  /** The category's standing read — count, denominator/unit and instances, in the category's own
   *  sort order, come off this union rather than as separate props (same convention as
   *  `AlertChip`'s own `category` prop). */
  category: AlertCategory;
  /** Called with the resolved destination once a row is activated — never with the raw instance,
   *  so the caller never has to re-derive the destination branch this component already resolved. */
  onNavigate: (target: AlertNavigateTarget) => void;
  /** The packed run's own measured wrapper (`AlertRun`'s ref, threaded down through
   *  `components/alerts/alert-run.tsx`) — handed to `PopoverContent` as `collisionBoundary`, so
   *  Radix's own collision detection (`@radix-ui/react-popper`'s `shift`/`flip`, on by default) keeps
   *  this flyout inside the run's own reserved span rather than only the viewport, matching what the
   *  deleted hand-rolled clamp did. Undefined for every current caller of `AlertFlyout` directly
   *  (this file's own tests), which is safe: `collisionBoundary` undefined just falls back to
   *  Radix's own default (the nearest clipping ancestor, effectively the viewport). */
  runRef?: RefObject<HTMLDivElement | null>;
}

/**
 * The flyout a chip opens: the category's name and icon, one line saying what the condition is,
 * every affected instance in the category's own sort order — no cap, no second home; a category
 * that is long is the honest shape of a common condition (docs/active/gameplay/alert-bar.md → "The
 * flyout") — and a footer stating the count with its denominator or unit (or no footer at all for
 * `faction` — see `alertFooterText`).
 *
 * A `PopoverContent`, not a hand-rolled popover: `components/ui/popover.tsx` already implements the
 * house keyboard convention (open never moves focus, ArrowDown enters, Escape exits and returns
 * focus to the chip), the one-open-at-a-time registry, and outside-click dismissal — all of it wired
 * by the caller (`AlertRunChips`, `components/alerts/alert-run.tsx`), which wraps this component's
 * return value in `<Popover align="start" pointerInert>`. `PopoverContent` supplies the `dialog`
 * role itself; this component's only accessibility contribution is the `aria-label` naming it.
 *
 * Anchored under its own chip by Radix's own popper positioning (`side="bottom"`, the `Popover`
 * default; `align="start"` lines this flyout's left edge up with its chip's, matching the approved
 * prototype's unclamped case) and kept off the run's own right inset — under the Tracker rail — by
 * `collisionBoundary={runRef?.current}`, Radix's own supported hook for constraining collision
 * detection to a boundary narrower than the viewport (`@radix-ui/react-popper`'s `shift`+`flip`,
 * `avoidCollisions: true` by default) rather than a hand-rolled measurement effect. Capped to the map
 * area's own height: the map fills exactly `calc(100vh - var(--topbar-height))` (`app/(game)/page.tsx`),
 * and the chip run sits `FLYOUT_TOP_OFFSET` above where this flyout's own top lands, so
 * `100vh - var(--topbar-height) - FLYOUT_TOP_OFFSET` is exactly the room left below it before the map
 * itself runs out.
 *
 * A row's click never applies an action in place and never removes itself from the list: nothing on
 * this bar is dismissible, so a click that both acted and cleared would be indistinguishable from a
 * dismissal — the one gesture this design deliberately does not have. Activating a row calls
 * `onNavigate` with the resolved destination and nothing else — it does NOT close the popover, and
 * there is no longer a way for it to: closing is `Popover`'s own job (Escape, an outside click), and
 * this component holds no reference to that state at all. Verified against Radix's own dismissal
 * layer (`@radix-ui/react-dismissable-layer`, wired through `PopoverContentNonModal`): it reacts only
 * to interaction OUTSIDE the content, never to a click on something inside it, so a row's own click
 * reaches only `onActivate` and never `Popover`'s close path.
 */
export function AlertFlyout({ category, onNavigate, runRef }: AlertFlyoutProps) {
  const def = ALERT_CATEGORIES[category.id];
  const Icon = def.icon;
  const tier = TIER_COLOR[def.tier];

  function activate(instance: AlertInstance) {
    onNavigate(resolveAlertTarget(category, instance));
  }

  const footerText = alertFooterText(category);

  // No `pointer-events-auto` here: `PopoverContent` portals to `document.body` (verified by reading
  // `@radix-ui/react-popover`'s own `PopoverPortal`, which renders `@radix-ui/react-portal`'s
  // `Portal` — a real DOM portal, defaulting to `document.body` when no `container` prop is given) —
  // so this element is never a descendant of the run's own `pointer-events-none` wrapper
  // (`components/alerts/alert-run.tsx`) and never inherits it, in a real browser or in jsdom alike.
  return (
    <PopoverContent
      aria-label={`${def.label} alerts`}
      sideOffset={FLYOUT_CLEARANCE}
      collisionBoundary={runRef?.current ?? undefined}
      className="flex w-[340px] flex-col shadow-[0_18px_40px_rgba(0,0,0,0.6)]"
      style={{
        borderLeft: `2px solid ${tier.base}`,
        maxHeight: `calc(100vh - var(--topbar-height) - ${FLYOUT_TOP_OFFSET}px)`,
      }}
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-2">
        <Icon aria-hidden className="h-5 w-5 shrink-0" style={{ color: tier.light }} />
        <h3 className="font-display text-xs uppercase tracking-wider" style={{ color: tier.light }}>
          {def.label}
        </h3>
      </header>
      <p className="shrink-0 border-b border-border px-2.5 py-1.5 text-[11px] text-text-tertiary">
        {def.conditionLine}
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {category.instances.map((instance, index) => (
          <AlertRow
            key={`${instance.systemId ?? "none"}-${instance.name}-${index}`}
            name={instance.name}
            measure={instance.measure}
            onActivate={() => activate(instance)}
          />
        ))}
      </ul>
      {footerText != null && (
        <footer className="shrink-0 border-t border-border px-2.5 py-1.5 text-[11px] text-text-tertiary">
          {footerText}
        </footer>
      )}
    </PopoverContent>
  );
}
