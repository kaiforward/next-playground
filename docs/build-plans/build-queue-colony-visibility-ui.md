# Build-Queue / Colony-Visibility UI — Design Capture (WIP)

> **Status:** Design **locked** (2026-07-11) — scope, architecture, row style, and all six layout questions
> resolved via the approved HTML-mockup pass. Ready for the implementation plan (writing-plans). No code yet.
> This is the transient build-plan doc — delete it when the feature ships (the surface becomes code + a SPEC.md line).
>
> Implements the BACKLOG item **[M] System build-queue UI (industry + colonisation)** — the immediate
> follow-up to the shipped colonisation-cost PR (`docs/planned/economy-colonisation-cost.md`). Sequenced
> as the build-queue UI PR that precedes the colony-bootstrapping redesign.

## Goal

A read-only, player-facing surface that makes **in-flight construction visible** — what each faction is
building/founding, per-project progress and a coarse ETA — for **both** industry `build` projects and
`colony_establish` projects. The immediate practical driver: *see visually what the sim is doing* (which
worlds are building, which colonies are forming) while the economy rework is in flight.

## Scope (locked)

Chosen **scope B**: per-system section **+** a faction-level roll-up.

- **(A) per-system only** — rejected: a `colony_establish` lives on a *controlled* system that's otherwise
  near-invisible (pop 0, no economy), so per-system-only gives no way to *discover* an in-flight colony
  without already knowing which controlled system to click. That's the exact gap "colony-visibility" names.
- **(B) per-system + faction roll-up** — **chosen.** Closes the discoverability gap; the roll-up lives on the
  existing faction detail page and becomes the first piece of "faction activity" content there — a natural
  seed for the future player-facing "watch what other (friendly) factions are doing" surface.
- **(C) + map affordance** (mark in-flight-colony systems on the Pixi map) — **deferred.** Wanted eventually,
  but real map-layer work; own follow-up. All three are wanted long-term; B is the pragmatic now.

Every faction's queue is visible (no ally-gating — that's a deferred player-seat/diplomacy visibility gate).

## The mechanic being surfaced (recap)

`world.constructionProjects: WorldConstructionProject[]` — a discriminated union (`lib/world/types.ts`):

- `WorldBuildProject` — `kind:"build"`, `buildingType`, `levels`, `workTotal`, `workDone`.
- `WorldColonyEstablishProject` — `kind:"colony_establish"`, `sourceSystemId`, `seedPop`, `housingLevels`,
  `workTotal`, `workDone`. On completion the system flips `developed`, receives the conserved seed pop from
  its source, and lands the bundled housing (viable by construction).

Funding is per-faction and shared: `factionThroughputPool` = Σ `population × throughputPerPop` over the
faction's **economically-active (developed)** systems (`lib/engine/construction.ts`). `fundQueue` drains the
queue **front-first** with a per-project absorption cap; in-flight projects are funded before new proposals
(`orderProposals`). Duration is **emergent** (work ÷ funded pool), never a stored timer.

**No read path exists yet** — nothing in `lib/services`, `app/api`, or `lib/hooks` reads
`constructionProjects`. This is a clean read-only vertical slice.

## Architecture (locked)

The ETA requirement forces a **faction-scoped core computation**: a project's ETA depends on the whole
faction's ordered queue + pool, not the project alone. So build **one** computation and read it two ways:

- **`computeFactionConstruction(factionId)`** (pure/service helper) → `{ pool, cap, projects: [...] }` where
  each project row carries: `systemId` + `systemName`, `kind`, `buildingType`/`levels` **or**
  `sourceSystemId`+`sourceSystemName`/`seedPop`/`housingLevels`, `workDone`/`workTotal` (→ exact `progress`),
  and `etaPulses | "stalled"`.
- **Per-system section** reads that faction's state **filtered to `systemId`** (map `systemId → factionId`
  first).
