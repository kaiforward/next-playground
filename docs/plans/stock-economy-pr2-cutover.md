# Stock-Based Economy — PR 2: Schema + Services + Processors Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual `supply`/`demand` market model with a single `stock` value end-to-end — schema, seed, engine, services, both tick processors, the simulator, and the market UI — wiring up PR 1's `quoteTrade`/`spotPrice` so the buy-out/dump-back exploit dies by construction in the live game.

**Architecture:** One `stock` column per `(station, good)`. Price is derived from `stock` vs a per-good `targetStock` anchor via PR 1's `MarketCurve` (`mid = basePrice × (targetStock/stock)^k`, clamped). Player/convoy/mission trades and the trade-flow simulator move a single `stockDelta`; the economy tick becomes `stock += production − consumption` (sqrt self-limiting, no mean-reversion, no `demand`). `targetStock`/initial-stock are **mechanically derived** from the existing per-good equilibrium band (calibration is PR 3). The UI moves to stock language now (In Stock / Buy / Sell), so **PR 3 shrinks to calibration + docs**.

**Tech Stack:** Next.js 16, TypeScript 5 (strict), Prisma 7 + PostgreSQL (driver adapter), Vitest 4. Test runner: `npx vitest run <path>`. Schema push: `npx prisma db push` (regenerates the client).

**Design reference:** `docs/planned/stock-based-market-economy.md` (all sections). PR 1 shipped the pure pricing core in `lib/engine/market-pricing.ts` + `lib/constants/market-economy.ts`.

---

## Conventions to follow (from CLAUDE.md)

- No `as` casts (except `as const` / guards in `lib/types/guards.ts`). No `unknown`. Type at boundaries, trust downstream.
- Engine functions are pure — no DB imports. Services own all DB access. Processors split into world interface + Prisma adapter + memory adapter + pure body; live and sim share the body.
- Prisma singleton `lib/prisma.ts`; client from `@/app/generated/prisma/client`. Bulk writes via `unnest()` (see existing adapters). Re-read state inside `$transaction` before writing (TOCTOU); use `{ set }` when a clamp is needed, `{ increment }` for pure atomic adds.
- `Record` keys come from union types/constants, never `Record<string, ...>` for domain maps.

## Build-order note (read before starting)

This is a column rename across ~35 files; there is **no way to keep `npx tsc --noEmit` green between every commit**. The order below front-loads the **pure-engine work (Groups A–C), which stays green**, then makes the **breaking schema change (Group D)**, after which the tree is red until the consumer cutover (Groups E–I) completes. Run `npx tsc --noEmit` at each **group boundary** (not every task) to track remaining breakage, and the full `npx vitest run` + `npm run simulate` at the end (Group J). Commit after each task regardless — transient red on the shared `feat/stock-based-economy` branch is expected and fine.

## File Structure

**Modified — engine (pure):** `lib/engine/trade.ts`, `lib/engine/tick.ts`, `lib/engine/market-tick-builder.ts`, `lib/engine/snapshot.ts`, `lib/engine/market-pricing.ts` (+ `lib/constants/market-economy.ts`). **Deleted:** `lib/engine/pricing.ts` + `lib/engine/__tests__/pricing.test.ts`.

**Modified — schema/seed:** `prisma/schema.prisma`, `prisma/seed.ts`.

**Modified — processors:** `lib/tick/world/economy-world.ts`, `lib/tick/adapters/{prisma,memory}/economy.ts`, `lib/tick/processors/economy.ts`; `lib/tick/world/trade-flow-world.ts`, `lib/tick/adapters/{prisma,memory}/trade-flow.ts`, `lib/tick/processors/trade-flow.ts`; `lib/tick/adapters/prisma/trade-missions.ts`; `lib/tick/adapters/prisma/snapshots.ts`.

**Modified — services:** `lib/services/{trade,convoy-trade,market,market-comparison,missions,cantina,dev-tools}.ts`.

**Modified — simulator:** `lib/engine/simulator/{types,bot,world,market-analysis,event-analysis,experiment}.ts`, `lib/engine/simulator/strategies/helpers.ts`.

**Modified — types/UI:** `lib/types/game.ts`, `lib/types/api.ts`, `lib/schemas/trade.ts`, `lib/trade/mock-data.ts`, `components/trade/market-table.tsx`, `components/trade/trade-form.tsx`, `components/market/market-comparison-panel.tsx`, `app/(game)/@panel/system/[systemId]/market/page.tsx`. **Renamed:** `components/trade/supply-demand-chart.tsx` → `components/trade/stock-chart.tsx`.

**Modified — tests:** `lib/engine/__tests__/snapshot.test.ts` and the integration suites under `lib/services/__tests__/integration/` + `lib/tick/processors/__tests__/integration/` that assert on supply/demand.

---

# GROUP A — Stock pricing foundation (additive, stays green)

### Task A1: Stock-derivation constants (`targetStock`, bounds, spread)

**Files:**
- Modify: `lib/constants/market-economy.ts`
- Test: `lib/constants/__tests__/market-economy.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/constants/__tests__/market-economy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  STOCK_MIN,
  STOCK_MAX,
  getTargetStock,
  getInitialStock,
  getSpread,
} from "../market-economy";
import { GOVERNMENT_TYPES } from "../government";

describe("stock bounds", () => {
  it("reuses the legacy supply band", () => {
    expect(STOCK_MIN).toBe(5);
    expect(STOCK_MAX).toBe(200);
  });
});

describe("getTargetStock", () => {
  it("is the midpoint of the good's producer and consumer supply targets", () => {
    // water: produces.supply 160, consumes.supply 110 -> round((160+110)/2)=135
    expect(getTargetStock("water")).toBe(135);
    // luxuries: 38, 24 -> 31
    expect(getTargetStock("luxuries")).toBe(31);
  });

  it("falls back to the mid stock band for unknown goods", () => {
    expect(getTargetStock("not_a_good")).toBe(Math.round((STOCK_MIN + STOCK_MAX) / 2));
  });
});

describe("getInitialStock", () => {
  it("seeds producers high (above target -> cheap)", () => {
    // agricultural produces food (produces.supply 155)
    expect(getInitialStock("agricultural", "food")).toBe(155);
    expect(getInitialStock("agricultural", "food")).toBeGreaterThan(getTargetStock("food"));
  });

  it("seeds consumers below target (-> expensive), blended by self-sufficiency", () => {
    // tech consumes food (self-sufficiency 0.15) -> between consumes.supply(110) and produces.supply(155)
    const stock = getInitialStock("tech", "food");
    expect(stock).toBeLessThan(getTargetStock("food"));
    expect(stock).toBeGreaterThanOrEqual(110);
  });

  it("seeds neutral goods at the target (-> price == base)", () => {
    // a good the economy neither produces nor consumes resolves to targetStock
    expect(getInitialStock("agricultural", "weapons")).toBe(getTargetStock("weapons"));
  });
});

describe("getSpread", () => {
  it("returns the default half-spread with no government", () => {
    expect(getSpread()).toBe(0.05);
  });

  it("widens for frontier and tightens for authoritarian", () => {
    const frontier = getSpread(GOVERNMENT_TYPES.frontier); // +20% -> 0.06
    const auth = getSpread(GOVERNMENT_TYPES.authoritarian); // -15% -> 0.0425
    expect(frontier).toBeCloseTo(0.06, 5);
    expect(auth).toBeCloseTo(0.0425, 5);
    expect(frontier).toBeGreaterThan(auth);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/constants/__tests__/market-economy.test.ts`
Expected: FAIL — `getTargetStock`/`getInitialStock`/`getSpread`/`STOCK_MIN`/`STOCK_MAX` are not exported.

- [ ] **Step 3: Add the helpers to `lib/constants/market-economy.ts`**

Replace the entire contents of `lib/constants/market-economy.ts` with:

```ts
/**
 * Constants for the stock-based market economy. See
 * docs/planned/stock-based-market-economy.md.
 */

import { ECONOMY_CONSTANTS, getConsumeEquilibrium } from "@/lib/constants/economy";
import { GOODS } from "@/lib/constants/goods";
import { getProducedGoods, getConsumedGoods } from "@/lib/constants/universe";
import type { GovernmentDefinition } from "@/lib/constants/government";
import type { EconomyType } from "@/lib/types/game";

/** Price-curve elasticity. k=1 reproduces the legacy demand/supply hyperbola. */
export const DEFAULT_ELASTICITY = 1;

/** Default bid-ask half-spread: buy = mid*(1+s), sell = mid*(1-s). */
export const DEFAULT_SPREAD = 0.05;

/** Global stock bounds — reuse the legacy supply floor/ceiling. */
export const STOCK_MIN = ECONOMY_CONSTANTS.MIN_LEVEL;
export const STOCK_MAX = ECONOMY_CONSTANTS.MAX_LEVEL;

/**
 * Pricing anchor: the stock level where the mid price equals basePrice.
 *
 * PR 2 derives this mechanically from the legacy per-good supply band — the
 * midpoint of the producer and consumer supply targets — so producers (seeded
 * high) read cheap and consumers (seeded low) read expensive. PR 3 replaces
 * this with calibrated per-good values.
 */
export function getTargetStock(goodId: string): number {
  const eq = GOODS[goodId]?.equilibrium;
  if (!eq) return Math.round((STOCK_MIN + STOCK_MAX) / 2);
  return Math.round((eq.produces.supply + eq.consumes.supply) / 2);
}

/**
 * Initial stock for a market at seed/reset time, by the system's relationship
 * to the good. Producers start above target (cheap), consumers below (expensive,
 * blended by self-sufficiency), neutrals at target (price == base).
 */
export function getInitialStock(economyType: EconomyType, goodId: string): number {
  const eq = GOODS[goodId]?.equilibrium;
  if (!eq) return getTargetStock(goodId);
  if (getProducedGoods(economyType).includes(goodId)) return eq.produces.supply;
  if (getConsumedGoods(economyType).includes(goodId)) {
    return getConsumeEquilibrium(economyType, goodId, eq).supply;
  }
  return getTargetStock(goodId);
}

/**
 * Bid-ask half-spread scaled by government margin policy. Repurposes the
 * government's `equilibriumSpreadPct` (frontier wide, authoritarian tight) to
 * scale the market spread now that the dual supply/demand band is gone.
 */
export function getSpread(govDef?: GovernmentDefinition): number {
  if (!govDef) return DEFAULT_SPREAD;
  return Math.max(0, DEFAULT_SPREAD * (1 + govDef.equilibriumSpreadPct / 100));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/constants/__tests__/market-economy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/market-economy.ts lib/constants/__tests__/market-economy.test.ts
git commit -m "feat(economy): stock targets, bounds, and government spread helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: `curveForGood` — build a MarketCurve from a good

**Files:**
- Modify: `lib/engine/market-pricing.ts` (add `curveForGood`)
- Test: `lib/engine/__tests__/market-pricing.test.ts` (append a `describe`)

- [ ] **Step 1: Write the failing test**

Append to `lib/engine/__tests__/market-pricing.test.ts`:

```ts
import { curveForGood } from "../market-pricing";
import { getTargetStock } from "@/lib/constants/market-economy";

