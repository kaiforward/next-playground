# SP5 Stage 1 — Build Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure `directed-build` engine — the demand-pulled faction build planner that decides what production to add where, by creating supply only where logistics runs out of reachable surplus.

**Architecture:** A pure, DB-free engine mirroring `lib/engine/directed-logistics.ts`. It classifies each `(system, good)` market state (reusing a shared classifier extracted from the logistics engine), finds **structural deficits** (a deficit with no reachable surplus), scores candidate buildable sites by capacity-aware reachable demand, and returns a greedy list of `PlannedBuild` entries (production + co-built housing). The processor, adapters, and wiring are separate follow-on plans; this plan is the engine + its unit tests only.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Pure functions, zero DB. Reuses `lib/constants/industry.ts`, `lib/constants/recipes.ts`, `lib/constants/goods.ts`, `lib/engine/industry.ts`, `lib/engine/resources.ts`.

## Global Constraints

- **No `as` casts** except `as const` (project rule). No `unknown`, no `Record<string, unknown>`.
- **No postfix `!`** except `find(...)!` in tests (project idiom).
- **Engine is pure** — zero DB imports. NEVER statically import `@/lib/prisma` (directly or transitively); the `unit` Vitest project sets no `DATABASE_URL` and module-load would throw.
- **Discriminated unions** for result-ish types, not `{ ok: boolean; ... }`.
- Reuse existing constants/helpers — do not duplicate `OUTPUT_PER_UNIT`, `effectiveSpaceCost`, `labourDemand`, `housingPopCap`, `GOOD_TIER_BY_KEY`, `GOOD_RECIPES`, `BUILDING_TYPES`, `RESOURCE_TYPES`.
- Thresholds: a good is a **deficit** when `stock < targetStock × DEFICIT_FRACTION` (0.8) and a **surplus** when `stock ≥ targetStock × SURPLUS_MARGIN` (1.4) — the same `DIRECTED_LOGISTICS` constants logistics uses.
- Run unit tests with `npx vitest run --project unit <path>` (verify with `DATABASE_URL` unset).

---

### Task 1: Extract the shared market-state classifier

Extract the inline deficit/surplus classification from `matchFactionTransfers` into a reusable, exported pure function so the build engine and the logistics engine share one definition. Behaviour of `matchFactionTransfers` must not change.

**Files:**
- Modify: `lib/engine/directed-logistics.ts`
- Test: `lib/engine/__tests__/directed-logistics.test.ts` (existing — must stay green)

**Interfaces:**
- Produces: `classifyMarketState(stock: number, targetStock: number): MarketClassification` and `interface MarketClassification { kind: "deficit" | "surplus" | "balanced"; shortfall: number; drawable: number }`. `shortfall = max(0, targetStock − stock)` when deficit (else 0); `drawable = max(0, stock − targetStock)` when surplus (else 0).

- [ ] **Step 1: Write the failing test**

Add to `lib/engine/__tests__/directed-logistics.test.ts`:

```typescript
import { classifyMarketState } from "@/lib/engine/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

describe("classifyMarketState", () => {
  it("classifies below the deficit fraction as deficit with shortfall to target", () => {
    // targetStock 10, DEFICIT_FRACTION 0.8 → threshold 8; stock 2 < 8.
    const c = classifyMarketState(2, 10);
    expect(c.kind).toBe("deficit");
    expect(c.shortfall).toBe(8);
    expect(c.drawable).toBe(0);
  });

  it("classifies at/above the surplus margin as surplus with drawable above target", () => {
    // targetStock 50, SURPLUS_MARGIN 1.4 → threshold 70; stock 100 ≥ 70.
    const c = classifyMarketState(100, 50);
    expect(c.kind).toBe("surplus");
    expect(c.drawable).toBe(50);
    expect(c.shortfall).toBe(0);
  });

  it("classifies the dead-band between thresholds as balanced", () => {
    // targetStock 10 → deficit < 8, surplus ≥ 14; stock 10 is between.
    const c = classifyMarketState(10, 10);
    expect(c.kind).toBe("balanced");
    expect(c.shortfall).toBe(0);
    expect(c.drawable).toBe(0);
  });

  it("never reports a negative shortfall or drawable", () => {
    expect(classifyMarketState(0, 0).kind).toBe("balanced");
    expect(classifyMarketState(7.9, 10).shortfall).toBeCloseTo(2.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-logistics.test.ts`
