# Measurement traps

Every way a measurement of this simulation has lied. Read this before trusting any number about the
economy — including a number you produced yourself. Most of these produce a confident, specific,
wrong answer, not an obviously broken one.

## The instrument

- **Suspect the instrument before the thing it measures.** The calibration harness once ran at
  `ECONOMY_SCALE=1` while the dev server ran at 100 (`.env` is loaded by Next, not by `tsx`), so the
  same seed and same code gave a dying galaxy in the sim and a thriving one in the game. Now guarded
  by `economy-scale-dynamic-invariance.test.ts`, but the reflex stands: when a harness result
  contradicts what the game shows, the harness is the suspect.
- **Never measure the tick's internals from outside the tick.** Logistics runs near the end of a
  tick, after economy/decay/population/migration have moved stock and demand and before build and
  colony founding move them again. A pre-tick snapshot claimed 84% of deliveries "exceeded" their
  target — pure snapshot error; a post-tick snapshot is wrong the other way. Instrument inside the
  processor. `anchorMult` is the sharpest case: events apply anchor shifts *during* the tick, so
  reading it beforehand gave "events explain 8%" and reading it where the matcher reads it gave 100%.
- **Measure with the function the mechanism actually calls, and check its scope.** Measuring "has a
  reachable supplier" with the build planner's `spare` instead of logistics' `surplusDrawable`, while
  ignoring that `matchFactionTransfers` runs *per faction*, turned "22 of 23 have no supplier" into a
  confident "0 of 23".
- **The default poisoning fixture is blind to the logistics matcher.** `generateWorld({ systemCount:
  100, seed: 42 })` produces zero directed-logistics flow events even at 300 ticks. The "prove
  nothing in the tick reads this field" convention (poison every row, run 50 ticks, diff the whole
  world) therefore cannot catch a leak whose only observable channel is `transfers`/`flowEvents`:
  clean and poisoned runs both read zero. A connected two-system water-gradient fixture does catch
  it — a deliberate leak moved `logisticsBill` 2.84 → 580.64. Fields with a non-matcher leak path
  (population, economy, planner) are still covered by the plain fixture. Any new signal written
  inside the matcher needs the connected fixture.

## The aggregate

- **An aggregate index washes out the axis the mechanism runs on.** Colony bootstrapping turns on
  arable and water slots specifically; a galaxy-wide yield score (7.59 striking vs 7.78 calm) said
  endowment was dead. It wasn't — 12.5% of stuck worlds held an arable slot against 73.8% of healthy
  ones. Before trusting a "measured dead", check the index was measured on the right axis.
- **Cohort mix moves an aggregate independently of the thing it measures.** `medianCover` medians
  over all markets, so a change in the living/dead or producer/consumer mix moves it on its own.
  `npm run simulate` cohorts by market role and world cohort — use it.
- **Striking count is a churn metric, not a health metric.** 50 systems striking at one frame
  contained 26 chronic cases and 30 crossing the line in either direction. Judge over a trailing
  window (striking at both ends AND population flat), or a recovering galaxy reads as a sick one.
- **A single-seed point A/B on a trajectory-sensitive count is unreadable inside its noise band.**
  The colonies-with-tier-1+-industry count at 24K swings ~±10 under ANY planner perturbation on one
  seed — every perturbed variant of one feature read 77-89 while only the byte-identical control
  matched the baseline's 100, and a half-strength variant read *worse* than full strength (no
  dose-response, the tell). A one-seed gap on such a metric is a point estimate inside that band,
  not a finding. Replicate across seeds (e.g. 43/44/45) and read the cross-seed pattern; treat as
  real only what holds a consistent sign or shape on every seed.

## The horizon

- **The 10,000-tick "equilibrium" horizon sits inside the founding transient for late-moving
  metrics — and the metric can be mid-collapse, not mid-recovery.** Under current timescales the
  first colony completes ~t=4,128, so 1K is pre-founding and 10K is founding era (~in-world year 7).
  The manufactured tier reads mid-collapse at 10K on any branch: baseline electronics cover 0.54 at
  10K is a transient peak, 0.00 by 16K on main too. Any A/B of such a metric at 10K measures
  *trajectory position*, not an equilibrium level, and can point in the opposite direction to the
  metric's own end state. Before reading a 10K number as a level, check the metric's own trajectory
  is flat there — or read at 16K+ and still call it founding era.

## The inference

- **A startup fault can set the equilibrium level.** "It is only 0.3% of flow now" is not evidence
  it did not cause the state you are standing in. A founding-era misallocation decides which worlds
  get established and stocked; equilibrium inherits that and looks innocent. This is the reason a
  "ruled out" needs both horizons.
- **A plan bullet asserting a symptom should carry a number or a file:line.** A false premise once
  sat in a paragraph beside two claims that *did* carry citations, and read exactly like them.
- **A structurally-guaranteed condition can masquerade as a finding.** "100% of throttled exporters
  hold drawable stock" reads like a discovery; it is arithmetic (throttled ⇒ stock > anchor ≥ export
  reserve). Before quoting a striking percentage, check whether the cohort's definition forces it.
- **A pre-registered "expected direction" on a share metric can pass on a dead galaxy.** A stage-3
  gate's two headline predictions both came true — exporter throttle share fell 30.9%→17.2% and the
  thin-reachable residual fell 71%→6% — while the economy collapsed to 0.2% supplied, because the
  change destroyed both denominators (exporter-path markets −85%; unmet tonnage ×8.8). A share
  metric's expected direction licenses nothing without its denominator's trajectory beside it; gate
  on absolute health reads first, direction predictions second.

## The test

- **Deleting a "proves X exists" assertion can silently delete the only value-level coverage of a
  field.** Killing the government-boost tests left `GoodMarketState.demand` and a logistics row's
  `.consumption` guarded by nothing but `isFinite`/`>=0`. Before deleting a test, grep whether any
  other test still pins an actual value on the fields it touched. A rewritten test that loops a
  collection needs its own non-empty guard — a sibling test's guard doesn't count.
- **Excess-property checking only fires on directly-annotated literals**, so `tsc` will not enumerate
  fixture props or inferred object literals. Grep; don't trust a clean typecheck to have found them
  all.
