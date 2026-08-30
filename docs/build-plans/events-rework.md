# Events rework — working file

## Idea

### Problem

The event system is trader-era decoration. Its 14 randomly-spawned types apply flat economy
modifiers (production/consumption rate multipliers, price-anchor shifts, supply/demand shocks —
`lib/constants/events.ts`) that expire on a timer, tie into no shipped mechanic, and offer the
player nothing to do about them. It is also the tick's worst scaler — its share of a mid-cycle
tick went 19.4% → 67.5% as everything around it was optimised (tick-speed audit figures, carried
on the roadmap events row). The one part that works is the relations-owned trio
(`border_conflict`, `pact_under_negotiation`, `alliance_dissolved`): spawned at weight 0 by the
relations processor from faction-pair scores, never by dice (`lib/constants/relations.ts:161-171`).

### Chosen direction

Strip now, prep the machinery, add content only when a mechanic earns it.

1. **Strip the random-modifier spawners** — every event whose topic is a fake version of
   something the sim produces or the queue is about to build for real: `supply_shortage`,
   `mining_boom`, `ore_glut`, `trade_festival`, `inner_system_conflict`, `conflict_spillover`,
   `pirate_raid`, `trade_embargo`, `refugee_crisis`, `tech_breakthrough`, `plague_risk`.
2. **Keep a lean exogenous core** — `solar_storm`, `asteroid_strike`, `plague` — and re-point
   their effects from rate multipliers to physical consequences (destroy stock, damage
   buildings, kill pops) so outcomes propagate through real mechanics instead of expiring.
   **Superseded by `## Spec`:** the owner's later call strips the three naturals as well
   ("strip them completely its simpler"); each returns via its own inclusion pass. The
   hazard-3 sweep rows below describing physical plague/asteroid effects belong to that later
   stage, not to this strip.
