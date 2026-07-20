import { z } from "zod";
import { TREASURY } from "@/lib/constants/treasury";

// Literal enum (Zod needs a tuple); the schema test pins it to ALL_TAX_LEVELS
// so the two can never drift.
const taxLevelSchema = z.enum(["very_low", "low", "normal", "high", "very_high"]);

const fraction = (min: number) =>
  z
    .number("Band funding must be a number")
    .min(min, `Band funding must be at least ${min}`)
    .max(1, "Band funding must be at most 1");

export const treasuryPolicySchema = z
  .object({
    taxLevel: taxLevelSchema.optional(),
    bands: z
      .object({
        maintenance: fraction(TREASURY.MAINTENANCE_SLIDER_FLOOR),
        logistics: fraction(0),
        construction: fraction(0),
      })
      .optional(),
  })
  .refine((v) => v.taxLevel !== undefined || v.bands !== undefined, {
    message: "Provide taxLevel and/or bands.",
  });

export type TreasuryPolicyInput = z.infer<typeof treasuryPolicySchema>;