Expected: FAIL — `classifyMarketState` is not exported.

- [ ] **Step 3: Add the classifier and refactor `matchFactionTransfers` to use it**

In `lib/engine/directed-logistics.ts`, add near the top (after imports):

```typescript
export type MarketKind = "deficit" | "surplus" | "balanced";

export interface MarketClassification {
  kind: MarketKind;
  /** targetStock − stock when deficit (> 0); else 0. */
  shortfall: number;
  /** stock − targetStock when surplus (> 0); else 0 — never draws below the anchor. */
  drawable: number;
}

/**
 * Classify one good's market against its days-of-supply anchor. Deficit ⇔
 * stock < targetStock × DEFICIT_FRACTION; surplus ⇔ stock ≥ targetStock ×
 * SURPLUS_MARGIN; the dead-band between is balanced. Shared by the logistics
 * matcher and the build planner so both read one definition.
 */
export function classifyMarketState(stock: number, targetStock: number): MarketClassification {
  if (stock < targetStock * DIRECTED_LOGISTICS.DEFICIT_FRACTION) {
    return { kind: "deficit", shortfall: Math.max(0, targetStock - stock), drawable: 0 };
  }
  if (stock >= targetStock * DIRECTED_LOGISTICS.SURPLUS_MARGIN) {
    return { kind: "surplus", shortfall: 0, drawable: Math.max(0, stock - targetStock) };
  }
  return { kind: "balanced", shortfall: 0, drawable: 0 };
}
```

Then replace the inline classification inside `matchFactionTransfers`'s `for (const g of s.goods)` loop with the helper:

```typescript
    for (const g of s.goods) {
      const c = classifyMarketState(g.stock, g.targetStock);
      if (c.kind === "deficit" && c.shortfall > 0) {
        deficits.push({ systemId: s.systemId, goodId: g.goodId, shortfall: c.shortfall, severity: c.shortfall * g.demand });
      } else if (c.kind === "surplus" && c.drawable > 0) {
        const list = surplusesByGood.get(g.goodId) ?? [];
        list.push({ systemId: s.systemId, goodId: g.goodId, drawable: c.drawable });
        surplusesByGood.set(g.goodId, list);
      }
    }
```

- [ ] **Step 4: Run tests to verify all pass (new classifier + unchanged matcher)**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-logistics.test.ts`
Expected: PASS — the new `classifyMarketState` tests and all existing `matchFactionTransfers` tests pass (behaviour unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/directed-logistics.ts lib/engine/__tests__/directed-logistics.test.ts
git commit -m "refactor(logistics): extract classifyMarketState shared classifier"
```

---

### Task 2: Build constants + types + per-system generation

Create the `directed-build` constant block and the engine's input/output types, plus the population-scaled build budget (mirror of `systemLogisticsGeneration`).

**Files:**
- Create: `lib/constants/directed-build.ts`
- Create: `lib/engine/directed-build.ts`
- Test: `lib/engine/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `classifyMarketState`, `RouteCost` from `lib/engine/directed-logistics` (Task 1); `ResourceVector` from `lib/types/game`.
- Produces:
  - `DIRECTED_BUILD` constant block (`INTERVAL`, `GENERATION_PER_POP`, `MAX_HOPS`, `HOP_WEIGHT`).
  - `interface BuildGoodState { goodId: string; stock: number; targetStock: number; demand: number }`
  - `interface BuildSystemState { systemId: string; factionId: string | null; population: number; buildings: Record<string, number>; slotCap: ResourceVector; generalSpace: number; habitableSpace: number; goods: BuildGoodState[] }`
  - `interface PlannedBuild { systemId: string; buildingType: string; count: number }`
  - `systemBuildGeneration(population: number): number`

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/directed-build.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { systemBuildGeneration } from "@/lib/engine/directed-build";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";

describe("systemBuildGeneration", () => {
  it("scales the build budget linearly with population", () => {
    expect(systemBuildGeneration(100)).toBeCloseTo(100 * DIRECTED_BUILD.GENERATION_PER_POP);
  });

  it("never returns a negative budget", () => {
    expect(systemBuildGeneration(-50)).toBe(0);
    expect(systemBuildGeneration(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-build.test.ts`
