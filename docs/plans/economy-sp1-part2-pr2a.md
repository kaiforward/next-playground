# Economy SP1 Part 2 — PR 2a: Engine + Constants + Substrate-Service Compute

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the physical-driver economy machinery (new constant tables, a pure `physicalRates` function, and a substrate read-service that exposes per-good production/consumption) and simplify the market tick pipeline to gate on rate — all with **zero live behaviour change**, so PR 2b's cutover is a one-line rate-source swap.

**Architecture:** Two independent tracks land in one PR. **Track A (additive):** new `GOOD_PRODUCTION` / `GOOD_CONSUMPTION` driver tables + a pure `physicalRates(goodId, aggregate, population)` engine function, surfaced through the existing `getSystemSubstrate` read service as a new `goods[]` field (no UI consumer yet). **Track B (behaviour-preserving refactor):** `simulateEconomyTick` stops checking `produces`/`consumes` membership and gates purely on `rate > 0`; the now-unused `economyType`/`produces`/`consumes` fields are removed from the tick pipeline (`MarketTickEntry`, `TickEntryInput`, `MarketTickInput`, `MarketView`, both adapters, the processor). The old `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION` tables still drive the live tick via the adapters in this PR — they are deleted in 2b.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Pure engine functions (zero DB). Prisma 7 read in the service layer only.

## Global Constraints

These apply to **every** task. Copied from `CLAUDE.md` + the locked design (`docs/planned/economy-simulation-substrate.md` §8.1):

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. If a type won't infer, fix it at the source.
- **No `unknown`** and **no `Record<string, unknown>`** anywhere. Good-keyed maps use `Record<string, …>` to match the existing `GOODS` / `ECONOMY_PRODUCTION` convention (there is no `GoodId` union in this codebase — do **not** invent one here).
- **Engine functions are pure** — no DB, no Prisma imports. Engine may import from `lib/constants/*` (established: `economy-shim.ts` imports `SUBSTRATE_GEN`).
- **Code comments describe the code's behaviour/purpose, never the PR/phase/plan.** Do **not** write "PR 2a", "Part 2", "2b", or "tuned in 2c" in any code comment or commit message. Say "first-draft values, calibrated via the simulator" instead. (Per the user's standing feedback on comments + clean history.)
- **TDD**: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- **Commit messages** are clean conventional commits describing the code (`feat(economy): …`), not the plan step.
- Test runner: `npx vitest run <path>` for one file; `npm run test:unit` for the whole unit project. Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`.
- **Behaviour parity is the gate for Track B.** The full unit suite — including `lib/engine/__tests__/simulator-integration.test.ts` — must pass unchanged after Tasks 4–5. That suite is the proof the refactor changed no economic output.

### Why Track B is behaviour-preserving (read before Task 4)

1. **Production gating.** The live adapter sets `baseProductionRate = getProductionRate(econ, goodKey)`, which is defined **iff** `goodKey ∈ produces`. The builder sets `productionRate` only when `baseProductionRate != null`. So `productionRate > 0` ⟺ "good is produced with a positive rate" ⟺ the old `productionRate > 0 && produces.includes(goodId)`. Dropping the membership check changes nothing.
2. **Consumption gating + the dead boost-only branch.** Same identity holds for `baseConsumptionRate`/`consumes`. The builder's *boost-only* branch (`baseConsumptionRate == null` but `govConsumptionBoost > 0`) sets a `consumptionRate` for a good the system does **not** consume — but `simulateEconomyTick`'s old `consumes.includes(goodId)` check **always gated that out** (base null ⟺ good ∉ consumes). So that branch is dead in the live game today. Removing the membership check *and* the boost-only branch together keeps `consumptionRate` undefined for non-consumed goods → still no drain. Net behaviour: identical.

---

## File Structure

**New files**
- `lib/constants/physical-economy.ts` — `GOOD_PRODUCTION` (driver coeff + optional resource), `GOOD_CONSUMPTION` (per-capita need), `LABOUR_HALF_POP`. First-draft magnitudes, simulator-calibrated later.
- `lib/constants/__tests__/physical-economy.test.ts` — table-completeness + resource-mapping tests.
- `lib/engine/physical-economy.ts` — `labourFactor`, `physicalRates`, `substrateGoodRates`, and the `PhysicalRates` / `SubstrateGoodRate` types. Pure.
- `lib/engine/__tests__/physical-economy.test.ts` — formula behaviour tests.

**Modified files**
- `lib/types/api.ts` — add `goods: SubstrateGoodRate[]` to the `visible` branch of `SystemSubstrateData`.
- `lib/services/universe.ts` — `getSystemSubstrate` populates `goods` via `substrateGoodRates`.
- `lib/engine/tick.ts` — `simulateEconomyTick` gates on rate; remove fields from `MarketTickEntry`/`TickEntryInput`; drop the boost-only branch in `buildMarketTickEntry`.
- `lib/engine/market-tick-builder.ts` — remove `economyType`/`produces`/`consumes` from `MarketTickInput` + `resolveMarketTickEntry`.
- `lib/tick/world/economy-world.ts` — remove `economyType`/`produces`/`consumes` from `MarketView`.
- `lib/tick/adapters/prisma/economy.ts` — stop returning the three fields (keep local `economyType` for rate derivation).
- `lib/tick/adapters/memory/economy.ts` — stop returning the three fields.
- `lib/tick/processors/economy.ts` — stop passing the three fields into `resolveMarketTickEntry`.
- `lib/engine/__tests__/tick.test.ts` — update the two affected assertions + the `entry()` helper + builder-input shapes.

**Untouched in this PR (deliberately):** `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION` (`lib/constants/universe.ts`), `SELF_SUFFICIENCY`/`getConsumeEquilibrium` (`lib/constants/economy.ts`), `getInitialStock`/`getTargetStock`/`CALIBRATED_TARGET_STOCK` (`lib/constants/market-economy.ts`), the economy shim (`lib/engine/economy-shim.ts`), `prisma/seed.ts`, the simulator world builder, all UI. These are 2b/2c/2d.

---

## Task 1: Physical-driver constant tables

**Files:**
- Create: `lib/constants/physical-economy.ts`
- Test: `lib/constants/__tests__/physical-economy.test.ts`

**Interfaces:**
- Consumes: `ResourceType` from `@/lib/types/game`; `GOODS`, `GOOD_NAMES`, `GOOD_TIER_BY_KEY` from `@/lib/constants/goods` (tests only).
- Produces:
  - `interface GoodProductionDriver { coeff: number; resource?: ResourceType }`
  - `const GOOD_PRODUCTION: Record<string, GoodProductionDriver>` — one entry per good.
  - `const GOOD_CONSUMPTION: Record<string, number>` — per-capita need, one entry per good.
  - `const LABOUR_HALF_POP: number` — population at which `labourFactor` = 0.5.

- [ ] **Step 1: Write the failing test**

Create `lib/constants/__tests__/physical-economy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  GOOD_PRODUCTION,
  GOOD_CONSUMPTION,
  LABOUR_HALF_POP,
} from "../physical-economy";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "../goods";
import { RESOURCE_TYPES } from "@/lib/engine/resources";

