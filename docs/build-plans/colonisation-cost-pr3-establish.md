# Colonisation Cost — PR3: Colony-Establish Mechanic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free/instant `controlled → developed` flip with a **pool-funded, timed colony-establish project** that competes with builds on ROI in the one funding queue, and lands a **viable-by-construction** colony (land-sized seed pop + bundled housing, so `popCap ≥ seedPop` on arrival).

**Architecture:** Colony establishment becomes the second consumer of PR2's decision → gate → pace pipeline.
1. `WorldConstructionProject` becomes a discriminated union `WorldBuildProject | WorldColonyEstablishProject` — one queue, funded by one `fundQueue`, so build-vs-colonise arbitrates on one pool.
2. `directed-build.ts` (the decision unit) gains `ColonyProposal` + `planFactionColonyProposals`, scoring each controlled candidate with PR1's `colonyValue`. Colony proposals interleave with build bundles by ROI in `orderProposals`.
3. The processor expands a funded colony proposal into a colony-establish project; on **completion** it emits a develop + land-sized-seed + bundled-housing mutation via `applyDevelopments`. The old instant develop phase and `MAX_DEVELOPS_PER_PULSE` are retired — only the pool paces develop.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Pure engine functions (no `fs`/`process.env`/DB). Reuses PR1's `lib/engine/colonisation-value.ts` (`colonyValue`, `factionSaturation`, `factionMissingResources`, `unblockedDemandByResource`), PR2's `Proposal`/`orderProposals`/`fundQueue`, and `workCostPerLevel`.

**Spec:** `docs/planned/economy-colonisation-cost.md` (the whole document; §1 funded develop, §2 viable-by-construction, §3 valuation, §4 value-order funding, Colony lifecycle, Architecture, Testing strategy). Builds on shipped PR1 (`colonisation-value.ts`) and PR2 (`Proposal`/`orderProposals`/`fundQueue` value-order funding).

## Global Constraints

Every task's requirements implicitly include these (from `CLAUDE.md`):

- **No `as` type assertions** except `as const` and runtime type guards in `lib/types/guards.ts`. Fix types at the source, never cast at the consumer. (User-defined type-guard predicates — `(p): p is WorldColonyEstablishProject => …` — are the sanctioned narrowing and are used here.)
- **No `unknown`** anywhere. Use typed keys/unions. **Discriminated unions** carry a `kind` string tag (`kind: "build"` / `kind: "colony_establish"`), never a `boolean` flag with optional fields.
- Engine functions are **pure** — no `fs`/`process.env`/DB imports. Test with Vitest.
- **`Map`/`Set` are fine in transient engine params/returns** (never persisted). The JSON-serializable rule applies only to the `World` store: **no `Infinity`/`NaN`, no `Map`/`Set`/`Date`/class instances** may reach `World` state. Only finite `WorldConstructionProject` rows (both variants) are persisted; the colony-valuation `Map`/`Set` aggregates stay ephemeral at the engine boundary.
- **Avoid postfix `!`** except `find(...)!` in tests (an accepted project idiom).
- **Never `.sort()` an input array in place** — sort a copy (`[...arr].sort(...)`).
- **Determinism:** no `Date.now`/`Math.random`/`new Date()` in any processor/engine body. Colony scoring/sizing is pure arithmetic; claim resolution keeps its existing seeded RNG.
- Tests live beside their module in `__tests__/*.test.ts`; the `unit` Vitest project picks them up automatically.
- The **build decision logic is unchanged** — the settle gate, labour gate, capacity math, academy/complex lift, in-flight subtraction, and the `planFactionBundles`/`planFactionProposals`/`planFactionBuilds` bodies are byte-for-byte the same. This PR only *adds* the colony proposer alongside them and reshapes the persisted project type.

---

## PR Roadmap (context — only PR3 is executable in this document)

Four sequential PRs on the shared `feat/economy-rework-base` branch.

- **PR1 — Valuation engine (shipped, `a672da8`).** `lib/engine/colonisation-value.ts` + tests. Pure, unwired.
- **PR2 — Proposal layer + value-order funding, builds only (shipped, `74249a6`).** `Proposal = BuildProposal` bundles; funding queue in descending bundle-ROI order; `fundQueue` the front-first drainer.
- **PR3 — Colony-establish mechanic (this doc).** Discriminate `WorldConstructionProject`; add `ColonyProposal` to the `Proposal` union (using PR1's `colonyValue`); emit it into PR2's pipeline (interleaving by ROI among the build bundles); retire `MAX_DEVELOPS_PER_PULSE` + the instant develop phase; extend `applyDevelopments` (land-sized seed + bundled housing + on-arrival `popCap`). Add `lib/constants/colonisation.ts`.
- **PR4 — Simulator metric + sequenced calibration.** Extend `build-analysis.ts` to report establish-projects-in-flight + build-vs-colonise pool split; run the coarse `L·σ`-first calibration pass to tune `COLONISATION.*`.

**PR3 explicitly does NOT:** extend the simulator's colonisation *metric* to report colony-establish projects (PR3 only guards `build-analysis.ts` so it doesn't NaN on the new project shape — the reporting is PR4), tune the `COLONISATION` coefficients to a target (first-cut values only; PR4 calibrates), or add doctrine per-faction overrides (Deferred).

---

## File Structure (PR3)

**Create:**
- `lib/constants/colonisation.ts` — `COLONISATION` block (`COLONY_ESTABLISH_WORK`, `LAND_PREMIUM`, `LAND_GENERAL_WEIGHT`, `LAND_DEPOSIT_WEIGHT`, `SIGMA_FLOOR`). First-cut; PR4 calibrates.
- `lib/constants/__tests__/colonisation.test.ts` — sane-value coverage.

**Modify (engine / world):**
- `lib/world/types.ts` — `WorldConstructionProject` → `WorldBuildProject | WorldColonyEstablishProject` (discriminated).
- `lib/world/save.ts` — bump `SAVE_FORMAT_VERSION` 4 → 5.
- `lib/engine/construction.ts` — `fundQueue` returns completed **rows** (`landed: WorldConstructionProject[]`, `LandedLevel` retired); `orderProposals` tiebreak made union-safe.
- `lib/engine/directed-build.ts` — `ColonyProposal`, `ColonyEstablishCandidate`, `ColonyEstablishParams`, `planFactionColonyProposals`, `factionGoodDeficits`; widen `Proposal`.
- `lib/engine/expansion.ts` — retire `planFactionDevelopments`, `DevelopCandidate`, `DevelopParams`, `FactionDevelopment` (the instant-develop ranker; claim tier unchanged).
- `lib/engine/simulator/build-analysis.ts` — guard the queue loop to build projects (colony-establish reporting is PR4).
- `lib/constants/expansion.ts` — remove `MAX_DEVELOPS_PER_PULSE`.

**Modify (tick / adapter):**
- `lib/tick/world/directed-build-world.ts` — `SystemDevelopment` gains `housingLevels`.
- `lib/tick/processors/directed-build.ts` — remove the instant develop phase; build + colony proposals → `orderProposals` → expand (discriminated) → `fundQueue`; persist-if-funded for colonies; landing → `applyDevelopments`.
- `lib/world/tick.ts` — `applyDevelopments` places bundled housing + on-arrival `popCap`; `developProvider` returns `ColonyEstablishCandidate[]`; pass `ColonyEstablishParams`; drop `MAX_DEVELOPS_PER_PULSE`.

**Modify (tests):**
- `lib/engine/__tests__/construction.test.ts`, `lib/engine/__tests__/directed-build.test.ts`, `lib/tick/processors/__tests__/directed-build.test.ts`, `lib/engine/simulator/__tests__/build-analysis.test.ts`, `lib/world/__tests__/save.test.ts` — add `kind: "build"` to project literals; update `landed`/version assertions; add colony coverage.
- `lib/constants/__tests__/expansion.test.ts` — drop the `MAX_DEVELOPS_PER_PULSE` assertion.
- `lib/engine/__tests__/expansion.test.ts` — drop the retired develop-ranker suite.
- `lib/world/__tests__/apply-developments.test.ts` — add `housingLevels` + viability (`popCap ≥ seedPop`) coverage.
- `lib/world/__tests__/tick-expansion.test.ts` — the "a colony develops within 4 months" assertion becomes a paced-expansion assertion (establishment is now timed/saturation-gated).

No files are deleted.

---

## Task 1: Colonisation constants (`lib/constants/colonisation.ts`)

Add the establish-cost / land-value / saturation-floor knobs. Additive — nothing consumes them until Task 4, so this task is `tsc`-green on its own.

**Files:**
- Create: `lib/constants/colonisation.ts`
- Test: `lib/constants/__tests__/colonisation.test.ts`

**Interfaces:**
- Consumes: nothing (leaf constants module).
- Produces:
  - `export const COLONISATION = { COLONY_ESTABLISH_WORK, LAND_PREMIUM, LAND_GENERAL_WEIGHT, LAND_DEPOSIT_WEIGHT, SIGMA_FLOOR } as const` — all `number`.

- [ ] **Step 1: Write the failing test**

Create `lib/constants/__tests__/colonisation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COLONISATION } from "@/lib/constants/colonisation";

describe("COLONISATION constants", () => {
  it("prices an establish project as positive work (the base settle cost)", () => {
    expect(COLONISATION.COLONY_ESTABLISH_WORK).toBeGreaterThan(0);
  });

  it("carries positive land-value weights (habitable dominates the secondary terms)", () => {
    expect(COLONISATION.LAND_PREMIUM).toBeGreaterThan(0);
    expect(COLONISATION.LAND_GENERAL_WEIGHT).toBeGreaterThanOrEqual(0);
    expect(COLONISATION.LAND_DEPOSIT_WEIGHT).toBeGreaterThanOrEqual(0);
    // Habitable land is the binding long-run constraint — it should out-weigh a unit of general space.
    expect(COLONISATION.LAND_PREMIUM).toBeGreaterThan(COLONISATION.LAND_GENERAL_WEIGHT);
  });

  it("keeps the σ-floor a valid gate fraction in [0, 1]", () => {
    expect(COLONISATION.SIGMA_FLOOR).toBeGreaterThanOrEqual(0);
    expect(COLONISATION.SIGMA_FLOOR).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/constants/__tests__/colonisation.test.ts`
Expected: FAIL — `@/lib/constants/colonisation` does not exist (import/compile error).

- [ ] **Step 3: Create the constants module**

Create `lib/constants/colonisation.ts`:

```ts
/**
 * Colonisation-cost tuning — the establish/land/saturation knobs of the pool-funded expansion model
 * (docs/planned/economy-colonisation-cost.md §1–§3). First-cut, coarse values: only the relative shape
 * matters here (home-first while there is cheap building; expansion accelerating as habitable territory
 * fills). PR4 calibrates the magnitudes in the sequenced `L·σ`-first pass. Each is a tunable *input* with
 * a clear meaning — a per-doctrine lookup feeds them later; the valuation formula never changes.
 */
export const COLONISATION = {
  /**
   * Base settle work for a colony-establish project, BEFORE the bundled seed-housing's build cost is
   * added on top (establishWork = COLONY_ESTABLISH_WORK + housingLevels × housing level-work). The
   * establish cost is paid in the currency of forgone building and spreads over pulses — that spread
   * IS the establish time. A temporary construction stand-in until a treasury prices expansion.
   */
  COLONY_ESTABLISH_WORK: 60,
  /** Value of one unit of habitable land — new habitable land → future pop → future economy. */
  LAND_PREMIUM: 3.0,
  /** Small secondary weight on fungible general space (factories, not pop). */
  LAND_GENERAL_WEIGHT: 0.5,
  /** Small secondary weight on deposit richness (Σ deposit slots). */
  LAND_DEPOSIT_WEIGHT: 4.0,
  /**
   * Share of the land value that stays live BEFORE saturation — the land-grab instinct. 0 = expand only
   * when saturated (tall/builder); →1 = grab land regardless of home state (expansionist). The primary
   * "expansionist vs not" dial (doctrine feeds it later).
   */
  SIGMA_FLOOR: 0.25,
} as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/constants/__tests__/colonisation.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (purely additive).

- [ ] **Step 6: Commit**

```bash
git add lib/constants/colonisation.ts lib/constants/__tests__/colonisation.test.ts
git commit -m "feat(colonisation): establish-cost + land-value tuning constants"
```

---

## Task 2: Discriminate `WorldConstructionProject` (build-only, green)

Split the project row into `WorldBuildProject | WorldColonyEstablishProject`, bump the save version, make `fundQueue` return completed **rows** (so a colony landing can carry its establish payload later), and add `kind: "build"` to every build-project literal. The colony variant is *defined* but *unused* — every existing behaviour is preserved, the suite stays green, `tsc` stays green.

**Files:**
- Modify: `lib/world/types.ts`, `lib/world/save.ts`, `lib/engine/construction.ts`, `lib/tick/processors/directed-build.ts`, `lib/engine/simulator/build-analysis.ts`
- Test: `lib/engine/__tests__/construction.test.ts`, `lib/engine/__tests__/directed-build.test.ts`, `lib/tick/processors/__tests__/directed-build.test.ts`, `lib/engine/simulator/__tests__/build-analysis.test.ts`, `lib/world/__tests__/save.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export interface WorldBuildProject { kind: "build"; id; factionId; systemId; buildingType; levels; workTotal; workDone }`
  - `export interface WorldColonyEstablishProject { kind: "colony_establish"; id; factionId; systemId; sourceSystemId; seedPop; housingLevels; workTotal; workDone }`
  - `export type WorldConstructionProject = WorldBuildProject | WorldColonyEstablishProject`
  - `fundQueue(...)` unchanged signature; `FundQueueResult.landed` is now `WorldConstructionProject[]` (completed rows). `LandedLevel` **removed**.
  - `SAVE_FORMAT_VERSION = 5`.

- [ ] **Step 1: Update the save round-trip + version tests**

In `lib/world/__tests__/save.test.ts`, change the version-assertion test (lines ~60-62) and the prior-version-rejection test (lines ~64-68), and add `kind: "build"` to the construction-project literal (lines ~73-83):

Replace:
```ts
  it("is at save format version 4 (construction projects + idleMonths)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(4);
  });

  it("rejects a prior-version (v3) save — saves break on the shape bump", () => {
    const json = JSON.stringify({ formatVersion: 3, world });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });
```
with:
```ts
  it("is at save format version 5 (discriminated construction projects)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(5);
  });

  it("rejects a prior-version (v4) save — saves break on the shape bump", () => {
    const json = JSON.stringify({ formatVersion: 4, world });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });
```

In the "round-trips construction projects" test, add `kind: "build"` to the project literal:
```ts
      constructionProjects: [
        {
          kind: "build",
          id: "proj-1",
          factionId: world.factions[0].id,
          systemId: world.systems[0].id,
          buildingType: "housing",
          levels: 2,
          workTotal: 30,
          workDone: 12,
        },
      ],
```

- [ ] **Step 2: Run the save tests to verify they fail**

Run: `npx vitest run lib/world/__tests__/save.test.ts`
Expected: FAIL — `SAVE_FORMAT_VERSION` is still 4, and `{ kind: "build", … }` is not assignable to the current (non-discriminated) `WorldConstructionProject` type (compile error).

- [ ] **Step 3: Discriminate the project type in `lib/world/types.ts`**

Replace the whole `WorldConstructionProject` interface (the JSDoc + interface, lines ~144-161) with:

```ts
/** Fields every committed construction project shares — funded by `factionId`'s per-pulse pool. */
interface WorldConstructionProjectBase {
  id: string;
  factionId: string;
  systemId: string;
  /** Total construction work to complete. */
  workTotal: number;
  /** Construction points accumulated so far, in [0, workTotal]. */
  workDone: number;
}

/**
 * A queued order to build `levels` whole levels of `buildingType` at `systemId`. Contributes zero
 * capacity until `workDone` reaches `workTotal`, then lands all `levels` at once. Duration is emergent
 * (work ÷ funded points), never a stored timer.
 */
export interface WorldBuildProject extends WorldConstructionProjectBase {
  kind: "build";
  buildingType: string;
  /** Whole levels this project lands on completion (integer ≥ 1). */
  levels: number;
}

/**
 * A queued order to establish a colony at controlled `systemId` (docs/planned/economy-colonisation-cost.md
 * §1-2). On completion the system flips `developed`, receives the conserved `seedPop` transferred from
 * `sourceSystemId` (capped at apply time by the source's population), and lands `housingLevels` of housing
 * bundled with it — so `popCap ≥ seedPop` on arrival (viable by construction). `seedPop`/`housingLevels`
 * are fixed at proposal time (sized to the colony's habitable land) and never recomputed.
 */
export interface WorldColonyEstablishProject extends WorldConstructionProjectBase {
  kind: "colony_establish";
  /** Nearest developed same-faction system the seed population transfers from (fixed for the project's life). */
  sourceSystemId: string;
  /** Conserved starter population, sized at proposal to the whole-level habitable cap. */
  seedPop: number;
  /** Housing levels placed with the colony (houses the seed pop; land-bounded). */
  housingLevels: number;
}

/**
 * One committed construction project. A discriminated union: ordinary `build` levels, or a
 * `colony_establish` that lands a viable colony. Both are funded from the same per-faction throughput
 * pool by the same `fundQueue`, so build-vs-colonise arbitrates on one budget.
 */
export type WorldConstructionProject = WorldBuildProject | WorldColonyEstablishProject;
```

- [ ] **Step 4: Bump the save version in `lib/world/save.ts`**

Change the version constant (line 16):
```ts
export const SAVE_FORMAT_VERSION = 5;
```

- [ ] **Step 5: Make `fundQueue` return completed rows in `lib/engine/construction.ts`**

Remove the `LandedLevel` interface (lines ~31-36) and change `FundQueueResult.landed` to a row list. Replace the `LandedLevel` interface + `FundQueueResult` interface with:

```ts
export interface FundQueueResult {
  /** Still-open projects with advanced workDone (landed projects removed). Same order as the input. */
  projects: WorldConstructionProject[];
  /**
   * Projects that COMPLETED this pulse (workDone reached workTotal), in the order they landed — full
   * discriminated rows, so the caller applies each by its `kind` (a build increments counts; a
   * colony-establish develops + seeds + houses). fundQueue stays decision-free: it moves rows between
   * open and landed by work alone, never interpreting the kind.
   */
  landed: WorldConstructionProject[];
}
```

In the `fundQueue` body, change the two `push` sites (lines ~75-79) so both branches emit the updated row:

```ts
    if (workDone >= p.workTotal) {
      landed.push({ ...p, workDone });
    } else {
      open.push({ ...p, workDone });
    }
```

and change the `landed` accumulator declaration (line ~67) from `const landed: LandedLevel[] = [];` to:
```ts
  const landed: WorldConstructionProject[] = [];
```

- [ ] **Step 6: Update the `construction.test.ts` project literals + `landed` assertions**

In `lib/engine/__tests__/construction.test.ts`, add `kind: "build"` to the `project()` helper (lines ~9-17):
```ts
function project(
  id: string,
  buildingType: string,
  levels: number,
  workDone = 0,
  workTotal = levels * workCostPerLevel(buildingType),
): WorldConstructionProject {
  return { kind: "build", id, factionId: "f1", systemId: "s1", buildingType, levels, workTotal, workDone };
}
```

`fundQueue` now returns full rows, so the two `landed`-shape assertions change from object-equality to identity checks. Replace line ~65:
```ts
    expect(r.projects).toHaveLength(0);
    expect(r.landed).toHaveLength(1);
    expect(r.landed[0].id).toBe("p");
```
(delete the old `expect(r.landed).toEqual([{ systemId: "s1", buildingType: HOUSING_TYPE, levels: 3 }]);`).

Replace line ~86 similarly:
```ts
    expect(r.landed).toHaveLength(1);
    expect(r.landed[0].id).toBe("p1");
```
(delete `expect(r.landed).toEqual([{ systemId: "s1", buildingType: HOUSING_TYPE, levels: 1 }]);`). The surrounding `expect(r.projects)` assertions in that test are unchanged.

- [ ] **Step 7: Add `kind: "build"` to the remaining build-project literals**

`lib/engine/__tests__/directed-build.test.ts` (the in-flight-subtraction test, line ~966):
```ts
      { kind: "build", id: "h", factionId: "f1", systemId: "X", buildingType: HOUSING_TYPE, levels: 10, workTotal: 80, workDone: 0 },
```

`lib/tick/processors/__tests__/directed-build.test.ts` — two `existing` literals (the "funds existing open projects" test ~line 84 and the "keeps in-flight projects" test ~line 176):
```ts
      id: "e", kind: "build", factionId: "f1", systemId: "B", buildingType: "housing", levels: 2, workTotal: 16, workDone: 0,
```
```ts
      id: "e", kind: "build", factionId: "f1", systemId: "B", buildingType: "food", levels: 2, workTotal: 24, workDone: 0,
```

`lib/engine/simulator/__tests__/build-analysis.test.ts` — the `project()` helper (line ~48):
```ts
  return { kind: "build", id: `${systemId}:${buildingType}`, factionId: "f1", systemId, buildingType, levels, workTotal, workDone };
