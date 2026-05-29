# Stock-Based Economy — PR 1: Pricing Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure, well-tested stock-based market-pricing engine (single stock value → spot price, integrated-slippage trade price, bid-ask spread) with zero changes to existing code or live-game behavior.

**Architecture:** Three brand-new files only. A constants module holds the elasticity and spread defaults. A pricing module exposes pure functions: `midPriceAt` (spot price from one `stock` value vs a `targetStock` anchor), `tradeAvgMidPrice` (averages the price curve over the stock range a trade moves — the slippage that kills the round-trip exploit), and `quoteTrade` (applies the bid-ask spread and produces an integer total). The legacy `calculatePrice` in `lib/engine/pricing.ts` is **not touched** — it has 24 callers, and the cutover to these new functions happens in PR 2. This PR is purely additive.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Test runner: `npx vitest run <path>`.

**Design reference:** `docs/planned/stock-based-market-economy.md` (sections 1–2).

---

## File Structure

- **Create** `lib/constants/market-economy.ts` — `DEFAULT_ELASTICITY`, `DEFAULT_SPREAD`. (New file; does not modify the existing `lib/constants/economy.ts`.)
- **Create** `lib/engine/market-pricing.ts` — `MarketCurve` interface + `midPriceAt`, `spotPrice`, `tradeAvgMidPrice`, `quoteTrade`, `TradeQuote`. Pure, no DB imports.
- **Create** `lib/engine/__tests__/market-pricing.test.ts` — full Vitest coverage including the exploit-dies and cross-system-profit assertions.

**Not in this PR** (deferred to PR 2/3): `lib/engine/trade.ts` validation/delta changes, `lib/services/trade.ts`, the schema migration, the economy/trade-flow processors, UI, and calibration of per-good `targetStock`. The functions here take `targetStock`, `k`, and `spread` as explicit parameters so they need no calibration to be testable.

---

## Conventions to follow (from CLAUDE.md)

- No `as` casts (except `as const`). No `unknown`. Type at boundaries.
- Engine functions are pure — no DB imports.
- Imports use the `@/` alias (e.g. `@/lib/constants/market-economy`).
- Keep functions small and single-purpose.

---

### Task 1: Spot price from a single stock value

**Files:**
- Create: `lib/constants/market-economy.ts`
- Create: `lib/engine/market-pricing.ts`
- Test: `lib/engine/__tests__/market-pricing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/market-pricing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { midPriceAt, spotPrice, type MarketCurve } from "../market-pricing";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts`
Expected: FAIL — `Failed to resolve import "../market-pricing"` (module does not exist yet).

- [ ] **Step 3: Create the constants module**

Create `lib/constants/market-economy.ts`:

```ts
/**
 * Constants for the stock-based market economy. See
 * docs/planned/stock-based-market-economy.md.
 */

/** Price-curve elasticity. k=1 reproduces the legacy demand/supply hyperbola. */
export const DEFAULT_ELASTICITY = 1;

/** Default bid-ask half-spread: buy = mid*(1+s), sell = mid*(1-s). */
export const DEFAULT_SPREAD = 0.05;
```

- [ ] **Step 4: Create the pricing module with `midPriceAt` + `spotPrice`**

Create `lib/engine/market-pricing.ts`:

```ts
import { DEFAULT_ELASTICITY } from "@/lib/constants/market-economy";

/**
 * A good's price curve at one station. Price is a function of a single
 * `stock` value relative to `targetStock` (the anchor where price ===
 * basePrice). See the stock-based market economy design spec.
 */
export interface MarketCurve {
  basePrice: number;
  /** Stock level where the mid price equals basePrice. */
  targetStock: number;
  /** Elasticity exponent. Defaults to DEFAULT_ELASTICITY (1). */
  k?: number;
  /** Minimum price as a multiple of basePrice (price ceiling on stock). */
  floorMult: number;
  /** Maximum price as a multiple of basePrice (price ceiling on price). */
  ceilingMult: number;
}

/**
 * Instantaneous (spot) mid price at a given stock level, clamped to the good's
 * floor/ceiling. Returns an UNROUNDED value so it can be summed without
 * compounding rounding error. Stock at/below zero returns the ceiling.
 *
 *   mid = basePrice * (targetStock / stock) ^ k
 */
export function midPriceAt(curve: MarketCurve, stock: number): number {
  const { basePrice, targetStock, floorMult, ceilingMult } = curve;
  const k = curve.k ?? DEFAULT_ELASTICITY;
  const min = floorMult * basePrice;
  const max = ceilingMult * basePrice;
  if (stock <= 0) return max;
  const raw = basePrice * (targetStock / stock) ** k;
  return Math.max(min, Math.min(max, raw));
}

/** Rounded spot price, for display. */
export function spotPrice(curve: MarketCurve, stock: number): number {
  return Math.round(midPriceAt(curve, stock));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts`
Expected: PASS — all `midPriceAt` and `spotPrice` tests green.

- [ ] **Step 6: Commit**

```bash
git add lib/constants/market-economy.ts lib/engine/market-pricing.ts lib/engine/__tests__/market-pricing.test.ts
git commit -m "feat(economy): stock-based spot pricing (midPriceAt)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Integrated-slippage trade price (`tradeAvgMidPrice`)

This is the core of the exploit fix: a trade of `q` units is priced as the average of the curve over the stock range it moves, not a flat snapshot. Each unit is priced at the **midpoint of the stock step it causes**, which makes a buy and an immediate sell-back walk the identical set of price points (perfect symmetry → no free round-trip).

**Files:**
- Modify: `lib/engine/market-pricing.ts` (add `tradeAvgMidPrice`)
- Test: `lib/engine/__tests__/market-pricing.test.ts` (add a `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `lib/engine/__tests__/market-pricing.test.ts`:

```ts
import { tradeAvgMidPrice } from "../market-pricing";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts`
Expected: FAIL — `tradeAvgMidPrice is not a function` / import has no such export.

- [ ] **Step 3: Add `tradeAvgMidPrice` to the pricing module**

Append to `lib/engine/market-pricing.ts`:

```ts
/**
 * Average mid price per unit for a trade of `quantity` units, integrating the
 * price curve over the stock range the trade moves (slippage). Each unit is
 * priced at the midpoint of the stock step it causes, so a buy and an immediate
 * sell-back traverse the identical price points — that symmetry is what makes
 * the round-trip exploit unprofitable.
 *
 *  - buy:  stock decreases; units priced at stock-0.5, stock-1.5, ...
 *  - sell: stock increases; units priced at stock+0.5, stock+1.5, ...
 */
export function tradeAvgMidPrice(
  curve: MarketCurve,
  stock: number,
  quantity: number,
  type: "buy" | "sell",
): number {
  if (quantity <= 0) return 0;
  let total = 0;
  for (let i = 0; i < quantity; i++) {
    const level = type === "buy" ? stock - i - 0.5 : stock + i + 0.5;
    total += midPriceAt(curve, level);
  }
  return total / quantity;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts`
Expected: PASS — including the symmetry test (the core exploit-fix property).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/market-pricing.ts lib/engine/__tests__/market-pricing.test.ts
git commit -m "feat(economy): integrated-slippage trade pricing (tradeAvgMidPrice)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Full quote with bid-ask spread (`quoteTrade`) + exploit/profit proofs

**Files:**
- Modify: `lib/engine/market-pricing.ts` (add `TradeQuote` + `quoteTrade`)
- Test: `lib/engine/__tests__/market-pricing.test.ts` (add a `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `lib/engine/__tests__/market-pricing.test.ts`:

```ts
import { quoteTrade } from "../market-pricing";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts`
Expected: FAIL — `quoteTrade is not a function` / no such export.

- [ ] **Step 3: Add `TradeQuote` + `quoteTrade`**

Append to `lib/engine/market-pricing.ts`:

```ts
export interface TradeQuote {
  /** Pre-spread average mid price per unit. */
  avgMidUnit: number;
  /** Post-spread average price per unit (buy: above mid, sell: below mid). */
  avgUnitPrice: number;
  /** Integer total the player pays (buy) or receives (sell). */
  totalPrice: number;
}

/**
 * Full price quote for a trade: integrated slippage (tradeAvgMidPrice) plus the
 * bid-ask spread. `spread` is the half-spread (e.g. 0.05). Only the grand total
 * is rounded, so per-unit rounding never compounds across the quantity.
 */
export function quoteTrade(
  curve: MarketCurve,
  stock: number,
  quantity: number,
  type: "buy" | "sell",
  spread: number,
): TradeQuote {
  const avgMidUnit = tradeAvgMidPrice(curve, stock, quantity, type);
  const spreadMult = type === "buy" ? 1 + spread : 1 - spread;
  const avgUnitPrice = avgMidUnit * spreadMult;
  const totalPrice = Math.round(avgUnitPrice * quantity);
  return { avgMidUnit, avgUnitPrice, totalPrice };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts`
Expected: PASS — including the exploit-dies (loss on round-trip) and profit-preserved (811) proofs.

- [ ] **Step 5: Run the full unit suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS — the existing `pricing.test.ts`, `trade.test.ts`, and all other suites are unaffected (this PR added files only).

- [ ] **Step 6: Commit**

```bash
git add lib/engine/market-pricing.ts lib/engine/__tests__/market-pricing.test.ts
git commit -m "feat(economy): trade quote with bid-ask spread (quoteTrade)

Closes the buy-out/dump-back exploit by construction: same-system
round-trips are a guaranteed loss while cross-system arbitrage is
preserved. Pure engine only; no live-game behavior change yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (spec §1–2):**
- §2 mid price `base × (target/stock)^k`, clamped, stock≤0 → ceiling → Task 1 (`midPriceAt`). ✅
- §2 elasticity `k` dial, default 1 → Task 1 (`k?` + `DEFAULT_ELASTICITY`). ✅
- §2 integrated slippage over the moved stock range → Task 2 (`tradeAvgMidPrice`, midpoint-per-unit). ✅
- §2 bid-ask spread `buy=mid×(1+s)`, `sell=mid×(1-s)` → Task 3 (`quoteTrade`). ✅
- §2 "exploit dies by construction" + cross-system profit preserved → Task 3 proof tests. ✅
- §1 single `stock` value, `targetStock` anchor, derived headroom → represented as function inputs; the stored-column/headroom-readout work is schema/UI and belongs to PR 2/3 (per spec §9), correctly out of scope here. ✅
- Per-good `floor`/`ceiling` multipliers → `MarketCurve.floorMult/ceilingMult` (sourced from existing `GoodDefinition.priceFloor/priceCeiling` when wired up in PR 2). ✅

**Placeholder scan:** No TBD/TODO; every code and test step contains complete, runnable content. ✅

**Type consistency:** `MarketCurve` (basePrice, targetStock, k?, floorMult, ceilingMult) is defined in Task 1 and used unchanged in Tasks 2–3. `tradeAvgMidPrice(curve, stock, quantity, type)` signature matches between definition (Task 2) and its use inside `quoteTrade` (Task 3). `TradeQuote` fields (`avgMidUnit`, `avgUnitPrice`, `totalPrice`) match between definition and tests. The `"buy" | "sell"` union is consistent throughout. ✅

**Scope:** Self-contained, additive, ships working+tested software (a pricing library) with no behavior change to the live game. ✅