describe("curveForGood", () => {
  it("assembles a MarketCurve from good fields + derived targetStock", () => {
    const curve = curveForGood("water", 25, 0.5, 2.0);
    expect(curve).toEqual({
      basePrice: 25,
      targetStock: getTargetStock("water"), // 135
      k: 1,
      floorMult: 0.5,
      ceilingMult: 2.0,
    });
  });

  it("prices at base when stock equals the derived target", () => {
    const curve = curveForGood("water", 25, 0.5, 2.0);
    expect(midPriceAt(curve, getTargetStock("water"))).toBe(25);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts`
Expected: FAIL — `curveForGood is not a function`.

- [ ] **Step 3: Add `curveForGood` to `lib/engine/market-pricing.ts`**

Change the import line at the top of `lib/engine/market-pricing.ts` from:

```ts
import { DEFAULT_ELASTICITY } from "@/lib/constants/market-economy";
```

to:

```ts
import { DEFAULT_ELASTICITY, getTargetStock } from "@/lib/constants/market-economy";
```

Then append to the end of the file:

```ts
/**
 * Build a MarketCurve for a good from its DB/definition fields. `targetStock`
 * is derived (PR 2) / calibrated (PR 3) in lib/constants/market-economy.ts; the
 * float floor/ceiling multipliers come straight off the good.
 */
export function curveForGood(
  goodId: string,
  basePrice: number,
  floorMult: number,
  ceilingMult: number,
): MarketCurve {
  return {
    basePrice,
    targetStock: getTargetStock(goodId),
    k: DEFAULT_ELASTICITY,
    floorMult,
    ceilingMult,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts`
Expected: PASS — full PR 1 suite + the new curve tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/market-pricing.ts lib/engine/__tests__/market-pricing.test.ts
git commit -m "feat(economy): curveForGood helper to build a MarketCurve from a good

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# GROUP B — Trade engine rewrite (pure, stays green)

### Task B1: Single-`stock` trade validation + delta

Replaces dual `supplyDelta`/`demandDelta` with one `stockDelta`, caps buys at `floor(stock − MIN)` (reserve) and sells at `floor(MAX − stock)` (warehouse capacity), and takes a precomputed `totalPrice` (the service computes it via `quoteTrade` so slippage is honored).

**Files:**
- Modify: `lib/engine/trade.ts` (full rewrite)
- Test: `lib/engine/__tests__/trade.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `lib/engine/__tests__/trade.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { validateAndCalculateTrade, validateFleetTrade, type TradeParams } from "../trade";

const BUY_BASE: TradeParams = {
  type: "buy",
  quantity: 10,
  totalPrice: 1000,
  playerCredits: 5000,
  currentCargoUsed: 0,
  cargoMax: 100,
  currentStock: 100,
  stockMin: 5,
  stockMax: 200,
  currentGoodQuantityInCargo: 0,
};

describe("validateAndCalculateTrade — buy", () => {
  it("produces a negative-credit, +cargo, -stock delta", () => {
    const res = validateAndCalculateTrade(BUY_BASE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.delta).toEqual({
      creditsDelta: -1000,
      cargoQuantityDelta: 10,
      stockDelta: -10,
      totalPrice: 1000,
    });
  });

  it("rejects when the player cannot afford the total", () => {
    const res = validateAndCalculateTrade({ ...BUY_BASE, playerCredits: 999 });
    expect(res.ok).toBe(false);
  });

  it("rejects when cargo space is insufficient", () => {
    const res = validateAndCalculateTrade({ ...BUY_BASE, currentCargoUsed: 95 });
    expect(res.ok).toBe(false);
  });

  it("caps the buy at floor(stock - stockMin) — the market keeps a reserve", () => {
    // stock 12, min 5 -> at most 7 buyable; asking 10 fails
    const res = validateAndCalculateTrade({ ...BUY_BASE, currentStock: 12, quantity: 10 });
    expect(res.ok).toBe(false);
    const ok = validateAndCalculateTrade({ ...BUY_BASE, currentStock: 12, quantity: 7 });
    expect(ok.ok).toBe(true);
  });
});

describe("validateAndCalculateTrade — sell", () => {
  const SELL_BASE: TradeParams = {
    type: "sell",
    quantity: 10,
    totalPrice: 800,
    playerCredits: 0,
    currentCargoUsed: 10,
    cargoMax: 100,
    currentStock: 100,
    stockMin: 5,
    stockMax: 200,
    currentGoodQuantityInCargo: 10,
  };

  it("produces a positive-credit, -cargo, +stock delta", () => {
    const res = validateAndCalculateTrade(SELL_BASE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.delta).toEqual({
      creditsDelta: 800,
      cargoQuantityDelta: -10,
      stockDelta: 10,
      totalPrice: 800,
    });
  });

  it("rejects selling more than is in cargo", () => {
    const res = validateAndCalculateTrade({ ...SELL_BASE, currentGoodQuantityInCargo: 4 });
    expect(res.ok).toBe(false);
  });

  it("caps the sell at floor(stockMax - stock) — can't sell into a full warehouse", () => {
    // stock 195, max 200 -> at most 5 absorbable; asking 10 fails
    const res = validateAndCalculateTrade({
      ...SELL_BASE,
      currentStock: 195,
      currentGoodQuantityInCargo: 10,
      quantity: 10,
    });
    expect(res.ok).toBe(false);
    const ok = validateAndCalculateTrade({
      ...SELL_BASE,
      currentStock: 195,
      currentGoodQuantityInCargo: 10,
      quantity: 5,
    });
    expect(ok.ok).toBe(true);
  });
});

describe("validateFleetTrade", () => {
  it("rejects a non-docked ship before any market checks", () => {
    const res = validateFleetTrade({ ...BUY_BASE, shipStatus: "in_transit" });
    expect(res.ok).toBe(false);
  });

  it("delegates to validateAndCalculateTrade when docked", () => {
    const res = validateFleetTrade({ ...BUY_BASE, shipStatus: "docked" });
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/trade.test.ts`
Expected: FAIL — `TradeParams` no longer has `currentStock`/`stockMin`/etc.; deltas use `stockDelta`.

- [ ] **Step 3: Rewrite `lib/engine/trade.ts`**

Replace the entire contents of `lib/engine/trade.ts` with:

```ts
/**
 * Pure trade validation and calculation engine.
 * No database dependency — operates entirely on passed-in values.
 *
 * Stock model: a trade moves a single `stockDelta` (buy: -qty, sell: +qty).
 * Buys are capped at floor(stock - stockMin) (the market keeps a reserve);
 * sells at floor(stockMax - stock) (can't sell into a full warehouse). The
 * `totalPrice` is computed by the caller via quoteTrade (integrated slippage +
 * spread), so this engine never sees a flat per-unit price.
 */

import type { ShipStatus } from "../types/game";

export interface TradeDelta {
  creditsDelta: number; // positive = player gains credits (sell), negative = player spends (buy)
  cargoQuantityDelta: number; // positive = player gains cargo (buy), negative = player loses (sell)
  stockDelta: number; // negative = stock removed (buy), positive = stock added (sell)
  totalPrice: number; // absolute price of the trade
}

export interface TradeParams {
  type: "buy" | "sell";
  quantity: number;
  /** Precomputed total (quoteTrade.totalPrice, after spread + any rep multiplier). */
  totalPrice: number;
  playerCredits: number;
  currentCargoUsed: number;
  cargoMax: number;
  currentStock: number;
  stockMin: number;
  stockMax: number;
  currentGoodQuantityInCargo: number;
}

export type TradeValidationResult =
  | { ok: true; delta: TradeDelta }
  | { ok: false; error: string };

export function validateAndCalculateTrade(
  params: TradeParams,
): TradeValidationResult {
  const {
    type,
    quantity,
    totalPrice,
    playerCredits,
    currentCargoUsed,
    cargoMax,
    currentStock,
    stockMin,
    stockMax,
    currentGoodQuantityInCargo,
  } = params;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "Quantity must be a positive integer." };
  }

  if (type === "buy") {
    if (totalPrice > playerCredits) {
      return {
        ok: false,
        error: `Not enough credits. Need ${totalPrice}, have ${playerCredits}.`,
      };
    }

    if (currentCargoUsed + quantity > cargoMax) {
      return {
        ok: false,
        error: `Not enough cargo space. Need ${quantity} slots, have ${cargoMax - currentCargoUsed} available.`,
      };
    }

    const available = Math.floor(currentStock - stockMin);
    if (quantity > available) {
      return {
        ok: false,
        error: `Not enough available to buy. Requested ${quantity}, available ${Math.max(0, available)}.`,
      };
    }

    return {
      ok: true,
      delta: {
        creditsDelta: -totalPrice,
        cargoQuantityDelta: quantity,
        stockDelta: -quantity,
        totalPrice,
      },
    };
  }

  // type === "sell"
  if (quantity > currentGoodQuantityInCargo) {
    return {
      ok: false,
      error: `Not enough in cargo. Want to sell ${quantity}, have ${currentGoodQuantityInCargo}.`,
    };
  }

  const capacity = Math.floor(stockMax - currentStock);
  if (quantity > capacity) {
    return {
      ok: false,
      error: `The market can't absorb that much. Sellable ${Math.max(0, capacity)}.`,
    };
  }

  return {
    ok: true,
    delta: {
      creditsDelta: totalPrice,
      cargoQuantityDelta: -quantity,
      stockDelta: quantity,
      totalPrice,
    },
  };
}

// ── Fleet-aware trade validation ────────────────────────────────

export interface FleetTradeParams extends TradeParams {
  shipStatus: ShipStatus;
}

export function validateFleetTrade(
  params: FleetTradeParams,
): TradeValidationResult {
  const { shipStatus, ...tradeParams } = params;

  if (shipStatus !== "docked") {
    return { ok: false, error: "Ship must be docked to trade." };
  }

  return validateAndCalculateTrade(tradeParams);
}
```

> **Note:** `TRADE_DEMAND_IMPACT_FACTOR` is intentionally removed — the trade-flow processor (Task F3) drops its only other use.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/trade.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/trade.ts lib/engine/__tests__/trade.test.ts
git commit -m "feat(economy): single-stock trade validation (stockDelta, reserve/capacity caps)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# GROUP C — Economy tick rewrite (pure, stays green)

### Task C1: `simulateEconomyTick` → single-stock production/consumption

Drops mean-reversion, equilibrium targets, and the `demand` axis. The tick is now `stock += production·prodScale − consumption·consScale + noise`, clamped to `[MIN, MAX]`. `selfLimitingFactor` is unchanged (it already operates on a single value vs `[min,max]`). Event modifiers contribute only `productionMult`/`consumptionMult`.

**Files:**
- Modify: `lib/engine/tick.ts`
- Test: `lib/engine/__tests__/tick.test.ts` (rewrite the economy-sim describe blocks; leave prosperity/ship-arrival tests intact)

- [ ] **Step 1: Rewrite the economy-tick tests**

In `lib/engine/__tests__/tick.test.ts`, replace every `describe` block that exercises `simulateEconomyTick`/`buildMarketTickEntry` (the supply/demand/equilibrium ones) with the following. **Keep** the existing `updateProsperity`, `getProsperityMultiplier`, `getProsperityLabel`, and `processShipArrivals` tests unchanged.

```ts
import { describe, it, expect } from "vitest";
import {
  simulateEconomyTick,
  buildMarketTickEntry,
  type MarketTickEntry,
  type EconomySimParams,
  type ProsperityParams,
} from "../tick";

const PARAMS: EconomySimParams = {
  noiseAmplitude: 0, // deterministic: no noise unless a test opts in
  minLevel: 5,
  maxLevel: 200,
};

function entry(over: Partial<MarketTickEntry>): MarketTickEntry {
  return {
    goodId: "food",
    stock: 100,
    economyType: "agricultural",
    produces: [],
    consumes: [],
    ...over,
  };
}

describe("simulateEconomyTick — production", () => {
  it("raises stock for a producer, self-limiting near the ceiling", () => {
    const mid = simulateEconomyTick([entry({ produces: ["food"], productionRate: 10, stock: 100 })], PARAMS);
    expect(mid[0].stock).toBeGreaterThan(100);
    const high = simulateEconomyTick([entry({ produces: ["food"], productionRate: 10, stock: 199 })], PARAMS);
    expect(high[0].stock - 199).toBeLessThan(mid[0].stock - 100); // slows near MAX
    expect(high[0].stock).toBeLessThanOrEqual(200); // clamped
  });

  it("does nothing for a good the system does not produce", () => {
    const out = simulateEconomyTick([entry({ produces: ["water"], productionRate: 10, stock: 100 })], PARAMS);
    expect(out[0].stock).toBe(100);
  });

  it("applies event production multipliers", () => {
    const base = simulateEconomyTick([entry({ produces: ["food"], productionRate: 10, stock: 100 })], PARAMS);
    const boosted = simulateEconomyTick([entry({ produces: ["food"], productionRate: 10, productionMult: 2, stock: 100 })], PARAMS);
    expect(boosted[0].stock - 100).toBeGreaterThan(base[0].stock - 100);
  });
});

describe("simulateEconomyTick — consumption", () => {
  it("lowers stock for a consumer, self-limiting near the floor", () => {
    const mid = simulateEconomyTick([entry({ consumes: ["food"], consumptionRate: 10, stock: 100 })], PARAMS);
    expect(mid[0].stock).toBeLessThan(100);
    const low = simulateEconomyTick([entry({ consumes: ["food"], consumptionRate: 10, stock: 6 })], PARAMS);
    expect(low[0].stock).toBeGreaterThanOrEqual(5); // clamped at MIN
  });
});

describe("simulateEconomyTick — noise", () => {
  it("perturbs stock within the band when amplitude > 0", () => {
    const out = simulateEconomyTick(
      [entry({ stock: 100, volatility: 1 })],
      { ...PARAMS, noiseAmplitude: 3 },
      () => 1, // rng=1 -> +full amplitude
    );
    expect(out[0].stock).toBeGreaterThan(100);
    expect(out[0].stock).toBeLessThanOrEqual(200);
  });

  it("does not mutate the input array", () => {
    const input = [entry({ produces: ["food"], productionRate: 10 })];
    const snapshot = input[0].stock;
    simulateEconomyTick(input, PARAMS);
    expect(input[0].stock).toBe(snapshot);
  });
});

describe("buildMarketTickEntry", () => {
  const prosperityParams: ProsperityParams = {
    decayRate: 0.03, maxGain: 0.1, targetVolume: 50,
    min: -1, max: 1, multAtMin: 0.3, multAtZero: 0.7, multAtMax: 1.3,
  };

  it("scales production and consumption by the prosperity multiplier", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        economyType: "agricultural",
        produces: ["food"],
        consumes: [],
        volatility: 1,
        baseProductionRate: 10,
        baseConsumptionRate: undefined,
        govConsumptionBoost: 0,
        traits: [],
        prosperity: 1, // multAtMax = 1.3
      },
      prosperityParams,
    );
    expect(e.productionRate).toBeCloseTo(13, 5); // 10 * 1.3
    expect(e.stock).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts`
Expected: FAIL — `MarketTickEntry` has no `stock`; `EconomySimParams` shape changed.

- [ ] **Step 3: Rewrite the economy-sim section of `lib/engine/tick.ts`**

In `lib/engine/tick.ts`, replace everything from the file header comment through the end of `simulateEconomyTick` (i.e. the `MarketTickEntry`/`EconomySimParams`/`getEquilibrium`/`driftValue`/`selfLimitingFactor`/`simulateEconomyTick` block, original lines 1–164) with:

```ts
/**
 * Economy simulation tick engine — single-stock model.
 *
 * Each market holds one `stock` value. Producers add stock (self-limiting near
 * the ceiling), consumers drain it (self-limiting near the floor), then noise is
 * applied and the value is clamped to [minLevel, maxLevel]. There is no
 * mean-reversion and no `demand` axis — equilibrium emerges spatially via the
 * trade-flow processor. See docs/planned/stock-based-market-economy.md §3.
 *
 * All functions are pure — no DB or constant imports.
 */

import { clamp } from "@/lib/utils/math";
import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import { computeTraitProductionBonus } from "@/lib/engine/trait-gen";

export interface MarketTickEntry {
  goodId: string;
  stock: number;
  economyType: string;
  produces: string[];
  consumes: string[];
  /** Per-good base production rate (undefined/0 = not a producer of this good). */
  productionRate?: number;
  /** Per-good base consumption rate (undefined/0 = not a consumer of this good). */
  consumptionRate?: number;
  /** Multiplier on production rate from events. Default 1.0. */
  productionMult?: number;
  /** Multiplier on consumption rate from events. Default 1.0. */
  consumptionMult?: number;
  /** Per-good volatility multiplier on noise amplitude. Default 1.0. */
  volatility?: number;
}

export interface EconomySimParams {
  noiseAmplitude: number;
  minLevel: number;
  maxLevel: number;
}

/**
 * Self-limiting scale factor (sqrt curve). Returns 0 at the boundary and 1 at
 * the opposite extreme; sqrt keeps rates active through mid-range and only drops
 * sharply near the extremes.
 */
function selfLimitingFactor(
  value: number,
  min: number,
  max: number,
  direction: "produce" | "consume",
): number {
  const range = max - min;
  if (range <= 0) return 0;
  const ratio =
    direction === "produce"
      ? (max - value) / range // production slows as stock approaches the ceiling
      : (value - min) / range; // consumption slows as stock approaches the floor
  return Math.sqrt(Math.max(0, Math.min(1, ratio)));
}

/**
 * Simulate one economy tick across all market entries.
 *
 * For each entry: apply self-limiting production (if a producer), self-limiting
 * consumption (if a consumer), then noise, then clamp to [minLevel, maxLevel].
 * Accepts an optional RNG for deterministic testing. Returns a new array.
 */
export function simulateEconomyTick(
  markets: MarketTickEntry[],
  params: EconomySimParams,
  rng: () => number = Math.random,
): MarketTickEntry[] {
  const { noiseAmplitude, minLevel, maxLevel } = params;

  return markets.map((entry) => {
    let stock = entry.stock;

    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0 && entry.produces.includes(entry.goodId)) {
      stock += effectiveProduction * selfLimitingFactor(stock, minLevel, maxLevel, "produce");
    }

    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0 && entry.consumes.includes(entry.goodId)) {
      stock -= effectiveConsumption * selfLimitingFactor(stock, minLevel, maxLevel, "consume");
    }

    const noise = (rng() * 2 - 1) * noiseAmplitude * (entry.volatility ?? 1);
    stock = clamp(stock + noise, minLevel, maxLevel);

    return { ...entry, stock };
  });
}
```

- [ ] **Step 4: Rewrite `buildMarketTickEntry` + `TickEntryInput` in `lib/engine/tick.ts`**

In the same file, replace the `TickEntryInput` interface and `buildMarketTickEntry` function (original lines 168–245) with:

```ts
/**
 * Pre-resolved inputs for building a MarketTickEntry. Callers resolve
 * data-source-specific values (DB vs SimWorld) into this common shape; the
 * builder handles shared computation (trait bonus, gov consumption boost,
 * prosperity scaling).
 */
export interface TickEntryInput {
  goodId: string;
  stock: number;
  economyType: string;
  produces: string[];
  consumes: string[];
  /** Volatility after government scaling. */
  volatility: number;
  /** Base production rate from economy type (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate from economy type (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Government consumption boost for this good. */
  govConsumptionBoost: number;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
  /** System prosperity value. */
  prosperity: number;
}

/**
 * Build a MarketTickEntry from pre-resolved inputs. Computes the trait
 * production bonus, folds the government consumption boost into the consumption
 * rate, and applies the prosperity multiplier equally to both rates. Callers
 * spread event productionMult/consumptionMult on top if present.
 */
export function buildMarketTickEntry(
  input: TickEntryInput,
  prosperityParams: ProsperityParams,
): MarketTickEntry {
  const prosperityMult = getProsperityMultiplier(input.prosperity, prosperityParams);

  const traitBonus = computeTraitProductionBonus(input.traits, input.goodId);
  const productionBeforeProsperity =
    input.baseProductionRate != null ? input.baseProductionRate * (1 + traitBonus) : undefined;

  const consumptionBeforeProsperity =
    input.baseConsumptionRate != null
      ? input.baseConsumptionRate + input.govConsumptionBoost
      : input.govConsumptionBoost > 0
        ? input.govConsumptionBoost
        : undefined;

  return {
    goodId: input.goodId,
    stock: input.stock,
    economyType: input.economyType,
    produces: input.produces,
    consumes: input.consumes,
    productionRate:
      productionBeforeProsperity != null ? productionBeforeProsperity * prosperityMult : undefined,
    consumptionRate:
      consumptionBeforeProsperity != null ? consumptionBeforeProsperity * prosperityMult : undefined,
    volatility: input.volatility,
  };
}
```

> The `ProsperityParams`/`updateProsperity`/`getProsperityMultiplier`/`getProsperityLabel`/`processShipArrivals` sections that follow are unchanged.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts`
Expected: PASS (economy + prosperity + ship-arrival tests).

- [ ] **Step 6: Commit**

```bash
git add lib/engine/tick.ts lib/engine/__tests__/tick.test.ts
git commit -m "feat(economy): single-stock economy tick (no mean-reversion, no demand)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: `resolveMarketTickEntry` (shared builder) → stock

**Files:**
- Modify: `lib/engine/market-tick-builder.ts`

- [ ] **Step 1: Rewrite `lib/engine/market-tick-builder.ts`**

Replace the entire contents with:

```ts
/**
 * Shared market tick entry builder.
 *
 * Both the live economy processor and the simulator build MarketTickEntry
 * objects through the same pipeline: good constants → government volatility
 * scaling → trait bonus → prosperity → event production/consumption modifiers.
 * (The legacy equilibrium-spread / self-sufficiency steps are gone — there is
 * no equilibrium target in the stock model.)
 */

import { GOODS } from "@/lib/constants/goods";
import { type GovernmentDefinition } from "@/lib/constants/government";
import { aggregateModifiers, type ModifierRow } from "@/lib/engine/events";
import { buildMarketTickEntry, type MarketTickEntry, type ProsperityParams } from "@/lib/engine/tick";
import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import type { EconomyType } from "@/lib/types/game";

/** Data-source-agnostic input for building a market tick entry. */
export interface MarketTickInput {
  goodId: string;
  stock: number;
  economyType: EconomyType;
  /** List of good IDs this system produces. */
  produces: string[];
  /** List of good IDs this system consumes. */
  consumes: string[];
  /** Base production rate for this good at this economy type (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate for this good at this economy type (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Government definition for the system's owning faction (undefined if none). */
  govDef?: GovernmentDefinition;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
  /** System prosperity value. */
  prosperity: number;
  /** Active economy modifiers for this system (already filtered). */
  modifiers: ModifierRow[];
  /** Modifier caps from constants. */
  modifierCaps: {
    minTargetMult: number;
    maxTargetMult: number;
    minMultiplier: number;
    maxMultiplier: number;
    minReversionMult: number;
  };
}

/**
 * Build a complete MarketTickEntry from data-source-agnostic inputs. Used by
 * both the live economy processor and the simulator so the tick logic is
 * identical.
 */
export function resolveMarketTickEntry(
  input: MarketTickInput,
  prosperityParams: ProsperityParams,
): MarketTickEntry {
  const goodDef = GOODS[input.goodId];

  // Government scales volatility (amplifies/dampens noise).
  const baseVolatility = goodDef?.volatility ?? 1;
  const volatility = input.govDef
    ? baseVolatility * input.govDef.volatilityModifier
    : baseVolatility;

  const entry = buildMarketTickEntry(
    {
      goodId: input.goodId,
      stock: input.stock,
      economyType: input.economyType,
      produces: input.produces,
      consumes: input.consumes,
      volatility,
      baseProductionRate: input.baseProductionRate,
      baseConsumptionRate: input.baseConsumptionRate,
      govConsumptionBoost: input.govDef?.consumptionBoosts[input.goodId] ?? 0,
      traits: input.traits,
      prosperity: input.prosperity,
    },
    prosperityParams,
  );

  if (input.modifiers.length === 0) return entry;

  // Only production/consumption multipliers affect the stock tick. The legacy
  // supply_target/demand_target/reversion_dampening modifiers have no analogue
  // in the single-stock model and are intentionally not applied (see spec §6);
  // events still shape the economy via rate multipliers and (future) stock shocks.
  const agg = aggregateModifiers(input.modifiers, input.goodId, input.modifierCaps);
  return {
    ...entry,
    productionMult: agg.productionMult,
    consumptionMult: agg.consumptionMult,
  };
}
```

> `aggregateModifiers` and `MODIFIER_CAPS` are unchanged — they still produce the full struct; we simply read two fields. Keep `aggregateModifiers`' signature as-is.

- [ ] **Step 2: Commit**

```bash
git add lib/engine/market-tick-builder.ts
git commit -m "refactor(economy): shared tick builder drops equilibrium, keeps rate modifiers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Group C boundary — these are pure modules; `tick.ts`/`market-tick-builder.ts` typecheck against each other. Their downstream consumers (economy processor + adapters + simulator) are cut over in Group E.

---

# GROUP D — Schema + seed (⚠️ breaking change starts here)

### Task D1: Migrate `StationMarket` to a single `stock` column

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Edit the model**

In `prisma/schema.prisma`, replace the two columns in `model StationMarket`:

```prisma
  supply    Float
  demand    Float
```

with:

```prisma
  stock     Float
```

- [ ] **Step 2: Push the schema (regenerates the Prisma client)**

Run: `npx prisma db push`
Expected: schema applied; `app/generated/prisma/client` regenerated so `StationMarket` now has `stock` and no `supply`/`demand`. **The project will not typecheck again until Group I completes** — this is expected.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(economy)!: StationMarket supply/demand -> single stock column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task D2: Seed initial stock

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Update the market-creation block**

In `prisma/seed.ts`, replace the per-good market creation block (the one computing `target` from `getConsumeEquilibrium`/`EQUILIBRIUM_TARGETS` and calling `prisma.stationMarket.create` with `supply`/`demand`) with:

```ts
    for (const [goodKey, goodRec] of Object.entries(goodRecords)) {
      await prisma.stationMarket.create({
        data: {
          stationId,
          goodId: goodRec.id,
          stock: getInitialStock(econ, goodKey),
        },
      });
    }
```

- [ ] **Step 2: Fix imports in `prisma/seed.ts`**

Ensure `getInitialStock` is imported and remove now-unused economy-equilibrium imports if they are no longer referenced elsewhere in the file:

```ts
import { getInitialStock } from "@/lib/constants/market-economy";
```

(Remove `getConsumeEquilibrium` / `EQUILIBRIUM_TARGETS` imports only if no other code in `seed.ts` still uses them.) `econ` is the system's `EconomyType` already in scope in that loop; `produces`/`consumes`/`goodEq` locals that fed the old `target` calculation can be deleted if unused.

- [ ] **Step 3: Re-seed and sanity-check**

Run: `npx prisma db seed`
Expected: completes without error; markets created with `stock`.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(economy): seed markets with derived initial stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# GROUP E — Economy processor + simulator world (cutover)

This group must be done together: the in-memory economy adapter reads `SimMarketEntry`, so the sim market type, the economy world types, both adapters, the processor body, and `world.ts` initial-stock all change in lockstep.

### Task E1: Simulator market types → stock

**Files:**
- Modify: `lib/engine/simulator/types.ts`

- [ ] **Step 1: Edit `SimMarketEntry`**

Replace:

```ts
export interface SimMarketEntry {
  systemId: string;
  goodId: string;
  basePrice: number;
  supply: number;
  demand: number;
  priceFloor: number;
  priceCeiling: number;
}
```

with:

```ts
export interface SimMarketEntry {
  systemId: string;
  goodId: string;
  basePrice: number;
  stock: number;
  priceFloor: number;
  priceCeiling: number;
}
```

- [ ] **Step 2: Edit the market-health `MarketSnapshot` type**

Replace:

```ts
export interface MarketSnapshot {
  systemId: string;
  goodId: string;
  supply: number;
  demand: number;
  price: number;
}
```

with:

```ts
export interface MarketSnapshot {
  systemId: string;
  goodId: string;
  stock: number;
  price: number;
}
```

- [ ] **Step 3: Edit `MarketHealthSummary.equilibriumDrift` → stock drift**

Replace the `equilibriumDrift` field:

```ts
  /** Per-good average distance from equilibrium at simulation end. */
  equilibriumDrift: { goodId: string; avgSupplyDrift: number; avgDemandDrift: number }[];
```

with:

```ts
  /** Per-good average distance of stock from its targetStock at simulation end. */
  stockDrift: { goodId: string; avgStockDrift: number }[];
```

- [ ] **Step 4: Commit**

```bash
git add lib/engine/simulator/types.ts
git commit -m "refactor(sim): SimMarketEntry + snapshots use stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task E2: Economy world interface → stock

**Files:**
- Modify: `lib/tick/world/economy-world.ts`

- [ ] **Step 1: Edit `MarketView`** — replace `supply`/`demand` with `stock`:

```ts
  basePrice: number;
  stock: number;
  economyType: EconomyType;
```

- [ ] **Step 2: Edit `MarketUpdate`** — replace the two fields with one:

```ts
/** Result of one market simulation step — written back via applyMarketUpdates. */
export interface MarketUpdate {
  id: string;
  stock: number;
}
```

- [ ] **Step 3: Update `EconomyProcessorParams.simParams` doc** (no shape change needed here — `EconomySimParams` is imported from `@/lib/engine/tick`, already updated). Update the `applyMarketUpdates` JSDoc from "Bulk-write market supply/demand" to "Bulk-write market stock."

- [ ] **Step 4: Commit**

```bash
git add lib/tick/world/economy-world.ts
git commit -m "refactor(economy): EconomyWorld market view/update use stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task E3: Economy adapters (Prisma + memory) → stock

**Files:**
- Modify: `lib/tick/adapters/prisma/economy.ts`
- Modify: `lib/tick/adapters/memory/economy.ts`

- [ ] **Step 1: Prisma adapter — `getMarketsForRegion`**

In `lib/tick/adapters/prisma/economy.ts`, in the `rows.map(...)` return object, replace:

```ts
        supply: m.supply,
        demand: m.demand,
```

with:

```ts
        stock: m.stock,
```

- [ ] **Step 2: Prisma adapter — `applyMarketUpdates`**

Replace the whole method body with a single-column `unnest` write:

```ts
  async applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    const ids = updates.map((u) => u.id);
    const stocks = updates.map((u) => (isFinite(u.stock) ? u.stock : 0));

    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "stock" = batch."stock"
      FROM unnest(${ids}::text[], ${stocks}::double precision[])
        AS batch("id", "stock")
      WHERE sm."id" = batch."id"`;
  }
```

- [ ] **Step 3: Memory adapter — `getMarketsForRegion`**

In `lib/tick/adapters/memory/economy.ts`, replace:

```ts
        supply: m.supply,
        demand: m.demand,
```

with:

```ts
        stock: m.stock,
```

- [ ] **Step 4: Memory adapter — `applyMarketUpdates`**

Replace the in-place rewrite with:

```ts
  applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const byKey = new Map<string, MarketUpdate>();
    for (const u of updates) byKey.set(u.id, u);

    this.markets = this.markets.map((m) => {
      const u = byKey.get(`${m.systemId}|${m.goodId}`);
      if (!u) return m;
      return { ...m, stock: isFinite(u.stock) ? u.stock : 0 };
    });
    return Promise.resolve();
  }
