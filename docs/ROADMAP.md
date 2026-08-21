# Roadmap

The single ordered queue of work. Memory tracks only *where we are* on it — nothing else keeps a
second copy of this list. When something ships, delete its row; git is the audit trail.

An item is: **what it is**, **next step** (one concrete action), and **Don't** (only when a
plausible-looking approach is already known-dead — the line that stops a dead path being re-walked).
Rationale, measurements and war stories belong in the linked design doc or in memory, not here.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

---

## In progress

(nothing — pull from the queue)

---

## Queued

The attention layer — how the player finds what to do — is two surfaces, both shipped:
[the Tracker](./active/gameplay/tracker.md) and [the alert bar](./active/gameplay/alert-bar.md).

1. **[L] Fewer viable systems at the start; growth gated behind habitation technology.** Early
   colonisation is overwhelming — too many viable targets at once, with nothing pacing which to take.
   Direction (Kai, 2026-08-12): cut how many systems are viable at generation so expansion starts
   slow, and let the rest of the galaxy open up later, when terraforming and specialist-housing
   technologies exist. Kai's read is that this slows the simulation rather than breaking it.
   **A third lever, and the cheapest: colonisation automation defaults off**, with AI founding slowed
   enough that a player can reasonably keep up by hand (Kai, 2026-08-12). Settled alongside the
   attention layer, whose Tracker owns the *surface* for a forming colony; this row owns the pacing.
   The knob already exists: `habitableFraction` is housing-per-space efficiency
   (`habitableSpace = generalSpace × habitableFraction`), and the expensive, low-yield
   specialist-habitation *building* was recorded as a hook at that same decision — see
   [negative-space-economy.md](./planned/negative-space-economy.md).
   **Honest dependency:** there is no technology or progression system in the codebase today — a grep
   for terraforming or technology finds only event and faction flavour text. "Gated behind
   technology" is therefore a new system, not a constant change, and the sequencing of the two is
   itself part of the design.
   **A second pacing lever, from the EU5 read (2026-08-12): price the charter by distance and by
   concurrent-colony count.** EU5 scales a colonial charter's cost with population, distance and how
   many charters you already hold, plus a monthly upkeep per active colony, and caps expeditions at
   roughly one per two years. Ours is `max(CHARTER_FEE_MIN, CHARTER_FEE_SPEND_MULT × maintenanceBill)`
   (`lib/constants/colonisation.ts:81-89`) — it scales with faction *size* only, so neither distance
   nor concurrency is priced. Both are cost-shaped ways to slow expansion without making systems
   dead, and they compose with (rather than replace) the viability cut. Overlaps the control-shaped
   **claim pricing** item in [player-seat-roadmap.md](./planned/player-seat-roadmap.md) — settle the
   two together, not twice.
   *Next step:* `/measure` how many systems are viable at founding today and how fast the galaxy
   actually colonises, before touching any constant.
   *Don't:* buy scarcity by making systems dead. Barren-but-alive is a deliberate decision — rocky
   barrens carry tiny artificial habitation so they read as small mining outposts, and only pure gas
   giants are truly uninhabitable.
---

## Unqueued

No order. Pull from here when the queue empties, or fold one in when a PR is already in the file.

**Packaging**
- **[M] Desktop shell packaging (Tauri vs Electron)** — booked out of the client-runtime migration
  by explicit decision (2026-08-19, "we should do it at some point soon"). The client runtime has
  shipped ([client-runtime.md](./active/engineering/client-runtime.md)): the save-backend seam and
  worker channel this row depends on are both built. Desktop gets real transferable `.json` save
  files via the existing Node file backend (`lib/world/save-files.ts`), owns its window chrome (no
  accidental refresh), and can hold window-close for the save. The shell choice itself is the row's
  first decision.
  *Next step:* pick the shell (Tauri vs Electron).

