# Stellar Trader

Single-player grand-strategy game (working title pending) in a procedurally generated galaxy — colonise, develop worlds under physical constraints, and steer a living simulated economy. It runs as an **in-memory, no-login local simulation**. Being re-conceived from a browser-based multiplayer space-trading game; the roadmap is in `docs/planned/grand-strategy-vision.md`.

**Important**: Read `docs/SPEC.md` at the start of every session to understand the full game, all active systems, and how they interact. The SPEC is the functional source of truth — this file is the code reference.

## Skills

- `/bootstrap` — Run environment checks (node, deps, env, outdated packages, build)
- `/spec-review <doc-path>` — Adversarially review a cross-mechanic feature spec before implementation planning
- `/uber-review [PR#]` — Run the multi-agent code-review pipeline against a branch or pull request

Shared, harness-neutral skills live in `.agents/skills/`. Claude discovery adapters live in `.claude/skills/`; the canonical workflow remains the `.agents` copy.

## Commands

- `npm run dev` — Start dev server (Turbopack)
- `npm run build` — Production build. **Use `npx next build --webpack` as the PR build gate** (Turbopack build has other quirks; webpack is the stable gate).
- `npx vitest run` — Run unit tests
- `npm run simulate` — Quick headless sanity check over the real tick (`lib/tick-harness/runner.ts`). Reports intrinsic economy-health metrics.
- `npm run simulate -- --config <file>` — Run experiment from YAML config (saves to `experiments/`).

The calibration harness (`lib/tick-harness/`) is a dev instrument, not a game feature — it runs `runWorldTick` (the exact tick the live loop runs) headlessly and reports economy-health metrics for validating changes before they ship. There is only one tick body, so the harness and the live game run literally the same code (no harness-only "bots" or strategies). World generation is `generateWorld(systemCount, seed)` (`lib/world/gen.ts`) invoked in-process on **New game**; there is no seed script and no database.

## Tech Stack

Next.js 16 (App Router), TypeScript 5 (strict), Tailwind CSS v4 + tailwind-variants, TanStack Query v5 (Suspense mode), react-error-boundary, React Flow v12, Recharts, React Hook Form + Zod v4, Vitest 4. **No database and no auth** — the world is an in-memory singleton in the server process, persisted as JSON save files on local disk.

## Project Structure

Core layers (fixed roles — see AGENTS.md conventions for rules):
- `lib/engine/` — Pure game logic. Zero I/O (no `fs`, no `process.env`, no DB). Test with Vitest.
- `lib/world/` — Single-player runtime substrate: the in-memory world store (`store.ts`, a globalThis singleton), world-gen (`gen.ts`), save/load (`save.ts` pure + `save-files.ts`, the only `fs` importer in `lib/`), the tick loop (`tick-loop.ts`), and the one shared tick body `runWorldTick` (`tick.ts`). See `docs/active/engineering/single-player-runtime.md`.
- `lib/services/` — All world-state reads and business logic (read the in-memory world; no DB). Route handlers are thin wrappers.
- `lib/tick/` — Processor pipeline. Each processor splits into a typed `World` interface (`lib/tick/world/`), a single in-memory adapter (`lib/tick/adapters/memory/`), and a pure processor body (`lib/tick/processors/`). `runWorldTick` drives them; the live game and the calibration harness run the same bodies. See `docs/active/engineering/processor-architecture.md`.
- `lib/tick-harness/` — The calibration harness: a dev instrument that runs `generateWorld` + `runWorldTick` headlessly for N ticks and reports economy-health metrics (`npm run simulate`). Not game logic and not engine-pure — it drives the real tick and analyzes its output. Its scope is the tick processors and the data they consume/produce, nothing else.
- `app/api/game/` — Thin HTTP wrappers: call service → NextResponse.json (no auth).
- `app/(game)/` — Game UI pages. `app/start/` — start screen (Continue / Load / New game).

## Docs

Functional spec: `docs/SPEC.md` — master game spec with system interaction map. Read this first.

