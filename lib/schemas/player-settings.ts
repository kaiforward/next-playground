import { z } from "zod";
import { ALERT_CATEGORY_IDS } from "@/lib/types/alerts";
import { TRACKER_SECTION_KEYS } from "@/lib/types/tracker";

/**
 * One alert category's checkbox, not the whole record — the same one-item-per-write shape
 * `pinSchema` uses, and for the same reason: a client that sends the whole record has to have read
 * a current one first, so two open surfaces can clobber each other's flags. The server merges a
 * single flag onto what it holds and returns the full record back.
 *
 * `z.enum(ALERT_CATEGORY_IDS)` is what makes the parsed `categoryId` an `AlertCategoryId` rather
 * than a `string`, so the service can index `ALERT_CATEGORIES` with it and the route needs no guard
 * of its own — the boundary narrows once (AGENTS.md → "Type at the boundary, trust downstream").
 */
export const alertCategorySchema = z.object({
  categoryId: z.enum(ALERT_CATEGORY_IDS, "Unknown alert category"),
  on: z.boolean("on must be a boolean"),
});

/** One Tracker section's checkbox — same one-item-per-write shape as `alertCategorySchema`. */
export const trackerSectionSchema = z.object({
  section: z.enum(TRACKER_SECTION_KEYS, "Unknown Tracker section"),
  on: z.boolean("on must be a boolean"),
});

export type AlertCategoryInput = z.infer<typeof alertCategorySchema>;
export type TrackerSectionInput = z.infer<typeof trackerSectionSchema>;
