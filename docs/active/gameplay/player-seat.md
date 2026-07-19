# Player Seat — Identity, Automation & Construction Verbs

> **Status: Implemented** (Slice 1 "the seat" + Slice 2 "control + construction actualisation" of the
> grand-strategy pivot's player-seat phase). Roadmap home:
> [grand-strategy-vision.md](../../planned/grand-strategy-vision.md) §8 Phase 3. The unbuilt remainder
> of Phase 3 (the faction purse, the alert feed) is designed in
> [player-seat-roadmap.md](../../planned/player-seat-roadmap.md). Sits *on* the autonomic-build/
> construction-pool machinery in [economy-autonomic-agency.md](./economy-autonomic-agency.md) and the
> colony lifecycle in [colonisation.md](./colonisation.md) — the player seat is a **human seat on
> machinery that already exists**, not a parallel AI.

---

## Key mechanics (the headline)

On **New Game** you author a faction — name, government, doctrine — and world-gen seats it as a ninth
major alongside the eight AI powers, recorded as `world.player.controlledFactionId`. From there your
faction runs on the **same autonomic brain as every AI faction** — the directed-logistics and
directed-build processors plan and fund your territory exactly as they do a rival's — except you get a
control surface on top of it:

- **Per-domain automation switches** (`world.player.automation.build` / `.colonisation`) that gate the
  planner's *proposal generation* for your faction — turn one off and the planner stops inventing new
  work in that domain, while every already-committed project keeps funding and drawing down.
- **Manual verbs** — order a build, direct a colony, cancel an order — standing in a system on its
  Industry tab (build) or Overview (colonisation), next to the evidence.
- **Queue priority** — your orders enter the *same* construction queue as autonomic proposals and
  outrank new ones, so directing the pool is immediate, not a suggestion the planner might defer.

A playerless world (`world.player === null` — the calibration harness, or any headless `generateWorld`
call with no `playerFaction`) takes none of this: automation gating and the queue-priority partition are
both identities with no player seat, so the AI-only simulation is untouched.

---

## The seat

`world.player: { controlledFactionId: string; automation: { build: boolean; colonisation: boolean } } |
null` is a top-level, JSON-serializable field on `World` — it survives save/load like everything else.
Your faction is seeded as an **additional major** (`isMajor: true`) in `generateFactions`, placed by the
same spacing + seed-biased `placeHomeworlds` logic as the eight presets: a major-quality homeworld with no
special bonus, no forced centring, an auto-assigned colour clear of the preset hues. On entry the map
auto-focuses your homeworld (`atlas.player.homeworldSystemId` feeds `StarMap`'s `initialSelectedSystemId`)
and a **"You"** badge marks your faction on the faction list and faction panel header
(`FactionSummary.isPlayer`, resolved from `world.player`). Full faction-seeding detail:
[faction-system.md](./faction-system.md#starting-position-implemented).

---

## Automation — per-domain switches, not a master toggle

```
world.player.automation: { build: boolean; colonisation: boolean }   // both default true
```

Each switch gates one domain's **proposal generation** in the directed-build processor for the player's
faction only — AI factions never read the field. Toggled off:

- The planner stops proposing new work in that domain (no new autonomic `build` proposals, or no new
  `colony_establish` proposals).
- **Funding of already-committed projects always continues** — nothing already in flight stalls.
- **Manual orders always continue** — the switches gate the *autonomic* planner, never your own verbs.

There is no logistics switch: directed logistics has no manual verb in this slice, and a toggle with
nothing behind it would be a lie. The switches surface as a pair of checkboxes on the faction
construction command card (see UI, below); a set call replaces `world.player.automation` wholesale
(`setAutomation`, `lib/services/construction-orders.ts`).

---

## Player orders

Manual and autonomic construction share **one queue** — `world.constructionProjects` rows all gain an
`origin: "auto" | "player"` field (priority, display, and cancel-permission all key off it). Ordering
always happens standing in the system, next to the evidence it changes.

### Order a build

Two entry points, both served by one feasibility computation (`computeBuildOptions`, below):

- **Quick-add** — a `+` control on every buildable ledger row on the Industry tab (existing buildings,
  housing, support, charted deposits including unworked ones). One click queues +1 level; a **second**
  click on the same row extends the same open player project rather than opening a second row
  (`levels += 1`, `workTotal += workPerLevel` on the standing `(system, buildingType)` row) — orders
  batch into one ledger entry. A hover tooltip carries the quick numbers (work · ≈pulses at the current
  pool); a hard-blocked row renders the `+` disabled with its reason.
- **New-industry dialog** — for types with no ledger row yet (including academies): building + levels +
  a live feasibility readout (space, deposit slots, labour added, estimated staffing, work, ETA). Hard
  ceilings block submit; a staffing shortfall warns amber but never blocks.

`orderBuild` (`lib/services/construction-orders.ts`) validates the seat, that the system is the
player's and developed, and the same physical ceiling `computeBuildOptions` reports, then either extends
the standing player row or mints a new `WorldBuildProject` with `origin: "player"`.

### Direct a colony

A controlled, not-yet-developed player system's founding entry (rendered on its **Overview**, not the
Industry tab — see UI). Eligibility mirrors the autonomic planner's own colony-candidate gate exactly,
via one shared function (`colonyEligibility`, `lib/services/colony-eligibility.ts`, consumed by both the
mutation service and the read service so neither drifts from the other): not already forming, above the
habitable floor, and a reachable developed same-faction seed source within the tick's hop radius
(`COLONY_REACH_HOPS = max(logistics, build, expansion reach)`). Sizing (`seedPop`, bundled
`housingLevels`, total `work`) comes from `sizeColonyEstablish` — the exact function the autonomic
planner calls, extracted so both order the same shape of project. An eligible system shows the verb plus
a preview line (source system, seed pop, bundled housing, work) that **is** the confirmation surface — no
dialog; clicking it orders directly. An ineligible controlled system shows the verb disabled with the
blocking reason, teaching the planner's own rules. The seed-source tie-break (nearest developed
same-faction system) differs in one respect from the autonomic planner's — see
[BACKLOG.md](../../BACKLOG.md) for the recorded (accepted) divergence.

### Cancel

An inline ✕ on player-originated rows (ghost rows on the Industry tab, the forming-colony hero row on
Overview). Cancelling drops the row outright — **work spent is lost**, by design. Add + cancel are the
whole verb set for this slice; reorder/pause are not built.

---

## Queue priority

Funding order across the whole faction queue reads: **in-flight committed work → your fresh orders →
new autonomic proposals**, implemented as a stable partition of the *stored* open set
(`orderOpenProjects`, `lib/engine/construction.ts`): everything already committed (any origin, any
`workDone`) keeps its stored front-first order; fresh player rows (`origin: "player"` with `workDone ≤
0`) move to the back of that, preserving their own insertion order. The caller appends this pulse's new
autonomic proposals after. The function is an **identity on any queue with no fresh player rows** — an
AI-only queue is untouched bit-for-bit, so the calibration harness needs no gate beyond its existing
one.

Persist-if-funded (autonomic colonies and Construction Centres are dropped when they receive no work this
pulse, so their price stays live rather than queue-jumping later) is **auto-only**: a player order has no
re-emitter, so it always persists until funded or cancelled, never silently dropped.

---

## Feasibility — hard ceilings vs a labour warning

One pure per-system, per-type computation (`computeBuildOptions`, `lib/engine/build-options.ts`) backs
the quick-add disabled state, the new-industry dialog's readout, and the order services' own
validation — the UI never learns a different truth than what the mutation will actually accept:

- **Space and deposit-slot ceilings are hard rejections everywhere** — the same physical checks the
  autonomic planner itself respects. A row/option at its ceiling reports `maxLevels: 0` with a `blocked`
  reason (`"no_space"` or `"no_deposit_slots"`).
- **The labour picture is a warning, never a block.** `labourAdded` (heads a level would draw, by grade)
  and `estStaffing` (staffing fraction estimated once one more level lands, min over the grades the type
  draws) are DATA — the ledger and Labour card already carry the staffing evidence in situ. The player
  may overbuild what their population can staff; staffing dilution and idle-decay punish that choice
  honestly. The autonomic planner protects the AI from this mistake by construction (it never proposes
  past spare labour); the player is allowed to make it.

ETAs are **queue-aware**: a hypothetical order joins the queue behind everything already committed
(exactly like a real fresh player row would), so the reported pulse count reflects where it would
actually land, not an isolated forecast.

---

## UI surfaces

- **Overview** — the vitals grid carries a **Construction** vital tile (open-project count, linking to
  the Industry tab) alongside Stability / Development / Population, on any developed system regardless
  of owner (parity with the old construction card, which always showed any faction's activity). A
  controlled, not-yet-developed player system's Overview instead renders the **colonisation founding
  entry**: the Establish-colony verb + preview, the forming colony hero-sized in the ghost grammar
  (cancellable when player-ordered), or the disabled verb with its blocking reason — this is the
  otherwise-inert undeveloped page's only live content.
- **Industry tab is the build surface.** In-flight builds render as **ghost rows inside the ledger group
  where they will land**: extractor orders in the deposit table (a single-type deposit's ghost sits under
  its one row; a multi-type deposit — e.g. arable → food + textiles — renders a shared aggregate parent
  row with per-type sub-rows below it, each carrying its own quick-add since the parent row's Slots
  column is the shared pool the sub-rows draw down), everything else under its **Housing / Academies /
  Specialisation / Production / Support** heading (a group with only ghosts still renders its heading). A
  ghost row: dim text, a ◇ amber glyph distinct from the health set (● stable / ▽ contracting / ▼
  collapsing), `+N` levels, a slim progress bar, ETA. Player-originated ghosts add a gold **ORDERED**
  badge + inline ✕. The quick-add `+` column and a **New industry** button in the health strip appear
  only on the player's own systems; a rival's developed system renders the same tab read-only, ghosts
  visible, no verbs.
- **Faction construction command card** is a command summary, not a per-project roll-up: the automation
  switch pair (player faction only), the pool with its base + Construction Centre composition, and two
  compact link lists — systems building (by project count) and colonies forming — every link landing on
  the system's Industry tab. Detail lives where the thing is built. AI faction pages show the pool + link
  lists with no switches.
- **The system/faction detail panel persists across selection** — switching which system or faction is
  open no longer remounts the drawer (no re-animation) and, for the system panel, the currently open
  sub-tab carries over onto the newly selected system where that tab still applies (Astrography always;
  any economy tab only if the target is developed), so panning the map between systems doesn't bounce you
  back to Overview each time.

---

## Concurrency (engineering note)

`runWorldTick` awaits only in-memory adapters (already-resolved promises resolve as microtasks), so the
event loop never reaches an HTTP handler mid-tick. Player-order mutation services therefore need no
mutex: they read and replace the in-memory world synchronously between ticks, and the open-project rows
they append are exactly what the next directed-build pulse funds. See the header comment in
`lib/services/construction-orders.ts`.

---

## What's next

The faction purse (treasury, budget bands, tax policy) and the alert feed are the remaining unbuilt
pieces of the player-seat phase — designed in
[player-seat-roadmap.md](../../planned/player-seat-roadmap.md), not yet implemented.
