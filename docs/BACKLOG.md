# Backlog

Actionable work items. When something ships, delete it — git history is the audit trail. For detailed designs, see linked docs in `docs/active/` and `docs/planned/`.

> **Purged 2026-07-06 for the grand-strategy pivot** ([grand-strategy-vision.md](./planned/grand-strategy-vision.md)): items serving the retired personal-player layer (mini-games, smuggling/bribes, hazard chains, reputation decoupling, trade-mission/ship-re-pricing rework, NPC trader agents) and the retiring Postgres runtime (batch writes, events query optimization) are deleted — git history has them. The pivot itself is tracked by phase in the vision doc §8, not here.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

## Ready

Well-defined, can start now.

- **[S] Needs-tooltip language pass** — the needs-ledger / pop-short tooltips deliberately ship with
  figures plus the single sentence "Higher-pressure needs create more unrest." (a needs-visibility build
  decision: final wording waits for a dedicated nested-tooltip pass). When that pass happens, also
  consider folding the two near-duplicate tooltip bodies (`NeedTooltip` in `population-panel.tsx`,
  `PopShortTooltipBody` in `industry-panel.tsx` — shared header/footer, divergent middles) into a shared
  shell; the duplication was sanctioned at build time.
- **[M] Type `goodId` as a `GoodId` union instead of `string`** — `GOODS` is declared
  `Record<string, GoodDefinition>` (`lib/constants/goods.ts`) and every `goodId` is a bare `string`, so
  `GOODS[goodId]` type-checks as `GoodDefinition` and never narrows to `undefined` — a typo'd or stale id
  is a runtime `undefined` deref with no compile-time signal. Not currently a live bug: world-gen seeds
  every `goodId` from `Object.keys(GOODS)`, so the key always exists. It became worth doing when the
  market World↔Tick round-trip was deleted: the tick used to resolve the catalog in exactly one place
  (`toTickMarkets`), and now reads `GOODS[goodId]` at ~10 point-of-use sites, so the untyped key is
  load-bearing in more places. Violates the "Typed keys" checklist item and "fix the types at the
  source rather than casting at the consumer".
  **Sized as its own PR, not a fold-in**: 89 `goodId: string` declaration sites across 96 files. The
  shape is `export const GOODS = {...} satisfies Record<string, GoodDefinition>` +
  `type GoodId = keyof typeof GOODS`, then propagate through `WorldMarket.goodId`,
  `MarketRowForLogistics`, and every consumer. The real work is the **save-file boundary**: `deserialize`
  takes untrusted JSON, so a save written before the union (or hand-edited) needs a guard in
  `lib/types/guards.ts` narrowing `string` → `GoodId` with a decided failure mode (reject the save vs
  drop the row). Don't start it without settling that.
