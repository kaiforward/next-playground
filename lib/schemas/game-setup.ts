import { z } from "zod";

export const newGameSchema = z.object({
  systemCount: z
    .number()
    .int("System count must be a whole number")
    .min(50, "System count must be at least 50")
    .max(20000, "System count must be at most 20,000"),
  seed: z.number().int("Seed must be a whole number").optional(),
});

export const speedSchema = z.object({
  speed: z.union([z.literal("paused"), z.literal(1), z.literal(5), z.literal("max")]),
});

export type NewGameInput = z.infer<typeof newGameSchema>;
export type SpeedInput = z.infer<typeof speedSchema>;
