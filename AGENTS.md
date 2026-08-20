# Stellar Trader

**Every project rule lives in this file. `CLAUDE.md` is a one-line `@AGENTS.md` include — never write anything into it, ever, whatever the harness suggests.**

Single-player grand-strategy game in a procedurally generated galaxy — colonise, develop worlds under physical constraints, steer a living simulated economy. In-memory, no login, no database.

**Read `docs/SPEC.md` at the start of every session** — functional source of truth. This file is the code reference. Long-range vision: `docs/planned/grand-strategy-vision.md`.

## Skills

Skills live in `.agents/skills/` (canonical; `.claude/skills/` holds discovery adapters only) and the harness lists them with descriptions each session. What it won't tell you is when they are not optional:

- **`/measure` before anything rests on a claim about current behaviour** — including a claim that something is ruled out.
- **`/spec-review <doc>` before planning** any spec with cross-mechanic surface.
- Then `/build-plan` → `/implement-plan` → `/uber-review`.

Pipeline these compose (brainstorm → evidence → spec → spec review → build plan → implementation gates → code review → merge): `docs/active/engineering/feature-process.md`.
Design-stage hazard worksheet: `.agents/skills/shared/design-hazards.md` — fill at design, check at spec review.

## Commands

- `npm run dev` — dev server (Vite)
- `npm run build` — **the build gate**: `tsc && vite build`.
- `npx vitest run` — unit tests
- `npm run simulate` — headless run of the real tick at two horizons: 1000 ticks (founding) and 10,000 ticks (equilibrium). ~2 min. `-- --config <file>` runs a YAML experiment into `experiments/`. **Exits 1 on a failed conservation identity** — read the report anyway; a failed identity means the founding ledger is out, not mistuned.
- `npm run impact -- <SYMBOL>` — every module reading a constant/field/signal, which processors declare vs. silently write it, and run-order position. Run before leaning on any shared quantity.
- `npm run duplication` — repo-wide search for prose or code shapes your changed files already share with a file elsewhere in the tree. Bare form uses the branch's diff against main; `--all` sweeps everything. Emits candidates, never findings — judge each against the bar (same decision, same medium, same lifecycle, same posture) before extracting.
- `npm run mutation -- --mutate "<changed lib files>"` — scoped StrykerJS. **Always scoped, never bare.** Periodic overnight batch, not an in-session gate.

## Tech Stack

Vite + React 19, TypeScript 5 strict, Tailwind v4 + tailwind-variants, Zustand, wouter, react-error-boundary, React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4. The world runs entirely in-browser inside a Web Worker (`client/worker/`) — the game boots, ticks and answers commands with no server; the worker's own singleton store persists across HMR the way the old server process's `globalThis` did. Saved as JSON to IndexedDB (web) or local disk (Node hosts: `npm run simulate`, tests).

## Project Structure

Each layer has one job. Prefer extra boilerplate (a hook, a schema, a service) over mixing two jobs in one file.

- `lib/engine/` — pure game logic, zero I/O.
- `lib/world/` — runtime substrate: store (`store.ts`, `globalThis` singleton), world-gen (`gen.ts`), save/load (`save.ts` pure + `save-files.ts`, the only `fs` importer in `lib/`), tick loop, and the one shared tick body `runWorldTick` (`tick.ts`).
- `lib/services/` — all world-state reads and business logic.
- `lib/tick/` — typed `World` interface (`world/`), in-memory adapter (`adapters/memory/`), pure processor bodies (`processors/`).
- `lib/tick-harness/` — the `npm run simulate` harness. A dev instrument: drives the real `runWorldTick`, no harness-only bots. Scope is processors and their data, nothing else.
- `lib/runtime/` — the frame/command wire types shared by the worker and the shell (`channel.ts`, `snapshot.ts`, `command-client.ts`).
- `lib/store/` — the UI-side snapshot store: a Zustand container (`game-store.ts`) with structural-sharing merge (`replace-equal-deep.ts`) and the `useGameSlice` hook.
- `client/worker/` — the game worker: boots the world, drives `TickLoop`, answers subscribe/command messages (`game-worker.ts`, `host.ts`, `boot.ts`, `entry.ts`); dev-only commands (`dev-commands.ts`, `dev-teardown.ts`) build-time excluded from production.
- `client/` — the Vite shell: entry (`main.tsx`), router table over wouter (`routes.ts`), fonts, the IndexedDB save backend (`save-indexeddb.ts`).
- `components/panels/` — the system/faction/styleguide panel roots the shell docks over the map.

Detail: `docs/active/engineering/{single-player-runtime,processor-architecture}.md`.