Design docs (under `docs/`):
- `docs/active/` — Implemented systems, split by type: `gameplay/` (economy + specialisation, events, trade-simulation, navigation, universe, system-traits, faction-system, ship-roster, …), `engineering/` (single-player-runtime, tick-engine, processor-architecture, map-data-loading), `design-system/` (theme)
- `docs/planned/` — Designed but not yet built (grand-strategy-vision, economy-simulation-vision, economy-specialisation, war-system, …)
- `docs/build-plans/` — Transient, code-heavy build plans for in-flight features. **Delete each once its feature ships** — the functional spec moves to `docs/active/` and the code is the source of truth. Functional roadmaps that merely order unbuilt features go in `docs/planned/`, not here.
- `docs/BACKLOG.md` — Actionable work items (delete when shipped)

Doc conventions:
- **No `docs/archive/`** — superseded design docs are deleted (git is the history). The tree is only active (current rules) / planned (unbuilt) / build-plans (transient).
- **Booking is the cost of being allowed to delete** — before deleting a doc, grep it for work it routes elsewhere ("→ BACKLOG", deferred, follow-up) and confirm each item was *actually* booked (`git log -S` the destination file; a plan saying "routed to BACKLOG" is not evidence anyone did it). A retiring doc is routinely the only record on `main` of the work it defers, so deleting it unbooked destroys that record silently — and git history is not a substitute, because nobody greps deleted files for a lever they don't know exists.
- **Active docs describe current reality in present tense** — no change-history/timeline ("removed in Phase 2"), no ephemeral phase nicknames or numbers; a deferred feature is stated as present-fact + a minimal planned-doc pointer.
- **Specs lead with a concise human-readable headline** of the key mechanics + interactions; math/specifics go in later detail sections.

## Design Principles

These apply to every layer — components, hooks, services, engine, processors, constants.

- **Separation of concerns** — Each layer has one job. Components render UI. Hooks manage data fetching and client state. Services own business logic and world-state access. Engine functions are pure computation. Route handlers are thin wrappers. Prefer additional boilerplate (hooks, schemas, services) over mixing concerns in a single file.
- **DRY (Don't Repeat Yourself)** — When logic, markup, or configuration appears in more than one place, extract it. Shared UI goes in `components/ui/` or `components/form/`. Shared business logic goes in `lib/utils/` or `lib/engine/`. Shared types go in `lib/types/`. The second occurrence is the signal to extract — don't wait for a third.
- **KISS (Keep It Simple)** — Solve the current problem with the minimum necessary complexity. Don't add indirection, abstraction, or configuration for hypothetical future needs. A straightforward 20-line function is better than a clever 5-line one. When choosing between approaches, pick the one that's easiest to read, debug, and delete.
- **Reusability** — Design interfaces (props, function signatures, types) for the next 10 uses, not just the current one. Use typed props, discriminated unions, and explicit accessor functions over loose string keys or open-ended config objects.
- **Security** — Validate at system boundaries (API routes, form schemas — e.g. New-game system count and save names are Zod-validated at the route). The in-memory world is advanced only by the single-owner tick loop and mutated by services through the world store; never trust client state for writes.

## Conventions

- **No `as` type assertions** — The only permitted uses of `as` are `as const` and inside runtime type guard functions (`lib/types/guards.ts`) that validate before returning. All other `as` casts are strictly forbidden. If TypeScript can't infer the type, fix the types at the source rather than casting at the consumer.
- **Type at the boundary, trust downstream** — Untyped data enters only at true boundaries (save-file `deserialize`, API `JSON.parse`); narrow it once with guards from `lib/types/guards.ts`, and the in-memory tick adapters narrow any string-typed row columns to unions on the way to a processor body. Services return fully typed data — components, hooks, and processors never re-validate types that were already validated upstream. If a component needs a type guard, the service isn't returning the right type.
- **No `unknown` in the codebase** — `Record<string, unknown>`, `unknown`, and untyped maps/arrays are banned everywhere: components, hooks, services, processors, engine, constants. The only exception is `JSON.parse` results at system boundaries (API routes, save-file `deserialize`, sessionStorage), which must be narrowed immediately with `typeof`/`in` checks — never stored as `unknown`. If a type is too loose, fix it at the source: hand-owned `World` row types (`lib/world/types.ts`), typed event maps for event data, specific value unions for filter params. Extra boilerplate is always preferable to `unknown`.
- **Generics must stay generic** — Generic components like `DataTable<T>` must work with `T` directly, never intersect it with `Record<string, unknown>` or widen it to weaken type safety. Use typed accessors (`render(row: T)`, `getValue(row: T)`) instead of string-key property access. If a generic component needs to access row data, require explicit accessor functions — never cast `T` to access properties by dynamic key.
- Engine functions are pure — no `fs`/`process.env`/DB imports. Test with Vitest.
- World state is read from the in-memory store (`lib/world/store.ts`, `getWorld()`), never a DB. The world is JSON-serializable — no `Map`/`Set`/`Date`/class instances in `World`.
- Tailwind v4 theme is in `globals.css` (`@theme inline {}`), no tailwind.config.js.
- API responses use `ApiResponse<T>` format: `{ data?: T, error?: string }`.
- Services layer (`lib/services/`) holds all world-state/business logic. Route handlers are thin wrappers. Read services throw `ServiceError`; mutation services return discriminated unions.
- **Discriminated unions for result types** — `{ ok: true; data } | { ok: false; error }`, never `{ ok: boolean; data?; error? }`.
- **Avoid the postfix `!` non-null assertion** — strip `null | undefined` with a real check, not `foo!`. Exception: `find(...)!` in tests is an accepted project idiom.
- Client data fetching uses TanStack Query hooks (`lib/hooks/`) with `useSuspenseQuery`. Pages/components wrap data-fetching sections in `QueryBoundary` instead of inline loading/error checks. Query keys are centralized in `lib/query/keys.ts`. Ship arrival invalidation is centralized in `useTickInvalidation` — pages do not subscribe to arrivals individually.
- Forms use React Hook Form + Zod schemas (`lib/schemas/`). Use `TextInput`/`NumberInput`/`SelectInput` from `components/form/`, never raw `<input>` or `<select>`.
- **Comments describe the code, not the plan** — code comments never reference the plan/phase/PR/migration that produced them.
- **Separate static metadata from per-tick dynamic data** — different read paths/endpoints, cached by change cadence (static = `staleTime: Infinity`; dynamic = tick-invalidated).
- **Keep gameplay and performance concerns separate** — never let a performance mechanism (e.g. sharding) silently become a gameplay rule; topology vs sharding are distinct.

## Gotchas / Known Pitfalls

Non-obvious, stack-specific traps — counter-intuitive enough that you wouldn't think to check, so check here. (The `/uber-review` skill's `rules/code-standards.md` is the review-time projection of these + the Conventions above; when you add a rule here, add its review slug there.)

