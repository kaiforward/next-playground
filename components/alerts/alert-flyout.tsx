"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import { AlertRow } from "@/components/alerts/alert-row";
import { TIER_COLOR } from "@/components/alerts/alert-chip";
import { CHIP_HEIGHT, RAIL_INSET } from "@/lib/constants/layout";
import type { SystemTabSegment } from "@/lib/constants/system-tabs";
import type { AlertCategory, AlertInstance } from "@/lib/types/api";

/** The flyout's own 5px clearance below its chip — matches the literal in this file's
 *  `top-[calc(100%+5px)]` class below, which has to stay a literal (a Tailwind arbitrary-value
 *  class can't consume a JS variable — the class string itself is what the build scans for). Kept
 *  as a named number anyway so the `maxHeight` derivation below reads as three named pieces rather
 *  than a bare arithmetic literal. */
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
 * plain route push with no map focus at all. `none` covers the one combination the destination
 * table never actually produces (a `system`-kind category whose instance carries no `systemId`) —
 * `AlertInstance.systemId` is typed nullable across the whole union, so this function still has to
 * return something for it rather than assume the impossible away.
 */
export type AlertNavigateTarget =
  | { kind: "system"; systemId: string; tab: SystemTabSegment }
  | { kind: "route"; path: string }
  | { kind: "none" };

/**
 * Resolves a row's destination off `ALERT_CATEGORIES[category.id].destination` and the specific
 * instance's own `systemId` — the per-instance decision the destination table
 * (docs/build-plans/alert-bar.md → "What a row click does") reserves for the three event bands
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
      // Maintenance unfunded — the faction panel, whatever the instance's own systemId says (it is
      // always null for this category: the row is faction-level, not per-system).
      return { kind: "route", path: "/factions" };
    case "events":
      // The three event bands: the event's own system when it has one, else the events panel.
      return instance.systemId
        ? { kind: "system", systemId: instance.systemId, tab: "" }
        : { kind: "route", path: "/events" };
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
  /** Called on Escape, on an outside click, and after every row activation. Never called with any
   *  side effect on the category's own data — see this component's own docstring. */
  onClose: () => void;
  /** The packed run's own measured wrapper (`AlertRun`'s ref, threaded down through
   *  `components/alerts/alert-run.tsx`) — used only to clamp this flyout's horizontal position
   *  against the run's own left/right edges once real layout exists (see the horizontal-clamp effect
   *  below). Undefined for every current caller of `AlertFlyout` directly (this file's own tests),
   *  which is safe: the clamp effect no-ops without it, leaving the flyout at its default `left-0`. */
  runRef?: RefObject<HTMLDivElement | null>;
}

/**
 * The flyout a chip opens: the category's name and icon, one line saying what the condition is,
 * every affected instance in the category's own sort order — no cap, no second home; a category
 * that is long is the honest shape of a common condition (docs/build-plans/alert-bar.md → "The
 * flyout") — and a footer stating the count with its denominator or unit (or no footer at all for
 * `faction` — see `alertFooterText`). Anchored under its own chip (`position: absolute`, a
 * positioned wrapper `AlertRunChips` gives each chip in `components/alerts/alert-run.tsx`) and
 * capped to the map area's own height: the map fills exactly `calc(100vh - var(--topbar-height))`
 * (`app/(game)/page.tsx`), and the chip run sits `FLYOUT_TOP_OFFSET` above where this flyout's own
 * top lands, so `100vh - var(--topbar-height) - FLYOUT_TOP_OFFSET` is exactly the room left below it
 * before the map itself runs out. The horizontal position defaults to `left-0` (lined up with the
 * chip) and is pulled back onto the run's own span by the clamp effect below when a chip near the
 * right of a packed run would otherwise hang the flyout off the run's own right inset and under the
 * Tracker rail — verbatim from the approved prototype's own `drawFlyout()` clamp.
 *
 * Not a native `<dialog>`, though `components/ui/dialog.tsx`'s own non-modal `.show()` path
 * (`modal={false}`) — not `showModal()` — is the one that would actually apply here: `.show()`
 * renders in normal flow, not the browser's top layer, so a native `<dialog>` could in principle
 * anchor under a chip exactly as this popover does. The real reason to hand-roll it is testability,
 * not layering: this project's pinned jsdom (29.1.1) implements no `show`/`showModal`/`close` on
 * `HTMLDialogElement` at all — every existing consumer of `Dialog` (`BuildDialog`, `SaveGameDialog`,
 * …) has no test file for exactly that reason. Two of this component's own required behaviours —
 * only one flyout open at a time, and Escape closing it and returning focus to its chip — are things
 * a `Dialog`-based implementation could not pin down in a test AT ALL, not merely test more
 * awkwardly. This popover reimplements `Dialog`'s own non-modal semantics by hand instead — manual
 * Escape listener, focus captured on mount and restored on unmount — on a plain, testable `<div>`.
 * This is a popover over the map, not a modal: it never traps focus, and Tab is free to leave it.
 *
 * A row's click never applies an action in place and never removes itself from the list: nothing
 * on this bar is dismissible, so a click that both acted and cleared would be indistinguishable
 * from a dismissal — the one gesture this design deliberately does not have. Activating a row calls
 * `onNavigate` with the resolved destination, then `onClose` — the flyout closes behind the
 * navigation it just caused, the same as choosing a destination from any other transient menu.
 */
