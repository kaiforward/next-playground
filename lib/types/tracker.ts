// Tracker panel types — the section enumeration. The authored default lives in
// `lib/constants/attention.ts`; the array here exists only to derive types from.

/**
 * The Tracker's three sections, in the panel's own top-to-bottom render order. This array, not a
 * separately hand-written union, is the single enumeration: `TrackerSectionKey` is derived from it
 * below, so the settings panel's checkbox list, the write schema and the stored record all walk the
 * same list the type is made of. Same convention as `ALERT_CATEGORY_IDS` (`lib/types/alerts.ts`),
 * and for the same reason — `Object.keys(...)` on a `Record<TrackerSectionKey, …>` widens back to
 * `string` and would need an `as` cast to hand a key to anything expecting the union.
 */
export const TRACKER_SECTION_KEYS = ["pinned", "building", "colonising"] as const;

/** One of the Tracker's three sections — see `TRACKER_SECTION_KEYS` above, which this is derived
 *  from. */
export type TrackerSectionKey = (typeof TRACKER_SECTION_KEYS)[number];

/** Which Tracker sections the player wants rendered — a section's rows and its heading disappear
 *  together when its flag is false. Stored on `WorldPlayer` (`lib/world/types.ts`), so it travels
 *  with the save. */
export type TrackerSections = Record<TrackerSectionKey, boolean>;
