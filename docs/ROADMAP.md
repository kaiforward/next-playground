# Roadmap

The single ordered queue of work. Memory tracks only *where we are* on it — nothing else keeps a
second copy of this list. When something ships, delete its row; git is the audit trail.

An item is: **what it is**, **next step** (one concrete action), and **Don't** (only when a
plausible-looking approach is already known-dead — the line that stops a dead path being re-walked).
Rationale, measurements and war stories belong in the linked design doc or in memory, not here.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

---

## In progress

- **Process overhaul** — how we plan, design and implement. Two named failures: asserting on false
  premises far too early, and output Kai can't parse. Direction: drop superpowers for this project,
  write project-specific skills built around interconnected game systems (events is the recurring
  miss), make evidence the deliverable rather than a design.
  *Next step:* finish the instruction-mass cut (AGENTS.md done, docs + memory in flight), then design
  the replacement skills.

---

## Queued

1. **[L] The attention layer — how the player finds what to do.** The system screens are built and
   detailed, and deciding what to act on is still hard. The player's actual verbs are colonising and
   building, so the layer's job is to surface, for each, either an issue to fix or an opportunity to
   take. Two reads wanted by name, neither of which exists today: **which systems are overcrowded or
   approaching it** (the cue to build housing), and **which systems cannot meet their demand from
   imports plus production**. Low stability already works as a third, and is the proof the approach
   reads well.
   Two surfaces, one problem. A **faction situation log** (player-seat Phase 3 Slice 4, design in
   [player-seat-roadmap.md](./planned/player-seat-roadmap.md); slices 1-3 shipped, active specs
   [player-seat.md](./active/gameplay/player-seat.md) +
   [player-seat-purse.md](./active/gameplay/player-seat-purse.md)) and a **systems view ordered by
   need** — a priority ranking over issues and opportunities, so the player can scan rather than
   hunt. The ranking is the harder half and the one with no design at all. Today's faction
   **Territory** tab is a flat name + economy-type list
   (`app/(game)/@panel/factions/[factionId]/territory/page.tsx`) — the natural site for the ranked
   view, or the thing it replaces.
   **Four principles settled 2026-08-12** from a read of how EU5 and Victoria 3 do it; reasoning and
   sources in memory `design-attention-layer-inputs`, which the design pass starts from:
   persistent state and discrete transition are **different surfaces** (a ranked list and a feed,
   Victoria 3's outliner/situation split); **quiet successes, loud warnings** — automation-on
   silences what the planner handles but never what it tried and could not do; alert on **unresolved
   need**, not raw state; and prefer **intent visibility** (the planner declaring what it wants to
   build next and where, on demand) over a notification.
   **A third read with no surface at all: nothing on the map says where a colony is forming.** The
   genre gets this nearly free because its map starts painted; ours appears out of black. Kai's
   leaning — colonisation automation defaults **off**, AI founding slowed enough that a player can
   keep up. This row owns the surface; the pacing lever is item 2 below.
   **Carries `RATION_EXIT_EPS`**, deferred here when the presentation layer shipped: the hysteresis has
   no surviving justification until a log exists. Its other two rationales are dead — the per-good
   regime chips it was authored for were dropped, and visual flapping does not occur (bands are
   written once per 24-tick economy cycle, so the fastest a chip or map cell can change is every 4.8s
   at speed 5, with SSE throttled to 4 emits/sec regardless). A log entry per transition is
   different: it accumulates in a list the player scrolls, so a system wobbling across an edge
   produces junk entries at any speed. Calibrate the value against the log's own spam, not the chips.
   **Open question to settle then:** whether the hysteresis applies to the persisted display band
   only (presentational) or to the classifier itself (mechanical — the regime feeds the unrest term).
   Unverified at deferral time; do not assume the first.
   *Next step:* design pass on the ranking and the notification model before any spec — the
   irritation problem is a design problem, and the two named reads are the first concrete test of
   whatever ranking comes out.
   *Don't:* ship a feed that fires per event without a ranking behind it, and don't alert on a
   persistent state. The precise genre complaint is that dismissing an alert for a still-true state
   makes it reappear instantly and crowd out the useful ones — that is why this row is not just
   "add alerts".

2. **[L] Fewer viable systems at the start; growth gated behind habitation technology.** Early
   colonisation is overwhelming — too many viable targets at once, with nothing pacing which to take.
   Direction (Kai, 2026-08-12): cut how many systems are viable at generation so expansion starts
   slow, and let the rest of the galaxy open up later, when terraforming and specialist-housing
   technologies exist. Kai's read is that this slows the simulation rather than breaking it.
   The knob already exists: `habitableFraction` is housing-per-space efficiency
   (`habitableSpace = generalSpace × habitableFraction`), and the expensive, low-yield
   specialist-habitation *building* was recorded as a hook at that same decision — see memory
   `project-barren-galaxy-artificial-habitation`.
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
  policy weighing availability against the number of demanding systems (candidate policies in
  memory `design-logistics-depth-inputs`; possibly player-configurable). Complements the band /
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
- **[XL] Pop wealth and buying power** — pops hold wealth and must afford their basket, so demand becomes
  partly monetary. Provision survives as a ratio and stays distinct (a world can hold the wealth and still
  lack the goods). The former blocker — `demandRate` double-purposed as pricing anchor and logistics
  deficit anchor — cleared with #211/#212 and the `TARGET_COVER` role split: pricing keeps the floored
  `demandRate` denominator, logistics and founding read real demand. Unlocks the strata-as-private-builder
  mechanic on the social-strata row above — wealth pops hold is what a private builder spends.
- **[L] Expanded pop tiers / social strata** — today's tiering is labour-grade only. Richer strata carry
  their own baskets. Composes with adaptive expectation (per-class expectation is how Victoria 3 derives
  its reference); nothing breaks if it never lands.
  **Also carries the strata-as-private-builder mechanic** (scoped 2026-08-12; inputs in memory
  `design-strata-private-builder`): in both reference games the strata are a *second builder* that is
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

**Platform**
- **[XL] Retire Next.js and TanStack Query — this is a single-page game, not a web app.** Packaging
  path B from [grand-strategy-vision.md](./planned/grand-strategy-vision.md) §6: the engine in a Web
  Worker, fully client-side, shippable as static web plus Tauri/Electron from one codebase. The
  Next.js server, the App Router, the `app/api/game/` handlers and the query layer all retire
  together.
  That section says "A migrates into B; don't decide today" — written when the pivot was young.
  Everything else in it has since shipped (Postgres and Prisma gone, world in memory, saves as JSON
  on disk), so the packaging path is the last undecided piece of a finished pivot, and the
  non-decision is the stale part.
  Kai's reasoning (2026-08-12): real performance gains and no delay opening panels, since the client
  currently round-trips to a local server for state that could sit in-process. His read is that the
  coupling below is all solvable and the end state is simpler than what it replaces.
  **What it actually touches**, so nobody sizes this as a framework swap: the entire client data
  layer. TanStack Query is load-bearing today — `useTickInvalidation`, the map atlas held at
  `staleTime: Infinity`, and the SSE-driven hooks that seed initial state from REST. The route
  handlers are thin, but every hook in `lib/hooks/` reads through them.
  *Next step:* a design pass that settles what replaces the query layer *first*. With the world
  in-process there may be no cache to invalidate at all — that is the simplification being claimed,
  and proving or killing it decides the size of everything else.
  *Don't:* port TanStack across as-is. Caching in front of an in-process world is the indirection
  this work exists to remove, and keeping it would leave both layers in place for none of the gain.

**Tick performance**
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

**Types / correctness**
- **[M] Type `goodId` as a `GoodId` union instead of `string`** — `GOODS` is `Record<string, GoodDefinition>`,
  so `GOODS[goodId]` type-checks and never narrows to `undefined`. Not a live bug (world-gen seeds every id
  from `Object.keys`), but load-bearing at ~10 point-of-use sites since the market round-trip was deleted.
  89 declaration sites across 96 files — its own PR. *Blocked on a decision:* the save-file `deserialize`
  boundary needs a guard narrowing `string` → `GoodId` with a decided failure mode (reject the save, or drop
  the row). Don't start without settling that.
- **[S] Two build-ceiling checks assume monotonic system ownership** — the read service nets committed levels
  from the player *faction's* rows; the mutation service nets *all* rows at the system. They agree only
  because a system's owner can't change yet. Unify behind one helper before conquest or rebellion ships.
- **[S] `estStaffing` and `buildingUsed` read staffing differently for support types** — `min` over the
  grades a building actually draws, vs `count × labourFulfil` (unskilled only). Display-consistency, not
  correctness; worth one shared staffing-estimate helper.

**UI**
- **[M] Dedicated goods tab** — a per-system goods surface with more depth than the Population or
  Industry tabs carry: per-good cycles of cover against the anchor, the regime (Supplied / Low
  reserve / Rationing / Shortage / Glut), civilian versus industrial draw, local production against
  local use, and what logistics is moving in or out. Replaces what the Market tab was for; the
  market table is a trading-game leftover that the presentation layer deliberately left alone rather than half-fixing
  it. Needs an interaction design pass — this is the third goods-bearing surface, so it must earn
  its place against the needs ledger and the industry roster rather than duplicating them.
  *Don't:* rebuild it as a price table — cycles of cover is the unit, price is a secondary read.
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
- **[S] Game-term glossary** — one doc defining the game's terms of art in plain language (pop = 1
  million people; tick/cycle; Provision; bands; cover; unrest/strike; control ladder…), written as
  the single source tooltips and tutorials quote from. The nested-tooltips row's "cross-linking
  concept glossary" is this doc grown hyperlinks — start it flat, don't wait for that system.
  Sibling of the tick-tempo anchor row below (that one anchors time; this anchors vocabulary).