- **[L] Economy band reconciliation** — design pass DONE (2026-07-20: brainstorm + EU5/Vic3
  research + adversarially-reviewed spec): see
  [economy-band-reconciliation.md](./planned/economy-band-reconciliation.md) for the full design
  (knee'd curves, flow-based decay signal, realized-aware planner, pressure-driven population,
  pricing-virtual floor, regime UI contract) including the recalibration/validation appendix and
  folded-in housekeeping. **Sequenced AFTER the purse slice (PR #193) ships**; landing it triggers
  the unrest/tax + treasury recalibrations recorded in the spec's §8. Next step: implementation
  plan (multi-PR, shared feature branch; curves/signals first).
- **[S] Funding sliders: EU5-style immediate number + shorted-only exception display** — decided
  2026-07-20 at purse Plan 3 merge. Today each band row shows "set X% · runs Y% — shorted", where
  `runs` is last settlement's latched paid fraction. Two problems: the steady state duplicates the
  same number twice, and the display **conflates the one-cycle latch lag with genuine insolvency** —
  raising a slider mid-cycle shows "— shorted" for the rest of the cycle even though nothing was
  shorted (last settlement simply ran the old setting). Change to the Paradox convention: show the
  set value only, updating immediately (next-cycle effect implicit), and surface the amber
  "— shorted" **only when the last settlement genuinely could not pay what was asked**. Detecting
  that properly needs the settlement snapshot to persist the slider values used at settlement
  (compare `funded` against them) — a `WorldTreasurySettlement` field, i.e. a save-format bump, which
  is why this didn't fold into the merge. Touches `FundingSlider` (drop the dual label), the
  treasury processor (snapshot the sliders), and the construction-card readout (same shorted rule).
- **[S] Move the dev cheat-panel button to the header** — other floating elements, including the map
  sidebar, get in the way of it where it currently sits.
- **[S] Improve UI** — Standardize main content panel size, system detail smaller than command center.
- **[S] Two independently-coded build-ceiling checks assume monotonic system ownership** — the
  build-options read service (`lib/services/build-options.ts`) nets committed levels from the player
  **faction's** open rows at a system, while the mutation service's own check
  (`committedAt`, `lib/services/construction-orders.ts`) nets **all** open rows at the system regardless
  of faction. The two agree only because a system's owning faction cannot currently change under it
  (conquest doesn't exist yet) — unify behind one shared helper before any ownership-transfer mechanic
  (conquest, rebellion) ships, or a stale rival's in-flight row could under/over-count a player's ceiling.
- **[S] `estStaffing` and `buildingUsed`'s "none"-kind dispatch read staffing differently for support
  types** — `computeBuildOptions`'s `estStaffing` (feasibility readout) is `min` over the grades a
  building's labour vector actually draws (e.g. a Construction Centre's unskilled + skill1); the tick's
  own `buildingUsed` (`lib/engine/industry.ts`) dispatches an `output: { kind: "none" }` building through
  `count × labourFulfil` only (unskilled/overall fulfilment, not skill1). The two numbers can diverge for
  a support building whose skill1 draw is the binding constraint — a display-consistency note, not a
  correctness bug (both are internally consistent with what they each drive); worth a single shared
  staffing-estimate helper if the divergence ever confuses a player-facing readout.
- **[M] System-finder dev tool** — A queryable dev panel (or `scripts/` CLI) to surface representative systems by characteristic for manual smoke-testing / QA: population band (dead/undeveloped/tiny-outpost/healthy), economy-type, deposit profile, building roster, NaN/anomaly checks — returning name + direct `/system/<id>` link. Recurring need whenever generation/economy changes land (e.g. verifying barren-but-alive systems read correctly). Build it against the in-memory world (`getWorld()`), surfaced in a `scripts/` CLI or the dev-tools panel.

## Needs Design

Direction is clear, approach needs a design doc before implementation.

- **[M] `TARGET_COVER` carries three roles in one constant** — it is authored as a *pricing* reference
  (the cover at which mid == basePrice, and explicitly "the whole-roster knob" for cross-system price
  dispersion), and two other systems borrow it: `classifyMarketState`'s deficit line and the transfer
  shortfall (`targetStock − stock`), plus it is the base of `productionCeiling`'s throttle. Separating
  those is still worth doing — but for the *player-knob* reason below, **not** because the anchor is
  unfundable. It is not; that claim was measured at 125 cycles, inside the economy's ~300-cycle startup
  transient, and is retracted (AGENTS.md, "Verifying changes", has the rule that catches this class).
  **Do NOT lower the anchor.** The 40 → 15 probe is superseded: run to 416 cycles the unmodified galaxy
  reaches price median 1.23×, p10 0.87×, cheap 12% / near-base 22%, mean D 0.030 — *better than* what 15
  bought at 125 cycles (1.50× / 0.92× / 10% / 14% / 0.059) and without its −6% population. `TARGET_COVER`'s
  own docstring already predicted the failure mode: "Lower values pin advanced goods to the price floor
  (cheap everywhere); higher values pin staples to the ceiling."
  **The anchor is never reached, by design, and that is fine.** `productionCeiling` runs at full rate only
  *up to* the anchor and ramps to 0 at `HOLD_COVER × anchor`, so a producer approaches it from below and
  cannot pass it except via imports; and logistics stops requesting once a market clears
  `DEFICIT_FRACTION × anchor`. Measured cover therefore rests near **0.82** (just above the 0.8 deficit
  line) for any serviced good — the effective fill target is 32 cycles, not 40. The two attractors visible
  in the per-good data are worth knowing: **0.82 ≈ `DEFICIT_FRACTION`** means "logistics services this
  good", and **0.25 = `EXPORT_RESERVE_COVER ÷ TARGET_COVER`** means "every producer is drained flat".
  **What is left to design** is role separation in service of a player-facing stockpile target (hold more
  cover for war, or to fund exports). That only works once the borrowers are re-denominated: under today's
  coupling a player raising cover would also un-throttle production, flip their markets to deficit, and
  spike prices — none of which they asked for. Use the shape that already worked for `EXPORT_RESERVE_COVER`
  in #207 (denominate in cycles of demand, not as a fraction of the price anchor).
  Couplings to keep straight when it moves: `RATION_COVER` (2) and `EXPORT_RESERVE_COVER` (10) are both
  absolute cycle counts, so they do not scale with the anchor.
- **[S] An exporter's resting price is pinned at its ceiling, not graded** — a drawn exporter rests at
  `EXPORT_RESERVE_COVER` (10 cycles) = 0.25×`TARGET_COVER`, which sits below the price-saturation point
  `T ÷ priceCeiling` (0.50×T…0.33×T across the roster), so the price curve **clamps** rather than grades.
  Every drawn exporter therefore reads the same maximum price no matter how drawn it is, and price stops
  being a health gauge on exactly the cohort that ships goods.
  **Measured, no longer inferred:** the cohorted report's exporter price column reads **3.00× for
  `electronics` and `luxuries` and 2.50× for `fuel`** at equilibrium — at the ceiling in every case. The design intent
  (`docs/planned/economy-band-reconciliation.md`, "Production knee at the anchor") was a graded
  base…~1.33× band; that band was an artifact of the *retired* 0.75×T reserve and is unreachable while
  the reserve sits below saturation.
  **The obvious remedy is dead and this item does not inherit it**: the fix used to be "lower the anchor
  so production can fund it", which the horizon retraction above kills — do NOT lower the anchor. Nor is
  raising the reserve free: #207 deliberately re-denominated `EXPORT_RESERVE_COVER` in cycles of demand
  rather than as a fraction of the anchor, and raising it withholds real stock from importers.
  **First step is a decision, not a change**: is a flat exporter price acceptable (exporters are supposed
  to run drained, and the importers they serve carry the dispersion), or does price need to grade there?
  If it needs to grade, the lever is the curve's saturation point, not the reserve — which makes this a
  companion to the per-good `MarketCurve.k` item below rather than a cover-constant change.
- **[M] Re-cut the unrest band against a supplied galaxy** — every band constant was calibrated
  against an ambient deficit that no longer exists. `D_SHORTAGE_CUT` (0.25) was cut explicitly against
  "the ambient barren-galaxy deficit ≈0.14 (every tier-1 and tier-2 good empty)", and the unrest slopes,
  strike threshold and necessity weights were all tuned in that galaxy. With distribution fixed, calm
  worlds' median D fell **0.114 → 0.022** and galaxy mean D **0.148 → 0.080**, so the whole band now
  sits far above where worlds actually live: only 21 of 573 systems strike and mean unrest is 0.199, i.e.
  unrest has become a weak signal rather than a graded one. Re-derive the cut and the slopes from the new
  distribution rather than nudging them — `lib/constants/__tests__/band-constants.test.ts` asserts the
  separations that must survive (sustained Rationing never collapses at any tax; a total food or water
  failure always does).
  **This is the one defect on this list that a longer horizon makes WORSE, so cut it against 416 cycles,
  not 125.** At 10,000 ticks mean D falls further to **0.030** and mean unrest to 0.156 — yet the regime
  split is Supplied 34.0% / **Rationing 62.7%** / Shortage 3.3%. Nearly two thirds of the galaxy is
  labelled Rationing while dissatisfaction is essentially nil, so the Supplied/Rationing boundary is
  being crossed by noise. The band is not grading anything, and every other constant on this list is
  horizon-sensitive in the opposite direction.
  **The cohorted read makes this conclusive: homeworlds sitting at mean D 0.000 are still 40% Rationing.**
  `foldSupplyState` returns `rationing` for *any* `d > 0`, so the label fires on a rounding artifact —
  there is no threshold to re-cut, because there is no threshold. The cohorts also show the galaxy mean
  D of 0.030 is an artifact of mix: `pop 10-100` runs D 0.105 with **17.9% striking** against
  `pop >=1K` at D 0.011 and 0.0%. Any re-cut derived from the galaxy-wide distribution would be fitted
  to the big-world cohort that dominates the count.
  **Superseded in scope by [supply-response.md](./planned/supply-response.md)** — a re-cut alone was
  the wrong instrument. The diagnosis moved on inspection: the unrest fixed point is
  `floor + slope × D`, so the regime label gates recovery *speed* only, and the real defect is that
  `D`'s own range collapsed ~5× (the fold squares each good's shortfall, and the slopes were cut
  against the unsquared scale). Re-cutting constants against a measured distribution was also
  explicitly rejected as a fitted-to-one-seed answer. The spec instead makes the score a readable
  supply percentage, demotes the bands to description, and resolves the struck-world cohort. Run
  `/spec-review` on it before planning implementation.
