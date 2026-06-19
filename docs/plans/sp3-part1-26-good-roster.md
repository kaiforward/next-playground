# SP3 Part 1 — The 26-Good Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the economy from 12 goods to the full 26-good market roster (activate the four inert resources gas/minerals/biomass/radioactive as tier-0 goods, add the six new tier-1 and four new tier-2 goods), lay down the supply-chain recipe catalog as inert data, and recalibrate the existing labour-only economy so all 26 goods trade healthily.

**Architecture:** Pure additive change to the constants layer. The economy still runs the **existing labour-only production model** (`coeff × labourFactor(pop)` for tier-1+, resource-driven for tier-0) — the industrial base and input-gating are Part 2/Part 3. New goods flow automatically into the seed, simulator, UI, and coverage tests because every consumer derives from `GOODS`/`GOOD_NAMES`. The only non-derived consumers are three lookup tables (`GOOD_PRODUCTION`, `GOOD_CONSUMPTION`, `GOOD_COLORS`) and one new recipe table.

**Tech Stack:** TypeScript 5 (strict), Vitest 4 for tests, Prisma 7 (reseed only — no migration), the in-repo economy simulator (`npm run simulate`).

## Global Constraints

- **No `as` casts** except `as const` and runtime guards in `lib/types/guards.ts`. Copy verbatim from CLAUDE.md.
- **No `unknown`** anywhere (no `Record<string, unknown>`). Use typed keys/values.
- **Typed keys** — good ids are plain `string` keys consistent with existing `GOOD_PRODUCTION`/`GOOD_CONSUMPTION`.
- **Production model is unchanged in Part 1** — tier-1/2 new goods are labour-only (`{ coeff }`, no `resource`); only tier-0 goods carry a `resource`. Input-gating is **Part 3** — recipes are inert data here.
- **All new constant values are first-draft and simulator-calibrated** — only relative shape matters (higher tier → smaller `coeff` and smaller per-capita need). Final values are tuned in Task 6.
- **The 26 market goods are tiers 0–2 only.** Tier-3 military *assets* (non-market) are out of scope.
- **Work on a phase branch off the shared branch** `feat/economy-sp3` (e.g. `feat/economy-sp3-roster`); squash-PR into `feat/economy-sp3` when Part 1 is complete (per the shared-feature-branch workflow). Commit after every task.
- **End every git commit message** with the trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Run unit tests** with `npx vitest run --project unit <path>` (the unit project sets no `DATABASE_URL`; none of the files in this plan import `@/lib/prisma`, so this is safe).

**The new goods (reference — used across Tasks 2–5):**

| Tier | Good (key) | basePrice | volatility | hazard | volume | mass | resource / inputs |
|---|---|---|---|---|---|---|---|
| 0 | `gas` | 30 | 0.7 | none | 2 | 1.0 | gas |
| 0 | `minerals` | 40 | 0.8 | none | 1 | 2.0 | minerals |
| 0 | `biomass` | 32 | 0.6 | none | 2 | 1.5 | biomass |
| 0 | `radioactives` | 50 | 1.2 | high | 1 | 2.0 | radioactive |
| 1 | `alloys` | 60 | 0.8 | none | 1 | 2.0 | metals, minerals |
| 1 | `polymers` | 48 | 0.7 | none | 1 | 1.0 | gas, biomass |
| 1 | `components` | 70 | 0.9 | none | 1 | 1.0 | minerals, metals |
| 1 | `consumer_goods` | 55 | 0.6 | none | 1 | 1.0 | textiles, polymers |
| 1 | `munitions` | 75 | 1.3 | low | 1 | 1.5 | metals, chemicals |
| 1 | `hull_plating` | 70 | 0.9 | none | 2 | 2.5 | metals, alloys |
| 2 | `weapons_systems` | 160 | 1.5 | high | 1 | 1.5 | electronics, munitions, hull_plating |
| 2 | `targeting_arrays` | 140 | 1.0 | none | 1 | 0.5 | electronics, components |
| 2 | `reactor_cores` | 170 | 1.2 | high | 1 | 2.0 | radioactives, alloys, components |
| 2 | `ship_frames` | 180 | 1.0 | none | 2 | 2.5 | hull_plating, alloys, components |

All new goods use the tier price band: tier-0 `priceFloor 0.5 / priceCeiling 2.0`, tier-1 `0.5 / 2.5`, tier-2 `0.5 / 3.0` (matching existing goods of that tier).