```

- [ ] **Step 5: Commit**

```bash
git add lib/tick/adapters/prisma/economy.ts lib/tick/adapters/memory/economy.ts
git commit -m "refactor(economy): economy adapters read/write stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task E4: Economy processor body → stock

**Files:**
- Modify: `lib/tick/processors/economy.ts`

- [ ] **Step 1: Update the tick-entry build + market updates**

Replace the `tickEntries` map's input object fields `supply: m.supply, demand: m.demand,` with `stock: m.stock,`, and replace the `marketUpdates` map:

```ts
  const marketUpdates: MarketUpdate[] = markets.map((m, i) => ({
    id: m.id,
    stock: simulated[i].stock,
  }));
```

- [ ] **Step 2: Update the live-wiring `simParams`**

Replace the `simParams` object (it referenced reversion/equilibrium) with the new shape:

```ts
const simParams: EconomySimParams = {
  noiseAmplitude: ECONOMY_CONSTANTS.NOISE_AMPLITUDE,
  minLevel: ECONOMY_CONSTANTS.MIN_LEVEL,
  maxLevel: ECONOMY_CONSTANTS.MAX_LEVEL,
};
```

- [ ] **Step 3: Fix imports**

Remove `EQUILIBRIUM_TARGETS` from the `@/lib/constants/economy` import (no longer used). Keep `ECONOMY_CONSTANTS` and all prosperity constants. The `resolveMarketTickEntry` call already passes `prosperity`, `modifiers`, `modifierCaps` — keep those; just ensure the `goodId/stock/basePrice/economyType/produces/consumes/baseProductionRate/baseConsumptionRate/govDef/traits` fields match the new `MarketTickInput` (drop `supply`/`demand`).

