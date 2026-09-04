import { z } from "zod";

/** Whole levels an order adds — shared by every levelled order (build, lane upgrade). */
const levelsSchema = z
  .number("Levels is required")
  .int("Levels must be a whole number")
  .min(1, "Levels must be at least 1")
  .max(100, "Levels must be at most 100");

export const orderBuildSchema = z.object({
  buildingType: z.string().trim().min(1, "Building type is required").max(64),
  levels: levelsSchema,
});

export const orderLaneUpgradeSchema = z.object({
  laneKey: z.string().trim().min(1, "Lane key is required").max(128),
  levels: levelsSchema,
});

export const automationSchema = z.object({
  build: z.boolean("build must be a boolean"),
  colonisation: z.boolean("colonisation must be a boolean"),
  lanes: z.boolean("lanes must be a boolean"),
});

export type OrderBuildInput = z.infer<typeof orderBuildSchema>;
export type OrderLaneUpgradeInput = z.infer<typeof orderLaneUpgradeSchema>;
export type AutomationInput = z.infer<typeof automationSchema>;
