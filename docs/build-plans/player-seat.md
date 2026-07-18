# Player Seat — Phase 3

Transient build-plan for the **player seat** — the slice of the grand-strategy pivot that puts a
human in a faction's chair. This doc is the design source of truth while the work is in flight; on
ship each slice promotes its functional spec into `docs/active/` (SPEC.md + faction-system.md / a new
player doc) and this file is deleted per the doc lifecycle.

Roadmap context: [grand-strategy-vision.md](../planned/grand-strategy-vision.md) §8, Phase 3. The core
inversion (vision §2 pillar 4): the autonomic agency layer — directed logistics, autonomic build,
colonisation — that already drives every AI faction becomes the **player's control surface**. The
player seat is a *human seat* on machinery that already exists; it is not new AI.

> **Time language.** The tick/cycle scale is not yet decided. This doc says **ticks**, **cycles**, and
> **pulses** — never "months" or "days". Existing code that still says "month" is left alone here and
> cleaned up opportunistically only in files a slice already touches.

---

## Phase 3 decomposition

Phase 3 is multi-subsystem. It ships as four sequential sub-projects, each its own spec → plan → build,
each independently playable. Build order:

1. **The Seat** *(shipped — PR #185)* — author a faction on New Game; a `world.player` marks which
   faction is yours; the existing read-only UI reframes around you (auto-focus your homeworld, a "You"
   tag). **No new verbs** — your faction runs on the autonomic brain, identical to the AI. The one
   unavoidable structural change (who is "the player", threaded through save/load) lands in the
   smallest possible slice, de-risking everything after it.
2. **Control + construction actualisation** *(this slice)* — the inversion made playable. Per-domain
   automation switches plus the first manual verbs (order a build, direct a colony) behind them —
   landing together with a construction-points rework (stratified pop base + Construction Centres) so
   the resource the verbs direct is a real, partly-built one. Design in Slice 2 below.
3. **The purse** — faction money, EU5-shaped: buildings carry a monetary dimension (tax yield,
   maintenance cost) feeding a treasury and budget bands, attached to structures that already exist
   rather than needing its own building roster invented first. Tax policy trades revenue against pop
   happiness. Comes after verbs.
4. **Alert feed** — the faction situation log, once there is enough happening to need telling where to
   look.

World-gen (small cores, open galaxy) and colonisation already shipped, so they are off the Phase 3
list.

---

## Slice 1 — The Seat *(shipped — PR #185)*

**Headline.** Clicking **New Game** opens a setup screen where you author a faction — name, government,
doctrine — plus galaxy size and an optional seed. World-gen seeds your faction as one more major
alongside the eight hand-crafted AI powers; you enter the galaxy already sitting in it, the camera
centred on your homeworld. Nothing else changes: your faction runs on the same autonomic brain as every
rival. This slice establishes *identity and entry* — the verbs come in Slice 2.

### 1. The setup screen (`/start/new`)

`/start`'s inline New-Game form is replaced by a button routing to a dedicated `/start/new` page (a
**Back** link returns to `/start`). The form collects exactly:

| Field | Control | Validation |
|---|---|---|
| Faction name | `TextInput` | required; trimmed; length-bounded |
| Government | `SelectInput` | one of the 8 `GovernmentType` values |
| Doctrine | `SelectInput` | one of the 5 `Doctrine` values |
| Systems | `NumberInput` | 50–20,000 (unchanged) |
| Seed (optional) | `TextInput` | optional integer (unchanged) |

Government/doctrine options come from the existing constants (`GOVERNMENT_TYPES`, `DOCTRINES`) so labels
and any descriptive copy stay single-sourced. Submit → `POST /api/game/new` → hard-nav to `/` (fresh
document, fresh TanStack cache — same pattern the current form uses). No color picker, no doctrine/
government modifier tuning — "author your faction" is name + government + doctrine, full stop.

### 2. The player faction in world-gen

`generateWorld` and `generateUniverse` gain an **optional** `playerFaction: { name, government,
doctrine }`. When present, it is injected in `generateFactions` as an **additional major**
(`isMajor: true`), appended to the preset-major block ahead of the procedural minors, then placed by
the same spacing + seed-biased `placeHomeworlds` logic as every other faction. Consequences:

- **Major-quality homeworld, no special bonus.** Your homeworld is spaced from rivals and seed-biased
  toward good substrate exactly like the eight presets — it is not centred, not buffed. Orientation is
  handled by auto-focus (§4), not by placement.
- **Government may duplicate a preset's.** Governments are not unique; picking Federation simply means
  two Federation majors exist. That is fine and expected.
- **Additive, not replacing.** All eight hand-crafted AI majors still exist; you are a ninth entrant.
- **Colour** is auto-assigned via the same distinct-hue path minors use, kept clear of the preset hues.

**Playerless path is unchanged.** The calibration harness (`npm run simulate`) and any headless
`generateWorld` call pass **no** `playerFaction`, so they keep generating a pure-AI galaxy — the economy
tests and health metrics do not move. `world.player` is `null` in that case.

**Determinism.** `(systemCount, seed, playerFaction)` fully determines the world (byte-for-byte through
JSON). Adding a player changes homeworld placement for everyone (one more homeworld participates in the
spacing), so a seed *with* a player is not position-identical to the same seed *without* one — that is
expected and not a regression; the playerless harness path is what stays pinned.

### 3. Player identity in the world

```
world.player: { controlledFactionId: string } | null
```

A new top-level field on `World`. It lives *in* the world object, so it serialises and round-trips
through save/load with everything else. Everything player-specific hangs off the controlled faction;
`world.player` is deliberately thin — for this slice it holds only the faction id. Save-shape change is
acceptable (saves break on world-shape change, pre-1.0).

**Client exposure.** Player identity folds into the **atlas** payload:

```
AtlasData.player: { controlledFactionId: string; homeworldSystemId: string } | null
```

The atlas is already the map's bootstrap payload and is cached `staleTime: Infinity` — the same
per-world, static cadence player identity has. The API resolves `controlledFactionId` → faction →
`homeworldId` so the client gets the homeworld **system** id directly (what auto-focus needs).
`atlas.player` exists specifically to feed auto-focus (§4); the "You" tag (§5) instead reads a
service-resolved `FactionSummary.isPlayer`, so the faction surfaces need no atlas cross-reference.

### 4. Auto-focus the homeworld

No new map machinery. `StarMap` already accepts `initialSelectedSystemId`, which seeds the camera's
initial `centerTarget` on mount (it centres the camera **without** opening the system panel) and the map
stays hidden until that centre settles — so there is no galaxy-view-then-jump flash. The game page,
which already fetches the atlas to render `StarMap`, reads `atlas.player.homeworldSystemId` and passes
it as `initialSelectedSystemId`. Result: entering the game — whether via New Game, Load, or a plain
refresh — lands the camera on your homeworld. When `atlas.player` is `null` (a hypothetically playerless
world in the browser), behaviour is exactly today's fit-to-galaxy view.

### 5. Minimal identity surfacing

A small **"You"** badge marks the controlled faction in the two read surfaces that list/lead with a
faction: the faction list and the faction panel header. Both render through one component
(`FactionCard`), and `FactionDetail extends FactionSummary`, so a single service-resolved
`FactionSummary.isPlayer` (set from `world.player`) lights up both surfaces. That is the whole of the
identity treatment for this slice — no bespoke your-territory map tint, no panels defaulting to you
beyond the camera focus. Those ride with Slice 2's control surface, where they have verbs to attach to.

### 6. Schema / API

- `newGameSchema` (`lib/schemas/game-setup.ts`) gains `name`, `government`, `doctrine` — name
  trimmed/length-bounded, government/doctrine as enums over the constant value sets. Validated at the
  route boundary (the existing pattern).
- `POST /api/game/new` passes the three new fields into `newGame()`, which forwards a `playerFaction`
  into `generateWorld`.
- New/load response shapes are unchanged (they return `meta`); the client focuses home via the atlas,
  so nothing about entry depends on the mutation response carrying the homeworld.

### 7. Cleanup folded into this slice