Expected: FAIL — module `@/lib/engine/directed-build` / `@/lib/constants/directed-build` not found.

- [ ] **Step 3: Create the constants**

Create `lib/constants/directed-build.ts`:

```typescript
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

/**
 * Directed-build (faction build planner) tuning. First-draft, simulator-calibrated;
 * only relative shape matters. The up-arrow twin of SP3.5 infrastructure decay.
 * See docs/plans/sp5-stage1-seed-coherence-design.md.
 */
export const DIRECTED_BUILD = {
  /** Ticks for the per-faction shard to sweep every faction once — the agency clock (matches logistics). */
  INTERVAL: 2 * ECONOMY_UPDATE_INTERVAL,
  /** Build-unit budget a system contributes per cycle = population × this. Free + capacity-bounded in v1. */
  GENERATION_PER_POP: 0.05,
  /** Reachability horizon, shared with logistics (tunable; see hop-cap note in the design). */
  MAX_HOPS: 4,
  /** Per-unit route cost = hops × this (proximity weight in placement scoring). */
  HOP_WEIGHT: 1.0,
} as const;
```

- [ ] **Step 4: Create the engine types + generation function**

Create `lib/engine/directed-build.ts`:

```typescript
/**
 * Pure directed-build planning — zero DB dependency. The faction build planner:
 * given each system's market state + buildable capacity and a route-cost function,
 * find structural deficits (a deficit with no reachable surplus) and decide what
 * production (+ co-built housing) to add where, demand-pulled. The processor maps
 * DB/sim rows into BuildSystemState and applies the returned PlannedBuild[].
 * See docs/plans/sp5-stage1-seed-coherence-design.md.
 */
import type { ResourceVector } from "@/lib/types/game";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";

/** Market state for one good at one system — the build planner's per-good input. */
export interface BuildGoodState {
  goodId: string;
  stock: number;
  targetStock: number;
  /** Total local demand rate (civilian + industrial); severity weight only. */
  demand: number;
}

/** A system's buildable state — markets + the body-derived capacity it can build into. */
export interface BuildSystemState {
  systemId: string;
  factionId: string | null;
  population: number;
  /** Current building counts (production types + "housing"). */
  buildings: Record<string, number>;
  /** Per-resource deposit-slot cap (Σ body slots) — caps tier-0 extractor counts. */
  slotCap: ResourceVector;
  /** Fungible general space — tier-1+ factories + housing draw here. */
  generalSpace: number;
  /** Habitable subset of space — additionally caps housing. */
  habitableSpace: number;
  goods: BuildGoodState[];
}

/** One build action: add `count` units of `buildingType` (a good id, or "housing") at `systemId`. */
export interface PlannedBuild {
  systemId: string;
  buildingType: string;
  count: number;
}

/** This system's per-cycle build-unit budget (free, population-scaled in v1). */
export function systemBuildGeneration(population: number): number {
  return Math.max(0, population) * DIRECTED_BUILD.GENERATION_PER_POP;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-build.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/constants/directed-build.ts lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "feat(build): directed-build constants, types, and per-system generation"
```

---

### Task 3: Structural-deficit detection

A structural deficit is a `(system, good)` deficit for which **no reachable surplus of that good exists** anywhere in the input set (goods flow surplus→deficit, so reachable means `routeCost(surplusSystemId, deficitSystemId)` is non-null). These are the only gaps build targets — non-structural deficits belong to logistics.

**Files:**
- Modify: `lib/engine/directed-build.ts`
- Test: `lib/engine/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `classifyMarketState`, `RouteCost` (from `directed-logistics`).
- Produces: `interface StructuralDeficit { systemId: string; goodId: string; shortfall: number; demand: number }` and `findStructuralDeficits(systems: BuildSystemState[], routeCost: RouteCost): StructuralDeficit[]`.

- [ ] **Step 1: Write the failing test**

Add to `lib/engine/__tests__/directed-build.test.ts`:

```typescript
import { findStructuralDeficits, type BuildSystemState } from "@/lib/engine/directed-build";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { RouteCost } from "@/lib/engine/directed-logistics";

