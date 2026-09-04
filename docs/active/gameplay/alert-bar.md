# The Alert Bar

The second of the attention layer's two surfaces. The first, [the Tracker](./tracker.md), holds
**things** — pinned systems, funded builds, forming colonies — and never rearranges itself by
severity. The alert bar holds **conditions**: a row exists only while it is true, ranked by an
authored tier rather than a computed cross-domain score, and disappears the moment it stops being
true rather than waiting to be dismissed.

## What it is

A run of small chips across the top of the map, each one a kind of trouble or opportunity that is
**true right now**. A chip appears the moment at least one instance meets its condition, carries the
count of instances, and disappears the moment the last of them clears. Clicking a chip opens the list
of instances, worst first; clicking a row flies the map to it.

That is the whole contract: **a row exists only while its condition is true, and nothing here is
dismissible.** A row clears when its condition stops — by the player fixing it, by the world resolving
it (an event's phases end, a colony is abandoned, decay eats the idle capacity), or by its domain
leaving view when its automation is switched on. What is forbidden is a row that persists after its
condition is false. Unfixability is a category's own business, not an exception to the rule — Overcrowded's
companion category is *defined* by there being no way to build the fix, and Industry idle is often
unfixable; both still clear the moment their condition genuinely stops.

The count is a raw instance count, and it is **extensive** — it grows with the empire, so it is not a
severity signal and is not comparable across categories or across a run. Severity is carried entirely
by the authored tier colour; the flyout footer carries the denominator ("3 of 253 developed systems")
for anyone who wants the rate.

Everything is scoped to the player's faction: developed systems the player controls. A rival's
condition is real strategic information and belongs on some other surface; it is not a condition
of yours, and it cannot be acted on.

## The rule that decides what belongs

An alert-bar row is a **condition**: it exists only while true. A Tracker row is a **thing**: it
persists regardless. Everything condition-shaped belongs here, everything thing-shaped there, and the
split is exhaustive — there is no third surface. A separate dismissible feed of discrete events was
considered and dropped for exactly this reason: an event the player should act on would be a
condition, so it would belong here rather than in a parallel scrolling list — moot today since the
only events left (the three relations-owned diplomacy arcs) are minimum-investment and surface only
in the faction-diplomacy panel and the plain faction-events list, not on this bar.
Two alert categories may name the same system — they are different warnings, not duplication, which is
why instances rank within a category and never across.

A condition resolves on its producing processor's cycle, not on the player's action. The economy,
construction and logistics cycles are all 24 ticks today but are independently tunable
(`lib/constants/tick-cadence.ts`), so a chip clears at the next cycle boundary after the fix lands, and
Build blocked and Demand unservable can lag the rest of the bar by up to one of their own intervals.
Nothing here promises instant clearing.

A condition's definition comes from what it means, never from what the galaxy currently measures.
Overcrowded is `population > popCap` because at 1.00 everyone is housed and the next person is not —
not because a distribution suggested a threshold. A measured rate can set a category's *default* and
can show that the game is not living up to a definition; it cannot move the definition itself.

## Placement and behaviour

The chips float over the top of the map, inset 8px from the system drawer on the left, the Tracker
rail on the right, and the top of the map. Nothing reserves layout height: on a galaxy with no live
conditions, no chips are there at all. The settings control is the one exception — it renders whenever
the run mounts, whatever the chip count, because it is the run's own entry point back to itself: a
player who has switched every hideable category off, with nothing critical firing right now, must
always have a way back to the categories that are hiding everything else. It sits at the **start** of
the run, before the first chip, so that its position never moves with the chip count: the run is
left-anchored, so a control after the chips would slide rightward — taking its own open panel with it
— the moment a category the player just switched on added a chip. The cost is that it precedes the
most severe chip rather than trailing the run. Empty space in the run passes clicks through to the
map; only the chips and the settings control are interactive.

The left inset tracks the system drawer's fixed width; the right inset tracks the Tracker rail's own
base width, plus the extra span the Tracker's own settings panel adds while that panel is open — a
single piece of state lifted to the map component and shared by both siblings, so the two never
disagree about how much room the rail occupies. All four numbers (`DRAWER_WIDTH`, `RAIL_INSET`,
`TRACKER_BASE_WIDTH`, `TRACKER_SETTINGS_SPAN`) live in `lib/constants/layout.ts`, each naming the
Tailwind class it has to stay in sync with by hand.

Chips are ordered by their category's authored tier — critical, then important, then informational —
with a hairline separator between tiers. Within a tier the order is authored too, and stable: a chip
never moves because its count changed.

**A category's chip tracks its count directly — it appears the moment the count goes above zero and
clears the moment it returns to zero, with no grace window.** A count only reaches zero when every one
of the category's instances has cleared, so there is no design that keeps a lingering chip meaningful
once its count is zero: it would either show a stale count or open an empty flyout.

**Packing adapts to the space, in four steps.** Chips sit spaced while the run fits; overlap by 8px
once it does not, each casting a shadow rightward with the leftmost (most severe) on top and the
hovered or open one raised clear of the stack; tighten as far as 16px of overlap before anything is
given up; and only past that does the tail collapse into a `+N` chip. The collapse never consumes a
critical chip — if the run cannot fit the critical tier plus a `+N`, the critical chips overlap past
16px instead. Below the width that would take, the run renders nothing at all rather than overflow.
Chip fills are opaque — the tier colour mixed into the surface, never into transparency — so
overlapping chips do not show each other, or the live map, through.

## The categories

Thirteen, each authored into one of three tiers at design time. Instances sort only *within* their
category, by that category's own natural measure; categories sort only by their authored tier. There
is no computed cross-domain score anywhere in this design — it is what lets housing, which carries no
ROI at all, sit on the same bar as an industry proposal without inventing a weight to compare them.

| Tier | Category | Condition | Sorts by |
|---|---|---|---|
| critical | Dying worlds | A world is losing population fast enough to end it, famine or not. | Time to abandonment (soonest first). |
| critical | Strike | Unrest has passed the point where workers walk out. | Suppression (most suppressed first). |
| critical | Maintenance unfunded | The treasury couldn't pay for maintenance the last settlement was asked to fund. | n/a — one faction-level row, count always 0 or 1. |
| important | Deprived worlds | Provision has fallen into the Deprived band. | Provision ascending. |
| important | Unrest rising | Provision is below what the population expects, before anyone strikes. | Grievance depth. |
| important | Survival stock falling | A world's food or water reserve is under three cycles from running out. | Time to empty (soonest first). |
| important | Demand unservable | A shortfall no reachable supplier or local production can close. | Unserved shortfall (largest first). |
| important | Overcrowded | Population has outgrown the housing built for it. | Cap utilisation (most over first). |
| important | No housing headroom | Overcrowded, nothing queued to fix it, and no room left to build more housing. | Population over cap. |
| important | Build blocked | The production planner wanted to build here and couldn't. | Authored reason severity, worst first; the dropped opportunity's own value tiebreaks within one reason only. |
| important | Industry idle | Built capacity that isn't running (no staff, no skill licence, or a recipe input never arrived). | Idle share. |
| info | Build opportunity | A ranked build the planner recommends, only while build automation is off. | Survival-serving builds first, then the planner's own score. |
| info | Colony opportunity | A controlled system worth establishing a colony at — physically viable and worth more than the labour its seed would drain — whether or not the treasury can currently fund it; only while colonisation automation is off. | value ÷ work, descending. |

**The critical tier cannot be hidden.** Three important-tier categories default off (Unrest rising,
Build blocked, Industry idle) because they are common and continuously true for states the player often
cannot immediately fix; every other category, including both opportunity categories, defaults on.

**A chip is an outcome; a row is a reason.** Build blocked is one chip, not five, even though its five
drop reasons (`no-capacity`, `no-input-supplier`, `no-consumer`, `no-labour`, `no-whole-level` —
`lib/engine/directed-build.ts`) have entirely different player fixes. The outcome is the same in every
case: a system wanted to build and could not. A fit-search failure on a building's footprint rather
than its labour currently reports as `no-labour` too, for lack of a dedicated sixth reason — a spec
decision, not yet made.

**Events carry no alert-bar category at all.** The three relations-owned event types
(`border_conflict`, `pact_under_negotiation`, `alliance_dissolved`) are minimum-investment content
that surfaces only in the faction-diplomacy panel and the plain faction-events list — a dedicated
Diplomacy category would mean authoring tiers and orderings for a system that faction mechanics
will eventually supersede, for content this thin. Every category on the bar today moves on the
`economyTick` channel; there is no separate event-notification dispatch channel.

## The flyout

Clicking a chip opens a panel beneath it — a `Popover` (`components/ui/popover.tsx`), the same
primitive the Tracker's own cards and settings panel use. It carries the category's name and icon, one
line saying what the condition is, the affected instances in the category's own sort order, and a
footer stating the total count with its denominator or unit — except Maintenance unfunded, whose count
is always 0 or 1 and always the player's own faction, so a footer would carry no information the player
doesn't already have; it renders none.

Anchored under its own chip, and kept off the Tracker rail by the primitive's own collision detection
against the run's reserved span, rather than a hand-measured clamp. Escape, an outside click,
one-open-at-a-time and the keyboard enter/exit convention (ArrowDown enters, Escape returns focus to
the chip) are the `Popover` primitive's behaviour, shared with every other popover in the game — see
[detail-panels.md](../design-system/detail-panels.md) for the full contract. This surface's only
addition is the content inside it.

**The flyout holds the whole list.** It grows to fit its rows, up to the height of the map area, and
scrolls inside past that. There is no row cap and no second home for the overflow — a category's
instances live in one place, in one order.

## What a row click does

**Every row does the same thing: fly the map to the system and open the destination tab**, reusing the
same fly-to-system-and-open-tab mechanism the Tracker's own rows use. The only per-category variation is
which tab, authored beside the category's tier and icon. A row's click applies no action in place and
does not close the flyout — nothing on this bar is dismissible, so a click that both acted and closed
the list would read as a dismissal, the one gesture this design deliberately does not have. A player can
walk a long category one instance at a time without the flyout closing between clicks.

| Category | Destination |
|---|---|
| Dying worlds, Strike, Deprived worlds, Unrest rising, Overcrowded, No housing headroom | system → Population tab |
| Industry idle, Build blocked, Build opportunity | system → Industry tab |
| Demand unservable, Survival stock falling | system → Logistics tab |
| Colony opportunity | system → Overview |
| Maintenance unfunded | the player faction panel's Overview (the treasury card's home) — the row is faction-level, not a system |

