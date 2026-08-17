"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useRouter } from "next/navigation";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { AlertChip, chip } from "@/components/alerts/alert-chip";
import { AlertFlyout, type AlertNavigateTarget } from "@/components/alerts/alert-flyout";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { useCycleBoundary } from "@/lib/hooks/use-cycle-boundary";
import { useSystemFocus } from "@/lib/hooks/use-system-focus";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import { DRAWER_WIDTH, TRACKER_BASE_WIDTH, TRACKER_SETTINGS_SPAN, RAIL_INSET } from "@/lib/constants/layout";
import { packRun, isOverlapping, chipMarginLeft, separatorMargins, stackZIndex } from "@/lib/utils/alert-packing";
import type { AlertCategory } from "@/lib/types/api";
import type { AlertCategoryId, AlertTier } from "@/lib/types/alerts";

/** A chip appears the cycle its first instance appears (immediately — count > 0 is enough) and
 *  clears after two consecutive cycles with none: still shown at 1 zero cycle and at 2, gone at 3.
 *  See `useHysteresisVisibleIds`. */
const GRACE_CYCLES = 2;

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
 * the left, the Tracker rail on the right, and the top of the map (docs/build-plans/alert-bar.md →
 * "Placement and behaviour"). Reserves no layout height: an empty run renders nothing at all, not an
 * empty band.
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
 * hand. A `ResizeObserver` on that measured element is what feeds `packRun` (`lib/utils/alert-packing.ts`)
 * a live number on viewport resize and on `settingsOpen` toggling. `AlertRunContent` below is the
 * part that actually renders chips from an `availableWidth` number; it never measures anything
 * itself, which is what keeps it renderable — and truthfully testable — in jsdom, where there is no
 * layout to measure (see its own docstring).
 */
export function AlertRun({ settingsOpen }: AlertRunProps) {
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

  const rightSpan = TRACKER_BASE_WIDTH + (settingsOpen ? TRACKER_SETTINGS_SPAN : 0) + RAIL_INSET;

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-2 z-20 flex min-w-0 items-center"
      style={{ left: `${DRAWER_WIDTH + RAIL_INSET}px`, right: `${rightSpan}px` }}
    >
      <AlertRunContent availableWidth={availableWidth} runRef={ref} />
    </div>
  );
}

/**
 * The testable half of the run: everything from `availableWidth` down is a pure function of props
 * and hook state, with no DOM measurement anywhere in this component or below it — jsdom has no
 * layout, so a measured width in a component under test is always 0, and every test would render an
 * empty run and pass vacuously. `AlertRun` above is the only thing that measures; this is what
 * `alert-run.test.tsx` renders directly, supplying `availableWidth` as a literal.
 *
 * Owns `useAlerts()` inside a `QueryBoundary`, same as `TrackerPanel` — a fetch failure degrades the
 * run, not the map behind it. `loadingFallback={null}`: the run reserves no layout height on
 * purpose (nothing behind an empty galaxy), so the loading state is the same as the empty state,
 * nothing, rather than a spinner floating over the map for one round trip.
 *
 * `runRef` is forwarded, unread, straight through to `AlertRunChips` and on to whichever
 * `AlertFlyout` is open — this component still measures nothing itself. It is `AlertRun`'s own
 * measuring ref (above), not a new one: the flyout's horizontal clamp needs the SAME rect
 * `ResizeObserver` already reads for packing, not a second element to keep in sync with it.
 */
export function AlertRunContent({
  availableWidth,
  runRef,
}: {
  availableWidth: number;
  runRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <QueryBoundary loadingFallback={null}>
      <AlertRunChips availableWidth={availableWidth} runRef={runRef} />
    </QueryBoundary>
  );
}

/**
 * Per-category presentational memory: once a category's count reaches zero its chip stays in the
 * run for two more cycles before disappearing, so a system oscillating across a threshold does not
 * toggle its chip in and out (and re-pack every chip to its right) every cycle
 * (docs/build-plans/alert-bar.md → "Placement and behaviour"). Cycle-scoped, not render-scoped: an
 * id's clock only moves when `cycle` itself changes, so however many re-renders land within one
 * cycle (an SSE refetch, an unrelated state change) cost it nothing.
 *
 * Purely presentational: it decides membership in the shown set only, never the data rendered for a
 * member. The category object a visible chip renders is always the SAME live object `useAlerts()`
 * returned this render — never a remembered snapshot — so a count that recovers mid-grace, or an
 * open flyout reading the same category, both see the true current numbers immediately.
 *
 * The map lives in a ref and is written during render (the same adjust-during-render idiom
 * `useCycleBoundary` itself uses): the write is idempotent for a given `(categories, cycle)` pair,
 * so React re-invoking this render (StrictMode, a bail-out retry) just re-sets the same values.
 */