**Economy / simulation**
- **[M] Relief — a player-funded intervention buys a viable world out of the strike loop** by
  moving goods through the real logistics simulation, never by deleting unrest. Design:
  [supply-response.md](./planned/supply-response.md) "Relief" (the arc's other items all shipped).
  Deferred from the queue by explicit decision (2026-08-10): the residual cohort is small (large
  non-famine rationing strikers + calmed-tiny worlds) and the owner wanted player-facing work
  after a long economy-math run. Gated on: the treasury accounting decision (band vs
  off-the-top), the targeted-transfer export, a costing (or booked logistics-cost row), and the
  per-category spend-attribution tooling row. New question since abandonment shipped: does an
  active relief order suspend the death line, or is the race accepted?
  *Don't:* let relief spend delete unrest directly, or buy haul capacity without a stated
  exception to the money-is-fuel invariant.
- **[M] Necessity weighting in the build planner** — the autonomic planner ranks opportunities by
  `BuildOpportunity.score` (`lib/engine/directed-build.ts:596-597, 850-856`): units of unmet demand it
  could serve, divided by route cost. That carries no necessity at all — a hundred units of unmet food
  and a hundred of unmet luxuries score identically, and nothing in the planner consults
  `SURVIVAL_GOODS`. **The alert bar shipped the fix on the read side only**, banding survival-serving
  builds above the rest on its Build opportunity chip, which exists only while build automation is
  off. So the player gets survival-first advice by hand and the planner does not follow it when
  automated — same data, two answers depending on a switch. This row closes that.
  Two things already established, so nobody re-derives them: `score` **is** demand-gated (`take` is
  bounded by the real shortfall), so the planner is not necessity-blind in effect — a food shortage
  raises food builds on its own, and what is missing is the *tiebreak* when several goods are short at
  once. And the unit bias that skews the ranking toward bulk goods is **13×** (`ship_frames` 0.6 →
  `gas` 8.0 across all 26 goods), not the "orders of magnitude" an earlier finding claimed.
  *Next step:* `/measure` how often survival and non-survival opportunities actually compete inside one
  planner run, both horizons, cohorted by developed systems — the weighting's value depends entirely on
  that rate, and Kai's prior is that it is often.
  *Don't:* copy the alert bar's band across without a sim reading. That band is a presentation
  ordering with no simulation consequence; this one changes what every faction builds at every horizon.
- **[L] Physical warehouse model — storage as a real, brake-relevant limit.** Today's storage
  constants (`EXTRACTOR/PRODUCTION_STORAGE_PER_UNIT`, `POP_CENTRE_STORAGE`) only deepen `maxStock`;
  they are authored per *producing* building while the brake knee is 40 cycles of *system-wide*
  draw — measured at the stage-3 gate 16×–843× apart per good (~143× at the median producing
  market), which is why capping the brake's taper with them hard-stopped production galaxy-wide
  and the cap was removed (Kai 2026-08-05). A real model makes warehouses something the game
  *builds*: the brake knee (40 cycles of use / 8 of output) is the natural capacity target the
  autonomic build works toward — storage becomes a build product balanced against production and
  consumption, not a seeded constant. Evidence preserved: gate report §7/§7.1 per-good tables
  (`temp/stage3-gate-report.md`).
  Kai's leaning (2026-08-05): industry pricing probably lands here too — it touches the same
  ROI/build-planner surface, so the ROI ordering gets retuned once, not twice.
  *Next step:* design pass + `/spec-review` (cross-mechanic: brake, pricing band `maxStock`,
  autonomic build, decay, Industry UI).
  *Don't:* re-size the existing constants to make a brake cap work — no single multiplier fits a
  16–843× per-good spread, and inflating them inflates every pricing band with them.
- **[L] Goods-pricing revisit** — moved way back from the economy queue by explicit decision
  (2026-08-03): pricing is only worth reworking when demand becomes partly monetary — pop wages
  and real goods purchase, or inter-faction trade agreements / shared markets. Also absorbs
  **separating `surplusDrawable`'s triple duty** (logistics donor cap / build input gate / founding
  manifest cap — three consumers of one figure, deferred at colonisation-economics). Kai's observation
  (2026-08-05, unmeasured): lots of edge cases with producers/consumers not reading the price based
  on type properly, which is why at least one shipped mechanic routes around live prices rather than
  reading them; `/measure` it when this row comes forward, since the row that named which mechanic is
  gone. Carries an unresolved finding: an exporter's resting price pins at its ceiling (measured at
  equilibrium: 3.00× / 3.00× / 2.50× for `electronics` / `luxuries` / `fuel` — a drawn exporter
  rests at `EXPORT_RESERVE_COVER`, below the curve's saturation point, so the curve clamps, and
  price stops being a health gauge on exactly the cohort that ships goods). Acceptable meanwhile:
  exporters run drained by design, importers carry the dispersion.
  *Don't:* lower the anchor (retracted: measured at 125 cycles, inside the ~300-cycle startup
  transient — run unmodified to 416 cycles the galaxy reaches price median 1.23× on its own) or
  raise the export reserve (withholds real stock from importers). If grading is wanted, the lever
  is the curve's saturation point — which makes the `MarketCurve.k` item below this work's natural
  first slice.
- **[M] Good-allocation cliff — how logistics splits a scarce good across demanding systems.**
  Gate 1 of supply-response measured per-good satisfaction as violently bimodal: on worlds below
  full Provision, individual goods sit at 0 or 1 with almost nothing between. Hypothesis: greedy
  fill — each receiving system takes its full demand while in-range supply lasts, so at most one
  system gets a partial fill and everyone after gets zero. If confirmed, the fix is an allocation
  policy weighing availability against the number of demanding systems (candidate policies listed
  on the logistics-pillar depth check row below; possibly player-configurable). Complements the band /
  critical-good mechanics — partial-satisfaction states make `CRITICAL_SATISFACTION` a live line
  instead of a formality. Sibling of the logistics-pillar depth check below.
  *Next step:* `/measure` the directed-logistics fill order to confirm or kill the greedy-drain
  hypothesis before any policy design.
- **[M] Per-good price response (`MarketCurve.k`)** — make "water spikes under scarcity, luxuries don't"
  real by giving each good its own price-curve exponent, without touching demand. `DEFAULT_ELASTICITY`
  is 1 for every good and `priceFloor`/`priceCeiling` is a pure tier lookup with zero per-good variation.
  Likely folds into the goods-pricing revisit above when that comes forward.
- **[M] Government layer revisit** — `GOVERNMENT_TYPES` carries only event weights and a danger baseline
  since the flat `consumptionBoosts` term was deleted. Governments are economically inert until something
  replaces it as an economic axis. The leading candidate: **doctrine-driven allocation of discretionary
  spend** — a per-government budget split over the two spends a faction chooses (construction and
  founding; maintenance and logistics are obligations, not choices), so expansionist empires commit more
  surplus to colonisation and read as sprawling many-world realms while tall ones concentrate into dense
  developed cores. Emerges from priced founding; composes with the ROI/`Proposal` review lens. Distinct
  from the funding sliders, which throttle payment of bills already arrived — this shapes what gets
  committed upstream. Needs the treasury spend-attribution row (Tooling) built first.
  **Design space, not a decision** (Kai, 2026-08-08): an EU5/Vic3-style **control/integration**
  primitive — a per-system stat a newly-taken or remote world starts low on, that scales BOTH tax
  pressure and tax income together (today `TAX_LEVEL_UNREST_PRESSURE` lands flat on every owned
  system while income scales with economic activity, so a two-pop colony carries the homeworld's
  unrest pressure for epsilon income). Distinct from adaptive expectation (which scales what
  population *demands*) — control scales what the *state extracts*; its value is the wider surface
  (occupation, distance, government types, doctrine allocation), not solving the founding-strike
  problem, which expectation already dissolves alone.