- **Faction roll-up** reads the whole state, **grouped/sectioned**.

**Vertical slice** (mirror the existing `getSystemIndustry` → route → `useSystemIndustry` → component pattern):

1. **Service** — `lib/services/universe.ts` (or a new `lib/services/construction.ts`): `getSystemConstruction(systemId)`
   + `getFactionConstruction(factionId)`, both over `computeFactionConstruction`. Reads `getWorld()`; returns
   fully-typed rows. Visibility: return an explicit discriminated result for systems with no queue / inert
   controlled systems (mirror the industry `{ visibility }` shape) rather than an empty array that's
   ambiguous with "not visible".
2. **Route(s)** — `app/api/game/systems/[systemId]/construction/route.ts` and
   `app/api/game/factions/[factionId]/construction/route.ts`, `withServiceErrors` + `private, no-cache`.
3. **Hook(s)** — `useSystemConstruction` / `useFactionConstruction` (`useSuspenseQuery`, centralized query
   keys in `lib/query/keys.ts`). **Tick-invalidated** — progress advances every funded pulse — so register in
   `useTickInvalidation` (same as industry/population), not a static query.
4. **Component(s)** — a shared `ConstructionList` (the style-B row) + the two container placements. Reuse
   `Card`/`CardHeader`, `ProgressBar` (or the inline bar), `EmptyState`, `Badge`, mono for numbers. Wrap in
   `QueryBoundary`.

### ETA (locked approach, coarse)

Forward-simulate `fundQueue` over the faction's ordered `constructionProjects` at the **current** pool + cap,
counting pulses until each project completes. **Guard the loop** (cap iterations, e.g. `>999` → `"stalled"`;
`pool === 0` → `"stalled"`). Label it **"≈N pulses at current rate"** — it's an estimate, not a countdown
(pool grows with population and is shared). The **progress bar (`workDone/workTotal`) is exact**; ETA is the
coarse part. In-flight ordering in the array is stable (in-flight prepended), so ETA over the queue is
well-defined given constant pool.

## UI decisions