function useHysteresisVisibleIds(categories: AlertCategory[], cycle: number): Set<AlertCategoryId> {
  const lastNonZeroCycle = useRef(new Map<AlertCategoryId, number>());

  for (const category of categories) {
    if (category.count > 0) lastNonZeroCycle.current.set(category.id, cycle);
  }

  const visible = new Set<AlertCategoryId>();
  for (const [id, seenAtCycle] of lastNonZeroCycle.current) {
    if (cycle - seenAtCycle <= GRACE_CYCLES) {
      visible.add(id);
    } else {
      // Out of the grace window — stop tracking it so the map doesn't grow across a whole session.
      lastNonZeroCycle.current.delete(id);
    }
  }
  return visible;
}

/**
 * The suspense-dependent core: reads the live alert data and the session's cycle count, applies the
 * hysteresis grace window, hands the result to `packRun` for placement, and renders the ordered
 * chips (critical tier first — `useAlerts()` already returns every category tier-then-order sorted,
 * per its own docstring, so this never re-sorts) plus a trailing "+N" for whatever `packRun`
 * collapsed.
 *
 * `packRun`'s `gap` is what actually places every chip — every number below (`chipMarginLeft`,
 * `separatorMargins`, `stackZIndex`, `isOverlapping`) is pure arithmetic from
 * `lib/utils/alert-packing.ts`, node-tested there; this component only hands that arithmetic to
 * `AlertChip` as `marginLeft`/`zIndex`/`overlapping`, per AGENTS.md's testing rule that a jsdom test
 * can't see a style. The leftmost, most severe chip's resting z-index is the highest
 * (`stackZIndex`); hovering or opening a chip raises it above the whole stack (the chip shell's own
 * `overlapping` variant and `aria-expanded:z-[95]`) regardless of position; the shadow, the hover
 * raise and the tier separator's tighter margins all apply only once `isOverlapping(gap)` — a spaced
 * run has nothing to cast a shadow over or raise a chip clear of.
 *
 * Which chip's flyout is open lives here as plain `useState` — ephemeral UI state, not persisted —
 * and is passed to each `AlertChip` as `open`/`onOpen`, and to `ActiveAlertFlyout` below (mounted
 * only for the open category, so at most one flyout ever renders). Each chip is wrapped in its own
 * `position: relative` `<div>` so its flyout — `position: absolute`, `top: 100%` — anchors under
 * THAT chip with no measurement of its own: `marginLeft` moves from `AlertChip` onto this wrapper so
 * the packed spacing is unchanged, and the wrapper's own width is exactly its chip's, so `left: 0`
 * lines the flyout's left edge up with the chip's by default — `runRef`, threaded through unread
 * here, is what `AlertFlyout` itself measures against to pull that back onto the run's own span near
 * the right of a packed run (see its own docstring).
 */
