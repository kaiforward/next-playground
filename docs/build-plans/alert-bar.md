# Alert bar

Working file for the attention layer's second surface. Accretes `## Idea` → `## Evidence` → spec →
build plan, and is deleted when the feature ships.

Prototype: [alert-bar-prototype.html](./alert-bar-prototype.html) — open it in a browser.

## Idea

A top-of-screen bar of alert categories, each a **condition** that exists only while it is true and
disappears when it is fixed. The counterpart to the Tracker, which holds *things*. The design was
settled with the owner on 2026-08-12 before any spec; the reasoning, the genre research and the four
principles live in memory `design-attention-layer-inputs`, and the one-line version is roadmap row 1.

The three settled claims this file builds on, restated so nothing is re-litigated:

- **Ranking is by authored category tier, never a computed cross-domain score.** Categories sit in
  critical / important / informational; instances sort only *within* a category, by that category's
  own natural measure. This is what dissolves the housing-has-no-ROI problem.
- **Opportunities and decisions belong on the bar, not only faults** — gated on the existing
  automation switch. Automation on means the planner's proposals are already being acted on, so only
  *blocked* intent surfaces; automation off means the ranked proposal list becomes the opportunities.
- **The per-category settings screen is load-bearing, not polish** — a checkbox per category plus a
  small non-hideable tier.

Absorbed here: the 12 event types plus the 3 relations-owned ones, which become alert categories
rather than the separate dismissible feed that was considered and dropped.

## Settled so far

- **There is no bar.** The chip run floats over the top of the map, inset to exactly the span between
  the system drawer and the Tracker rail, with the settings control as its last item. Nothing reserves
  layout height, so the surface costs nothing on a quiet galaxy, and the run's height is a property of
  the chips rather than of a band they sit inside. A backing panel behind just the run is optional and
  undecided; the chips are opaque and legible over the map without one.
- **The inset is fixed to the two panel widths, not to whether a panel is open.** That is what stops
  the chips reflowing every time the player clicks a system — the objection that killed a floating run
  the first time it was considered.
- **The span is also what keeps a flyout anchored under its own chip and off both panels.** Sliding a
  popover away from its trigger to dodge a panel was rejected outright: some alerts will open the
  system panel directly, so a popover that both drifts from its chip and covers the thing it acts on
  is the wrong trade.
- **A full-width bar was built first and dropped.** It worked, but it reserved map height permanently
  — including on a quiet galaxy with nothing to say — and its own inner container was already inset to
  this same span, which is the tell that the shell was doing nothing the run wasn't. **Consequence to
  book:** the faction name and flag were going to live in that bar's left block, and now need another
  home.
- **Chips are icon-plus-count, not labelled**, at **20px** icons, with chip height derived from that
  figure rather than set independently.
- **The run is inset 8px** from both panels and from the top of the map, and carries **no backing
  panel** — the chips are opaque and read over the map on their own.
  **This moves the Tracker.** Its rail is 16px today (`inset-y-4 right-4`,
  `components/map/map-right-rail.tsx:68`); it goes to 8px so the two surfaces line up, rather than the
  run being drawn out of step with it. That file is in this feature's diff.
- **The fault slash is cased** — a second line in the chip's own background colour, offset up and
  right, drawn under the slash. It carves a gap out of whatever the slash crosses so the negation
  reads as a negation rather than as one more stroke on a busy glyph.
- **Packing is adaptive, in four steps**, measured at render rather than assumed: chips are **spaced**
  while the run fits; **overlapped** at −8px EU5-style once it doesn't; **tightened** as far as −16px
  before anything is given up; and only then does the tail collapse into a `+N` chip. Overflow is a
  last resort that should never fire at ordinary widths, rather than the first answer.
- **The overlap forces one thing:** chip fills must be **opaque** — the tier colour mixed into a
  surface, not into transparency — or overlapping chips show through each other, and over a live map
  they would show the map through too. Each is shadowed rightward, the leftmost (most severe) sits on
  top, and hovering raises a chip clear of the stack.
- **Wrapping and scrolling were not taken.** A wrapped second row grows the run downward over the map
  mid-game; a scrolling run hides alerts behind a gesture on a surface whose whole job is to be
  glanceable. Compression degrades more gracefully than either.
- **Chips inside the existing top bar** was killed by arithmetic: ~5 chips against fifteen
  categories, and that space is already promised to treasury readouts.
- **Empty space inside the run passes clicks through to the map.** Only the chips take pointer events,
  the same rule the Tracker's rail already follows.

## Draft category and tier list

First cut. `Ships today` = a read exists and something renders it. `Derivable` = the data is in world
state but nothing computes this shape of it. `New` = the engine throws the fact away today.

Icons are real lucide 0.577 glyphs, checked against the installed package. `Crosshair`,
`TriangleAlert` and `Sparkles` are **reused** from `EVENT_TYPE_ICON` (`lib/constants/ui.ts:117`), so
the bar inherits vocabulary the events screen already teaches, and the event flyouts carry each
event's own icon from that same map. Where lucide has no negated variant — there is no `FactoryOff`
or `GlobeOff` — the glyph carries a **fault slash**: the corner-to-corner line lucide's own `-off`
icons use, drawn over the plain subject glyph and cased so it survives a busy one.

