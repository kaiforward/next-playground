"use client";

import { useCallback, useEffect, useState } from "react";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import type { AlertCategoryId } from "@/lib/types/alerts";

const STORAGE_KEY = "stellarTrader:alertCategories";

export type AlertCategorySettings = Record<AlertCategoryId, boolean>;

/**
 * Default AND fallback: the authored `defaultOn` off `ALERT_CATEGORIES` for every category — read
 * off the registry field by field, never a second hand-written true/false list, so this can never
 * drift from the authored defaults (`docs/active/gameplay/alert-bar.md` → "The categories", the
 * single authority there).
 *
 * Deliberately NOT the Tracker's own all-on fallback (`DEFAULT_TRACKER_SECTIONS`). A Tracker section
 * carries no urgency, so "show everything, including on a malformed read" costs the player nothing.
 * An alert category does carry urgency, and three important-tier categories are authored OFF by
 * default (`docs/active/gameplay/alert-bar.md` → "The categories") — falling back to all-on would
 * silently re-enable exactly the categories the design chose to hide, on every malformed read. Every
 * critical category's own `defaultOn` is `true`, since the tier can never be turned off anyway (see
 * `hideable` below).
 */
export const DEFAULT_ALERT_CATEGORIES: AlertCategorySettings = {
  famine: ALERT_CATEGORIES.famine.defaultOn,
  strike: ALERT_CATEGORIES.strike.defaultOn,
  maintenance_unfunded: ALERT_CATEGORIES.maintenance_unfunded.defaultOn,
  crisis: ALERT_CATEGORIES.crisis.defaultOn,
  deprived_worlds: ALERT_CATEGORIES.deprived_worlds.defaultOn,
  unrest_rising: ALERT_CATEGORIES.unrest_rising.defaultOn,
  survival_stock_falling: ALERT_CATEGORIES.survival_stock_falling.defaultOn,
  demand_unservable: ALERT_CATEGORIES.demand_unservable.defaultOn,
  overcrowded: ALERT_CATEGORIES.overcrowded.defaultOn,
  no_housing_headroom: ALERT_CATEGORIES.no_housing_headroom.defaultOn,
  build_blocked: ALERT_CATEGORIES.build_blocked.defaultOn,
  industry_idle: ALERT_CATEGORIES.industry_idle.defaultOn,
  disruption: ALERT_CATEGORIES.disruption.defaultOn,
  build_opportunity: ALERT_CATEGORIES.build_opportunity.defaultOn,
  colony_opportunity: ALERT_CATEGORIES.colony_opportunity.defaultOn,
  windfall: ALERT_CATEGORIES.windfall.defaultOn,
};

/**
 * Narrows a parsed `localStorage` value at the boundary — `typeof`/`in` checks only, no `as`,
 * mirroring `components/map/map-session.ts`'s `parseOverlays`. Unlike the Tracker's own
 * `parseSections` (which demands all three of ITS keys and discards the whole object otherwise),
 * this merges PER KEY onto `DEFAULT_ALERT_CATEGORIES`: a missing key, a non-boolean value, or a
 * whole value that isn't a usable object all fall back to that one key's own authored default,
 * rather than discarding every other key's genuine, validly-stored preference.
 *
 * That choice is deliberate, not incidental. With sixteen categories today and a registry that will
 * grow, whole-object rejection means shipping a seventeenth category silently wipes every existing
 * player's saved preferences the next time they load the game (the new key is "missing" from every
 * stored object ever written) — the exact failure `parseSections` cannot have today, since the
 * Tracker's three keys are not expected to grow. A per-key merge instead treats an unrecognised or
 * missing key as "never assessed, use the authored default", the same convention the alert bar's own
 * signal fields (`docs/active/gameplay/alert-bar.md` → "What the engine emits") already use for
 * exactly this reason.
 */