- [ ] **Step 4: Commit**

```bash
git add lib/tick/processors/economy.ts
git commit -m "refactor(economy): economy processor body uses stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task E5: Simulator world initialization → stock

**Files:**
- Modify: `lib/engine/simulator/world.ts`

- [ ] **Step 1: Replace the initial-market construction**

In `lib/engine/simulator/world.ts`, replace the `markets.push({...})` block that set `supply`/`demand` from equilibrium with:

```ts
      const basePrice = goodConst?.basePrice ?? goodDef.basePrice;

      markets.push({
        systemId: sys.id,
        goodId: goodKey,
        basePrice,
        stock: getInitialStock(sys.economyType, goodKey),
        priceFloor: goodConst?.priceFloor ?? goodDef.priceFloor,
        priceCeiling: goodConst?.priceCeiling ?? goodDef.priceCeiling,
      });
```

- [ ] **Step 2: Fix imports**

Add `import { getInitialStock } from "@/lib/constants/market-economy";`. Remove the `getConsumeEquilibrium` import and the now-unused `isProduced`/`isConsumed`/`goodEq`/`target` locals if nothing else in the loop uses them.

- [ ] **Step 3: Commit**

```bash
git add lib/engine/simulator/world.ts
git commit -m "refactor(sim): initialize sim markets with derived stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task E6: Economy integration test → stock

