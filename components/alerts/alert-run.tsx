"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useNavigate } from "@/components/ui/link-provider";
import { renderNothingFallback } from "@/components/ui/error-fallback";
import { SettingsIcon } from "@/components/ui/icons";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { AlertChip, chip } from "@/components/alerts/alert-chip";
import { AlertFlyout, type AlertNavigateTarget } from "@/components/alerts/alert-flyout";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { useSetAlertCategory } from "@/lib/hooks/use-player-settings";
import { useSystemFocus, useLaneFocus } from "@/lib/hooks/use-system-focus";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import { DRAWER_WIDTH, TRACKER_BASE_WIDTH, TRACKER_SETTINGS_SPAN, RAIL_INSET } from "@/lib/constants/layout";
import { layoutRun, RUN_HEIGHT } from "@/lib/utils/alert-packing";
import type { AlertCategory } from "@/lib/types/api";

interface AlertRunProps {
  /** Whether the Tracker's settings panel is open — the one state the run's right inset tracks
   *  beyond the Tracker's own always-mounted base width (alert-bar.md → "Placement and
   *  behaviour"). Ownership of the state lives in `star-map.tsx`, lifted there the same way
   *  `mapMode`/`overlays` already are, and passed down to both this component and `MapRightRail`
   *  (whose own toggle button drives it) — a single source of truth rather than two `useState`s
   *  kept in sync by an effect. */
  settingsOpen: boolean;
}

/**
 * The alert run's mount point — floats over the top of the map, inset 8px from the system drawer on
 * the left, the Tracker rail on the right, and the top of the map (docs/active/gameplay/alert-bar.md →
 * "Placement and behaviour"). Reserves no layout height: it is an absolutely positioned overlay, never
 * a band the map's own layout budgets for. What renders inside varies — the settings control always
 * mounts once the run itself does; chips are conditional on there being anything to show (see
 * `AlertRunChips` below).
 *
 * The left inset is expressed as CSS alone — `DRAWER_WIDTH + RAIL_INSET` px
 * (`lib/constants/layout.ts`), matching `detail-panel.tsx`'s own `w-[560px] max-w-full` — a FIXED
 * width, not a viewport clamp: the drawer itself never resizes with the viewport, so neither does
 * this inset. Applied UNCONDITIONALLY, whether or not a system is actually selected right now. That
 * is what stops the run reflowing the moment the player clicks a system: the space is always
 * reserved, exactly as the Tracker rail's own base width is always reserved on the right whether or
 * not anything is pinned. The right inset instead has to come from `settingsOpen`, lifted state
 * owned by `star-map.tsx` — see `AlertRunProps`.
 *
 * Because both insets are real CSS, this wrapper's own rendered width IS the run's available
 * packing width — no separate window-width formula to keep in sync with the drawer/rail CSS by
 * hand. A `ResizeObserver` on that measured element is what feeds `layoutRun` (`lib/utils/alert-packing.ts`)
 * a live number on viewport resize and on `settingsOpen` toggling. `AlertRunContent` below is the
 * part that actually renders chips from an `availableWidth` number; it never measures anything
 * itself, which is what keeps it renderable — and truthfully testable — in jsdom, where there is no
 * layout to measure (see its own docstring).
 *
 * Wrapped in `React.memo` for the same reason its sibling `MapRightRail` is, and in the same
 * position: `StarMap` re-renders both on every throttled pan/zoom tick, and without the boundary
 * that drags this whole subtree — one stateful `Popover` per visible chip, each mounting a flyout —
 * along for a viewport change that never touches this component's props. Its one prop is a boolean,
 * so the boundary holds trivially.
 */
export const AlertRun = memo(function AlertRun({ settingsOpen }: AlertRunProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Three terms, right to left, because the rail is not flush with the map. First `RAIL_INSET`: the
  // rail's own offset from the map's right edge (`inset-y-2 right-2`,
  // `components/map/map-right-rail.tsx`), which the run has to clear before it reaches anything the
  // rail occupies. Then the width the rail actually occupies. Then `RAIL_INSET` again, this time the
  // run's own gap FROM the rail — the same standard inset it takes off the map's top edge. Only one
  // of those two is the run's own spacing; drop the other and the run's right edge lands exactly on
  // the Tracker's left edge with no gap between them.
  const railOccupiedWidth = TRACKER_BASE_WIDTH + (settingsOpen ? TRACKER_SETTINGS_SPAN : 0);
  const rightSpan = RAIL_INSET + railOccupiedWidth + RAIL_INSET;

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-2 z-20 flex min-w-0 items-center"
      style={{ left: `${DRAWER_WIDTH + RAIL_INSET}px`, right: `${rightSpan}px` }}
    >
      <AlertRunContent availableWidth={availableWidth} runRef={ref} />
    </div>
  );
});