| Tier | Category | Icon | Condition, and its sort measure | Data |
|---|---|---|---|---|
| critical | Famine | `WheatOff` | Survival-good shortfall. Sorts by shortfall depth. | Ships today |
| critical | Colony dying | `Globe` + slash | Famine world whose population is **shrinking** toward `ABANDON_POP_FLOOR`. Sorts by cycles to the floor. Needs the per-cycle population delta persisted — see below. | New (small) |
| critical | Strike | `Megaphone` | Unrest past the strike threshold. Sorts by suppression. | Ships today |
| critical | Maintenance unfunded | `BanknoteX` | Settlement could not pay the maintenance band — the only path into destructive decay. One faction-level row. | Ships today |
| critical | **Crisis** | `Siren` | Events that can break a world — plague, raid, asteroid strike, inner-system conflict, border conflict. Sorts by phase severity. | Needs banding |
| important | Deprived worlds | `BatteryLow` | Provision in the Deprived band. Sorts by Provision ascending. | Ships today |
| important | Unrest rising | `TrendingUp` | Provision below the expectation the population is used to, not yet striking. Sorts by grievance depth. | Ships today |
| important | Demand unservable | `RouteOff` | A deficit no reachable donor and no local production can close. Sorts by unserved demand rate. | New |
| important | Overcrowded | `BedDouble` | Over `popCap` **and** no habitable headroom for another housing level (`habitableHousingHeadroom < 1`). Sorts by population over cap. **Defaults off**: 0.4% of developed systems during expansion, 97.3% at build-out — useful exactly while there is still land to develop. | Derivable |
| important | Build blocked | `HardHat` + slash | The planner wanted to build and could not — no land, no spare labour, no affordable whole level. Sorts by the ROI of what was dropped. **Defaults off**: measured at 50.4% of developed systems per planner run, not rare. | New |
| important | Industry idle | `Factory` + slash | Built capacity not running — no skill licence, missing inputs, no staff. Sorts by idle share. | Ships today |
| important | **Disruption** | `TriangleAlert` — reused | Events that cost but do not threaten — shortage, storm, embargo, glut, a dissolved alliance. Sorts by phase severity. | Needs banding |
| info | Build opportunity | `HardHat` | Ranked planner proposals, **only while build automation is off**. Sorts by ROI. | Ships today |
| info | Colony opportunity | `Globe` | Eligible controlled systems, **only while colonisation automation is off**. Sorts by colony ROI. | Ships today |
| info | **Windfall** | `Sparkles` — reused | Events worth riding — trade festival, mining boom, tech breakthrough, a pact opening. Sorts by phases remaining. | Needs banding |

**Discrete events are separate from the conditions, and split three ways by authored valence** —
`Crisis` (critical), `Disruption` (important), `Windfall` (info). The rest of the bar is standing
system warnings and opportunities, things that are *true* until fixed; an event is a happening with
phases and an end. Giving each of the fifteen kinds its own chip made the bar mostly weather report,
but one chip for all of them buried a plague next to a trade festival.

Three bands is the resolution, and it keeps the tier rule intact: each event **type** is banded at
authoring time, so an event chip's tier is authored exactly like every other category's. It also
dissolves the question of whether a merged Events chip should colour itself by its worst member — the
split does that work at design time instead of at runtime.

**The banding is new authoring, not a read of existing data.** `EventDefinition` carries no severity
or valence: its `severity` field is a child-event spawn multiplier and `weight` is spawn frequency
(`lib/constants/events.ts`). The band is a new per-type field, or a lookup beside `EVENT_TYPE_ICON`
in `lib/constants/ui.ts:117`.

This does not reopen the dropped third surface: three chips on the same bar, ranked in the same tier
order, not a parallel scrolling list, and nothing about them is dismissible. That is the line to hold
— an event flyout that grows dismissal, its own settings, or a persistent unread count has become the
feed that was rejected.

**`border_conflict` folds into `Crisis`** — settled, after checking what it actually is. There is no
war state in the codebase: every `war` identifier is a comment, a fog-of-war name, or a note about a
future layer. `border_conflict` is purely an event, spawned by the relations processor when a pair
drops to ≤-25 and handed to the events processor for its three-phase lifecycle
(`lib/tick/processors/relations.ts:34-37`). An event belongs in an event band, and `Crisis` is
critical and non-hideable, so nothing is buried by putting it there.

**A dedicated war category is designed when war ships, not now.** The diplomacy and war layers are
unbuilt, so authoring a category against them would be guessing at a shape. The bar's non-hideable
critical tier is where it lands when there is something to put in it. The same caution applies to the
whole political side of this list: the economy is what has actually been built, and every category
above reads economic or population state except this one.

**Two glyph pairs came out of this**, and they are the clearest thing on the bar: `Globe` plain is a
colony you could found, `Globe` slashed is one dying; `HardHat` plain is a build you could order,
`HardHat` slashed is one that could not happen. Same subject, faulted and not, in different tiers.

