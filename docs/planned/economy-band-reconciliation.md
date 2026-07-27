# Economy Band Reconciliation — Knee'd Curves, Regime Legibility, and the Pressure-Driven Population

> Design pass settled 2026-07-20 (supersedes the `[L]` BACKLOG brief). Not yet built. Landing this
> triggers an unrest/tax recalibration and a treasury recalibration (see §8). The wireframe work in
> §7 gets its own collaborative HTML pass at build time.

## Headline

The economy's throttle curves gain **knees**: consumption delivers in full until stock reaches an
explicit emergency ration threshold, production runs at full rate up to the days-of-supply anchor, and the decay signal reads
healthy capacity as fully used. The resting state of a healthy system becomes **pops fully fed,
factories running, price ≈ base** — instead of today's structural ~80%-of-anchor equilibrium where
every system is permanently rationed ~17%, every producer reads ~90% "worked", and prices lean 24%
high at perfect health. Population growth stops being fuelled by empty housing (which decay then
eats — the treadmill) and becomes satisfaction-driven with **overcrowding as a soft brake** that
feeds unrest pressure and migration push — full worlds push settlers outward, making land
exhaustion the engine of colonisation. The market floor becomes a pure **price saturation point**
(draws may continue toward empty); the build planner sizes capacity to demand **plus a margin** and
gains a feedback backstop plus rate-limiting so the burst-build/decay see-saw disappears. The three
resulting regimes — **Supplied / Low reserve / Rationing / Shortage** (+ **Glut** on the producer side) — share
one set of threshold constants between mechanics and UI, so the panels name states instead of
showing contradictory percentages.

## Why (diagnosis, verified on code + a live save)

One structural fact wore many costumes. Production throttled by `√` over `[minStock, 1.3×T]` and
consumption by `√` over `[minStock, T]` cross at ~80–84% of the anchor `T`, so at perfect health:

- pops rationed ~17% (satisfaction ≈ 0.83) → permanent "pops short" badges and a structural unrest
  floor → a standing population-decline term;
- the selling/decay signal (`outputUptake`, measured on the full storage band) read ~0.85–0.9 →
  every producer stack ≥ ~7 levels and every margin-ahead housing stack held a permanent whole idle
  level → decay shed a level every buffer period → the autonomic rebuilt it (the treadmill; manual
  players with automation off just lost the ratchet);
- full satisfaction (stock ≥ T) required ~1.6× capacity overprovision, at which point uptake ≤
  ~0.82 put every stack ≥ 6 into decay — **full satisfaction and decay-safe industry were
  mathematically incompatible**;
- the planner's structural-deficit test compared full-staffed *capacity* to demand, while realized
  output was throttled ~21% below capacity — "capacity covers demand" blocked building forever
  while pops rationed; when a good's galaxy-wide spare vanished, `coveredFraction` flipped every
  deficit structural in one pulse (observed 60-level burst builds), which glutted, idled, decayed,
  and repeated.

The gentle everywhere-active `√` ramps were a deliberate trading-game design: the permanent
sub-anchor equilibrium *was the arbitrage spread* the player-trader lived on. That player no longer
exists; the spread is pure loss. Paradox economies (Vic3/EU5/Stellaris, researched 2026-07-20) use
the opposite grammar — flat healthy region, discrete named problem regimes with thresholds,
escalating maluses, and hysteresis — and that grammar is what this design adopts.

## 1. Curve geometry — the three knees

The access/reserve separation is specified fully in
[economy-rationing-amendment.md](./economy-rationing-amendment.md).

Vocabulary (unchanged): anchor `T = TARGET_COVER × demandRate × anchorMult` (price = base), hold
ceiling `1.3×T` (HOLD_COVER), storage max ≈ `2×T + storage`, price-saturation point `0.5×T`
(ex-`minStock`).

- **Emergency ration threshold**: full delivery while
  `stock ≥ RATION_COVER × demandRate` (initial 2 demand cycles), independent of the 40-cycle
  pricing anchor and `anchorMult`. Below it, satisfaction ramps convexly
  (√-shaped: gentle just under the threshold, brutal near empty)
  to 0 at **stock = 0** — not at the floor (§4). Healthy systems have satisfaction exactly 1 and
  contribute zero structural dissatisfaction.
