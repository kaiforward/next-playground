# Colonisation economics — founding-economics baseline (roadmap row 10)

Working file for the row-10 `/measure` baseline. Row: founding stops being free — claims, establish
projects and founding manifests carry real monetary and goods cost, and the AI founding policy prices
colonies against its treasury. Before any design exists, this file pins what founding actually costs
and paces **today**, so the cost model is authored against measured scales, not intuition.

Transient like any build plan: deleted when row 10 ships, durable readings carried into the active
docs or `killed-designs`.

## Re-grounded aim (settled 2026-08-05, Kai)

Colonisation becomes a **priced strategic decision** competing for the same treasury and goods as
everything else; pacing emerges from the cost, never from an authored rate. The original
leech-colony motivation is falsified (C5) — the trivialisation problem is the absence of tradeoff,
not the speed. Costs are derived from physical quantities (manifest bought at market prices,
establish work billed at real rates, a charter fee scaled to cycle spend) rather than flat
constants, so the later drains on the same treasury — priced logistics, military, industry pricing
(leaning: lands with the warehouse/storage row) — rescale them without retuning. Values stay coarse
until those sibling mechanics ship. Bite anchor from C3: founding-era spend is ~600/cycle per
faction against a ~5,600 median balance; a price at cycle-of-spend scale is where founding starts
sequencing against construction.

## Claims and falsifiers

Written and committed before any instrument runs. Each claim is about current behaviour; each
falsifier is in the units and at the horizon the measurement will use.

### C1 — Founding cadence: everything founds early

**Claim:** The AI founding policy founds essentially every system it will ever found early in a run —
the large majority (>80%) of colonies ever founded by t=10,000 already exist by t≈500–1000, and the
equilibrium founding rate is near zero because the galaxy is saturated, not because founding is gated
by anything scarce.

**Falsifier:** If >20% of a run's total foundings happen after t=2,000, or the cumulative founding
curve is still climbing materially at equilibrium, founding pacing already has structure and the
row's "founds essentially everything by ~t500" premise is wrong — the cost model would then be
reshaping an existing pacing mechanism, not creating one.

### C2 — Monetary cost: founding debits nothing

