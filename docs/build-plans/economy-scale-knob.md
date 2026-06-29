# Global Economy-Scale Knob (`ECONOMY_SCALE`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one server-only `ECONOMY_SCALE = S` multiplier that uniformly scales the goods-side economy magnitudes (production, consumption, seeded stock) and the absolute terms that ride them, leaving prices and equilibrium ratios invariant.

**Architecture:** A dependency-free leaf module `lib/constants/economy-scale.ts` resolves `S` from the environment once at module load and exposes `scaleValue` / `scaleRecord`. Each magnitude-defining constant module imports those helpers and bakes `S` into its base values at the source (Approach A), so every downstream consumer scales automatically with zero engine/signature changes. Default `S = 1` is exactly byte-identical to today.

**Tech Stack:** TypeScript 5 (strict), Vitest 4 (`unit` project), Node `process.env`.

Design spec: `docs/planned/economy-scale-knob.md`. Parent: `docs/planned/economy-scaling-and-trade-rework.md`.

## Global Constraints

- **No `as` type assertions** except `as const` and inside `lib/types/guards.ts`. `toEconomyScale` returns a plain `number`, so it needs no cast.
- **No `unknown`** anywhere.
- **Engine/constants modules stay pure** — no DB imports. Never **statically** import `@/lib/prisma` (directly or transitively) into a unit-tested module graph; the `unit` project sets no `DATABASE_URL` and `lib/prisma.ts` throws at module load. Verify env-sensitive tests with `unset DATABASE_URL` (see below).
- **The S = 1 invariant is the primary merge gate:** the full existing unit + sim suite must pass byte-identical. Multiplying by exactly `1` is identity in IEEE-754, so this holds structurally — but it must be *verified*, not assumed.
- **`economy-scale.ts` imports nothing** — it is the root of the constants-magnitude graph; any import risks a cycle. Its validator lives inline (a deliberate refinement of the spec, which suggested `guards.ts`; `guards.ts` carries value imports that would couple/cycle).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work on branch `feat/economy-scale-knob` (already checked out).

---

### Task 1: The `economy-scale` knob module

**Files:**
- Create: `lib/constants/economy-scale.ts`
- Test: `lib/constants/__tests__/economy-scale.test.ts`

**Interfaces:**
- Produces:
  - `toEconomyScale(value: string): number` — parse + validate (positive, finite); throws otherwise.
  - `ECONOMY_SCALE: number` — resolved once from `process.env.ECONOMY_SCALE ?? "1"`.
  - `scaleValue(n: number): number` — `n * ECONOMY_SCALE`.
  - `scaleRecord(record: Record<string, number>): Record<string, number>` — every value `* ECONOMY_SCALE`.

- [ ] **Step 1: Write the failing test**

Create `lib/constants/__tests__/economy-scale.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toEconomyScale,
  ECONOMY_SCALE,
  scaleValue,
  scaleRecord,
} from "@/lib/constants/economy-scale";

describe("toEconomyScale", () => {
  it("parses positive finite numbers", () => {
    expect(toEconomyScale("1")).toBe(1);
    expect(toEconomyScale("10")).toBe(10);
    expect(toEconomyScale("2.5")).toBe(2.5);
  });

  it("rejects non-positive, non-finite, and non-numeric values", () => {
    expect(() => toEconomyScale("0")).toThrow();
    expect(() => toEconomyScale("-1")).toThrow();
    expect(() => toEconomyScale("abc")).toThrow();
    expect(() => toEconomyScale("Infinity")).toThrow();
    expect(() => toEconomyScale("NaN")).toThrow();
    expect(() => toEconomyScale("")).toThrow();
  });
});

describe("scale helpers at default scale (S = 1)", () => {
  it("defaults ECONOMY_SCALE to 1 when the env var is unset", () => {
    expect(ECONOMY_SCALE).toBe(1);
  });

  it("scaleValue is identity at S = 1", () => {
    expect(scaleValue(8)).toBe(8);
    expect(scaleValue(0.5)).toBe(0.5);
  });

  it("scaleRecord maps every value and preserves keys at S = 1", () => {
    expect(scaleRecord({ a: 2, b: 3 })).toEqual({ a: 2, b: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/constants/__tests__/economy-scale.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/constants/economy-scale"` (module does not exist yet).

