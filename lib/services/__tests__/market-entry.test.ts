import { describe, it, expect } from "vitest";
import { buildMarketEntry, curveForGoodRow } from "@/lib/services/market-entry";
import {
  spotPrice,
  quoteTrade,
  curveForGood,
} from "@/lib/engine/market-pricing";
import {
  getSpread,
  getTargetStock,
  DEFAULT_SPREAD,
} from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";

// "food" is a producer-cheap good; its DB row mirrors the GOODS constant.
const FOOD = {
  name: GOODS.food.name,
  basePrice: GOODS.food.basePrice,
  priceFloor: GOODS.food.priceFloor,
  priceCeiling: GOODS.food.priceCeiling,
};

describe("curveForGoodRow", () => {
  it("resolves the canonical good key and a curve anchored at the good's targetStock", () => {
    const { goodKey, curve } = curveForGoodRow(FOOD);
    expect(goodKey).toBe("food");
    expect(curve).toEqual(
      curveForGood("food", FOOD.basePrice, FOOD.priceFloor, FOOD.priceCeiling),
    );
    expect(curve.targetStock).toBe(getTargetStock("food"));
  });

  it("falls back to the raw name when no key mapping exists", () => {
    const { goodKey } = curveForGoodRow({ ...FOOD, name: "Not A Real Good" });
    expect(goodKey).toBe("Not A Real Good");
  });

  it("scales targetStock by anchorMult (anchorMult=2 doubles targetStock)", () => {
    const base = curveForGoodRow(FOOD);
    const shifted = curveForGoodRow(FOOD, 2);
    expect(shifted.curve.targetStock).toBe(base.curve.targetStock * 2);
  });
});

describe("buildMarketEntry", () => {
  const stock = 140;
  const curve = curveForGood(
    "food",
    FOOD.basePrice,
    FOOD.priceFloor,
    FOOD.priceCeiling,
  );

  it("prices a single buy/sell unit off the default spread when no government is given", () => {
    const entry = buildMarketEntry("good-1", FOOD, stock);
    const spread = DEFAULT_SPREAD;

    expect(entry.goodId).toBe("good-1");
    expect(entry.goodName).toBe(FOOD.name);
    expect(entry.basePrice).toBe(FOOD.basePrice);
    expect(entry.currentPrice).toBe(spotPrice(curve, stock));
    expect(entry.buyPrice).toBe(quoteTrade(curve, stock, 1, "buy", spread).totalPrice);
    expect(entry.sellPrice).toBe(quoteTrade(curve, stock, 1, "sell", spread).totalPrice);

    // Curve inputs exposed for client-side quote previews.
    expect(entry.priceFloor).toBe(FOOD.priceFloor);
    expect(entry.priceCeiling).toBe(FOOD.priceCeiling);
    expect(entry.targetStock).toBe(curve.targetStock);
    expect(entry.spread).toBe(spread);
  });

  it("applies the government bid-ask spread (non-default path)", () => {
    // frontier widens the spread (+20%); authoritarian tightens it (−15%).
    const gov = GOVERNMENT_TYPES.frontier;
    const spread = getSpread(gov);
    expect(spread).not.toBe(DEFAULT_SPREAD); // guards against silent no-op

    const entry = buildMarketEntry("good-1", FOOD, stock, gov);
    expect(entry.buyPrice).toBe(quoteTrade(curve, stock, 1, "buy", spread).totalPrice);
    expect(entry.sellPrice).toBe(quoteTrade(curve, stock, 1, "sell", spread).totalPrice);

    // Wider spread ⇒ buy no lower / sell no higher than the default-spread
    // quote. (>= / <= rather than strict, since a single cheap unit can tie
    // after integer rounding — the exact-pin assertions above are the real
    // guard; this only catches a spread inversion.)
    const defaultEntry = buildMarketEntry("good-1", FOOD, stock);
    expect(entry.buyPrice).toBeGreaterThanOrEqual(defaultEntry.buyPrice);
    expect(entry.sellPrice).toBeLessThanOrEqual(defaultEntry.sellPrice);
  });

  it("floors stock so the player never sees fractional goods", () => {
    const entry = buildMarketEntry("good-1", FOOD, 140.9);
    expect(entry.stock).toBe(140);
  });

  it("anchorMult raises currentPrice at a stock level that is unclamped for both anchors", () => {
    // food: basePrice=30, floor=0.5×=15, ceiling=2×=60, targetStock=101.
    // At stock=130 (above targetStock=101, below 2×targetStock=202):
    //   anchorMult=1 → 30*(101/130)^1 ≈ 23.3 → rounds to 23 (above floor ✓)
    //   anchorMult=2 → 30*(202/130)^1 ≈ 46.6 → rounds to 47 (below ceiling ✓)
    // Both are unclamped, so the shift is clearly visible in the output price.
    const testStock = 130;
    const base = buildMarketEntry("good-1", FOOD, testStock);
    const shifted = buildMarketEntry("good-1", FOOD, testStock, undefined, 2);
    expect(shifted.currentPrice).toBeGreaterThan(base.currentPrice);
  });

  it("default (no anchorMult arg) equals passing anchorMult=1 explicitly", () => {
    const entry = buildMarketEntry("good-1", FOOD, stock);
    const explicit = buildMarketEntry("good-1", FOOD, stock, undefined, 1);
    expect(entry.currentPrice).toBe(explicit.currentPrice);
    expect(entry.buyPrice).toBe(explicit.buyPrice);
    expect(entry.sellPrice).toBe(explicit.sellPrice);
  });
});