**`Construction` was rejected for Build blocked** and `HardHat` taken instead. That glyph is already
three diagonal strokes, so even a cased fourth diagonal reads as more barrier hatching rather than as
a negation, while a clean dome takes a slash unambiguously. Judged side by side in the prototype, both
treatments, before deciding.

**One glyph is still weak: Unrest rising.** It has no subject icon to slash — `Megaphone` is the
strike and `Flame` belongs to `asteroid_strike` — so it falls back to a bare `TrendingUp`, which says
something is climbing but not what. A second overlay type (a rising marker over a subject glyph) would
fix it at the cost of a second visual convention to learn. Not decided.

**Custom icons are a live possibility** for this project rather than a rejected one. The lucide set
plus the cased slash covers fourteen of the fifteen; a dedicated set would be a later pass, and
nothing here forecloses it.

Two of the three `New` rows are the reads roadmap row 1 named by name (Overcrowded is `Derivable`
rather than `New` — the per-system figure exists at `lib/services/tracker.ts:60`, what is missing is a
faction-wide read of it). `Build blocked` is genuinely new instrumentation: the drop is a bare
`continue` at `lib/engine/directed-build.ts:824` with no reason recorded anywhere.

## Settings, and what defaults off

A per-category settings panel, opened from the control at the end of the chip run and following the
Tracker's pattern: a checkbox per category, grouped by tier, persisted in the browser as a view preference
rather than in the save. The two `info` groups additionally only ever appear while their domain's
automation is off, so they self-gate on top of the checkbox.

**The critical tier cannot be turned off.** That is the small non-hideable set the design promised —
nothing that can end a colony or start a war is switched off by accident. Five categories, locked on.

**Four important-tier categories default to OFF.** The list below is the *measured* one — the guesses
it started from were right about three of five and wrong about two, which is why it was measured:

| Category | Default | Measured rate (startup → equilibrium) | Why |
|---|---|---|---|
| Deprived worlds | **ON** | 0.4% → 0.0% | Measured rare, so it is a real signal rather than noise. The guess that it was common was wrong. |
| Unrest rising | OFF | 13.8% → 22.3% | Common, and an early warning for a state Strike already announces loudly. |
| Overcrowded | **ON** | 0.4% during expansion | Rare and actionable while there is land to develop. Its build-out saturation is the space problem, not an alert problem, so the default is not set against it. |
| Industry idle | OFF | 2.0% → 34.5% | EU5's single most-hidden alert, and often genuinely unfixable. |
| Build blocked | OFF | 50.4% of developed systems per planner run | "Rare by construction" measured false at 2.5× its falsifier. |

This is the same posture the opportunity categories already take with the automation switch: with a
domain automated the player is not told what the brain is handling, only what it *could not* do. A
player who wants to min-max turns them on.

**It also changes what the volume measurement is for.** The question stops being "does this category
survive the tier list" and becomes "does it default on or off", which is a far lower bar — a category
measured as continuously true across dozens of systems is a default-off category, not a deleted one.
The measurement is still owed; it is no longer a gate on the spec being written.

**Popover bodies are deliberately thin:** a list of the affected systems, sorted by the category's own
measure, and nothing else. A row navigates; richer bodies are a later pass.

## Specification

### What it is

A run of small chips across the top of the map, each one a kind of trouble or opportunity that is
**true right now**. A chip appears when at least one system meets its condition, carries the count of
systems that do, and disappears when the last of them stops. Clicking a chip opens the list of systems
affected, worst first; clicking a row goes there.

That is the whole contract, and the sentence that decides every argument about it: **fixing the
condition makes the row go away**. A row the player can look at but never clear does not belong here.

The Tracker, beside it, holds the opposite kind of thing — worlds and projects the player is watching,
which stay in the list whether or not anything is wrong. Nothing appears on both.

### The rule that decides what belongs

An alert-bar row is a **condition**: it exists only while true. A Tracker row is a **thing**: it
persists regardless. Everything condition-shaped belongs here, everything thing-shaped there, and the
split is exhaustive — there is no third surface, and a dismissible event log was considered and
dropped precisely so there is only ever one place that says "look at this".

Two consequences follow. The game decides what is on the alert bar, so the player needs a way to turn
categories off; the player decides what is in the Tracker, so it needs a pin control instead. And
because a condition clears itself, **nothing on this bar is dismissible** — dismissing a state that is
still true is the genre failure the whole design exists to avoid.

### Placement and behaviour

The chips float over the top of the map, inset 8px from the system drawer on the left, the Tracker
rail on the right, and the top of the map. Nothing reserves layout height: on a galaxy with no live
conditions and no automation switched off, the surface is not there at all. Empty space in the run
passes clicks through to the map; only the chips themselves are interactive.

The inset is fixed to the two panel widths whether or not a panel is open, so the run never reflows
when the player clicks a system.

Chips are ordered by their category's authored tier — critical, then important, then informational —
with a hairline separator between tiers. Within a tier the order is authored too, and stable: a chip
never moves because its count changed.

**Packing adapts to the space, in four steps.** Chips sit spaced while the run fits; overlap by 8px
once it does not, each casting a shadow rightward with the leftmost on top and the hovered one raised
clear; tighten as far as 16px of overlap before anything is given up; and only past that does the tail
collapse into a `+N` chip. Overflow is a last resort, not the first answer, and at ordinary widths it
does not fire. Chip fills are opaque so overlapping chips do not show each other — or the live map —
through.

