// Alert bar types — the category registry's shape. The authored tables live in
// `lib/constants/alerts.ts`; the one array here exists only to derive a type from.

import type { LucideIcon } from "lucide-react";
import type { SystemTabSegment } from "@/lib/constants/system-tabs";

/** Chip colour band. Non-hideable is exactly the critical tier. */
export type AlertTier = "critical" | "important" | "info";

/** The sixteen standing alert categories — system warnings, opportunities and
 *  the three event bands, per the alert bar's authored tier list. */
export type AlertCategoryId =
  | "famine"
  | "strike"
  | "maintenance_unfunded"
  | "crisis"
  | "deprived_worlds"
  | "unrest_rising"
  | "survival_stock_falling"
  | "demand_unservable"
  | "overcrowded"
  | "no_housing_headroom"
  | "build_blocked"
  | "industry_idle"
  | "disruption"
  | "build_opportunity"
  | "colony_opportunity"
  | "windfall";

/** The system tabs an alert row can navigate to — a fixed subset of `SystemTabSegment`. Typed with
 *  `satisfies` (not `as const`-only) so a renamed or removed segment fails to compile here instead
 *  of silently drifting. */
const ALERT_DESTINATION_TABS = ["", "population", "industry", "logistics"] satisfies SystemTabSegment[];

/** Where a row click sends the player. `system` reuses the Tracker's fly-to-system-and-open-tab
 *  flow; `faction` opens the faction panel (Maintenance unfunded, which is faction-level, not
 *  per-system); `events` opens the events panel (the three event bands navigate to the event's own
 *  system when it has one — decided per-instance at click time, not here). */
export type AlertDestination =
  | { kind: "system"; tab: (typeof ALERT_DESTINATION_TABS)[number] }
  | { kind: "faction" }
  | { kind: "events" };

/** One category's authored entry in the alert bar's tier list — tier, default, destination and
 *  order in one place so they cannot drift apart across the surfaces that read them. */
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
  /** Whether the category's settings checkbox starts checked. The defaults table is the single
   *  authority; every critical category is `true` since the tier cannot be turned off anyway. */
  defaultOn: boolean;
  /** Whether the category can be switched off at all. `false` only for the critical tier. */
  hideable: boolean;
  /** Chip order within its tier. Unique per tier — the authored order is total, so a chip cannot
   *  move once ranking runs. */
  order: number;
}
