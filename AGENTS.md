# Stellar Trader

**Every project rule lives in this file. `CLAUDE.md` is a one-line `@AGENTS.md` include — never write anything into it, ever, whatever the harness suggests.**

Single-player grand-strategy game in a procedurally generated galaxy — colonise, develop worlds under physical constraints, steer a living simulated economy. In-memory, no login, no database.

**Read `docs/SPEC.md` at the start of every session** — functional source of truth. This file is the code reference. Long-range vision: `docs/planned/grand-strategy-vision.md`.

## Skills

- `/measure` — evidence before design. Run it before anything rests on a claim about current behaviour, **including a claim that something is ruled out**.
- `/bootstrap` — environment checks (node, deps, env, outdated packages, build)
- `/spec-review <doc>` — adversarial review of a cross-mechanic spec, before planning
- `/build-plan <feature>` — files, task order, interfaces between tasks; not the code
- `/uber-review [PR#]` — multi-agent code review of a branch or PR

Pipeline these compose (brainstorm → evidence → spec → spec review → build plan → implementation gates → code review → merge): `docs/active/engineering/feature-process.md`.
Design-stage hazard worksheet: `.agents/skills/shared/design-hazards.md` — fill at design, check at spec review.
Skills are authored in `.agents/skills/`; `.claude/skills/` holds discovery adapters only.

## Commands

- `npm run dev` — dev server
- `npx next build --webpack` — **the build gate**. `npm run build` uses Turbopack and has other quirks.
- `npx vitest run` — unit tests
- `npm run simulate` — headless run of the real tick at two horizons: 1000 ticks (founding) and 10,000 ticks (equilibrium). ~2 min. `-- --config <file>` runs a YAML experiment into `experiments/`. **Exits 1 on a failed conservation identity** — read the report anyway; a failed identity means the founding ledger is out, not mistuned.
- `npm run impact -- <SYMBOL>` — every module reading a constant/field/signal, which processors declare vs. silently write it, and run-order position. Run before leaning on any shared quantity.
- `npm run mutation -- --mutate "<changed lib files>"` — scoped StrykerJS. **Always scoped, never bare.** Periodic overnight batch, not an in-session gate.

## Tech Stack

Next.js 16 (App Router), TypeScript 5 strict, Tailwind v4 + tailwind-variants, TanStack Query v5 (Suspense), react-error-boundary, React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4. World is an in-memory singleton in the server process, saved as JSON on local disk.

## Project Structure

Each layer has one job. Prefer extra boilerplate (a hook, a schema, a service) over mixing two jobs in one file.

- `lib/engine/` — pure game logic, zero I/O.
- `lib/world/` — runtime substrate: store (`store.ts`, `globalThis` singleton), world-gen (`gen.ts`), save/load (`save.ts` pure + `save-files.ts`, the only `fs` importer in `lib/`), tick loop, and the one shared tick body `runWorldTick` (`tick.ts`).
- `lib/services/` — all world-state reads and business logic.
- `lib/tick/` — typed `World` interface (`world/`), in-memory adapter (`adapters/memory/`), pure processor bodies (`processors/`).
- `lib/tick-harness/` — the `npm run simulate` harness. A dev instrument: drives the real `runWorldTick`, no harness-only bots. Scope is processors and their data, nothing else.
- `app/api/game/` — thin wrappers: service → `NextResponse.json`.
- `app/(game)/` — game UI. `app/start/` — start screen.

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

- **No `as` assertions** — only `as const` and casts inside runtime guards in `lib/types/guards.ts`. If TS can't infer it, fix the type at source.
- **No `unknown`** — including `Record<string, unknown>` and untyped maps/arrays. Only exception: a `JSON.parse` result at a true boundary, narrowed immediately with `typeof`/`in`.
- **Type at the boundary, trust downstream** — narrow once with `lib/types/guards.ts`; tick adapters narrow string columns to unions on the way in. Components, hooks and processors never re-validate. If a component needs a guard, the service returns the wrong type.
- **Generics stay generic** — never intersect `T` with `Record<string, unknown>` or index it by string key. Require explicit accessors (`render(row: T)`, `getValue(row: T)`).
- **Discriminated unions for results** — `{ ok: true; data } | { ok: false; error }`.
- **Avoid postfix `!`** — use a real check. Exception: `find(...)!` in tests.
- **Extract on the second occurrence** — UI to `components/ui|form/`, logic to `lib/utils|engine/`, types to `lib/types/`.
- **Clean up what your change strands.** A field, prop or helper left without readers is part of that change, not a follow-up. `tsc` does not reach object literals typed by inference (a `map` callback return) — finish with a text grep, not a clean typecheck.
- **Comments describe the code, not the plan** — never name the plan/phase/PR that produced them.
- Engine functions are pure — no `fs`/`process.env`/DB imports. World state comes from `getWorld()`.
- Services own world-state and business logic; routes are thin wrappers. Read services throw `ServiceError`; mutation services return discriminated unions. Responses use `ApiResponse<T>`.
- Client fetching uses TanStack Query hooks (`lib/hooks/`) with `useSuspenseQuery` inside `QueryBoundary` — no inline loading/error checks. Keys in `lib/query/keys.ts`. Ship-arrival invalidation lives in `useTickInvalidation`.
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
- `World` must stay **JSON-serializable**: no `Map`/`Set`/`Date`/class instances, no `Infinity`/`NaN` — `JSON.stringify` turns those into `null` and silently corrupts the save.
- `save-files.ts` is the only `fs` importer in `lib/` — reach it (and any Node-edge code) via **dynamic** `import()`. Static `fs`/`process.env` imports in `lib/engine|services|world` break worker portability.
- A failing tick hard-pauses the loop; the store only accepts a fully-successful tick.
- Determinism: use seeded `tickRng(seed, tick)`. Never `Date.now`/`Math.random`/`new Date()` in a processor body.