### The categories

Fifteen, in the table above. Each is authored into one of three tiers at design time. **There is no
computed cross-domain score anywhere in this design**: instances sort only *within* their category, by
that category's own natural measure, and categories sort only by their authored tier. This is what
lets housing — which carries no ROI value at all — sit on the same bar as an industry proposal without
inventing a weight to compare them.

Discrete events are three categories banded by authored valence rather than one chip or fifteen:
Crisis, Disruption, Windfall. Each event type is banded at authoring time, so an event chip's tier is
authored exactly as every other category's is.

### The flyout

Clicking a chip opens a panel beneath it, anchored under that chip. It carries the category's name and
icon, one line saying what the condition is, the affected systems in the category's own sort order,
and a footer carrying the total count.

**The flyout holds the whole list.** It grows to fit its rows, up to the height of the map area, and
scrolls inside past that. There is no row cap and no second home for the overflow: a category's
instances live in one place, in one order. Some categories will be long — Build blocked measured at
50.4% of developed systems — and a long list is the honest shape of a common condition rather than a
reason to split the surface. Both reference games run popovers to nearly full screen height for
exactly this, and Build blocked among others defaults off, so the long lists are opt-in.

Nothing is gained by a filter or a second sort here: instances sort only by the category's own measure,
so the scroll is the whole feature.

### What a row click does

**Every row does the same thing: fly the map to the system and open the destination tab**, reusing the
Tracker's focus mechanism (`components/tracker/tracker-panel.tsx:120`). The only per-category variation
is which tab, authored beside the category's tier and icon.

A row never applies an action in place. The bar's contract is that fixing the condition makes the row
go away, so a click that both acts and clears the row is indistinguishable from dismissal — the one
gesture this design does not have. EU5 can afford click-fires-an-effect only because right-click
dismisses sits beside it to disambiguate. The pull is strongest on the two opportunity categories, and
weakest on inspection: their proposals are already ranked on the system's own construction surface, so
navigating there *is* the apply flow, with the ROI context the decision needs.

| Category | Destination |
|---|---|
| Famine, Colony dying, Strike, Deprived worlds, Unrest rising, Overcrowded | system → `population` |
| Industry idle, Build blocked, Build opportunity | system → `industry` |
| Demand unservable | system → `logistics` |
| Colony opportunity | system → root |
| Maintenance unfunded | the faction panel — the row is faction-level, not a system |
| Crisis, Disruption, Windfall | the system when the event has one, else the events panel |

The five system tabs that exist are `population`, `industry`, `logistics`, `market` and `astrography`,
plus the system root. Events carry `systemId: string | null` (`lib/world/types.ts:462`) — region-level
events have no system, which is why that row is the one conditional destination.

A row's right-hand edge is left free for a later secondary action, so an opportunity row can grow a
direct "build it" without redesigning the row. Not built now.

Only one flyout is open at a time, Escape closes it, and clicking away closes it.

### Settings

A per-category panel from the control at the end of the run: a checkbox per category grouped by tier,
persisted in the browser as a view preference, not in the save. **The critical tier cannot be turned
off** — that is the small non-hideable set. Four important-tier categories default off, listed above.
Toggling does not close the panel.

### What the engine must newly emit

Two categories have no signal in the code today, and this is the bulk of the work:

- **The per-cycle population delta**, persisted per system. `populationDelta` is computed every cycle
  (`lib/tick/processors/population.ts:106`) and thrown away — only the resulting `population` is
  written — so nothing in world state says whether a world is growing or shrinking. Without it,
  Colony dying can only sort by raw population, which puts every freshly-seeded 2-pop colony above a
  world actually collapsing: the seed size *is* the default state, so the alert would be mostly false
  positives. With it, the condition becomes "in famine **and** shrinking" and the sort measure becomes
  a real forecast, `(population − ABANDON_POP_FLOOR) / −delta`.

  One field, written once per economy cycle alongside `population`. **Absent means never assessed, not
  zero** — the same convention as `provision` and for the same reason, since 0 is a real reading
  meaning "stable" and would otherwise be indistinguishable from "never ran".

  **Hazard 1, stated up front:** this is authored for one job — the Colony dying forecast. It is
  obviously attractive to the Tracker's rows, the Population panel, and the queued unrest-history /
  recovery-forecast work. Those are welcome to read it, but any of them wanting a *different* shape
  (a trailing average, a longer window) must add their own rather than redefining this one. That is
  precisely how `TARGET_COVER` and `demandRate` happened.

- **Build blocked.** The planner drops an opportunity it wanted with a bare `continue`
  (`lib/engine/directed-build.ts:824`, `if (maxLevels < 1) continue`) or a zero-level fit search,
  recording nothing. It must instead emit, per system, the reason the best-ranked dropped opportunity
  failed — no habitable land, no spare labour, no affordable whole level — plus the ROI of what was
  dropped, for the within-category sort.