---

### Task 1: Make good-count assertions roster-agnostic

Removes the only hardcoded `12` so adding goods in later tasks doesn't break an existing test. Pure test/comment change — no behaviour change.

**Files:**
- Modify: `lib/engine/__tests__/simulator.test.ts:35`
- Modify: `lib/constants/market-economy.ts` (comment at ~line 26)
- Modify: `lib/test-utils/fixtures.ts` (comments at ~lines 5, 227, 247)

**Interfaces:**
- Consumes: `GOOD_NAMES` from `@/lib/constants/goods` (existing export — the canonical good-id list).
- Produces: nothing new; makes the market-count assertion derive from `GOOD_NAMES.length`.

- [ ] **Step 1: Confirm the brittle assertion is the only hardcoded count**

Run: `npx vitest run --project unit lib/engine/__tests__/simulator.test.ts`
Expected: PASS (baseline, 12 goods). Then grep for other hardcoded counts:

Search the repo for `* 12`, `=== 12`, `).toBe(12`, `length).toBe(12` under `lib/` and `app/`. Expected: only `lib/engine/__tests__/simulator.test.ts:35` matches a good-count assertion.

- [ ] **Step 2: Make the assertion derive from `GOOD_NAMES.length`**

In `lib/engine/__tests__/simulator.test.ts`, ensure `GOOD_NAMES` is imported (add to the existing `@/lib/constants/goods` import if not present), then change line 35:

```typescript
// before:
expect(world.markets.length).toBe(world.systems.length * 12); // 12 goods per system
// after:
expect(world.markets.length).toBe(world.systems.length * GOOD_NAMES.length); // one market per good per system
```

- [ ] **Step 3: Update stale "12 goods" comments**

In `lib/constants/market-economy.ts`, the `TARGET_COVER` doc comment says "across all twelve goods, so staples (deep cover) and advanced goods (thin cover)…". Change "all twelve goods" → "all goods".

In `lib/test-utils/fixtures.ts`, change the three comments referencing "all 12 goods" / "12 goods" → "all goods" (the code already iterates `Object.entries(GOODS)`).

- [ ] **Step 4: Run the affected tests**

Run: `npx vitest run --project unit lib/engine/__tests__/simulator.test.ts`
Expected: PASS (still 12 goods, but now `12 × GOOD_NAMES.length` = `12 × 12`).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/__tests__/simulator.test.ts lib/constants/market-economy.ts lib/test-utils/fixtures.ts
git commit -m "test(economy): derive market-count assertion from GOOD_NAMES.length"
```

---

### Task 2: Add the four tier-0 goods (activate the inert resources)

Activates gas, minerals, biomass, and radioactives — the four resources that were economically inert because no good consumed them. After this task they are produced (resource-driven), consumed (population), seeded, and tradeable.

**Files:**
- Modify: `lib/constants/goods.ts` (the `GOODS` record, tier-0 section)
- Modify: `lib/constants/physical-economy.ts` (`GOOD_PRODUCTION`, `GOOD_CONSUMPTION`)
- Modify: `lib/constants/ui.ts` (`GOOD_COLORS`, ~lines 193–206)
- Test: `lib/constants/__tests__/physical-economy.test.ts` (existing coverage test — the failing test)

**Interfaces:**
- Consumes: `GoodDefinition` shape from `goods.ts`; `GoodProductionDriver` (`{ coeff, resource? }`) from `physical-economy.ts`; `ResourceType` values `gas`/`minerals`/`biomass`/`radioactive`.
- Produces: good keys `gas`, `minerals`, `biomass`, `radioactives` available in `GOODS`/`GOOD_NAMES`, with production drivers and per-capita needs.

- [ ] **Step 1: Watch the existing coverage test fail after adding the goods**

First add the four goods to `GOODS` in `lib/constants/goods.ts`, immediately after the `textiles` entry (still inside the tier-0 block, before the Tier 1 comment):

```typescript
  gas: {
    name: "Gas",
    description: "Hydrogen, helium-3, and atmospheric gases — raw energy feedstock.",
    basePrice: 30,
    tier: 0,
    volume: 2,
    mass: 1.0,
    volatility: 0.7,
    hazard: "none",
    priceFloor: 0.5,
    priceCeiling: 2.0,
  },
  minerals: {
    name: "Minerals",
    description: "Rare earths, crystalline materials, and precision-grade ores.",
    basePrice: 40,
    tier: 0,
    volume: 1,
    mass: 2.0,
    volatility: 0.8,
    hazard: "none",
    priceFloor: 0.5,
    priceCeiling: 2.0,
  },
  biomass: {
    name: "Biomass",
    description: "Organic compounds and biological feedstock for synthesis.",
    basePrice: 32,
    tier: 0,
    volume: 2,
    mass: 1.5,
    volatility: 0.6,
    hazard: "none",
    priceFloor: 0.5,
    priceCeiling: 2.0,
  },
  radioactives: {
    name: "Radioactives",
    description: "Fissile materials and isotopes — high value, high hazard.",
    basePrice: 50,
    tier: 0,
    volume: 1,
    mass: 2.0,
    volatility: 1.2,
    hazard: "high",
    priceFloor: 0.5,
    priceCeiling: 2.0,
  },
