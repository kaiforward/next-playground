# The Purse — Plan 1 of 3: Treasury Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every faction gets a persisted treasury that fills from two taxes (grade-weighted employed heads; realized production at fixed reference values) and drains through three budget-band bills paid in a fixed ladder (maintenance → logistics → construction) once per month — fully observable in the calibration harness.

**Architecture:** A new tick-mutable `World` array (`treasuries`, modeled on the `WorldFactionRelation` lifecycle) settled by a new `treasury` processor (standard tri-file: typed world interface / memory adapter / pure body) that runs after directed-build, gated on the month pulse. The one real economy change is exporting realized per-(system, good) output from the supply-chain sim via `EconomySignals`. Construction and logistics export "work performed this pulse" per faction so bills charge work done, not standing capacity.

**Tech Stack:** TypeScript 5 strict, Vitest 4, the existing tick-processor architecture (`lib/tick/`), the calibration harness (`lib/tick-harness/`).

**Spec:** `docs/planned/player-seat-purse.md` (settled 2026-07-19). This plan implements the treasury container, both income lines, the settlement ladder, tax levels (rate multiplier only), zero-start initial state, AI parity defaults, and harness metrics. **Deferred to Plan 2:** band funding *gating* construction/logistics throughput, maintenance decay modulation + output malus, tax-level → unrest pressure. **Deferred to Plan 3:** services/API/mutations and UI (treasury card needs its collaborative design pass first). Funded fractions ARE computed and latched in this plan — Plan 2 wires their consumers.

## Global Constraints

- **Money is ECONOMY_SCALE-invariant.** Heads, building counts, construction work points, and bills do not scale with S; realized production and logistics work DO — divide both by `economyScale` at collection. All money constants are S-invariant by definition (never wrapped in `scaleValue`/`scaleRecord`).
- **JSON-serializable World** — no `Map`/`Set`/`Date` in persisted rows; no `NaN`/`Infinity` may ever reach `World` state (coerce non-finite to 0, mirroring `fundQueue`'s guard).
- **No `as` assertions** (except `as const` and inside `lib/types/guards.ts`), **no `unknown`**, **no postfix `!`** (except `find(...)!` in tests).
- **Pulse-shape scaling** (processor-architecture doc): heads-tax income and the maintenance bill are monthly rates → `× catchUpFactor(interval)` inside the body. Realized production and work-performed quantities are already catchUp-scaled upstream → never rescale them. Funded fractions are dimensionless ratios → never scale.
- **Determinism** — the treasury body is a pure function of world + tick; no RNG, no `Date.now`/`Math.random`.
- **Balance clamps at ≥ 0** — no debt. Zero-bill guard: when a band's bill is 0, effective funding = the slider value, never 0/0.
- **Comments describe the code, not the plan** — no "Plan 1"/"Slice 3" references in code comments.
- Bill/tax rate magnitudes in `lib/constants/treasury.ts` are **calibration seeds** — Task 10 tunes them against the harness; do not hand-wring over exact values in earlier tasks.
- Commit after each task: `git add <files> && git commit -m "<type>(purse): <what>"`.

---

### Task 1: TaxLevel type + guards

**Files:**
- Modify: `lib/types/game.ts` (add union next to `GovernmentType`, which is at lines 51-59)
- Modify: `lib/types/guards.ts` (follow the `GOVERNMENT_TYPES` Set + `to`/`is` pattern at lines 28-31 / 72-81, and the `ALL_` array pattern at lines 162-165)
- Test: `lib/types/__tests__/guards.test.ts` (add to the existing file; if no guards test file exists, create it)

**Interfaces:**
- Produces: `type TaxLevel = "very_low" | "low" | "normal" | "high" | "very_high"` (`lib/types/game.ts`), `toTaxLevel(value: string): TaxLevel`, `isTaxLevel(value: string): value is TaxLevel`, `ALL_TAX_LEVELS: readonly TaxLevel[]` (`lib/types/guards.ts`). Every later task imports `TaxLevel` from `@/lib/types/game`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toTaxLevel, isTaxLevel, ALL_TAX_LEVELS } from "@/lib/types/guards";