**Files:**
- Modify: `lib/tick/processors/__tests__/integration/economy.integration.test.ts`

- [ ] **Step 1: Update assertions**

Replace every `supply`/`demand` reference: seed test markets with `stock`, assert producers' stock rises and consumers' stock falls over ticks (toward the band extremes), and that stock stays within `[MIN, MAX]`. Replace any equilibrium-convergence assertion with a "producer stock > consumer stock for the same good across systems" check. Remove assertions on `demand`.

- [ ] **Step 2: Run economy + tick suites**

Run: `npx vitest run lib/tick/processors/__tests__/integration/economy.integration.test.ts lib/engine/__tests__/tick.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/tick/processors/__tests__/integration/economy.integration.test.ts
git commit -m "test(economy): economy integration test asserts on stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# GROUP F — Trade-flow processor (cutover)

### Task F1: Trade-flow world interface → stock

**Files:**
- Modify: `lib/tick/world/trade-flow-world.ts`

- [ ] **Step 1: Edit `MarketSnapshot`** — replace `supply`/`demand` with `stock` (keep `basePrice`, `priceFloor`, `priceCeiling`):

```ts
export interface MarketSnapshot {
  id: string;
  systemId: string;
  goodId: string;
  basePrice: number;
  stock: number;
  priceFloor: number;
  priceCeiling: number;
}
```

- [ ] **Step 2: Edit `MarketUpdate`**:

```ts
/** Absolute stock write (already clamped). */
export interface MarketUpdate {
  id: string;
  stock: number;
}
```

- [ ] **Step 3: Trim `TradeFlowProcessorParams`** — remove `tradeDemandImpactFactor` (no demand axis). Update the `minLevel`/`maxLevel` doc comments to say "stock floor/ceiling".

- [ ] **Step 4: Commit**

```bash
git add lib/tick/world/trade-flow-world.ts
git commit -m "refactor(trade-flow): world snapshot/update use stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F2: Trade-flow adapters (Prisma + memory) → stock

**Files:**
- Modify: `lib/tick/adapters/prisma/trade-flow.ts`
- Modify: `lib/tick/adapters/memory/trade-flow.ts`

- [ ] **Step 1: Prisma adapter — `getMarketSnapshotsForRegion`** — replace `supply: m.supply, demand: m.demand,` with `stock: m.stock,`.

- [ ] **Step 2: Prisma adapter — `applyMarketUpdates`** — single-column `unnest`:

```ts
  async applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    const ids = updates.map((u) => u.id);
    const stocks = updates.map((u) => (isFinite(u.stock) ? u.stock : 0));

    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "stock" = batch."stock"
      FROM unnest(${ids}::text[], ${stocks}::double precision[])
        AS batch("id", "stock")
      WHERE sm."id" = batch."id"`;
  }
```

- [ ] **Step 3: Memory adapter — `getMarketSnapshotsForRegion`** — replace `supply: m.supply, demand: m.demand,` with `stock: m.stock,`.

- [ ] **Step 4: Memory adapter — `applyMarketUpdates`** — write `stock` only:

```ts
  applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const byKey = new Map<string, MarketUpdate>();
    for (const u of updates) byKey.set(u.id, u);

    this.markets = this.markets.map((m) => {
      const u = byKey.get(`${m.systemId}|${m.goodId}`);
      if (!u) return m;
      return { ...m, stock: isFinite(u.stock) ? u.stock : 0 };
    });
    return Promise.resolve();
  }
```

- [ ] **Step 5: Commit**

```bash
git add lib/tick/adapters/prisma/trade-flow.ts lib/tick/adapters/memory/trade-flow.ts
git commit -m "refactor(trade-flow): adapters read/write stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F3: Trade-flow processor body → mid-price gradient on stock

The gradient becomes the **mid-price difference** (each side priced from its own `stock` via `spotPrice`), and a flow moves a single `stockDelta` (source `stock − qty`, destination `stock + qty`). The demand-impact bookkeeping is dropped.

**Files:**
- Modify: `lib/tick/processors/trade-flow.ts`
- Test: `lib/tick/processors/__tests__/trade-flow.test.ts`

- [ ] **Step 1: Update the test**

In `lib/tick/processors/__tests__/trade-flow.test.ts`, change the in-memory `SimMarketEntry` fixtures from `supply`/`demand` to `stock`, drop `tradeDemandImpactFactor` from the params object, and assert that flow decreases the cheaper (higher-stock) system's `stock` and increases the more-expensive (lower-stock) system's `stock`. Keep the budget/displacement/gradient-threshold cases (adjust the stock values so the chosen good still produces a gradient above threshold).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tick/processors/__tests__/trade-flow.test.ts`
Expected: FAIL — params/`MarketSnapshot` shape changed.

- [ ] **Step 3: Rewrite the gradient + flow application in `lib/tick/processors/trade-flow.ts`**

Replace the imports:

```ts
import { calculatePrice } from "@/lib/engine/pricing";
import { TRADE_DEMAND_IMPACT_FACTOR } from "@/lib/engine/trade";
```

with:

```ts
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
```

In the per-good gradient loop, replace the two `calculatePrice(...)` calls and `gradient` computation with:

```ts
      const priceA = spotPrice(
        curveForGood(goodId, mA.basePrice, mA.priceFloor, mA.priceCeiling),
        mA.stock,
      );
      const priceB = spotPrice(
        curveForGood(goodId, mB.basePrice, mB.priceFloor, mB.priceCeiling),
        mB.stock,
      );
      const gradient = (priceB - priceA) / mA.basePrice;
```

Replace the headroom/capacity + apply block (the `supplyHeadroom`/`supplyCapacity`/`demandImpact`/`newFrom*`/`newTo*` section) with a single-`stock` version:

```ts
    const stockHeadroom = Math.max(0, mFrom.stock - params.minLevel);
    const stockCapacity = Math.max(0, params.maxLevel - mTo.stock);
    const gradientFraction = Math.min(
      1,
      Math.abs(bestGradient) * params.gradientSensitivity,
    );
    const rawQty =
      Math.min(effectiveBudget, stockHeadroom, stockCapacity) * gradientFraction;
    const quantity = Math.floor(rawQty);
    if (quantity <= 0) continue;

    // Source mirrors a player buy at the cheaper end; destination a sell at the dearer end.
    const newFromStock = clamp(mFrom.stock - quantity, params.minLevel, params.maxLevel);
    const newToStock = clamp(mTo.stock + quantity, params.minLevel, params.maxLevel);

    // Mutate the in-flight snapshot so later edges see fresh state.
    mFrom.stock = newFromStock;
    mTo.stock = newToStock;

    updatesByMarketId.set(mFrom.id, { id: mFrom.id, stock: newFromStock });
    updatesByMarketId.set(mTo.id, { id: mTo.id, stock: newToStock });
```

- [ ] **Step 4: Update the live wiring**

In the `tradeFlowProcessor.process` params object, delete the `tradeDemandImpactFactor: TRADE_DEMAND_IMPACT_FACTOR,` line.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/tick/processors/__tests__/trade-flow.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/tick/processors/trade-flow.ts lib/tick/processors/__tests__/trade-flow.test.ts
git commit -m "feat(trade-flow): mid-price gradient + single stockDelta flow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# GROUP G — Services, types, snapshots (cutover)

### Task G1: Client/API types → stock language

**Files:**
- Modify: `lib/types/game.ts`
- Modify: `lib/types/api.ts` (no field changes — verify it re-exports `MarketEntry`)

- [ ] **Step 1: Rewrite the market types in `lib/types/game.ts`**

Replace `MarketEntry` and `MarketComparisonEntry` with:

```ts
export interface MarketEntry {
  goodId: string;
  goodName: string;
  basePrice: number;
  /** Mid (spot) price — used for trend vs basePrice and price history. */
  currentPrice: number;
  /** Per-unit buy price (mid × (1 + spread)), rounded. */
  buyPrice: number;
  /** Per-unit sell price (mid × (1 − spread)), rounded. */
  sellPrice: number;
  /** Units in stock (floored for display). */
  stock: number;
}

export interface MarketComparisonEntry {
  systemId: string;
  basePrice: number;
  currentPrice: number;
  /** Units in stock (floored). */
  stock: number;
}
```

`TradeHistoryEntry` is unchanged.

- [ ] **Step 2: Verify `lib/types/api.ts`**

`ShipTradeResult.updatedMarket` and `ConvoyTradeResult.updatedMarket` are typed as `MarketEntry` — no edit needed; they pick up the new shape. Confirm nothing in `api.ts` hardcodes `supply`/`demand`.

- [ ] **Step 3: Commit**

```bash
git add lib/types/game.ts
git commit -m "refactor(types): MarketEntry uses stock + buy/sell prices

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task G2: A shared `buildMarketEntry` helper (DRY for read services)

Three read services (`market`, `cantina`, and the trade responses) map a DB market row → `MarketEntry`. Extract the mapping once.

**Files:**
- Create: `lib/services/market-entry.ts`

- [ ] **Step 1: Create the helper**

```ts
import {
  spotPrice,
  quoteTrade,
  curveForGood,
  type MarketCurve,
} from "@/lib/engine/market-pricing";
import { getSpread, STOCK_MIN } from "@/lib/constants/market-economy";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import type { GovernmentDefinition } from "@/lib/constants/government";
import type { MarketEntry } from "@/lib/types/game";

/** Minimal good shape needed to price a market row. */
export interface PricedGood {
  name: string;
  basePrice: number;
  priceFloor: number;
  priceCeiling: number;
}

/** Resolve the canonical good key + price curve for a DB good row. */
export function curveForGoodRow(good: PricedGood): { goodKey: string; curve: MarketCurve } {
  const goodKey = GOOD_NAME_TO_KEY.get(good.name) ?? good.name;
  return {
    goodKey,
    curve: curveForGood(goodKey, good.basePrice, good.priceFloor, good.priceCeiling),
  };
}

/**
 * Build a display MarketEntry from a market row's stock + good. The single-unit
 * buy/sell prices use the bid-ask spread for the system's government; the
 * integrated-slippage total for a real trade is computed separately in
 * executeTrade. `stock` is floored so the player never sees fractional goods.
 */
export function buildMarketEntry(
  goodId: string,
  good: PricedGood,
  stock: number,
  govDef?: GovernmentDefinition,
): MarketEntry {
  const { curve } = curveForGoodRow(good);
  const spread = getSpread(govDef);
  return {
    goodId,
    goodName: good.name,
    basePrice: good.basePrice,
    currentPrice: spotPrice(curve, stock),
    buyPrice: quoteTrade(curve, stock, 1, "buy", spread).totalPrice,
    sellPrice: quoteTrade(curve, stock, 1, "sell", spread).totalPrice,
    stock: Math.floor(stock),
  };
}

export { STOCK_MIN };
```

- [ ] **Step 2: Commit**

