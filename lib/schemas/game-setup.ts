import { z } from "zod";
import { sanitizeSaveName, AUTOSAVE_NAME } from "@/lib/world/save";

export const newGameSchema = z.object({
  systemCount: z
    .number("System count is required")
    .int("System count must be a whole number")
    .min(50, "System count must be at least 50")
    .max(20000, "System count must be at most 20,000"),
  seed: z.number("Seed must be a number").int("Seed must be a whole number").optional(),
});

export const speedSchema = z.object({
  speed: z.union([z.literal("paused"), z.literal(1), z.literal(5), z.literal("max")], {
    error: 'Speed must be one of "paused", 1, 5, "max".',
  }),
});

/**
 * Save names are sanitized to `[a-z0-9-_]` on disk (`sanitizeSaveName`), so a
 * name that sanitizes to nothing (e.g. "???") would silently collide on
 * `saves/.json` — reject it here at the boundary instead. Shared by the save
 * and load schemas so both apply the same length + sanitize constraints.
 */
const saveName = z
  .string()
  .trim()
  .min(1, "Save name is required")
  .max(40, "Save name must be at most 40 characters")
  .refine((name) => sanitizeSaveName(name).length > 0, {
    message: "Save name must contain at least one letter or number",
  });

export const saveGameSchema = z.object({
  // A player-typed name that sanitizes to the reserved autosave slot would
  // silently clobber (and be clobbered by) the ambient autosave — reject it.
  name: saveName.refine((name) => sanitizeSaveName(name) !== AUTOSAVE_NAME, {
    message: `"${AUTOSAVE_NAME}" is a reserved save name`,
  }),
});

export const loadGameSchema = z.object({ name: saveName });

export type NewGameInput = z.infer<typeof newGameSchema>;
export type SpeedInput = z.infer<typeof speedSchema>;
export type SaveGameInput = z.infer<typeof saveGameSchema>;
export type LoadGameInput = z.infer<typeof loadGameSchema>;