**In-memory world & save files**
- The world is **process state** — a full dev-server restart (not HMR) loses unsaved progress. The `TickLoop` autosaves every 60 s while running + on pause, and the store is a `globalThis` singleton so HMR survives — a restart doesn't. (Turbopack's persistent cache can even re-run a deleted `instrumentation.ts` after a restart; `rm -rf .next` if boot behaviour looks stale.)
- `World` must stay **JSON-serializable**: no `Map`/`Set`/`Date`/class instances, and no `Infinity`/`NaN` in world state — `JSON.stringify` turns those into `null`, silently corrupting a save. Guard tick math that could produce them.
- `save-files.ts` is the only `fs` importer in `lib/` — keep it (and any Node-edge code) behind a **dynamic** `import()` from the pure path so the engine/services/world-gen graph stays worker-portable (path-B guardrail). Static `fs`/`process.env` imports in `lib/engine`, `lib/services`, or `lib/world` (except `save-files.ts`) break that.
- A failing tick **hard-pauses** the loop and never commits the broken world (no `setWorld`, no autosave) — atomicity comes from the store accepting only a fully-successful tick, not a transaction.
- Determinism: tick math uses seeded RNG (`tickRng(seed, tick)`); never read `Date.now`/`Math.random`/`new Date()` inside a processor body (wall-clock is for pacing/autosave/logging only).

**Testing / Vitest**
- The `unit` project runs both `lib/**` and `components/**` `*.test.ts`. There is no longer an integration/Postgres project (deleted with the DB). No jsdom — DOM-touching tests need an inline `globalThis` stub in `beforeAll`.

