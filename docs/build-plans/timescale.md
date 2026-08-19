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
            16.2, max 17 (startup) / 20 (equilibrium). The instrument counts cycle INTERVALS, so
            a 17-absorption build reads as 16 — the median sits exactly at the floor (fencepost,
            noted at spec-review). Colonies founded: 233 by t=1,000; 562 by t=10,000, 80% of
            them by t=1,704 (cadenceMarkTick).
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

### C7 — baseline health bar (added at spec-review)

```
Meaning:    The pre-change galaxy's coarse health figures, recorded so the post-change gates
            compare against numbers instead of memory.
Claim:      Baseline reference — no claim; the reading is the deliverable.
Number:     Startup (1,000t): 253 settled systems, 0 striking (0.0%), 9 cumulative teardown
            levels, 0 overshoot deaths, buildings 7,840 → 12,290.
            Equilibrium (10,000t): 581 settled, 8 striking (1.4%), 6,070 cumulative teardown
            levels (≈0.042 per standing level; 144,635 standing at end), 332 overshoot deaths,
            buildings 7,840 → 144,635.
Horizon:    Both (from the same quick run as C1-C6, seed 42, scale 100).
Cohort:     Settled systems galaxy-wide; striking = unrest ≥ 0.65 at end-of-run.
Licenses:   Supports numeric gate comparisons (gates 1 and 3). The 332 overshoot deaths prove the
            pop>popCap path IS reachable in the shipped game — which is why overshootDeathRate's
            value is a live decision, not dead tuning. Does NOT support any per-cohort teardown
            attribution (event-driven vs idle-driven not separated here).
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
about three years instead of one season. No market or pricing constant moves and the same goods
move each cycle; the construction band's money flow per cycle is held exactly constant, while
founding spend and the maintenance bill both run lower during the expansion era — factions run
richer, a stated consequence watched at the gates. The galaxy's maturation stretches by a factor
between ×10 and ×30 (which of the two limits it — building pace or growth — is the trajectory
run's question).

**Why:** The game had no calendar, so every duration was tuned by unanchored feel (## Idea). Owner
decisions encoded here: the anchor — "I think for a space game 6 hours increments are reasonable";
cycle naming — "since we already use kinda cycle for a week we could use different language";
uniformity — "there should be no differentiation between an 'existing world' and a colony, besides
the colony phase"; the three realism anchors (3%/year pop growth, ×10 build durations, ~2.8-year
founding) — "This sounds much more reasonable to me, and is the sort of time I would expect projects
like that to take and we can always tweak this later"; and the preservation constraint — "the
economy works well as is, hopefully everything just slows down and nothing breaks", which this spec
turns into the invariant that per-cycle CONSTRUCTION spend does not move; founding spend and the
maintenance bill both fall during the expansion era, so factions run richer — stated, and watched
at gate 2. Post-review decisions (2026-08-19): scale the cycle-denominated judging windows and
transfer caps with the pace (accepted as a family); keep `overshootDeathRate` at 0.05 — it fires
only above the unrest gate, so calm overcrowding just stops growing and crisis shedding stays
short and violent.

**Evidence** (pointers into ## Evidence above):
- C1: growth is ~30× the real-world anchor; seeded developed worlds are born at cap. Licenses the
  30× slowdown; does NOT separate housing-limits from the growth constant.
- C2: colony establishes complete at the absorption-cap floor (median 16 measured intervals ≈ the
  17-absorption floor for 68 work — the instrument counts cycle intervals, so a 17-absorption
  build reads as 16). Licenses the floor formula for establishes; the ordinary-build rows of the
  durations table are the floor, i.e. a **lower bound** — realised medians may sit above it and
  the gates read them per type.
- C6: ≥31 ticks/s worst segment. Licenses the anchor on wall-clock grounds; machine-relative.
- C4/C5: event lengths (~1 week–1 season) and the decay idle grace (72 days) already read as
  plausible at this anchor — licensed to stay untouched this pass.

**Not claimed:** No player-facing date display or fictional calendar names — that is its own later
slice; this spec only lands the internal anchor constant. No change to event durations, unrest
integration speed, or disaster realism: `declineRate` scales with growth (famine decline slows
×30 in real terms) while `overshootDeathRate` stays at 0.05 — deaths above the housing cap occur
only above the unrest gate and clear the excess in months, then recovery runs at the new slow
growth; the full disasters treatment is deferred to its own pass. No claim that colonisation
*frequency* is right afterwards — settler
supply tightens emergently and the colonisation-pacing row (roadmap item 2) owns that question.
No retuning of any market/pricing constant: cycle-denominated economics are untouched by design.

### The calendar

`HOURS_PER_TICK = 6` — new, emitted at `lib/constants/tick-cadence.ts` beside `CYCLE_LENGTH`
(`lib/constants/tick-cadence.ts:19`). Derived language, used in docs and rate rationales: 4
ticks/day, cycle = 24 ticks = 6 days, ≈60.9 cycles/year, 1 year ≈ 1,461 ticks. External anchor:
Victoria 3 runs 4 ticks/day. The constant is documentation-of-meaning plus a conversion helper for
future display work; no processor reads it this pass. Ownership: `HOURS_PER_TICK` anchors the tick
to in-world time; a cycle's in-world length is DERIVED as `CYCLE_LENGTH × HOURS_PER_TICK`, so
retuning `CYCLE_LENGTH` changes the length of the week, never the tick. `REFERENCE_INTERVAL`
remains the rate-calibration anchor, unrelated to the calendar. The `CYCLE_LENGTH` docstring's
"changes granularity, not wall-clock rates" (`lib/constants/tick-cadence.ts:16-18`) stops being
fully true once the calendar ships — updated in the same change.

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
| `CONSTRUCTION.PAYBACK_HORIZON` (`:43`) | 12 | 120 | *(spec-review)* the centre's amortisation horizon is a count of cycles and a cycle now buys ÷10 of a level; held at 12, centre ROI falls 2.4R → 0.24R against unscaled `workCostPerLevel` 25 (`lib/engine/construction-centre.ts:105-106`) and centres never fund |
| `CONSTRUCTION.BACKLOG_WINDOW` (`:45`) | 6 | 60 | *(spec-review)* `budget = pool × window` vs work-denominated queue depth (`construction-centre.ts:57-64`); pool ÷10 against unscaled work moves the starved frontier ÷10 — ×10 restores its authored work-depth |
| `INFRASTRUCTURE_DECAY_PARAMS.idleBufferCycles` (`lib/constants/infrastructure.ts:21`) | 12 | 120 | *(spec-review)* the grace is an absolute cycle count against a staffing clock now 30× slower; at 12, teardown (12 cycles) outruns both rebuild (20–75 cycles) and restaffing (~220 cycles for a housing-level gap) — the authored "stickier than population" hysteresis inverts. 120 cycles ≈ 2 in-world years idle before demolition |
| `MIGRATION_PARAMS.employedLeakFraction` (`lib/constants/population.ts:165`) | 0.02 | 0.0007 | *(spec-review)* the always-on staffed-worker leak (`lib/engine/migration.ts:129`) and the settler-gate supply credit (`lib/engine/directed-build.ts:1502`); preserves its ~1.3× ratio to the growth rate |
| `COLONY_DELIVERY_PARAMS.sourceOutflowCap` (`lib/constants/population.ts:180`) | 0.05 | 0.0017 | *(spec-review)* the primary colony fill flow; its docstring's "growth re-donates, keeping reinforcement sustained" breaks at 100× the new growth rate — 0.0017 preserves "well above the diffusion rate" (now 0.0003) and keeps colony fill at the boom-pace anchor |

One named code change beyond constants: the ETA forecast guard `maxCycles` 999 → 9999 in
`forecastEtaCycles` and `forecastIndependentEtaCycles` (`lib/engine/construction.ts:323,359`) — a
cycles-denominated give-up bound whose forecasts all run ~10× longer; at 999 a healthy deep-queue
project returns null, which the UI renders as "stalled" (`components/construction/construction-row.tsx:32`).

Deliberately unchanged: `workCostPerLevel` and every override (it is also the maintenance-bill base,
`lib/engine/treasury.ts:112` — moving it moves standing costs galaxy-wide);
`MAINTENANCE_RATE_PER_WORK`, `LOGISTICS_RATE_PER_WORK`; `CYCLE_LENGTH`;
`POPULATION_PARAMS.overshootDeathRate` 0.05 *(spec-review decision)* — it fires only above the
unrest gate and scales with unrest (`lib/engine/population.ts:443-473`), so calm overcrowding just
stops growing across the crowd-brake band and nobody dies; during strike-level collapse the
unhoused excess sheds in months (harsh by choice), and the resulting 100:1 death:growth asymmetry
is accepted and deferred to the disasters pass. Baseline evidence that the path is live: 332
overshoot deaths at the equilibrium horizon (C7); `FOUNDING_STOCK_COVER`, `MIN_SETTLER_SUPPLY` (a
headcount per hungry colony, not a rate; its establish-duration independence is authored at
`lib/engine/directed-build.ts:1489-1492`); charter fee constants — **with the caveat, labelled
hypothesis:** the charter tracks the live maintenance bill (`lib/constants/colonisation.ts:68`),
which tracks the standing-level census, whose in-run half this spec slows ×10; if the founding-era
bill falls, the charter drifts toward the `CHARTER_FEE_MIN` 100 cliff (~6× cheaper colonies)
exactly while treasuries run richer — gate 2 reads it; all event, unrest and market constants.

### Resulting durations (the audit table)

Build rows are the absorption-cap **floor — a lower bound** (measured at the floor only for colony
establishes, C2); realised per-type medians are a gate metric. Cycle counts are the instrument's
interval count (an N-absorption build reads N−1 — the fencepost C2 exhibits as median 16 against a
17-absorption floor).

| Thing | Today (floor) | After (floor) | Real-world reference |
|---|---|---|---|
| Housing level | 2 cycles = 12 days | 20 cycles ≈ 4 months | housing development ~1 year (kept faster: prefab fiction) |
| Extractor | 3 cycles = 18 days | 30 cycles ≈ 6 months | mine/site opening 1-3 years |
| Tier-1 factory | 5 cycles = 30 days | 50 cycles ≈ 10 months | factory construction ~1-2 years |
| Tier-2 factory | 7.5 cycles = 45 days | 75 cycles ≈ 15 months | heavy plant 2-4 years |
| Colony establish | 16 measured (17-absorption floor) ≈ 100 days | ~169 measured (170-absorption floor) ≈ 2.8 years | no analog; owner call |
| Pop growth | ≈ ×2.5/year | ≈ 3.1%/year | frontier-boom ceiling |
| Galaxy maturation | ~8 years (plateau t≈11,500) | ×10–×30 slower — projection; C1 does not separate the build-limited (×10 ≈ 79 yr) from the growth-limited (×30 ≈ 236 yr) case, and the trajectory run's slope answers it | a grand-strategy arc |

Behavioural notes, observable: build ETAs shown by `lib/services/build-options.ts:80-82` and
`lib/services/construction.ts:134-135` read the same constants, so every UI ETA moves consistently
with no separate change. Saves are constants-compatible: no `World` shape change, and an in-flight
project's `work` remaining stays valid — it simply absorbs at the new cap from the next cycle.
Mid-flight founding projects likewise continue under the new stall window.

### Verification plan (sim gates)

1. Both standard horizons pass the coarse health bar with no regression: conservation identities
   PASS, no NaN/runaway/pinning; striking share and cumulative teardown compared numerically
   against C7 (striking ≤ ~3× C7's share at the matching horizon; the tolerance is coarse by
   design — this is a health bar, not a tuning read). Note the relabel: at the new rates the
   10,000-tick horizon is early-era, not equilibrium — read it as "founding era, year 7", never
   tune demography against it.
2. A trajectory check (scratch runner, ~50K ticks ≈ 34 in-world years), instrumenting:
   - the **growth term itself** (`growthRate × pop × crowdFactor × (1 − D)`, summed per system
     per cycle, annualised) reads 3%±1/year on unsaturated developed systems — never the
     population delta, which delivery/leak/diffusion also write;
   - realised commit→complete medians per build type (housing / extractor / tier-1 / tier-2 /
     establish) against their floors — establish target ≈169 measured cycles (170-absorption
     floor), tolerance ±5;
   - foundings keep **starting**: colony-establish commits per cycle non-zero through the run,
     plus the settler-gate denial count (`lib/engine/directed-build.ts:1507`);
   - money: median charter at first founding and late-run + share of foundings paying
     `CHARTER_FEE_MIN`, vs C7's era figures; median faction balance within ~3× baseline;
   - centres: construction-centre proposals funded per faction non-zero and comparable to C7;
   - plateau: the trajectory's slope extrapolation brackets the maturation factor (×10–×30
     question in the durations table).
3. The decay gate, pass/fail: cumulative teardown levels per standing level at horizon 2 within
   ~1.5× C7's ratio (C7: 6,070 teardown / 144,635 standing ≈ 0.042 over the run), plus the
   landing-unstaffed fraction (levels landing into systems whose post-landing labourFulfil < 1)
   compared against C7, read again at the 50K run.
4. The harness's own "equilibrium" label and the roadmap row about it
   (`docs/ROADMAP.md` → "Decide the simulate equilibrium horizon") inherit this change — flagged
   there, not solved here.

Docstrings updated in the same change (the cleanup rule, not a follow-up):
`MIGRATION_PARAMS.maxOutflowFraction` (`population.ts:154`, quotes "(0.015)"),
`FOUNDING_STALL_COMPLETE_CYCLES` (`colonisation.ts:108`, the "68 ÷ 4 ⇒ ≥17" worked example), the
`CONSTRUCTION` header worked examples (`construction.ts:10-18,36-40`), the `TREASURY` header's
"construction work points are unscaled counts" (`treasury.ts:1-5` — points are fractional at cap
0.4), and `CYCLE_LENGTH`'s "changes granularity, not wall-clock rates" (`tick-cadence.ts:16-18`).

### Hazard worksheet

**1. One quantity, several unrelated jobs** (`npm run impact` outputs pasted in trimmed form):

| Quantity | Every reader today | Which this design moves | Intended? |
|---|---|---|---|
| `workCostPerLevel` | `impact`: 15 refs / 5 modules — directed-build (`lib/engine/directed-build.ts:825,1093,1103,1108,1338,569`), build-options (`lib/engine/build-options.ts:118`), construction-centre (`lib/engine/construction-centre.ts:106`), **treasury maintenance** (`lib/engine/treasury.ts:112`) | **none** | Yes — triple duty (build effort / proposal sizing / maintenance base) is exactly why the duration levers avoid it |
| `CONSTRUCTION.*` | `impact`: 16 refs / 3 modules — tick (`lib/world/tick.ts:1548-1554`), services build-options (`lib/services/build-options.ts:80-82`), services construction (`lib/services/construction.ts:134-135`), harness build-analysis (`lib/tick-harness/build-analysis.ts:881`). impact verdict: HAZARD 1 APPLIES. **Plus the param-renamed deep readers the text scan cannot see** *(spec-review)*: `lib/engine/construction.ts:95-124,183-238,319-340` (cap → build-time floor, fronts, ETA forecast) and `lib/engine/construction-centre.ts:57-64,105` (pointsPerLevel/paybackHorizon/backlogWindow → centre valuation and starved frontier) | `THROUGHPUT_PER_POP`, `PER_BUILD_ABSORPTION_CAP`, `POOL_FLOOR_BASE`, `POINTS_PER_LEVEL`, `PAYBACK_HORIZON`, `BACKLOG_WINDOW` | Yes — ratios checked individually *(spec-review corrected the blanket claim)*: fronts (pool ÷ cap) and floor share hold under ÷10; centre yield and the starved frontier do NOT hold without the ×10 on PAYBACK_HORIZON and BACKLOG_WINDOW, which is why both moved into the change table; UI ETA services read the same constants so displays move with the mechanics |
| `POPULATION_PARAMS` | `impact`: 10 refs / 4 modules — tick (`lib/world/tick.ts:1301`), UI provision-view (`components/system/provision-view.ts:122-160`, crowdBrakeEnd only), system-population service (`lib/services/system-population.ts:59,79`, crowdBrakeEnd only), simulate (`scripts/simulate.ts:363`, crowdBrakeEnd) | `growthRate`, `declineRate` only | Yes — every non-tick reader consumes `crowdBrakeEnd`, which does not move; `overshootDeathRate` stays by decision (see unchanged list) |
| `MIGRATION_PARAMS` | `impact`: tick (`lib/world/tick.ts:1390,1574`), migration-map service (`lib/services/migration-map.ts:31`, weights only). `employedLeakFraction` has TWO tick readers *(spec-review)*: the always-on leak (`lib/engine/migration.ts:129`) and the settler-gate supply credit (`lib/engine/directed-build.ts:1502` via tick.ts:1574) | `maxOutflowFraction`, `employedLeakFraction` | Yes — the service reads `weights`, untouched; both scaled flows keep their authored ratios to the growth rate |
| `COLONY_DELIVERY_PARAMS` *(spec-review addition)* | single tick reader: `delivery:` at `lib/world/tick.ts:1391` → `lib/engine/colonist-delivery.ts:51-55` (`min(idleSpare, sourceOutflowCap × population)`) | `sourceOutflowCap` | Yes — the primary colony fill flow, scaled to preserve "well above the diffusion rate"; `minSourcePopulation` (a headcount) untouched |
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
| `PAYBACK_HORIZON` *(spec-review)* | "Reference cycles of point output a centre's value is amortised over (the ROI numerator horizon)" (`construction.ts:42`) | the centre-ROI leg that must stretch with the pace — its denominator is `workCostPerLevel`, frozen | Yes, once scaled ×10; at 12 the docstring's premise (horizon ≥ the centre's own payback) inverts, 5 → 50 cycles |
| `BACKLOG_WINDOW` *(spec-review)* | "Reference cycles of pool drain that define the funding frontier — work beyond it is starved" (`construction.ts:44`) | the frontier's pool leg; compared against unscaled work | Yes, once scaled ×10 — at 6 the frontier sits at one tenth its authored work-depth |
| `idleBufferCycles` *(spec-review)* | "a level must sit idle this many runs before the marginal idle level tears down … deliberately long enough to absorb temporary labour and market shocks … the hysteresis that keeps infrastructure stickier than population" (`infrastructure.ts:7-18`) | the demolition grace, measured against a staffing clock now 30× slower | Yes, once scaled ×10 — at 12 the labour-shock half of its authored meaning inverts (grace 12 vs restaffing ~220 cycles) |
| `sourceOutflowCap` *(spec-review)* | "sits well above the diffusion rate (colony delivery IS the flow) … growth re-donates, keeping reinforcement sustained" (`population.ts:168-180`) | the primary colony fill rate | Yes, once scaled — at 0.05 "growth re-donates" breaks (100× the new growth rate turns sustained reinforcement into a one-time dump) |
| `employedLeakFraction` *(spec-review)* | "Small always-on leak of staffed workers toward strongly-attractive colonies — the pop pump that lets colonisation proceed once home worlds saturate" (`population.ts:162-165`) | a per-cycle staffed-worker fraction, and the settler gate's supply proxy | Yes, once scaled — 1.3× → 40× growth otherwise, decalibrating the anti-sprawl gate it feeds |

**3. Systems sweep:**

| System | Interaction | Reason if none |
|---|---|---|
| Events | Durations untouched (C4: plausible at anchor). *(spec-review corrected this row's reasoning)*: every event effect is a multiplier or one-shot shock (`lib/constants/events.ts:30-46`, capped at `:99-108`) — none is an absolute per-tick rate the slowdown magnifies, and episode population cost is unchanged in relative terms because `declineRate` scales with growth (`lib/engine/population.ts:468`). The channel that genuinely shifts is infrastructure: teardown above unrest 0.75 stays at 1 level/type/cycle (`lib/engine/infrastructure-decay.ts:149-179`) while a level's replacement becomes ×10 slower and ×10 dearer — a ~10× rise in the real cost of an unrest episode, **accepted as realism** (owner call at review) | — |
| Population + migration | The change itself; `maxOutflowFraction` scaled by its own docstring rule | — |
| Unrest / regime | Unrest integration and strike thresholds untouched — strikes evolve at today's pace against slower demography; watched via striking share in gate 1 | — |
| Industry + staffing | *(spec-review sharpened)*: the concrete mechanism is directed-build's proposal-time labour gate (`lib/engine/directed-build.ts:1047-1053`) — a build staffable at commit could be drained by colonist delivery over the now-10×-longer window while regrowth (÷30) can't replace it, landing levels unstaffable. Mitigated by scaling `sourceOutflowCap` (change table); gate metric added: fraction of levels landing into systems with post-landing labourFulfil < 1, vs C7 | — |
| Infrastructure decay | `idleBufferCycles` scales 12 → 120 (change table) — at 12 the ordering inverts: teardown grace (12 cycles) < rebuild (20–75) < restaffing (~220 for a housing-level pop gap vs ~7 today), so the authored hysteresis becomes a churn loop. Gate 3 is now pass/fail against C7 | — |
| Directed logistics | none — cycle cadence and all cover/reserve constants are cycle-denominated and untouched; volumes move only with demography | ✓ |
| Directed build / planner | ROI scoring reads unmet demand ÷ route cost (`lib/engine/directed-build.ts:596-597`), not money or time — unmoved. Pool floor and centre yield scaled with the pool | — |
| Colonisation + founding | Establish ≈170 cycles; stall window rescaled; charter constants untouched but the fee tracks the live maintenance bill — **hypothesis** that it holds near today's level (see unchanged list; gate 2 reads the median charter and the `CHARTER_FEE_MIN` share); settler supply tightens emergently and the settler gate's credit is rescaled with `employedLeakFraction` — frequency owned by the colonisation-pacing row, and gate 2 checks foundings keep starting | — |
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
unsaturated developed systems, cohorted, not the galaxy total alone. *(spec-review third confound)*:
a developed system's population **delta** also moves with diffusion outflow, the employed leak and
colonist-delivery donation (`lib/engine/migration.ts:118,129`; `lib/engine/colonist-delivery.ts:54`)
— so gate 2 instruments the growth term itself (`growthRate × pop × crowdFactor × (1 − D)`,
`lib/engine/population.ts:467`), never the delta. Teardown totals move with event mix — gate 3
compares against C7's baseline figures, not zero.

### Terminal falsifier

*Provenance: committed at `a00baa76` before any instrument ran; text below unedited since. The
measure-plan falsifiers (Claims A and B, above) were committed at `480d080b`, likewise unedited.
Verdicts: both CONFIRMED (`## Evidence` → Verdict).*

**If C6 measures sustained tick throughput below 3 ticks/s at the 10,000-tick equilibrium horizon,
the 4-ticks/day anchor is dead** — a 100-year arc is 146,000 ticks at this anchor, and below
3 ticks/s that arc exceeds ~13.5 wall-clock hours at best speed, which no rate tuning can fix; a
coarser tick would be forced. (Reference: fast mode is configured at 5 ticks/s today; Victoria 3's
100-year arc is ~146K ticks — the direction claims we land in its league, ~8 wall-hours.)