- **[S] Define a tick-tempo anchor** — a short doc section stating what a tick feels like in play:
  wall-clock at each speed setting (fast mode is 5 ticks/s today), rough equivalents against
  genre reference points (Victoria 3 ≈ 146K ticks per 100 years at 4 ticks/day), and the cycle
  (24 ticks) as the unit pacing arguments should be made in. Exists so calibration decisions stop
  arguing "N ticks feels long/short" from unanchored intuition — the relaxation-rate call at the
  supply-response Gate 1 turned on exactly this. Not a design of game-time itself (ticks still
  have no defined in-fiction span); just the shared measuring language.
  *Next step:* one section in `docs/SPEC.md` or `docs/active/gameplay/`, plus a one-line pointer
  wherever pacing constants are authored.
- **[S] Move the dev cheat-panel button to the header** — the map sidebar and other floating elements block it.
- **[S] Standardise main content panel size** — system detail should be smaller than command center.
- **[S] Unrest history / recovery forecast** — a per-system chart of unrest over time and a forecast
  of recovery trajectory, beyond the Population tab's current expectation/grievance snapshot.
  Backlog polish, not started.

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
  interim famine gate on delivery is explicitly temporary scaffolding for this). Kai's design leanings for it (hub/chain propagation, flow priority as a lever, one
  coarse in-fiction valve at most) are preserved in memory `design-logistics-depth-inputs`.
  **Absorbs the former flow-visualisation row**, retired 2026-08-12: a logistics overlay already
  ships on the map, and designing a second flow view before this pass changes what flows is
  backwards. Its approved HTML prototype survives as an input —
  [ui-ws2-map-modes.md](./planned/ui-ws2-map-modes.md), memory `project-ws2-map-modes`.
- **[S] §3.5 player-directed colony founding** — the mechanism (`employedGradientThreshold` speed-dial)
  ships **inert but tested**. Wire it when the player-agency phase reaches it.

**Tooling**
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
  (+20-60% runtime on every run) or keep 10k and rely on the documented trap (memory
  `measurement-traps`, "The horizon"). Kai's call; surfaced 2026-08-03.
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
