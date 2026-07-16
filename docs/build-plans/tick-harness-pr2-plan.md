# Tick-harness PR2 (move + rename the row types) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the tick's four working row types out of `lib/engine/simulator/` and into `lib/tick/rows.ts`, renamed `Sim*` → `Tick*`, so live tick code stops importing its core types from a directory named `simulator`. Rename the `toSim*` joins to `toTick*`, and free the `TickEvent` name by renaming the broadcast payload `TickEventRaw` → `TickBroadcastRaw`.

**Architecture:** A type-level move plus identifier renames. Nothing changes at runtime: type names, function names, and local variable names are all erased or irrelevant to the values the tick produces. `lib/engine/simulator/types.ts` keeps only the harness's own config/results/health types (`SimConfig`, `SimResults`, …) — those are PR3's rename, **not this PR's**. The gate is a byte-identical comparison of `npm run simulate -- --json` before and after.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Next.js 16. No new dependencies.

## Global Constraints

- **No `as` type assertions** — only `as const` and inside `lib/types/guards.ts`.
- **No `unknown`** anywhere.
- **No behaviour change.** Not a single number the simulation produces may differ. This is the PR's gate and it is absolute — see Task 0 and Task 7.
- **Comments describe the code, not the plan** — no comment may reference this PR, the build plan, or the migration.
- **Never use `cd` in compound commands** — the working directory is already the project root.
- Spec: `docs/build-plans/tick-harness-rename.md`.

---

## The rename table

| Now | Becomes | Where it lives after |
|---|---|---|
| `SimSystem` | `TickSystem` | `lib/tick/rows.ts` (new) |
| `SimConnection` | `TickConnection` | `lib/tick/rows.ts` (new) |
| `SimMarketEntry` | `TickMarket` | `lib/tick/rows.ts` (new) |
| `SimEvent` | `TickEvent` | `lib/tick/rows.ts` (new) |
| `toSimSystems` / `toSimMarkets` / `toSimConnections` | `toTickSystems` / `toTickMarkets` / `toTickConnections` | `lib/world/tick.ts` (unmoved) |
| `TickEventRaw` | `TickBroadcastRaw` | `lib/tick/types.ts` (unmoved) |