**Claim:** Founding a colony debits no treasury account. No claims charge, no establish-project
charge, no manifest purchase — the manifest is goods moved from founder stock
(`directed-build.ts` folds `stockManifest` into stock; the tonnage is tracked "for the calibration
harness only"). The only treasury-adjacent founding cost is work billed through the logistics /
construction bands, which founding barely moves.

**Falsifier:** Any code path that debits a `WorldFactionTreasury` balance on claim, establish or
founding, found by the impact/code sweep — or a treasury settlement line that moves with founding
events at the startup horizon. Either kills "monetarily free" and the design starts from re-pricing
an existing charge instead of introducing one.

### C3 — Treasury headroom: any plausible price would not bind

**Claim:** During the founding era (t ≤ 1,000), faction treasuries run a structural surplus — median
faction balance is positive, growing, and equivalent to multiple cycles of that faction's total
per-cycle spend (maintenance + logistics + construction), and the funding ladder latches at or near
1.0 (no band runs short). Consequence if true: a per-colony price must be authored at a deliberate
scale (a meaningful fraction of a cycle's spend or more) to bind at all; a token price changes no
founding decision.

**Falsifier:** If founding-era treasuries sit near zero, or any settlement band latches materially
below 1.0 for the median faction, treasuries are already tight and *any* colony price bites
immediately — the design question becomes sequencing against existing bills, not authoring a price
big enough to notice.

### C4 — The founder's goods cost is transient (the `founderCoverAfter` question)

**Claim:** The measured ~0.29–0.30× median founder cover after seeding a manifest (562/562 real
samples, post-fix — see `honest-demand-thread` memory) is a transient depression: founder markets
recover to their role-cohort norm within the startup transient (~300+ cycles) and show no lasting
depression vs cohort at equilibrium.

**Falsifier:** If founder markets remain measurably below their role-cohort norm at equilibrium
(10k; 12k for high-tier goods per the stage-3 gate convention), founding already carries a lasting
*physical* cost today — the row's premise sharpens from "founding is free" to "founding is
monetarily free but physically costly", and the cost model must price against that, not on top of it
as if it were zero.

### C5 — Leech-colony baseline: the pattern row 10 exists to fix

**Claim:** A material share (>25%) of colonies founded in-run land in the struck / served-last
cohort and are still there at equilibrium — the leech-colony pattern (#212's documented cost,
`economy-autonomic-agency.md`) that "fewer, deliberate colonies" is meant to fix structurally.

**Falsifier:** If in-run colonies are mostly healthy at equilibrium (struck share ≤10%, in line with
seeded worlds), the leech-colony motivation is weaker than assumed and the row's aim needs
re-justifying before a cost model is designed around it.

### A1 — The everything-free audit (sweep, not a number)

Enumerate every founding-adjacent resource flow and record whether it is priced, budgeted, or
physically bound today: claims, establish projects, founding manifests, the logistics work budget,
the per-pop construction pool base. Already measured, cite don't re-measure: the haul budget never
binds (~6–8% spent, 2026-08-04) — pricing it changes no flow unless deliberately authored to bind.

## Instruments

- C1, C4, C5 — `npm run simulate`, both horizons, cohorted (foundingStock covers the in-run colony
  cohort; founder recovery read against role cohort). Founding timeline per cycle may need a scratch
  diag in `.superpowers/` — validate its count against the harness's own founded-colonies figure.
- C2, A1 — code sweep + `npm run impact` on the treasury write path and founding path. No sim needed
  unless a charge is found.
- C3 — harness treasury reporting if it exists; else a scratch diag reading `WorldTreasurySettlement`
  per cycle, validated against the bands' latched funding fractions as the independent signal.

## Evidence

Conditions common to every reading below: `npm run simulate` quick run, seed 42, 600 systems,
`ECONOMY_SCALE=100`, `CYCLE_LENGTH` 24. The scratch diagnostic (`.superpowers/row10-diag.ts`,
gitignored) drives the same `runWorldTick` from the same `generateWorld(seed 42, 600)` for 12,000
ticks with checkpoints at t=1000 / 10000 / 12000; determinism (`tickRng(seed, tick)`) makes a
checkpoint at t=N identical to a separate N-tick run's endpoint, which is why one run serves all
three horizons. **No hook was patched into `lib/`** — founding manifests already ride
`runWorldTick().instrumentation.foundingManifests`, and treasuries/unrest are world state.

### C2 — Monetary cost: founding debits nothing

```
Meaning:    Founding a colony moves people and goods out of the founder's own stores and consumes
            construction throughput, but it never charges a faction account; the only money in the
            loop is the generic construction band's bill on work performed, which is fully funded.
Claim:      Founding a colony debits no treasury account — no claim charge, no establish-project
            charge, no manifest purchase.
Number:     0 code paths debit WorldFactionTreasury.balance on claim, establish or founding.
            `npm run impact -- balance` finds exactly two writers of that field in the whole
            simulation: lib/tick/processors/treasury.ts:148 (the per-cycle settlement) and
            lib/world/gen.ts:209 (world-gen init, 0). Neither is reachable from the claim,
            establish or manifest path. The colonisation modules contain zero money references:
            grep for treasury|money|credits|balance|cost|price over lib/engine/expansion.ts and
            lib/engine/colonisation-value.ts returns 1 hit, a doc-link comment.
Horizon:    n/a — code sweep, not a sim reading. Cross-checked against the settlement lines at both
            horizons: no band moves with founding (see C3's raw rows; `funded` is 100/100/100 at
            t=1000 with 324 colonies founded and at t=10000 with 562).
Cohort:     the whole faction roster (20 treasuries); all claim/establish/founding code paths.
Licenses:   Supports "no per-colony monetary price exists today". Does NOT support "money is
            irrelevant to founding" — money gates founding INDIRECTLY through one channel:
            `funded.construction` scales the physical construction pool
            (lib/world/tick.ts:1084-1085 → lib/tick/processors/directed-build.ts:250-251), and the
            establish project's absorbed work is billed back through the construction band
            (lib/tick/processors/directed-build.ts:363 → lib/world/tick.ts:1098 →
            lib/tick/processors/treasury.ts:124). That channel is real but never binds today
            (funded.construction = 1.000, see C3). Also does NOT support "founding is costless" —
            see C4/C5 for the physical costs.
```

**Raw — `npm run impact -- balance` (verbatim):**

```
TICK RIPPLE — processors that READ it via their World interface
  none — no processor reads this through its declared interface.

TICK SIMULATION — 11 references in 4 modules (+17 in tests) (+18 in comments, not counted)
  treasury                       6×  lib/engine/treasury.ts
      :41    balance: number;
      :104   balance: number,
      :109   let available = safe(balance) + safe(income);
      :121   return { balance: available, paid, funded };
      :132   const settled = settleLadder(t.balance, income, bills, t.bands);
      :148   balance: settled.balance,
  directed-build                 3×  lib/tick/processors/directed-build.ts
      :99    balance: Map<string, number>,
      :113   const remaining = balance.get(key)
      :117   balance.set(key, remaining - quantity);
  gen                            1×  lib/world/gen.ts
      :209   balance: 0,
  world/types                    1×  lib/world/types.ts
      :352   balance: number;
```

The three `directed-build` hits are a **goods** balance, not money: `planFoundingStock`'s per-cycle
running stock balance per (source system, good) (lib/tick/processors/directed-build.ts:96-121).

**Outcome: CONFIRMED.** The falsifier asked for any code path debiting a `WorldFactionTreasury`
balance on claim, establish or founding, or a settlement line that moves with founding events at
the startup horizon. Neither exists.

### A1 — The everything-free audit

Every founding-adjacent resource flow, and what actually constrains it today.

| # | Flow | Priced? | Budgeted / bound by | Where |
|---|---|---|---|---|
| 1 | **Claim** (unclaimed → `controlled`) | **Free** — no money, no work, no goods, no pop | Rate cap only: `MAX_CLAIMS_PER_CYCLE = 1` per faction per cycle, `REACH_JUMPS = 3`, `SCORE_FLOOR = 0.001` (permissive — excludes only zero-substrate rocks) | `lib/constants/expansion.ts:17-25`; `lib/engine/expansion.ts` (`proposeFactionClaims`/`resolveClaims`); applied `lib/tick/processors/directed-build.ts:180-188` → `lib/world/tick.ts:439` |
| 2 | **Establish project work** | **Not priced per colony**; billed generically | Physically budgeted out of the faction construction pool, ROI-ordered against ordinary builds. `establishWork = COLONY_ESTABLISH_WORK (60) + housingLevels × workCostPerLevel(housing) (8)` ⇒ **68 work** for the shipped 1-level seed | `lib/constants/colonisation.ts:15`; `lib/engine/directed-build.ts:1064`; committed `lib/tick/processors/directed-build.ts:341-352`, funded `:359-362` |
| 3 | **Establish work → money** | **Billed, indirectly** — the only treasury-adjacent founding flow | `absorbed` work → `pendingWork.construction` → `constructionBill = pendingConstruction × constructionRatePerWork`. Not per-colony: the colony's 68 points are indistinguishable in the band from any build's. Never binds (`funded.construction` 1.000, C3) | `lib/tick/processors/directed-build.ts:363` → `lib/world/tick.ts:1098` → `lib/tick/processors/treasury.ts:120-124, 132` |
| 4 | **Anti-sprawl settler gate** | **Free** | Physically bound by labour: `budget = floor(releasable / MIN_SETTLER_SUPPLY(5)) − hungryColonies` caps new establishes per faction per cycle | `lib/constants/colonisation.ts:42`; `lib/engine/directed-build.ts:1149-1164` |
| 5 | **Seed population** (`COLONY_SEED_POP = 2`) | **Free** | Physically bound and **conserved**: `min(seedPop, source spare)`, drawn down across the cycle so two colonies from one source share a shrinking pile. Its opportunity cost is netted into the colony's *value* (`SEED_POP_COST_WEIGHT`), which is a ranking term, not a charge | `lib/constants/expansion.ts:32`, `lib/constants/colonisation.ts:34`; `lib/world/tick.ts:460-494` (esp. 471-475) |
| 6 | **Bundled seed housing** | **Work-priced inside #2, then materialised free** | `housingLevels × 8` work is inside `establishWork`; at completion the levels are granted directly, with no build project and no separate charge | `lib/engine/directed-build.ts:1055-1073`; granted `lib/world/tick.ts:483-491` |
| 7 | **Founding manifest (goods)** | **Free of money** | Physically bound twice: want = `FOUNDING_STOCK_COVER (30) × consumptionRate` at the seed pop, capped by the founder's own `surplusDrawable` (its export reserve) and by a per-cycle running balance per (source, good). Tonnage is tracked "for the calibration harness only" | `lib/constants/colonisation.ts:64`; `lib/tick/processors/directed-build.ts:96-121, 413-422`; applied `lib/world/tick.ts:549+` |
| 8 | **New colony's market rows** | **Free** | Created EMPTY — the manifest is the first stock the system ever holds | `lib/world/tick.ts:505-548` |
| 9 | **Logistics haul budget** (the colony's later imports) | **Money-derived budget exists** | Scaled by `funded.logistics`; **never binds today**. Already measured (2026-08-04): ~6-8% of budget spent, never binding. Today's report reads `Budget spent frac` 0.010 (startup) / 0.016 (equilibrium) and `Funding-bound events` 0 / `Funding-bound set rate` 0.000 at BOTH horizons. See the instrument note below | `lib/world/tick.ts:947-948`; raw rows under C3 |
| 10 | **Per-pop construction pool base** | **Money-scaled, never binding** | `factionConstructionPool` (eligible heads × `THROUGHPUT_PER_POP` + centre output) × `catchUp` × `funded.construction`. Pool reads 5.2K (t=1000) / 58.2K (t=10000) per cycle against a 68-work colony | `lib/tick/processors/directed-build.ts:240-251`; raw rows under C1 |
| 11 | **Young-colony pool floor** | **A subsidy, not a cost** | `developmentFloorShare` reserves pool ahead of the ROI order for low-development systems | `lib/tick/processors/directed-build.ts:290-299` |
| 12 | **Migration into the colony** | **Free** | No money coupling at all — grep for treasury/funded/money/cost over `lib/tick/processors/migration.ts`, `lib/engine/migration.ts`, `lib/engine/colonist-delivery.ts` returns one prose comment | — |

**Instrument note on #9:** the cited ~6-8% and today's 1.0%/1.6% are the same metric read either
side of the stage-2 review fix — `budgetSpentFrac` now accrues only from `LOGISTICS_WARMUP_TICKS`
(honest-demand-thread memory). The *never binds* half is what A1 leans on, and that is independently
confirmed by `Funding-bound events 0` at both horizons, which is a count, not a share.

**Summary:** of twelve founding-adjacent flows, **zero carry a per-colony price**. Three (#3, #9,
#10) touch money at all, all three generically and none binding. The real constraints on founding
today are physical and all sit in the construction/labour layer: a 1-per-cycle claim rate, 68 work
points against a 5.2K-58.2K pool, a settler-supply gate, and a conserved 2-pop seed.

### C1 — Founding cadence: everything founds early

```
Meaning:    Founding is a one-off burst that runs itself out early and then stops completely —
            the galaxy fills up and stays filled, so there is no ongoing founding rate at all for a
            cost model to modulate. But the burst is slower and longer than the claim assumed: it
            takes about three times as long as "by t≈500-1000" to place four fifths of the colonies.
Claim:      The AI founding policy founds essentially every system it will ever found early in a
            run, and the equilibrium founding rate is near zero because the galaxy is saturated.
Number:     7.8% of foundings (44 of 562) happen after t=2,000 — under the falsifier's 20% bar.
            The cumulative curve is dead flat from t=3,696: last founding at t=3,696, ZERO
            foundings in the final 8,300 ticks. Saturation is real: 562 colonies + 20 homeworlds =
            582 of 600 systems developed.
            CORRECTION to the claim's own timing figure: only 8.9% exist by t=500 and 57.7% by
            t=1,000 — the >80% mark falls at ~t=1,500 (87.4%), not "t≈500-1000".
Horizon:    startup (1000t) AND equilibrium (10,000t), plus 12,000t — one deterministic 12,000-tick
            run with checkpoints; the founding count at each checkpoint reproduces the harness's own
            two-horizon figures exactly.
Cohort:     all in-run foundings (a system that becomes `developed` after t=0 — the harness's own
            rule). At this seed that is the entire non-homeworld population: world-gen seeds 20
            homeworlds and ZERO colonies.
Licenses:   Supports "there is no equilibrium founding rate to price" and "a cost model would be
            reshaping a startup burst, not an ongoing flow". Does NOT support "founding is unpaced"
            — the burst has real internal structure (nothing at all before t=432, then a 1,500-tick
            ramp), so a cost model lands on an existing pacing mechanism. Does NOT license the
            claim's "by t≈500-1000" figure, which is wrong by ~500-1,000 ticks.
```

**Raw — scratch diag, 12,000 ticks, seed 42 (verbatim):**

```
total foundings over 12000 ticks: 562
  cumulative @ t=  250:    0  (0.0% of run total)
  cumulative @ t=  500:   50  (8.9% of run total)
  cumulative @ t= 1000:  324  (57.7% of run total)
  cumulative @ t= 1500:  491  (87.4% of run total)
  cumulative @ t= 2000:  518  (92.2% of run total)
  cumulative @ t= 3000:  553  (98.4% of run total)
  cumulative @ t= 4000:  562  (100.0% of run total)
  cumulative @ t=10000:  562  (100.0% of run total)
  cumulative @ t=12000:  562  (100.0% of run total)
  share founded AFTER t=2000: 44 / 562 = 7.8%
  share founded by t=1000:    324 / 562 = 57.7%
  first founding t=432, last founding t=3696
  foundings in the last 2000 ticks: 0
  per-1000-tick buckets:
    t     1- 1000:  324 ############################################################
    t  1001- 2000:  194 ############################################################
    t  2001- 3000:   35 ###################################
    t  3001- 4000:    9 #########
    t  4001- 5000:    0
    …  (every bucket to t=12000 reads 0)
  VALIDATE (vs harness "Founding stock: N colonies founded"): t=1000 → 324, t=10000 → 562
```

**Raw — `npm run simulate`, the harness's own founding counts (verbatim):**

```
STARTUP — 1000 ticks (41 cycles), 600 systems, seed 42, economy scale 100
Colonisation & Build Loop (end of simulation):
Metric                         |    Homeworld |       Colony
-------------------------------+--------------+-------------
Developed systems              |           20 |          324
Founding stock: 324 colonies founded (312 reached a first assessment)
Construction pool: base 5.2K + centres 5 (0.1% centre) | centres built 1, in flight 2
  queue: 9.9K work remaining ≈ 1.9 cycles at current pool

EQUILIBRIUM — 10000 ticks (416 cycles), 600 systems, seed 42, economy scale 100
Colonisation & Build Loop (end of simulation):
Metric                         |    Homeworld |       Colony
-------------------------------+--------------+-------------
Developed systems              |           20 |          562
Founding stock: 562 colonies founded (562 reached a first assessment)
Construction pool: base 58.2K + centres 15 (0.0% centre) | centres built 3, in flight 0
  queue: 5.4K work remaining ≈ 0.1 cycles at current pool
```

**Outcome: CONFIRMED** — against the committed falsifier, which asked for >20% of foundings after
t=2,000 (actual 7.8%) or a curve still climbing materially at equilibrium (actual: flat since
t=3,696, zero foundings across the final 8,300 ticks). Neither limb trips. **Recorded correction:**
the claim's own ">80% by t≈500-1000" prose is false — the 80% mark is at ~t=1,500. The falsifier is
the committed test and it holds; the prose figure does not, and nothing downstream should quote it.

### C3 — Treasury headroom: any plausible price would not bind

```
Meaning:    Faction treasuries are not a constraint on anything during the founding era and are
            wildly unconstraining after it — money piles up faster than the bills can spend it, and
            every budget band is paid in full. A colony price small enough to feel reasonable would
            be invisible.
Claim:      During the founding era faction treasuries run a structural surplus equivalent to
            multiple cycles of the faction's total per-cycle spend, and the funding ladder latches
            at or near 1.0.
Number:     Founding era (t ≤ 1,000): median faction balance 5,592 against a per-faction per-cycle
            total spend of 598 — HEADROOM 9.35× cycles, and growing 587 → 12,026 across the era.
            Median latched funding 1.000 / 1.000 / 1.000 (maintenance / logistics / construction).
            Equilibrium: 487× (t 9,001-10,000) and 759× (t 11,001-12,000) cycles of spend, median
            funding still 1.000 / 1.000 / 1.000, zero shorted faction-cycles.
            The one caveat: 16 of 820 founding-era faction-cycles (1.95%) shorted a band, with
            construction funding dipping as low as 0.070 in a single early cycle (first at t=120).
            That is a startup-transient tail, not the median — the median never leaves 1.000.
Horizon:    startup (1000t) AND equilibrium (10,000t, re-read at 12,000t). Both needed: the
            equilibrium balance is ~390× the founding-era one, so an equilibrium read alone would
            wildly overstate founding-era headroom, and a founding-era read alone would miss that
            the surplus compounds rather than plateaus.
Cohort:     the whole 20-faction roster, per settlement cycle (41-42 cycles per window).
Licenses:   Supports "a token per-colony price changes no founding decision" and "the price must be
            authored at the scale of a meaningful fraction of a cycle's spend to bind at all".
            Does NOT support "money never binds anything" — the founding-era tail DOES short
            construction (min funded 0.070 at t=120), so a price loaded onto the construction band
            in the first ~5 cycles would land on a band that is already occasionally short. Does
            NOT license any equilibrium-scaled price: 487× headroom at t=10,000 says nothing about
            the founding era where the decision actually happens.
```

**Raw — scratch diag, per-cycle `WorldTreasurySettlement` (verbatim):**

```
  FOUNDING ERA (t 1-1000, 41 cycles, 20 factions)
    median faction balance:            5592.3
    median per-cycle spend (roster):   11957.2  → per faction 597.9
    median per-cycle BILL (roster):    12115.2
    HEADROOM = balance ÷ per-faction per-cycle spend: 9.35× cycles
    per-cycle spend by band (roster median): maint 1831.1 | logi 493.3 | constr 9434.6
    per-cycle bill by band  (roster median): maint 1831.1 | logi 493.3 | constr 9464.3
    latched funded fraction (median over faction-cycles): maint 1.000 | logi 1.000 | constr 1.000
    min funded fraction seen in window:  maint 1.000 | logi 1.000 | constr 0.070
    faction-cycles with ANY band shorted: 16 of 820
    balance trajectory: first cycle 587.4 → last cycle 12025.8
  EQUILIBRIUM (9000-10000) (t 9001-10000, 41 cycles, 20 factions)
    median faction balance:            1951345.8
    median per-cycle spend (roster):   80076.9  → per faction 4003.8
    HEADROOM = balance ÷ per-faction per-cycle spend: 487.37× cycles
    per-cycle spend by band (roster median): maint 28349.4 | logi 44576.6 | constr 8188.0
    latched funded fraction (median over faction-cycles): maint 1.000 | logi 1.000 | constr 1.000
    min funded fraction seen in window:  maint 1.000 | logi 1.000 | constr 1.000
    faction-cycles with ANY band shorted: 0 of 820
    balance trajectory: first cycle 1693937.0 → last cycle 2190343.8
  EQUILIBRIUM (11000-12000) (t 11001-12000, 42 cycles, 20 factions)
    median faction balance:            3011095.9
    median per-cycle spend (roster):   79372.6  → per faction 3968.6
    HEADROOM = balance ÷ per-faction per-cycle spend: 758.72× cycles
    per-cycle spend by band (roster median): maint 29363.1 | logi 46818.1 | constr 3192.0
    latched funded fraction (median over faction-cycles): maint 1.000 | logi 1.000 | constr 1.000
    min funded fraction seen in window:  maint 1.000 | logi 1.000 | constr 1.000
    faction-cycles with ANY band shorted: 0 of 840
    balance trajectory: first cycle 2700625.4 → last cycle 3253940.7
  first cycle with any faction shorted: t=120 (1 factions)
  VALIDATE (vs harness "Treasury:" line) t=1000: mean balance 13195.6, median 12025.8, funded maint 100% / logi 100% / constr 100%
  VALIDATE (vs harness "Treasury:" line) t=10000: mean balance 2191571.1, median 2190343.8, funded maint 100% / logi 100% / constr 100%
  VALIDATE (vs harness "Treasury:" line) t=12000: mean balance 3215759.4, median 3253940.7, funded maint 100% / logi 100% / constr 100%
```

**Raw — `npm run simulate` treasury + haul-budget rows (verbatim), both horizons:**

```
STARTUP — 1000 ticks (41 cycles), 600 systems, seed 42, economy scale 100
Treasury (end of simulation):
Treasury: 20 factions | balance mean 13.2K (min 1.4K, max 28.6K) | income 10% heads / 90% production
  funded: maint 100% | logi 100% | constr 100% | first shortfall t=150
Logistics Activity (whole run):
Budget spent frac        |            0.010
Funding-bound events     |                0
Funding-bound set rate   |            0.000

EQUILIBRIUM — 10000 ticks (416 cycles), 600 systems, seed 42, economy scale 100
Treasury (end of simulation):
Treasury: 20 factions | balance mean 2.2M (min 1.2M, max 3.3M) | income 10% heads / 90% production
  funded: maint 100% | logi 100% | constr 100% | first shortfall t=150
Logistics Activity (whole run):
Budget spent frac        |            0.016
Funding-bound events     |                0
Funding-bound set rate   |            0.000
```

(The harness reports `first shortfall t=150` because it samples at `SNAPSHOT_INTERVAL`; the
per-cycle diag catches the true first at t=120. Same event, finer sampling.)

**Outcome: CONFIRMED.** The falsifier asked for founding-era treasuries near zero (actual: 9.35×
cycles of spend, compounding) or a band latching materially below 1.0 for the median faction
(actual: median 1.000 in every band in every window). Neither trips.

### C4 — The founder's goods cost is transient

```
Meaning:    A world that ships a founding manifest is not left worse off than comparable worlds.
            Measured against markets playing the same role for the same good, founder markets sit
            exactly at the norm — at every horizon, including immediately after the founding burst.
            The low reading taken at the moment of seeding is a different quantity, not a lasting
            wound.
Claim:      The ~0.29-0.30× median founder cover after seeding is a transient depression; founder
            markets recover to their role-cohort norm and show no lasting depression at equilibrium.
Number:     Median ratio (founder market cover ÷ its own good+role cohort median cover):
            1.01× at t=1,000, 1.01× at t=10,000, 1.00× at t=12,000. Founder markets are
            indistinguishable from their cohort at every horizon measured.
            The seeding reading reproduces exactly: median founderCoverAfter 0.29× through t=1,000
            (n=306) and 0.31× through t=10,000 (n=532), matching the harness's own 0.29× / 0.31×.
            Founder markets' donor-floor cover — the same denominator the seeding read uses — runs
            0.38× (t=1,000) → 0.64× (t=10,000) → 0.80× (t=12,000).
Horizon:    startup (1000t) AND equilibrium (10,000t), re-read at 12,000t per the stage-3 high-tier
            convention. The 12k read matters: founder role-cover is still climbing between 10k and
            12k (0.63 → 0.80 absolute), so 10k alone would be a mid-recovery sample — but the RATIO
            to cohort is flat (1.01 → 1.00) across exactly that stretch, because the cohort is
            climbing with it.
Cohort:     the 806-809 (systemId|goodId) markets that have ever sourced a founding manifest, each
            compared against the median cover of its OWN good × role partition (exporter /
            self-supplier / consumer), never the galaxy median.
Licenses:   Supports "founding leaves no lasting physical mark on the founder, measured against
            comparable markets". Does NOT support "the 0.29× reading was an artefact" — it is a
            real reading of a real quantity, and it is in a DIFFERENT unit (stock ÷ donorReserve,
            minimum across the manifest) from the role-cover ratio (stock ÷ targetStock, median
            across markets); the two must not be quoted as a before/after pair.
            One structural caveat, and it is why the equilibrium read is the load-bearing one: at
            t=1,000 founder markets are 575 of the 1,173-market exporter cohort (49%), so the
            startup ratio is close to self-comparison. At t=10,000 they are 530 of 5,835 exporters
            (9.1%) and 254 of 3,571 self-suppliers (7.1%) — a genuine comparison against a cohort
            they do not dominate. Read the equilibrium ratio, not the startup one.
```

**Raw — scratch diag (verbatim):**

```
manifests recorded: 532 (532 with a measurable binding cover)
  AT SEEDING — median founderCoverAfter (stock ÷ donorReserve, binding good):
    through t= 1000: 0.29×  (n=306)
    through t=10000: 0.31×  (n=532)
    through t=12000: 0.31×  (n=532)
  VALIDATE (vs harness "median founder cover after"): through t=1000 → 0.29×, through t=10000 → 0.31×
  VALIDATE (vs harness "mean manifest ... t/colony"): t=1000 → 145 t/colony over 324 founded

  LATER — the same founder markets, measured against their own good+role cohort:
    t= 1000: n= 618 founder markets | median founder role-cover 0.38 | median of their cohort medians 0.39 | median RATIO founder÷cohort 1.01× | below cohort: 35.8%
        role consumer       n=   4 median ratio 1.49×
        role exporter       n= 575 median ratio 1.01×
        role self-supplier  n=  39 median ratio 1.00×
        donor-floor cover of founder markets (same unit as seeding read): median 0.38× (n=618)
    t=10000: n= 806 founder markets | median founder role-cover 0.63 | median of their cohort medians 0.82 | median RATIO founder÷cohort 1.01× | below cohort: 38.5%
        role consumer       n=  22 median ratio 1.56×
        role exporter       n= 530 median ratio 1.01×
        role self-supplier  n= 254 median ratio 1.00×
        donor-floor cover of founder markets (same unit as seeding read): median 0.64× (n=809)
    t=12000: n= 807 founder markets | median founder role-cover 0.80 | median of their cohort medians 0.92 | median RATIO founder÷cohort 1.00× | below cohort: 51.1%
        role consumer       n=  21 median ratio 1.45×
        role exporter       n= 495 median ratio 0.99×
        role self-supplier  n= 291 median ratio 1.00×
        donor-floor cover of founder markets (same unit as seeding read): median 0.80× (n=809)
```

**Raw — the harness's own founder-cost rows (verbatim), both horizons:**

```
STARTUP — 1000 ticks (41 cycles), 600 systems, seed 42, economy scale 100
Founding stock: 324 colonies founded (312 reached a first assessment)
  opening satisfaction (demand-weighted): mean 0.55, dissatisfaction 0.262 | opened deprived (<0.50): 143
  cost to founders: mean manifest 145 t/colony | median founder cover after (binding good) 0.29×

EQUILIBRIUM — 10000 ticks (416 cycles), 600 systems, seed 42, economy scale 100
Founding stock: 562 colonies founded (562 reached a first assessment)
  opening satisfaction (demand-weighted): mean 0.43, dissatisfaction 0.353 | opened deprived (<0.50): 385
  cost to founders: mean manifest 112 t/colony | median founder cover after (binding good) 0.31×

  (cohort membership the ratios are measured against)
  startup:      membership: exporter 1173, self-supplier 57, consumer 4110, inert 3604
  equilibrium:  membership: exporter 5835, self-supplier 3571, consumer 4736, inert 990
```

**Outcome: CONFIRMED.** The falsifier asked whether founder markets remain measurably below their
role-cohort norm at equilibrium (10k, and 12k for high-tier). They read 1.01× and 1.00× — at norm,
not below. Founding carries no lasting physical cost to the founder that this instrument can see.

### C5 — Leech-colony baseline

```
Meaning:    Colonies founded in play are overwhelmingly healthy at equilibrium. The chronically
            unhappy minority is a few percent, not a quarter — the leech-colony pattern the row was
            written to fix is far smaller today than the row assumes. Separately, the comparison the
            claim asked for cannot be made as written: world-gen seeds no colonies at all, so there
            is no seeded-colony baseline to compare against.
Claim:      A material share (>25%) of colonies founded in-run land in the struck / served-last
            cohort and are still there at equilibrium.
Number:     Struck share of in-run colonies at equilibrium: 3.0% (17 of 562) at t=10,000 and 2.8%
            (16 of 562) at t=12,000. Judged over a trailing window rather than one frame, CHRONIC
            (struck at every one of the last 10 cycle samples) is 2.7% at t=10,000 and 2.8% at
            t=12,000 — so this is not churn: essentially every struck world is chronically struck.
            Served-last proxy: 3.7% (t=10,000) / 3.0% (t=12,000) of in-run colonies sit in the
            shortage regime. The comparator: homeworlds 0.0% struck. Seeded colonies n=0 — world-gen
            produces 20 homeworlds and ZERO seeded colonies, so the harness's "colony" world cohort
            IS the in-run cohort (562 = foundedCount, exactly).
Horizon:    startup (1000t: 0.0% struck, 20.7% in shortage) AND equilibrium (10,000t), re-read at
            12,000t. Both matter: the startup horizon shows zero strikes with a fifth of colonies
            short — unrest has not yet accumulated — so a startup read alone would have said the
            pattern does not exist, and an equilibrium read alone would miss that the 20.7%
            founding-era shortage resolves rather than hardens.
Cohort:     in-run founded colonies (n=562) vs homeworlds (n=20); the seeded-colony cohort the claim
            names is empty at this seed.
Licenses:   Supports "the chronic-leech share is ~3%, not >25%". Does NOT support "colonies are
            fine" — 48% of the colony cohort sits in the rationing regime at equilibrium, and 385 of
            562 opened deprived (<0.50 satisfaction). The falsifier was written in struck share and
            struck share is what this answers; rationing and opening deprivation are separate
            questions this reading does not settle either way.
```

**Raw — scratch diag, trailing-window strike (verbatim):**

```
strike threshold 0.65; "chronic" = struck at EVERY one of the last 10 cycle samples
  t=1000
    in-run founded   n= 324 | struck now    0 (0.0%) | chronic    0 (0.0%)
    seeded colonies  n=   0 | struck now    0 (n/a) | chronic    0 (n/a)
    homeworlds       n=  20 | struck now    0 (0.0%) | chronic    0 (0.0%)
    shortage regime: in-run 20.7% | seeded n/a
  t=10000
    in-run founded   n= 562 | struck now   17 (3.0%) | chronic   15 (2.7%)
    seeded colonies  n=   0 | struck now    0 (n/a) | chronic    0 (n/a)
    homeworlds       n=  20 | struck now    0 (0.0%) | chronic    0 (0.0%)
    shortage regime: in-run 3.7% | seeded n/a
  t=12000
    in-run founded   n= 562 | struck now   16 (2.8%) | chronic   16 (2.8%)
    seeded colonies  n=   0 | struck now    0 (n/a) | chronic    0 (n/a)
    homeworlds       n=  20 | struck now    0 (0.0%) | chronic    0 (0.0%)
    shortage regime: in-run 3.0% | seeded n/a
  VALIDATE (vs harness "colony" world-cohort strike%): combined colony strike now @ t=10000 = 17/562 = 3.0%
```

**Raw — `npm run simulate`, world-cohort tables (verbatim), both horizons:**

```
STARTUP — 1000 ticks (41 cycles), 600 systems, seed 42, economy scale 100
Supply & unrest by world cohort (end of simulation):
Cohort           |      n |   mean D |   unrest |   strike% |        Sup/Rat/Sho %
-----------------+--------+----------+----------+-----------+---------------------
pop <10          |     12 |    0.000 |    0.000 |      0.0% |          100 / 0 / 0
pop 10-100       |    179 |    0.209 |    0.142 |      0.0% |          0 / 63 / 37
pop 100-1K       |    133 |    0.012 |    0.071 |      0.0% |          47 / 53 / 0
pop >=1K         |     20 |    0.000 |    0.072 |      0.0% |          100 / 0 / 0
survival-short   |     47 |    0.156 |    0.076 |      0.0% |         19 / 49 / 32
homeworld        |     20 |    0.000 |    0.072 |      0.0% |          100 / 0 / 0
colony           |    324 |    0.120 |    0.107 |      0.0% |         23 / 56 / 21

EQUILIBRIUM — 10000 ticks (416 cycles), 600 systems, seed 42, economy scale 100
Supply & unrest by world cohort (end of simulation):
Cohort           |      n |   mean D |   unrest |   strike% |        Sup/Rat/Sho %
-----------------+--------+----------+----------+-----------+---------------------
pop 10-100       |     68 |    0.146 |    0.327 |     14.7% |          4 / 81 / 15
pop 100-1K       |    144 |    0.077 |    0.245 |      4.2% |          10 / 84 / 6
pop >=1K         |    370 |    0.006 |    0.113 |      0.3% |          75 / 25 / 1
survival-short   |    176 |    0.113 |    0.290 |      9.1% |          4 / 85 / 11
homeworld        |     20 |    0.000 |    0.101 |      0.0% |          100 / 0 / 0
colony           |    562 |    0.041 |    0.174 |      3.0% |          49 / 48 / 4
```

**Outcome: FALSIFIED.** The falsifier stated: "If in-run colonies are mostly healthy at equilibrium
(struck share ≤10%, in line with seeded worlds), the leech-colony motivation is weaker than assumed
and the row's aim needs re-justifying before a cost model is designed around it." Struck share is
3.0% (10k) / 2.8% (12k), well under the 10% bar, and chronic rather than churning. The row's
"fewer, deliberate colonies" motivation does not rest on a measurable leech population at this seed.

## Instrument notes

Things a later reader must not re-derive, and traps this campaign hit.

- **No `lib/` hook was needed or patched.** Founding manifests already ride
  `runWorldTick().instrumentation.foundingManifests`; treasuries and unrest are world state. The
  scratch runner is `.superpowers/row10-diag.ts` (gitignored), env-driven via
  `DIAG_TICKS`/`DIAG_SYSTEMS`/`DIAG_SEED`/`DIAG_TRAIL_CYCLES`.
- **Every reading was validated against a figure the harness prints independently**, and all five
  matched exactly: founded count 324 / 562; median founderCoverAfter 0.29× / 0.31×; mean manifest
  145 t/colony; treasury mean balance 13,195.6 ≈ 13.2K and 2,191,571 ≈ 2.2M with funded
  100/100/100; colony-cohort strike 17/562 = 3.0%.
- **World-gen seeds ZERO colonies at this seed** — 20 homeworlds only. Anything phrased as "in-run
  colonies vs seeded colonies" has no denominator on the second half; the harness's `colony` world
  cohort is exactly the in-run founded population (562 = foundedCount).
- **`founderCoverAfter` and role-cover are different units** and must never be quoted as a
  before/after pair: `founderCoverAfter` is stock ÷ `donorReserve`, minimum across the manifest's
  goods, sampled at the founding tick; role cover is stock ÷ `curveForRow().targetStock`, median
  across markets, sampled at a horizon.
- **The C4 startup ratio is near-tautological; the equilibrium one is not.** Founder markets are 49%
  of the exporter cohort at t=1,000 but only 9.1% of it at t=10,000. Read the equilibrium ratio.
- **The founding-era treasury tail is not the median.** 16 of 820 founding-era faction-cycles short
  a band, construction funding hitting 0.070 at t=120. The median never leaves 1.000, which is what
  C3's falsifier tested — but "money never binds in the founding era" would be a wrong summary.
- **`budgetSpentFrac` reads 0.010 / 0.016 today** where the 2026-08-04 note recorded ~6-8%; that is
  the stage-2 accrual-window fix (`LOGISTICS_WARMUP_TICKS`), not a behaviour change. The
  never-binds half is confirmed independently by `Funding-bound events 0` at both horizons.
- **A single deterministic long run serves every horizon.** `tickRng(seed, tick)` and no wall-clock
  in any processor body mean a checkpoint at t=N is identical to a separate N-tick run's endpoint —
  proven here by the diag's t=1,000 and t=10,000 checkpoints reproducing the harness's two separate
  runs exactly.
