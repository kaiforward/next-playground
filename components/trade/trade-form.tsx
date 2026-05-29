"use client";

import { useState, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { MarketEntry, TradeType } from "@/lib/types/game";
import { quoteTrade, type MarketCurve } from "@/lib/engine/market-pricing";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { formatCredits } from "@/lib/utils/format";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
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

  // Active per-unit price: buy uses buyPrice, sell uses sellPrice (the spread).
  const unitPrice = tradeType === "buy" ? good.buyPrice : good.sellPrice;
  const cargoSpaceAvailable = cargoMax - cargoUsed;
  const maxBuyable = Math.max(0, Math.floor(good.stock) - ECONOMY_CONSTANTS.MIN_LEVEL);

  const maxBuyByCredits = Math.floor(playerCredits / Math.max(1, good.buyPrice));
  const maxBuy = Math.min(maxBuyByCredits, cargoSpaceAvailable, maxBuyable);
  const maxSell = currentCargoQuantity;

  const schemaCtx = useMemo(
    () => ({
      tradeType,
      unitPrice,
      playerCredits,
      cargoSpaceAvailable,
      maxBuyable,
      currentCargoQuantity,
    }),
    [tradeType, unitPrice, playerCredits, cargoSpaceAvailable, maxBuyable, currentCargoQuantity]
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

  // Reproduce the server's price curve so the total reflects integrated
  // slippage (each unit priced at the midpoint of the stock step it moves) plus
  // the bid-ask spread — identical math to executeTrade's quoteTrade call.
  // Reputation multipliers are applied server-side and not shown here yet.
  const curve = useMemo<MarketCurve>(
    () => ({
      basePrice: good.basePrice,
      targetStock: good.targetStock,
      floorMult: good.priceFloor,
      ceilingMult: good.priceCeiling,
    }),
    [good.basePrice, good.targetStock, good.priceFloor, good.priceCeiling],
  );

  // Integrated total for the whole order (NOT quantity × unit price — that flat
  // form hid slippage). Falls back to 0 for an empty/invalid quantity.
  const totalCost = useMemo(
    () =>
      quantity > 0
        ? quoteTrade(curve, good.stock, quantity, tradeType, good.spread).totalPrice
        : 0,
    [curve, good.stock, good.spread, quantity, tradeType],
  );

  // Effective average per unit (includes slippage); for q=1 this equals the spot
  // unit price. Shown so the player sees the marginal cost of bulk orders.
  const avgUnitPrice = quantity > 0 ? Math.round(totalCost / quantity) : unitPrice;

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
        subtitle={shipName ? `Ship: ${shipName} · ${formatCredits(unitPrice)}/unit` : `Unit price: ${formatCredits(unitPrice)}`}
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
                ? `Max: ${maxBuy} (credits: ${maxBuyByCredits}, cargo: ${cargoSpaceAvailable}, stock: ${maxBuyable})`
                : `Max: ${maxSell} in cargo`
            }
            {...register("quantity", { valueAsNumber: true })}
          />

          {/* Preview */}
          <div className="rounded-lg bg-surface p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-text-tertiary">Spot / unit</span>
              <span className="text-text-primary">
                {formatCredits(unitPrice)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-tertiary">Quantity</span>
              <span className="text-text-primary">{quantity}</span>
            </div>
            {quantity > 1 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-tertiary">Avg / unit (slippage)</span>
                <span className="text-text-primary">
                  {formatCredits(avgUnitPrice)}
                </span>
              </div>
            )}
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