- **Demand unservable.** No `residual` or `unserved` quantity exists in `lib/engine/directed-logistics.ts`.
  A system whose deficit cannot be closed by any reachable donor *or* by local production must be
  distinguishable from one merely waiting on the work budget — which `logisticsFundingBound` already
  marks (`lib/engine/directed-logistics.ts:173`), read today by the build planner
  (`lib/engine/directed-build.ts:340`) and industry (`lib/engine/industry.ts:402`) but by no UI.

Both are **read-only additions from the alert bar's point of view**: the bar reads them, nothing about
them changes what the tick decides. That is the property to preserve at review — an alert that changes
the simulation is a mechanic wearing a notification's clothes.

### World state and saves

**The alert bar adds no *player* state, and one field of world state.** Category visibility is a
browser preference, not a save field, so there is no per-player state at all. The one addition to the
save is the per-cycle population delta above — a save-format bump, taken deliberately because the
alternative is a Colony dying alert that is mostly false positives. Nothing in the tick reads anything
the alert bar itself writes, because the bar writes nothing.

The two new engine signals above are the exception and are the tick's own state, specified with the
instrumentation rather than here.

**Absence is not zero.** `provision`, `supplyBand` and `criticalWeight` are all absent on a system the
economy has never assessed, and that is deliberate (`lib/world/types.ts:106-141`). A never-assessed
system must not appear in Famine or Deprived; it has no reading, not a bad one. This is the same trap
the Tracker already handles at `lib/services/tracker.ts:65`.

## Design hazards — filled

Per `.agents/skills/shared/design-hazards.md`. This is not a pure-UI change — two categories require
new tick instrumentation — so every row is filled.

### 1. One quantity, several unrelated jobs

| Quantity | Every reader today | Which this design moves | Intended? |
|---|---|---|---|
| `supplyBand` | 15 refs across 7 modules (`npm run impact -- supplyBand`): population processor + adapter, `rows`, `population-world`, `world/tick`, `world/types`, `provision-map`, `provision-read` | **None.** Adds an eighth reader (the alert read service) and moves nothing. | Yes — pure read |
| `provision` / `provisionExpectation` | population engine + processor, `provision-read`, `provision-map`, system vitals | **None.** Read for Deprived and for Unrest rising. | Yes — pure read |
| `unrest`, `popCap`, `population` | economy, population, migration, decay, vitals, Tracker | **None.** | Yes — pure read |
| `logisticsFundingBound` | `directed-build.ts:340`, `industry.ts:402` | **None**, but Demand unservable must not be confused with it — funding-bound is a *temporary* state, unservable is a structural one. Two conditions, two signals. | Yes, and stated |
| *(new)* blocked-build reason | none — new | New quantity, sole reader is the alert read service. | Yes |
| *(new)* event valence band | none — new | New per-type authoring, read by the alert read service. | Yes |

The design's whole posture on this hazard: it **adds readers and moves nothing**. The one place that
could go wrong is the two new signals acquiring tick-side readers later, which is why they are
specified as emitted-and-read-only.

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same? |
|---|---|---|---|
| `ABANDON_POP_FLOOR` (`lib/constants/population.ts:141`) | the population below which a famine system is abandoned | the line Colony dying counts down to | Yes |
| `STRIKE_PARAMS.threshold` | the unrest above which a system strikes (`system-population.ts:119`) | the Strike category's condition | Yes |
| `supplyBand === "famine"` | `foldSupplyState`'s survival punch-through; the docstring states it is a **strict biconditional** with `survivalShortfall` (`lib/world/types.ts:141`) | the Famine category's condition, read directly rather than re-inferred | Yes — and the biconditional is why no re-derivation is needed |
| `criticalWeight` | crisis-term input; explicitly **not** inferable from `supplyBand`, and deliberately not clamped to [0,1] | **not used** — no category reads it | n/a |

No constant is being read for a new meaning. Deprived reads the band, not a Provision number against
an invented threshold.

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | **Three categories are events.** Needs a new authored valence band per event type; `EventDefinition` has no severity or valence field today (`severity` is a child-spawn multiplier, `weight` is spawn frequency). | — |
| Population + migration | Reads `population`, `popCap`, `provision`, `provisionExpectation`. Writes nothing. | — |
| Unrest / regime | Reads `unrest` against `STRIKE_PARAMS.threshold`, and grievance as `expectation − provision` (`grievanceShortfall`, `lib/engine/population.ts:295`). Writes nothing. | — |
| Industry + staffing | Industry idle reads existing per-building idle reasons. Build blocked's labour case reads the planner's own fit gate. | — |
| Infrastructure decay | None directly, but Industry idle is the **early warning for decay** — idle capacity is what decay removes. Surfacing it does not change the decay rate. | — |
| Directed logistics | Demand unservable is new instrumentation here. Must be distinguished from `logisticsFundingBound`. | — |
| Directed build / planner | Build blocked is new instrumentation here. Build opportunity reads the ranked proposals, gated on the automation switch. | — |
| Colonisation + founding manifest | Colony opportunity reads eligibility; Colony dying reads the abandonment line. No write path. | — |
| Treasury / purse | Maintenance unfunded reads `WorldTreasurySettlement.paid.maintenance` against `maintenanceBill` (`lib/world/types.ts:405-421`). | — |
| Factions + relations | `border_conflict` arrives as an event via the relations processor (`lib/tick/processors/relations.ts:34-37`); it lands in Crisis. **No war state exists** to interact with. | — |
| Save format (`World` shape) | **One new per-system field** — the per-cycle population delta. Settings stay a browser preference, so no new *player* state. Contrast the Tracker, which added `pinnedSystemIds` and nothing else. | — |
| The harness's own metrics | **None.** The harness drives `runWorldTick` and has no player seat, so no category evaluates. The two new engine signals must therefore be **inert when unread** and must not change any harness figure. | — |

