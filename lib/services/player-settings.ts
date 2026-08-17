/**
 * Attention-layer settings verbs — the mutation half of the alert bar's category checkboxes
 * (docs/active/gameplay/alert-bar.md → "Settings") and the Tracker's section checkboxes
 * (docs/active/gameplay/tracker.md → "Settings").
 *
 * Both records live on `world.player`, so they travel with the save: every attention-layer setting
 * is per-save, whatever kind of setting it is. Both take ONE flag per write and return the full
 * merged record, mirroring `setSystemPin` — the client never sends a whole record it would first
 * have had to read, so two open surfaces cannot clobber each other's flags.
 *
 * No processor reads either record; they are read back out by `getAlertData` / `getTrackerData`
 * alongside the data each surface already fetches.
 */
import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import type { AlertCategoryInput, TrackerSectionInput } from "@/lib/schemas/player-settings";
import type { AlertCategorySettings } from "@/lib/types/alerts";
import type { TrackerSections } from "@/lib/types/tracker";
import type { World, WorldPlayer } from "@/lib/world/types";

export type SetAlertCategoryResult =
  | { ok: true; data: AlertCategorySettings }
  | { ok: false; error: string };

export type SetTrackerSectionResult =
  | { ok: true; data: TrackerSections }
  | { ok: false; error: string };

type Seat = { world: World; player: WorldPlayer } | { error: string };

function requirePlayer(): Seat {
  if (!hasWorld()) return { error: "No world loaded." };
  const world = getWorld();
  const player = world.player;
  if (!player) return { error: "This world has no player seat." };
  return { world, player };
}

/**
 * Turns one alert category on or off.
 *
 * A non-hideable (critical) category is REJECTED rather than silently accepted: the settings panel
 * renders no control for one (`components/alerts/alert-settings.tsx`), so the only way to reach this
 * branch is a caller ignoring the registry's own `hideable` flag, and answering 200 to a write that
 * did nothing would tell that caller its change took. This is what keeps "the critical tier cannot
 * be turned off" true at the one place that could otherwise violate it, rather than only in the UI
 * that happens not to offer the button.
 */
export function setAlertCategory(input: AlertCategoryInput): SetAlertCategoryResult {
  const seat = requirePlayer();
  if ("error" in seat) return { ok: false, error: seat.error };
  const { world, player } = seat;

  if (!ALERT_CATEGORIES[input.categoryId].hideable) {
    return { ok: false, error: "Critical alert categories cannot be hidden." };
  }

  // Re-setting a checkbox to what it already is changes nothing — skip the write rather than bump
  // the store's version counter, which is what tells every reader the world moved (same guard
  // `setSystemPin` carries for the same reason).
  if (player.alertCategories[input.categoryId] === input.on) {
    return { ok: true, data: player.alertCategories };
  }

  const alertCategories: AlertCategorySettings = {
    ...player.alertCategories,
    [input.categoryId]: input.on,
  };
  setWorld({ ...world, player: { ...player, alertCategories } });
  return { ok: true, data: alertCategories };
}

/** Shows or hides one Tracker section. Every section is hideable — there is no critical tier here. */
export function setTrackerSection(input: TrackerSectionInput): SetTrackerSectionResult {
  const seat = requirePlayer();
  if ("error" in seat) return { ok: false, error: seat.error };
  const { world, player } = seat;

  if (player.trackerSections[input.section] === input.on) {
    return { ok: true, data: player.trackerSections };
  }

  const trackerSections: TrackerSections = { ...player.trackerSections, [input.section]: input.on };
  setWorld({ ...world, player: { ...player, trackerSections } });
  return { ok: true, data: trackerSections };
}