export function AlertFlyout({ category, onNavigate, onClose, runRef }: AlertFlyoutProps) {
  const def = ALERT_CATEGORIES[category.id];
  const Icon = def.icon;
  const tier = TIER_COLOR[def.tier];
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [left, setLeft] = useState(0);

  // Mirrors `Dialog`'s own non-modal open effect (capture what had focus, move focus into the
  // popover's first row, hand focus back on unmount) without the native `<dialog>` element — see
  // this component's own docstring for why.
  useEffect(() => {
    const active = document.activeElement;
    previousFocusRef.current = active instanceof HTMLElement ? active : null;
    const firstRow = containerRef.current?.querySelector<HTMLElement>("button");
    firstRow?.focus();
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

  // The horizontal clamp — verbatim from the approved prototype's own `drawFlyout()`:
  //   const left = Math.min(tr.left - fr.left, span.right - fr.left - el.offsetWidth);
  //   el.style.left = Math.max(span.left - fr.left, left) + 'px';
  // The prototype computes in coordinates relative to the map frame it appends the flyout into; this
  // component instead sits absolutely positioned within its OWN chip's wrapper (`AlertRunChips`'s
  // `position: relative` div), whose left edge already IS the trigger's own left edge (`tr.left`) —
  // so `left: 0` here is exactly the prototype's unclamped `tr.left - fr.left`. Reworking the same
  // clamp into that local frame (subtracting `tr.left` from every term) collapses the `fr` term out
  // entirely: `Math.max(span.left - tr.left, Math.min(0, span.right - tr.left - width))`. `runRef` —
  // `AlertRun`'s own measured wrapper — stands in for the prototype's `span`; `containerRef.current
  // .parentElement` (the per-chip wrapper) stands in for `trigger`. Inert in jsdom: every
  // `getBoundingClientRect()` there returns all-zero rects and `offsetWidth` is 0, so `left` resolves
  // to 0 — the same value the default `left-0` class already renders — and no existing test observes
  // a difference.
  useLayoutEffect(() => {
    const el = containerRef.current;
    const trigger = el?.parentElement;
    const runEl = runRef?.current;
    if (!el || !trigger || !runEl) return;

    function place() {
      if (!el || !trigger || !runEl) return;
      const span = runEl.getBoundingClientRect();
      const tr = trigger.getBoundingClientRect();
      const width = el.offsetWidth;
      setLeft(Math.max(span.left - tr.left, Math.min(0, span.right - tr.left - width)));
    }

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [runRef]);

  // Navigating does NOT close the flyout. The spec gives it exactly two ways to close — Escape, and
  // a click outside it — and a row is neither. Keeping it open lets a player walk a category's
  // instances one after another, which is the whole reason the list has no cap; closing on the first
  // row would make a long list unusable and would also read as the dismissal gesture this bar
  // deliberately does not have. The Tracker's own rich cards behave the same way.
  function activate(instance: AlertInstance) {
    onNavigate(resolveAlertTarget(category, instance));
  }

  const footerText = alertFooterText(category);

  // `pointer-events-auto` below is load-bearing, not decoration. The run's own wrapper is
  // `pointer-events-none` so empty space between chips passes clicks through to the map, and the
  // chip button re-enables them for itself alone — this flyout is that button's SIBLING inside the
  // same wrapper, so without this it inherits `none` and every row in it is dead to the mouse.
  // jsdom cannot catch it: Testing Library dispatches events straight at the element, so a row click
  // passes in a test while doing nothing at all in a browser.
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={`${def.label} alerts`}
      className="pointer-events-auto absolute top-[calc(100%+5px)] z-20 flex w-[340px] flex-col border border-border-strong bg-surface shadow-[0_18px_40px_rgba(0,0,0,0.6)]"
      style={{
        left: `${left}px`,
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
    </div>
  );
}