describe("tax level guards", () => {
  it("accepts all five levels", () => {
    expect(ALL_TAX_LEVELS).toEqual(["very_low", "low", "normal", "high", "very_high"]);
    for (const level of ALL_TAX_LEVELS) {
      expect(isTaxLevel(level)).toBe(true);
      expect(toTaxLevel(level)).toBe(level);
    }
  });

  it("rejects unknown values", () => {
    expect(isTaxLevel("confiscatory")).toBe(false);
    expect(() => toTaxLevel("confiscatory")).toThrow('Invalid tax level: "confiscatory"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/types/__tests__/guards.test.ts`
Expected: FAIL — `toTaxLevel` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `lib/types/game.ts`, after `GovernmentType`:

```ts
/** Five-step faction tax stance (very low → very high) — a policy lever, not a slider. */
export type TaxLevel = "very_low" | "low" | "normal" | "high" | "very_high";
```

In `lib/types/guards.ts` (import `TaxLevel` from `./game` alongside the existing type imports):

```ts
const TAX_LEVELS: ReadonlySet<string> = new Set<TaxLevel>([
  "very_low", "low", "normal", "high", "very_high",
]);

export function toTaxLevel(value: string): TaxLevel {
  if (!TAX_LEVELS.has(value)) {
    throw new Error(`Invalid tax level: "${value}"`);
  }
  return value as TaxLevel;
}

export function isTaxLevel(value: string): value is TaxLevel {
  return TAX_LEVELS.has(value);
}

export const ALL_TAX_LEVELS: readonly TaxLevel[] = [
  "very_low", "low", "normal", "high", "very_high",
];
```

(The `as TaxLevel` inside `toTaxLevel` is the permitted guard-function use.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/types/__tests__/guards.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/types/game.ts lib/types/guards.ts lib/types/__tests__/guards.test.ts
git commit -m "feat(purse): TaxLevel union + boundary guards"
```

---

### Task 2: Treasury constants + derived reference values

**Files:**
- Create: `lib/constants/treasury.ts`
- Test: `lib/constants/__tests__/treasury.test.ts`

**Interfaces:**
- Consumes: `GOODS`, `GOOD_NAMES` (`@/lib/constants/goods`), `GOOD_RECIPES` (`@/lib/constants/recipes`), `TaxLevel` (`@/lib/types/game`), `GovernmentType` (`@/lib/types/game`).
- Produces: `TREASURY` (rate constants object), `TAX_LEVEL_RATE_MULT: Record<TaxLevel, number>`, `TAX_LEVEL_UNREST_PRESSURE: Record<TaxLevel, number>` (consumed in Plan 2; defined now so the level table is complete), `DEFAULT_TAX_LEVEL: Record<GovernmentType, TaxLevel>`, `REFERENCE_VALUE: Record<string, number>` (per good id, S-invariant).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { GOOD_NAMES, GOODS } from "@/lib/constants/goods";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import {
  REFERENCE_VALUE,
  TREASURY,
  TAX_LEVEL_RATE_MULT,
  DEFAULT_TAX_LEVEL,
} from "@/lib/constants/treasury";
import { ALL_TAX_LEVELS } from "@/lib/types/guards";
import { ALL_GOVERNMENT_TYPES } from "@/lib/types/guards";

describe("reference values", () => {
  it("covers every good with a positive, finite, S-invariant value", () => {
    for (const goodId of GOOD_NAMES) {
      const v = REFERENCE_VALUE[goodId];
      expect(v, goodId).toBeGreaterThan(0);
      expect(Number.isFinite(v), goodId).toBe(true);
    }
  });

  it("values downstream goods as value-added, not turnover (alloys < basePrice)", () => {
    // alloys has a recipe — its reference value must be net of input base prices,
    // floored at REFERENCE_VALUE_FLOOR_SHARE of its own basePrice.
    const recipe = GOOD_RECIPES["alloys"];
    expect(recipe).toBeDefined();
    expect(REFERENCE_VALUE["alloys"]).toBeLessThan(GOODS["alloys"].basePrice);
    expect(REFERENCE_VALUE["alloys"]).toBeGreaterThanOrEqual(
      TREASURY.REFERENCE_VALUE_FLOOR_SHARE * GOODS["alloys"].basePrice,
    );
  });

  it("keeps tier-0 goods at full base price (no inputs)", () => {
    expect(REFERENCE_VALUE["ore"]).toBe(GOODS["ore"].basePrice);
  });
});

describe("tax level tables", () => {
  it("has a rate multiplier and a government default for every level/government", () => {
    for (const level of ALL_TAX_LEVELS) {
      expect(TAX_LEVEL_RATE_MULT[level]).toBeGreaterThan(0);
    }
    expect(TAX_LEVEL_RATE_MULT["normal"]).toBe(1);
    for (const gov of ALL_GOVERNMENT_TYPES) {
      expect(ALL_TAX_LEVELS).toContain(DEFAULT_TAX_LEVEL[gov]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/constants/__tests__/treasury.test.ts`
Expected: FAIL — module `@/lib/constants/treasury` not found.

- [ ] **Step 3: Write the implementation**

`lib/constants/treasury.ts`:

```ts
/**
 * Faction treasury constants. ALL values here are ECONOMY_SCALE-invariant by
 * definition (money never rides S): heads, building levels, and construction
 * work points are unscaled counts, and the two S-scaled tax bases (realized
 * production, logistics work) are divided by the scale at collection.
 *
 * Rate magnitudes are harness-calibrated (`npm run simulate` — early-game
 * solvency and no runaway hoards are the acceptance bar), not hand-derived.
 */
import { GOODS, GOOD_NAMES } from "@/lib/constants/goods";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import type { GovernmentType, TaxLevel } from "@/lib/types/game";

export const TREASURY = {
  /** Money collected per weighted employed head per reference month, before the tax-level multiplier. */
  HEADS_TAX_PER_MONTH: 0.01,
  /** Per-head weights by labour grade — skilled cores out-earn frontier headcount. */
  HEADS_WEIGHTS: { unskilled: 1, technicians: 3, engineers: 9 },
  /** Share of reference value collected per realized unit (at S=1), before the tax-level multiplier. */
  PRODUCTION_TAX_RATE: 0.05,
  /** A processed good's reference value never falls below this share of its own base price. */
  REFERENCE_VALUE_FLOOR_SHARE: 0.25,
  /** Monthly upkeep per unit of build-work embodied in standing building levels. */
  MAINTENANCE_RATE_PER_WORK: 0.002,
  /** Money per construction point actually absorbed by the queue. */
  CONSTRUCTION_RATE_PER_WORK: 0.5,
  /** Money per unit of logistics work-budget actually consumed (S-normalised at accrual). */
  LOGISTICS_RATE_PER_WORK: 0.05,
  /** The maintenance slider's floor — the 50-100% range charges only flow (recoverable). */
  MAINTENANCE_SLIDER_FLOOR: 0.5,
} as const;

/** Rate multiplier applied to BOTH income lines by the faction's tax stance. */
export const TAX_LEVEL_RATE_MULT: Record<TaxLevel, number> = {
  very_low: 0.5,
  low: 0.75,
  normal: 1,
  high: 1.3,
  very_high: 1.6,
};

/** Proportional pressure fed into the per-system unrest integrator (consumed by the population processor). */
export const TAX_LEVEL_UNREST_PRESSURE: Record<TaxLevel, number> = {
  very_low: 0,
  low: 0.02,
  normal: 0.05,
  high: 0.1,
  very_high: 0.18,
};

/** Government-flavoured default tax stance (tax is internal policy — the government axis). */
export const DEFAULT_TAX_LEVEL: Record<GovernmentType, TaxLevel> = {
  federation: "normal",
  corporate: "low",
  authoritarian: "high",
  frontier: "low",
  cooperative: "normal",
  technocratic: "normal",
  militarist: "high",
  theocratic: "normal",
};

/**
 * Fixed per-good assessed values for the production tax (a cadastral tax).
 * Value-added-aware: a processed good is valued at its base price NET of its
 * inputs' base prices (floored), so deep chains aren't taxed as turnover —
 * ore is not taxed again inside alloys inside machinery. Tier-0 goods have no
 * recipe and keep their full base price.
 */
function buildReferenceValues(): Record<string, number> {
  const values: Record<string, number> = {};
  for (const goodId of GOOD_NAMES) {
    const def = GOODS[goodId];
    const recipe = GOOD_RECIPES[goodId];
    let inputCost = 0;
    if (recipe) {
      for (const [inputId, perOutput] of Object.entries(recipe)) {
        inputCost += (GOODS[inputId]?.basePrice ?? 0) * perOutput;
      }
    }
    values[goodId] = Math.max(
      def.basePrice - inputCost,
      TREASURY.REFERENCE_VALUE_FLOOR_SHARE * def.basePrice,
    );
  }
  return values;
}

export const REFERENCE_VALUE: Record<string, number> = buildReferenceValues();
```

Note: if `ALL_GOVERNMENT_TYPES` is not exported from `@/lib/types/guards` under that exact name, check `lib/types/guards.ts:162-165` for the actual export name and use that in the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/constants/__tests__/treasury.test.ts`
Expected: PASS. If the `alloys` floor assertion fails because its value-added is genuinely above basePrice fractions, inspect the printed values — the floor share, not the recipe, is the tunable.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/treasury.ts lib/constants/__tests__/treasury.test.ts
git commit -m "feat(purse): treasury constants + value-added reference values"
```

---

### Task 3: Engine — income, bills, and the settlement ladder (pure)

**Files:**
- Create: `lib/engine/treasury.ts`
- Test: `lib/engine/__tests__/treasury.test.ts`

**Interfaces:**
- Consumes: `workCostPerLevel(buildingType: string): number` (`@/lib/constants/construction`), `clamp` (`@/lib/utils/math`), `TreasuryBands` (defined in Task 4 — see note below).
- Produces (exact exports later tasks use):
  - `interface TreasuryBands { maintenance: number; logistics: number; construction: number; }` — **defined here in `lib/engine/treasury.ts`** and re-used by the world row in Task 4 (world/types imports it — same direction as `WorldConstructionProject` flowing between the layers; engine must not import world/types here to avoid a cycle, so the engine owns the type).
  - `headsTaxIncome(alloc: HeadsTaxInput, weights: HeadsTaxInput, ratePerHead: number, rateMult: number): number`
  - `productionTaxIncome(realizedByGood: ReadonlyMap<string, number>, referenceValues: Record<string, number>, rate: number, rateMult: number, economyScale: number): number`
  - `maintenanceBill(levelsByType: ReadonlyMap<string, number>, ratePerWork: number): MaintenanceBillResult`
  - `settleLadder(balance: number, income: number, bills: TreasuryBands, sliders: TreasuryBands): SettlementLadderResult`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  headsTaxIncome,
  productionTaxIncome,
  maintenanceBill,
  settleLadder,
  type TreasuryBands,
} from "@/lib/engine/treasury";

const WEIGHTS = { unskilled: 1, technicians: 3, engineers: 9 };
const FULL: TreasuryBands = { maintenance: 1, logistics: 1, construction: 1 };

describe("headsTaxIncome", () => {
  it("weights grades steeply and applies rate x multiplier", () => {
    const alloc = { unskilled: 100, technicians: 10, engineers: 1 };
    // weighted = 100*1 + 10*3 + 1*9 = 139
    expect(headsTaxIncome(alloc, WEIGHTS, 0.01, 1)).toBeCloseTo(1.39);
    expect(headsTaxIncome(alloc, WEIGHTS, 0.01, 1.5)).toBeCloseTo(2.085);
  });

  it("coerces non-finite head counts to 0", () => {
    expect(headsTaxIncome({ unskilled: NaN, technicians: 0, engineers: 0 }, WEIGHTS, 0.01, 1)).toBe(0);
  });
});

describe("productionTaxIncome", () => {
  const REF = { ore: 30, alloys: 50 };

  it("values realized units at reference values, normalised by economy scale", () => {
    const realized = new Map([["ore", 200], ["alloys", 100]]);
    // at S=100: (200/100)*30 + (100/100)*50 = 110; x rate 0.05 x mult 1 = 5.5
    expect(productionTaxIncome(realized, REF, 0.05, 1, 100)).toBeCloseTo(5.5);
  });

  it("is ECONOMY_SCALE-invariant when units scale with S", () => {
    const atS1 = productionTaxIncome(new Map([["ore", 2]]), REF, 0.05, 1, 1);
    const atS100 = productionTaxIncome(new Map([["ore", 200]]), REF, 0.05, 1, 100);
    expect(atS100).toBeCloseTo(atS1);
  });

  it("skips goods with no reference value and non-finite units", () => {
    const realized = new Map([["mystery_good", 100], ["ore", NaN]]);
    expect(productionTaxIncome(realized, REF, 0.05, 1, 1)).toBe(0);
  });
});

describe("maintenanceBill", () => {
  it("charges standing levels weighted by embodied build work, itemised by type", () => {
    const levels = new Map([["housing", 10], ["ore", 5]]);
    const result = maintenanceBill(levels, 0.002);
    expect(result.total).toBeGreaterThan(0);
    expect(result.byType).toHaveLength(2);
    const sum = result.byType.reduce((acc, l) => acc + l.amount, 0);
    expect(sum).toBeCloseTo(result.total);
  });
});

describe("settleLadder", () => {
  it("pays all bands in full when income covers everything", () => {
    const r = settleLadder(0, 100, { maintenance: 30, logistics: 20, construction: 40 }, FULL);
    expect(r.balance).toBeCloseTo(10);
    expect(r.funded).toEqual({ maintenance: 1, logistics: 1, construction: 1 });
  });

  it("shorts in reverse ladder order: construction starves before logistics before maintenance", () => {
    const r = settleLadder(0, 45, { maintenance: 30, logistics: 20, construction: 40 }, FULL);
    expect(r.paid.maintenance).toBeCloseTo(30);
    expect(r.paid.logistics).toBeCloseTo(15);
    expect(r.paid.construction).toBe(0);
    expect(r.funded.maintenance).toBe(1);
    expect(r.funded.logistics).toBeCloseTo(0.75);
    expect(r.funded.construction).toBe(0);
    expect(r.balance).toBe(0);
  });

  it("a slider charges only its fraction of the bill, and the paid fraction is the effective funding", () => {
    const sliders: TreasuryBands = { maintenance: 1, logistics: 1, construction: 0.5 };
    const r = settleLadder(0, 1000, { maintenance: 0, logistics: 0, construction: 40 }, sliders);
    expect(r.paid.construction).toBeCloseTo(20);
    expect(r.funded.construction).toBeCloseTo(0.5);
  });

  it("zero-bill guard: effective funding equals the slider, never 0/0", () => {
    const sliders: TreasuryBands = { maintenance: 0.8, logistics: 1, construction: 0.6 };
    const r = settleLadder(5, 0, { maintenance: 0, logistics: 0, construction: 0 }, sliders);
    expect(r.funded).toEqual({ maintenance: 0.8, logistics: 1, construction: 0.6 });
    expect(r.balance).toBe(5);
  });

  it("never goes negative and coerces non-finite inputs to 0", () => {
    const r = settleLadder(NaN, Infinity, { maintenance: NaN, logistics: 5, construction: 5 }, FULL);
    expect(Number.isFinite(r.balance)).toBe(true);
    expect(r.balance).toBeGreaterThanOrEqual(0);
    expect(r.paid.maintenance).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/treasury.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/engine/treasury.ts`:

```ts
/**
 * Faction treasury math — pure (no I/O, no world imports). Income lines value
 * real economic activity (employed heads by grade; realized physical output at
 * fixed reference values); bills are paid in a fixed priority ladder
 * maintenance → logistics → construction, so flow costs (a stalled queue)
 * starve before stock costs (unpaid upkeep) compound. Balance never goes
 * negative — there is no debt instrument.
 *
 * Every entry point coerces non-finite inputs to 0: a NaN reaching World state
 * becomes null under JSON.stringify and corrupts the save.
 */
import { clamp } from "@/lib/utils/math";
import { workCostPerLevel } from "@/lib/constants/construction";

/** One value per budget band. Used both for slider settings and paid/funded fractions. */
export interface TreasuryBands {
  maintenance: number;
  logistics: number;
  construction: number;
}

/** Employed heads by grade — the shape of `LabourAllocation`'s working fields. */
export interface HeadsTaxInput {
  unskilled: number;
  technicians: number;
  engineers: number;
}

export interface MaintenanceBillLine {
  buildingType: string;
  amount: number;
}

export interface MaintenanceBillResult {
  total: number;
  byType: MaintenanceBillLine[];
}

export interface SettlementLadderResult {
  /** Post-settlement balance, ≥ 0. */
  balance: number;
  /** Money actually paid per band. */
  paid: TreasuryBands;
  /** Paid fraction of each band's FULL bill — the effective funding level its
   *  consumers run at next month. When a band's bill is 0 this is the slider
   *  value (never 0/0). */
  funded: TreasuryBands;
}

const safe = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0);

export function headsTaxIncome(
  alloc: HeadsTaxInput,
  weights: HeadsTaxInput,
  ratePerHead: number,
  rateMult: number,
): number {
  const weighted =
    safe(alloc.unskilled) * safe(weights.unskilled) +
    safe(alloc.technicians) * safe(weights.technicians) +
    safe(alloc.engineers) * safe(weights.engineers);
  return weighted * safe(ratePerHead) * safe(rateMult);
}

export function productionTaxIncome(
  realizedByGood: ReadonlyMap<string, number>,
  referenceValues: Record<string, number>,
  rate: number,
  rateMult: number,
  economyScale: number,
): number {
  const scale = Number.isFinite(economyScale) && economyScale > 0 ? economyScale : 1;
  let assessed = 0;
  for (const [goodId, units] of realizedByGood) {
    const ref = referenceValues[goodId];
    if (ref === undefined || !Number.isFinite(units) || units <= 0) continue;
    assessed += (units / scale) * ref;
  }
  return assessed * safe(rate) * safe(rateMult);
}

export function maintenanceBill(
  levelsByType: ReadonlyMap<string, number>,
  ratePerWork: number,
): MaintenanceBillResult {
  const rate = safe(ratePerWork);
  const byType: MaintenanceBillLine[] = [];
  let total = 0;
  for (const [buildingType, levels] of levelsByType) {
    const amount = safe(levels) * workCostPerLevel(buildingType) * rate;
    if (amount <= 0) continue;
    byType.push({ buildingType, amount });
    total += amount;
  }
  return { total, byType };
}

const BAND_LADDER = ["maintenance", "logistics", "construction"] as const;

export function settleLadder(
  balance: number,
  income: number,
  bills: TreasuryBands,
  sliders: TreasuryBands,
): SettlementLadderResult {
  let available = safe(balance) + safe(income);
  const paid: TreasuryBands = { maintenance: 0, logistics: 0, construction: 0 };
  const funded: TreasuryBands = { maintenance: 0, logistics: 0, construction: 0 };
  for (const band of BAND_LADDER) {
    const bill = safe(bills[band]);
    const slider = clamp(Number.isFinite(sliders[band]) ? sliders[band] : 1, 0, 1);
    const charge = bill * slider;
    const pay = Math.min(charge, available);
    available -= pay;
    paid[band] = pay;
    funded[band] = bill > 0 ? pay / bill : slider;
  }
  return { balance: available, paid, funded };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/treasury.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/engine/treasury.ts lib/engine/__tests__/treasury.test.ts
git commit -m "feat(purse): treasury engine - income lines, maintenance bill, settlement ladder"
```

---

### Task 4: World rows, world-gen seeding, save-format bump

**Files:**
- Modify: `lib/world/types.ts` (new row types after `WorldAlliancePact` at line 270; `treasuries` on `World` after `alliancePacts` at line 370)
- Modify: `lib/world/gen.ts` (seed rows near the relations loop at lines 203-212; add to the returned `World` literal at lines 222-246)
- Modify: `lib/world/save.ts` (line 20: `SAVE_FORMAT_VERSION` 7 → 8)
- Test: `lib/world/__tests__/save.test.ts` (line 61 asserts `toBe(7)` — bump), `lib/world/__tests__/gen.test.ts` (add treasury seeding assertions; create the describe block in the existing gen test file)

**Interfaces:**
- Consumes: `TaxLevel` (`@/lib/types/game`), `TreasuryBands` (`@/lib/engine/treasury`), `DEFAULT_TAX_LEVEL` (`@/lib/constants/treasury`).
- Produces (verbatim, in `lib/world/types.ts`):

```ts
import type { TreasuryBands } from "@/lib/engine/treasury";
// (TaxLevel joins the existing type imports from "@/lib/types/game")

/** One system's contribution to a settlement's income, itemised for the UI and harness. */
export interface TreasuryIncomeBySystem {
  systemId: string;
  heads: number;
  production: number;
}

export interface TreasuryMaintenanceLine {
  buildingType: string;
  amount: number;
}

/** The last monthly settlement's itemised snapshot — persisted so UI reads never recompute transients. */
export interface WorldTreasurySettlement {
  tick: number;
  headsIncome: number;
  productionIncome: number;
  incomeBySystem: TreasuryIncomeBySystem[];
  maintenanceBill: number;
  maintenanceByType: TreasuryMaintenanceLine[];
  logisticsBill: number;
  constructionBill: number;
  paid: TreasuryBands;
}

/** One faction's treasury — the only persisted per-faction tick-mutable state. */
export interface WorldFactionTreasury {
  factionId: string;
  /** ≥ 0 — no debt instrument. */
  balance: number;
  taxLevel: TaxLevel;
  /** Funding sliders (0-1); maintenance is floored at 0.5 at every write boundary. */
  bands: TreasuryBands;
  /** Latched paid-fractions from the last settlement — the effective funding each band's consumers run at. */
  funded: TreasuryBands;
  /** Work performed since the last settlement (logistics S-normalised at accrual); billed then cleared. */
  pendingWork: { logistics: number; construction: number };
  lastSettlement: WorldTreasurySettlement | null;
  updatedAtTick: number;
}
```

  and on `World` (after `alliancePacts`): `treasuries: WorldFactionTreasury[];`

- [ ] **Step 1: Write the failing tests**

In `lib/world/__tests__/gen.test.ts` add:

```ts
describe("treasury seeding", () => {
  const world = generateWorld({ systemCount: 40, seed: 7 });

  it("seeds one zero-balance treasury per faction with full bands", () => {
    expect(world.treasuries).toHaveLength(world.factions.length);
    const byFaction = new Set(world.treasuries.map((t) => t.factionId));
    for (const f of world.factions) expect(byFaction.has(f.id)).toBe(true);
    for (const t of world.treasuries) {
      expect(t.balance).toBe(0);
      expect(t.bands).toEqual({ maintenance: 1, logistics: 1, construction: 1 });
      expect(t.funded).toEqual({ maintenance: 1, logistics: 1, construction: 1 });
      expect(t.pendingWork).toEqual({ logistics: 0, construction: 0 });
      expect(t.lastSettlement).toBeNull();
    }
  });

  it("flavours the default tax level by government", () => {
    for (const t of world.treasuries) {
      const faction = world.factions.find((f) => f.id === t.factionId)!;
      expect(t.taxLevel).toBe(DEFAULT_TAX_LEVEL[faction.governmentType]);
    }
  });
});
```

(Match the existing gen test's `generateWorld` call shape — check how the file constructs its fixture world and reuse it rather than generating a second world if one is already shared.)

In `lib/world/__tests__/save.test.ts`: change the `expect(SAVE_FORMAT_VERSION).toBe(7)` assertion at line 61 to `toBe(8)`, and update any fixture that hard-codes `formatVersion: 7` as the *current* version (version-rejection fixtures that deliberately use old numbers stay as they are).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/world/__tests__/gen.test.ts lib/world/__tests__/save.test.ts`
Expected: gen FAILs on `world.treasuries` being undefined (type error first — that's the signal); save FAILs on 7 ≠ 8.

- [ ] **Step 3: Implement**

1. Add the types above to `lib/world/types.ts` and `treasuries: WorldFactionTreasury[];` to `World`.
2. `lib/world/save.ts` line 20: `export const SAVE_FORMAT_VERSION = 8;`
3. `lib/world/gen.ts` — import `DEFAULT_TAX_LEVEL` from `@/lib/constants/treasury` and `WorldFactionTreasury` from `./types`, then after the relations loop:

```ts
// ── Treasuries (zero start — solvency is a calibration outcome, not a handout) ──
const treasuries: WorldFactionTreasury[] = factions.map((f) => ({
  factionId: f.id,
  balance: 0,
  taxLevel: DEFAULT_TAX_LEVEL[f.governmentType],
  bands: { maintenance: 1, logistics: 1, construction: 1 },
  funded: { maintenance: 1, logistics: 1, construction: 1 },
  pendingWork: { logistics: 0, construction: 0 },
  lastSettlement: null,
  updatedAtTick: 0,
}));
```

and add `treasuries,` to the returned `World` literal (after `relations,`).

4. Fix every other construction site of a full `World` literal the compiler now flags (tests/fixtures) by adding `treasuries: []` — let `npx tsc --noEmit` find them; do not hand-hunt.

- [ ] **Step 4: Typecheck + run the world test suite**

Run: `npx tsc --noEmit` then `npx vitest run lib/world`
Expected: clean compile; gen + save tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(purse): WorldFactionTreasury rows, world-gen seeding, save format v8"
```

---

### Task 5: Export realized production from the economy sim

**Files:**
- Modify: `lib/engine/supply-chain.ts` (`simulateSystemEconomyTick` lines 56-117, `simulateCoupledEconomyTick` lines 125-146)
- Modify: `lib/tick/types.ts` (`EconomySignals` at lines 51-60)
- Modify: `lib/tick/processors/economy.ts` (signal assembly at lines 150-178)
- Test: `lib/engine/__tests__/supply-chain.test.ts` (extend existing), `lib/tick/processors/__tests__/economy.test.ts` (extend existing)

**Interfaces:**
- Produces:
  - `interface SimulatedMarketEntry extends MarketTickEntry { realized: number }` (`@/lib/engine/supply-chain`); both simulate functions now return `SimulatedMarketEntry[]`.
  - `EconomySignals` gains a **required** third field: `realizedProductionBySystem: Map<string, Map<string, number>>` (systemId → goodId → physical units actually produced this pulse, post input-gate and operating-ceiling).

- [ ] **Step 1: Write the failing tests**

In `lib/engine/__tests__/supply-chain.test.ts` (reuse the file's existing entry fixtures/helpers):

```ts
it("reports realized output per entry — input-starved production realizes less than capacity", () => {
  // A producer of a recipe good with almost no input stock: gate ≈ 0 → realized ≈ 0.
  // A tier-0 producer with open band: realized ≈ effectiveProduction.
  // Build two entries with the file's fixture helper; assert:
  const simulated = simulateSystemEconomyTick(entries, { holdCover });
  expect(simulated[tier0Index].realized).toBeCloseTo(expectedFreeOutput);
  expect(simulated[starvedIndex].realized).toBeLessThan(capacityOfStarved * 0.1);
  // Non-producers report 0, not undefined:
  expect(simulated[consumerOnlyIndex].realized).toBe(0);
});
```

In `lib/tick/processors/__tests__/economy.test.ts` (using the existing `makeProducerSystem`/`makeMarket`/`makeCtx` fixtures):

```ts
it("exports realized production per (system, good) in economySignals", async () => {
  const systems = [makeProducerSystem("sys-1", 0)];
  const markets = [makeMarket("sys-1", "food", 100)];
  const world = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
  const result = await runEconomyProcessor(world, makeCtx(0), ECON_PARAMS);
  const realized = result.economySignals!.realizedProductionBySystem;
  expect(realized.get("sys-1")).toBeDefined();
  expect(realized.get("sys-1")!.get("food")).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/supply-chain.test.ts lib/tick/processors/__tests__/economy.test.ts`
Expected: FAIL — `realized` / `realizedProductionBySystem` do not exist.

- [ ] **Step 3: Implement**

`lib/engine/supply-chain.ts`:

```ts
/** A market entry after simulation: post-tick stock plus the physical output actually produced. */
export interface SimulatedMarketEntry extends MarketTickEntry {
  /** Output actually produced this run — post input-gate and operating-ceiling. 0 for non-producers. */
  realized: number;
}
```

In `simulateSystemEconomyTick` — change the return type to `SimulatedMarketEntry[]`, track realized output in a map, record `actualOutput` where it is computed (line 91), and fold into the return:

```ts
const realizedByGood = new Map<string, number>();
// ... inside the production branch, after `const actualOutput = ...`:
realizedByGood.set(entry.goodId, (realizedByGood.get(entry.goodId) ?? 0) + actualOutput);
// ... final return:
return entries.map((e) => ({
  ...e,
  stock: stockOf(e.goodId),
  realized: realizedByGood.get(e.goodId) ?? 0,
}));
```

In `simulateCoupledEconomyTick` — change the return type and the `result` array type to `SimulatedMarketEntry[]`; no other logic changes.

`lib/tick/types.ts` — add to `EconomySignals`:

```ts
  /** Per-system, per-good physical output actually produced this pulse (post
   *  input-gate and operating-ceiling) — the production-tax base. Absent system ⇒ produced nothing. */
  realizedProductionBySystem: Map<string, Map<string, number>>;
```

`lib/tick/processors/economy.ts` — in the measurement loop (alongside `uptakeBySystem`):

```ts
const realizedProductionBySystem = new Map<string, Map<string, number>>();
// inside markets.forEach((m, i) => { ... }):
const realized = simulated[i].realized;
if (realized > 0) {
  const bySystem = realizedProductionBySystem.get(m.systemId) ?? new Map<string, number>();
  bySystem.set(m.goodId, (bySystem.get(m.goodId) ?? 0) + realized);
  realizedProductionBySystem.set(m.systemId, bySystem);
}
// and in the signal assembly (line 178):
const economySignals: EconomySignals = { dissatisfactionBySystem, outputUptakeBySystem: uptakeBySystem, realizedProductionBySystem };
```

Then `npx tsc --noEmit` and fix every `EconomySignals` fixture the compiler flags (the infrastructure-decay and population processor tests construct them — add `realizedProductionBySystem: new Map()`).

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS (this change touches shared signal plumbing — run everything, not just the two files).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(purse): export realized per-(system,good) production via EconomySignals"
```

---

### Task 6: Export work performed — construction absorbed + logistics consumed

**Files:**
- Modify: `lib/engine/construction.ts` (`FundQueueResult` + `fundQueue` lines 93-120 + `fundQueueWithFloor` lines 148-188)
- Modify: `lib/tick/types.ts` (`TickProcessorResult` lines 62-68)
- Modify: `lib/tick/processors/directed-build.ts` (per-faction loop, funding call at lines 272-275, final return)
- Modify: `lib/tick/processors/directed-logistics.ts` (the `allTransfers` flatMap at lines 100-102, final return)
- Test: `lib/engine/__tests__/construction.test.ts`, `lib/tick/processors/__tests__/directed-build.test.ts`, `lib/tick/processors/__tests__/directed-logistics.test.ts` (extend the existing files)

**Interfaces:**
- Consumes: `PlannedTransfer.cost` (`@/lib/engine/directed-logistics`, the per-transfer work-budget spend).
- Produces:
  - `FundQueueResult` gains `absorbed: number` — total construction points actually consumed this pulse (Σ per-project take, both passes).
  - `TickProcessorResult` gains `workPerformedByFaction?: Map<string, number>` — emitted by directed-build (absorbed points) and directed-logistics (Σ transfer cost, raw/S-scaled), keyed by factionId; null-faction (independent) work is never billed and never appears.

- [ ] **Step 1: Write the failing tests**

`lib/engine/__tests__/construction.test.ts` (reuse existing project fixtures):

```ts
it("fundQueue reports total absorbed points", () => {
  const projects = [makeProject({ workTotal: 10, workDone: 0 }), makeProject({ workTotal: 10, workDone: 0 })];
  const r = fundQueue(projects, 6, 4);
  expect(r.absorbed).toBeCloseTo(6); // 4 to the first (cap), 2 to the second
});

it("fundQueueWithFloor's absorbed covers both passes and never exceeds the pool", () => {
  const r = fundQueueWithFloor(ordered, 10, 4, 3, isEligible);
  const workDelta = [...r.projects, ...r.landed].reduce((acc, p) => acc + p.workDone, 0)
    - ordered.reduce((acc, p) => acc + p.workDone, 0);
  expect(r.absorbed).toBeCloseTo(workDelta);
  expect(r.absorbed).toBeLessThanOrEqual(10);
});
```

`lib/tick/processors/__tests__/directed-build.test.ts`: using the file's existing world fixture, run the processor on a pulse tick with a funded queue and assert `result.workPerformedByFaction!.get(factionId)` is > 0 and ≤ the faction pool.

`lib/tick/processors/__tests__/directed-logistics.test.ts`: run a pulse with one matched transfer between two systems of one faction and assert `result.workPerformedByFaction!.get(factionId)` is > 0 (equal to the planned transfer cost).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: FAIL — `absorbed`/`workPerformedByFaction` missing.

- [ ] **Step 3: Implement**

`lib/engine/construction.ts` — add `absorbed: number` to `FundQueueResult` (its interface sits above `fundQueue`). In `fundQueue`: accumulate `let absorbedTotal = 0; ... absorbedTotal += absorbed;` and return `{ projects: open, landed, absorbed: absorbedTotal }`. In `fundQueueWithFloor`: pass A `absorbedTotal += take` (inside the `if (take > 0)`), pass B `absorbedTotal += take`, return it.

`lib/tick/types.ts` — extend `TickProcessorResult`:

```ts
  /** Work actually performed this pulse per faction (directed-build: construction
   *  points absorbed; directed-logistics: work-budget consumed). Transient input
   *  to the treasury settlement — not broadcast, not persisted. */
  workPerformedByFaction?: Map<string, number>;
```

`lib/tick/processors/directed-build.ts` — before the per-faction loop: `const workPerformedByFaction = new Map<string, number>();`. After the `fundQueueWithFloor` call (destructure `absorbed` too):

```ts
const { projects: fundedOpen, landed, absorbed } = fundQueueWithFloor(
  [...orderOpenProjects(existing), ...newProjects], pool, cap, reserved,
  (p) => p.kind === "build" && (floorBySystem.get(p.systemId) ?? 0) > 0,
);
if (factionId !== null && absorbed > 0) workPerformedByFaction.set(factionId, absorbed);
```

and include `workPerformedByFaction` in the processor's returned result object.

`lib/tick/processors/directed-logistics.ts` — replace the `allTransfers` flatMap with a loop that keeps faction attribution:

```ts
const workPerformedByFaction = new Map<string, number>();
const allTransfers: PlannedTransfer[] = [];
for (const [factionId, group] of byFaction) {
  const transfers = matchFactionTransfers(group.map((r) => toLogisticsState(r, catchUp)), params.routeCost);
  allTransfers.push(...transfers);
  if (factionId === null) continue;
  let work = 0;
  for (const t of transfers) work += t.cost;
  if (work > 0) workPerformedByFaction.set(factionId, work);
}
```

(import `type PlannedTransfer` from `@/lib/engine/directed-logistics`), and return `{ workPerformedByFaction }` from the body's final return (early returns keep returning `{}` — no keys resolved means no work).

Note: logistics bills the engine's *planned* spend (`t.cost`), not the post-clamp `moved` volume — the work-budget was consumed at matching, exactly as the spec's "work-budget actually consumed by transfers".

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(purse): export work performed per faction from directed-build + directed-logistics"
```

---

### Task 7: The treasury processor (tri-file) 

**Files:**
- Create: `lib/tick/world/treasury-world.ts`
- Create: `lib/tick/adapters/memory/treasury.ts`
- Create: `lib/tick/processors/treasury.ts`
- Test: `lib/tick/processors/__tests__/treasury.test.ts`

**Interfaces:**
- Consumes: `settleLadder`, `headsTaxIncome`, `productionTaxIncome`, `maintenanceBill`, `TreasuryBands` (`@/lib/engine/treasury`); `computeSystemLabourSnapshot` (`@/lib/engine/industry`); `isPulseTick`, `catchUpFactor` (`@/lib/tick/shard`); `WorldFactionTreasury`, `WorldTreasurySettlement`, `TreasuryIncomeBySystem`, `TreasuryMaintenanceLine` (`@/lib/world/types`); `TAX_LEVEL_RATE_MULT` (`@/lib/constants/treasury`); `TickContext`, `TickProcessorResult` (`../types`); ctx signal `ctx.results.get("economy")?.economySignals?.realizedProductionBySystem`.
- Produces (what Task 8 wires):

`lib/tick/world/treasury-world.ts` (verbatim):

```ts
import type { WorldFactionTreasury } from "@/lib/world/types";

/** One faction-owned developed system's tax base: heads for the heads tax,
 *  buildings for the maintenance bill. */
export interface TreasuryFactionSystemRow {
  systemId: string;
  factionId: string;
  population: number;
  buildings: Record<string, number>;
}

export interface TreasuryWorld {
  /** All faction treasuries (every faction has exactly one). */
  getTreasuries(): Promise<WorldFactionTreasury[]>;
  /** Faction-owned, economically active systems with the columns the taxes read. */
  getFactionSystems(): Promise<TreasuryFactionSystemRow[]>;
  /** Bulk-write settled/accrued treasury rows (matched by factionId). */
  applyTreasuryUpdates(updates: WorldFactionTreasury[]): Promise<void>;
}

/** Per-tick params sourced by `runWorldTick`. */
export interface TreasuryProcessorParams {
  /** Settlement cadence — the month pulse. */
  interval: number;
  /** ECONOMY_SCALE, for normalising S-scaled tax bases at collection. */
  economyScale: number;
  /** Construction points absorbed per faction this tick (directed-build's export). Empty map off-pulse. */
  constructionWorkByFaction: ReadonlyMap<string, number>;
  /** Logistics work-budget consumed per faction this tick (raw, S-scaled). Empty map off-pulse. */
  logisticsWorkByFaction: ReadonlyMap<string, number>;
  rates: {
    headsTaxPerMonth: number;
    headsWeights: { unskilled: number; technicians: number; engineers: number };
    productionTaxRate: number;
    referenceValues: Record<string, number>;
    maintenanceRatePerWork: number;
    constructionRatePerWork: number;
    logisticsRatePerWork: number;
  };
}
```

`lib/tick/adapters/memory/treasury.ts` (verbatim — the standard copy-on-construct / public-fields adapter):

```ts
import type { WorldFactionTreasury } from "@/lib/world/types";
import type { TreasuryWorld, TreasuryFactionSystemRow } from "@/lib/tick/world/treasury-world";

export class InMemoryTreasuryWorld implements TreasuryWorld {
  treasuries: WorldFactionTreasury[];
  systems: TreasuryFactionSystemRow[];

  constructor(initial: { treasuries: WorldFactionTreasury[]; systems: TreasuryFactionSystemRow[] }) {
    this.treasuries = initial.treasuries.map((t) => ({ ...t }));
    this.systems = initial.systems.map((s) => ({ ...s, buildings: { ...s.buildings } }));
  }

  getTreasuries(): Promise<WorldFactionTreasury[]> {
    return Promise.resolve(this.treasuries);
  }

  getFactionSystems(): Promise<TreasuryFactionSystemRow[]> {
    return Promise.resolve(this.systems);
  }

  applyTreasuryUpdates(updates: WorldFactionTreasury[]): Promise<void> {
    const byFaction = new Map(updates.map((u) => [u.factionId, u]));
    this.treasuries = this.treasuries.map((t) => byFaction.get(t.factionId) ?? t);
    return Promise.resolve();
  }
}
```

`lib/tick/processors/treasury.ts` (verbatim):

```ts
import type { TickContext, TickProcessorResult } from "../types";
import { isPulseTick, catchUpFactor } from "@/lib/tick/shard";
import {
  headsTaxIncome,
  productionTaxIncome,
  maintenanceBill,
  settleLadder,
} from "@/lib/engine/treasury";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { TAX_LEVEL_RATE_MULT } from "@/lib/constants/treasury";
import type {
  WorldFactionTreasury,
  WorldTreasurySettlement,
  TreasuryIncomeBySystem,
  TreasuryMaintenanceLine,
} from "@/lib/world/types";
import type { TreasuryWorld, TreasuryProcessorParams } from "@/lib/tick/world/treasury-world";

const EMPTY_REALIZED: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map();

/**
 * Monthly treasury settlement: collect both tax lines from the month just
 * produced, then pay bills in the fixed ladder maintenance → logistics →
 * construction; the paid fraction per band latches as that band's effective
 * funding for the following month. Off the month pulse the body only accrues
 * work performed by band pulses (bills charge work performed, not standing
 * capacity — the standing-cost job belongs to maintenance).
 *
 * Heads tax and maintenance are monthly rates → scaled by catchUpFactor here;
 * realized production and work quantities arrive already catchUp-scaled from
 * their own pulses and are never rescaled. Logistics work is S-scaled and is
 * normalised by economyScale at accrual; realized production at collection.
 */
export async function runTreasuryProcessor(
  world: TreasuryWorld,
  ctx: TickContext,
  params: TreasuryProcessorParams,
): Promise<TickProcessorResult> {
  const treasuries = await world.getTreasuries();
  if (treasuries.length === 0) return {};

  const settles = isPulseTick(ctx.tick, params.interval);
  const hasWork =
    params.constructionWorkByFaction.size > 0 || params.logisticsWorkByFaction.size > 0;
  if (!settles && !hasWork) return {};

  const scale =
    Number.isFinite(params.economyScale) && params.economyScale > 0 ? params.economyScale : 1;
  const catchUp = catchUpFactor(params.interval);
  const realizedBySystem =
    ctx.results.get("economy")?.economySignals?.realizedProductionBySystem ?? EMPTY_REALIZED;

  const systemsByFaction = new Map<string, { systemId: string; population: number; buildings: Record<string, number> }[]>();
  if (settles) {
    for (const s of await world.getFactionSystems()) {
      const list = systemsByFaction.get(s.factionId) ?? [];
      list.push(s);
      systemsByFaction.set(s.factionId, list);
    }
  }

  const updates: WorldFactionTreasury[] = [];
  for (const t of treasuries) {
    const pendingConstruction =
      t.pendingWork.construction + (params.constructionWorkByFaction.get(t.factionId) ?? 0);
    const pendingLogistics =
      t.pendingWork.logistics + (params.logisticsWorkByFaction.get(t.factionId) ?? 0) / scale;

    if (!settles) {
      if (
        pendingConstruction !== t.pendingWork.construction ||
        pendingLogistics !== t.pendingWork.logistics
      ) {
        updates.push({
          ...t,
          pendingWork: { construction: pendingConstruction, logistics: pendingLogistics },
          updatedAtTick: ctx.tick,
        });
      }
      continue;
    }

    const rateMult = TAX_LEVEL_RATE_MULT[t.taxLevel];
    const systems = systemsByFaction.get(t.factionId) ?? [];

    let headsIncome = 0;
    let productionIncome = 0;
    const incomeBySystem: TreasuryIncomeBySystem[] = [];
    const levelsByType = new Map<string, number>();
    for (const s of systems) {
      const alloc = computeSystemLabourSnapshot(s.buildings, s.population).basis;
      const heads =
        headsTaxIncome(alloc, params.rates.headsWeights, params.rates.headsTaxPerMonth, rateMult) *
        catchUp;
      const production = productionTaxIncome(
        realizedBySystem.get(s.systemId) ?? new Map<string, number>(),
        params.rates.referenceValues,
        params.rates.productionTaxRate,
        rateMult,
        scale,
      );
      headsIncome += heads;
      productionIncome += production;
      if (heads > 0 || production > 0) {
        incomeBySystem.push({ systemId: s.systemId, heads, production });
      }
      for (const [buildingType, count] of Object.entries(s.buildings)) {
        if (count > 0) levelsByType.set(buildingType, (levelsByType.get(buildingType) ?? 0) + count);
      }
    }

    const upkeep = maintenanceBill(levelsByType, params.rates.maintenanceRatePerWork);
    const bills = {
      maintenance: upkeep.total * catchUp,
      logistics: pendingLogistics * params.rates.logisticsRatePerWork,
      construction: pendingConstruction * params.rates.constructionRatePerWork,
    };
    const maintenanceByType: TreasuryMaintenanceLine[] = upkeep.byType.map((l) => ({
      buildingType: l.buildingType,
      amount: l.amount * catchUp,
    }));

    const income = headsIncome + productionIncome;
    const settled = settleLadder(t.balance, income, bills, t.bands);

    const lastSettlement: WorldTreasurySettlement = {
      tick: ctx.tick,
      headsIncome,
      productionIncome,
      incomeBySystem,
      maintenanceBill: bills.maintenance,
      maintenanceByType,
      logisticsBill: bills.logistics,
      constructionBill: bills.construction,
      paid: settled.paid,
    };

    updates.push({
      ...t,
      balance: settled.balance,
      funded: settled.funded,
      pendingWork: { construction: 0, logistics: 0 },
      lastSettlement,
      updatedAtTick: ctx.tick,
    });
  }

  if (updates.length > 0) await world.applyTreasuryUpdates(updates);
  return {};
}
```

Type note: `EMPTY_REALIZED` is typed with `ReadonlyMap` inner values while `realizedProductionBySystem` uses mutable `Map`s — if the compiler objects to the union, type the local as `ReadonlyMap<string, ReadonlyMap<string, number>>` (a `Map` satisfies `ReadonlyMap`, so the signal assigns cleanly).

- [ ] **Step 1: Write the failing tests** (`lib/tick/processors/__tests__/treasury.test.ts` — the fixture style mirrors `infrastructure-decay.test.ts`'s `ctxWith`):

```ts
import { describe, it, expect } from "vitest";
import { runTreasuryProcessor } from "@/lib/tick/processors/treasury";
import { InMemoryTreasuryWorld } from "@/lib/tick/adapters/memory/treasury";
import type { TreasuryProcessorParams } from "@/lib/tick/world/treasury-world";
import type { TickContext } from "@/lib/tick/types";
import type { WorldFactionTreasury } from "@/lib/world/types";

const RATES: TreasuryProcessorParams["rates"] = {
  headsTaxPerMonth: 0.01,
  headsWeights: { unskilled: 1, technicians: 3, engineers: 9 },
  productionTaxRate: 0.05,
  referenceValues: { food: 20 },
  maintenanceRatePerWork: 0.002,
  constructionRatePerWork: 0.5,
  logisticsRatePerWork: 0.05,
};

function makeParams(overrides: Partial<TreasuryProcessorParams> = {}): TreasuryProcessorParams {
  return {
    interval: 24,
    economyScale: 1,
    constructionWorkByFaction: new Map(),
    logisticsWorkByFaction: new Map(),
    rates: RATES,
    ...overrides,
  };
}

function makeTreasury(overrides: Partial<WorldFactionTreasury> = {}): WorldFactionTreasury {
  return {
    factionId: "faction-1",
    balance: 0,
    taxLevel: "normal",
    bands: { maintenance: 1, logistics: 1, construction: 1 },
    funded: { maintenance: 1, logistics: 1, construction: 1 },
    pendingWork: { logistics: 0, construction: 0 },
    lastSettlement: null,
    updatedAtTick: 0,
    ...overrides,
  };
}

function ctxWithRealized(tick: number, realized: Map<string, Map<string, number>>): TickContext {
  return {
    tick,
    results: new Map([
      ["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map(),
          outputUptakeBySystem: new Map(),
          realizedProductionBySystem: realized,
        },
      }],
    ]),
  };
}

const SYSTEM = { systemId: "sys-1", factionId: "faction-1", population: 100, buildings: { housing: 4, food: 2 } };

describe("treasury processor", () => {
  it("settles on the month pulse: collects both lines, pays bills, latches funded fractions", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(
      world,
      ctxWithRealized(24, new Map([["sys-1", new Map([["food", 10]])]])),
      makeParams(),
    );
    const t = world.treasuries[0];
    expect(t.lastSettlement).not.toBeNull();
    expect(t.lastSettlement!.headsIncome).toBeGreaterThan(0);
    expect(t.lastSettlement!.productionIncome).toBeCloseTo(10 * 20 * 0.05);
    expect(t.lastSettlement!.maintenanceBill).toBeGreaterThan(0);
    expect(t.balance).toBeGreaterThanOrEqual(0);
    expect(t.updatedAtTick).toBe(24);
  });

  it("accrues work off-pulse without settling, and bills it at the next settlement", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, { tick: 12, results: new Map() }, makeParams({
      constructionWorkByFaction: new Map([["faction-1", 8]]),
      logisticsWorkByFaction: new Map([["faction-1", 40]]),
      economyScale: 100,
    }));
    expect(world.treasuries[0].lastSettlement).toBeNull();
    expect(world.treasuries[0].pendingWork.construction).toBe(8);
    expect(world.treasuries[0].pendingWork.logistics).toBeCloseTo(0.4); // 40 / S=100

    await runTreasuryProcessor(world, ctxWithRealized(24, new Map()), makeParams({ economyScale: 100 }));
    const settled = world.treasuries[0].lastSettlement!;
    expect(settled.constructionBill).toBeCloseTo(8 * 0.5);
    expect(settled.logisticsBill).toBeCloseTo(0.4 * 0.05);
    expect(world.treasuries[0].pendingWork).toEqual({ logistics: 0, construction: 0 });
  });

  it("shorts the ladder bottom-up under insolvency and latches the paid fraction as funding", async () => {
    // Zero income (no systems), a construction backlog to bill, zero balance.
    const world = new InMemoryTreasuryWorld({
      treasuries: [makeTreasury({ pendingWork: { logistics: 0, construction: 100 } })],
      systems: [],
    });
    await runTreasuryProcessor(world, ctxWithRealized(24, new Map()), makeParams());
    const t = world.treasuries[0];
    expect(t.funded.construction).toBe(0); // billed 50, paid 0
    expect(t.funded.maintenance).toBe(1);  // zero-bill guard: slider value
    expect(t.balance).toBe(0);
  });

  it("is a no-op off-pulse with no work", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, { tick: 7, results: new Map() }, makeParams());
    expect(world.treasuries[0].updatedAtTick).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tick/processors/__tests__/treasury.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the three files** with the verbatim code from the Interfaces section above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tick/processors/__tests__/treasury.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tick/world/treasury-world.ts lib/tick/adapters/memory/treasury.ts lib/tick/processors/treasury.ts lib/tick/processors/__tests__/treasury.test.ts
git commit -m "feat(purse): treasury settlement processor (tri-file + tests)"
```

---

### Task 8: Wire the treasury stage into `runWorldTick`

**Files:**
- Modify: `lib/world/tick.ts` — imports at lines 64-82; a `treasuries` local alongside the other stage locals (~line 513-531); capture the two work maps inside the monthly-pulse block; new stage between the monthly-pulse block's close (line 845) and the relations stage (line 856); fold `treasuries` into `nextWorld` (lines 908-922)
- Test: `lib/world/__tests__/tick-treasury.test.ts` (new)

**Interfaces:**
- Consumes: everything Task 7 produced; `ECONOMY_SCALE` (`@/lib/constants/economy-scale`); `TREASURY`, `REFERENCE_VALUE` (`@/lib/constants/treasury`); `isEconomicallyActive` (already imported in tick.ts).
- Produces: `world.treasuries` advances every month pulse; `processorsRun` includes `"treasury"`.

- [ ] **Step 1: Write the failing integration test** (`lib/world/__tests__/tick-treasury.test.ts` — mirror the world-fixture style of `tick-monthly-pulse.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";

describe("treasury over the live tick", () => {
  it("settles every faction on the month pulse with finite, non-negative state", async () => {
    let world = generateWorld({ systemCount: 40, seed: 11 });
    let sawTreasuryRun = false;
    for (let i = 0; i < MONTH_LENGTH; i++) {
      const result = await runWorldTick(world);
      world = result.world;
      if (result.events.processors?.includes("treasury")) sawTreasuryRun = true;
    }
    expect(sawTreasuryRun).toBe(true);
    expect(world.treasuries.length).toBe(world.factions.length);
    for (const t of world.treasuries) {
      expect(t.lastSettlement, t.factionId).not.toBeNull();
      expect(Number.isFinite(t.balance)).toBe(true);
      expect(t.balance).toBeGreaterThanOrEqual(0);
      for (const band of ["maintenance", "logistics", "construction"] as const) {
        expect(t.funded[band]).toBeGreaterThanOrEqual(0);
        expect(t.funded[band]).toBeLessThanOrEqual(1);
      }
      // The world must survive a JSON round-trip (no NaN → null corruption).
      expect(JSON.parse(JSON.stringify(t))).toEqual(t);
    }
    // At least one faction earned something in a seeded 40-system galaxy.
    const totalIncome = world.treasuries.reduce(
      (acc, t) => acc + (t.lastSettlement?.headsIncome ?? 0) + (t.lastSettlement?.productionIncome ?? 0), 0);
    expect(totalIncome).toBeGreaterThan(0);
  });
});
```

(Check `runWorldTick`'s actual return shape in `tick.ts:497` — if `events.processors` is not where the processor list lands, read `TickBroadcastRaw` at `lib/tick/types.ts:71-77` and adjust the access; the field is `processors` on the broadcast payload.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/world/__tests__/tick-treasury.test.ts`
Expected: FAIL — `lastSettlement` stays null (`treasuries` never advances; if Task 4 wasn't wired, `world.treasuries` may be missing entirely).

- [ ] **Step 3: Implement the wiring** in `lib/world/tick.ts`:

1. Imports:

```ts
import { runTreasuryProcessor } from "@/lib/tick/processors/treasury";
import { InMemoryTreasuryWorld } from "@/lib/tick/adapters/memory/treasury";
import { ECONOMY_SCALE } from "@/lib/constants/economy-scale";
import { TREASURY, REFERENCE_VALUE } from "@/lib/constants/treasury";
```

2. With the other stage locals: `let treasuries = world.treasuries;` and, just above the monthly-pulse block:

```ts
let constructionWorkByFaction: Map<string, number> | undefined;
let logisticsWorkByFaction: Map<string, number> | undefined;
```

3. Inside the monthly-pulse block, capture the exports: where the directed-logistics stage runs its body, keep the result (`const dlResult = await runDirectedLogisticsProcessor(...)`) and set `logisticsWorkByFaction = dlResult.workPerformedByFaction;`; same for directed-build (`const dbResult = await runDirectedBuildProcessor(...)`; `constructionWorkByFaction = dbResult.workPerformedByFaction;`).

4. After the monthly-pulse block closes (after line 845), before the flow-events prune:

```ts
// ── treasury (monthly settlement; off-pulse it only accrues band-pulse work) ──
{
  const treasuryResolves = isPulseTick(tick, cadence.month);
  const hasWork =
    (constructionWorkByFaction?.size ?? 0) > 0 || (logisticsWorkByFaction?.size ?? 0) > 0;
  if (treasuries.length > 0 && (treasuryResolves || hasWork)) {
    const treasuryWorld = new InMemoryTreasuryWorld({
      treasuries,
      systems: systems
        .filter((s) => s.factionId !== null && isEconomicallyActive(s.control))
        .map((s) => ({
          systemId: s.id,
          factionId: s.factionId ?? "",
          population: s.population,
          buildings: s.buildings,
        })),
    });
    await runTreasuryProcessor(
      treasuryWorld,
      {
        tick,
        results: economySignals ? new Map([["economy", { economySignals }]]) : new Map(),
      },
      {
        interval: cadence.month,
        economyScale: ECONOMY_SCALE,
        constructionWorkByFaction: constructionWorkByFaction ?? new Map(),
        logisticsWorkByFaction: logisticsWorkByFaction ?? new Map(),
        rates: {
          headsTaxPerMonth: TREASURY.HEADS_TAX_PER_MONTH,
          headsWeights: TREASURY.HEADS_WEIGHTS,
          productionTaxRate: TREASURY.PRODUCTION_TAX_RATE,
          referenceValues: REFERENCE_VALUE,
          maintenanceRatePerWork: TREASURY.MAINTENANCE_RATE_PER_WORK,
          constructionRatePerWork: TREASURY.CONSTRUCTION_RATE_PER_WORK,
          logisticsRatePerWork: TREASURY.LOGISTICS_RATE_PER_WORK,
        },
      },
    );
    treasuries = treasuryWorld.treasuries;
    processorsRun.push("treasury");
  }
}
```

(`s.factionId ?? ""` is unreachable-but-typed: the filter already excluded nulls; if the narrowing doesn't flow through `.map`, this keeps the row typed without `!`. `TREASURY.HEADS_WEIGHTS` is `as const`-readonly — if the params type rejects it, spread it: `{ ...TREASURY.HEADS_WEIGHTS }`.)

5. Fold into `nextWorld` (the override list at lines 908-922): add `treasuries,` after `alliancePacts,`.

- [ ] **Step 4: Run the integration test + full suite**

Run: `npx vitest run lib/world/__tests__/tick-treasury.test.ts` then `npx vitest run`
Expected: PASS. Watch the pre-existing `cadence-invariance` and `tick-monthly-pulse` world tests — they exercise the whole pipeline and will catch a treasury stage that throws or corrupts state.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(purse): wire treasury settlement into runWorldTick"
```

---

### Task 9: Harness metrics — the coarse health bar for money

**Files:**
- Create: `lib/tick-harness/treasury-analysis.ts`
- Modify: `lib/tick-harness/types.ts` (extend `HarnessResults`), `lib/tick-harness/runner.ts` (sample + summarize), `scripts/simulate.ts` (report block in `formatTable`, lines ~267-308 region)
- Test: `lib/tick-harness/__tests__/treasury-analysis.test.ts`

**Interfaces:**
- Produces:

```ts
// lib/tick-harness/treasury-analysis.ts
import type { WorldFactionTreasury } from "@/lib/world/types";

/** One sampled point of the roster's balance trajectory. */
export interface TreasurySnapshot {
  tick: number;
  meanBalance: number;
  minBalance: number;
  /** Factions whose last settlement shorted any band below its slider. */
  shortedFactions: number;
}

export interface TreasurySummary {
  factionCount: number;
  meanBalance: number;
  minBalance: number;
  maxBalance: number;
  /** Aggregate income shares across the roster's last settlements (0-1; NaN-free). */
  headsShare: number;
  productionShare: number;
  /** Mean latched funded fraction per band. */
  fundedMeans: { maintenance: number; logistics: number; construction: number };
  /** Standing guards: rows with non-finite or negative money values. */
  invalidRows: number;
  /** First sampled tick where any faction shorted a band, or null if never. */
  firstShortfallTick: number | null;
}

export function sampleTreasuries(tick: number, treasuries: WorldFactionTreasury[]): TreasurySnapshot;
export function summarizeTreasuries(treasuries: WorldFactionTreasury[], snapshots: TreasurySnapshot[]): TreasurySummary;
```

A faction "shorted a band" when `lastSettlement !== null` and for any band `funded[band] < bands[band] - 1e-9` (paid fraction below its slider setting).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { sampleTreasuries, summarizeTreasuries } from "@/lib/tick-harness/treasury-analysis";
import type { WorldFactionTreasury } from "@/lib/world/types";

function makeTreasury(overrides: Partial<WorldFactionTreasury>): WorldFactionTreasury {
  return {
    factionId: "f1", balance: 10, taxLevel: "normal",
    bands: { maintenance: 1, logistics: 1, construction: 1 },
    funded: { maintenance: 1, logistics: 1, construction: 1 },
    pendingWork: { logistics: 0, construction: 0 },
    lastSettlement: {
      tick: 24, headsIncome: 6, productionIncome: 4, incomeBySystem: [],
      maintenanceBill: 2, maintenanceByType: [], logisticsBill: 1, constructionBill: 1,
      paid: { maintenance: 2, logistics: 1, construction: 1 },
    },
    updatedAtTick: 24,
    ...overrides,
  };
}

describe("treasury analysis", () => {
  it("computes balances, income shares, and flags shorted factions", () => {
    const solvent = makeTreasury({ factionId: "f1", balance: 20 });
    const shorted = makeTreasury({
      factionId: "f2", balance: 0,
      funded: { maintenance: 1, logistics: 0.5, construction: 0 },
    });
    const snap = sampleTreasuries(24, [solvent, shorted]);
    expect(snap.meanBalance).toBeCloseTo(10);
    expect(snap.minBalance).toBe(0);
    expect(snap.shortedFactions).toBe(1);

    const summary = summarizeTreasuries([solvent, shorted], [snap]);
    expect(summary.factionCount).toBe(2);
    expect(summary.headsShare).toBeCloseTo(0.6); // 12 of 20 total income
    expect(summary.productionShare).toBeCloseTo(0.4);
    expect(summary.firstShortfallTick).toBe(24);
    expect(summary.invalidRows).toBe(0);
  });

  it("counts non-finite or negative balances as invalid rows", () => {
    const bad = makeTreasury({ factionId: "f3", balance: NaN });
    expect(summarizeTreasuries([bad], []).invalidRows).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tick-harness/__tests__/treasury-analysis.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/tick-harness/treasury-analysis.ts`:

```ts
import type { WorldFactionTreasury } from "@/lib/world/types";

export interface TreasurySnapshot {
  tick: number;
  meanBalance: number;
  minBalance: number;
  shortedFactions: number;
}

export interface TreasurySummary {
  factionCount: number;
  meanBalance: number;
  minBalance: number;
  maxBalance: number;
  headsShare: number;
  productionShare: number;
  fundedMeans: { maintenance: number; logistics: number; construction: number };
  invalidRows: number;
  firstShortfallTick: number | null;
}

const BANDS = ["maintenance", "logistics", "construction"] as const;

function isShorted(t: WorldFactionTreasury): boolean {
  if (t.lastSettlement === null) return false;
  return BANDS.some((band) => t.funded[band] < t.bands[band] - 1e-9);
}

export function sampleTreasuries(tick: number, treasuries: WorldFactionTreasury[]): TreasurySnapshot {
  const balances = treasuries.map((t) => t.balance);
  const total = balances.reduce((acc, b) => acc + b, 0);
  return {
    tick,
    meanBalance: treasuries.length > 0 ? total / treasuries.length : 0,
    minBalance: balances.length > 0 ? Math.min(...balances) : 0,
    shortedFactions: treasuries.filter(isShorted).length,
  };
}

export function summarizeTreasuries(
  treasuries: WorldFactionTreasury[],
  snapshots: TreasurySnapshot[],
): TreasurySummary {
  const balances = treasuries.map((t) => t.balance);
  const total = balances.reduce((acc, b) => acc + b, 0);
  let heads = 0;
  let production = 0;
  const fundedSums = { maintenance: 0, logistics: 0, construction: 0 };
  let invalidRows = 0;
  for (const t of treasuries) {
    const moneyFields = [t.balance, t.pendingWork.logistics, t.pendingWork.construction];
    if (moneyFields.some((v) => !Number.isFinite(v) || v < 0)) invalidRows++;
    heads += t.lastSettlement?.headsIncome ?? 0;
    production += t.lastSettlement?.productionIncome ?? 0;
    for (const band of BANDS) fundedSums[band] += t.funded[band];
  }
  const income = heads + production;
  const n = Math.max(1, treasuries.length);
  const firstShortfall = snapshots.find((s) => s.shortedFactions > 0);
  return {
    factionCount: treasuries.length,
    meanBalance: treasuries.length > 0 ? total / treasuries.length : 0,
    minBalance: balances.length > 0 ? Math.min(...balances) : 0,
    maxBalance: balances.length > 0 ? Math.max(...balances) : 0,
    headsShare: income > 0 ? heads / income : 0,
    productionShare: income > 0 ? production / income : 0,
    fundedMeans: {
      maintenance: fundedSums.maintenance / n,
      logistics: fundedSums.logistics / n,
      construction: fundedSums.construction / n,
    },
    invalidRows,
    firstShortfallTick: firstShortfall ? firstShortfall.tick : null,
  };
}
```

`lib/tick-harness/types.ts` — add to `HarnessResults`: `treasurySummary: TreasurySummary; treasurySnapshots: TreasurySnapshot[];` (import the types from `./treasury-analysis`).

`lib/tick-harness/runner.ts` — in the tick loop's existing `SNAPSHOT_INTERVAL` sampling branch (lines 108-113), push `sampleTreasuries(tick, world.treasuries)` into a `treasurySnapshots` array; in the returned results (lines 142-156), add `treasurySummary: summarizeTreasuries(finalWorld.treasuries, treasurySnapshots), treasurySnapshots`.

`scripts/simulate.ts` — in `formatTable`, after the construction-pool block (~line 275):

```ts
const ts = results.treasurySummary;
lines.push(
  `Treasury: ${ts.factionCount} factions | balance mean ${fmtNum(ts.meanBalance)} ` +
    `(min ${fmtNum(ts.minBalance)}, max ${fmtNum(ts.maxBalance)}) | ` +
    `income ${(ts.headsShare * 100).toFixed(0)}% heads / ${(ts.productionShare * 100).toFixed(0)}% production`,
);
lines.push(
  `  funded: maint ${(ts.fundedMeans.maintenance * 100).toFixed(0)}% | ` +
    `logi ${(ts.fundedMeans.logistics * 100).toFixed(0)}% | ` +
    `constr ${(ts.fundedMeans.construction * 100).toFixed(0)}%` +
    (ts.firstShortfallTick !== null ? ` | first shortfall t=${ts.firstShortfallTick}` : " | never shorted") +
    (ts.invalidRows > 0 ? ` | ⚠ ${ts.invalidRows} INVALID ROWS` : ""),
);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run lib/tick-harness` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(purse): harness treasury metrics + simulate report block"
```

---

### Task 10: Calibration pass — early-game solvency on the real tick

This task has no new code deliverable; its deliverable is **tuned constants** in `lib/constants/treasury.ts` and a recorded baseline.

- [ ] **Step 1: Run the default quick sim**

Run: `npm run simulate`
Read the new Treasury block. Acceptance bar (coarse health only — per the working practices, no precision tuning):
- `invalidRows` = 0 (hard fail otherwise — find the NaN source before touching rates).
- No designed-permanent insolvency: `fundedMeans.construction` must not pin at 0 across the run.
- **Early-game solvency:** the zero-start opening must not stall by bookkeeping accident — `firstShortfallTick` in the first few months is acceptable only if funded fractions recover; a roster majority shorted at every snapshot is a rate-tuning fault.
- No runaway hoard: mean balance should not grow monotonically unbounded relative to monthly income (a monotone hoard means the maintenance sink is undersized).

- [ ] **Step 2: Run the longer horizon**

Run: `npm run simulate -- --config experiments/examples/baseline.yaml` (or a 1500-tick run if baseline is shorter — remember the 500-tick default is pre-logistics; logistics bills only appear after transfers start ~t=456).

- [ ] **Step 3: Tune** `TREASURY.HEADS_TAX_PER_MONTH`, `PRODUCTION_TAX_RATE`, `MAINTENANCE_RATE_PER_WORK`, `CONSTRUCTION_RATE_PER_WORK`, `LOGISTICS_RATE_PER_WORK` until the bar above holds at both horizons. Adjust income rates before sink rates (the sink sizes the hoard ceiling; income sizes early solvency). Re-run `npx vitest run` after tuning — the engine tests use explicit rates and stay green, but the constants test's floor assertions must still hold.

- [ ] **Step 4: Verify the PR build gate**

Run: `npx next build --webpack`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/treasury.ts
git commit -m "feat(purse): calibrate treasury rates against the harness health bar"
```

---

## Deliverable / definition of done for Plan 1

- `npm run simulate` prints a Treasury block showing every faction collecting, paying, and staying finite; early-game solvency holds at both horizons.
- `npx vitest run`, `npx tsc --noEmit`, and `npx next build --webpack` are green.
- Funded fractions latch monthly on every treasury row — **consumed by nothing yet** (Plan 2 gates construction/logistics/maintenance off them; Plan 3 surfaces them).
- Save format is v8; New Game seeds zero-balance treasuries with government-flavoured tax levels.

## Follow-up plans (not this plan)

- **Plan 2 — the effects:** thread `funded.construction` into the directed-build pool (`directed-build.ts:178`), `funded.logistics` into the logistics generation (`directed-logistics.ts:35`), maintenance funding into idle-decay aggression (`infrastructure-decay.ts:101` accrual / `idleBufferMonths`) + the output malus (a sibling multiplier to `productionSuppress` at `market-tick-builder`/`engine/tick.ts` — must NOT feed `buildingUsed`), and `TAX_LEVEL_UNREST_PRESSURE` into the population processor's `d` term. Extend the S-invariance and cadence-invariance world tests to cover treasury trajectories once money has behavioural consequences.
- **Plan 3 — player surfaces:** faction services/API additions, Zod-validated mutations (tax level, band sliders with the 0.5 maintenance floor), the construction-card funded readout, and the treasury card — **after** its collaborative HTML design pass. The reserved `GhostVitalTile` slot is at `app/(game)/@panel/factions/[factionId]/page.tsx:64-74`.