/**
 * The testable half of the run: everything from `availableWidth` down is a pure function of props
 * and hook state, with no DOM measurement anywhere in this component or below it — jsdom has no
 * layout, so a measured width in a component under test is always 0, and every test would render an
 * empty run and pass vacuously. `AlertRun` above is the only thing that measures; this is what
 * `alert-run.test.tsx` renders directly, supplying `availableWidth` as a literal.
 *
 * Owns `useAlerts()` inside an `ErrorBoundary` — a read failure degrades the run, not the map behind
 * it. `useAlerts()` is a synchronous store read (Task 7), so there is no loading state to reserve
 * layout height for any more — the run either renders its chips or, on an error, nothing (the same
 * "reserves no layout height" contract the old `loadingFallback={null}` stated explicitly).
 *
 * `runRef` is forwarded, unread, straight through to `AlertRunChips` and on to every `AlertFlyout` —
 * this component still measures nothing itself. It is `AlertRun`'s own measuring ref (above), not a
 * new one: `AlertFlyout`'s own `collisionBoundary` needs the SAME rect `ResizeObserver` already reads
 * for packing, not a second element to keep in sync with it.
 */
export function AlertRunContent({
  availableWidth,
  runRef,
}: {
  availableWidth: number;
  runRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <ErrorBoundary fallbackRender={renderNothingFallback}>
      <AlertRunChips availableWidth={availableWidth} runRef={runRef} />
    </ErrorBoundary>
  );
}

/**
 * The suspense-dependent core: reads the live alert data, keeps only the categories with a live
 * (nonzero) count, hands the result to `layoutRun` for placement, and draws the items it gets back —
 * the settings control, the ordered chips (critical tier first — `useAlerts()` already returns every
 * category tier-then-order sorted, per its own docstring, so this never re-sorts), a hairline at
 * every tier boundary, and a trailing "+N" for whatever the layout collapsed.
 *
 * A category's chip tracks its count directly — no grace window. A category whose count drops to
 * zero has had every one of its instances clear, so keeping its chip around after that would mean
 * either rendering a stale count (a chip claiming to be interesting when it is not) or opening an
 * empty flyout (a row for a system the condition no longer holds for) — there is no third option
 * that keeps the chip meaningful. An earlier version stayed lit for two cycles to smooth a system
 * oscillating across a threshold; that only bites when a category is down to exactly one instance
 * (a count only reaches zero when every instance clears at once), so the churn it prevented was rare
 * enough that paying a constant, confusing cost for it was the wrong trade.
 *
 * `layoutRun` (`lib/utils/alert-packing.ts`) owns the whole of the run's geometry: it returns every
 * element the run draws, in render order, each already placed at an explicit left offset, and this
 * component renders that list and computes no position of its own. There is deliberately no second
 * model here — a margin rule, a separator rule, a stacking rule — for the layout's own arithmetic to
 * disagree with; every past overflow on this surface was such a disagreement. The offsets are pure
 * arithmetic, node-tested in `alert-packing.test.ts`, per AGENTS.md's testing rule that a jsdom test
 * can't see a style.
 *
 * Every item is absolutely positioned inside a `RUN_HEIGHT`-tall box and vertically centred by the
 * one shared rule (`top-1/2 -translate-y-1/2`, on the `chip` shell and on `TierSeparator`), which is
 * what the flex row's `items-center` used to do. The leftmost, most severe chip's resting z-index is
 * the highest; hovering or opening a chip raises it above the whole stack (the chip shell's own
 * `overlapping` variant and `aria-expanded:z-[95]`) regardless of position; the shadow, the hover
 * raise and the tier separator's tighter margins all apply only once the layout reports
 * `overlapping` — a spaced run has nothing to cast a shadow over or raise a chip clear of.
 *
 * Which chip's flyout is open is no longer tracked here at all: each chip is its own `Popover`
 * (`components/ui/popover.tsx`), self-managing its own open state, and the primitive's module-level
 * exclusivity registry — not React state owned by this component — is what keeps at most one open at
 * a time, chip flyouts and the settings panel alike (see the settings control below). `AlertChip`
 * renders as the `PopoverTrigger`'s child and no longer takes `open`/`onOpen`: Radix writes
 * `aria-expanded`/`data-state` onto that exact button, and the chip's own rest/open fill reads
 * `data-state` in CSS (`components/alerts/alert-chip.tsx`). `Popover` itself renders no DOM node
 * (`PopperPrimitive.Root` is a bare context provider), so the chip's own left offset goes onto
 * `AlertChip` itself rather than onto a wrapping positioned `<div>` — there is no `<div>` to wrap,
 * and a wrapper carrying the offset would carry the z-index with it and trap an open chip's
 * `aria-expanded` raise inside its own stacking context.
 *
 * Reads `categorySettings` — the same `useAlerts()` payload the categories themselves arrive on,
 * stored on `world.player` and so carried by the save — to decide which of the live (nonzero-count)
 * categories actually SHOW: a hideable category with its checkbox off is filtered out here, before
 * `layoutRun` ever sees it, same as a category with no live instances — turning a category off is
 * indistinguishable from it never having fired, which is what keeps the layout above unaware
 * settings exist at all.
 * A non-hideable (critical) category shows regardless of what `categorySettings` says for it —
 * `!hideable` short-circuits the check — so a hand-edited save can never hide one, not just the
 * settings panel's own missing control for it (the write boundary refuses one too,
 * `lib/services/player-settings.ts`). The two `info`
 * categories' own automation self-gate (`lib/services/alerts.ts`) needs no mirroring here:
 * automation-on means the category's `count` never went above zero, so the count check above never
 * admits its id regardless of what this filter or the checkbox says.
 *
 * The settings control is the run's own LEADING item, placed at offset 0 by the layout. It leads
 * rather than trails because the run is left-anchored: an item added anywhere before the control
 * would push the control, and the popover anchored to it, rightward — so turning a category on from
 * that very popover would slide the control out from under the pointer that just clicked it. At the
 * run's left edge its position is independent of the chip count entirely. The cost, accepted: it
 * precedes the most severe chip rather than trailing the run. Whatever the layout places immediately
 * after it — the first chip, or the "+N" tail when no chip fit — is never pulled back over it, since
 * only a chip's left-hand neighbour being another chip earns a negative offset. The control is
 * placed UNCONDITIONALLY, whatever else fits: it is the run's only entry point back to its own
 * category checkboxes, so a player who has switched every hideable category off, with nothing
 * critical firing right now, must always have a way back to it rather than losing the run — and with
 * it the only route back into settings — for the rest of that save (owner decision,
 * docs/active/gameplay/alert-bar.md → "Placement and behaviour"). It is the one item exempt from
 * `availableWidth`; chips and the collapsed tail are still the thing that renders nothing rather
 * than overflow.
 *
 * Mutually exclusive with an open category flyout, mirroring the approved prototype's own
 * `settingsOpen`/`openId` pair: opening the settings panel closes whichever flyout was open, and
 * opening a flyout closes settings — never both floating over the map at once. This used to be code
 * in this file; it is now `Popover`'s own module-level registry, since the settings panel is a
 * `Popover` instance exactly like every chip's flyout (verified: the registry
 * (`components/ui/popover.tsx`'s `openStack`/`claimOpen`) is a bare module-level variable, not
 * scoped to any one `Popover` React tree, so it applies across every mounted instance regardless of
 * which component renders it — both are depth-0 popovers here, so the stack's depth-0 slot is
 * exactly the single incumbent this comment already describes).
 */