### 4. A symptom asserted without a measurement

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| `supplyBand === "famine"` iff `survivalShortfall` | `lib/world/types.ts:141` docstring | code | — |
| The planner drops blocked opportunities with no record | `lib/engine/directed-build.ts:824` | code | — |
| No unserved/residual signal exists in logistics | grep of `lib/engine/directed-logistics.ts` — no `residual` or `unserved` symbol | code | — |
| `logisticsFundingBound` is read by the engine but no UI | `directed-build.ts:340`, `industry.ts:402`; no `components/` reader | code | — |
| No war state exists | every `war` identifier in `lib/` is a comment, a fog-of-war name, or a future-layer note | code | — |
| Grievance is derivable without new history | `grievanceShortfall(expectation, provision)`, `lib/engine/population.ts:295`; both fields persisted | code | — |
| **How many systems each category would carry** | **NONE — hypothesis** | — | — |
| **"Blocked builds are rare by construction"** | **NONE — hypothesis** | — | — |

The last two are labelled hypotheses, not findings. They set defaults, not the category list — see
Evidence still owed.

### 5. Designing against a threshold or primitive that does not exist

| Consumes | Produced at | Actual shape today | Design assumes |
|---|---|---|---|
| Famine | `foldSupplyState`, `lib/engine/population.ts:262`; persisted `supplyBand` | `"famine"` only via the survival branch; **absent when never assessed** | matches |
| Deprived band | same fold, persisted | four descriptive bands; famine punches through at any Provision | matches — Deprived is a band, not a Provision cutoff |
| Strike | `system-population.ts:119`, `unrest > STRIKE_PARAMS.threshold` | boolean derived at read time | matches |
| Colony dying | `lib/tick/processors/population.ts:111` reports systems already below the floor; `populationDelta` at `:106` is computed and discarded | reports **crossings**, not a countdown; the delta exists for one statement and is never written | **RESOLVED by persisting the delta** — the forecast then derives from two persisted numbers |
| Maintenance unfunded | `WorldTreasurySettlement`, `lib/world/types.ts:405` | `paid` vs the bills, per settlement | matches |
| Unrest rising | `grievanceShortfall`, `lib/engine/population.ts:295` | `expectation − provision`, both persisted | matches — no unrest history needed |
| Build blocked | **does not exist** | — | new instrumentation |
| Demand unservable | **does not exist** | — | new instrumentation |
| Event valence | **does not exist** | `EventDefinition` has no severity/valence | new authoring |

The Colony dying row is the hazard-5 catch: the design said "sorts by cycles to the floor" against a
processor that only reports systems already past it.

### 6. Designing against an aggregate that moves for other reasons

| Metric | Read at which cohort | What else moves it |
|---|---|---|
| Per-category instance count | **Must be cohorted by world age and by developed-vs-frontier.** A galaxy-wide count rises purely with the number of developed systems. | Colonisation rate, universe size, the horizon. A count that doubles because the empire doubled is not a worsening condition. |
| "Rare by construction" for Build blocked | Blocked events per planner run, per faction, not galaxy totals | Faction count, construction pool size, how saturated territory is |

Both are the same trap: an alert count is an extensive quantity, so it grows with the empire. Any
default-off decision must be made on a **rate** (share of developed systems), never a raw count.

## Evidence

Claims and falsifiers committed **before** the instruments ran, per `/measure` step 2. Any later edit
to this section shows up in `git diff` rather than in nobody's memory.

### Claim A — the four default-off categories are common

> At equilibrium, each of the four categories defaulted off — Deprived, Unrest rising, Overcrowded,
> Industry idle — is true for **more than 20%** of the player faction's developed systems.

**Falsifier A:** if any of the four reads **below 10%** of developed systems at *both* horizons, its
default-off is unjustified and that category defaults on instead.

### Claim B — blocked builds are rare by construction

> Per directed-build run at equilibrium, the planner drops an opportunity it wanted (no habitable
> land, no spare labour, no affordable whole level) on **fewer than 5%** of the faction's developed
> systems.

**Falsifier B:** if blocked drops occur on **more than 20%** of developed systems per run at either
horizon, "rare by construction" is false, and Build blocked defaults off with the other four rather
than being one of the signals that justifies the whole principle-2 class.

### Readings

Instrument: a scratch runner driving the real `runWorldTick` on the quick run's own config
(`DEFAULT_SYSTEM_COUNT`, seed 42), sampling at both horizons, counted over **developed systems** and
reported per faction. Claim B additionally used a temporary counter at the planner's two drop sites,
reverted in the same turn (`git checkout -- lib/engine/directed-build.ts`, verified by grep).

