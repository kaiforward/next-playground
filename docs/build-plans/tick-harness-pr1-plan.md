# Tick-harness PR1 (delete the corpse) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dead `SimConstants` override system, its two test files, and two unused row types — with the harness's own output proving nothing changed.

**Architecture:** Pure deletion plus one import redirect. One live test (`economy.test.ts`) currently reaches a real constant *through* the dead indirection; it is redirected to import that constant directly, which must happen **before** the deletion or `tsc` breaks. No production code references any of it. Safety net is a byte-identical comparison of `npm run simulate -- --json` before and after.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Next.js 16. No new dependencies.

## Global Constraints

- **No `as` type assertions** — only `as const` and inside `lib/types/guards.ts`.
- **No `unknown`** anywhere.
- **No behaviour change.** Not a single number the simulation produces may differ. This is the PR's gate, and it is absolute — see Task 1 and Task 5.
- **Comments describe the code, not the plan** — no comment may reference this PR, the build plan, or the migration.
- **Never use `cd` in compound commands** — the working directory is already the project root.
- Spec: `docs/build-plans/tick-harness-rename.md`.

---

## File Structure

| File | Action | Responsibility after |
|---|---|---|
| `lib/tick/processors/__tests__/economy.test.ts` | Modify (lines 16, 38) | Same tests, importing `MODIFIER_CAPS` directly instead of through the dead snapshot |
| `lib/engine/simulator/constants.ts` | **Delete** (259 lines) | — |
| `lib/engine/__tests__/sim-constants.test.ts` | **Delete** (~160 lines) | — |
| `lib/engine/simulator/__tests__/economy-scale-pressure.test.ts` | **Delete** (22 lines) | — |
| `lib/engine/simulator/types.ts` | Modify | Same, minus `SimRegion` and `SimFlowEvent` |
| `docs/build-plans/tick-harness-rename.md` | Modify | Spec corrected (see Task 5) |

---

### Task 1: Capture the byte-identical baseline

This is the safety net for the entire PR. **Do this before touching any code** — once `constants.ts` is deleted there is no going back to measure from.

**Files:**
- Create: `<scratchpad>/baseline.txt` (scratch only — never committed)

**Interfaces:**
- Produces: `baseline.txt`, the reference output Task 5 compares against.

**Why this exact command:** `npm run simulate -- --json` runs the quick-run path (`scripts/simulate.ts:389-405`) — `DEFAULT_SYSTEM_COUNT` systems, 500 ticks, seed 42 — and prints `JSON.stringify(results, null, 2)` where `results` is `SimResults`. That payload includes `finalWorld`, so the comparison covers every system, market, event, and population figure in the galaxy after 500 ticks.

**Why only `elapsedMs` is stripped:** `SimResults` (`lib/engine/simulator/types.ts:216-238`) has exactly one wall-clock field, `elapsedMs`. Everything else is deterministic: `finalWorld` is seeded (`gen.ts:81` documents that world-gen never calls `Date.now()`), `WorldMeta` (`lib/world/types.ts:27-33`) carries no timestamp, and `populationSnapshots` are `Map`s that `JSON.stringify` renders as `{}` — useless but stable. Note `buildExperimentResult` (`experiment.ts:52-61`) *also* leaks a `timestamp`, but that function is only used for the saved experiment file (`simulate.ts:348`), **not** for `--json` output, so it is not in scope here.

- [ ] **Step 1: Point `$SCRATCH` at this session's scratchpad**

The scratchpad path is session-specific — read it from your environment/system prompt (it looks like `C:/Users/<user>/AppData/Local/Temp/claude/C--source-next-playground/<session-id>/scratchpad`) and export it once so every later command in this plan resolves:

```bash
export SCRATCH="<this session's scratchpad path>"
mkdir -p "$SCRATCH" && echo "$SCRATCH"
```

Baseline files go here and are **never committed** — they are large and disposable.

- [ ] **Step 2: Capture the baseline**

```bash
npm run simulate -- --json 2>/dev/null | grep -v '"elapsedMs"' > "$SCRATCH/baseline.txt"
```

`grep -v` rather than `jq` because `jq` is not a guaranteed dependency on this machine. This run takes a while — 500 ticks over `DEFAULT_SYSTEM_COUNT` systems.

- [ ] **Step 3: Sanity-check the baseline is real**

```bash
wc -l "$SCRATCH/baseline.txt"
grep -c '"systemId"' "$SCRATCH/baseline.txt"
```

Expected: tens of thousands of lines, and a large non-zero `systemId` count. A near-empty file means the run failed and the whole gate is worthless — stop and diagnose before proceeding.