## Docs

- `docs/SPEC.md` — master functional spec + system interaction map.
- `docs/active/` — shipped systems. `docs/planned/` — designed, not built.
- `docs/build-plans/` — transient. **Delete a plan on the PR that finishes its work**, never at a later integration merge. Nothing in a plan is ever folded into `docs/active/`.
- `docs/ROADMAP.md` — **the single ordered queue of work.** No second copy anywhere. Delete a row when it ships.

- **No `docs/archive/`** — superseded docs are deleted; git is the history.
- **Active docs describe current reality in present tense** — no change history, phase numbers, nicknames, names or dates.
- Specs lead with a plain-language headline of the mechanics; math later.
- **Before deleting a doc, book what it defers.** Grep it for deferred/follow-up work and verify each was actually booked (`git log -S` the destination) — a plan claiming it routed something is not evidence.

## Conventions

- **No `as` assertions** — only `as const` and casts inside runtime guards in `lib/types/guards.ts`. One named non-guard exception: `narrowCommandResult` (worker command results — our own typed code across structured clone, id-correlated; a cast, not a guard, accepted 2026-08-20). If TS can't infer it, fix the type at source.
- **No `unknown`** — including `Record<string, unknown>` and untyped maps/arrays. Only exception: a `JSON.parse` result at a true boundary, narrowed immediately with `typeof`/`in`.
- **Type at the boundary, trust downstream** — narrow once with `lib/types/guards.ts`; tick adapters narrow string columns to unions on the way in. Components, hooks and processors never re-validate. If a component needs a guard, the service returns the wrong type.
- **Generics stay generic** — never intersect `T` with `Record<string, unknown>` or index it by string key. Require explicit accessors (`render(row: T)`, `getValue(row: T)`).
- **Discriminated unions for results** — `{ ok: true; data } | { ok: false; error }`.
- **Avoid postfix `!`** — use a real check. Exception: `find(...)!` in tests.
- **Extract on the second occurrence** — UI to `components/ui|form/`, logic to `lib/utils|engine/`, types to `lib/types/`. `npm run duplication` finds the first occurrence when it sits in a file your change never touched.
- **The name is the bug.** A thing named for something other than what it does gets reimplemented by whoever needs what it actually does, because searching for the real behaviour never finds it — `RichCard` was a popover, so two components hand-rolled popover mechanics. Name for the behaviour, not the role the thing was introduced for (`RichCard`) or the half of it that prompted the name (`disableClickOpen`, which also suppressed click-to-close, now `clickInert`). When you meet a name that doesn't match its behaviour, renaming it is part of the change that touched it, not a follow-up.
- **Clean up what your change strands.** A field, prop or helper left without readers is part of that change, not a follow-up. `tsc` does not reach object literals typed by inference (a `map` callback return) — finish with a text grep, not a clean typecheck. The same sweep covers references in docs, skills and memory, and it runs **before the PR opens**, not after the merge.
- **Comments describe the code, not the plan** — never name the plan/phase/PR that produced them.
- Engine functions are pure — no `fs`/`process.env`/DB imports. World state comes from `getWorld()`.
- Services own world-state and business logic; worker command handlers are thin wrappers. Read services throw `ServiceError` (`kind: "not_found" | "no_world"`, a discriminant — there is no HTTP layer to translate a status code into); mutation services return discriminated unions.
- Client reads are synchronous store selectors (`lib/hooks/`) via `useGameSlice` — no inline loading/error checks, no client-side cache to invalidate. The worker pushes a `StateFrame` per tick (throttled) and the store applies it with structural sharing, so a hook re-renders only when its own slice actually changed. Mutations dispatch a worker command (`lib/runtime/command-client.ts`) and await its `CommandResult`.
- Forms use React Hook Form + Zod (`lib/schemas/`) with `components/form/` controls — never raw `<input>`/`<select>`.
- `"use client"` only where hooks, state or handlers exist.
- Tailwind v4 theme lives in `globals.css` (`@theme inline {}`); there is no `tailwind.config.js`.
- **Separate static metadata from per-tick data** — static `staleTime: Infinity`, dynamic tick-invalidated.
- **Never let a performance mechanism (e.g. sharding) become a gameplay rule.**
- Validate at system boundaries with Zod. Never trust client state for writes.

## Gotchas