A row's right-hand edge is left free for a later secondary action, so an opportunity row could grow a
direct "build it" without redesigning the row.

## Settings

A per-category panel, opened from the control at the start of the chip run: a checkbox per category,
grouped by tier, **stored in the save on the player seat**. Toggling a category does not close the
panel. Critical categories render no control at all — not a disabled one, which would still suggest
the set is negotiable; the write boundary refuses one too, so the tier cannot be hidden by any route.

Every attention-layer setting is per-save, whatever kind of setting it is. A player who has hidden a
category is describing this game, not the machine they are sitting at: a second save of a different
empire starts from the authored defaults again, and a save carried to another machine takes its
settings with it.

The two `info` opportunity categories additionally only ever appear while their domain's automation is
off, regardless of what their checkbox says — the same posture the opportunity categories take
everywhere: with a domain automated, the planner's own decisions are already being acted on, so only
what it *tried and could not do* is worth surfacing.

The settings panel is itself a `Popover`, so it shares the primitive's one-open-at-a-time registry with
every chip's flyout: opening settings closes whichever flyout was open, and opening a flyout closes
settings. The control renders whenever the run mounts, whatever the chip count — it is the only way
back to these checkboxes, so it cannot depend on there being anything else on the bar to click.

## What the engine emits

Six signals exist only for this surface, persisted as optional `World` fields rather than computed at
read time — each processor already computes the underlying value and used to throw it away. All six
follow the same conventions: **absent means never assessed, not zero**; each is written for every
entity its producing run visited (the value where the condition held, absent where it did not), and
left untouched for one the run did not visit; and each is reset on abandonment and again on
redevelopment, so a re-founded colony never inherits its predecessor's reading. Nothing inside the tick
reads any of them back — they exist purely for this read surface.