```bash
git add lib/services/market-entry.ts
git commit -m "feat(services): shared buildMarketEntry/curveForGoodRow helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task G3: `getMarket` + `getMarketComparison` → stock

**Files:**
- Modify: `lib/services/market.ts`
- Modify: `lib/services/market-comparison.ts`

- [ ] **Step 1: `market.ts`**

Replace the `calculatePrice` import with the helper, fetch the system's government, and map via `buildMarketEntry`. Update `getMarket`'s station query to include the owning faction's government:

```ts
import { prisma } from "@/lib/prisma";
import { buildMarketEntry } from "./market-entry";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { toGovernmentType } from "@/lib/types/guards";
import { ServiceError } from "./errors";
import type { MarketEntry, TradeHistoryEntry } from "@/lib/types/game";
import { toTradeType } from "@/lib/types/guards";
```

In `getMarket`, fetch the station with its system faction and resolve `govDef`, then:

```ts
  const station = await prisma.station.findUnique({
    where: { systemId },
    include: { system: { select: { faction: { select: { governmentType: true } } } } },
  });
  if (!station) {
    throw new ServiceError("No station found in this system.", 404);
  }
  const govDef = station.system.faction
    ? GOVERNMENT_TYPES[toGovernmentType(station.system.faction.governmentType)]
    : undefined;

  const marketEntries = await prisma.stationMarket.findMany({
    where: { stationId: station.id },
    include: {
      good: { select: { id: true, name: true, basePrice: true, priceFloor: true, priceCeiling: true } },
    },
  });

  const entries: MarketEntry[] = marketEntries.map((m) =>
    buildMarketEntry(m.good.id, m.good, m.stock, govDef),
  );

  return { stationId: station.id, entries };
```

- [ ] **Step 2: `market-comparison.ts`**

Replace `calculatePrice` with stock pricing. Each visible system can have a different government; fetch it per row. Update the query to include the good's price fields + the station's system faction, and map:

```ts
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
```

```ts
  const markets = await prisma.stationMarket.findMany({
    where: { goodId: good.id, station: { systemId: { in: visibleIds } } },
    select: {
      stock: true,
      station: { select: { systemId: true } },
    },
  });

  const curve = curveForGood(
    GOOD_NAME_TO_KEY.get(/* good.name */ "") ?? good.id, // see note
    good.basePrice,
    good.priceFloor,
    good.priceCeiling,
  );

  const entries: MarketComparisonEntry[] = markets.map((m) => ({
    systemId: m.station.systemId,
    basePrice: good.basePrice,
    currentPrice: spotPrice(curve, m.stock),
    stock: Math.floor(m.stock),
  }));
```

> **Note:** the comparison query selects a single `good` by CUID; fetch its `name` too (add `name: true` to the `good` select at the top of the function) so `curveForGood` gets the right `goodId` key via `GOOD_NAME_TO_KEY`. The comparison panel shows mid price only, so per-system government spread is not needed here.

- [ ] **Step 3: Commit**

```bash
git add lib/services/market.ts lib/services/market-comparison.ts
git commit -m "refactor(services): market reads use stock-based pricing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task G4: `executeTrade` (single-ship) → quote + stockDelta

**Files:**
- Modify: `lib/services/trade.ts`

- [ ] **Step 1: Swap pricing + validation**

Replace the `calculatePrice` import with:

```ts
import { quoteTrade, curveForGood } from "@/lib/engine/market-pricing";
import { getSpread, STOCK_MIN, STOCK_MAX } from "@/lib/constants/market-economy";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { toGovernmentType } from "@/lib/types/guards";
import { buildMarketEntry } from "./market-entry";
```

Include the government on the station lookup:

```ts
  const station = await prisma.station.findUnique({
    where: { systemId: ship.systemId },
    include: {
      system: { select: { factionId: true, faction: { select: { governmentType: true } } } },
    },
  });
```

Replace the `basePrice`/`unitPrice` snapshot (the `calculatePrice` + reputation block) with a quote:

```ts
  const goodKey = GOOD_NAME_TO_KEY.get(marketEntry.good.name) ?? marketEntry.good.name;
  const curve = curveForGood(goodKey, marketEntry.good.basePrice, marketEntry.good.priceFloor, marketEntry.good.priceCeiling);
  const govDef = station.system.faction
    ? GOVERNMENT_TYPES[toGovernmentType(station.system.faction.governmentType)]
    : undefined;
  const spread = getSpread(govDef);

  const quote = quoteTrade(curve, marketEntry.stock, quantity, type, spread);

  // Reputation gating + multiplier (stacks on the quote, as before).
  let totalPrice = quote.totalPrice;
  if (factionId) {
    const repRow = await prisma.playerFactionReputation.findUnique({
      where: { playerId_factionId: { playerId, factionId } },
      select: { score: true },
    });
    const tier = getReputationTier(repRow?.score ?? 0);
    if (tier.tradeDenied) {
      return { ok: false, error: "This faction refuses to trade with you (hostile standing).", status: 403 };
    }
    const mult = type === "buy" ? tier.buyMultiplier : tier.sellMultiplier;
    totalPrice = Math.round(totalPrice * mult);
  }
  const unitPrice = Math.round(totalPrice / quantity); // for trade history
```

Replace the `validateFleetTrade({...})` call's market fields:

```ts
  const result = validateFleetTrade({
    type,
    quantity,
    totalPrice,
    playerCredits: player.credits,
    currentCargoUsed,
    cargoMax: ship.cargoMax,
    currentStock: marketEntry.stock,
    stockMin: STOCK_MIN,
    stockMax: STOCK_MAX,
    currentGoodQuantityInCargo,
    shipStatus: toShipStatus(ship.status),
  });
```

- [ ] **Step 2: Apply the stock delta inside the transaction**

Replace the market `update` inside `$transaction` with a clamped stock write:

```ts
      const freshMarket = await tx.stationMarket.findUnique({ where: { id: marketEntry.id } });
      const nextStock = Math.max(
        STOCK_MIN,
        Math.min(STOCK_MAX, (freshMarket?.stock ?? 0) + delta.stockDelta),
      );
      const market = await tx.stationMarket.update({
        where: { id: marketEntry.id },
        data: { stock: nextStock },
        include: { good: true },
      });
```

Keep the affordability re-check (`delta.totalPrice`), the credits/cargo/tradeHistory/`tradeVolumeAccum` writes unchanged. The `tradeHistory.create` `price` becomes `unitPrice` (already computed).

- [ ] **Step 3: Build the response with `buildMarketEntry`**

Replace the trailing `newPrice = calculatePrice(...)` + return block with:

```ts
  return {
    ok: true,
    data: {
      ship: serializeShip(freshShip),
      updatedMarket: buildMarketEntry(
        updatedMarket.goodId,
        updatedMarket.good,
        updatedMarket.stock,
        govDef,
      ),
    },
  };
```

- [ ] **Step 4: Commit**

```bash
git add lib/services/trade.ts
git commit -m "feat(trade): executeTrade uses integrated-slippage quote + stockDelta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task G5: `executeConvoyTrade` → quote + stockDelta

**Files:**
- Modify: `lib/services/convoy-trade.ts`

- [ ] **Step 1: Apply the same transformation as Task G4** — same imports; include government on the station lookup; replace the `calculatePrice`/`unitPrice` block with the `quoteTrade` + reputation block (using `marketEntry.stock` and the convoy's `quantity`); pass `totalPrice`/`currentStock`/`stockMin`/`stockMax` into `validateFleetTrade`; inside the transaction replace the `supply`/`demand` market `update` with the clamped `stock` write; build the response `updatedMarket` via `buildMarketEntry`. The cargo distribution/pull loops over member ships are unchanged.

- [ ] **Step 2: Commit**

```bash
git add lib/services/convoy-trade.ts
git commit -m "feat(trade): executeConvoyTrade uses quote + stockDelta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task G6: Missions service → stock

**Files:**
- Modify: `lib/services/missions.ts`

- [ ] **Step 1: Price lookups**

Replace the two `calculatePrice(...)` calls (the `buildPriceLookup` map and the `deliverMission` fresh-price recompute) with `spotPrice(curveForGood(goodKey, basePrice, priceFloor, priceCeiling), stock)`. Resolve `goodKey` via `GOOD_NAME_TO_KEY.get(entry.good.name) ?? entry.goodId`. Add the imports:

```ts
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { STOCK_MIN, STOCK_MAX } from "@/lib/constants/market-economy";
```

- [ ] **Step 2: Market update on delivery**

Mission delivery is a sell (adds goods to the destination). Replace the `supply`/`demand` update with a clamped stock add:

```ts
    const nextStock = Math.max(
      STOCK_MIN,
      Math.min(STOCK_MAX, freshMarket.stock + freshMission.quantity),
    );
    await tx.stationMarket.update({
      where: { id: freshMarket.id },
      data: { stock: nextStock },
    });
```

Remove the `demandDelta` local. (If mission reward uses `freshUnitPrice`, keep that — it now comes from `spotPrice`.)

- [ ] **Step 3: Commit**

```bash
git add lib/services/missions.ts
git commit -m "refactor(missions): stock-based pricing + stock delivery delta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task G7: Cantina + dev-tools → stock

**Files:**
- Modify: `lib/services/cantina.ts`
- Modify: `lib/services/dev-tools.ts`

- [ ] **Step 1: `cantina.ts`**

Replace the neighbor-market `MarketEntry` map's `calculatePrice` + `supply`/`demand` fields with `buildMarketEntry(m.good.id, m.good, m.stock, govDef)`. Resolve `govDef` per neighbor station from its system faction (the bartender-tips query already walks neighbor stations — add `faction: { select: { governmentType: true } }` to the system include and resolve via `GOVERNMENT_TYPES`/`toGovernmentType`). Import `buildMarketEntry`.

- [ ] **Step 2: `dev-tools.ts` — `getEconomySnapshot`**

Replace the `EconomySnapshotSystem.markets` item type's `supply`/`demand` with `stock`, and the map's `calculatePrice` with `spotPrice`:

```ts
    markets: (sys.station?.markets ?? []).map((m) => {
      const goodKey = GOOD_NAME_TO_KEY.get(m.good.name) ?? m.goodId;
      return {
        goodId: m.goodId,
        goodName: m.good.name,
        stock: m.stock,
        price: spotPrice(curveForGood(goodKey, m.good.basePrice, m.good.priceFloor, m.good.priceCeiling), m.stock),
      };
    }),
```

Update the `markets` field type to `{ goodId: string; goodName: string; stock: number; price: number }[]`.

- [ ] **Step 3: `dev-tools.ts` — `resetEconomy`**

Replace the per-market equilibrium reset with `getInitialStock`:

```ts
      const econ = toEconomyType(m.station.system.economyType);
      const goodKey = goodKeyByName.get(m.good.name) ?? m.good.name;
      await tx.stationMarket.update({
        where: { id: m.id },
        data: { stock: getInitialStock(econ, goodKey) },
      });
```

Remove the `produces`/`consumes`/`isProduced`/`isConsumed`/`goodEq`/`target` locals and the `EQUILIBRIUM_TARGETS` import if now unused; add `import { getInitialStock } from "@/lib/constants/market-economy";` and the `spotPrice`/`curveForGood` + `GOOD_NAME_TO_KEY` imports.

- [ ] **Step 4: Commit**

```bash
git add lib/services/cantina.ts lib/services/dev-tools.ts
git commit -m "refactor(services): cantina + dev-tools use stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task G8: Price-history snapshot (`snapshot.ts` + Prisma adapter) → stock

**Files:**
- Modify: `lib/engine/snapshot.ts`
- Modify: `lib/tick/adapters/prisma/snapshots.ts`
- Test: `lib/engine/__tests__/snapshot.test.ts`

- [ ] **Step 1: Update `snapshot.test.ts`**