**Next.js 16 / React / TanStack Query**
- `useSuspenseQuery` fires during SSR render (not in an effect) — relative-URL `fetch()` crashes on the server; `QueryBoundary`'s mounted guard defers children past hydration.
- Parallel-route `@slot`s: a slot with no URL match on soft-nav goes stale — give it a `[...catchAll]/page.tsx` returning `null`, plus a `default.tsx` for hard-nav.
- Never `.sort()` a state array during render — use `[...arr].sort()` / `.toSorted()`.
- Await async callbacks passed to children; type the prop `() => Promise<void>` (TS won't warn on `() => void`).
- SSE-driven hooks must seed initial state from a REST endpoint on mount, else stale defaults until the first event.
- A parent "reset on input change" effect can clobber a child's lifted data when the child's query is **cached** (both `setState`s land in one commit, parent wins). Tag lifted state with the input it was fetched for and render on match — don't clear via a competing effect.
- Zod v4: `superRefine` uses `code: "custom"` (string) and runs only after base validation passes.
- RHF: a resolver swapped via `useMemo` does NOT auto-revalidate — `useEffect` + `trigger()`.
- react-error-boundary v5 `fallbackRender`: `error` is `unknown` — coerce `error instanceof Error ? error : new Error(String(error))`.
- A server-only env read at module load (`process.env.X`) is `undefined` in the **client bundle** unless `NEXT_PUBLIC_*` or listed in `next.config.ts` `env` — so a client component that reads its *resolved value* (directly, or via a transitively-imported constant derived from it) silently falls back to the default client-side while the server uses the real value. The trigger is the client **reading the value**, not merely importing the module (importing a module that derives `X` but reading only unscaled siblings is safe). Prefer keeping such envs **server-only** and having the client consume already-resolved data from the API; expose via `next.config.ts` only when the client genuinely must recompute from the env itself. `ECONOMY_SCALE` is intentionally server-only for this reason. (Map extent is not such a case: it rides in generated world state as `meta.mapSize` and the client reads it from the atlas rather than recomputing from an env.)

**Caching / API / data shapes**
- Never `Cache-Control: immutable` on API responses (it's for hashed static assets) — a **New game** replaces the whole world, so `immutable`/long `max-age` would serve stale system ids that mismatch live tile/dynamic data; use `no-cache`/`max-age` and let TanStack `staleTime` handle in-memory caching. Routes are no longer auth-gated, so the old `public`-cross-serves-users hazard is gone, but `private, no-cache` stays the sensible default.
- `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION` are `Record<EconomyType, Record<string, number>>` — use `getProducedGoods()`/`getConsumedGoods()` or the `in` operator, never `.includes()` (fails silently on a Record).

**Map / Pixi** (skip unless touching the map / WebGL surface)
- Map extent (`mapSize`) comes from the atlas (`meta.mapSize`, generated from system count) — the client computes tile geometry from that value, not an env var. Pass it through explicitly (`systemToTile`/`tileBounds`/`frustumToTiles` all take `mapSize`); there is no module-level `UNIVERSE_SCALE`/tile-size constant anymore.
- Pixi rasterizes small text / sharp corners as aliased mush — map markers use rounded corners + zoom-gated text. Deliberate departure from Foundry's no-rounding rule, which is HTML-only; the WebGL map is its own surface.
- Throttle (leading+trailing), not debounce, for Pixi-ticker→`setState` (debounce never fires during continuous zoom).
- Frustum-gate object *creation*, not just visibility — `SystemObject` is expensive; create only in-frustum, batched per frame.
- `frustumToTiles` max col/row uses `ceil(max / TILE_SIZE) - 1` (half-open `[min, max)`, matching `systemToTile`).
- Keep tick-scoped data (visibility, dynamic) on tick-keyed queries, not viewport-keyed — viewport keys cause flicker + redundant calls on every pan.
- Native `<dialog>` modal: never set `m-0`/`inset-auto` — it breaks `showModal()` UA centering.

**Misc**
- **`git ls-files` is the instrument; `ls` lies.** A `.gitignore` negation under an excluded *directory* is a silent no-op — git cannot re-include anything beneath an excluded directory, so `/experiments` + `!/experiments/examples/` tracked nothing for as long as it existed (fixed by excluding the directory's *contents*: `/experiments/*`). The failure is invisible on disk: the files are right there, `ls` shows them, editors open them, and only `git ls-files` reveals the repo never had them. Before assuming a path is versioned — especially before `git rm`, a move, or "it's in the repo, I can see it" — check `git ls-files`, not `ls`.
- **Tailwind v4 (`@tailwindcss/oxide`) auto-scans the whole project — incl. `docs/*.md` — for class candidates.** A backslash-hex sequence in scanned prose (a Windows path like `…\c5612caa…`, a regex `\d`/`\c`) is read as a CSS escape and rejected as `Invalid code point <n>` at `globals.css:1:1`, aborting `npm run build`. `docs/` is excluded via `@source not "../docs"` in `globals.css`; keep non-source prose out of the scan (or add another `@source not`). Note this only surfaces on a real `next build` (Turbopack) — `tsc` and Vitest stay green — and only on a branch whose offending doc was actually pushed, so CI catches it but local `tsc`-only checks won't.

## UI Components

**Theme**: "Foundry" — industrial, sharp-edged, copper/amber accents. Full reference: `docs/active/design-system/theme.md`. Key rules: no rounded corners on cards/buttons/badges (only DetailPanel modal and FilterBar chips get rounding), copper left-accent stripe on all cards, `font-display` (Chakra Petch) for headings, `font-mono` (Geist Mono) for numeric values.

Use existing components instead of inline markup. Never duplicate markup that already has a component. Use `tv()` variants, typed props, and semantic HTML (`<dl>` for key-value, `<button>` for actions). Keep variant counts small and intentional.

- `components/ui/` — Layout and action primitives (Button, Card, Badge, PageContainer, ProgressBar, StatDisplay, DataTable, StatList, LoadingFallback, ErrorFallback). Read the file for props/variants.
- `components/form/` — Form controls (TextInput, NumberInput, RangeInput, SelectInput, FormError). Never use raw `<input>` or `<select>`.
- **QueryBoundary** (`components/ui/query-boundary.tsx`) — Wraps data-fetching sections. Uses a mounted guard to defer children past SSR hydration so `useSuspenseQuery` only fires in the browser. Composes Suspense + ErrorBoundary + QueryErrorResetBoundary.
- **Dialog** (`components/ui/dialog.tsx`) — Native `<dialog>` wrapper. Non-modal uses `.show()` + manual Escape/focus; modal uses `showModal()` + browser-native focus trap. Companion `useDialog` hook.

## Quality Checklist

After each phase or meaningful commit, verify against these common pitfalls before moving on:

- **Typed keys** — Maps use union keys from constants/types, not `Record<string, ...>`
- **Existing components** — `EmptyState`, `ErrorFallback`, form components, `Badge` — not raw markup
- **No duplication** — If logic/markup exists in two places, extract to `lib/utils/` or `components/ui/`
- **`"use client"` only where needed** — Components without hooks, state, or event handlers don't need it
- **Clean up after yourself** — No unused props, dead imports, or orphaned code left behind

## Git Workflow

- Feature branch per feature (`feat/feature-name`), PR to main when complete.
- Commit after each meaningful unit of work (new model, API route, component).
- **Break large features into 2-4 phase PRs** — each PR small enough to hold full convention context. Review against the quality checklist after each phase, not just at the end. A 12-phase plan should ship as 3-4 PRs, not one monolithic branch. (A markdown-only/tooling change is a single PR — the phase-PR rule is for code features.)
- **The PR unit is the cohesive PART/sub-project, not its internal phases.** A part may be organised internally into Phase A/B/C — those are check-in **pauses**, not separate PRs. Accumulate them all on the one part-branch and match how the prior part shipped (if Part 1 was one PR, Part 2 is one PR). The 2-4-PR split above is for a *single* sub-project genuinely too big for one PR — never read a build plan's "3 phases" as "3 PRs".
- **Multi-PR features use a shared feature branch:** branch off main, phase PRs merge into the shared branch, one final PR shared→main. Shared branches keep a clean atomic per-feature history — phase branches squash in; no merge/bugfix/impl-detail commits on shared.
- **Merge shared→main (or phase→shared) as squash or fast-forward, never a regular merge commit** — squash when phase-commit subjects carry build-noise (`PR3`/`Phase B`/etc.), else fast-forward to keep clean atomic per-feature history.
- **Never open a PR whose base is another open PR's branch.** Squash is the merge default here, so merging the base PR rewrites its commits and deletes its branch — which **permanently auto-closes** the stacked PR. GitHub refuses to reopen it or retarget it, and restoring the deleted base ref does not help; the only way out is a replacement PR. Branch sequential work off `main` and wait, or accept the replacement. If you are ever mid-stack anyway: grab the base branch's head SHA **before** merging (`--delete-branch` removes the local branch too, so the name is gone and the SHA is the only handle), then `git rebase --onto origin/main <old-base-head-SHA> <branch>`.
- **Worktrees are for parallel workstreams, not sequential PRs** — use them for concurrent independent sessions or to keep main's checkout untouched (dev server, editor); for sequential PR-by-PR work on one feature use a shared branch. Always `git worktree remove` after — never leave stale worktrees.
- **Do the doc lifecycle on the feature branch BEFORE the final whole-branch review** (promote spec → `docs/active/`, update the umbrella + `docs/SPEC.md`, delete the build plan) — the review's fold-conformance lens then checks the fold, and post-merge docs force a pointless docs-only PR.

### Review process
- **Spec-stage gate:** run `/spec-review <spec-doc>` on an approved feature spec with cross-mechanic surface (economy, tick processors, changed signals/primitives) BEFORE writing the implementation plan. Pure-UI slices and tooling changes skip it.
- Review with `/uber-review`. Local reviews diff against the shared feature branch (not main) when one exists; PR reviews are fine as-is.
- **Open the PR *before* reviewing** — push and open it, then run the review, so findings land as PR comments. Don't gate PR creation on a clean review.
- **Review each sub-feature GOING INTO shared, so shared→main needs only a light sanity pass.** Each sub-feature is its own small branch, `/uber-review`'d while it is small and still in context. An expensive whole-branch review at the end is the *symptom* of having skipped that per-feature gate — not the standard (SP5 autonomic-light accumulated 49 commits / ~8k lines / 56 files on one branch and forced exactly that).
- **PR-mode `/uber-review`: check out the PR head first**, else agents review stale base-branch code.
- **Scale the review to substantive surface, not file count.** Deletion-heavy PRs: strip pure-deletion files from the reviewed diff (`--diff-filter=d`; pass the deleted-file list as context — the big token lever), bump `--chunk-size`, prune `--only` reviewers whose domain was deleted.
- **Fix cheap + self-contained + already-touching Minor findings in-task** — don't reflexively defer them; deferred ones get an explicit owned cleanup pass, not a weak final-review sink.
- **When the user runs the manual/visual smoke themselves, wait for their go-ahead** before launching the whole-branch review.
- **Never merge over red CI.** If a failure is an unrelated flake (e.g. heavy sim tests timing out under parallel load), confirm it passes in isolation and fix the flake to green — don't merge past it.

## Working Practices

**Verifying changes (dev has no live universe)**
- Verify generation/economy CHANGES by intrinsic coherence, not bit-identical parity vs old output — seeded RNG shifts by design when the draws change.
- Prove a gameplay mechanic works via the simulator (the real tick) measuring the actual OUTCOME — not isolated engine fixtures (which pass while the galaxy is 100% broken). Add a sim metric when a symptom hides in aggregate health.
- Until all mechanisms ship, calibrate the economy to a COARSE health bar only (no NaN/runaway/pinning; dispersion; liquidity) — defer precision tuning (it's perishable) and loosen magnitude-pinning tests to ranges.

**Before building a mechanic**
- Map its runtime interactions with ALL shipped mechanics (decay, staffing, pop viability) first — a plan that ignores staffing builds unstaffable capacity that decay then eats.
- Verify a foundation exposes the discrete primitives the upper layers need before building on it; interaction specs are not integration proof.

**UI / dataviz**
- UI-heavy work gets a collaborative design pass with a browser-viewable HTML prototype the user approves BEFORE implementation — never an agent invoking frontend-design blind. Go breadth-first: rough wireframes to react to, then refine the chosen one — don't jump straight to a single polished prototype.
- A shared/segmented bar is for two consumers of ONE datapoint, never N differently-scaled series (those get separate bars; per-grade detail → tooltip mini-bars).

**Scripts**
- `scripts/` holds only wired generic instruments (npm-aliased or a Vitest test); one-off diagnostics live in scratch and are never committed.

## Shell Commands

- **Never use `cd` in compound commands** — The working directory is already the project root. Compound commands like `cd /path && git log` trigger security approval prompts. Just run the command directly (e.g. `git log`).

## Troubleshooting

When hitting errors, don't fix symptoms directly. Step back and search for the canonical
implementation pattern for the specific tool combination (e.g. "Next.js 16 App Router + TanStack
Query Suspense setup"). Official docs and standard patterns resolve issues faster than iterating on
type errors.