```

- [ ] **Step 2: Run the coverage test to verify it fails**

Run: `npx vitest run --project unit lib/constants/__tests__/physical-economy.test.ts`
Expected: FAIL — `production: gas` / `consumption: gas` (etc.) `toBeDefined` fails, because the new goods are in `GOOD_NAMES` but not yet in `GOOD_PRODUCTION`/`GOOD_CONSUMPTION`.

- [ ] **Step 3: Add the production drivers and consumption needs**

In `lib/constants/physical-economy.ts`, add to `GOOD_PRODUCTION` in the Tier 0 block (after `textiles`):

```typescript
  gas: { coeff: 1.2, resource: "gas" },
  minerals: { coeff: 1.0, resource: "minerals" },
  biomass: { coeff: 1.2, resource: "biomass" },
  radioactives: { coeff: 0.8, resource: "radioactive" },
```

And to `GOOD_CONSUMPTION` in the Tier 0 block (after `textiles`):

```typescript
  gas: 0.003,
  minerals: 0.002,
  biomass: 0.002,
  radioactives: 0.0008,
```

- [ ] **Step 4: Run the coverage test to verify it passes**

Run: `npx vitest run --project unit lib/constants/__tests__/physical-economy.test.ts`
Expected: PASS — every `GOOD_NAME` now has a production driver and a positive per-capita need; no extra entries.

- [ ] **Step 5: Add chart colors for the new goods**

In `lib/constants/ui.ts`, add to the `GOOD_COLORS` map (after `textiles`):

```typescript
  gas: "#a5f3fc",
  minerals: "#fcd34d",
  biomass: "#86efac",
  radioactives: "#bef264",
```

- [ ] **Step 6: Run the full unit suite**

Run: `npx vitest run --project unit`
Expected: PASS — the engine `physical-economy.test.ts` (`substrateGoodRates` returns one entry per `GOOD_NAME`), `market-economy.test.ts`, and `simulator.test.ts` (now `16 × systems`) all pass with 16 goods.

- [ ] **Step 7: Commit**

```bash
git add lib/constants/goods.ts lib/constants/physical-economy.ts lib/constants/ui.ts
git commit -m "feat(economy): activate gas/minerals/biomass/radioactives as tier-0 goods"
```

---

### Task 3: Add the six new tier-1 goods

Adds alloys, polymers, components, consumer_goods, munitions, hull_plating as labour-only processed goods (no input-gating yet).

**Files:**
- Modify: `lib/constants/goods.ts` (`GOODS`, end of tier-1 section)
- Modify: `lib/constants/physical-economy.ts` (`GOOD_PRODUCTION`, `GOOD_CONSUMPTION`, tier-1 blocks)
- Modify: `lib/constants/ui.ts` (`GOOD_COLORS`)

**Interfaces:**
- Consumes: same shapes as Task 2.
- Produces: good keys `alloys`, `polymers`, `components`, `consumer_goods`, `munitions`, `hull_plating` (tier 1, labour-only production).

- [ ] **Step 1: Add the six goods to `GOODS`**

In `lib/constants/goods.ts`, after the `medicine` entry (end of the tier-1 block, before the Tier 2 comment):

```typescript
  alloys: {
    name: "Alloys",
    description: "High-strength composite metals — titanium alloys, durasteel.",
    basePrice: 60, tier: 1, volume: 1, mass: 2.0,
    volatility: 0.8, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },
  polymers: {
    name: "Polymers",
    description: "Plastics, synthetics, and carbon fibre from petrochemicals and bioprocessing.",
    basePrice: 48, tier: 1, volume: 1, mass: 1.0,
    volatility: 0.7, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },
  components: {
    name: "Components",
    description: "Precision parts — circuit boards, actuators, micro-assemblies. The universal intermediate.",
    basePrice: 70, tier: 1, volume: 1, mass: 1.0,
    volatility: 0.9, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },
  consumer_goods: {
    name: "Consumer Goods",
    description: "Everyday manufactured products — clothing, tools, devices.",
    basePrice: 55, tier: 1, volume: 1, mass: 1.0,
    volatility: 0.6, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },
  munitions: {
    name: "Munitions",
    description: "Ammunition, explosives, and propellant charges.",
    basePrice: 75, tier: 1, volume: 1, mass: 1.5,
    volatility: 1.3, hazard: "low", priceFloor: 0.5, priceCeiling: 2.5,
  },
  hull_plating: {
    name: "Hull Plating",
    description: "Armour plates and structural panels — military-grade structural material.",
    basePrice: 70, tier: 1, volume: 2, mass: 2.5,
    volatility: 0.9, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },
```

- [ ] **Step 2: Run the coverage test to verify it fails**

Run: `npx vitest run --project unit lib/constants/__tests__/physical-economy.test.ts`
Expected: FAIL — `production: alloys` (etc.) undefined.

- [ ] **Step 3: Add production drivers and consumption needs**

In `lib/constants/physical-economy.ts`, add to `GOOD_PRODUCTION` in the Tier 1 block (after `medicine`):

```typescript
  alloys: { coeff: 4 },
  polymers: { coeff: 4.5 },
  components: { coeff: 4 },
  consumer_goods: { coeff: 4.5 },
  munitions: { coeff: 3.5 },
  hull_plating: { coeff: 3.5 },
```

Add to `GOOD_CONSUMPTION` in the Tier 1 block (after `medicine`):

```typescript
  alloys: 0.001,
  polymers: 0.0012,
  components: 0.001,
  consumer_goods: 0.0015,
  munitions: 0.0005,
  hull_plating: 0.0005,
```

- [ ] **Step 4: Run the coverage test to verify it passes**

Run: `npx vitest run --project unit lib/constants/__tests__/physical-economy.test.ts`
Expected: PASS.

- [ ] **Step 5: Add chart colors**

In `lib/constants/ui.ts` `GOOD_COLORS`:

```typescript
  alloys: "#cbd5e1",
  polymers: "#f0abfc",
  components: "#93c5fd",
  consumer_goods: "#fda4af",
  munitions: "#fb7185",
  hull_plating: "#78716c",
```

- [ ] **Step 6: Run the full unit suite**

Run: `npx vitest run --project unit`
Expected: PASS (22 goods).

- [ ] **Step 7: Commit**

```bash
git add lib/constants/goods.ts lib/constants/physical-economy.ts lib/constants/ui.ts
git commit -m "feat(economy): add six tier-1 processed goods (alloys, polymers, components, consumer goods, munitions, hull plating)"
```

---

### Task 4: Add the four new tier-2 goods

Adds weapons_systems, targeting_arrays, reactor_cores, ship_frames (labour-only, completing the 26-good roster).

**Files:**
- Modify: `lib/constants/goods.ts` (`GOODS`, end of tier-2 section, before the closing `} as const;`)
- Modify: `lib/constants/physical-economy.ts` (`GOOD_PRODUCTION`, `GOOD_CONSUMPTION`, tier-2 blocks)
- Modify: `lib/constants/ui.ts` (`GOOD_COLORS`)

**Interfaces:**
- Consumes: same shapes as Task 2.
- Produces: good keys `weapons_systems`, `targeting_arrays`, `reactor_cores`, `ship_frames` (tier 2). After this task `GOOD_NAMES.length === 26`.

- [ ] **Step 1: Add the four goods to `GOODS`**

In `lib/constants/goods.ts`, after the `luxuries` entry, before `} as const;`:

```typescript
  weapons_systems: {
    name: "Weapons Systems",
    description: "Ship-mounted weapon platforms — turrets, launchers, beam arrays.",
    basePrice: 160, tier: 2, volume: 1, mass: 1.5,
    volatility: 1.5, hazard: "high", priceFloor: 0.5, priceCeiling: 3.0,
  },
  targeting_arrays: {
    name: "Targeting Arrays",
    description: "Fire-control systems, long-range sensors, tactical computers.",
    basePrice: 140, tier: 2, volume: 1, mass: 0.5,
    volatility: 1.0, hazard: "none", priceFloor: 0.5, priceCeiling: 3.0,
  },
  reactor_cores: {
    name: "Reactor Cores",
    description: "Military-grade power plants — fusion reactors, antimatter containment.",
    basePrice: 170, tier: 2, volume: 1, mass: 2.0,
    volatility: 1.2, hazard: "high", priceFloor: 0.5, priceCeiling: 3.0,
  },
  ship_frames: {
    name: "Ship Frames",
    description: "Assembled structural hull sections — spaceframes, bulkheads.",
    basePrice: 180, tier: 2, volume: 2, mass: 2.5,
    volatility: 1.0, hazard: "none", priceFloor: 0.5, priceCeiling: 3.0,
  },