Change `MarketInput` fixtures from `supply`/`demand` to `stock`, and update expected prices to `spotPrice` of the derived curve (use a known good key, e.g. `food`, so `getTargetStock` is deterministic — assert exact values with `midPriceAt`/`spotPrice`).

- [ ] **Step 2: Rewrite `lib/engine/snapshot.ts`**

```ts
import { spotPrice, curveForGood } from "./market-pricing";

export interface MarketInput {
  systemId: string;
  goodId: string;
  stock: number;
  basePrice: number;
  priceFloor?: number;
  priceCeiling?: number;
}

export interface PriceHistoryEntry {
  tick: number;
  prices: Record<string, number>;
}

/**
 * Build one PriceHistoryEntry per system from a flat array of market rows.
 * Groups by systemId, computes each good's spot price from its stock. Pure.
 */
export function buildPriceEntry(
  markets: MarketInput[],
  tick: number,
): Map<string, PriceHistoryEntry> {
  const bySystem = new Map<string, MarketInput[]>();
  for (const m of markets) {
    const arr = bySystem.get(m.systemId);
    if (arr) arr.push(m);
    else bySystem.set(m.systemId, [m]);
  }

  const result = new Map<string, PriceHistoryEntry>();
  for (const [systemId, systemMarkets] of bySystem) {
    const prices: Record<string, number> = {};
    for (const m of systemMarkets) {
      const curve = curveForGood(m.goodId, m.basePrice, m.priceFloor ?? 0.2, m.priceCeiling ?? 5.0);
      prices[m.goodId] = spotPrice(curve, m.stock);
    }
    result.set(systemId, { tick, prices });
  }

  return result;
}
```

(`appendSnapshot` is unchanged.) Note `buildPriceEntry` now expects `goodId` to be the canonical good **key** — confirm the snapshots adapter passes the key (it likely already resolves via `GOOD_NAME_TO_KEY`); if it passes the CUID, map it to the key in the adapter.

- [ ] **Step 3: Update `lib/tick/adapters/prisma/snapshots.ts`**

In whatever method builds `MarketInput[]` (the `getMarkets()` mapping), replace `supply`/`demand` with `stock: m.stock`, and ensure `goodId` is the canonical key (`GOOD_NAME_TO_KEY.get(m.good.name) ?? ...`).

- [ ] **Step 4: Run**

Run: `npx vitest run lib/engine/__tests__/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/snapshot.ts lib/tick/adapters/prisma/snapshots.ts lib/engine/__tests__/snapshot.test.ts
git commit -m "refactor(snapshots): price history uses stock-based spot price

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task G9: Trade-missions adapter + mock data + integration tests

**Files:**
- Modify: `lib/tick/adapters/prisma/trade-missions.ts`
- Modify: `lib/trade/mock-data.ts`
- Modify: integration suites that assert supply/demand

- [ ] **Step 1: `trade-missions.ts` — `getMarketPrices`**

Replace the `calculatePrice(...)` with `spotPrice(curveForGood(goodKey, m.good.basePrice, m.good.priceFloor, m.good.priceCeiling), m.stock)` (the `goodKey` is already resolved on the line above via `GOOD_NAME_TO_KEY`). Swap the import.

- [ ] **Step 2: `mock-data.ts`**

Rewrite each `MOCK_MARKET` entry to the new `MarketEntry` shape, e.g.:

```ts
export const MOCK_MARKET: MarketEntry[] = [
  { goodId: "food", goodName: "Food", basePrice: 20, currentPrice: 18, buyPrice: 19, sellPrice: 17, stock: 120 },
  { goodId: "ore", goodName: "Ore", basePrice: 30, currentPrice: 35, buyPrice: 37, sellPrice: 33, stock: 45 },
  { goodId: "fuel", goodName: "Fuel", basePrice: 40, currentPrice: 42, buyPrice: 44, sellPrice: 40, stock: 50 },
  { goodId: "electronics", goodName: "Electronics", basePrice: 80, currentPrice: 95, buyPrice: 100, sellPrice: 90, stock: 30 },
  { goodId: "machinery", goodName: "Machinery", basePrice: 100, currentPrice: 88, buyPrice: 92, sellPrice: 84, stock: 65 },
  { goodId: "luxuries", goodName: "Luxuries", basePrice: 150, currentPrice: 200, buyPrice: 210, sellPrice: 190, stock: 15 },
];
```

- [ ] **Step 3: Integration suites**

Update `lib/services/__tests__/integration/{trade,convoy-trade,market,market-comparison,missions}.integration.test.ts` and `lib/tick/processors/__tests__/integration/events.integration.test.ts`:
- Seed `StationMarket` rows with `stock` instead of `supply`/`demand`.
- Replace assertions on `updatedMarket.supply`/`.demand` with `updatedMarket.stock` (and where relevant, `buyPrice`/`sellPrice`).
- For the round-trip test in `trade.integration.test.ts`: assert that **buy-then-immediate-sell-back nets a loss** (the spread), and that buy decreases stock / sell increases it.
- `events.integration.test.ts`: assert event **rate** multipliers change stock trajectory; drop assertions on equilibrium-target shifts (now inert — see Task C2).

- [ ] **Step 4: Run the integration suites**

Run: `npx vitest run lib/services/__tests__/integration lib/tick/processors/__tests__/integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tick/adapters/prisma/trade-missions.ts lib/trade/mock-data.ts lib/services/__tests__/integration lib/tick/processors/__tests__/integration
git commit -m "refactor: trade-missions adapter, mocks, and integration tests use stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# GROUP H — Simulator bots & analysis (cutover)

### Task H1: Strategy helpers → stock pricing

**Files:**
- Modify: `lib/engine/simulator/strategies/helpers.ts`

- [ ] **Step 1: Replace pricing + availability**

Swap the import `import { calculatePrice } from "@/lib/engine/pricing";` for:

```ts
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { STOCK_MIN } from "@/lib/constants/market-economy";
```

Rewrite `getPrice`:

```ts
export function getPrice(m: SimMarketEntry): number {
  return spotPrice(curveForGood(m.goodId, m.basePrice, m.priceFloor, m.priceCeiling), m.stock);
}
```

In `estimateSellPrice`/`estimateBuyPrice`, replace `calculatePrice(market.basePrice, market.supply, market.demand, ...)` with `getPrice(market)` (multiplied by quantity), and replace the `market.supply < quantity` availability guard in `estimateBuyPrice` with `market.stock - STOCK_MIN < quantity`. In `findOpportunities`, replace `buyMarket.supply <= 0` with `buyMarket.stock - STOCK_MIN <= 0` and `maxBySupply = buyMarket.supply` with `maxBySupply = Math.floor(buyMarket.stock - STOCK_MIN)`.

- [ ] **Step 2: Commit**

```bash
git add lib/engine/simulator/strategies/helpers.ts
git commit -m "refactor(sim): strategy helpers price + cap on stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task H2: Bot executor → stock

**Files:**
- Modify: `lib/engine/simulator/bot.ts`

- [ ] **Step 1: Replace pricing + market impact**

Swap the import for `import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";` and `import { STOCK_MIN, STOCK_MAX } from "@/lib/constants/market-economy";`.

Sell leg — replace the `calculatePrice` price + the supply/demand impact map:

```ts
    const price = spotPrice(curveForGood(market.goodId, market.basePrice, market.priceFloor, market.priceCeiling), market.stock);
    const revenue = price * cargo.quantity;
    player = { ...player, credits: player.credits + revenue };

    markets = markets.map((m) =>
      m === market
        ? { ...m, stock: Math.min(STOCK_MAX, m.stock + cargo.quantity) }
        : m,
    );
```

Buy leg — replace the price, the `buyMarket.supply >= decision.buyQuantity` guard, and the impact map:

```ts
      const price = spotPrice(curveForGood(buyMarket.goodId, buyMarket.basePrice, buyMarket.priceFloor, buyMarket.priceCeiling), buyMarket.stock);
      const totalCost = price * decision.buyQuantity;

      if (totalCost <= player.credits && buyMarket.stock - STOCK_MIN >= decision.buyQuantity) {
        player = { ...player, credits: player.credits - totalCost };
        ship = { ...ship, cargo: [...ship.cargo, { goodId: decision.buyGoodId, quantity: decision.buyQuantity }] };

        markets = markets.map((m) =>
          m === buyMarket
            ? { ...m, stock: Math.max(STOCK_MIN, m.stock - decision.buyQuantity) }
            : m,
        );
        // ...tradeCount / goodsTraded bookkeeping unchanged
```

Remove the `demandDelta` / `constants.bots.tradeImpactFactor` lines on both legs.

> **Note (calibration):** the bot prices each leg at the spot mid (not integrated slippage) and ignores the spread — that's fine for the calibration harness; it intentionally approximates aggregate trading pressure, not the exact player formula. Equilibrium targets are validated in PR 3.

- [ ] **Step 2: Commit**

```bash
git add lib/engine/simulator/bot.ts
git commit -m "refactor(sim): bot prices on stock and moves a single stock delta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task H3: Simulator analysis (market + event) → stock

**Files:**
- Modify: `lib/engine/simulator/market-analysis.ts`
- Modify: `lib/engine/simulator/event-analysis.ts`
- Modify: `lib/engine/simulator/experiment.ts`

- [ ] **Step 1: `market-analysis.ts`**

Swap the import for `spotPrice`/`curveForGood` + `getTargetStock`. In `takeMarketSnapshot`, return `{ systemId, goodId, stock: m.stock, price: getPrice-equivalent }` (use `spotPrice(curveForGood(...), m.stock)`). In `computePriceDispersion`, replace `calculatePrice(...)` with the same. Rewrite `computeEquilibriumDrift` → `computeStockDrift`: for each market, `drift = m.stock - getTargetStock(m.goodId)`; aggregate per good into `{ goodId, avgStockDrift }`; sort by `abs(avgStockDrift)` desc. Update `computeMarketHealth` to return `{ priceDispersion, stockDrift }` (matching the `MarketHealthSummary` change from Task E1). Drop the `constants`/economy-relationship logic that fed the old supply/demand drift.

- [ ] **Step 2: `event-analysis.ts`**

In `snapshotPrices`, replace `calculatePrice(m.basePrice, m.supply, m.demand, ...)` with `spotPrice(curveForGood(m.goodId, m.basePrice, m.priceFloor, m.priceCeiling), m.stock)`. Swap the import. No other change (it works off prices).

- [ ] **Step 3: `experiment.ts`**

In `ConstantOverridesSchema`, replace the `equilibrium` block (produces/consumes/neutral supply/demand) with a stock-oriented override, or remove it if unused by current experiment configs:

```ts
  stock: z.object({
    targetStockMult: z.number().optional(),
  }).optional(),
```

If `constants.equilibrium` / `constants.goods[*].equilibrium` are read elsewhere in the simulator after H1–H3, grep and remove those reads (the drift calc was the last consumer). Keep the `goods` basePrice override and all non-economy sections unchanged.

- [ ] **Step 4: Run the simulator unit/integration tests**

Run: `npx vitest run lib/engine/__tests__/simulator-integration.test.ts`
Expected: PASS (update any supply/demand assertions in that file as part of this task).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/simulator/market-analysis.ts lib/engine/simulator/event-analysis.ts lib/engine/simulator/experiment.ts lib/engine/__tests__/simulator-integration.test.ts
git commit -m "refactor(sim): analysis + experiment config use stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# GROUP I — UI (stock language)

### Task I1: Trade schema → stock cap + per-side price

**Files:**
- Modify: `lib/schemas/trade.ts`

- [ ] **Step 1: Rewrite the context + buy checks**

Replace `TradeSchemaContext` and the buy branch:

```ts
export interface TradeSchemaContext {
  tradeType: TradeType;
  /** Per-unit price for the active side (buyPrice or sellPrice). */
  unitPrice: number;
  playerCredits: number;
  cargoSpaceAvailable: number;
  /** Max units buyable from current stock (floor(stock - STOCK_MIN)). */
  maxBuyable: number;
  currentCargoQuantity: number;
}
```

In the buy branch, replace the `quantity > ctx.supply` check with:

```ts
        if (quantity > ctx.maxBuyable) {
          refineCtx.addIssue({
            code: "custom",
            path: ["quantity"],
            message: `Only ${ctx.maxBuyable} units available to buy.`,
          });
          return;
        }