- **[XL] Pop wealth and buying power** — pops hold wealth and must afford their basket, so demand becomes
  partly monetary. Provision survives as a ratio and stays distinct (a world can hold the wealth and still
  lack the goods). The former blocker — `demandRate` double-purposed as pricing anchor and logistics
  deficit anchor — cleared with #211/#212 and the `TARGET_COVER` role split: pricing keeps the floored
  `demandRate` denominator, logistics and founding read real demand. Unlocks the strata-as-private-builder
  mechanic on the social-strata row above — wealth pops hold is what a private builder spends.
- **[L] Expanded pop tiers / social strata** — today's tiering is labour-grade only. Richer strata carry
  their own baskets. Composes with adaptive expectation (per-class expectation is how Victoria 3 derives
  its reference); nothing breaks if it never lands.
  **Also carries the strata-as-private-builder mechanic** (scoped 2026-08-12): in both reference
  games the strata are a *second builder* that is
  neither the player nor automation — Victoria 3's investment pool splits the construction queue into
  private and government by economic law; EU5's estates build regardless of the player's automation
  settings and their builds cannot be cancelled. The interesting axis is **ownership, not output** —
  same buildings and goods, but the returns bypass the treasury and tearing one down costs political
  standing. Gated on real pop wealth (the row below, and the purse's Stage 3 monetisation staging),
  since a stratum cannot invest what it does not hold.
  *Don't:* give the private builder its own construction pool without deciding how it shares the
  physical ceiling — a second unexamined pool breaks "money is fuel, not capacity".
- **[S] Loose ends out of scope for band reconciliation, unpicked-up since** — noted but not designed:
  a legible EU5-style reserve/stockpile mechanic (visible policy-set stockpile, crisis
  release/requisition, war stores, rationed by access) — ties to purse Stage 2-3 monetisation and
  the priced-logistics/military/industry-pricing cluster above; rent or housing-quality goods;
  distance-weighting the autonomic-build spare pool (a possible refinement to the response-pacing
  backstop, noted, not built). No design pass on any of the three; pull individually when its area
  comes forward rather than as a group.
- **[M] Disasters / decline realism pass** — the timescale calendar carries an accepted ~100:1
  death:growth asymmetry forward unexamined: `overshootDeathRate` stays at 0.05 (fires only above
  the unrest gate — calm overcrowding just stops growing, crisis shedding stays short and violent),
  while `declineRate` now scales with growth, so famine decline runs ×30 slower in real terms than
  before the calendar shipped. Decide what disaster-driven decline should mean at the new anchor —
  whether that slowdown is the right shape for a famine or crisis event, and whether the
  death:growth ratio itself is a deliberate design point or an artifact worth revisiting.
  *Next step:* design pass on what "disaster" means at the new rates.
- **[M] Housing relief valve: size the burst from current pop growth** — `plannedHousingUnits`
  (`lib/engine/directed-build.ts:266-279`) builds one instantaneous burst back to `RELIEF_TARGET`
  0.92 once occupancy passes `RELIEF_TRIGGER` 0.95 — ~3-8% of current popCap in whole levels at
  once (a seeded 250-level world commits ~18-22 housing on its first plan). The burst size silently
  encoded the old fill rate: headroom that filled in weeks at ×2.5/year growth takes ~2 years at
  3%/year, sitting as unstaffed landings meanwhile — the timescale gate read 54% of levels landing
  into systems with labourFulfil < 1, vs 8.7% pre-change (pooled across types; not yet split).
  Direction (Kai, 2026-08-19): derive the build size from the CURRENT population growth rate — build
  what will fill within a near-term horizon — so the valve survives future growth/scaling retunes
  instead of re-encoding a rate assumption. Design carefully: trigger oscillation, the decay
  containment invariant (`RELIEF_TARGET × (1 + VACANCY_SLACK) ≥ 1`), and whole-level lumpiness on
  small sites all constrain the sizing.
  *Next step:* `/measure` — split unstaffed landings by building type (the trajectory instrument's
  landing diff needs a per-type split) and read the fill time of a relief burst at the new rates.
- **[S] Measure why construction centres never funded pre-timescale** — zero centre commits
  anywhere in the pre-timescale equilibrium run (surfaced as a baseline fact at the timescale
  build plan's Gate B, owner-deferred out of that PR). At the shipped constants they do fund —
  every faction committed and completed exactly one in the 50K trajectory read — so the question
  is why the old `PAYBACK_HORIZON`/`BACKLOG_WINDOW` regime priced them out entirely, and whether
  one-per-faction is the intended pacing now. ROI competition against backlog draining has not
  been separated as the cause.
  *Next step:* `/measure` before any centre-tuning design.
**Tick performance**

To reprofile `runWorldTick` (~15 min): temporarily add an `export const __tickProfile:
Record<string, number>` + a `__mark(section)` closure to `lib/world/tick.ts`, stamp every section
boundary keyed by `boundary|off-boundary` (`tick % 24 === 0`), drive it from a `scripts/` tsx script
(bare imports don't resolve from a scratchpad script) that generates a world, runs one warm-up cycle,
clears the profile, then times 4 cycles; `git checkout lib/world/tick.ts` reverts cleanly. Always
record a whole-tick total and assert marks sum to ~100% of it — a decomposition that stops at the last
processor silently misses the assemble step. A/B only within one process: the same tick measured
29.26ms after a 600-system world in the same process vs 21.17ms measured alone (GC pressure), so
absolute ms are not portable across sessions or runs. To prove a gating/caching change by identity
rather than inspection, hash `JSON.stringify(world)` after N ticks and require byte-equality (hash the
broadcast split — payload apart from `processors` — or a diff in the unread run-list masquerades as an
SSE-payload diff).

Three guesses this profiling killed, so nobody re-reasons to them: "off-boundary ticks are free, so
gating adds galaxy walks" (false — everything except relations already rebuilt its full setup every
tick pre-#180); "`marketRowsBySystem`/`buildBuildRows` are the big costs" (no — 3.8%/0.8%, and a later
re-measurement of `marketRowsBySystem` alone found 9.5%, the *smallest* gateable item, after an
earlier estimate had it at 12.3%); "it's the systems/buildings merge" (no — `mergeSystems` 0.57ms,
`flattenBuildings` 0.13ms; the cost is markets, and only markets).

- **[M] `toTickSystems` is the whole mid-cycle tick outside events** — 2.5 ms/tick at 2,400 systems,
  19.0% of a mid-cycle tick. Gating can't touch it: ship-arrivals and events both run every tick and both
  consume `TickSystem` rows. *Next step:* check what those two actually read (ids/names; ids/names/control/region)
  before assuming the full row is needed — narrow it, don't skip it.
- **[M] The events processor scales worst in the tick, and is now two-thirds of it** — ~7× the cost for
  4× the systems; its share went 19.4% → 67.5% as everything around it was hollowed out. At 10,000+ systems
  this is the wall. *Next step:* fold into the events re-point ([grand-strategy-vision.md](./planned/grand-strategy-vision.md) §4)
  rather than fixing standalone — that pass rewrites the model anyway.
  Percentages are the portable figure; absolute ms move with machine and load, so re-baseline in-run.
- **[M] Markets need a real dirty/ownership model** — the events adapter copies every market row in the
  galaxy every tick (~62,000 at 2,400 systems) and almost never writes one. The copy is **load-bearing**,
  not waste: it de-aliases rows the previous world still holds. *Next step:* a design pass on copy-on-write
  rows or a dirty flag. *Don't:* reference-identity dirty-checking — the adapter hands back fresh rows
  whether or not anything changed, so it always reports dirty. Real save-corruption risk if aliasing leaks.
- **[L] Engine tick at aspiration scale (10-20K systems)** — the tick-speed audit's measured curve
  (reading C1 of the deleted tick-speed-audit working file; git keeps it): sustained Node TPS at the
  10,000-tick horizon is 118.8 / 56.4 / 22.7 / 10.5 at 600 / 2K / 5K / 10K systems, with the
  developed cohort FLAT (~440-500) across scales — so the cost is total-system-scaled machinery
  (join/merge ~46% of tick time; directed-build scans the full system list), and the 5 TPS
  reference crosses at ~19-20K systems extrapolated, at the cheapest era the game has. No current
  preset hits the ceiling, so this is not urgent — it becomes real work when content pushes past
  ~10K systems or a later era fattens the developed cohort. The frame-architecture fix cannot
  carry 20K alone: engine and host both need their pass before anything steers players toward
  galaxies above ~10K. The sibling rows above (toTickSystems, events scaling, market dirty model)
  are the known mechanisms; this row is the umbrella target that decides when they come forward.
  *Next step:* a comparative-target research sprint — for Stellaris, Vicky 3, EU5 and peers,
  establish wall-clock per game-year at max speed (our tick is 4/day, 24-tick week, so cross-game
  comparison is by game-time rate, not raw TPS) and the count of selectable/controllable units
  (Stellaris ~1K systems but multiple controllable bodies per system; EU5 ~22K locations) — then
  set this row's explicit target ("at N units, a game-year in ≤X s") and decide which sibling row
  moves first against the post-frame-architecture browser curve (measured 2026-08-21, founding
  era: ~350→250 / ~55 / ~16 / ~6 TPS at 600 / 5K / 10K / 20K).
  *Don't:* tune against the 10,000-tick horizon's TPS as if it were equilibrium — it is founding
  era (~year 7), the cheapest era; late-game numbers are strictly worse and unmeasured.
- **[XL] Native engine core (Rust) for tick speed** — port the pure tick (engine + processors) to
  Rust once JS-side work stops paying. The seam already exists: the worker channel isolates the
  engine behind subscribe/command messages, so a native core behind a desktop shell is a contained
  swap ([client-runtime.md](./active/engineering/client-runtime.md), "Rust behind a desktop
  shell") — same messages, same React UI. Gated on two things from the aspiration-scale umbrella
  row above: the comparative-target research sprint setting the actual goal ("at N units, a
  game-year in ≤X s"), and the algorithmic sibling rows (toTickSystems, events scaling, market
  dirty model) being fixed or judged first — a port buys a constant factor, and the measured
  bottleneck is total-system-scaled machinery, which ports along with everything else.
  *Next step:* nothing until the comparative target exists; then a design pass on the seam
  (what crosses the boundary per tick, and where the world state lives).
  *Don't:* start the port to fix a specific slow processor — that's the sibling rows' job in JS,
  where the fix is cheap to iterate on.

**Types / correctness**
- **[S] `.get(...)!`-in-tests idiom decision** — 8 sites use a postfix-`!` `Map.get` in tests (against
  the Conventions rule that only allows it in `find(...)!`). Deferred at the fix wave that found them,
  not booked. Decide: sweep them to a real check, or widen the accepted-idiom carve-out to cover
  `Map.get` too.
  *Next step:* raise whenever test conventions next open; not urgent on its own.
- **[M] Type `goodId` as a `GoodId` union instead of `string`** — `GOODS` is `Record<string, GoodDefinition>`,
  so `GOODS[goodId]` type-checks and never narrows to `undefined`. Not a live bug (world-gen seeds every id
  from `Object.keys`), but load-bearing at ~10 point-of-use sites since the market round-trip was deleted.
  89 declaration sites across 96 files — its own PR. *Blocked on a decision:* the save-file `deserialise`
  boundary needs a guard narrowing `string` → `GoodId` with a decided failure mode (reject the save, or drop
  the row). Don't start without settling that.
- **[S] `estStaffing` and `buildingUsed` read staffing differently for support types** — `min` over the
  grades a building actually draws, vs `count × labourFulfil` (unskilled only). Display-consistency, not
  correctness; worth one shared staffing-estimate helper.

**UI**
- **[M] How far to push map accessibility** — raised and unsettled (2026-08-13): the Pixi map is not
  accessible at all, so how much of the rest of the game is worth doing given that ceiling? The
  narrow piece that WAS decided already shipped with the Tracker — a keyboard enter/exit convention
  for popovers, as interaction design, not accessibility charity.
  *Next step:* Kai's call on scope before any design pass.
- **[M] Dedicated goods tab** — a per-system goods surface with more depth than the Population or
  Industry tabs carry: per-good cycles of cover against the anchor, the regime (Supplied / Low
  reserve / Rationing / Shortage / Glut), civilian versus industrial draw, local production against
  local use, and what logistics is moving in or out. Replaces what the Market tab was for; the
  market table is a trading-game leftover that the presentation layer deliberately left alone rather than half-fixing
  it. Needs an interaction design pass — this is the third goods-bearing surface, so it must earn
  its place against the needs ledger and the industry roster rather than duplicating them.
  *Don't:* rebuild it as a price table — cycles of cover is the unit, price is a secondary read.
- **[M] A full construction screen — every active project, not just the front.** The Tracker caps its
  Building section at 10 rows, because a real faction runs ~44 funded builds at once and a panel meant
  to be scanned cannot carry them. The capped rows and the queue behind the front are both summarised
  as counts, so there is currently **nowhere to see the whole queue** — the per-system Industry tab
  shows one system's builds, and the faction construction card shows systems-with-counts, neither of
  which is the full list. Wanted: a sortable, filterable view of every open project across the faction
  with its progress, funding rate and ETA. Surfaced by the owner while running the Tracker in a real
  game (2026-08-12).
  *Next step:* decide whether it is a faction-panel tab or its own route before any layout work.
  *Don't:* rebuild it as a second Tracker. The Tracker answers "where is my pool going right now";
  this answers "show me everything", and the two want different orderings and different densities.
- **[S] Funding sliders: show the set value immediately, shorted-only exception** — today's "set X% · runs Y%"
  duplicates the number in steady state and conflates the one-cycle latch lag with genuine insolvency.
  *Next step:* needs the settlement snapshot to persist the slider values used at settlement — a
  `WorldTreasurySettlement` field, i.e. a save-format bump. Touches `FundingSlider`, the treasury processor,
  and the construction-card readout.
- **[M] Faction-screen colonise verb with map target selection** — the construction command card gets a
  colonise action entering a map target-selection mode (eligible systems highlighted, click to direct),
  explicitly not a dropdown. Needs a short interaction design pass first.
- **[S] Needs-tooltip language pass** — the needs-ledger / pop-short tooltips ship with figures plus one
  placeholder sentence, pending a nested-tooltip pass. Fold the two near-duplicate bodies (`NeedTooltip` in
  `population-panel.tsx`, `PopShortTooltipBody` in `industry-panel.tsx`) into a shared shell then.
- **[L] Paradox-style nested/pinnable deep tooltips** — tooltips whose terms are themselves hoverable,
  pinnable for comparison, backed by a cross-linking concept glossary. Needs a design doc + collaborative
  HTML-prototype pass. Core genre UI post-pivot, not polish. The theme already reserves a copper treatment
  as this system's second tier.
  **The primitive shipped with the Tracker** (`Popover`, `components/ui/popover.tsx`) — a Radix-Popover-based
  popover with hover-to-open, keyboard access and a safe transit area, scoped to one level. What stays here:
  **nesting** (a parent popover must not close while a child is open — neither Radix primitive gives this,
  so it is custom either way), pinning, the glossary, and **migrating the existing plain Radix tooltips**
  onto the popover, which is deliberately deferred rather than done alongside the Tracker.
  Design input worth not losing: Paradox tooltips **follow the cursor until you hold still, then latch**
  so you can move onto them. That is a legitimate alternative to a grace-area polygon and arguably
  simpler; decide between them at the prototype pass.
  *Don't:* design the nesting model before there is a real chain of descriptions to design against —
  the shape follows the content, and the Tracker needed only one level.
- **[S] Game-term glossary** — one doc defining the game's terms of art in plain language (pop = 1
  million people; tick/cycle; Provision; bands; cover; unrest/strike; control ladder…), written as
  the single source tooltips and tutorials quote from. The nested-tooltips row's "cross-linking
  concept glossary" is this doc grown hyperlinks — start it flat, don't wait for that system.
  The time-anchoring counterpart already shipped — SPEC.md's Calendar section anchors ticks to
  in-world time; this row anchors vocabulary instead.
- **[S] Move the dev cheat-panel button to the header** — the map sidebar and other floating elements block it.
- **[S] Standardise main content panel size** — system detail should be smaller than command center.
- **[S] Unrest history / recovery forecast** — a per-system chart of unrest over time and a forecast
  of recovery trajectory, beyond the Population tab's current expectation/grievance snapshot.
  Backlog polish, not started.
- **[S] The Provisioned map mode cannot show Famine.** Famine punches through at any Provision level
  (`foldSupplyState`'s survival branch, `lib/engine/population.ts`), so it cannot be represented as a
  step on a Provision ramp the way the other bands are. Surfaced while building the alert bar, unrelated
  to it. Needs a visual treatment (a distinct marker layered over the ramp, most likely) before Famine
  is readable from that map mode at all.
  *Next step:* fold into whichever map-modes pass picks this up next — no design pass yet.
- **[S] A build fit-search failure on *footprint* reports as `no-labour`.** There is no dedicated sixth
  `BuildDropReason` (`lib/engine/directed-build.ts`), so a site rejected for lack of space is attributed
  to lack of workers. A spec decision, not a bug.
  *Next step:* decide whether the sixth reason is worth its own band before adding it.
  *Don't:* let the width drift silently in the meantime — the packing tests derive their expected
  widths from the same constants they check, so a mismatch would only ever surface as visual overflow,
  never a red test.

**Audits Kai has asked for**
- **[M] Trader-hangover audit** — sweep the codebase for leftovers from the old browser space-trading
  game that don't serve the grand-strategy vision, on the three-pillar basis (population, industry,
  logistics; the player is a faction ruler, not a trader). Requested, never started. Known instances of
  the class already found this way: `quoteTrade`/spread/buy-sell columns (deleted), the map price mode
  (cut), `GOODS.volatility` (still present as unread metadata since the noise path was removed in #170).
- **[M] Logistics-pillar depth check** — the pillar is still shallow; e.g. penalised cross-unowned-space
  logistics was inherited from a retired umbrella and never built. Its own pass before calling the
  pillar done. Includes **hauling founding freight with real ships** — the staged manifest currently
  teleports source→colony at completion; deferred at colonisation-economics to whenever logistics
  carries real cargo. Also absorbs **unifying people-movement**: one-hop diffusion migration and the
  faction-pool colonist delivery do the same task for different reasons and should become one routed
  system when logistics carries people (decided at the abandonment measurement, 2026-08-10; the
  interim famine gate on delivery is explicitly temporary scaffolding for this). Kai's design
  leanings for the pass (all leanings, not decisions):
  - **Hub/chain is the real hard part** (2026-08-03): difficulty should come from being part of a
    *chain* — infrastructure, cost, labour, distance — not per-world stock thresholds. A
    throughput/entrepôt world would request more inbound when its exports hit their limit (demand
    propagating upstream through hubs) while producers near consumers ship direct. The point-to-point
    matcher today has no hub concept.
  - **Flow priority is a lever** (2026-08-03): the matcher's sink ordering (severity = shortfall ×
    draw, worst-first) is designable — e.g. scaling need by relative size so a tiny colony's request
    can outrank raw tonnage, with a mechanical player lever over priority.
  - **Player exposure stays coarse**: sensible defaults for thresholds, never raw per-good
    warehouse valves (unmanageable, illegible). At most one coarse in-fiction policy (a faction
    stockpile stance); real control lives in automation toggles, budgets, directed orders.
  - **Scarce-good allocation policy candidates** (2026-08-08, feeding the good-allocation-cliff row
    above), if the greedy-drain hypothesis confirms: (a) spread available supply evenly across
    demanding systems; (b) satisfy lowest-Provision systems first; (c) band-maximizing — scale
    exports so as many systems as possible cross a higher satisfaction band without maxing any one out.
  **Absorbs the former flow-visualisation row**, retired 2026-08-12: a logistics overlay already
  ships on the map, and designing a second flow view before this pass changes what flows is
  backwards. Its approved HTML prototype survives as an input —
  [ui-ws2-map-modes.md](./planned/ui-ws2-map-modes.md) (P2, flow-viz).
  **Carry necessity into the routing calculations too** (Kai, 2026-08-16). The same gap the build
  planner has: logistics decides what to haul from shortfall quantity and route cost, and a unit of
  unmet food ranks alongside a unit of unmet luxuries. Sibling of the necessity-weighting row under
  Economy — settle the two together so survival goods are not privileged in one pillar and not the
  other. The concrete place it lands is the **good-allocation cliff** row above, which owns the
  allocation policy; this line exists so the pillar pass does not design that policy necessity-blind.
- **[S] §3.5 player-directed colony founding** — the mechanism (`employedGradientThreshold` speed-dial)
  ships **inert but tested**. Wire it when the player-agency phase reaches it.

**Tooling**
- **[S] Rebuild lint for the Vite stack** — eslint left the repo with the Next retirement (its
  config was `eslint-config-next`-bound; nothing in CI ran it). Wanted back for what tsc can't
  see: `react-hooks` (`rules-of-hooks`, `exhaustive-deps` — stale-closure bugs in the store-hook
  layer) and `jsx-a11y` (the component tests lean on roles/accessible names). Flat config,
  `typescript-eslint` + the two plugins, a `lint` script; owner decides whether it joins the CI
  gate. *Next step:* write the flat config and run it once over the tree to size the fix-up.
- **[S/M] Overnight mutation re-sweep** — the first Stryker cycle (merged 2026-08-09) swept 40 files;
  the remaining ~66 `lib/` files have never been swept at all. Owed: an overnight re-sweep of the 40
  (incremental cache invalidates most of them anyway) plus a first sweep of the rest, same
  kill-or-accept discipline as the first cycle. **Noise-survivor warning:** the review that closed
  cycle 1 reverted the mutator-class exclusions in `stryker.config.mjs`, so the re-sweep will
  re-report the ~204 already-accepted noise-class survivors (`temp/fix-wave/noise-ledger.md`) —
  don't re-triage them.
  *Next step:* schedule the overnight batch (`--concurrency 8`, pre-approved) for a window Kai isn't
  using the machine.
- **[M] Sim gates beyond the four founding identities** — agreed rule: a gate fails only when the
  code is broken, never when the balance is off; if a designer could plausibly fix it by changing a
  constant, it's a bar to read, not a gate. Three families, all seed-proof (never "X of Y systems"):
  (1) **invariants** (any seed/tick) — no non-finite number, no negative stock/pop/popCap/levels,
  bounded [0,1] fields, tick never threw; (2) **liveness**, strictly `>0` and skip-with-printed-reason
  below the warm-up tick counts — something transported/built/founded/migrated/taxed/resolved an
  event; (3) **pathology** (the tail) — stranded systems, total collapse, divergence ceilings. Price
  gates are explicitly OUT ("we don't care about price of goods right now"). Determinism does NOT
  belong in the sim — a Vitest test on a tiny world proves it in seconds. Kai also wants integration
  tests eventually — raise how the two relate when either starts.
  *Next step:* design pass turning the three families into an actual gate list, then `/spec-review`.
- **[S] Doc-lifecycle gate** — a script failing when a `docs/planned/` doc names an identifier that
  exists in `lib/` (i.e. the doc describes shipped code in the tense of outstanding work), wired into
  `/uber-review`. Seven of fourteen `docs/planned/` docs had rotted this way at the process-overhaul
  audit; ~an hour of work would have caught all seven.
  *Next step:* write the script and wire it into `/uber-review`'s conventions lens.
- **[S] Component tests for the two interactions still proven by nothing** — tooltip open state and
  keyboard navigation. Both are within what jsdom can honestly verify: a tooltip's open state is an
  accessibility-tree fact (`aria-describedby`, the content appearing), and keyboard navigation is
  interaction, driven by `user-event`. The needs ledger's rows are the concrete case — `NeedRow`
  carries `tabIndex={0}` and a focus-visible ring, and nothing exercises either. Deferred from the
  jsdom port, whose scope was replacing the existing html-string tests, not adding coverage.
  *Don't:* extend this to appearance. Colour, size, position and layout are unverifiable without a
  real browser, and asserting them in jsdom buys a test that passes while the thing is invisible —
  that belongs to the integration-test thread, not here.
- **[S] Per-category treasury spend attribution** — the tick merges charter fees and staged materials
  into one `foundingDebitsByFaction` figure, so the harness can neither check the charter conservation
  identity in money (it falls back to counting colonies) nor say what any faction spent on what in a
  given cycle. Split the instrumentation per category (charter / staged materials / construction /
  maintenance / logistics) and print per-cycle spend by category in the harness. An oversight of the
  colonisation-economics spec, booked at its calibration gate. Prerequisite for tuning doctrine
  allocation (government layer revisit) and for the founding-constant retune when the sibling treasury
  drains (priced logistics, military, industry pricing) land.
- **[M] Pre-existing mutation survivors in the colonisation-adjacent files** — the PR #217 scoped
  sweep (27 files) surfaced ~1,000 surviving/no-coverage mutants on lines *outside* that PR's diff;
  the in-diff ones were handled at the PR's own gate. Heaviest: `lib/world/tick.ts`,
  `lib/engine/directed-build.ts`, `lib/tick-harness/runner.ts`. The incremental cache
  (`reports/stryker-incremental.json`, machine-local) makes re-runs minutes, not hours.
  *Next step:* chip file-by-file, worst first, same kill-or-accept discipline as the PR gate.
- **[S] Harden the runner integration suite's thin anchors** — found while re-deriving the
  drawBrakeCeiling divergence fixture. The gate-split identity test (`runner.test.ts:152`,
  `charter + funds + pool + unGated === observed`) passes vacuously: the 20/7/240 fixture never
  exercises three of the four buckets (all zeros), so a broken classification still satisfies the
  identity — same hollowing-out class as the divergence failure, but silent. Three sibling
  assertions rest on counts of exactly 2 (`materialsShortUnderEvent`, founder `systemCount`,
  `inFlight.max`) and zero out on modest tuning changes; `budgetSpentFrac` passes at 0.006% spend,
  a near-vacuous read of the haul-budget ledger.
  *Next step:* one fixture-derivation pass giving the gate-split test a scenario with all four
  buckets non-zero; document or widen the count-2 anchors while there.
- **[S] Decide the simulate "equilibrium" horizon** — the quick run's 10,000-tick label sits inside
  the startup transient for high-tier consumer metrics (electronics/luxuries recoveries land
  t≈9,500-11,000; ship_frames later still). Options: extend the labelled horizon to 12-16k
  (+20-60% runtime on every run) or keep 10k and rely on the documented trap
  ([measurement-traps.md](./active/engineering/measurement-traps.md), "The horizon"). Kai's call;
  surfaced 2026-08-03.
  **The timescale calendar inherits and sharpens this row**: at the shipped rates the first colony
  founds ~tick 4,128, so the 1,000-tick startup horizon is now entirely pre-founding (zero
  colonies, zero migration, zero transfers) and the 10,000-tick horizon is founding-era
  (~in-world year 7), not equilibrium — founding-era questions need ~5,000+ ticks, and true
  equilibrium sits far beyond 10K (galaxy maturation runs ×10-×30 slower at the new anchor). The
  decision is now to re-pick BOTH horizon labels and lengths, not just extend one.
- **[M] System-finder dev tool** — queryable dev panel or `scripts/` CLI surfacing representative systems by
  characteristic (population band, economy type, deposit profile, building roster, NaN checks) with a direct
  `/system/<id>` link. Recurring need whenever generation or economy changes land.
- **[S] Age-since-founding cohort axis for the harness** — deliberately cut. Only colonies founded *during*
  a run carry a `foundedTick`, so every seeded system lands in one bucket, which at equilibrium is most of
  the galaxy. `foundingStock` already covers the in-run cohort. Revisit only if a real founding-age cohort
  is needed; it requires threading `foundedTick` onto `TickSystem` and world state (save-format).

**Parked by an explicit decision — don't re-propose as new**
- **[S] Colony seed size scaled against the housing unit** — a 2-pop seed against a 20-pop housing level
  means no colony can open looking anything but empty. Variant on record: send what the founder can spare,
  up to a whole level. Changes colonisation pacing and the AI founding policy, which is why it parked.
  Eligible to un-park now founding is priced — pacing changes land on a costed mechanic, not a free one.
- **[S] Luxuries weighted higher for engineers** — Kai's point is that engineers should be *more* annoyed
  when luxuries are missing. The engineer basket already carries luxuries at 50× the per-capita rate;
  whether that is enough is demand tuning. Revisit once the galaxy isn't starving.
- **[S] `idleBufferMonths`** — the fallback lever if the tighter colony-opening absorption proves too slow.
- **[S] Decide the fate of `docs/planned/economy-specialisation-s4-guardrails.md`** — a pre-pivot
  discussion agenda (findings F1-F6, hypotheses H1-H3, a 10-item calibration lever list) paused
  2026-07-03 and never resumed. **Its entire evidence base is unverifiable**: every figure was measured
  against a live Postgres world via `npm run audit:economy`, and neither the database nor the script
  exists any more. The doc now carries a warning header saying so. Read the questions, discard the
  numbers, and either re-measure the survivors with `npm run simulate` or delete it.
- **[S] The `[1.3, 1.4)× self-supplier lock` as a bug** — closed as intended, 2026-08-03. A
  self-supplier whose stock sits between the production brake and the donation margin has
  production halted and donation refused, exit only downward — ruled **chosen conservatism**: a
  world producing less than it uses shouldn't dump stock it can't replace. Measured false before
  closure that it "can only re-donate what it was given" (the generosity rule fires 2.9%/1.8% of
  hauls at startup/equilibrium, 95% of those donors held made, not given, stock).
- **Necessity as demand-curve slope** — killed as structurally unbuildable at review; the shipped
  replacement is necessity as an **authored per-good weight** on the unrest fold. `demandRate`
  itself is not movable to carry necessity: it is the unit of account for a good in a system —
  price anchor, market band, ration threshold, producer glut/decay signal, logistics deficit gate,
  build planner's capacity sizing, colony founding stock, and the harness cover metric all key off
  it. Anything that moves it moves all of those.
- **[S] Per-tick construction funding** — killed 2026-07-17. Its Victoria-3-parity motivation
  didn't survive a check (Vic3's queue-timing window is ~28 base ticks vs our 24, larger, and its
  bars move weekly). The month-long funding lag is a granularity artifact of the coarse economy
  tick, not the deliberate demand-anchor lag — reordering the economy ahead of directed-build was
  considered and rejected (would fund construction off month-start pop/stocks). If responsiveness
  ever matters the lever is a finer economy cadence, not construction staleness.
- **Map price mode** — cut 2026-07 as premature; a trader hangover; price is the *opportunity* tool
  for a trader and the player is a faction ruler. Event pills were stripped from the map at the
  same time. Flow overlays survive as ambient world-legibility and are still queued (logistics-pillar
  depth check row).
- **Retiring the idle channel for housing** — superseded 2026-07-27, never built. Targeted a minor
  collision (12 months to bite, spare level only); sizing colony housing to the seed dissolves it
  by construction. The actual colony-killer was the unrest channel, not this.
- **Cycle 24 → 28 ticks for Earth-week/Vic3 parity** — killed at the timescale brainstorm,
  2026-08-19. `CYCLE_LENGTH` feeds logistics cadence, treasury settlement, pricing cadence and
  every cycle-denominated constant; stretching it 17% for a calendar *label* with zero simulation
  meaning was rejected — the fiction absorbs the week length instead. Same session killed 1h ticks
  (100y ≈ 876K ticks, ~49 wall-hours at 5 ticks/s) and 1-day ticks (against the fine-grained-ticks
  lean).

**Deferred / conditional**
- **[S] Relations' trade-volume drift driver is dead code** — `getTradeVolumeBetween` counts only
  cross-faction flows (`lib/tick/adapters/memory/relations.ts:191`) and every flow row is
  same-faction by construction, so the "recent trade" drift term has never fired. Found at the
  honest-demand-and-flow spec review (2026-08-04); pre-existing, untouched by that spec. Wire it
  (or delete the term) when inter-faction trade / shared markets ship.
- **[M] Switchable faction relation model** — `FactionRelation` stores one symmetric `score` per pair. If
  asymmetric opinion matters (one-sided grudges, vassalage), switch to per-direction scores. Reevaluate when
  diplomacy or war is specced.
- **[S] Flow-overlay particle thresholds vs economy scale** — the map particle constants are tuned for S=1 and
  intentionally not scaled by `ECONOMY_SCALE` (client-side visuals; the knob is server-only). At S≈100 every
  edge pins at max and the overlay loses its volume contrast — legibility only, not perf or correctness.
