import { z } from "zod";
import { formatCredits } from "@/lib/utils/format";
import type { TradeType } from "@/lib/types/game";

export interface TradeSchemaContext {
  tradeType: TradeType;
  unitPrice: number;
  playerCredits: number;
  cargoSpaceAvailable: number;
  supply: number;
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
        if (quantity > ctx.supply) {
          refineCtx.addIssue({
            code: "custom",
            path: ["quantity"],
            message: `Not enough supply. Only ${ctx.supply} units available.`,
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
