import { z } from "zod";

/** The most whole levels one order may add. Exported so a control that steps `levels` can bound
 *  itself at the same number the schema rejects past, rather than letting the player build an order
 *  the command will refuse. */
export const MAX_ORDER_LEVELS = 100;

/** Whole levels an order adds — shared by every levelled order (build, lane upgrade). */
const levelsSchema = z
  .number("Levels is required")
  .int("Levels must be a whole number")
  .min(1, "Levels must be at least 1")
  .max(MAX_ORDER_LEVELS, `Levels must be at most ${MAX_ORDER_LEVELS}`);

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
