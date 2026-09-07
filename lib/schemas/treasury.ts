import { z } from "zod";
import { TREASURY } from "@/lib/constants/treasury";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

// Literal enum (Zod needs a tuple); the schema test pins it to ALL_TAX_LEVELS
// so the two can never drift.
const taxLevelSchema = z.enum(["very_low", "low", "normal", "high", "very_high"]);

// Derived from the constant tuple, not retyped — the schema test pins the accepted set to
// STOCKPILE_SCALE_STEPS so the two can never drift.
const stockpileScaleSchema = z.literal([...DIRECTED_LOGISTICS.STOCKPILE_SCALE_STEPS]);

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
    stockpileScale: stockpileScaleSchema.optional(),
  })
  .refine(
    (v) => v.taxLevel !== undefined || v.bands !== undefined || v.stockpileScale !== undefined,
    { message: "Provide taxLevel, bands, and/or stockpileScale." },
  );

export type TreasuryPolicyInput = z.infer<typeof treasuryPolicySchema>;
