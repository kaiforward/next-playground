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

### Terminal falsifier

**If C6 measures sustained tick throughput below 3 ticks/s at the 10,000-tick equilibrium horizon,
the 4-ticks/day anchor is dead** — a 100-year arc is 146,000 ticks at this anchor, and below
3 ticks/s that arc exceeds ~13.5 wall-clock hours at best speed, which no rate tuning can fix; a
coarser tick would be forced. (Reference: fast mode is configured at 5 ticks/s today; Victoria 3's
100-year arc is ~146K ticks — the direction claims we land in its league, ~8 wall-hours.)