- **`WorldSystem.populationChange`** — the realised change in `population` across one economy cycle,
  including migration and colony-founding transfers, denominated per reference cycle. Dying worlds'
  time-to-abandonment sort is built on it: `ln(population / ABANDON_POP_FLOOR) / k`, where `k` is the
  fractional decline rate this field implies. A donor that founds a colony this cycle reads more
  pessimistic for that one cycle, self-correcting the next.
- **`WorldSystem.populationTrend`** — a smoothed (EMA, half-life ~3 reference cycles), founding-excluded
  reading of the same per-cycle fractional population change: a colony-founding donor's debit is added
  back out of the sample before it feeds the average, since handing settlers to a colony on purpose is
  not dying, while migration losses stay in. Dying worlds' entry condition is gated on this field, not
  on `populationChange` or on famine — a well-fed world whose population is falling fast enough
  (quality-starved growth losing to unrest) now raises the alert, which a famine-gated condition never
  could.
- **`WorldMarket.stockChange`** — the realised change in `stock` across one full economy cycle, written
  only for the survival goods (water, food). The window is measured against a persisted baseline
  (`WorldMarket.stockAtLastBoundary`) rather than a value snapshotted at the boundary tick itself, so a
  delivery that lands on any tick of the cycle — not only the boundary tick — still counts. Survival
  stock falling's `stock / −stockChange` cycles-to-empty measure is built on it.