- **Delete `startingSystemId` end-to-end.** It is a stale bookmark predating the "you author a faction"
  model and nothing consumes it (confirmed: only `WorldMeta`, `gen.ts`, and tests reference it — no UI/
  map code). Remove the `WorldMeta` field, its computation in `gen.ts`, and the engine's
  `startingSystemIndex` field + `selectStartingSystem()` in `universe-gen.ts`, plus their tests and the
  doc mentions (faction-system.md §5, universe.md, single-player-runtime.md).
- **Purge months/days language** in any file this slice already edits (opportunistic only — not a
  repo-wide sweep).
- **Update vision §3 wording**: the seat is an *authored* faction (name/government/doctrine), not a
  *picked* existing one.

### 8. Explicitly out of scope for Slice 1

No player verbs, no money/treasury/budget, no automation toggles, no manual build or colonisation, no
alert feed, no custom map styling. You author a faction, land on your homeworld, and watch your empire
run on the same brain as the AI. Everything actionable is Slice 2+.

---

### Slice 1 testing

- **World-gen** (`lib/world/__tests__/gen.test.ts`, `lib/engine/__tests__/*`): with a `playerFaction`,
  the world contains a ninth major carrying the authored name/government/doctrine with a placed
  homeworld and `world.player.controlledFactionId` pointing at it; **without** one, generation matches
  today (playerless, `world.player === null`) — the harness path is pinned.
- **Schema**: `newGameSchema` accepts valid government/doctrine and rejects out-of-set values, empty/
  overlong names.
- **Save/load** (`lib/world/__tests__/save.test.ts`): `SAVE_FORMAT_VERSION` bumps 5 → 6 (adding
  `world.player` is a world-shape change); `world.player` survives the serialize/deserialize round-trip,
  and a v5 save is rejected cleanly ("saves break on upgrade", per project convention).
- **`startingSystemId` removal**: the tests that assert on it are removed with the field; nothing else
  references it.
- **Setup form**: renders the government/doctrine selects and validates required fields (component test,
  matching how the current New-Game form is covered).

---

## Slice 2 — Control + construction actualisation

**Headline.** Two things land together. First, construction points become a real, partly-*built*
resource: the pop-generated base pool narrows to heads not employed in skilled work, and a new
**Construction Centre** building adds capital-generated points — so a faction that educates its
population must substitute infrastructure for the labour it loses. Second, the player gets the first
manual verbs — **order a build**, **direct a colony**, **cancel** — behind per-domain automation
toggles. All factions share the points rework (the AI plans centres via the same ROI machinery); the
verbs are the player's alone. Money is explicitly **not** in this slice (Slice 3).

### 1. Construction points — stratified pop base

The faction throughput pool's per-system contribution changes from raw headcount to **eligible
heads**:

```
eligible = population − employed technicians − employed engineers
pool     = Σ over developed systems of eligible × THROUGHPUT_PER_POP  (+ centre output, §2)
```

Eligibility follows **employment, not education** — `splitLabour` already classifies technician/
engineer heads as people *working* skill-1/skill-2 jobs (licence-capped), and everyone else lands in
unskilled/unemployed, who all still build. Consequences, both emergent rather than tuned:

- A faction that industrialises absorbs heads into skilled jobs and its base construction labour
  erodes automatically — richer factions *need* Construction Centres. Nobody wrote a "rich factions
  build slower" rule.
- An underemployed graduate (licensed, no skilled job) still swings a hammer; education alone costs
  nothing — only actually employing your educated pops does.

`THROUGHPUT_PER_POP` is recalibrated upward so a young low-skill economy's pool is roughly unchanged
(the eligible base is nearly the whole population there). The pool function gains the system's
buildings as input (the split derives from them).

### 2. The Construction Centre

A new non-production building type (pattern: vocational school — it produces no market good):

| Aspect | Behaviour |
|---|---|
| Output | `levels × POINTS_PER_LEVEL × staffing fulfilment` added to the faction pool each pulse |
| Staffing | Tier-1-factory-like profile: mostly unskilled + a meaningful technician draw |
| Space | Normal general-space footprint |
| Build cost | Work-cost override entry (`WORK_PER_LEVEL_OVERRIDE`) |
| Decay | Subject to idle-decay like any building |

