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
- **Chips inside the existing top bar** was killed by arithmetic: ~5 chips against seventeen
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
take the slash. **`GlobeOff` does exist** (`node_modules/lucide-react/dist/esm/icons/globe-off.js`),
so Colony dying takes the stock glyph unless the cased slash proves more legible over a live map —
a prototype question, not a spec one.

The `Clears by` column records how a row actually stops being true, per the contract below: **fix**
(the player can act), **expiry** (an event's phases end), **world-resolves** (the simulation removes
the subject — a colony is abandoned, decay eats the idle capacity, population falls).

| Tier | Category | Icon | Condition, and its sort measure | Clears by | Data |
|---|---|---|---|---|---|
| critical | Famine | `WheatOff` | Survival-good shortfall (`supplyBand === "famine"`). Sorts by shortfall depth. | fix | Ships today |
| critical | Colony dying | `GlobeOff` | Famine world whose population is **shrinking** toward `ABANDON_POP_FLOOR`. Sorts by fractional decline rate (`−delta / population`), steepest first. Needs the per-cycle population delta persisted — see below. | fix / world-resolves (abandonment) | New (small) |
| critical | Strike | `Megaphone` | Unrest past the strike threshold. Sorts by suppression. | fix | Ships today |
| critical | Maintenance unfunded | `BanknoteX` | Settlement could not pay the maintenance band **it was asked to pay** — insolvency, not a slider setting. The only path into destructive decay. One faction-level row, count always 1. | fix | Ships today |
| critical | **Crisis** | `Siren` | Events that can break a world — plague, raid, asteroid strike, inner-system conflict, border conflict. Sorts by authored impact rank (new authoring, beside the band). | expiry | Needs banding |
| important | Deprived worlds | `BatteryLow` | Provision in the Deprived band. Sorts by Provision ascending. | fix | Ships today |
| important | Unrest rising | `TrendingUp` | Provision below the floored expectation the population is judged against, not yet striking. Requires a real memory (`provisionExpectation` present). Sorts by grievance depth. | fix | Ships today |
| important | Survival stock falling | `Hourglass` | A survival good (`SURVIVAL_GOODS` — water, food) whose **stock is falling** with cycles-to-empty below a threshold. Sorts by cycles remaining, soonest first. Stock is used because directed logistics lands imports as stock deltas, so a falling stock is the true net drain; local consumption-vs-production would fire on every importer. Needs the per-cycle survival stock delta persisted — see below. | fix | New (small) |
| important | Demand unservable | `RouteOff` | A deficit no reachable donor and no local production can close — structural, as distinct from the temporary `logisticsFundingBound`. Sorts by unserved demand rate. | fix | New |
| important | Overcrowded | `BedDouble` | `population > popCap` — there are people with no housing. Sorts by cap utilisation. The threshold is definitional, not tuned: at 1.00 everyone is housed and the next person is not. | fix | Derivable |
| important | No housing headroom | `BedDouble` + slash | Over `popCap` **and** no habitable room for another housing level (`habitableHousingHeadroom < 1`, evaluated against queue-adjusted buildings). The world needs housing and physically cannot build it. Sorts by population over cap. | world-resolves (population falls) | Derivable |
| important | Build blocked | `HardHat` + slash | The **production** planner wanted to build and could not — no capacity, no reachable input supplier, no spare labour, no affordable whole level. Sorts by the ROI of what was dropped. Housing refusals belong to *No housing headroom*, not here: housing carries no ROI and would have nothing to sort by. **Defaults off**: measured at 50.4% of developed systems per planner run, not rare. | fix | New |
| important | Industry idle | `Factory` + slash | Built capacity not running — no skill licence, missing inputs, no staff. Sorts by idle share. The missing-inputs case needs a sixth `IdleReason` — see below. | fix / world-resolves (decay removes it) | Ships today + new |
| important | **Disruption** | `TriangleAlert` — also a type icon | Events that cost but do not threaten — shortage, storm, embargo, glut, a dissolved alliance, and the three below. Sorts by authored impact rank. | expiry | Needs banding |
| info | Build opportunity | `HardHat` | Ranked planner proposals, **only while build automation is off**. Sorts by ROI. | fix | Ships today |
| info | Colony opportunity | `Globe` | Eligible controlled systems, **only while colonisation automation is off**. Sorts by colony ROI. | fix | Ships today |
| info | **Windfall** | `Sparkles` — also a type icon | Events worth riding — trade festival, mining boom, tech breakthrough, a pact opening. Sorts by `ticksRemaining`, soonest to expire first. | expiry | Needs banding |

