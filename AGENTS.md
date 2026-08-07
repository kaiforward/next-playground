# Stellar Trader

Single-player grand-strategy game in a procedurally generated galaxy — colonise, develop worlds under physical constraints, steer a living simulated economy. In-memory, no login, no database. Roadmap: `docs/planned/grand-strategy-vision.md`.

**Read `docs/SPEC.md` at the start of every session** — it is the functional source of truth for the game and how its systems interact. This file is the code reference.

## Skills

- `/measure` — **evidence before design.** Run it whenever anything downstream will rest on a claim about how the game behaves today, including a claim that something is ruled out.
- `/bootstrap` — environment checks (node, deps, env, outdated packages, build)
- `/spec-review <doc-path>` — adversarial review of a cross-mechanic spec, before implementation planning
- `/build-plan <feature>` — implementation plan from a reviewed spec: files, task order and the interfaces between tasks — not the code
- `/uber-review [PR#]` — multi-agent code review of a branch or PR

**The end-to-end pipeline these skills compose — brainstorm → evidence → spec → spec review →
build plan → implementation gates → code review → merge — is `docs/active/engineering/feature-process.md`.**

Design-stage hazards (the six ways a design here has been wrong, as a worksheet) live in
`.agents/skills/shared/design-hazards.md`. Fill it at design, check it at spec review.

Skills are authored in `.agents/skills/` (canonical). `.claude/skills/` holds discovery adapters only.

## Commands

- `npm run dev` — dev server (Turbopack)
- `npx next build --webpack` — **the build gate**. `npm run build` uses Turbopack, which has other quirks.
- `npx vitest run` — unit tests
- `npm run simulate` — headless run of the real tick, reporting economy health at two horizons: 1000 ticks (startup/founding behaviour) and 10,000 ticks (equilibrium). ~2 min. `-- --config <file>` runs a YAML experiment into `experiments/`.
- `npm run impact -- <SYMBOL>` — every module that reads a constant, field or signal, which tick processors declare it, which ones write it without declaring it, and their position in the run order. Run it before leaning on any shared quantity.
- `npm run mutation -- --mutate "<changed lib files>"` — scoped StrykerJS run; a surviving mutant is a code change no test notices. Runs as a periodic batch (sweep → fix wave → re-sweep, typically overnight), not an in-session pre-review gate; incremental cache in `reports/stryker-incremental.json`. **Always scoped, never bare.**

## Tech Stack

Next.js 16 (App Router), TypeScript 5 strict, Tailwind v4 + tailwind-variants, TanStack Query v5 (Suspense), react-error-boundary, React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4. No database, no auth — the world is an in-memory singleton in the server process, saved as JSON on local disk.

## Project Structure

Each layer has one job. Prefer extra boilerplate (a hook, a schema, a service) over mixing two jobs in one file.

- `lib/engine/` — pure game logic, zero I/O.
- `lib/world/` — runtime substrate: world store (`store.ts`, a `globalThis` singleton), world-gen (`gen.ts`), save/load (`save.ts` pure + `save-files.ts`, the only `fs` importer in `lib/`), tick loop (`tick-loop.ts`), and the one shared tick body `runWorldTick` (`tick.ts`).
- `lib/services/` — all world-state reads and business logic.
- `lib/tick/` — processor pipeline: typed `World` interface (`world/`), in-memory adapter (`adapters/memory/`), pure processor body (`processors/`).
- `lib/tick-harness/` — the calibration harness behind `npm run simulate`. A dev instrument, not game logic: it drives the real `runWorldTick` (one tick body only — no harness-only bots) and analyses the output. Scope is the tick processors and their data, nothing else.
- `app/api/game/` — thin wrappers: call service → `NextResponse.json`.
- `app/(game)/` — game UI. `app/start/` — start screen.

Detail: `docs/active/engineering/{single-player-runtime,processor-architecture}.md`.

## Docs

- `docs/SPEC.md` — master functional spec + system interaction map.
- `docs/active/` — shipped systems (`gameplay/`, `engineering/`, `design-system/`).
- `docs/planned/` — designed, not built.
- `docs/build-plans/` — transient build plans; **delete each when its feature ships**.
- `docs/ROADMAP.md` — **the single ordered queue of work.** Nothing else keeps a second copy of it; memory tracks only where we are on it. Delete a row when it ships.

