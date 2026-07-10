# Colonisation Cost — PR1: Valuation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, fully unit-tested colony-valuation engine (`colonyValue` = `U + L·(σ_floor + (1−σ_floor)·σ)`) that later PRs wire into the build planner — no wiring, no behaviour change yet.

**Architecture:** One new pure engine module, `lib/engine/colonisation-value.ts`, with zero I/O. It exposes a static recipe-closure map (good → the tier-0 deposit resources it transitively needs) plus four pure functions: `factionMissingResources`, `factionSaturation`, `unblockedDemandByResource`, and `colonyValue`. Faction-level aggregates are computed from plain input types this module defines; the real-system → input-type mapping lands in PR3. Nothing imports this module in PR1 — it ships green and inert, exactly the calibration-in-isolation foundation the spec prescribes.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Pure functions only (no `fs`/`process.env`/DB). Reuses existing constants (`GOOD_RECIPES`, `BUILDING_TYPES`, `RESOURCE_TYPES`, `POP_CENTRE_DENSITY`, `housingPopCap`).

**Spec:** `docs/planned/economy-colonisation-cost.md` (§3 Valuation, the `U`/`L`/`σ` terms).

## Global Constraints

Every task's requirements implicitly include these (from `CLAUDE.md`):

- **No `as` type assertions** except `as const`. Fix types at the source, never cast at the consumer.
- **No `unknown`** anywhere. Use typed keys/unions.
- Engine functions are **pure** — no `fs`/`process.env`/DB imports. Test with Vitest.
- **`Map`/`Set` are fine in transient engine function params/returns** (they are never persisted). The JSON-serializable rule applies only to the in-memory `World` store, which this module does not touch.
- **Avoid postfix `!`** except `find(...)!` in tests (an accepted project idiom).
- Tests live in `lib/engine/__tests__/*.test.ts`; the `unit` Vitest project picks them up automatically.
- Discriminated unions use `{ ok: true; … } | { ok: false; … }` shape (not relevant in PR1, listed for continuity).

---

## PR Roadmap (context — only PR1 is executable in this document)

