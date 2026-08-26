// Attention-layer defaults — what a new world's alert-bar and Tracker settings start as.
//
// Deliberately icon-free, unlike the category registry it sits beside (`lib/constants/alerts.ts`,
// which imports lucide). These two records are seeded onto `WorldPlayer` at world-gen, so
// `lib/world/gen.ts` has to reach them — and that module is on the `npm run simulate` path, where
// importing the registry would pull the whole lucide barrel into a node process that renders
// nothing.

import type { AlertCategorySettings } from "@/lib/types/alerts";
import type { TrackerSections } from "@/lib/types/tracker";

/**
 * Which alert categories a new world starts with on the bar — the authored defaults table from
 * `docs/active/gameplay/alert-bar.md` → "The categories", and the single authority for them. Written
 * out key by key rather than folded from `ALERT_CATEGORY_IDS` because a fold widens the result's
 * keys back to `string`, which would need an `as` cast to satisfy `AlertCategorySettings`; spelled
 * out, the compiler requires all sixteen.
 *
 * Three important-tier categories are authored OFF — the alert bar is a surface the design chose not
 * to fill by default. Every critical category is `true`, since the tier cannot be turned off anyway
 * (`AlertCategoryDef.hideable`).
 *
 * Also the read fallback for a world with no player seat (`lib/services/alerts.ts`): there is no
 * seat to hold a preference for, and the bar has nothing to show either way.
 */
export const DEFAULT_ALERT_CATEGORIES: AlertCategorySettings = {
  // ── critical — cannot be turned off ──────────────────────────
  population_collapse: true,
  strike: true,
  maintenance_unfunded: true,
  crisis: true,
  // ── important ───────────────────────────────────────────────
  deprived_worlds: true,
  unrest_rising: false,
  survival_stock_falling: true,
  demand_unservable: true,
  overcrowded: true,
  no_housing_headroom: true,
  build_blocked: false,
  industry_idle: false,
  disruption: true,
  // ── info ────────────────────────────────────────────────────
  build_opportunity: true,
  colony_opportunity: true,
  windfall: true,
};

/**
 * Which Tracker sections a new world starts with: every one on. A Tracker section carries no urgency
 * (unlike an alert category), so "show everything" costs the player nothing
 * (docs/active/gameplay/tracker.md → "Settings").
 *
 * Also the read fallback for a world with no player seat (`lib/services/tracker.ts`), for the same
 * reason as above.
 */
export const DEFAULT_TRACKER_SECTIONS: TrackerSections = {
  pinned: true,
  building: true,
  colonising: true,
};