```

- [ ] **Step 2: Run the coverage test to verify it fails**

Run: `npx vitest run --project unit lib/constants/__tests__/physical-economy.test.ts`
Expected: FAIL — `production: weapons_systems` (etc.) undefined.

- [ ] **Step 3: Add production drivers and consumption needs**

In `lib/constants/physical-economy.ts`, add to `GOOD_PRODUCTION` in the Tier 2 block (after `luxuries`):

```typescript
  weapons_systems: { coeff: 1.5 },
  targeting_arrays: { coeff: 2 },
  reactor_cores: { coeff: 1.5 },
  ship_frames: { coeff: 1.2 },
```

Add to `GOOD_CONSUMPTION` in the Tier 2 block (after `luxuries`):

```typescript
  weapons_systems: 0.0003,
  targeting_arrays: 0.0004,
  reactor_cores: 0.0003,
  ship_frames: 0.0003,
```

- [ ] **Step 4: Run the coverage test to verify it passes**

Run: `npx vitest run --project unit lib/constants/__tests__/physical-economy.test.ts`
Expected: PASS.

- [ ] **Step 5: Add chart colors**

In `lib/constants/ui.ts` `GOOD_COLORS`:

```typescript
  weapons_systems: "#dc2626",
  targeting_arrays: "#2dd4bf",
  reactor_cores: "#facc15",
  ship_frames: "#64748b",
```

- [ ] **Step 6: Run the full unit suite + typecheck**

Run: `npx vitest run --project unit`
Expected: PASS — `simulator.test.ts` now asserts `26 × systems` markets.

Run: `npx tsc --noEmit`
Expected: no errors (new goods type-check against `GoodDefinition`/`GoodTier`/`Hazard`).

- [ ] **Step 7: Commit**

```bash
git add lib/constants/goods.ts lib/constants/physical-economy.ts lib/constants/ui.ts
git commit -m "feat(economy): add four tier-2 advanced goods — completes the 26-good roster"
```

---

### Task 5: The supply-chain recipe catalog (inert data + integrity test)

Lock the chain structure as data. Recipes are **not consumed by anything in Part 1** — they are wired into input-gating in Part 3. The value delivered here is a single source of truth for the chain plus an integrity test that guarantees it is a valid acyclic supply graph.

**Files:**
- Create: `lib/constants/recipes.ts`
- Create: `lib/constants/__tests__/recipes.test.ts`

**Interfaces:**
- Consumes: `GOODS`, `GOOD_NAMES`, `GOOD_TIER_BY_KEY` from `@/lib/constants/goods`.
- Produces: `GOOD_RECIPES: Record<string, Record<string, number>>` — `produced good id → { input good id: units consumed per unit output }`. Tier-0 goods are absent (extracted, no recipe). Part 3 reads this for input-gating.

- [ ] **Step 1: Write the integrity test (failing — module doesn't exist yet)**

Create `lib/constants/__tests__/recipes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";