function AlertRunChips({
  availableWidth,
  runRef,
}: {
  availableWidth: number;
  runRef?: RefObject<HTMLDivElement | null>;
}) {
  const { categories, categorySettings } = useAlerts();
  const setCategory = useSetAlertCategory();

  const shown = categories.filter((category) => {
    if (category.count <= 0) return false;
    const def = ALERT_CATEGORIES[category.id];
    return !def.hideable || categorySettings[category.id];
  });
  // The ordered tier-and-count sequence IS the layout's input: it needs the critical PREFIX and the
  // tier boundaries (each of which draws a separator, and so costs width), both of which are facts
  // about this order rather than counts that could be restated beside it — and each chip's own
  // count, which is what decides how wide that chip actually draws. The category rides along so a
  // placed chip carries the thing it was laid out from, rather than a position into this list that
  // the two sides would then have to agree about.
  const runChips = shown.map((category) => ({
    tier: ALERT_CATEGORIES[category.id].tier,
    count: category.count,
    category,
  }));
  const { items, overlapping, contentWidth } = layoutRun(runChips, availableWidth);

  return (
    <div className="relative flex-none" style={{ width: contentWidth, height: RUN_HEIGHT }}>
      {items.map((item, index) => {
        if (item.kind === "control") {
          return (
            <Popover key="settings" align="start" pointerInert>
              <PopoverTrigger>
                <button
                  type="button"
                  aria-label="Alert settings"
                  className={chip({
                    overlapping,
                    class: "border-border-strong bg-surface text-text-secondary",
                  })}
                  style={{ left: item.left }}
                >
                  <SettingsIcon aria-hidden="true" className="h-5 w-5" />
                </button>
              </PopoverTrigger>
              <AlertSettings
                categories={categorySettings}
                onChangeCategory={(categoryId, on) => setCategory.mutate({ categoryId, on })}
              />
            </Popover>
          );
        }
        if (item.kind === "chip") {
          return (
            <Popover key={item.chip.category.id} align="start" pointerInert>
              <PopoverTrigger>
                <AlertChip
                  category={item.chip.category}
                  zIndex={item.zIndex}
                  overlapping={overlapping}
                  left={item.left}
                />
              </PopoverTrigger>
              <ActiveAlertFlyout category={item.chip.category} runRef={runRef} />
            </Popover>
          );
        }
        if (item.kind === "separator") {
          return <TierSeparator key={`separator-${index}`} left={item.left} />;
        }
        return (
          <CollapsedTail
            key="tail"
            collapsed={item.collapsed}
            left={item.left}
            overlapping={overlapping}
          />
        );
      })}
    </div>
  );
}

