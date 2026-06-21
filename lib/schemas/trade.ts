import { z } from "zod";
import { formatCredits } from "@/lib/utils/format";
import type { TradeType } from "@/lib/types/game";

export interface TradeSchemaContext {
  tradeType: TradeType;
  /** Per-unit price for the active side (buyPrice or sellPrice). */
  unitPrice: number;
  playerCredits: number;
  cargoSpaceAvailable: number;
  /** Max units buyable from current stock (floor(stock - band.minStock)) — uses the per-market band reserve. */
  maxBuyable: number;
  currentCargoQuantity: number;
}

export function createTradeSchema(ctx: TradeSchemaContext) {
  return z
    .object({
      quantity: z
        .number({ error: "Quantity must be a number" })
        .int({ message: "Quantity must be a whole number" })
        .min(1, "Minimum quantity is 1"),
    })
    .superRefine((data, refineCtx) => {
      const { quantity } = data;

      if (ctx.tradeType === "buy") {
        const totalCost = quantity * ctx.unitPrice;
        if (totalCost > ctx.playerCredits) {
          refineCtx.addIssue({
            code: "custom",
            path: ["quantity"],
            message: `Not enough credits. You need ${formatCredits(totalCost)} but only have ${formatCredits(ctx.playerCredits)}.`,
          });
          return;
        }
        if (quantity > ctx.cargoSpaceAvailable) {
          refineCtx.addIssue({
            code: "custom",
            path: ["quantity"],
            message: `Not enough cargo space. You have ${ctx.cargoSpaceAvailable} units free.`,
          });
          return;
        }
        if (quantity > ctx.maxBuyable) {
          refineCtx.addIssue({
            code: "custom",
            path: ["quantity"],
            message: `Only ${ctx.maxBuyable} units available to buy.`,
          });
          return;
        }
      } else {
        if (quantity > ctx.currentCargoQuantity) {
          refineCtx.addIssue({
            code: "custom",
            path: ["quantity"],
            message: `You only have ${ctx.currentCargoQuantity} units to sell.`,
          });
          return;
        }
      }
    });
}

export type TradeFormData = z.infer<ReturnType<typeof createTradeSchema>>;
