# Player Seat Slice 2 — PR B (control half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player gets manual construction verbs — quick-add and new-industry orders, direct-a-colony, cancel — surfaced on the system Industry tab (ghost rows in the ledger, colonisation as its founding entry), behind per-domain automation toggles; the Overview construction card is deleted and the faction card slims to a command summary. Save 6 → 7.

**Architecture:** Manual and autonomic projects stay one queue: `WorldConstructionProject` gains `origin: "player" | "auto"`; a stable-partition ordering (`orderOpenProjects`) sends fresh player orders behind committed work but ahead of new autonomic proposals — an identity on AI-only queues, so the simulator is untouched. `world.player.automation` gates the player faction's *proposal generation* in the directed-build processor (funding always continues). A new pure `build-options` engine module computes per-type feasibility (hard space/slot ceilings, labour warning data) that one read endpoint serves to the dialog, the quick-add states, and the mutation services' validation. UI lands on the Industry tab (ghost rows + verbs), the industry page's undeveloped state (colony surface), and a rewritten faction command card.

**Tech Stack:** TypeScript 5 strict, Vitest 4, Next.js 16 App Router, Zod v4, TanStack Query v5, RHF, tailwind-variants.

**Spec:** `docs/build-plans/player-seat.md` Slice 2 §4–8 (the settled v2 design). Deliberate refinements over the spec's letter, locked here:
- **Queue-position rule is implemented as a stable partition of the *stored* open set** — fresh player rows (`origin: "player" && workDone ≤ 0`) move behind everything already committed (any origin, any workDone), ahead of this pulse's new proposals. Rationale: the stored order can legitimately hold unfunded auto rows ahead of floor-funded in-flight rows (`fundQueueWithFloor` pass A), and a full workDone-based re-sort would change AI funding — the partition is an identity for AI-only queues, so the sim gate stays a no-change check.
- **No mutation mutex.** `runWorldTick` awaits only in-memory adapters (already-resolved promises → microtasks), so the event loop never reaches an HTTP handler mid-tick; route mutations are ordered strictly between ticks. Recorded as a comment in the mutation service header.
- **Quick-add batching extends the open player project** for the same (system, buildingType): `levels += n`, `workTotal += n × workCostPerLevel` — one ledger row per type, matching the wireframe.

## Global Constraints

- No `as` assertions (except `as const` / guards in `lib/types/guards.ts`); no `unknown`; no postfix `!` outside tests' `find(...)!`.
- Engine files (`lib/engine/`) stay pure — no `fs`, `process.env`, `Date.now`, `Math.random`.
- World state stays JSON-serializable; guard math that could produce `NaN`/`Infinity`.
- Comments describe the code, never the plan/PR that produced it.
- Discriminated unions for result types; typed keys, not `Record<string, unknown>`.
- Forms use RHF + Zod; `components/form/` controls only — never raw `<input>`/`<select>`.
- Foundry theme: sharp corners, `font-display` headings, `font-mono` numerics; reuse `Button`/`Badge`/`InlineAlert`/`Dialog`/`Tooltip` primitives.
- Build gate before PR: `npx tsc --noEmit`, `npx vitest run`, `npx next build --webpack`, plus the Task 11 simulator gate.
- Branch: work happens on `feat/player-seat-2-control`, PR into shared branch `feat/player-seat-2`. Commit after each task.

---

### Task 0: Branch setup + simulator baseline

- [ ] **Step 1: Create the PR B branch off the shared branch**

```bash
git checkout feat/player-seat-2 && git pull
git checkout -b feat/player-seat-2-control
```

- [ ] **Step 2: Capture the baseline simulator report** (takes several minutes)

```bash
npm run simulate -- --config experiments/examples/cadence-invariance-24.yaml > "$env:TEMP/sim-baseline-pr-b.txt" 2>&1
```

(PowerShell path shown; in Bash use a scratchpad path.) Keep the file — Task 11 diffs against it. Note down: final population, developed-system counts, construction pool composition (base/centres, from the PR A metric block), queue sizes, no NaN/`null` anywhere.

- [ ] **Step 3: No commit** — baseline stays out of the repo.

---

### Task 1: World shape — `origin`, `automation`, save v7

**Files:**
- Modify: `lib/world/types.ts` (`WorldConstructionProjectBase`, `WorldPlayer`)
- Modify: `lib/world/save.ts:20` (version bump)
- Modify: `lib/world/gen.ts:214-217` (default automation)
- Modify: `lib/tick/processors/directed-build.ts:227-254` (stamp `origin: "auto"` on new projects)
- Modify (mechanical, tsc-driven): every test fixture constructing a `WorldConstructionProject` literal — known sites: `lib/engine/__tests__/construction.test.ts`, `lib/engine/__tests__/construction-centre.test.ts`, `lib/engine/__tests__/construction-readout.test.ts`, `lib/tick/processors/__tests__/directed-build.test.ts`, `lib/tick-harness/__tests__/build-analysis.test.ts`, `lib/services/__tests__/*` (any construction fixtures)
- Test: `lib/world/__tests__/save.test.ts`, `lib/world/__tests__/gen.test.ts`

**Interfaces:**
- Produces (later tasks depend on these exact shapes):

```ts
// lib/world/types.ts
interface WorldConstructionProjectBase {
  id: string;
  factionId: string;
  systemId: string;
  /** Who committed this row: the autonomic planner, or a player order (priority, display, cancel-permission). */
  origin: "auto" | "player";
  workTotal: number;
  workDone: number;
}

export interface WorldPlayer {
  controlledFactionId: string;
  /** Per-domain autonomic switches. Off = the planner stops PROPOSING in that domain for the player's
   *  faction; committed funding and manual orders always continue. AI factions never read this. */
  automation: { build: boolean; colonisation: boolean };
}
```

- `SAVE_FORMAT_VERSION` becomes `7`.

- [ ] **Step 1: Write the failing tests**

`lib/world/__tests__/save.test.ts` — update the version pin and the reject test:

```ts
  it("is at save format version 7 (automation + project origin)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(7);
  });

  it("rejects a prior-version (v6) save — saves break on the shape bump", () => {
    const json = JSON.stringify({ formatVersion: 6, world });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });
```

(Keep/adapt the existing prior-version test — point it at 6.)

`lib/world/__tests__/gen.test.ts` — inside the existing player-faction describe:

```ts
  it("seats the player with both automation switches on", () => {
    const world = generateWorld({ ...base, playerFaction: authored });
    expect(world.player?.automation).toEqual({ build: true, colonisation: true });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/world/__tests__/save.test.ts lib/world/__tests__/gen.test.ts`
Expected: FAIL — version is 6, `automation` undefined.

- [ ] **Step 3: Implement**

1. `lib/world/types.ts` — add `origin: "auto" | "player";` to `WorldConstructionProjectBase` (after `systemId`) and `automation: { build: boolean; colonisation: boolean };` to `WorldPlayer`, with the doc comments from the Interfaces block above.
2. `lib/world/save.ts:20` — `export const SAVE_FORMAT_VERSION = 7;`
3. `lib/world/gen.ts:214-217`:

```ts
  const player =
    universe.playerFactionIndex !== null
      ? {
          controlledFactionId: factionIds[universe.playerFactionIndex],
          automation: { build: true, colonisation: true },
        }
      : null;
```

4. `lib/tick/processors/directed-build.ts` — both `newProjects.push({...})` literals gain `origin: "auto",` (after `id`).
5. Run `npx tsc --noEmit` and add `origin: "auto"` to every flagged fixture literal (the files listed above; the sweep is mechanical — every literal is a planner/auto fixture, none represent player orders).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: full suite PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(world): project origin + player automation switches, save v7"
```

---

### Task 2: Engine + processor — player queue priority, persist rules

**Files:**
- Modify: `lib/engine/construction.ts` (new `orderOpenProjects`)
- Modify: `lib/tick/processors/directed-build.ts:259-272` (ordering + persist)
- Modify: `lib/services/construction.ts` (readout consumes the same order — one-line change)
- Test: `lib/engine/__tests__/construction.test.ts`, `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- Produces:

```ts
/** Stable partition of a faction's stored open set: fresh player orders (origin "player",
 *  workDone ≤ 0) move to the back — behind all committed work, ahead of the caller's new
 *  proposals. Identity for queues with no fresh player rows. Pure. */
export function orderOpenProjects(projects: WorldConstructionProject[]): WorldConstructionProject[]
```

- Consumes: Task 1's `origin` field.

- [ ] **Step 1: Write the failing tests**

