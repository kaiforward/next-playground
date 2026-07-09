import { describe, it, expect } from "vitest";
import { buildMarketEntry, curveForGoodRow } from "@/lib/services/market-entry";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { TARGET_COVER } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";

// "food" is a producer-cheap good; its DB row mirrors the GOODS constant.
const FOOD = {
  name: GOODS.food.name,
  basePrice: GOODS.food.basePrice,
  priceFloor: GOODS.food.priceFloor,
  priceCeiling: GOODS.food.priceCeiling,
};

describe("curveForGoodRow", () => {
  it("resolves the canonical good key and a per-system reference curve", () => {
    const { goodKey, curve } = curveForGoodRow(FOOD, 7);
    expect(goodKey).toBe("food");
    expect(curve).toEqual(
      curveForGood(FOOD.basePrice, FOOD.priceFloor, FOOD.priceCeiling, 7),
    );
    expect(curve.targetStock).toBe(TARGET_COVER * 7);
  });

  it("falls back to the raw name when no key mapping exists", () => {
    const { goodKey } = curveForGoodRow({ ...FOOD, name: "Not A Real Good" }, 7);
    expect(goodKey).toBe("Not A Real Good");
  });

  it("scales the reference by anchorMult (anchorMult=2 doubles it)", () => {
    const base = curveForGoodRow(FOOD, 7);
    const shifted = curveForGoodRow(FOOD, 7, 2);
    expect(shifted.curve.targetStock).toBe(base.curve.targetStock * 2);
  });
});

describe("buildMarketEntry", () => {
  const stock = 140;
  const demandRate = 2;
  const curve = curveForGood(FOOD.basePrice, FOOD.priceFloor, FOOD.priceCeiling, demandRate);

  it("builds the derived spot entry (no buy/sell/spread fields)", () => {
    const entry = buildMarketEntry("good-1", FOOD, stock, demandRate);

    expect(entry.goodId).toBe("good-1");
    expect(entry.goodName).toBe(FOOD.name);
    expect(entry.basePrice).toBe(FOOD.basePrice);
    expect(entry.currentPrice).toBe(spotPrice(curve, stock));
    expect(entry.stock).toBe(stock);
    // The trading fields are gone — the entry is the spot readout only.
    expect(entry).not.toHaveProperty("buyPrice");
    expect(entry).not.toHaveProperty("sellPrice");
    expect(entry).not.toHaveProperty("spread");
  });

  it("floors stock so the player never sees fractional goods", () => {
    const entry = buildMarketEntry("good-1", FOOD, 140.9, demandRate);
    expect(entry.stock).toBe(140);
  });

  it("anchorMult raises currentPrice at a stock level unclamped for both anchors", () => {
    // food: basePrice=30, floor=0.5×=15, ceiling=2×=60; reference =
    // TARGET_COVER×demandRate = 40×2 = 80. At stock=130 (above 80, below 160):
    //   anchorMult=1 → 30*(80/130)  ≈ 18.5 → 18 (above floor ✓)
    //   anchorMult=2 → 30*(160/130) ≈ 36.9 → 37 (below ceiling ✓)
    const testStock = 130;
    const base = buildMarketEntry("good-1", FOOD, testStock, demandRate);
    const shifted = buildMarketEntry("good-1", FOOD, testStock, demandRate, 2);
    expect(shifted.currentPrice).toBeGreaterThan(base.currentPrice);
  });

  it("default (no anchorMult arg) equals passing anchorMult=1 explicitly", () => {
    const entry = buildMarketEntry("good-1", FOOD, stock, demandRate);
    const explicit = buildMarketEntry("good-1", FOOD, stock, demandRate, 1);
    expect(entry.currentPrice).toBe(explicit.currentPrice);
  });
});