**Seventeen categories.** Overcrowded was one category and is now two: combining "over the cap" with
"and no room to fix it" meant the manual builder — the player with build automation off, who is the
one who needs the nudge — was told last, only once every habitable slot was already gone. The two
facts are separate warnings and a system may raise both.

**Two categories are warnings ahead of a critical one, and sit one tier below it.** Unrest rising is
important where Strike is critical; Survival stock falling is important where Famine is critical. The
same relationship, authored the same way.

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

**Three glyph pairs came out of this**, and they are the clearest thing on the bar: `Globe` plain is a
colony you could found, `GlobeOff` is one dying; `HardHat` plain is a build you could order, `HardHat`
slashed is one that could not happen; `BedDouble` plain is a world over its housing cap, `BedDouble`
slashed is one that cannot build its way out. Same subject, faulted and not.

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
plus the cased slash covers all seventeen; a dedicated set would be a later pass, and nothing here
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
nothing that can end a colony or start a war is switched off by accident. Five categories, locked on.

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

Seventeen, in the table above. Each is authored into one of three tiers at design time. **There is no
computed cross-domain score anywhere in this design**: instances sort only *within* their category, by
that category's own natural measure, and categories sort only by their authored tier. This is what
lets housing — which carries no ROI value at all — sit on the same bar as an industry proposal without
inventing a weight to compare them.

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
| Famine, Colony dying, Strike, Deprived worlds, Unrest rising, Overcrowded, No housing headroom | system → `population` |
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
  written — so nothing in world state says whether a world is growing or shrinking. Without it,
  Colony dying can only sort by raw population, which puts every freshly-seeded 2-pop colony above a
  world actually collapsing.

  **What is persisted is the realised change in `population` including migration**, computed as
  `population_after_migration − population_at_cycle_start` and written by the tick body after the
  migration stage — *not* the population processor's `delta`. `populationDelta`
  (`lib/engine/population.ts:458-473`) is growth − decline − overshoot-death with no migration term,
  and migration runs afterwards in the same tick; on a dying colony departures are a real and often
  dominant drain. Persisting the biological delta alone would systematically understate the collapse.

  **The sort measure is the fractional decline rate, `−delta / population`** — steepest first. The
  obvious `(population − ABANDON_POP_FLOOR) / −delta` does not work: every term of the delta scales
  with population, so on a famine world the expression collapses to roughly
  `(1 − 1/pop) / (declineRate·unrest + …)` and orders by unrest rather than by collapse speed. It is
  also undefined at the edges — `delta === 0` gives `−Infinity` and sorts a stable world first,
  `delta > 0` gives a negative finite value and also sorts first. Those cases are excluded by the
  condition (the category requires shrinking) rather than guarded in the sort.

  Denominated **per reference cycle**, matching `delta`'s own denomination rather than the
  `delta × catchUpFactor` a single run applies — the two are equal only while `CYCLE_LENGTH` (24)
  equals `REFERENCE_INTERVAL` (24), and `CYCLE_LENGTH` is a documented knob.

  **Hazard 1, stated up front:** this is authored for one job — the Colony dying measure. It is
  obviously attractive to the Tracker's rows, the Population panel, and the queued unrest-history /
  recovery-forecast work. Those are welcome to read it, but any of them wanting a *different* shape
  (a trailing average, a longer window) must add their own rather than redefining this one. That is
  precisely how `TARGET_COVER` and `demandRate` happened.

- **The per-cycle survival stock delta**, per (system, good), for `SURVIVAL_GOODS` only
  (`lib/constants/physical-economy.ts:153` — water and food). Stock is the right base because
  directed logistics lands its hauls as stock deltas, so a falling stock is production minus
  consumption *after* imports; the purely local `honestUseRate > realizedProductionRate` would fire on
  every importer, which in a specialised economy is most of the galaxy by design. Cycles-to-empty is
  then `stock / −delta`, and the alert's threshold on it is **owed a measurement** — a number to read
  off a sim run, not to guess here.

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

