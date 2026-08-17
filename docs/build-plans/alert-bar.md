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

Absorbed here: the 14 spawned event types plus the 3 relations-owned ones — seventeen in all
(`EVENT_TYPE_ICON`, `lib/constants/ui.ts:117-138`) — which become alert categories rather than the
separate dismissible feed that was considered and dropped.

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
  this same span, which is the tell that the shell was doing nothing the run wasn't. The faction name
  and flag, once destined for that bar's left block, go above the system and faction detail panels on
  the left instead — a separate piece of work, not this one.
- **Chips are icon-plus-count, not labelled**, at **20px** icons, with chip height derived from that
  figure rather than set independently.
- **The run is inset 8px** from both panels and from the top of the map, and carries **no backing
  panel** — the chips are opaque and read over the map on their own.
  **This moves three surfaces, not one.** `components/map/map-right-rail.tsx:68` carries
  `inset-y-4 right-4` on the **outer** column, which holds the Tracker, its settings panel and the
  **map controls dock** (`:69-73`). `inset-y-4` is a vertical pair, so 16px → 8px moves all three on
  the top, bottom and right edges. Confirm the dock still clears the map's bottom edge at 8px, or pin
  it separately. That file is in this feature's diff.
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
- **Chips inside the existing top bar** was killed by arithmetic: ~5 chips against sixteen
  categories, and that space is already promised to treasury readouts.
- **Empty space inside the run passes clicks through to the map.** Only the chips take pointer events,
  the same rule the Tracker's rail already follows.

## Draft category and tier list

First cut. `Ships today` = a read exists and something renders it. `Derivable` = the data is in world
state but nothing computes this shape of it. `New` = the engine throws the fact away today.

Icons are real lucide 0.577 glyphs, checked against the installed package. **Event flyout rows carry
each event type's own icon** from `EVENT_TYPE_ICON` (`lib/constants/ui.ts:117`), so the bar inherits
the vocabulary the events screen already teaches. The three band chips take their own glyphs —
`Siren`, `TriangleAlert`, `Sparkles` — of which the latter two are also type icons (`plague_risk` and
`trade_festival`), so a Windfall chip and one of its own rows can render identically; pick
replacements if that reads badly in the prototype.

Where lucide has no negated variant the glyph carries a **fault slash**: the corner-to-corner line
lucide's own `-off` icons use, drawn over the plain subject glyph and cased so it survives a busy one.
Checked against the installed package: there is no `FactoryOff` and no `BedDoubleOff`, so those two
take the slash.

The `Clears by` column records how a row actually stops being true, per the contract below: **fix**
(the player can act), **expiry** (an event's phases end), **world-resolves** (the simulation removes
the subject — a colony is abandoned, decay eats the idle capacity, population falls).

| Tier | Category | Icon | Condition, and its sort measure | Clears by | Data |
|---|---|---|---|---|---|
| critical | Famine | `WheatOff` | Survival-good shortfall (`supplyBand === "famine"`). Sorts by time to abandonment, soonest first — an exponential countdown to `ABANDON_POP_FLOOR`, `ln(population / ABANDON_POP_FLOOR) / k` where `k = −populationChange / population`; a famine world that is **not shrinking** carries no countdown and sorts after the shrinking ones, by shortfall depth. Needs the per-cycle population delta persisted — see below. | fix / world-resolves (abandonment) | Ships today + New (small) |
| critical | Strike | `Megaphone` | Unrest past the strike threshold. Sorts by suppression. | fix | Ships today |
| critical | Maintenance unfunded | `BanknoteX` | Settlement could not pay the maintenance band **it was asked to pay** — insolvency, not a slider setting. The only path into destructive decay. One faction-level row, count always 1. | fix | Ships today |
| critical | **Crisis** | `Siren` | Events that can break a world — plague, raid, asteroid strike, inner-system conflict, border conflict. Sorts by authored impact rank (new authoring, beside the band). | expiry | Needs banding |
| important | Deprived worlds | `BatteryLow` | Provision in the Deprived band. Sorts by Provision ascending. | fix | Ships today |
| important | Unrest rising | `TrendingUp` | Provision below the floored expectation the population is judged against, not yet striking. Requires a real memory (`provisionExpectation` present). Sorts by grievance depth. | fix | Ships today |
| important | Survival stock falling | `Hourglass` | A survival good (`SURVIVAL_GOODS` — water, food) with **cycles-to-empty below 3** — falling alone is meaningless, since stocks oscillate and over half of survival-good rows are falling at any moment, so the countdown carries the whole condition. Sorts by cycles remaining, soonest first. Stock is used because directed logistics lands imports as stock deltas, so a falling stock is the true net drain; local consumption-vs-production would fire on every importer. Needs the per-cycle survival stock delta persisted — see below. | fix | New (small) |
| important | Demand unservable | `RouteOff` | A deficit no reachable donor and no local production can close — structural, as distinct from the temporary `logisticsFundingBound`. Sorts by unserved demand rate. | fix | New |
| important | Overcrowded | `BedDouble` | `population > popCap` — there are people with no housing. Sorts by cap utilisation. The threshold is definitional, not tuned: at 1.00 everyone is housed and the next person is not. | fix | Derivable |
| important | No housing headroom | `BedDouble` + slash | Over `popCap`, **nothing queued to fix it**, and no habitable room for another housing level (`habitableHousingHeadroom < 1`, evaluated against queue-adjusted buildings). The world needs housing, has none coming, and physically cannot build it. Sorts by population over cap. | world-resolves (population falls) | Derivable |
| important | Build blocked | `HardHat` + slash | The **production** planner wanted to build and could not — no capacity, no reachable input supplier, no spare labour, no affordable whole level. Sorts by **authored reason severity**, worst first — see below. Housing refusals belong to *No housing headroom*, not here: housing carries no ROI and would have nothing to sort by. **Defaults off**: measured at 50.4% of developed systems per planner run, not rare. | fix | New |
| important | Industry idle | `Factory` + slash | Built capacity not running — no skill licence, missing inputs, no staff. Sorts by idle share. The missing-inputs case needs a sixth `IdleReason` — see below. | no staff / no licence: fix or world-resolves (decay removes it) · missing inputs: **fix only** | Ships today + new |
| important | **Disruption** | `TriangleAlert` — also a type icon | Events that cost but do not threaten — shortage, storm, embargo, glut, a dissolved alliance, and the three below. Sorts by authored impact rank. | expiry | Needs banding |
| info | Build opportunity | `HardHat` | Ranked planner proposals, **only while build automation is off**. Sorts **survival-serving builds first**, then by demand served per route cost — see below. | fix | New |
| info | Colony opportunity | `Globe` | Eligible controlled systems, **only while colonisation automation is off**. Sorts by the planner's own `value / work` — a real ROI, unlike the build side. | fix | New |
| info | **Windfall** | `Sparkles` — also a type icon | Events worth riding — trade festival, mining boom, tech breakthrough, a pact opening. Sorts by `ticksRemaining`, soonest to expire first. | expiry | Needs banding |

**Sixteen categories.** Overcrowded was one category and is now two: combining "over the cap" with
"and no room to fix it" meant the manual builder — the player with build automation off, who is the
one who needs the nudge — was told last, only once every habitable slot was already gone. The two
facts are separate warnings and a system may raise both.

**Two categories are warnings ahead of a critical one, and sit one tier below it.** Unrest rising is
important where Strike is critical; Survival stock falling is important where Famine is critical. The
same relationship, authored the same way.

**Colony dying is deleted, folded into Famine's sort rather than kept as a third warning.** The two
categories above step down a tier because each is a warning *before* a bad state — a distinct, earlier
condition that earns its own chip ahead of the critical one it precedes. Colony dying was never that
shape: it was not an early signal of famine, it was famine advanced far enough to be terminal, which is
exactly why it could not step down a tier the way the other two do — it is *more* urgent than the state
it rides alongside, not less. A worse version of the same state is not a second chip; it is the sort
order inside the one chip that already exists, which is what stops sixteen categories becoming forty. A
pre-committed falsifier ran at Gate 1 and fired — see `## Evidence` → Colony dying vs Famine overlap —
but it measured something else entirely and was withdrawn rather than acted on; the fold happens for
the structural reason above, and would have happened at any reading.

**Survival stock falling survives the same test Colony dying failed.** Famine is delivery failing;
Survival stock falling is the buffer draining. A world can draw down its food warehouse while everyone
is still fed — that is what a warehouse is for — and it can be in famine with a stock that is not
falling if production just collapsed. Neither implies the other, so these are two conditions rather
than one condition at two severities, and it stays one tier below Famine, matching Unrest rising below
Strike.

**Discrete events are separate from the conditions, and split three ways by authored valence** —
`Crisis` (critical), `Disruption` (important), `Windfall` (info). The rest of the bar is standing
system warnings and opportunities, things that are *true* until fixed; an event is a happening with
phases and an end. Giving each of the seventeen kinds its own chip made the bar mostly weather report,
but one chip for all of them buried a plague next to a trade festival.

Three bands is the resolution, and it keeps the tier rule intact: each event **type** is banded at
authoring time, so an event chip's tier is authored exactly like every other category's. It also
dissolves the question of whether a merged Events chip should colour itself by its worst member — the
split does that work at design time instead of at runtime.

**The banding is new authoring, not a read of existing data.** `EventDefinition`
(`lib/constants/events.ts:68-79`) carries neither severity nor valence — it has `weight` (spawn
frequency) and no severity field at all. The `severity` fields in that file belong to `SpreadRule`
(`:51`, a child-spawn multiplier) and to the event instance (`WorldEvent.severity`,
`lib/world/types.ts:469`, a spread-weakening intensity identical across all root events). The band is
a new per-type lookup beside `EVENT_TYPE_ICON` in `lib/constants/ui.ts:117`.

**The sort measure is new authoring too.** The tier list's original "sorts by phase severity" had no
producer: `EventPhaseDefinition` (`lib/constants/events.ts:58-66`) has name, displayName,
durationRange, modifiers, notification, shocks and spread — no severity — and the instance severity
ties across every root event. Crisis and Disruption therefore sort by an **authored impact rank**
carried in the same lookup as the band. Windfall sorts by `ticksRemaining`, which does exist.

**All seventeen types are banded**, and the lookup is typed `Record<EventTypeId, EventBand>` so a
future type cannot ship unbanded:

| Band | Event types |
|---|---|
| **Crisis** | `plague`, `pirate_raid`, `asteroid_strike`, `inner_system_conflict`, `border_conflict` |
| **Disruption** | `supply_shortage`, `solar_storm`, `trade_embargo`, `ore_glut`, `alliance_dissolved`, `conflict_spillover`, `plague_risk`, `refugee_crisis` |
| **Windfall** | `trade_festival`, `mining_boom`, `tech_breakthrough`, `pact_under_negotiation` |

The last three of Disruption were unbanded in the first cut and are the ones worth stating a reason
for. `conflict_spillover` (`lib/constants/events.ts:274-288`) and `plague_risk` (`:296-309`) are the
weakened children of Crisis parents — production 0.8 and food 0.6 against their parents' 0.5 and 0.4 —
and `plague_risk` is a *risk*, so banding it Crisis would put a non-hideable chip on a plague that has
not happened. `refugee_crisis` (`:490-518`) is the closest call: it hits survival goods directly (food
supply −30%, production 0.7 in its second phase), but that is the same shape as `supply_shortage`,
which is already Disruption. It costs; it does not break a world.

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

**Two glyph pairs came out of this**, and they are the clearest thing on the bar: `HardHat` plain is a
build you could order, `HardHat` slashed is one that could not happen; `BedDouble` plain is a world over
its housing cap, `BedDouble` slashed is one that cannot build its way out. Same subject, faulted and
not. `Globe` stands alone for Colony opportunity — there is no `GlobeOff` counterpart on the bar, since
Colony dying is not a category.

**`Construction` was rejected for Build blocked** and `HardHat` taken instead. That glyph is already
three diagonal strokes, so even a cased fourth diagonal reads as more barrier hatching rather than as
a negation, while a clean dome takes a slash unambiguously. Judged side by side in the prototype, both
treatments, before deciding.

**`Unrest rising` keeps its bare `TrendingUp`** — settled. It has no subject glyph to slash
(`Megaphone` is the strike, `Flame` belongs to `asteroid_strike`), and it does not need one: the
chip's fill is its tier colour, so a rising arrow in the important-tier colour reads as something
climbing that is a problem, which is the whole of what the category means. A second overlay
convention would have been invented to say less than the colour already says.

**Custom icons are a live possibility** for this project rather than a rejected one. The lucide set
plus the cased slash covers all sixteen; a dedicated set would be a later pass, and nothing here
forecloses it.

The `Derivable` rows need no tick-side addition — Overcrowded and No housing headroom both compute
from persisted `WorldSystem` columns, the per-system figure already existing at
`lib/services/tracker.ts:60`; what is missing is a faction-wide read. The `New` rows are the genuine
instrumentation, specified below.

## Settings, and what defaults off

A per-category settings panel, opened from the control at the end of the chip run and following the
Tracker's pattern: a checkbox per category, grouped by tier, persisted in the browser as a view preference
rather than in the save. The two `info` groups additionally only ever appear while their domain's
automation is off, so they self-gate on top of the checkbox.

**The critical tier cannot be turned off.** That is the small non-hideable set the design promised —
nothing that can end a colony or start a war is switched off by accident. Four categories, locked on.

**Three important-tier categories default to OFF.** This table is the single authority on defaults —
no other section states one. The list is the *measured* one where a measurement exists; the guesses it
started from were right about three of five and wrong about two, which is why it was measured:

| Category | Default | Measured rate (startup → equilibrium) | Why |
|---|---|---|---|
| Deprived worlds | **ON** | 0.4% → 0.0% | Measured rare, so it is a real signal rather than noise. The guess that it was common was wrong. |
| Unrest rising | OFF | 13.8% → 22.3% | Common, and an early warning for a state Strike already announces loudly. |
| Overcrowded | **ON** | over cap: 7.9% → 98.6% | Kept on deliberately, against the equilibrium rate. If nearly every mature world is genuinely over its housing cap then the alert is correct and the *game* is wrong — proactive housing is meant to lead population and at equilibrium it does not. Better that the bar says so loudly than that the default hides it. Revisit after playing, not after tuning. |
| No housing headroom | **ON** | not separately measured | Same reasoning; it is the subset of the above that cannot be built out of. |
| Survival stock falling | **ON** | not yet measured | A leading indicator of Famine, which is rare (1.6% → 1.2%). Expected rare on the same grounds; the threshold and the rate are both owed. |
| Industry idle | OFF | 2.0% → 34.5% | EU5's single most-hidden alert, and often genuinely unfixable. |
| Build blocked | OFF | 50.4% of developed systems per planner run | "Rare by construction" measured false at 2.5× its falsifier. |

This is the same posture the opportunity categories already take with the automation switch: with a
domain automated the player is not told what the brain is handling, only what it *could not* do. A
player who wants to min-max turns them on.

**What a volume measurement is for here.** It answers "does this category default on or off", never
"does this category exist" — a category measured as continuously true across dozens of systems is a
default-off category, not a deleted one. And it never sets a category's *condition*: a condition
follows from what the thing means, and a rate only says whether the game currently lives up to it.
That is why Overcrowded is `population > popCap` regardless of the 98.6% reading.

**Popover bodies are deliberately thin:** a list of the affected systems, sorted by the category's own
measure, and nothing else. A row navigates; richer bodies are a later pass.

## Specification

### What it is

A run of small chips across the top of the map, each one a kind of trouble or opportunity that is
**true right now**. A chip appears when at least one instance meets its condition, carries the count
of instances, and disappears when the last of them stops. Clicking a chip opens the list, worst first;
clicking a row goes there.

That is the whole contract, and the sentence that decides every argument about it: **a row exists only
while its condition is true, and nothing here is dismissible.** A row clears when its condition stops
— by the player fixing it, by the world resolving it (an event's phases end, a colony is abandoned,
decay eats the idle capacity), or by the domain leaving view when its automation is switched on. What
is forbidden is a row that persists after its condition is false.

That wording replaces an earlier, narrower one — "fixing the condition makes the row go away" — which
five categories could not honour. Overcrowded's companion is *defined* by there being no way to build
the fix; Industry idle is often unfixable; the three event bands end on their own. Unfixability is an
argument about a category's **default**, not about its inclusion: what the rule is actually protecting
is that no state still true can be dismissed.

