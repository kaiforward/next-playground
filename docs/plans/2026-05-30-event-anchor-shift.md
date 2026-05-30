# Event Anchor-Shift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give events a working economy lever in the stock model — an `anchor_shift` modifier that multiplies a good's pricing anchor (`targetStock`) for the event's duration, raising/lowering price without moving stock — and delete the dead supply/demand-target + reversion machinery left over from the old dual model.

**Architecture:** The active anchor is stored per market as `StationMarket.anchorMult` (default 1). The economy processor recomputes it each tick from a system's active `anchor_shift` modifiers (same writer/cadence as `stock`) and writes it alongside stock. Reads stay pure: `curveForGood` gains an `anchorMult` param and derives `targetStock = getTargetStock(good) × anchorMult`. Legacy `demand_target`/`supply_target` event entries convert mechanically to one anchor per good via `anchorMult = demandTargetMult / supplyTargetMult`. See `docs/planned/stock-based-market-economy.md` §6.1.

**Tech Stack:** TypeScript (strict), Prisma 7 + PostgreSQL (driver adapter), Vitest 4. Live game and simulator run the same processor body and pricing functions.

---

## File Structure

**Engine / constants (pure):**
- `lib/engine/events.ts` — `AggregatedModifiers`, `ModifierCaps`, `aggregateModifiers`, `scaleValue` comment. Collapse supply/demand mults → one `anchorMult`; drop reversion.
- `lib/constants/events.ts` — `ModifierTemplate.type` union, `MODIFIER_CAPS`, and **all event definition modifier arrays** (the conversion).
- `lib/constants/market-economy.ts` — unchanged (`getTargetStock` stays the base anchor).
- `lib/engine/market-pricing.ts` — `curveForGood` gains `anchorMult` param.
- `lib/engine/market-tick-builder.ts` — `MarketTickInput.modifierCaps` shape only.
- `lib/utils/event-effects.ts` — `summarizePhaseEffects` reads `anchor_shift`.
- `lib/engine/snapshot.ts` — `MarketInput` gains optional `anchorMult`.

**Tick layer:**
- `lib/tick/world/economy-world.ts` — `MarketUpdate.anchorMult`; cap-shape on `MarketTickInput`/`EconomyProcessorParams`.
- `lib/tick/processors/economy.ts` — compute + write `anchorMult`.
- `lib/tick/adapters/prisma/economy.ts` — write `anchorMult` in `applyMarketUpdates`.
- `lib/tick/adapters/memory/economy.ts` — write `anchorMult` to `SimMarketEntry`.
- `lib/tick/world/trade-flow-world.ts` — `MarketSnapshot.anchorMult`.
- `lib/tick/adapters/prisma/trade-flow.ts` + `lib/tick/adapters/memory/trade-flow.ts` — populate it.
- `lib/tick/processors/trade-flow.ts` — pass it into `curveForGood`.
- `lib/tick/world/snapshots-world.ts` (`MarketView`) + `lib/tick/adapters/prisma/snapshots.ts` — populate `anchorMult` for price history.

**Services (read sites — thread `.anchorMult`):**
- `lib/services/trade.ts`, `convoy-trade.ts`, `missions.ts` (×2), `dev-tools.ts`
- `lib/tick/adapters/prisma/trade-missions.ts`

**Simulator:**
- `lib/engine/simulator/types.ts` — `SimMarketEntry.anchorMult`.
- `lib/engine/simulator/bot.ts` (×2), `strategies/helpers.ts`, `market-analysis.ts` (×2), `event-analysis.ts` — thread `m.anchorMult`.
- `lib/engine/simulator/constants.ts` — `modifierCaps` shape.

**Schema / docs:**
- `prisma/schema.prisma` — `StationMarket.anchorMult Float @default(1)`.
- `docs/active/gameplay/events.md`, `event-catalog.md`, `economy.md`.

**Tests touched:** `lib/engine/__tests__/events.test.ts`, `danger.test.ts`, `market-pricing.test.ts`; `lib/services/__tests__/market-entry.test.ts`; `lib/engine/__tests__/sim-constants.test.ts`; `lib/tick/processors/__tests__/integration/economy.integration.test.ts`.

---

## Conversion Reference Table (authoritative anchor values)

Rule: `anchorMult = demandTargetMult / supplyTargetMult` per good, rounded to 2 dp. Navigation `equilibrium_shift`/`danger_level` is unchanged. `rate_multiplier` is unchanged. **All `reversion_dampening` modifiers are removed.** `null` goodId = all-goods anchor (compounds onto per-good anchors in aggregation).