3. **The dice rule:** a small random roll is allowed, but frequency/severity must always carry a
   real modifier from world composition (asteroid events scale with a system's belt count) or
   player neglect (plague needs underfunded healthcare or a vulnerability to land), and
   mitigation must be buildable (orbital defenses, healthcare). RNG decides *when*; world state
   decides *how likely and how bad*; player investment decides *mitigation*.
4. **Entry bar for all future content:** an event cannot ship unless the mechanic that makes it
   preventable or exploitable is named and shipped.
5. **Generalise the relations pattern into arc plumbing** — any processor can open a weight-0,
   multi-phase arc with player-visible options. Strikes are the documented first client, written
   when a pressure mechanic ships (strike pressure is currently calm: 5.6% of colonies striking
   at full scale, a near-dead pop<10 cohort — roadmap strike-calm row).
6. **Decision popups** — center-screen choice moments, first clients the three relations arcs
   (they currently render in the same pill list as random plagues, so nothing reads as
   faction-related — `components/panels/faction-events.tsx`).
7. **Events never inject unrest or danger.** They create conditions (a shortage, a dead route,
   dead pops) and the unrest loop reacts.

### Killed alternatives

- **Fix processor performance standalone** — the model decision rewrites the processor anyway
  (was the roadmap perf row's own guidance).
- **Measure-first re-base of the coverage cap** — the cap dies with the model; owner call
  ("I just don't feel like we need a measure, the original events are from ages ago").
- **Keep the modifier events and retune them** — they are fake versions of mechanics the queue
  builds for real (shortages → markets, piracy → logistics, conflicts → war, refugees → pops).
- **Pure-dice natural events** — killed by the dice rule; even naturals get composition
  modifiers and buildable mitigation.
- **Build the strike arc now** — nothing applies pressure yet; a chain built today sits dormant
  (see the 5.6% figure above). Content waits; only the plumbing ships.

### Premises

**Definitional (owner decisions, this session, 2026-08-30):**
- "Make nearly all events preventable through good gameplay management … an event can't go in
  unless we add a mechanic that makes it interesting."
- "A tiny bit of dice rolling or very low chances [is fine], but then there should always be a
  real modifier that makes it meaningful like player neglect or world composition."
- "We can prep events, but … only add something that genuinely feels valuable right now to the
  existing mechanics."
- Relations arcs get expanded visibility, "maybe some of these events get center screen popups."

**Checkable (implementation gates, not direction inputs):**
- The stripped events are decoration, not load-bearing: the post-strip simulate stays on the
  health bar (no NaN/runaway/pinning, dispersion and liquidity intact) at both horizons.
- Saves in the wild hold active events of stripped types; the load path must handle them
  (verify by code read before the strip lands).
- The events processor's tick share drops materially post-strip (baseline: 67.5% of a mid-cycle
  tick; re-baseline in-run, percentages only).

**Hypothesis:**
- Belt count is already generated per system in a form asteroid frequency can read
  *(hypothesis — verify in `lib/world/gen.ts` at spec time)*.

### Terminal falsifier

If the post-strip `npm run simulate` at the 10,000-tick horizon shows a health-bar regression
attributable to event removal — dispersion collapse or price pinning that the pre-strip baseline
does not show — then the modifier events were load-bearing perturbation, and the strip cannot
ship without a replacement perturbation source. That kills "strip with no replacement", the
premise the whole sequencing stands on.

### Exit

No `/measure` stage: the direction replaces the system rather than resting on claims about its
current behaviour — the owner's explicit call, quoted above. Next stage is `/feature-spec` for
the strip + lean core + arc plumbing, drawing the hazard sweep from this file.

### Hazard-3 sweep (brainstorm depth)

| System | Interaction |
|---|---|
| Events | The change itself. |
| Population + migration | Plague re-pointed to kill pops physically; `refugee_crisis` deleted (migration is already mechanical one-hop diffusion). |
| Unrest / regime | Events stop being able to touch unrest directly (rule 7); removing supply shocks changes provision dips the strike loop reads. |
| Industry + staffing | Physical effects destroy stock/buildings; rate-multiplier removal changes production paths. Future mitigation buildings must be staffable. |
| Infrastructure decay | Mitigation infrastructure (defenses, healthcare) will decay like anything else — content-stage concern, none at strip stage. |
| Directed logistics | Supply-shock events deleted; events processor shares the per-tick `TickSystem` consumption with ship-arrivals (roadmap `toTickSystems` row). |
| Directed build / planner | None at strip stage — planner reads demand/supply, not event state. Mitigation buildings enter its ROI at content stage. |
| Colonisation + founding | None at strip stage; belt-count risk later makes system composition a colonisation consideration. |
| Treasury / purse | None at strip stage; "well-financed healthcare" implies a future budget category. |
| Factions + relations | Relations arcs kept, promoted to popups; relations processor untouched otherwise. |
| Save format (`World` shape) | Active events of deleted types exist in saves; `GameEvent`/phase shape changes with physical effects. Load path is a named gate. |
| Harness metrics | `lib/tick-harness/event-analysis.ts` and any event-count characterisation pins re-derive after the strip. |

## Spec

**What changes:** Random events stop happening entirely. The only events left in the galaxy are
the three diplomacy arcs factions create between themselves — a border conflict, a pact under
negotiation, an alliance dissolving — and everything about how they already behave is unchanged.
The economy stops receiving event shocks and modifiers except the border conflict's small
production dip. The machinery that runs event phases and applies modifiers stays alive
underneath, ready for future mechanic-owned arcs; the machinery that rolled dice to spawn events
is removed with the events that used it.

**Why:** From `## Idea`: the event system is trader-era decoration. Owner decisions this spec
encodes, quoted (session 2026-08-30):
- Strip scope: "yeah b let's just strip them completely its simpler" — option (b): the three
  naturals (solar_storm, asteroid_strike, plague) strip too; each returns via its own inclusion
  pass carrying its supporting mechanic. Until then the relations trio are the only live events.
- One at a time: "we also need to decide how to include each new event, probably one at a time
  so we can put in the right systems without rushing anything."
- Alerts: "we just strip them from alerts as well, its not a problem, might be a category worth
  keeping but that's it probs."
- Entry bar (from `## Idea`, definitional): "an event can't go in unless we add a mechanic that
  makes it interesting."

**Evidence:** No `/measure` stage — `## Idea` → Exit: "the direction replaces the system rather
than resting on claims about its current behaviour — the owner's explicit call." Readings this
spec rests on instead:
- Tick-cost share: events at 67.5% of a mid-cycle tick (tick-speed audit; in-process A/B only,
  percentages portable, absolute ms are not — carried on the roadmap events row).
- Code-map receipts gathered this session (Explore agent + `npm run impact`), cited inline below.

**Not claimed:**
- This spec does not design any future event — not the naturals' return, not the strike arc, not
  popups. Each is its own later spec under the entry bar.
- It does not fix the events adapter's copy-every-market-row-per-tick cost (roadmap: "Markets
  need a real dirty/ownership model") — the copy is load-bearing de-aliasing and stays.
- It does not remove the modifier plumbing (`anchorMult`/`productionMult`/`consumptionMult`
  fields and their 16-module read surface) — values collapse to neutral, fields stay (hazard 1
  below).
- The skimmer's wrong takeaway: "events were deleted." The arc machinery, the relations trio,
  and the modifier chain all survive; what died is random spawning and its content.

### Behaviour

**B1 — What stops.** The 14 spawnable event definitions are deleted, and with them the random
spawn path. Today the tick enters spawning every 5th tick (`lib/tick/processors/events.ts:286-287`,
`EVENT_SPAWN_INTERVAL` at `lib/constants/events.ts:84`) and picks by weighted random over
weight>0 definitions (`lib/engine/events.ts:252, 271-286`) under a coverage-derived global cap
(`maxEventsGlobal = round(totalSystems × 0.25)`, `lib/constants/events.ts:835`). All of it goes:
`selectEventsToSpawn`, spawn weights, cooldown ledger, `scaleEventCaps`, `EVENT_SPAWN_INTERVAL`,
`EVENT_COVERAGE_TARGET`, `MAX_EVENTS_PER_SYSTEM`, `MAX_EVENTS_GLOBAL` (already imported by
nothing — documentation-only per code map). Observable: a fresh galaxy runs indefinitely with
zero events until factions' relations cross the diplomacy thresholds. With `scaleEventCaps` gone,
the events stage sources `EVENT_DEFINITIONS` directly (`lib/world/tick.ts:1233` currently takes
`scaled.definitions` for both the adapter and the processor param).

**B1a — Events RNG stream separation, landed BEFORE the strip.** The tick creates one RNG stream
per tick (`tickRng(world.meta.seed, tick)`, `lib/world/tick.ts:1232`) shared by events (:1335),
directed-build (:1764) and relations (:2063); events draws from it on phase advances and spawn
ticks, and directed-build breaks colonisation-site ties with it
(`lib/engine/expansion.ts:122`). Removing event draws from a shared stream shifts every
downstream draw — including which system a faction colonises — so a same-seed pre/post
comparison would be confounded by RNG realignment, not just event removal. Therefore: events
gets its own derived stream (e.g. a distinct `tickRng` domain for the events processor only)
as the branch's first code change; the falsifier's pre-strip baseline is taken **after**
separation lands, so baseline and post-strip runs draw identically everywhere outside events.
The existing determinism test (`lib/world/__tests__/tick.test.ts:1567`) rides on stream-position
identity and re-derives against the split streams.

**B2 — What survives, unchanged.** The relations trio and their existing lifecycle:
- Spawned only by the relations processor from pair scores (`lib/engine/relations.ts:189, 214-219,
  235-239`; thresholds `lib/constants/relations.ts:161-171`).
- `pact_under_negotiation` / `alliance_dissolved` lifecycle stays relations-owned — the events
  processor skips them (`lib/tick/processors/events.ts:26-29, 126`).
- `border_conflict` keeps its three phases driven by the events processor's phase machinery
  (`lib/tick/processors/events.ts:116-146`, `checkPhaseTransition` at `lib/engine/events.ts:92-105`),
  and its skirmish phase keeps production ×0.9 via the surviving modifier chain
  (`lib/constants/events.ts:701-703` → `aggregateModifiers` `lib/engine/events.ts:158-184` →
  `resolveMarketTickEntry` `lib/engine/market-tick-builder.ts:70` → economy row writes
  `lib/tick/processors/economy.ts:187, 198`).
- The faction-diplomacy panel surface survives intact (`components/panels/faction-diplomacy.tsx:184-215`).

**B3 — Stranded machinery removed with its last client.** Deleted because no surviving
definition uses it and future events arrive by redesign, not by reuse (AGENTS.md: clean up what
the change strands):
- Spread: `SpreadRule` (`lib/constants/events.ts:48-56`), `evaluateSpreadTargets`
  (`lib/engine/events.ts:367-434`), the processor's spread pass
  (`lib/tick/processors/events.ts:195-275`). No surviving definition has spread rules.
- Shocks: `ShockTemplate` (`lib/constants/events.ts:39-46`), `buildShocksForPhase`
  (`lib/engine/events.ts:328-346`), `expandShocks` + apply sites
  (`lib/tick/processors/events.ts:79-88, 173, 257, 325`), `applyShocks`
  (`lib/tick/adapters/memory/events.ts:169-209`). No surviving definition has shocks; the
  physical-effects direction supersedes stock-delta shocks.
- The `equilibrium_shift` modifier type — already dead today: `aggregateModifiers` matches only
  `anchor_shift` and the two rate parameters (`lib/engine/events.ts:172-175`); nothing produces it.
- The event notification channel: `EventNotificationPayload` emission
  (`lib/tick/processors/events.ts:132-137, 179-187, 262-268, 333-339`) has **zero subscribers**
  today (`lib/hooks/use-tick.ts:78` is the only reference; the toast/activity surfaces
  `docs/active/gameplay/events.md:79` claims do not exist), and no surviving definition carries a
  `notification` string.
- The dev event spawner, whole vertical: `components/dev-tools/event-spawner-section.tsx`,
  `lib/hooks/use-dev-tools.ts:112`, `client/worker/dev-commands.ts:30, 60-73`,
  `lib/services/dev-tools.ts:54-110`. Post-strip it could only offer the trio, and a dev-spawned
  relations event is already dropped by the tick (`metadata: null` at `lib/services/dev-tools.ts:90`
  vs the ownership check at `lib/world/tick.ts:2059`, pinned by
  `lib/world/__tests__/tick-events-modifiers.test.ts:128-138`) — the surface becomes vacuous.
- Spawner-only definition fields: `EventDefinition.weight`, `.cooldown`, `.maxActive`,
  `.targetFilter` and `EventPhaseDefinition.notification` (`lib/constants/events.ts:52-56, 72-76`)
  lose every reader with `selectEventsToSpawn` / `evaluateSpreadTargets` / `scaleEventCaps`
  (readers at `lib/engine/events.ts:252-262, 402-404`; notification only at the deleted emission
  sites) — removed from the interfaces and from the three surviving definitions.
- `resetEconomy`'s event arm (`lib/services/dev-tools.ts:171-203`): post-strip it could only
  delete relations-owned events, and deleting an active `pact_under_negotiation` while a pair is
  parked above +75 permanently blocks that alliance — the spawn condition requires a fresh
  threshold *crossing* (`pair.score < negotiationThreshold` before,
  `lib/tick/processors/relations.ts:146-152`), which a parked pair never produces again. The
  command stops clearing `events`/`modifiers` (relations owns that lifecycle; modifiers are
  rebuilt from active events every tick, `lib/world/tick.ts:1170-1185`), `eventsCleared` drops
  from `DevCommandMap["resetEconomy"]` (`client/worker/dev-commands.ts:34`), and the function's
  anchor-mult docstring (:162-168) is re-authored — it describes the events-as-economy-modifiers
  world this spec ends.

**B4 — Save format.** `SAVE_FORMAT_VERSION` bumps 16 → 17 (`lib/world/save.ts:36`). Nothing
validates `event.type` on load (`deserialiseWorld` checks only version + shape,
`lib/world/save.ts:74-94, 145-174`; `toEventTypeId` has zero callers), and a stale type crashes
the alert bar on first render — `EVENT_DEFINITIONS[event.type]` then `.phases` unguarded at
`lib/services/alerts.ts:633-639`, likewise `compareEventSeverity` (`lib/constants/ui.ts:174-179`).
The bump makes old saves refuse loudly instead. Edge case covered: a save captured mid-arc with a
stripped event active cannot reach the new code. The same bump also covers the changed
`world.player.alertCategories` key set (B5) — no per-key save migration is needed.

**B5 — Alert bar: pure removal.** The three event alert categories (crisis / disruption /
windfall) are removed with no replacement (owner call at review triage, on the
minimum-investment principle for the trio — a Diplomacy category would mean authoring tiers and
orderings for events that faction mechanics will supersede). Events surface only in the
faction-diplomacy panel and the simplified faction-events list (B6). The full removal surface —
the category set is persisted state, not just UI:
- `lib/types/alerts.ts` — `ALERT_CATEGORY_IDS` 16 → 13 members; the "sixteen" docstrings there
  (:44) and at `lib/constants/alerts.ts:30` update; `AlertCategorySettings` is stored on
  `WorldPlayer` (`lib/world/types.ts:68`, seeded `lib/world/gen.ts:228`) so the key-set change
  rides the B4 version bump.
- `lib/constants/alerts.ts` — the three category entries go; `crisis` leaves the non-hideable
  critical tier, shrinking the tested membership (`lib/constants/__tests__/attention.test.ts:27-31`).
- `lib/constants/attention.ts` — `DEFAULT_ALERT_CATEGORIES` drops three keys (:31, :41, :45).
- Write boundary needs no logic change — `z.enum(ALERT_CATEGORY_IDS)`
  (`lib/schemas/player-settings.ts:15`) shrinks with the array.
- Stranded with the categories and deleted: the `{ kind: "events" }` `AlertDestination` variant
  (`lib/types/alerts.ts:72`) and its switch arms (`components/alerts/alert-chip.tsx:73-74`,
  `alert-flyout.tsx:38, 88-93`), `EventAlertCategory` / `unit: "events"` / `toEventCategory` and
  the category builders (`lib/services/alerts.ts:254-258, 607-663`), and `EVENT_BAND` +
  `EVENT_BAND_ORDER` + `compareEventSeverity` (`lib/constants/ui.ts:131-179`) — the comparator's
  last caller is the faction-events severity sort, which B6 removes.
- Tests riding this: `attention.test.ts`, `alert-run.test.tsx`, `alert-settings.test.tsx`,
  `lib/constants/__tests__/ui.test.ts` (the band table's test).

**B6 — UI prunes.** The badge-colour and icon maps in `lib/constants/ui.ts` (:42-63, :86-110)
prune to the trio — the compiler forces this; the band map deletes with the alert categories
(B5). `getActiveEvents` drops `systemId: null` events (`lib/services/events.ts:17`), so of the
trio only `border_conflict` ever reaches the per-system and galaxy-feed surfaces — the diplomacy
pair render only in faction-diplomacy. Consequences taken explicitly rather than by mechanical
prune:
- `components/panels/faction-events.tsx` becomes a plain list: the filter bar (:17-24),
  `TYPE_CATEGORY` (:32-50) and the Severity sort option (:28, :56) are **removed**, not pruned —
  a two-chip filter over one reachable category and a comparator that returns 0 for every pair
  are dead controls (owner call: keep the panel, minimum investment, no fold into
  faction-diplomacy).
- `EVENT_TYPE_IDS` (`lib/constants/events.ts:783-790`) is deleted — post-strip it duplicates
  `RELATIONS_EVENT_TYPES` (:791-795) byte for byte, and its only surviving reader is
  `lib/constants/__tests__/ui.test.ts`, which re-points to `RELATIONS_EVENT_TYPES` (the name
  with the live tick reader, `lib/world/tick.ts:1154`).
- Two of border_conflict's three phases carry no modifiers, so `summarisePhaseEffects` returns
  its `"Minor market effects"` fallback for them (`lib/utils/event-effects.ts:44`) — the strip
  makes the fallback the common case, so those phases get honest `/game-copy` text.
- The per-system Active Events section needs no change (renders null when empty,
  `components/events/active-events-section.tsx:13`).

**B7 — Docs lifecycle, on this branch.** `docs/active/gameplay/events.md` is rewritten in
present tense around the surviving system (it is stale today: claims spawn "every 20 ticks" vs
code's 5, caps 15/2 vs derived `systems×0.25`/3, and toast + map-marker surfaces that do not
exist — `docs/active/gameplay/events.md:38-40, 76-83`). `docs/active/gameplay/event-catalog.md`
is rewritten around the trio (it documents none of them today). `docs/planned/event-ideas.md` is
deleted — its arcs are random-modifier events the entry bar now forbids; before deletion its
"Event Engine Mechanics" list (permanent phases, branching successors, player-triggered events)
is folded into this working file as arc-plumbing candidates for the inclusion passes.
`docs/SPEC.md` is updated on this branch: the Events section (:68-69) rewritten around the
relations trio and the surviving phase/modifier machinery; the alert-bar sentence (:96 — "Sixteen
categories … three valence-banded event categories") and the authored valence/impact-rank table
mention (:184) reconciled with B5; the Events → Economy interaction edge (:175) narrowed to
border_conflict's skirmish production dip; the event-modifier and event-targeting clauses at
:25, :40 and :46 corrected. `lib/engine/economy-type.ts:6-9`'s docstring drops its
event-targeting claim ("AND event targeting reads it") — both readers of
`targetFilter.economyTypes` die with the spawner — as does the same claim at `docs/SPEC.md:40`.

**B8 — Tests.** Known breakage, each rewritten against the surviving system and red-proofed:
`lib/constants/__tests__/ui.test.ts:33-118` (transcribes all 17 types),
`lib/constants/__tests__/band-constants.test.ts:336-359` (builds its scenario from
`solar_storm` phases — retype onto a synthetic definition),
`lib/world/__tests__/tick-events-modifiers.test.ts` fixtures (use `inner_system_conflict` —
retype onto `border_conflict`), `lib/services/__tests__/dev-tools.test.ts:29-84` (dev spawner
deleted with its tests). Three more files ride the strip:
`lib/tick/processors/__tests__/events.test.ts` — the spawn/spread/shock/notification tests and
the whole `InMemoryEventsWorld.applyShocks` block (:303-435) delete with their subjects; the
phase-transition (:150) and relations-lifecycle (:217) tests retype onto `border_conflict`.
`lib/tick/__tests__/helpers.test.ts:28-35` — the `eventNotifications` merge assertion retypes
onto a surviving channel. `lib/utils/__tests__/event-effects.test.ts:130-140` — the
`equilibrium_shift` legacy-tolerance case deletes with the union member (it stops compiling).
The consumption-modifier tripwire
(`lib/tick-harness/__tests__/population-analysis.test.ts:744-759`) passes unchanged.

**B9 — Harness.** `lib/tick-harness/event-analysis.ts` and the simulate Event Impact table stay
(border_conflict remains measurable; the empty case already prints "no events occurred",
`scripts/simulate.ts:957-958`). The sim gate for this PR: `npm run simulate` at both horizons,
pre- and post-strip on the same seed, **with the pre-strip baseline taken after B1a's stream
separation lands** — without it the comparison is confounded (B1a). The tick-share premise from
`## Idea` ("drops materially from 67.5%") is an expected observation, not a gate: `npm run
simulate` reports economy metrics and cannot measure processor share, the 67.5% was never
decomposed into spawn-path cost versus the retained market-row copy
(`lib/tick/adapters/memory/events.ts:49`), and no target number was authored. If a share figure
is wanted post-strip it comes from the tick-profile instrument at its own scale, as its own
follow-up — not from this PR's gate.

### Hazard worksheet

**1. One quantity, several jobs** — quantities this design moves:

| Quantity | Readers today | Which move | Intended? |
|---|---|---|---|
| `EVENT_DEFINITIONS` | 16 refs / 6 modules outside tick (impact run pasted below) + tick + harness | All — the Record shrinks to the trio | Yes; every module pruned in this PR |
| `anchorMult` | 46 refs / 16 modules (impact run: events, industry, market-pricing, market-tick-builder, supply-chain, tick, economy, good-market-state, directed-logistics-world, economy-world, markets, world/types, dev-tools, market-entry, market, system-industry-readout) | Value only: no surviving producer ≠ 1 | Yes — **deliberately kept coupled**: fields and all readers stay, the strip removes producers, value rests at neutral 1. Removing the plumbing would churn 16 modules and break falsifier attribution |
| `productionMult` | 18 refs / 9 modules (impact run) | Value: only producer left is border_conflict skirmish ×0.9 | Yes — same posture as anchorMult |
| `consumptionMult` | same chain | No surviving producer ≠ 1 (tripwire test already asserts no shipped definition carries one) | Yes — same posture |
| `economyType` | Derivation `lib/engine/economy-type.ts`; readers: UI badges, `Region.dominantEconomy`, and event targeting via `targetFilter.economyTypes` (`lib/engine/events.ts:256, 402`) | The event-targeting reader is deleted | Yes — economyType becomes display + region-label only; its docstring's "not display-only … event targeting reads it" claim updates (B7) |

`npm run impact -- EVENT_DEFINITIONS` (key excerpt): outside-tick readers
`event-spawner-section.tsx:9,28` · `faction-diplomacy.tsx:15,185` · `alerts.ts:63,633` ·
`dev-tools.ts:8,65` · `events.ts:3,19`; harness `population-analysis.ts:10,195`; "ALSO TOUCHED BY —
processors that do not declare it: events (2/9)". Verdict: SHARED, hazard 1 applies — per-module
disposition is the table above plus B3/B5/B6.

**2. Constant read against its docstring:**

| Constant | Docstring says | Used as | Same? |
|---|---|---|---|
| `EVENT_COVERAGE_TARGET` | "Target fraction of systems with active events. Used to scale caps by universe size." (`lib/constants/events.ts:95-96`) | Deleted with the spawner it scales | Yes — dies with its purpose |
| `MAX_EVENTS_GLOBAL` | "Base max concurrent events globally (for 600 systems)" (`:89-93`) | Documentation-only; nothing imports it (code map) | Already dead; deleted |
| `RELATIONS_PHASE_SENTINEL` | Finite sentinel because `Infinity` corrupts JSON saves (`lib/constants/relations.ts:190-200`) | Untouched | Yes |

**3. System sweep:**

| System | Interaction |
|---|---|
| Events | The change itself. |
| Population + migration | None mechanical — no surviving event touches pops; plague's effects were economy modifiers only (`ModifierTemplate.domain` is `"economy"`, `lib/constants/events.ts:30-37`). |
| Unrest / regime | Indirect only: stripped supply shocks stop perturbing stock (`applyShocks` moved `market.stock`, `lib/tick/adapters/memory/events.ts:195`), so provision dips the strike loop reads get calmer. Falsifier's sim gate covers it. |
| Industry + staffing | Value-level only: `productionMult` rests at 1 except border_conflict skirmish (B2). No building/staffing surface touched. |
| Infrastructure decay | None — no decay reader appears among event consumers (code map §8). |
| Directed logistics | Value-level via `anchorMult` in `logisticsTarget`/`donorReserve` (`lib/tick/processors/good-market-state.ts:147-177`): rests at neutral 1 post-strip. Fields kept (hazard 1). |
| Directed build / planner | Value-level only — the build input-supply gate reads `donorReserve`, which rides `anchorMult` (`lib/engine/directed-build.ts:52-55`; produced at `lib/tick/processors/good-market-state.ts:177`); no surviving producer moves `anchorMult` off 1, so the gate reads its neutral value. No event *state* is read. |
| Colonisation + founding | Same as the planner row — the founding manifest's supply gate rides the same `donorReserve`/`anchorMult` quantity at its neutral value. No event state in founding paths. |
| Worker snapshot / runtime | `lib/runtime/snapshot.ts:127, 267` publishes `getActiveEvents()` each frame; post-strip the slice carries border_conflict only. No shape change; the slice stays. |
| Treasury / purse | None — events never touched money (`ModifierTemplate.domain` is `"economy"` rates/anchors only). |
| Factions + relations | Trio preserved bit-for-bit (B2); relations processor untouched. |
| Save format (`World` shape) | `WorldEvent.type` union shrinks; version bump 16→17 (B4). `World.modifiers` shape unchanged. |
| Harness metrics | Event Impact table near-empties by design (B9); `population-analysis.ts:356` consumptionMult derivation returns 1 — unchanged behaviour, already asserted by its tripwire test. |

**4. Claims carried with evidence:**

| Claim | Evidence | Horizon/Cohort |
|---|---|---|
| Events = 67.5% of a mid-cycle tick | Tick-speed audit, carried on roadmap events row | 2,400-system profile run; percentages portable, ms not |
| Stale save type crashes alert bar | `lib/services/alerts.ts:633-639` unguarded deref | Code read, this session |
| Notification channel has no subscriber | `lib/hooks/use-tick.ts:78` is the only reference repo-wide | Code read, this session |
| Diplomacy pair invisible on event surfaces | `lib/services/events.ts:17` drops `systemId: null` | Code read, this session |
| `equilibrium_shift` produced/consumed by nothing | `lib/engine/events.ts:172-175` matches only the other two | Code read, this session |
| events.md spawn figures stale | doc says interval 20 / caps 15/2; code says 5 (`lib/constants/events.ts:84`) / `systems×0.25` (`:835`) / 3 (`:87`) | Code read, this session |

**5. Consumed signals exist:** the spec consumes nothing new. The one surviving dependency —
border_conflict's phase lifecycle — is produced today at `lib/tick/processors/events.ts:116-146`
with `RELATIONS_OWNED_LIFECYCLE` deliberately excluding it (`:22-29`), verified this session.

**6. Aggregates the falsifier reads:** dispersion and liquidity from `npm run simulate`, read
per market-role cohort at both horizons, same seed pre/post. What else moves them: **the shared
per-tick RNG stream** — events, directed-build and relations all draw from one `tickRng`
instance (`lib/world/tick.ts:1232, 1335, 1764, 2063`), and directed-build's colonisation-site
tie-break consumes it (`lib/engine/expansion.ts:122`), so removing event draws would shift
cohort mix itself. B1a removes this confound: events gets its own stream first, the baseline is
taken after separation, and only then is event removal the sole delta source between the runs.

### Falsifier (provenance: committed at 1316c430, moved here unedited)

If the post-strip `npm run simulate` at the 10,000-tick horizon shows a health-bar regression
attributable to event removal — dispersion collapse or price pinning that the pre-strip baseline
does not show — then the modifier events were load-bearing perturbation, and the strip cannot
ship without a replacement perturbation source. That kills "strip with no replacement", the
premise the whole sequencing stands on.

### Exit

Cross-mechanic surface — the strip touches the events, economy and relations processors' shared
data, the tick body, the save format, and shared modifier fields with a 16-module read surface.
**→ `/spec-review` is mandatory before any build plan.**