Append to `lib/engine/__tests__/construction.test.ts` (reuse the file's project-fixture helper style; every fixture now carries `origin`):

```ts
describe("orderOpenProjects", () => {
  const row = (id: string, origin: "auto" | "player", workDone: number): WorldConstructionProject => ({
    kind: "build", id, factionId: "f1", systemId: "s1", origin,
    buildingType: "metals", levels: 1, workTotal: 20, workDone,
  });

  it("moves fresh player orders behind committed work, preserving relative order (FIFO)", () => {
    const stored = [row("p1", "player", 0), row("a1", "auto", 5), row("p2", "player", 0), row("a2", "auto", 0)];
    expect(orderOpenProjects(stored).map((p) => p.id)).toEqual(["a1", "a2", "p1", "p2"]);
  });

  it("is an identity on queues with no fresh player rows (AI queues untouched)", () => {
    const stored = [row("a1", "auto", 0), row("a2", "auto", 7), row("a3", "auto", 0)];
    expect(orderOpenProjects(stored).map((p) => p.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("keeps a player row that has received work in its committed position", () => {
    const stored = [row("p1", "player", 3), row("a1", "auto", 0)];
    expect(orderOpenProjects(stored).map((p) => p.id)).toEqual(["p1", "a1"]);
  });
});
```

Append to `lib/tick/processors/__tests__/directed-build.test.ts` (mirror the file's `scenario`/`MemoryDirectedBuildWorld` helpers; construct a world whose open set holds a fresh player build order plus enough auto backlog that the pool cannot fund everything):

```ts
describe("player orders in the funding queue", () => {
  it("funds a fresh player order ahead of this pulse's new autonomic proposals", async () => {
    // World with a deficit (so the planner proposes) and ONE fresh player order in the open set;
    // pool sized to fund exactly one project's pulse-cap. The player row must receive work; the
    // new proposals must not.
    const playerOrder: WorldConstructionProject = { kind: "build", id: "player-1", factionId: "f1",
      systemId: "s1", origin: "player", buildingType: "metals", levels: 1, workTotal: 20, workDone: 0 };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [playerOrder]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: { ...mkConstruction(5, 0.001) }, // tiny pool: one absorption only
    });
    const persisted = w.constructionProjects.find((p) => p.id === "player-1");
    expect(persisted).toBeDefined();
    expect(persisted?.workDone).toBeGreaterThan(0);
  });

  it("never drops an unfunded player order (persist-if-funded is auto-only)", async () => {
    const playerColony: WorldConstructionProject = { kind: "colony_establish", id: "player-c1",
      factionId: "f1", systemId: "s9", origin: "player", sourceSystemId: "s1",
      seedPop: 100, housingLevels: 1, workTotal: 60, workDone: 0 };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [playerColony]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: { ...mkConstruction(1000, 0) }, // zero pool: nothing funds
    });
    expect(w.constructionProjects.some((p) => p.id === "player-c1")).toBe(true);
  });
});
```

(Adapt the constructor call to how the file passes open projects into `MemoryDirectedBuildWorld` — read the top of the test file; the invariants under test are the two comments, not the exact magnitudes.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts lib/tick/processors/__tests__/directed-build.test.ts`
Expected: FAIL — `orderOpenProjects` not exported; player-row assertions fail.

- [ ] **Step 3: Implement**

`lib/engine/construction.ts` — after `fundQueueWithFloor`:

```ts
/**
 * Funding order over a faction's STORED open set: everything already committed keeps its stored
 * order (front-first — including unfunded auto rows and floor-funded rows the stored order
 * interleaves); fresh player orders (origin "player" with no work yet) move to the back of it,
 * preserving their own insertion (FIFO) order. The caller appends this pulse's new proposals after,
 * so the full priority reads: committed work → player orders → new autonomic proposals. Pure;
 * identity for queues with no fresh player rows.
 */
export function orderOpenProjects(projects: WorldConstructionProject[]): WorldConstructionProject[] {
  const committed: WorldConstructionProject[] = [];
  const freshPlayer: WorldConstructionProject[] = [];
  for (const p of projects) {
    if (p.origin === "player" && p.workDone <= 0) freshPlayer.push(p);
    else committed.push(p);
  }
  return [...committed, ...freshPlayer];
}
```

`lib/tick/processors/directed-build.ts`:

1. Import `orderOpenProjects` from `@/lib/engine/construction` (extend the existing import).
2. The funding call (line ~259) becomes:

```ts
    const { projects: fundedOpen, landed } = fundQueueWithFloor(
      [...orderOpenProjects(existing), ...newProjects], pool, cap, reserved,
      (p) => p.kind === "build" && (floorBySystem.get(p.systemId) ?? 0) > 0,
    );
```

3. The persist loop's drop rules become auto-only:

```ts
    for (const p of fundedOpen) {
      // Persist-if-funded applies to AUTONOMIC colonies and centres only — they are re-emitted and
      // re-priced next pulse, so a workless row is dropped to keep the queue live. A player order is
      // a standing commitment with no re-emitter: it always persists until funded or cancelled.
      if (p.origin !== "player") {
        if (p.kind === "colony_establish" && p.workDone <= 0) continue;
        if (p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE && p.workDone <= 0) continue;
      }
      nextOpen.push(p);
    }
```

`lib/services/construction.ts` — `readoutForFaction` passes the same order the funder uses, so ETAs and row order match reality:

```ts
  const projects = orderOpenProjects(world.constructionProjects.filter((p) => p.factionId === factionId));
```

(import `orderOpenProjects` from `@/lib/engine/construction`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine lib/tick/processors/__tests__/directed-build.test.ts lib/services`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine lib/tick/processors/directed-build.ts lib/services/construction.ts
git commit -m "feat(tick): player orders outrank new autonomic proposals; player rows always persist"
```

---

### Task 3: Processor — automation gating + tick threading

**Files:**
- Modify: `lib/tick/processors/directed-build.ts` (params + faction loop)
- Modify: `lib/world/tick.ts:801-834` (thread `world.player`)
- Test: `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- `DirectedBuildProcessorParams` gains:

```ts
  /** The human seat, when one exists: gates PROPOSAL GENERATION for this faction per domain.
   *  Funding of committed work and manual orders is never gated. Omitted → no gating (harness). */
  player?: { factionId: string; automation: { build: boolean; colonisation: boolean } };
```

- [ ] **Step 1: Write the failing tests**

Append to the `player orders in the funding queue` describe (or a sibling describe) in `lib/tick/processors/__tests__/directed-build.test.ts`:

```ts
  it("skips build proposal generation for the player's faction when automation.build is off", async () => {
    // Deficit scenario that WOULD propose builds; with build automation off, no new projects appear
    // for the player faction — but a pre-existing committed row still receives funding.
    const inFlight: WorldConstructionProject = { kind: "build", id: "b-committed", factionId: "f1",
      systemId: "s1", origin: "auto", buildingType: "metals", levels: 1, workTotal: 20, workDone: 5 };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [inFlight]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: { ...mkConstruction() },
      player: { factionId: "f1", automation: { build: false, colonisation: true } },
    });
    expect(w.constructionProjects.every((p) => p.id === "b-committed")).toBe(true);
    expect(w.constructionProjects[0]?.workDone).toBeGreaterThan(5);
  });

  it("skips colony proposal generation when automation.colonisation is off, leaving builds alone", async () => {
    // Scenario with an eligible colony candidate AND a build deficit: colonisation off must yield
    // zero colony_establish rows while build rows still appear.
    const w = new MemoryDirectedBuildWorld(scenarioWithColonyCandidate());
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: { ...mkConstruction() },
      develop: developParams(),
      player: { factionId: "f1", automation: { build: true, colonisation: false } },
    });
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(false);
    expect(w.constructionProjects.some((p) => p.kind === "build")).toBe(true);
  });

  it("ignores automation entirely for non-player factions", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: { ...mkConstruction() },
      player: { factionId: "someone-else", automation: { build: false, colonisation: false } },
    });
    expect(w.constructionProjects.length).toBeGreaterThan(0); // f1 planned as usual
  });
```

(`scenarioWithColonyCandidate()` / `developParams()`: mirror how the file's existing colonisation tests construct a controlled candidate + `develop` params — reuse those helpers by name after reading the file; the invariant is the kind-count assertions.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: FAIL — TypeScript: unknown param `player`.

- [ ] **Step 3: Implement**

`lib/tick/processors/directed-build.ts`:

1. Add the `player?` field to `DirectedBuildProcessorParams` (doc comment from Interfaces).
2. In the faction loop, immediately after `const existing = ...`:

```ts
    // The human seat's per-domain switches: off = skip PROPOSAL GENERATION for this faction in that
    // domain. Committed funding always continues below; manual orders arrive via `existing`.
    const automation = params.player?.factionId === factionId ? params.player.automation : null;
    const skipBuild = automation !== null && !automation.build;
    const skipColonise = automation !== null && !automation.colonisation;
```

3. Gate the three proposal sources:

```ts
    const buildProposals = skipBuild ? [] : planFactionProposals(buildStates, params.routeCost, existing, developmentRefs);
```

```ts
    if (params.develop && factionId !== null && !skipColonise) {
```

```ts
    if (factionId !== null && !skipBuild) {
      const centre = planCentreProposal(...);   // unchanged body — a centre is a build-domain proposal
```

`lib/world/tick.ts` — in the `runDirectedBuildProcessor` call (after `develop: {...}`):

```ts
        player: world.player
          ? { factionId: world.player.controlledFactionId, automation: world.player.automation }
          : undefined,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: PASS (existing tests untouched — omitted `player` means no gating).

- [ ] **Step 5: Commit**

```bash
git add lib/tick/processors/directed-build.ts lib/world/tick.ts lib/tick/processors/__tests__/directed-build.test.ts
git commit -m "feat(tick): per-domain automation gates player-faction proposal generation"
```

---

### Task 4: Engine — build options (feasibility) + colony sizing extraction

**Files:**
- Create: `lib/engine/build-options.ts`
- Modify: `lib/engine/directed-build.ts` (export `extractorsOnResource`; extract `sizeColonyEstablish` and use it in `planFactionColonyProposals`)
- Test: `lib/engine/__tests__/build-options.test.ts`, `lib/engine/__tests__/directed-build.test.ts` (sizing)

**Interfaces:**
- Produces:

```ts
// lib/engine/build-options.ts
export interface BuildOptionSystem {
  population: number;
  buildings: Record<string, number>;
  slotCap: ResourceVector;
  generalSpace: number;
  habitableSpace: number;
}
export type BuildBlockReason = "no_space" | "no_deposit_slots";
export interface BuildOption {
  buildingType: string;
  /** Whole levels physically addable now, NET of built + committed (in-flight) levels. */
  maxLevels: number;
  /** Non-null = hard-blocked (maxLevels 0): the reason the quick-add/dialog shows. */
  blocked: BuildBlockReason | null;
  workPerLevel: number;
  /** Heads one level adds, by grade. */
  labourAdded: { unskilled: number; skill1: number; skill2: number };
  /** Estimated staffing fraction once one more level lands (min over the grades the type draws),
   *  computed on built + committed + 1. 1 for types drawing no labour. */
  estStaffing: number;
}
/** One entry per BUILDING_TYPES key, deterministic catalog order. `committed` = in-flight levels by type. */
export function computeBuildOptions(sys: BuildOptionSystem, committed: Record<string, number>): BuildOption[]

// lib/engine/directed-build.ts
export interface ColonySizing { seedPop: number; housingLevels: number; work: number }
/** Land-sized seed + bundled housing + total establish work, or null when the site can't hold one
 *  whole housing level (not viable). The single sizing rule the planner AND the player verb share. */
export function sizeColonyEstablish(
  habitableSpace: number,
  params: Pick<ColonyEstablishParams, "seedPop" | "establishWork">,
): ColonySizing | null
```

- Consumes: `BUILDING_TYPES`, `HOUSING_TYPE`, `effectiveSpaceCost`, `labourTotal` (constants); `generalSpaceUsed`, `labourParts`, `computeLabourAllocation`, `labourStateFromParts` from `@/lib/engine/industry`; `workCostPerLevel`; `GOOD_TIER_BY_KEY`; `POP_CENTRE_DENSITY`.

- [ ] **Step 1: Write the failing tests**

Create `lib/engine/__tests__/build-options.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeBuildOptions } from "@/lib/engine/build-options";
import { HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, CONSTRUCTION_CENTRE_TYPE, BUILDING_TYPES } from "@/lib/constants/industry";
import { workCostPerLevel } from "@/lib/constants/construction";
import { emptyResourceVector } from "@/lib/engine/resources";

function sys(over: Partial<Parameters<typeof computeBuildOptions>[0]> = {}) {
  return {
    population: 500, buildings: {}, slotCap: emptyResourceVector(),
    generalSpace: 10, habitableSpace: 4, ...over,
  };
}
const byType = (opts: ReturnType<typeof computeBuildOptions>, t: string) => opts.find((o) => o.buildingType === t)!;

describe("computeBuildOptions", () => {
  it("caps housing by the tighter of habitable and general space, net of committed levels", () => {
    // habitable 4 → 4 housing levels max; 2 built + 1 committed → 1 addable.
    const opts = computeBuildOptions(sys({ buildings: { [HOUSING_TYPE]: 2 } }), { [HOUSING_TYPE]: 1 });
    const h = byType(opts, HOUSING_TYPE);
    expect(h.maxLevels).toBe(1);
    expect(h.blocked).toBeNull();
    expect(h.workPerLevel).toBe(workCostPerLevel(HOUSING_TYPE));
  });

  it("hard-blocks a general-space type when no footprint remains", () => {
    const full = sys({ generalSpace: 2, buildings: { [HOUSING_TYPE]: 2 } }); // habitable 4, general full
    const c = byType(computeBuildOptions(full, {}), CONSTRUCTION_CENTRE_TYPE);
    expect(c.maxLevels).toBe(0);
    expect(c.blocked).toBe("no_space");
  });

  it("caps an extractor by its deposit slots and reports no_deposit_slots at zero", () => {
    // Pick any tier-0 type from the catalog and grant 2 slots of its resource.
    const tier0 = Object.keys(BUILDING_TYPES).find((t) => BUILDING_TYPES[t].resource !== undefined)!;
    const resource = BUILDING_TYPES[tier0].resource!;
    const slotCap = { ...emptyResourceVector(), [resource]: 2 };
    const open = byType(computeBuildOptions(sys({ slotCap }), {}), tier0);
    expect(open.maxLevels).toBe(2);
    const exhausted = byType(computeBuildOptions(sys({ slotCap, buildings: { [tier0]: 2 } }), {}), tier0);
    expect(exhausted.maxLevels).toBe(0);
    expect(exhausted.blocked).toBe("no_deposit_slots");
  });

  it("reports the labour a level adds and a degraded staffing estimate on a tight population", () => {
    // Centre draws { unskilled: 18, skill1: 7 }; population 10 cannot staff it → estStaffing < 1.
    const tight = sys({ population: 10, buildings: { [VOCATIONAL_SCHOOL_TYPE]: 1 } });
    const c = byType(computeBuildOptions(tight, {}), CONSTRUCTION_CENTRE_TYPE);
    expect(c.labourAdded).toEqual(BUILDING_TYPES[CONSTRUCTION_CENTRE_TYPE].labour);
    expect(c.estStaffing).toBeLessThan(1);
    // Housing draws nobody — always fully "staffed".
    expect(byType(computeBuildOptions(tight, {}), HOUSING_TYPE).estStaffing).toBe(1);
  });
});
```

Append to `lib/engine/__tests__/directed-build.test.ts`:

```ts
describe("sizeColonyEstablish", () => {
  const params = { seedPop: 500, establishWork: 100 };

  it("sizes seed to the whole-level habitable cap with housing to house it", () => {
    const s = sizeColonyEstablish(3, params); // habitable 3 → 3 whole housing levels possible
    expect(s).not.toBeNull();
    if (s === null) return;
    expect(s.housingLevels).toBeGreaterThanOrEqual(1);
    expect(s.seedPop).toBeLessThanOrEqual(params.seedPop);
    expect(s.work).toBe(params.establishWork + s.housingLevels * workCostPerLevel(HOUSING_TYPE));
  });

  it("returns null when the site cannot hold one whole housing level", () => {
    expect(sizeColonyEstablish(0.4, params)).toBeNull();
  });
});
```

(imports: `sizeColonyEstablish` from `@/lib/engine/directed-build`, `HOUSING_TYPE`, `workCostPerLevel`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/build-options.test.ts lib/engine/__tests__/directed-build.test.ts`
Expected: FAIL — modules/functions missing.

- [ ] **Step 3: Implement**

`lib/engine/directed-build.ts`:

1. Export the existing private helper (rename-free): change `function extractorsOnResource(` to `export function extractorsOnResource(`.
2. Add above `planFactionColonyProposals`:

```ts
/** Seed + bundled-housing sizing for a colony at `habitableSpace` — the planner's whole-level rule,
 *  shared with the player's direct-colony verb so both order identical projects. Null = the site
 *  can't hold one whole housing level (not viable). */
export interface ColonySizing { seedPop: number; housingLevels: number; work: number }

export function sizeColonyEstablish(
  habitableSpace: number,
  params: Pick<ColonyEstablishParams, "seedPop" | "establishWork">,
): ColonySizing | null {
  const housingCost = effectiveSpaceCost(HOUSING_TYPE);
  const maxHousingLevels = housingCost > 0 ? Math.floor(Math.max(0, habitableSpace) / housingCost) : 0;
  const habitableCap = maxHousingLevels * POP_CENTRE_DENSITY;
  const seedPop = Math.min(params.seedPop, habitableCap);
  const housingLevels = Math.min(maxHousingLevels, Math.ceil(seedPop / POP_CENTRE_DENSITY));
  if (housingLevels < 1 || seedPop <= 0) return null;
  return { seedPop, housingLevels, work: params.establishWork + housingLevels * workCostPerLevel(HOUSING_TYPE) };
}
```

3. In `planFactionColonyProposals`, replace the inline sizing block (the `maxHousingLevels`/`habitableCap`/`seedPop`/`housingLevels` lines and the `work` computation) with:

```ts
    const sizing = sizeColonyEstablish(c.habitableSpace, params);
    if (sizing === null) continue; // no whole housing level → not viable, skip
    const { seedPop, housingLevels, work } = sizing;
```

(The `housingCost` const above the loop becomes unused — delete it. The `value` computation and everything else stays.)

4. Create `lib/engine/build-options.ts`:

```ts
/**
 * Pure per-type build feasibility for ONE system — the single computation behind the player's
 * quick-add states, the new-industry dialog readout, and the order services' validation.
 *
 * Hard ceilings only (space, deposit slots): a zero `maxLevels` carries its `blocked` reason. The
 * labour picture is DATA, never a block — `labourAdded` + `estStaffing` feed the warning surface;
 * the player may overbuild what their pops can staff and staffing dilution + idle-decay punish it.
 */
import type { ResourceVector } from "@/lib/types/game";
import {
  BUILDING_TYPES, HOUSING_TYPE, effectiveSpaceCost,
} from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { workCostPerLevel } from "@/lib/constants/construction";
import { extractorsOnResource } from "@/lib/engine/directed-build";
import { generalSpaceUsed, labourParts, labourStateFromParts } from "@/lib/engine/industry";

export interface BuildOptionSystem {
  population: number;
  buildings: Record<string, number>;
  slotCap: ResourceVector;
  generalSpace: number;
  habitableSpace: number;
}

export type BuildBlockReason = "no_space" | "no_deposit_slots";

export interface BuildOption {
  buildingType: string;
  /** Whole levels physically addable now, net of built + committed (in-flight) levels. */
  maxLevels: number;
  /** Non-null = hard-blocked (maxLevels 0). */
  blocked: BuildBlockReason | null;
  workPerLevel: number;
  /** Heads one level adds, by grade. */
  labourAdded: { unskilled: number; skill1: number; skill2: number };
  /** Estimated staffing once one more level lands (min over drawn grades, on built + committed + 1);
   *  1 for types that draw no labour. */
  estStaffing: number;
}

/** Buildings + committed folded into one effective count map (what the world will hold once the queue lands). */
function effectiveCounts(buildings: Record<string, number>, committed: Record<string, number>): Record<string, number> {
  const out = { ...buildings };
  for (const [type, levels] of Object.entries(committed)) {
    if (levels > 0) out[type] = (out[type] ?? 0) + levels;
  }
  return out;
}

export function computeBuildOptions(
  sys: BuildOptionSystem,
  committed: Record<string, number>,
): BuildOption[] {
  const effective = effectiveCounts(sys.buildings, committed);
  const remainingGeneral = sys.generalSpace - generalSpaceUsed(effective);

  return Object.keys(BUILDING_TYPES).map((buildingType) => {
    const def = BUILDING_TYPES[buildingType];
    const labour = def.labour ?? { unskilled: 0, skill1: 0, skill2: 0 };
    const isExtractor = GOOD_TIER_BY_KEY[buildingType] === 0 && def.resource !== undefined;

    let maxLevels: number;
    let blocked: BuildBlockReason | null = null;
    if (isExtractor && def.resource !== undefined) {
      const remaining = sys.slotCap[def.resource] - extractorsOnResource(effective, def.resource);
      maxLevels = Math.max(0, Math.floor(remaining));
      if (maxLevels === 0) blocked = "no_deposit_slots";
    } else {
      const cost = effectiveSpaceCost(buildingType);
      let space = remainingGeneral;
      if (buildingType === HOUSING_TYPE) {
        const housingUsed = (effective[HOUSING_TYPE] ?? 0) * cost;
        space = Math.min(space, sys.habitableSpace - housingUsed);
      }
      maxLevels = cost > 0 ? Math.max(0, Math.floor(space / cost)) : 0;
      if (maxLevels === 0) blocked = "no_space";
    }

    // Staffing estimate for the level being considered: the system once the queue + this level land.
    const drawsLabour = labour.unskilled > 0 || labour.skill1 > 0 || labour.skill2 > 0;
    let estStaffing = 1;
    if (drawsLabour) {
      const next = { ...effective, [buildingType]: (effective[buildingType] ?? 0) + 1 };
      const state = labourStateFromParts(labourParts(next), sys.population);
      estStaffing = Math.min(
        state.labourFulfil,
        labour.skill1 > 0 ? state.skill1Fulfil : 1,
        labour.skill2 > 0 ? state.skill2Fulfil : 1,
      );
    }

    return {
      buildingType,
      maxLevels,
      blocked: maxLevels === 0 ? blocked : null,
      workPerLevel: workCostPerLevel(buildingType),
      labourAdded: { unskilled: labour.unskilled, skill1: labour.skill1, skill2: labour.skill2 },
      estStaffing,
    };
  });
}
```

(Import-cycle check before committing: `build-options.ts` → `directed-build.ts` → `industry.ts` — none of those import `build-options.ts`, so the graph stays acyclic. If `BUILDING_TYPES[t].labour` is non-optional in the catalog type, drop the `?? {...}` fallback rather than leaving dead code.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine`
Expected: PASS (including the untouched colony-proposal tests — the sizing refactor is behaviour-preserving).

- [ ] **Step 5: Commit**

```bash
git add lib/engine
git commit -m "feat(engine): per-type build feasibility + shared colony sizing"
```

---

### Task 5: Mutation services + schemas + verb routes

**Files:**
- Create: `lib/services/construction-orders.ts`
- Create: `lib/schemas/construction-orders.ts`
- Create: `app/api/game/systems/[systemId]/build-orders/route.ts`
- Create: `app/api/game/systems/[systemId]/colony-orders/route.ts`
- Create: `app/api/game/construction-orders/[projectId]/route.ts` (DELETE)
- Create: `app/api/game/player/automation/route.ts` (POST)
- Modify: `lib/types/api.ts` (response aliases)
- Test: `lib/services/__tests__/construction-orders.test.ts`, `lib/schemas/__tests__/construction-orders.test.ts`

**Interfaces:**
- Produces:

```ts
// lib/services/construction-orders.ts
export type OrderBuildResult =
  | { ok: true; data: { projectId: string; levels: number } }   // levels = the row's new total
  | { ok: false; error: string };
export function orderBuild(input: { systemId: string; buildingType: string; levels: number }): OrderBuildResult

export type OrderColonyResult =
  | { ok: true; data: { projectId: string } }
  | { ok: false; error: string };
export function orderColony(input: { systemId: string }): OrderColonyResult

export type CancelOrderResult =
  | { ok: true; data: { projectId: string } }
  | { ok: false; error: string };
export function cancelOrder(input: { projectId: string }): CancelOrderResult

export type SetAutomationResult =
  | { ok: true; data: { build: boolean; colonisation: boolean } }
  | { ok: false; error: string };
export function setAutomation(input: { build: boolean; colonisation: boolean }): SetAutomationResult

// lib/schemas/construction-orders.ts
export const orderBuildSchema: z.ZodObject<...>   // { buildingType: string 1..64; levels: int 1..100 }
export const automationSchema: z.ZodObject<...>   // { build: boolean; colonisation: boolean }
```

- Consumes: `computeBuildOptions` (Task 4), `sizeColonyEstablish` (Task 4), `boundedHopsFromOrigin` (`@/lib/engine/pathfinding`), `buildingsBySystem` (`@/lib/services/world-index`), `resourceVectorFromColumns` (mirror `lib/services/system-development.ts:17` for the slotCap derivation), constants `COLONISATION`, `EXPANSION`, `DIRECTED_LOGISTICS`, `DIRECTED_BUILD`.

- [ ] **Step 1: Write the failing tests**

Create `lib/services/__tests__/construction-orders.test.ts` (mirror how existing service tests build and `setWorld` a small fixture world — read `lib/services/__tests__/game.test.ts` first for the store setup/teardown idiom):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { getWorld } from "@/lib/world/store";
import { orderBuild, orderColony, cancelOrder, setAutomation } from "@/lib/services/construction-orders";
import { HOUSING_TYPE } from "@/lib/constants/industry";

/** A small authored world: the player faction owns a developed homeworld. */
function seatWorld() {
  return generateWorld({
    systemCount: 60, seed: 42,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
}
const home = () => {
  const w = getWorld();
  const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
  return w.systems.find((s) => s.id === f.homeworldId)!;
};

describe("construction order services", () => {
  beforeEach(() => { clearWorld(); setWorld(seatWorld()); });

  it("orders housing at the player's homeworld and batches a second order into the same row", () => {
    const first = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.projectId).toBe(first.data.projectId);
    expect(second.data.levels).toBe(2);
    const row = getWorld().constructionProjects.find((p) => p.id === first.data.projectId)!;
    expect(row.origin).toBe("player");
    expect(row.kind === "build" && row.levels).toBe(2);
  });

  it("hard-rejects a build beyond the physical ceiling", () => {
    const r = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 100 });
    expect(r.ok).toBe(false);
  });

  it("rejects builds at systems the player does not control", () => {
    const w = getWorld();
    const foreign = w.systems.find(
      (s) => s.control === "developed" && s.factionId !== w.player?.controlledFactionId,
    )!;
    const r = orderBuild({ systemId: foreign.id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(r.ok).toBe(false);
  });

  it("cancels only player-originated projects", () => {
    const placed = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
    if (!placed.ok) throw new Error("setup failed");
    expect(cancelOrder({ projectId: placed.data.projectId }).ok).toBe(true);
    expect(getWorld().constructionProjects.some((p) => p.id === placed.data.projectId)).toBe(false);
    expect(cancelOrder({ projectId: "no-such-project" }).ok).toBe(false);
  });

  it("orders a colony at an eligible controlled system and rejects an ineligible one", () => {
    // Deterministically manufacture eligibility: take a controlled player system if the seed
    // produced one, else claim an unclaimed neighbour of the homeworld as controlled.
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    let target = w.systems.find((s) => s.factionId === pid && s.control === "controlled");
    if (!target) {
      const conn = w.connections.find((c) => c.fromId === home().id || c.toId === home().id)!;
      const otherId = conn.fromId === home().id ? conn.toId : conn.fromId;
      target = w.systems.find((s) => s.id === otherId)!;
      target.factionId = pid;
      target.control = "controlled";
    }
    const r = orderColony({ systemId: target.id });
    if (target.habitableSpace >= 1) {
      expect(r.ok).toBe(true);
      const row = getWorld().constructionProjects.find((p) => p.kind === "colony_establish" && p.systemId === target.id)!;
      expect(row.origin).toBe("player");
      // A second order on the same system is "already forming".
      expect(orderColony({ systemId: target.id }).ok).toBe(false);
    } else {
      expect(r.ok).toBe(false); // below the habitable floor is a legitimate reject
    }
    // The developed homeworld is never colony-eligible.
    expect(orderColony({ systemId: home().id }).ok).toBe(false);
  });

  it("sets and reports automation on the player seat", () => {
    const r = setAutomation({ build: false, colonisation: true });
    expect(r.ok).toBe(true);
    expect(getWorld().player?.automation).toEqual({ build: false, colonisation: true });
  });
});
```

Create `lib/schemas/__tests__/construction-orders.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { orderBuildSchema, automationSchema } from "@/lib/schemas/construction-orders";

describe("construction order schemas", () => {
  it("accepts a valid build order and rejects non-positive / fractional / huge levels", () => {
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 2 }).success).toBe(true);
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 0 }).success).toBe(false);
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 1.5 }).success).toBe(false);
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 101 }).success).toBe(false);
    expect(orderBuildSchema.safeParse({ buildingType: "", levels: 1 }).success).toBe(false);
  });

  it("requires both automation switches as booleans", () => {
    expect(automationSchema.safeParse({ build: true, colonisation: false }).success).toBe(true);
    expect(automationSchema.safeParse({ build: true }).success).toBe(false);
    expect(automationSchema.safeParse({ build: "yes", colonisation: false }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/services/__tests__/construction-orders.test.ts lib/schemas/__tests__/construction-orders.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

`lib/schemas/construction-orders.ts`:

```ts
import { z } from "zod";

export const orderBuildSchema = z.object({
  buildingType: z.string().trim().min(1, "Building type is required").max(64),
  levels: z
    .number("Levels is required")
    .int("Levels must be a whole number")
    .min(1, "Levels must be at least 1")
    .max(100, "Levels must be at most 100"),
});

export const automationSchema = z.object({
  build: z.boolean("build must be a boolean"),
  colonisation: z.boolean("colonisation must be a boolean"),
});

export type OrderBuildInput = z.infer<typeof orderBuildSchema>;
export type AutomationInput = z.infer<typeof automationSchema>;
```

`lib/services/construction-orders.ts` — full file:

```ts
/**
 * Player construction verbs — the mutation half of the control surface. Every verb validates the
 * seat (a player exists, the system is theirs) and the same physical ceilings the planner uses
 * (`computeBuildOptions` / `sizeColonyEstablish`), then writes directly into the in-memory world.
 *
 * Concurrency: `runWorldTick` awaits only in-memory adapters, so the event loop never reaches an
 * HTTP handler mid-tick — these synchronous mutations are strictly ordered between ticks and the
 * open set they append to is exactly what the next directed-build pulse funds.
 */
import { getWorld, hasWorld } from "@/lib/world/store";
import type { World, WorldSystem, WorldBuildProject } from "@/lib/world/types";
import { computeBuildOptions } from "@/lib/engine/build-options";
import { sizeColonyEstablish } from "@/lib/engine/directed-build";
import { boundedHopsFromOrigin } from "@/lib/engine/pathfinding";
import { buildingsBySystem } from "@/lib/services/world-index";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { BUILDING_TYPES } from "@/lib/constants/industry";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

/** The hop radius the tick's shared BFS uses — seed-source reach for the colony verb matches it. */
export const COLONY_REACH_HOPS = Math.max(
  DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS, EXPANSION.REACH_JUMPS,
);

type Seat = { world: World; factionId: string };

function requireSeat(): Seat | { error: string } {
  if (!hasWorld()) return { error: "No world loaded." };
  const world = getWorld();
  if (!world.player) return { error: "This world has no player seat." };
  return { world, factionId: world.player.controlledFactionId };
}

function playerSystem(seat: Seat, systemId: string): WorldSystem | { error: string } {
  const system = seat.world.systems.find((s) => s.id === systemId);
  if (!system) return { error: `System ${systemId} not found.` };
  if (system.factionId !== seat.factionId) return { error: "You do not control this system." };
  return system;
}

function mintProjectId(world: World): string {
  const id = `construction-${world.nextId}`;
  world.nextId += 1;
  return id;
}

/** In-flight build levels by type at one system (the committed state feasibility nets against). */
function committedAt(world: World, systemId: string): Record<string, number> {
  const committed: Record<string, number> = {};
  for (const p of world.constructionProjects) {
    if (p.kind !== "build" || p.systemId !== systemId) continue;
    committed[p.buildingType] = (committed[p.buildingType] ?? 0) + p.levels;
  }
  return committed;
}

export type OrderBuildResult =
  | { ok: true; data: { projectId: string; levels: number } }
  | { ok: false; error: string };

export function orderBuild(input: { systemId: string; buildingType: string; levels: number }): OrderBuildResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const system = playerSystem(seat, input.systemId);
  if ("error" in system) return { ok: false, error: system.error };
  if (system.control !== "developed") return { ok: false, error: "Builds require a developed system." };
  if (!(input.buildingType in BUILDING_TYPES)) {
    return { ok: false, error: `Unknown building type: ${input.buildingType}` };
  }

  const options = computeBuildOptions(
    {
      population: system.population,
      buildings: buildingsBySystem().get(system.id) ?? {},
      slotCap: resourceVectorFromColumns(system),
      generalSpace: system.generalSpace,
      habitableSpace: system.habitableSpace,
    },
    committedAt(seat.world, system.id),
  );
  const option = options.find((o) => o.buildingType === input.buildingType);
  if (!option) return { ok: false, error: `Unknown building type: ${input.buildingType}` };
  if (input.levels > option.maxLevels) {
    return {
      ok: false,
      error: option.blocked === "no_deposit_slots"
        ? "No free deposit slots for that building here."
        : `Not enough space: ${option.maxLevels} more level(s) fit here.`,
    };
  }

  // Batching: repeat orders extend the standing player row for this (system, type) — one ledger
  // row, growing workTotal, keeping its queue position and accrued work.
  const existing = seat.world.constructionProjects.find(
    (p): p is WorldBuildProject =>
      p.kind === "build" && p.origin === "player" &&
      p.systemId === system.id && p.buildingType === input.buildingType,
  );
  if (existing) {
    existing.levels += input.levels;
    existing.workTotal += input.levels * option.workPerLevel;
    return { ok: true, data: { projectId: existing.id, levels: existing.levels } };
  }

  const project: WorldBuildProject = {
    kind: "build",
    id: mintProjectId(seat.world),
    factionId: seat.factionId,
    systemId: system.id,
    origin: "player",
    buildingType: input.buildingType,
    levels: input.levels,
    workTotal: input.levels * option.workPerLevel,
    workDone: 0,
  };
  seat.world.constructionProjects.push(project);
  return { ok: true, data: { projectId: project.id, levels: project.levels } };
}

/** Why a controlled system can't take a colony order right now (mirrors planner eligibility). */
export type ColonyBlockReason = "already_forming" | "below_habitable_floor" | "no_seed_source";

/** Nearest developed same-faction seed source within the tick's reach radius, or null. */
export function findSeedSource(world: World, factionId: string, systemId: string): string | null {
  const hops = boundedHopsFromOrigin(systemId, world.connections, COLONY_REACH_HOPS);
  let best: { id: string; h: number } | null = null;
  for (const s of world.systems) {
    if (s.factionId !== factionId || s.control !== "developed") continue;
    const h = hops.get(s.id);
    if (h === undefined || h <= 0) continue;
    if (best === null || h < best.h || (h === best.h && s.id < best.id)) best = { id: s.id, h };
  }
  return best?.id ?? null;
}

/** Planner-equivalent eligibility for the direct-colony verb at a CONTROLLED player system. */
export function colonyEligibility(
  world: World, factionId: string, system: WorldSystem,
): { eligible: true; sourceSystemId: string } | { eligible: false; reason: ColonyBlockReason } {
  if (world.constructionProjects.some((p) => p.kind === "colony_establish" && p.systemId === system.id)) {
    return { eligible: false, reason: "already_forming" };
  }
  if (system.habitableSpace < EXPANSION.DEVELOP_HABITABLE_FLOOR) {
    return { eligible: false, reason: "below_habitable_floor" };
  }
  if (sizeColonyEstablish(system.habitableSpace, sizingParams()) === null) {
    return { eligible: false, reason: "below_habitable_floor" };
  }
  const source = findSeedSource(world, factionId, system.id);
  if (source === null) return { eligible: false, reason: "no_seed_source" };
  return { eligible: true, sourceSystemId: source };
}

export function sizingParams(): { seedPop: number; establishWork: number } {
  return { seedPop: EXPANSION.COLONY_SEED_POP, establishWork: COLONISATION.COLONY_ESTABLISH_WORK };
}

export type OrderColonyResult =
  | { ok: true; data: { projectId: string } }
  | { ok: false; error: string };

export function orderColony(input: { systemId: string }): OrderColonyResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const system = playerSystem(seat, input.systemId);
  if ("error" in system) return { ok: false, error: system.error };
  if (system.control !== "controlled") {
    return { ok: false, error: "Colonies are established at controlled, not-yet-colonised systems." };
  }

  const check = colonyEligibility(seat.world, seat.factionId, system);
  if (!check.eligible) {
    const message: Record<ColonyBlockReason, string> = {
      already_forming: "A colony is already forming here.",
      below_habitable_floor: "Below the habitable floor — this world cannot hold a colony.",
      no_seed_source: "No developed system in range to seed the colony from.",
    };
    return { ok: false, error: message[check.reason] };
  }
  const sizing = sizeColonyEstablish(system.habitableSpace, sizingParams());
  if (sizing === null) return { ok: false, error: "Below the habitable floor — this world cannot hold a colony." };

  const projectId = mintProjectId(seat.world);
  seat.world.constructionProjects.push({
    kind: "colony_establish",
    id: projectId,
    factionId: seat.factionId,
    systemId: system.id,
    origin: "player",
    sourceSystemId: check.sourceSystemId,
    seedPop: sizing.seedPop,
    housingLevels: sizing.housingLevels,
    workTotal: sizing.work,
    workDone: 0,
  });
  return { ok: true, data: { projectId } };
}

export type CancelOrderResult =
  | { ok: true; data: { projectId: string } }
  | { ok: false; error: string };

export function cancelOrder(input: { projectId: string }): CancelOrderResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const index = seat.world.constructionProjects.findIndex((p) => p.id === input.projectId);
  const project = index >= 0 ? seat.world.constructionProjects[index] : undefined;
  if (!project || project.factionId !== seat.factionId || project.origin !== "player") {
    return { ok: false, error: "No cancellable order with that id." };
  }
  seat.world.constructionProjects.splice(index, 1); // work spent is lost — by design
  return { ok: true, data: { projectId: input.projectId } };
}

export type SetAutomationResult =
  | { ok: true; data: { build: boolean; colonisation: boolean } }
  | { ok: false; error: string };

export function setAutomation(input: { build: boolean; colonisation: boolean }): SetAutomationResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const world = getWorld();
  if (!world.player) return { ok: false, error: "This world has no player seat." };
  world.player.automation = { build: input.build, colonisation: input.colonisation };
  return { ok: true, data: { ...world.player.automation } };
}
```

(Constant homes may differ — before writing imports, grep `COLONY_ESTABLISH_WORK`, `COLONY_SEED_POP`, `DEVELOP_HABITABLE_FLOOR`, `MAX_HOPS`, `REACH_JUMPS` for their actual module paths and use those. If `resourceVectorFromColumns(system)` takes a narrower argument shape, mirror the call in `lib/services/system-development.ts:17` exactly.)

Routes — all four follow the `new/route.ts` pattern (parse → schema → service → `ApiResponse`); `!result.ok` returns status 400:

`app/api/game/systems/[systemId]/build-orders/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { orderBuild } from "@/lib/services/construction-orders";
import { orderBuildSchema } from "@/lib/schemas/construction-orders";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { ApiResponse, OrderBuildResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  const { systemId } = await params;
  const body = await parseJsonBody<{ buildingType?: string; levels?: number }>(request);
  const parsed = orderBuildSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }
  const result = orderBuild({ systemId, ...parsed.data });
  if (!result.ok) return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 400 });
  return NextResponse.json<OrderBuildResponse>({ data: result.data });
}
```

`colony-orders/route.ts` — same shape, no body schema (the systemId param is the input): calls `orderColony({ systemId })`.
`construction-orders/[projectId]/route.ts` — `export async function DELETE(...)` awaiting `params` for `projectId`, calls `cancelOrder`.
`player/automation/route.ts` — `POST`, validates with `automationSchema`, calls `setAutomation`.

`lib/types/api.ts` — add:

```ts
export type OrderBuildResponse = ApiResponse<{ projectId: string; levels: number }>;
export type OrderColonyResponse = ApiResponse<{ projectId: string }>;
export type CancelOrderResponse = ApiResponse<{ projectId: string }>;
export type AutomationResponse = ApiResponse<{ build: boolean; colonisation: boolean }>;
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run lib/services lib/schemas` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add lib/services lib/schemas lib/types/api.ts app/api/game
git commit -m "feat(api): player construction verbs — build/colony orders, cancel, automation"
```

