import { z } from "zod";

export const orderBuildSchema = z.object({
  buildingType: z.string().trim().min(1, "Building type is required").max(64),
  levels: z
    .number("Levels is required")
    .int("Levels must be a whole number")
    .min(1, "Levels must be at least 1")
    .max(100, "Levels must be at most 100"),
});

export const automationSchema = z.object({
  build: z.boolean("build must be a boolean"),
  colonisation: z.boolean("colonisation must be a boolean"),
});

export type OrderBuildInput = z.infer<typeof orderBuildSchema>;
export type AutomationInput = z.infer<typeof automationSchema>;