- [ ] **Step 3: Write the module**

Create `lib/constants/economy-scale.ts`:

```ts
/**
 * Global economy-scale knob. A single multiplier S applied to the goods-side
 * magnitudes of the economy (production, consumption, seeded stock) and the
 * absolute terms that ride them. Ratio/dimensionless terms (target-cover, price
 * exponent, thresholds, route cost) deliberately do NOT scale, so prices and
 * equilibrium are invariant under S — only magnitudes change. See
 * docs/planned/economy-scale-knob.md.
 *
 * This module imports NOTHING: it is the root of the constants-magnitude graph,
 * so any import would risk a circular dependency. Server-only — it is never read
 * for its value by the client (the client consumes already-scaled data from the
 * API), so it is intentionally not exposed via next.config.ts `env`.
 */

/** Parse + validate the scale: a positive, finite number. Throws on anything else. */
export function toEconomyScale(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ECONOMY_SCALE: "${value}". Expected a positive, finite number.`);
  }
  return n;
}

/** Active economy scale, resolved once from the environment. Defaults to 1 (no scaling). */
export const ECONOMY_SCALE: number = toEconomyScale(process.env.ECONOMY_SCALE ?? "1");

/** Scale a single magnitude by the active economy scale. */
export function scaleValue(n: number): number {
  return n * ECONOMY_SCALE;
}

