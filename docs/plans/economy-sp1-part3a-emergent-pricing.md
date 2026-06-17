# SP1 Part 3a — Emergent Pricing Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global per-good pricing anchor (`CALIBRATED_TARGET_STOCK`) with a per-system **days-of-supply** reference, so market price becomes a readout of physical state (`stock` relative to local demand) instead of a hand-tuned constant.

**Architecture:** Days-of-supply is the *same* power-law curve already in use, with a per-system reference replacing the global anchor: `reference = TARGET_COVER × demandRate × anchorMult`, `price = basePrice × (reference / stock)^k`. `demandRate` (`= max(perCapitaNeed × population, MIN_DEMAND)`) is stored as a new `StationMarket.demandRate` column — mirroring the existing `anchorMult` column — written at seed time and threaded into every price-curve build site. `midPriceAt`, integrated slippage, the bid-ask spread, and the round-trip-exploit guard are untouched (identical curve shape). This is Part 3a: the cutover. Part 3b (separate PR) calibrates `TARGET_COVER` via the simulator and rewrites the active `economy.md`.

**Tech Stack:** Next.js 16, TypeScript 5 (strict), PostgreSQL via Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), Vitest 4.

**Design source of truth:** `docs/planned/economy-simulation-substrate.md` §8.2 (locked design).

## Global Constraints