**Verified free before starting:** none of `TickSystem`, `TickConnection`, `TickMarket`, `TickEvent`, `TickBroadcastRaw`, `toTickSystems`, `toTickMarkets`, `toTickConnections` exists anywhere in the repo today (grep, 2026-07-16 — only the spec's own prose mentions them). No collision risk.

**Why a new file rather than `lib/tick/types.ts`:** `types.ts` is the tick's *plumbing* (`TickContext`, `TickProcessorResult`, `EconomySignals`, broadcast payloads); the rows are the tick's *data*. Splitting them keeps both focused and makes `TickMarket`'s eventual deletion in the perf project a single-file change.

**Why not `lib/world/types.ts`:** that file is the persisted, JSON-serializable `World` contract. These rows are **mutable non-persisted per-tick scratch** — `mergeSystemsIntoWorld` and `flattenBuildings` write them back into `World`. Putting them next to `World` would invite the assumption that they save. Their doc comments must say what they are.

---

## Explicitly out of scope (do not touch)

Naming this list is the point — the spec splits this work across four PRs and PR2 must not drift into PR3.

| Symbol | Why it stays |
|---|---|
| `SimConfig`, `SimResults`, `runSimulation` | PR3 renames these to `HarnessConfig` / `HarnessResults` / `runTickHarness` together with the directory move. |
| `lib/engine/tick.ts:115` "DB vs SimWorld" comment | PR3's doc sweep. `engine/tick.ts` uses `MarketTickEntry`, not a row type — PR2 does not open the file, so fixing it here would be unrelated churn. |
| `EconomySimParams` / `simParams` (`lib/engine/tick.ts:37`, `lib/world/tick.ts:572`) | The **verb** usage the spec deliberately keeps ("Simulate one economy tick"). Not the Sim-as-a-noun this project retires. |
| `` `sim-${world.nextId}` `` event-id prefix (`lib/services/dev-tools.ts:79`) | A **runtime data value**, not a type name. Changing it would change output and break the gate. |
| `docs/active/gameplay/economy-equilibrium-rework.md:136` (`SimResults.marketHealth`) | Names `SimResults`, which PR2 does not rename. PR3's doc sweep. |
| `npm run simulate` | The verb is honest and stays (spec: "Kill the noun, keep the verb"). |

**Deliberate deviation from the spec, and why:** the spec assigns `lib/tick/adapters/memory/events.ts:27`'s "SimWorld" doc rot to PR3. **Fix it in PR2 instead** (Task 3). PR2 rewrites that file's type declarations directly beneath that comment, and PR1's review established the lesson that half-fixing a file's rot makes it re-surface. PR3's remaining sweep is unaffected.

---

## File Structure

| File | Action | Responsibility after |
|---|---|---|
| `lib/tick/rows.ts` | **Create** | The tick's four mutable per-tick working row types |
| `lib/engine/simulator/types.ts` | Modify | Harness config/results/health types only — the rows are gone |
| `lib/tick/types.ts` | Modify | Same, with `TickEventRaw` → `TickBroadcastRaw` |
| `lib/world/tick.ts` | Modify | Same joins, renamed `toTick*`, importing rows from `@/lib/tick/rows` |
| `lib/tick/adapters/memory/{economy,events,population,migration,infrastructure}.ts` | Modify | Import renamed rows; `events.ts` header rot fixed |
| `lib/engine/simulator/{runner,market-analysis,event-analysis,build-analysis,population-analysis}.ts` | Modify | Import renamed rows from their new home |
| `scripts/simulate.ts` | Modify | `toTickSystems`; local `finalSimSystems` → `finalTickSystems` |
| 11 test files | Modify | Import renamed rows |
| `docs/active/engineering/processor-architecture.md` | Modify | The join names on line 53 (rot **this PR creates**) |

---

### Task 0: Capture the byte-identical baseline

**Done — do not redo.** Captured on `refactor/tick-rows` at `26150fe` (clean `main`) before any code was touched:

```bash
npm run simulate -- --json 2>/dev/null \
  | grep -v '"elapsedMs"' \
  | sed -E 's/[0-9]+ms/Xms/g' \
  > "<SCRATCH>/baseline.norm"
```

Verified real: **1,221,348 lines**, **174,969** `systemId`, **1** `finalWorld` — identical to PR1's reference figures, which also confirms nothing drifted since PR1 shipped.

Substitute the literal scratchpad path for `<SCRATCH>` in every command; shell state does not persist between Bash tool calls. Both filters are load-bearing (`elapsedMs` is the only wall-clock *field*; the `[events]` spawn log leaks `in <N>ms` on **stdout**, which `2>/dev/null` misses). Full rationale in the spec's Verification section.

---

### Task 1: Create `lib/tick/rows.ts`

**Files:**
- Create: `lib/tick/rows.ts`
- Modify: `lib/engine/simulator/types.ts`

**Interfaces:**
- Produces: `TickSystem`, `TickConnection`, `TickMarket`, `TickEvent` — consumed by every later task.

Move the four interfaces verbatim out of `lib/engine/simulator/types.ts`, renaming only the interface names. **Every field, every field doc comment, and the field order stay exactly as they are** — a field-level edit here would be a real change hiding inside a mechanical diff.

- [ ] **Step 1: Write `lib/tick/rows.ts`**

Header comment must state the three facts a reader needs, and no history:

```ts
/**
 * The tick's working row types — mutable per-tick copies the processors' shared
 * in-memory adapters (`lib/tick/adapters/memory/*`) read and write.
 *
 * These are **not** persisted. `runWorldTick` (`lib/world/tick.ts`) builds them
 * from `World` via the `toTick*` joins — inlining catalog/derived data `World`
 * omits — then merges the mutated rows back into the next `World`. They live
 * apart from `World` (`lib/world/types.ts`), which is the persisted,
 * JSON-serializable contract, because a row here saves nothing by itself.
 */
```

Then the four interfaces, carrying `EventTypeId`, `EconomyType`, `GovernmentType`, `ResourceVector`, and `SystemControl` imports across as needed. `TickEvent` needs `EventTypeId`; `TickSystem` needs the other four. `TickConnection` and `TickMarket` need none.

- [ ] **Step 2: Strip the rows out of `lib/engine/simulator/types.ts`**

Delete the four interfaces and the `// ── Adapter row shapes ──` divider. Then **fix the file header**, which currently advertises the rows as this file's contents — leaving it would be exactly the doc rot this project exists to kill. The surviving file is the harness's own types, so:

```ts
/**
 * Calibration-harness types — the config it takes, the results it returns, and
 * the market/event/region health shapes its analyzers compute.
 *
 * The tick's own row types live in `lib/tick/rows.ts`; the one world model is
 * `World` (`lib/world/types.ts`) and the one tick pipeline is `runWorldTick`
 * (`lib/world/tick.ts`).
 */
```

Drop any import the surviving types no longer use (`ResourceVector`, `SystemControl`, and `EventTypeId` may go; `World` and `GovernmentType` are still needed by `SimResults` / `RegionOverviewEntry`). `tsc` will name any that are wrong.

- [ ] **Step 3: Typecheck — expect failures, and read them**

```bash
npx tsc --noEmit
```

Expected: **errors, all of the form "has no exported member 'SimSystem'"** in the ~25 consumer files. That is the map for Tasks 2-5. An error of any *other* shape (a type mismatch, an unused import) means the move was not verbatim — stop and fix it here.

No commit yet — the tree does not typecheck until Task 5.

---

### Task 2: Rename the joins in `lib/world/tick.ts`

**Files:**
- Modify: `lib/world/tick.ts`

**Interfaces:**
- Consumes: Task 1's `lib/tick/rows.ts`.
- Produces: `toTickSystems` / `toTickMarkets` / `toTickConnections`, consumed by `runner.ts`, `scripts/simulate.ts`, and two test files.

- [ ] **Step 1: Repoint the row import**

Replace the `@/lib/engine/simulator/types` import block with `TickConnection`, `TickMarket`, `TickSystem` from `@/lib/tick/rows`.

- [ ] **Step 2: Rename the three exported joins and every call site**

`toSimConnections` → `toTickConnections`, `toSimSystems` → `toTickSystems`, `toSimMarkets` → `toTickMarkets`. Call sites inside this file are at `:508-510` and the comment at `:868`.

- [ ] **Step 3: Rename `TickEventRaw` → `TickBroadcastRaw` at its three sites here**

The import at `:75`, the `runWorldTick` return type at `:500`, and the local at `:860`. (The declaration itself is Task 4.)

- [ ] **Step 4: Rename the type-derived locals**

The noun survives in local names that mirror the types, and these lines are already being touched:

| Now | Becomes | Site |
|---|---|---|
| `simSystems` | `tickSystems` | `:212`, `:213`, `:231`, `:233` |
| `simMarkets` | `tickMarkets` | `:243`, `:244` |
| `sim` | `tickSystem` / `tickMarket` | `:215-225`, `:246-248` |
| `simById` | `tickSystemById` | `:691`, `:709` |

Leave `simParams` (`:572`) alone — see Out of scope.

- [ ] **Step 5: Fix the section header and doc comments (`:115-134`)**

`// ── World → Sim row joins …` becomes `// ── World → tick row joins …`. The `toTickConnections` doc says the harness reuses these joins to build "the Sim-shaped views its health analyzers read" — say "tick-row views". The `toTickSystems` doc says "one SimSystem row per system" — say `TickSystem`. The `:378` and `:394` comments naming `: SimSystem` return annotations must name `: TickSystem`, or they document a signature that no longer exists.

- [ ] **Step 6: Typecheck this file's own errors are gone**

```bash
npx tsc --noEmit 2>&1 | grep "lib/world/tick.ts"
```

Expected: no output. Errors elsewhere are expected until Task 5.

---

### Task 3: Repoint the in-memory adapters

**Files:**
- Modify: `lib/tick/adapters/memory/{economy,events,population,migration,infrastructure}.ts`

**Interfaces:**
- Consumes: `lib/tick/rows.ts`.

These five files are the reason this PR exists: they are live tick code that today imports its core types from `@/lib/engine/simulator/types`.

- [ ] **Step 1: Repoint and rename in each of the five files**

Import from `@/lib/tick/rows` and rename every use. Mechanical: `economy.ts` (`:13-14`, `:26`, `:30-31`, `:35-36`), `events.ts` (`:16-19`, `:33-46`, `:173`, `:183`), `population.ts` (`:4`, `:13-14`, `:16`), `migration.ts` (`:8`, `:15`, `:19-20`), `infrastructure.ts` (`:8`, `:16`, `:18`).

- [ ] **Step 2: Fix `events.ts`'s header rot (`:22-31`)**

The comment describes a world that does not exist: "the simulator's world", "Modifiers in SimWorld don't carry an eventId", "avoids the sim's previous end-of-tick rebuild-all-modifiers pass", and a comparison to Prisma's cascade semantics (Prisma is deleted). Only the middle fact is real and load-bearing — modifier rows genuinely carry no `eventId`, which is *why* the rebuild-from-active-events approach is needed. Keep that; drop the fiction:

```ts
/**
 * In-memory adapter. Owns mutable slices of the tick's rows for the duration of
 * one `runEventsProcessor` call; the caller reads the final state via the public
 * arrays after the processor returns.
 *
 * Modifier rows carry no eventId, so when an event advances or expires the
 * modifier set is rebuilt from the remaining active events.
 */
```

- [ ] **Step 3: Fix `economy.ts:26`'s comment**

It names "the underlying SimMarketEntry" — say `TickMarket`.

- [ ] **Step 4: Typecheck the adapters are clean**

```bash
npx tsc --noEmit 2>&1 | grep "lib/tick/adapters"
```

Expected: no output.

---

### Task 4: Rename `TickEventRaw` → `TickBroadcastRaw`

**Files:**
- Modify: `lib/tick/types.ts`

**Interfaces:**
- Produces: the freed `TickEvent` name (already taken by Task 1's row type) and `TickBroadcastRaw`.

**Why:** `TickEventRaw` is not an event — it is the payload `TickLoop` wraps into a `TickBroadcast` frame. `SimEvent` *is* an event (a strike, a shortage). The old name held the good name hostage.

- [ ] **Step 1: Rename the declaration (`:71`)**

`export interface TickEventRaw` → `export interface TickBroadcastRaw`. Its doc comment says "The full event payload emitted by one tick's run" — make it name what it is: `/** The full payload one tick's run hands to the broadcast layer. */`

- [ ] **Step 2: Confirm the only other consumer was Task 2's**

```bash
grep -rn "TickEventRaw" --include="*.ts" . | grep -v node_modules
```

Expected: only `lib/world/__tests__/tick.test.ts:85`, a test *name* string (Task 5). Any `.ts` hit outside `lib/world/tick.ts` means Task 2 missed a site.

---

### Task 5: Repoint the harness analyzers, the script, and the tests

**Files:**
- Modify: `lib/engine/simulator/{runner,market-analysis,event-analysis,build-analysis,population-analysis}.ts`
- Modify: `scripts/simulate.ts`
- Modify: 11 test files (see below)

**Interfaces:**
- Consumes: everything above. **After this task `tsc` must be clean** — that is the task's definition of done.

- [ ] **Step 1: The five harness analyzers**

Import rows from `@/lib/tick/rows` (they currently use relative `./types`; the rows are no longer local, so the alias is right). `runner.ts` additionally takes `toTickSystems`/`toTickMarkets` from `@/lib/world/tick`, and its local `simSystemsAtStart` (`:49`, `:51`) becomes `tickSystemsAtStart`. `market-analysis.ts:12`'s mixed import must **split**: `MarketSnapshot`/`MarketHealthSummary` stay on `./types`, `TickMarket` moves to `@/lib/tick/rows`. Same shape in `event-analysis.ts` and `runner.ts`.

**Leave `SimConfig` / `SimResults` / `runSimulation` alone.** They are PR3.

- [ ] **Step 2: `scripts/simulate.ts`**

`toSimSystems` → `toTickSystems` (`:32`, `:88`); local `finalSimSystems` → `finalTickSystems` (`:88`, `:172`, `:203`, `:221`); the comment at `:87` names `toSimSystems` — update it.

- [ ] **Step 3: The 11 test files**

Pure import-and-identifier renames:

`lib/world/__tests__/apply-developments.test.ts`, `lib/world/__tests__/tick.test.ts`, `lib/services/__tests__/system-cadence.test.ts` (its `makeSimSystem` helper → `makeTickSystem`), `lib/tick/adapters/memory/__tests__/{economy,infrastructure}.test.ts`, `lib/tick/processors/__tests__/{economy,events,infrastructure-decay,migration,population}.test.ts`, `lib/engine/simulator/__tests__/{build-analysis,market-analysis,population-analysis}.test.ts`.

Two test *names* are prose, not identifiers, and must move with the code or they lie:
- `lib/world/__tests__/tick.test.ts:85` — "returns a TickEventRaw whose currentTick…" → `TickBroadcastRaw`
- `lib/world/__tests__/tick.test.ts:119` — "toSimSystems seeds buildingIdleMonths…" → `toTickSystems`

Its local `sim` (`:126-129`) → `tickSystem`. `apply-developments.test.ts:9`'s "Minimal valid SimSystem fixture" comment → `TickSystem`.

- [ ] **Step 4: `tsc` must be clean**

```bash
npx tsc --noEmit
```

Expected: **clean**. This is the proof every consumer moved.

- [ ] **Step 5: No `Sim`-row identifier may survive**

```bash
grep -rn "SimSystem\|SimConnection\|SimMarketEntry\|SimEvent\|toSimSystems\|toSimMarkets\|toSimConnections\|TickEventRaw\|simSystems\|simMarkets\|finalSimSystems\|makeSimSystem" --include="*.ts" . | grep -v node_modules
```

Expected: **no output**. `tsc` cannot catch a stale name in a comment or a test title; this grep can. (`SimConfig`/`SimResults`/`EconomySimParams`/`simParams` are deliberately absent from this pattern — they are PR3's or permanent.)

- [ ] **Step 6: Full suite**

```bash
npx vitest run
```

Expected: all pass, **same count as `main`** (1649). Unlike PR1, nothing is deleted here — a changed count means something was lost.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(tick): move the tick's row types to lib/tick/rows.ts as Tick*

SimSystem, SimConnection, SimMarketEntry and SimEvent are the tick's core
working types — every in-memory adapter uses them and runWorldTick is built
on them — but they were defined in lib/engine/simulator/, so live tick code
imported its own types from a directory named simulator. The directory name
asserted a game/harness split the code does not have.

They move to lib/tick/rows.ts as TickSystem, TickConnection, TickMarket and
TickEvent, kept apart from World (lib/world/types.ts) because they are mutable
per-tick scratch, not the persisted contract. The joins that build them rename
toSim* -> toTick*.

TickEventRaw becomes TickBroadcastRaw: it is the payload TickLoop wraps into a
TickBroadcast frame, not an event, and it was holding the TickEvent name.

No behaviour change — type, function and local names only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Fix the doc rot this PR creates

**Files:**
- Modify: `docs/active/engineering/processor-architecture.md:53`

**Why this is PR2's job and not PR3's:** PR1's review found an active doc documenting a symbol that PR1 had just deleted — rot the PR *created*, true on `main` and false on merge, invisible to any diff-scoped reviewer because the file was not in the diff. The instrument is a repo-wide grep of the changed symbols, not a reviewer. `processor-architecture.md:53` names `toSimSystems`/`toSimMarkets`/`toSimConnections`, which this PR renames.

- [ ] **Step 1: Grep every renamed symbol across all prose, not just `.ts`**

```bash
grep -rn "SimSystem\|SimConnection\|SimMarketEntry\|SimEvent\|toSimSystems\|toSimMarkets\|toSimConnections\|TickEventRaw" --include="*.md" . | grep -v node_modules
```

Expected hits, and the ruling on each:
- `docs/active/engineering/processor-architecture.md:53` — **fix now.** Names the joins.
- `docs/build-plans/tick-harness-rename.md` — **leave.** The spec's own rename table; it *describes* this work. Deleted in PR4.
- `docs/build-plans/tick-harness-pr1-plan.md` — **leave.** A shipped PR's record. Deleted in PR4.
- `docs/active/gameplay/economy-equilibrium-rework.md:136` — **leave.** Names `SimResults`, which PR2 does not rename (PR3 does).

Anything else in `docs/active/`, `docs/planned/`, `docs/SPEC.md`, or `CLAUDE.md` — fix it here.

- [ ] **Step 2: Fix line 53**

Replace `toSimSystems`/`toSimMarkets`/`toSimConnections` with `toTickSystems`/`toTickMarkets`/`toTickConnections`. **Leave the `simulator/runner.ts` path references in this file alone** — PR3 moves the directory and owns that sweep.

- [ ] **Step 3: Commit**

```bash
git add docs/active/engineering/processor-architecture.md
git commit -m "docs: name the tick row joins by their current names

processor-architecture.md documented the World -> view joins as toSim*.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Prove no behaviour changed

**Interfaces:**
- Consumes: `baseline.norm` from Task 0.

- [ ] **Step 1: Re-run the harness and compare**

```bash
npm run simulate -- --json 2>/dev/null \
  | grep -v '"elapsedMs"' \
  | sed -E 's/[0-9]+ms/Xms/g' \
  > "<SCRATCH>/after.norm"
diff "<SCRATCH>/baseline.norm" "<SCRATCH>/after.norm" && echo "IDENTICAL"
```

Expected: `IDENTICAL`, no diff output.

**Any diff at all is a failure.** This PR renames types, functions, and locals — all erased at runtime. There is no mechanism by which a number should move. Do not rationalise a small diff and do not re-baseline: a diff means a rename silently changed a *value*, and finding out which is worth more than this PR. The likeliest culprit would be a "rename" that touched a field name inside a row interface (which would change `JSON.stringify` output) — check `git diff lib/tick/rows.ts` against the original interfaces first.

- [ ] **Step 2: Full gate**

```bash
npx tsc --noEmit
npx vitest run
npx next build --webpack
```

Expected: all clean. `next build --webpack` is the PR gate per CLAUDE.md.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin refactor/tick-rows
gh pr create --base main --title "refactor(tick): move the tick's row types to lib/tick/rows.ts as Tick*" --body "..."
```

Body should state: second of four PRs; the rename table; the byte-identical gate result; and that `SimConfig`/`SimResults`/the directory move are PR3.

---

## Doc lifecycle

This plan and `tick-harness-rename.md` are transient build plans, deleted together in **PR4** per the build-plans convention. The spec is still needed by PR3-4.

## Notes for the implementer

- **Task order is load-bearing.** Task 1 breaks `tsc` on purpose and Tasks 2-5 repair it; the tree does not typecheck in between. Do not commit mid-repair.
- **The move must be verbatim.** Rename interface *names* only. A field rename inside a row type would change `JSON.stringify` output and blow the gate — and would be a real change smuggled into a mechanical diff.
- **Do not touch `SimConfig`, `SimResults`, or `runSimulation`.** They are PR3, together with the directory move.
- **`tsc` is not the whole gate.** It cannot see a stale name in a comment or a test title, and it cannot see doc rot in `.md`. Task 5 Step 5 and Task 6 Step 1 are the greps that can.
- **If the Task 7 diff is non-empty, stop.** Do not adjust the baseline to match.