**Testing**
- Two Vitest projects split by extension: `.test.tsx` renders in jsdom (`components/**`, `app/**`); `.test.ts` is pure logic in node.
- **A component test asserts roles, accessible names, text and what interaction changes — never classes or styles.** jsdom has no CSS or layout, so a class assertion would pass with the stylesheet deleted. Carve-out: whether an element renders at all. Where a number's only observable is a style (bar width, rule position), move the maths to a node-tested helper.
- Three ways such a test passes vacuously: an accessible name built from props rather than the DOM can't fail when the element stops rendering; `toHaveTextContent` can't see a `NaN` in a style attribute (assert on `container.innerHTML`); a mutation mocked over a fixed data object never removes the row, so anything downstream of unmounting (focus handoff, empty states) is asserted in a state the app never reaches.

**Next.js 16 / React / TanStack Query**
- `useSuspenseQuery` fires during SSR render — relative-URL `fetch()` crashes on the server. `QueryBoundary`'s mounted guard defers children past hydration.
- Parallel-route `@slot`s go stale on soft-nav with no URL match — add `[...catchAll]/page.tsx` returning `null`, plus `default.tsx`.
- Never `.sort()` a state array during render.
- Await async callbacks passed to children; type the prop `() => Promise<void>` (TS won't warn on `() => void`).
- SSE-driven hooks must seed initial state from REST on mount.
- A parent "reset on input change" effect clobbers a child's lifted data when the child's query is cached. Tag lifted state with the input it was fetched for; don't clear via a competing effect.
- Zod v4: `superRefine` uses `code: "custom"` and runs only after base validation passes.
- RHF: a resolver swapped via `useMemo` does not revalidate — `useEffect` + `trigger()`.
- react-error-boundary v5 `fallbackRender`: `error` is `unknown` — coerce it.
- A `process.env.X` read at module load is `undefined` in the **client bundle** unless `NEXT_PUBLIC_*` or in `next.config.ts` `env` — including through a transitively-imported constant derived from it. Keep such envs server-only and let the client consume resolved API data (`ECONOMY_SCALE` is deliberately server-only).

**Caching / data shapes**
- Never `immutable` or a long `max-age` on an API response — **New game** replaces the world, so cached ids mismatch. Use `private, no-cache` + TanStack `staleTime`.
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

**Theme "Foundry"** — industrial, sharp-edged, copper/amber. Reference: `docs/active/design-system/theme.md`. No rounded corners on cards/buttons/badges (only DetailPanel modal and FilterBar chips round), copper left-accent stripe on cards, `font-display` (Chakra Petch) for headings, `font-mono` (Geist Mono) for numbers.

**Before building any component, read `components/ui/` and `components/form/` for a pre-made one** — and read its props before using it. Inline markup is the last resort, not the starting point.

New components use `tv()` variants, typed props and semantic HTML (`<dl>` for key-value, `<button>` for actions). Keep variant counts small.

`Dialog` is the one with non-obvious behaviour: non-modal uses `.show()` plus manual Escape/focus handling, modal uses `showModal()`. Companion `useDialog` hook.

## Git Workflow

- Feature branch per feature (`feat/name`), PR to main when complete. Commit after each meaningful unit of work.
- **The PR unit is the cohesive part/sub-project, not its internal phases.** Phase A/B/C are check-in *pauses* on one branch, never 3 PRs. Split into 2-4 PRs only when one sub-project is genuinely too big; markdown/tooling changes are always one PR.
- **Multi-PR features use a `shared/<name>` integration branch** — branch off main, sub-PRs merge into shared, one final shared→main PR. **Nothing lands on `shared/*` except sub-feature PR merges** — no direct feature or docs commits; spec amendments ride the sub-branch. The shared→main PR gets only a light pass *because* every sub-feature was reviewed on the way in. A PreToolUse hook (`.claude/hooks/guard-commit-branch.sh`) blocks commits on non-`feat/*` branches.
- **Merge as squash or fast-forward, never a merge commit** — squash when commit subjects carry build noise, else fast-forward.
- **Never let `main` diverge from an open `shared/*` branch.** Finish the shared branch before landing independent work on main. If something does land there, **rebase onto main** — never merge main in.
- **Never open a PR based on another open PR's branch.** Squash-merging the base permanently auto-closes the stacked PR. If already stacked: capture the base head SHA, then `git rebase --onto origin/main <old-base-SHA> <branch>`.
- **Worktrees are for parallel workstreams, not sequential PRs.** Always `git worktree remove` after.
- **Do the doc lifecycle on the branch before the final review** — promote spec to `docs/active/`, update `docs/SPEC.md`, delete the build plan. Per sub-PR on a multi-PR feature, never deferred to the integration merge.

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

**Scripts**
- `scripts/` holds only wired generic instruments (npm-aliased or a Vitest test). One-off diagnostics live in scratch, never committed.