- **`WorldSystem.buildBlocked`** — the directed-build planner's best-ranked dropped opportunity this
  run: a `BuildDropReason` and the ROI of what was dropped (ordering only, not comparable across
  systems or goods). Housing refusals never appear here — they are *No housing headroom*'s signal.
- **`WorldSystem.buildOpportunity`** — the planner's own best-ranked scored build opportunity this
  run, persisted rather than re-derived so the alert bar and the planner's own decisions can never
  disagree about what counts as a candidate.
- **`WorldSystem.colonyOpportunity`** — the colony planner's **pre-gate assessment** this run: the
  establish terms for every physically viable candidate worth more than the labour its seed would
  drain. The funding gates (the treasury's running founding budget and the settler-supply cap) shape
  only what the planner founds, never this signal — a site the faction cannot yet afford keeps its
  row, and the system panel quotes the cost the verb is blocked on. The row clears when the
  assessment itself stops: the site is no longer worth it, a colony starts forming there, or the
  system leaves the candidate set.
- **`WorldMarket.unservedShortfall`** — how much of a deficit no reachable same-faction donor and no
  local production could close on the latest directed-logistics run, written on the deficit endpoint
  only. A positive level *is* the classification — there is no separate boolean to keep in step with
  it. Distinct from `logisticsFundingBound`, which means the work budget, not the galaxy, stopped a fill
  that had enough reachable capacity to succeed.

One more signal lives beside the industry engine rather than in `World` state: **`IdleReason` gained a
sixth member, `"inputs"`**, for a fully staffed, freely selling factory whose recipe input never
arrived — invisible before, since only staffing and skill licence were tracked. It feeds both Industry
idle's condition and a fourth `IndustryHealth` state, `idle`, so the Industry panel can tell a
genuinely-idle building from one decay is about to shrink. Decay cannot see a missing input (its own
context carries no market stock), so an input-starved factory is never torn down; it clears only by the
player fixing the supply chain, unlike a staffing or licence shortfall, which still clears by decay
eating the level.

One authored lookup table completes the picture: `BUILD_DROP_SEVERITY` (`lib/constants/alerts.ts`)
ranks Build blocked's five drop reasons worst-first — a presentation ordering, authored where two
quantities are not otherwise comparable, rather than a value read out of the simulation.

## World state and saves

Category visibility is player state, stored on the player seat beside the pin list and the automation
switches, and read back out on the alert payload the bar already fetches. Every key is always present:
a new world is seeded from the authored defaults table, so no reader has to treat an absent flag as
anything. It is a **required** field, which is why adding it bumped `SAVE_FORMAT_VERSION` — an older
save would load a seat with no settings record at all, and the surfaces that index it would throw
rather than degrade.

The save also carries the six signals above, all additive and optional, so those needed no bump of
their own: an old save simply loads with every one of them absent, and each category reads that the
same way it reads a system the economy has never assessed — as not in the category, not as a false
zero. On a save predating those fields, Survival stock falling shows nothing and Dying worlds has
nothing to gate or sort on until the first economy cycle after load; that is correct, not a bug.

## Out of scope

- **Richer flyout bodies** beyond a name and a measure. The bodies are deliberately thin; a later pass
  can add detail without redesigning the row.
- **A secondary "apply it" action on opportunity rows.** The row's right edge stays free for it.
- **Housing refusals inside Build blocked.** Housing carries no ROI, so a housing row would have
  nothing to sort by — *No housing headroom* owns that fact instead.
- **A faction-wide list surface for a category that outgrows its flyout.** The flyout is uncapped and
  scrolls, so there is no overflow to host anywhere else.
- **A visible hover tooltip naming the category.** The chip's accessible name already carries the
  category, count and denominator on every interaction, not only on hover.