| Event | Phase | Anchor shifts (goodId → value) | reversion_dampening to remove |
|---|---|---|---|
| inner_system_conflict | tensions | fuel→1.4, machinery→1.5 | — |
| inner_system_conflict | escalation | fuel→1.8, machinery→1.8 | — |
| inner_system_conflict | active | fuel→2.5, machinery→2.0 | yes (0.3) |
| inner_system_conflict | aftermath | electronics→1.8, food→1.6 | — |
| inner_system_conflict | recovery | electronics→1.2, food→1.15 | — |
| plague | spreading | medicine→2.0 | yes (0.5) |
| plague | containment | medicine→1.6 | — |
| plague | recovery | — | yes (0.5) |
| trade_festival | festival | luxuries→2.0, food→1.4, null→1.2 | — |
| conflict_spillover | spillover | fuel→1.4, machinery→1.3 | — |
| plague_risk | risk | medicine→1.3 | — |
| mining_boom | discovery | ore→0.56 | — |
| mining_boom | boom | ore→0.40, food→1.4, luxuries→1.5 | — |
| mining_boom | peak | food→1.6 | — |
| mining_boom | depletion | ore→1.43 | — |
| ore_glut | glut | ore→0.50 | — |
| supply_shortage | shortage | null→3.0 | yes (0.5) |
| pirate_raid | raiding | null→1.67, weapons→2.0 | — |
| pirate_raid | crackdown | machinery→1.6 | — |
| solar_storm | clearing | — | yes (0.3) |
| refugee_crisis | influx | food→1.6, medicine→1.4 | — |
| refugee_crisis | overcrowding | food→2.0, medicine→1.8 | — |
| refugee_crisis | settlement | food→1.3, medicine→1.15 | — |
| trade_embargo | imposed | null→2.33 | — |
| trade_embargo | enforcement | null→4.0 *(softened from 4.25 to cap)* | yes (0.4) |
| trade_embargo | easing | null→1.5 | — |
| tech_breakthrough | discovery | machinery→1.4 | — |
| tech_breakthrough | innovation | electronics→0.56, machinery→1.8 | — |
| tech_breakthrough | adoption | electronics→0.77, machinery→1.2 | — |
| asteroid_strike | aftermath | machinery→1.8 | — |

`border_conflict`, `pact_under_negotiation`, `alliance_dissolved` have no economy `equilibrium_shift` — leave untouched.

**Replacement format** — every economy `equilibrium_shift` line becomes:
```ts
{ domain: "economy", type: "anchor_shift", target: "system", goodId: "<good>", parameter: "target_stock", value: <anchor> },
```
(`goodId: null` for all-goods). When a phase had *both* a `supply_target` and a `demand_target` on the **same** good, they collapse into **one** `anchor_shift` line for that good.

---

## Task 1: Schema — add `anchorMult` column

**Files:**
- Modify: `prisma/schema.prisma:295-306` (model `StationMarket`)

- [ ] **Step 1: Add the column**

In `model StationMarket`, add after the `stock` line:
```prisma
model StationMarket {
  id        String   @id @default(cuid())
  stationId String
  goodId    String
  stock     Float
  anchorMult Float   @default(1)
  updatedAt DateTime @updatedAt

  station Station @relation(fields: [stationId], references: [id], onDelete: Cascade)
  good    Good    @relation(fields: [goodId], references: [id])

  @@unique([stationId, goodId])
}
```

- [ ] **Step 2: Validate + push the schema**

Run: `npx prisma validate` then `npx prisma db push`
Expected: validate passes; push reports the `StationMarket.anchorMult` column added, existing rows backfilled to `1`.