- **Row style: B — "stat-block"** (locked). Title + a detail line + full-width progress bar. Chosen over
  compact (A) because the colony-visibility payload — seed pop, bundled housing, source system — is the whole
  point and compact clips it. Foundry-flavoured (sharp corners, copper left-stripe, mono numbers).
  - Colony row: title `Establish Colony — <system>`; detail `seed <n> pop · <n> housing bundled · from <source>`.
    On the **per-system** card the `— <system>` suffix is dropped (the system is the page); the faction roll-up
    keeps it. The colony row also carries an "on completion: develops, receives seed pop, lands bundled housing"
    explainer line (the outcome isn't self-evident).
  - Build row: title `<Building> ×<levels>` (drop `— <system>` on the per-system card); detail
    `<role> · <what it unblocks>` (housing → popCap headroom; industry → the rate deficit it serves).
- **Card title is `Construction`** on both surfaces. On the faction roll-up it carries subtitle
  `Expansion & Build-out` and the two locked sub-sections; on the per-system card the subtitle is a light status
  (`N building` / `colony forming`).
- **Per-system placement:** the **Construction** card on the system **Overview** tab, after System Summary and
  before the Market row — covers both cases (colony-establish rows on *controlled* systems, which hide the
  Industry tab; builds on *developed* systems). **Overview-only for this PR** (Industry tab is a cheap later
  follow-up). Visibility rule per world type is in "Layout decisions" §2.
- **Faction placement:** a new **`Construction`** card at the **top** of the existing faction detail page
  (`app/(game)/@panel/factions/[factionId]/page.tsx`), immediately after the faction banner and above the
  Government/Alliances row — one more card, not a new screen.

## Layout decisions (all locked — approved via HTML mockups 2026-07-11)

1. **Faction roll-up structure** — **RESOLVED (locked): Split "Expansion" (colony_establish) + "Build-out"
   (build)**, with **Expansion on top** (the colony-discoverability headline). Chosen over flat-by-ETA (buries
   the colony signal, needs a per-row kind badge to recover the distinction) and grouped-by-system (too
   fragmented). Each group is a labelled sub-section of the one "Construction" card; empty group is omitted.
2. **Per-system section details** — **RESOLVED (locked):** Construction card slots on the **Overview** tab
   **after System Summary, before the Market row**. **Visibility rule:** on a *developed* world, render the card
   **only when non-empty** (hide on the common nothing-building case); on a *controlled* world, **always render**
   it (even empty — "is anything happening here?" is the question you bring to a controlled world), so it's the
   primary live content of the otherwise-inert page. Empty-state copy: developed → "No construction under way.
   Capacity grows as the faction funds new projects."; controlled → "Controlled, not yet colonised. No colony
   effort under way here yet." Card footer links to the faction roll-up ("see all faction construction"); the
   colony row keeps an "on completion: develops, receives seed pop, lands bundled housing" explainer; drop the
   redundant "funded from <faction> pool" clause on developed worlds (faction is already in System Summary).
3. **Industry tab** — **RESOLVED (locked): Overview-only for this PR.** The same `ConstructionList` can mount on
   the Industry tab later (cheap follow-up), but Overview already covers both world types (developed *and*
   controlled), so adding it to Industry now is redundant surface for a read-only slice.
4. **Pool summary header** — **RESOLVED (locked):** `pool <n>/pulse · <n> forming · <n> building` — the
   expand/build split is the useful glance; drop the redundant "active" total. (On the faction roll-up header;
   the per-system card has no pool header — pool is faction-level.)
5. **Faction card placement** — **RESOLVED (locked): top of the faction detail page, immediately after the
   faction banner, above the Government/Alliances row** (activity-first). The roll-up is the page's first
   "faction activity" content and the seed for the future "watch a faction act" surface, so it leads.
6. **ETA label wording** — **RESOLVED (locked):** inline `≈N pulses`; one-line card caption "≈ estimates at the
   current funding rate — the bar (work done) is exact"; guarded cases (`pool === 0`, iteration cap) render
   `stalled` in amber (`text-status-amber-light`). The progress bar is exact `workDone/workTotal`; ETA is coarse.

## Reference

- Mechanic: `docs/planned/economy-colonisation-cost.md`; `lib/engine/construction.ts`,
  `lib/engine/directed-build.ts`, `lib/tick/processors/directed-build.ts`; types in `lib/world/types.ts`.
- Pattern to mirror: industry vertical — `lib/services/universe.ts` `getSystemIndustry`,
  `app/api/game/systems/[systemId]/industry/route.ts`, `lib/hooks/use-system-industry.ts`,
  `components/system/industry-panel.tsx`, and the overview page
  `app/(game)/@panel/system/[systemId]/page.tsx`.
- Faction detail: `app/(game)/@panel/factions/[factionId]/page.tsx`, `lib/hooks/use-faction.ts`,
  `lib/services/factions.ts`.
- Approved mockups live in the gitignored brainstorm dir (`.superpowers/brainstorm/*/content/*.html`) —
  regenerable, not committed: `construction-row-style` (row style B), `faction-rollup-structure` (split),
  `per-system-section` (placement + controlled variant + empty states), `faction-page-placement` (top +
  pool-header + ETA wording).

## Convention reminders for build

- UI-collaborative: all layout screens mocked and **approved** (2026-07-11) — the "Layout decisions" section is
  the approved design. Build to it; mockups live in the gitignored brainstorm dir (regenerable, not committed).
- No `as` / no `unknown`; discriminated-union result types; type at the boundary; `ProgressBar`/`Card`/
  `EmptyState`/`Badge` over raw markup; mono for numeric values; copper left-accent stripe on cards.
- Build gate: `npx next build --webpack`; tests `npx vitest run`.