- **Satisfaction is a flow, measured once — and persisted so its readers exist**: satisfaction :=
  the consumption factor actually applied this pulse (delivered ÷ demanded), not a re-derived
  stock position. The economy pulse persists it per (system, good) to `World`
  (JSON-serializable; missing ⇒ 1); dissatisfaction, the needs UI, the regime chips, and the §2
  squeeze counters all read that stored value — never a stock recompute (the read services and
  planners have no other path to the flow; see §2's plumbing note). This kills the
  boundary bias of post-tick stock reads (a month that starts above the ration threshold delivers
  in full but may end below it) and retires the two secondary computation sites that would otherwise contradict the sim:
  the pop-needs display projection (`lib/engine/pop-needs.ts`) and the build planner's linear
  `stock/target` fed-proxy (`supplyDissatisfaction`), both re-based on the same measure — the
  planner proxy otherwise punishes reserve drawdown as unmet current need.
- **Production knee at the anchor**: full rate while `stock ≤ T`; ramps **linearly** to 0 across
  `[T, 1.3×T]`. The anchor is the producer's normal hold; `[T, 1.3×T]` becomes a deceleration zone
  absorbing shocks. A self-supplier with margin capacity rests just above `T` → **healthy price ≈
  base** (decision: knee *at* the anchor, so price is a true health gauge with full two-sided
  dispersion range; the rejected alternative — knee above the anchor — made "healthy" read ~0.8×
  everywhere and compressed the glut-signalling range). Two owned nuances: an exporter's resting
  price sits between base and ~1.33× scaling with how hard logistics draws it (§2's
  strategic-export-reserve draw) — hot demand makes exporters dearer, which is signal, not noise; and
  `[rationStock, T]` is a curve-side dead zone (both flanks flat), so a dented self-supplier recovers
  on the provisioning margin's timescale (~0.25%-of-T/month at margin 0.1) with price elevated
  meanwhile — accepted: price doubles as a shock-age gauge; the margin is sized against recovery
  time in calibration and the harness watches shock-recovery tails (§8).
- **Selling/decay signal is the ISOLATED ceiling term — not realized output, and not the old
  storage-band position**: producers' `used = count × min(effectiveFulfilment, sellingFactor +
  USED_SLACK)`, where `sellingFactor` is the produce-direction ceiling throttle alone (the §1
  knee curve at the pulse's stock — the "warehouse full, output unwanted" brake the sim already
  computes as its own term). Staffing stays its own separate min, counted once, exactly as the
  shipped `buildingUsed` composes it. **The signal must never read realized / suppressed /
  input-gated output** — realized output folds in labour fulfilment, the input gate, strike
  suppression, the maintenance output malus, and event production multipliers, and each would
  leak non-glut suppression into demolition: an insolvent faction's fully-staffed producers would
  shed levels (violating the purse's load-bearing flow-only guarantee — the malus scales output,
  never the idle signal), a multi-month strike or event episode would convert into permanent
  capacity loss, and an input-starved factory would read as glut while its stock visibly drains
  (turning the supply-chain cascade from throttle into teardown). Asserted in tests (§7). Why not
  the old storage-band read: it is structurally broken for exporters — the band is scaled by
  *local* demand (`demandRate` floors at `MIN_DEMAND`) while an exporter's capacity serves
  *remote* demand, so a pure-extractor colony's single level can out-produce its deceleration
  zone in one pulse. The isolated ceiling term is immune where it matters: §2 draws structural
  exporters to comfort each logistics pulse, so their start-of-pulse stock sits at or below the
  anchor where the throttle is flat (reads fully selling); genuinely glutted or demand-dead
  producers pile into `[T, 1.3×T]`, throttle toward 0, and prune to fit. **Funding-bound
  exclusion (mirrors §2's build-side exclusion)**: a producer whose good has reachable structural
  deficits but whose shipment was funding-limited (the matcher ran out of funded haul budget)
  reads as used, not glut — wanted-but-unshipped is a treasury/logistics-funding problem, and
  pruning demand-backed export capacity during a funding dip would ratchet capacity down one-way
  (decay prunes the exporter while the backstop refuses to build at the importer). A single
  deliberately-overshot level on a small colony stays decay-safe via the existing whole-level
  floor.
- **Regimes distinguish access from reserve health, with hysteresis**: Supplied
  (satisfaction = 1), Low reserve (supplied but below strategic cover), Rationing
  (satisfaction < 1), Shortage (satisfaction < 0.5 — the existing critical severity
  threshold, reused), plus Glut as the producer-side exception, defined on the **isolated selling term alone**
  (`sellingFactor + slack < 1`), with **precedence**: understaffed and input-short classify first
  (their own §6 states) — only a fully-staffed, input-satisfied producer can read Glut, and the
  selling factor contains no labour or input term to conflate them. Regime transitions carry an enter/exit band (`RATION_EXIT_EPS`, calibrated with the presentation pass, around the
  relevant boundary) so systems parked at a boundary don't flap chips or spam the future alert
  feed. §6 makes the UI speak them.

Knock-on recorded: with structural dissatisfaction = 0 at health, **the only standing unrest floor
is tax** (purse Plan 2's `taxPressure`), so population equilibria rise galaxy-wide → §8
recalibration.

## 2. The build planner — measuring need, pacing the response

- **The classification substrate becomes realized-aware** (this is the load-bearing fix; the
  backstop alone cannot reach it). `toGoodMarketStates` today feeds full-staffed *capacity* into
  the shared deficit/surplus classification, blind to input gates, strikes, and the maintenance
  malus — so the logistics matcher's self-supply gate (`production < demand`,
  `directed-logistics.ts`) refuses forever to ship to an input-starved factory system whose
  *capacity* covers demand while its *realized* output is ~0, and `surplusDrawable` happily drains
  a striking exporter's buffer in the very month its output collapsed. Fix: the classification
  `production` figure applies the suppression multipliers and input gates (the tick already emits
  `realizedProductionBySystem`); a suppressed exporter is not drawable below its anchor; an
  input-starved system *is* a deficit sink. Without this, §4's deeper draws make the existing
  deadlock strictly worse.
- **Provisioning margin**: capacity targets `(1 + PROVISION_MARGIN) × demand` (initial 0.10–0.15).
  Exact-capacity builds park a system on the comfort boundary with no recovery rate; the margin is
  the shock absorber.
- **Feedback backstop**: a system **rationing for ≥ 2 consecutive pulses** counts its rationed gap
  as structural deficit — with two exclusions so it never builds capacity at problems capacity
  can't fix: squeezes explained by **reachable-but-unshipped spare** (the matcher ran out of
  funded haul budget — a treasury/logistics-funding problem; building local capacity there would
  switch the importer off its exporter, glut the exporter, and relocate the see-saw to the funding
  boundary), and squeezes explained by **suppression** (strike / maintenance malus — an
  unrest/treasury problem; a multi-month strike outlasts any persistence filter and would
  otherwise mint permanent capacity that gluts when the strike ends). What remains — genuine
  capacity shortfalls, yield drift, event damage — builds.
- **The suppression exclusion is scoped to the shortfall suppression actually explains, per
  (system, good).** Capacity a strike does not possess cannot be the thing a strike is suppressing:
  the exclusion applies only to the gap between what a system's built capacity *could* produce and
  what it *is* producing, and never to the gap between demand and full capacity. A system whose
  full-output capacity is below demand — including the ordinary case of **zero capacity in that
  good** — is a genuine structural shortfall and remains buildable however restive it is. Stated as
  one rule: compare demand against full-staffed capacity; build the difference when demand exceeds
  it, and decline only when capacity covers demand while realized output does not. The
  system-wide read is the failure mode this replaces — a single striking industry otherwise zeroes
  every good's need at that system, so a colony with no extractor can never be proposed the
  extractor whose absence is causing the shortage that is causing the strike. That loop has no
  exit and it closes over any system in the strike regime.
- **Exporter spare is realized, not latent**: the spare a suppressed system offers the matcher and
  the deficit netting is its actual output above demand, never its un-struck capacity. Planning
  against output that is not being produced overstates galaxy-wide spare and suppresses building
  at the importers that need it.
- **Response pacing** (kills the burst-build): a residual must persist 2 consecutive pulses before
  it is proposable, and each pulse proposes at most `BUILD_RATE_CAP` (~⅓–½, calibrated) of a good's
  outstanding gap — the correction ramps over 2–3 months. Distance-weighting the spare pool is a
  noted possible refinement, deliberately not in this pass.
- **New stored state + plumbing (the new signals need carriers — none exists today)**: the
  squeeze-persistence and proposal-persistence counters AND §1's per-pulse satisfaction are
  per-(system, good) `World` state — JSON-serializable, save-compatible (missing ⇒ 0 for
  counters, 1 for satisfaction), mirroring §5's idle-counter story. The realized-aware
  classification additionally needs realized/suppressed production threaded to the planners:
  today `runWorldTick` hands directed-logistics and directed-build a bare `{ tick }` ctx (no
  `economySignals`), and their row types carry no unrest or maintenance malus to re-derive
  suppression locally — extend the planner rows (or ctx.results) explicitly. Off-month-pulse
  fallback: when the logistics/construction pulse lands where `economySignals` is undefined, the
  planners read the last persisted month-pulse values.
- **The government consumption boost folds into `demandRate`**: today it is added to the drain
  *after* the band is built, so on low-civilian-demand goods (weapons/fuel at militarist systems)
  the anchor understates true demand up to ~2×, the §6 cover chip would lie, and the boost can
  exceed the provisioning margin entirely — parking those goods permanently in the backstop path.
  Folding it in makes the band, the margin, and the cover chip all see the real drain. **Fold at
  the shared civilian-demand chokepoint** (`consumptionRate` / `capacityGoodRates`, threading the
  system's government type) — not the stored `demandRate` column alone: the planner/logistics
  demand is recomputed fresh in `toGoodMarketStates` from that chokepoint and would otherwise
  stay gov-blind, leaving the self-supply gate and deficit sizing under-provisioned on exactly
  these goods. Test: a militarist system's planner-side weapons/fuel demand equals civilian +
  industrial + boost.
- **Logistics under the new geometry**: the matcher already replenishes receivers far above the
  two-cycle ration threshold. Structural exporters may still be drawn below the anchor, but their
  floor is a separately named strategic export-reserve policy (initially the prior 0.75 × T), never
  `RATION_COVER`; otherwise routine exports would deliberately park them at the edge of rationing.
  Non-producing stock-holders keep the anchor floor.
- **Assessment timing remains explicit**: logistics stays after economy/population in the tick.
  Imports change stock immediately but do not rewrite the already-measured satisfaction or unrest
  for that pulse; they are assessed at the next economy pulse. Add an end-to-end ordering test.
  This is causal history, not stale data, and §6 labels the latest assessment accordingly.

## 3. Population growth and housing — fuel tank → pressure valve

- **Regime-sensitive unrest response**: goods dissatisfaction and tax pressure become explicit
  sibling terms rather than one opaque sum. Supplied systems recover faster toward the equilibrium
  supported by their current tax pressure; Rationing accumulates unrest gradually; Shortage
  accumulates it faster. The calibrated functions must be monotonic (worse delivery never creates
  less pressure), preserve each tax level's intended equilibrium, and keep one isolated bad pulse
  recoverable rather than strike-triggering. Do not implement this by multiplying the whole
  existing integrator: that would silently change what taxation means. Add an end-to-end recovery
  test proving that current Needs becomes Supplied immediately while stored unrest then declines
  at the designed rate.

- **The rate-selecting regime is demand-weighted, not worst-good.** The regime that picks the
  accumulation rate is folded from how much of a system's *demand* is badly supplied, not from
  whether any single demanded good is short. A worst-good fold makes the fast rate ambient rather
  than exceptional: the barren-galaxy design guarantees a chronic higher-tier deficit at nearly
  every system (`POPULATION_PARAMS` names it as an unavoidable D ≈ 0.4), so a mining colony with
  full food and water and empty luxuries is graded identically to a system in famine. Demand
  weighting already exists on the *magnitude* term D and is the right instrument here. It also
  composes with the skilled baskets for free — luxuries appear only in the engineer basket, so an
  engineer-heavy system genuinely does put luxuries at a demand share that can trip the fast rate,
  while a mining colony does not; that per-population variation is required behaviour. Requiring a
  per-good "vital" list is explicitly rejected: it is a magic list, and it cannot express the same
  good mattering differently to different populations.

  **Which demand-weighted fold is UNRESOLVED — a summed-share fold cannot express this goal.** The
  design intent is two-sided: ambient higher-tier scarcity must stop selecting the fast rate, *and*
  a real food/water failure must still select it. Measured against the shipped basket (26 goods
  carry positive civilian demand; world-gen creates a market for every system × every good, so the
  fold sees the whole basket, not a civilian subset):

  | Case | Unskilled world | Mature hub (15% tech / 4% eng) | Engineer-heavy |
  | --- | --- | --- | --- |
  | Water empty alone | 16.6% | 14.1% | 9.9% |
  | Food empty alone | 14.3% | 12.1% | 8.5% |
  | Tier-2 civilian trio empty | 10.7% | 20.7% | 34.7% |
  | All tier-1+2 empty (the barren-chronic case) | 38.7% | 46.5% | 62.0% |

  Summing the short goods' demand share therefore requires a cut `≤ 0.166` to grade a total water
  failure as Shortage and a cut `> 0.387` to keep the barren-chronic deficit at Rationing. No value
  satisfies both, so this is a structural limit of the summed fold rather than a calibration miss:
  summing knows only *how much* demand is short, and the ambient deficit is short on more demand
  than an acute one — eighteen small goods against one large one. (An earlier draft of this section
  cited food and water as ~76% of the basket and luxuries as ~3%; those came from a six-good subset
  that does not exist in the code.)

  **The intended answer is now demand elasticity — see `docs/planned/demand-elasticity.md`**, which
  carries the measured basket, every rejected fold with its disqualifying evidence, and the primitive
  itself. In short: necessity is not the *height* of a demand curve (consumption volume) but its
  *slope* (how much wanting survives when the good cannot be had), and this model has only the
  height. Volume is a bad necessity proxy in its own data — medicine's per-capita need sits below
  gas's purely because medicine is tier-1. With elasticity the fold stops needing a definition of
  deprivation at all: elastic goods' demand shrinks to meet supply, so they cannot carry a standing
  deficit, so ambient higher-tier scarcity stops driving unrest at the source rather than being
  filtered out by a threshold.

  Any share-based fold — summed, largest-good, or a threshold on D — is a stopgap. If elasticity is
  judged too large a change, the fallback is the **largest single term of D** (`max_g [share_g ×
  (1 − sat_g)²]`, cut ≈ 0.10): continuous, no satisfaction cliff, and it separates every measured
  scenario correctly, but it still reads necessity as consumption volume. Both the summed fold locked
  above and the `SHORTAGE_SATISFACTION` cliff it depends on are disqualified on the evidence.

- **Each regime bounds where unrest settles.** The accumulation gains are re-parameterised as
  `gain = ceiling × decay`, so each regime carries a named ceiling and the equilibrium under
  sustained dissatisfaction is `floor + ceiling × D`. The integrator's shape is untouched (the
  prohibition above still holds — this changes what the gains *mean*, not how they are applied),
  the tax floor remains the exact equilibrium at D = 0, and the Shortage ceiling stays strictly
  above the Rationing one. Without a ceiling the gains are free parameters whose ratio to the
  relaxation rate silently sets the equilibrium: at the shipped values the Shortage equilibrium is
  `floor + 2D`, so D ≈ 0.35 — below the chronic deficit the barren galaxy takes for granted —
  settles a system above the 0.75 infrastructure-collapse threshold, and Rationing at `floor + D`
  is only twice as forgiving. Chronic scarcity in goods that barely matter must not be able to
  reach a regime reserved for catastrophe; the ceilings are what make that a guarantee rather than
  a calibration accident. Rationing's ceiling sits below the strike threshold by construction —
  asserted in a test.

  The ceilings and the fold above ship together, because the containment guarantee is a claim about
  the *pair*. "Nothing but famine reaches the collapse regime" holds only while ambient scarcity
  selects Rationing; under the shipped worst-good fold the ambient case still selects Shortage, so
  ceilings alone would carry a guarantee that is false in exactly the systems it exists to protect.

- **Growth**: `rate × pop × (1 − D) × crowd(r)` where `r = pop ÷ popCap`. `crowd(r)` = 1 while
  `r ≤ 1.0`, braking smoothly to 0 at `r = CROWD_BRAKE_END` (initial 1.15). Population may exceed
  popCap freely; the logistic headroom term is gone. Decline channels unchanged (unrest-scaled
  decline; overshoot-death for the housing-rotted collapse).
- **Overcrowding pressure** (`1.0 < r`): a **bounded** unrest contribution (clamped like tax
  pressure — a full world can never strike-spiral off crowding alone) plus migration push via the
  existing overshoot-repel coupling (verified shipped: attractiveness goes negative on overshoot
  and destination headroom blocks inflow at full systems). Full systems slow, grumble, and export
  people — **land exhaustion drives colonisation**. Migration *destinations* stay capped at popCap
  (people move to where housing exists — coherent), and **colony establishment sizes housing to the
  seed's own need — no bundled spare level** (§5 carries the reasoning); a new colony opens at the
  occupancy its seed warrants and earns its second level from the relief valve like any other
  system. The harness gains a migration-throughput metric (§8, read on land-tight seeds
  specifically); the relief target (0.92) is the calibration lever if galaxy-wide migration turns
  construction-latency-bound, and the idle buffer is the fallback lever if the tighter opening
  absorption proves too slow.
- **The overshoot-death channel is rescoped to the collapse regime**: it fires only while
  `unrest > the strike threshold`. Today "pop > popCap" is *synonymous* with housing rot (growth
  and migration both hard-cap at popCap), so the death term's trigger doubled as rot detection;
  this design makes `r ∈ (1, 1.15]` the *normal* state of a full world while tax + crowding give
  it standing unrest — unscoped, the term becomes a permanent tax-scaled death leak on every
  healthy crowded world (~0.3–1.3%/year), silently killing the settlers §3 means to export. Gated
  above the strike threshold it stays what its docstring promises: the violent-collapse mortality
  term.
- **Housing decay vacancy allowance**: `used = min(count, occupancy × (1 + VACANCY_SLACK))`
  (initial 0.10). Normal vacancy reads fully used at any stack size — the treadmill becomes
  structurally impossible — while genuine emptying (pop collapse, mass emigration) still decays.
- **Autonomic housing flips to pressure relief**: build when `r` rises past ~0.95, sized to return
  `r` to ~0.92 — strictly inside the vacancy allowance (8% vacancy < 10% slack), so autonomic
  housing never feeds decay at any stack size. The **fed** gate stays; the **calm** gate does not
  apply to relief housing. Gating the pressure valve on the pressure being low is circular, and
  the deadlock is concrete with shipped constants: very-high tax unrest pressure (0.18) + the
  crowding clamp (0.05) exceeds `UNREST_SETTLE` (0.2), so a high-tax crowded world would
  permanently fail the calm gate while the blocked relief keeps the crowding pressure flowing.
  Relief housing answers crowding regardless of unrest; the fed gate still stops housing growth at
  starving systems. `SETTLE_MARGIN`'s pre-provisioning identity is retired.
- **popCap identity**: no longer a growth asymptote — it is the comfort line where crowding
  pressure begins. Still derived from housing exactly as today. Housing remains purely structural
  (no rent, no housing-quality goods this pass). Guard: `crowd(r)` at `popCap ≤ 0` treats the
  system as fully crowded (growth 0) — never Infinity/NaN into world state (housing can reach 0
  via unrest teardown; the JSON-serializable invariant is absolute). The housing round-up rationale
  in `plannedHousingUnits` ("population exceeding its own cap is impossible") rests on the premise
  this section deletes — rewritten with the pass, not blindly preserved.

## 4. The floor — pricing construct, not a goods wall

- `minStock` keeps one job: where the price curve saturates at the ceiling. **Every**
  `minStock`-floor site moves off it — the enumeration is exhaustive, not two clamps: the tick's
  stock clamp and the event-shock adapter's (`applyShocks` clamps at `minStock` today, which
  would leave supply-destruction events unable to push a market below 0.5×T: the one mechanic
  that should create the spec's real crises would be floored above the zone where crises exist)
  both become `[0, maxStock]`; the input gate's drawable (`max(0, stock − minStock)`, in the sim
  and the read-path recomputes) becomes `max(0, stock)`; and the recipe draw floor
  (`max(minStock, stock − draw)`) becomes `max(0, stock − draw)`. The directed-logistics
  transfer's source floor is governed by `surplusDrawable`'s comfort/anchor floor, not
  `minStock` — its lingering `minStock` reference is cleaned up with the pass. Consumption and
  recipe draws run toward empty. The UI never draws the saturation point as an untouchable
  reserve; vocabulary: **price saturation point**.
- **Seed stocks stop inheriting the retired floor**: world-gen retains a separate
  `INITIAL_RESERVE_ANCHOR_FRAC = 0.75` floor. This is initial strategic reserve policy, not the
  emergency ration threshold; new markets must not seed at only two cycles.
- **Colonies founded in play get the same courtesy, paid for by their founder.** World-gen seeds its
  starting markets with a reserve; `colony_establish` seeds nothing, so a landed colony opens at
  stock 0 on every good — maximum shortage on its first assessment, months before its first
  extractor can finish or a route can reach it. It accumulates unrest the whole time and, under the
  shipped constants, is destroyed before the question "is this colony viable?" is ever asked. The
  establishment therefore carries a **founding stock endowment**: cover on the goods the seed
  population actually consumes, **drawn from the founding system's own stock** and conserved exactly
  as the seed population already is (`moved = min(want, what the source can spare)`), respecting the
  same drawable floor logistics uses so provisioning a colony cannot ration the founder. Not minted;
  the founder feels the cost.
  - **Sized against the colony's real demand basket, with no vital-goods list.** Two settlers demand
    overwhelmingly food and water and trace luxuries, so the shipment comes out weighted correctly
    on its own. A founder that genuinely holds none of something sends none, and the colony opens
    short on it — which the demand-weighted regime fold above correctly grades as a grumble rather
    than a famine. Colonies inheriting their founder's poverty is desirable texture.
  - **This buys a countdown, not immunity.** If neither local production nor a trade route arrives
    before the stores run out, the colony still fails — on the merits, and late enough that the
    failure is informative. Cover is calibrated against the time to stand up a first extractor, so a
    colony doing the right thing survives to reap it, and the founder's cost is a real brake on
    founding more colonies than a faction can provision.
- **Decision — shared scarcity ramp**: below `rationStock`, civilian consumption and industrial
  input draws use the same factor. The shipped coupled tick remains deterministic and
  recipe-topological rather than promising a pro-rata allocation pass: civilian delivery occurs
  with the good's entry and downstream industries draw later in recipe order. Civilian
  satisfaction remains civilian-delivered ÷ civilian-demanded.
- **Crisis becomes real and only real**: true empty (satisfaction 0, unrest climbing into
  strike/collapse) is reachable only in genuine catastrophe, never as a market's resting state.
- **Designed later promotion** (not built now): with purse Stage 2–3 monetisation, a *legible*
  EU5-style reserve — a visible, policy-set stockpile (N days held back, crisis release /
  requisition, war stores) rationed by access.

## 5. Infrastructure decay — gardener, not treadmill

- **Idle buffer 6 → 12 reference-months.** Idle now means genuinely unneeded, so the buffer's only
  jobs are how long over-capacity lingers and how long a dead colony's infrastructure survives.
- **Big-stack bias is cured by honest signals, not new machinery** — the whole-level trigger,
  one-level-per-buffer pacing, academy/complex utilisation reads, and single-level overshoot
  protection all stay exactly as built. The unrest-collapse channel keeps its threshold and its
  purpose but is rescoped below.
- **Couplings recorded**: maintenance funding's `bufferScale` (purse Plan 2) now governs
  glut-pruning speed and dead-colony persistence rather than a background treadmill — re-checked in
  §8. The decay-signal invariant lives here too: **the producer decay/Glut signal must never read
  realized, suppressed, or input-gated output** — the purse's flow-only guarantee (the malus
  scales output *after* utilisation is measured) extends to strike and event suppression, and the
  §1 funding-bound exclusion keeps a treasury dip from pruning demand-backed exporters. Stored
  idle-month counters survive saves harmlessly (healthy systems zero them on the first
  post-change run).
- **Housing is headroom, not waste — the idle channel can't tell them apart.** An idle production
  building is exactly the waste decay exists to prune; empty housing is capacity built deliberately
  ahead of the people who will fill it. The idle test asks a steady-state question —
  `capacityUsed("pop_cap") = min(count, population / POP_CENTRE_DENSITY × (1 + VACANCY_SLACK))` — so
  it cannot distinguish the two, and every mechanism that builds housing ahead of demand collides
  with it.
- **Every housing-sizing site resolves the collision by construction — none of them is exempted.**
  The idle test never fires on a stack whose spare capacity is under one whole level, so any sizing
  rule landing inside the vacancy slack is permanently safe at every stack size. Relief housing
  already satisfies it (`RELIEF_TARGET × (1 + VACANCY_SLACK) ≥ 1`). Colony establish is brought
  inside the same rule by **sizing housing to the seed's own need and dropping the bundled spare
  level**: `ceil(seedPop ÷ POP_CENTRE_DENSITY)` levels leaves under a whole level spare at every
  seed size, where the previous `+1` had a colony opening at seed population 2 read
  `floor(2 − 0.11) = 1` idle level from the moment it landed, shed after the idle buffer unless
  colonist delivery reached roughly 18 pop first. Containment is asserted across both sites.
  Exempting housing from the idle test was considered and rejected: it treats one badly-sized site
  as a defect in a rule that is correct, and it would leave genuinely abandoned housing unpruned.
- **The cost of dropping the spare level is opening absorption, and it is bounded** — a fresh colony
  holds one level rather than two, and the relief valve adds the next within a pulse of the trigger.
  The real tension is lumpiness: a 2-pop seed against a 20-pop housing unit means no colony can open
  looking anything but empty. Sizing the *seed* against the housing unit is the deeper fix and is
  deliberately deferred — it changes colonisation pacing and needs a founding policy. The idle
  buffer is the fallback lever if the tighter opening absorption proves too slow.
- **The trapped-colony population is not this collision at scale.** The idle channel takes a year to
  bite and removes only the spare level; the unrest-collapse channel removes *occupied* housing in a
  single run. The rescope below is what addresses it.
- **The unrest-collapse channel is rescoped to be proportionate, and never to strand a population.**
  It keeps θ = 0.75 and its purpose — the violent, discrete infrastructure collapse of a genuinely
  failed system — but three properties change:
  - **One level per run for the system, not one per building type.** The shipped channel iterates
    building types and sheds a level from each, so teardown speed scales with how *varied* a
    system's built base is: a ten-type world loses ten levels a month for the same unrest that costs
    a one-type world a single level. Collapse must not punish development. The level is shed from
    the least-used eligible type first (deterministic tie-break), so collapse eats the least-needed
    thing first.
  - **Severity scales with distance above the threshold** — unrest just over θ is a slow bleed,
    total revolt is fast. The shipped cliff treats 0.76 and 1.00 identically, turning a threshold
    crossing into immediate catastrophe with no observable ramp and nothing to react to.
  - **Housing is floored at the occupancy its residents need.** A failing system may lose its
    industry, its academies and its complexes; it may not be demolished out from under the people
    living in it. `popCap = 0` with residents present is a near-absorbing trap — `crowd(r)` reads
    fully crowded so growth is exactly zero, overshoot-death fires, and the relief valve cannot
    rebuild until the system is fed, which it cannot become without the capacity just torn down.
    Collapse must remain a decline that can be arrested, not a state with no exit.

## 6. Presentation contract — the panels speak regimes

Content contract only; concrete layout gets the house collaborative wireframe pass at build time.

- **Per-good regime chip** (Supplied / Low reserve / Rationing / Shortage / Glut) everywhere a good appears,
  driven by the §1 constants — the UI cannot contradict the simulation. **Precedence** for a good
  both produced and consumed locally: an access failure wins, while a Supplied good with
  producer-side Glut shows **Glut** (the actionable state); Rationing/Shortage exclude Glut by construction (low
  stock ⇒ full-rate production).
- **Days of cover is the primary unit** (stock ÷ demand rate, against reserve anchor 40 / ration 2); raw
  units demote to tooltips.
- **The Industry roster's "Worked" column splits**: a *Staffed* figure (pure labour, per grade) and
  a *state chip* naming the condition (producing / glut-idling / input-short on *which* input /
  understaffed on *which* grade). The single number that blended staffing with selling is retired.
  **Read-side derivation specified**: because §1's selling factor is the isolated ceiling
  throttle (stock + band only — no unrest/malus needed), the read service recomputes it exactly;
  `UtilizationContext.outputUptake` becomes the selling-factor accessor at both call sites (the
  decay engine and `buildIndustryReadout`), so the tick and the panel read one definition and
  cannot diverge. Staffing/input chips come from the labour state and input gates the readout
  already derives.
- **Needs panel**: "pops short X%" appears only during rationing — after §1 that is always a real
  problem, never ambient noise. Severity thresholds ride the regime constants — concretely, the
  read-side severity bands adopt them: met = Supplied (satisfaction ≈ 1 within
  `RATION_EXIT_EPS`), short = Rationing, critical = Shortage (< 0.5); the legacy 0.95 "met" band
  is retired.
- **Population panel shows the crowding state**: occupancy routinely exceeds 100% under §3, so the
  occupancy bar gains an overshoot treatment plus a crowding chip (comfortable / crowding /
  braked) — in this pass, not deferred; today's bar simply cannot represent the designed-normal
  state.
- **Stability explains causes and memory**: the Population surface separates current goods
  pressure from current tax pressure and shows whether stored unrest is rising, stable, or
  recovering. A coarse recovery indication is sufficient; an exact historical chart or precise
  “N months” forecast is optional backlog polish. Needs is labelled as the latest economy
  assessment, including the deliberate §2 logistics-to-assessment lag.
- **Collapsed-housing diagnostics remain visible**: `popCap <= 0` must not replace the Population
  panel with a generic Uninhabited state while population or unrest remains. The stranded
  population, stability, causes, and collapse state stay inspectable.
- **Strike language uses the mechanic's threshold**: the badge/readout names Strike when
  production suppression actually begins (`unrest >= 0.65`), rather than waiting for a separate
  0.8 presentation boundary. The explicit strike warning and badge cannot disagree.
- **Alert feed** (Slice 4, later): regime transitions (entering Shortage, going overcrowded) are
  its natural events — pointer recorded; the enter/exit hysteresis (§1) is what makes those
  transitions alert-worthy rather than boundary noise.

## 7. New/changed constants (all coarse first-cuts, harness-calibrated)

| Constant | Initial | Meaning |
| --- | --- | --- |
| `RATION_COVER` | 2 cycles | Emergency threshold below which current delivery is rationed |
| initial/export reserve floor | 0.75 × T | Strategic reserve policy, separate from access |
| production knee | 1.0 × T | Full rate to the anchor; ramp ends at HOLD_COVER (1.3, unchanged) |
| `USED_SLACK` | 0.15 | Producer decay-signal slack on the throttle |
| `VACANCY_SLACK` | 0.10 | Housing decay-signal vacancy allowance |
| `CROWD_BRAKE_END` | 1.15 | Occupancy ratio where growth reaches zero |
| crowding-pressure clamp | 0.05 | Max unrest-integrator contribution from overcrowding |
| `PROVISION_MARGIN` | 0.10–0.15 | Planner capacity margin over demand |
| squeeze persistence | 2 pulses | Feedback-backstop + proposal persistence window |
| `BUILD_RATE_CAP` | ~0.4 | Max fraction of a good's gap proposed per pulse |
| `idleBufferMonths` | 12 (was 6) | Sustained-idle buffer |
| housing pressure trigger / target | 0.95 / 0.92 | Autonomic housing relief band (target inside the vacancy slack) |
| `RATION_EXIT_EPS` | calibrated with the presentation pass | Regime-chip enter/exit hysteresis around rationing |
| overshoot-death gate | strike threshold (0.65) | Unrest above which the overshoot-death term fires (collapse regime only) |
| colony housing sizing | `ceil(seedPop ÷ POP_CENTRE_DENSITY)` | No bundled spare level — inside the vacancy slack by construction (§5) |
| shortage demand share | calibrated | Share of a system's demand in badly-supplied goods that selects the fast unrest rate (§3) |
| unrest ceiling — Rationing | below the strike threshold | Equilibrium `floor + ceiling × D`; asserted under 0.65 (§3) |
| unrest ceiling — Shortage | calibrated, > Rationing's | Only genuine famine may approach the collapse regime (§3) |
| collapse severity ramp | 0 at θ → full at unrest 1 | Distance above θ scales teardown speed; replaces the cliff (§5) |
| collapse teardown rate | 1 level per run per SYSTEM | Was one per building type — no longer scales with built variety (§5) |
| founding stock cover | ≈ time to stand up a first extractor | Colony endowment drawn from the founder's stock (§4) |

Constant dependencies asserted in tests compare the logistics trigger in demand cycles against
`RATION_COVER`; and the decay/Glut
selling factor contains no labour, input-gate, strike, maintenance, or event term (the purse
flow-only invariant, §1/§5).

## 8. Interactions, recalibration, validation

- **Unrest/tax recalibration**: structural dissatisfaction vanishes at health, so tax becomes the
  only standing unrest floor — population equilibria rise; calibrate the §3 regime-sensitive
  accumulation/recovery curves, re-check tax-level equilibria and strike thresholds, and report
  recovery tails from historical unrest.
- **Treasury recalibration** (Task-10-style, flagged when this pass was sequenced): realized output
  rises galaxy-wide → production-tax income moves; re-run the purse funding-gate calibration.
- **Invariance**: `ECONOMY_SCALE` ratio-invariance holds by construction (all knees are
  band-relative); re-run the invariance bridges. S=1 output is *not* byte-identical to pre-change —
  update fixtures; keep magnitude assertions range-y per the coarse-health standard.
- **Harness validation targets**: no "pops short" badges at rest on healthy systems; median
  price/base ≈ 1.0 with real dispersion both directions; housing stacks stable without rebuild
  churn; no burst builds (new sim metric: max levels committed per good per pulse); dead colonies
  still cleaned up; genuinely glutted capacity prunes; colonies populate; no NaN/runaway/pinning.
  Also assert: Supplied recovery is faster than Rationing recovery; Shortage accumulates faster
  than shallow Rationing; tax equilibria remain ordered and intentional; one shortage pulse is
  recoverable; logistics delivered after assessment changes satisfaction on the next assessment.
- **Additional targets for the collapse/colony pass**: a system supplied in its high-demand goods
  and short only in low-demand ones stays off the fast unrest rate and settles below the strike
  threshold; sustained Rationing cannot reach the 0.75 collapse threshold at any tax level; a
  collapsing system's teardown rate is independent of how many building types it has built; a
  system in collapse never reaches `popCap = 0` while it holds population; a system with zero
  capacity in a good receives build proposals for it regardless of its unrest; a striking system
  contributes only its realized output to exporter spare; and a colony founded into a supplied
  region survives its opening months without entering the collapse regime while one founded beyond
  logistics reach still fails. Track the **striking share** and the **stranded-population count**
  (population with `popCap ≈ 0`) as headline health metrics — both were the loudest signal that the
  shipped constants were compounding rather than correcting.
- **Regime-share metric**: add % of (system, good) pairs per regime to the simulate report — the
  permanent instrument for this pass and future economy work.
- **Further harness updates**: the population saturation watch inverts meaning (pop ≈ popCap
  becomes the healthy resting state, not a pathology — the new pathology is r pinned at the crowd
  brake with relief blocked); add a migration-throughput metric (verifies absorption pacing after
  the pre-provision retires, §3) and a shock-recovery-tail read (price recovery time through the
  §1 dead zone). Two existing instruments re-base to the new geometry: `computeCoverLevels`
  excludes structural exporters (production ≥ demand) from deficit classification — §2 parks them
  at comfort deliberately, the live matcher's self-supply gate already excludes them, and the
  unpatched metric would report false deficits exactly where the design is healthiest; and the
  stock-pin metric re-bases from the retired `minStock` clamp to true floor pins (stock ≈ 0, the
  Shortage regime), updating its "literal clamp" doc language.

## Out of scope

The reserve/stockpile mechanic build (§4 pointer), rent or housing-quality goods,
distance-weighted spare netting, per-building labour assignment (uniform proportional staffing
stays), and any map price-mode work.

## Housekeeping folded into the build

`lib/tick/processors/economy.ts:168` cites `docs/planned/economy-equilibrium-rework.md`; the doc
lives at `docs/active/gameplay/economy-equilibrium-rework.md` (never deleted — the BACKLOG brief's
recovery instruction was unnecessary). Fix the pointer; on ship, update that active doc (its
"change" section describes the geometry this pass replaces), delete the `[L]` BACKLOG item, and
re-audit the hedged maturity-flattens-spread memory note against the new equilibrium.