- [ ] **Step 3: Regenerate the client** (if push didn't)

Run: `npx prisma generate`
Expected: success. `m.anchorMult` is now a typed field on `StationMarket`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(economy): add StationMarket.anchorMult column"
```

---

## Task 2: `aggregateModifiers` → single `anchorMult` + caps cleanup

**Files:**
- Modify: `lib/engine/events.ts:52-80` (`AggregatedModifiers`, `ModifierCaps`), `:113-126` (`scaleValue` comment), `:162-195` (`aggregateModifiers`)
- Modify: `lib/constants/events.ts:30-37` (`ModifierTemplate`), `:98-110` (`MODIFIER_CAPS`)
- Test: `lib/engine/__tests__/events.test.ts:204-310`

- [ ] **Step 1: Rewrite the `aggregateModifiers` test block**

Replace `lib/engine/__tests__/events.test.ts:204-310` (the whole `describe("aggregateModifiers", …)`) with:
```ts
// ── aggregateModifiers ──────────────────────────────────────────

describe("aggregateModifiers", () => {
  it("returns defaults when no modifiers match", () => {
    const result = aggregateModifiers([], "fuel", defaultCaps);
    expect(result).toEqual({
      anchorMult: 1,
      productionMult: 1,
      consumptionMult: 1,
    });
  });

  it("compounds anchor shifts for matching good", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 1.5 },
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 1.4 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBeCloseTo(2.1); // 1.5 × 1.4
  });

  it("includes null-goodId anchor shifts (apply to all goods)", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: null, parameter: "target_stock", value: 1.3 },
    ];
    const result = aggregateModifiers(mods, "luxuries", defaultCaps);
    expect(result.anchorMult).toBeCloseTo(1.3);
  });

  it("compounds null-goodId and per-good anchor shifts together", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: null, parameter: "target_stock", value: 1.67 },
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "weapons", parameter: "target_stock", value: 2.0 },
    ];
    const result = aggregateModifiers(mods, "weapons", defaultCaps);
    expect(result.anchorMult).toBeCloseTo(3.34); // 1.67 × 2.0
  });

  it("excludes anchor shifts for a different good", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "ore", parameter: "target_stock", value: 2.0 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBe(1);
  });

  it("multiplies rate multipliers", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "production_rate", value: 0.5 },
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "production_rate", value: 0.8 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.productionMult).toBeCloseTo(0.4); // 0.5 × 0.8
  });

  it("caps anchor to maxAnchorMult", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 3.0 },
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 2.0 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBe(4.0); // 6.0 capped at maxAnchorMult
  });

  it("caps anchor to minAnchorMult", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 0.05 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBe(0.1); // capped at minAnchorMult
  });

  it("caps rate multiplier to minMultiplier", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "production_rate", value: 0.05 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.productionMult).toBe(0.1);
  });

  it("handles combined modifiers from multiple events", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 1.8 },
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "production_rate", value: 0.4 },
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: null, parameter: "target_stock", value: 1.2 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBeCloseTo(2.16); // 1.8 × 1.2
    expect(result.productionMult).toBe(0.4);
  });
});
```

Then update the `defaultCaps` test fixture near the top of the file (search `defaultCaps`) to the new shape:
```ts
const defaultCaps = {
  minAnchorMult: 0.1,
  maxAnchorMult: 4.0,
  minMultiplier: 0.1,
  maxMultiplier: 3.0,
};
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run lib/engine/__tests__/events.test.ts -t aggregateModifiers`
Expected: FAIL (type errors / `anchorMult` undefined — implementation not updated yet).

- [ ] **Step 3: Update the engine types + aggregation**

In `lib/engine/events.ts`, replace the `AggregatedModifiers` interface (`:52-61`) with:
```ts
/** Aggregated modifier effects for a single market entry. */
export interface AggregatedModifiers {
  /** Compound multiplier on the good's pricing anchor (targetStock). Default 1. */
  anchorMult: number;
  productionMult: number;
  consumptionMult: number;
}
```

Replace the `ModifierCaps` interface (`:73-80`) with:
```ts
/** Caps applied during aggregation. */
export interface ModifierCaps {
  minAnchorMult: number;
  maxAnchorMult: number;
  minMultiplier: number;
  maxMultiplier: number;
}
```

Replace the `aggregateModifiers` body (`:162-195`) with:
```ts
export function aggregateModifiers(
  modifiers: ModifierRow[],
  goodId: string,
  caps: ModifierCaps,
): AggregatedModifiers {
  let anchorMult = 1;
  let productionMult = 1;
  let consumptionMult = 1;

  for (const mod of modifiers) {
    // Match: modifier applies to this good specifically, or to all goods (null)
    if (mod.goodId !== null && mod.goodId !== goodId) continue;

    if (mod.type === "anchor_shift") {
      if (mod.parameter === "target_stock") anchorMult *= mod.value;
    } else if (mod.type === "rate_multiplier") {
      if (mod.parameter === "production_rate") productionMult *= mod.value;
      else if (mod.parameter === "consumption_rate") consumptionMult *= mod.value;
    }
  }

  return {
    anchorMult: clamp(anchorMult, caps.minAnchorMult, caps.maxAnchorMult),
    productionMult: clamp(productionMult, caps.minMultiplier, caps.maxMultiplier),
    consumptionMult: clamp(consumptionMult, caps.minMultiplier, caps.maxMultiplier),
  };
}
```

Update the `aggregateModifiers` doc comment (`:155-161`) to: `Anchor shifts compound (multiply); rate multipliers compound. Safety caps applied at the end.`

Update the `scaleValue` doc comment (`:113-119`) — replace the `equilibrium_shift` sentence with: `For anchor_shift (a multiplier), 2.0 at severity 0.5 → 1.5; rate_multiplier uses the same formula. Navigation equilibrium_shift (danger_level) is additive and handled elsewhere.`

- [ ] **Step 4: Update the modifier type union + caps constant**

In `lib/constants/events.ts`, change `ModifierTemplate.type` (`:32`) to:
```ts
  type: "equilibrium_shift" | "anchor_shift" | "rate_multiplier";
```
and its `parameter` comment (`:35`) to:
```ts
  parameter: string; // "target_stock" (anchor_shift), "production_rate"/"consumption_rate" (rate_multiplier), "danger_level" (equilibrium_shift/navigation)
```

Replace `MODIFIER_CAPS` (`:98-110`) with:
```ts
/** Safety caps for aggregated modifier values. */
export const MODIFIER_CAPS = {
  /** Minimum anchor multiplier (never fully zero out the anchor). */
  minAnchorMult: 0.1,
  /** Maximum anchor multiplier. */
  maxAnchorMult: 4.0,
  /** Minimum rate multiplier (never fully zero out production). */
  minMultiplier: 0.1,
  /** Maximum rate multiplier. */
  maxMultiplier: 3.0,
} as const;
```
Also update the comment block at `:112-114` to drop the `equilibrium_shift` references: `// NOTE: anchor_shift values are MULTIPLIERS on a good's pricing anchor (1.0 = no change, 2.0 = double = pricier, 0.5 = half = cheaper). danger_level values remain additive.`

- [ ] **Step 5: Run the test — expect pass**