---

### Task 6: Read side — row `origin`, build-options service + route

**Files:**
- Modify: `lib/engine/construction-readout.ts` (`origin` on `ConstructionRowBase`)
- Create: `lib/services/build-options.ts`
- Create: `app/api/game/systems/[systemId]/build-options/route.ts`
- Modify: `lib/types/api.ts` (`SystemBuildOptionsData` + response)
- Test: `lib/engine/__tests__/construction-readout.test.ts`, `lib/services/__tests__/build-options.test.ts`

**Interfaces:**
- `ConstructionRowBase` gains `origin: "auto" | "player";` (copied from the project in `computeFactionConstruction`) — every row surface (system section, faction card) can now mark ORDERED and gate cancel.
- Produces:

```ts
// lib/types/api.ts
import type { BuildOption } from "@/lib/engine/build-options";
import type { ColonyBlockReason } from "@/lib/services/construction-orders";

/** One dialog/quick-add option: engine feasibility + display label + queue-aware ETA. */
export interface BuildOptionData extends BuildOption {
  label: string;
  /** ≈pulses until a 1-level order placed NOW would land (player queue position); null = stalled pool. */
  etaPulses: number | null;
}
export type SystemBuildOptionsData =
  | { mode: "none" }                                   // not the player's system (or no seat)
  | { mode: "colony"; colony:
      | { state: "eligible"; preview: { sourceSystemId: string; sourceSystemName: string; seedPop: number; housingLevels: number; work: number } }
      | { state: "ineligible"; reason: ColonyBlockReason } }
  | { mode: "build"; options: BuildOptionData[] };
export type SystemBuildOptionsResponse = ApiResponse<SystemBuildOptionsData>;

// lib/services/build-options.ts
export function getSystemBuildOptions(systemId: string): SystemBuildOptionsData
```