function parseCategories(value: unknown): AlertCategorySettings {
  const merged: AlertCategorySettings = { ...DEFAULT_ALERT_CATEGORIES };
  if (typeof value !== "object" || value === null) return merged;

  if ("famine" in value && typeof value.famine === "boolean") merged.famine = value.famine;
  if ("strike" in value && typeof value.strike === "boolean") merged.strike = value.strike;
  if ("maintenance_unfunded" in value && typeof value.maintenance_unfunded === "boolean") {
    merged.maintenance_unfunded = value.maintenance_unfunded;
  }
  if ("crisis" in value && typeof value.crisis === "boolean") merged.crisis = value.crisis;
  if ("deprived_worlds" in value && typeof value.deprived_worlds === "boolean") {
    merged.deprived_worlds = value.deprived_worlds;
  }
  if ("unrest_rising" in value && typeof value.unrest_rising === "boolean") {
    merged.unrest_rising = value.unrest_rising;
  }
  if ("survival_stock_falling" in value && typeof value.survival_stock_falling === "boolean") {
    merged.survival_stock_falling = value.survival_stock_falling;
  }
  if ("demand_unservable" in value && typeof value.demand_unservable === "boolean") {
    merged.demand_unservable = value.demand_unservable;
  }
  if ("overcrowded" in value && typeof value.overcrowded === "boolean") {
    merged.overcrowded = value.overcrowded;
  }
  if ("no_housing_headroom" in value && typeof value.no_housing_headroom === "boolean") {
    merged.no_housing_headroom = value.no_housing_headroom;
  }
  if ("build_blocked" in value && typeof value.build_blocked === "boolean") {
    merged.build_blocked = value.build_blocked;
  }
  if ("industry_idle" in value && typeof value.industry_idle === "boolean") {
    merged.industry_idle = value.industry_idle;
  }
  if ("disruption" in value && typeof value.disruption === "boolean") {
    merged.disruption = value.disruption;
  }
  if ("build_opportunity" in value && typeof value.build_opportunity === "boolean") {
    merged.build_opportunity = value.build_opportunity;
  }
  if ("colony_opportunity" in value && typeof value.colony_opportunity === "boolean") {
    merged.colony_opportunity = value.colony_opportunity;
  }
  if ("windfall" in value && typeof value.windfall === "boolean") merged.windfall = value.windfall;

  return merged;
}

function readStoredCategories(): AlertCategorySettings {
  if (typeof window === "undefined") return DEFAULT_ALERT_CATEGORIES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ALERT_CATEGORIES;
    const parsed: unknown = JSON.parse(raw);
    return parseCategories(parsed);
  } catch {
    // Malformed JSON, or `localStorage` unavailable (SSR / privacy mode) — fall back rather than
    // throw at the boundary.
    return DEFAULT_ALERT_CATEGORIES;
  }
}

function writeStoredCategories(categories: AlertCategorySettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
  } catch {
    // Storage unavailable or full — the change stays in-memory for this render only.
  }
}

/**
 * Which alert categories the player wants to see on the bar — a view preference, not world state
 * (never part of the save, the same posture as `useTrackerSections`). Persisted to `localStorage`,
 * not `sessionStorage`, for the same "still true tomorrow" reason the Tracker's own hook gives.
 *
 * Hydrates from storage in an effect rather than on the initial render, matching
 * `useTrackerSections`'s own pattern — a server-rendered first paint and the client's first paint
 * agree (both see `DEFAULT_ALERT_CATEGORIES`) before the real stored value lands, so there is no
 * hydration mismatch to reconcile.
 *
 * `setCategory` no-ops for a non-hideable (critical) category id — the settings panel never renders
 * a control for one (`components/alerts/alert-settings.tsx`), so the only way to reach this branch
 * is a caller ignoring the registry's own `hideable` flag; this keeps "the critical tier cannot be
 * turned off" true at the one place that could otherwise violate it, not just in the UI that happens
 * not to offer the button.
 */
export function useAlertCategories(): {
  categories: AlertCategorySettings;
  setCategory: (id: AlertCategoryId, on: boolean) => void;
} {
  const [categories, setCategories] = useState<AlertCategorySettings>(DEFAULT_ALERT_CATEGORIES);

  useEffect(() => {
    setCategories(readStoredCategories());
  }, []);

  const setCategory = useCallback((id: AlertCategoryId, on: boolean) => {
    if (!ALERT_CATEGORIES[id].hideable) return;
    setCategories((prev) => {
      const next = { ...prev, [id]: on };
      writeStoredCategories(next);
      return next;
    });
  }, []);

  return { categories, setCategory };
}