Conventions:
- **No `docs/archive/`** — superseded docs are deleted. Git is the history.
- **Active docs describe current reality in present tense** — no change history, no phase numbers or nicknames, no names or dates attributing decisions (git holds who and when).
- **Specs lead with a plain-language headline** of the mechanics and their interactions; math goes in later sections.
- **Before deleting a doc, book what it defers.** Grep it for deferred/follow-up/"→ ROADMAP" work and confirm each was actually booked (`git log -S` the destination) — a plan claiming it routed something is not evidence anyone did.

## Conventions

- **No `as` type assertions** — only `as const` and casts inside runtime guards in `lib/types/guards.ts`. If TypeScript can't infer it, fix the type at the source.
- **No `unknown`** — `unknown`, `Record<string, unknown>`, untyped maps/arrays are banned everywhere. Only exception: a `JSON.parse` result at a true boundary (API route, save-file `deserialize`, sessionStorage), narrowed immediately with `typeof`/`in`.
- **Type at the boundary, trust downstream** — narrow once at the boundary with `lib/types/guards.ts`; tick adapters narrow string columns to unions on the way into a processor. Components, hooks and processors never re-validate. If a component needs a guard, the service is returning the wrong type.
- **Generics stay generic** — never intersect `T` with `Record<string, unknown>` or reach into it by string key. Require explicit accessors (`render(row: T)`, `getValue(row: T)`).
- **Discriminated unions for results** — `{ ok: true; data } | { ok: false; error }`, never `{ ok: boolean; data?; error? }`.
- **Avoid postfix `!`** — strip `null | undefined` with a real check. Exception: `find(...)!` in tests is an accepted idiom.
- **Extract on the second occurrence**, not the third — shared UI to `components/ui|form/`, shared logic to `lib/utils|engine/`, shared types to `lib/types/`.
- **Clean up what your own change strands.** A field, prop or helper your rewrite leaves without readers is part of that change, not a follow-up — cost is judged by the judgement required, not the number of sites. `tsc` does not reach object literals typed by inference (an `Array.from`/`map` callback return), so finish with a text grep, not a clean typecheck.
- **Comments describe the code, not the plan** — never name the plan/phase/PR/migration that produced them.
- Engine functions are pure — no `fs`/`process.env`/DB imports.
- World state is read from `getWorld()` (`lib/world/store.ts`), never a DB.
- Services own all world-state and business logic; route handlers are thin wrappers. Read services throw `ServiceError`; mutation services return discriminated unions.
- API responses use `ApiResponse<T>`: `{ data?: T, error?: string }`.
- Client data fetching uses TanStack Query hooks (`lib/hooks/`) with `useSuspenseQuery`, wrapped in `QueryBoundary` — no inline loading/error checks. Query keys live in `lib/query/keys.ts`. Ship-arrival invalidation is centralised in `useTickInvalidation`.
- Forms use React Hook Form + Zod (`lib/schemas/`) with `components/form/` controls — never raw `<input>`/`<select>`.
- `"use client"` only where needed — no hooks, state or handlers means no directive.
- Tailwind v4 theme lives in `globals.css` (`@theme inline {}`); there is no `tailwind.config.js`.
- **Separate static metadata from per-tick dynamic data** — different read paths, cached by change cadence (static `staleTime: Infinity`, dynamic tick-invalidated).
- **Keep gameplay and performance concerns separate** — never let a performance mechanism (e.g. sharding) become a gameplay rule.
- Validate at system boundaries with Zod (API routes, form schemas). Never trust client state for writes.

## Gotchas / Known Pitfalls