**The count is a raw instance count, and it is extensive** — it grows with the empire, so it is not a
severity signal and is not comparable across categories or across a run. Famine falls from 1.6% to
1.2% of developed systems between horizons while its raw count rises from 4 to 7. Severity is carried
entirely by the authored tier colour; the flyout footer carries the denominator ("3 of 253 developed
systems") for anyone who wants the rate.

**Everything is scoped to the player's faction** — developed systems the player controls, and for the
three event categories, events in those systems plus the relations-owned pair events where the
player's faction is one of the pair. A rival's plague is real strategic information and belongs on
some other surface; it is not a condition of yours, it cannot be acted on, and Crisis cannot be
switched off.

The Tracker, beside it, holds the opposite kind of thing — worlds and projects the player is watching,
which stay in the list whether or not anything is wrong. Nothing appears on both. Two *alert*
categories may name the same system: they are different warnings, not duplication, which is exactly
why instances rank within a category and never across.

### The rule that decides what belongs

An alert-bar row is a **condition**: it exists only while true. A Tracker row is a **thing**: it
persists regardless. Everything condition-shaped belongs here, everything thing-shaped there, and the
split is exhaustive — there is no third surface, and a dismissible event log was considered and
dropped precisely so there is only ever one place that says "look at this".

Two consequences follow. The game decides what is on the alert bar, so the player needs a way to turn
categories off; the player decides what is in the Tracker, so it needs a pin control instead. And
because a condition clears itself, **nothing on this bar is dismissible** — dismissing a state that is
still true is the genre failure the whole design exists to avoid.

**A condition resolves on its producing processor's cycle, not on the player's action.** The economy,
construction and logistics cycles are all 24 ticks today but are independently tunable knobs
(`lib/constants/tick-cadence.ts:21-27`), so a chip clears at the next cycle boundary after the fix
lands, and Build blocked and Demand unservable can lag the rest of the bar by up to one of their own
intervals. That is the honest form of the contract; nothing here promises instant clearing.

**A condition's definition comes from what it means, never from what the galaxy currently measures.**
Overcrowded is `population > popCap` because at 1.00 everyone is housed and the next person is not —
not because a distribution suggested a threshold. A measured rate can set a *default* and can tell us
the game is not living up to a definition; it cannot move the definition. Many mechanics that will
shape population are unbuilt, so a rule fitted to today's numbers would encode an unfinished system.

### Placement and behaviour

The chips float over the top of the map, inset 8px from the system drawer on the left, the Tracker
rail on the right, and the top of the map. Nothing reserves layout height: on a galaxy with no live
conditions and no automation switched off, the surface is not there at all. Empty space in the run
passes clicks through to the map; only the chips themselves are interactive.

The inset is fixed to the system drawer's width on the left and the Tracker rail's **base** width
(`w-72`, `components/tracker/tracker-panel.tsx:58`) on the right, whether or not either panel is open,
so the run never reflows when the player clicks a system. **One exception:** `TrackerSettings`
(`w-44`, `components/tracker/tracker-settings.tsx:39`) mounts inside the same rail row and widens the
occupied right span from 288px to 472px while open. The run's right inset tracks that one state — it
is a panel the player deliberately opened, not the map-click churn the fixed inset exists to prevent,
and without tracking it the chips and their flyouts would sit under the Tracker by 184px.

Chips are ordered by their category's authored tier — critical, then important, then informational —
with a hairline separator between tiers. Within a tier the order is authored too, and stable: a chip
never moves because its count changed.

**A chip appears the cycle its first instance appears, and clears after two consecutive cycles with
none.** Without that, a system oscillating across a threshold toggles its chip in and out of the run
and re-packs every chip to its right. The hysteresis is presentational only — it touches no
classifier, changes no condition, and rows inside an open flyout update immediately.

**Packing adapts to the space, in four steps.** Chips sit spaced while the run fits; overlap by 8px
once it does not, each casting a shadow rightward with the leftmost on top and the hovered one raised
clear; tighten as far as 16px of overlap before anything is given up; and only past that does the tail
collapse into a `+N` chip. Overflow is a last resort, not the first answer, and at ordinary widths it
does not fire. Chip fills are opaque so overlapping chips do not show each other — or the live map —
through.

**The `+N` collapse never consumes a critical chip.** The tail is informational-first so criticals
collapse last anyway, but the invariant has to be stated rather than left to ordering: a category the
settings forbid switching off must not vanish by layout instead. If the run cannot fit the critical
tier plus a `+N`, the critical chips overlap past 16px rather than collapse. Below the width of that,
the run does not render at all — the span is fixed to the two panel widths regardless of viewport, so
a narrow window can leave it small or negative, and that floor needs a defined behaviour rather than
an accident.

### The categories

Sixteen, in the table above. Each is authored into one of three tiers at design time. **There is no
computed cross-domain score anywhere in this design**: instances sort only *within* their category, by
that category's own natural measure, and categories sort only by their authored tier. This is what
lets housing — which carries no ROI value at all — sit on the same bar as an industry proposal without
inventing a weight to compare them.

**A chip is an outcome; a row is a reason.** Build blocked is one chip, not five, even though its five
drop reasons (`no-capacity`, `no-input-supplier`, `no-consumer`, `no-labour`, `no-whole-level` —
`lib/engine/directed-build.ts:125`) have entirely different player fixes. The outcome is the same in
every case: a system wanted to build and could not. Which fix applies is what the row carries, sorted
worst-first by `BUILD_DROP_SEVERITY`. Splitting one outcome across five chips spends the run's scarcest
resource — horizontal space — on a distinction the flyout already makes.

Discrete events are three categories banded by authored valence rather than one chip or seventeen:
Crisis, Disruption, Windfall. Each event type is banded at authoring time, so an event chip's tier is
authored exactly as every other category's is.

**An event chip's count is instances, not systems** — the one place the bar departs from its
count-of-systems rule, and it has to. A region-target phase applies its modifiers to a whole region
from one instance (`lib/engine/events.ts:136`), so counting systems over-reports; and
`pact_under_negotiation` and `alliance_dissolved` spawn with no system at all, so counting systems
reports zero for an event that is plainly happening. The flyout's footer says which unit it is
counting.

Event chips also refresh on a different SSE channel from every other chip — `eventNotifications`
rather than `economyTick` (`lib/hooks/use-tick-invalidation.ts`). The alert read key subscribes to
both.

### The flyout

Clicking a chip opens a panel beneath it, anchored under that chip. It carries the category's name and
icon, one line saying what the condition is, the affected **instances** in the category's own sort
order, and a footer carrying the total count with its denominator.

Instances are systems for most categories, **events** for Crisis / Disruption / Windfall, and a
**single faction-level row** for Maintenance unfunded — whose chip count is therefore always 1 and
whose sort order is vacuous. Maintenance unfunded evaluates only when `lastSettlement` is non-null
(`lib/world/types.ts:443`); before a fresh world's first settlement the category does not appear.

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

A row never applies an action in place. Nothing on this bar is dismissible, so a click that both acts
and clears the row would be indistinguishable from dismissal — the one gesture this design does not
have. EU5 can afford click-fires-an-effect only because right-click dismisses sits beside it to
disambiguate. The pull is strongest on the two opportunity categories, and weakest on inspection:
their proposals are already ranked on the system's own construction surface, so navigating there *is*
the apply flow, with the ROI context the decision needs.

| Category | Destination |
|---|---|
| Famine, Strike, Deprived worlds, Unrest rising, Overcrowded, No housing headroom | system → `population` |
| Industry idle, Build blocked, Build opportunity | system → `industry` |
| Demand unservable, Survival stock falling | system → `logistics` |
| Colony opportunity | system → root |
| Maintenance unfunded | the faction panel — the row is faction-level, not a system |
| Crisis, Disruption, Windfall | the system when the event has one, else the events panel |

The five system tabs that exist are `population`, `industry`, `logistics`, `market` and `astrography`,
plus the system root. `ActiveEvent.systemId` is `string | null` (`lib/types/game.ts:290`; the
persisted `WorldEvent` shape matches at `lib/world/types.ts:462`) — region-level events have no
system, which is why that row is the one conditional destination.

Two mechanical notes for the implementation. The Tracker's `activate` is typed `"" | "industry"`
today (`components/tracker/tracker-panel.tsx:115`) and widens to the five tab segments. The two
non-system destinations do not use it at all — Maintenance unfunded and a region-level event navigate
without a map focus, because there is no system to fly to.

A row's right-hand edge is left free for a later secondary action, so an opportunity row can grow a
direct "build it" without redesigning the row. Not built now.

Only one flyout is open at a time, Escape closes it, and clicking away closes it.

### Settings

A per-category panel from the control at the end of the run: a checkbox per category grouped by tier,
persisted in the browser as a view preference, not in the save. **The critical tier cannot be turned
off** — that is the small non-hideable set. Three important-tier categories default off; the defaults
table above is the single authority. Toggling does not close the panel.

### What the engine must newly emit

Four signals have no producer in the code today, and this is the bulk of the work.

**First, the carrier — because it is not free.** A processor has exactly three exits and two of them
cannot reach a read service. `ctx.results` is a per-tick Map discarded at the end of `runWorldTick`
(`lib/tick/types.ts:40`). `TickInstrumentation` is a closed `Pick` whose docstring reads "Transient,
calibration-only … never broadcast or folded into `World`. The calibration harness is the only reader"
(`lib/tick/types.ts:220-233`). SSE carries three fixed payload arrays (`:31`). Every read service
calls `getWorld()`. **So each signal below is persisted world state**, written by its producing
processor and read by nothing inside the tick.

Every one of them follows the same three conventions, stated once here rather than four times below:

- **Absent means never assessed, not zero.** Carried through `toTickSystems` and
  `mergeSystemsIntoWorld` by a delete/assign pair rather than an object literal, so absence stays a
  true absence (`lib/world/tick.ts:206-216`, `:263-272`).
- **Set-and-clear, never append.** On every run the field is written for every entity the run visited
  — the value where the condition held, **absent where it did not** — so a system that stops being
  blocked clears on the next run. An entity the run did not visit keeps its previous value.
- **Reset with the world.** Each joins `applyAbandonments` (`lib/world/tick.ts:559`) beside
  `provision` / `supplyBand` / `criticalWeight` / `provisionExpectation`, and `applyDevelopments`
  (`:533`) on any flip to `developed`. `logisticsFundingBound` already does exactly this on the market
  side (`:601`). Without it a re-founded colony carries its predecessor's readings — a present-but-false
  value, which is precisely what the absence convention exists to prevent.

The four:

- **The per-cycle population delta**, per system. `populationDelta` is computed every cycle
  (`lib/tick/processors/population.ts:106`) and thrown away — only the resulting `population` is
  written — so nothing in world state says whether a world is growing or shrinking. Without it, Famine
  has no way to tell a world sliding toward abandonment from one merely short this cycle, and every row
  falls back to sorting by shortfall depth.

  **What is persisted is the realised change in `population` including migration**, computed as
  `population_after_migration − population_at_cycle_start` and written by the tick body after the
  migration stage — *not* the population processor's `delta`. `populationDelta`
  (`lib/engine/population.ts:458-473`) is growth − decline − overshoot-death with no migration term,
  and migration runs afterwards in the same tick; on a dying colony departures are a real and often
  dominant drain. Persisting the biological delta alone would systematically understate the collapse.

  **The sort measure is time to abandonment, not the decline rate alone.** `k = −delta / population` is
  the fractional decline rate per cycle, and because population falls proportionally rather than by a
  fixed amount — a world going from 50 to 1 takes far longer than subtraction suggests — the countdown
  is `ln(population / ABANDON_POP_FLOOR) / k`, an exponential time-to-empty. The obvious
  `(population − ABANDON_POP_FLOOR) / −delta` was tried first and rejected: every term of the delta
  scales with population, so on a famine world that linear expression collapses to roughly
  `(1 − 1/pop) / (declineRate·unrest + …)` and orders by unrest rather than by collapse speed; the
  logarithmic form has no such failure. It is undefined at the same edges the rate itself is — `delta
  === 0` gives `k = 0` and an infinite countdown, `delta > 0` gives a negative `k` and a negative
  countdown — and those cases are excluded by the condition rather than guarded in the formula: a
  famine world that is not shrinking carries no countdown at all, and sorts after the shrinking ones,
  by shortfall depth.

  Denominated **per reference cycle**, matching `delta`'s own denomination rather than the
  `delta × catchUpFactor` a single run applies — the two are equal only while `CYCLE_LENGTH` (24)
  equals `REFERENCE_INTERVAL` (24), and `CYCLE_LENGTH` is a documented knob.

  **Hazard 1, stated up front:** this is authored for one job — Famine's time-to-abandonment sort. It
  is obviously attractive to the Tracker's rows, the Population panel, and the queued unrest-history /
  recovery-forecast work. Those are welcome to read it, but any of them wanting a *different* shape
  (a trailing average, a longer window) must add their own rather than redefining this one. That is
  precisely how `TARGET_COVER` and `demandRate` happened.

- **The per-cycle survival stock delta**, per (system, good), for `SURVIVAL_GOODS` only
  (`lib/constants/physical-economy.ts:153` — water and food). Stock is the right base because
  directed logistics lands its hauls as stock deltas, so a falling stock is production minus
  consumption *after* imports; the purely local `honestUseRate > realizedProductionRate` would fire on
  every importer, which in a specialised economy is most of the galaxy by design. Cycles-to-empty is
  then `stock / −delta`, and the alert's threshold on it is `cycles-to-empty < 3`, authored from remedy
  time rather than read off a distribution — see the tier list's Survival stock falling entry and
  `## Evidence` for the reasoning and the sanity-check reading.

- **Build blocked.** The planner drops an opportunity it wanted with a bare `continue`, recording
  nothing. The drop is not one site but several, and the two the first cut named are not the important
  ones: `:737 if (capUnits <= 0)` — the literal "no capacity" case, and the one that fires *before*
  ranking, so a fully-saturated system produces no opportunities at all and therefore never reaches
  the later sites; `:738` no reachable input supplier — a reason the original list of three omitted;
  `:744` no reachable consumer; `:762` non-positive score; then `:775`, `:778`, `:790`, `:824`
  (`if (maxLevels < 1) continue`) and the `:874` fit search. It must emit, per system, the reason the
  best-ranked dropped opportunity failed plus the ROI of what was dropped, for the within-category
  sort. **Housing refusals are not in scope here** — `plannedHousingUnits` (`:186-199`) is a separate
  path and its refusals belong to *No housing headroom*.

- **Demand unservable.** No `residual` or `unserved` quantity exists in
  `lib/engine/directed-logistics.ts`. A system whose deficit cannot be closed by any reachable donor
  *or* by local production must be distinguishable from one merely waiting on the work budget, which
  `logisticsFundingBound` marks (`:173`). The shape matters and differs from that precedent:
  `logisticsFundingBound` is per (system, good) and is written to **both endpoints** of a
  funding-bound haul including the donor (`:170-175`), so a signal copying it would put exporting
  systems in a category about unmet local demand. Emit per (system, good) on the **deficit endpoint
  only**. A system unservable in three goods counts once — the chip counts systems.

**One more, outside the four, in `industry.ts`.** Industry idle's "missing inputs" case has no
producer: `IdleReason` is exactly five values (`lib/engine/industry.ts:544`) and is only assigned when
`used < count`, where `used` for a producer is staffed-and-selling capacity. `inputGate` is computed
on the same rows and reaches `output` and nothing else, so a factory that is fully staffed, freely
selling and producing nothing because its inputs never arrived reads as *fully used*, with no idle
reason at all. Add a sixth `IdleReason` derived from `inputGate < 1` and thread it into `used` so the
building actually reads idle. It is the most actionable of the three idle causes — a supply-chain
failure the player can fix by building the supplier or the route — where "no staff" often cannot be
fixed at all.

**Build blocked sorts by authored reason severity, not by the dropped ROI.** The first cut said "sorts
by the ROI of what was dropped", and that measure has no producer. Four of the planner's nine drop
sites fire *before* anything is scored, so no opportunity object exists and there is nothing to
divide: `no-input-supplier` is **always** 0, a saturated `no-capacity` is always 0, and the
pre-ranking branch of `no-consumer` is too — while `no-whole-level` and `no-labour`, the two
near-miss reasons, always carry a real figure. Sorting on it puts the least-blocked systems first.
And the figure itself is annotated **"Ordering only"** where it is defined: it sums served quantity
over route cost across goods whose `OUTPUT_PER_UNIT` differs by orders of magnitude
(`lib/constants/industry.ts:208`), so it was built to rank candidates inside one planner run and was
never a value comparable between systems.

So the five reasons are ranked at design time, exactly as the event bands are, in
`BUILD_DROP_SEVERITY: Record<BuildDropReason, number>` beside the category registry. Worst first
means most-blocked first — a system that can build nothing at all outranks one that lost a marginal
factory to a better-ranked rival:

| Rank | Reason | Why here |
|---|---|---|
| 1 | `no-capacity` | Nothing can be built at all; the site is saturated. |
| 2 | `no-input-supplier` | The chain is broken upstream — actionable, and it blocks every level of the good. |
| 3 | `no-consumer` | Nothing reachable wants it; a routing or territory problem. |
| 4 | `no-labour` | The site is viable and the population is not there yet. |
| 5 | `no-whole-level` | The near miss — capacity exists but not a whole level of it. |

`droppedRoi` is still emitted and still shown as the row's measure, but it is a **tiebreak within one
reason only**, never the primary key, because it is not comparable across goods. Where it is 0 for
every row in a reason, the order inside that reason is the stable authored one.

**Build opportunity sorts survival-serving builds first, then by the planner's own score.** "Sorts by
ROI" was the first cut and had no producer: there is no build-side ROI anywhere. The only ranking
figure the planner computes is `BuildOpportunity.score` (`lib/engine/directed-build.ts:596-597,
850-856`) — for each reachable system short of the good, the units this site could actually supply
them, divided by route cost, summed. That is a real and useful measure of *where building would close
unmet demand*, and it is what this category sorts by inside a band.

It carries one bias, stated rather than hidden. `score` counts units, and a unit means a different
amount of capacity per good: `OUTPUT_PER_UNIT` runs from 0.6 (`ship_frames`) to 8.0 (`gas`), a **13×
spread** across all 26 goods (`lib/constants/physical-economy.ts:29-56`, six overrides at
`lib/constants/industry.ts:200-206`; `ECONOMY_SCALE` scales all of them uniformly and does not touch
the ratio). So the list skews toward the bulk end of the economy and ranks shipbuilding and military
opportunities lower than the capacity they represent. Every system on the list still genuinely has
reachable unmet demand it could serve — `take` is bounded by the real shortfall — so the skew costs
order, never correctness, and on an informational chip that only appears with automation off that is
an accepted trade. **The order is not a value ranking and must not be read as one.**

What `score` does **not** carry is necessity: a hundred units of unmet food and a hundred units of
unmet luxuries contribute identically, and nothing in the planner consults `SURVIVAL_GOODS`
(`lib/constants/physical-economy.ts:153`) — the pair whose shortfall alone sets the Famine band. So
the category bands before it sorts:

| Band | Contents |
|---|---|
| 1 | the system's best opportunity **serving a survival good** — water or food |
| 2 | its best opportunity otherwise |

A system with any survival-serving opportunity is represented by that one and ranks above every
band-2 system, whatever the scores say; inside a band the order is `score`, highest first. This is
the same move `BUILD_DROP_SEVERITY` and `EVENT_BAND` make — where two quantities are not comparable,
author the band and sort within it rather than inventing an exchange rate between them. It needs no
tuned constant, which is the point: a survival-good multiplier would be a magic number standing in
for a decision, and the decision is simply that feeding people outranks not feeding them.

**That fold is local to the readout, and deliberately does not reach decay.** There are two `used`
values: `buildIndustryReadout`'s, which the panel and the alert service read, and
`computeSystemDecay`'s, which decides what is torn down. Both dispatch through `buildingUsed`, whose
producer branch is `count × min(effectiveFulfilment(state, tier), canSell)`
(`lib/engine/industry.ts:430-435`) — staffing and skill licence are in it, `inputGate` is not, and
decay's `SystemDecayInput` (`lib/engine/infrastructure-decay.ts:51-64`) carries no market stock to
compute one from. Giving decay that visibility would need a new per-(system, good) signal out of the
economy processor and a new field on `SystemDecayInput`.

**It is not wired, by decision.** Decay eating a factory whose inputs merely have not arrived
destroys the capacity the alert exists to rescue, and it is the one idle cause the player can
straightforwardly fix. So the missing-inputs row clears by fix alone; the staffing and licence rows
keep clearing by decay exactly as they do today.

That leaves the Industry panel needing a word for a building that is genuinely idle and will never
shed a level, so `IndustryHealth` carries a fourth state, **`idle`**, between `stable` and
`contracting`. `contracting` means the decay engine is about to remove a level and is reserved for
the causes it can actually see; `idle` names the input-starved case, which it cannot. Both the
per-building read and the system-level roll-up make the split, since the roll-up counted idle levels
off the same gated figure.

All of these are **read-only from the alert bar's point of view**: the bar reads them, and nothing in
the tick reads them back, so nothing about them changes what the tick decides. That is the property to
preserve at review — an alert that changes the simulation is a mechanic wearing a notification's
clothes. The bar itself writes nothing; the write edges belong to the processors.

### World state and saves

**The alert bar adds no *player* state.** Category visibility is a browser preference, not a save
field, so there is no per-player state at all. What the save gains is the seven persisted signals
above: the population delta, the blocked-build reason + dropped ROI, the ranked build opportunity and
the colony opportunity on `WorldSystem`; the survival stock delta and the unserved shortfall level on
`WorldMarket`; the latched per-band charges on `WorldTreasurySettlement`.

**No `SAVE_FORMAT_VERSION` bump is needed, and taking one would be actively wrong.** `save.ts`'s own
rule: "An additive OPTIONAL field that old saves can legitimately omit does NOT need a bump: the field
simply stays `undefined` on load, which is correct" (`lib/world/save.ts:6-10`). All seven are exactly
that shape, and "absent means never assessed" is not merely compatible with an unbumped load — it is
what makes it correct. A bump would reject every named save and the rolling autosave that Continue
loads (`:78`, `SAVE_FORMAT_VERSION` 13) and buy nothing.

One consequence to state rather than discover: on a save predating these fields every system reads
absent, so Survival stock falling shows nothing, and Famine's countdown sort has nothing to work from —
every famine row falls back to sorting by shortfall depth — until the first economy cycle after load.
That is correct, and it is not a bug.

**Absence is not zero, for every category, not just two.** `provision`, `supplyBand`,
`criticalWeight` and `provisionExpectation` are all absent on a system the economy has never assessed,
and that is deliberate (`lib/world/types.ts:99-141`). The rule generalises: **a system with any of the
fields a category reads absent does not appear in that category** — it has no reading, not a bad one.
This is the trap the Tracker already handles at `lib/services/tracker.ts:65`.

Per category, the nullable inputs that rule governs:

| Category | Nullable inputs | Absent reads as |
|---|---|---|
| Famine, Deprived worlds | `supplyBand` | not in the category |
| Famine (countdown sort only) | population delta | absent reads as **not shrinking** — the row still appears, gated by `supplyBand` alone, with no countdown; it sorts after the shrinking ones, by shortfall depth |
| Unrest rising | `provision`, `provisionExpectation` | not in the category — **and this one matters**: `readExpectation` seeds a missing memory from this cycle's own Provision and floors the result at `EXPECTATION_PARAMS.floor` (0.5), so a never-seeded system would otherwise report grievance `max(0, 0.5 − provision)` — falling short of a floor it has no memory of. The category requires a real stored `provisionExpectation`. |
| Overcrowded, No housing headroom | `popCap` | `popCap === 0` reads as not overcrowded, matching `lib/services/tracker.ts:60` |
| Survival stock falling | survival stock delta | not in the category |
| Build blocked, Demand unservable | their own emitted fields | not in the category |
| Maintenance unfunded | `lastSettlement` | category does not appear |

## Design hazards — filled

Per `.agents/skills/shared/design-hazards.md`. This is not a pure-UI change — several categories
require new tick instrumentation — so every row is filled.

### 1. One quantity, several unrelated jobs

Reader counts are `npm run impact -- <SYMBOL>` results, not recollection. The first cut of this table
named module *subsets* from memory and was 3-5× short on four of its six rows, which is the exact
shape the hazard exists to catch.

| Quantity | Every reader today | Which this design moves | Intended? |
|---|---|---|---|
| `supplyBand` | 15 refs / 7 modules: population processor + adapter, `rows`, `population-world`, `world/tick`, `world/types`, `provision-map`, `provision-read` | **None.** Adds one reader (the alert read service). | Yes — pure read |
| `provision` / `provisionExpectation` | **71 refs / 23 modules.** Largest is `lib/services/system-population.ts` (10×); then the whole Pixi choropleth stack (`value-ramp`, `value-choropleth-layer`, `number-aggregation`, `pixi-map-canvas`, `star-map`, `map-overlay-controls`), `app/(game)/@panel/system/[systemId]/page.tsx` (9×), `app/api/game/systems/provision/route.ts`, `lib/hooks/use-provision.ts`, `lib/services/tracker.ts`, plus the population engine + processor, `provision-read`, `provision-map` | **None.** Read for Deprived and Unrest rising. | Yes — pure read |
| `unrest` | **101 refs / 31 modules.** `npm run impact` additionally flags **`economy` (3/9 in run order) as touching `unrest` without declaring it as a read** — an undeclared writer, so what a reader sees depends on run-order position | **None.** | Yes — pure read |
| `popCap` | **68 refs / 21 modules** | **None.** | Yes — pure read |
| `logisticsFundingBound` | **27 refs / 9 modules**: `directed-logistics.ts:152,173`, `directed-build.ts:340`, `industry.ts:402,432,663,698,730,794`, **`infrastructure-decay.ts:63,119`**, `services/universe.ts:199,241`, `tick/processors/directed-logistics.ts:195-199`, `tick/processors/good-market-state.ts:186`, `tick/processors/infrastructure-decay.ts:49,65`. `directed build` is flagged as an **undeclared writer** at 7/9 | **None**, but Demand unservable must not be confused with it — funding-bound is *temporary*, unservable is structural. Two conditions, two signals, and the new one is per (system, good) on the deficit endpoint only. | Yes, and stated |
| `STRIKE_PARAMS.threshold` | Strike suppression (`lib/services/system-population.ts:119` and the population engine) **and** the overshoot-death gate: `POPULATION_PARAMS.overshootDeathUnrestGate: STRIKE_PARAMS.threshold` (`lib/constants/population.ts:130`) → `lib/engine/population.ts:470` | **None** — but the coupling is real and kept deliberately, and it moved rather than went away. A system crossing 0.65 enters the Strike chip *and* acquires the death term that now dominates the population decline rate behind Famine's time-to-abandonment sort — the same coupling that used to reach Colony dying's measure reaches Famine's instead. Moving the constant still moves both. | Yes, and stated |
| *(new)* blocked-build reason + dropped ROI | none — new | New quantity on `WorldSystem`, sole reader is the alert read service. | Yes |
| *(new)* population delta, survival stock delta, structural-unservable bit | none — new | New quantities, sole reader is the alert read service. | Yes |
| *(new)* event valence band + impact rank | none — new | New per-type authoring, read by the alert read service. | Yes |

The design's whole posture on this hazard: it **adds readers and moves nothing**. The one place that
could go wrong is the new signals acquiring tick-side readers later, which is why they are specified
as emitted-and-read-only. Every newly-surfaced reader above is pure-read and unmoved — including
`infrastructure-decay.ts`'s use of `logisticsFundingBound`, which matters because decay is the system
row 3 previously answered "None directly" for.

The two undeclared writers (`economy` on `unrest`, `directed build` on `logisticsFundingBound`) change
nothing for this design — the alert service reads after the tick completes — but they are recorded
because a reader that ran *inside* the tick would see different values depending on position.

### 2. A constant read for a meaning it was not authored to have

Docstrings quoted, not paraphrased — the hazard's shipped instances are all cases where a paraphrase
dropped the clause that mattered.

| Constant | Docstring says | This design uses it as | Same? |
|---|---|---|---|
| `ABANDON_POP_FLOOR` (`lib/constants/population.ts:133-141`) | "Abandonment's death line… famine + population below one pop — under a million people — means the colony is over. **A backstop, deliberately un-tuned: no window, no calibration sweep owns this number.**" | the line Famine's time-to-abandonment countdown counts down to | **Yes, and the consequence is accepted rather than hidden.** The countdown reads the constant for exactly its authored meaning — the line at which abandonment actually happens — which is the right reading. But the docstring also says the constant is deliberately un-tuned with no calibration sweep owning it, and the countdown now targets it directly (an earlier draft of this design kept it out of the sort for exactly this reason). A future re-tune of this backstop moves Famine's sort order, not just the abandonment gate. That coupling is new, and it is a stated cost of the countdown rather than an oversight. |
| `STRIKE_PARAMS.threshold` (`:72-79`) | "Strike production-suppression regime derived from unrest… Threshold raised to 0.65 so only genuinely high-unrest systems strike" — says nothing about population death | the Strike category's condition | Yes for Strike. But see row 1: the constant has a **second, undocumented job** as `overshootDeathUnrestGate`, which couples it to Famine's sort measure. |
| `EXPECTATION_PARAMS.floor` (`:85-88`) | "'No population normalises living on half of what it needs.' Applied at read as `max(stored, floor)` — the stored value itself is never floored. Independent of `SHORTAGE_SATISFACTION` despite the equal value… Do not couple them." | nothing directly — but it silently shapes Unrest rising, because `readExpectation` floors the effective expectation and seeds a missing memory from this cycle's own Provision | **Not the same**, and handled: the category requires a real stored `provisionExpectation`, so a never-seeded system is excluded rather than reported as falling short of a floor it has no memory of. |
| `CROWDING.BRAKE_END` / `PRESSURE_MAX` (`:64-70`) | "Overcrowding shape **shared by the growth brake and the standing crowding-pressure ramp.** BRAKE_END is r = population/popCap at which growth reaches zero and crowding pressure reaches its max" | neither is a condition or a threshold here | n/a — and the shared job is why the measured utilisation band is so narrow: growth is braked to zero at 1.15, so nothing travels far past 1.0. That is mechanical, not incidental. |
| `supplyBand === "famine"` | `foldSupplyState`'s survival punch-through; the docstring states it is a **strict biconditional** with `survivalShortfall` (`lib/world/types.ts:131-133`) | the Famine category's condition, read directly rather than re-inferred | Yes — verified at the producer too: `foldSupplyState` (`lib/engine/population.ts:257-262`) returns famine only from the survival branch, so it holds in both directions |
| `criticalWeight` | crisis-term input; explicitly **not** inferable from `supplyBand`, and deliberately not clamped to [0,1] | **not used** — no category reads it | n/a |
| `SURVIVAL_GOODS` (`lib/constants/physical-economy.ts:153`) | `["water", "food"]` — the goods whose shortfall alone sets the Famine band | the scope of Survival stock falling | Yes — the same pair, used for the warning ahead of the state |

No constant is being read for a new meaning. Deprived reads the band, not a Provision number against
an invented threshold; Overcrowded reads `popCap` as the housing that exists, which is what it is.

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | **Three categories are events.** Needs a new authored valence band **and impact rank** per event type, over all **seventeen** `EventTypeId` members including the two child types that spread from parents. `EventDefinition` (`lib/constants/events.ts:68-79`) has no severity or valence field at all — `weight` is spawn frequency; the `severity` fields belong to `SpreadRule` (`:51`) and to the instance (`lib/world/types.ts:469`). Event categories are scoped to the player's faction and count **instances, not systems**. | — |
| Population + migration | Reads `population`, `popCap`, `provision`, `provisionExpectation`. **And writes**: the persisted per-cycle population delta is the realised change *including* migration, so it is computed by the tick body after the migration stage — `populationDelta` (`lib/engine/population.ts:458-473`) carries no migration term, and on a dying colony departures are often the dominant drain. | — |
| Unrest / regime | Reads `unrest` against `STRIKE_PARAMS.threshold`, and grievance as `expectation − provision` (`grievanceShortfall`, `lib/engine/population.ts:295`). Writes nothing. The threshold's second job as `overshootDeathUnrestGate` couples Strike to Famine's sort — see row 1. | — |
| Industry + staffing | Industry idle reads existing per-building idle reasons **and needs a sixth**: `IdleReason` (`lib/engine/industry.ts:544`) has no input-starvation member, so an input-gated factory reads as fully used. Build blocked's labour case reads the planner's own fit gate. | — |
| Infrastructure decay | **Decay is the clearing mechanism for Industry idle's staffing and licence causes, not their consequence** — the direction was stated backwards in the first cut. `idleLevels = floor(count − used)` (`lib/engine/infrastructure-decay.ts:95`) accrues a countdown while ≥ 1 and tears the level down; `used` then equals `count` and `idleReason` clears (`lib/engine/industry.ts:790`). So the row disappears when the capacity is destroyed. Accepted deliberately — decay is a mechanic the player is expected to know, and the flyout does not explain it. **The missing-inputs cause is the exception and clears by fix only**: decay's `used` comes from `buildingUsed`'s producer branch (`lib/engine/industry.ts:430-435`), which reads `effectiveFulfilment` and `canSell` but never `inputGate`, and decay's own `SystemDecayInput` carries no market stock to compute a gate from — so an input-starved factory is never torn down. That is a decision, not an oversight; see the emission section. Decay also reads `logisticsFundingBound` (`:63,119`), which row 1 now records. | — |
| Directed logistics | Demand unservable is new instrumentation here, per (system, good) on the deficit endpoint only — unlike `logisticsFundingBound`, which is written to both endpoints of a funding-bound haul (`lib/engine/directed-logistics.ts:170-175`). Survival stock falling reads persisted `stock` plus a new per-cycle stock delta. | — |
| Directed build / planner | Build blocked is new instrumentation here, across the full drop set rather than two sites. Build opportunity reads the ranked proposals, gated on the automation switch. Note the assessment runs for **every** faction regardless of `world.player` (`lib/tick/processors/directed-build.ts:450`) — the switch gates proposal *emission*, not the clock. | — |
| Colonisation + founding manifest | Colony opportunity reads eligibility. No write path. | — |
| Treasury / purse | Maintenance unfunded reads `paid.maintenance` against **`WorldTreasurySettlement.charged.maintenance`** — the band the settlement was *asked* to pay, latched at that settlement. Testing against the full bill would fire on any maintenance slider below 1.0, a legal player setting floored at 0.5: `settleLadder` computes `charge = bill × slider; pay = min(charge, available)`, so `paid < bill` is true whenever the slider is down. Insolvency is `pay < charge`. Testing against the LIVE `treasury.bands.maintenance` is equally wrong in the other direction: the player verb writes the slider with no re-settle, so moving it flips the alert on a settlement that never changed. `settleLadder` reports `charged` per band and the treasury processor persists all three; `bandShortfall` (`lib/engine/treasury.ts`) is the single test, shared with the treasury and construction cards so no two surfaces can disagree, and it uses no live slider at all and skips a settlement that predates the field. | — |
| Factions + relations | `border_conflict` arrives as an event via the relations processor (`lib/tick/processors/relations.ts:34-37`); it lands in Crisis. The three relations-owned events scope to pairs the player's faction is in. **No war state exists** to interact with. | — |
| **Abandonment (tick body)** | Every persisted signal this design adds joins the resettlement reset: deleted in `applyAbandonments` (`lib/world/tick.ts:559`) beside `provision` / `supplyBand` / `criticalWeight` / `provisionExpectation`, deleted again on any flip to `developed` in `applyDevelopments` (`:533`), and threaded through `toTickSystems` (`:206`) and `mergeSystemsIntoWorld` (`:263`) by the same delete/assign pair so absence stays a true absence. Without it a re-founded colony carries the dead world's death rate. `logisticsFundingBound` already does this on the market side (`:601`). | — |
| Save format (`World` shape) | **Seven new optional fields** — `populationChange`, `buildBlocked` (reason + dropped ROI), `buildOpportunity` (score + good) and `colonyOpportunity` (value + work) on `WorldSystem`; `stockChange` and `unservedShortfall` on `WorldMarket`; the latched per-band `charged` on `WorldTreasurySettlement`. Unservable demand is the shortfall level alone — absent or zero means servable — not a level paired with a separate bit. All additive and optional, so **no `SAVE_FORMAT_VERSION` bump** (`lib/world/save.ts:6-10`). Settings stay a browser preference, so no new *player* state. Contrast the Tracker, which added `pinnedSystemIds` and nothing else. | — |
| The harness's own metrics | **None** — but not for a player-seat reason. The directed-build assessment runs for every faction whether or not `world.player` exists (`lib/tick/processors/directed-build.ts:450`), so the Build-blocked drop sites execute on every harness run; the spec's own Evidence measured 367,449 drops inside exactly that path. Inertness rests on nothing in the tick **reading** any new field, and on the four conservation identities being treasury/founding-scoped — none reads `population`, `popCap`, `buildings` or `stock`. The gate: `npm run simulate` at both horizons must be numerically identical before and after the instrumentation lands. | — |

### 4. A symptom asserted without a measurement

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| `supplyBand === "famine"` iff `survivalShortfall` | `lib/world/types.ts:131-133` docstring, confirmed at the producer `lib/engine/population.ts:257-262` | code | — |
| The planner drops blocked opportunities with no record | `lib/engine/directed-build.ts:737, 738, 744, 762, 775, 778, 790, 824, 874` — nine sites, none recording | code | — |
| No unserved/residual signal exists in logistics | grep of `lib/engine/directed-logistics.ts` — no `residual` or `unserved` symbol | code | — |
| `logisticsFundingBound` has no `components/` reader | `directed-build.ts:340`, `industry.ts:402` and seven more (row 1); `services/universe.ts:199,241` reads it to build engine accessors, which is not a UI read | code | — |
| No war state exists | every `war` identifier in `lib/` is a comment, a fog-of-war name, or a future-layer note | code | — |
| Grievance is derivable without new history | `grievanceShortfall(expectation, provision)`, `lib/engine/population.ts:295`; both fields persisted | code | — |
| `IdleReason` has no input-starvation member | `lib/engine/industry.ts:544` — five values, assigned only when `used < count` | code | — |
| An additive optional field needs no save bump | `lib/world/save.ts:6-10` docstring | code | — |
| Per-category incidence | Deprived 0.4% → 0.0%; Unrest rising 13.8% → 22.3%; Overcrowded (over cap) 7.9% → 98.6%; Industry idle 2.0% → 34.5% | 1,000t **and** 10,000t | developed systems, with a per-faction breakdown showing the same rates inside the largest factions |
| **"Blocked builds are rare by construction" — FALSE** | 50.40% of developed systems per planner run (mean), peak 81.62% | 10,000t, startup ticks excluded | developed systems, per planner run |
| The Colony-dying-vs-Famine overlap falsifier | **Measured at Gate 1 and withdrawn as invalid.** 100% of famine-banded developed systems carried a negative `populationChange` at equilibrium (7 of 7), 50% at startup (2 of 4) — it fired, but licenses nothing about the category's existence | startup (1,000t) and equilibrium (10,000t) | famine-banded developed systems |
| Survival stock falling's threshold | **Authored from remedy time, not measured** — `cycles-to-empty < 3`. The measured incidence (6.7% → 2.4%) is a Gate 1 sanity check on that default, not its source | startup (1,000t) and equilibrium (10,000t) | developed systems |

The first eight are code facts. The next two are the measured findings from spec review — see
`## Evidence`, where each carries its instrument, both horizons and a `Licenses` line. The last two were
settled at Gate 1: the Colony-dying overlap falsifier fired and was withdrawn — it measured a
near-tautology, not whether Colony dying earned its own chip, and the category was dropped for a
structural reason unrelated to this number; the Survival stock falling threshold is authored from
remedy time, with its Gate 1 reading serving only as a sanity check on the volume it selects.

### 5. Designing against a threshold or primitive that does not exist

| Consumes | Produced at | Actual shape today | Design assumes |
|---|---|---|---|
| Famine | `foldSupplyState`, `lib/engine/population.ts:262`; persisted `supplyBand` | `"famine"` only via the survival branch; **absent when never assessed** | matches |
| Deprived band | same fold, persisted | four descriptive bands; famine punches through at any Provision | matches — Deprived is a band, not a Provision cutoff |
| Strike | `system-population.ts:119`, `unrest > STRIKE_PARAMS.threshold` | boolean derived at read time | matches |
| Famine (time-to-abandonment sort) | `lib/tick/processors/population.ts:111` reports systems already below the floor; `populationDelta` at `:106` is computed and discarded | reports **crossings**, not a countdown; the delta exists for one statement and is never written, and carries **no migration term** | **RESOLVED by persisting the realised post-migration change** — see the emission section. The measure is `ln(population / ABANDON_POP_FLOOR) / k`, `k = −populationChange / population`: an exponential countdown to the real abandonment line, not the linear extrapolation `(pop − floor) / −delta` first proposed, and not the bare decline rate `−delta / population` proposed after that. A famine world that is not shrinking carries no countdown and sorts after the shrinking ones, by shortfall depth. |
| Maintenance unfunded | `WorldTreasurySettlement`, `lib/world/types.ts` | `paid` per band, post-slider, plus `charged` — what the ladder asked each band for, latched at the same instant | **RESOLVED by latching the charge**. `paid` alone cannot distinguish a legal low slider from insolvency, and the live `bands.maintenance` is not the settlement's own slider — it moves with no re-settle, so the two terms have to come from one frozen row |
| Unrest rising | `grievanceShortfall`, `lib/engine/population.ts:295`; `readExpectation`, `lib/engine/expectation.ts:43-52` | `max(stored, floor)` − provision, and a **missing memory is seeded from this cycle's own Provision** | matches only with the never-seeded guard — the category requires a stored `provisionExpectation` |
| Overcrowded | `population`, `popCap` — both persisted `WorldSystem` columns | `popCap` recomputed live from surviving housing each cycle | matches |
| No housing headroom | `habitableHousingHeadroom`, `lib/engine/directed-build.ts:213-220` | a fractional housing-**unit** count, range [0, ∞); the planner's own `< 1` test means "no room for even one whole level" (`:239`). But the planner never calls it on raw state — `effectiveBuildSystems` (`:297-333`) folds open `build` projects in first, and is **not exported** | matches only against **queue-adjusted** buildings, and the fold is monotonically *downward*, so it moves systems into the category rather than out of it — "relief already in flight" is a separate conjunct, not something the adjustment provides. Needs a shared exported helper: this is the third copy of the fold |
| Survival stock falling | `stock`, `honestUseRate`, `realizedProductionRate` — all persisted (`lib/world/types.ts:288-322`) | present; but no **stock delta** exists | new instrumentation (small) |
| Industry idle | `IdleReason`, `lib/engine/industry.ts:544` | five members; assigned only when `used < count`, and `used` for a producer is staffed-and-selling capacity, so input starvation is invisible — `inputGate` reaches `output` (`:786`) and nothing else | **partly missing** — skill-licence and staffing ship; missing-inputs needs a sixth member from `inputGate < 1` |
| Build blocked | **does not exist** | — | new instrumentation, across nine drop sites |
| Demand unservable | **does not exist** | — | new instrumentation |
| Event valence + impact rank | **does not exist** | `EventDefinition` has neither | new authoring, over all seventeen types |

The Famine time-to-abandonment row is the original hazard-5 catch: first authored under the name Colony
dying, whose condition said "sorts by cycles to the floor" against a processor that only reports
systems already past it. Colony dying was later dropped as its own category, and the same corrected
sort measure now belongs to Famine instead. Three more rows joined it at review — Maintenance unfunded,
Industry idle and No housing headroom each consume something whose real shape differs from what the
first cut assumed.

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
reported per faction. Claim B additionally used a temporary counter at **two** of the planner's drop
sites, reverted in the same turn (`git checkout -- lib/engine/directed-build.ts`, verified by grep).

Instrument validated before reading: the runner reports an absent Claim-B counter as **NOT MEASURED**
rather than as zero — a counter that never fires and a mechanism that never fires look identical, and
the first run exercised exactly that branch.

**Two notes on reading the raw block below, added at spec review.** The `[default OFF]` annotations
are what the runner printed at the time and record the defaults *as they then stood* — three of them
have since changed; the defaults table above is the authority. And the Overcrowded line is the
near-cap definition (`≥ 90%`), superseded by the re-measure that follows.

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
Licenses:   Supports Build blocked defaulting OFF, and kills "rare by construction". It is a bound in
            BOTH directions and neither is tight. A SUPERSET of systems entirely blocked: the counter
            records a system where at least one opportunity was dropped, not one where nothing could
            be built. A SUBSET of blocked opportunities: only two of the planner's nine drop sites
            were instrumented, and the omitted ones include :737 (`capUnits <= 0`, the literal "no
            capacity" case) which fires BEFORE ranking — so a fully saturated system produces no
            opportunities and contributes no drops at all. Correcting that widens the true rate; it
            cannot narrow it, so the default-off decision stands. Do not quote 50.4% later as a bound
            in either direction.
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

**Outcome: the near-cap definition is falsified.** Tightening the threshold from ≥90% to >100% does
not change the equilibrium rate — 98.6% against 99.0%.

**What the reading does not license, and what was originally read into it.** This measurement was
first taken as showing that "population against the cap is not a condition this game has, at any
threshold", and the design was reshaped around that: a second conjunct was added to select a rarer
set, and the default was set from the startup figure. Both moves treated a rate as evidence about a
*definition*, which it is not. `population > popCap` means there are people with no housing; that is
what the words mean, and no distribution can make it mean something else. What a 98.6% rate says is
that the galaxy currently fails that condition almost everywhere — a statement about the game, not
about the alert. See the finding immediately below, which is that same fact read the right way round.

**A finding outside this feature, worth surfacing on its own.** 7.9% → 98.6% is a drift across the
run, not a founding artefact. The design's stated intent is that *proactive housing leads* population
(`docs/SPEC.md`, Directed Logistics & Autonomic Agency), and at equilibrium it plainly does not — it
is behind almost everywhere. Whether that is benign (build and decay resting a hair over occupancy)
or real (housing chronically losing) turns entirely on the magnitude, which this reading does not
have. **Not booked, not diagnosed** — raised here because it was found here.

---

### Overcrowded — the condition, and why a rate cannot set it

**Two categories, both computable today.** Overcrowded is `population > popCap`. No housing headroom
is that, **and** no housing standing in the construction queue for this system, **and**
`habitableHousingHeadroom(sys) < 1` (`lib/engine/directed-build.ts:213` — the planner's own "can
another housing level physically be built here", evaluated against queue-adjusted buildings).

**The queued-housing conjunct, and the direction of the queue adjustment.** These are two separate
guards that read as one and are easy to collapse, so both are stated. The category means *nothing is
coming and nothing can come* — which is why its `Clears by` is world-resolves rather than fix — so a
system with a housing level already committed is excluded outright: it is building its way out, which
is exactly the thing this category exists to say is impossible.

The queue adjustment does **not** do that job, and assuming it does gets the direction backwards.
`habitableHousingHeadroom` subtracts standing housing from both the habitable bound and the general
bound (`lib/engine/directed-build.ts:213-220`), and `generalSpaceUsed` only ever adds, so folding
queued levels in can only **lower** headroom — it moves systems *into* this category, never out of
it. The planner's own `effectiveBuildSystems` folds the same way for the same reason: don't propose
past a physical limit already spoken for. What the fold therefore earns its keep on, once queued
housing is excluded separately, is a committed **factory** eating the general space housing would
have needed — a real case, and the reason the answer is not simply to drop the adjustment.

They were one category with both conjuncts, and splitting them is the substantive change this section
records. Combining them meant a world was only called overcrowded once it *also* could not be fixed —
which is tolerable when the planner is building for you, but means the manual builder, with build
automation off, is told last, after every habitable slot is already gone. That player is the one who
needs the nudge. The two facts are separate warnings, and a system may raise both.

**The condition is definitional and no measurement can move it.** At `population === popCap` everyone
is housed and the next person is not; above it there are people with no housing, which is what the
word means. Padding the threshold to 110% to dodge brief population surges would buy noise-resistance
by making the alert mean something other than its name — hysteresis buys the same thing without
touching the meaning, and that is where it lives (see Placement and behaviour).

Incidence, for reference only and for **neither the condition nor the default**: over cap 7.9% at
1,000 ticks, 98.6% at 10,000. The equilibrium figure is high because mature systems run out of space,
a known separate problem already scheduled — but that is not why it is set aside. It is set aside
because many mechanics that will shape population are unbuilt, so any rule fitted to today's numbers
would encode an unfinished system. If nearly every mature world is genuinely over its housing cap, the
alert is right and the game is wrong.

**One quantitative note, and its status.** An unrecorded reading suggested nothing reaches `BRAKE_END`
(1.15) at either horizon and that the equilibrium band is roughly 0.034 wide. That is exactly the
distribution the re-measure's own `Licenses` line says it does **not** contain, and it has no
instrument, horizon or cohort recorded. It is retained here as an **unverified impression, not a
reading** — do not build on it. If it matters later it gets measured properly. The mechanism behind it
is not in doubt: `CROWDING.BRAKE_END` is shared by the growth brake and the crowding-pressure ramp
(`lib/constants/population.ts:64-70`), so growth is braked to zero at 1.15 and nothing travels far
past 1.0.

### Colony dying vs Famine overlap — the falsifier fired, and was withdrawn

This falsifier was pre-committed at spec review, in hazard 4: fold Colony dying into Famine if more
than 90% of famine-banded developed systems carry a negative `populationChange` at either horizon. It
was read at Gate 1, fired, and is recorded here so nobody re-runs it.

```
Meaning:    Most famine worlds are indeed losing population, but the number never bore on the
            question it was asked to answer. A world with no food loses population; a filter for
            "famine and shrinking" that selects almost the whole famine set is closer to a
            near-tautology than a discovery about whether these are two ideas or one.
Claim:      More than 90% of famine-banded developed systems carry a negative populationChange, at
            either horizon.
Number:     100% at equilibrium (7 of 7); 50% at startup (2 of 4).
Horizon:    startup (1,000t) AND equilibrium (10,000t)
Cohort:     famine-banded developed systems
Licenses:   Nothing about the category's existence. (a) It measures a near-tautology — a world with
            no food loses population — so it could never have discriminated between "these are two
            ideas" and "these are one". (b) It used a measured rate to decide a definition, which this
            spec's own rule on aggregates forbids. (c) Its ">90% at either horizon" wording let the
            seven-system equilibrium sample outvote the startup reading, which shows famine-but-stable
            worlds do exist (2 of 4 negative, not 4 of 4).
```

**Outcome: fired, and withdrawn as invalid.** Colony dying is deleted, but not because this falsifier
fired — it is deleted for the structural reason recorded in the tier list: it was never a warning ahead
of Famine, it was Famine far enough along to be terminal, which is sort order inside one category
rather than a second chip. The fold would have happened at any reading this falsifier produced.

### Survival stock falling — threshold from remedy time, volume as a sanity check only

The threshold is **not** read off a distribution. That framing (the earlier `## Evidence still owed`
item 3) repeats the exact error the falsifier above just demonstrated: a rate can set a default, never
a definition or a threshold standing in for one. The threshold is authored from **remedy time**: the
fix for a draining survival good is a redirected shipment, and shipments move on the logistics cycle —
one cycle for the matcher to see the deficit and route a haul, one for the goods to land, one of margin
for the player to notice and act. Three cycles. Below that the alert would be announcing a problem the
player has no time left to fix.

Simply falling is meaningless on its own: stocks oscillate, so over half of survival-good rows are
falling at any given moment. The countdown — cycles-to-empty below 3 — has to carry the whole
condition; direction alone cannot.

```
Meaning:    Under a 3-cycle threshold the category is a little more common than the state it leads —
            Famine — which is the right shape for a leading indicator: rarer would mean it seldom
            warns before famine hits, commoner would mean it is firing on ordinary noise.
Claim:      cycles-to-empty < 3 selects a plausible leading-indicator volume — more common than
            Famine, not by orders of magnitude.
Number:     6.7% of developed systems at startup, 2.4% at equilibrium, against Famine's own
            1.6% → 1.2%.
Horizon:    startup (1,000t) AND equilibrium (10,000t)
Cohort:     developed systems
Licenses:   Supports the existing default of ON, and confirms the authored threshold does not select
            an absurd volume. Does NOT set the threshold — the 3-cycle figure comes from remedy time,
            above, and would stand even had this reading come out differently. Does not license any
            other cycles-to-empty cutoff as "more correct" on volume grounds alone.
```

**Outcome: default confirmed, threshold unchanged by the reading.** Survival stock falling defaults ON
and its threshold is `cycles-to-empty < 3`.

### What the readings changed

- **Deprived defaults ON.** It is rare, which is exactly what makes it a good alert.
- **Build blocked defaults OFF**, and its justification is gone. It stays as a category — the reason
  it was wanted (automation's silent failures are the only signal there is) is unaffected — but it is
  now a category the player opts into, not one the design leans on.
- **Overcrowded became two categories, and its default stayed ON.** The readings did not set either
  the condition or the default here — the split came from the automation argument above, and the
  default was kept deliberately against a 98.6% equilibrium rate.
- **The horizon split is load-bearing for Industry idle**: 2.0% at startup against 34.5% at
  equilibrium. A startup-only read would have called it rare and defaulted it on.
- **Colony dying is deleted, and the falsifier that fired on it is withdrawn.** The category is gone
  for the structural reason in the tier list, not for the 100%/50% overlap reading — a second instance
  of the same lesson the next bullet states.
- **Survival stock falling's threshold is authored, not measured**, and the Gate 1 reading is a sanity
  check on the default rather than the threshold's source.
- **What the readings did *not* license, learned the hard way here:** a rate can set a default and can
  reveal that the game is not living up to a definition. It cannot set the definition. Two design
  moves in the first cut did exactly that and were reversed at review.

## Evidence still owed / now settled

1. ~~Category volume at ordinary play~~ — **measured**, see Evidence above. Moved Deprived to
   default-on and confirmed the other three.
2. ~~"Blocked builds are rare by construction"~~ — **measured and false**, see Evidence above.
   Superseded in scope: the counter covered two of nine drop sites, so the true rate is higher. The
   conclusion is unaffected.
3. ~~Survival stock falling's threshold~~ — **settled: `cycles-to-empty < 3`, authored from remedy
   time** (one logistics cycle for the matcher to route, one for the goods to land, one of margin to
   notice), not read off a distribution. See `## Evidence` → Survival stock falling. The measured
   incidence (6.7% → 2.4%, against Famine's 1.6% → 1.2%) is a Gate 1 sanity check on that default, not
   its source.
4. ~~Whether Colony dying is a meaningful subset of Famine~~ — **settled: Colony dying is deleted.**
   Not for the falsifier's number — it fired (100% at equilibrium, 50% at startup) and was withdrawn as
   invalid; see `## Evidence` → Colony dying vs Famine overlap — but for the structural reason recorded
   in the tier list: it was never a warning ahead of Famine, it was Famine far enough along to be
   terminal, which is sort order inside one category rather than a second chip. The persisted
   population delta survives regardless — Famine's time-to-abandonment sort needs it.
5. **`RATION_EXIT_EPS`.** Carried here by roadmap row 1 with no surviving justification unless band
   transitions become an alert category. They do not, so the constant is a delete unless something
   else claims it. Its open question — whether the hysteresis applies to the persisted display band
   only (presentational) or to the classifier itself (mechanical, since the regime feeds the unrest
   term) — is **not** answered by this spec's chip-level hysteresis, which is presentational and
   touches no classifier. Unverified; do not assume the first.

## Naming an unlabelled chip

Chips are icon-plus-count with no visible label, so a chip's **accessible name carries the category
name, the count and its denominator** — "Famine, 3 of 253 developed systems"; "Crisis, 2 events".
Without it the control is a button with a count in it and nothing that says what the count is of, and
the denominator is what stops an extensive number reading as a severity.

`Unrest rising` keeps its bare `TrendingUp`. It has no subject glyph to slash, but it does not need
one: the chip's fill is its tier colour, so a rising arrow in the important-tier colour reads as
something climbing that is a problem, which is the whole of what the category means. A second overlay
convention would have been invented to say less than the colour already says.

The visible-tooltip question is open and small: hovering already raises an overlapped chip clear of
the stack, so a tooltip would be a second hover behaviour on the same target. Either the category name
appears on hover, or it appears only on opening the flyout. Not decided; it changes no data.

## Build plan

Files, order and the contracts between tasks. Not the code — the spec above owns every decision, and a
task needing one the spec does not carry goes back to the spec rather than being settled here.

Fifteen tasks in four stages, one gate. Stages are check-in pauses on one branch, not PRs. **If the
diff grows past comfortable review, split A+B (engine and read layer) from C (the surface)** — that is
the owner's stated preference over deferring a category into its own cycle, because the chip and
flyout machinery is shared across all sixteen.

**The floor for a `WorldSystem` optional field**, walked against `supplyBand` (`npm run impact --
supplyBand`, 15 refs / 7 modules) rather than imagined: the type, the tick row, the World-interface
shape, the adapter's delete/assign pair, and **four** sites in `lib/world/tick.ts` — the join
(`toTickSystems`), the merge (`mergeSystemsIntoWorld`), the redevelopment clear (`applyDevelopments`)
and the abandonment clear (`applyAbandonments`). A task touching only the type and the writer is short
by five files.

**The floor for a `WorldMarket` optional field**, walked against `logisticsFundingBound` (26 refs /
8 modules): the type, the producing engine's own state type, the World-interface shape, and three
sites in `lib/world/tick.ts` — the market join, both merge paths (map and rows), and
`resetAbandonedMarkets`.

### Resolution — every measure and the thing that produces it

Every quantity the spec promises to sort, threshold or clear by, resolved to a producer before any
task consumes it. Four rows resolved to nothing and are why Tasks 16-18 exist; the rest carry a
receipt. Rows marked *(built)* were resolved and consumed by a committed task.

| Measure | State | Producer |
|---|---|---|
| Famine — time to abandonment | exists *(built)* | `population` + `ABANDON_POP_FLOOR` (`lib/constants/population.ts:133`) + `populationChange` (Task 1) |
| Strike — suppression | exists *(built)* | `strikeMultiplier` (`lib/engine/population.ts`) |
| Deprived worlds — Provision ascending | exists *(built)* | `WorldSystem.provision` |
| Unrest rising — grievance depth | exists *(built)* | `readExpectation` (`lib/engine/expectation.ts:43-52`) |
| Overcrowded — cap utilisation | exists *(built)* | `population` / `popCap` |
| No housing headroom — population over cap | exists *(built)* | same, plus `habitableHousingHeadroom` (`lib/engine/directed-build.ts:213`) |
| Survival stock falling — cycles to empty | exists + new *(built)* | `WorldMarket.stock` + `stockChange` (Task 2) |
| Build blocked — reason severity, ROI tiebreak | new *(built)* | `BUILD_DROP_SEVERITY` (Task 7) + `buildBlocked.droppedRoi` (Task 3) |
| Industry idle — idle share | exists *(built)* | `buildIndustryReadout`'s `used` / `count`, with Task 5's `inputs` gate |
| Crisis / Disruption — impact rank | new *(built)* | `EVENT_BAND[type].impactRank` (Task 6) |
| Windfall — soonest to expire | exists | `ActiveEvent.ticksRemaining` (`lib/types/game.ts:296`) |
| Maintenance unfunded — sort | n/a | single faction-level row; the order is vacuous |
| **Demand unservable — unserved demand rate** | **new — Task 16** | the magnitude exists as `Deficit.shortfall` (`lib/engine/directed-logistics.ts:220`) and is discarded; Task 4 persisted only the boolean. `demandRate` (`lib/world/types.ts:333`) is *demand*, not *unserved* demand, and is not a substitute |
| **Build opportunity — survival band, then demand served per route cost** | **new — Task 17** | the band is authored beside the category registry against `SURVIVAL_GOODS`; the score is `BuildOpportunity.score` (`lib/engine/directed-build.ts:596-597`), computed every run and discarded. "Sorts by ROI" had no producer — `lib/engine/build-options.ts` carries no value, score or ROI symbol at all |
| **Colony opportunity — `value / work`** | **new — Task 17** | `ColonyProposal.value` and `.work` (`lib/engine/directed-build.ts:1197-1200`) are computed every run and discarded. `colonyValue(…)` itself (`:1344`) is unexported and needs faction-wide aggregates; `colonyEligibility` returns costs only (`lib/services/colony-eligibility.ts:74-78`) |
| **Chip hysteresis — two consecutive cycles** | **new — Task 18** | `EconomyTickPayload` distinguishes a resolving tick from a mid-cycle one (`systemCount` / `shardIndex`, `lib/tick/processors/economy.ts:41,268`), but `useTickInvalidation` discards the payload, so no component can count cycles |

### Stage A — the persisted signals and the engine changes

No UI in this stage. Every task adds an optional persisted field or an authored constant, and nothing
in the tick reads any of them.

### Task 1 — Persist the realised per-cycle population change

Files: `lib/world/types.ts`, `lib/tick/rows.ts`, `lib/tick/world/population-world.ts`,
`lib/tick/adapters/memory/population.ts`, `lib/world/tick.ts`, `lib/world/__tests__/tick.test.ts`,
`lib/tick/adapters/memory/__tests__/population.test.ts`

Interface: `WorldSystem.populationChange?: number` — the realised change in `population` across one
economy cycle **including migration and colony-founding transfers**, denominated per reference cycle.
Written by the tick body after the directed-build stage, not by the population processor:
`populationDelta` (`lib/engine/population.ts:458-473`) carries no migration term, migration writes
`population` afterwards in the same tick, and a colony-founding donor's seed debit
(`applyDevelopments`) is a real population loss for that donor. Absent means never assessed. Joins the
delete/assign pair at `lib/world/tick.ts:206-216` and `:263-272`, and the clears at `:533-538` and
`:575-579`.

Proves:
- A system whose population fell only through migration reports a negative change, not zero — the
  pre-migration `populationDelta` alone would report zero here.
- A system abandoned and re-developed in later ticks reports **absent**, not its predecessor's value.
- A never-assessed system reports absent, and absent survives a save round-trip as absent, not as 0.
- A cycle in which population is unchanged reports 0, distinguishably from absent.
- Changing `CYCLE_LENGTH` away from `REFERENCE_INTERVAL` does not change the reported figure.
- The tick's own outputs — `population`, `unrest`, every harness figure — are identical to before.

Consumes: nothing.

### Task 2 — Persist the per-cycle survival-good stock change

Files: `lib/world/types.ts`, `lib/engine/directed-logistics.ts`,
`lib/tick/world/directed-logistics-world.ts`, `lib/world/tick.ts`, `lib/world/__tests__/tick.test.ts`

Interface: `WorldMarket.stockChange?: number`, written only for `SURVIVAL_GOODS`
(`lib/constants/physical-economy.ts:153`) — the realised change in `stock` across one economy cycle,
computed after the LAST stage of the tick that moves stock: directed logistics' hauls, then directed
build's founding staging draw and staged manifest delivery. The draw belongs inside it for the same
reason `populationChange` counts the colony seed, and the polarity makes it load-bearing: the reader
divides `stock` by `−stockChange`, so a drain left outside quotes the donor a longer runway than it
has. Absent means never assessed. Joins the
market join at `lib/world/tick.ts:316`, both merge paths at `:366-371` and `:404-409`, and
`resetAbandonedMarkets` at `:593-604`.

Proves:
- A system importing its food and holding steady reports ~0, not a drain — the import lands as a stock
  delta and must be inside the figure.
- A system whose local production trails consumption **and** has no donor reports a negative change.
- A non-survival good carries no `stockChange` on any market row.
- An abandoned system's market row reports absent afterwards, while its `stock` is retained.
- A market row predating this task loads with the field absent and is not read as 0.
- A founding donor's figure covers the survival goods it shipped out to stand up a colony.

Consumes: nothing.

### Task 3 — Emit the blocked-build reason and the dropped ROI

Files: `lib/engine/directed-build.ts`, `lib/tick/processors/directed-build.ts`,
`lib/tick/world/directed-build-world.ts`, `lib/world/types.ts`, `lib/tick/rows.ts`,
`lib/world/tick.ts`, `lib/engine/__tests__/directed-build.test.ts`

Interface: `WorldSystem.buildBlocked?: { reason: BuildDropReason; droppedRoi: number }` and
`export type BuildDropReason = "no-capacity" | "no-input-supplier" | "no-consumer" | "no-labour" | "no-whole-level"`.
Written per system on every planner run for the **best-ranked** dropped production opportunity, absent
where one landed or none was wanted. The drop sites are `lib/engine/directed-build.ts:737, 738, 744,
762, 775, 778, 790, 824, 874`. Housing refusals (`plannedHousingUnits`, `:186-199`) are **out of
scope** — they belong to Task 8's *No housing headroom*.

Proves:
- A fully saturated system reports `no-capacity`, not absent. It drops at the pre-ranking capacity
  check — the site the original two-site instrumentation missed entirely.
- A site with **no slot cap at all** for the deficit good reports nothing. The scoring loop pairs
  every site with every good in deficit — food and water always among them — so "capacity is 0" is
  reached both by a site whose deposits are used up and by one that never had a deposit. Only the
  first is a blocked build; recording the second would put a block on nearly every economically
  active system every run, and break the absence convention the write path relies on.
- A system whose only obstacle is an absent input supplier reports `no-input-supplier`, distinctly
  from `no-capacity`.
- A system whose opportunity **landed** this run reports absent, so the row clears without waiting for
  an abandonment.
- A system the planner did not visit keeps its previous value rather than being cleared.
- Turning build automation off does not blank the field — the assessment runs regardless
  (`lib/tick/processors/directed-build.ts:450`); only proposal emission is gated.
- The planner's own decisions — which proposals it emits, in what order — are unchanged.

Consumes: nothing.

### Task 4 — Emit the structural-unservable reading

Files: `lib/engine/directed-logistics.ts`, `lib/tick/processors/directed-logistics.ts`,
`lib/tick/world/directed-logistics-world.ts`, `lib/world/types.ts`, `lib/world/tick.ts`,
`lib/engine/__tests__/directed-logistics.test.ts`

Interface: `WorldMarket.unservedShortfall?: number` — a deficit no reachable same-faction donor and
no local production can close, carried as the unclosed LEVEL rather than a bit. The size is the whole
classification: the matcher only queues a deficit whose shortfall is strictly positive, so a positive
reading means unservable and absent-or-zero means servable, with no second field to keep in step.
Written per (system, good) on the **deficit endpoint only**, deliberately unlike
`logisticsFundingBound`, which the matcher writes to **both** endpoints of a funding-bound haul
(`lib/engine/directed-logistics.ts:170-175`, applied at
`lib/tick/processors/directed-logistics.ts:128-129`). Task 16 below is folded into this one — the
level and the classification are the same field.

Proves:
- A deficit left unserved purely by the work budget sets `logisticsFundingBound` and **no**
  `unservedShortfall` — the temporary and the structural must not collapse into one another.
- A deficit with no reachable donor and no local producer carries a positive `unservedShortfall`.
- The **donor** row of a funding-bound haul never carries one, though it does get
  `logisticsFundingBound`.
- A system unservable in three goods produces three market-row readings, which Task 9 counts as one
  system.
- A deficit that becomes servable has the key DELETED on the next logistics run — not left holding a
  stale level, and not persisted as a zero.
- A deficit is **not** flagged for capacity an earlier deficit in the same run already drew. The
  structural test sums each donor's drawable AS CLASSIFIED, before any deficit spent it: "would
  persist even with unlimited budget" is a property of the galaxy, not of the order the worst-first
  queue happens to walk, and a donor drawn fully dry must not drop out of the sum either.

Consumes: nothing.

### Task 5 — A sixth `IdleReason` for input starvation

Files: `lib/engine/industry.ts`, `components/system/industry-rows.ts`,
`components/system/needs-view.ts`, `components/system/industry-panel.tsx`,
`lib/engine/__tests__/industry.test.ts`, `components/system/__tests__/needs-view.test.ts`

Interface: `IdleReason` (`lib/engine/industry.ts:544`) gains `"inputs"`, derived from `inputGate < 1`,
and `used` for a producer accounts for it so an input-starved building reads idle rather than fully
used. **`needs-view.ts` is not optional here**: `buildProblems` names the labour grade from
`idleReason`, and there is no grade to name when inputs bind — so `staffingGradeName` returns
`undefined` for `"inputs"` and the row falls back to the generic "Understaffed N%" chip, exactly as
`"selling"` already does. `"inputs"` stays a *binding reason*: excluding it from that predicate would
drop the understaffed chip from a producer that is both starved and genuinely short-staffed, and the
row shows a chip for every negative state it is in. Staffing is keyed off `staffedFraction`, which is
independent of the input gate, so nothing about that is double-reporting.

Proves:
- A fully staffed, freely selling factory with no recipe inputs reads idle with reason `"inputs"` —
  today it reads `used === count` with no reason at all.
- That same factory renders no understaffed chip — because its staffing NUMBER is fine, not because
  of its reason.
- A producer that is both input-starved and understaffed renders **both** chips, the staffing one
  generic.
- A tier-0 extractable, which has no input gate, never reports `"inputs"`.
- Existing idle reasons and health colouring are unchanged for every building that had one before.

Consumes: nothing.

### Task 6 — Author the event band and impact rank

Files: `lib/constants/ui.ts`, `lib/constants/__tests__/ui.test.ts`

Interface: `export type EventBand = "crisis" | "disruption" | "windfall"` and
`export const EVENT_BAND: Record<EventTypeId, { band: EventBand; impactRank: number }>` — beside
`EVENT_TYPE_ICON` (`lib/constants/ui.ts:117-138`) and keyed the same way, so the compiler requires all
seventeen types. Values are the band table in the spec above; `impactRank` is the within-band sort for
Crisis and Disruption, authored because no per-phase severity exists (`EventPhaseDefinition`,
`lib/constants/events.ts:58-66`).

Proves:
- All seventeen `EventTypeId` members have a band — including `conflict_spillover`, `plague_risk` and
  `refugee_crisis`, the three the first cut omitted.
- Removing a key fails the typecheck rather than producing a partial map at runtime.
- The three relations-owned types are banded, not just the fourteen spawned ones.
- No band is empty.

Consumes: nothing.

### Gate 1 — the instrumentation is inert, and two owed numbers — passed

Arms: the branch at the end of Stage A, against `main`.

Reads:
- `npm run simulate` at **both horizons**, before and after Stage A. Every figure and all four
  conservation identities identical — the signals are written but nothing in the tick reads them, so
  drift means a write leaked into a decision path.
- **Survival stock falling's threshold.** Cycles-to-empty (`stock / −stockChange`) across developed
  systems, both horizons, cohorted, so the threshold is read rather than guessed. Spec `## Evidence
  still owed` item 3.
- **The Colony-dying-vs-Famine overlap.** Share of famine-banded developed systems carrying a negative
  `populationChange`, both horizons. Spec item 4, falsifier written there.

**Inertness: passed.** `npm run simulate` on `main` (`f0930d17`) against the branch at the end of Stage
A, both horizons, whole-report diff. Only the two wall-clock timing lines differ; every figure and all
four conservation identities are identical, and both runs exit 0.

**The two owed readings are taken, and both are now settled rather than owed.** Spec `## Evidence still
owed` items 3 and 4 are rewritten accordingly — see `## Evidence` → Survival stock falling and → Colony
dying vs Famine overlap. Survival stock falling's threshold is `cycles-to-empty < 3`, authored from
remedy time; the reading (6.7% → 2.4%) is a sanity check on that default, not its source. The
Colony-dying falsifier fired (100% at equilibrium, 50% at startup) and was withdrawn as invalid — it
measured a near-tautology and licenses nothing about the category's existence.

**Superseding the consequence booked at this gate.** The plan said: if the overlap falsifier fires,
Task 9 drops the Colony dying category. The falsifier did fire, but that is not why the category is
gone — the fold happens for the structural reason recorded in the tier list (a warning ahead of a bad
state earns its own chip one tier down; a worse version of the same state is sort order inside one
chip, not a second chip), and would have happened at any falsifier reading. Task 9's category count and
the tier list both lose the row; `populationChange` survives regardless, since Famine's
time-to-abandonment sort needs it.

Merge condition: identical sim output at both horizons; the threshold set from the reading and written
into the spec; the overlap measured and its falsifier called either way. **Met.**

### Stage B — the read layer

### Task 7 — The category registry

Files: `lib/constants/alerts.ts` (new), `lib/types/alerts.ts` (new),
`lib/constants/__tests__/alerts.test.ts` (new)

Also carries `export const BUILD_DROP_SEVERITY: Record<BuildDropReason, number>` — the authored
worst-first rank for Build blocked's within-category sort, per the tier-list section above. It lives
here rather than beside `BuildDropReason` because it is a presentation ordering, not an engine fact.

Interface: `export type AlertTier = "critical" | "important" | "info"`; `export type AlertCategoryId`
— a union of the sixteen ids; `export const ALERT_CATEGORIES: Record<AlertCategoryId,
AlertCategoryDef>` where `AlertCategoryDef` carries `{ tier: AlertTier; icon: LucideIcon; faulted:
boolean; label: string; conditionLine: string; destination: AlertDestination; defaultOn: boolean;
hideable: boolean; order: number }`; and `export type AlertDestination = { kind: "system"; tab: "" |
"population" | "industry" | "logistics" } | { kind: "faction" } | { kind: "events" }`. This is the
spec's authored table in one place, so tier, default, destination and order cannot drift apart across
the surfaces that read them.

Proves:
- Every `critical` category has `hideable: false`, and no other tier does — the non-hideable set is
  exactly the critical tier.
- Every category the spec's defaults table names OFF has `defaultOn: false`; every other is ON.
- `order` is unique within a tier, so the authored order is total and a chip cannot move.
- The destinations that are not systems carry no system tab.
- Adding a category id without a table entry fails the typecheck.

Consumes: Task 6.

### Task 8 — The read service: state-derived categories

Files: `lib/services/alerts.ts` (new), `lib/types/api.ts`, `lib/services/__tests__/alerts.test.ts` (new)

Interface: `getAlertData(): AlertData` where `AlertData = { categories: AlertCategory[] }`,
`AlertCategory` a discriminated union on what the count counts —
`{ id; unit: "developed_systems"; count; denominator; instances }` for the system-scoped categories,
`{ id; unit: "controlled_systems"; count; denominator; instances }` for Colony opportunity, whose
candidates are claimed-but-undeveloped systems and so are a share of that total rather than the
developed one, `{ id; unit: "events"; count; instances }` for Crisis / Disruption / Windfall, which
carry no denominator at all (an event count is not a share of the systems total and can exceed it),
and `{ id; unit: "faction"; count; instances }` for Maintenance unfunded, the one faction-level
category, whose count is 0 or 1 and likewise a share of nothing,
`AlertInstance = { systemId: string | null; name: string; measure: string; sortKey: number }`. This
task covers the categories reading only persisted system state: Famine, Deprived worlds, Strike,
Unrest rising, Overcrowded, No housing headroom — all scoped to the player faction's developed systems,
which is also `denominator`.

Proves:
- A never-assessed system appears in **no** category rather than with a zero reading — `provision`,
  `supplyBand`, `criticalWeight` and `provisionExpectation` are each absent-not-zero.
- Unrest rising excludes a system with no stored `provisionExpectation`, so a fresh colony does not
  report grievance against a read-side floor it has no memory of (`lib/engine/expectation.ts:43-52`).
- A system at exactly `population === popCap` is **not** Overcrowded; one pop above it is.
- No housing headroom excludes a system with a housing level already in the construction queue — the
  category means nothing is coming and nothing can come.
- It evaluates headroom against **queue-adjusted** buildings, so a committed *factory* eating the
  general space housing would have needed does count against the headroom. The adjustment moves
  systems into this category, never out of it — see the Overcrowded evidence section.
- A system in another faction never appears in any category.
- `popCap === 0` with population above 0 reads as not overcrowded, matching `lib/services/tracker.ts:60`.

Consumes: Tasks 1, 7.

### Task 9 — The read service: signal-derived, faction-level and event categories

Files: `lib/services/alerts.ts`, `lib/services/__tests__/alerts.test.ts`. Reads (does not modify)
`lib/services/build-options.ts` and `lib/services/colony-eligibility.ts` for the two opportunity
categories, and `world.player.automation` (`lib/world/types.ts:45`) for their gate.

Interface: extends `getAlertData` with the remaining ten categories — Survival stock falling, Demand
unservable, Build blocked, Industry idle, Maintenance unfunded, the two `info` opportunity categories
(Build opportunity, Colony opportunity) and the three event categories. Together with Task 8's six
that is all sixteen. Maintenance unfunded returns exactly one instance with `systemId: null`; the
event categories return one instance per **event**, `systemId` nullable.

Proves:
- Maintenance unfunded does **not** fire when the maintenance slider is below 1.0 with a solvent
  treasury — the test is `bandShortfall(settlement, "maintenance")`, not against the full bill
  (`lib/engine/treasury.ts`, `settleLadder`).
- It does not fire either when the player RAISES the slider after a solvent settlement: both terms
  are latched at the settlement, so live policy cannot retroactively make a paid bill look short.
- It does not appear at all before a fresh world's first settlement (`lastSettlement` null).
- A system unservable in three goods counts **once**, not three times.
- An event in a rival faction's system raises no chip; a relations-owned pair event involving the
  player's faction does.
- A region-level event with `systemId: null` still counts, and the count is instances not systems.
- Survival stock falling excludes a system whose stock is rising, and one whose cycles-to-empty is
  above the Gate 1 threshold.
- **Build opportunity and Colony opportunity return nothing while their domain's automation is ON**,
  regardless of any settings checkbox — they self-gate on `world.player.automation`, and that gate is
  independent of the category toggle. With automation off they return the planner's ranked proposals
  and the eligible controlled systems respectively.

Consumes: Tasks 2, 3, 4, 5, 6, 7, 8; Gate 1's threshold.

### Task 10 — Route, hook, key, invalidation

Files: `app/api/game/player/alerts/route.ts` (new), `lib/hooks/use-alerts.ts` (new),
`lib/query/keys.ts`, `lib/hooks/use-tick-invalidation.ts`, `lib/types/api.ts`

Interface: `GET /api/game/player/alerts` returning `AlertResponse` via `withServiceErrors` with
`Cache-Control: private, no-cache`; `useAlerts()` on `queryKeys.alerts`, invalidated on **both** the
`economyTick` and `eventNotifications` SSE channels — the event categories move on the second, every
other category on the first.

Proves:
- **A world driven through real `runWorldTick` cycles produces alert rows whose systems and measures
  match the state those cycles actually left** — the one seam nothing currently covers. Every
  boundary is pinned in isolation (engine → processor → adapter → `WorldSystem` → read service), but
  no test drives a tick and then reads the service, so a composition-only wiring defect would pass
  everything. Booked here at review of Tasks 9/16/17 because this task is where a route first makes
  the whole chain reachable end to end.
- The response carries `private, no-cache`, so a New game cannot serve stale system ids from cache.
- An economy tick invalidates the key; an event notification also invalidates it.
- The hook is a `useSuspenseQuery` inside a `QueryBoundary` and does not fetch during SSR render.
- A service error surfaces as an error response rather than a partial payload.

Consumes: Tasks 8, 9.

### Stage C — the surface

### Task 11 — `AlertChip`

Files: `components/alerts/alert-chip.tsx` (new), `components/alerts/__tests__/alert-chip.test.tsx` (new)

Interface: `AlertChip({ category, open, onOpen })` — a 20px icon plus count, opaque tier
fill, optional cased fault slash, accessible name carrying category and count, plus the denominator
where the category has one, in that category's own unit ("Famine, 3 of 253 developed systems";
"Colony opportunity, 3 of 12 controlled systems"; "Crisis, 2 events"). The chip reads
the count and unit off the `AlertCategory` union rather than taking them as separate props, so an
event category cannot be handed a systems denominator. **Whether the category is faulted is read the
same way**, off `ALERT_CATEGORIES[category.id]` — it is authored per category, so a caller must not be
able to hand a chip a slash the table does not grant it. Tier, icon and label come off the registry
for the same reason.

Proves:
- The accessible name is built from the rendered DOM, not from props alone, so it fails when the
  element stops rendering.
- Count and denominator both reach a system-scoped chip's accessible name — a count with no
  denominator is the extensive-number failure the spec names.
- An event chip names its unit ("2 events") and never borrows the developed-systems denominator, and
  neither does the faction-level Maintenance unfunded chip.
- The fault slash renders only for the faulted categories.
- The chip is a `button` and is keyboard-operable.
- Whether the chip renders at all is asserted; its colours are not (jsdom has no CSS).

Consumes: Task 7.

### Task 12 — `AlertRun` — placement, packing, hysteresis

Files: `components/alerts/alert-run.tsx` (new), `lib/utils/alert-packing.ts` (new),
`components/map/map-right-rail.tsx`, `components/map/star-map.tsx`,
`lib/utils/__tests__/alert-packing.test.ts` (new),
`components/alerts/__tests__/alert-run.test.tsx` (new)

Interface: `packRun(chipCount, availableWidth, criticalCount): { step: "spaced" | "overlap8" |
"overlap16" | "collapse"; visible: number; collapsed: number }` — a pure function in `lib/utils/`,
because the packing decision's only DOM observable is a style, and a class assertion in jsdom would
pass with the stylesheet deleted. `AlertRun` renders the ordered chips over the map, inset 8px,
tracking the Tracker rail's base width and its settings-panel exception. **`map-right-rail.tsx:68`
changes `inset-y-4 right-4` to the 8px pair** — that class sits on the outer column shared by the
Tracker, its settings panel and `MapControlsDock`, so all three move on top, bottom and right.

Proves:
- `packRun` never places a critical chip in the collapsed tail, at any width — the settings forbid
  hiding those and layout must not hide them either.
- Below the width that fits the critical tier plus a `+N`, the run renders nothing rather than
  overflowing.
- A category whose instances vanish keeps its chip for two cycles, then clears — a system oscillating
  across a threshold must not toggle the run.
- Chip order does not change when a count changes.
- Empty space in the run passes clicks through to the map; only chips take pointer events.
- `MapControlsDock` still clears the map's bottom edge at the new inset.

Consumes: Tasks 7, 10, 11.

### Task 13 — `AlertFlyout`

Files: `components/alerts/alert-flyout.tsx` (new), `components/alerts/alert-row.tsx` (new),
`components/tracker/tracker-panel.tsx`, `components/alerts/__tests__/alert-flyout.test.tsx` (new)

Interface: `AlertFlyout({ category, onNavigate, onClose })` — instances, count and unit come off the
`AlertCategory` union rather than as separate props — anchored under
its chip, growing to the map area's height and scrolling inside past that, no row cap. A row is name
plus measure; activating it navigates via the destination in `ALERT_CATEGORIES`, reusing the Tracker's
focus mechanism (`components/tracker/tracker-panel.tsx:115-121`), **whose `segment` union widens from
`"" | "industry"` to the five tab segments**.

Proves:
- A category with more instances than fit scrolls rather than truncating — no cap, no second home.
- Only one flyout is open at a time; Escape closes it and returns focus to its chip.
- A Maintenance unfunded flyout renders its single faction-level row with no system name.
- An event row with `systemId: null` navigates to the events panel and attempts no map focus.
- The footer states the count and, for a system-scoped category, its denominator; an event or
  faction-level category's footer states the unit instead.
- A row click navigates and does **not** apply any action or clear the row.

Consumes: Tasks 7, 10, 12.

### Task 14 — `AlertSettings`

Files: `components/alerts/alert-settings.tsx` (new), `lib/hooks/use-alert-categories.ts` (new),
`lib/hooks/__tests__/use-alert-categories.test.tsx` (new),
`components/alerts/__tests__/alert-settings.test.tsx` (new)

Interface: `useAlertCategories(): { categories: Record<AlertCategoryId, boolean>; setCategory }`,
persisted in `localStorage` and narrowed at the boundary with `typeof`/`in` only, modelled on
`lib/hooks/use-tracker-sections.ts`. `AlertSettings` renders a checkbox per hideable category grouped
by tier, opened from the control at the end of the run.

Proves:
- Critical categories render no control at all — not a disabled one, which would still suggest the set
  is negotiable.
- A malformed or partial stored value falls back to the authored defaults, not to all-on (the
  Tracker's fallback, which is wrong here because an alert carries urgency).
- The three spec-named default-off categories start unchecked on a first visit.
- Toggling a category does not close the panel.
- The two `info` categories stay hidden while their automation is on, whatever the checkbox says.

Consumes: Tasks 7, 12.

### Stage D — the fold

### Task 15 — Doc fold

Files: `docs/active/gameplay/alert-bar.md` (new), `docs/SPEC.md`, `docs/ROADMAP.md`,
`docs/active/gameplay/tracker.md`, `docs/build-plans/alert-bar.md` (deleted),
`docs/build-plans/alert-bar-prototype.html` (deleted)

Interface: the spec above promoted to `docs/active/gameplay/alert-bar.md` in present tense, with no
change history, phase numbers or dates; `docs/SPEC.md`'s Single-Player Runtime paragraph (which says
the alert bar "remains planned") and its Tracker section updated; roadmap row 1 deleted; the Tracker's
own doc updated where the rail inset moved; this working file and its prototype deleted.

Proves: not a test task — the check is that `grep -rn "alert bar" docs/` finds no "planned" claim, and
that nothing references the deleted working file.

Consumes: every task.

### Tasks added by the resolution pass

Three measures resolved to a producer that exists but is not persisted; each gets a task. A fourth
resolved to nothing and is blocked on the spec — see below.

**Order:** Tasks 16 and 17 are Stage A-shaped and run before Task 9's two affected categories are
re-read; Task 18 runs with Task 10, before Task 12 consumes it.

### Task 16 — The unserved shortfall IS the unservable reading

Files: `lib/engine/directed-logistics.ts`, `lib/tick/processors/directed-logistics.ts`,
`lib/tick/world/directed-logistics-world.ts`, `lib/world/types.ts`, `lib/world/tick.ts`,
`lib/engine/__tests__/directed-logistics.test.ts`

Interface: folded into Task 4 — `WorldMarket.unservedShortfall?: number` is the single field, and a
positive value is what "unservable" means. A **level, not a rate**: the deficit's
`max(0, target − stock)` (`lib/engine/directed-logistics.ts:38-44`) less the drawable capacity its
reachable donors still hold — the part no donor can cover, not the whole want — so it takes no
per-cycle denomination, unlike Task 2's `stockChange`. Follows the `WorldMarket` optional-field floor above.

Proves:
- A system unservable in three goods carries three shortfall figures, and the read service still
  counts it once — at the largest of them, not the sum.
- A deficit closed by a reachable donor has the key deleted rather than zeroed on the row.
- A deficit left unserved purely by the work budget carries `logisticsFundingBound` and **no**
  shortfall — the temporary and the structural stay distinct.
- An abandoned system's market row reports absent afterwards.
- The figure is a level: changing `CYCLE_LENGTH` does not move it.

Consumes: Task 4.

### Task 17 — Persist the planner's ranked opportunity terms

Files: `lib/engine/directed-build.ts`, `lib/tick/processors/directed-build.ts`,
`lib/tick/world/directed-build-world.ts`, `lib/world/types.ts`, `lib/tick/rows.ts`,
`lib/world/tick.ts`, `lib/engine/__tests__/directed-build.test.ts`

Interface: two optional `WorldSystem` fields, both pure side-channel writes mirroring `buildBlocked`
(Task 3) including `applyBuildBlockedUpdates`'s clear-visited-then-assign semantics, and inert
exactly as that one is:

- `colonyOpportunity?: { value: number; work: number }` — the terms `ColonyProposal` already carries
  (`lib/engine/directed-build.ts:1197-1200`), `value` being `colonyValue(c, …) − popCost` and `work`
  the establish-plus-housing denominator. Written per candidate system, absent where none was proposed.
- `buildOpportunity?: { score: number; goodId: string }` — the **best-ranked** opportunity's own
  `BuildOpportunity.score` (`:596-597`) and the good it would serve. The good rides along because the
  read service bands on it: a system with any survival-serving opportunity is represented by that one
  rather than by its highest-scoring one, per the spec's Build opportunity section. Absent where the
  system produced no scored opportunity.

The band itself needs **no new authored table**: `SURVIVAL_GOODS`
(`lib/constants/physical-economy.ts:153`) already is the authority on which goods are survival goods,
so the band is a predicate over the persisted `goodId` and belongs to the read service, not here.
What this task owes the band is the `goodId` — and the **choice of which opportunity to persist**,
since a single stored score cannot be re-banded after the fact.

Proves:
- The assessment runs and both fields are written with their domain's automation **off** — the switch
  gates proposal emission, not the clock (`lib/tick/processors/directed-build.ts:450`).
- A system whose best-scoring opportunity serves a non-survival good, but which also has a
  survival-serving one, persists the survival one — the band cannot be applied after the fact from a
  single stored score.
- A system that stops being a candidate clears rather than keeping a stale figure.
- A system the run did not visit keeps its previous value.
- The planner's own decisions — which proposals it emits, in what order — are unchanged.
- Nothing inside the tick reads either field back.

Consumes: Task 3's write-back pattern.

### Task 18 — Surface the cycle boundary to the client

Files: `lib/hooks/use-tick-invalidation.ts`, `lib/hooks/use-cycle-boundary.ts` (new),
`lib/hooks/__tests__/use-cycle-boundary.test.tsx` (new)

Interface: a hook exposing the count of resolving economy cycles seen this session, derived from
`useTickContext().currentTick` — `floor(currentTick / CYCLE_LENGTH)`, anchored at the first tick the
transport reports so the count still starts at 0. Task 12's hysteresis counts cycles through this,
never renders or refetches.

**Derived from the tick, not from the boundary broadcast.** `EconomyTickPayload` does distinguish the
two — the resolving payload writes `systemCount: systemIds.length` and `economyMidCyclePayload`
hard-codes `systemCount: 0`, while `shardIndex`/`shardCount` carry no signal on either — but the
CHANNEL is lossy: the tick loop throttles broadcasts to one per 250 ms and is latest-wins, replacing
the pending frame rather than merging its `events` (`lib/world/tick-loop.ts`). One tick in
`CYCLE_LENGTH` carries the boundary payload, so at speed a whole cycle can pass inside a single
throttle window and an edge-counting hook stalls silently — taking the chip hysteresis with it.
`currentTick` is overwritten by every frame that does arrive, so it is correct however many were
dropped. The anchor waits for a positive tick because `useTick` opens at 0 and seeds from REST in an
effect; anchoring on that placeholder would hand a live world's first real frame a count in the
hundreds.

Proves:
- A mid-cycle tick does not advance the count; crossing a boundary does.
- The count advances by the cycles actually crossed when the transport drops whole cycles of frames.
- It starts at 0 when it mounts against a world already thousands of ticks in.
- The count survives a refetch that returns identical data.
- A component consuming it sees exactly one advance per cycle across a multi-tick run.

Consumes: nothing.

### Task 9 — amended by the resolution pass

Three of Task 9's sixteen categories were built against measures with no producer, and each carried a
proxy the implementer chose rather than the spec. All three come out:

- **Demand unservable** sorted by `demandRate`, which is demand, not unserved demand. Reads Task 16's
  `unservedShortfall` instead, largest first, still counting a multi-good system once.
- **Build opportunity** sorted by addable level count. Reads Task 17's `buildOpportunity`, banded
  survival-first then by score.
- **Colony opportunity** sorted by `seedPop ÷ (charter + projectedBill)`. Reads Task 17's
  `colonyOpportunity`, by `value / work` descending.

Its `Proves` list gains one entry: a system whose best-scoring build opportunity serves a non-survival
good, while a survival-serving one also exists there, sorts above every band-2 system.

Consumes additionally: Tasks 16, 17.

## Verification

**Sim, both horizons, cohorted.** `npm run simulate` before and after Stage A must be identical at
1,000 and 10,000 ticks including all four conservation identities — the whole design rests on the new
signals being inert, so drift is a write that leaked into a decision path. Gate 1 owns that read.
Stages B-D touch no tick code: the alert bar is a read surface and moves no sim metric by
construction, which is the property to demonstrate rather than a number to improve.

**Two readings the gate produced, not assertions this plan made:** Survival stock falling's
cycles-to-empty threshold — settled at `< 3`, authored from remedy time — and the
Colony-dying-vs-Famine overlap, whose falsifier fired and was withdrawn as invalid; Colony dying is
deleted for the structural reason in the tier list, not for this number. Both cohorted by developed
systems, both horizons; see `## Evidence`.

**Build gate:** `npx next build --webpack`. **Unit:** `npx vitest run`. **Mutation:** the scoped
`npm run mutation -- --mutate "<changed lib files>"` sweep is the periodic overnight batch, not an
in-session gate.

**Manual smoke, by the owner:** the run over a live map at several window widths, the packing steps, a
flyout that overflows, and the settings panel — packing and inset behaviour cannot be proven in jsdom,
which has no layout.

## Doc fold

Runs on the branch before the final review, per sub-PR if A+B and C are split — never deferred to an
integration merge.

- **New:** `docs/active/gameplay/alert-bar.md`, promoted from the spec above.
- **Stale on ship:** `docs/SPEC.md` — Single-Player Runtime says the alert bar "remains planned", and
  the Tracker section describes the attention layer as having one shipped surface.
- **Stale on ship:** `docs/active/gameplay/tracker.md` and any theme note describing the right rail's
  16px inset (`components/map/map-right-rail.tsx:68` moves to 8px).
- **Superseded:** roadmap row 1 — delete it, not amend it.
- **Deleted:** this working file and `alert-bar-prototype.html`, after the promotion. Before deleting,
  grep this file for deferred work and verify each item was actually booked.
- **Memory:** `design-attention-layer-inputs` retires when this ships — already background only.

## Not covered

- **A visible hover tooltip carrying the category name.** *Dropped for now* — hovering already raises
  an overlapped chip, so a tooltip is a second hover behaviour on one target, and the accessible name
  carries the category regardless. Named as open in the spec.
- **Richer flyout bodies** beyond name plus measure. *Dropped*: the spec commits to thin bodies
  deliberately, and a later pass can add without redesign.
- **A secondary "apply it" action on opportunity rows.** *Dropped*, with the seam left — the row's
  right edge stays free, so it can be added without reworking the row.
- **`RATION_EXIT_EPS`.** *Booked* — spec `## Evidence still owed` item 5. Band transitions did not
  become a category, so the constant is a delete unless something else claims it, and this plan's
  chip-level hysteresis is presentational and does not answer its question.
- **The Provisioned map mode cannot show Famine.** *Booked at the doc fold* — unrelated to this
  feature, surfaced during it; raise when map modes next open rather than folding it in here.
- **Housing refusals inside Build blocked.** *Dropped*, reason in the spec: housing carries no ROI, so
  a housing row would have nothing to sort by. *No housing headroom* owns that fact.
- **A faction-wide list surface for a category that outgrows its flyout.** *Dropped* — the flyout is
  uncapped and scrolls, so there is no overflow to host. The faction Territory tab is explicitly no
  longer a candidate.
- **The faction name and flag's new home.** *Dropped from this feature* — they go above the left
  detail panels, separate work the owner has already scoped out of this branch.