- **No `as` type assertions** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown`** anywhere except immediately-narrowed `JSON.parse` at boundaries. Use typed unions / Prisma-generated types.
- **Typed keys** — maps use union keys from constants/types, never `Record<string, unknown>`.
- **`noUnusedLocals` + `noUnusedParameters` are ON** — a dead param or unused local is a `tsc` error. Dropping `goodId` from `curveForGood` therefore forces removing any `goodKey` local that was only feeding it. `tsc --noEmit` will flag each one; remove them.
- **Engine functions are pure** (no DB imports) and tested with Vitest. `lib/constants/market-economy.ts` may import `lib/engine/physical-economy` (it already does); it must NOT import `lib/engine/market-pricing` (would cycle).
- **Schema workflow is `db push`** (no `prisma/migrations` dir). After a schema edit: `npx prisma db push` then `npx prisma generate`.
- **Prisma singleton** in `lib/prisma.ts`; client imported from `@/app/generated/prisma/client`.
- **Run unit tests with** `npx vitest run`. Type-check with `npx tsc --noEmit`.
- **Branch:** work on a phase branch off the shared `feat/economy-simulation` branch; PR into the shared branch when 3a is green. Atomic per-task commits.
- **First-draft constants** (`TARGET_COVER`, `MIN_DEMAND`, the seed-cover band) are placeholders here; Part 3b calibrates them via `npm run simulate`. Tests must assert against the *imported* constants, never hardcode their numeric values, so they survive 3b recalibration.

---

## Task 1: Add the `demandRate` column to `StationMarket`

**Files:**
- Modify: `prisma/schema.prisma` (model `StationMarket`, around line 331-343)

**Interfaces:**
- Produces: a `demandRate Float @default(1)` column on `StationMarket`, available on every loaded market row (mirrors `anchorMult`).

- [ ] **Step 1: Add the column**

In `prisma/schema.prisma`, change the `StationMarket` model from:

```prisma
model StationMarket {
  id        String   @id @default(cuid())
  stationId String
  goodId    String
  stock      Float
  anchorMult Float    @default(1)
  updatedAt  DateTime @updatedAt
```

to:

```prisma
model StationMarket {
  id        String   @id @default(cuid())
  stationId String
  goodId    String
  stock      Float
  anchorMult Float    @default(1)
  /** Per-capita-need × population (floored) — the days-of-supply denominator. Static while population is static; seed-written. */
  demandRate Float    @default(1)
  updatedAt  DateTime @updatedAt
```

- [ ] **Step 2: Push the schema and regenerate the client**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." (the column is added; existing rows get the default `1`).

Run: `npx prisma generate`
Expected: client regenerated; the `StationMarket` type now has `demandRate: number`.

- [ ] **Step 3: Verify the type-check still passes**

Run: `npx tsc --noEmit`
Expected: PASS (no code references the column yet).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(economy): add StationMarket.demandRate column for days-of-supply pricing"
```

---

## Task 2: Pricing constants + `marketDemandRate` helper

**Files:**
- Modify: `lib/constants/market-economy.ts`
- Test: `lib/constants/__tests__/market-economy.test.ts`

**Interfaces:**
- Consumes: `physicalRates` from `@/lib/engine/physical-economy` (already imported), `ResourceVector` from `@/lib/types/game` (already imported).
- Produces:
  - `export const TARGET_COVER: number` — days of cover at which `mid === basePrice`.
  - `export const MIN_DEMAND: number` — floor on the days-of-supply denominator.
  - `export function marketDemandRate(aggregate: ResourceVector, population: number, goodId: string): number` — `max(physicalRates(...).consumption, MIN_DEMAND)`.

- [ ] **Step 1: Write the failing test**

Add to `lib/constants/__tests__/market-economy.test.ts` (import `marketDemandRate`, `MIN_DEMAND` from `../market-economy`; the file already has a `makeResourceVector` helper used by the `getInitialStock` tests):

```typescript
import { marketDemandRate, MIN_DEMAND } from "../market-economy";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";

describe("marketDemandRate", () => {
  it("returns per-capita-need × population for a populated system", () => {
    const rate = marketDemandRate(makeResourceVector({}), 1000, "water");
    expect(rate).toBeCloseTo(GOOD_CONSUMPTION.water * 1000);
  });

  it("scales linearly with population", () => {
    const low = marketDemandRate(makeResourceVector({}), 500, "food");
    const high = marketDemandRate(makeResourceVector({}), 1000, "food");
    expect(high).toBeCloseTo(low * 2);
  });

  it("floors at MIN_DEMAND for a zero-population system", () => {
    expect(marketDemandRate(makeResourceVector({}), 0, "luxuries")).toBe(MIN_DEMAND);
  });

  it("floors at MIN_DEMAND for an unknown good", () => {
    expect(marketDemandRate(makeResourceVector({}), 1000, "not_a_good")).toBe(MIN_DEMAND);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/constants/__tests__/market-economy.test.ts -t marketDemandRate`
Expected: FAIL — `marketDemandRate` / `MIN_DEMAND` not exported.

- [ ] **Step 3: Add the constants and helper**

In `lib/constants/market-economy.ts`, just below the existing `DEFAULT_SPREAD` constant (line ~16), add:

```typescript
/**
 * Days of cover (stock ÷ local demand rate) at which a good's mid price equals
 * its basePrice. The single global reference that replaces the per-good anchor
 * table — per-good market depth now emerges from per-good demand rates.
 * First-draft; Part 3b calibrates this via `npm run simulate`.
 */
export const TARGET_COVER = 50;

/**
 * Floor on the days-of-supply denominator so a near-empty system yields a finite
 * cover instead of a divide-by-zero / zero reference. First-draft; calibrated in 3b.
 */
export const MIN_DEMAND = 0.05;
```

Then add the helper (place it near `getInitialStock`, after `getTargetStock`):

```typescript
/**
 * The per-market demand rate — the days-of-supply denominator. Equals the
 * system's base physical consumption for the good (perCapitaNeed × population),
 * floored at MIN_DEMAND. Government consumptionBoost and prosperity are
 * deliberately excluded: they move price through stock, not through the
 * reference. Stored on StationMarket.demandRate and used to build the price curve.
 */
export function marketDemandRate(
  aggregate: ResourceVector,
  population: number,
  goodId: string,
): number {
  const { consumption } = physicalRates(goodId, aggregate, population);
  return Math.max(consumption, MIN_DEMAND);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/constants/__tests__/market-economy.test.ts -t marketDemandRate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/market-economy.ts lib/constants/__tests__/market-economy.test.ts
git commit -m "feat(economy): add TARGET_COVER, MIN_DEMAND, and marketDemandRate helper"
```

---

## Task 3: Plumb `demandRate` through every data carrier (no pricing change yet)

This task adds a required `demandRate` field to every market-shaped type and populates it everywhere a market object is constructed. `curveForGood` is NOT changed yet, so the field is carried but not yet consumed by pricing — the build stays green.

**Files:**
- Modify: `lib/engine/simulator/types.ts` (`SimMarketEntry`)
- Modify: `lib/tick/world/trade-flow-world.ts` (`MarketSnapshot`)
- Modify: `lib/tick/world/snapshots-world.ts` (`MarketView`)
- Modify: `lib/engine/snapshot.ts` (`MarketInput`)
- Modify: `lib/tick/adapters/prisma/trade-flow.ts` (map the column)
- Modify: `lib/tick/adapters/memory/trade-flow.ts` (map from `SimMarketEntry`)
- Modify: `lib/tick/adapters/prisma/snapshots.ts` (add `demandRate: true` to the `select`, map it)
- Modify: `lib/engine/simulator/world.ts` (compute via `marketDemandRate`)
- Modify: `prisma/seed.ts` (seed-write the column)
- Modify: `lib/test-utils/fixtures.ts` (seed-write the column)
- Test fixtures to update: `lib/engine/simulator/__tests__/market-analysis.test.ts`, `lib/tick/processors/__tests__/trade-flow.test.ts`, `lib/tick/processors/__tests__/price-snapshots.test.ts`, `lib/tick/processors/__tests__/events.test.ts`, `lib/engine/__tests__/trade-flow-integration.test.ts`, `lib/engine/__tests__/snapshot.test.ts`

**Interfaces:**
- Consumes: `marketDemandRate` (Task 2), the `StationMarket.demandRate` column (Task 1).
- Produces: a populated `demandRate: number` on `SimMarketEntry`, `MarketSnapshot`, `MarketView` (snapshots), and `MarketInput`.

- [ ] **Step 1: Add `demandRate` to the four carrier interfaces**

`lib/engine/simulator/types.ts` — in `SimMarketEntry` (after `anchorMult`):
```typescript
  /** Stored pricing-anchor multiplier (1 = none); written by the economy processor. */
  anchorMult: number;
  /** Per-capita-need × population (floored) — the days-of-supply pricing denominator. */
  demandRate: number;
```

`lib/tick/world/trade-flow-world.ts` — in `MarketSnapshot` (after `anchorMult`):
```typescript
  /** Stored pricing-anchor multiplier (1 = none). */
  anchorMult: number;
  /** Days-of-supply pricing denominator (perCapitaNeed × population, floored). */
  demandRate: number;
```

`lib/tick/world/snapshots-world.ts` — in `MarketView` (after `anchorMult`):
```typescript
  stock: number;
  anchorMult: number;
  /** Days-of-supply pricing denominator (perCapitaNeed × population, floored). */
  demandRate: number;
  basePrice: number;
```

`lib/engine/snapshot.ts` — in `MarketInput` (after `anchorMult?`):
```typescript
  /** Stored pricing-anchor multiplier (1 = none). */
  anchorMult?: number;
  /** Days-of-supply pricing denominator (perCapitaNeed × population, floored). */
  demandRate: number;
```

- [ ] **Step 2: Populate `demandRate` in the adapters**

`lib/tick/adapters/prisma/trade-flow.ts` — the query uses `include:`, so `m.demandRate` is already returned. In the `rows.map(...)` (lines ~105-114) add the field:
```typescript
      stock: m.stock,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
      priceFloor: m.good.priceFloor,
```

`lib/tick/adapters/memory/trade-flow.ts` — in the `snapshots.push({...})` (lines ~106-115) add:
```typescript
      stock: m.stock,
      anchorMult: m.anchorMult,
      demandRate: m.demandRate,
      priceFloor: m.priceFloor,
```

`lib/tick/adapters/prisma/snapshots.ts` — this query uses an explicit `select:`. Add `demandRate: true` to it (after `anchorMult: true`):
```typescript
    select: {
      stock: true,
      anchorMult: true,
      demandRate: true,
      good: {
```
and in the `rows.map(...)` (after `anchorMult: r.anchorMult`):
```typescript
      stock: r.stock,
      anchorMult: r.anchorMult,
      demandRate: r.demandRate,
      basePrice: r.good.basePrice,
```

- [ ] **Step 3: Compute `demandRate` where markets are seeded/built**

`lib/engine/simulator/world.ts` — import the helper and set the field. At the top add to the existing market-economy import:
```typescript
import { getInitialStock, marketDemandRate } from "@/lib/constants/market-economy";
```
In the `markets.push({...})` (lines ~104-112) add:
```typescript
        stock: getInitialStock(sys.aggregate, sys.population, goodKey),
        anchorMult: 1,
        demandRate: marketDemandRate(sys.aggregate, sys.population, goodKey),
        priceFloor: goodConst?.priceFloor ?? goodDef.priceFloor,
```

`prisma/seed.ts` — add the helper to the import (line 5) and set the column in `marketData` (lines ~195-199):
```typescript
import { getInitialStock, marketDemandRate } from "@/lib/constants/market-economy";
```
```typescript
    return Object.entries(goodRecords).map(([goodKey, goodRec]) => ({
      stationId,
      goodId: goodRec.id,
      stock: getInitialStock(sys.aggregate, sys.population, goodKey),
      demandRate: marketDemandRate(sys.aggregate, sys.population, goodKey),
    }));
```

`lib/test-utils/fixtures.ts` — add `marketDemandRate` to the market-economy import and set it in the `stationMarket.create` (lines ~254-263):
```typescript
      data: {
        stationId,
        goodId: goodIds[key],
        stock: getInitialStock(aggregate, population, key),
        demandRate: marketDemandRate(aggregate, population, key),
      },
```

- [ ] **Step 4: Add `demandRate` to the unit-test fixtures that construct carriers**

Each of these builds a `SimMarketEntry` / `MarketView` / `MarketInput` literal and will now fail `tsc`. Add `demandRate` to each fixture. A literal value is fine for these unit fixtures (they assert relative behaviour, not absolute prices) — use `demandRate: 1` unless the test needs per-good differentiation.

`lib/engine/simulator/__tests__/market-analysis.test.ts` — `market(...)` helper:
```typescript
  return { systemId, goodId, basePrice: 100, stock, anchorMult: 1, demandRate: 1, priceFloor: 0.2, priceCeiling: 5.0 };
```

`lib/tick/processors/__tests__/trade-flow.test.ts` — `makeMarket(...)`:
```typescript
    stock,
    anchorMult: 1,
    demandRate: 1,
    priceFloor: 0.2,
```

`lib/tick/processors/__tests__/events.test.ts` — `makeMarket(...)`:
```typescript
    stock,
    anchorMult: 1,
    demandRate: 1,
    priceFloor: 0.2,
```

`lib/tick/processors/__tests__/price-snapshots.test.ts` — `makeMarket(...)`:
```typescript
    stock,
    anchorMult: 1,
    demandRate: 1,
    basePrice: 100,
```

`lib/engine/__tests__/trade-flow-integration.test.ts` — the `markets.push({...})`:
```typescript
    stock: isProducer ? 120 : 20,
    anchorMult: 1,
    demandRate: 1,
    priceFloor: 0.2,
```

`lib/engine/__tests__/snapshot.test.ts` — the `MarketInput[]` fixture; add `demandRate: 1` to each entry:
```typescript
const markets: MarketInput[] = [
  { systemId: "sys-1", goodId: "food", stock: 100, basePrice: 20, demandRate: 1 },
  { systemId: "sys-1", goodId: "water", stock: 50, basePrice: 40, demandRate: 1 },
  { systemId: "sys-2", goodId: "food", stock: 200, basePrice: 20, demandRate: 1 },
];
```

- [ ] **Step 5: Verify type-check and full suite pass**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS (behaviour unchanged — `demandRate` is carried but not yet consumed by pricing).

- [ ] **Step 6: Commit**

```bash
git add lib/engine/simulator/types.ts lib/tick/world/trade-flow-world.ts lib/tick/world/snapshots-world.ts lib/engine/snapshot.ts lib/tick/adapters/prisma/trade-flow.ts lib/tick/adapters/memory/trade-flow.ts lib/tick/adapters/prisma/snapshots.ts lib/engine/simulator/world.ts prisma/seed.ts lib/test-utils/fixtures.ts lib/engine/simulator/__tests__/market-analysis.test.ts lib/tick/processors/__tests__/trade-flow.test.ts lib/tick/processors/__tests__/events.test.ts lib/tick/processors/__tests__/price-snapshots.test.ts lib/engine/__tests__/trade-flow-integration.test.ts lib/engine/__tests__/snapshot.test.ts
git commit -m "feat(economy): carry demandRate through every market data structure"
```

---

## Task 4: Flip `curveForGood` to days-of-supply + thread all call sites

The atomic cutover. `curveForGood` drops its `goodId` parameter, takes a required `demandRate`, and computes the per-system reference. Every call site is updated to the new signature, passing the `demandRate` now carried by Task 3. `getTargetStock` / `CALIBRATED_TARGET_STOCK` stay alive for now (only `computeStockDrift` and the `market-economy` test still use them — deleted in Task 5).

**Files:** `lib/engine/market-pricing.ts`, `lib/services/market-entry.ts`, `lib/services/market.ts`, `lib/services/market-comparison.ts`, `lib/services/convoy-trade.ts`, `lib/services/trade.ts`, `lib/services/cantina.ts`, `lib/services/missions.ts`, `lib/services/dev-tools.ts`, `lib/tick/processors/trade-flow.ts`, `lib/tick/adapters/prisma/trade-missions.ts`, `lib/engine/snapshot.ts`, `lib/engine/simulator/bot.ts`, `lib/engine/simulator/event-analysis.ts`, `lib/engine/simulator/strategies/helpers.ts`, `lib/engine/simulator/market-analysis.ts`; tests: `lib/engine/__tests__/market-pricing.test.ts`, `lib/services/__tests__/market-entry.test.ts`, `lib/engine/simulator/__tests__/market-analysis.test.ts`, `lib/engine/__tests__/simulator-integration.test.ts`, `lib/services/__tests__/integration/trade.integration.test.ts`, `lib/services/__tests__/integration/missions.integration.test.ts`

**Interfaces:**
- Produces (the new signatures every caller relies on):
  - `curveForGood(basePrice: number, floorMult: number, ceilingMult: number, demandRate: number, anchorMult?: number): MarketCurve`
  - `curveForGoodRow(good: PricedGood, demandRate: number, anchorMult?: number): { goodKey: string; curve: MarketCurve }`
  - `buildMarketEntry(goodId: string, good: PricedGood, stock: number, demandRate: number, govDef?: GovernmentDefinition, anchorMult?: number): MarketEntry`

- [ ] **Step 1: Write the failing engine test**

Replace the `describe("curveForGood", ...)` block in `lib/engine/__tests__/market-pricing.test.ts` (lines ~179-206, and update its imports at the top of that block) with:

```typescript
import { curveForGood } from "../market-pricing";
import { TARGET_COVER } from "@/lib/constants/market-economy";

describe("curveForGood", () => {
  it("anchors the curve at TARGET_COVER × demandRate (per-system reference)", () => {
    const curve = curveForGood(25, 0.5, 2.0, 3);
    expect(curve).toEqual({
      basePrice: 25,
      targetStock: TARGET_COVER * 3,
      k: 1,
      floorMult: 0.5,
      ceilingMult: 2.0,
    });
  });

  it("prices at base when stock equals the per-system reference", () => {
    const demandRate = 3;
    const curve = curveForGood(25, 0.5, 2.0, demandRate);
    expect(midPriceAt(curve, TARGET_COVER * demandRate)).toBe(25);
  });

  it("scales the reference by anchorMult", () => {
    const base = curveForGood(25, 0.5, 2.0, 3);
    const shifted = curveForGood(25, 0.5, 2.0, 3, 2);
    expect(shifted.targetStock).toBeCloseTo(base.targetStock * 2);
  });

  it("a higher demandRate gives a deeper market (higher reference)", () => {
    const thin = curveForGood(25, 0.5, 2.0, 1);
    const deep = curveForGood(25, 0.5, 2.0, 8);
    expect(deep.targetStock).toBeGreaterThan(thin.targetStock);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts -t curveForGood`
Expected: FAIL — `curveForGood` still has the old signature / imports `getTargetStock`.

- [ ] **Step 3: Reframe `curveForGood`**

In `lib/engine/market-pricing.ts`, change the import (line 1) from:
```typescript
import { DEFAULT_ELASTICITY, getTargetStock } from "@/lib/constants/market-economy";
```
to:
```typescript
import { DEFAULT_ELASTICITY, TARGET_COVER } from "@/lib/constants/market-economy";
```
Replace `curveForGood` (lines 102-123) with:
```typescript
/**
 * Build a MarketCurve for a good from its DB/definition fields. The reference
 * stock (where mid === basePrice) is the per-system days-of-supply anchor:
 * `TARGET_COVER × demandRate × anchorMult`. `demandRate` is the market's stored
 * local demand rate (perCapitaNeed × population, floored); `anchorMult` (default
 * 1) carries active anchor_shift events. See economy-simulation-substrate.md §8.2.
 */
export function curveForGood(
  basePrice: number,
  floorMult: number,
  ceilingMult: number,
  demandRate: number,
  anchorMult: number = 1,
): MarketCurve {
  return {
    basePrice,
    targetStock: TARGET_COVER * demandRate * anchorMult,
    k: DEFAULT_ELASTICITY,
    floorMult,
    ceilingMult,
  };
}
```

- [ ] **Step 4: Run the engine test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts -t curveForGood`
Expected: PASS. (The rest of the repo now fails `tsc` — fixed in the next steps.)

- [ ] **Step 5: Update the central funnel (`market-entry.ts`)**

In `lib/services/market-entry.ts`, replace `curveForGoodRow` and `buildMarketEntry` (lines 20-62) with:
```typescript
/** Resolve the canonical good key + price curve for a DB good row. */
export function curveForGoodRow(
  good: PricedGood,
  demandRate: number,
  anchorMult: number = 1,
): { goodKey: string; curve: MarketCurve } {
  const goodKey = GOOD_NAME_TO_KEY.get(good.name) ?? good.name;
  return {
    goodKey,
    curve: curveForGood(good.basePrice, good.priceFloor, good.priceCeiling, demandRate, anchorMult),
  };
}

/**
 * Build a display MarketEntry from a market row's stock + good. The single-unit
 * buy/sell prices use the bid-ask spread for the system's government; the
 * integrated-slippage total for a real trade is computed separately in
 * executeTrade. `stock` is floored so the player never sees fractional goods.
 *
 * `demandRate` is the market row's stored days-of-supply denominator; `anchorMult`
 * its stored anchor-shift multiplier (default 1). The resulting `targetStock` is
 * the per-system reference, exposed on the entry so the client reproduces the
 * exact curve for quote previews.
 */
export function buildMarketEntry(
  goodId: string,
  good: PricedGood,
  stock: number,
  demandRate: number,
  govDef?: GovernmentDefinition,
  anchorMult: number = 1,
): MarketEntry {
  const { curve } = curveForGoodRow(good, demandRate, anchorMult);
  const spread = getSpread(govDef);
  return {
    goodId,
    goodName: good.name,
    basePrice: good.basePrice,
    currentPrice: spotPrice(curve, stock),
    buyPrice: quoteTrade(curve, stock, 1, "buy", spread).totalPrice,
    sellPrice: quoteTrade(curve, stock, 1, "sell", spread).totalPrice,
    stock: Math.floor(stock),
    priceFloor: good.priceFloor,
    priceCeiling: good.priceCeiling,
    targetStock: curve.targetStock,
    spread,
  };
}
```

- [ ] **Step 6: Update the service call sites**

`lib/services/market.ts` (line ~37) — pass `m.demandRate`:
```typescript
  const entries: MarketEntry[] = marketEntries.map((m) =>
    buildMarketEntry(m.good.id, m.good, m.stock, m.demandRate, govDef, m.anchorMult),
  );
```

`lib/services/market-comparison.ts` — add `demandRate: true` to the `select` (after `anchorMult: true`, line ~45):
```typescript
    select: {
      stock: true,
      anchorMult: true,
      demandRate: true,
      station: { select: { systemId: true } },
    },
```
and update the curve build (line ~55), dropping the now-unused `goodKey` (line ~50) which `tsc` will flag:
```typescript
  const entries: MarketComparisonEntry[] = markets.map((m) => ({
    systemId: m.station.systemId,
    basePrice: good.basePrice,
    currentPrice: spotPrice(curveForGood(good.basePrice, good.priceFloor, good.priceCeiling, m.demandRate, m.anchorMult), m.stock),
    stock: Math.floor(m.stock),
  }));
```
(Remove the `const goodKey = GOOD_NAME_TO_KEY.get(good.name) ?? good.id;` line and its now-unused `GOOD_NAME_TO_KEY` import if nothing else uses it — `tsc` will tell you.)

`lib/services/convoy-trade.ts` — the `curveForGood(...)` (lines ~119-125):
```typescript
  const curve = curveForGood(
    marketEntry.good.basePrice,
    marketEntry.good.priceFloor,
    marketEntry.good.priceCeiling,
    marketEntry.demandRate,
    marketEntry.anchorMult,
  );
```
and the `buildMarketEntry(...)` (lines ~335-341):
```typescript
      updatedMarket: buildMarketEntry(
        updatedMarket.goodId,
        updatedMarket.good,
        updatedMarket.stock,
        updatedMarket.demandRate,
        govDef,
        updatedMarket.anchorMult,
      ),
```
(If `goodKey` becomes unused after the curve change, remove its declaration — `tsc` will flag it.)

`lib/services/trade.ts` — the `curveForGood(...)` (lines ~96-102):
```typescript
  const curve = curveForGood(
    marketEntry.good.basePrice,
    marketEntry.good.priceFloor,
    marketEntry.good.priceCeiling,
    marketEntry.demandRate,
    marketEntry.anchorMult,
  );
```
and the `buildMarketEntry(...)` (lines ~285-291):
```typescript
      updatedMarket: buildMarketEntry(
        updatedMarket.goodId,
        updatedMarket.good,
        updatedMarket.stock,
        updatedMarket.demandRate,
        govDef,
        updatedMarket.anchorMult,
      ),
```
(Remove `goodKey` if it becomes unused.)

`lib/services/cantina.ts` (line ~85) — pass `m.demandRate`:
```typescript
        const entries: MarketEntry[] = station.markets.map((m) =>
          buildMarketEntry(m.good.id, m.good, m.stock, m.demandRate, govDef, m.anchorMult),
        );
```

`lib/services/missions.ts` — `buildPriceLookup` (lines ~102-105):
```typescript
    const price = spotPrice(
      curveForGood(entry.good.basePrice, entry.good.priceFloor, entry.good.priceCeiling, entry.demandRate, entry.anchorMult),
      entry.stock,
    );
```
and `deliverMission` (lines ~351-354):
```typescript
    const freshUnitPrice = spotPrice(
      curveForGood(freshMarket.good.basePrice, freshMarket.good.priceFloor, freshMarket.good.priceCeiling, freshMarket.demandRate, freshMarket.anchorMult),
      freshMarket.stock,
    );
```
(Remove the `goodKey` locals at lines ~101 and ~350 if they become unused — `tsc` will flag them.)

`lib/services/dev-tools.ts` — `getEconomySnapshot` (line ~259):
```typescript
        price: spotPrice(curveForGood(m.good.basePrice, m.good.priceFloor, m.good.priceCeiling, m.demandRate, m.anchorMult), m.stock),
```
(Remove the `goodKey` local at line ~253 if unused.)

- [ ] **Step 7: Update the tick-side pricing call sites**

`lib/tick/processors/trade-flow.ts` (lines ~132-139):
```typescript
      const priceA = spotPrice(
        curveForGood(mA.basePrice, mA.priceFloor, mA.priceCeiling, mA.demandRate, mA.anchorMult),
        mA.stock,
      );
      const priceB = spotPrice(
        curveForGood(mB.basePrice, mB.priceFloor, mB.priceCeiling, mB.demandRate, mB.anchorMult),
        mB.stock,
      );
```
(`goodId` is still used elsewhere in this processor for keying — leave it; only the `curveForGood` argument list changes.)

`lib/tick/adapters/prisma/trade-missions.ts` (lines ~66-69) — keep `goodKey` (it feeds `MarketPriceView.goodId`), just change the curve args:
```typescript
        currentPrice: spotPrice(
          curveForGood(m.good.basePrice, m.good.priceFloor, m.good.priceCeiling, m.demandRate, m.anchorMult),
          m.stock,
        ),
```

`lib/engine/snapshot.ts` — `buildPriceEntry` (line 38). `m.goodId` is still used on the next line, so keep it; only the curve args change:
```typescript
      const curve = curveForGood(m.basePrice, m.priceFloor ?? 0.2, m.priceCeiling ?? 5.0, m.demandRate, m.anchorMult ?? 1);
```

- [ ] **Step 8: Update the simulator pricing call sites**

`lib/engine/simulator/bot.ts` — both sites (lines ~64 and ~108):
```typescript
    const price = spotPrice(curveForGood(market.basePrice, market.priceFloor, market.priceCeiling, market.demandRate, market.anchorMult), market.stock);
```
```typescript
      const price = spotPrice(curveForGood(buyMarket.basePrice, buyMarket.priceFloor, buyMarket.priceCeiling, buyMarket.demandRate, buyMarket.anchorMult), buyMarket.stock);
```

`lib/engine/simulator/event-analysis.ts` (line ~32) — `m.goodId` still used on the line above, keep it:
```typescript
      price: spotPrice(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock),
```

`lib/engine/simulator/strategies/helpers.ts` — `getPrice` (line ~18):
```typescript
export function getPrice(m: SimMarketEntry): number {
  return spotPrice(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock);
}
```

`lib/engine/simulator/market-analysis.ts` — `takeMarketSnapshot` (line ~22) and `computePriceDispersion` (line ~47). (Leave `computeStockDrift` and the `getTargetStock` import for Task 5.)
```typescript
    price: spotPrice(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock),
```
```typescript
    const price = spotPrice(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock);
```

- [ ] **Step 9: Update the remaining tests that call `curveForGood` / `buildMarketEntry` / `curveForGoodRow`**

`lib/services/__tests__/market-entry.test.ts` — update the `curveForGoodRow` and `buildMarketEntry` describe blocks (lines ~24-116). Pass a `demandRate` (e.g. `7`) and assert the reference is `TARGET_COVER × demandRate × anchorMult`. Import `TARGET_COVER` from `@/lib/constants/market-economy`. Representative rewrite:
```typescript
import { TARGET_COVER } from "@/lib/constants/market-economy";

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
```
In the `buildMarketEntry` block, update its local `curve` and every `buildMarketEntry(...)` call to thread a `demandRate` (the `curve` must be built with the same `demandRate` the entry uses, e.g.):
```typescript
  const demandRate = 7;
  const curve = curveForGood(FOOD.basePrice, FOOD.priceFloor, FOOD.priceCeiling, demandRate);
  // ...
    const entry = buildMarketEntry("good-1", FOOD, stock, demandRate);
  // ... and the anchorMult variant:
    const entry = buildMarketEntry("good-1", FOOD, stock, demandRate, undefined, 2);
```

`lib/engine/simulator/__tests__/market-analysis.test.ts` — the `takeMarketSnapshot` assertion (line ~45):
```typescript
      spotPrice(curveForGood(100, 0.2, 5.0, 1), 200),
```
(The `market(...)` fixture already carries `demandRate: 1` from Task 3, so the snapshot price uses `demandRate: 1`; match it here.)

`lib/engine/__tests__/simulator-integration.test.ts` — both sites (lines ~135 and ~148):
```typescript
            spotPrice(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock),
```
```typescript
          const after = spotPrice(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock);
```

`lib/services/__tests__/integration/trade.integration.test.ts` (line ~22) — the loaded `good` row plus the market's `demandRate`. The market is loaded as `marketBefore`/equivalent in this test; pass its `demandRate`:
```typescript
  const curve = curveForGood(good.basePrice, good.priceFloor, good.priceCeiling, market.demandRate, market.anchorMult);
```
(Use whatever the local market-row variable is named; ensure the test's market query returns the row with `demandRate` — `include`/default selection already does.)

`lib/services/__tests__/integration/missions.integration.test.ts` (lines ~137-145):
```typescript
      const expectedUnitPrice = spotPrice(
        curveForGood(
          marketBefore!.good.basePrice,
          marketBefore!.good.priceFloor,
          marketBefore!.good.priceCeiling,
          marketBefore!.demandRate,
          marketBefore!.anchorMult,
        ),
        marketBefore!.stock,
      );
```

- [ ] **Step 10: Verify type-check and full suite pass**

Run: `npx tsc --noEmit`
Expected: PASS. If it flags an unused `goodKey` local or `GOOD_NAME_TO_KEY` import, remove it.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(economy): price markets on per-system days-of-supply"
```

---

## Task 5: Retire the global anchor (`getTargetStock` / `CALIBRATED_TARGET_STOCK`)

After Task 4, the only remaining users of `getTargetStock` are the simulator's `computeStockDrift` and the `market-economy` test. Repoint the drift report at the per-system reference, then delete the anchor table and function.

**Files:**
- Modify: `lib/engine/simulator/market-analysis.ts`
- Modify: `lib/constants/market-economy.ts`
- Modify: `lib/constants/__tests__/market-economy.test.ts`
- Test: `lib/engine/simulator/__tests__/market-analysis.test.ts`

- [ ] **Step 1: Repoint `computeStockDrift` at the per-system reference**

In `lib/engine/simulator/market-analysis.ts`, remove the `getTargetStock` import (line 10). In `computeStockDrift` (lines ~73-96), replace `const drift = m.stock - getTargetStock(m.goodId);` with the per-market reference read off the curve:
```typescript
  for (const m of world.markets) {
    const reference = curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult).targetStock;
    const drift = m.stock - reference;
```
Update the function's doc comment to say drift is measured against each market's per-system days-of-supply reference, not a global anchor.

- [ ] **Step 2: Update the stock-drift test**

In `lib/engine/simulator/__tests__/market-analysis.test.ts`, remove the `getTargetStock` import and rewrite the "stock drift" test to compute the expected reference from the fixture's `demandRate` via `curveForGood(...).targetStock` (or assert relative ordering/signing). Example shape — since the `market(...)` fixture uses `basePrice: 100, demandRate: 1, anchorMult: 1`, the reference is `curveForGood(100, 0.2, 5.0, 1).targetStock` for every good:
```typescript
import { curveForGood } from "@/lib/engine/market-pricing";

it("averages drift per good, signs it vs the per-system reference, and sorts by |drift|", () => {
  const { stockDrift } = computeMarketHealth(
    world([
      market("sys-1", "water", 200),
      market("sys-2", "water", 140),
      market("sys-1", "luxuries", 20),
    ]),
  );
  const reference = curveForGood(100, 0.2, 5.0, 1).targetStock;
  const expectedWater = (200 + 140) / 2 - reference;
  const expectedLux = 20 - reference;
  // ...assert stockDrift entries match expectedWater / expectedLux and sort by |drift|.
});
```

- [ ] **Step 3: Delete the anchor table, function, and its test**

In `lib/constants/market-economy.ts`, delete `CALIBRATED_TARGET_STOCK` (lines ~22-48) and `getTargetStock` (lines ~50-61). Leave `getInitialStock` for Task 6 (it still references `getTargetStock` — so this step will not compile until you also do Task 6 Step 1; do them together, or temporarily inline the fallback). To keep this task green on its own, in the same edit replace `getInitialStock`'s two `return getTargetStock(goodId);` lines with `return Math.round((STOCK_MIN + STOCK_MAX) / 2);` as an interim fallback (Task 6 rewrites the whole function).

In `lib/constants/__tests__/market-economy.test.ts`, delete the entire `describe("getTargetStock", ...)` block and remove `getTargetStock` from the imports.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: PASS (no remaining references to `getTargetStock` / `CALIBRATED_TARGET_STOCK`).

Run: `npx vitest run lib/engine/simulator/__tests__/market-analysis.test.ts lib/constants/__tests__/market-economy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/simulator/market-analysis.ts lib/constants/market-economy.ts lib/constants/__tests__/market-economy.test.ts lib/engine/simulator/__tests__/market-analysis.test.ts
git commit -m "feat(economy): retire the global pricing anchor (getTargetStock/CALIBRATED_TARGET_STOCK)"
```

---

## Task 6: Cover-based seeding + delete the `equilibrium` seed pair

Rewrite `getInitialStock` to seed each market around its per-system reference scaled by net balance, and delete the now-unused `equilibrium` field from the good definitions.

**Files:**
- Modify: `lib/constants/market-economy.ts`
- Modify: `lib/constants/goods.ts`
- Test: `lib/constants/__tests__/market-economy.test.ts`

**Interfaces:**
- Produces: `getInitialStock(aggregate: ResourceVector, population: number, goodId: string): number` — signature unchanged; body now derives from the per-system reference (no `equilibrium`).

- [ ] **Step 1: Write the failing seeding tests**

Replace the `describe("getInitialStock", ...)` block in `lib/constants/__tests__/market-economy.test.ts` with reference-relative assertions (import `TARGET_COVER`, `marketDemandRate`, `STOCK_MIN`, `STOCK_MAX`):
```typescript
describe("getInitialStock", () => {
  it("seeds a net producer above its reference (deeper cover → cheap)", () => {
    // Water-rich, low-pop system: strong net water producer.
    const agg = makeResourceVector({ water: 12 });
    const reference = TARGET_COVER * marketDemandRate(agg, 100, "water");
    const seed = getInitialStock(agg, 100, "water");
    expect(seed).toBeGreaterThan(reference);
  });

  it("seeds a net consumer below its reference (shallower cover → dear)", () => {
    const agg = makeResourceVector({ water: 0 });
    const reference = TARGET_COVER * marketDemandRate(agg, 2000, "water");
    const seed = getInitialStock(agg, 2000, "water");
    expect(seed).toBeLessThan(reference);
  });

  it("a net producer seeds higher than a net consumer for the same good", () => {
    const producer = getInitialStock(makeResourceVector({ water: 12 }), 100, "water");
    const consumer = getInitialStock(makeResourceVector({ water: 0 }), 2000, "water");
    expect(producer).toBeGreaterThan(consumer);
  });

  it("clamps seeds to the stock band", () => {
    const seed = getInitialStock(makeResourceVector({ water: 0 }), 100000, "water");
    expect(seed).toBeGreaterThanOrEqual(STOCK_MIN);
    expect(seed).toBeLessThanOrEqual(STOCK_MAX);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/constants/__tests__/market-economy.test.ts -t getInitialStock`
Expected: FAIL (still references `equilibrium` / interim fallback behaviour).

- [ ] **Step 3: Rewrite `getInitialStock`**

In `lib/constants/market-economy.ts`, add the seed-cover band constants near `TARGET_COVER`:
```typescript
/** Seed-cover multipliers on the reference: pure consumer → SEED_COVER_MIN (dear), pure producer → SEED_COVER_MAX (cheap). First-draft; calibrated in 3b. */
export const SEED_COVER_MIN = 0.5;
export const SEED_COVER_MAX = 1.5;
```
Replace `getInitialStock` (lines ~63-84) with:
```typescript
/**
 * Initial stock for a market at seed/reset time, derived from the system's net
 * balance for the good around its per-system days-of-supply reference
 * (TARGET_COVER × demandRate). A net producer seeds with deeper cover (reads
 * cheap), a net consumer with shallower cover (reads dear); a balanced or inert
 * market seeds at the reference (reads at base price). Clamped to the stock band.
 */
export function getInitialStock(
  aggregate: ResourceVector,
  population: number,
  goodId: string,
): number {
  const reference = TARGET_COVER * marketDemandRate(aggregate, population, goodId);
  const { production, consumption } = physicalRates(goodId, aggregate, population);
  const total = production + consumption;

  const producerShare = total > 0 ? production / total : 0.5; // 1 producer, 0 consumer
  const coverMult = SEED_COVER_MIN + producerShare * (SEED_COVER_MAX - SEED_COVER_MIN);
  return Math.round(Math.max(STOCK_MIN, Math.min(STOCK_MAX, reference * coverMult)));
}
```
Remove the now-unused `GOODS` import from `lib/constants/market-economy.ts` if nothing else uses it (`tsc`/lint will flag it).

- [ ] **Step 4: Delete the `equilibrium` seed pair from the good definitions**

In `lib/constants/goods.ts`:
- Delete the `GoodEquilibrium` interface (lines 3-8).
- Delete the `/** Per-good equilibrium targets ... */` doc line and the `equilibrium: GoodEquilibrium;` field from `GoodDefinition` (lines 23-24).
- Delete the `equilibrium: { produces: …, consumes: … },` block from all 12 goods.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/constants/__tests__/market-economy.test.ts -t getInitialStock`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS (no remaining `equilibrium` / `GoodEquilibrium` references).

- [ ] **Step 6: Commit**

```bash
git add lib/constants/market-economy.ts lib/constants/goods.ts lib/constants/__tests__/market-economy.test.ts
git commit -m "feat(economy): cover-based market seeding; delete the equilibrium seed pair"
```

---

## Task 7: Reseed + full verification gate

No new code unless verification surfaces a problem. This is the gate before opening the 3a PR.

- [ ] **Step 1: Reseed the database** (schema + seeding changed → mandatory)

Run: `npx prisma db seed`
Expected: "Seeding complete!" with no errors. Every `StationMarket` row now has a `demandRate` and a cover-based `stock`.

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Full unit + processor suite**

Run: `npx vitest run`
Expected: PASS (all ~1000+ tests). Pay attention to the economy/trade-flow/snapshot/market suites.

- [ ] **Step 4: Simulator sanity check** (coarse — full calibration is 3b)

Run: `npm run simulate`
Expected: completes without errors; stocks land within `[5, 200]`; greedy strategy materially out-earns random. Note any goods pinned to the floor/ceiling for 3b to address via `TARGET_COVER` calibration — do NOT tune coefficients here.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run: `npm run dev`, open a market screen, confirm prices render, buy/sell quotes look sane, and the trade-form total preview matches. Confirm a populous core system reads dearer than a sparse frontier system for an imported good.

- [ ] **Step 6: Open the phase PR into the shared branch**

Push the phase branch and open a PR into `feat/economy-simulation`. Summarize the cutover; note that `TARGET_COVER` is a first-draft placeholder calibrated in Part 3b, and that `economy.md` is rewritten in 3b (still describes anchor pricing until then).

---

## Self-Review notes (coverage vs spec §8.2)

- §8.2.1 reframe (same curve, per-system reference) → Task 4.
- §8.2.2 `demandRate` = base physical demand, floored, excludes gov/prosperity → Task 2 (`marketDemandRate`). Stored column mirroring `anchorMult` → Task 1; seed-written → Task 3.
- §8.2.2 single global `TARGET_COVER` → Task 2; replaces `CALIBRATED_TARGET_STOCK` → Task 5.
- §8.2.3 cover-based seeding, deletes `equilibrium` → Task 6.
- §8.2.4 deletes `getTargetStock`/`CALIBRATED_TARGET_STOCK`/`equilibrium`; keeps slippage, spread, `STOCK_MIN/MAX`, `DEFAULT_ELASTICITY`, `anchorMult` (events) → Tasks 4-6 (kept items untouched).
- §8.2.7 reseed required, atomic cutover (no no-op intermediate) → Task 7; the green-per-commit ordering (additive plumbing in Tasks 1-3 before the flip in Task 4) is how this plan keeps each commit building despite the atomic signature change.
- Out of scope (population dynamics, build-space, event redesign) → not touched.