function buildSys(
  systemId: string,
  good: { goodId: string; stock: number; targetStock: number; demand: number },
): BuildSystemState {
  return {
    systemId, factionId: "f1", population: 100, buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0, goods: [good],
  };
}

const reachable: RouteCost = () => 1;
const unreachable: RouteCost = () => null;

describe("findStructuralDeficits", () => {
  it("flags a deficit as structural when no surplus of that good is reachable", () => {
    const deficit = buildSys("A", { goodId: "electronics", stock: 1, targetStock: 10, demand: 4 });
    const out = findStructuralDeficits([deficit], reachable);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ systemId: "A", goodId: "electronics", shortfall: 9, demand: 4 });
  });

  it("excludes a deficit when a reachable surplus of that good exists", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4 });
    const surplus = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4 });
    expect(findStructuralDeficits([deficit, surplus], reachable)).toHaveLength(0);
  });

  it("keeps a deficit structural when the only surplus is unreachable", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4 });
    const surplus = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4 });
    expect(findStructuralDeficits([deficit, surplus], unreachable)).toHaveLength(1);
  });

  it("does not treat a balanced or surplus market as a deficit", () => {
    const balanced = buildSys("A", { goodId: "ore", stock: 10, targetStock: 10, demand: 4 });
    expect(findStructuralDeficits([balanced], reachable)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-build.test.ts`
Expected: FAIL — `findStructuralDeficits` not exported.

- [ ] **Step 3: Implement `findStructuralDeficits`**

Add to `lib/engine/directed-build.ts` (and extend the import line):

```typescript
import { classifyMarketState, type RouteCost } from "@/lib/engine/directed-logistics";
```

```typescript
/** A deficit with no reachable surplus of its good — the build target. */
export interface StructuralDeficit {
  systemId: string;
  goodId: string;
  shortfall: number;
  demand: number;
}

/**
 * Find deficits that logistics cannot serve because no reachable surplus of the
 * good exists. Build classification per (system, good); collect deficits and the
 * surplus-holding systems per good; a deficit is structural when no surplus system
 * of its good can reach it (routeCost(surplus, deficit) non-null).
 */
export function findStructuralDeficits(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): StructuralDeficit[] {
  const deficits: Array<{ systemId: string; goodId: string; shortfall: number; demand: number }> = [];
  const surplusSystemsByGood = new Map<string, string[]>();

  for (const s of systems) {
    for (const g of s.goods) {
      const c = classifyMarketState(g.stock, g.targetStock);
      if (c.kind === "deficit" && c.shortfall > 0) {
        deficits.push({ systemId: s.systemId, goodId: g.goodId, shortfall: c.shortfall, demand: g.demand });
      } else if (c.kind === "surplus" && c.drawable > 0) {
        const list = surplusSystemsByGood.get(g.goodId) ?? [];
        list.push(s.systemId);
        surplusSystemsByGood.set(g.goodId, list);
      }
    }
  }

  const structural: StructuralDeficit[] = [];
  for (const d of deficits) {
    const sources = surplusSystemsByGood.get(d.goodId) ?? [];
    const reachableSurplus = sources.some((su) => routeCost(su, d.systemId) !== null);
    if (!reachableSurplus) structural.push(d);
  }
  return structural;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "feat(build): structural-deficit detection (deficit with no reachable surplus)"
```

---

### Task 4: Buildable-output capacity

Compute how much additional output of a good a system can host, accounting for the space already consumed by its current buildings. Tier-0 extractors are capped by remaining deposit slots for the good's resource (goods sharing a resource share the cap); tier-1+ factories are capped by remaining general space ÷ footprint. Output = buildable units × `OUTPUT_PER_UNIT[good]`.

**Files:**
- Modify: `lib/engine/directed-build.ts`
- Test: `lib/engine/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `GOOD_TIER_BY_KEY` (`lib/constants/goods`), `BUILDING_TYPES`, `OUTPUT_PER_UNIT`, `effectiveSpaceCost`, `HOUSING_TYPE` (`lib/constants/industry`), `RESOURCE_TYPES` (`lib/engine/resources`).
- Produces: `buildableUnits(sys: BuildSystemState, goodId: string): number` (units, not output) and `buildableOutput(sys: BuildSystemState, goodId: string): number` (units × outputPerUnit). Internal helper `generalSpaceUsed(buildings): number`.

- [ ] **Step 1: Write the failing test**

Add to `lib/engine/__tests__/directed-build.test.ts`:

```typescript
import { buildableUnits, buildableOutput } from "@/lib/engine/directed-build";
import { unitResourceVector } from "@/lib/engine/resources";
import { OUTPUT_PER_UNIT } from "@/lib/constants/industry";

// A tier-0 good (food → arable) with deposit slots; sys has space but partial build.
function tier0Sys(builtFood: number, foodSlots: number): BuildSystemState {
  const slotCap = emptyResourceVector();
  // food's resource is arable — set via the building catalog's resource at runtime in the impl;
  // here we set every resource's cap so the test is independent of the food→resource mapping.
  for (const k of Object.keys(slotCap)) slotCap[k as keyof typeof slotCap] = foodSlots;
  return {
    systemId: "A", factionId: "f1", population: 100,
    buildings: { food: builtFood }, slotCap, generalSpace: 100, habitableSpace: 50, goods: [],
  };
}

describe("buildableUnits / buildableOutput", () => {
  it("caps a tier-0 extractor by remaining deposit slots for its resource", () => {
    const sys = tier0Sys(3, 5); // 3 of 5 slots used → 2 remaining
    expect(buildableUnits(sys, "food")).toBeCloseTo(2);
    expect(buildableOutput(sys, "food")).toBeCloseTo(2 * OUTPUT_PER_UNIT.food);
  });

  it("returns zero tier-0 capacity when slots are full", () => {
    const sys = tier0Sys(5, 5);
    expect(buildableUnits(sys, "food")).toBe(0);
  });

  it("caps a tier-1+ factory by remaining general space ÷ footprint", () => {
    // metals is tier-1 (recipe { ore: 1 }); generalSpace 100, no buildings → 100 / spaceCost units.
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    expect(buildableUnits(sys, "metals")).toBeGreaterThan(0);
  });

  it("reduces tier-1+ capacity by space already used by existing buildings", () => {
    const full: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, buildings: { metals: 100 },
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    // metals occupies general space; with 100 units already built, ~no room left.
    expect(buildableUnits(full, "metals")).toBeCloseTo(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-build.test.ts`
Expected: FAIL — `buildableUnits` / `buildableOutput` not exported.

- [ ] **Step 3: Implement capacity helpers**

Extend the imports in `lib/engine/directed-build.ts`:

```typescript
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { BUILDING_TYPES, OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE } from "@/lib/constants/industry";
```

Add:

```typescript
/**
 * General space consumed by current buildings: every tier-1+ factory and housing
 * occupies general space (× its footprint). Tier-0 extractors sit on deposit slots,
 * NOT general space, so they are excluded.
 */
function generalSpaceUsed(buildings: Record<string, number>): number {
  let used = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (type === HOUSING_TYPE) {
      used += count * effectiveSpaceCost(type);
      continue;
    }
    if (GOOD_TIER_BY_KEY[type] === 0) continue; // extractors don't use general space
    used += count * effectiveSpaceCost(type);
  }
  return used;
}

/** Deposit-slot units already used for `resource` (goods sharing the resource share the cap). */
function extractorsOnResource(buildings: Record<string, number>, resource: string): number {
  let used = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0 || GOOD_TIER_BY_KEY[type] !== 0) continue;
    if (BUILDING_TYPES[type]?.resource === resource) used += count;
  }
  return used;
}

/**
 * Additional building units of `goodId` a system can host given current builds.
 * Tier-0: remaining deposit slots for the good's resource. Tier-1+: remaining
 * general space ÷ the type's footprint. Never negative.
 */
export function buildableUnits(sys: BuildSystemState, goodId: string): number {
  const tier = GOOD_TIER_BY_KEY[goodId];
  if (tier === 0) {
    const resource = BUILDING_TYPES[goodId]?.resource;
    if (!resource) return 0;
    const cap = sys.slotCap[resource];
    const remaining = cap - extractorsOnResource(sys.buildings, resource);
    return Math.max(0, remaining);
  }
  const cost = effectiveSpaceCost(goodId);
  if (cost <= 0) return 0;
  const remainingGeneral = sys.generalSpace - generalSpaceUsed(sys.buildings);
  return Math.max(0, remainingGeneral / cost);
}

/** Additional output of `goodId` a system can host = buildable units × per-unit output. */
export function buildableOutput(sys: BuildSystemState, goodId: string): number {
  return buildableUnits(sys, goodId) * (OUTPUT_PER_UNIT[goodId] ?? 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "feat(build): buildable-output capacity (deposit slots / general space aware)"
```

---

### Task 5: Greedy placement planning + co-built housing

The top-level engine entry. For each structural-gap good, score candidate buildable sites by reachable demand they can serve (capacity-bounded, nearest-first), pick the best, emit a production `PlannedBuild` (capped by capacity / remaining demand / faction budget) plus the housing needed to staff it, then continue greedily until the budget is spent. Tier-1+ sites are only eligible this cycle when their recipe inputs are locally produced or have a reachable surplus (the cascade gate).

**Files:**
- Modify: `lib/engine/directed-build.ts`
- Test: `lib/engine/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4; `GOOD_RECIPES` (`lib/constants/recipes`), `labourDemand`, `housingPopCap` (`lib/engine/industry`), `POP_CENTRE_DENSITY`, `HOUSING_TYPE` (`lib/constants/industry`).
- Produces: `planFactionBuilds(systems: BuildSystemState[], routeCost: RouteCost): PlannedBuild[]`. Each production build at a system is accompanied by a `HOUSING_TYPE` build sized to keep `labourDemand ≤ popCap` for that system.

- [ ] **Step 1: Write the failing test**

Add to `lib/engine/__tests__/directed-build.test.ts`:

```typescript
import { planFactionBuilds, type PlannedBuild } from "@/lib/engine/directed-build";

function countFor(builds: PlannedBuild[], systemId: string, type: string): number {
  return builds.filter((b) => b.systemId === systemId && b.buildingType === type)
    .reduce((sum, b) => sum + b.count, 0);
}

describe("planFactionBuilds", () => {
  it("builds tier-0 production at a site that can serve a reachable structural deficit", () => {
    // A: structural food deficit (no surplus anywhere). B: has arable slots + population budget, reachable from A.
    const slotCap = emptyResourceVector();
    for (const k of Object.keys(slotCap)) slotCap[k as keyof typeof slotCap] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 10, targetStock: 10, demand: 5 }],
    };
    const builds = planFactionBuilds([deficit, builder], () => 1);
    expect(countFor(builds, "B", "food")).toBeGreaterThan(0);
    // Co-built housing accompanies the production so it can be staffed.
    expect(countFor(builds, "B", "housing")).toBeGreaterThan(0);
  });

  it("does not build where the good's deficit already has a reachable surplus", () => {
    const slotCap = emptyResourceVector();
    for (const k of Object.keys(slotCap)) slotCap[k as keyof typeof slotCap] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const surplus: BuildSystemState = {
      systemId: "S", factionId: "f1", population: 100, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 100, targetStock: 20, demand: 5 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 50, goods: [],
    };
    const builds = planFactionBuilds([deficit, surplus, builder], () => 1);
    expect(countFor(builds, "B", "food")).toBe(0);
  });

  it("gates a tier-1+ build until its inputs are locally produced (the cascade)", () => {
    // A: structural metals deficit. B: general space + budget but NO ore production and no reachable ore surplus.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "metals", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builderNoInput: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50, goods: [],
    };
    expect(countFor(planFactionBuilds([deficit, builderNoInput], () => 1), "B", "metals")).toBe(0);

    // Same, but B locally produces ore → the metals factory becomes eligible.
    const builderWithInput: BuildSystemState = {
      ...builderNoInput, buildings: { ore: 5 },
    };
    expect(countFor(planFactionBuilds([deficit, builderWithInput], () => 1), "B", "metals")).toBeGreaterThan(0);
  });

  it("returns no builds when the faction has no structural deficits", () => {
    const balanced: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 10, targetStock: 10, demand: 5 }],
    };
    expect(planFactionBuilds([balanced], () => 1)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-build.test.ts`
Expected: FAIL — `planFactionBuilds` not exported.

- [ ] **Step 3: Implement `planFactionBuilds`**

Extend imports in `lib/engine/directed-build.ts`:

```typescript
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { labourDemand, housingPopCap } from "@/lib/engine/industry";
```

Add:

```typescript
/** A tier-1+ site is build-eligible this cycle only when every recipe input is locally produced or has a reachable surplus. */
function inputsAvailable(
  goodId: string,
  site: BuildSystemState,
  reachableSurplusGoods: Set<string>,
): boolean {
  const recipe = GOOD_RECIPES[goodId];
  if (!recipe) return true; // tier-0 has no recipe
  return Object.keys(recipe).every(
    (input) => (site.buildings[input] ?? 0) > 0 || reachableSurplusGoods.has(input),
  );
}

/**
 * Greedy demand-pulled build planner for ONE faction's systems. Budget = Σ system
 * generation, spent as building units. For each structural-gap good, score candidate
 * sites by the reachable structural demand they can serve (capacity-bounded,
 * nearest-first), build at the best, co-build housing to staff it, decrement, repeat.
 */
export function planFactionBuilds(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): PlannedBuild[] {
  let budget = 0;
  for (const s of systems) budget += systemBuildGeneration(s.population);
  if (budget <= 0) return [];

  const structural = findStructuralDeficits(systems, routeCost);
  if (structural.length === 0) return [];

  // Goods for which this faction has a reachable surplus anywhere (for the tier-1+ input gate).
  const reachableSurplusGoods = new Set<string>();
  for (const s of systems) {
    for (const g of s.goods) {
      const c = classifyMarketState(g.stock, g.targetStock);
      if (c.kind === "surplus" && c.drawable > 0) reachableSurplusGoods.add(g.goodId);
    }
  }

  // Mutable per-system building working copy so capacity reflects builds made this pass.
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) working.set(s.systemId, { ...s, buildings: { ...s.buildings } });

  // Remaining structural shortfall per (good → systemId → shortfall).
  const remainingByGood = new Map<string, Map<string, number>>();
  for (const d of structural) {
    const m = remainingByGood.get(d.goodId) ?? new Map<string, number>();
    m.set(d.systemId, (m.get(d.systemId) ?? 0) + d.shortfall);
    remainingByGood.set(d.goodId, m);
  }

  const builds: PlannedBuild[] = [];

  // Greedy: repeatedly pick the highest-scoring (site, good) and build there until budget runs out.
  while (budget > 0) {
    let best: { site: BuildSystemState; goodId: string; score: number; units: number } | null = null;

    for (const [goodId, deficitMap] of remainingByGood) {
      const totalRemaining = [...deficitMap.values()].reduce((a, b) => a + b, 0);
      if (totalRemaining <= 0) continue;

      for (const site of working.values()) {
        const capUnits = buildableUnits(site, goodId);
        if (capUnits <= 0) continue;
        if (GOOD_TIER_BY_KEY[goodId] !== 0 && !inputsAvailable(goodId, site, reachableSurplusGoods)) continue;

        const perUnit = OUTPUT_PER_UNIT[goodId] ?? 0;
        if (perUnit <= 0) continue;

        // Score: allocate this site's output capacity to its reachable structural deficits,
        // nearest-first, summing allocated ÷ routeCost (capacity + proximity, each once).
        let capOutput = capUnits * perUnit;
        const reachable = [...deficitMap.entries()]
          .map(([sysId, short]) => ({ sysId, short, cost: routeCost(site.systemId, sysId) }))
          .filter((r): r is { sysId: string; short: number; cost: number } => r.cost !== null && r.cost > 0)
          .sort((a, b) => a.cost - b.cost);
        if (reachable.length === 0) continue;

        let score = 0;
        let servedOutput = 0;
        for (const r of reachable) {
          if (capOutput <= 0) break;
          const take = Math.min(capOutput, r.short);
          score += take / r.cost;
          servedOutput += take;
          capOutput -= take;
        }
        if (servedOutput <= 0) continue;

        // Units to build = output needed ÷ per-unit, capped by capacity and budget.
        const wantUnits = Math.min(capUnits, servedOutput / perUnit, budget);
        if (wantUnits <= 0) continue;
        if (!best || score > best.score) best = { site, goodId, score, units: wantUnits };
      }
    }

    if (!best) break;

    // Apply the production build to the working copy + emit it.
    const site = best.site;
    site.buildings[best.goodId] = (site.buildings[best.goodId] ?? 0) + best.units;
    builds.push({ systemId: site.systemId, buildingType: best.goodId, count: best.units });
    budget -= best.units;

    // Co-build housing to keep labourDemand ≤ popCap, bounded by habitable + general space.
    const needLabour = labourDemand(site.buildings);
    const havePopCap = housingPopCap(site.buildings);
    if (needLabour > havePopCap) {
      const housingUnits = (needLabour - havePopCap) / POP_CENTRE_DENSITY;
      const cost = effectiveSpaceCost(HOUSING_TYPE);
      const remainingGeneral = site.generalSpace - generalSpaceUsed(site.buildings);
      const affordable = Math.min(site.habitableSpace, remainingGeneral) / cost;
      const housing = Math.max(0, Math.min(housingUnits, affordable));
      if (housing > 0) {
        site.buildings[HOUSING_TYPE] = (site.buildings[HOUSING_TYPE] ?? 0) + housing;
        builds.push({ systemId: site.systemId, buildingType: HOUSING_TYPE, count: housing });
      }
    }

    // Decrement the served structural demand (nearest-first again) so we don't re-target it.
    const deficitMap = remainingByGood.get(best.goodId);
    if (deficitMap) {
      let producedOutput = best.units * (OUTPUT_PER_UNIT[best.goodId] ?? 0);
      const nearest = [...deficitMap.entries()]
        .map(([sysId, short]) => ({ sysId, short, cost: routeCost(site.systemId, sysId) }))
        .filter((r): r is { sysId: string; short: number; cost: number } => r.cost !== null && r.cost > 0)
        .sort((a, b) => a.cost - b.cost);
      for (const r of nearest) {
        if (producedOutput <= 0) break;
        const take = Math.min(producedOutput, r.short);
        deficitMap.set(r.sysId, r.short - take);
        producedOutput -= take;
      }
    }
  }

  return builds;
}
```

- [ ] **Step 4: Run the full engine test suite**

Run: `npx vitest run --project unit lib/engine/__tests__/directed-build.test.ts`
Expected: PASS — all `planFactionBuilds` cases plus Tasks 2–4.

- [ ] **Step 5: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "feat(build): greedy demand-pulled placement planning + co-built housing"
```

---

## What this plan deliberately defers (follow-on plans)

- **Processor body** (`runDirectedBuildProcessor`) + **World interface** + **in-memory adapter** + **simulator wiring** — mechanical mirror of directed-logistics; the next plan. Phase-1 sim validation ("build alone develops a hand-seeded world") lands there.
- **Prisma adapter** (live reads of body-derived `slotCap`/`generalSpace`/`habitableSpace`; `GREATEST()` unnest increment writes) + **registry registration** — needs a short body-capacity-read exploration first.
- **Minimal-core seeder, age-forward harness, validation pass** — design-doc Phases 2–4, separate plans.

## Self-Review

- **Spec coverage:** Implements the design's "build-up planner" core — structural-deficit signal (Task 3), capacity-aware placement score (Tasks 4–5), cascade input-gate (Task 5), staffing co-build (Task 5), per-system population-scaled budget (Task 2), shared classification reuse (Task 1). Budget/cadence constants are first-draft per the design's "simulator-calibrated" note. Processor/seeder/harness are explicitly deferred above.
- **Placeholder scan:** none — every step has complete code and exact commands.
- **Type consistency:** `BuildSystemState`/`BuildGoodState`/`PlannedBuild`/`StructuralDeficit` defined in Tasks 2–3 and consumed unchanged in 4–5; `classifyMarketState`/`MarketClassification`/`RouteCost` defined in Task 1 and imported consistently; `buildableUnits`/`buildableOutput`/`systemBuildGeneration`/`findStructuralDeficits`/`planFactionBuilds` names stable across tasks.