Staffing fulfilment is computed from the system's buildings + population via the existing industry
helpers. The technician draw completes the substitution loop: you convert a few educated heads plus
capital into more points than the many raw labourers you lost.

### 3. Centre valuation — priced on the existing ROI axis

A centre serves no demand, so it gets no invented value; instead **a construction point's worth is
the best work it can't yet fund**. Per faction per pulse:

1. Order the backlog (open projects + this pulse's proposals) into funding order as usual.
2. Find the **frontier**: work beyond what the current pool drains within `BACKLOG_WINDOW` pulses.
3. `r` = the best ROI among proposals beyond the frontier (`0` if the backlog drains inside the
   window).
4. Emit at most **one** centre proposal — and none while a centre project is already in flight for
   the faction: `value = POINTS_PER_LEVEL × r × PAYBACK_HORIZON`, `work = workCostPerLevel(centre)`,
   sited at the developed system with the most spare labour and space (deterministic tie-break by
   systemId). It enters `orderProposals` as a normal proposal and competes on ROI.

Emergent behaviour — the starvation trigger derived instead of invented: a deep backlog of
*valuable* work → high frontier ROI → the centre outranks mid-queue proposals and funds; a draining
backlog → `r ≈ 0` → never builds; a deep backlog of *junk* → the centre ranks as low as the junk and
correctly waits. Self-limiting: a landed centre grows the pool, pushing the frontier out and dropping
the next centre's value. Two interpretable constants (`PAYBACK_HORIZON` — capital payback;
`BACKLOG_WINDOW`), both simulator-calibrated.

### 4. Automation toggles

```
world.player.automation: { build: boolean; colonisation: boolean }   // both default true
```

Toggled off, the directed-build processor skips **proposal generation** for the player's faction in
that domain — funding of already-committed projects always continues, and manual orders still flow.
AI factions ignore the field entirely. No logistics toggle: logistics has no manual verb in this
slice, and a toggle with nothing behind it is a lie. Surfaced as the switch pair on the faction
construction command card (§6). Save bump 6 → 7 (world-shape change).

### 5. Manual verbs

Ordering always happens **standing in the system** — on its Industry tab, next to the evidence.

- **Order a build** — two entry points:
  - **Quick-add**: a `+` control on every buildable ledger row — existing buildings, housing,
    support, and charted deposits (including unworked ones). One click queues +1 level of that
    row's type, no dialog; repeat clicks extend the same open player project (`levels` +1,
    `workTotal` grows by the level's work cost) so orders batch into one row. A hover tooltip
    carries the quick numbers (work · ≈ pulses at the current pool). Hard-blocked rows (no space /
    no free deposit slots) render the `+` disabled with the reason.
  - **New-industry dialog**: for types with no ledger row yet (including academies) — building +
    levels + a live feasibility readout (space, deposit slots, labour added, est. staffing, work,
    ETA), system fixed by where it was opened. Hard ceilings block submit; staffing shows amber.
  Space and deposit-slot ceilings are **hard rejections** everywhere (the same physical checks the
  planner uses); the labour gate is a **warning, not a block** — the ledger and labour card carry
  the staffing evidence in situ, and the player may overbuild what their pops can staff; staffing
  dilution + idle-decay punish it honestly. The planner protects the AI from that mistake; the
  player gets to make it.
- **Direct a colony** — the Industry tab of an eligible controlled system; its "not yet colonised"
  state is the invitation (button + a preview line: seed source, seed pop, bundled housing, work).
  Click creates the colony-establish project directly — the preview line is the confirmation
  surface, no dialog. Same eligibility as planner candidates (habitable floor, seed source, not
  already in flight); an ineligible controlled system shows the verb disabled with the blocking
  reason — it teaches the planner's rules.
- **Cancel** — inline ✕ on player-originated rows (ghost rows and the forming-colony row; work
  spent is lost). Add + cancel are the whole verb set — reorder/pause come later if wanted.

