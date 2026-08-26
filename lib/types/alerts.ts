// Alert bar types — the category registry's shape. The authored tables live in
// `lib/constants/alerts.ts`; the two arrays here exist only to derive types from.

import type { LucideIcon } from "lucide-react";
import type { SystemTabSegment } from "@/lib/constants/system-tabs";

/** Chip colour band. Non-hideable is exactly the critical tier. */
export type AlertTier = "critical" | "important" | "info";

/**
 * The sixteen standing alert categories — system warnings, opportunities and the three event bands,
 * per the alert bar's authored tier list. This array, not a separately hand-written union, is the
 * single enumeration: `AlertCategoryId` is derived from it below, so every surface that has to walk
 * every category (the settings panel's checkbox list, the write schema in
 * `lib/schemas/player-settings.ts`) iterates the same list the type is made of, and a
 * seventeenth category cannot be added to one without the other. Use instead of
 * `Object.keys(ALERT_CATEGORIES)`, which widens a `Record<AlertCategoryId, …>`'s keys back to a bare
 * `string` (a standing TypeScript limitation on `Record`) and so would need an `as` cast to hand an
 * id back to anything expecting the union.
 *
 * Order here is the registry's own authored tier-then-order sequence, but nothing reads it as an
 * ordering: the two surfaces that render in order sort on `ALERT_CATEGORIES[id].tier`/`.order`
 * instead, so this array carries no second copy of the authored order to drift.
 */
export const ALERT_CATEGORY_IDS = [
  "population_collapse",
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
] as const;

/** One of the sixteen standing alert categories — see `ALERT_CATEGORY_IDS` above, which this is
 *  derived from. */
export type AlertCategoryId = (typeof ALERT_CATEGORY_IDS)[number];

/** Which alert categories the player wants on the bar, one flag per category. Stored on
 *  `WorldPlayer` (`lib/world/types.ts`), so it travels with the save. A critical category's flag is
 *  always `true` and the write boundary refuses to change it (`lib/services/player-settings.ts`) —
 *  the tier cannot be turned off. */
export type AlertCategorySettings = Record<AlertCategoryId, boolean>;

/** The system tabs an alert row can navigate to — a fixed subset of `SystemTabSegment`. Typed with
 *  `satisfies` (not `as const`-only) so a renamed or removed segment fails to compile here instead
 *  of silently drifting. */
const ALERT_DESTINATION_TABS = ["", "population", "industry", "logistics"] satisfies SystemTabSegment[];

/** The four system tabs an alert destination may name, as a type — named rather than left inline so
 *  the surfaces that carry a resolved destination around (`AlertNavigateTarget`,
 *  `components/alerts/alert-flyout.tsx`) can state the same subset instead of re-widening it back to
 *  the full `SystemTabSegment`. */
export type AlertDestinationTab = (typeof ALERT_DESTINATION_TABS)[number];

/** Where a row click sends the player. `system` reuses the Tracker's fly-to-system-and-open-tab
 *  flow; `faction` opens the faction panel (Maintenance unfunded, which is faction-level, not
 *  per-system); `events` opens the events panel (the three event bands navigate to the event's own
 *  system when it has one — decided per-instance at click time, not here). */
export type AlertDestination =
  | { kind: "system"; tab: AlertDestinationTab }
  | { kind: "faction" }
  | { kind: "events" };

/** One category's authored entry in the alert bar's tier list — tier, destination and order in one
 *  place so they cannot drift apart across the surfaces that read them. The default on/off state is
 *  deliberately not here; see `lib/constants/alerts.ts`'s header for where it lives and why. */
export interface AlertCategoryDef {
  tier: AlertTier;
  icon: LucideIcon;
  /** Whether the chip carries the cased fault slash — a plain subject glyph negated because lucide
   *  has no `-off` variant for it. */
  faulted: boolean;
  label: string;
  /** The one line the flyout shows saying what the condition is, in plain player-facing prose. */
  conditionLine: string;
  destination: AlertDestination;
  /** Whether the category can be switched off at all. `false` only for the critical tier. */
  hideable: boolean;
  /** Chip order within its tier. Unique per tier — the authored order is total, so a chip cannot
   *  move once ranking runs. */
  order: number;
}