describe("GOOD_PRODUCTION / GOOD_CONSUMPTION coverage", () => {
  it("has a production driver and a consumption need for every good", () => {
    for (const goodId of GOOD_NAMES) {
      expect(GOOD_PRODUCTION[goodId], `production: ${goodId}`).toBeDefined();
      expect(GOOD_CONSUMPTION[goodId], `consumption: ${goodId}`).toBeDefined();
    }
  });

  it("defines no drivers or needs for goods that do not exist", () => {
    const known = new Set(GOOD_NAMES);
    for (const goodId of Object.keys(GOOD_PRODUCTION)) expect(known.has(goodId)).toBe(true);
    for (const goodId of Object.keys(GOOD_CONSUMPTION)) expect(known.has(goodId)).toBe(true);
  });

  it("uses positive coefficients and per-capita needs", () => {
    for (const goodId of GOOD_NAMES) {
      expect(GOOD_PRODUCTION[goodId].coeff).toBeGreaterThan(0);
      expect(GOOD_CONSUMPTION[goodId]).toBeGreaterThan(0);
    }
  });
});

describe("resource-driven vs labour-only split", () => {
  it("maps tier-0 goods to their driving resource", () => {
    expect(GOOD_PRODUCTION.water.resource).toBe("water");
    expect(GOOD_PRODUCTION.ore.resource).toBe("ore");
    expect(GOOD_PRODUCTION.food.resource).toBe("arable");
    expect(GOOD_PRODUCTION.textiles.resource).toBe("arable");
  });

  it("leaves tier-1/2 goods labour-only (no resource gate)", () => {
    for (const goodId of GOOD_NAMES) {
      if (GOOD_TIER_BY_KEY[goodId] === 0) {
        expect(GOOD_PRODUCTION[goodId].resource, `tier-0 ${goodId}`).toBeDefined();
      } else {
        expect(GOOD_PRODUCTION[goodId].resource, `tier-${GOOD_TIER_BY_KEY[goodId]} ${goodId}`).toBeUndefined();
      }
    }
  });

  it("never drives production from an economically-inert resource", () => {
    const inert = new Set(["gas", "minerals", "biomass", "radioactive"]);
    for (const goodId of GOOD_NAMES) {
      const res = GOOD_PRODUCTION[goodId].resource;
      if (res) expect(inert.has(res), `${goodId} → ${res}`).toBe(false);
    }
    // sanity: the inert set is a subset of the real resource types
    for (const r of inert) expect(RESOURCE_TYPES).toContain(r);
  });
});