**Queue position:** in-flight committed work finishes first, then **player orders outrank all
autonomic proposals** (FIFO among themselves), then the usual housing → ROI order. Eviction comes
free: unfunded autonomic proposals are never persisted (persist-if-funded) and re-emit next pulse, so
manual orders consuming the pool *is* the push-out.

**Plumbing:** manual and autonomic projects are the same `WorldConstructionProject` rows — one
queue, one funder; a row gains `origin: "player" | "auto"` (priority, display, cancel-permission).
Zod-validated route → mutation service returning a discriminated union → world store. One
feasibility computation (per system, per building type: space, slots, labour delta, est. staffing,
work, ETA) serves the dialog readout, the quick-add disabled states, and route validation.

### 6. UI

**The Industry tab is the construction surface** — everything physically being built in a system
lives there. The Overview construction section is deleted (it was the placeholder queue).

- **Ghost rows** — in-flight builds render *inside the ledger group where they will land*:
  extractor builds in the deposit table, everything else under its Housing / Specialisation /
  Production / Support group (a group with only ghosts still renders). Grammar: ◇ amber glyph
  (distinct from the health set ● ▽ ▼), dim text, `+N` levels, a slim progress bar, progress % in
  the Worked column, ETA in the Out/cyc column. Player-originated ghosts add a gold ORDERED tag +
  inline ✕ cancel.
- **Verbs on the tab** — the quick-add `+` per row (§5) and a **New industry** button in the
  health strip, both player-controlled systems only.
- **Colonisation** — an undeveloped controlled system's Industry tab replaces its dead empty
  state: eligible → the Establish colony verb + preview; forming → the colony project hero-sized
  in the same ghost grammar (the founding entry of the ledger — when it completes, the ledger
  opens where the row stood).
- **Rival visibility** — AI systems render the tab read-only with ghost rows visible (parity with
  the old Overview card, which already showed any faction's construction).
- **Overview** — the construction section is gone; the context strip gains a one-line pointer
  while anything is forming/building here ("colony forming — 46% → Industry"). No bars, no queue.
- **Faction construction card** becomes a **command summary**: the automation switch pair
  (player faction only), the pool with base + centres composition, and two compact link lists —
  build-out (system → its Industry tab · project count, sorted by count) and forming colonies
  (system links). The per-project roll-up is deleted; detail lives where the thing is built. AI
  faction pages show pool + lists, no switches.
- Deferred and booked in `docs/BACKLOG.md`: a faction-screen colonise verb with **map-based**
  target selection (not a dropdown).

### 7. Slice 2 testing

- **Engine**: eligible-pop pool math (skilled employment shrinks the pool; underemployed graduates
  don't); centre output × fulfilment; frontier-ROI valuation (funds under valuable backlog, waits on
  junk or a draining queue); queue ordering with player rows (in-flight → player → housing → ROI);
  quick-add batching (a second order extends the open player project, not a second row); the
  feasibility computation (hard ceilings vs the labour warning; colony eligibility reasons).
- **Simulator gate (the real proof)**: AI factions still colonise and develop; centres appear under
  backlog pressure and *don't* appear without it; no runaway/NaN. Add a pool-composition
  (base vs centres) + queue-ETA metric to the health report so starvation is visible.
- **Component**: ledger ghost rows render in the right groups; quick-add enabled/disabled states;
  new-industry dialog validation; toggle wiring; faction command-card lists.
- **Save/load**: v7 round-trip (`automation`, `origin`); v6 rejected cleanly.

### 8. Sequencing

Shared feature branch; two PRs, each `/uber-review`'d going in:

- **PR A — the economy half** *(shipped to shared)*: stratified base + Construction Centre +
  frontier-ROI valuation, sim-validated. All-faction recalibration risk isolated here, no UI.
- **PR B — the control half**: toggles + verbs + the Industry-tab construction surface (ghost
  rows, quick-add, new-industry dialog, colony states), Overview card removal, faction command
  card. Save 6 → 7.

---

## Build gate

`npx next build --webpack`, `npx vitest run`, and `npm run simulate` (for Slice 2: confirming the
AI-faction health metrics per §7's simulator gate) before each PR.
