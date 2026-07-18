# Player Seat Slice 2 — PR A (economy half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construction points become a real, partly-built resource: the pop pool narrows to eligible (non-skilled-employed) heads, a new Construction Centre building adds capital-generated points, and centres are auto-planned via frontier-ROI valuation on the existing proposal machinery.

**Architecture:** Three seams change. (1) `lib/engine/construction.ts` replaces `factionThroughputPool` with `factionConstructionPool`, which reads each developed system's buildings to compute eligible heads (via `computeLabourAllocation`) plus centre output. (2) A new pure module `lib/engine/construction-centre.ts` prices at most one centre proposal per faction per pulse off the backlog frontier; the directed-build processor threads it into `orderProposals` like any proposal. (3) The readout/service and the calibration harness pick up the new pool shape so pool composition and queue ETA are visible.

**Tech Stack:** TypeScript 5 strict, Vitest 4. Engine-pure changes only (no I/O); no UI, no save-format change (PR B owns `automation`/`origin` and the v7 bump).

**Spec:** `docs/build-plans/player-seat.md` Slice 2 §1–3, §7–8. Deliberate refinements over the spec's letter (approved rationale inline where they land):
- The spec's "splitLabour" is `computeLabourAllocation` (`lib/engine/industry.ts:216`) — employment-bounded buckets, exactly the eligibility semantics §1 wants.
- Centre projects get **persist-if-funded** (like colonies): an unfunded centre project is dropped and re-priced next pulse. Without this, a junk-ranked centre would persist and then fund ahead of next pulse's proposals (existing projects fund front-first), defeating "correctly waits".
- Centre valuation runs in **reference-month units** (unscaled pool + constants); only the funding pool is `catchUp`-scaled. Keeps the frontier interval-invariant.

## Global Constraints

- No `as` assertions (except `as const` / guards in `lib/types/guards.ts`); no `unknown`; no postfix `!` outside tests' `find(...)!`.
- Engine files (`lib/engine/`) stay pure — no `fs`, `process.env`, `Date.now`, `Math.random`.
- World state stays JSON-serializable; guard math that could produce `NaN`/`Infinity`.
- Comments describe the code, never the plan/PR that produced it.
- Discriminated unions for result types; typed keys, not `Record<string, unknown>`.
- Build gate before PR: `npx tsc --noEmit`, `npx vitest run`, `npx next build --webpack`, plus the Task 7 simulator gate.
- Branch: work happens on `feat/player-seat-2-economy`, PR into shared branch `feat/player-seat-2` (created in Task 0). Commit after each task.

---

### Task 0: Branch setup + simulator baseline

The Slice 2 design spec is already committed (docs commit on `main` made before this plan executes). This task cuts the branches and captures the pre-change simulator baseline the Task 7 gate compares against.

- [ ] **Step 1: Create the shared feature branch and the PR A branch**

```bash
git checkout main && git pull
git checkout -b feat/player-seat-2
git push -u origin feat/player-seat-2
git checkout -b feat/player-seat-2-economy
```

- [ ] **Step 2: Capture the baseline simulator report**

Run (takes several minutes — 1500 ticks, 600 systems, full scale):

```bash
npm run simulate -- --config experiments/examples/cadence-invariance-24.yaml > "$env:TEMP/sim-baseline-pr-a.txt" 2>&1
```

(PowerShell path shown; in Bash use a scratchpad path.) Keep the file — Task 7 diffs against it. Note down at minimum: final population, buildings built (Colonisation & Build Loop block: developed system counts, with-tier-0/tier-1+/housing counts), construction queue sizes, and that no NaN/`null` appears anywhere in the report.

- [ ] **Step 3: Commit nothing yet** — this task produces no code change; the baseline file stays out of the repo (scratch only).

---

### Task 1: Constants — the Construction Centre type + tuning knobs

**Files:**
- Modify: `lib/constants/industry.ts` (type id + `BUILDING_TYPES` entry, near the academy entries)
- Modify: `lib/constants/construction.ts` (`WORK_PER_LEVEL_OVERRIDE` + three new `CONSTRUCTION` knobs)
- Modify: `lib/constants/building-descriptions.ts` (bespoke copy)
- Modify: `lib/world/types.ts:141` (the `WorldBuilding.buildingType` doc comment)
- Test: `lib/constants/__tests__/industry.test.ts`, `lib/engine/__tests__/construction.test.ts`, `lib/constants/__tests__/building-descriptions.test.ts`

**Interfaces:**
- Produces: `CONSTRUCTION_CENTRE_TYPE = "construction_centre"` (exported from `lib/constants/industry.ts`); `BUILDING_TYPES[CONSTRUCTION_CENTRE_TYPE]` with `output: { kind: "none" }` and labour `{ unskilled: 18, skill1: 7, skill2: 0 }`; `CONSTRUCTION.POINTS_PER_LEVEL`, `CONSTRUCTION.PAYBACK_HORIZON`, `CONSTRUCTION.BACKLOG_WINDOW`; `workCostPerLevel(CONSTRUCTION_CENTRE_TYPE) === 25`.
- Consumes: existing catalog machinery (`BuildingTypeDef`, `WORK_PER_LEVEL_OVERRIDE`).

Design notes locked here:
- **Output kind `"none"`** — the centre produces no market good, no capacity licence, no modifier. `buildingUsed` (`lib/engine/industry.ts:424`) already dispatches `none → count × labourFulfil`, which makes idle-decay work unchanged: an unstaffable centre sheds levels; a staffed one holds.
- **Labour = the tier-1 default vector** (`{ unskilled: 18, skill1: 7, skill2: 0 }`) — the spec's "tier-1-factory-like profile".
- **Space = `DEFAULT_SPACE_COST` (1.0)** — the spec's "normal general-space footprint". Both `generalSpaceUsed` variants bill it automatically (it carries no `resource` and is not tier-0).
- **Work cost 25** — above a tier-1 factory (20), below a complex (40): capital-heavy but not anchor-scale.
- **Knob first-cuts** (sim-calibrated in Task 7): `POINTS_PER_LEVEL: 5` (≈4× the 1.25 points its 25 heads would yield as raw eligible labour — the substitution must beat the labour it absorbs), `PAYBACK_HORIZON: 12` reference months, `BACKLOG_WINDOW: 6` reference months.
- **`THROUGHPUT_PER_POP` stays 0.05 for now** — §1 says recalibrate upward so a young low-skill economy is roughly unchanged; young economies have near-zero skilled employment so the delta is small. Task 7 measures and moves it only if the sim shows pools sagging.

- [ ] **Step 1: Write the failing tests**

Append to `lib/constants/__tests__/industry.test.ts` (import `CONSTRUCTION_CENTRE_TYPE` from `@/lib/constants/industry`):

```ts
describe("construction centre", () => {
  it("is a non-producing, tier-1-staffed building on normal general space", () => {
    const def = BUILDING_TYPES[CONSTRUCTION_CENTRE_TYPE];
    expect(def).toBeDefined();
    expect(def.output).toEqual({ kind: "none" });
    expect(def.outputGood).toBeUndefined();
    expect(def.skill1Licensed).toBeUndefined();
    expect(def.skill2Licensed).toBeUndefined();
    expect(def.labour).toEqual({ unskilled: 18, skill1: 7, skill2: 0 });
    expect(def.spaceCost).toBe(1.0);
  });
});
```

