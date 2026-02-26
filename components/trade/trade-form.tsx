"use client";

import { useState, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { MarketEntry, TradeType } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { formatCredits } from "@/lib/utils/format";
import { TabList, Tab } from "@/components/ui/tabs";
import {
  createTradeSchema,
  type TradeFormData,
} from "@/lib/schemas/trade";

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

  const cargoSpaceAvailable = cargoMax - cargoUsed;

  const maxBuyByCredits = Math.floor(playerCredits / good.currentPrice);
  const maxBuyByCargo = cargoSpaceAvailable;
  const maxBuy = Math.min(maxBuyByCredits, maxBuyByCargo, good.supply);
  const maxSell = currentCargoQuantity;

  const schemaCtx = useMemo(
    () => ({
      tradeType,
      unitPrice: good.currentPrice,
      playerCredits,
      cargoSpaceAvailable,
      supply: good.supply,
      currentCargoQuantity,
    }),
    [tradeType, good.currentPrice, playerCredits, cargoSpaceAvailable, good.supply, currentCargoQuantity]
  );

  const schema = useMemo(() => createTradeSchema(schemaCtx), [schemaCtx]);
  const resolver = useMemo(() => zodResolver(schema), [schema]);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    formState: { errors, isValid },
    reset,
  } = useForm<TradeFormData>({
    resolver,
    defaultValues: { quantity: 1 },
    mode: "onChange",
  });

  // Re-validate when context changes (e.g. tradeType toggle)
  useEffect(() => {
    trigger("quantity");
  }, [schema, trigger]);

  const quantity = watch("quantity") || 0;
  const totalCost = quantity * good.currentPrice;

  async function onSubmit(data: TradeFormData) {
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
        <TabList variant="pill" className="mb-4">
          <Tab
            variant="pill"
            activeColor="green"
            active={tradeType === "buy"}
            onClick={() => setTradeType("buy")}
          >
            Buy
          </Tab>
          <Tab
            variant="pill"
            activeColor="red"
            active={tradeType === "sell"}
            onClick={() => setTradeType("sell")}
          >
            Sell
          </Tab>
        </TabList>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <NumberInput
            id="quantity"
            label="Quantity"
            min={1}
            max={tradeType === "buy" ? maxBuy : maxSell}
            error={errors.quantity?.message}
            hint={
              tradeType === "buy"
                ? `Max: ${maxBuy} (credits: ${maxBuyByCredits}, cargo: ${maxBuyByCargo}, supply: ${good.supply})`
                : `Max: ${maxSell} in cargo`
            }
            {...register("quantity", { valueAsNumber: true })}
          />

          {/* Preview */}
          <div className="rounded-lg bg-surface p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-text-tertiary">Unit Price</span>
              <span className="text-white">
                {formatCredits(good.currentPrice)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-tertiary">Quantity</span>
              <span className="text-white">{quantity}</span>
            </div>
            <div className="border-t border-border pt-1 flex justify-between text-sm font-semibold">
              <span className="text-text-secondary">
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

          {/* Submit */}
          <Button
            type="submit"
            disabled={isSubmitting || !isValid}
            variant="action"
            color={tradeType === "buy" ? "green" : "red"}
            fullWidth
          >
            {isSubmitting
              ? "Processing..."
              : tradeType === "buy"
                ? `Buy ${good.goodName}`
                : `Sell ${good.goodName}`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