All of these are **read-only from the alert bar's point of view**: the bar reads them, and nothing in
the tick reads them back, so nothing about them changes what the tick decides. That is the property to
preserve at review — an alert that changes the simulation is a mechanic wearing a notification's
clothes. The bar itself writes nothing; the write edges belong to the processors.

### World state and saves

**The alert bar adds no *player* state.** Category visibility is a browser preference, not a save
field, so there is no per-player state at all. What the save gains is the four persisted signals
above: the population delta and the blocked-build reason + dropped ROI on `WorldSystem`, the survival
stock delta and the structural-unservable bit on `WorldMarket`.

**No `SAVE_FORMAT_VERSION` bump is needed, and taking one would be actively wrong.** `save.ts`'s own
rule: "An additive OPTIONAL field that old saves can legitimately omit does NOT need a bump: the field
simply stays `undefined` on load, which is correct" (`lib/world/save.ts:6-10`). All four are exactly
that shape, and "absent means never assessed" is not merely compatible with an unbumped load — it is
what makes it correct. A bump would reject every named save and the rolling autosave that Continue
loads (`:78`, `SAVE_FORMAT_VERSION` 13) and buy nothing.

One consequence to state rather than discover: on a save predating these fields every system reads
absent, so Colony dying and Survival stock falling show nothing until the first economy cycle after
load. That is correct, and it is not a bug.

**Absence is not zero, for every category, not just two.** `provision`, `supplyBand`,
`criticalWeight` and `provisionExpectation` are all absent on a system the economy has never assessed,
and that is deliberate (`lib/world/types.ts:99-141`). The rule generalises: **a system with any of the
fields a category reads absent does not appear in that category** — it has no reading, not a bad one.
This is the trap the Tracker already handles at `lib/services/tracker.ts:65`.

Per category, the nullable inputs that rule governs:

| Category | Nullable inputs | Absent reads as |
|---|---|---|
| Famine, Deprived worlds | `supplyBand` | not in the category |
| Colony dying | `supplyBand`, population delta | not in the category |
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
| `STRIKE_PARAMS.threshold` | Strike suppression (`lib/services/system-population.ts:119` and the population engine) **and** the overshoot-death gate: `POPULATION_PARAMS.overshootDeathUnrestGate: STRIKE_PARAMS.threshold` (`lib/constants/population.ts:130`) → `lib/engine/population.ts:470` | **None** — but the coupling is real and kept deliberately. A system crossing 0.65 enters the Strike chip *and* acquires the death term that dominates its Colony dying measure, so the two critical categories fire and rank off one number. Moving the constant moves both. | Yes, and stated |
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
| `ABANDON_POP_FLOOR` (`lib/constants/population.ts:133-141`) | "Abandonment's death line… famine + population below one pop — under a million people — means the colony is over. **A backstop, deliberately un-tuned: no window, no calibration sweep owns this number.**" | the line Colony dying's condition is oriented toward | **Qualified yes.** The design deliberately does **not** put it in the sort — the measure is `−delta / population`, so a future re-tune of this un-tuned backstop cannot silently re-order a critical alert. It remains the abandonment gate only. |
| `STRIKE_PARAMS.threshold` (`:72-79`) | "Strike production-suppression regime derived from unrest… Threshold raised to 0.65 so only genuinely high-unrest systems strike" — says nothing about population death | the Strike category's condition | Yes for Strike. But see row 1: the constant has a **second, undocumented job** as `overshootDeathUnrestGate`, which couples it to Colony dying's measure. |
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
| Unrest / regime | Reads `unrest` against `STRIKE_PARAMS.threshold`, and grievance as `expectation − provision` (`grievanceShortfall`, `lib/engine/population.ts:295`). Writes nothing. The threshold's second job as `overshootDeathUnrestGate` couples Strike to Colony dying's measure — see row 1. | — |
| Industry + staffing | Industry idle reads existing per-building idle reasons **and needs a sixth**: `IdleReason` (`lib/engine/industry.ts:544`) has no input-starvation member, so an input-gated factory reads as fully used. Build blocked's labour case reads the planner's own fit gate. | — |
| Infrastructure decay | **Decay is the clearing mechanism for Industry idle, not its consequence** — the direction was stated backwards in the first cut. `idleLevels = floor(count − used)` (`lib/engine/infrastructure-decay.ts:95`) accrues a countdown while ≥ 1 and tears the level down; `used` then equals `count` and `idleReason` clears (`lib/engine/industry.ts:790`). So the row disappears when the capacity is destroyed. Accepted deliberately — decay is a mechanic the player is expected to know, and the flyout does not explain it. Decay also reads `logisticsFundingBound` (`:63,119`), which row 1 now records. | — |
| Directed logistics | Demand unservable is new instrumentation here, per (system, good) on the deficit endpoint only — unlike `logisticsFundingBound`, which is written to both endpoints of a funding-bound haul (`lib/engine/directed-logistics.ts:170-175`). Survival stock falling reads persisted `stock` plus a new per-cycle stock delta. | — |
| Directed build / planner | Build blocked is new instrumentation here, across the full drop set rather than two sites. Build opportunity reads the ranked proposals, gated on the automation switch. Note the assessment runs for **every** faction regardless of `world.player` (`lib/tick/processors/directed-build.ts:450`) — the switch gates proposal *emission*, not the clock. | — |
| Colonisation + founding manifest | Colony opportunity reads eligibility; Colony dying reads the abandonment line. No write path. | — |
| Treasury / purse | Maintenance unfunded reads `paid.maintenance` against **`maintenanceBill × treasury.bands.maintenance`** — the band the settlement was *asked* to pay. Testing against the full bill would fire on any maintenance slider below 1.0, a legal player setting floored at 0.5: `settleLadder` computes `charge = bill × slider; pay = min(charge, available)` (`lib/engine/treasury.ts:126-131`), so `paid < bill` is true whenever the slider is down. Insolvency is `pay < charge`. Adds `WorldFactionTreasury.bands.maintenance` to the read list. | — |
| Factions + relations | `border_conflict` arrives as an event via the relations processor (`lib/tick/processors/relations.ts:34-37`); it lands in Crisis. The three relations-owned events scope to pairs the player's faction is in. **No war state exists** to interact with. | — |
| **Abandonment (tick body)** | Every persisted signal this design adds joins the resettlement reset: deleted in `applyAbandonments` (`lib/world/tick.ts:559`) beside `provision` / `supplyBand` / `criticalWeight` / `provisionExpectation`, deleted again on any flip to `developed` in `applyDevelopments` (`:533`), and threaded through `toTickSystems` (`:206`) and `mergeSystemsIntoWorld` (`:263`) by the same delete/assign pair so absence stays a true absence. Without it a re-founded colony carries the dead world's death rate. `logisticsFundingBound` already does this on the market side (`:601`). | — |
| Save format (`World` shape) | **Four new optional fields** — population delta and blocked-build reason + dropped ROI on `WorldSystem`; survival stock delta and the structural-unservable bit on `WorldMarket`. All additive and optional, so **no `SAVE_FORMAT_VERSION` bump** (`lib/world/save.ts:6-10`). Settings stay a browser preference, so no new *player* state. Contrast the Tracker, which added `pinnedSystemIds` and nothing else. | — |
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
| Whether Colony dying is a meaningful subset of Famine | **NONE — hypothesis.** Famine drives the satisfaction factor toward zero and elevates unrest, so the delta is negative by construction on most famine worlds; the overlap is unmeasured | — | — |
| Survival stock falling's incidence and threshold | **NONE — owed.** The threshold is a number to read off a sim run | — | — |

The first eight are code facts. The next two are the measured findings — see `## Evidence`, where each
carries its instrument, both horizons and a `Licenses` line. The last two are labelled hypotheses, and
neither sets a condition: the first is a question about whether Colony dying earns its own chip, the
second is a threshold to measure before shipping.

### 5. Designing against a threshold or primitive that does not exist