describe("LABOUR_HALF_POP", () => {
  it("is a positive population magnitude", () => {
    expect(LABOUR_HALF_POP).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/constants/__tests__/physical-economy.test.ts`
Expected: FAIL — `Cannot find module '../physical-economy'`.

- [ ] **Step 3: Create the constants module**

Create `lib/constants/physical-economy.ts`:

```typescript
/**
 * Physical-driver economy tables — production and consumption derive from a
 * system's substrate (resource aggregate + population), not an economy-type
 * rate table.
 *
 * Production rate per good:
 *   coeff × labourFactor(population) × (resource ? aggregate[resource] : 1)
 * Tier-0 goods are resource-driven (scale with a deposit magnitude); tier-1/2
 * goods are labour-only (space/labour-bound, no deposit gate). Consumption is
 * universal and population-scaled: perCapitaNeed × population.
 *
 * All magnitudes are first-draft and calibrated via the simulator; only their
 * relative shape matters here (higher tier → smaller coeff and smaller need).
 */
import type { ResourceType } from "@/lib/types/game";

export interface GoodProductionDriver {
  /** Production coefficient — multiplied by labour (and the resource magnitude when resource-driven). */
  coeff: number;
  /** Tier-0 resource whose aggregate magnitude gates production. Omitted for labour-only goods. */
  resource?: ResourceType;
}

/** Per-good production drivers. Arable splits across food + textiles via differing coeffs. */
export const GOOD_PRODUCTION: Record<string, GoodProductionDriver> = {
  // Tier 0 — resource-driven (scale with deposit magnitude AND labour).
  water: { coeff: 1.5, resource: "water" },
  food: { coeff: 1.5, resource: "arable" },
  ore: { coeff: 1.2, resource: "ore" },
  textiles: { coeff: 0.6, resource: "arable" },
  // Tier 1 — labour-only.
  fuel: { coeff: 5 },
  metals: { coeff: 5 },
  chemicals: { coeff: 4 },
  medicine: { coeff: 3.5 },
  // Tier 2 — labour-only, smaller coeffs (luxuries rarest).
  electronics: { coeff: 3 },
  machinery: { coeff: 2.5 },
  weapons: { coeff: 2 },
  luxuries: { coeff: 1.5 },
};

/** Per-good per-capita consumption need. consRate = need × population. Higher tier → lower need. */
export const GOOD_CONSUMPTION: Record<string, number> = {
  // Tier 0.
  water: 0.004,
  food: 0.004,
  ore: 0.002,
  textiles: 0.002,
  // Tier 1.
  fuel: 0.0015,
  metals: 0.0015,
  chemicals: 0.0015,
  medicine: 0.001,
  // Tier 2.
  electronics: 0.001,
  machinery: 0.0008,
  weapons: 0.0005,
  luxuries: 0.0005,
};

/** Population at which labourFactor reaches 0.5 (soft-saturating curve). First-draft; simulator-calibrated. */
export const LABOUR_HALF_POP = 500;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/constants/__tests__/physical-economy.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add lib/constants/physical-economy.ts lib/constants/__tests__/physical-economy.test.ts
git commit -m "feat(economy): add physical-driver production/consumption tables"
```

---

## Task 2: Pure `physicalRates` engine function

**Files:**
- Create: `lib/engine/physical-economy.ts`
- Test: `lib/engine/__tests__/physical-economy.test.ts`

**Interfaces:**
- Consumes: `ResourceVector` from `@/lib/types/game`; `GOOD_PRODUCTION`, `GOOD_CONSUMPTION`, `LABOUR_HALF_POP` from `@/lib/constants/physical-economy`; `makeResourceVector` from `@/lib/engine/resources` (tests only).
- Produces:
  - `interface PhysicalRates { production: number; consumption: number }`
  - `function labourFactor(population: number): number` — `pop / (pop + LABOUR_HALF_POP)`, `0` for `pop <= 0`.
  - `function physicalRates(goodId: string, aggregate: ResourceVector, population: number): PhysicalRates`

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/physical-economy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { labourFactor, physicalRates } from "../physical-economy";
import { makeResourceVector } from "../resources";
import { LABOUR_HALF_POP, GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";

const AGG = makeResourceVector({ water: 10, ore: 5, arable: 8 });

describe("labourFactor", () => {
  it("is 0 at or below zero population", () => {
    expect(labourFactor(0)).toBe(0);
    expect(labourFactor(-100)).toBe(0);
  });

  it("is 0.5 at the half-saturation population", () => {
    expect(labourFactor(LABOUR_HALF_POP)).toBeCloseTo(0.5, 10);
  });

  it("rises monotonically and saturates below 1", () => {
    expect(labourFactor(100)).toBeLessThan(labourFactor(1000));
    expect(labourFactor(1_000_000)).toBeLessThan(1);
    expect(labourFactor(1_000_000)).toBeGreaterThan(0.99);
  });
});

describe("physicalRates — production", () => {
  it("scales a resource-driven good with its resource aggregate", () => {
    const lo = physicalRates("water", makeResourceVector({ water: 5 }), 1000);
    const hi = physicalRates("water", makeResourceVector({ water: 10 }), 1000);
    expect(hi.production).toBeCloseTo(lo.production * 2, 10); // linear in aggregate
    expect(lo.production).toBeGreaterThan(0);
  });

  it("ignores the aggregate for a labour-only good", () => {
    const a = physicalRates("luxuries", makeResourceVector({ ore: 0 }), 1000);
    const b = physicalRates("luxuries", makeResourceVector({ ore: 99 }), 1000);
    expect(a.production).toBeCloseTo(b.production, 10);
    expect(a.production).toBeGreaterThan(0);
  });

  it("scales production with labour (population)", () => {
    const low = physicalRates("luxuries", AGG, 100);
    const high = physicalRates("luxuries", AGG, 2000);
    expect(high.production).toBeGreaterThan(low.production);
  });

  it("yields zero production for an unknown good", () => {
    expect(physicalRates("not_a_good", AGG, 1000).production).toBe(0);
  });
});

describe("physicalRates — consumption", () => {
  it("scales linearly with population", () => {
    const single = physicalRates("food", AGG, 100).consumption;
    const triple = physicalRates("food", AGG, 300).consumption;
    expect(triple).toBeCloseTo(single * 3, 10);
    expect(single).toBeCloseTo(GOOD_CONSUMPTION.food * 100, 10);
  });

  it("is zero at zero population for every term", () => {
    const r = physicalRates("food", AGG, 0);
    expect(r.production).toBe(0);
    expect(r.consumption).toBe(0);
  });

  it("yields zero consumption for an unknown good", () => {
    expect(physicalRates("not_a_good", AGG, 1000).consumption).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/physical-economy.test.ts`
Expected: FAIL — `Cannot find module '../physical-economy'`.

- [ ] **Step 3: Create the engine module**

Create `lib/engine/physical-economy.ts`:

```typescript
/**
 * Pure physical-economy rates — zero DB dependency.
 *
 * A system's production and consumption for a good derive from its physical
 * substrate: the aggregate resource vector and population. The same function
 * feeds the live tick, the simulator, and the read service so there is one
 * source of truth for the formula.
 */
import type { ResourceVector } from "@/lib/types/game";
import {
  GOOD_PRODUCTION,
  GOOD_CONSUMPTION,
  LABOUR_HALF_POP,
} from "@/lib/constants/physical-economy";

/** Production + consumption rate for one good at one system. */
export interface PhysicalRates {
  production: number;
  consumption: number;
}

/**
 * Normalized, soft-saturating labour scalar in [0, 1). Zero at no population,
 * 0.5 at LABOUR_HALF_POP, asymptotic to 1. A fixed per-system value while
 * population is static.
 */
export function labourFactor(population: number): number {
  if (population <= 0) return 0;
  return population / (population + LABOUR_HALF_POP);
}

/**
 * Physical production + consumption rates for a good at a system.
 *   production  = coeff × labour × (resource-driven ? aggregate[resource] : 1)
 *   consumption = perCapitaNeed × population
 * Unknown goods yield zero on both axes.
 */
export function physicalRates(
  goodId: string,
  aggregate: ResourceVector,
  population: number,
): PhysicalRates {
  const labour = labourFactor(population);

  const driver = GOOD_PRODUCTION[goodId];
  const production = driver
    ? driver.coeff * labour * (driver.resource ? aggregate[driver.resource] : 1)
    : 0;

  const need = GOOD_CONSUMPTION[goodId] ?? 0;
  const consumption = need * Math.max(0, population);

  return { production, consumption };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/physical-economy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/physical-economy.ts lib/engine/__tests__/physical-economy.test.ts
git commit -m "feat(economy): add pure physicalRates substrate-driven rate function"
```

---

## Task 3: Surface per-good rates through the substrate read service

**Files:**
- Modify: `lib/engine/physical-economy.ts` (add `SubstrateGoodRate` + `substrateGoodRates`)
- Modify: `lib/engine/__tests__/physical-economy.test.ts` (add coverage)
- Modify: `lib/types/api.ts:120-140` (add `goods` to `SystemSubstrateData` visible branch)
- Modify: `lib/services/universe.ts:1-15` (imports) and `lib/services/universe.ts:286-293` (return)

**Interfaces:**
- Consumes: `physicalRates` (Task 2); `GOOD_NAMES` from `@/lib/constants/goods`.
- Produces:
  - `interface SubstrateGoodRate { goodId: string; production: number; consumption: number }` (exported from `lib/engine/physical-economy.ts`)
  - `function substrateGoodRates(aggregate: ResourceVector, population: number): SubstrateGoodRate[]` — one entry per good, in `GOOD_NAMES` order.
  - `SystemSubstrateData` (visible) gains `goods: SubstrateGoodRate[]`.

- [ ] **Step 1: Write the failing test (append to the engine test file)**

Append to `lib/engine/__tests__/physical-economy.test.ts`:

```typescript
import { substrateGoodRates } from "../physical-economy";
import { GOOD_NAMES } from "@/lib/constants/goods";

describe("substrateGoodRates", () => {
  it("returns one entry per good in GOOD_NAMES order", () => {
    const rows = substrateGoodRates(AGG, 1000);
    expect(rows.map((r) => r.goodId)).toEqual(GOOD_NAMES);
  });

  it("matches physicalRates for each good", () => {
    const rows = substrateGoodRates(AGG, 1000);
    for (const row of rows) {
      const direct = physicalRates(row.goodId, AGG, 1000);
      expect(row.production).toBeCloseTo(direct.production, 10);
      expect(row.consumption).toBeCloseTo(direct.consumption, 10);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/physical-economy.test.ts`
Expected: FAIL — `substrateGoodRates` is not exported.

- [ ] **Step 3: Add the helper to the engine module**

In `lib/engine/physical-economy.ts`, add the `GOOD_NAMES` import and append the type + helper:

Change the constants import block to also pull `GOOD_NAMES`:

```typescript
import { GOOD_NAMES } from "@/lib/constants/goods";
import {
  GOOD_PRODUCTION,
  GOOD_CONSUMPTION,
  LABOUR_HALF_POP,
} from "@/lib/constants/physical-economy";
```

Append at the end of the file:

```typescript
/** Per-good production/consumption snapshot for one system — the read-service shape. */
export interface SubstrateGoodRate {
  goodId: string;
  production: number;
  consumption: number;
}

/** Production + consumption for every good at a system, in canonical good order. */
export function substrateGoodRates(
  aggregate: ResourceVector,
  population: number,
): SubstrateGoodRate[] {
  return GOOD_NAMES.map((goodId) => {
    const { production, consumption } = physicalRates(goodId, aggregate, population);
    return { goodId, production, consumption };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/physical-economy.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the field to the API type**

In `lib/types/api.ts`, add the import (extend the existing `from "@/lib/engine/..."` style — there is none yet, so add a new `import type`):

After the existing imports block (around line 33, after the `GlobalEventMap` import), add:

```typescript
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
```

Then extend the `visible` branch of `SystemSubstrateData` (currently lines ~131-140):

```typescript
export type SystemSubstrateData =
  | {
      visibility: "visible";
      sunClass: SunClass;
      population: number;
      popCap: number;
      aggregate: ResourceVector;
      bodies: BodyView[];
      /** Per-good production/consumption computed from this system's substrate. */
      goods: SubstrateGoodRate[];
    }
  | { visibility: "unknown" };
```

Also re-export the row type so consumers can keep importing substrate types from `api.ts` (as they do `BodyView`). Re-export the **already-imported** local binding (no second `from`), placed next to the substrate type exports:

```typescript
export type { SubstrateGoodRate };
```

- [ ] **Step 6: Populate `goods` in the service**

In `lib/services/universe.ts`, add the import (extend line 5):

```typescript
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { substrateGoodRates } from "@/lib/engine/physical-economy";
```

Then, in `getSystemSubstrate`, change the final `return` (currently lines ~286-293) to include `goods`:

```typescript
  return {
    visibility: "visible",
    sunClass: toSunClass(system.sunClass),
    population: system.population,
    popCap: system.popCap,
    aggregate,
    bodies,
    goods: substrateGoodRates(aggregate, system.population),
  };
```

- [ ] **Step 7: Verify wiring compiles and nothing else broke**

Run: `npx tsc --noEmit`
Expected: no errors. (The substrate API route + hook return `SystemSubstrateData` unchanged — the new field flows through with no route/hook edit.)

Run: `npm run test:unit`
Expected: PASS — full unit suite green.

- [ ] **Step 8: Commit**

```bash
git add lib/engine/physical-economy.ts lib/engine/__tests__/physical-economy.test.ts lib/types/api.ts lib/services/universe.ts
git commit -m "feat(economy): expose per-good substrate rates from the system substrate service"
```

---

## Task 4: Gate the tick on rate; shed the economy-type fields from the pipeline

This is a single atomic, **behaviour-preserving** refactor (see "Why Track B is behaviour-preserving" above). The `MarketTickEntry` interface change ripples through every builder and call site, so all edits land together; the suite is run once after the full set. The old `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION` tables still feed the adapters — only the plumbing changes.

**Files:**
- Modify: `lib/engine/tick.ts`
- Modify: `lib/engine/market-tick-builder.ts`
- Modify: `lib/tick/world/economy-world.ts`
- Modify: `lib/tick/adapters/prisma/economy.ts`
- Modify: `lib/tick/adapters/memory/economy.ts`
- Modify: `lib/tick/processors/economy.ts`
- Test: `lib/engine/__tests__/tick.test.ts`

**Interfaces:**
- `MarketTickEntry` loses `economyType`, `produces`, `consumes`. Keeps `goodId`, `stock`, `productionRate?`, `consumptionRate?`, `productionMult?`, `consumptionMult?`, `volatility?`.
- `TickEntryInput` loses `economyType`, `produces`, `consumes`.
- `MarketTickInput` loses `economyType`, `produces`, `consumes`.
- `MarketView` loses `economyType`, `produces`, `consumes`.
- `simulateEconomyTick` gates production/consumption on `rate > 0` only.
- `buildMarketTickEntry` drops the gov-boost-only consumption branch.

- [ ] **Step 1: Update the tick tests to pin the new semantics**

In `lib/engine/__tests__/tick.test.ts`:

(a) Update the `entry()` helper to drop the removed fields:

```typescript
function entry(over: Partial<MarketTickEntry>): MarketTickEntry {
  return {
    goodId: "food",
    stock: 100,
    ...over,
  };
}
```

(b) In `describe("simulateEconomyTick — production")`, the existing cases pass `produces: [...]`. Remove those args and rewrite the "does nothing" case to be rate-based:

```typescript
describe("simulateEconomyTick — production", () => {
  it("raises stock for a producer, self-limiting near the ceiling", () => {
    const mid = simulateEconomyTick([entry({ productionRate: 10, stock: 100 })], PARAMS);
    expect(mid[0].stock).toBeGreaterThan(100);
    const high = simulateEconomyTick([entry({ productionRate: 10, stock: 199 })], PARAMS);
    expect(high[0].stock - 199).toBeLessThan(mid[0].stock - 100); // slows near MAX
    expect(high[0].stock).toBeLessThanOrEqual(200); // clamped
  });

  it("does nothing when the production rate is zero or undefined", () => {
    expect(simulateEconomyTick([entry({ productionRate: 0, stock: 100 })], PARAMS)[0].stock).toBe(100);
    expect(simulateEconomyTick([entry({ stock: 100 })], PARAMS)[0].stock).toBe(100);
  });

  it("applies event production multipliers", () => {
    const base = simulateEconomyTick([entry({ productionRate: 10, stock: 100 })], PARAMS);
    const boosted = simulateEconomyTick([entry({ productionRate: 10, productionMult: 2, stock: 100 })], PARAMS);
    expect(boosted[0].stock - 100).toBeGreaterThan(base[0].stock - 100);
  });
});
```

(c) In `describe("simulateEconomyTick — consumption")`, drop the `consumes: [...]` args:

```typescript
describe("simulateEconomyTick — consumption", () => {
  it("lowers stock for a consumer, self-limiting near the floor", () => {
    const mid = simulateEconomyTick([entry({ consumptionRate: 10, stock: 100 })], PARAMS);
    expect(mid[0].stock).toBeLessThan(100);
    const low = simulateEconomyTick([entry({ consumptionRate: 10, stock: 6 })], PARAMS);
    expect(low[0].stock).toBeGreaterThanOrEqual(5); // clamped at MIN
  });

  it("applies event consumption multipliers", () => {
    const base = simulateEconomyTick([entry({ consumptionRate: 10, stock: 100 })], PARAMS);
    const boosted = simulateEconomyTick([entry({ consumptionRate: 10, consumptionMult: 2, stock: 100 })], PARAMS);
    expect(100 - boosted[0].stock).toBeGreaterThan(100 - base[0].stock);
  });
});
```

(d) In `describe("simulateEconomyTick — noise")`, the "does not mutate" case drops `produces`:

```typescript
  it("does not mutate the input array", () => {
    const input = [entry({ productionRate: 10 })];
    const snapshot = input[0].stock;
    simulateEconomyTick(input, PARAMS);
    expect(input[0].stock).toBe(snapshot);
  });
```

(e) In `describe("buildMarketTickEntry")`, drop `economyType`/`produces`/`consumes` from every input object, and replace the boost-only test. The four cases become:

```typescript
  it("scales production and consumption by the prosperity multiplier", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
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

  it("ignores traits when computing production — they no longer grant a bonus", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        volatility: 1,
        baseProductionRate: 10,
        baseConsumptionRate: undefined,
        govConsumptionBoost: 0,
        traits: [{ traitId: "precursor_ruins", quality: 3 }],
        prosperity: 1,
      },
      prosperityParams,
    );
    expect(e.productionRate).toBeCloseTo(13, 5);
  });

  it("folds the government consumption boost into a consumed good's rate", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        volatility: 1,
        baseProductionRate: undefined,
        baseConsumptionRate: 10,
        govConsumptionBoost: 5,
        traits: [],
        prosperity: 0, // multAtZero = 0.7
      },
      prosperityParams,
    );
    expect(e.consumptionRate).toBeCloseTo((10 + 5) * 0.7, 5); // (base + boost) * mult
  });

  it("ignores a government boost on a good the system does not consume", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        volatility: 1,
        baseProductionRate: undefined,
        baseConsumptionRate: undefined,
        govConsumptionBoost: 5,
        traits: [],
        prosperity: 0,
      },
      prosperityParams,
    );
    expect(e.consumptionRate).toBeUndefined(); // no base rate ⇒ boost cannot create consumption
  });

  it("leaves consumption undefined when there is no base rate and no boost", () => {
    const e = buildMarketTickEntry(
      {
        goodId: "food",
        stock: 100,
        volatility: 1,
        baseProductionRate: undefined,
        baseConsumptionRate: undefined,
        govConsumptionBoost: 0,
        traits: [],
        prosperity: 0,
      },
      prosperityParams,
    );
    expect(e.consumptionRate).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tick tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts`
Expected: FAIL — type errors (the `entry()` helper / inputs no longer match the current interfaces) and/or the boost-only assertion fails against current code. This confirms the tests pin the new behaviour.

- [ ] **Step 3: Simplify `simulateEconomyTick` gating in `lib/engine/tick.ts`**

Replace the two gating blocks inside `simulateEconomyTick`:

```typescript
    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0) {
      stock += effectiveProduction * selfLimitingFactor(stock, minLevel, maxLevel, "produce");
    }

    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      stock -= effectiveConsumption * selfLimitingFactor(stock, minLevel, maxLevel, "consume");
    }