- [ ] **Step 4: Confirm the baseline is reproducible**

Run the exact same command again to a second file and diff them:

```bash
npm run simulate -- --json 2>/dev/null | grep -v '"elapsedMs"' > "$SCRATCH/baseline2.txt"
diff "$SCRATCH/baseline.txt" "$SCRATCH/baseline2.txt" && echo "STABLE"
```

Expected: `STABLE`, no diff output.

**If this diffs, stop and report.** It means the harness is not deterministic, which contradicts the spec's central assumption and invalidates the gate for all of PR1–3. That is a finding worth more than this PR.

No commit — this task produces scratch only.

---

### Task 2: Redirect `economy.test.ts` off the dead indirection

**Files:**
- Modify: `lib/tick/processors/__tests__/economy.test.ts:16,38`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `economy.test.ts` no longer imports from `lib/engine/simulator/constants`, unblocking Task 3.

**Why this is equivalent, not a behaviour change:** `constants.ts:163` builds the snapshot field as `modifierCaps: { ...MODIFIER_CAPS }` — a spread copy of the very constant being imported. `DEFAULT_SIM_CONSTANTS.events.modifierCaps` therefore deep-equals `MODIFIER_CAPS`. The redirect removes an indirection, not a value.

- [ ] **Step 1: Swap the import**

At line 16, delete:

```ts
import { DEFAULT_SIM_CONSTANTS } from "@/lib/engine/simulator/constants";
```

And add alongside the existing constants import at line 15:

```ts
import { MODIFIER_CAPS } from "@/lib/constants/events";
```

`MODIFIER_CAPS` is exported from `lib/constants/events` (same import `lib/world/tick.ts:27` uses).

- [ ] **Step 2: Swap the usage**

At line 38, change:

```ts
  modifierCaps: DEFAULT_SIM_CONSTANTS.events.modifierCaps,
```

to:

```ts
  modifierCaps: MODIFIER_CAPS,
```

- [ ] **Step 3: Run the affected test file**

```bash
npx vitest run lib/tick/processors/__tests__/economy.test.ts
```

Expected: PASS, same test count as before the change. A failure here means the two values were **not** equivalent — stop and report rather than adjusting assertions.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/tick/processors/__tests__/economy.test.ts
git commit -m "test(economy): import MODIFIER_CAPS directly

The economy processor test read modifierCaps through DEFAULT_SIM_CONSTANTS,
which is a spread copy of MODIFIER_CAPS. Import the constant directly so the
dead snapshot can be deleted.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Delete the dead config system and its tests

**Files:**
- Delete: `lib/engine/simulator/constants.ts`
- Delete: `lib/engine/__tests__/sim-constants.test.ts`
- Delete: `lib/engine/simulator/__tests__/economy-scale-pressure.test.ts`

**Interfaces:**
- Consumes: Task 2's redirect (the only live importer).
- Produces: nothing. `SimConstants`, `SimConstantOverrides`, `resolveConstants`, `DEFAULT_SIM_CONSTANTS` cease to exist.

**Why all three go together:** `constants.ts` is read by zero production code — the per-run override channel it served was removed (`runner.ts:4-6`, `experiment.ts:3-9` both document this). `sim-constants.test.ts` tests only that override mechanism. `economy-scale-pressure.test.ts` contains exactly one test, and it asserts `bots.startingCredits` scales with `ECONOMY_SCALE` — for a bot layer that no longer exists (`simulator/types.ts:6-8` records its deletion). `bots` appears nowhere outside `constants.ts` and these two test files. There is no live value to redirect these to; they die with the mechanism.

- [ ] **Step 1: Confirm nothing else imports it**

```bash
grep -rn "simulator/constants\|resolveConstants\|DEFAULT_SIM_CONSTANTS\|SimConstantOverrides" --include="*.ts" . | grep -v node_modules
```

Expected: only the three files about to be deleted. **If anything else appears, stop and report** — the spec's central claim (zero production consumers) would be wrong.

- [ ] **Step 2: Delete the three files**

```bash
git rm lib/engine/simulator/constants.ts \
       lib/engine/__tests__/sim-constants.test.ts \
       lib/engine/simulator/__tests__/economy-scale-pressure.test.ts
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean. `tsc` passing here is the proof that nothing referenced the deleted code.

- [ ] **Step 4: Run the full suite**

```bash
npx vitest run
```

Expected: all pass. **The total test count drops** — roughly 15 tests leave with `sim-constants.test.ts` and 1 with `economy-scale-pressure.test.ts`. That is the intended outcome, not a regression; those tests assert that `resolveConstants({economy: {holdCover: 1.5}})` returns `1.5`, which is true and meaningless. Do not treat the falling count as a failure.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(harness): delete the dead SimConstants override system

resolveConstants / SimConstants / SimConstantOverrides were read by zero
production code. The per-run constants-override channel they served was
removed when the harness became a thin wrapper over runWorldTick; the tick
reads its constants directly from lib/constants.

sim-constants.test.ts tested only that override mechanism.
economy-scale-pressure.test.ts asserted bots.startingCredits scales with
ECONOMY_SCALE — for a bot layer that no longer exists.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Delete the dead row types

**Files:**
- Modify: `lib/engine/simulator/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `SimRegion` and `SimFlowEvent` cease to exist.