```

(The credits + cargo-space checks are unchanged; `totalCost = quantity * ctx.unitPrice` now uses the active side's price.)

- [ ] **Step 2: Commit**

```bash
git add lib/schemas/trade.ts
git commit -m "refactor(trade-form): schema validates against stock + per-side price

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task I2: TradeForm → stock + buy/sell price

**Files:**
- Modify: `components/trade/trade-form.tsx`

- [ ] **Step 1: Use stock + per-side price**

Add `import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";`. Compute the active per-unit price and the buy cap from stock:

```ts
  const unitPrice = tradeType === "buy" ? good.buyPrice : good.sellPrice;
  const cargoSpaceAvailable = cargoMax - cargoUsed;
  const maxBuyable = Math.max(0, Math.floor(good.stock) - ECONOMY_CONSTANTS.MIN_LEVEL);

  const maxBuyByCredits = Math.floor(playerCredits / Math.max(1, good.buyPrice));
  const maxBuy = Math.min(maxBuyByCredits, cargoSpaceAvailable, maxBuyable);
  const maxSell = currentCargoQuantity;
```

Update `schemaCtx` to pass `unitPrice` and `maxBuyable` (drop `supply`). Update `totalCost = quantity * unitPrice`. Update the hint string: `Max: ${maxBuy} (credits: ${maxBuyByCredits}, cargo: ${cargoSpaceAvailable}, stock: ${maxBuyable})`. Update the preview "Unit Price" line and the `CardHeader` subtitle to use `unitPrice` (so buy/sell prices show correctly per tab).

- [ ] **Step 2: Commit**

```bash
git add components/trade/trade-form.tsx
git commit -m "feat(trade-form): show buy/sell price + stock-based max

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task I3: Market table → In Stock / Buy / Sell

**Files:**
- Modify: `components/trade/market-table.tsx`

- [ ] **Step 1: Replace the Supply/Demand columns**

Remove the `supply` and `demand` column definitions. Add columns:

```tsx
    {
      key: "stock",
      label: "In Stock",
      sortable: true,
      getValue: (row) => row.stock,
      render: (row) => <span className="font-mono">{row.stock}</span>,
    },
    {
      key: "buyPrice",
      label: "Buy",
      sortable: true,
      getValue: (row) => row.buyPrice,
      render: (row) => <span className="font-mono text-text-secondary">{formatCredits(row.buyPrice)}</span>,
    },
    {
      key: "sellPrice",
      label: "Sell",
      sortable: true,
      getValue: (row) => row.sellPrice,
      render: (row) => <span className="font-mono text-text-secondary">{formatCredits(row.sellPrice)}</span>,
    },
```

Keep `currentPrice` (mid) and the `priceTrend` column (it compares `currentPrice` to `basePrice`, unchanged). Consider dropping the standalone `currentPrice` column to avoid redundancy with Buy/Sell — leave the Trend column.

- [ ] **Step 2: Commit**

```bash
git add components/trade/market-table.tsx
git commit -m "feat(ui): market table shows In Stock / Buy / Sell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task I4: Supply/Demand chart → Stock chart

**Files:**
- Rename: `components/trade/supply-demand-chart.tsx` → `components/trade/stock-chart.tsx`
- Modify: `app/(game)/@panel/system/[systemId]/market/page.tsx`

- [ ] **Step 1: Create `components/trade/stock-chart.tsx`**

```tsx
"use client";

import type { MarketEntry } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ThemedBarChart } from "@/components/ui/themed-bar-chart";

const BARS = [{ dataKey: "stock", name: "In Stock", color: "#60a5fa" }];

interface StockChartProps {
  entries: MarketEntry[];
}

export function StockChart({ entries }: StockChartProps) {
  const data = entries.map((e) => ({ name: e.goodName, stock: e.stock }));

  return (
    <Card variant="bordered" padding="md">
      <CardHeader title="Stock Levels" subtitle="Inventory for all goods" />
      <CardContent>
        <div className="w-full h-72">
          <ThemedBarChart data={data} bars={BARS} xAxisKey="name" />
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Delete the old file**

```bash
git rm components/trade/supply-demand-chart.tsx
```

- [ ] **Step 3: Update the market page**

In `app/(game)/@panel/system/[systemId]/market/page.tsx`, change the import `import { SupplyDemandChart } from "@/components/trade/supply-demand-chart";` to `import { StockChart } from "@/components/trade/stock-chart";`, and the JSX `<SupplyDemandChart entries={market} />` to `<StockChart entries={market} />`.

- [ ] **Step 4: Commit**

```bash
git add components/trade/stock-chart.tsx app/(game)/@panel/system/[systemId]/market/page.tsx
git commit -m "feat(ui): replace supply/demand chart with stock chart

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task I5: Market comparison panel → stock

**Files:**
- Modify: `components/market/market-comparison-panel.tsx`

- [ ] **Step 1: Rename the sort key + column**

Change `type SortKey = "price" | "supply" | "hops";` to `type SortKey = "price" | "stock" | "hops";`. In the `rows` sort `useMemo`, replace `a.supply`/`b.supply` with `a.stock`/`b.stock`. In the header, change the `toggleSort("supply")` button label "Supply" → "Stock". In the row render, replace `{r.supply}` with `{r.stock}`. (The `ratio`/buy-sell filter uses `currentPrice/basePrice`, unchanged.)

- [ ] **Step 2: Commit**

```bash
git add components/market/market-comparison-panel.tsx
git commit -m "feat(ui): comparison panel sorts/show stock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# GROUP J — Cleanup & verification

### Task J1: Delete the legacy pricing engine

**Files:**
- Delete: `lib/engine/pricing.ts`, `lib/engine/__tests__/pricing.test.ts`

- [ ] **Step 1: Confirm no remaining importers**

Run: `npx vitest run` is not enough — grep first.
Run: search the repo for `engine/pricing` and `calculatePrice`. Expected: zero matches outside the deleted files (all callers migrated in Groups F–H).

- [ ] **Step 2: Delete**

```bash
git rm lib/engine/pricing.ts lib/engine/__tests__/pricing.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(economy): remove legacy supply/demand calculatePrice

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task J2: Full verification

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors. (First fully-green typecheck since Task D1.) Fix any stragglers — most likely lingering `m.supply`/`m.demand`/`calculatePrice` references the cutover missed; grep for them.

- [ ] **Step 2: Unit + integration tests**

Run: `npx vitest run`
Expected: all suites pass.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 4: Simulator sanity check**

Run: `npm run simulate`
Expected: completes 500 ticks for all strategies without NaN/crash; bots make trades; market-health output shows non-trivial price dispersion (cross-system arbitrage preserved). Prices need not be calibrated yet — that's PR 3. If a good's prices pin to floor/ceiling everywhere, note it for PR 3 calibration but do not block.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run: `npm run dev`, dock a ship, confirm: market table shows In Stock / Buy / Sell; buying raises the buy price and lowers stock; **buying then immediately selling back nets a small loss** (the spread — the exploit is dead); cross-system price differences remain.

- [ ] **Step 6: Update memory + roadmap**

Update `docs/planned/stock-based-market-economy.md` phasing note: PR 3 is now **calibration + docs only** (UI shipped in PR 2). Update the `stock-economy-roadmap` memory: PR 2 done; PR 3 = recalibrate `targetStock`/rates against `npm run simulate`, write `docs/active/gameplay/economy.md`/`trading.md`/`trade-simulation.md`, and delete `docs/plans/stock-economy-pr2-cutover.md`.

- [ ] **Step 7: Final commit**

```bash
git add docs/planned/stock-based-market-economy.md
git commit -m "docs(economy): PR 2 complete — PR 3 is calibration + docs only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (`docs/planned/stock-based-market-economy.md`):**
- §1 single `stock` value, `MIN`/`MAX`/`targetStock` derived → Task D1 (schema), A1 (`STOCK_MIN/MAX`, `getTargetStock`). ✅
- §2 mid price + integrated slippage + spread → reuses PR 1; wired via `curveForGood`/`buildMarketEntry`/`quoteTrade` in G2/G4/G5. ✅
- §2 exploit dies / arbitrage preserved → enforced by PR 1's `quoteTrade`; verified live in J2 step 5 + the trade integration round-trip test (G9). ✅
- §3 tick `stock += production − consumption`, sqrt self-limiting, no mean-reversion, prosperity scaling → Task C1/C2, E4. ✅
- §4 buy cap `floor(stock−MIN)`, sell cap `floor(MAX−stock)`, single `stockDelta`, TOCTOU re-read + clamp, `tradeVolumeAccum` unchanged, rep multipliers stack → Task B1, G4, G5. ✅
- §5 trade-flow mid-price gradient + single stockDelta, drops opposite-demand bookkeeping, budget/throttle/cadence unchanged → Task F1–F3. ✅
- §6 government scales spread (repurposed `equilibriumSpreadPct`), prosperity scales rates, events via rate multipliers (target/reversion modifiers documented inert) → Task A1 (`getSpread`), C2. ✅
- §7 schema migration + seed; UI to In Stock / Buy price / Sell price / max buyable/sellable; price history + trade history keep working → Task D1/D2, G1, G8, I1–I5. ✅
- §8 calibration explicitly deferred to PR 3; PR 2 uses mechanical `getTargetStock`/`getInitialStock` → Task A1, J2 step 6. ✅

**Placeholder scan:** Pure-engine tasks (A1, A2, B1, C1, C2) ship complete code + complete tests. Mechanical cutover tasks give exact before→after with full replacement blocks. The few "apply the same transformation" references (G5 mirrors G4; G9 integration edits) point at a fully-specified sibling task rather than leaving content blank. No TBD/TODO. ✅

**Type consistency:** `MarketCurve` fields and `curveForGood(goodId, basePrice, floorMult, ceilingMult)` match across A2/F3/G/H. `TradeDelta.stockDelta` + `TradeParams.{currentStock,stockMin,stockMax,totalPrice}` are defined in B1 and consumed identically in G4/G5. `MarketTickEntry.stock` (C1) is read by E3/E4 and the memory adapter via `SimMarketEntry.stock` (E1). `MarketEntry.{stock,buyPrice,sellPrice,currentPrice}` (G1) is produced by `buildMarketEntry` (G2) and consumed by TradeForm/market-table/stock-chart/comparison (I2–I5) and the trade hooks (unchanged — they pass `updatedMarket` through). `MarketUpdate.stock` is consistent across both world interfaces (E2/F1) and all four adapters. ✅

**Scope:** Honors the user's decisions — one PR-2, UI moved to stock language now, mechanical target derivation — so PR 3 is calibration + docs. Build order keeps Groups A–C green, isolates the breaking schema change to D, and gates full green at J2. ✅