/** Scale every numeric value of a record by the active economy scale (keys unchanged). */
export function scaleRecord(record: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = value * ECONOMY_SCALE;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/constants/__tests__/economy-scale.test.ts`
Expected: PASS (all 5 tests). Running with `DATABASE_URL` unset confirms the module is prisma-free.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/economy-scale.ts lib/constants/__tests__/economy-scale.test.ts
git commit -m "$(cat <<'EOF'
feat(economy): add ECONOMY_SCALE knob module (leaf, default S=1)

Dependency-free leaf exposing toEconomyScale (positive/finite validator),
ECONOMY_SCALE (resolved from env, default 1), and scaleValue/scaleRecord
helpers. No constants wired yet — S=1 is a no-op.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Scale the live-economy magnitudes + absolute terms

**Files:**
- Test: `lib/engine/__tests__/economy-scale-invariance.test.ts` (create)
- Modify: `lib/constants/physical-economy.ts` (`GOOD_CONSUMPTION`)
- Modify: `lib/constants/market-economy.ts` (`MIN_DEMAND`)
- Modify: `lib/constants/industry.ts` (`OUTPUT_PER_UNIT`, the three storage scalars, `POP_CENTRE_STORAGE`)
- Modify: `lib/constants/trade-simulation.ts` (`TRADE_SIMULATION.FLOW_BUDGET`)
- Modify: `lib/constants/directed-logistics.ts` (`DIRECTED_LOGISTICS.GENERATION_PER_POP`)

**Interfaces:**
- Consumes: `scaleValue`, `scaleRecord` from `lib/constants/economy-scale` (Task 1).
- Produces: no signature changes — all listed constants keep their existing names/types; only their values now ride `ECONOMY_SCALE`. `OUTPUT_PER_UNIT` scaling propagates to `BUILDING_TYPES[g].outputPerUnit` (built from it). Seeded stock (`getInitialStock`) and industrial input-demand scale automatically (derived from the above).

The invariance test loads the constants graph fresh at two scales (via `vi.resetModules` + `vi.stubEnv` + dynamic `import`) and asserts magnitudes scale while price is invariant. It fails until every constant below is wired.

- [ ] **Step 1: Write the failing invariance test**

Create `lib/engine/__tests__/economy-scale-invariance.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";

// Load the constants-magnitude graph fresh at a chosen ECONOMY_SCALE. resetModules
// clears the module cache so economy-scale.ts re-reads the stubbed env at import.
async function loadAtScale(scale: string) {
  vi.resetModules();
  vi.stubEnv("ECONOMY_SCALE", scale);
  const physical = await import("@/lib/constants/physical-economy");
  const market = await import("@/lib/constants/market-economy");
  const industryConsts = await import("@/lib/constants/industry");
  const tradeSim = await import("@/lib/constants/trade-simulation");
  const logistics = await import("@/lib/constants/directed-logistics");
  const industryEngine = await import("@/lib/engine/industry");
  const pricing = await import("@/lib/engine/market-pricing");
  return { physical, market, industryConsts, tradeSim, logistics, industryEngine, pricing };
}

// A representative market priced through the real seed/pricing path. demandRate
// uses GOOD_CONSUMPTION + MIN_DEMAND; storageCapacity uses the storage constants;
// the stock sits inside the band (a deficit) so midPriceAt is unclamped.
function scenario(mods: Awaited<ReturnType<typeof loadAtScale>>) {
  const { market, industryConsts, industryEngine, pricing } = mods;
  const pop = 1000;
  const buildings: Record<string, number> = { food: 10, [industryConsts.HOUSING_TYPE]: 5 };

  const demandFood = market.demandRateForGood("food", pop);             // need-driven
  const demandFloored = market.demandRateForGood("ship_frames", 1);     // MIN_DEMAND-floored
  const storageCapacity = industryEngine.facilityStorageForGood(buildings, "food");

  const band = pricing.marketBand({
    demandRate: demandFood,
    storageCapacity,
    priceFloor: 0.5,
    priceCeiling: 2.0,
  });
  const stock = band.targetStock * 0.8; // in-band deficit
  const price = pricing.midPriceAt(
    { basePrice: 100, targetStock: band.targetStock, floorMult: 0.5, ceilingMult: 2.0 },
    stock,
  );

  return {
    demandFood,
    demandFloored,
    storageCapacity,
    targetStock: band.targetStock,
    maxStock: band.maxStock,
    stock,
    price,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("ECONOMY_SCALE invariance", () => {
  it("scales every wired magnitude by S", async () => {
    const base = await loadAtScale("1");
    const x10 = await loadAtScale("10");

    // Raw constant wiring.
    expect(x10.physical.GOOD_CONSUMPTION.water).toBeCloseTo(base.physical.GOOD_CONSUMPTION.water * 10);
    expect(x10.market.MIN_DEMAND).toBeCloseTo(base.market.MIN_DEMAND * 10);
    expect(x10.industryConsts.OUTPUT_PER_UNIT.food).toBeCloseTo(base.industryConsts.OUTPUT_PER_UNIT.food * 10);
    expect(x10.industryConsts.EXTRACTOR_STORAGE_PER_UNIT).toBeCloseTo(base.industryConsts.EXTRACTOR_STORAGE_PER_UNIT * 10);
    expect(x10.industryConsts.PRODUCTION_STORAGE_PER_UNIT).toBeCloseTo(base.industryConsts.PRODUCTION_STORAGE_PER_UNIT * 10);
    expect(x10.industryConsts.POP_CENTRE_STORAGE_DEFAULT).toBeCloseTo(base.industryConsts.POP_CENTRE_STORAGE_DEFAULT * 10);
    expect(x10.industryConsts.POP_CENTRE_STORAGE.food).toBeCloseTo(base.industryConsts.POP_CENTRE_STORAGE.food * 10);
    expect(x10.tradeSim.TRADE_SIMULATION.FLOW_BUDGET).toBeCloseTo(base.tradeSim.TRADE_SIMULATION.FLOW_BUDGET * 10);
    expect(x10.logistics.DIRECTED_LOGISTICS.GENERATION_PER_POP).toBeCloseTo(base.logistics.DIRECTED_LOGISTICS.GENERATION_PER_POP * 10);
  });

  it("scales derived magnitudes by S and leaves price invariant", async () => {
    const base = scenario(await loadAtScale("1"));
    const x10 = scenario(await loadAtScale("10"));

    expect(x10.demandFood).toBeCloseTo(base.demandFood * 10);     // GOOD_CONSUMPTION rides S
    expect(x10.demandFloored).toBeCloseTo(base.demandFloored * 10); // MIN_DEMAND floor rides S
    expect(x10.storageCapacity).toBeCloseTo(base.storageCapacity * 10);
    expect(x10.targetStock).toBeCloseTo(base.targetStock * 10);
    expect(x10.maxStock).toBeCloseTo(base.maxStock * 10);
    expect(x10.stock).toBeCloseTo(base.stock * 10);

    expect(x10.price).toBeCloseTo(base.price); // INVARIANT — the equilibrium-preservation proof
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/economy-scale-invariance.test.ts`
Expected: FAIL — at `S = 10` the constants are unscaled, so e.g. `x10.market.MIN_DEMAND` equals `base.market.MIN_DEMAND` (not ×10). Confirms the test detects unwired constants. (If it instead errors on import, a scaled module statically imports prisma — stop and fix that first.)

- [ ] **Step 3: Scale `GOOD_CONSUMPTION`**

In `lib/constants/physical-economy.ts`, add the import at the top of the file:

```ts
import { scaleRecord } from "@/lib/constants/economy-scale";
```

Wrap the `GOOD_CONSUMPTION` object literal (currently `export const GOOD_CONSUMPTION: Record<string, number> = { ... };`) so the whole literal is passed through `scaleRecord`:

```ts
export const GOOD_CONSUMPTION: Record<string, number> = scaleRecord({
  // Tier 0.
  water: 0.007,
  food: 0.006,
  ore: 0.002,
  textiles: 0.002,
  gas: 0.004,
  minerals: 0.002,
  biomass: 0.002,
  radioactives: 0.0008,
  // Tier 1.
  fuel: 0.0015,
  metals: 0.0015,
  chemicals: 0.0015,
  medicine: 0.001,
  alloys: 0.001,
  polymers: 0.0012,
  components: 0.001,
  consumer_goods: 0.0015,
  munitions: 0.0005,
  hull_plating: 0.0005,
  // Tier 2.
  electronics: 0.001,
  machinery: 0.0008,
  weapons: 0.0005,
  luxuries: 0.0005,
  weapons_systems: 0.0003,
  targeting_arrays: 0.0004,
  reactor_cores: 0.0003,
  ship_frames: 0.0003,
});
```

- [ ] **Step 4: Scale `MIN_DEMAND`**

In `lib/constants/market-economy.ts`, add to the existing imports:

```ts
import { scaleValue } from "@/lib/constants/economy-scale";
```

Change the `MIN_DEMAND` definition (keep its doc comment) from `export const MIN_DEMAND = 0.05;` to:

```ts
export const MIN_DEMAND = scaleValue(0.05);
```

- [ ] **Step 5: Scale the `industry.ts` magnitudes**

In `lib/constants/industry.ts`, add to the imports:

```ts
import { scaleValue, scaleRecord } from "@/lib/constants/economy-scale";
```

Wrap `OUTPUT_PER_UNIT` (currently `export const OUTPUT_PER_UNIT: Record<string, number> = Object.fromEntries(...)`) in `scaleRecord`:

```ts
export const OUTPUT_PER_UNIT: Record<string, number> = scaleRecord(
  Object.fromEntries(GOOD_NAMES.map((g) => [g, OUTPUT_OVERRIDES[g] ?? GOOD_PRODUCTION[g]?.coeff ?? 1])),
);
```

Scale the three storage scalars (keep their doc comments):

```ts
export const EXTRACTOR_STORAGE_PER_UNIT = scaleValue(40);
export const PRODUCTION_STORAGE_PER_UNIT = scaleValue(15);
export const POP_CENTRE_STORAGE_DEFAULT = scaleValue(2);
```

Wrap the `POP_CENTRE_STORAGE` map (keep its doc comment):

```ts
export const POP_CENTRE_STORAGE: Record<string, number> = scaleRecord({
  consumer_goods: 12, food: 8, water: 8, medicine: 6, luxuries: 6, textiles: 5,
});
```

- [ ] **Step 6: Scale `TRADE_SIMULATION.FLOW_BUDGET`**

In `lib/constants/trade-simulation.ts`, add at the top of the file (before the export):

```ts
import { scaleValue } from "@/lib/constants/economy-scale";
```

Change the `FLOW_BUDGET` line inside the `TRADE_SIMULATION` object (keep its doc comment) from `FLOW_BUDGET: 8,` to:

```ts
  FLOW_BUDGET: scaleValue(8),
```

(The `as const` object already holds computed values, so a computed `FLOW_BUDGET` is consistent. This auto-propagates to the simulator's `tradeFlow.flowBudget`, which references `TRADE_SIMULATION.FLOW_BUDGET`.)

- [ ] **Step 7: Scale `DIRECTED_LOGISTICS.GENERATION_PER_POP`**

In `lib/constants/directed-logistics.ts`, add below the existing import:

```ts
import { scaleValue } from "@/lib/constants/economy-scale";
```

Change the `GENERATION_PER_POP` line inside the `DIRECTED_LOGISTICS` object (keep its doc comment) from `GENERATION_PER_POP: 0.5,` to:

```ts
  GENERATION_PER_POP: scaleValue(0.5),
```

(Do **not** touch `HOP_WEIGHT` / `FUEL_WEIGHT` — goods-agnostic route cost. Do **not** touch `DIRECTED_BUILD.GENERATION_PER_POP` in `directed-build.ts` — building-denominated, must not scale.)

- [ ] **Step 8: Run the invariance test to verify it passes**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/economy-scale-invariance.test.ts`
Expected: PASS (both tests) — every magnitude scales ×10 and `price` is invariant.

- [ ] **Step 9: Verify the S = 1 invariant (full unit suite, byte-identical)**

Run: `unset DATABASE_URL; npx vitest run --project unit`
Expected: PASS — the entire unit suite green with no changed assertions (at the default `S = 1`, every scaled value equals its original).

- [ ] **Step 10: Commit**

```bash
git add lib/engine/__tests__/economy-scale-invariance.test.ts lib/constants/physical-economy.ts lib/constants/market-economy.ts lib/constants/industry.ts lib/constants/trade-simulation.ts lib/constants/directed-logistics.ts
git commit -m "$(cat <<'EOF'
feat(economy): scale live-economy magnitudes by ECONOMY_SCALE

Bake S into the goods-side magnitudes (GOOD_CONSUMPTION, OUTPUT_PER_UNIT) and
the absolute terms that ride them (MIN_DEMAND, the three storage scalars,
POP_CENTRE_STORAGE, TRADE_SIMULATION.FLOW_BUDGET, DIRECTED_LOGISTICS.
GENERATION_PER_POP). Seeded stock and industrial input-demand scale
automatically. Invariance test proves magnitudes ride S while price is
unchanged; full unit suite green at S=1 (byte-identical).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Scale the simulator trading-pressure + full verification

**Files:**
- Test: `lib/engine/simulator/__tests__/economy-scale-pressure.test.ts` (create)
- Modify: `lib/engine/simulator/constants.ts:206` (`bots.startingCredits`)

**Interfaces:**
- Consumes: `scaleValue` (Task 1); `resolveConstants()` from `lib/engine/simulator/constants` (existing).
- Produces: `resolveConstants().bots.startingCredits` and `.tradeFlow.flowBudget` now ride `ECONOMY_SCALE` (the latter already, via `TRADE_SIMULATION.FLOW_BUDGET` scaled in Task 2). Keeps the calibration knob complete — a single env var scales the live economy *and* the synthetic trading pressure the simulator drives it with.

- [ ] **Step 1: Write the failing test**

Create `lib/engine/simulator/__tests__/economy-scale-pressure.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";

async function resolveAtScale(scale: string) {
  vi.resetModules();
  vi.stubEnv("ECONOMY_SCALE", scale);
  const { resolveConstants } = await import("@/lib/engine/simulator/constants");
  return resolveConstants();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("ECONOMY_SCALE simulator pressure", () => {
  it("scales bot starting credits and the sim flow budget by S", async () => {
    const base = await resolveAtScale("1");
    const x10 = await resolveAtScale("10");

    expect(x10.bots.startingCredits).toBeCloseTo(base.bots.startingCredits * 10);
    expect(x10.tradeFlow.flowBudget).toBeCloseTo(base.tradeFlow.flowBudget * 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/simulator/__tests__/economy-scale-pressure.test.ts`
Expected: FAIL — `startingCredits` is a hard-coded `500`, so `x10.bots.startingCredits` equals `base` (not ×10). (`flowBudget` already scales from Task 2; this test gates the `startingCredits` wiring.)

- [ ] **Step 3: Scale `bots.startingCredits`**

In `lib/engine/simulator/constants.ts`, add to the imports (alongside the existing `TRADE_SIMULATION` import):

```ts
import { scaleValue } from "@/lib/constants/economy-scale";
```

Change the `startingCredits` line (inside the `bots` block of `buildDefaults()`, line ~206) from `startingCredits: 500,` to:

```ts
      startingCredits: scaleValue(500),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/simulator/__tests__/economy-scale-pressure.test.ts`
Expected: PASS — both `startingCredits` and `flowBudget` scale ×10.

- [ ] **Step 5: Verify the full unit suite (S = 1 byte-identical)**

Run: `unset DATABASE_URL; npx vitest run --project unit`
Expected: PASS — entire unit suite green, no changed assertions.

- [ ] **Step 6: Verify the simulator runs unchanged at S = 1**

Run: `npm run simulate`
Expected: completes normally; equilibrium output matches the pre-change baseline (default `S = 1`).

- [ ] **Step 7: Manual spot-check that S scales the sim economy (not committed)**

Run: `ECONOMY_SCALE=10 npm run simulate`
Expected: completes normally; per-system production/consumption/stock magnitudes are ~10× the `S = 1` run while equilibrium prices are unchanged. This is a sanity eyeball, not a committed assertion — calibration (sub-project 2) is where a real value of S is chosen. If anything diverges in *price*, stop: a ratio term was scaled by mistake.

- [ ] **Step 8: Commit**

```bash
git add lib/engine/simulator/__tests__/economy-scale-pressure.test.ts lib/engine/simulator/constants.ts
git commit -m "$(cat <<'EOF'
feat(economy): scale simulator trading-pressure by ECONOMY_SCALE

bots.startingCredits now rides S so synthetic buying power matches the xS
economy at invariant prices; the sim flowBudget already scales via the shared
TRADE_SIMULATION.FLOW_BUDGET. ECONOMY_SCALE is now one complete knob — the
calibration pass (sub-project 2) only has to pick the number.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage** — checked against `docs/planned/economy-scale-knob.md`:
- Knob (`economy-scale.ts`, `toEconomyScale` validator default 1, server-only) → Task 1. ✅ (Validator placed inline, not in `guards.ts` — documented deviation with rationale.)
- Scale-by-S inventory (GOOD_CONSUMPTION, OUTPUT_PER_UNIT, MIN_DEMAND, the three storage scalars, POP_CENTRE_STORAGE, FLOW_BUDGET, DIRECTED_LOGISTICS.GENERATION_PER_POP) → Task 2 steps 3–7. ✅
- Sim pressure (startingCredits explicit, flowBudget auto) → Task 3. ✅
- "Do NOT scale" set (DIRECTED_BUILD.GENERATION_PER_POP, HOP/FUEL weights, ratios) → called out as untouched in Task 2 step 7; no task modifies them. ✅
- Verification: S=1 byte-identical (Task 2 step 9, Task 3 step 5), S=k invariance unit test (Task 2), sim discipline (Task 3 steps 6–7). ✅
- Scope boundary (no calibration value, no contract rework, no ship re-pricing) → respected; only the knob + wiring + tests. ✅

**2. Placeholder scan** — no TBD/TODO/"handle edge cases"/"similar to". Every code step shows complete code. ✅

**3. Type consistency** — helper names (`scaleValue`, `scaleRecord`, `toEconomyScale`, `ECONOMY_SCALE`) are defined in Task 1 and consumed verbatim in Tasks 2–3. Test helpers (`loadAtScale`, `scenario`, `resolveAtScale`) are self-contained per file. Pricing API used (`marketBand`, `midPriceAt`, `demandRateForGood`, `facilityStorageForGood`, `HOUSING_TYPE`) matches the verified signatures in `lib/engine/market-pricing.ts`, `lib/constants/market-economy.ts`, and `lib/engine/industry.ts`. ✅