Instrument validated before reading: the runner reports an absent Claim-B counter as **NOT MEASURED**
rather than as zero — a counter that never fires and a mechanism that never fires look identical, and
the first run exercised exactly that branch.

```
===== STARTUP — 1000 ticks =====
developed systems: 253
  Famine          1.6%  (4)
  Deprived        0.4%  (1)   [default OFF]
  Strike          0.0%  (0)
  Overcrowded    49.0%  (124)   [default OFF]
  Unrest rising  13.8%  (35)   [default OFF]
  Industry idle   2.0%  (5)   [default OFF, proxied by staffing]
   faction-637            n=  22 deprived   0.0% crowd  22.7% grieve   0.0% idle   9.1%
   faction-640            n=  17 deprived   0.0% crowd  47.1% grieve   5.9% idle   0.0%
   faction-631            n=  17 deprived   0.0% crowd  41.2% grieve   5.9% idle  11.8%
   faction-626            n=  17 deprived   0.0% crowd  29.4% grieve  23.5% idle   0.0%

===== EQUILIBRIUM — 10000 ticks =====
developed systems: 582
  Famine          1.2%  (7)
  Deprived        0.0%  (0)   [default OFF]
  Strike          1.4%  (8)
  Overcrowded    99.0%  (576)   [default OFF]
  Unrest rising  22.3%  (130)   [default OFF]
  Industry idle  34.5%  (201)   [default OFF, proxied by staffing]
   faction-632            n=  45 deprived   0.0% crowd 100.0% grieve  20.0% idle  31.1%
   faction-635            n=  38 deprived   0.0% crowd  94.7% grieve  28.9% idle  28.9%
   faction-630            n=  36 deprived   0.0% crowd 100.0% grieve  19.4% idle  52.8%
   faction-639            n=  36 deprived   0.0% crowd 100.0% grieve  16.7% idle  38.9%

===== CLAIM B — planner blocked drops =====
  -- equilibrium only (after t=1000) --
  runs with >=1 blocked drop: 375
  mean blocked systems per such run: 293.32 = 50.40% of developed
  peak: 475 = 81.62% of developed
  drops by reason: no-fit-space-or-labour=367449, no-whole-level=1691
```

---

```
Meaning:    Three of the four categories we defaulted off are indeed common, but the fourth —
            Deprived — almost never happens, so hiding it by default hides a genuine signal.
Claim:      Each of the four default-off categories is true for >20% of developed systems at
            equilibrium.
Number:     Deprived 0.4% → 0.0%; Unrest rising 13.8% → 22.3%; Overcrowded 49.0% → 99.0%;
            Industry idle 2.0% → 34.5%
Horizon:    startup (1,000t) AND equilibrium (10,000t)
Cohort:     developed systems, galaxy-wide, with a per-faction breakdown showing the same rates
            inside the largest factions — so the galaxy figure is not a cohort-mix artefact
Licenses:   Supports the DEFAULT for each of these four categories. Does NOT support deleting any of
            them, and does NOT measure Industry idle honestly — that row is proxied by labour
            fulfilment alone, so it misses missing-input and missing-licence idleness and is a LOWER
            bound. Does not speak to the categories not listed.
```

**Outcome: partly falsified.** Falsifier A fires for **Deprived** — 0.4% and 0.0%, below 10% at both
horizons — so **Deprived defaults ON**. The other three survive: Overcrowded and Industry idle
comfortably, Unrest rising on the equilibrium reading.

---

```
Meaning:    "Blocked builds are rare by construction" is false. The planner drops an opportunity it
            wanted at about half the empire on every run, which is the same shape as the EU5 alert
            players install a mod to hide.
Claim:      Per directed-build run at equilibrium, the planner drops an opportunity it wanted on
            fewer than 5% of the faction's developed systems.
Number:     50.40% of developed systems per run (mean), peak 81.62%. 367,449 drops for
            no-fit-space-or-labour against 1,691 for no-whole-level.
Horizon:    equilibrium (10,000t), with the startup ticks excluded from the equilibrium figure
Cohort:     developed systems, per planner run — ticks where the planner did not run are excluded
            rather than counted as zeros, which would divide by every tick instead of every run
Licenses:   Supports Build blocked defaulting OFF, and kills "rare by construction". Does NOT
            establish how many systems are *entirely* blocked: the counter records a system where at
            least one opportunity was dropped, which is a SUPERSET of systems where nothing could be
            built at all. It is an upper bound. A narrower instrument — systems where no opportunity
            landed — is the follow-up if anyone wants to rescue the category, and it would have to
            come in 10× lower to save the claim.
```

**Outcome: falsified.** Falsifier B fires at 2.5× its threshold. **Build blocked defaults OFF**, and
the claim that saved our version of it from EU5's fate does not hold.

---

### Re-measure — Overcrowded against the engine's own primitive

The first reading used "≥90% of `popCap`", which was my threshold, not the game's. `crowdingPressure`
(`lib/engine/population.ts:409`) is the engine's own: exactly zero at or below the cap, ramping to
`PRESSURE_MAX` by `BRAKE_END` (1.15). Strictly *over* the cap is therefore the honest condition, and
the pressure is a built-in sort measure.

