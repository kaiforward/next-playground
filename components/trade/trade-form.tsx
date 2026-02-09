"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { MarketEntry, TradeType } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { formatCredits } from "@/lib/utils/format";

const tradeSchema = z.object({
  quantity: z
    .number({ error: "Quantity must be a number" })
    .int({ message: "Quantity must be a whole number" })
    .min(1, "Minimum quantity is 1"),
});

type TradeFormData = z.infer<typeof tradeSchema>;

interface TradeFormProps {
  good: MarketEntry;
  playerCredits: number;
  cargoUsed: number;
  cargoMax: number;
  currentCargoQuantity: number;
  shipName?: string;
  onTrade: (request: { goodId: string; quantity: number; type: TradeType }) => Promise<void>;
}

export function TradeForm({
  good,
  playerCredits,
  cargoUsed,
  cargoMax,
  currentCargoQuantity,
  shipName,
  onTrade,
}: TradeFormProps) {
  const [tradeType, setTradeType] = useState<TradeType>("buy");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm<TradeFormData>({
    resolver: zodResolver(tradeSchema),
    defaultValues: { quantity: 1 },
  });

  const quantity = watch("quantity") || 0;
  const totalCost = quantity * good.currentPrice;
  const cargoSpaceAvailable = cargoMax - cargoUsed;

  const maxBuyByCredits = Math.floor(playerCredits / good.currentPrice);
  const maxBuyByCargo = cargoSpaceAvailable;
  const maxBuy = Math.min(maxBuyByCredits, maxBuyByCargo, good.supply);
  const maxSell = currentCargoQuantity;

  function getValidationError(): string | null {
    if (tradeType === "buy") {
      if (totalCost > playerCredits) {
        return `Not enough credits. You need ${formatCredits(totalCost)} but only have ${formatCredits(playerCredits)}.`;
      }
      if (quantity > cargoSpaceAvailable) {
        return `Not enough cargo space. You have ${cargoSpaceAvailable} units free.`;
      }
      if (quantity > good.supply) {
        return `Not enough supply. Only ${good.supply} units available.`;
      }
    } else {
      if (quantity > currentCargoQuantity) {
        return `You only have ${currentCargoQuantity} units of ${good.goodName} to sell.`;
      }
    }
    return null;
  }

  const validationError = getValidationError();

  async function onSubmit(data: TradeFormData) {
    if (validationError) return;
    setIsSubmitting(true);
    try {
      await onTrade({
        goodId: good.goodId,
        quantity: data.quantity,
        type: tradeType,
      });
      reset({ quantity: 1 });
    } catch {
      // Error handling is done by the parent component
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title={`Trade ${good.goodName}`}
        subtitle={shipName ? `Ship: ${shipName} · ${formatCredits(good.currentPrice)}/unit` : `Unit price: ${formatCredits(good.currentPrice)}`}
      />
      <CardContent>
        {/* Buy / Sell tabs */}
        <div className="flex mb-4 rounded-lg overflow-hidden border border-white/10">
          <button
            type="button"
            onClick={() => setTradeType("buy")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tradeType === "buy"
                ? "bg-green-500/20 text-green-300"
                : "bg-white/5 text-white/50 hover:text-white/80"
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setTradeType("sell")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tradeType === "sell"
                ? "bg-red-500/20 text-red-300"
                : "bg-white/5 text-white/50 hover:text-white/80"
            }`}
          >
            Sell
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Quantity input */}
          <div>
            <label
              htmlFor="quantity"
              className="block text-xs font-medium text-white/50 uppercase tracking-wider mb-1"
            >
              Quantity
            </label>
            <input
              id="quantity"
              type="number"
              min={1}
              max={tradeType === "buy" ? maxBuy : maxSell}
              {...register("quantity", { valueAsNumber: true })}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            {errors.quantity && (
              <p className="mt-1 text-xs text-red-400">
                {errors.quantity.message}
              </p>
            )}
            <p className="mt-1 text-xs text-white/40">
              {tradeType === "buy"
                ? `Max: ${maxBuy} (credits: ${maxBuyByCredits}, cargo: ${maxBuyByCargo}, supply: ${good.supply})`
                : `Max: ${maxSell} in cargo`}
            </p>
          </div>

          {/* Preview */}
          <div className="rounded-lg bg-white/5 p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Unit Price</span>
              <span className="text-white">
                {formatCredits(good.currentPrice)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Quantity</span>
              <span className="text-white">{quantity}</span>
            </div>
            <div className="border-t border-white/10 pt-1 flex justify-between text-sm font-semibold">
              <span className="text-white/70">
                {tradeType === "buy" ? "Total Cost" : "Total Revenue"}
              </span>
              <span
                className={
                  tradeType === "buy" ? "text-red-300" : "text-green-300"
                }
              >
                {formatCredits(totalCost)}
              </span>
            </div>
          </div>

          {/* Validation error */}
          {validationError && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              {validationError}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting || !!validationError}
            className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              tradeType === "buy"
                ? "bg-green-600 hover:bg-green-500 text-white"
                : "bg-red-600 hover:bg-red-500 text-white"
            }`}
          >
            {isSubmitting
              ? "Processing..."
              : tradeType === "buy"
                ? `Buy ${good.goodName}`
                : `Sell ${good.goodName}`}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