```

- [ ] **Step 8: Add `kind: "build"` to the processor's minted project**

In `lib/tick/processors/directed-build.ts`, the `newProjects.push({ … })` in the per-faction funding loop (lines ~162-170) gains `kind: "build"`:

```ts
        newProjects.push({
          kind: "build",
          id: params.construction.mintId(),
          factionId: p.factionId,
          systemId: p.systemId,
          buildingType: item.buildingType,
          levels: item.levels,
          workTotal: item.levels * workCostPerLevel(item.buildingType),
          workDone: 0,
        });
```

- [ ] **Step 9: Narrow the processor's landed loop to build rows**

`fundQueue.landed` is now full rows. In the same processor file, the landed loop (lines ~177-181) narrows by kind (the colony branch is added in Task 4):

```ts
    for (const l of landed) {
      if (l.kind !== "build") continue; // colony-establish landings handled in Task 4
      const byType = landedBySystem.get(l.systemId) ?? new Map<string, number>();
      byType.set(l.buildingType, (byType.get(l.buildingType) ?? 0) + l.levels);
      landedBySystem.set(l.systemId, byType);
    }
```

- [ ] **Step 10: Guard `build-analysis.ts` against the new project shape**

The queue loop reads build-only fields (`buildingType`, `levels`), so it must narrow. In `lib/engine/simulator/build-analysis.ts`, add a guard at the top of the `for (const p of projects)` loop (line ~129):

```ts
  for (const p of projects) {
    if (p.kind !== "build") continue; // colony-establish reporting lands in PR4
    const isHome = homeworldSet.has(p.systemId);
```

- [ ] **Step 11: Add a build-analysis regression that colony projects don't corrupt the queue split**

Append to the `describe("summarizeColonisation — construction queue split", …)` block in `lib/engine/simulator/__tests__/build-analysis.test.ts`:

```ts
  it("excludes colony-establish projects from the queue split (reported in PR4, no NaN)", () => {
    const colony: WorldConstructionProject = {
      kind: "colony_establish", id: "c1:establish", factionId: "f1", systemId: "c1",
      sourceSystemId: "hw", seedPop: 50, housingLevels: 3, workTotal: 84, workDone: 40,
    };
    const summary = summarizeColonisation([], new Set(["hw"]), [
      project("hw", "ore", { levels: 4, workTotal: 100, workDone: 50 }),
      colony,
    ]);
    // Only the build project is counted; the colony-establish is skipped (no undefined buildingType/levels).
    expect(summary.queue.homeworldProjects).toBe(1);
    expect(summary.queue.colonyProjects).toBe(0);
    expect(summary.queue.colonyLevels).toBe(0);
    expect(Number.isNaN(summary.queue.colonyMeanProgress)).toBe(false);
  });
```

- [ ] **Step 12: Run the touched suites to verify they pass**

Run: `npx vitest run lib/world/__tests__/save.test.ts lib/engine/__tests__/construction.test.ts lib/engine/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/engine/simulator/__tests__/build-analysis.test.ts`
Expected: PASS — build behaviour preserved; the colony variant compiles and is excluded from build-analysis.

- [ ] **Step 13: Full suite + typecheck**

Run: `npx vitest run`
Expected: PASS (whole suite).

Run: `npx tsc --noEmit`
Expected: no errors. Confirm `LandedLevel` is gone:

Run: `git grep -n "LandedLevel" -- lib`
Expected: no matches.

- [ ] **Step 14: Commit**

```bash
git add lib/world/types.ts lib/world/save.ts lib/engine/construction.ts lib/tick/processors/directed-build.ts lib/engine/simulator/build-analysis.ts lib/world/__tests__/save.test.ts lib/engine/__tests__/construction.test.ts lib/engine/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/engine/simulator/__tests__/build-analysis.test.ts
git commit -m "refactor(colonisation): discriminate WorldConstructionProject (build | colony_establish)"
```

---

## Task 3: Colony proposal engine (`directed-build.ts` + `orderProposals`)

Add `ColonyProposal` to the `Proposal` union and a pure `planFactionColonyProposals` that scores each controlled candidate with PR1's `colonyValue`, sizes its land-capped seed + bundled housing, and prices its `establishWork`. Make `orderProposals` union-safe so colonies interleave with build bundles by ROI (housing still leads). Colonies are engine-tested but not yet wired into the processor — `tsc` and the suite stay green.

**Files:**
- Modify: `lib/engine/directed-build.ts`, `lib/engine/construction.ts`
- Test: `lib/engine/__tests__/directed-build.test.ts`, `lib/engine/__tests__/construction.test.ts`

**Interfaces:**
- Consumes: `colonyValue`, `factionMissingResources`, `factionSaturation`, `unblockedDemandByResource`, `type FactionSystemState`, `type GoodDeficit`, `type ColonyValueParams` (`lib/engine/colonisation-value.ts`); `HOUSING_TYPE`, `POP_CENTRE_DENSITY`, `effectiveSpaceCost` (already imported), `workCostPerLevel` (already imported); `type WorldColonyEstablishProject` (`lib/world/types.ts`); `BuildSystemState`/`BuildGoodState` (same file).
- Produces (in `directed-build.ts`):
  - `export interface ColonyEstablishCandidate { systemId: string; habitableSpace: number; generalSpace: number; slotCap: ResourceVector; sourceSystemId: string }`
  - `export interface ColonyEstablishParams extends ColonyValueParams { establishWork: number; seedPop: number; habitableFloor: number }`
  - `export interface ColonyProposal { kind: "colony_establish"; factionId: string; systemId: string; sourceSystemId: string; seedPop: number; housingLevels: number; value: number; work: number }`
  - `export type Proposal = BuildProposal | ColonyProposal`
  - `export function factionGoodDeficits(developed: BuildSystemState[]): GoodDeficit[]`
  - `export function planFactionColonyProposals(factionId: string, developed: BuildSystemState[], candidates: ColonyEstablishCandidate[], openColonyProjects: WorldColonyEstablishProject[], params: ColonyEstablishParams): ColonyProposal[]`
- Produces (in `construction.ts`): `orderProposals` handles a `ColonyProposal` (`proposalRoi`/`isHousing` already union-safe; tiebreak widened).

- [ ] **Step 1: Write the failing colony-planner tests**

In `lib/engine/__tests__/directed-build.test.ts`, adjust the existing imports precisely (the file already imports `emptyResourceVector`/`unitResourceVector`/`makeResourceVector`/`RESOURCE_TYPES` from resources on line 6, and `effectiveSpaceCost`/`HOUSING_TYPE` from industry on line 7 — do **not** re-import those, it would duplicate the bindings), then append this suite.

Extend the line-2 `@/lib/engine/directed-build` import to add the colony symbols + `type BuildGoodState`:
```ts
import { findStructuralDeficits, buildableUnits, buildableOutput, planFactionBuilds, planFactionProposals, planFactionColonyProposals, factionGoodDeficits, supplyDissatisfaction, fedAndCalm, habitableHousingHeadroom, plannedHousingUnits, hopRouteCost, type BuildSystemState, type BuildGoodState, type PlannedBuild, type Proposal, type ColonyEstablishCandidate, type ColonyEstablishParams } from "@/lib/engine/directed-build";
```
Extend the line-4 world-types import to add the colony variant:
```ts
import type { WorldConstructionProject, WorldColonyEstablishProject } from "@/lib/world/types";
```
Extend the line-7 industry import to add `POP_CENTRE_DENSITY` (append it to the existing named list).

Add three new import lines (none of these modules is imported yet):
```ts
import type { ResourceVector } from "@/lib/types/game";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";
```

Append the suite:

```ts
const COLONY_PARAMS: ColonyEstablishParams = {
  landPremium: COLONISATION.LAND_PREMIUM,
  landGeneralWeight: COLONISATION.LAND_GENERAL_WEIGHT,
  landDepositWeight: COLONISATION.LAND_DEPOSIT_WEIGHT,
  sigmaFloor: COLONISATION.SIGMA_FLOOR,
  establishWork: COLONISATION.COLONY_ESTABLISH_WORK,
  seedPop: EXPANSION.COLONY_SEED_POP,
  habitableFloor: EXPANSION.DEVELOP_HABITABLE_FLOOR,
};

/** A developed home system for the σ/missing/deficit aggregates. `housing` sets built pop-cap; `habitable`
 *  the potential — equal ⇒ σ = 1 (saturated). `goods` seed the faction rate deficits. */
function homeState(opts: {
  systemId?: string;
  housing?: number;
  habitableSpace?: number;
  slotCap?: ResourceVector;
  goods?: BuildGoodState[];
}): BuildSystemState {
  return {
    systemId: opts.systemId ?? "home", factionId: "f1", control: "developed", population: 1000, unrest: 0,
    buildings: opts.housing ? { [HOUSING_TYPE]: opts.housing } : {},
    slotCap: opts.slotCap ?? emptyResourceVector(),
    generalSpace: 0, habitableSpace: opts.habitableSpace ?? 0, goods: opts.goods ?? [],
  };
}

/** A controlled colony candidate with a seed source. */
function candidate(opts: {
  systemId?: string; habitableSpace?: number; generalSpace?: number; slotCap?: ResourceVector;
}): ColonyEstablishCandidate {
  return {
    systemId: opts.systemId ?? "c1",
    habitableSpace: opts.habitableSpace ?? 100,
    generalSpace: opts.generalSpace ?? 0,
    slotCap: opts.slotCap ?? emptyResourceVector(),
    sourceSystemId: "home",
  };
}

describe("factionGoodDeficits", () => {
  it("sums each good's positive (demand − production) across developed systems", () => {
    const developed = [
      homeState({ systemId: "a", goods: [{ goodId: "food", stock: 0, targetStock: 0, demand: 30, production: 10 }] }),
      homeState({ systemId: "b", goods: [
        { goodId: "food", stock: 0, targetStock: 0, demand: 20, production: 5 },
        { goodId: "ore", stock: 0, targetStock: 0, demand: 5, production: 50 }, // surplus → no deficit
      ] }),
    ];
    const deficits = factionGoodDeficits(developed);
    const food = deficits.find((d) => d.goodId === "food");
    expect(food?.rateDeficit).toBeCloseTo((30 - 10) + (20 - 5), 6);
    expect(deficits.some((d) => d.goodId === "ore")).toBe(false); // ore is a surplus everywhere
  });
});

describe("planFactionColonyProposals", () => {
  it("scores a candidate's land value and rises with faction saturation σ (the crossover driver)", () => {
    const c = candidate({ habitableSpace: 100, generalSpace: 40 });
    // Unsaturated home: lots of unbuilt habitable land (σ ≈ 0) → land premium mostly dormant.
    const loose = planFactionColonyProposals("f1", [homeState({ housing: 1, habitableSpace: 1000 })], [c], [], COLONY_PARAMS);
    // Saturated home: housing fills all habitable land (σ = 1) → full land premium live.
    const tight = planFactionColonyProposals("f1", [homeState({ housing: 5, habitableSpace: 5 })], [c], [], COLONY_PARAMS);
    expect(loose).toHaveLength(1);
    expect(tight).toHaveLength(1);
    expect(loose[0].value).toBeGreaterThan(0);                 // σ_floor keeps some land value live
    expect(tight[0].value).toBeGreaterThan(loose[0].value);    // saturation activates the rest
  });

  it("credits U (unblocking value) for a keystone deposit even at σ = 0", () => {
    // Home has no `ore` deposit anywhere (missing) and a structural `metals` deficit (metals needs ore).
    // A candidate WITH an ore deposit unblocks that deficit up the recipe chain → U > 0 even unsaturated.
    const oreVec = makeResourceVector({ ore: 5 });
    const home = homeState({
      housing: 1, habitableSpace: 1000, // σ ≈ 0 → land term nearly dormant
      slotCap: emptyResourceVector(),   // zero ore slots → ore is a missing resource
      goods: [{ goodId: "metals", stock: 0, targetStock: 0, demand: 40, production: 0 }],
    });
    const keystone = candidate({ systemId: "ore-world", habitableSpace: 5, slotCap: oreVec });
    const barren = candidate({ systemId: "rock", habitableSpace: 5, slotCap: emptyResourceVector() });
    const [k] = planFactionColonyProposals("f1", [home], [keystone], [], COLONY_PARAMS);
    const [b] = planFactionColonyProposals("f1", [home], [barren], [], COLONY_PARAMS);
    // Same land (habitable 5); the keystone's ore deposit adds the metals deficit's demand as U.
    expect(k.value - b.value).toBeGreaterThan(0);
  });

  it("sizes the seed + bundled housing to the land, and prices establishWork = base + housing work", () => {
    const developed = [homeState({ housing: 1, habitableSpace: 1000 })];
    // Land-rich: whole-level habitable cap ≫ seedPop → full seed.
    const [rich] = planFactionColonyProposals("f1", developed, [candidate({ systemId: "big", habitableSpace: 100 })], [], COLONY_PARAMS);
    expect(rich.seedPop).toBe(EXPANSION.COLONY_SEED_POP);
    expect(rich.housingLevels).toBe(Math.ceil(EXPANSION.COLONY_SEED_POP / POP_CENTRE_DENSITY));
    expect(rich.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(rich.seedPop); // viable by construction
    expect(rich.work).toBeCloseTo(COLONISATION.COLONY_ESTABLISH_WORK + rich.housingLevels * workCostPerLevel(HOUSING_TYPE), 6);
    expect(rich.work).toBeGreaterThan(COLONISATION.COLONY_ESTABLISH_WORK); // housing is paid for, not free

    // Land-poor: two whole housing levels of habitable land → seed capped below COLONY_SEED_POP.
    const housingCost = effectiveSpaceCost(HOUSING_TYPE);
    const poorHabitable = 2 * housingCost; // exactly 2 whole levels
    const [poor] = planFactionColonyProposals("f1", developed, [candidate({ systemId: "small", habitableSpace: poorHabitable })], [], COLONY_PARAMS);
    expect(poor.seedPop).toBe(Math.min(EXPANSION.COLONY_SEED_POP, 2 * POP_CENTRE_DENSITY));
    expect(poor.seedPop).toBeLessThan(EXPANSION.COLONY_SEED_POP);
    expect(poor.housingLevels).toBeLessThanOrEqual(2);
    expect(poor.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(poor.seedPop);
  });

  it("skips a candidate below the habitable floor and one with no whole housing level", () => {
    const developed = [homeState({ housing: 1, habitableSpace: 1000 })];
    const belowFloor = candidate({ systemId: "dead", habitableSpace: 0 });
    expect(planFactionColonyProposals("f1", developed, [belowFloor], [], COLONY_PARAMS)).toHaveLength(0);
  });

  it("does not re-propose a colony already in flight for that system", () => {
    const developed = [homeState({ housing: 1, habitableSpace: 1000 })];
    const c = candidate({ systemId: "c1", habitableSpace: 100 });
    const open: WorldColonyEstablishProject[] = [
      { kind: "colony_establish", id: "e", factionId: "f1", systemId: "c1", sourceSystemId: "home", seedPop: 50, housingLevels: 3, workTotal: 84, workDone: 20 },
    ];
    expect(planFactionColonyProposals("f1", developed, [c], [], COLONY_PARAMS)).toHaveLength(1);
    expect(planFactionColonyProposals("f1", developed, [c], open, COLONY_PARAMS)).toHaveLength(0);
  });

  it("carries kind, faction, system, and the fixed seed source through to the proposal", () => {
    const developed = [homeState({ housing: 1, habitableSpace: 1000 })];
    const [p] = planFactionColonyProposals("f1", developed, [candidate({ systemId: "c1" })], [], COLONY_PARAMS);
    expect(p.kind).toBe("colony_establish");
    expect(p.factionId).toBe("f1");
    expect(p.systemId).toBe("c1");
    expect(p.sourceSystemId).toBe("home");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: FAIL — `planFactionColonyProposals` / `factionGoodDeficits` / `ColonyEstablishCandidate` / `ColonyEstablishParams` are not exported (compile/import error).

- [ ] **Step 3: Add the colonisation-value imports to `directed-build.ts`**

At the top of `lib/engine/directed-build.ts`, extend the `WorldConstructionProject` import (line 11) to include the colony variant, and add the valuation-engine import (after the `workCostPerLevel` import, line ~24):

```ts
import type { SystemControl, WorldConstructionProject, WorldColonyEstablishProject } from "@/lib/world/types";
```
```ts
import {
  colonyValue, factionMissingResources, factionSaturation, unblockedDemandByResource,
  type FactionSystemState, type GoodDeficit, type ColonyValueParams,
} from "@/lib/engine/colonisation-value";
```

- [ ] **Step 4: Widen the `Proposal` union**

Replace the `Proposal` type alias (line ~386) with:
```ts
/** The proposal union the decision layer emits — build bundles and colony-establishments, ranked on one pool. */
export type Proposal = BuildProposal | ColonyProposal;
```

- [ ] **Step 5: Add the colony proposal types + planner**

Append to `lib/engine/directed-build.ts` (after `planFactionProposals`, at end of file):

```ts
// ── Colony-establish proposals (the second consumer of the decision → gate → pace pipeline) ──────────

/** A controlled system a faction could settle: its substrate + the developed seed source (from hop data). */
export interface ColonyEstablishCandidate {
  systemId: string;
  habitableSpace: number;
  generalSpace: number;
  slotCap: ResourceVector;
  /** Nearest developed same-faction system — the conserved seed source (non-null; the provider drops sourceless). */
  sourceSystemId: string;
}

/** Tunable colony inputs: the valuation coefficients plus the establish cost, seed base, and habitable floor. */
export interface ColonyEstablishParams extends ColonyValueParams {
  /** Base settle work before the bundled seed-housing's build cost (COLONISATION.COLONY_ESTABLISH_WORK). */
  establishWork: number;
  /** Starter colony population, land-capped at proposal (EXPANSION.COLONY_SEED_POP). */
  seedPop: number;
  /** Minimum habitable space to consider a controlled system a colony candidate (EXPANSION.DEVELOP_HABITABLE_FLOOR). */
  habitableFloor: number;
}

/**
 * A colony-establish proposal — a single-item member of the `Proposal` union carrying its `colonyValue`
 * (the ROI numerator, on the build-comparable demand-rate axis) and `establishWork` (the denominator). It
 * interleaves with build bundles by ROI in `orderProposals`; the processor expands a funded one into a
 * `colony_establish` project. `seedPop`/`housingLevels` are fixed here (sized to the candidate's land).
 */
export interface ColonyProposal {
  kind: "colony_establish";
  factionId: string;
  /** The controlled system being settled. */
  systemId: string;
  /** Nearest developed same-faction system the seed transfers from (fixed at proposal). */
  sourceSystemId: string;
  /** Land-sized seed: min(COLONY_SEED_POP, whole-level habitable cap). */
  seedPop: number;
  /** Housing bundled with the establishment (houses the seed pop; ≤ whole-level habitable capacity). */
  housingLevels: number;
  /** colonyValue(c) — the ROI numerator. */
  value: number;
  /** COLONY_ESTABLISH_WORK + housingLevels × housing level-work — the ROI denominator. */
  work: number;
}

/**
 * Faction-level rate deficit per good = Σ over developed systems of max(0, demand − production). The
 * `U` (unblocking-value) input to colony scoring: a missing deposit's worth is mostly the DOWNSTREAM
 * demand it gates, so we hand the raw per-good deficits to `unblockedDemandByResource` to attribute
 * fractionally across the missing resources in each good's recipe closure. A self-supplied good (no
 * deficit) contributes nothing.
 */
export function factionGoodDeficits(developed: BuildSystemState[]): GoodDeficit[] {
  const byGood = new Map<string, number>();
  for (const s of developed) {
    for (const g of s.goods) {
      const deficit = g.demand - (g.production ?? 0);
      if (deficit > 0) byGood.set(g.goodId, (byGood.get(g.goodId) ?? 0) + deficit);
    }
  }
  return [...byGood].map(([goodId, rateDeficit]) => ({ goodId, rateDeficit }));
}

/**
 * Emit a colony-establish proposal for each controlled candidate above the ROI floor, scored on the same
 * demand-rate axis as a build (docs/planned/economy-colonisation-cost.md §3). Faction-level aggregates
 * (territory saturation σ, and the unmet demand each missing resource unblocks) are computed once from the
 * faction's DEVELOPED systems; each candidate is then valued with `colonyValue` and sized to its land —
 * seed capped to the whole-level habitable capacity and housing sized to house it, so the landed colony has
 * `popCap ≥ seedPop` (viable by construction). There is NO per-pulse cap: every eligible candidate is
 * proposed; the pool decides which advance (a proposal persists as an in-flight project only once funded —
 * enforced by the processor's persist-if-funded). A candidate already being established (open project) or
 * below the habitable floor / lacking a whole housing level is skipped. The `Map`/`Set` aggregates are
 * transient — nothing here reaches `World` state.
 */
export function planFactionColonyProposals(
  factionId: string,
  developed: BuildSystemState[],
  candidates: ColonyEstablishCandidate[],
  openColonyProjects: WorldColonyEstablishProject[],
  params: ColonyEstablishParams,
): ColonyProposal[] {
  if (candidates.length === 0) return [];

  const factionSystems: FactionSystemState[] = developed.map((s) => ({
    buildings: s.buildings, habitableSpace: s.habitableSpace, slotCap: s.slotCap,
  }));
  const missing = factionMissingResources(factionSystems);
  const sigma = factionSaturation(factionSystems);
  const unblocked = unblockedDemandByResource(factionGoodDeficits(developed), missing);

  const inFlight = new Set(openColonyProjects.map((p) => p.systemId));
  const housingCost = effectiveSpaceCost(HOUSING_TYPE);

  const proposals: ColonyProposal[] = [];
  for (const c of candidates) {
    if (inFlight.has(c.systemId)) continue;                 // already being established
    if (c.habitableSpace < params.habitableFloor) continue; // DEVELOP_HABITABLE_FLOOR gate stands

    // Land-sized seed + bundled housing, on WHOLE housing levels so popCap ≥ seedPop exactly (no rounding
    // gap): seed capped to the whole-level habitable capacity; housing sized to house it, land-bounded.
    const maxHousingLevels = housingCost > 0 ? Math.floor(Math.max(0, c.habitableSpace) / housingCost) : 0;
    const habitableCap = maxHousingLevels * POP_CENTRE_DENSITY;
    const seedPop = Math.min(params.seedPop, habitableCap);
    const housingLevels = Math.min(maxHousingLevels, Math.ceil(seedPop / POP_CENTRE_DENSITY));
    if (housingLevels < 1 || seedPop <= 0) continue;        // no whole housing level → not viable, skip

    const value = colonyValue(c, unblocked, sigma, params);
    const work = params.establishWork + housingLevels * workCostPerLevel(HOUSING_TYPE);

    proposals.push({
      kind: "colony_establish", factionId, systemId: c.systemId,
      sourceSystemId: c.sourceSystemId, seedPop, housingLevels, value, work,
    });
  }
  return proposals;
}
```

- [ ] **Step 6: Run the colony-planner tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: PASS — the new colony suite **and** every pre-existing planner test (the build planner body is untouched).

- [ ] **Step 7: Write the failing `orderProposals` colony-interleaving tests**

In `lib/engine/__tests__/construction.test.ts`, **replace** the existing line-3 `import type { Proposal } from "@/lib/engine/directed-build";` with the line below (adding `ColonyProposal`), then append the helper + interleaving tests after the existing `orderProposals` suite:

```ts
import type { Proposal, ColonyProposal } from "@/lib/engine/directed-build";
```
```ts
/** Build a colony-establish proposal with explicit value/work. */
function colony(systemId: string, value: number, work: number): ColonyProposal {
  return { kind: "colony_establish", factionId: "f1", systemId, sourceSystemId: "home", seedPop: 50, housingLevels: 3, value, work };
}

describe("orderProposals — colony interleaving", () => {
  it("interleaves a colony among build bundles by descending ROI", () => {
    const hi = proposal("s1", [{ buildingType: "food", levels: 1 }], 40, 20);   // ROI 2.0
    const col = colony("c1", 30, 20);                                            // ROI 1.5
    const lo = proposal("s2", [{ buildingType: "ore", levels: 1 }], 10, 20);     // ROI 0.5
    expect(orderProposals([lo, col, hi]).map((p) => p.systemId)).toEqual(["s1", "c1", "s2"]);
  });

  it("keeps housing ahead of a higher-ROI colony (proactive substrate still leads)", () => {
    const housing = proposal("s1", [{ buildingType: "housing", levels: 1 }], 0, 8, "housing");
    const col = colony("c1", 1000, 4); // enormous ROI, still funded after housing
    const ordered = orderProposals([col, housing]);
    expect(ordered[0]).toBe(housing);
    expect(ordered[1]).toBe(col);
  });

  it("is deterministic with a colony present (union-safe tiebreak, no items on a colony)", () => {
    const a = colony("c-a", 20, 20); // ROI 1.0
    const b = proposal("s-b", [{ buildingType: "ore", levels: 1 }], 20, 20); // ROI 1.0 (tie)
    const order1 = orderProposals([a, b]).map((p) => p.systemId);
    const order2 = orderProposals([b, a]).map((p) => p.systemId);
    expect(order1).toEqual(order2);
  });
});
```

- [ ] **Step 8: Run the construction tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts`
Expected: FAIL — `orderProposals`'s tiebreak reads `p.items[0]`, which does not exist on a `ColonyProposal`, so the file fails to compile (and the interleaving assertions would be wrong).

- [ ] **Step 9: Make `orderProposals`'s tiebreak union-safe**

In `lib/engine/construction.ts`, change the `tiebreak` closure inside `orderProposals` (line ~107) so it discriminates on kind (`proposalRoi` and `isHousing` already narrow by `kind` and need no change):

```ts
  const tiebreak = (p: Proposal): string =>
    p.kind === "build" ? `${p.systemId}|${p.items[0]?.buildingType ?? ""}` : `${p.systemId}|colony`;
```

- [ ] **Step 10: Run the construction tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts`
Expected: PASS — colony interleaving + housing-leads + determinism, plus every pre-existing `orderProposals`/`proposalRoi`/`fundQueue` test.

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`planFactionColonyProposals` is exported but not yet called by the processor — wiring is Task 4.)

- [ ] **Step 12: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/construction.ts lib/engine/__tests__/directed-build.test.ts lib/engine/__tests__/construction.test.ts
git commit -m "feat(colonisation): colony-establish proposals scored by colonyValue, ROI-interleaved"
```

---

## Task 4: Wire the mechanic (processor + tick + `applyDevelopments`; retire the instant develop path)

Remove the instant `controlled → developed` flip. Build colony proposals per faction, order them with build bundles, expand a funded colony proposal into a `colony_establish` project, and on **completion** develop the colony with its land-sized seed + bundled housing (`popCap ≥ seedPop`). Persist a NEW colony project only if it received funding this pulse (the open queue never balloons with unfunded colonies). Retire `planFactionDevelopments` and `MAX_DEVELOPS_PER_PULSE`. This is the task that makes the mechanic live; it ends `tsc`- and suite-green.

**Files:**
- Modify: `lib/tick/world/directed-build-world.ts`, `lib/tick/processors/directed-build.ts`, `lib/world/tick.ts`, `lib/engine/expansion.ts`, `lib/constants/expansion.ts`
- Test: `lib/world/__tests__/apply-developments.test.ts`, `lib/tick/processors/__tests__/directed-build.test.ts`, `lib/world/__tests__/tick-expansion.test.ts`, `lib/engine/__tests__/expansion.test.ts`, `lib/constants/__tests__/expansion.test.ts`

**Interfaces:**
- Consumes: `planFactionColonyProposals`, `type ColonyProposal`, `type ColonyEstablishCandidate`, `type ColonyEstablishParams`, `factionGoodDeficits`? (no — internal to the planner) (`lib/engine/directed-build.ts`); `isEconomicallyActive` (`lib/engine/control.ts`); `colonyValue` chain (transitive); `COLONISATION` (`lib/constants/colonisation.ts`); `housingPopCap` (`lib/engine/industry.ts`); `HOUSING_TYPE` (`lib/constants/industry.ts`); `type WorldColonyEstablishProject` (`lib/world/types.ts`).
- Produces:
  - `SystemDevelopment` gains `housingLevels: number`.
  - `runDirectedBuildProcessor` keeps its signature; `params.develop` becomes `{ candidateProvider: (factionId: string) => ColonyEstablishCandidate[]; params: ColonyEstablishParams }`.
  - `applyDevelopments(systems, developments)` (tick.ts) now places bundled housing and sets on-arrival `popCap`.
  - **Removed from `expansion.ts`:** `planFactionDevelopments`, `DevelopCandidate`, `DevelopParams`, `FactionDevelopment`. **Removed from `EXPANSION`:** `MAX_DEVELOPS_PER_PULSE`.

- [ ] **Step 1: Extend `SystemDevelopment` with `housingLevels`**

In `lib/tick/world/directed-build-world.ts`, the `SystemDevelopment` interface (lines ~46-52):

```ts
/** One development: a controlled system flips to developed and receives a conserved colony seed + bundled housing. */
export interface SystemDevelopment {
  systemId: string;
  /** Developed same-faction system the seed population is transferred from. */
  sourceSystemId: string;
  seedPop: number;
  /** Housing levels placed on the colony with the establishment (viable by construction). */
  housingLevels: number;
}
```

- [ ] **Step 2: Write the failing `applyDevelopments` housing/viability tests**

In `lib/world/__tests__/apply-developments.test.ts`, add `HOUSING_TYPE` + `POP_CENTRE_DENSITY` + `housingPopCap` imports, add `housingLevels` to the two existing `SystemDevelopment` literals, and append viability tests:

Add imports:
```ts
import { HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { housingPopCap } from "@/lib/engine/industry";
```

In the "conserves population" test, give each development a `housingLevels` (housing does not change population, so the conservation assertions stand):
```ts
    const developments: SystemDevelopment[] = [
      { systemId: "target-a", sourceSystemId: "source", seedPop: 50, housingLevels: 3 },
      { systemId: "target-b", sourceSystemId: "source", seedPop: 50, housingLevels: 3 },
    ];
```

In the "moves the full seed" test, add `housingLevels: 3` to the development and set the target's popCap to a realistic inert 0 so the raise is observable, then assert housing + popCap:
```ts
    const target = makeSystem("target", 0);
    target.control = "controlled";
    target.popCap = 0; // inert controlled system
    const systems = [source, target];
    const developments: SystemDevelopment[] = [
      { systemId: "target", sourceSystemId: "source", seedPop: 50, housingLevels: 3 },
    ];
```
and after the existing population/control assertions, add:
```ts
    expect(afterTarget.buildings[HOUSING_TYPE]).toBe(3);                       // bundled housing placed
    expect(afterTarget.popCap).toBeGreaterThanOrEqual(afterTarget.population); // viable by construction
    expect(afterTarget.popCap).toBe(housingPopCap({ [HOUSING_TYPE]: 3 }));     // popCap = placed housing
```

Append a dedicated viability test:
```ts
  it("lands a viable colony: housing placed, popCap ≥ seed, source keeps the rest (land-poor seed)", () => {
    const source = makeSystem("source", 500);
    const colony = makeSystem("colony", 0);
    colony.control = "controlled";
    colony.popCap = 0;
    colony.buildings = {};
    const systems = [source, colony];
    // A land-poor seed of 25 (below one full housing level's density) with a single bundled housing level.
    const developments: SystemDevelopment[] = [
      { systemId: "colony", sourceSystemId: "source", seedPop: 25, housingLevels: 2, },
    ];
    const after = applyDevelopments(systems, developments);
    const c = after.find((s) => s.id === "colony")!;
    const src = after.find((s) => s.id === "source")!;
    expect(c.control).toBe("developed");
    expect(c.population).toBe(25);
    expect(c.buildings[HOUSING_TYPE]).toBe(2);
    expect(c.popCap).toBe(2 * POP_CENTRE_DENSITY);
    expect(c.popCap).toBeGreaterThanOrEqual(c.population); // no popCap≈0 stranded state
    expect(src.population).toBe(475);                       // conserved: 500 − 25
    for (const s of after) expect(Number.isFinite(s.popCap)).toBe(true);
  });
```

- [ ] **Step 3: Run the apply-developments tests to verify they fail**

Run: `npx vitest run lib/world/__tests__/apply-developments.test.ts`
Expected: FAIL — `SystemDevelopment` now requires `housingLevels` (the literals lacking it error, once Step 1 lands) and `applyDevelopments` does not yet place housing / set popCap.

- [ ] **Step 4: Extend `applyDevelopments` in `lib/world/tick.ts` (housing + on-arrival popCap)**

Add imports near the industry-related imports at the top of `lib/world/tick.ts`:
```ts
import { housingPopCap } from "@/lib/engine/industry";
import { HOUSING_TYPE } from "@/lib/constants/industry";
```

Replace the whole `applyDevelopments` function (its JSDoc + body, lines ~397-430) with:

```ts
/**
 * Apply completed colony establishments: the target flips `developed`, receives the conserved seed
 * population (capped by what its stored source can spare), and lands its bundled housing so `popCap ≥
 * seedPop` on arrival (viable by construction — docs/planned/economy-colonisation-cost.md §2). The `:
 * SimSystem` annotation narrows the `"developed"` literal. `available` tracks each source's remaining
 * spendable population across the loop so two establishments sharing a source draw from the same
 * (shrinking) balance rather than both reading the original snapshot — otherwise a shared source would
 * mint population that was never conserved. popCap is raised to the placed housing's capacity (never
 * lowered) — the same figure infrastructure-decay recomputes next tick, set here so the colony is viable
 * the instant it exists.
 */
export function applyDevelopments(systems: SimSystem[], developments: SystemDevelopment[]): SimSystem[] {
  if (developments.length === 0) return systems;
  const bySystem = new Map(systems.map((s) => [s.id, s]));
  const popDelta = new Map<string, number>();
  const developed = new Set<string>();
  const housingBySystem = new Map<string, number>();
  const available = new Map<string, number>();
  for (const d of developments) {
    const source = bySystem.get(d.sourceSystemId);
    const target = bySystem.get(d.systemId);
    if (!source || !target) continue;
    const remaining = available.get(d.sourceSystemId) ?? Math.max(0, source.population);
    const moved = Math.min(d.seedPop, remaining);
    available.set(d.sourceSystemId, remaining - moved);
    popDelta.set(d.sourceSystemId, (popDelta.get(d.sourceSystemId) ?? 0) - moved);
    popDelta.set(d.systemId, (popDelta.get(d.systemId) ?? 0) + moved);
    developed.add(d.systemId);
    housingBySystem.set(d.systemId, (housingBySystem.get(d.systemId) ?? 0) + d.housingLevels);
  }
  return systems.map((s): SimSystem => {
    const delta = popDelta.get(s.id) ?? 0;
    const nowDeveloped = developed.has(s.id);
    if (delta === 0 && !nowDeveloped) return s;
    const buildings = nowDeveloped
      ? { ...s.buildings, [HOUSING_TYPE]: (s.buildings[HOUSING_TYPE] ?? 0) + (housingBySystem.get(s.id) ?? 0) }
      : s.buildings;
    return {
      ...s,
      population: Math.max(0, s.population + delta),
      control: nowDeveloped ? "developed" : s.control,
      buildings,
      popCap: nowDeveloped ? Math.max(s.popCap, housingPopCap(buildings)) : s.popCap,
    };
  });
}
```

- [ ] **Step 5: Run the apply-developments tests to verify they pass**

Run: `npx vitest run lib/world/__tests__/apply-developments.test.ts`
Expected: PASS — conservation (unchanged), housing placement, and on-arrival `popCap ≥ seedPop`.

- [ ] **Step 6: Retire the develop-ranker in `lib/engine/expansion.ts`**

Delete `DevelopCandidate`, `DevelopParams`, `FactionDevelopment`, and `planFactionDevelopments` (lines ~106-158 — from `/** One in-faction controlled system that could be developed … */` through the end of `planFactionDevelopments`). The colony decision now lives in `planFactionColonyProposals`. Keep everything above (the claim tier: `ClaimCandidate`, `scoreClaimCandidate`, `proposeFactionClaims`, `resolveClaims`, `ResolvedClaim`, `ExpansionParams`, `ExpansionScoreWeights`).

- [ ] **Step 7: Remove `MAX_DEVELOPS_PER_PULSE` from `lib/constants/expansion.ts`**

Delete the `MAX_DEVELOPS_PER_PULSE` line (line ~19) and its doc comment (line ~18). Keep `REACH_JUMPS`, `MAX_CLAIMS_PER_PULSE`, `SCORE_FLOOR`, `SCORE_WEIGHTS`, `DEVELOP_HABITABLE_FLOOR`, `COLONY_SEED_POP`. Update the module doc comment's parenthetical: change "gradualness comes from the small per-pulse caps + the reach radius + the score/habitable floors" to reflect that develop is now pool-funded:

```ts
 * Claims are cheap and near-instant this phase (bounded by MAX_CLAIMS_PER_PULSE + the reach radius +
 * the score floor). Developing a controlled system is NO longer instant or capped here — it is a
 * pool-funded, timed colony-establish project (docs/planned/economy-colonisation-cost.md); COLONY_SEED_POP
 * and DEVELOP_HABITABLE_FLOOR feed that project's sizing/eligibility, the construction pool paces it.
```

- [ ] **Step 8: Drop the `MAX_DEVELOPS_PER_PULSE` assertion in the constants test**

In `lib/constants/__tests__/expansion.test.ts`, remove the `MAX_DEVELOPS_PER_PULSE` line from the "keeps claims + developments gradual" test (line ~16) and reword it to "keeps claims gradual":

```ts
  it("keeps claims gradual (small per-pulse cap, permissive positive floor)", () => {
    expect(EXPANSION.MAX_CLAIMS_PER_PULSE).toBeGreaterThanOrEqual(1);
    expect(EXPANSION.SCORE_FLOOR).toBeGreaterThan(0);
  });
```

- [ ] **Step 9: Remove the retired develop-ranker suite in `expansion.test.ts`**

In `lib/engine/__tests__/expansion.test.ts`, delete the `planFactionDevelopments` import, the `DevelopCandidate`/`DevelopParams` type imports, the `DEV_PARAMS` const, the `devCand` helper, and the whole `describe("planFactionDevelopments", …)` block (the develop-ranker is retired). Keep the claim-tier suites (`scoreClaimCandidate`, `proposeFactionClaims`, `resolveClaims`).

- [ ] **Step 10: Rewrite the processor's develop wiring**

In `lib/tick/processors/directed-build.ts`:

(a) Replace the engine/expansion imports (lines ~3-4 and ~16-26) so the retired develop-ranker is gone and the colony planner + narrowing helpers are in:

```ts
import { planFactionProposals, planFactionColonyProposals, type BuildSystemState, type ColonyProposal, type ColonyEstablishCandidate, type ColonyEstablishParams } from "@/lib/engine/directed-build";
import { fundQueue, factionThroughputPool, orderProposals } from "@/lib/engine/construction";
import { isEconomicallyActive } from "@/lib/engine/control";
```
and change the world-types import to add the colony variant:
```ts
import type { WorldConstructionProject, WorldColonyEstablishProject } from "@/lib/world/types";
```
and the expansion import (drop `planFactionDevelopments`, `DevelopCandidate`, `DevelopParams`):
```ts
import {
  proposeFactionClaims,
  resolveClaims,
  type ClaimCandidate,
  type ClaimProposal,
  type ExpansionParams,
} from "@/lib/engine/expansion";
```

(b) Change the `develop?` param shape in `DirectedBuildProcessorParams` (lines ~47-51):
```ts
  /** Colony-establish step. Omitted → no colonisation (build-only path used by engine/adapter tests). */
  develop?: {
    /** Controlled colony candidates per faction (substrate + seed source), from the tick body's hop data. */
    candidateProvider: (factionId: string) => ColonyEstablishCandidate[];
    params: ColonyEstablishParams;
  };
```

(c) Delete the whole instant develop-phase block (lines ~109-119 — from `// ── Develop phase …` through the closing `}` after `await world.applyDevelopments(developments);`). Developments now come from completed colony-establish projects (below).

(d) Add a `developments` accumulator alongside `landedBySystem`/`nextOpen` (near line ~143-144):
```ts
  const landedBySystem = new Map<string, Map<string, number>>();
  const developments: SystemDevelopment[] = [];
  const nextOpen: WorldConstructionProject[] = [];
```

(e) In the per-faction loop, after `const proposals = planFactionProposals(...)` — replace the existing `const ordered = orderProposals(proposals);` (line ~155) with build + colony proposal assembly:
```ts
    const buildStates = group.map(toBuildState);
    const buildProposals = planFactionProposals(buildStates, params.routeCost, existing);

    // Colony-establish proposals compete with builds on the same pool. Only faction-owned systems can
    // colonise (a null-faction group is independents — never); the develop param is omitted in build-only tests.
    let colonyProposals: ColonyProposal[] = [];
    if (params.develop && factionId !== null) {
      const developedStates = buildStates.filter((s) => isEconomicallyActive(s.control));
      const openColonies = existing.filter(
        (p): p is WorldColonyEstablishProject => p.kind === "colony_establish",
      );
      colonyProposals = planFactionColonyProposals(
        factionId, developedStates, params.develop.candidateProvider(factionId), openColonies, params.develop.params,
      );
    }

    const ordered = orderProposals([...buildProposals, ...colonyProposals]);
```
(Delete the now-duplicated `const proposals = planFactionProposals(group.map(toBuildState), …)` line it replaces.)

(f) Replace the proposal-expansion loop (lines ~159-172) so it discriminates build vs colony:
```ts
    // Expand each proposal into whole-level project rows: a build bundle's `items` are already gate-first
    // (complex → academies → production); a colony is a single colony-establish project whose workTotal is
    // its establishWork. fundQueue never sees the ROI — the ordering is done.
    const newProjects: WorldConstructionProject[] = [];
    for (const p of ordered) {
      if (p.kind === "build") {
        for (const item of p.items) {
          newProjects.push({
            kind: "build",
            id: params.construction.mintId(),
            factionId: p.factionId,
            systemId: p.systemId,
            buildingType: item.buildingType,
            levels: item.levels,
            workTotal: item.levels * workCostPerLevel(item.buildingType),
            workDone: 0,
          });
        }
      } else {
        newProjects.push({
          kind: "colony_establish",
          id: params.construction.mintId(),
          factionId: p.factionId,
          systemId: p.systemId,
          sourceSystemId: p.sourceSystemId,
          seedPop: p.seedPop,
          housingLevels: p.housingLevels,
          workTotal: p.work,
          workDone: 0,
        });
      }
    }
```

(g) Replace the fund + persist + landing block (lines ~174-181) with persist-if-funded (colonies) + a discriminated landing split:
```ts
    // Fund front-first: in-flight work finishes before new commitments; land completed levels.
    const { projects: fundedOpen, landed } = fundQueue([...existing, ...newProjects], pool, params.construction.cap);
    for (const p of fundedOpen) {
      // Persist-if-funded for colonies: a colony-establish that got NO work this pulse is dropped and
      // re-scored next pulse, so the open queue never balloons with unfunded colonies (pool-pacing alone
      // bounds expansion — there is no per-pulse develop cap). In-flight colonies always have workDone > 0,
      // so they persist. Builds persist regardless (their in-flight subtraction already bounds them).
      if (p.kind === "colony_establish" && p.workDone <= 0) continue;
      nextOpen.push(p);
    }
    for (const l of landed) {
      if (l.kind === "build") {
        const byType = landedBySystem.get(l.systemId) ?? new Map<string, number>();
        byType.set(l.buildingType, (byType.get(l.buildingType) ?? 0) + l.levels);
        landedBySystem.set(l.systemId, byType);
      } else {
        // A completed colony-establish → develop the system: seed transfer + bundled housing (applied in tick.ts).
        developments.push({
          systemId: l.systemId, sourceSystemId: l.sourceSystemId, seedPop: l.seedPop, housingLevels: l.housingLevels,
        });
      }
    }
```

(h) After the per-faction loop, before `applyBuildingIncreases`, apply the landed developments (line ~184, just before "Emit absolute new counts"):
```ts
  // Apply completed colony establishments (develop + conserved seed + bundled housing).
  if (developments.length > 0) await world.applyDevelopments(developments);
```
(The building-increase emission + `applyConstructionUpdates` blocks below are unchanged.)

(i) Update the `runDirectedBuildProcessor` JSDoc (the develop-phase sentence, lines ~109-111 region and the class comment ~70-83). Replace the develop-phase description with the colony-establish flow:
```ts
 * Colonisation is now the second consumer of the same decision → gate → pace pipeline: each faction's
 * controlled candidates are scored (`planFactionColonyProposals`, via colonyValue), interleaved with build
 * bundles by ROI (`orderProposals`), and expanded into colony-establish projects. There is no instant
 * develop flip — a `colony_establish` accrues work over pulses like any build and, on COMPLETION, develops
 * its target (seed transfer + bundled housing via `applyDevelopments`). Only funded colony proposals
 * persist as in-flight projects, so the open queue is bounded without a per-pulse develop cap.
```

- [ ] **Step 11: Rewire the tick body (`lib/world/tick.ts`) — provider, params, imports**

(a) Add imports:
```ts
import { COLONISATION } from "@/lib/constants/colonisation";
```
and extend the `directed-build` engine import (line ~38) to bring the candidate type:
```ts
import { hopRouteCost, type ColonyEstablishCandidate } from "@/lib/engine/directed-build";
```
and narrow the expansion type import (line ~39) to just the claim candidate:
```ts
import type { ClaimCandidate } from "@/lib/engine/expansion";
```
(`HOUSING_TYPE` + `housingPopCap` were added in Step 4.)

(b) Replace the `developProvider` (lines ~718-740) so it returns `ColonyEstablishCandidate[]` (substrate + seed source; sourceless candidates dropped):
```ts
    // Colony-candidate provider: a faction's CONTROLLED systems that have a reachable developed
    // same-faction seed source, tagged with their substrate + that source. The colony planner scores
    // them via colonyValue and funds establish projects from the shared pool.
    const developProvider = (factionId: string): ColonyEstablishCandidate[] => {
      const candidates: ColonyEstablishCandidate[] = [];
      for (const s of systems) {
        if (s.factionId !== factionId || s.control !== "controlled") continue;
        const neighbours = hops.get(s.id);
        let sourceSystemId: string | null = null;
        let bestHop = Infinity;
        if (neighbours) {
          for (const [destId, h] of neighbours) {
            if (h <= 0) continue;
            if (factionBySystem.get(destId) !== factionId) continue;
            if (controlBySystem.get(destId) !== "developed") continue;
            if (h < bestHop) { bestHop = h; sourceSystemId = destId; }
          }
        }
        if (sourceSystemId === null) continue; // no developed seed source reachable → cannot establish
        candidates.push({
          systemId: s.id,
          habitableSpace: s.habitableSpace,
          generalSpace: s.generalSpace,
          slotCap: s.slotCap,
          sourceSystemId,
        });
      }
      return candidates;
    };
```

(c) Replace the `develop:` param passed to `runDirectedBuildProcessor` (lines ~757-760) with the colony params:
```ts
      develop: {
        candidateProvider: developProvider,
        params: {
          landPremium: COLONISATION.LAND_PREMIUM,
          landGeneralWeight: COLONISATION.LAND_GENERAL_WEIGHT,
          landDepositWeight: COLONISATION.LAND_DEPOSIT_WEIGHT,
          sigmaFloor: COLONISATION.SIGMA_FLOOR,
          establishWork: COLONISATION.COLONY_ESTABLISH_WORK,
          seedPop: EXPANSION.COLONY_SEED_POP,
          habitableFloor: EXPANSION.DEVELOP_HABITABLE_FLOOR,
        },
      },
```
(`EXPANSION` is already imported; `EXPANSION.MAX_DEVELOPS_PER_PULSE` is no longer referenced.)

- [ ] **Step 12: Rework the processor's develop tests → colony-establish tests**

In `lib/tick/processors/__tests__/directed-build.test.ts`:

(a) Change the expansion type import (line ~9) to drop `DevelopCandidate`/`DevelopParams` and add the colony types + constants:
```ts
import type { ClaimCandidate, ExpansionParams } from "@/lib/engine/expansion";
import type { ColonyEstablishCandidate, ColonyEstablishParams } from "@/lib/engine/directed-build";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";
import { workCostPerLevel } from "@/lib/constants/construction";
import { HOUSING_TYPE, POP_CENTRE_DENSITY, effectiveSpaceCost } from "@/lib/constants/industry";
```

(b) Replace `DEV_PARAMS` (lines ~235-237) with a `COLONY_PARAMS`:
```ts
const COLONY_PARAMS: ColonyEstablishParams = {
  landPremium: COLONISATION.LAND_PREMIUM,
  landGeneralWeight: COLONISATION.LAND_GENERAL_WEIGHT,
  landDepositWeight: COLONISATION.LAND_DEPOSIT_WEIGHT,
  sigmaFloor: COLONISATION.SIGMA_FLOOR,
  establishWork: COLONISATION.COLONY_ESTABLISH_WORK,
  seedPop: EXPANSION.COLONY_SEED_POP,
  habitableFloor: EXPANSION.DEVELOP_HABITABLE_FLOOR,
};

/** A developed home with housing filling all its habitable land (σ = 1) and no build deficits — so the
 *  pool funds only colonies. Population sets the throughput pool. */
function saturatedHome(population: number): SystemBuildRow {
  return {
    systemId: "home", factionId: "f1", control: "developed", population, unrest: 0,
    buildings: { [HOUSING_TYPE]: 5 },
    yields: unitResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 5, habitableSpace: 5, markets: [], // habitable fully housed (5 levels) → σ = 1, no housing headroom
  };
}

function colonyCand(systemId: string, habitableSpace = 100): ColonyEstablishCandidate {
  return { systemId, habitableSpace, generalSpace: 50, slotCap: emptyResourceVector(), sourceSystemId: "home" };
}
```

(c) Replace the `describe("runDirectedBuildProcessor: claim + develop phase", …)` block's develop tests. Keep the two claim tests unchanged; replace the "develops the best controlled candidate on a due tick" test with colony-establish coverage, and add the timed/bounded/viable tests:

```ts
describe("runDirectedBuildProcessor: colony-establish phase", () => {
  it("does NOT develop on the pulse it is proposed — the colony-establish accrues work over pulses", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    // A tiny cap so the establish project cannot complete this pulse.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(0); // not flipped this pulse
    const colony = w.constructionProjects.find((p) => p.kind === "colony_establish");
    expect(colony).toBeDefined();
    expect(colony!.systemId).toBe("c1");
    // establishWork exceeds the base by the bundled seed-housing's build cost (housing is paid for).
    expect(colony!.workTotal).toBeGreaterThan(COLONISATION.COLONY_ESTABLISH_WORK);
  });

  it("develops the colony once the establish project completes (seed + bundled housing landing)", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    // A generous pool + cap completes the establish this pulse.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(1);
    const dev = w.developments[0];
    expect(dev.systemId).toBe("c1");
    expect(dev.sourceSystemId).toBe("home");
    expect(dev.seedPop).toBe(EXPANSION.COLONY_SEED_POP);
    // Viable by construction: bundled housing houses the whole seed.
    expect(dev.housingLevels).toBe(Math.ceil(dev.seedPop / POP_CENTRE_DENSITY));
    expect(dev.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(dev.seedPop);
    // The completed establish project is removed from the open queue.
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(false);
  });

  it("bounds the open queue: with many candidates and a small pool, only funded colonies persist", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(80)]); // pool = 80 × 0.05 = 4 → one cap-worth
    const candidates = ["c1", "c2", "c3", "c4", "c5"].map((id) => colonyCand(id));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? candidates : []), params: COLONY_PARAMS },
    });
    const openColonies = w.constructionProjects.filter((p) => p.kind === "colony_establish");
    // Front-first funding gives one colony a cap's worth; the other four get zero and are dropped.
    expect(openColonies.length).toBeLessThan(candidates.length);
    expect(openColonies.length).toBeGreaterThanOrEqual(1);
    for (const p of openColonies) expect(p.workDone).toBeGreaterThan(0);
  });

  it("develops nothing off the pulse boundary", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
      develop: { candidateProvider: () => [colonyCand("c1")], params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(0);
    expect(w.constructionProjects).toHaveLength(0);
  });
});
```

(Keep the existing `describe("runDirectedBuildProcessor: claim + develop phase", …)`'s **claim** tests — rename that describe to `"runDirectedBuildProcessor: claim phase"` and remove only its "develops the best controlled candidate" test and the "claims/develops nothing off boundary" test's develop wording is fine to keep as a claim-only assertion. If the develop-param on the claim tests references the old shape, drop the `develop:` key from those claim-only calls.)

- [ ] **Step 13: Rework the end-to-end expansion tick test (paced, not instant)**

In `lib/world/__tests__/tick-expansion.test.ts`, the first test asserts a colony *develops* within 4 months — impossible now that establishment is pool-funded and saturation-gated (early home-first means colonies rarely fund until home fills). Replace lines ~32-34 (the `developedNonHome` block) with a paced-expansion assertion:

```ts
    // Developing is now a pool-funded, timed colony-establish project (not an instant flip), and it is
    // saturation-gated (home-first while there is cheap building). So within a few months we assert
    // colonisation is PACED — controlled borders accumulate — rather than a completed developed colony
    // (end-to-end completion + viability is covered by the processor + applyDevelopments unit tests, and
    // long-run pacing by `npm run simulate`).
    const controlledNonHome = world.systems.filter((s) => s.control === "controlled" && !homeworldIds.has(s.id));
    expect(controlledNonHome.length).toBeGreaterThan(0);
    // No colony-establish project ever carries NaN/Infinity work into World state.
    for (const p of world.constructionProjects) {
      expect(Number.isFinite(p.workTotal)).toBe(true);
      expect(Number.isFinite(p.workDone)).toBe(true);
    }
```

The determinism and finiteness tests below are unchanged (colony scoring/sizing is deterministic and finite).

- [ ] **Step 14: Run the touched suites to verify they pass**

Run: `npx vitest run lib/world/__tests__/apply-developments.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/world/__tests__/tick-expansion.test.ts lib/engine/__tests__/expansion.test.ts lib/constants/__tests__/expansion.test.ts`
Expected: PASS.

- [ ] **Step 15: Full suite + typecheck**

Run: `npx vitest run`
Expected: PASS (whole suite).

Run: `npx tsc --noEmit`
Expected: no errors. Confirm the develop-ranker + cap are gone:

Run: `git grep -n "planFactionDevelopments\|MAX_DEVELOPS_PER_PULSE\|DevelopParams\|DevelopCandidate\|FactionDevelopment" -- lib`
Expected: no matches.

- [ ] **Step 16: Commit**

```bash
git add lib/tick/world/directed-build-world.ts lib/tick/processors/directed-build.ts lib/world/tick.ts lib/engine/expansion.ts lib/constants/expansion.ts lib/world/__tests__/apply-developments.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/world/__tests__/tick-expansion.test.ts lib/engine/__tests__/expansion.test.ts lib/constants/__tests__/expansion.test.ts
git commit -m "feat(colonisation): pool-funded timed colony-establish (viable-by-construction); retire instant develop"
```

---

## Task 5: Save round-trip for a colony project + verification gate

Prove a `colony_establish` project survives save/load (determinism/serializability), then run the whole PR gate.

**Files:**
- Test: `lib/world/__tests__/save.test.ts`
- Verification only (no source changes).

- [ ] **Step 1: Add a colony-establish save round-trip test**

Append to the `describe("serializeWorld / deserializeWorld", …)` block in `lib/world/__tests__/save.test.ts`:

```ts
  it("round-trips a colony-establish project unchanged (serializable, no lost fields)", () => {
    const withColony: World = {
      ...world,
      constructionProjects: [
        {
          kind: "colony_establish",
          id: "establish-1",
          factionId: world.factions[0].id,
          systemId: world.systems[1].id,
          sourceSystemId: world.systems[0].id,
          seedPop: 50,
          housingLevels: 3,
          workTotal: 84,
          workDone: 40,
        },
      ],
    };
    const result = deserializeWorld(serializeWorld(withColony));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world).toStrictEqual(withColony);
  });
```

- [ ] **Step 2: Run the save test to verify it passes**

Run: `npx vitest run lib/world/__tests__/save.test.ts`
Expected: PASS.

- [ ] **Step 3: Full unit suite**

Run: `npx vitest run`
Expected: PASS — the whole suite green.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Production build gate**

Run: `npx next build --webpack`
Expected: build succeeds (the PR-gate build per `CLAUDE.md`).

- [ ] **Step 6: Simulator sanity (coherence, not target metrics)**

Run: `npm run simulate`
Expected: the run completes with **no NaN/Infinity and no crash**; `greedy ≫ random` still holds; the build loop still functions. Because develop is now pool-funded and saturation-gated, colonies establish more slowly and later than the old instant flip — verify intrinsic coherence, not parity with the pre-PR3 run (`dev-coherence-over-parity`). The colonisation summary is unchanged this PR (colony-establish reporting + the calibration pass are PR4); confirm only that it prints without NaN and shows no fresh populated-but-no-industry / popCap-starved colonies attributable to the mechanic (colonies now land with bundled housing).

- [ ] **Step 7: Confirm the new surface is wired and the old surface is gone**

Run: `git grep -n "planFactionColonyProposals\|ColonyProposal\|colony_establish" -- lib`
Expected: matches in `lib/engine/directed-build.ts`, `lib/engine/construction.ts`, `lib/world/types.ts`, `lib/tick/processors/directed-build.ts`, and their `__tests__` (+ `save.test.ts`). `colonyValue` is now called from `directed-build.ts` (no longer unwired).

Run: `git grep -n "planFactionDevelopments\|MAX_DEVELOPS_PER_PULSE\|LandedLevel" -- lib`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add lib/world/__tests__/save.test.ts
git commit -m "test(colonisation): colony-establish project round-trips through save/load"
```

---

## Self-Review

**1. Spec coverage** (`docs/planned/economy-colonisation-cost.md`):
- §1 Claim stays cheap; develop becomes the funded project; `MAX_DEVELOPS_PER_PULSE` retired, only the pool paces → instant develop phase removed (Task 4), colony-establish project (Task 2 type, Task 4 wiring), cap removed (Task 4). ✓
- §1 `establishWork = COLONY_ESTABLISH_WORK + housingLevels × housing work` → `planFactionColonyProposals` work accrual (Task 3); asserted `> base` (Tasks 3, 4). ✓
- §2 Viable by construction — conserved land-sized seed + bundled housing sized to it, `popCap ≥ seedPop`, source drain absorbed at apply time → `planFactionColonyProposals` sizing on whole housing levels (Task 3) + `applyDevelopments` housing/popCap (Task 4) + apply-developments viability tests. ✓
- §2 seed sized to land (land-poor → smaller seed, no habitable land → not a candidate) → whole-level `habitableCap` cap + `DEVELOP_HABITABLE_FLOOR` + `housingLevels ≥ 1` guard (Task 3). ✓
- §3 Valuation U + L·(σ_floor + (1−σ_floor)σ) on one axis → `colonyValue` (PR1) driven by `factionGoodDeficits`/`factionMissingResources`/`factionSaturation`/`unblockedDemandByResource` (Task 3); crossover + keystone-U tested. ✓
- §4 Value-order funding — colony carries ROI at the proposal, interleaves by ROI, `fundQueue` stays decision-free; persist-if-funded so the open queue stays bounded → `orderProposals` union-safe (Task 3), processor expand + persist-if-funded (Task 4); bounded-queue test. ✓
- Colony lifecycle (controlled → funded establish over N pulses → develop + seed + housing) → Tasks 3-4; timed/completion/viable processor tests. ✓
- Architecture touch-points: `colonisation-value.ts` (reused, PR1), `directed-build.ts` (proposals), `construction.ts` (fundQueue/orderProposals), `processors/directed-build.ts`, `tick.ts` (`applyDevelopments` + provider), constants (`colonisation.ts` new, `expansion.ts` trimmed). `build-analysis.ts` guarded (full metric = PR4). ✓
- Testing strategy: crossover (Task 3), σ_floor spectrum (Task 3 saturation test + PR1 unit), U up the chain (Task 3 keystone), establish timed+pool-funded (Task 4), no-starts-throttle/bounded queue (Task 4), viable by construction (Tasks 3-4), seed sized to land (Task 3), value-order gate-first preserved (Task 3 + PR2), determinism + serializability (Task 5 round-trip + tick-expansion determinism), simulator health (Task 5). ✓
- **Correctly deferred to PR4:** the simulator colonisation *metric* extension (establish-in-flight, pool split) and the `COLONISATION` calibration pass. Named in the PR Roadmap.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above" — every code step ships complete code; every run step an exact command + expected result.

**3. Type consistency:** `WorldColonyEstablishProject` fields (`kind`, `sourceSystemId`, `seedPop`, `housingLevels`, `workTotal`, `workDone`) match the `ColonyProposal` fields the processor reads when minting (Task 4 (f)) and the `SystemDevelopment` fields derived on landing (Task 4 (g)) — `housingLevels`/`seedPop`/`sourceSystemId`/`systemId` names agree across proposal → project → landing → `applyDevelopments`. `ColonyEstablishParams` extends `ColonyValueParams` so `colonyValue(candidate, unblocked, sigma, params)` accepts it directly, and `ColonyEstablishCandidate` structurally satisfies `ColonyCandidate` (the 3 substrate fields) so it passes to `colonyValue` unwrapped. `fundQueue.landed: WorldConstructionProject[]` is consumed by the processor's kind-narrowed loop (Task 2 build-only, Task 4 adds colony). `factionGoodDeficits` returns `GoodDeficit[]` consumed by `unblockedDemandByResource`.

**4. Behaviour preservation:** The build planner (`planFactionBundles`/`planFactionProposals`/`planFactionBuilds`) and the build funding path are byte-identical — PR3 only *adds* colony proposals into the same `orderProposals`/`fundQueue`, reshapes the persisted project row (adds `kind`), and changes `fundQueue.landed` from a derived `LandedLevel` to the completed row (same information for builds). The only intended behaviour change is that develop is now pool-funded/timed instead of an instant per-pulse flip.

**5. Determinism / serializability:** Colony scoring/sizing is pure arithmetic (no RNG, no wall-clock); claim resolution keeps its seeded RNG. `orderProposals` keeps a total-order tiebreak (union-safe). `Map`/`Set` colony aggregates are transient (never stored). Only finite `WorldConstructionProject` rows reach `World` (both variants have finite `workTotal`/`workDone`/`seedPop`/`housingLevels`); `establishWork`/`colonyValue` are finite; `applyDevelopments` caps and floors keep `population`/`popCap` finite and non-negative. Save version bumped 4→5; both project variants round-trip (Tasks 2, 5).

**6. Import-cycle check:** `directed-build.ts` adds a runtime import of `colonisation-value.ts` (which imports only constants/resources — no back-edge to `directed-build.ts`), so no cycle. `construction.ts` keeps its type-only `Proposal` import from `directed-build.ts`. The processor imports the engine functions; `tick.ts` imports `ColonyEstablishCandidate` (type-only) from `directed-build.ts` and `COLONISATION`/`housingPopCap`/`HOUSING_TYPE` (all leaf modules). No new runtime cycle.
