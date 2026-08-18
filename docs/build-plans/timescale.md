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

### Terminal falsifier

**If C6 measures sustained tick throughput below 3 ticks/s at the 10,000-tick equilibrium horizon,
the 4-ticks/day anchor is dead** — a 100-year arc is 146,000 ticks at this anchor, and below
3 ticks/s that arc exceeds ~13.5 wall-clock hours at best speed, which no rate tuning can fix; a
coarser tick would be forced. (Reference: fast mode is configured at 5 ticks/s today; Victoria 3's
100-year arc is ~146K ticks — the direction claims we land in its league, ~8 wall-hours.)