Non-obvious, stack-specific traps. (`/uber-review`'s `rules/code-standards.md` is the review-time projection of these + the Conventions above — when you add a rule here, add its review slug there.)

**In-memory world & save files**
- The world is **process state** — a dev-server restart (not HMR) loses unsaved progress. `TickLoop` autosaves every 60 s and on pause; the store is a `globalThis` singleton so HMR survives. If boot behaviour looks stale, `rm -rf .next` (Turbopack's persistent cache can re-run a deleted `instrumentation.ts`).
- `World` must stay **JSON-serializable**: no `Map`/`Set`/`Date`/class instances, no `Infinity`/`NaN` — `JSON.stringify` turns those into `null` and silently corrupts the save. Guard tick math that can produce them.
- `save-files.ts` is the only `fs` importer in `lib/` — reach it (and any Node-edge code) via a **dynamic** `import()` so the engine/services/world-gen graph stays worker-portable. Static `fs`/`process.env` imports in `lib/engine`, `lib/services` or `lib/world` break that.
- A failing tick **hard-pauses** the loop and never commits the broken world — atomicity comes from the store accepting only a fully-successful tick.
- Determinism: use seeded `tickRng(seed, tick)`. Never `Date.now`/`Math.random`/`new Date()` inside a processor body (wall-clock is for pacing/autosave/logging only).

**Testing**
- The `unit` Vitest project runs `lib/**` and `components/**`. No jsdom — DOM-touching tests need an inline `globalThis` stub in `beforeAll`.

**Next.js 16 / React / TanStack Query**
- `useSuspenseQuery` fires during SSR render, not in an effect — relative-URL `fetch()` crashes on the server. `QueryBoundary`'s mounted guard defers children past hydration.
- Parallel-route `@slot`s go stale on soft-nav with no URL match — add `[...catchAll]/page.tsx` returning `null`, plus `default.tsx` for hard-nav.
- Never `.sort()` a state array during render — use `[...arr].sort()` / `.toSorted()`.
- Await async callbacks passed to children; type the prop `() => Promise<void>` (TS won't warn on `() => void`).
- SSE-driven hooks must seed initial state from a REST endpoint on mount.
- A parent "reset on input change" effect clobbers a child's lifted data when the child's query is **cached** (both `setState`s land in one commit, parent wins). Tag lifted state with the input it was fetched for; don't clear via a competing effect.
- Zod v4: `superRefine` uses `code: "custom"` and runs only after base validation passes.
- RHF: a resolver swapped via `useMemo` does not auto-revalidate — `useEffect` + `trigger()`.
- react-error-boundary v5 `fallbackRender`: `error` is `unknown` — coerce it.
- A `process.env.X` read at module load is `undefined` in the **client bundle** unless `NEXT_PUBLIC_*` or listed in `next.config.ts` `env`. A client component reading its *resolved value* — directly, or through a transitively-imported constant derived from it — silently falls back to the default while the server uses the real one. The trigger is reading the value, not importing the module. Keep such envs server-only and let the client consume resolved data from the API (`ECONOMY_SCALE` is deliberately server-only).

**Caching / API / data shapes**
- Never `Cache-Control: immutable` or a long `max-age` on an API response — a **New game** replaces the whole world, so stale system ids mismatch live data. Use `private, no-cache` and let TanStack `staleTime` cache in memory.
- `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION` are `Record<EconomyType, Record<string, number>>` — use `getProducedGoods()`/`getConsumedGoods()` or `in`, never `.includes()` (fails silently on a Record).

**Map / Pixi** (skip unless touching the map / WebGL surface)
- Map extent comes from the atlas (`meta.mapSize`), not an env — pass it explicitly (`systemToTile`/`tileBounds`/`frustumToTiles` all take it).
- Pixi rasterizes small text and sharp corners as aliased mush — map markers use rounded corners + zoom-gated text. Deliberate departure from Foundry's no-rounding rule, which is HTML-only.
- Throttle (leading+trailing), not debounce, for Pixi-ticker → `setState` — debounce never fires during continuous zoom.
- Frustum-gate object *creation*, not just visibility — `SystemObject` is expensive; create only in-frustum, batched per frame.
- `frustumToTiles` max col/row uses `ceil(max / TILE_SIZE) - 1` (half-open, matching `systemToTile`).
- Keep tick-scoped data on tick-keyed queries, never viewport-keyed — viewport keys cause flicker and redundant calls on every pan.
- Native `<dialog>` modal: never `m-0`/`inset-auto` — it breaks `showModal()` UA centering.

**Misc**
- **`git ls-files` is the instrument; `ls` lies.** A `.gitignore` negation under an excluded *directory* is a silent no-op — exclude the directory's *contents* (`/experiments/*`) if anything beneath it must be re-includable. Check `git ls-files` before assuming a path is versioned.
- **Tailwind v4 scans the whole project for class candidates, including `docs/*.md`.** A backslash-hex sequence in scanned prose (a Windows path, a regex `\d`) reads as a CSS escape and aborts `next build` with `Invalid code point`. `docs/` is excluded via `@source not "../docs"` in `globals.css` — keep non-source prose out of the scan. Only surfaces on a real `next build`; `tsc` and Vitest stay green.

## UI Components

**Theme "Foundry"** — industrial, sharp-edged, copper/amber. Full reference: `docs/active/design-system/theme.md`. No rounded corners on cards/buttons/badges (only DetailPanel modal and FilterBar chips round), copper left-accent stripe on cards, `font-display` (Chakra Petch) for headings, `font-mono` (Geist Mono) for numbers.

Use existing components instead of inline markup. Use `tv()` variants, typed props, semantic HTML (`<dl>` for key-value, `<button>` for actions). Keep variant counts small.

- `components/ui/` — Button, Card, Badge, PageContainer, ProgressBar, StatDisplay, DataTable, StatList, EmptyState, LoadingFallback, ErrorFallback. Read the file for props.
- `components/form/` — TextInput, NumberInput, RangeInput, SelectInput, FormError.
- `QueryBoundary` — composes Suspense + ErrorBoundary + QueryErrorResetBoundary with a mounted guard.
- `Dialog` — native `<dialog>` wrapper; non-modal uses `.show()` + manual Escape/focus, modal uses `showModal()`. Companion `useDialog` hook.

## Git Workflow

- Feature branch per feature (`feat/name`), PR to main when complete. Commit after each meaningful unit of work.
- **The PR unit is the cohesive part/sub-project, not its internal phases.** Phase A/B/C are check-in *pauses* on one branch — never read "3 phases" as "3 PRs". Split into 2-4 PRs only when a single sub-project is genuinely too big for one; markdown/tooling changes are always one PR.
- **Multi-PR features use a shared feature branch** — branch off main, sub-PRs merge into shared, one final PR shared→main.
- **Merge as squash or fast-forward, never a merge commit** — squash when commit subjects carry build noise (`PR3`, `Phase B`), else fast-forward.
- **Never open a PR whose base is another open PR's branch.** Squash-merging the base rewrites its commits and deletes its branch, which *permanently* auto-closes the stacked PR — GitHub will not reopen or retarget it. Branch sequential work off `main`. If already stacked: capture the base head SHA before merging, then `git rebase --onto origin/main <old-base-SHA> <branch>`.
- **Worktrees are for parallel workstreams, not sequential PRs.** Always `git worktree remove` after.
- **Do the doc lifecycle on the branch before the final review** — promote spec to `docs/active/`, update `docs/SPEC.md`, delete the build plan. Post-merge docs force a pointless docs-only PR.

### Review process
- **Spec gate:** `/spec-review <doc>` on any spec with cross-mechanic surface (economy, tick processors, changed signals/primitives) BEFORE writing the implementation plan. Pure-UI and tooling skip it.
- **Everything you know about a PR goes on the table BEFORE it merges.** Findings, doubts, "worth considering" notes, anything you would otherwise append afterwards — they belong in the review response while the merge is still an open decision. A post-merge "oh, also, three things…" is withholding the inputs to a decision already made, and is the single most-repeated failure here. If you genuinely only see something after the merge, say plainly that it was missed at review time.
- **A roadmap item is the owner's decision, not yours.** Booking a finding instead of fixing it must be (a) stated in the turn's response and (b) named in the commit message. Default: if it is cheap, self-contained and in a file the PR already touches, fix it and say so.
- **Open the PR before reviewing**, so findings land as PR comments. Don't gate PR creation on a clean review.
- **Review each sub-feature going INTO shared**, while it is small and in context — a whole-branch review at the end is the symptom of having skipped that gate, not the standard.
- **PR-mode `/uber-review`: check out the PR head first**, else agents review stale base-branch code.
- **Scale the review to substantive surface, not file count.** Deletion-heavy PRs: strip pure-deletion files (`--diff-filter=d`, pass the deleted list as context), bump `--chunk-size`, prune `--only` reviewers whose domain was deleted.
- **Wait for the go-ahead** when the manual/visual smoke is being run by hand.
- **Never merge over red CI.** Confirm an unrelated flake passes in isolation and fix it — don't merge past it.

## Working Practices

**Verifying changes** (dev has no live universe)
- **Prove a mechanic works with `npm run simulate` measuring the actual outcome** — not isolated engine fixtures, which pass while the galaxy is 100% broken. Add a sim metric when a symptom hides inside an aggregate.
- Verify generation/economy changes by intrinsic coherence, not parity with old output — seeded RNG shifts by design when the draws change.
- **Read both horizons, always.** Startup (1000 t) answers founding/provisioning questions; equilibrium (10,000 t) is the only valid basis for tuning a constant. The startup transient is ~300+ cycles (`CYCLE_LENGTH` 24). Never quote one at the other's question: a short read is not evidence of an equilibrium fault, and an equilibrium read is not evidence a founding fault does not exist.
- **A "ruled out" is a claim with the same evidence bar as a finding** — both horizons, and record which horizon and cohort it was measured at. Nobody re-tests a negative, so a wrong one steers every later investigation away from the cause.
- **Read an aggregate cohorted before diagnosing it** (`npm run simulate` splits by market role and world cohort). A galaxy-wide median moves with cohort *mix*, not just with the thing it measures.
- **Write the test that fails when the task's own premise breaks**, not one that confirms the happy path.
- **Red-proof before review; mutation sweep on a batch cadence** — every new/changed test seen red once
  (break the premise, watch it fail, restore) is the synchronous, in-session gate. The scoped
  `npm run mutation` sweep runs as a periodic batch — sweep → fix wave → re-sweep, results at the next
  working session — with the same bar: every in-diff survivor killed or accepted with a stated reason, never
  a Stryker disable comment. Procedure: `docs/active/engineering/feature-process.md`.
- Calibrate to a coarse health bar only (no NaN/runaway/pinning; dispersion; liquidity) until all mechanisms ship — precision tuning is perishable.

**Before building a mechanic**
- **Map its runtime interactions with ALL shipped mechanics first** — decay, staffing, pop viability, and **events** (the one most often forgotten). A plan that ignores staffing builds unstaffable capacity that decay then eats.
- Verify the foundation exposes the discrete primitives the upper layers need; an interaction spec is not integration proof.
- **Read what a constant was authored to MEAN — its docstring, not its value.** Numbers here are routinely authored for one purpose and read as if they meant another: `GOOD_CONSUMPTION` is a tier gradient, not a necessity ranking; `MIN_DEMAND` is a divide-by-zero guard for *pricing*; `TARGET_COVER` is a price-dispersion knob. Check the authored intent and the table's real shape before leaning on a value.

**UI / dataviz**
- UI-heavy work gets a collaborative design pass with a browser-viewable HTML prototype approved BEFORE implementation. Breadth-first: rough wireframes to react to, then refine the chosen one.
- A shared/segmented bar is for two consumers of ONE datapoint, never N differently-scaled series.

**Executing fix batches**
- **Batches of code fixes (review findings, mutant kills, multi-file cleanups) go to a dispatched
  Opus agent** — with the standard one-line ask — never inline in the main
  session. Inline is for a single trivial edit only. The main session runs the priciest model and
  its context belongs to orchestration; "don't block on an ask" is not a reason to skip the ask.
  The ask describes the dispatch's scope in words — what it will read and do, never a token count.
  The session's job on the result: verify the agent's claims and make the judgement calls it flags
  (a wrong finding, a fix that would weaken a test).

**Scripts**
- `scripts/` holds only wired generic instruments (npm-aliased or a Vitest test). One-off diagnostics live in scratch and are never committed.

**Shell**
- Never use `cd` in compound commands — the working directory is already the project root.
