import { describe, it, expect } from "vitest";
import { midPriceAt, spotPrice, tradeAvgMidPrice, quoteTrade, type MarketCurve } from "../market-pricing";

// Wide clamp so the raw curve is visible (legacy-style 0.2x–5.0x).
const WIDE: MarketCurve = {
  basePrice: 100,
  targetStock: 20,
  k: 1,
  floorMult: 0.2,
  ceilingMult: 5.0,
};

// Tier-0-style narrow clamp (0.5x–2.0x) to exercise floor/ceiling.
const NARROW: MarketCurve = {
  basePrice: 100,
  targetStock: 20,
  k: 1,
  floorMult: 0.5,
  ceilingMult: 2.0,
};

describe("midPriceAt", () => {
  it("returns basePrice when stock equals targetStock", () => {
    expect(midPriceAt(WIDE, 20)).toBe(100);
  });

  it("is more expensive when stock is below target (shortage)", () => {
    expect(midPriceAt(WIDE, 10)).toBe(200); // 100 * 20/10
  });

  it("is cheaper when stock is above target (surplus)", () => {
    expect(midPriceAt(WIDE, 40)).toBe(50); // 100 * 20/40
  });

  it("clamps to the ceiling on severe shortage", () => {
    // raw 100 * 20/5 = 400, clamped to 2.0 * 100 = 200
    expect(midPriceAt(NARROW, 5)).toBe(200);
  });

  it("clamps to the floor on severe surplus", () => {
    // raw 100 * 20/80 = 25, clamped up to 0.5 * 100 = 50
    expect(midPriceAt(NARROW, 80)).toBe(50);
  });

  it("returns the ceiling when stock is zero or negative", () => {
    expect(midPriceAt(WIDE, 0)).toBe(500); // 5.0 * 100
    expect(midPriceAt(WIDE, -3)).toBe(500);
  });

  it("defaults k to 1 when omitted", () => {
    const noK: MarketCurve = { basePrice: 100, targetStock: 20, floorMult: 0.2, ceilingMult: 5.0 };
    expect(midPriceAt(noK, 10)).toBe(200);
  });

  it("softens the curve when k < 1", () => {
    // 100 * (20/10)^0.5 = 100 * 1.41421 = 141.42, gentler than k=1's 200
    const soft: MarketCurve = { ...WIDE, k: 0.5 };
    expect(midPriceAt(soft, 10)).toBeCloseTo(141.42, 1);
    expect(midPriceAt(soft, 10)).toBeLessThan(midPriceAt(WIDE, 10));
  });
});

describe("spotPrice", () => {
  it("rounds the mid price for display", () => {
    // 100 * 20/30 = 66.667 -> 67
    expect(spotPrice(WIDE, 30)).toBe(67);
  });
});