- **[M] `luxuries` consumers are starving — and `electronics` is a different problem** — these two were
  booked as one item because both read 0.25 median cover galaxy-wide. The cohorted read shows the
  headline number was hiding opposite diagnoses, so **split them before designing against either**:
  - **`luxuries` — a real service failure.** Consumer markets sit at **0.02 median cover with 53% empty**.
    Consumers genuinely are not being served; this is the item that keeps the original framing.
  - **`electronics` — consumers are largely served.** Consumer markets sit at **0.77 median cover** (near
    the 0.82 serviced attractor) with 32% empty. The 0.25 galaxy-wide figure is the *producer* cohort:
    239 exporters and 174 self-suppliers, against only 148 consumers, all resting at their drained
    reserve. Producers holding at reserve while their consumers read 0.77 is the system working, not
    failing — what remains worth asking is whether 32% empty consumers is acceptable, which is a much
    narrower question than "never serviced".
    **Caveat:** the consumer cohort itself excludes markets whose local demand floors below
    `MIN_DEMAND` (the harness's `inert` role), which skews it toward larger worlds — "consumers are
    largely served" is a claim about above-floor markets, not about every world that wants electronics.
  0.25 is exactly `EXPORT_RESERVE_COVER ÷ TARGET_COVER`, i.e. a producer drained flat to its warehouse
  reserve. Two suspects worth separating for the `luxuries` half: the build planner not committing
  tier-2/3 capacity (academy-gated skill labour is the likely binding constraint), versus the recipes'
  input chains starving upstream. **Ruled OUT as a cause:**
  phantom `MIN_DEMAND` demand stealing their allocation. That looked total at 29 cycles (100% of
  `ship_frames`/`weapons_systems`/`reactor_cores`/`targeting_arrays` deliveries went to markets with no
  real demand) but is a one-time founding tax — at 416 cycles floored markets are 6.5% of markets, 0.0%
  of requested volume and **0.3% of delivered quantity**. Do not re-open it.
- **[S] `HOLD_COVER` (1.3) caps production below `SURPLUS_MARGIN` (1.4), so a self-supplier can never
  become a donor** — `productionCeiling` returns 0 at `1.3 × targetStock`; the ordinary-donor branch of
  `surplusDrawable` requires `stock ≥ 1.4 × targetStock`. A system can therefore only ever re-donate
  surplus it was **given**, never surplus it **made**; only structural exporters (`production > demand`)
  ship anything. The git history says this was not chosen: `SURPLUS_MARGIN: 1.4` landed 2026-06-27 in the
  SP5 logistics feature (`5e665be7`), and `HOLD_COVER: 1.3` landed three days later in the *separate*
  production-throttle feature (`49d66500`), calibrated against price median with no reference to the
  threshold it was capping. May still be defensible as a rule — but nothing says so, and
  `SURPLUS_MARGIN`'s "deliberate residual" docstring describes a band production cannot cross. First
  step is a measurement, not a change: count transfers that fire via the non-exporter path over a
  10,000-tick run. If it is zero, the margin is decorative and the two constants need one owner.
  The producer-stock instrumentation that measurement needs is already written — `.superpowers/lock-diag.ts`
  (gitignored, so no grep will find it) takes `DIAG_TICKS`/`DIAG_SYSTEMS`/`DIAG_SEED` and reports
  anchor-funding plus per-producer stock; `floor-diag.ts` beside it attributes requested vs delivered
  per good at the moment of each transfer.
- **[M] Struck worlds can neither grow out of it nor die** — 11 of 573 settled systems (499 people)
  sit striking indefinitely, with **zero** of them declining over the last 500 ticks. Growth carries
  `(1 − D)` and decline carries unrest, so at high D the two terms nearly cancel and the world parks
  there. **81.8% of the residual cohort is survival-short**: deposit-less rocks that cannot feed
  themselves (12.5% hold an arable slot against 74% of healthy worlds) — a real physical limit rather
  than a rule problem. Roughly half also have no habitable land left. Neither remoteness nor
  overcrowding is the cause (measured: 3.91 vs 3.72 hops to a homeworld, degree 6.19 vs 6.20; 34.4% vs
  34.6% over popCap — and `CROWDING.PRESSURE_MAX` is 0.05, so overcrowding cannot reach 0.82 unrest
  structurally), and it is no longer a distribution problem either (that shipped; the cohort halved from
  23/1,343 people and its basket-short half went with it). Two shapes worth weighing: let a
  chronically-struck world actually die (break the growth/decline cancellation), or stop founding
  colonies that can never be supplied. Colonies opening deprived has largely resolved itself — 553/553
  down to 373/553, opening satisfaction 0.18 → 0.42 — because the founding manifest now arrives supplied.
- **Per-good price response (`MarketCurve.k`)** — make "water spikes under scarcity, luxuries don't"
  real by giving each good its own price-curve exponent, without touching demand. `DEFAULT_ELASTICITY`
  is currently 1 for every good and `GOODS.priceFloor`/`priceCeiling` is a pure tier lookup with zero
  per-good variation. Booked from `docs/planned/necessity-weighted-unrest.md`.
- **Government layer revisit** — `GOVERNMENT_TYPES` carries only event weights and a danger baseline
  since the flat `consumptionBoosts` term was deleted; decide what, if anything, replaces it as an
  economic axis. Governments are economically inert until then. Booked from
  `docs/planned/necessity-weighted-unrest.md`.
- **[M] Faction-screen colonise verb with map-based target selection** — deferred from the Slice 2
  control-surface design pass (2026-07-18). The faction construction command card gets a colonise
  action that enters a **map target-selection mode** (eligible systems highlighted, click to direct
  the colony) — explicitly not a dropdown. Complements the shipped per-system Establish-colony verb on
  a controlled system's Overview (see [player-seat.md](./active/gameplay/player-seat.md)). Needs a
  short design pass for the map selection-mode interaction before building.

- **[M] Tick perf: `toTickSystems` is the whole mid-cycle tick outside events** — it costs 2.5ms/tick
  at 2,400 systems, **19.0% of a mid-cycle tick** and, since boundary-gating shipped, the only
  remaining cost there other than events (67.5%). **Gating cannot touch it**: ship-arrivals and events
  both genuinely run every tick and both consume `TickSystem` rows, so the join has to happen. The
  lever is to *narrow* it, not skip it — it walks every building row in the galaxy to build the count
  and idle-cycles rosters, then maps every system, and mid-cycle the only consumers are ship-arrivals
  (ids/names) and events (ids, names, control, region). Worth checking what those two actually read
  before assuming the full row is needed; a cheaper mid-cycle projection, or moving the roster join
  behind what needs it, is the likely shape. Fold into the events re-point only if that pass changes
  what events reads from a system — otherwise it stands alone.
- **[M] Tick perf: the events processor scales worst in the tick — and is now two-thirds of it** — it
  costs 1.3ms/tick at 600 systems and ~9-10ms at 2,400: **~7× the cost for 4× the systems**, the worst
  scaling curve of any stage. Two shipped changes have hollowed out everything around it without
  touching it — deleting the market World↔Tick round-trip, then gating the cycle-start stages' setup
  — so its share has gone **19.4% → ~40% → 67.5% of a mid-cycle tick**. It legitimately runs every
  tick (phase progression, plus a spawn every `EVENT_SPAWN_INTERVAL`), so neither lever touched it;
  the cost is the processor itself. Mid-cycle it now essentially *is* the tick: events 67.5%,
  `toTickSystems` 19.0% (its own entry above), relations 7.8%, everything else <4%. At 10,000+ systems
  this is the wall. **Fold it into the events re-point** (pivot Phase 5,
  [grand-strategy-vision.md](./planned/grand-strategy-vision.md) §4 "Re-point") rather than fixing it
  standalone — that pass rewrites the model anyway (physical perturbations + player-facing choice
  events), so pay the perf work once, there.
  Percentages are the portable figure — absolute ms move with machine and load (the same off-boundary
  tick measured 54ms on 2026-07-16 and 94ms on 2026-07-17 pre-fix), so re-baseline in-run rather than
  comparing ms across sessions, and measure a before/after in one process as the gating change did.
- **[M] Give markets a real dirty/ownership model — the last full-galaxy copy per tick** — every tick
  the events adapter copies every market row in the galaxy on construction
  (`initial.markets.map((m) => ({ ...m }))`, `lib/tick/adapters/memory/events.ts`) — ~62,000 rows at
  2,400 systems — and events almost never writes one (the spawn log routinely reports `0 shocks`).
  That copy is **load-bearing, not waste**: `markets` starts as `world.markets` itself, and the events
  adapter is the first stage to touch it, so its copy is what stops a later stage mutating rows the
  previous world still holds (see the `let markets` comment in `lib/world/tick.ts`). It cannot be
  gated away for the same reason the events stage cannot — it runs every tick by design.
  Boundary-gating already removed the *second* copy (economy's, which mid-cycle was a redundant copy
  of rows events had just de-aliased); population's is cycle-start-only. So this is now the one remaining
  per-tick full-market pass, and retiring it needs an actual ownership model — copy-on-write rows, or
  a dirty flag the events stage sets when it shocks a market — not another gate. Real correctness risk
  (aliasing the previous world corrupts a save), so it needs a design pass.
  Note the obvious dirty-check is dead on arrival for the same reason recorded when the round-trip was
  deleted: reference-identity against the adapter output always reports "dirty", because the
  constructor hands back fresh rows whether or not anything changed.
- **[L] Paradox-style nested/pinnable deep tooltips** — Rich-tooltip infrastructure in the spirit of
  Stellaris / EU5 / Victoria: tooltips whose terms are themselves hoverable (nested), pinnable for comparison,
  backed by a cross-linking concept glossary so any mechanic term (labour grade, basket, anchor, fulfilment)
  explains itself anywhere it appears. Needs a real design doc + collaborative HTML-prototype pass. The
  shipped tooltip-affordance convention (grey dotted underline, see `docs/active/design-system/theme.md`)
  deliberately reserves a copper treatment as this system's future second tier for glossary-backed concept
  links. **Post-pivot this is core genre UI, not polish** — slot it once the player seat (pivot Phase 3) exists.

## Future

Blocked on prerequisites or very large scope.

- **[M] Switchable faction relation model** — `FactionRelation` currently stores one shared `score` per faction pair (symmetric). If the War re-spec or later play-testing reveals asymmetric opinions matter (one-sided grudges, vassal arrangements, "I trust you more than you trust me"), switch to per-direction scores. Two shapes available: (a) add `aOpinionOfB` / `bOpinionOfA` columns keeping the canonical-ordering convention; (b) drop ordering, store two rows per pair. Reevaluate when the pivot's diplomacy phase (Phase 5) or war (Phase 6) is specced.
- **[S] Flow-overlay particle thresholds vs economy-scale** — The map flow-overlay particle density (`LOGISTICS_FLOW` / `TRADE_FLOW` in `components/map/pixi/theme.ts`: `volumePerExtraParticle`, `minParticlesPerEdge`, `maxParticlesPerEdge`, `maxTotalParticles`) is tuned for S=1 flow magnitudes and is intentionally **not** scaled by `ECONOMY_SCALE` (client-side visual constants; the knob is server-only by design). At the calibrated S≈100 every edge pins at `maxParticlesPerEdge` and the global budget concentrates on the top flows, so the overlay loses its high- vs low-volume contrast (purely a legibility loss, not perf/correctness). Revisit the thresholds when running at the scaled economy; also a natural fold-in for the pivot's flow-system merge (Phase 4).
- **[S] Age-since-founding cohort axis for the calibration harness — deliberately cut, needs `foundedTick`
  on `TickSystem`** — the cohorted harness metrics work considered founding age as a third cohort axis
  alongside market role and world cohort, and dropped it: only colonies founded *during a run* carry a
  `foundedTick`, so every world-gen-seeded system would land in one undifferentiated bucket, and at the
  equilibrium horizon that bucket is most of the galaxy. `foundingStock` already reports opening
  satisfaction for exactly the in-run cohort, which is the age question that had a customer; population
  band proxies "young colony still filling" well enough since young colonies are small. Revisit only if
  a real founding-age cohort is needed — it requires threading a `foundedTick` onto `TickSystem` (and
  world state, a save-format consideration), not just harness-side code.

### Economy + player depth — layered after PR6

Three new mechanics, all deliberately deferred. The ordering principle: **get the existing economy
logical and stable first**, so PR6's presentation layers onto something settled, and only then add
mechanics. Each was checked for whether deferring it traps us, and none does — but two carry a
condition, recorded with them. The shared condition is that **nothing here is a reason to precision-tune
now**: each of these changes what the unrest slopes are measured against, so constants tuned before them
are invalidated twice over (the standing "coarse health bar only" practice in AGENTS.md already says
this; the risk is forgetting it under pressure to make numbers look good).

- **[L] Adaptive expectation — judge a world against its own history, not a global line** — every
  threshold today is global and fixed, so a two-pop colony and a homeworld are held to one standard and
  that standard never moves as the galaxy develops. The measurements show the consequence: as the galaxy
  matures, mean shortfall runs 0.148 → 0.080 → 0.030 and striking worlds 32 → 21 → 13 — **the unrest
  system winds down monotonically**, because worlds improve against a bar that stays put. That is a
  late-game content problem no recalibration can reach. Designed as step 3 of
  [supply-response.md](./planned/supply-response.md); do not attempt before step 2 (the change term),
  which is the same mechanism in cruder form and is what shows whether a change response behaves.
- **[XL] Pop wealth and buying power** — pops hold wealth and must afford their basket, so demand
  becomes partly monetary rather than purely physical. Provision survives as a ratio (delivered ÷
  demanded) and stays a genuinely distinct layer — a world can hold the wealth and still not have the
  goods, which is the state worth modelling. **Condition: `demandRate` must be untangled first.** It is
  already double-purposed as both the pricing anchor and the logistics deficit anchor (see its docstring
  on `WorldMarket`), and hanging wealth-modulated demand off an already-overloaded quantity repeats the
  exact failure this backlog keeps recording. That untangling is the `TARGET_COVER` role-separation item
  above, which this promotes from nice-to-have to prerequisite.
- **[L] Expanded pop tiers / social strata** — today's pop tiering is labour-grade only (unskilled,
  skilled, academy-gated). Richer strata would carry their own needs baskets. Safest of the three to
  defer: Provision is already a weighted mean over a basket, so richer classes only change the basket's
  composition. It also *improves* adaptive expectation rather than conflicting with it — per-class
  expectations are exactly how Victoria 3 derives its reference — so the two compose if strata land
  first, and nothing breaks if they don't.