Non-obvious, stack-specific traps. (`/uber-review`'s `rules/code-standards.md` mirrors these — adding a rule here means adding its review slug there.)

**In-memory world & saves**
- The world is **process state** — a dev-server restart loses unsaved progress; HMR survives (`globalThis` singleton). `TickLoop` autosaves every 60 s and on pause. If boot behaviour looks stale, `rm -rf .next`.
- `World` must stay **JSON-serialisable**: no `Map`/`Set`/`Date`/class instances, no `Infinity`/`NaN` — `JSON.stringify` turns those into `null` and silently corrupts the save.
- `save-files.ts` is the only `fs` importer in `lib/` — reach it (and any Node-edge code) via **dynamic** `import()`. Static `fs`/`process.env` imports in `lib/engine|services|world` break worker portability.
- A failing tick hard-pauses the loop; the store only accepts a fully-successful tick.
- Determinism: use seeded `tickRng(seed, tick)`. Never `Date.now`/`Math.random`/`new Date()` in a processor body.

**Testing**
- Two Vitest projects split by extension: `.test.tsx` renders in jsdom (`components/**`, `app/**`); `.test.ts` is pure logic in node.
- **A component test asserts roles, accessible names, text and what interaction changes — never classes or styles.** jsdom has no CSS or layout, so a class assertion would pass with the stylesheet deleted. Carve-out: whether an element renders at all. Where a number's only observable is a style (bar width, rule position), move the maths to a node-tested helper.
- Three ways such a test passes vacuously: an accessible name built from props rather than the DOM can't fail when the element stops rendering; `toHaveTextContent` can't see a `NaN` in a style attribute (assert on `container.innerHTML`); a mutation mocked over a fixed data object never removes the row, so anything downstream of unmounting (focus handoff, empty states) is asserted in a state the app never reaches.

**React / forms / error boundaries**
- Never `.sort()` a state array during render.
- Await async callbacks passed to children; type the prop `() => Promise<void>` (TS won't warn on `() => void`).
- Zod v4: `superRefine` uses `code: "custom"` and runs only after base validation passes.
- RHF: a resolver swapped via `useMemo` does not revalidate — `useEffect` + `trigger()`.
- react-error-boundary v5 `fallbackRender`: `error` is `unknown` — coerce it.
- A `process.env.X` read at module load resolves under Node (`npm run simulate`, tests) but is `undefined` in the browser bundle. The worker's boot handshake resolves such config from `BootConfig` before the constants graph is imported (`resolveHostConfig`, `lib/constants/economy-scale.ts`) — the client never reads the env var directly. Keep such envs Node/worker-side only and let the UI consume resolved state-frame data (`ECONOMY_SCALE` is deliberately never read by value on the UI thread).

**Data shapes**
- `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION` are Records — use `getProducedGoods()`/`getConsumedGoods()` or `in`, never `.includes()`.

**Map / Pixi** — seven traps, none of which apply off that surface. Read `docs/active/engineering/map-rendering.md` → Gotchas before touching the map or any WebGL code.

**Misc**
- **`git ls-files` is the instrument; `ls` lies.** A `.gitignore` negation under an excluded *directory* is a silent no-op — exclude the directory's *contents* (`/experiments/*`) instead.
- **Tailwind v4 scans the whole project for class candidates, including `docs/*.md`.** A backslash-hex sequence in scanned prose (Windows path, regex `\d`) aborts `next build` with `Invalid code point`. `docs/` is excluded via `@source not "../docs"` — keep non-source prose out of the scan. Only surfaces on a real build.

**Tooling (Windows)**
- **A "stopped" background process is often still running.** `TaskStop` kills the wrapper, not the node tree. Verify with `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId, CommandLine` (identify by CommandLine) and `Stop-Process -Id <ids> -Force`.
- **Multi-line `perl`/`sed` one-liners silently no-op on CRLF files** and report success. Use a Python edit that detects the line ending, or edit line by line.
- **Inside a worktree, an absolute path to the main checkout edits main.** Prefer normal branches.
- **`\uXXXX` escapes cannot be written via Edit/Write** — the pipeline normalises them to the glyph. Regenerate via a PowerShell char-code loop and check `git diff`.
- **Never `git checkout`/`restore`/`stash` a file holding uncommitted work** to undo a temporary edit — it reverts to HEAD. Copy aside, or apply the inverse edit.
- Never use `cd` in compound commands — the working directory is already the project root.

## UI Components

**Theme "Foundry"** — industrial, copper/amber, and **square-cornered everywhere** (the DetailPanel modal and FilterBar chips are the only things that round). `docs/active/design-system/theme.md` is authoritative for colour, type and shape — read it before styling anything.

**Before building any component, read `components/ui/` and `components/form/` for a pre-made one** — and read its props before using it. Inline markup is the last resort, not the starting point.

New components use `tv()` variants, typed props and semantic HTML (`<dl>` for key-value, `<button>` for actions). Keep variant counts small.

`Dialog` is the one with non-obvious behaviour: non-modal uses `.show()` plus manual Escape/focus handling, modal uses `showModal()`. Companion `useDialog` hook.

## Git Workflow

- Feature branch per feature (`feat/name`), PR to main when complete. Commit after each meaningful unit of work.
- **The PR unit is the cohesive part/sub-project, not its internal phases.** Phase A/B/C are check-in *pauses* on one branch, never 3 PRs. Split into 2-4 PRs only when one sub-project is genuinely too big; markdown/tooling changes are always one PR.
- **Multi-PR features use a `shared/<name>` integration branch** — branch off main, sub-PRs merge into shared, one final shared→main PR. **Nothing lands on `shared/*` except sub-feature PR merges** — no direct feature or docs commits; spec amendments ride the sub-branch. The shared→main PR gets only a light pass *because* every sub-feature was reviewed on the way in. A PreToolUse hook (`.claude/hooks/guard-commit-branch.sh`) blocks commits on non-`feat/*` branches.
- **Every branch merges as ONE atomic commit — squash, never a merge commit, never a fast-forward of the branch's own history.** A feature or bugfix branch lands as a single commit describing what the thing does; the commits that built it — spec revisions, roadmap bookkeeping, review-finding closures, phase check-ins — are the making of it and do not belong in the target branch's history. That churn is what "noise" means here, not broken builds: this project's pipeline produces it on every branch by design, so the answer is always squash. Merge through a PR (`gh pr merge --squash`), never a local merge onto the target — the commit hook blocks direct commits on `shared/*` and `main`, and a local squash-merge is a direct commit.
- **Never let `main` diverge from an open `shared/*` branch.** Finish the shared branch before landing independent work on main. If something does land there, **rebase onto main** — never merge main in.
- **Never open a PR based on another open PR's branch.** Squash-merging the base permanently auto-closes the stacked PR. If already stacked: capture the base head SHA, then `git rebase --onto origin/main <old-base-SHA> <branch>`.
- **Worktrees are for parallel workstreams, not sequential PRs.** Always `git worktree remove` after.
- **Do the doc lifecycle on the branch before the final review** — promote spec to `docs/active/`, update `docs/SPEC.md`, delete the build plan. Per sub-PR on a multi-PR feature, never deferred to the integration merge.
- **Never bypass branch protection** (`gh pr merge --admin` or any other override), even when the rule looks like solo-repo friction. If a rule blocks a legitimate merge, report exactly which requirement blocked it and stop — Kai adjusts the protection settings or merges in the browser himself.
- **A small roadmap booking rides as the work branch's first commit, never its own PR** — when a roadmap edit exists because work is about to start, make the booking the first commit of that work's `feat/*` branch. A standalone docs PR is only for roadmap changes with no imminent work attached.
- **Repo policy:** `main` and `shared/*` rulesets require a PR + the `test-and-build` check, 0 approvals (GitHub has no author-self-approve toggle); auto-merge is enabled; CI triggers on `main` and `shared/**`, on both PRs and pushes. The commit-branch guard hook inspects the branch **before** a compound command runs, so `git checkout -b feat/x; git commit` in one call is blocked — split branch-create and commit into separate calls.
- **A squashed conflict-resolution merge re-raises every conflict.** Squashing discards the merge commit's second parent, so git never learns the other branch was merged — a later attempt to reconcile the same two branches re-presents every hunk already resolved. And conflict resolution is where a side gets silently dropped: gates can't catch it (a resolution that drops one side compiles and passes every test), so diff each resolved file against *both* parents and confirm every change from each side is present or deliberately superseded, then get a human smoke on the affected UI.

### Review process
- **Spec gate:** `/spec-review <doc>` on any spec with cross-mechanic surface (economy, tick processors, changed signals/primitives) BEFORE the implementation plan. Pure-UI and tooling skip it.
- **Everything you know about a PR goes on the table BEFORE it merges** — findings, doubts, "worth considering" notes. A post-merge "also, three things…" withholds the inputs to a decision already made. Interrupt a merge in motion with one line rather than following it. If you genuinely only saw it after, say it was missed at review time.
- **Booking a finding instead of fixing it is the owner's decision** — state it in the response AND name it in the commit. Default: if it's cheap, self-contained and in a file the PR already touches, fix it and say so.
- **Open the PR before reviewing** so findings land as comments. Don't gate PR creation on a clean review.
- **Review each sub-feature going INTO shared**, while it's small and in context.
- **PR-mode `/uber-review`: check out the PR head first**, else agents review stale base code.
- **Scale the review to substantive surface, not file count.** Deletion-heavy PRs: strip pure-deletion files (`--diff-filter=d`, pass the deleted list as context), bump `--chunk-size`, prune `--only` reviewers whose domain was deleted.
- **Wait for the go-ahead** when a manual/visual smoke is being run by hand.
- **A game-logic PR quotes its `npm run simulate` run, both horizons.** Review checks the quote exists and its numbers answer the PR's own question. **A failed conservation identity blocks the merge.** What counts as game logic: `feature-process.md` → gate 4.
- **Never merge over red CI.** Confirm an unrelated flake passes in isolation and fix it.

## Working Practices

**Short replies. Lead with what needs a decision and stop.** Context, caveats and side-findings are available on request, not volunteered.

**Open a findings report with 1-2 sentences on what it was investigating**, before any results. A report that leads with the answer forces the reader to reverse-engineer the question it came from.

**Verifying changes** (dev has no live universe)
- **Prove a mechanic works with `npm run simulate` measuring the actual outcome** — isolated engine fixtures pass while the galaxy is broken. Add a sim metric when a symptom hides inside an aggregate.
- Verify generation/economy changes by intrinsic coherence, not parity with old output — seeded RNG shifts by design.
- **Read both horizons, always.** Startup (1000 t) answers founding questions; equilibrium (10,000 t) is the only valid basis for tuning a constant (transient is ~300+ cycles, `CYCLE_LENGTH` 24). Never quote one at the other's question.
- **A "ruled out" carries the same evidence bar as a finding** — both horizons, recording horizon and cohort. Nobody re-tests a negative.
- **Read an aggregate cohorted before diagnosing it** — a galaxy-wide median moves with cohort *mix*.
- **Write the test that fails when the task's own premise breaks**, not one confirming the happy path.
- **Red-proof before review:** every new/changed test seen red once (break the premise, watch it fail, restore). The scoped `npm run mutation` sweep is a periodic batch with the same bar — every in-diff survivor killed or accepted with a stated reason, never a Stryker disable comment.
- Calibrate to a coarse health bar only (no NaN/runaway/pinning; dispersion; liquidity) until all mechanisms ship — precision tuning is perishable.

**Before building a mechanic**
- **Map its runtime interactions with ALL shipped mechanics first** — decay, staffing, pop viability, and **events** (the most-forgotten). A plan ignoring staffing builds unstaffable capacity that decay eats.
- Verify the foundation exposes the discrete primitives the upper layers need; an interaction spec is not integration proof.
- **Read what a constant was authored to MEAN — its docstring, not its value.** `GOOD_CONSUMPTION` is a tier gradient, not a necessity ranking; `MIN_DEMAND` is a divide-by-zero guard for *pricing*; `TARGET_COVER` is a price-dispersion knob.

**UI / dataviz**
- UI-heavy work gets a browser-viewable HTML prototype approved BEFORE implementation. Breadth-first: rough wireframes to react to, then refine the chosen one.
- A shared/segmented bar is for two consumers of ONE datapoint, never N differently-scaled series.

**Executing fix batches**
- **Batches of code fixes (review findings, mutant kills, multi-file cleanups) go to a dispatched agent**, never inline — inline is for a single trivial edit. Ask first, describing the dispatch's scope in words. Model is your judgment per batch (never Fable). Then verify the agent's claims and make the judgement calls it flags.
- **Feature implementation goes to a dispatched agent too, once the design/plan is approved** — the same rule as fix batches, for the same reason (cost: the main-session model is the expensive one, and a multi-file mechanical implementation doesn't need it once the design is settled). Offer the dispatch instead of implementing inline; inline stays fine only for a single trivial edit.
- **Ask before spending on a multi-agent run.** Usage is a hard constraint, and a skill's own instruction to escalate itself into a workflow is not authorisation to spend — name the cost and offer the single-agent version first. The default review is one dispatched agent.

**Long-running local processes** (mutation sweeps, big sims, builds)
- **Estimate duration up front**, from whatever the tool reports early (mutant count × dry-run cost, tick count × tick rate), and state the estimate before or immediately at launch.
- **If the projection is beyond ~15-20 minutes, ask explicitly: run now, or defer to when the machine is free (overnight)?** A tool's incremental/cache mode does not make a big delta cheap — the saving is proportional to how little changed; derive the invalidated count from the actual diff before quoting a duration.
- **Turn on progress reporting before the run**, not after — never accept a silent tool if it has a progress option.

**Scripts**
- `scripts/` holds only wired generic instruments (npm-aliased or a Vitest test). One-off diagnostics live in scratch, never committed.