function AlertRunChips({
  availableWidth,
  runRef,
}: {
  availableWidth: number;
  runRef?: RefObject<HTMLDivElement | null>;
}) {
  const { categories } = useAlerts();
  const cycle = useCycleBoundary();
  const visibleIds = useHysteresisVisibleIds(categories, cycle);
  const [openId, setOpenId] = useState<AlertCategoryId | null>(null);

  const shown = categories.filter((category) => visibleIds.has(category.id));
  const criticalCount = shown.filter((category) => ALERT_CATEGORIES[category.id].tier === "critical").length;
  const { visible, collapsed, gap } = packRun(shown.length, availableWidth, criticalCount);

  if (visible === 0) return null;

  const chips = shown.slice(0, visible);
  const hidden = shown.slice(visible);
  const overlapping = isOverlapping(gap);

  let lastTier: AlertTier | null = null;

  return (
    <div className="flex items-center">
      {chips.map((category, index) => {
        const tier = ALERT_CATEGORIES[category.id].tier;
        const isNewTier = lastTier !== null && tier !== lastTier;
        lastTier = tier;
        const position = index === 0 ? "first" : isNewTier ? "after-separator" : "after-chip";
        const marginLeft = chipMarginLeft(gap, position);
        const zIndex = stackZIndex(index, chips.length);
        const isOpen = openId === category.id;
        return (
          <Fragment key={category.id}>
            {isNewTier && <TierSeparator gap={gap} />}
            <div className="relative inline-flex" style={{ marginLeft }}>
              <AlertChip
                category={category}
                open={isOpen}
                onOpen={() => setOpenId((id) => (id === category.id ? null : category.id))}
                zIndex={zIndex}
                overlapping={overlapping}
              />
              {isOpen && (
                <ActiveAlertFlyout category={category} onClose={() => setOpenId(null)} runRef={runRef} />
              )}
            </div>
          </Fragment>
        );
      })}
      {collapsed > 0 && (
        <CollapsedTail categories={hidden} marginLeft={chipMarginLeft(gap, "after-chip")} />
      )}
    </div>
  );
}

/**
 * The one place `useSystemFocus()`/`useRouter()` actually run for the alert bar — deliberately
 * inside this small wrapper, itself mounted only while ITS OWN category's flyout is open, rather
 * than up in `AlertRunChips` (always mounted whenever the run has anything to show).
 * `useSystemFocus()` calls the suspense-backed `useAtlas()`; calling that unconditionally on every
 * render would make simply having a nonempty alert bar on screen depend on an atlas fetch, and
 * would throw in any test that renders `AlertRunContent`/`AlertRunChips` without a `QueryClient` —
 * every existing case in `alert-run.test.tsx`, none of which ever opens a flyout, so this component
 * never mounts in them and nothing there had to change.
 *
 * Resolves an `AlertFlyout` row's already-decided target (`resolveAlertTarget`,
 * `components/alerts/alert-flyout.tsx`) into the actual navigation: `focusSystem` for a system
 * destination, a plain `router.push` for a faction/events route, nothing for the one combination
 * the destination table never produces.
 */
function ActiveAlertFlyout({
  category,
  onClose,
  runRef,
}: {
  category: AlertCategory;
  onClose: () => void;
  runRef?: RefObject<HTMLDivElement | null>;
}) {
  const router = useRouter();
  const focusSystem = useSystemFocus();

  function handleNavigate(target: AlertNavigateTarget) {
    if (target.kind === "system") focusSystem(target.systemId, target.tab);
    else if (target.kind === "route") router.push(target.path);
  }

  return (
    <AlertFlyout category={category} onNavigate={handleNavigate} onClose={onClose} runRef={runRef} />
  );
}

/** The hairline between tiers — verbatim from alert-bar-prototype.html's `.tier-gap` rule (resting
 *  margin) and its `.bar-chips.overlap .tier-gap` override (once packing overlaps). */
function TierSeparator({ gap }: { gap: number }) {
  const { left, right } = separatorMargins(gap);
  return (
    <span
      aria-hidden="true"
      className="h-4 w-px flex-none bg-border-strong"
      style={{ marginLeft: left, marginRight: right }}
    />
  );
}

/** The tail of an over-full run, once `packRun` has decided some of the least-severe chips have to
 *  fold away — never a critical one, by `packRun`'s own contract. Plain count, no interaction yet:
 *  what clicking it does belongs to the flyout work (Task 13), same as an individual chip's click
 *  today. Consumes `AlertChip`'s own shell (`chip` from `components/alerts/alert-chip.tsx`) rather
 *  than hand-duplicating its classes — the two must not drift (AGENTS.md's extract-on-second-
 *  occurrence rule). `collapsed > 0` only happens past `packRun`'s overlap floor, so this tail is
 *  always drawn with the rightward shadow, same as any overlapping chip. */
function CollapsedTail({ categories, marginLeft }: { categories: AlertCategory[]; marginLeft: number }) {
  if (categories.length === 0) return null;
  return (
    <span
      className={chip({
        overlapping: true,
        class: "border-border-strong bg-surface font-mono text-text-secondary",
      })}
      style={{ marginLeft }}
    >
      +{categories.length}
    </span>
  );
}
