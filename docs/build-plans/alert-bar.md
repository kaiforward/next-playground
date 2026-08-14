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
| critical | Colony dying | `Globe` + slash | Famine world falling toward `ABANDON_POP_FLOOR`. Sorts by cycles to the floor. | Derivable |
| critical | Strike | `Megaphone` | Unrest past the strike threshold. Sorts by suppression. | Ships today |
| critical | Maintenance unfunded | `BanknoteX` | Settlement could not pay the maintenance band — the only path into destructive decay. One faction-level row. | Ships today |
| critical | **Crisis** | `Siren` | Events that can break a world — plague, raid, asteroid strike, inner-system conflict, border conflict. Sorts by phase severity. | Needs banding |
| important | Deprived worlds | `BatteryLow` | Provision in the Deprived band. Sorts by Provision ascending. | Ships today |
| important | Unrest rising | `TrendingUp` | Grievance climbing, not yet striking. Sorts by rate of climb. | Derivable |
| important | Demand unservable | `RouteOff` | A deficit no reachable donor and no local production can close. Sorts by unserved demand rate. | New |
| important | Overcrowded | `BedDouble` | Population pressed against `popCap`. Sorts by cap utilisation. | Derivable |
| important | Build blocked | `HardHat` + slash | The planner wanted to build and could not — no land, no spare labour, no affordable whole level. Sorts by the ROI of what was dropped. | New |
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

**Four important-tier categories default to OFF**, each because it is either continuously true for a
state the player often cannot fix — EU5's exact failure — or already being handled by the autonomic
brain:

| Category | Why it starts off |
|---|---|
| Deprived worlds | Common, and directed logistics is already working on it. |
| Unrest rising | An early warning for a state that Strike already announces loudly. |
| Overcrowded | The autonomic builder puts housing up on its own. |
| Industry idle | EU5's single most-hidden alert, and often genuinely unfixable. |

This is the same posture the opportunity categories already take with the automation switch: with a
domain automated the player is not told what the brain is handling, only what it *could not* do. A
player who wants to min-max turns them on.

**It also changes what the volume measurement is for.** The question stops being "does this category
survive the tier list" and becomes "does it default on or off", which is a far lower bar — a category
measured as continuously true across dozens of systems is a default-off category, not a deleted one.
The measurement is still owed; it is no longer a gate on the spec being written.

**Popover contents are deliberately thin for now:** a list of the affected systems, sorted by the
category's own measure. Per-category click behaviour and richer bodies are a later pass.

## Evidence still owed

1. **Category volume at ordinary play.** The EU5 failure this design exists to avoid is a category
   that is continuously true for states the player cannot fix, crowding out the useful ones. Every
   `important`-tier row above is a candidate: `Deprived` and `Industry idle` in particular could
   plausibly carry a hundred rows in a 600-system galaxy, which would make them uninhabitable as
   alerts regardless of how well the bar is drawn. Measure the instance count per category at both
   horizons, cohorted. Since the settings pass, this decides each category's **default**, not whether
   it exists — the four already defaulted off are the ones suspected worst, and the measurement
   confirms or moves that list.
2. **"Blocked builds are rare by construction."** This is the specific claim that saves our version of
   the blocked-build alert from EU5's fate, and it is unmeasured. Flagged as such in
   `design-attention-layer-inputs`.
3. **`RATION_EXIT_EPS`.** Carried here by roadmap row 1 with no surviving justification unless band
   transitions become an alert category. If they do, calibrate the hysteresis against a condition
   flapping on and off the bar; if they don't, delete the constant. Open either way: whether the
   hysteresis applies to the persisted display band only (presentational) or to the classifier itself
   (mechanical — the regime feeds the unrest term). Unverified; do not assume the first.

## Open, and needed at the planning pass

- **What clicking an instance does.** EU5 varies it per category — jump the camera, open a screen, or
  apply the decision in place. Ours needs the same per-category answer, and for opportunity categories
  "apply it" is a real option. It interacts with the tier list rather than following from it.
- **Where a category's full instance list lives** when it outgrows a flyout. The roadmap nominates the
  faction Territory tab (`app/(game)/@panel/factions/[factionId]/territory/page.tsx`).