describe("GOOD_RECIPES integrity", () => {
  it("has a recipe for every tier-1+ good and none for tier-0 goods", () => {
    for (const goodId of GOOD_NAMES) {
      const tier = GOOD_TIER_BY_KEY[goodId];
      if (tier === 0) {
        expect(GOOD_RECIPES[goodId], `tier-0 good must have no recipe: ${goodId}`).toBeUndefined();
      } else {
        expect(GOOD_RECIPES[goodId], `tier-${tier} good must have a recipe: ${goodId}`).toBeDefined();
      }
    }
  });

  it("references only real goods, with positive input quantities", () => {
    const known = new Set(GOOD_NAMES);
    for (const [output, inputs] of Object.entries(GOOD_RECIPES)) {
      expect(known.has(output), `recipe key is a real good: ${output}`).toBe(true);
      for (const [input, qty] of Object.entries(inputs)) {
        expect(known.has(input), `input is a real good: ${input} (in ${output})`).toBe(true);
        expect(qty, `positive input qty: ${input} in ${output}`).toBeGreaterThan(0);
      }
    }
  });

  it("only consumes inputs of equal or lower tier", () => {
    for (const [output, inputs] of Object.entries(GOOD_RECIPES)) {
      const outTier = GOOD_TIER_BY_KEY[output];
      for (const input of Object.keys(inputs)) {
        expect(GOOD_TIER_BY_KEY[input], `${input} tier <= ${output} tier`).toBeLessThanOrEqual(outTier);
      }
    }
  });

  it("is acyclic (a valid DAG so Part 3 can topologically order production)", () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const cyclic: string[] = [];
    const visit = (good: string): void => {
      if (done.has(good)) return;
      if (visiting.has(good)) {
        cyclic.push(good);
        return;
      }
      visiting.add(good);
      for (const input of Object.keys(GOOD_RECIPES[good] ?? {})) visit(input);
      visiting.delete(good);
      done.add(good);
    };
    for (const good of Object.keys(GOOD_RECIPES)) visit(good);
    expect(cyclic, `cycle detected through: ${cyclic.join(", ")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit lib/constants/__tests__/recipes.test.ts`
Expected: FAIL — cannot resolve `@/lib/constants/recipes` (module not found).

- [ ] **Step 3: Create the recipe catalog**

Create `lib/constants/recipes.ts`:

```typescript
/**
 * Supply-chain recipes: produced good -> { input good: units consumed per unit
 * output }. Tier-0 goods are resource-extracted and have NO recipe (absent
 * here). Input quantities are first-draft and simulator-calibrated in SP3
 * Part 3; only the input *structure* (which goods feed which) is locked here.
 *
 * INERT until SP3 Part 3 wires input-gating — no consumer reads this in Part 1.
 * The graph is a DAG (see recipes.test.ts); Part 3 topologically orders
 * production within a system so a freshly-produced input feeds its consumer
 * the same tick.
 */
export const GOOD_RECIPES: Record<string, Record<string, number>> = {
  // ── Tier 1 ────────────────────────────────────────────────
  fuel: { gas: 1 },
  metals: { ore: 1 },
  chemicals: { gas: 0.5, minerals: 0.5 },
  medicine: { biomass: 0.5, chemicals: 0.5 },
  alloys: { metals: 0.6, minerals: 0.4 },
  polymers: { gas: 0.5, biomass: 0.5 },
  components: { minerals: 0.5, metals: 0.5 },
  consumer_goods: { textiles: 0.5, polymers: 0.5 },
  munitions: { metals: 0.5, chemicals: 0.5 },
  hull_plating: { metals: 0.5, alloys: 0.5 },
  // ── Tier 2 ────────────────────────────────────────────────
  electronics: { components: 0.6, chemicals: 0.4 },
  machinery: { metals: 0.5, components: 0.5 },
  weapons: { metals: 0.4, chemicals: 0.3, munitions: 0.3 },
  luxuries: { consumer_goods: 0.5, electronics: 0.5 },
  weapons_systems: { electronics: 0.4, munitions: 0.3, hull_plating: 0.3 },
  targeting_arrays: { electronics: 0.6, components: 0.4 },
  reactor_cores: { radioactives: 0.4, alloys: 0.3, components: 0.3 },
  ship_frames: { hull_plating: 0.4, alloys: 0.3, components: 0.3 },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit lib/constants/__tests__/recipes.test.ts`
Expected: PASS — every tier-1+ good has a recipe, no tier-0 good does, all inputs are real lower-or-equal-tier goods, and the graph is acyclic.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/recipes.ts lib/constants/__tests__/recipes.test.ts
git commit -m "feat(economy): add supply-chain recipe catalog (inert until Part 3 input-gating)"
```

---

### Task 6: Reseed and recalibrate the 26-good economy

The economy now runs 26 goods on first-draft constants. This task validates and tunes them against the simulator's equilibrium targets, then reseeds the live database. Calibration is iterative — the "test" is the simulator's market-health output meeting the targets below.

**Files:**
- Modify (as needed): `lib/constants/physical-economy.ts` (`GOOD_PRODUCTION` coeffs, `GOOD_CONSUMPTION` needs), `lib/constants/goods.ts` (basePrice/volatility of any pinned good), `lib/constants/market-economy.ts` (`TARGET_COVER` only if the whole set needs it).
- Run: `npm run simulate`; `npx prisma db seed`.

**Interfaces:**
- Consumes: the 26-good `GOODS`/`GOOD_PRODUCTION`/`GOOD_CONSUMPTION` from Tasks 2–4.
- Produces: calibrated first-draft constants for 26 goods; a reseeded DB with 26 markets per system.

- [ ] **Step 1: Run the simulator baseline for 26 goods**

Run: `npm run simulate`
This runs all strategies, 500 ticks, seed 42 (per CLAUDE.md), and prints per-good price dispersion, stock drift, and per-strategy credits. No DB needed (the simulator generates its own universe).

- [ ] **Step 2: Check the calibration targets**

Read the market-health table and verify, across all 26 goods:
- **Stocks stay in `[5, 200]`** — no good's stock drifts to a bound and pins there everywhere.
- **Cross-system price dispersion is non-trivial for every good** — no good is pinned cheap-everywhere (price floor) or dear-everywhere (ceiling). A good with ~zero dispersion is mispriced.
- **`greedy ≫ random`** — the greedy trading strategy out-earns random, i.e. profitable cross-system gradients exist.
- **Population is stable-but-growing** (SP2 target) — no total collapse, no instant saturation, no migration ping-pong.

- [ ] **Step 3: Tune any mispriced good (repeat Step 1–2 until targets hold)**

For each good that misses a target, turn exactly one knob and re-run:
- **Pinned cheap everywhere** (oversupplied) → lower its `GOOD_PRODUCTION[good].coeff` (or raise `GOOD_CONSUMPTION[good]`).
- **Pinned dear everywhere** (undersupplied) → raise its `coeff` (or lower its need).
- **Stock pinned at a bound** → the production/consumption balance is off; nudge `coeff`/need toward parity.
- **Flat (no dispersion)** → increase the good's `volatility` slightly, or check its `coeff` relative to its tier neighbours.
- Keep relative shape intact (higher tier → smaller coeff, smaller need). Only touch `TARGET_COVER` if the *whole* roster skews one way (it is the single global lever — changing it moves every good).

Re-run `npm run simulate` after each change. Coarse-only — stop when all four targets hold; do not over-tune (Part 2/SP5 reshape the equilibrium).

- [ ] **Step 4: Run the full test suite (unit + integration)**

Run: `npx vitest run`
Expected: PASS — including `simulator-integration.test.ts` (determinism: same seed → identical results, now over 26 goods).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Reseed the live database**

Run: `npx prisma db seed`
Expected: "Created 26 goods" and markets created for every system (26 per system). No migration is needed — `Good` and `StationMarket` schemas are unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/constants/physical-economy.ts lib/constants/goods.ts lib/constants/market-economy.ts
git commit -m "feat(economy): calibrate 26-good roster to equilibrium targets (coarse)"
```

(If Steps 3 changed no files because the first-draft values already passed, commit is a no-op — note that in the task summary instead.)

---

## Done criteria for Part 1

- `GOOD_NAMES.length === 26`; all 26 goods have production drivers, per-capita needs, and chart colors.
- The four formerly-inert resources (gas/minerals/biomass/radioactive) drive tradeable tier-0 goods.
- `GOOD_RECIPES` locks the full supply chain as an acyclic graph (inert until Part 3).
- `npm run simulate` meets all four targets across 26 goods; `npx vitest run` and `npx tsc --noEmit` are green.
- The DB is reseeded with 26 markets per system.
- **Not in Part 1:** the industrial base / build space / capacity-driven production (Part 2) and input-gating / production-input demand (Part 3). The economy still runs the labour-only model.
```