```

- [ ] **Step 4: Trim `MarketTickEntry` in `lib/engine/tick.ts`**

Replace the `MarketTickEntry` interface (remove `economyType`, `produces`, `consumes`):

```typescript
export interface MarketTickEntry {
  goodId: string;
  stock: number;
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
```

Update the doc comment above `simulateEconomyTick` to drop the membership wording — change the line "...if a producer..., ...if a consumer..." to "...applies production when `productionRate > 0`, consumption when `consumptionRate > 0`, then noise, then clamp...".

- [ ] **Step 5: Trim `TickEntryInput` and `buildMarketTickEntry` in `lib/engine/tick.ts`**

Replace `TickEntryInput` (remove `economyType`, `produces`, `consumes`):

```typescript
export interface TickEntryInput {
  goodId: string;
  stock: number;
  /** Volatility after government scaling. */
  volatility: number;
  /** Base production rate from the substrate driver (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate from the substrate driver (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Government consumption boost for this good. */
  govConsumptionBoost: number;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
  /** System prosperity value. */
  prosperity: number;
}
```

Replace the `consumptionBeforeProsperity` computation (drop the boost-only branch) and the returned object (drop the three fields):

```typescript
  const consumptionBeforeProsperity =
    input.baseConsumptionRate != null
      ? input.baseConsumptionRate + input.govConsumptionBoost
      : undefined;

