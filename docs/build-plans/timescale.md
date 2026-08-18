# Timescale: define the calendar

## Idea

### Problem

The game has no calendar: a tick means nothing in in-world time, so every duration (cycle length,
pop growth, travel, event lengths, decay) is tuned by unanchored feel and pacing arguments cannot
be settled. The calendar is a definition set from external reference; a rate can fail the
definition, never set it.

### Chosen direction (Kai, 2026-08-19)

**1 tick = 6 in-world hours (4 ticks/day). The cycle stays 24 ticks = 6 in-world days.**

- Internal and research units are real hours/days/weeks — rate defaults get anchored against
  real-world data in those units (e.g. average population growth). Kai: "internally have this
  concept of hours/days/weeks and we use that in our research for e.g average pop growth that
  matches reality roughly."
- Player-facing language is fictional, not Earth-calendar — the 24-tick cycle is already the
  economic "week", so it gets a fictional name rather than claiming to be seven days. Kai: "since
  we already use kinda cycle for a week we could use different language." Display converts tick to
  a Stellaris-style fictional date; the exact format is a design-stage question, not settled here.
- The 6-hour floor on observable change is accepted: "for a space game 6 hours increments are
  reasonable, its a larger scale than EU5 or vicky." Combat (unbuilt) worries were examined and
  parked — battles can be authored in ticks or resolved sub-tick internally, so the calendar does
  not foreclose war pacing.

### Killed alternatives

- **Cycle → 28 ticks (Earth week, exact Vicky3 parity)** — `CYCLE_LENGTH`
  (`lib/constants/tick-cadence.ts:19`) feeds logistics cadence, treasury settlement, pricing
  cadence and every cycle-denominated tuning constant; all would stretch ~17% for a calendar label
  with zero simulation meaning.
- **1 tick = 1 hour, cycle = 1 day** — 100 years becomes ~876K ticks, ~49 wall-clock hours at fast
  mode's 5 ticks/s; kills the grand-strategy arc.
- **1 tick = 1 day, cycle ≈ a month** — coarser EU4-style; contradicts the stated lean toward
  fine-grained ticks with slower rates.
- **EU5-style finer/daytime-only ticks** — raised and passed over: "we dont need 24 ticks a day
  though probably."

### Premises

**Definitional** (owner decisions / external anchors — quoted above, no measurement needed):

- D1. 1 tick = 6 in-world hours; 4 ticks/day. External anchor: Victoria 3 runs 4 ticks/day.
- D2. Cycle stays 24 ticks = 6 in-world days, fictionally named.
- D3. Real-world data (in real units) sets rate *defaults*; it never redefines a mechanic.
- D4. Tick → fictional date conversion is display-layer.

**Checkable** (→ `/measure` claims, both horizons, cohorted):

- C1. Worlds reach max population by ~tick 12,000 (~8 in-world years at this anchor) — the roadmap
  carries this figure unverified. Falsifiable as: median pop-to-max for the seeded developed cohort
  is inside 10,000–14,000 ticks at the equilibrium horizon.
- C2. Colonisation pace: ticks from charter to viable colony (one instrument run shared with the
  colonisation-pacing roadmap row).
- C3. Travel durations: the distribution of ship travel ticks.
- C4. Event lengths: the distribution of active-event durations in ticks.
- C5. Decay: half-life in ticks of unmaintained infrastructure.
- C6. Tick cost: ms/tick at both horizons, giving sustained maximum ticks/s at equilibrium galaxy
  size (feeds the terminal falsifier).

**Hypotheses** (believed, carried with the label on):

- H1. No save-format change is needed — the date is derivable from `tick` at display time. Dies if
  a per-game start-date epoch is wanted.
- H2. Combat, when built, can resolve sub-tick internally if the 6-hour floor proves too coarse.
- H3. The directed build/planner defines no durations of its own — it only reads rates.

## Measure plan

Committed before any instrument runs.