This feature ships as four sequential PRs on the shared `feat/economy-rework-base` branch. Each later PR gets its own plan document, written against the shipped reality of the ones before it (the project's phased-PR convention).

- **PR1 — Valuation engine (this doc).** `lib/engine/colonisation-value.ts` + tests. Pure, unwired, behaviour-neutral. Calibratable in isolation.
- **PR2 — Proposal layer + value-order funding (builds only).** Refactor the build planner's output into `Proposal = BuildProposal` (a *bundle*: production + the academies/complex that gate it, carrying `servedValue` and `totalWork`). Assemble the funding queue in descending bundle-ROI order, gate-first within each proposal; `fundQueue` stays the decision-free front-first drainer. Net behaviour: the same builds land, now ROI-ordered — a regression test asserts an academy still funds *before* the production it gates. Touches `directed-build.ts`, `construction.ts`, `processors/directed-build.ts`.
- **PR3 — Colony-establish mechanic (the second consumer).** Discriminate `WorldConstructionProject = BuildConstructionProject | ColonyEstablishProject` (colony carries `targetSystemId`, `sourceSystemId`, `seedPop`, `housingLevels`); update `lib/world/types.ts`, save/load serialization, memory adapters, and the `fundQueue` landing. Add `lib/constants/colonisation.ts` (the `COLONISATION` block) and wire it into `ColonyValueParams`. Emit `ColonyProposal` (using PR1's `colonyValue`) into PR2's pipeline; `establishWork = COLONY_ESTABLISH_WORK + housingLevels × workCostPerLevel(HOUSING_TYPE)`. Extend the develop-candidate provider (substrate + fixed `sourceSystemId` + faction aggregates) and `applyDevelopments` (land-sized seed + bundled housing). Retire `MAX_DEVELOPS_PER_PULSE` and the old free-instant develop path. Persist a colony proposal as a project only once funded.
- **PR4 — Simulator metric + calibration.** Extend `build-analysis.ts` (establish-in-flight + build-vs-colonise pool split); run the coarse, *sequenced* calibration pass (L·σ crossover first in non-resource-starved scenarios, then verify U's keystone-deposit behaviour).

---

## File Structure (PR1)

- **Create:** `lib/engine/colonisation-value.ts` — the entire valuation engine (types + `RESOURCE_CLOSURE` + `factionMissingResources` + `factionSaturation` + `unblockedDemandByResource` + `colonyValue`). One file, one responsibility: turn a colony candidate + faction state into a build-comparable value.
- **Create:** `lib/engine/__tests__/colonisation-value.test.ts` — unit tests for every export.

No other files change in PR1.

---

## Task 1: Recipe-closure map (`RESOURCE_CLOSURE`)

**Files:**
- Create: `lib/engine/colonisation-value.ts`
- Test: `lib/engine/__tests__/colonisation-value.test.ts`

**Interfaces:**
- Consumes: `GOOD_RECIPES` (`lib/constants/recipes.ts`, `Record<string, Record<string, number>>`), `GOOD_NAMES` (`lib/constants/goods.ts`, `string[]`), `BUILDING_TYPES` (`lib/constants/industry.ts`; tier-0 entries carry `resource?: ResourceType`), `ResourceType` (`lib/types/game.ts`).
- Produces: `export const RESOURCE_CLOSURE: Readonly<Record<string, readonly ResourceType[]>>` — good id → the tier-0 deposit resources it transitively needs.

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/colonisation-value.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RESOURCE_CLOSURE } from "@/lib/engine/colonisation-value";

describe("RESOURCE_CLOSURE", () => {
  it("maps a tier-0 good to its own resource", () => {
    expect([...RESOURCE_CLOSURE.ore]).toEqual(["ore"]);
    expect([...RESOURCE_CLOSURE.radioactives]).toEqual(["radioactive"]);
  });

  it("maps a tier-1 good to the union of its inputs' resources", () => {
    // alloys = metals(→ore) + minerals(→minerals)
    expect(new Set(RESOURCE_CLOSURE.alloys)).toEqual(new Set(["ore", "minerals"]));
  });

  it("traces a deep tier-2 chain down to its deposits", () => {
    // reactor_cores = radioactives(→radioactive) + alloys(→ore,minerals) + components(→minerals,ore)
    expect(new Set(RESOURCE_CLOSURE.reactor_cores)).toEqual(
      new Set(["radioactive", "ore", "minerals"]),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/colonisation-value.test.ts`
Expected: FAIL — cannot resolve `@/lib/engine/colonisation-value` (module does not exist).

- [ ] **Step 3: Create the module with `RESOURCE_CLOSURE`**

Create `lib/engine/colonisation-value.ts`:

```ts
/**
 * Pure colony valuation — the expand-vs-build ROI numerator
 * (docs/planned/economy-colonisation-cost.md §3). Zero I/O.
 *
 * A colony's value sits on the same demand-rate axis as a build's served deficit, so the planner
 * can rank "establish this colony" against "build this factory" on one pool:
 *
 *   Value(c) = U(c) + L(c) · (σ_floor + (1 − σ_floor) · σ)
 *
 * - U(c) — unblocking value: unmet demand the colony's deposits unblock, traced down each blocked
 *   good's recipe chain to the missing deposits that gate it (split fractionally across a good's
 *   gating missing deposits). Coefficient-free — already in demand-rate units.
 * - L(c) — land option value: LAND_PREMIUM·habitableSpace + small general-space + deposit-richness
 *   weights. Forward-looking; independent of any current deficit.
 * - σ — faction territory saturation in [0,1]: built housing pop-cap ÷ habitable-potential pop-cap.
 */
import type { ResourceType } from "@/lib/types/game";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { BUILDING_TYPES } from "@/lib/constants/industry";

/**
 * good id → the tier-0 deposit resources it transitively needs. A tier-0 good's closure is its own
 * single resource (`BUILDING_TYPES[good].resource`); a tier-1+ good's is the union of its recipe
 * inputs' closures. Derived once from the (acyclic) recipe graph, so runtime scoring stays cheap.
 */
export const RESOURCE_CLOSURE: Readonly<Record<string, readonly ResourceType[]>> = (() => {
  const memo = new Map<string, ReadonlySet<ResourceType>>();
  const resolve = (goodId: string): ReadonlySet<ResourceType> => {
    const cached = memo.get(goodId);
    if (cached) return cached;
    const out = new Set<ResourceType>();
    const recipe = GOOD_RECIPES[goodId];
    if (recipe) {
      for (const input of Object.keys(recipe)) for (const r of resolve(input)) out.add(r);
    } else {
      const resource = BUILDING_TYPES[goodId]?.resource;
      if (resource) out.add(resource);
    }
    memo.set(goodId, out);
    return out;
  };
  const result: Record<string, readonly ResourceType[]> = {};
  for (const good of GOOD_NAMES) result[good] = [...resolve(good)];
  return result;
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/colonisation-value.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/colonisation-value.ts lib/engine/__tests__/colonisation-value.test.ts
git commit -m "feat(colonisation): recipe-closure map for colony valuation"
```

---

## Task 2: Faction aggregates — `factionMissingResources` + `factionSaturation`

**Files:**
- Modify: `lib/engine/colonisation-value.ts`
- Test: `lib/engine/__tests__/colonisation-value.test.ts`

**Interfaces:**
- Consumes: `RESOURCE_TYPES` (`lib/engine/resources.ts`, `ResourceType[]`), `ResourceVector` (`lib/types/game.ts`, `Record<ResourceType, number>`), `housingPopCap` (`lib/engine/industry.ts`, `(buildings: Record<string, number>) => number`), `HOUSING_TYPE`, `POP_CENTRE_DENSITY`, `effectiveSpaceCost` (`lib/constants/industry.ts`), `clamp` (`lib/utils/math.ts`).
- Produces:
  - `export interface FactionSystemState { buildings: Record<string, number>; habitableSpace: number; slotCap: ResourceVector }`
  - `export function factionMissingResources(developed: FactionSystemState[]): Set<ResourceType>`
  - `export function factionSaturation(developed: FactionSystemState[]): number`

- [ ] **Step 1: Write the failing tests**

Append to `lib/engine/__tests__/colonisation-value.test.ts` (add the two new imports to the existing import from `@/lib/engine/colonisation-value`, and add the `emptyResourceVector` + `HOUSING_TYPE` imports):

```ts
import {
  RESOURCE_CLOSURE,
  factionMissingResources,
  factionSaturation,
  type FactionSystemState,
} from "@/lib/engine/colonisation-value";
import { emptyResourceVector } from "@/lib/engine/resources";
import { HOUSING_TYPE } from "@/lib/constants/industry";

function sys(over: Partial<FactionSystemState>): FactionSystemState {
  return { buildings: {}, habitableSpace: 0, slotCap: emptyResourceVector(), ...over };
}

describe("factionMissingResources", () => {
  it("returns resources with zero slotCap across developed systems", () => {
    const oreOnly = sys({ slotCap: { ...emptyResourceVector(), ore: 5 } });
    const missing = factionMissingResources([oreOnly]);
    expect(missing.has("ore")).toBe(false);
    expect(missing.has("radioactive")).toBe(true);
    expect(missing.has("gas")).toBe(true);
  });

  it("treats a resource present on ANY developed system as not missing", () => {
    const a = sys({ slotCap: { ...emptyResourceVector(), ore: 5 } });
    const b = sys({ slotCap: { ...emptyResourceVector(), gas: 3 } });
    const missing = factionMissingResources([a, b]);
    expect(missing.has("ore")).toBe(false);
    expect(missing.has("gas")).toBe(false);
    expect(missing.has("radioactive")).toBe(true);
  });
});

describe("factionSaturation", () => {
  it("is ~0 when habitable land is mostly unbuilt", () => {
    // 100 habitable / housing cost 1 → 2000 potential pop-cap; 0 housing built → σ ≈ 0
    expect(factionSaturation([sys({ habitableSpace: 100 })])).toBeCloseTo(0, 5);
  });

  it("is 1 when housing fills the habitable land", () => {
    // 100 housing × POP_CENTRE_DENSITY(20) = 2000 built = 2000 potential → σ = 1
    expect(
      factionSaturation([sys({ habitableSpace: 100, buildings: { [HOUSING_TYPE]: 100 } })]),
    ).toBeCloseTo(1, 5);
  });

  it("treats zero habitable potential as fully saturated", () => {
    expect(factionSaturation([sys({ habitableSpace: 0 })])).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/colonisation-value.test.ts`
Expected: FAIL — `factionMissingResources`/`factionSaturation`/`FactionSystemState` not exported.

- [ ] **Step 3: Add the aggregates to the module**

Add these imports to the top of `lib/engine/colonisation-value.ts` (extend the `ResourceType` type import to also import `ResourceVector`, and add the four new imports):

```ts
import type { ResourceType, ResourceVector } from "@/lib/types/game";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { housingPopCap } from "@/lib/engine/industry";
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  POP_CENTRE_DENSITY,
  effectiveSpaceCost,
} from "@/lib/constants/industry";
import { clamp } from "@/lib/utils/math";
```

(The existing `import { BUILDING_TYPES } from "@/lib/constants/industry";` from Task 1 is replaced by the grouped import above — do not leave a duplicate `BUILDING_TYPES` import.)

Append below `RESOURCE_CLOSURE`:

```ts
/** A developed system's state needed for the faction-level aggregates (σ, missing resources). */
export interface FactionSystemState {
  buildings: Record<string, number>;
  habitableSpace: number;
  slotCap: ResourceVector;
}

/**
 * Resources the faction has NO deposit slots for across its developed systems — the binary
 * "can't make it at all" set. A colony supplying one of these unblocks the goods that need it.
 */
export function factionMissingResources(developed: FactionSystemState[]): Set<ResourceType> {
  const missing = new Set<ResourceType>(RESOURCE_TYPES);
  for (const s of developed) {
    for (const r of RESOURCE_TYPES) if (s.slotCap[r] > 0) missing.delete(r);
  }
  return missing;
}

/**
 * Faction territory saturation σ ∈ [0,1]: built housing pop-cap ÷ habitable-potential pop-cap
 * across developed systems. Low when there is lots of unbuilt habitable land; 1 when built out.
 * Zero potential (no habitable land) reads as fully saturated (1) — there is no room to fill.
 */
export function factionSaturation(developed: FactionSystemState[]): number {
  const housingCost = effectiveSpaceCost(HOUSING_TYPE);
  let built = 0;
  let potential = 0;
  for (const s of developed) {
    built += housingPopCap(s.buildings);
    if (housingCost > 0) {
      potential += (Math.max(0, s.habitableSpace) / housingCost) * POP_CENTRE_DENSITY;
    }
  }
  if (potential <= 0) return 1;
  return clamp(built / potential, 0, 1);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/colonisation-value.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/colonisation-value.ts lib/engine/__tests__/colonisation-value.test.ts
git commit -m "feat(colonisation): faction missing-resources + saturation aggregates"
```

---

## Task 3: Fractional demand attribution — `unblockedDemandByResource`

**Files:**
- Modify: `lib/engine/colonisation-value.ts`
- Test: `lib/engine/__tests__/colonisation-value.test.ts`

**Interfaces:**
- Consumes: `RESOURCE_CLOSURE` (Task 1), `ResourceType`.
- Produces:
  - `export interface GoodDeficit { goodId: string; rateDeficit: number }`
  - `export function unblockedDemandByResource(deficits: GoodDeficit[], missing: ReadonlySet<ResourceType>): Map<ResourceType, number>`

- [ ] **Step 1: Write the failing tests**

Add `unblockedDemandByResource` and `type GoodDeficit` to the existing import from `@/lib/engine/colonisation-value`, add a `ResourceType` type import, and append:

```ts
import type { ResourceType } from "@/lib/types/game";

describe("unblockedDemandByResource", () => {
  it("attributes a blocked good's deficit to its single missing gating resource", () => {
    // metals needs ore; ore missing → ore gets the full deficit
    const m = unblockedDemandByResource(
      [{ goodId: "metals", rateDeficit: 10 }],
      new Set<ResourceType>(["ore"]),
    );
    expect(m.get("ore")).toBeCloseTo(10, 5);
  });

  it("splits a deficit equally across two missing gating resources", () => {
    // alloys → {ore, minerals}; both missing → 5 each
    const m = unblockedDemandByResource(
      [{ goodId: "alloys", rateDeficit: 10 }],
      new Set<ResourceType>(["ore", "minerals"]),
    );
    expect(m.get("ore")).toBeCloseTo(5, 5);
    expect(m.get("minerals")).toBeCloseTo(5, 5);
  });

  it("ignores a good whose gating resources the faction already has", () => {
    // metals needs ore; nothing missing → no attribution
    const m = unblockedDemandByResource([{ goodId: "metals", rateDeficit: 10 }], new Set());
    expect(m.size).toBe(0);
  });

  it("ignores non-positive deficits", () => {
    const m = unblockedDemandByResource(
      [{ goodId: "metals", rateDeficit: 0 }],
      new Set<ResourceType>(["ore"]),
    );
    expect(m.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/colonisation-value.test.ts`
Expected: FAIL — `unblockedDemandByResource`/`GoodDeficit` not exported.

- [ ] **Step 3: Add the attribution function**

Append to `lib/engine/colonisation-value.ts`:

```ts
/** One good the faction under-produces (demand > production) — a structural rate deficit. */
export interface GoodDeficit {
  goodId: string;
  rateDeficit: number;
}

/**
 * Unmet demand attributable to each missing resource, split fractionally: a good's rate deficit is
 * divided equally across the missing resources that gate it (the ones in its recipe closure the
 * faction lacks). A good with no gating missing resource contributes nothing; a good gated by two
 * missing resources gives half its deficit to each — so a colony supplying both scores the whole,
 * one supplying either scores half, with no double-count.
 */
export function unblockedDemandByResource(
  deficits: GoodDeficit[],
  missing: ReadonlySet<ResourceType>,
): Map<ResourceType, number> {
  const out = new Map<ResourceType, number>();
  for (const d of deficits) {
    if (d.rateDeficit <= 0) continue;
    const gating = (RESOURCE_CLOSURE[d.goodId] ?? []).filter((r) => missing.has(r));
    if (gating.length === 0) continue;
    const share = d.rateDeficit / gating.length;
    for (const r of gating) out.set(r, (out.get(r) ?? 0) + share);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/colonisation-value.test.ts`
Expected: PASS (all tests so far).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/colonisation-value.ts lib/engine/__tests__/colonisation-value.test.ts
git commit -m "feat(colonisation): fractional unmet-demand attribution by missing resource"
```

---

## Task 4: The valuation — `colonyValue`

**Files:**
- Modify: `lib/engine/colonisation-value.ts`
- Test: `lib/engine/__tests__/colonisation-value.test.ts`

**Interfaces:**
- Consumes: `RESOURCE_TYPES`, `ResourceVector`, `ResourceType`, `clamp`.
- Produces:
  - `export interface ColonyCandidate { habitableSpace: number; generalSpace: number; slotCap: ResourceVector }`
  - `export interface ColonyValueParams { landPremium: number; landGeneralWeight: number; landDepositWeight: number; sigmaFloor: number }`
  - `export function colonyValue(candidate: ColonyCandidate, unblockedByResource: ReadonlyMap<ResourceType, number>, saturation: number, params: ColonyValueParams): number`

- [ ] **Step 1: Write the failing tests**

Add `colonyValue`, `type ColonyCandidate`, and `type ColonyValueParams` to the existing import from `@/lib/engine/colonisation-value`, then append:

```ts
const PARAMS: ColonyValueParams = {
  landPremium: 0.4,
  landGeneralWeight: 0.1,
  landDepositWeight: 0.15,
  sigmaFloor: 0.25,
};

function candidate(over: Partial<ColonyCandidate>): ColonyCandidate {
  return { habitableSpace: 0, generalSpace: 0, slotCap: emptyResourceVector(), ...over };
}

describe("colonyValue", () => {
  it("credits U for a missing resource the candidate supplies, even at σ=0", () => {
    const unblocked = new Map<ResourceType, number>([["radioactive", 12]]);
    const c = candidate({ slotCap: { ...emptyResourceVector(), radioactive: 3 } });
    // U = 12; L = landDepositWeight(0.15) × depositRichness(3) = 0.45; landGate at σ=0 = sigmaFloor 0.25
    const v = colonyValue(c, unblocked, 0, PARAMS);
    expect(v).toBeCloseTo(12 + 0.45 * 0.25, 5);
    expect(v).toBeGreaterThan(0);
  });

  it("scales generic land value up with saturation via the σ_floor blend", () => {
    const c = candidate({ habitableSpace: 100 }); // L = 0.4 × 100 = 40
    const atLow = colonyValue(c, new Map(), 0, PARAMS); // landGate 0.25 → 10
    const atHigh = colonyValue(c, new Map(), 1, PARAMS); // landGate 1 → 40
    expect(atLow).toBeCloseTo(10, 5);
    expect(atHigh).toBeCloseTo(40, 5);
    expect(atHigh).toBeGreaterThan(atLow);
  });

  it("σ_floor=0 makes generic land worthless until saturated; σ_floor=1 values it fully", () => {
    const c = candidate({ habitableSpace: 100 });
    const tall = colonyValue(c, new Map(), 0, { ...PARAMS, sigmaFloor: 0 });
    const rush = colonyValue(c, new Map(), 0, { ...PARAMS, sigmaFloor: 1 });
    expect(tall).toBeCloseTo(0, 5);
    expect(rush).toBeCloseTo(40, 5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/colonisation-value.test.ts`
Expected: FAIL — `colonyValue`/`ColonyCandidate`/`ColonyValueParams` not exported.

- [ ] **Step 3: Add `colonyValue` and its types**

Append to `lib/engine/colonisation-value.ts`:

```ts
/** A colony candidate's substrate — the physical inputs to its valuation. */
export interface ColonyCandidate {
  habitableSpace: number;
  generalSpace: number;
  slotCap: ResourceVector;
}

/** Tunable colony-valuation coefficients (global defaults now; per-doctrine later). */
export interface ColonyValueParams {
  landPremium: number;
  landGeneralWeight: number;
  landDepositWeight: number;
  sigmaFloor: number;
}

/** Σ of a candidate's deposit slots across all resources — its "deposit richness". */
function depositRichness(slotCap: ResourceVector): number {
  let total = 0;
  for (const r of RESOURCE_TYPES) total += Math.max(0, slotCap[r]);
  return total;
}

/**
 * Colony value on the build-comparable demand-rate axis: U(c) + L(c)·(σ_floor + (1−σ_floor)·σ).
 * `unblockedByResource` and `saturation` are the faction-level aggregates (computed once per pulse
 * by the caller); `candidate` is the controlled system being scored. `U` is coefficient-free (it is
 * already unmet demand); `L` carries the land coefficients; `σ` gates how much of `L` is live.
 */
export function colonyValue(
  candidate: ColonyCandidate,
  unblockedByResource: ReadonlyMap<ResourceType, number>,
  saturation: number,
  params: ColonyValueParams,
): number {
  // U: unmet demand of every missing resource this candidate supplies (has any deposit slot for).
  let u = 0;
  for (const r of RESOURCE_TYPES) {
    if (candidate.slotCap[r] > 0) u += unblockedByResource.get(r) ?? 0;
  }
  // L: land option value — habitable space plus small general-space and deposit-richness weights.
  const l =
    params.landPremium * Math.max(0, candidate.habitableSpace) +
    params.landGeneralWeight * Math.max(0, candidate.generalSpace) +
    params.landDepositWeight * depositRichness(candidate.slotCap);
  const sigma = clamp(saturation, 0, 1);
  const landGate = params.sigmaFloor + (1 - params.sigmaFloor) * sigma;
  return u + l * landGate;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/colonisation-value.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/colonisation-value.ts lib/engine/__tests__/colonisation-value.test.ts
git commit -m "feat(colonisation): colonyValue — U + land-option-value on the build-comparable axis"
```

---

## Task 5: PR verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run`
Expected: PASS — the whole suite green (colonisation-value tests added; nothing else touched, so no regressions).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build gate**

Run: `npx next build --webpack`
Expected: build succeeds (the PR-gate build per `CLAUDE.md`).

- [ ] **Step 4: Confirm the module is inert**

Run: `git grep -n "colonisation-value" -- lib app`
Expected: only `lib/engine/colonisation-value.ts` and its test reference it — no production caller yet (PR1 is behaviour-neutral by design; wiring lands in PR2/PR3).

---

## Self-Review

**1. Spec coverage (PR1 scope = §3 valuation primitives):**
- `U(c)` recipe-chain + fractional attribution → `RESOURCE_CLOSURE` (Task 1) + `unblockedDemandByResource` (Task 3) + the `U` loop in `colonyValue` (Task 4). ✓
- Missing-resource gate ("zero deposit slots") → `factionMissingResources` (Task 2). ✓
- `L(c)` land option value (habitable + general + deposit richness) → `colonyValue` (Task 4). ✓
- `σ` saturation (built housing pop-cap ÷ habitable potential) → `factionSaturation` (Task 2). ✓
- `σ_floor` blend and the coefficient-free `U` → `colonyValue` + its tests (Task 4). ✓
- **Deferred to later PRs (correctly out of PR1 scope):** `establishWork`/`COLONISATION` constants, the discriminated project type, the proposal/value-order funding, `applyDevelopments` extension, retiring `MAX_DEVELOPS_PER_PULSE`, the simulator metric. Each is named in the PR Roadmap.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above" — every step has concrete code or an exact command. ✓

**3. Type consistency:** `FactionSystemState` (Task 2) is consumed by both aggregates; `ColonyCandidate`/`ColonyValueParams`/`GoodDeficit` names are used identically in their producing task and tests; `RESOURCE_CLOSURE`'s `Readonly<Record<string, readonly ResourceType[]>>` type is consumed by `unblockedDemandByResource` via `.filter` (allowed on a readonly array). The Task 2 import step explicitly replaces (not duplicates) the Task 1 `BUILDING_TYPES` import. ✓

**4. Ambiguity check:** `factionMissingResources` operates on *developed* systems only (the caller filters — documented in the JSDoc and the roadmap's PR3 note that the provider passes developed systems); the candidate being scored is a *controlled* system whose own deposits are therefore not counted as "present", which is what lets it score `U`. Made explicit in the module header and PR3 roadmap.