  return {
    goodId: input.goodId,
    stock: input.stock,
    productionRate:
      productionBeforeProsperity != null ? productionBeforeProsperity * prosperityMult : undefined,
    consumptionRate:
      consumptionBeforeProsperity != null ? consumptionBeforeProsperity * prosperityMult : undefined,
    volatility: input.volatility,
  };
```

(Leave `productionBeforeProsperity` as-is above it.)

- [ ] **Step 6: Trim `MarketTickInput` + `resolveMarketTickEntry` in `lib/engine/market-tick-builder.ts`**

Remove the now-unused `EconomyType` import (line 16). Remove `economyType`, `produces`, `consumes` from `MarketTickInput`:

```typescript
export interface MarketTickInput {
  goodId: string;
  stock: number;
  /** Base production rate for this good (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate for this good (undefined = not a consumer). */
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
  modifierCaps: ModifierCaps;
}
```

In `resolveMarketTickEntry`, remove the three fields from the `buildMarketTickEntry` argument:

```typescript
  const entry = buildMarketTickEntry(
    {
      goodId: input.goodId,
      stock: input.stock,
      volatility,
      baseProductionRate: input.baseProductionRate,
      baseConsumptionRate: input.baseConsumptionRate,
      govConsumptionBoost: input.govDef?.consumptionBoosts[input.goodId] ?? 0,
      traits: input.traits,
      prosperity: input.prosperity,
    },
    prosperityParams,
  );
```

- [ ] **Step 7: Trim `MarketView` in `lib/tick/world/economy-world.ts`**

Remove the now-unused `EconomyType` import (change `import type { EconomyType, GovernmentType } ...` to `import type { GovernmentType } ...`). Remove `economyType`, `produces`, `consumes` from `MarketView`:

```typescript
export interface MarketView {
  /** Adapter-owned identifier — round-trips into `MarketUpdate.id`. */
  id: string;
  systemId: string;
  goodId: string;
  basePrice: number;
  stock: number;
  /** Government of the system's owning faction — read per-market post-cutover. */
  governmentType: GovernmentType;
  /** Base production rate for this good, if any. */
  baseProductionRate?: number;
  /** Base consumption rate for this good, if any. */
  baseConsumptionRate?: number;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
}
```

- [ ] **Step 8: Update the Prisma adapter (`lib/tick/adapters/prisma/economy.ts`)**

Remove the now-unused `getProducedGoods, getConsumedGoods` imports (keep `getProductionRate, getConsumptionRate`). The local `economyType` const stays (it derives the rates). Drop the three fields from the returned object:

```typescript
      return {
        id: m.id,
        systemId: m.station.system.id,
        goodId: goodKey,
        basePrice: m.good.basePrice,
        stock: m.stock,
        governmentType,
        baseProductionRate: getProductionRate(economyType, goodKey),
        baseConsumptionRate: getConsumptionRate(economyType, goodKey),
        traits: m.station.system.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })),
      };