- Consumes: Task 4 engine + Task 5's `colonyEligibility`/`sizingParams`/`findSeedSource`; `orderOpenProjects`, `forecastEtaPulses` (`@/lib/engine/construction`); `buildingLabel` (`@/lib/engine/construction-readout`); `CONSTRUCTION` knobs; `factionConstructionPool`.

- [ ] **Step 1: Write the failing tests**

`lib/engine/__tests__/construction-readout.test.ts` — every fixture project already carries `origin` (Task 1 sweep); add:

```ts
  it("carries each project's origin through to its row", () => {
    const projects: WorldConstructionProject[] = [
      { kind: "build", id: "a", factionId: "f1", systemId: "s1", origin: "auto",
        buildingType: "housing", levels: 1, workTotal: 10, workDone: 0 },
      { kind: "build", id: "b", factionId: "f1", systemId: "s1", origin: "player",
        buildingType: "housing", levels: 1, workTotal: 10, workDone: 0 },
    ];
    const r = computeFactionConstruction(projects, systems, rates, 4);
    expect(r.all.map((row) => row.origin)).toEqual(["auto", "player"]);
  });
```

(`systems`/`rates`: reuse the file's fixtures.)

Create `lib/services/__tests__/build-options.test.ts` (same seat-world fixture idiom as Task 5's service test):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { getSystemBuildOptions } from "@/lib/services/build-options";
import { HOUSING_TYPE } from "@/lib/constants/industry";

function seatWorld() {
  return generateWorld({
    systemCount: 60, seed: 42,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
}

describe("getSystemBuildOptions", () => {
  beforeEach(() => { clearWorld(); setWorld(seatWorld()); });

  it("returns build mode with labelled options at the player's developed homeworld", () => {
    const w = getWorld();
    const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
    const data = getSystemBuildOptions(f.homeworldId);
    expect(data.mode).toBe("build");
    if (data.mode !== "build") return;
    const housing = data.options.find((o) => o.buildingType === HOUSING_TYPE)!;
    expect(housing.label).toBe("Housing");
    expect(housing.workPerLevel).toBeGreaterThan(0);
  });

  it("returns none for a rival faction's system and for a playerless world", () => {
    const w = getWorld();
    const foreign = w.systems.find(
      (s) => s.factionId !== null && s.factionId !== w.player?.controlledFactionId,
    )!;
    expect(getSystemBuildOptions(foreign.id).mode).toBe("none");
  });

  it("returns colony mode at a controlled player system", () => {
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    const home = w.systems.find((s) => s.id === w.factions.find((x) => x.id === pid)!.homeworldId)!;
    let target = w.systems.find((s) => s.factionId === pid && s.control === "controlled");
    if (!target) {
      const conn = w.connections.find((c) => c.fromId === home.id || c.toId === home.id)!;
      const otherId = conn.fromId === home.id ? conn.toId : conn.fromId;
      target = w.systems.find((s) => s.id === otherId)!;
      target.factionId = pid;
      target.control = "controlled";
    }
    const data = getSystemBuildOptions(target.id);
    expect(data.mode).toBe("colony");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/construction-readout.test.ts lib/services/__tests__/build-options.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/engine/construction-readout.ts` — `ConstructionRowBase` gains `origin: "auto" | "player";`; in `computeFactionConstruction`'s row-base literal add `origin: p.origin,`.

`lib/services/build-options.ts` — full file:

```ts
/**
 * Read service for the player's per-system build surface: which verbs exist here and their
 * feasibility. `none` on anything that isn't the player's system; `colony` on a controlled world
 * (the verb + its eligibility); `build` on a developed one (per-type options + queue-aware ETA —
 * the same numbers the order services enforce, so the UI never learns a different truth).
 */
import { getWorld, hasWorld } from "@/lib/world/store";
import { ServiceError } from "@/lib/services/errors";
import { computeBuildOptions } from "@/lib/engine/build-options";
import {
  factionConstructionPool, forecastEtaPulses, orderOpenProjects,
} from "@/lib/engine/construction";
import { buildingLabel } from "@/lib/engine/construction-readout";
import { colonyEligibility, sizingParams } from "@/lib/services/construction-orders";
import { sizeColonyEstablish } from "@/lib/engine/directed-build";
import { buildingsBySystem } from "@/lib/services/world-index";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { CONSTRUCTION } from "@/lib/constants/construction";
import type { SystemBuildOptionsData, BuildOptionData } from "@/lib/types/api";
import type { WorldConstructionProject } from "@/lib/world/types";

export function getSystemBuildOptions(systemId: string): SystemBuildOptionsData {
  if (!hasWorld()) throw new ServiceError("No world loaded", 409);
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError(`System ${systemId} not found.`, 404);

  const player = world.player;
  if (!player || system.factionId !== player.controlledFactionId) return { mode: "none" };

  if (system.control === "controlled") {
    const check = colonyEligibility(world, player.controlledFactionId, system);
    if (!check.eligible) return { mode: "colony", colony: { state: "ineligible", reason: check.reason } };
    const sizing = sizeColonyEstablish(system.habitableSpace, sizingParams());
    if (sizing === null) {
      return { mode: "colony", colony: { state: "ineligible", reason: "below_habitable_floor" } };
    }
    const sourceName = world.systems.find((s) => s.id === check.sourceSystemId)?.name ?? check.sourceSystemId;
    return {
      mode: "colony",
      colony: {
        state: "eligible",
        preview: {
          sourceSystemId: check.sourceSystemId, sourceSystemName: sourceName,
          seedPop: sizing.seedPop, housingLevels: sizing.housingLevels, work: sizing.work,
        },
      },
    };
  }
  if (system.control !== "developed") return { mode: "none" };

  const buildings = buildingsBySystem();
  const factionId = player.controlledFactionId;
  const factionProjects = orderOpenProjects(
    world.constructionProjects.filter((p) => p.factionId === factionId),
  );
  const committed: Record<string, number> = {};
  for (const p of factionProjects) {
    if (p.kind === "build" && p.systemId === system.id) {
      committed[p.buildingType] = (committed[p.buildingType] ?? 0) + p.levels;
    }
  }

  const options = computeBuildOptions(
    {
      population: system.population,
      buildings: buildings.get(system.id) ?? {},
      slotCap: resourceVectorFromColumns(system),
      generalSpace: system.generalSpace,
      habitableSpace: system.habitableSpace,
    },
    committed,
  );

  // Queue-aware ETA: a 1-level order placed NOW joins the queue behind everything committed (it is
  // a fresh player row), so its landing pulse comes from one forecast over queue + hypothetical row.
  const pool = factionConstructionPool(
    world.systems
      .filter((s) => s.factionId === factionId)
      .map((s) => ({ control: s.control, population: s.population, buildings: buildings.get(s.id) ?? {} })),
    { throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP, pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL },
  ).total;
  const cap = CONSTRUCTION.PER_BUILD_ABSORPTION_CAP;

  const decorated: BuildOptionData[] = options.map((o) => {
    let etaPulses: number | null = null;
    if (o.maxLevels > 0) {
      const hypothetical: WorldConstructionProject = {
        kind: "build", id: "eta-probe", factionId, systemId: system.id, origin: "player",
        buildingType: o.buildingType, levels: 1, workTotal: o.workPerLevel, workDone: 0,
      };
      const queue = [...factionProjects, hypothetical];
      etaPulses = forecastEtaPulses(queue, pool, cap)[queue.length - 1];
    }
    return { ...o, label: buildingLabel(o.buildingType), etaPulses };
  });

  return { mode: "build", options: decorated };
}
```

`app/api/game/systems/[systemId]/build-options/route.ts` — GET, mirroring the existing `systems/[systemId]/construction/route.ts` wrapper (read it for the ServiceError-to-status idiom and copy it; the service call is `getSystemBuildOptions(systemId)`, the response type `SystemBuildOptionsResponse`).

`lib/types/api.ts` — add the Interfaces-block types verbatim, next to `SystemConstructionData`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run lib/engine lib/services` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/construction-readout.ts lib/services lib/types/api.ts app/api/game
git commit -m "feat(api): per-system build options + colony eligibility read surface; row origin"
```

---

### Task 7: Client data layer — keys, hooks, invalidation

**Files:**
- Modify: `lib/query/keys.ts`
- Create: `lib/hooks/use-build-options.ts`
- Create: `lib/hooks/use-construction-orders.ts`
- Modify: `lib/hooks/use-tick-invalidation.ts`

**Interfaces:**
- Produces:

```ts
// keys
systemBuildOptionsAll: ["systemBuildOptions"] as const,
systemBuildOptions: (systemId: string) => ["systemBuildOptions", systemId] as const,

// use-build-options.ts
export function useSystemBuildOptions(systemId: string): SystemBuildOptionsData   // useSuspenseQuery

// use-construction-orders.ts — TanStack useMutation wrappers, all invalidating on success
export function useOrderBuild(systemId: string)     // mutate({ buildingType, levels })
export function useOrderColony(systemId: string)    // mutate()
export function useCancelOrder()                    // mutate({ projectId })
export function useSetAutomation()                  // mutate({ build, colonisation })
```

- [ ] **Step 1: Implement** (client plumbing — no unit tests; exercised by Task 8-10 surfaces and the Task 11 gates)

`lib/query/keys.ts` — add the two keys after `systemConstruction` with the comment `// Per-system player build options (feasibility + verbs) — tick-invalidated.`

`lib/hooks/use-build-options.ts`:

```ts
"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemBuildOptionsData } from "@/lib/types/api";

/** The player's build surface for one system (verbs + feasibility). Tick-invalidated. */
export function useSystemBuildOptions(systemId: string): SystemBuildOptionsData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemBuildOptions(systemId),
    queryFn: () => apiFetch<SystemBuildOptionsData>(`/api/game/systems/${systemId}/build-options`),
  });
  return data;
}
```

`lib/hooks/use-construction-orders.ts`:

```ts
"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiMutate, apiDelete } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";

/** Every order verb dirties the same three surfaces: queues, the faction summary, and feasibility. */
function invalidateOrderSurfaces(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.systemConstructionAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.factionConstructionAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.systemBuildOptionsAll });
}

export function useOrderBuild(systemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { buildingType: string; levels: number }) =>
      apiMutate<{ projectId: string; levels: number }>(`/api/game/systems/${systemId}/build-orders`, input),
    onSuccess: () => invalidateOrderSurfaces(queryClient),
  });
}

export function useOrderColony(systemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiMutate<{ projectId: string }>(`/api/game/systems/${systemId}/colony-orders`),
    onSuccess: () => invalidateOrderSurfaces(queryClient),
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string }) =>
      apiDelete<{ projectId: string }>(`/api/game/construction-orders/${input.projectId}`),
    onSuccess: () => invalidateOrderSurfaces(queryClient),
  });
}

export function useSetAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { build: boolean; colonisation: boolean }) =>
      apiMutate<{ build: boolean; colonisation: boolean }>(`/api/game/player/automation`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.factionConstructionAll });
    },
  });
}
```

`lib/hooks/use-tick-invalidation.ts` — in the `economyTick` block, after the construction invalidations:

```ts
        queryClient.invalidateQueries({ queryKey: queryKeys.systemBuildOptionsAll });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/query/keys.ts lib/hooks
git commit -m "feat(client): build-options query + order mutation hooks"
```

---

### Task 8: Industry tab — ghost rows, quick-add, new-industry dialog

**Files:**
- Create: `components/system/industry-ghosts.ts` (pure classification helper)
- Create: `components/construction/quick-add-button.tsx`
- Create: `components/construction/build-dialog.tsx`
- Modify: `components/system/industry-panel.tsx` (ghost rows into both tables; `+` column; New industry button)
- Test: `components/system/__tests__/industry-ghosts.test.ts`

**Interfaces:**
- Produces:

```ts
// industry-ghosts.ts — pure, testable without DOM
export type GhostGroup = "deposit" | "Housing" | "Specialisation" | "Production" | "Support";
export interface GhostRow {
  projectId: string;
  buildingType: string;
  label: string;
  levels: number;
  origin: "auto" | "player";
  progress: number;            // 0..1
  etaPulses: number | null;
  /** deposit ghosts carry the resource their extractor sits on. */
  resource?: string;
}
/** Split a system's in-flight BUILD rows into ledger destinations. Colony rows are excluded
 *  (they render on the undeveloped surface, Task 9). */
export function classifyGhosts(rows: ConstructionProjectRow[]): Map<GhostGroup, GhostRow[]>

// quick-add-button.tsx
export function QuickAddButton(props: {
  systemId: string;
  option: BuildOptionData;       // blocked/maxLevels/eta drive disabled state + tooltip
}): JSX.Element

// build-dialog.tsx
export function BuildDialog(props: {
  systemId: string;
  systemName: string;
  /** Types with no ledger row yet (the caller filters). */
  options: BuildOptionData[];
  open: boolean;
  onClose: () => void;
}): JSX.Element
```

- Consumes: `useSystemConstruction`, `useSystemBuildOptions`, `useOrderBuild`, `useCancelOrder` (Task 7); `ConstructionProjectRow` (with `origin`, Task 6); `Dialog`/`useDialog`, `Button`, `Badge`, `InlineAlert`, `Tooltip` primitives; `SelectInput`, `NumberInput` from `components/form/`; RHF + `zodResolver`.

- [ ] **Step 1: Write the failing tests**

Create `components/system/__tests__/industry-ghosts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyGhosts } from "@/components/system/industry-ghosts";
import {
  HOUSING_TYPE, CONSTRUCTION_CENTRE_TYPE, COMPLEX_TYPES, BUILDING_TYPES,
} from "@/lib/constants/industry";
import type { ConstructionProjectRow } from "@/lib/engine/construction-readout";

function buildRow(buildingType: string, origin: "auto" | "player" = "auto"): ConstructionProjectRow {
  return {
    kind: "build", id: `p-${buildingType}`, systemId: "s1", systemName: "Alpha", origin,
    buildingType, buildingLabel: buildingType, levels: 2, detail: "", progress: 0.25,
    workDone: 5, workTotal: 20, etaPulses: 3, nextPulseGain: 2,
  };
}

describe("classifyGhosts", () => {
  it("routes extractors to the deposit group with their resource, others to their ledger group", () => {
    const tier0 = Object.keys(BUILDING_TYPES).find((t) => BUILDING_TYPES[t].resource !== undefined)!;
    const complex = COMPLEX_TYPES[0];
    const ghosts = classifyGhosts([
      buildRow(tier0), buildRow(HOUSING_TYPE, "player"),
      buildRow(CONSTRUCTION_CENTRE_TYPE), buildRow(complex),
    ]);
    expect(ghosts.get("deposit")?.[0]?.resource).toBe(BUILDING_TYPES[tier0].resource);
    expect(ghosts.get("Housing")?.[0]?.origin).toBe("player");
    expect(ghosts.get("Support")?.[0]?.buildingType).toBe(CONSTRUCTION_CENTRE_TYPE);
    expect(ghosts.get("Specialisation")?.[0]?.buildingType).toBe(complex);
  });

  it("excludes colony rows — they belong to the undeveloped surface, not the ledger", () => {
    const colony: ConstructionProjectRow = {
      kind: "colony_establish", id: "c1", systemId: "s1", systemName: "Alpha", origin: "player",
      sourceSystemId: "s0", sourceSystemName: "Home", seedPop: 100, housingLevels: 1,
      progress: 0.5, workDone: 10, workTotal: 20, etaPulses: 2, nextPulseGain: 2,
    };
    expect(classifyGhosts([colony]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/system/__tests__/industry-ghosts.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helper**

First, `lib/engine/construction-readout.ts` — `ConstructionProjectBuildRow` gains the raw type id
the ghost classifier keys on (the label alone can't be classified):

```ts
export interface ConstructionProjectBuildRow extends ConstructionRowBase {
  kind: "build";
  /** Raw building-type id — ledger-group classification keys on this, not the label. */
  buildingType: string;
  /** "Housing", "Foundry", "Vocational School", … */
  buildingLabel: string;
  levels: number;
  detail: string;
}
```

…and `computeFactionConstruction`'s build branch adds `buildingType: p.buildingType,`. (tsc flags any
fixture that needs the field — add it alongside `buildingLabel`.)

Then `components/system/industry-ghosts.ts`:

```ts
/**
 * Ledger placement for a system's in-flight BUILD projects — each ghost row lands in the group its
 * building will join (extractors on the deposit table via their resource; everything else under its
 * Housing / Specialisation / Production / Support heading), so the Industry tab reads
 * "have N, M more coming" in place. Colony rows are excluded: a forming colony is the undeveloped
 * surface's content, not a ledger entry.
 */
import type { ConstructionProjectRow } from "@/lib/engine/construction-readout";
import {
  BUILDING_TYPES, HOUSING_TYPE, COMPLEX_TYPES, SUPPORT_TYPES, ACADEMY_TYPES,
} from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";

export type GhostGroup = "deposit" | "Housing" | "Specialisation" | "Production" | "Support";

export interface GhostRow {
  projectId: string;
  buildingType: string;
  label: string;
  levels: number;
  origin: "auto" | "player";
  progress: number;
  etaPulses: number | null;
  resource?: string;
}

function groupFor(buildingType: string): { group: GhostGroup; resource?: string } | null {
  const resource = BUILDING_TYPES[buildingType]?.resource;
  if (GOOD_TIER_BY_KEY[buildingType] === 0 && resource !== undefined) return { group: "deposit", resource };
  if (buildingType === HOUSING_TYPE) return { group: "Housing" };
  if (COMPLEX_TYPES.includes(buildingType)) return { group: "Specialisation" };
  if (SUPPORT_TYPES.includes(buildingType)) return { group: "Support" };
  if (ACADEMY_TYPES.includes(buildingType)) return { group: "Support" }; // academies have no ledger row; surface them with Support
  if ((GOOD_TIER_BY_KEY[buildingType] ?? 0) >= 1) return { group: "Production" };
  return null;
}

export function classifyGhosts(rows: ConstructionProjectRow[]): Map<GhostGroup, GhostRow[]> {
  const out = new Map<GhostGroup, GhostRow[]>();
  for (const row of rows) {
    if (row.kind !== "build") continue;
    const placed = groupFor(row.buildingType);
    if (!placed) continue;
    const list = out.get(placed.group) ?? [];
    list.push({
      projectId: row.id,
      buildingType: row.buildingType,
      label: row.buildingLabel,
      levels: row.levels,
      origin: row.origin,
      progress: row.progress,
      etaPulses: row.etaPulses,
      resource: placed.resource,
    });
    out.set(placed.group, list);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/system/__tests__/industry-ghosts.test.ts lib/engine`
Expected: PASS.

- [ ] **Step 5: Implement the controls**

`components/construction/quick-add-button.tsx`:

```tsx
"use client";

import { useOrderBuild } from "@/lib/hooks/use-construction-orders";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatEta } from "@/lib/utils/construction-format";
import type { BuildOptionData } from "@/lib/types/api";

const BLOCK_COPY = {
  no_space: "No space left for this building here.",
  no_deposit_slots: "No free deposit slots here.",
} as const;

/**
 * One-click "+1 level" order for a ledger row. The ledger itself is the feasibility readout, so the
 * tooltip carries only the quick numbers (work · ≈pulses); a hard-blocked row disables with its
 * reason. Bare TooltipTrigger — a square icon button already reads as a control.
 */
export function QuickAddButton({ systemId, option }: { systemId: string; option: BuildOptionData }) {
  const order = useOrderBuild(systemId);
  const blocked = option.maxLevels === 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Queue +1 ${option.label} level`}
          disabled={blocked || order.isPending}
          onClick={() => order.mutate({ buildingType: option.buildingType, levels: 1 })}
          className="inline-flex h-5 w-5 items-center justify-center border border-accent/40 bg-accent/10 font-mono text-[13px] leading-none text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          +
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        {blocked && option.blocked ? (
          <p className="text-[11px] text-text-secondary">{BLOCK_COPY[option.blocked]}</p>
        ) : (
          <p className="font-mono text-[11px] text-text-secondary">
            +1 level · {option.workPerLevel} work · {formatEta(option.etaPulses)}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
```

`components/construction/build-dialog.tsx` (the §3 wireframe: form left, feasibility readout right; hard blocks disable submit, the staffing row warns amber):

```tsx
"use client";

import { useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SelectInput } from "@/components/form/select-input";
import { NumberInput } from "@/components/form/number-input";
import { useOrderBuild } from "@/lib/hooks/use-construction-orders";
import { formatEta } from "@/lib/utils/construction-format";
import { formatPeople } from "@/lib/utils/format";
import type { BuildOptionData } from "@/lib/types/api";

const orderSchema = z.object({
  buildingType: z.string().min(1, "Pick a building"),
  levels: z.number().int().min(1, "At least 1 level"),
});
type OrderForm = z.infer<typeof orderSchema>;

/** Readout row: label left, mono value right; tone colours the value. */
function ReadoutRow({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const toneClass =
    tone === "ok" ? "text-status-green-light" : tone === "warn" ? "text-status-amber-light" : tone === "bad" ? "text-status-red-light" : "text-text-primary";
  return (
    <div className="flex items-baseline justify-between border-b border-dotted border-border py-1 text-xs last:border-b-0">
      <span className="text-text-tertiary">{label}</span>
      <span className={`font-mono ${toneClass}`}>{value}</span>
    </div>
  );
}

/**
 * New-industry order dialog — the one dialog left: types with no ledger row yet, system fixed.
 * Space/slot ceilings hard-block submit; the staffing estimate warns and never blocks.
 */
export function BuildDialog({
  systemId, systemName, options, open, onClose,
}: {
  systemId: string;
  systemName: string;
  options: BuildOptionData[];
  open: boolean;
  onClose: () => void;
}) {
  const order = useOrderBuild(systemId);
  const { control, handleSubmit, watch, reset, formState } = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: { buildingType: options[0]?.buildingType ?? "", levels: 1 },
  });
  const chosenType = watch("buildingType");
  const levels = watch("levels");
  const option = useMemo(() => options.find((o) => o.buildingType === chosenType), [options, chosenType]);

  const overCeiling = option !== undefined && levels > option.maxLevels;
  const staffingShort = option !== undefined && option.estStaffing < 1;
  const totalWork = option !== undefined ? option.workPerLevel * Math.max(1, levels) : 0;

  const submit = handleSubmit((values) => {
    order.mutate(values, { onSuccess: () => { reset(); onClose(); } });
  });

  return (
    <Dialog open={open} onClose={onClose} modal size="md" initialFocus="select">
      <h3 className="font-display text-base font-bold text-text-primary">New industry — {systemName}</h3>
      <p className="mb-4 mt-0.5 text-xs text-text-tertiary">
        Ordered work outranks autonomic proposals in the funding queue.
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_260px]">
        <div>
          <Controller
            control={control}
            name="buildingType"
            render={({ field }) => (
              <SelectInput
                label="Building"
                value={field.value}
                onChange={field.onChange}
                options={options.map((o) => ({ value: o.buildingType, label: o.label }))}
              />
            )}
          />
          <div className="mt-3">
            <Controller
              control={control}
              name="levels"
              render={({ field }) => (
                <NumberInput label="Levels" value={field.value} onChange={field.onChange} min={1} max={option?.maxLevels ?? 1} />
              )}
            />
          </div>
          {overCeiling && option && (
            <InlineAlert color="red" className="mt-3">
              {option.blocked === "no_deposit_slots"
                ? "No free deposit slots for that building here."
                : `Not enough space — ${option.maxLevels} level(s) fit here.`}
            </InlineAlert>
          )}
          {!overCeiling && staffingShort && (
            <InlineAlert color="amber" className="mt-3">
              Staffing shortfall — this adds labour demand your population can&apos;t fill. It will run
              under-staffed and exposed to decay.
            </InlineAlert>
          )}
        </div>
        <div className="self-start border border-border bg-surface-hover p-3.5">
          <p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
            Feasibility — {systemName}
          </p>
          {option && (
            <>
              <ReadoutRow
                label="Max levels"
                value={String(option.maxLevels)}
                tone={overCeiling ? "bad" : "ok"}
              />
              <ReadoutRow
                label="Labour added"
                value={`${formatPeople(option.labourAdded.unskilled * Math.max(1, levels))} + ${formatPeople(option.labourAdded.skill1 * Math.max(1, levels))} tech`}
              />
              <ReadoutRow
                label="Est. staffing"
                value={`${Math.round(option.estStaffing * 100)}%`}
                tone={staffingShort ? "warn" : "ok"}
              />
              <ReadoutRow label="Work" value={String(totalWork)} />
              <ReadoutRow label="ETA" value={formatEta(option.etaPulses)} />
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" disabled={!option || overCeiling || !formState.isValid || order.isPending}>
            Queue build
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
```

(Read `components/form/select-input.tsx` / `number-input.tsx` before wiring — match their actual prop names; if `InlineAlert` takes a different colour prop, mirror its real API. If `labourAdded.skill2 > 0` types exist in the catalog, append `+ N eng` to the labour row the same way.)

- [ ] **Step 6: Integrate into the industry panel**

`components/system/industry-panel.tsx` — the integration (read the file top-to-bottom first; it was fully quoted during design):

1. `IndustryPanel` additionally calls `useSystemConstruction(systemId)` and `useSystemBuildOptions(systemId)`. Derive:

```tsx
  const construction = useSystemConstruction(systemId);
  const buildSurface = useSystemBuildOptions(systemId);
  const ghostRows = classifyGhosts(construction.visibility === "visible" ? construction.projects : []);
  const canOrder = buildSurface.mode === "build";
  const optionByType = new Map(canOrder ? buildSurface.options.map((o) => [o.buildingType, o]) : []);
```

2. **Health strip** gains the New-industry button after `<LegendTooltip />` when `canOrder`: an outline `Button` (`size="xs"`) labelled `+ New industry`, opening the `BuildDialog` via `useDialog`. Dialog `options` = `buildSurface.options.filter((o) => !(o.buildingType in currentCounts) && o.maxLevels > 0)` where `currentCounts` is the map the panel already derives from `buildings` (types with a ledger row get quick-add instead).
3. **DepositTable**: add a trailing narrow column (header empty, width ~26px). Existing deposit rows render `<QuickAddButton>` for the deposit's extractor type **when `canOrder` and exactly one catalog extractor type works that resource** (`Object.keys(BUILDING_TYPES).filter((t) => BUILDING_TYPES[t].resource === row.resource)`); more than one → render nothing (the dialog covers it). Below matching deposit rows, render that resource's ghost rows from `ghostRows.get("deposit")`.
4. **BuildingsTable**: same trailing column; each building row gets `<QuickAddButton option={optionByType.get(b.buildingType)}>` when `canOrder` and the option exists. After each group's real rows, append the group's ghosts (`ghostRows.get(group.title)`); a group whose `buildings` array is empty but has ghosts must still render its heading.
5. **Ghost row rendering** (one shared row component inside the panel file — mirrors the wireframe grammar):

```tsx
/** In-flight build in the ledger: ◇ dim row, slim amber bar, % + ETA in the numeric columns. */
function GhostLedgerRow({ ghost, canCancel, onCancel, columns }: {
  ghost: GhostRow; canCancel: boolean; onCancel: (projectId: string) => void; columns: 3 | 4;
}) {
  return (
    <tr className="border-b border-border/40 last:border-b-0">
      <td className="px-1.5 py-1 text-[12px] text-text-tertiary">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="font-mono text-[9px] text-status-amber-light">◇</span>
          {ghost.label} <span className="font-mono">+{ghost.levels}</span>
          {ghost.origin === "player" && <Badge color="amber">ORDERED</Badge>}
          {ghost.origin === "player" && canCancel && (
            <button
              type="button"
              aria-label={`Cancel ${ghost.label} order`}
              onClick={() => onCancel(ghost.projectId)}
              className="px-1 text-[11px] text-status-red-light transition-colors hover:text-status-red"
            >
              ✕
            </button>
          )}
        </span>
        <span className="mt-0.5 block h-1 max-w-[180px] bg-surface-active">
          <span aria-hidden className="block h-full bg-status-amber/75" style={{ width: `${Math.round(ghost.progress * 100)}%` }} />
        </span>
      </td>
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-status-amber-light">
        {Math.round(ghost.progress * 100)}%
      </td>
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-text-tertiary">{formatEta(ghost.etaPulses)}</td>
      {columns === 4 && <td />}
    </tr>
  );
}
```

   Wire `onCancel` to `useCancelOrder().mutate({ projectId })` at the panel level; `canCancel = canOrder` (verbs only on the player's systems — AI ghosts render read-only, which is the rival-visibility parity requirement).
6. Deposit-table headers gain the empty fourth `<Th>` only when `canOrder` (AI systems keep today's exact 4-column deposit / 3-column building layout — pass `columns` accordingly, and use a gold ORDERED badge if `Badge` has a gold/amber variant; `amber` is the existing closest).

- [ ] **Step 7: Verify + commit**

Run: `npx vitest run components lib` then `npx tsc --noEmit`, then `/verify`-style manual smoke: `npm run dev`, open a player system's Industry tab → quick-add housing (row appears as ghost with ORDERED + ✕), open New industry dialog, order a type, cancel it.

```bash
git add components lib/engine/construction-readout.ts
git commit -m "feat(ui): Industry-tab construction surface — ghost rows, quick-add, new-industry dialog"
```

---

### Task 9: Colony surface + Overview cleanup

**Files:**
- Create: `components/construction/colony-section.tsx`
- Modify: `components/system/industry-panel.tsx` (undeveloped states render the colony surface)
- Modify: `components/construction/construction-row.tsx` (ORDERED badge + optional cancel)
- Modify: `app/(game)/@panel/system/[systemId]/page.tsx` (drop the card; add the pointer line)
- Delete: `components/construction/system-construction-section.tsx`

**Interfaces:**
- `ConstructionRow` gains optional `onCancel?: (projectId: string) => void`; renders an amber ORDERED `Badge` when `row.origin === "player"`, and the ✕ cancel button when both player-origin and `onCancel` given.
- Produces:

```tsx
/** The Industry tab's content for a controlled, not-yet-developed system: forming project (hero row),
 *  eligible verb + preview, or ineligible reason. Renders nothing on systems that aren't in a colony
 *  state (developed / foreign-undeveloped-with-nothing-forming). */
export function ColonySection(props: { systemId: string }): JSX.Element | null
```

- [ ] **Step 1: Implement `ColonySection`**

`components/construction/colony-section.tsx`:

```tsx
"use client";

import { useSystemConstruction } from "@/lib/hooks/use-system-construction";
import { useSystemBuildOptions } from "@/lib/hooks/use-build-options";
import { useOrderColony, useCancelOrder } from "@/lib/hooks/use-construction-orders";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConstructionRow } from "@/components/construction/construction-row";
import { formatMagnitude } from "@/lib/utils/format";
import type { ColonyBlockReason } from "@/lib/services/construction-orders";

const REASON_COPY: Record<ColonyBlockReason, string> = {
  already_forming: "A colony is already forming here.",
  below_habitable_floor: "Below the habitable floor — this world cannot hold a colony.",
  no_seed_source: "No developed system in range to seed a colony from.",
};

/**
 * A controlled system's Industry-tab content — the ledger's founding entry. Forming → the colony
 * project hero-sized (cancellable when player-ordered); eligible → the Establish verb + its preview
 * (the preview line IS the confirmation surface — the click orders directly); ineligible → the
 * verb disabled with the planner's blocking reason. Foreign systems render forming read-only.
 */
export function ColonySection({ systemId }: { systemId: string }) {
  const construction = useSystemConstruction(systemId);
  const buildSurface = useSystemBuildOptions(systemId);
  const orderColony = useOrderColony(systemId);
  const cancel = useCancelOrder();

  const forming = construction.visibility === "visible"
    ? construction.projects.find((p) => p.kind === "colony_establish")
    : undefined;
  const colony = buildSurface.mode === "colony" ? buildSurface.colony : null;
  if (!forming && !colony) return null;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader title="Construction" />
      <CardContent>
        {forming ? (
          <ConstructionRow
            row={forming}
            showSystem={false}
            onCancel={buildSurface.mode !== "none" ? (projectId) => cancel.mutate({ projectId }) : undefined}
          />
        ) : colony?.state === "eligible" ? (
          <>
            <p className="mb-3 text-sm text-text-tertiary">
              Controlled, not yet colonised. Charted deposits await development.
            </p>
            <Button
              variant="action"
              color="green"
              size="sm"
              disabled={orderColony.isPending}
              onClick={() => orderColony.mutate()}
            >
              ◆ Establish colony
            </Button>
            <p className="mt-2.5 text-xs text-text-secondary">
              seeds <span className="font-mono text-text-primary">{formatMagnitude(colony.preview.seedPop)}</span> pop
              from <span className="text-text-accent">{colony.preview.sourceSystemName}</span> ·{" "}
              <span className="font-mono text-text-primary">{colony.preview.housingLevels}</span> housing bundled ·{" "}
              <span className="font-mono text-text-primary">{formatMagnitude(colony.preview.work)}</span> work
            </p>
          </>
        ) : colony ? (
          <>
            <p className="mb-3 text-sm text-text-tertiary">Controlled, not yet colonised.</p>
            <Button variant="action" color="green" size="sm" disabled>◆ Establish colony</Button>
            <p className="mt-2.5 text-xs text-status-amber-light">{REASON_COPY[colony.reason]}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

(Match `Button`'s real variant/color API — the theme doc lists `action` + `green` as an existing compound.)

- [ ] **Step 2: Extend `ConstructionRow`**

`components/construction/construction-row.tsx` — props become `{ row, showSystem, onCancel }`; in the title line, after the ETA span's *left* neighbours (i.e. right after the title text), insert:

```tsx
        {row.origin === "player" && <Badge color="amber">ORDERED</Badge>}
```

and on the detail line (both kinds), when `row.origin === "player" && onCancel`:

```tsx
        <button
          type="button"
          aria-label="Cancel order"
          onClick={() => onCancel(row.id)}
          className="ml-auto px-1.5 text-[11px] text-status-red-light transition-colors hover:text-status-red"
        >
          ✕ Cancel
        </button>
```

(The colony detail line is a `<p>` — wrap its content in a flex span so `ml-auto` works, mirroring how the build branch already lays out its detail row in Task 8's panel work.)

- [ ] **Step 3: Wire the industry page states + delete the Overview card**

1. `components/system/industry-panel.tsx` — the two `EmptyState` early-returns become colony-aware:

```tsx
  if (data.visibility === "unknown") {
    return (
      <>
        <ColonySection systemId={systemId} />
        <EmptyState message="This system isn't developed yet — no industry to survey." />
      </>
    );
  }
```

   (`ColonySection` returns null when there's nothing to show, so foreign empty systems keep today's exact rendering. The `buildings.length === 0` branch stays as-is — a developed system with no industry is not a colony state.)
2. `app/(game)/@panel/system/[systemId]/page.tsx` — remove the `SystemConstructionSection` import + render. In its place (end of the context-strip card or directly after it), the pointer line:

```tsx
      <ConstructionPointer systemId={systemId} />
```

   with, in the same file:

```tsx
/** One-line scent trail to the Industry tab while anything is forming/building here. No bars, no queue. */
function ConstructionPointer({ systemId }: { systemId: string }) {
  const data = useSystemConstruction(systemId);
  if (data.visibility !== "visible" || data.projects.length === 0) return null;
  const colony = data.projects.find((p) => p.kind === "colony_establish");
  const text = colony
    ? `colony forming — ${Math.round(colony.progress * 100)}%`
    : `${data.projects.length} project${data.projects.length === 1 ? "" : "s"} building`;
  return (
    <Link
      href={`/system/${systemId}/industry`}
      className="mb-6 block text-xs text-text-accent transition-colors hover:text-text-accent-hover"
    >
      {text} → Industry
    </Link>
  );
}
```

3. Delete `components/construction/system-construction-section.tsx`; `npx tsc --noEmit` confirms nothing else imports it.

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run components lib` + `npx tsc --noEmit`; manual smoke: an eligible controlled player system shows the verb on its Industry tab, ordering flips it to the forming hero row with ORDERED + cancel; the Overview shows only the pointer line.

```bash
git add components app lib
git commit -m "feat(ui): colonisation as the ledger's founding entry; Overview queue card removed"
```

---

### Task 10: Faction command card

**Files:**
- Modify: `lib/services/construction.ts` + `lib/types/api.ts` (`FactionConstructionData` reshape)
- Rewrite: `components/construction/faction-construction-card.tsx`
- Test: `lib/services/__tests__/construction.test.ts` (extend or create — mirror the seat-world fixture)

**Interfaces:**
- Produces (replaces the old row-array shape — `expansion`/`buildOut`/`expandCount`/`buildCount` leave the API):

```ts
export interface FactionConstructionData {
  factionId: string;
  pool: number;
  poolBase: number;
  poolCentres: number;
  /** The player's switches; null on AI factions (no switches rendered). */
  automation: { build: boolean; colonisation: boolean } | null;
  /** Systems with open build projects — count desc, then name asc. */
  buildSystems: Array<{ systemId: string; systemName: string; count: number }>;
  /** Forming colonies — progress desc, then name asc. */
  colonies: Array<{ systemId: string; systemName: string; progress: number }>;
  /** Player-originated open projects across the faction. */
  orderedCount: number;
}
```

- Consumes: the readout's `all` rows (`origin`, `progress`, `systemId`, `systemName`); `useSetAutomation` (Task 7); `CheckboxInput` (`components/form/checkbox-input.tsx`).

- [ ] **Step 1: Write the failing test**

Append to (or create) `lib/services/__tests__/construction.test.ts` — seat-world fixture as in Task 5, then:

```ts
  it("summarises the queue as link lists and surfaces the player's switches", () => {
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    const home = w.factions.find((f) => f.id === pid)!.homeworldId;
    orderBuild({ systemId: home, buildingType: HOUSING_TYPE, levels: 1 });
    const data = getFactionConstruction(pid);
    expect(data.automation).toEqual({ build: true, colonisation: true });
    expect(data.buildSystems.some((s) => s.systemId === home && s.count >= 1)).toBe(true);
    expect(data.orderedCount).toBeGreaterThanOrEqual(1);
    // An AI faction reports no switches.
    const ai = w.factions.find((f) => f.id !== pid)!;
    expect(getFactionConstruction(ai.id).automation).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/services/__tests__/construction.test.ts`
Expected: FAIL — shape mismatch.

- [ ] **Step 3: Implement the service reshape**

`lib/services/construction.ts` — `getFactionConstruction` becomes:

```ts
export function getFactionConstruction(factionId: string): FactionConstructionData {
  const readout = readoutForFaction(factionId);
  const world = getWorld();

  const bySystem = new Map<string, { systemName: string; count: number }>();
  const colonies: Array<{ systemId: string; systemName: string; progress: number }> = [];
  let orderedCount = 0;
  for (const row of readout.all) {
    if (row.origin === "player") orderedCount += 1;
    if (row.kind === "colony_establish") {
      colonies.push({ systemId: row.systemId, systemName: row.systemName, progress: row.progress });
    } else {
      const entry = bySystem.get(row.systemId) ?? { systemName: row.systemName, count: 0 };
      entry.count += 1;
      bySystem.set(row.systemId, entry);
    }
  }
  const buildSystems = [...bySystem]
    .map(([systemId, v]) => ({ systemId, systemName: v.systemName, count: v.count }))
    .sort((a, b) => b.count - a.count || a.systemName.localeCompare(b.systemName));
  colonies.sort((a, b) => b.progress - a.progress || a.systemName.localeCompare(b.systemName));

  const automation =
    world.player?.controlledFactionId === factionId ? { ...world.player.automation } : null;

  return {
    factionId,
    pool: readout.pool, poolBase: readout.poolBase, poolCentres: readout.poolCentres,
    automation, buildSystems, colonies, orderedCount,
  };
}
```

Update `FactionConstructionData` in `lib/types/api.ts` to the Interfaces shape (delete the row-array fields). `getSystemConstruction` is untouched (it reads `readout.all`).

- [ ] **Step 4: Rewrite the card**

`components/construction/faction-construction-card.tsx` — full replacement:

```tsx
"use client";

import Link from "next/link";
import { useFactionConstruction } from "@/lib/hooks/use-faction-construction";
import { useSetAutomation } from "@/lib/hooks/use-construction-orders";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { CheckboxInput } from "@/components/form/checkbox-input";
import { formatMagnitude } from "@/lib/utils/format";

/**
 * The faction's construction command summary: the automation switch pair (player faction only),
 * the pool with its base + centres composition, and compact link lists — build-out by system and
 * forming colonies. Detail lives where the thing is built: every link lands on the system's
 * Industry tab.
 */
export function FactionConstructionCard({ factionId }: { factionId: string }) {
  const data = useFactionConstruction(factionId);
  const setAutomation = useSetAutomation();
  const empty = data.buildSystems.length === 0 && data.colonies.length === 0;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader
        title="Construction"
        subtitle={
          <>
            pool <span className="font-mono text-text-secondary">{formatMagnitude(data.pool)}</span>/pulse ·{" "}
            <span className="font-mono text-text-secondary">{formatMagnitude(data.poolBase)}</span> base +{" "}
            <span className="font-mono text-text-secondary">{formatMagnitude(data.poolCentres)}</span> centres
            {data.orderedCount > 0 && <> · {data.orderedCount} ordered</>}
          </>
        }
      />
      <CardContent>
        {data.automation && (
          <div className="mb-4 flex gap-2">
            <CheckboxInput
              label="Autonomic build"
              checked={data.automation.build}
              onChange={(build) =>
                setAutomation.mutate({ build, colonisation: data.automation?.colonisation ?? true })
              }
            />
            <CheckboxInput
              label="Autonomic colonisation"
              checked={data.automation.colonisation}
              onChange={(colonisation) =>
                setAutomation.mutate({ build: data.automation?.build ?? true, colonisation })
              }
            />
          </div>
        )}
        {empty ? (
          <EmptyState message="No active construction or expansion." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <SectionHeader as="h4" className="mb-2">
                Building — {data.buildSystems.reduce((s, x) => s + x.count, 0)} across {data.buildSystems.length} systems
              </SectionHeader>
              <ul>
                {data.buildSystems.map((s) => (
                  <li key={s.systemId} className="flex items-baseline justify-between py-0.5 text-sm">
                    <Link href={`/system/${s.systemId}/industry`} className="text-text-accent transition-colors hover:text-text-accent-hover">
                      {s.systemName}
                    </Link>
                    <span className="font-mono text-xs text-text-secondary">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionHeader as="h4" className="mb-2">Colonies forming — {data.colonies.length}</SectionHeader>
              <ul>
                {data.colonies.map((c) => (
                  <li key={c.systemId} className="py-0.5 text-sm">
                    <Link href={`/system/${c.systemId}/industry`} className="text-text-accent transition-colors hover:text-text-accent-hover">
                      {c.systemName}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

(`CheckboxInput`'s row styling comes from `choiceRow` slots — pass no extra className; if the two rows need widths, wrap each in `flex-1` divs. `CardHeader.subtitle` accepts `ReactNode` — it does today.)

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run` + `npx tsc --noEmit`; manual smoke: player faction page shows switches + lists; toggling persists (refetch shows the new state); an AI faction page shows lists only.

```bash
git add lib components
git commit -m "feat(ui): faction construction card becomes a command summary with link lists"
```

---

### Task 11: Gates — full suite, build, simulator no-change check

- [ ] **Step 1: Full local gate**

Run, in order — all must pass:

```bash
npx tsc --noEmit
npx vitest run
npx next build --webpack
```

- [ ] **Step 2: Simulator gate (playerless path unchanged)**

```bash
npm run simulate -- --config experiments/examples/cadence-invariance-24.yaml > "$env:TEMP/sim-pr-b.txt" 2>&1
```

Diff against the Task 0 baseline. The playerless world takes none of PR B's paths (`origin` is always `"auto"`, no player, `orderOpenProjects` is an identity), so the gate is **statistical no-change**: population, developed-system counts, pool composition, and queue sizes within the run's ordinary noise band, and no NaN/`null`. A real divergence means the ordering or persist change leaked into the AI path — stop and fix before the PR.

- [ ] **Step 3: Manual smoke checklist (run through once in `npm run dev`)**

1. New game → homeworld Industry tab: quick-add on a row → ghost row with ORDERED + ✕; tooltip shows work + ETA; cancel removes it.
2. New industry dialog: readout updates per building/levels; over-ceiling blocks; staffing warns amber but submits.
3. Eligible controlled system → Establish colony → forming hero row; Overview shows the pointer line only.
4. Faction page: switches toggle + persist; lists link to Industry tabs.
5. A rival's developed system: read-only tab, ghosts visible, no buttons.
6. Save, restart dev server, load → orders + switches survive (v7 round-trip in anger).

- [ ] **Step 4: Push + PR into the shared branch**

```bash
git push -u origin feat/player-seat-2-control
gh pr create --base feat/player-seat-2 --title "Player seat Slice 2 PR B — the control half" --body "..."
```

Then run `/uber-review` on the PR (check out the PR head first), fix findings, and squash-merge into `feat/player-seat-2` per the project git workflow. **After the merge, the slice is complete** — the slice-ship doc lifecycle (promote the Slice 2 spec into `docs/active/`, update `docs/SPEC.md`, delete `player-seat.md`, `player-seat-s2-pr-a.md`, and this file) happens on the shared branch BEFORE shared→main.
