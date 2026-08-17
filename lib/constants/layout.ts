/**
 * Cross-surface layout numbers the alert run (`components/alerts/alert-run.tsx`) needs to stay in
 * sync with panels it does not render — pulled into one module because they were previously
 * hardcoded, separately, in `alert-run.tsx` itself, and finding 2 of the Task 12 review round is
 * proof that comment discipline alone already let one of them drift from the panel it names.
 *
 * Each constant's docstring names the Tailwind class it must stay in sync with by hand — a Tailwind
 * class cannot consume a JS constant without a CSS-variable indirection, and that larger refactor is
 * not in scope here.
 */

/** `components/ui/detail-panel.tsx:14` — the system/faction drawer's own fixed width (`w-[560px]
 *  max-w-full`), NOT a viewport-relative clamp. The alert run's left inset must track this exact
 *  number: a clamp expression here would claim more or less space than the drawer actually covers
 *  on any viewport where the clamp doesn't resolve to 560px. */
export const DRAWER_WIDTH = 560;

/** `components/tracker/tracker-panel.tsx:58` — the Tracker's own base width (`w-72`), always
 *  mounted whether or not its settings sibling is open. */
export const TRACKER_BASE_WIDTH = 288;

/** `components/tracker/tracker-settings.tsx:39` (`w-44` = 176px) plus the row's own `gap-2` (8px)
 *  between it and the Tracker panel (`components/map/map-right-rail.tsx`) — the span the settings
 *  panel ADDS to the occupied right side while it is open. */
export const TRACKER_SETTINGS_SPAN = 176 + 8;

/** `components/map/map-right-rail.tsx:87`'s `inset-y-2 right-2` (8px) — the rail's own inset off
 *  the map edges. Reused by the alert run so it sits the same 8px off the Tracker rail as the rail
 *  sits off the map's own edges, and reused again for the run's own `top-2` (`alert-run.tsx`) — the
 *  same standard 8px inset, this time off the map's top edge. */
export const RAIL_INSET = 8;

/** `components/alerts/alert-chip.tsx`'s own chip shell (`h-[26px]`) — the rendered height of one
 *  chip. `alert-flyout.tsx` needs this to know how far below the map's own top edge a chip's bottom
 *  edge sits (`RAIL_INSET` above it, plus this), before its own 5px clearance beneath that — see
 *  `alert-flyout.tsx`'s own docstring for the full derivation. Exists here, not as a local constant
 *  in `alert-flyout.tsx`, because it tracks a class in a DIFFERENT file — the reason this module
 *  exists at all. */
export const CHIP_HEIGHT = 26;