**Claim A (the rates-too-fast premise — C1, C2):** read at 1 tick = 6 h, current population growth
and colonisation pace run at least 10× faster than real-world anchors — pop-to-max ≈ 12,000 ticks
≈ 8.2 in-world years, and charter→viable colonisation well under a decade. This is the premise
behind "fine-grained ticks with much slower rates".
*Falsifier:* if median pop-to-max for the seeded developed cohort exceeds 150,000 ticks (~100
years) — i.e. growth is already real-world-plausible — the rate-audit premise is false and the
direction's shape changes (anchor may stand, but "slow everything down" dies). Read at whatever
horizon reaches max; if 10,000 ticks does not, extend the run rather than extrapolate.

**Claim B (C6, the terminal falsifier's input):** the tick loop sustains ≥ 3 ticks/s at the
equilibrium-horizon galaxy. *Falsifier:* measured ms/tick at the 10,000-tick horizon implies
sustained throughput below 3 ticks/s → the 4-ticks/day anchor is dead (see Terminal falsifier).

**Descriptive readings, no prior on record (C3, C4, C5):** travel-duration distribution, event-length
distribution, decay half-life. These feed the spec's duration-audit table; each gets the six-field
frame but has no kill-line — there is nothing on record for them to contradict. C5 is likely
analytic (a constant-derived half-life), instrumented by reading the producer, not the sim.

## Evidence

Instruments: the standard quick run (`npm run simulate`, seed 42, 600 systems, economy scale 100,
both horizons, all conservation identities PASS) and a scratch 16,000-tick runner
(`temp/timescale-diag.ts`, same seed/scale, pure `runWorldTick`, per-cycle sampling). The scratch
runner was validated against the quick run's independent total-population figure: quick run
t=10,000 reads 1,593,333; the runner brackets it (1,584,259 at t=9,600 / 1,601,924 at t=10,560).
No tracked file was instrumented; the runner lives in gitignored `temp/`.

### C1 — population growth (Claim A)

```
Meaning:    The galaxy's population S-curve plateaus at ~tick 11,500, but seeded developed
            worlds are BORN at max — the roadmap's "worlds hit max pop by ~12K" is the galaxy
            plateau, not any world growing to cap. Growth is ~30× real-world at the anchor.
Claim:      Read at 1 tick = 6 h, population growth runs ≥10× faster than real-world anchors.
Number:     Total pop 100,000 (t=0) → 131,898 (t=960) → 1,601,924 (t=10,560) → flat
            1,605K–1,607K from t=11,520 to 16,000. Early doubling ≈ 1,300 ticks ≈ 0.9 in-world
            years; whole-curve average ≈ ×12 over 8.2 in-world years ≈ 35%/year vs the ~1%/year
            real-world anchor. All 20 seeded developed systems sit at ≥98% popCap at t0;
            0 reached it in-run (nothing left to reach). Analytic: growthRate 0.015 per
            system-cycle (lib/constants/population.ts:102,126) compounds to ≈×2.5/in-world-year
            unconstrained.
Horizon:    16,000 ticks continuous (covers both standard horizons; plateau at ~11,500).
Cohort:     Galaxy total + the 20 seeded developed systems tracked individually.
Licenses:   Supports "rates must slow massively to meet a real-world anchor" (Claim A CONFIRMED,
            by ~30×). Supports correcting the roadmap premise: the 12K figure is the galaxy-wide
            plateau driven by colony founding + fill, not seeded-world growth — seeded developed
            worlds have NO growth phase at all. Does NOT support any statement about what limits
            growth (housing build-out vs the growth constant — not separated here), nor about
            colony-level fill times (not cohorted out).
```

### C2 — colonisation pace

```
Meaning:    Founding a colony takes about 16 cycles start to finish, and the founding era is
            effectively over within the first ~17% of the equilibrium run.
Claim:      Descriptive (no prior). Shared instrument with the colonisation-pacing roadmap row.
Number:     commitment → completion median 16 cycles (384 ticks ≈ 96 in-world days), mean 16.1/
            16.2, max 17 (startup) / 20 (equilibrium). Colonies founded: 233 by t=1,000; 562 by
            t=10,000, 80% of them by t=1,704 (cadenceMarkTick).
Horizon:    Both (startup 1,000t; equilibrium 10,000t).
Cohort:     All colonies founded in-run, galaxy-wide.
Licenses:   Supports the duration-audit table and the colonisation-pacing row's speed question
            (562 colonies in ~6.8 in-world years). Does NOT support per-colony viability timing
            (founding completion ≠ economic viability) — that needs the founding-trajectory
            buckets if wanted.
```

### C3 — travel durations

```
Meaning:    Nothing physically travels in the simulation today; the only travel durations that
            exist are the navigation primitive's, which would make a typical lane hop ~30 hours.
Claim:      Descriptive (no prior).
Number:     Real ship trips observed over 16,000 ticks: 0 (ships array empty end-to-end).
            Directed logistics plans and applies stock transfers within one tick
            (lib/tick/processors/directed-logistics.ts:103-164); migration is instantaneous
            (SPEC interaction map); founding manifests teleport (roadmap, logistics-depth row).
            Analytic hopDuration over the real galaxy's 1,866 lanes at reference speed:
            min 4 / p10 4 / median 5 / p90 7 / max 24 ticks (= 30 h median, 6 days max).
Horizon:    16,000 ticks (trip count); analytic for the distribution (world-gen output, seed 42).
Cohort:     All 1,866 lanes; all ships (there are none).
Licenses:   Supports "the calendar constrains no shipped travel mechanic today" — travel-time
            audit only binds future work (real-freight logistics). Does NOT support "travel
            would feel right at 6 h/tick" — no shipped consumer of hopDuration runs in the tick.
```

### C4 — event lengths

```
Meaning:    Events run from about a week to a season of in-world time at the chosen anchor.
Claim:      Descriptive (no prior).
Number:     Equilibrium (n=7,727): p10 34 / median 69 / p90 280 / max 406 ticks
            (≈ 8.5 days / 17 days / 70 days / 101 days at 6 h/tick).
            Startup (n=777): p10 34 / median 62 / p90 252 / max 387 — same shape.
Horizon:    Both.
Cohort:     Every event impact recorded by the harness, all types pooled.
Licenses:   Supports the duration-audit table. Does NOT support per-type judgements (a plague
            and a festival are pooled here); split by eventType at the spec if a type looks odd.
```

### C5 — infrastructure decay (analytic)

```
Meaning:    Decay has no half-life — it is a whole-level ratchet with a 12-cycle idle grace,
            which the anchor reads as 72 in-world days before an idle level tears down.
Claim:      Descriptive (no prior; the "half-life" framing in C5 was wrong).
Number:     idleBufferCycles 12 (= 288 ticks = 72 days), then one level per eligible type per
            cycle; catastrophic channel strictly above unrest 0.75
            (lib/constants/infrastructure.ts:20-23 and its docstring).
Horizon:    n/a — constant + mechanism read, not a rate measurement.
Cohort:     n/a.
Licenses:   Supports the duration-audit table. Does NOT support "decay pace is right/wrong" —
            no outcome was measured here.
```

### C6 — tick throughput (Claim B, the terminal falsifier's input)

```
Meaning:    The tick is more than an order of magnitude faster than the kill line — the
            4-ticks/day anchor is safe on wall-clock grounds.
Claim:      The tick loop sustains ≥ 3 ticks/s at the equilibrium-horizon galaxy.
Number:     Pure runWorldTick, per 1,000-tick segment: 6.2 ms/t (0-1k), peaking 31.9 ms/t
            (5-6k, peak colonisation churn), settling 20.4–22.1 ms/t from 9k onward →
            sustained ≈ 45-49 ticks/s at the settled galaxy, worst segment ≈ 31 ticks/s.
            Harness-laden comparison: 24.5 ms/t over the equilibrium quick run.
Horizon:    16,000 ticks continuous; worst and settled segments quoted separately.
Cohort:     Whole tick, 600 systems, economy scale 100, this dev machine.
Licenses:   Claim B CONFIRMED with ~15× margin: a 146,000-tick 100-year arc ≈ 50-80 wall-
            minutes of pure compute at the settled rate. Machine-relative — the margin is the
            portable read, not the ms. Does NOT license any per-processor conclusion (see
            tick-perf memory for that instrument), and says nothing about UI/SSE overhead at
            speed.
```

### Verdict against the falsifiers

- **Claim A (rates too fast): CONFIRMED** — ~30× the real-world growth anchor; the falsifier
  (already-plausible growth, >150K ticks to max) is nowhere near firing.
- **C1's specific 10K–14K band: reframed, not confirmed** — the seeded developed cohort has no
  time-to-max (born at cap). The 12K figure survives as the galaxy plateau tick (~11,500), and the
  roadmap row's wording should say so.
- **Claim B (throughput): CONFIRMED** — ≥31 ticks/s worst segment vs the 3 ticks/s kill line.
  The terminal falsifier does not fire. **The direction stands.**

## Spec

**What changes:** One tick is now defined as six in-world hours, so the 24-tick economic cycle is a
six-day week and every duration in the game can be read in days and years. Three families of rates
slow to match real-world reference points: population grows at a frontier-boom pace instead of
doubling in months, buildings take months-to-years instead of weeks, and founding a colony takes
about three years instead of one season. Nothing else about the economy's behaviour changes — the
same money flows each cycle, the same goods move, the same events fire; the galaxy simply matures
over a century instead of eight years.

**Why:** The game had no calendar, so every duration was tuned by unanchored feel (## Idea). Owner
decisions encoded here: the anchor — "I think for a space game 6 hours increments are reasonable";
cycle naming — "since we already use kinda cycle for a week we could use different language";
uniformity — "there should be no differentiation between an 'existing world' and a colony, besides
the colony phase"; the three realism anchors (3%/year pop growth, ×10 build durations, ~2.8-year
founding) — "This sounds much more reasonable to me, and is the sort of time I would expect projects
like that to take and we can always tweak this later"; and the preservation constraint — "the
economy works well as is, hopefully everything just slows down and nothing breaks", which this spec
turns into the invariant that per-cycle treasury flows do not move.

**Evidence** (pointers into ## Evidence above):
- C1: growth is ~30× the real-world anchor; seeded developed worlds are born at cap. Licenses the
  30× slowdown; does NOT separate housing-limits from the growth constant.
- C2: founding completes in a median 16 cycles, at the absorption-cap floor. Licenses treating
  build durations as the floor formula `work ÷ cap`.
- C6: ≥31 ticks/s worst segment. Licenses the anchor on wall-clock grounds; machine-relative.
- C4/C5: event lengths (~1 week–1 season) and the decay idle grace (72 days) already read as
  plausible at this anchor — licensed to stay untouched this pass.

**Not claimed:** No player-facing date display or fictional calendar names — that is its own later
slice; this spec only lands the internal anchor constant. No change to event durations, decay
pacing, unrest integration speed, or disaster/decline realism: `declineRate` and
`overshootDeathRate` scale symmetrically with growth (or stay put, per the table), which makes
famine and decline *slow* in real terms — deliberately deferred to a future disasters pass rather
than half-designed here. No claim that colonisation *frequency* is right afterwards — settler
supply tightens emergently and the colonisation-pacing row (roadmap item 2) owns that question.
No retuning of any market/pricing constant: cycle-denominated economics are untouched by design.

### The calendar

`HOURS_PER_TICK = 6` — new, emitted at `lib/constants/tick-cadence.ts` beside `CYCLE_LENGTH`
(`lib/constants/tick-cadence.ts:19`). Derived language, used in docs and rate rationales: 4
ticks/day, cycle = 24 ticks = 6 days, ≈60.9 cycles/year, 1 year ≈ 1,461 ticks. External anchor:
Victoria 3 runs 4 ticks/day. The constant is documentation-of-meaning plus a conversion helper for
future display work; no processor reads it this pass.

### Rate changes (all values are proposals with rationale; defaults set by measurement)

| Constant | Today | Proposed | Rationale |
|---|---|---|---|
| `POPULATION_PARAMS.growthRate` (`lib/constants/population.ts:126`) | 0.015/cycle | 0.0005/cycle | 1.0005^60.9 ≈ 3.1%/year — the frontier-boom ceiling (19th-c US with mass immigration) |
| `POPULATION_PARAMS.declineRate` (`:127`) | 0.015 | 0.0005 | preserves the authored growth/decline symmetry (`lib/constants/population.ts:104-107`); disaster realism deferred (Not claimed) |
| `MIGRATION_PARAMS.maxOutflowFraction` (`:156`) | 0.01 | 0.0003 | its own docstring rule: "Kept BELOW the natural growth rate … a stronger rate bled the cores dry" (`lib/constants/population.ts:154-155`) |
| `CONSTRUCTION.THROUGHPUT_PER_POP` (`lib/constants/construction.ts:21`) | 0.05 | 0.005 | pool ÷10 → levels-per-year throughput ÷10 |
| `CONSTRUCTION.PER_BUILD_ABSORPTION_CAP` (`:23`) | 4 | 0.4 | min build time = work ÷ cap ×10; with pool ÷10 the parallel-front count (pool ÷ cap) is unchanged |
| `CONSTRUCTION.POOL_FLOOR_BASE` (`:33`) | 4 | 0.4 | same share of the ÷10 pool — the young-colony fairness floor keeps its meaning |
| `CONSTRUCTION.POINTS_PER_LEVEL` (`:41`) | 5 | 0.5 | keeps the centre's "well above eligible-heads yield" ratio (25 × 0.005 = 0.125 vs 0.5) |
| `TREASURY_RATES.CONSTRUCTION_RATE_PER_WORK` (`lib/constants/treasury.ts:26`) | 4 | 40 | points absorbed/cycle ÷10 × rate ×10 = per-cycle construction spend UNCHANGED (the invariant); a level's lifetime money cost rises ×10 — infrastructure is expensive, stated consequence |
| `COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES` (`lib/constants/colonisation.ts:111`) | 8 | 80 | its own rationale is "~half a nominal establish" (`:108`); the establish is now ≥170 cycles |

Deliberately unchanged: `workCostPerLevel` and every override (it is also the maintenance-bill base,
`lib/engine/treasury.ts:112` — moving it moves standing costs galaxy-wide);
`MAINTENANCE_RATE_PER_WORK`, `LOGISTICS_RATE_PER_WORK`; `CYCLE_LENGTH`; `PAYBACK_HORIZON` and
`BACKLOG_WINDOW` (cycle-denominated ratios of pool quantities that both scale ÷10);
`FOUNDING_STOCK_COVER`, `MIN_SETTLER_SUPPLY`, charter fees (charter scales with the untouched
maintenance bill by construction, `lib/constants/colonisation.ts:68`); all event, decay, unrest and
market constants.

### Resulting durations (the audit table)

| Thing | Today | After | Real-world reference |
|---|---|---|---|
| Housing level | 2 cycles = 12 days | 20 cycles ≈ 4 months | housing development ~1 year (kept faster: prefab fiction) |
| Extractor | 3 cycles = 18 days | 30 cycles ≈ 6 months | mine/site opening 1-3 years |
| Tier-1 factory | 5 cycles = 30 days | 50 cycles ≈ 10 months | factory construction ~1-2 years |
| Tier-2 factory | 7.5 cycles = 45 days | 75 cycles ≈ 15 months | heavy plant 2-4 years |
| Colony establish | ~17 cycles ≈ 100 days | ~170 cycles ≈ 2.8 years | no analog; owner call |
| Pop growth | ≈ ×2.5/year | ≈ 3.1%/year | frontier-boom ceiling |
| Galaxy maturation | ~8 years (plateau t≈11,500) | order of a century (analytic; verified by trajectory slope, below) | a grand-strategy arc |

Behavioural notes, observable: build ETAs shown by `lib/services/build-options.ts:80-82` and
`lib/services/construction.ts:134-135` read the same constants, so every UI ETA moves consistently
with no separate change. Saves are constants-compatible: no `World` shape change, and an in-flight
project's `work` remaining stays valid — it simply absorbs at the new cap from the next cycle.
Mid-flight founding projects likewise continue under the new stall window.

### Verification plan (sim gates)

1. Both standard horizons pass the coarse health bar with no regression: conservation identities
   PASS, no NaN/runaway/pinning, striking share and teardown totals comparable to the baseline run
   in `## Evidence`. Note the relabel: at the new rates the 10,000-tick horizon is early-era, not
   equilibrium — read it as "founding era, year 7", never tune demography against it.
2. A trajectory check (scratch runner, ~50K ticks ≈ 34 in-world years): realised galaxy population
   growth reads 3%±1/year while unsaturated, and founding commitment→completion medians ≈170
   cycles. This is the gate on the two headline rates.
3. The decay watch: cumulative teardown levels at horizon 2 must not run away — slower pop growth
   means capacity waits longer for staff, and decay eating unstaffed capacity is the known failure
   shape (hazard worksheet precedent).
4. The harness's own "equilibrium" label and the roadmap row about it
   (`docs/ROADMAP.md` → "Decide the simulate equilibrium horizon") inherit this change — flagged
   there, not solved here.

### Hazard worksheet

**1. One quantity, several unrelated jobs** (`npm run impact` outputs pasted in trimmed form):

| Quantity | Every reader today | Which this design moves | Intended? |
|---|---|---|---|
| `workCostPerLevel` | `impact`: 15 refs / 5 modules — directed-build (`lib/engine/directed-build.ts:825,1093,1103,1108,1338,569`), build-options (`lib/engine/build-options.ts:118`), construction-centre (`lib/engine/construction-centre.ts:106`), **treasury maintenance** (`lib/engine/treasury.ts:112`) | **none** | Yes — triple duty (build effort / proposal sizing / maintenance base) is exactly why the duration levers avoid it |
| `CONSTRUCTION.*` | `impact`: 16 refs / 3 modules — tick (`lib/world/tick.ts:1548-1554`), services build-options (`lib/services/build-options.ts:80-82`), services construction (`lib/services/construction.ts:134-135`), harness build-analysis (`lib/tick-harness/build-analysis.ts:881`). impact verdict: HAZARD 1 APPLIES | `THROUGHPUT_PER_POP`, `PER_BUILD_ABSORPTION_CAP`, `POOL_FLOOR_BASE`, `POINTS_PER_LEVEL` | Yes — all four scale ÷10 together so every ratio between them (fronts, floor share, centre yield) is preserved; UI ETA services read the same constants so displays move with the mechanics |
| `POPULATION_PARAMS` | `impact`: 10 refs / 4 modules — tick (`lib/world/tick.ts:1301`), UI provision-view (`components/system/provision-view.ts:122-160`, crowdBrakeEnd only), system-population service (`lib/services/system-population.ts:59,79`, crowdBrakeEnd only), simulate (`scripts/simulate.ts:363`, crowdBrakeEnd) | `growthRate`, `declineRate` only | Yes — every non-tick reader consumes `crowdBrakeEnd`, which does not move |
| `MIGRATION_PARAMS` | `impact`: tick (`lib/world/tick.ts:1390,1574`), migration-map service (`lib/services/migration-map.ts:31`, weights only) | `maxOutflowFraction` | Yes — the service reads `weights`, untouched |
| `CONSTRUCTION_RATE_PER_WORK` | treasury accrual only (`lib/tick/processors/treasury.ts:77-79` bills work performed; `lib/constants/treasury.ts:26` "Money per construction point actually absorbed") | ×10 | Yes — single-reader; pairs with absorption ÷10 to hold per-cycle spend |

**2. Constants read for their authored meaning** (docstrings quoted):

| Constant | Docstring says | This design uses it as | Same? |
|---|---|---|---|
| `PER_BUILD_ABSORPTION_CAP` | "sets the minimum build time (work ÷ cap) and the front count" (`construction.ts:22`) | the build-duration lever | Yes — both effects computed above |
| `THROUGHPUT_PER_POP` | "points a faction's pool gains per unit population per cycle" (`construction.ts:20`) | the throughput lever | Yes |
| `maxOutflowFraction` | "Kept BELOW the natural growth rate (0.015) so edge diffusion can't drain a system faster than it regrows" (`population.ts:154-155`) | forced to scale with growth | Yes — the docstring's own invariant would break if left |
| `FOUNDING_STALL_COMPLETE_CYCLES` | "~8 is roughly half a nominal establish (68 work ÷ … 4 ⇒ ≥17 cycles)" (`colonisation.ts:108`) | rescaled to half the new establish | Yes |
| `POINTS_PER_LEVEL` | "Set well above what the level's own labour draw would yield" (`construction.ts:38-39`) | scaled to preserve that ratio | Yes |
| `CONSTRUCTION_RATE_PER_WORK` | "Money per construction point actually absorbed by the queue" (`treasury.ts:25`) | flow-invariance lever | Yes — flow = points × rate |
| `growthRate` | "per population-processor run, one per economy-shard update … Calibrated against the simulator" (`population.ts:102,123`) | per-cycle growth, recalibrated to an external anchor | Yes — recalibration is the change |

**3. Systems sweep:**

| System | Interaction | Reason if none |
|---|---|---|
| Events | Durations untouched (C4: plausible at anchor). Relative cost shifts: a 70-day event hits a world that regrows 30× slower, so episodes cost proportionally more — accepted as realism; sim gate 3 watches cumulative teardown/overshoot | — |
| Population + migration | The change itself; `maxOutflowFraction` scaled by its own docstring rule | — |
| Unrest / regime | Unrest integration and strike thresholds untouched — strikes evolve at today's pace against slower demography; watched via striking share in gate 1 | — |
| Industry + staffing | Builds ÷10 but pop ÷30: capacity waits ~3× longer (relative) for staff. The known decay-eats-unstaffed-capacity shape — gate 3 exists for this | — |
| Infrastructure decay | Constants untouched (72-day idle grace); exposure rises via the staffing lag above — same gate | — |
| Directed logistics | none — cycle cadence and all cover/reserve constants are cycle-denominated and untouched; volumes move only with demography | ✓ |
| Directed build / planner | ROI scoring reads unmet demand ÷ route cost (`lib/engine/directed-build.ts:596-597`), not money or time — unmoved. Pool floor and centre yield scaled with the pool | — |
| Colonisation + founding | Establish ≈170 cycles; stall window rescaled; charter untouched (scales with the untouched maintenance bill, `colonisation.ts:68`); settler supply tightens emergently — owned by the colonisation-pacing row | — |
| Treasury / purse | Per-cycle flows invariant by construction; lifetime level cost ×10; founding spend/cycle ≈÷10 → richer treasuries during expansion, gate 2 records the share | — |
| Factions + relations | none — the 3-tick relations cadence and drift terms carry no rate this spec touches | ✓ |
| Save format | none — constants only, no `World` shape change; in-flight projects/foundings remain valid mid-save (work remaining absorbs at the new cap) | ✓ |
| Harness metrics | Horizon labels shift meaning (10K ticks = early era, not equilibrium); founding-lifecycle and runner-test count anchors (`runner.test.ts:152` thin-anchor row) will move; gate 4 flags the equilibrium-horizon roadmap row | — |

**4. Claims:** all carried in `## Evidence` above with horizon+cohort; the two new analytic claims —
maintenance ≈2.4% of capex/year after the change, founding spend/cycle ≈÷10 — are derived, labelled
projections until gate 2 reads them.

**5. Consumed signals exist:** growth applied in the population processor via params
(`lib/world/tick.ts:1301`); pool math at `lib/world/tick.ts:1548-1554`; construction billed as work
performed (`lib/tick/processors/treasury.ts:23-28,77-79`); maintenance from `workCostPerLevel`
(`lib/engine/treasury.ts:112`). No new signal is consumed that does not exist.

**6. Aggregates that move for other reasons:** galaxy pop growth %/year moves with founding count
and habitable-land supply, not only `growthRate` — gate 2 reads per-system realised growth on
unsaturated developed systems, cohorted, not the galaxy total alone. Teardown totals move with
event mix — gate 3 compares against the baseline run's cohort table, not zero.

### Terminal falsifier

*Provenance: committed at `a00baa76` before any instrument ran; text below unedited since. The
measure-plan falsifiers (Claims A and B, above) were committed at `480d080b`, likewise unedited.
Verdicts: both CONFIRMED (`## Evidence` → Verdict).*

**If C6 measures sustained tick throughput below 3 ticks/s at the 10,000-tick equilibrium horizon,
the 4-ticks/day anchor is dead** — a 100-year arc is 146,000 ticks at this anchor, and below
3 ticks/s that arc exceeds ~13.5 wall-clock hours at best speed, which no rate tuning can fix; a
coarser tick would be forced. (Reference: fast mode is configured at 5 ticks/s today; Victoria 3's
100-year arc is ~146K ticks — the direction claims we land in its league, ~8 wall-hours.)