Run: `npx vitest run lib/engine/__tests__/events.test.ts -t aggregateModifiers`
Expected: PASS. (The file will still fail to compile elsewhere until Task 3/10 — that's fine; the targeted test passes.)

- [ ] **Step 6: Commit**

```bash
git add lib/engine/events.ts lib/constants/events.ts lib/engine/__tests__/events.test.ts
git commit -m "feat(economy): aggregateModifiers returns single anchorMult; drop reversion"
```

---

## Task 3: Cap-shape on the tick-builder + economy-world types

**Files:**
- Modify: `lib/engine/market-tick-builder.ts:40-46` (`MarketTickInput.modifierCaps`)
- Modify: `lib/tick/world/economy-world.ts:116-122` (`EconomyProcessorParams.modifierCaps`)

- [ ] **Step 1: Replace both inline cap shapes with the canonical type**

In `lib/engine/market-tick-builder.ts`, change the `modifierCaps` field (`:40-46`) to import + reuse `ModifierCaps`. Update the import on `:13` to also import the type, and replace the inline object:
```ts
import { aggregateModifiers, type ModifierRow, type ModifierCaps } from "@/lib/engine/events";
```
```ts
  /** Modifier caps from constants. */
  modifierCaps: ModifierCaps;
```

In `lib/tick/world/economy-world.ts`, add to the events import (top of file) `type ModifierCaps` from `@/lib/engine/events`, and replace the inline `modifierCaps` object on `EconomyProcessorParams` (`:116-122`) with:
```ts
  /** Caps applied when aggregating event modifiers per market. */
  modifierCaps: ModifierCaps;
```
Add the import line near the other type imports:
```ts
import type { ModifierRow, ModifierCaps } from "@/lib/engine/events";
```
(merge with the existing `ModifierRow` import if present — there is one at `:12`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: the only remaining errors are in untouched read sites / event defs (Tasks 4–10). No errors in `market-tick-builder.ts` or `economy-world.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/engine/market-tick-builder.ts lib/tick/world/economy-world.ts
git commit -m "refactor(economy): reuse ModifierCaps type for tick-builder + processor params"
```

---

## Task 4: `curveForGood` gains `anchorMult`

**Files:**
- Modify: `lib/engine/market-pricing.ts:102-120`
- Test: `lib/engine/__tests__/market-pricing.test.ts:179-195`

- [ ] **Step 1: Add a failing test**

Append inside the `curveForGood` describe block in `lib/engine/__tests__/market-pricing.test.ts` (after the existing assertions near `:195`):
```ts
  it("scales targetStock by anchorMult when provided", () => {
    const base = curveForGood("water", 25, 0.5, 2.0);
    const shifted = curveForGood("water", 25, 0.5, 2.0, 2);
    expect(shifted.targetStock).toBeCloseTo(base.targetStock * 2);
  });

  it("defaults anchorMult to 1 (anchor unchanged)", () => {
    const a = curveForGood("water", 25, 0.5, 2.0);
    const b = curveForGood("water", 25, 0.5, 2.0, 1);
    expect(a.targetStock).toBe(b.targetStock);
  });
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts -t curveForGood`
Expected: FAIL (anchorMult arg ignored — `shifted.targetStock` equals base).

- [ ] **Step 3: Implement**

Replace `curveForGood` (`lib/engine/market-pricing.ts:107-120`) with:
```ts
export function curveForGood(
  goodId: string,
  basePrice: number,
  floorMult: number,
  ceilingMult: number,
  anchorMult: number = 1,
): MarketCurve {
  return {
    basePrice,
    targetStock: getTargetStock(goodId) * anchorMult,
    k: DEFAULT_ELASTICITY,
    floorMult,
    ceilingMult,
  };
}
```
Update the function doc comment (`:102-106`) to add: `An optional anchorMult (default 1, supplied from the market row's stored anchorMult) scales the anchor for active events; see the stock-economy spec §6.1.`

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run lib/engine/__tests__/market-pricing.test.ts -t curveForGood`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/market-pricing.ts lib/engine/__tests__/market-pricing.test.ts
git commit -m "feat(economy): curveForGood accepts anchorMult to scale the pricing anchor"
```

---

## Task 5: Economy processor computes + writes `anchorMult`

**Files:**
- Modify: `lib/tick/world/economy-world.ts:62-66` (`MarketUpdate`)
- Modify: `lib/tick/processors/economy.ts:24` (import), `:138-141` (build updates)
- Modify: `lib/tick/adapters/prisma/economy.ts:124-136` (`applyMarketUpdates`)
- Modify: `lib/tick/adapters/memory/economy.ts:121-132` (`applyMarketUpdates`)
- Test: `lib/tick/processors/__tests__/integration/economy.integration.test.ts`

- [ ] **Step 1: Add `anchorMult` to `MarketUpdate`**

In `lib/tick/world/economy-world.ts`, change `MarketUpdate` (`:62-66`) to:
```ts
/** Result of one market simulation step — written back via applyMarketUpdates. */
export interface MarketUpdate {
  id: string;
  stock: number;
  /** Active pricing-anchor multiplier from event modifiers (1 = none). */
  anchorMult: number;
}
```

- [ ] **Step 2: Compute it in the processor**

In `lib/tick/processors/economy.ts`, ensure `aggregateModifiers` is imported (add to the existing `@/lib/engine/events` import on `:25`):
```ts
import { aggregateModifiers, type ModifierRow } from "@/lib/engine/events";
```
Replace the `marketUpdates` construction (`:138-141`) with:
```ts
  const marketUpdates: MarketUpdate[] = markets.map((m, i) => {
    const mods = modifiersBySystem.get(m.systemId) ?? [];
    const anchorMult =
      mods.length > 0
        ? aggregateModifiers(mods, m.goodId, modifierCaps).anchorMult
        : 1;
    return { id: m.id, stock: simulated[i].stock, anchorMult };
  });
```
(`modifierCaps` is already destructured from `params` on `:51`.)

- [ ] **Step 3: Write it — Prisma adapter**

Replace `applyMarketUpdates` in `lib/tick/adapters/prisma/economy.ts:124-136` with:
```ts
  async applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    const ids = updates.map((u) => u.id);
    const stocks = updates.map((u) => (isFinite(u.stock) ? u.stock : 0));
    const anchors = updates.map((u) => (isFinite(u.anchorMult) ? u.anchorMult : 1));

    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "stock" = batch."stock", "anchorMult" = batch."anchorMult"
      FROM unnest(${ids}::text[], ${stocks}::double precision[], ${anchors}::double precision[])
        AS batch("id", "stock", "anchorMult")
      WHERE sm."id" = batch."id"`;
  }
```

- [ ] **Step 4: Write it — memory adapter**

In `lib/tick/adapters/memory/economy.ts`, replace the map body in `applyMarketUpdates` (`:126-130`) with:
```ts
    this.markets = this.markets.map((m) => {
      const u = byKey.get(`${m.systemId}|${m.goodId}`);
      if (!u) return m;
      return {
        ...m,
        stock: isFinite(u.stock) ? u.stock : 0,
        anchorMult: isFinite(u.anchorMult) ? u.anchorMult : 1,
      };
    });
```
(This writes `anchorMult` onto `SimMarketEntry`; the field is added in Task 9. Until then `tsc` flags it — acceptable mid-plan.)

- [ ] **Step 5: Add an integration assertion**

In `lib/tick/processors/__tests__/integration/economy.integration.test.ts`, add a test that an active `anchor_shift` modifier raises the written `anchorMult`. Use the existing harness pattern in that file (it already builds an in-memory world and passes `modifierCaps: MODIFIER_CAPS`). Add:
```ts
it("writes anchorMult from an active anchor_shift modifier", async () => {
  const world = makeWorld(); // existing helper that seeds systems/markets/regions
  const region = (await world.getRegions())[0];
  const markets = await world.getMarketsForRegion(region.id);
  const target = markets[0];
  world.modifiers = [
    { domain: "economy", type: "anchor_shift", targetType: "system", targetId: target.systemId, goodId: target.goodId, parameter: "target_stock", value: 2.0 },
  ];
  // Run the processor on the tick that selects this region.
  await runEconomyProcessor(world, { tick: regionTickFor(region) }, params);
  const updated = world.markets.find((m) => m.systemId === target.systemId && m.goodId === target.goodId);
  expect(updated?.anchorMult).toBeCloseTo(2.0);
});
```
If the file lacks `makeWorld`/`regionTickFor` helpers, adapt to the file's actual setup (read the top of the file first). The assertion that matters: after a tick where the region with an `anchor_shift` mod is processed, that market's `anchorMult` equals the modifier value.

- [ ] **Step 6: Run the integration test**

Run: `npx vitest run lib/tick/processors/__tests__/integration/economy.integration.test.ts`
Expected: PASS (including the new assertion).

- [ ] **Step 7: Commit**

```bash
git add lib/tick/world/economy-world.ts lib/tick/processors/economy.ts lib/tick/adapters/prisma/economy.ts lib/tick/adapters/memory/economy.ts lib/tick/processors/__tests__/integration/economy.integration.test.ts
git commit -m "feat(economy): processor computes + persists anchorMult per market"
```

---

## Task 6: Thread `anchorMult` into the Prisma-`include` read sites

These all load the `StationMarket` row via `include` (not `select`), so the new `anchorMult` scalar is already present — only the `curveForGood` call changes.

**Files:**
- Modify: `lib/services/trade.ts:96`
- Modify: `lib/services/convoy-trade.ts:119`
- Modify: `lib/services/missions.ts:103` and `:352`
- Modify: `lib/services/dev-tools.ts:258`
- Modify: `lib/tick/adapters/prisma/trade-missions.ts:67`

- [ ] **Step 1: Edit each call to pass the row's `anchorMult`**

`lib/services/trade.ts:96` →
```ts
  const curve = curveForGood(goodKey, marketEntry.good.basePrice, marketEntry.good.priceFloor, marketEntry.good.priceCeiling, marketEntry.anchorMult);
```
`lib/services/convoy-trade.ts:119` (multi-line call) — add `marketEntry.anchorMult` as the 5th arg:
```ts
  const curve = curveForGood(
    goodKey,
    marketEntry.good.basePrice,
    marketEntry.good.priceFloor,
    marketEntry.good.priceCeiling,
    marketEntry.anchorMult,
  );
```
`lib/services/missions.ts:103` → add `entry.anchorMult` as 5th arg.
`lib/services/missions.ts:352` → add `freshMarket.anchorMult` as 5th arg.
`lib/services/dev-tools.ts:258` → add `m.anchorMult` as 5th arg.
`lib/tick/adapters/prisma/trade-missions.ts:67` → add `m.anchorMult` as 5th arg.

- [ ] **Step 2: Typecheck the touched files**

Run: `npx tsc --noEmit`
Expected: no new errors in these six files (the `anchorMult` field resolves off the included `StationMarket` row).

- [ ] **Step 3: Commit**

```bash
git add lib/services/trade.ts lib/services/convoy-trade.ts lib/services/missions.ts lib/services/dev-tools.ts lib/tick/adapters/prisma/trade-missions.ts
git commit -m "feat(economy): apply stored anchorMult at player/convoy/mission/dev pricing sites"
```

---

## Task 7: Price-history snapshot path honors `anchorMult`

So recorded price history matches the prices players see.

**Files:**
- Modify: `lib/engine/snapshot.ts:3-10` (`MarketInput`), `:36`
- Modify: `lib/tick/world/snapshots-world.ts` (`MarketView`)
- Modify: `lib/tick/adapters/prisma/snapshots.ts:22-42` (`getMarkets`)

- [ ] **Step 1: Add `anchorMult` to `MarketInput` and use it**

In `lib/engine/snapshot.ts`, change `MarketInput` (`:3-10`):
```ts
export interface MarketInput {
  systemId: string;
  goodId: string;
  stock: number;
  basePrice: number;
  priceFloor?: number;
  priceCeiling?: number;
  /** Stored pricing-anchor multiplier (1 = none). */
  anchorMult?: number;
}
```
and the `curveForGood` call (`:36`):
```ts
      const curve = curveForGood(m.goodId, m.basePrice, m.priceFloor ?? 0.2, m.priceCeiling ?? 5.0, m.anchorMult ?? 1);
```

- [ ] **Step 2: Add `anchorMult` to the snapshots `MarketView`**

In `lib/tick/world/snapshots-world.ts`, find the `MarketView` interface and add `anchorMult: number;` next to `stock`. (This is the snapshots world's own `MarketView`, distinct from economy-world's.)

- [ ] **Step 3: Populate it in the adapter**

In `lib/tick/adapters/prisma/snapshots.ts`, add `anchorMult: true,` to the `select` (`:24-31`, alongside `stock: true`) and add `anchorMult: r.anchorMult,` to the returned object (`:33-41`):
```ts
    const rows = await this.tx.stationMarket.findMany({
      select: {
        stock: true,
        anchorMult: true,
        good: {
          select: { name: true, basePrice: true, priceFloor: true, priceCeiling: true },
        },
        station: { select: { system: { select: { id: true } } } },
      },
    });

    return rows.map((r) => ({
      systemId: r.station.system.id,
      goodId: GOOD_NAME_TO_KEY.get(r.good.name) ?? r.good.name,
      stock: r.stock,
      anchorMult: r.anchorMult,
      basePrice: r.good.basePrice,
      priceFloor: r.good.priceFloor,
      priceCeiling: r.good.priceCeiling,
    }));
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in these three files.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/snapshot.ts lib/tick/world/snapshots-world.ts lib/tick/adapters/prisma/snapshots.ts
git commit -m "feat(economy): price-history snapshots reflect active anchorMult"
```

---

## Task 8: Trade-flow gradient honors `anchorMult`

So inter-system flow responds to event-driven price changes.

**Files:**
- Modify: `lib/tick/world/trade-flow-world.ts:33-42` (`MarketSnapshot`)
- Modify: `lib/tick/adapters/prisma/trade-flow.ts:102-110`
- Modify: `lib/tick/adapters/memory/trade-flow.ts:100-110` (the snapshot map)
- Modify: `lib/tick/processors/trade-flow.ts:133` and `:137`

- [ ] **Step 1: Add the field to `MarketSnapshot`**

In `lib/tick/world/trade-flow-world.ts`, add to `MarketSnapshot` (`:33-42`):
```ts
  stock: number;
  /** Stored pricing-anchor multiplier (1 = none). */
  anchorMult: number;
  priceFloor: number;
```

- [ ] **Step 2: Populate — Prisma adapter**

In `lib/tick/adapters/prisma/trade-flow.ts`, add `anchorMult: m.anchorMult,` to the returned snapshot object (`:102-110`, next to `stock: m.stock`). The query already uses `include` so the scalar is present.

- [ ] **Step 3: Populate — memory adapter**

In `lib/tick/adapters/memory/trade-flow.ts`, find the snapshot object construction in `getMarketSnapshotsForRegion` (`:100-110`) and add `anchorMult: m.anchorMult,` (sourced from the `SimMarketEntry`, field added in Task 9).

- [ ] **Step 4: Thread into pricing**

In `lib/tick/processors/trade-flow.ts`, add the 5th arg to both `curveForGood` calls:
```ts
// :133
const curveA = curveForGood(goodId, mA.basePrice, mA.priceFloor, mA.priceCeiling, mA.anchorMult);
// :137
const curveB = curveForGood(goodId, mB.basePrice, mB.priceFloor, mB.priceCeiling, mB.anchorMult);
```
(Match the actual variable names at those lines.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in these four files.

- [ ] **Step 6: Commit**

```bash
git add lib/tick/world/trade-flow-world.ts lib/tick/adapters/prisma/trade-flow.ts lib/tick/adapters/memory/trade-flow.ts lib/tick/processors/trade-flow.ts
git commit -m "feat(economy): trade-flow price gradient honors anchorMult"
```

---

## Task 9: Simulator threads `anchorMult` end-to-end

Required so `npm run simulate` validates event price impact (the sim runs the same processor + creates real `anchor_shift` modifier rows).

**Files:**
- Modify: `lib/engine/simulator/types.ts:44-51` (`SimMarketEntry`)
- Modify: wherever `SimMarketEntry` objects are constructed (set `anchorMult: 1`)
- Modify: `lib/engine/simulator/bot.ts:64` and `:108`
- Modify: `lib/engine/simulator/strategies/helpers.ts:18`
- Modify: `lib/engine/simulator/market-analysis.ts:22` and `:47`
- Modify: `lib/engine/simulator/event-analysis.ts:32`

- [ ] **Step 1: Add the field**

In `lib/engine/simulator/types.ts`, change `SimMarketEntry` (`:44-51`) to add:
```ts
export interface SimMarketEntry {
  systemId: string;
  goodId: string;
  basePrice: number;
  stock: number;
  /** Stored pricing-anchor multiplier (1 = none); written by the economy processor. */
  anchorMult: number;
  priceFloor: number;
  priceCeiling: number;
}
```

- [ ] **Step 2: Set `anchorMult: 1` at construction**

Run: `npx tsc --noEmit` and let it point to the `SimMarketEntry` construction site(s) (likely the simulator world-gen/setup that builds initial markets). At each, add `anchorMult: 1,`. (Search: `stock:` near `basePrice:` in `lib/engine/simulator/`.)

- [ ] **Step 3: Thread into all sim pricing calls**

Add `m.anchorMult` (or the local var name) as the 5th `curveForGood` arg at each site:
- `bot.ts:64` → `curveForGood(market.goodId, market.basePrice, market.priceFloor, market.priceCeiling, market.anchorMult)`
- `bot.ts:108` → `curveForGood(buyMarket.goodId, buyMarket.basePrice, buyMarket.priceFloor, buyMarket.priceCeiling, buyMarket.anchorMult)`
- `strategies/helpers.ts:18` → add `m.anchorMult` as 5th arg inside the `curveForGood(...)`.
- `market-analysis.ts:22` and `:47` → add `m.anchorMult` as 5th arg.
- `event-analysis.ts:32` → add `m.anchorMult` as 5th arg.

- [ ] **Step 4: Typecheck + unit tests**

Run: `npx tsc --noEmit` then `npx vitest run lib/engine/simulator`
Expected: no type errors; simulator unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/simulator
git commit -m "feat(economy): simulator threads anchorMult through pricing"
```

---

## Task 10: Convert event definitions (anchor_shift) + remove reversion_dampening

**Files:**
- Modify: `lib/constants/events.ts:116-697` (all event definitions)

- [ ] **Step 1: Apply the conversion**

For every event phase, using the **Conversion Reference Table** above:
1. Replace each **economy** `equilibrium_shift` modifier (`parameter: "supply_target"` / `"demand_target"`) with a single `anchor_shift` modifier per good using the table's value and the replacement format. Collapse same-good supply+demand pairs into one line.
2. Delete every `reversion_dampening` modifier line (the table's right column flags which phases).
3. Leave `rate_multiplier`, navigation `equilibrium_shift` (`danger_level`), `shocks`, and `spread` lines untouched.

Worked example — `inner_system_conflict` `active` phase (`:152-166`) becomes:
```ts
      modifiers: [
        { domain: "economy", type: "anchor_shift", target: "system", goodId: "fuel", parameter: "target_stock", value: 2.5 },
        { domain: "economy", type: "anchor_shift", target: "system", goodId: "machinery", parameter: "target_stock", value: 2.0 },
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.2 },
        { domain: "navigation", type: "equilibrium_shift", target: "system", parameter: "danger_level", value: 0.2 },
      ],
      shocks: [
        { target: "system", goodId: "fuel", parameter: "supply", value: -0.3, mode: "percentage" },
        { target: "system", goodId: "machinery", parameter: "supply", value: -0.2, mode: "percentage" },
      ],
      spread: [
        { eventType: "conflict_spillover", probability: 0.3, severity: 0.3 },
      ],
```
(reversion_dampening removed; danger/production/shocks/spread kept.)

Worked example — `ore_glut` `glut` phase (`:401-405`, two lines on the same good) becomes one line:
```ts
      modifiers: [
        { domain: "economy", type: "anchor_shift", target: "system", goodId: "ore", parameter: "target_stock", value: 0.5 },
      ],
```

- [ ] **Step 2: Typecheck the full file**

Run: `npx tsc --noEmit`
Expected: no `supply_target`/`demand_target`/`reversion_dampening` references remain.

- [ ] **Step 3: Grep to confirm no leftovers**

Run: `npx vitest run` is not the check here — instead search the source:
Use Grep for `supply_target|demand_target|reversion_dampening` in `lib/constants/events.ts`.
Expected: zero matches.

- [ ] **Step 4: Commit**

```bash
git add lib/constants/events.ts
git commit -m "feat(economy): convert event defs to anchor_shift; remove reversion_dampening"
```

---

## Task 11: Effect summaries + danger test fixture

**Files:**
- Modify: `lib/utils/event-effects.ts:13-68`
- Modify: `lib/engine/__tests__/danger.test.ts:27-38`

- [ ] **Step 1: Rewrite `summarizePhaseEffects`**

Replace `lib/utils/event-effects.ts:13-68` with a version that reads `anchor_shift`:
```ts
export function summarizePhaseEffects(phase: EventPhaseDefinition): string {
  const parts: string[] = [];

  const demandUp: string[] = [];
  const demandDown: string[] = [];
  let productionChange: "up" | "down" | null = null;
  let hasDanger = false;

  for (const mod of phase.modifiers) {
    if (mod.domain === "navigation") {
      hasDanger = true;
      continue;
    }

    const goodLabel = mod.goodId ? goodDisplayName(mod.goodId) : null;

    if (mod.type === "anchor_shift" && mod.parameter === "target_stock") {
      if (mod.value > 1) {
        if (goodLabel) demandUp.push(goodLabel);
        else parts.push("All demand up");
      } else if (mod.value < 1) {
        if (goodLabel) demandDown.push(goodLabel);
        else parts.push("All demand down");
      }
    } else if (mod.type === "rate_multiplier" && mod.parameter === "production_rate") {
      productionChange = mod.value > 1 ? "up" : "down";
    }
  }

  const hasAllDemandUp = parts.includes("All demand up");
  const hasAllDemandDown = parts.includes("All demand down");

  if (demandUp.length > 0 && !hasAllDemandUp) parts.push(`${demandUp.join(", ")} demand up`);
  if (demandDown.length > 0 && !hasAllDemandDown) parts.push(`${demandDown.join(", ")} demand down`);
  if (productionChange === "down") parts.push("Production slowed");
  if (productionChange === "up") parts.push("Production boosted");
  if (hasDanger) parts.push("Danger increased");

  return parts.length > 0 ? parts.join(" · ") : "Minor market effects";
}
```
Update the function doc comment to: `Derive a human-readable effect summary from a phase's modifiers. Anchor shifts surface as "X demand up/down" (high demand = high price). Returns e.g. "Food, Medicine demand up · Production slowed · Danger increased".`

- [ ] **Step 2: Update the danger test economy-mod fixture**

In `lib/engine/__tests__/danger.test.ts`, change `makeEconomyMod` (`:27-38`) so the representative non-danger economy modifier uses the new type:
```ts
function makeEconomyMod(overrides: Partial<ModifierRow> = {}): ModifierRow {
  return {
    domain: "economy",
    type: "anchor_shift",
    targetType: "system",
    targetId: "sys-1",
    goodId: "fuel",
    parameter: "target_stock",
    value: 1.5,
    ...overrides,
  };
}
```
And in the test `"returns 0 when no danger_level modifiers (only economy modifiers)"` (`:47-50`), change the second mod override from `{ parameter: "supply_target" }` to `{ parameter: "target_stock", value: 0.6 }`.

- [ ] **Step 3: Run the affected tests**

Run: `npx vitest run lib/engine/__tests__/danger.test.ts lib/constants/__tests__ lib/engine/__tests__/events.test.ts`
Expected: PASS. (Event summaries rebuild from the new defs automatically.)

- [ ] **Step 4: Commit**

```bash
git add lib/utils/event-effects.ts lib/engine/__tests__/danger.test.ts
git commit -m "feat(economy): effect summaries read anchor_shift; update danger fixture"
```

---

## Task 12: Simulator constants alignment

**Files:**
- Modify: `lib/engine/simulator/constants.ts` (the `modifierCaps` block)
- Test: `lib/engine/__tests__/sim-constants.test.ts:49`

- [ ] **Step 1: Update the sim caps shape**

In `lib/engine/simulator/constants.ts`, find the `modifierCaps` object under the events constants and set it to mirror the new `MODIFIER_CAPS`:
```ts
    modifierCaps: {
      minAnchorMult: 0.1,
      maxAnchorMult: 4.0,
      minMultiplier: 0.1,
      maxMultiplier: 3.0,
    },
```
(If the file imports and spreads `MODIFIER_CAPS` directly, no change is needed beyond confirming it compiles.)

- [ ] **Step 2: Run the sim-constants test**

Run: `npx vitest run lib/engine/__tests__/sim-constants.test.ts`
Expected: PASS (`c.events.modifierCaps` deep-equals `MODIFIER_CAPS`).

- [ ] **Step 3: Commit**

```bash
git add lib/engine/simulator/constants.ts
git commit -m "chore(sim): align modifierCaps with new anchor caps"
```

---

## Task 13: Full test + build + simulator validation

**Files:** none (verification only).

- [ ] **Step 1: Full unit + integration suite**

Run: `npx vitest run`
Expected: all green. If any test still references `supplyTargetMult`/`demandTargetMult`/`reversionMult`/`reversion_dampening`/`equilibrium_shift` economy params, fix it to the new shape and re-run.

- [ ] **Step 2: Type + production build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: no errors.

- [ ] **Step 3: Simulator sanity + event price impact**

Run: `npm run simulate`
Expected: completes; equilibrium prices stay in their target bands. Inspect the run's `eventImpacts` — events that convert to anchor shifts (e.g. `supply_shortage`, `inner_system_conflict`, `mining_boom`) should show a non-trivial `weightedPriceImpactPct` in the expected direction (shortages/conflict positive, gluts/booms negative). If any anchor is mis-signed, fix its value in `lib/constants/events.ts` per the table and re-run.

- [ ] **Step 4: Commit any calibration fixes**

```bash
git add -A
git commit -m "test(economy): sim-validate anchor-shift price impact"
```

---

## Task 14: Docs

**Files:**
- Modify: `docs/active/gameplay/events.md`, `docs/active/gameplay/event-catalog.md`, `docs/active/gameplay/economy.md`

- [ ] **Step 1: Update the docs**

- `events.md`: in the modifier-types section, replace the dual supply/demand `equilibrium_shift` description with the `anchor_shift` modifier (multiplies a good's `targetStock`; `>1` pricier, `<1` cheaper; stored on `StationMarket.anchorMult`, written by the economy processor, read via `curveForGood`). Remove the `reversion_dampening` entry. Keep navigation `danger_level`.
- `event-catalog.md`: if it lists per-event/per-phase economy effects in supply/demand terms, update the wording to match the new anchor effects (effect summaries still read "X demand up/down").
- `economy.md`: add a short note under the events interaction that anchor shifts are the event lever on price in the stock model, distinct from one-time stock shocks.

- [ ] **Step 2: Commit**

```bash
git add docs/active/gameplay/events.md docs/active/gameplay/event-catalog.md docs/active/gameplay/economy.md
git commit -m "docs(economy): document anchor_shift event modifier"
```

- [ ] **Step 3: Delete this plan** (per repo convention — build plans are deleted when the feature ships)

```bash
git rm docs/plans/2026-05-30-event-anchor-shift.md
git commit -m "chore: remove shipped anchor-shift build plan"
```

---

## Self-Review Notes

- **Spec coverage:** §6.1 modifier (T2,T10) · anchorMult-on-row storage + processor write (T1,T5) · read path / curveForGood (T4,T6–T9) · conversion rule (T10 + table) · repurposed caps (T2,T12) · reversion cleanup (T2,T10) · summaries wording (T11) · sim-validate (T13) · docs (T14). All covered.
- **Type consistency:** `anchorMult` is the field name everywhere (schema, `MarketUpdate`, `MarketInput`, `MarketSnapshot`, `SimMarketEntry`, `AggregatedModifiers`, `curveForGood` param). Caps are `minAnchorMult`/`maxAnchorMult`/`minMultiplier`/`maxMultiplier` (no reversion) in `ModifierCaps`, `MODIFIER_CAPS`, and sim constants. Modifier `type` is `"anchor_shift"`, `parameter` is `"target_stock"` throughout.
- **Cadence note:** `anchorMult` updates on the region's economy turn (round-robin), identical to `stock` and rate-multiplier effects — by design (spec §6.1).