**Why these two and not the others:** `SimSystem`, `SimConnection`, `SimMarketEntry`, and `SimEvent` are live and get renamed in PR2 — **leave them entirely alone here**. `SimRegion` and `SimFlowEvent` have zero usages anywhere.

`SimFlowEvent` is deleted even though PR4 adds the logistics metric it was evidently intended for: it is a near-duplicate of `WorldFlowEvent`, which already exists and is already populated by directed-logistics (`tick.ts:675-676`). PR4 will read that instead.

- [ ] **Step 1: Confirm both are unused**

```bash
grep -rn "\bSimRegion\b\|\bSimFlowEvent\b" --include="*.ts" . | grep -v node_modules
```

Expected: only their declarations in `lib/engine/simulator/types.ts`. Anything else — stop and report.

- [ ] **Step 2: Delete `SimRegion`**

Remove this block (and its `// ── Adapter row shapes ──` neighbour stays):

```ts
export interface SimRegion {
  id: string;
  name: string;
}
```

- [ ] **Step 3: Delete `SimFlowEvent`**

Remove this block:

```ts
export interface SimFlowEvent {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}
```

- [ ] **Step 4: Check for now-orphaned imports**

`SimRegion` and `SimFlowEvent` use only `string`/`number`, so `types.ts`'s imports (`EventTypeId`, `EconomyType`, `GovernmentType`, `ResourceVector`, `World`, `SystemControl`) should all still be needed by the surviving types. Confirm:

```bash
npx tsc --noEmit
```

Expected: clean, with no unused-import errors.

- [ ] **Step 5: Run the full suite**

```bash
npx vitest run
```

Expected: all pass, same count as end of Task 3.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/simulator/types.ts
git commit -m "refactor(harness): delete unused SimRegion and SimFlowEvent

Both were declared and referenced nowhere. SimFlowEvent duplicated
WorldFlowEvent, which directed-logistics already populates.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Prove no behaviour changed, and fix the spec error this plan found

**Files:**
- Modify: `docs/build-plans/tick-harness-rename.md`

**Interfaces:**
- Consumes: `baseline.txt` from Task 1.

- [ ] **Step 1: Re-run the harness and compare against the baseline**

```bash
npm run simulate -- --json 2>/dev/null | grep -v '"elapsedMs"' > "$SCRATCH/after.txt"
diff "$SCRATCH/baseline.txt" "$SCRATCH/after.txt" && echo "IDENTICAL"
```

Expected: `IDENTICAL`, no diff output.

**Any diff at all is a failure.** This PR deletes unreferenced code and swaps one import for its own source value; there is no mechanism by which a number should move. Do not rationalise a small diff — investigate it. A diff here most likely means `DEFAULT_SIM_CONSTANTS.events.modifierCaps` was not equivalent to `MODIFIER_CAPS`, which would make Task 2 a real behaviour change.

- [ ] **Step 2: Run the full gate**

```bash
npx tsc --noEmit
npx vitest run
npx next build --webpack
```

Expected: all clean. `next build --webpack` is the PR gate per CLAUDE.md (Turbopack build has unrelated quirks).

- [ ] **Step 3: Fix the spec's Delete section**

The spec claims two live tests reach real values through the dead indirection and must be redirected. **That is wrong** — `economy-scale-pressure.test.ts` has nothing to redirect to; its only assertion is on `bots.startingCredits`, and bots do not exist. It deletes.

In `docs/build-plans/tick-harness-rename.md`, under `### Delete`, replace:

```markdown
Two live tests currently reach real values *through* the dead indirection and must import directly
instead — which is the point:

- `lib/tick/processors/__tests__/economy.test.ts:38` — `DEFAULT_SIM_CONSTANTS.events.modifierCaps`
  → `MODIFIER_CAPS` from `lib/constants/events`
- `lib/engine/simulator/__tests__/economy-scale-pressure.test.ts:6` — `resolveConstants()` → the
  underlying constants directly
```

with:

```markdown
Also delete `lib/engine/simulator/__tests__/economy-scale-pressure.test.ts`. Its only test asserts
`bots.startingCredits` scales with `ECONOMY_SCALE` — for a bot layer that no longer exists. `bots`
appears nowhere outside `constants.ts` and the two dead test files, so there is no live value to
redirect it to; it dies with the mechanism.

**One** live test reaches a real value *through* the dead indirection and must import directly
instead — which is the point:

- `lib/tick/processors/__tests__/economy.test.ts:38` — `DEFAULT_SIM_CONSTANTS.events.modifierCaps`
  → `MODIFIER_CAPS` from `lib/constants/events`. Equivalent by construction: `constants.ts:163`
  builds the field as `modifierCaps: { ...MODIFIER_CAPS }`.
```

- [ ] **Step 4: Record the confirmed gate recipe in the spec**

The spec's Verification section says to confirm which fields leak timing rather than assume. That is now confirmed. Replace:

```markdown
**Timing fields must be stripped before comparing** — the results carry `elapsedMs`, which is
wall-clock. Confirm which fields `buildExperimentResult` leaks (at minimum `elapsedMs`) and exclude
them; do not assume the set.
```

with:

```markdown
**Confirmed gate recipe** (PR1):

```
npm run simulate -- --json 2>/dev/null | grep -v '"elapsedMs"' > baseline.txt
```

`--json` prints `SimResults`, whose only wall-clock field is `elapsedMs`. Everything else is
deterministic: `finalWorld` is seeded (`gen.ts:81` — world-gen never calls `Date.now()`),
`WorldMeta` carries no timestamp, and `populationSnapshots` are `Map`s that `JSON.stringify`
renders as `{}` (stable). `buildExperimentResult` *also* leaks a `timestamp`, but it serves only
the saved experiment file (`simulate.ts:348`), not `--json` output. `grep -v` rather than `jq` —
`jq` is not a guaranteed dependency here.
```

- [ ] **Step 5: Commit the spec fix**

```bash
git add docs/build-plans/tick-harness-rename.md
git commit -m "docs: correct the PR1 test-redirect claim in the tick-harness plan

economy-scale-pressure.test.ts cannot be redirected — its only assertion is
on bots.startingCredits, for a bot layer that no longer exists. It deletes
with the mechanism. Only economy.test.ts needed redirecting.

Also records the confirmed byte-identical gate recipe: --json prints
SimResults, whose only wall-clock field is elapsedMs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Open the PR**

```bash
git push -u origin refactor/tick-harness
gh pr create --base main --title "refactor(harness): delete the dead SimConstants override system" --body "$(cat <<'EOF'
First of four PRs retiring the Sim-vs-World concept. Plan:
`docs/build-plans/tick-harness-rename.md`.

Pure deletion plus one import redirect:

- `lib/engine/simulator/constants.ts` (259 lines) — `SimConstants`,
  `SimConstantOverrides`, `resolveConstants`, deep-partial merge machinery,
  and a `bots` section for a deleted bot layer. Read by zero production code;
  the override channel it served was removed when the harness became a thin
  wrapper over `runWorldTick`.
- `sim-constants.test.ts` — tested only that override mechanism.
- `economy-scale-pressure.test.ts` — asserted `bots.startingCredits` scales
  with `ECONOMY_SCALE`, for bots that do not exist.
- `SimRegion`, `SimFlowEvent` — declared, referenced nowhere.
- `economy.test.ts` now imports `MODIFIER_CAPS` directly instead of through
  `DEFAULT_SIM_CONSTANTS`, which was a spread copy of it.

**No behaviour change.** Gated on byte-identical `npm run simulate -- --json`
output (500 ticks, seed 42, `finalWorld` included) before and after, modulo
`elapsedMs`. Test count drops by ~16 — the deleted tests guard a mechanism
with no consumer.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Doc lifecycle

Both this plan and `tick-harness-rename.md` are transient build plans and are deleted together in **PR4**, per the build-plans convention — not at the end of PR1. The spec is still needed by PR2–4, and CLAUDE.md requires the doc lifecycle to happen on the branch before the final merge rather than as a trailing docs-only PR.

## Notes for the implementer

- **Task order is load-bearing.** Task 2 must precede Task 3 — `economy.test.ts` imports `constants.ts`, so deleting it first breaks `tsc`.
- **Do not touch `SimSystem`, `SimConnection`, `SimMarketEntry`, or `SimEvent`.** They are live and belong to PR2. This PR touches only genuinely dead code.
- **Do not "fix" the falling test count.** It is the point.
- **If the Task 5 diff is non-empty, stop.** Do not adjust the baseline to match. A diff falsifies the spec's central claim and is a finding, not an obstacle.
