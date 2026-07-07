import { z } from "zod";
import { sanitizeSaveName } from "@/lib/world/save";

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
 * `saves/.json` — reject it here at the boundary instead.
 */
export const saveGameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Save name is required")
    .max(40, "Save name must be at most 40 characters")
    .refine((name) => sanitizeSaveName(name).length > 0, {
      message: "Save name must contain at least one letter or number",
    }),
});

export const loadGameSchema = z.object({
  name: z.string().min(1, "Save name is required"),
});

export type NewGameInput = z.infer<typeof newGameSchema>;
export type SpeedInput = z.infer<typeof speedSchema>;
export type SaveGameInput = z.infer<typeof saveGameSchema>;
export type LoadGameInput = z.infer<typeof loadGameSchema>;