```
===== STARTUP — 1000 ticks =====        developed systems: 253
  Overcrowded>=90%   49.0%  (124)
  Over cap (>100%)    7.9%  (20)
  crowdPressure>0     7.9%  (20)

===== EQUILIBRIUM — 10000 ticks =====   developed systems: 582
  Overcrowded>=90%   99.0%  (576)
  Over cap (>100%)   98.6%  (574)
  crowdPressure>0    98.6%  (574)
```

```
Meaning:    Worlds do not merely sit at their housing cap at equilibrium — almost all of them are
            over it, and they get there over the run rather than starting there. Overcrowding is the
            resting state of a mature galaxy, so it cannot be an alert condition at any threshold.
Claim:      (re-measure) Overcrowded is a usable condition if defined as strictly over the cap
            rather than near it.
Number:     over cap 7.9% at startup → 98.6% at equilibrium. `crowdPressure > 0` reads identically,
            confirming the two definitions are the same set.
Horizon:    startup (1,000t) AND equilibrium (10,000t) — the split is the finding
Cohort:     developed systems; per faction the largest six run 92-100% at equilibrium, so it is not
            a cohort-mix artefact
Licenses:   Supports Overcrowded being unusable as an alert at any cap-relative threshold, and
            supports it defaulting off. Does NOT measure HOW FAR over the cap these worlds sit —
            this is an incidence count, not a distribution. Marginally-over (a rounding equilibrium
            between build and decay) and badly-over (housing chronically losing) are indistinguishable
            in this reading, and they mean very different things.
```

**Outcome: falsified.** Tightening the threshold does not rescue the category — 98.6% against 99.0%
is no improvement. Overcrowded **defaults off**, and "population against the cap" is not a condition
this game has, at any threshold.

**A finding outside this feature, worth surfacing on its own.** 7.9% → 98.6% is a drift across the
run, not a founding artefact. The design's stated intent is that *proactive housing leads* population
(`docs/SPEC.md`, Directed Logistics & Autonomic Agency), and at equilibrium it plainly does not — it
is behind almost everywhere. Whether that is benign (build and decay resting a hair over occupancy)
or real (housing chronically losing) turns entirely on the magnitude, which this reading does not
have. **Not booked, not diagnosed** — raised here because it was found here.

---

### Overcrowded — the condition, and why its rate is not a design input

**The condition is computable today**: `population > popCap` **and**
`habitableHousingHeadroom(sys) < 1` (`lib/engine/directed-build.ts:163` — the planner's own "can
another housing level physically be built here"). Sorts by population over cap. That is the whole
answer, and it is what the spec carries.

Incidence, for reference only: 0.4% of developed systems at 1,000 ticks, 97.3% at 10,000.

**The equilibrium figure is not a reason to change the design.** It saturates because mature systems
run out of space, which is a known separate problem the owner has scheduled rather than an alert
fault — so tuning this category against it would be tuning against a state the game is going to leave.
The expansion-phase reading is the one that reflects a working game, and there the alert is rare and
actionable. Revisit the default only if it still saturates after the space work.

**Recorded so it is not re-derived:** nothing reaches `BRAKE_END` (1.15) at either horizon and the
equilibrium band is 0.034 wide (p10 1.088, max 1.127), so cap utilisation alone can neither select nor
sort this category. That is why the second conjunct is in the condition rather than a threshold.

### What the readings changed

- **Deprived defaults ON.** It is rare, which is exactly what makes it a good alert.
- **Build blocked defaults OFF**, and its justification is gone. It stays as a category — the reason
  it was wanted (automation's silent failures are the only signal there is) is unaffected — but it is
  now a category the player opts into, not one the design leans on.
- **Overcrowded is kept and defined with two conjuncts** — over `popCap` and no habitable headroom
  for another housing level. Both are available today. Its default is set on the expansion-phase
  reading (0.4%), not the build-out one, because build-out saturation is the scheduled space problem
  rather than a property of the alert.
- **The horizon split is load-bearing for Industry idle**: 2.0% at startup against 34.5% at
  equilibrium. A startup-only read would have called it rare and defaulted it on.

## Evidence still owed / now settled

1. ~~Category volume at ordinary play~~ — **measured**, see Evidence above. Moved Deprived to
   default-on and confirmed the other three.
2. ~~"Blocked builds are rare by construction"~~ — **measured and false**, see Evidence above.
3. **`RATION_EXIT_EPS`.** Carried here by roadmap row 1 with no surviving justification unless band
   transitions become an alert category. If they do, calibrate the hysteresis against a condition
   flapping on and off the bar; if they don't, delete the constant. Open either way: whether the
   hysteresis applies to the persisted display band only (presentational) or to the classifier itself
   (mechanical — the regime feeds the unrest term). Unverified; do not assume the first.

## Still open

- **The `Unrest rising` glyph.** A bare `TrendingUp` with no subject to slash — see the tier list.
- **A new home for the faction name and flag**, which were to live in the dropped full-width bar's
  left block.