describe("tradeAvgMidPrice", () => {
  // WIDE curve (base 100, target 20, k 1, clamps 0.2x–5.0x) keeps the
  // 10.5–39.5 stock range fully on the raw curve (no clamping).
  const WIDE: MarketCurve = {
    basePrice: 100,
    targetStock: 20,
    k: 1,
    floorMult: 0.2,
    ceilingMult: 5.0,
  };

  it("returns 0 for non-positive quantity", () => {
    expect(tradeAvgMidPrice(WIDE, 20, 0, "buy")).toBe(0);
  });

  it("matches the spot price for a single unit (priced at the step midpoint)", () => {
    // Buying 1 unit moves stock 20 -> 19, priced at midpoint 19.5: 100*20/19.5
    expect(tradeAvgMidPrice(WIDE, 20, 1, "buy")).toBeCloseTo(102.564, 2);
  });

  it("buying averages ABOVE the starting spot price (price rises as you buy)", () => {
    const avg = tradeAvgMidPrice(WIDE, 20, 10, "buy");
    expect(avg).toBeGreaterThan(midPriceAt(WIDE, 20)); // > 100
    expect(avg).toBeCloseTo(138.57, 1); // ~ integral 100*20*ln(20/10)/10 = 138.6
  });

  it("selling averages BELOW the starting spot price (price falls as you sell)", () => {
    // Selling 10 into a shortage at stock 10 moves stock 10 -> 20.
    const avg = tradeAvgMidPrice(WIDE, 10, 10, "sell");
    expect(avg).toBeLessThan(midPriceAt(WIDE, 10)); // < 200
    expect(avg).toBeCloseTo(138.57, 1);
  });

  it("buy q from S and sell q back from S-q are perfectly symmetric", () => {
    // The exploit fix: same stock segment traversed both ways -> identical avg.
    const buyAvg = tradeAvgMidPrice(WIDE, 20, 10, "buy"); // 20 -> 10
    const sellAvg = tradeAvgMidPrice(WIDE, 10, 10, "sell"); // 10 -> 20
    expect(sellAvg).toBeCloseTo(buyAvg, 6);
  });

  it("sell from stock 0 prices the first unit at level 0.5 (raw curve), not the stock<=0 ceiling", () => {
    // Reachable state: a station emptied to 0 stock, player sells into it.
    // High ceiling so level 0.5 stays on the raw curve instead of clamping.
    const HIGH: MarketCurve = { basePrice: 100, targetStock: 20, k: 1, floorMult: 0.2, ceilingMult: 50 };
    // The single unit sells at level 0 + 0.5 = 0.5: raw 100 * 20/0.5 = 4000.
    expect(tradeAvgMidPrice(HIGH, 0, 1, "sell")).toBeCloseTo(4000, 6);
    // Distinct from the stock<=0 branch, which returns the ceiling (50 * 100 = 5000).
    expect(midPriceAt(HIGH, 0)).toBe(5000);
  });

  it("clamps each unit so draining toward zero cannot exceed the ceiling", () => {
    const NARROW: MarketCurve = {
      basePrice: 100,
      targetStock: 20,
      k: 1,
      floorMult: 0.5,
      ceilingMult: 2.0, // ceiling price = 200
    };
    // Buying 8 from stock 8 walks levels 7.5..0.5; deep levels clamp to 200.
    const avg = tradeAvgMidPrice(NARROW, 8, 8, "buy");
    expect(avg).toBeLessThanOrEqual(200);
    expect(avg).toBeGreaterThan(100);
  });
});

describe("quoteTrade", () => {
  const WIDE: MarketCurve = {
    basePrice: 100,
    targetStock: 20,
    k: 1,
    floorMult: 0.2,
    ceilingMult: 5.0,
  };

  it("applies the spread above mid on a buy and rounds only the total", () => {
    // avgMid ~138.567; buy unit *1.05 -> ~145.495; total = round(*10) = 1455
    const q = quoteTrade(WIDE, 20, 10, "buy", 0.05);
    expect(q.avgMidUnit).toBeCloseTo(138.57, 1);
    expect(q.avgUnitPrice).toBeCloseTo(145.5, 0);
    expect(q.totalPrice).toBe(1455);
  });

  it("applies the spread below mid on a sell", () => {
    // avgMid ~138.567; sell unit *0.95 -> ~131.639; total = round(*10) = 1316
    const q = quoteTrade(WIDE, 10, 10, "sell", 0.05);
    expect(q.avgUnitPrice).toBeCloseTo(131.6, 0);
    expect(q.totalPrice).toBe(1316);
  });

  it("KILLS the same-system round-trip: buying then selling back is a loss", () => {
    const buy = quoteTrade(WIDE, 20, 10, "buy", 0.05); // pay
    const sellBack = quoteTrade(WIDE, 10, 10, "sell", 0.05); // receive, stock now 10
    expect(sellBack.totalPrice).toBeLessThan(buy.totalPrice); // 1316 < 1455
  });

  it("PRESERVES cross-system arbitrage: buy at a surplus, sell at a shortage", () => {
    // Spread 0 isolates the geographic gap. Buy 10 at surplus stock 40,
    // sell 10 at shortage stock 10.
    const buyA = quoteTrade(WIDE, 40, 10, "buy", 0); // avg ~57.53 -> 575
    const sellB = quoteTrade(WIDE, 10, 10, "sell", 0); // avg ~138.57 -> 1386
    expect(buyA.totalPrice).toBe(575);
    expect(sellB.totalPrice).toBe(1386);
    expect(sellB.totalPrice - buyA.totalPrice).toBe(811); // healthy profit
  });
});