```

The import block becomes:

```typescript
import {
  getProductionRate,
  getConsumptionRate,
} from "@/lib/constants/universe";
```

- [ ] **Step 9: Update the memory adapter (`lib/tick/adapters/memory/economy.ts`)**

Drop the three fields from the `views.push({...})` object (keep the rate reads off `sys.produces`/`sys.consumes`):

```typescript
      views.push({
        id: `${m.systemId}|${m.goodId}`,
        systemId: m.systemId,
        goodId: m.goodId,
        basePrice: m.basePrice,
        stock: m.stock,
        governmentType: sys.governmentType,
        baseProductionRate: sys.produces[m.goodId],
        baseConsumptionRate: sys.consumes[m.goodId],
        traits: sys.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })),
      });
```

- [ ] **Step 10: Update the processor (`lib/tick/processors/economy.ts`)**

In the `markets.map((m) => resolveMarketTickEntry({...}))` call, drop the `economyType`, `produces`, `consumes` lines:

```typescript
  const resolved = markets.map((m) =>
    resolveMarketTickEntry(
      {
        goodId: m.goodId,
        stock: m.stock,
        baseProductionRate: m.baseProductionRate,
        baseConsumptionRate: m.baseConsumptionRate,
        govDef: GOVERNMENT_TYPES[m.governmentType] ?? undefined,
        traits: m.traits,
        prosperity: prosperityBySystem.get(m.systemId) ?? 0,
        modifiers: modifiersBySystem.get(m.systemId) ?? [],
        modifierCaps,
      },
      prosperityParams,
    ),
  );