/**
 * The one place `useSystemFocus()`/`useNavigate()` actually run for the alert bar — kept in this small
 * wrapper rather than inside `alert-flyout.tsx` itself so `AlertFlyout`'s own tests keep rendering it
 * directly with a spy `onNavigate`, no router or atlas provider required (`alert-flyout.test.tsx`'s
 * own stated convention).
 *
 * Mounted for every visible chip now, not only the open one: `Popover` exposes no open/closed signal
 * to its consumer (no controlled `open` prop, no `onOpenChange` callback — see
 * `components/ui/popover.tsx`'s own `PopoverProps`), so `AlertRunChips` above has no state left to
 * conditionally render this component on, and `ActiveAlertFlyout` sits ABOVE `AlertFlyout`'s own
 * `PopoverContent` in the tree — outside the boundary Radix's `Presence` gates — so mounting it is
 * not itself deferred by the popover being closed. This is safe here specifically: `useSystemFocus()`
 * calls `useAtlas()` (`lib/hooks/use-atlas.ts`), a synchronous read off the store's `atlas` slice
 * (Task 7) — every extra mount here is a cheap selector subscription, not a fetch or a suspend, so
 * mounting one per visible chip costs nothing beyond the subscription itself. `useNavigate()` reads
 * context only, no fetch of any kind.
 *
 * Resolves an `AlertFlyout` row's already-decided target (`resolveAlertTarget`,
 * `components/alerts/alert-flyout.tsx`) into the actual navigation: `focusSystem` for a system
 * destination, `focusLane` for a lane destination (Lane congested — recentres on the lane's own
 * midpoint and opens its card, the same channel `LanePanel`'s own "Show on Map" button uses), a
 * `router.push` onto the player faction's panel for a faction destination (the player id comes off
 * the same already-resolved atlas read `useSystemFocus` relies on; a world with no player seat never
 * emits a faction-destination alert, so the null branch is a no-op, not a route), nothing for the one
 * combination the destination table never produces.
 */
function ActiveAlertFlyout({
  category,
  runRef,
}: {
  category: AlertCategory;
  runRef?: RefObject<HTMLDivElement | null>;
}) {
  const navigate = useNavigate();
  const focusSystem = useSystemFocus();
  const focusLane = useLaneFocus();
  const { atlas } = useAtlas();

  function handleNavigate(target: AlertNavigateTarget) {
    if (target.kind === "system") focusSystem(target.systemId, target.tab);
    else if (target.kind === "lane") focusLane(target.laneKey);
    else if (target.kind === "faction") {
      // `target.tab` is always "" now that Maintenance unfunded is the only faction-kind
      // destination — no alert category routes to a faction panel tab any more.
      const factionId = atlas.player?.controlledFactionId;
      if (factionId) navigate(`/factions/${factionId}`);
    }
  }

  return <AlertFlyout category={category} onNavigate={handleNavigate} runRef={runRef} />;
}

/** The hairline between tiers — a `w-px` rule at the offset the layout placed it at. Its own margins
 *  are already spent in the offsets on either side of it, so nothing is left here but the rule and
 *  the same vertical centring every other item in the run takes. */
function TierSeparator({ left }: { left: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-border-strong"
      style={{ left }}
    />
  );
}

/** The tail of an over-full run, once the layout has folded some of the least-severe chips away —
 *  never a critical one, by `layoutRun`'s own contract. Plain count, no interaction: it names several
 *  different categories at once, so a single click has no one flyout to open the way an individual
 *  chip's does. Consumes `AlertChip`'s own shell (`chip` from `components/alerts/alert-chip.tsx`)
 *  rather than hand-duplicating its classes — the two must not drift (AGENTS.md's
 *  extract-on-second-occurrence rule). A tail is only ever placed past the overlap floor, so
 *  `overlapping` is always true here; it is threaded from the layout anyway rather than hardcoded, so
 *  the tail's shadow cannot disagree with the run's. */
function CollapsedTail({
  collapsed,
  left,
  overlapping,
}: {
  collapsed: number;
  left: number;
  overlapping: boolean;
}) {
  return (
    <span
      className={chip({
        overlapping,
        class: "border-border-strong bg-surface font-mono text-text-secondary",
      })}
      style={{ left }}
    >
      +{collapsed}
    </span>
  );
}