| Consumes | Produced at | Actual shape today | Design assumes |
|---|---|---|---|
| Famine | `foldSupplyState`, `lib/engine/population.ts:262`; persisted `supplyBand` | `"famine"` only via the survival branch; **absent when never assessed** | matches |
| Deprived band | same fold, persisted | four descriptive bands; famine punches through at any Provision | matches — Deprived is a band, not a Provision cutoff |
| Strike | `system-population.ts:119`, `unrest > STRIKE_PARAMS.threshold` | boolean derived at read time | matches |
| Colony dying | `lib/tick/processors/population.ts:111` reports systems already below the floor; `populationDelta` at `:106` is computed and discarded | reports **crossings**, not a countdown; the delta exists for one statement and is never written, and carries **no migration term** | **RESOLVED by persisting the realised post-migration change** — see the emission section; the earlier `(pop − floor) / −delta` measure was degenerate and was replaced by `−delta / population` |
| Maintenance unfunded | `WorldTreasurySettlement`, `lib/world/types.ts:405-421` | `paid` per band, post-slider; the settlement carries **neither the charge nor the slider** | **partly missing** — the honest test needs `treasury.bands.maintenance` alongside, or the condition fires on a legal slider setting |
| Unrest rising | `grievanceShortfall`, `lib/engine/population.ts:295`; `readExpectation`, `lib/engine/expectation.ts:43-52` | `max(stored, floor)` − provision, and a **missing memory is seeded from this cycle's own Provision** | matches only with the never-seeded guard — the category requires a stored `provisionExpectation` |
| Overcrowded | `population`, `popCap` — both persisted `WorldSystem` columns | `popCap` recomputed live from surviving housing each cycle | matches |
| No housing headroom | `habitableHousingHeadroom`, `lib/engine/directed-build.ts:163-170` | a fractional housing-**unit** count, range [0, ∞); the planner's own `< 1` test means "no room for even one whole level" (`:189`). But the planner never calls it on raw state — `effectiveBuildSystems` (`:247-282`) folds open `build` projects in first, and is **not exported** | matches only against **queue-adjusted** buildings; needs a shared exported helper, else the alert lights on a system whose relief housing is already in flight |
| Survival stock falling | `stock`, `honestUseRate`, `realizedProductionRate` — all persisted (`lib/world/types.ts:288-322`) | present; but no **stock delta** exists | new instrumentation (small) |
| Industry idle | `IdleReason`, `lib/engine/industry.ts:544` | five members; assigned only when `used < count`, and `used` for a producer is staffed-and-selling capacity, so input starvation is invisible — `inputGate` reaches `output` (`:786`) and nothing else | **partly missing** — skill-licence and staffing ship; missing-inputs needs a sixth member from `inputGate < 1` |
| Build blocked | **does not exist** | — | new instrumentation, across nine drop sites |
| Demand unservable | **does not exist** | — | new instrumentation |
| Event valence + impact rank | **does not exist** | `EventDefinition` has neither | new authoring, over all seventeen types |

The Colony dying row is the original hazard-5 catch: the design said "sorts by cycles to the floor"
against a processor that only reports systems already past it. Three more rows joined it at review —
Maintenance unfunded, Industry idle and No housing headroom each consume something whose real shape
differs from what the first cut assumed.

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
is that **and** `habitableHousingHeadroom(sys) < 1` (`lib/engine/directed-build.ts:163` — the
planner's own "can another housing level physically be built here", evaluated against queue-adjusted
buildings).

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
- **What the readings did *not* license, learned the hard way here:** a rate can set a default and can
  reveal that the game is not living up to a definition. It cannot set the definition. Two design
  moves in the first cut did exactly that and were reversed at review.

## Evidence still owed / now settled

1. ~~Category volume at ordinary play~~ — **measured**, see Evidence above. Moved Deprived to
   default-on and confirmed the other three.
2. ~~"Blocked builds are rare by construction"~~ — **measured and false**, see Evidence above.
   Superseded in scope: the counter covered two of nine drop sites, so the true rate is higher. The
   conclusion is unaffected.
3. **Survival stock falling's threshold.** Cycles-to-empty below what? A number to read off a sim run
   at both horizons, cohorted by developed systems, before the category ships. Its incidence is owed
   with it.
4. **Whether Colony dying is a meaningful subset of Famine.** Famine drives the satisfaction factor
   toward zero and elevates unrest, so the population delta is negative by construction on most famine
   worlds — the second conjunct may select almost nothing Famine does not already select, in which
   case Colony dying is a severity treatment inside the Famine chip rather than its own category.
   Falsifier: if more than 90% of famine-banded developed systems carry a negative delta at either
   horizon, fold it in. Note this bears on the *category*, not on the persisted delta, which the sort
   measure needs either way.
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