```

- [ ] **Step 11: Run the tick tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts`
Expected: PASS.

- [ ] **Step 12: Typecheck + full unit suite (behaviour-parity gate)**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run test:unit`
Expected: PASS — **including** `lib/engine/__tests__/simulator-integration.test.ts`. Green here proves the refactor changed no economic output.

- [ ] **Step 13: Simulator sanity (extra confidence)**

Run: `npm run simulate`
Expected: completes; equilibrium/price output consistent with a pre-refactor run (no crash, stocks stay inside `[5, 200]`). This is a non-blocking confidence check on top of the unit gate.

- [ ] **Step 14: Commit**

```bash
git add lib/engine/tick.ts lib/engine/market-tick-builder.ts lib/tick/world/economy-world.ts lib/tick/adapters/prisma/economy.ts lib/tick/adapters/memory/economy.ts lib/tick/processors/economy.ts lib/engine/__tests__/tick.test.ts
git commit -m "refactor(economy): gate market tick on rate and drop economy-type fields from the pipeline"
```

---

## Final verification

- [ ] **Run the entire unit suite once more**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Typecheck + lint the whole project**

Run: `npx tsc --noEmit`
Run: `npm run lint`
Expected: no errors, no warnings on the touched files.

---

## Self-review checklist (run before opening the PR)

- [ ] **Spec coverage (§8.1.7 item 1):** new tables ✔ (Task 1), pure `physicalRates` ✔ (Task 2), `MarketTickEntry` simplification ✔ (Task 4), substrate service returns per-good production/consumption ✔ (Task 3), no live behaviour change ✔ (Track B parity gate + old tables still drive the tick).
- [ ] **No `as` / `unknown`** introduced. Good-keyed maps use `Record<string, …>` matching `GOODS`.
- [ ] **No dead code:** `getProducedGoods`/`getConsumedGoods` imports removed from the Prisma adapter; `EconomyType` imports removed from `market-tick-builder.ts` and `economy-world.ts`; no orphaned `produces`/`consumes` references remain (grep `\.produces\b|\.consumes\b` in `lib/tick` + `lib/engine/tick.ts` + `lib/engine/market-tick-builder.ts` — only `sys.produces`/`sys.consumes` in the memory adapter should remain).
- [ ] **No comment references** to PR/phase/plan; magnitudes documented as "first-draft, simulator-calibrated".
- [ ] **Type consistency:** `SubstrateGoodRate` name identical across engine, `api.ts`, and tests; `physicalRates` signature `(goodId, aggregate, population)` identical at every call site.
- [ ] **Out of scope confirmed untouched:** `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION`, `SELF_SUFFICIENCY`/`getConsumeEquilibrium`, `getInitialStock`/`getTargetStock`/`CALIBRATED_TARGET_STOCK`, the shim, `prisma/seed.ts`, the simulator world builder, all UI.

---

## What this PR sets up (not built here)

- **2b** wires the adapters to `physicalRates` (the rate-source swap the refactor was de-risking), swaps the Overview Produces/Consumes lists + population label to the new `goods`/`population` values, deletes `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION`/`SELF_SUFFICIENCY`/`getConsumeEquilibrium` and the shim's economic role, and rewrites `getInitialStock`.
- **2c** recalibrates the first-draft coeffs/needs/`LABOUR_HALF_POP` and the pricing anchors via `npm run simulate`; updates docs.
- **2d** adds net import/export indicators + per-good bars on the Astrography substrate tab, consuming the `goods[]` field this PR introduced.