Append to the `construction constants` describe in `lib/engine/__tests__/construction.test.ts` (import `CONSTRUCTION_CENTRE_TYPE`):

```ts
  it("prices a construction-centre level above a tier-1 factory and below a complex", () => {
    expect(workCostPerLevel(CONSTRUCTION_CENTRE_TYPE)).toBeGreaterThan(workCostPerLevel("metals"));
    expect(workCostPerLevel(CONSTRUCTION_CENTRE_TYPE)).toBeLessThan(workCostPerLevel("heavy_industry_complex"));
  });

  it("exposes positive centre knobs (points per level, payback horizon, backlog window)", () => {
    expect(CONSTRUCTION.POINTS_PER_LEVEL).toBeGreaterThan(0);
    expect(CONSTRUCTION.PAYBACK_HORIZON).toBeGreaterThan(0);
    expect(CONSTRUCTION.BACKLOG_WINDOW).toBeGreaterThan(0);
  });
```

Check `lib/constants/__tests__/building-descriptions.test.ts` first: if it enumerates non-good building types, add `CONSTRUCTION_CENTRE_TYPE` to its expectation; otherwise add:

```ts
  it("describes the construction centre", () => {
    expect(BUILDING_DESCRIPTIONS[CONSTRUCTION_CENTRE_TYPE]).toContain("onstruction");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts lib/engine/__tests__/construction.test.ts lib/constants/__tests__/building-descriptions.test.ts`
Expected: FAIL — `CONSTRUCTION_CENTRE_TYPE` not exported / properties undefined.

- [ ] **Step 3: Implement the constants**

`lib/constants/industry.ts` — after the `RESEARCH_INSTITUTE_TYPE` line (~line 25):

```ts
export const CONSTRUCTION_CENTRE_TYPE = "construction_centre";
```

In the `BUILDING_TYPES` literal, after the research-institute entry:

```ts
  [CONSTRUCTION_CENTRE_TYPE]: {
    output: { kind: "none" },
    spaceCost: DEFAULT_SPACE_COST,
    labour: { unskilled: 18, skill1: 7, skill2: 0 },
  },
```

`lib/constants/construction.ts` — import `CONSTRUCTION_CENTRE_TYPE`; add to `WORK_PER_LEVEL_OVERRIDE`:

```ts
  [CONSTRUCTION_CENTRE_TYPE]: 25,
```

Add to the `CONSTRUCTION` object (after `FLOOR_DEV_KNEE`):

```ts
  /**
   * Construction points one fully-staffed Construction Centre level adds to its faction's pool per
   * reference month. Set well above what the level's own labour draw would yield as eligible heads
   * (25 heads × THROUGHPUT_PER_POP ≈ 1.25), so substituting capital + technicians for raw labour pays.
   */
  POINTS_PER_LEVEL: 5,
  /** Reference months of point output a centre's value is amortised over (the ROI numerator horizon). */
  PAYBACK_HORIZON: 12,
  /** Reference months of pool drain that define the funding frontier — work beyond it is "starved". */
  BACKLOG_WINDOW: 6,
```

`lib/constants/building-descriptions.ts` — import `CONSTRUCTION_CENTRE_TYPE`; add to `BUILDING_DESCRIPTIONS`:

```ts
  [CONSTRUCTION_CENTRE_TYPE]:
    "Construction centre — industrial fabricators, yards, and heavy plant. Adds capital-generated construction points to the faction's build pool, substituting for the raw labour a skilled economy absorbs into its factories. Draws unskilled labour and technicians to run; decays when it cannot be staffed.",
```

`lib/world/types.ts:141` — update the `buildingType` comment to:

```ts
  /** Production-good type id, or a non-production type: "housing", an academy, a specialisation complex, or "construction_centre". */
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/constants lib/engine/__tests__/construction.test.ts`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add lib/constants lib/world/types.ts lib/engine/__tests__/construction.test.ts
git commit -m "feat(econ): Construction Centre building type + pool/valuation knobs"
```

---

### Task 2: Engine — eligible-heads pool with centre output

**Files:**
- Modify: `lib/engine/construction.ts:21-30` (replace `factionThroughputPool`)
- Test: `lib/engine/__tests__/construction.test.ts:19-33` (replace the `factionThroughputPool` describe)

**Interfaces:**
- Produces (exact, later tasks depend on these):

```ts
export interface ConstructionPoolSystem {
  control: SystemControl;
  population: number;
  buildings: Record<string, number>;
}
export interface ConstructionPoolRates {
  /** Points per eligible head per pulse. Callers pre-scale by catchUp for funding use. */
  throughputPerPop: number;
  /** Points one fully-staffed centre level adds per pulse. Same pre-scaling rule. */
  pointsPerLevel: number;
}
export interface ConstructionPool {
  /** Eligible-heads base: Σ (unskilled + unemployed) × throughputPerPop over developed systems. */
  base: number;
  /** Centre output: Σ levels × pointsPerLevel × min(labourFulfil, skill1Fulfil). */
  centres: number;
  total: number;
}
export function factionConstructionPool(
  systems: ConstructionPoolSystem[],
  rates: ConstructionPoolRates,
): ConstructionPool
```

- Consumes: `computeLabourAllocation`, `labourParts`, `labourStateFromParts` from `@/lib/engine/industry`; `CONSTRUCTION_CENTRE_TYPE` from `@/lib/constants/industry`; `isEconomicallyActive` (already imported).
- **The old `factionThroughputPool` is deleted** (no dual pool paths). Its two other callers — `lib/engine/construction-readout.ts` and `lib/tick/processors/directed-build.ts` — are migrated in Tasks 4 and 5; between this task and those, `npx tsc --noEmit` fails, which is why Tasks 2→5 land as one PR. Run only targeted vitest files until Task 5.

- [ ] **Step 1: Write the failing tests**

Replace the `factionThroughputPool` describe in `lib/engine/__tests__/construction.test.ts` with (import `factionConstructionPool` instead; import `CONSTRUCTION_CENTRE_TYPE`, `VOCATIONAL_SCHOOL_TYPE`, `SKILL1_PER_SCHOOL` from `@/lib/constants/industry`):

```ts
describe("factionConstructionPool", () => {
  const rates = { throughputPerPop: 0.05, pointsPerLevel: 5 };

  it("counts every head at a system with no skilled employment (young economy unchanged)", () => {
    const systems = [
      { control: "developed" as const, population: 100, buildings: {} },
      { control: "controlled" as const, population: 50, buildings: {} },  // inert
      { control: "developed" as const, population: 200, buildings: {} },
    ];
    const pool = factionConstructionPool(systems, rates);
    expect(pool.base).toBeCloseTo((100 + 200) * 0.05);
    expect(pool.centres).toBe(0);
    expect(pool.total).toBeCloseTo(pool.base);
  });

  it("removes employed technicians/engineers from the base, but not licensed-but-jobless heads", () => {
    // metals: labour { unskilled: 18, skill1: 7 } (tier-1 default). One school licenses 150 skill-1 seats.
    // 2 metals factories demand 14 technician heads; the school itself draws 15 unskilled.
    const employed = {
      control: "developed" as const,
      population: 200,
      buildings: { metals: 2, [VOCATIONAL_SCHOOL_TYPE]: 1 },
    };
    // Same licences, no skilled jobs: graduates still swing hammers — full population counts.
    const jobless = {
      control: "developed" as const,
      population: 200,
      buildings: { [VOCATIONAL_SCHOOL_TYPE]: 1 },
    };
    const withJobs = factionConstructionPool([employed], rates);
    const withoutJobs = factionConstructionPool([jobless], rates);
    expect(withJobs.base).toBeCloseTo((200 - 14) * 0.05); // 14 technician heads employed
    expect(withoutJobs.base).toBeCloseTo(200 * 0.05);     // licences alone cost nothing
  });

  it("adds centre output scaled by staffing fulfilment (labour and technician gates)", () => {
    // 1 centre: 25 heads (18 unskilled + 7 skill1); a school licenses its technicians; pop staffs fully.
    const staffed = {
      control: "developed" as const,
      population: 200,
      buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1, [VOCATIONAL_SCHOOL_TYPE]: 1 },
    };
    const full = factionConstructionPool([staffed], rates);
    expect(full.centres).toBeCloseTo(5); // 1 level × 5 × fulfilment 1
    // The centre's own technicians are employed heads — they leave the base.
    expect(full.base).toBeCloseTo((200 - 7) * 0.05);
    expect(full.total).toBeCloseTo(full.base + full.centres);

    // No school → skill1Fulfil = 0 → centre produces nothing.
    const unlicensed = {
      control: "developed" as const,
      population: 200,
      buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1 },
    };
    expect(factionConstructionPool([unlicensed], rates).centres).toBe(0);

    // Half the heads → labourFulfil scales output down proportionally.
    const short = {
      control: "developed" as const,
      population: 20, // demand = 25 (centre) + 15 (school) = 40 → labourFulfil = 0.5
      buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1, [VOCATIONAL_SCHOOL_TYPE]: 1 },
    };
    expect(factionConstructionPool([short], rates).centres).toBeCloseTo(5 * 0.5);
  });

  it("floors negative population at zero", () => {
    expect(
      factionConstructionPool(
        [{ control: "developed" as const, population: -10, buildings: {} }],
        rates,
      ).total,
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts`
Expected: FAIL — `factionConstructionPool` is not exported.

- [ ] **Step 3: Implement**

In `lib/engine/construction.ts`, replace `factionThroughputPool` (lines 14–30) with:

```ts
import { computeLabourAllocation, labourParts, labourStateFromParts } from "@/lib/engine/industry";
import { CONSTRUCTION_CENTRE_TYPE } from "@/lib/constants/industry";
```

(add to the existing imports at the top), then:

```ts
/** The per-system fields the pool reads: ownership tier, headcount, and the built base. */
export interface ConstructionPoolSystem {
  control: SystemControl;
  population: number;
  buildings: Record<string, number>;
}

/** Per-pulse point rates. Callers scale both by catchUp when funding (they are pulse incomes). */
export interface ConstructionPoolRates {
  /** Construction points per eligible head per pulse. */
  throughputPerPop: number;
  /** Construction points one fully-staffed Construction Centre level adds per pulse. */
  pointsPerLevel: number;
}

/** A faction's pool, split by source — base (eligible heads) and centre (capital) output. */
export interface ConstructionPool {
  base: number;
  centres: number;
  total: number;
}

/**
 * A faction's per-pulse construction pool over its economically-active (developed) systems.
 *
 * The base is ELIGIBLE heads, not raw headcount: population minus the heads actually employed in
 * technician/engineer jobs (`computeLabourAllocation` — employment-bounded, so a licensed head with
 * no skilled job still builds). An industrialising faction's base erodes as skilled jobs absorb
 * heads; Construction Centres substitute capital for that lost labour, adding
 * `levels × pointsPerLevel × min(labourFulfil, skill1Fulfil)` (the centre's own staffing gate —
 * headcount plus its technician draw). Controlled/unclaimed systems are inert (population 0) and
 * contribute nothing. This remains the single pacing meter: the planner proposes toward physical
 * ceilings; this pool decides how fast fundQueue drains the queue.
 */
export function factionConstructionPool(
  systems: ConstructionPoolSystem[],
  rates: ConstructionPoolRates,
): ConstructionPool {
  let base = 0;
  let centres = 0;
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    const parts = labourParts(s.buildings);
    const alloc = computeLabourAllocation(parts, s.population);
    base += (alloc.unskilled + alloc.unemployed) * rates.throughputPerPop;
    const count = s.buildings[CONSTRUCTION_CENTRE_TYPE] ?? 0;
    if (count > 0) {
      const state = labourStateFromParts(parts, s.population);
      centres += count * rates.pointsPerLevel * Math.min(state.labourFulfil, state.skill1Fulfil);
    }
  }
  return { base, centres, total: base + centres };
}
```

(Import-cycle check: `engine/industry.ts` does not import `engine/construction.ts`, so this is safe.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts`
Expected: PASS. (`tsc` is expected to fail repo-wide until Tasks 4–5 migrate the other two callers — do not run the full gate yet.)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/construction.ts lib/engine/__tests__/construction.test.ts
git commit -m "feat(econ): eligible-heads construction pool with centre output"
```

---

### Task 3: Engine — frontier-ROI centre valuation

**Files:**
- Create: `lib/engine/construction-centre.ts`
- Test: `lib/engine/__tests__/construction-centre.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CentreValuationParams {
  /** CONSTRUCTION.POINTS_PER_LEVEL — unscaled reference-month rate. */
  pointsPerLevel: number;
  /** CONSTRUCTION.PAYBACK_HORIZON — reference months of output the value amortises. */
  paybackHorizon: number;
  /** CONSTRUCTION.BACKLOG_WINDOW — reference months of pool drain defining the frontier. */
  backlogWindow: number;
}
export function planCentreProposal(
  factionId: string,
  ordered: Proposal[],                       // this pulse's proposals, already in funding order
  openProjects: WorldConstructionProject[],  // the faction's in-flight queue (funds first)
  systems: BuildSystemState[],               // the faction's build states (siting)
  pool: number,                              // UNSCALED reference-month pool (ConstructionPool.total)
  params: CentreValuationParams,
): BuildProposal | null
```

- Consumes: `Proposal`, `BuildProposal`, `BuildSystemState` (types) from `@/lib/engine/directed-build`; `proposalRoi` from `@/lib/engine/construction`; `labourDemand`, `generalSpaceUsed` from `@/lib/engine/industry`; `isEconomicallyActive` from `@/lib/engine/control`; `CONSTRUCTION_CENTRE_TYPE`, `effectiveSpaceCost`, `BUILDING_TYPES` from `@/lib/constants/industry`; `workCostPerLevel` from `@/lib/constants/construction`.

Semantics locked here (each is a test):
1. **In-flight gate:** any open `build` project of the centre type for this faction → `null`. (With Task 4's persist-if-funded, "in flight" means a centre that has actually received work.)
2. **Frontier:** `budget = pool × backlogWindow`. Walk the funding order — first `Σ max(0, workTotal − workDone)` over `openProjects`, then each ordered proposal's `work` — and a proposal is *beyond the frontier* when the cumulative work **through it** exceeds `budget`. `r` = max `proposalRoi` among beyond-frontier proposals; `r ≤ 0` (backlog drains, or only zero-value housing is starved) → `null`.
3. **Value:** `value = pointsPerLevel × r × paybackHorizon`, `work = workCostPerLevel(CONSTRUCTION_CENTRE_TYPE)`, one item `{ buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1 }`, `role: "industry"`, `kind: "build"`.
4. **Siting:** among developed systems whose *remaining* general space — after subtracting space already committed by open build projects and this pulse's proposals (tier-0 items excluded; they sit on deposit slots) — fits the centre footprint: pick max spare labour `max(0, population − labourDemand(buildings))`; ties → more remaining space; then lowest `systemId`. No eligible site → `null`.

- [ ] **Step 1: Write the failing tests**

Create `lib/engine/__tests__/construction-centre.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planCentreProposal } from "@/lib/engine/construction-centre";
import type { Proposal, BuildSystemState } from "@/lib/engine/directed-build";
import type { WorldConstructionProject } from "@/lib/world/types";
import { workCostPerLevel } from "@/lib/constants/construction";
import { CONSTRUCTION_CENTRE_TYPE } from "@/lib/constants/industry";
import { emptyResourceVector } from "@/lib/engine/resources";

const PARAMS = { pointsPerLevel: 5, paybackHorizon: 12, backlogWindow: 6 };

function system(systemId: string, population: number, generalSpace = 50): BuildSystemState {
  return {
    systemId, factionId: "f1", control: "developed", population, unrest: 0,
    buildings: {}, slotCap: emptyResourceVector(), generalSpace, habitableSpace: 10, goods: [],
  };
}

function proposal(systemId: string, value: number, work: number): Proposal {
  return { kind: "build", factionId: "f1", systemId, role: "industry",
    items: [{ buildingType: "metals", levels: 1 }], value, work };
}

function centreProject(workDone = 1): WorldConstructionProject {
  return { kind: "build", id: "c1", factionId: "f1", systemId: "s1",
    buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1,
    workTotal: workCostPerLevel(CONSTRUCTION_CENTRE_TYPE), workDone };
}

describe("planCentreProposal", () => {
  it("emits a centre priced off the best starved ROI when valuable work sits beyond the frontier", () => {
    // pool 10 × window 6 = 60 budget. First proposal (work 50) fits; the second (work 50, roi 2) starts
    // inside but its cumulative 100 > 60 → beyond the frontier.
    const ordered = [proposal("s1", 25, 50), proposal("s1", 100, 50)];
    const p = planCentreProposal("f1", ordered, [], [system("s1", 500)], 10, PARAMS);
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(p.items).toEqual([{ buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1 }]);
    expect(p.work).toBe(workCostPerLevel(CONSTRUCTION_CENTRE_TYPE));
    expect(p.value).toBeCloseTo(5 * (100 / 50) * 12); // pointsPerLevel × r × horizon
    expect(p.role).toBe("industry");
  });

  it("returns null when the backlog drains inside the window", () => {
    const ordered = [proposal("s1", 25, 50)]; // 50 ≤ 10 × 6 — everything funds in time
    expect(planCentreProposal("f1", ordered, [], [system("s1", 500)], 10, PARAMS)).toBeNull();
  });

  it("counts in-flight remaining work toward the frontier", () => {
    // 55 remaining in-flight + a 10-work proposal = 65 > 60 → that proposal is starved.
    const open: WorldConstructionProject[] = [{ kind: "build", id: "b1", factionId: "f1",
      systemId: "s1", buildingType: "metals", levels: 3, workTotal: 60, workDone: 5 }];
    const ordered = [proposal("s1", 30, 10)];
    const p = planCentreProposal("f1", ordered, open, [system("s1", 500)], 10, PARAMS);
    expect(p).not.toBeNull();
  });

  it("returns null while a centre project is already in flight", () => {
    const ordered = [proposal("s1", 100, 50), proposal("s1", 100, 50)];
    expect(planCentreProposal("f1", ordered, [centreProject()], [system("s1", 500)], 1, PARAMS)).toBeNull();
  });

  it("sites at the developed system with the most spare labour, tie-broken by systemId", () => {
    // s2 has more spare labour (no buildings anywhere → spare = population).
    const ordered = [proposal("s1", 100, 50), proposal("s1", 100, 50)];
    const p = planCentreProposal("f1", ordered, [], [system("s1", 100), system("s2", 300)], 1, PARAMS);
    expect(p?.systemId).toBe("s2");
    // Exact tie on spare labour and space → lowest systemId.
    const tied = planCentreProposal("f1", ordered, [], [system("s2", 300), system("s1", 300)], 1, PARAMS);
    expect(tied?.systemId).toBe("s1");
  });

  it("returns null when no developed system has general space for the centre", () => {
    const ordered = [proposal("s1", 100, 50), proposal("s1", 100, 50)];
    expect(planCentreProposal("f1", ordered, [], [system("s1", 500, 0.5)], 1, PARAMS)).toBeNull();
  });

  it("ignores zero-value (housing) proposals when picking the frontier ROI", () => {
    const housing: Proposal = { kind: "build", factionId: "f1", systemId: "s1", role: "housing",
      items: [{ buildingType: "housing", levels: 10 }], value: 0, work: 80 };
    expect(planCentreProposal("f1", [housing], [], [system("s1", 500)], 1, PARAMS)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/construction-centre.test.ts`
Expected: FAIL — module `@/lib/engine/construction-centre` does not exist.

- [ ] **Step 3: Implement**

Create `lib/engine/construction-centre.ts`:

```ts
/**
 * Pure Construction Centre valuation — zero DB dependency.
 *
 * A centre serves no market demand, so it carries no invented value: a construction point is worth
 * the best work the pool can't yet fund. Per faction per pulse, the backlog (in-flight projects +
 * this pulse's ordered proposals) is walked in funding order against the work the pool drains within
 * BACKLOG_WINDOW reference months; the best ROI beyond that frontier prices at most ONE centre
 * proposal, which then competes on the ordinary ROI ordering. Emergent, self-limiting: a deep
 * valuable backlog funds a centre; a draining queue or junk backlog never does; a landed centre
 * grows the pool and pushes the frontier out. All quantities here are reference-month units — the
 * caller passes the UNSCALED pool (catchUp scaling is a funding concern, not a valuation one).
 */
import type { WorldConstructionProject } from "@/lib/world/types";
import type { BuildProposal, BuildSystemState, Proposal } from "@/lib/engine/directed-build";
import { proposalRoi } from "@/lib/engine/construction";
import { generalSpaceUsed, labourDemand } from "@/lib/engine/industry";
import { isEconomicallyActive } from "@/lib/engine/control";
import { BUILDING_TYPES, CONSTRUCTION_CENTRE_TYPE, effectiveSpaceCost } from "@/lib/constants/industry";
import { workCostPerLevel } from "@/lib/constants/construction";

export interface CentreValuationParams {
  /** Points one fully-staffed centre level yields per reference month (CONSTRUCTION.POINTS_PER_LEVEL). */
  pointsPerLevel: number;
  /** Reference months of output the centre's value amortises (CONSTRUCTION.PAYBACK_HORIZON). */
  paybackHorizon: number;
  /** Reference months of pool drain that define the funding frontier (CONSTRUCTION.BACKLOG_WINDOW). */
  backlogWindow: number;
}

/** General space a queued build order will consume when it lands. Tier-0 sits on deposit slots → 0. */
function queuedSpace(buildingType: string, levels: number): number {
  if (BUILDING_TYPES[buildingType]?.resource) return 0;
  return levels * effectiveSpaceCost(buildingType);
}

/**
 * Price and site at most one Construction Centre proposal for a faction this pulse, or null when the
 * backlog drains inside the window, a centre is already in flight, or no developed system can host
 * one. `ordered` is this pulse's proposals in funding order; `pool` is the faction's unscaled
 * reference-month construction pool.
 */
export function planCentreProposal(
  factionId: string,
  ordered: Proposal[],
  openProjects: WorldConstructionProject[],
  systems: BuildSystemState[],
  pool: number,
  params: CentreValuationParams,
): BuildProposal | null {
  // One centre in flight at a time — the landed pool growth must re-price the next one.
  if (openProjects.some((p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE)) {
    return null;
  }

  // Frontier: cumulative work in funding order (in-flight first) vs the window's drainable budget.
  // A proposal whose cumulative work exceeds the budget cannot fund inside the window — starved.
  const budget = Math.max(0, pool) * params.backlogWindow;
  let cumulative = 0;
  for (const p of openProjects) cumulative += Math.max(0, p.workTotal - p.workDone);
  let bestStarvedRoi = 0;
  for (const p of ordered) {
    cumulative += p.work;
    if (cumulative > budget) bestStarvedRoi = Math.max(bestStarvedRoi, proposalRoi(p));
  }
  if (bestStarvedRoi <= 0) return null;

  // Siting: the developed system with the most spare labour that can physically host the centre,
  // net of space already committed by the queue and this pulse's proposals. Deterministic: spare
  // labour desc → remaining space desc → systemId asc.
  const committedSpace = new Map<string, number>();
  for (const p of openProjects) {
    if (p.kind !== "build") continue;
    committedSpace.set(p.systemId, (committedSpace.get(p.systemId) ?? 0) + queuedSpace(p.buildingType, p.levels));
  }
  for (const p of ordered) {
    if (p.kind !== "build") continue;
    let space = 0;
    for (const item of p.items) space += queuedSpace(item.buildingType, item.levels);
    committedSpace.set(p.systemId, (committedSpace.get(p.systemId) ?? 0) + space);
  }

  const footprint = effectiveSpaceCost(CONSTRUCTION_CENTRE_TYPE);
  let site: { systemId: string; spare: number; space: number } | null = null;
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    const space = s.generalSpace - generalSpaceUsed(s.buildings) - (committedSpace.get(s.systemId) ?? 0);
    if (space < footprint) continue;
    const spare = Math.max(0, s.population - labourDemand(s.buildings));
    if (
      site === null ||
      spare > site.spare ||
      (spare === site.spare && (space > site.space || (space === site.space && s.systemId < site.systemId)))
    ) {
      site = { systemId: s.systemId, spare, space };
    }
  }
  if (site === null) return null;

  return {
    kind: "build",
    factionId,
    systemId: site.systemId,
    role: "industry",
    items: [{ buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1 }],
    value: params.pointsPerLevel * bestStarvedRoi * params.paybackHorizon,
    work: workCostPerLevel(CONSTRUCTION_CENTRE_TYPE),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/construction-centre.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/construction-centre.ts lib/engine/__tests__/construction-centre.test.ts
git commit -m "feat(econ): frontier-ROI Construction Centre valuation"
```

---

### Task 4: Processor integration — pool, centre proposal, persist-if-funded

**Files:**
- Modify: `lib/tick/processors/directed-build.ts` (params + faction loop)
- Modify: `lib/world/tick.ts:804-811` (thread the three new knobs)
- Test: `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- `DirectedBuildProcessorParams.construction` gains `pointsPerLevel: number`, `paybackHorizon: number`, `backlogWindow: number` (all unscaled reference-month values; the processor owns catchUp scaling).
- Consumes: `factionConstructionPool` (Task 2), `planCentreProposal` (Task 3), `CONSTRUCTION_CENTRE_TYPE`.

- [ ] **Step 1: Write the failing tests**

In `lib/tick/processors/__tests__/directed-build.test.ts`, extend `mkConstruction` (line 21) so every existing call keeps working:

```ts
function mkConstruction(
  cap = 1000,
  throughputPerPop = 0.05,
  floorBase: number = CONSTRUCTION.POOL_FLOOR_BASE,
  floorKnee: number = CONSTRUCTION.FLOOR_DEV_KNEE,
) {
  let n = 0;
  return {
    cap, throughputPerPop, floorBase, floorKnee,
    pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL,
    paybackHorizon: CONSTRUCTION.PAYBACK_HORIZON,
    backlogWindow: CONSTRUCTION.BACKLOG_WINDOW,
    mintId: () => `proj-${n++}`,
  };
}
```

Fix the one inline literal at line ~111 the same way (spread `mkConstruction()` fields or add the three knobs).

Add a describe (adapt the scenario helpers already in the file — the test needs a world whose faction has a deficit-driven backlog far larger than its pool):

```ts
describe("construction centres", () => {
  it("commits a centre project when the backlog runs beyond the frontier", async () => {
    // Deficit scenario with the pool throttled so committed work vastly outruns what BACKLOG_WINDOW
    // pulses can drain (tiny throughputPerPop → deep starved backlog → a centre is proposed), and a
    // SMALL cap so the pool spreads across parallel fronts — the high-ROI centre must actually
    // receive work this pulse, because persist-if-funded drops a workless centre (next test).
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: { ...mkConstruction(2, 0.001) },
    });
    const centres = w.constructionProjects.filter(
      (p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE,
    );
    expect(centres.length).toBeGreaterThanOrEqual(1);
  });

  it("drops an unfunded centre project instead of persisting it (persist-if-funded)", async () => {
    // Same starved world, pool ≈ 0: the centre proposal is committed but receives no work, so it
    // must NOT appear in the persisted open set.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: { ...mkConstruction(1000, 0) }, // zero pool: nothing funds
    });
    const centres = w.constructionProjects.filter(
      (p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE,
    );
    expect(centres).toHaveLength(0);
  });
});
```

(Exact scenario-helper names/args: read the top of the test file and mirror the existing `scenario(...)`/`MemoryDirectedBuildWorld` usage — the two tests above state the required world shape in their comments. With `throughputPerPop = 0`, note the frontier check uses `pool = 0` → budget 0 → all ROI-carrying proposals are starved, so a centre IS proposed, gets no funding, and must be dropped. For the first test, verify while writing it that the scenario's proposed backlog work actually exceeds `pool × BACKLOG_WINDOW` and that the centre receives work under the small cap — tune the `throughputPerPop`/cap pair until both hold; the invariant under test is "deep starved backlog ⇒ a centre is committed and persists once funded", not the specific magnitudes.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: FAIL — TypeScript: unknown properties `pointsPerLevel`/…, and the centre assertions fail.

- [ ] **Step 3: Implement the processor changes**

`lib/tick/processors/directed-build.ts`:

1. Imports — replace `factionThroughputPool` with `factionConstructionPool` in the `@/lib/engine/construction` import; add:

```ts
import { planCentreProposal } from "@/lib/engine/construction-centre";
import { CONSTRUCTION_CENTRE_TYPE } from "@/lib/constants/industry";
```

2. `DirectedBuildProcessorParams.construction` — add after `floorKnee`:

```ts
    /** Points one fully-staffed Construction Centre level adds per reference month. */
    pointsPerLevel: number;
    /** Reference months of centre output its proposal value amortises. */
    paybackHorizon: number;
    /** Reference months of pool drain defining the centre-valuation frontier. */
    backlogWindow: number;
```

3. In the faction loop, replace the pool line (`lib/tick/processors/directed-build.ts:158`) with:

```ts
    // The faction's per-pulse pool: eligible heads + centre output over developed systems
    // (controlled/unclaimed are inert). Valuation reads the unscaled reference-month pool;
    // funding scales it by catchUp like every pulse income. The pool drains the queue; it
    // never enqueues.
    const poolRef = factionConstructionPool(
      group.map((r) => ({ control: r.control, population: r.population, buildings: r.buildings })),
      {
        throughputPerPop: params.construction.throughputPerPop,
        pointsPerLevel: params.construction.pointsPerLevel,
      },
    );
    const pool = poolRef.total * catchUp;
```

4. Replace the `const ordered = orderProposals(...)` line (currently line 194) with:

```ts
    let ordered = orderProposals([...buildProposals, ...colonyProposals]);

    // At most one centre proposal per pulse, priced off the backlog frontier; it re-enters the
    // ROI ordering as a normal proposal (independent systems — null faction — never build centres).
    if (factionId !== null) {
      const centre = planCentreProposal(factionId, ordered, existing, buildStates, poolRef.total, {
        pointsPerLevel: params.construction.pointsPerLevel,
        paybackHorizon: params.construction.paybackHorizon,
        backlogWindow: params.construction.backlogWindow,
      });
      if (centre) ordered = orderProposals([...ordered, centre]);
    }
```

5. In the persist loop (currently line 235–242), extend the persist-if-funded rule:

```ts
    for (const p of fundedOpen) {
      // Persist-if-funded for colonies AND centres: a project of either kind that got NO work this
      // pulse is dropped and re-scored next pulse — colonies so the open queue never balloons,
      // centres so their frontier price stays live instead of a stale commitment queue-jumping
      // later pulses. In-flight rows always have workDone > 0, so they persist. Ordinary builds
      // persist regardless (their in-flight subtraction already bounds them).
      if (p.kind === "colony_establish" && p.workDone <= 0) continue;
      if (p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE && p.workDone <= 0) continue;
      nextOpen.push(p);
    }
```

6. `lib/world/tick.ts` (~line 804) — add the three knobs:

```ts
        construction: {
          cap: CONSTRUCTION.PER_BUILD_ABSORPTION_CAP,
          throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP,
          floorBase: CONSTRUCTION.POOL_FLOOR_BASE,
          floorKnee: CONSTRUCTION.FLOOR_DEV_KNEE,
          pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL,
          paybackHorizon: CONSTRUCTION.PAYBACK_HORIZON,
          backlogWindow: CONSTRUCTION.BACKLOG_WINDOW,
          // Project ids draw from the world's monotonic counter, threaded through this tick.
          mintId: () => `construction-${nextId++}`,
        },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts lib/engine`
Expected: PASS (including all pre-existing processor tests — the pool change can shift magnitudes in tests that pinned exact pool values; if one pins `pop × 0.05` exactly at a system whose fixture has skilled employment, re-derive the expected value from eligible heads rather than loosening the assertion).

- [ ] **Step 5: Commit**

```bash
git add lib/tick/processors/directed-build.ts lib/world/tick.ts lib/tick/processors/__tests__/directed-build.test.ts
git commit -m "feat(tick): eligible-heads pool + centre planning in directed-build"
```

---

### Task 5: Readout, service, and labels

**Files:**
- Modify: `lib/engine/construction-readout.ts` (`ConstructionSystemInfo`, `computeFactionConstruction`, `buildingLabel`, `describeBuildProject`, `FactionConstructionReadout`)
- Modify: `lib/services/construction.ts` (join buildings; new call shape; expose composition)
- Modify: `components/system/industry-panel.tsx:76-79` (label map)
- Test: `lib/engine/__tests__/construction-readout.test.ts`

**Interfaces:**
- `ConstructionSystemInfo` gains `buildings: Record<string, number>`.
- `computeFactionConstruction(projects, systems, rates: ConstructionPoolRates, cap)` — third parameter changes from `throughputPerPop: number` to the Task 2 `ConstructionPoolRates`.
- `FactionConstructionReadout` gains `poolBase: number` and `poolCentres: number` (`pool` stays the total — every ETA consumer keeps working). The service's `FactionConstructionData` passes both through (PR B renders them).

- [ ] **Step 1: Write the failing tests**

In `lib/engine/__tests__/construction-readout.test.ts`: every fixture system gains `buildings: {}` and every `computeFactionConstruction(..., 0.05, 4)` call becomes `computeFactionConstruction(..., { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4)` (the zero-pool test's `0` becomes `{ throughputPerPop: 0, pointsPerLevel: 0 }`). Add:

```ts
  it("splits the pool into base and centre components", () => {
    const systems = [
      { id: "s1", name: "Alpha", control: "developed" as const, population: 200,
        buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1, [VOCATIONAL_SCHOOL_TYPE]: 1 } },
    ];
    const r = computeFactionConstruction([], systems, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4);
    expect(r.poolCentres).toBeCloseTo(5);          // fully staffed centre
    expect(r.poolBase).toBeCloseTo((200 - 7) * 0.05); // its technicians left the base
    expect(r.pool).toBeCloseTo(r.poolBase + r.poolCentres);
  });

  it("labels a centre build project", () => {
    expect(buildingLabel(CONSTRUCTION_CENTRE_TYPE)).toBe("Construction Centre");
    expect(describeBuildProject(CONSTRUCTION_CENTRE_TYPE)).toContain("construction");
  });
```

(imports: `CONSTRUCTION_CENTRE_TYPE`, `VOCATIONAL_SCHOOL_TYPE` from `@/lib/constants/industry`; `buildingLabel`, `describeBuildProject` are already exported.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/construction-readout.test.ts`
Expected: FAIL — type errors on the new signature / missing fields.

- [ ] **Step 3: Implement**

`lib/engine/construction-readout.ts`:

```ts
import {
  factionConstructionPool, forecastEtaPulses, fundQueue, type ConstructionPoolRates,
} from "@/lib/engine/construction";
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, CONSTRUCTION_CENTRE_TYPE, COMPLEX_BY_TYPE,
} from "@/lib/constants/industry";
```

`ConstructionSystemInfo` gains:

```ts
  /** Built base — feeds the eligible-heads pool split and centre output. */
  buildings: Record<string, number>;
```

`FactionConstructionReadout` — replace the `pool` doc comment and add the split:

```ts
  /** Total per-pulse funding rate (base + centres) — the value the ETA forecast runs on. */
  pool: number;
  /** Eligible-heads component of the pool (population not employed in skilled work). */
  poolBase: number;
  /** Construction Centre component of the pool (capital-generated points). */
  poolCentres: number;
```

`computeFactionConstruction` — signature + pool lines:

```ts
export function computeFactionConstruction(
  projects: WorldConstructionProject[],
  systems: ConstructionSystemInfo[],
  rates: ConstructionPoolRates,
  cap: number,
): FactionConstructionReadout {
  const nameById = new Map(systems.map((s) => [s.id, s.name]));
  const poolParts = factionConstructionPool(systems, rates);
  const pool = poolParts.total;
```

…and include `poolBase: poolParts.base, poolCentres: poolParts.centres` in the returned object next to `pool`.

`buildingLabel` — add before the complex/goods fallback:

```ts
  if (buildingType === CONSTRUCTION_CENTRE_TYPE) return "Construction Centre";
```

`describeBuildProject` — add:

```ts
  if (buildingType === CONSTRUCTION_CENTRE_TYPE) return "construction · adds faction build throughput";
```

`lib/services/construction.ts` — read the file fully first; it maps `world.systems` to `ConstructionSystemInfo`. Group buildings once (grep `lib/services` for an existing buildings-by-system helper and reuse it if one exists; otherwise inline):

```ts
  const buildingsBySystem = new Map<string, Record<string, number>>();
  for (const b of world.buildings) {
    if (b.count <= 0) continue;
    const rec = buildingsBySystem.get(b.systemId) ?? {};
    rec[b.buildingType] = b.count;
    buildingsBySystem.set(b.systemId, rec);
  }
  const systems: ConstructionSystemInfo[] = world.systems
    .filter((s) => s.factionId === factionId)
    .map((s) => ({
      id: s.id, name: s.name, control: s.control, population: s.population,
      buildings: buildingsBySystem.get(s.id) ?? {},
    }));
```

…and the call becomes:

```ts
  return computeFactionConstruction(
    projects, systems,
    { throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP, pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL },
    CONSTRUCTION.PER_BUILD_ABSORPTION_CAP,
  );
```

Then extend `FactionConstructionData`/`getFactionConstruction` (same file or its type home — follow the existing shape) to pass `poolBase`/`poolCentres` through alongside `pool`.

`components/system/industry-panel.tsx` — the non-good label map (line 76) gains the centre; rename it honestly:

```tsx
/** Non-good building types aren't in GOODS — name them explicitly. */
const NON_GOOD_LABELS: Record<string, string> = {
  [VOCATIONAL_SCHOOL_TYPE]: "Vocational School",
  [RESEARCH_INSTITUTE_TYPE]: "Research Institute",
  [CONSTRUCTION_CENTRE_TYPE]: "Construction Centre",
};
```

(and update its usages in the file — search `ACADEMY_LABELS`).

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: full suite PASS; tsc clean — this is the task where the last `factionThroughputPool` reference disappears, so the whole repo must compile now.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/construction-readout.ts lib/services/construction.ts components/system/industry-panel.tsx lib/engine/__tests__/construction-readout.test.ts
git commit -m "feat(econ): pool composition in construction readout + centre labels"
```

---

### Task 6: Harness metric — pool composition + queue ETA

**Files:**
- Modify: `lib/tick-harness/build-analysis.ts` (centre in `breakdown`/`projectKind`; new `summarizeConstructionPool`)
- Modify: `scripts/simulate.ts` (print block after the colonisation section, ~line 267)
- Test: `lib/tick-harness/__tests__/build-analysis.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ConstructionPoolSummary {
  poolBase: number;
  poolCentres: number;
  /** poolCentres / (poolBase + poolCentres); 0 when the pool is empty. */
  centreShare: number;
  /** Built centre levels across developed systems. */
  centreLevels: number;
  /** Open centre build projects. */
  centreProjects: number;
  /** Σ max(0, workTotal − workDone) over all open projects. */
  queueRemainingWork: number;
  /** Pulses to drain the whole open queue at the current total pool; null when the pool is 0. */
  queueEtaPulses: number | null;
}
export function summarizeConstructionPool(
  systems: TickSystem[],
  projects: WorldConstructionProject[],
): ConstructionPoolSummary
```

- Consumes: `factionConstructionPool` (pool composition aggregates linearly over developed systems, so one call over all systems equals the per-faction sum), `CONSTRUCTION` knobs, `CONSTRUCTION_CENTRE_TYPE`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/tick-harness/__tests__/build-analysis.test.ts` (mirror the file's existing `TickSystem` fixture helper; import `summarizeConstructionPool`, `CONSTRUCTION_CENTRE_TYPE`, `CONSTRUCTION`, `workCostPerLevel`):

```ts
describe("summarizeConstructionPool", () => {
  it("splits base vs centre points and derives the queue ETA", () => {
    // One developed system, 200 pop, 1 staffed centre + school (matches the engine test's fixture).
    const sys = developedSystem({ population: 200,
      buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1, vocational_school: 1 } });
    const projects: WorldConstructionProject[] = [
      { kind: "build", id: "p1", factionId: "f1", systemId: sys.id, buildingType: "metals",
        levels: 2, workTotal: 40, workDone: 10 },
    ];
    const s = summarizeConstructionPool([sys], projects);
    expect(s.poolCentres).toBeCloseTo(CONSTRUCTION.POINTS_PER_LEVEL);
    expect(s.poolBase).toBeCloseTo((200 - 7) * CONSTRUCTION.THROUGHPUT_PER_POP);
    expect(s.centreShare).toBeCloseTo(s.poolCentres / (s.poolBase + s.poolCentres));
    expect(s.centreLevels).toBe(1);
    expect(s.queueRemainingWork).toBe(30);
    expect(s.queueEtaPulses).toBeCloseTo(30 / (s.poolBase + s.poolCentres));
  });

  it("reports a null ETA when nothing funds the queue", () => {
    const s = summarizeConstructionPool([], [
      { kind: "build", id: "p1", factionId: "f1", systemId: "x", buildingType: "metals",
        levels: 1, workTotal: 20, workDone: 0 },
    ]);
    expect(s.queueEtaPulses).toBeNull();
    expect(s.queueRemainingWork).toBe(20);
  });

  it("counts open centre projects under kind 'centre'", () => {
    const summary = summarizeColonisation([], new Set(), [
      { kind: "build", id: "c1", factionId: "f1", systemId: "x",
        buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1,
        workTotal: workCostPerLevel(CONSTRUCTION_CENTRE_TYPE), workDone: 0 },
    ]);
    expect(summary.queue.colonyByKind["centre"]).toBe(1);
  });
});
```

(`developedSystem` = whatever fixture helper the file already uses for `TickSystem`s — reuse it; if none fits, build the minimal `TickSystem` literal the existing tests use.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tick-harness/__tests__/build-analysis.test.ts`
Expected: FAIL — `summarizeConstructionPool` not exported; `colonyByKind["centre"]` lands in `"other"`.

- [ ] **Step 3: Implement**

`lib/tick-harness/build-analysis.ts`:

1. Imports: add `CONSTRUCTION_CENTRE_TYPE` to the industry import; add `factionConstructionPool` from `@/lib/engine/construction` and `CONSTRUCTION` from `@/lib/constants/construction`.
2. `BuildBreakdown` gains `centre: number`; `breakdown()` gains, before the tier lookup:

```ts
    if (type === CONSTRUCTION_CENTRE_TYPE) { b.centre += count; continue; }
```

(and `centre: 0` in the initialiser).
3. `projectKind()` gains:

```ts
  if (buildingType === CONSTRUCTION_CENTRE_TYPE) return "centre";
```

4. New summary at the bottom of the file:

```ts
/** Galaxy-wide construction-pool composition + queue pressure — starvation made visible. */
export interface ConstructionPoolSummary {
  poolBase: number;
  poolCentres: number;
  /** poolCentres / (poolBase + poolCentres); 0 when the pool is empty. */
  centreShare: number;
  /** Built centre levels across developed systems. */
  centreLevels: number;
  /** Open centre build projects. */
  centreProjects: number;
  /** Σ max(0, workTotal − workDone) over all open projects. */
  queueRemainingWork: number;
  /** Pulses to drain the whole open queue at the current total pool; null when the pool is 0. */
  queueEtaPulses: number | null;
}

/**
 * Pool composition (eligible-heads base vs Construction Centre output) and how many pulses the open
 * queue takes to drain at that rate. Composition aggregates linearly over developed systems, so one
 * pass over the whole galaxy equals the per-faction sum.
 */
export function summarizeConstructionPool(
  systems: TickSystem[],
  projects: WorldConstructionProject[],
): ConstructionPoolSummary {
  const pool = factionConstructionPool(
    systems.map((s) => ({ control: s.control, population: s.population, buildings: s.buildings })),
    { throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP, pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL },
  );
  let centreLevels = 0;
  for (const s of systems) {
    if (s.control === "developed") centreLevels += s.buildings[CONSTRUCTION_CENTRE_TYPE] ?? 0;
  }
  let centreProjects = 0;
  let queueRemainingWork = 0;
  for (const p of projects) {
    queueRemainingWork += Math.max(0, p.workTotal - p.workDone);
    if (p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE) centreProjects++;
  }
  return {
    poolBase: pool.base,
    poolCentres: pool.centres,
    centreShare: pool.total > 0 ? pool.centres / pool.total : 0,
    centreLevels,
    centreProjects,
    queueRemainingWork,
    queueEtaPulses: pool.total > 0 ? queueRemainingWork / pool.total : null,
  };
}
```

(Check `TickSystem` exposes `control`/`buildings`/`population` — `summarizeColonisation` already reads all three.)

5. `scripts/simulate.ts` — import `summarizeConstructionPool`; inside the colonisation block (after line 266), append:

```ts
    const cp = summarizeConstructionPool(finalTickSystems, finalWorld.constructionProjects);
    lines.push(
      `Construction pool: base ${fmtNum(cp.poolBase)} + centres ${fmtNum(cp.poolCentres)} ` +
        `(${(cp.centreShare * 100).toFixed(1)}% centre) | centres built ${cp.centreLevels}, in flight ${cp.centreProjects}`,
    );
    lines.push(
      `  queue: ${fmtNum(cp.queueRemainingWork)} work remaining` +
        (cp.queueEtaPulses !== null ? ` ≈ ${cp.queueEtaPulses.toFixed(1)} pulses at current pool` : " (pool is zero — stalled)"),
    );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tick-harness` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add lib/tick-harness/build-analysis.ts lib/tick-harness/__tests__/build-analysis.test.ts scripts/simulate.ts
git commit -m "feat(sim): pool-composition + queue-ETA metrics in the health report"
```

---

### Task 7: Simulator gate + calibration (the real proof)

**Files:** possibly `lib/constants/construction.ts` (knob adjustments only). No new code.

- [ ] **Step 1: Run the gate config**

```bash
npm run simulate -- --config experiments/examples/cadence-invariance-24.yaml > "$env:TEMP/sim-pr-a.txt" 2>&1
```

- [ ] **Step 2: Compare against the Task 0 baseline, against these pass criteria**

1. **AI factions still colonise and develop** — developed-system counts, with-tier-0/tier-1+/housing counts, and final population within the same coarse band as baseline (intrinsic coherence, not bit-parity — seeded draws shift by design).
2. **Centres appear under backlog pressure** — `centres built` > 0 by t=1500 in a full-scale galaxy (mature homeworlds have skilled employment and deep queues), AND the quick 500-tick default run (`npm run simulate`) shows few/no centres (young galaxy, little skilled employment → little starvation signal). Both directions matter: appearing without pressure or never appearing at all are both failures.
3. **No NaN/runaway/pinning** — no `NaN`/`null`/`Infinity` anywhere in the report; pool figures finite and positive.
4. **Pool health** — galaxy `poolBase` at t=1500 should sit near baseline's implied pool (baseline pop × 0.05). If build-out (buildings built, queue drain) degrades materially because eligible heads shrank, raise `THROUGHPUT_PER_POP` (e.g. 0.05 → 0.055) so the young-economy pool is unchanged and re-run — that is the §1 recalibration, done against measurement, not guessed.
5. **Centre sanity** — `centreShare` should be modest (single-digit-to-low-tens %), not runaway (centres building centres to fund centres would show as share climbing toward 1 — the self-limiting frontier should prevent it; if it doesn't, lower `PAYBACK_HORIZON`).

- [ ] **Step 3: If knobs moved, re-run until criteria hold, then commit**

```bash
git add lib/constants/construction.ts
git commit -m "chore(econ): calibrate centre/pool knobs against the sim gate"
```

(Skip the commit if nothing moved.)

- [ ] **Step 4: Full gates**

Run: `npx vitest run` → all pass; `npx tsc --noEmit` → clean; `npx next build --webpack` → succeeds.

- [ ] **Step 5: Push and open PR A**

```bash
git push -u origin feat/player-seat-2-economy
gh pr create --base feat/player-seat-2 --title "feat(econ): construction actualisation — eligible-heads pool + Construction Centres (Slice 2 PR A)" --body "..."
```

PR body: summarize §1–3 of the spec, the three refinements from this plan's header, and paste the sim-gate before/after numbers. End with the standard generated-with footer. **Open the PR before running `/uber-review`** (project convention), then run `/uber-review` on it.

---

## Out of scope for PR A (PR B / later)

- `world.player.automation` toggles, manual verbs, `origin: "player" | "auto"`, save bump 6→7, all UI actions (spec §4–6) — PR B.
- Queue ordering with player rows (spec §7's fourth engine bullet) — PR B, with the rows it tests.
- Doc lifecycle (promote spec to `docs/active/`, delete the build plan) — happens once the whole slice ships, on the shared branch before squash-merge to main.

## Self-review notes (already applied)

- Spec §1 recalibration is measurement-driven (Task 7 #4), not a guessed constant.
- Spec §3's "sited at the developed system with the most spare labour and space" is resolved to a total order: spare labour desc → remaining space desc → systemId asc, with queued/proposed space subtracted so a centre can't overcommit a site the same pulse fills.
- Spec §3's "none while a centre project is already in flight" + the funding queue's front-first persistence interact badly for never-funded centres; resolved by centre persist-if-funded (plan header, Task 4 step 3.5).
- `fundQueueWithFloor`'s floor eligibility (`kind === "build"` at a flagged young colony) is untouched — a centre sited at a young colony may draw floor points like any build; acceptable and unlikely (siting prefers spare-labour-rich mature systems).
