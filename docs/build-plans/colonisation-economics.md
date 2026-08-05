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
not the speed. Costs are derived from physical quantities (manifest valued at the goods' base /
reference prices, establish work billed at real rates, a charter fee scaled to cycle spend) rather
than flat constants, so the later drains on the same treasury — priced logistics, military, industry pricing
(leaning: lands with the warehouse/storage row) — rescale them without retuning. Values stay coarse
until those sibling mechanics ship. Bite anchor from C3: founding-era spend is ~600/cycle per
faction against a ~5,600 median balance; a price at cycle-of-spend scale is where founding starts
sequencing against construction.

Kai's constraint (2026-08-05): do NOT value the manifest at **live local market prices** — the live
pricing layer misbehaves today (producers/consumers not reading price by type properly; see the
goods-pricing revisit row). Use base/reference prices, behind one valuation seam that upgrades to
live prices when the pricing revisit ships.

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

---

## Build plan

Spec: `docs/planned/colonisation-economics.md` (spec-reviewed 2026-08-05, all 25 findings applied,
`d70d1cd6`). The spec owns every decision below; this plan owns files, order and the contracts
between tasks. Phases are check-in pauses on one branch — the PR unit is the whole row.

**Phase A — the priced quantities exist (Tasks 1-5).** Nothing founds differently yet: the debit
channel is wired but always empty.
**Phase B — the mechanism (Tasks 6-10).** The gate, the charter, staging, delivery, the settler gate.
**Phase C — surfaces and instruments (Tasks 11-14)**, then the calibration gate.

### Task 1 — One seam values founding, and the four new constants exist

Files: `lib/constants/colonisation.ts`; `lib/engine/founding-cost.ts` **(new)**;
`lib/engine/__tests__/founding-cost.test.ts` **(new)**.

Interface:
- `COLONISATION` gains `CHARTER_FEE_SPEND_MULT` (6.5), `CHARTER_FEE_MIN` (100),
  `FOUNDING_GATE_HEADROOM` (2.0), `FOUNDING_STALL_COMPLETE_CYCLES` (8) — meanings and anchors
  verbatim from the spec's constants table. `COLONY_ESTABLISH_WORK`'s docstring drops "a temporary
  construction stand-in until a treasury prices expansion" (this row is that pricing).
- `foundingGoodsValue(lines: ReadonlyArray<{ goodId: string; quantity: number }>, economyScale: number): number`
  — the single valuation seam, `Σ (quantity / ECONOMY_SCALE) × GOODS[goodId].basePrice`. Takes the
  scale as a parameter, matching `productionTaxIncome` (`lib/engine/treasury.ts:68-83`) — the engine
  graph never imports the env-resolved constant. Never reads `REFERENCE_VALUE`.
- `charterFee(maintenanceBill: number, params: { mult: number; min: number }): number`
  = `max(min, mult × maintenanceBill)` — a real floor, not a null-fallback.
- `projectedManifestWant(sourceGoods: ReadonlyArray<GoodMarketState>, seedPop: number, cover: number): FoundingStockLine[]`
  — the **uncapped** want, one line per good the seed consumes, on the same want expression
  `planFoundingStock` uses (`lib/tick/processors/directed-build.ts:109-111`) with no
  `surplusDrawable` cap. Deliberately an upper bound (spec: over-reserving is the safe direction).
- `foundingCommitmentCost(charter: number, projectedBillValue: number, headroom: number): number`
  = `charter + headroom × projectedBillValue` — the gate quantity, one function so the planner, the
  player service and the staging check can never read three different numbers.

Proves: `founding-cost.test.ts` — total founding cost for a fixed seed pop is **equal** at
`ECONOMY_SCALE` 1 and 100, via `vi.resetModules()` + `vi.stubEnv` re-import (the
`lib/engine/__tests__/economy-scale-invariance.test.ts` pattern; the re-import is required because
the *quantity* rides S through `scaleRecord`). Drop the `/ economyScale` divisor and this is the only
test in the suite that fails — everything else is pinned at S=1 (`vitest.config.ts:29`).

Consumes: —

### Task 2 — World shape carries the ledger, the charter flag and the purse line

Files: `lib/world/types.ts`; `lib/world/save.ts`; `lib/world/gen.ts`;
`lib/world/__tests__/save.test.ts`.

Interface:
- `WorldFoundingStockLine { goodId: string; quantity: number }` in `lib/world/types.ts`;
  `FoundingStockLine` in `lib/tick/world/directed-build-world.ts:55` becomes an alias of it (the
  `TreasuryMaintenanceLine = MaintenanceBillLine` pattern at `types.ts:333`), so one shape crosses
  the processor/world boundary.
- `WorldColonyEstablishProject` (`types.ts:190`) gains **required** `stagedManifest:
  WorldFoundingStockLine[]`, `charterPaid: boolean`, `stalledCycles: number`.
- `WorldFactionTreasury` (`types.ts:349`) gains **required** `pendingFounding: number`;
  `gen.ts:209`'s init writes `pendingFounding: 0`.
- `WorldTreasurySettlement` (`types.ts:336`) gains **required** `foundingExpense: number` — its own
  field, never a fourth member of `TreasuryBands`.
- `SAVE_FORMAT_VERSION` 10 → 11 (`save.ts:29`).

Required, not optional, is the point: `tsc` then fails at both project creation sites (the autonomic
planner and `orderColony`) until Tasks 7 and 11 supply them.

Proves: `save.test.ts` — the version pin moves to 11 and a world holding a staged manifest
round-trips; a `formatVersion: 10` payload is rejected by `deserializeWorld` (`save.ts:78-83`). The
premise that breaks if a field is made optional is caught by `tsc`, not by this test — that is why
they are required.

Consumes: Task 1 (shape only).

### Task 3 — The queue funder accepts a per-project ceiling

Files: `lib/engine/construction.ts`; `lib/engine/__tests__/construction.test.ts`.

Interface: `fundQueueWithFloor(ordered, pool, cap, reserved, isFloorEligible, capFor?: (p:
WorldConstructionProject) => number)` — `capFor` returns this project's absorption ceiling for the
cycle; omitted → the scalar `cap` for every project, exactly today's behaviour. It binds in **both**
passes (`construction.ts:167-177` and `:184-193`), so the reserved floor cannot route around a
ceiling of 0. `fundQueue` is untouched — the ETA forecasters (`forecastEtaCycles`,
`forecastIndependentEtaCycles`, `nextCycleGains`) keep reading the scalar cap.

Proves: `construction.test.ts` — a project whose `capFor` returns 0 absorbs nothing while its queue
neighbours fund normally *and* the reserve does not fund it either (the floor-pass bypass is the
regression); a project at half cap takes twice the cycles. The existing suite is the identity proof
for the omitted-callback path.

Consumes: —

### Task 4 — The treasury accrues and settles founding expense

Files: `lib/tick/world/treasury-world.ts`; `lib/tick/processors/treasury.ts`; `lib/world/tick.ts`
(params wiring only); `lib/tick/processors/__tests__/treasury.test.ts`;
`lib/world/__tests__/cadence-invariance.test.ts`.

Interface:
- `TreasuryProcessorParams` gains `foundingDebitsByFaction: ReadonlyMap<string, number>` — same
  shape and same threading as `constructionWorkByFaction`.
- Mid-cycle: accrue into `pendingFounding` through `safeMoney`, exactly as `pendingWork` is accrued
  (`treasury.ts:70-88`). The early return `if (!settles && !hasWork)` (`:44-46`) and the mid-cycle
  write branch (`:77-88`) both gain the founding term.
- At settlement: `foundingExpense = pendingFounding` (post-accrual), subtracted from `balance`
  through `safeMoney` **before** `settleLadder` (`:132`), `pendingFounding` reset to 0, and
  `foundingExpense` written onto `lastSettlement`. `balance` keeps exactly one writer (`:148`).
- `RunTotals` in `cadence-invariance.test.ts:48-52` gains a founding-expense total.

The `build12` arm of that test (`cycle: 24, construction: 12`) **already is** the
`CONSTRUCTION_INTERVAL ≠ CYCLE_LENGTH` configuration the spec asks for — what is missing is a
founding term in the totals it compares, not a new arm.

Proves: `processors/__tests__/treasury.test.ts` — a founding debit accrued on a **workless**
mid-cycle tick still reaches the next settlement (fails the moment either guard keeps keying on
pending *work* only), and `balance_after = balance_before + income − paid − foundingExpense`.

Consumes: Task 2.

### Task 5 — Every reader of a settlement learns about the new expense

Files: `lib/services/treasury.ts`; `components/factions/treasury-card.tsx`;
`lib/tick-harness/treasury-analysis.ts`; `lib/services/__tests__/treasury.test.ts`;
`lib/tick-harness/__tests__/treasury-analysis.test.ts`.

Interface:
- `getFactionTreasury`'s `net` (`services/treasury.ts:22-26`) gains the founding term:
  `net = headsIncome + productionIncome − (paid.maintenance + paid.logistics + paid.construction +
  foundingExpense)`.
- `treasury-card.tsx` gains a `Founding` `LedgerRow` alongside the Logistics and Construction expense
  rows (`:101-102`).
- `treasury-analysis.ts` `moneyFields` (`:65-75`) gains `t.pendingFounding` and
  `t.lastSettlement.foundingExpense`, so a non-finite or negative value increments `invalidRows`
  instead of silently corrupting the summary.

Proves: `services/__tests__/treasury.test.ts` — `net` reconciles with the balance delta across a
settlement carrying a founding expense (fails if the term is dropped: today's formula would report a
surplus a faction did not have). Harness test: a row with `foundingExpense: NaN` counts as invalid.

Consumes: Tasks 2, 4.

### Task 6 — The planner prices each candidate against a running balance

Files: `lib/engine/directed-build.ts`; `lib/engine/__tests__/directed-build.test.ts`.

Interface:
- `ColonyEstablishParams` gains `charterMult`, `charterMin`, `gateHeadroom`, `foundingStockCover`,
  `economyScale`.
- `planFactionColonyProposals(factionId, developed, candidates, openColonyProjects, params, budget)`
  — new final argument `budget: { balance: number; maintenanceBill: number }`, the faction's working
  balance and the charter's scale base. Omitted/undefined → no money gate (the engine-test and
  independents path, matching how `develop` is already optional at the processor).
- The gate runs per candidate **after** `sizeColonyEstablish` + source lookup (`:1115-1136`), beside
  the existing physical gates, over the **value-ordered** candidate list: a candidate is proposed
  only while the running budget covers `foundingCommitmentCost(charterFee(budget.maintenanceBill),
  foundingGoodsValue(projectedManifestWant(source.goods, seedPop, cover), economyScale),
  gateHeadroom)`; each acceptance decrements the running budget by its own cost; the first failure
  ends the list.
- The ROI value axis and the `work` denominator are untouched — no money enters `colonyValue`.

Ordering note: the money gate and the settler-supply gate (`:1153-1164`) are both prefix truncations
of the same value order, so composing them is order-independent — the result is the shorter prefix
either way. No decision needed about which runs first.

Proves: `directed-build.test.ts` — a faction whose balance covers exactly one candidate's commitment
cost proposes **one**, not N (today's code emits every eligible candidate — `:1081` "There is NO
per-cycle cap"), and the dropped candidates reappear on a later cycle once the balance recovers.

Consumes: Task 1.

### Task 7 — The charter is paid atomically with queue persistence

Files: `lib/tick/processors/directed-build.ts`; `lib/tick/types.ts`; `lib/world/tick.ts`;
`lib/tick/processors/__tests__/directed-build.test.ts`.

Interface:
- `DirectedBuildProcessorParams` gains
  `treasuryByFaction?: ReadonlyMap<string, { balance: number; pendingFounding: number; maintenanceBill: number }>`
  — built in `runWorldTick` from `treasuries` beside the existing `fundingByFaction` map
  (`tick.ts:1084-1085`). Omitted → founding is unpriced (the build-only engine/adapter path).
- `TickProcessorResult` gains `foundingDebitsByFaction?: Map<string, number>`, returned by the
  processor and threaded to `runTreasuryProcessor` exactly as `workPerformedByFaction` is
  (`tick.ts:1098` → `:1136`). Not instrumentation — a settlement input.
- **The tick body's own `hasWork` guard gains the founding term too** (`tick.ts:1109-1110`), not just
  the params. That guard decides whether `runTreasuryProcessor` is *called at all*, so the
  processor's internal guard (Task 4) is unreachable when this one refuses. It can be false on a tick
  that produces founding debits: `directed-build.ts` only writes `workPerformedByFaction` when
  `absorbed > 0`, and a cycle where every due faction absorbed zero work is exactly what this task's
  own `capFor: 0` for an unpaid charter produces. Off a settlement tick — the
  `CONSTRUCTION_INTERVAL ≠ CYCLE_LENGTH` case — the charter debit would be silently dropped.
- Per faction, before the queue is funded: `workingBalance = balance − pendingFounding`, decremented
  by each charter paid this cycle. The charter phase walks the colony rows in queue order; for each
  with `charterPaid === false`, if the working balance covers `charterFee` **re-quoted from the
  current `lastSettlement.maintenanceBill`**, debit it into `foundingDebitsByFaction` and set
  `charterPaid: true`; otherwise leave it unpaid (it absorbs no work this cycle — Task 8's ceiling).
- Persist-if-funded (`directed-build.ts:368-371`) gains: a `colony_establish` with `charterPaid` is
  exempt from the `workDone <= 0` drop, the same treatment player rows already get.
- New colony rows are minted with `charterPaid: false, stagedManifest: [], stalledCycles: 0`
  (`:341-352`).

Proves: `processors/__tests__/directed-build.test.ts`, two falsifiers from the spec's acceptance bar —
(a) over a multi-cycle run, Σ charter debits == the number of projects that ever reached
`charterPaid`, never more (drop the persist exemption and a stalled row is deleted and re-emitted
with a fresh id, charging twice); (b) Σ charters committed by one faction in one cycle ≤ that
faction's opening balance (drop the running decrement and a faction that can afford one commits
several).

Consumes: Tasks 1, 2, 4, 6.

### Task 8 — Materials stage per cycle, and gate the work

Files: `lib/tick/processors/directed-build.ts`; `lib/tick/world/directed-build-world.ts`;
`lib/world/tick.ts`; `lib/tick/processors/__tests__/directed-build.test.ts`.

Interface:
- `FoundingStagingDraw { sourceSystemId: string; goodId: string; quantity: number }` — the per-cycle
  source debit, collected on `DirectedBuildWorld` alongside `developments`.
- `planStagingDraw(source: SystemBuildRow, project: WorldColonyEstablishProject, workShare: number,
  stockBalance: Map<string, number>, moneyLeft: number, economyScale: number): { lines:
  FoundingStockLine[]; cost: number; achievableFraction: number }` — lives beside `planFoundingStock`
  (`directed-build.ts:96-121`), which is where the source's market rows are. `workShare` is this
  cycle's share of the manifest, matched to the work the ordinary cap would absorb. Per good the draw
  is the minimum of (remaining want, live `surplusDrawable` headroom under the running per-(source,
  good) balance, what `moneyLeft` pays for through the seam). Money is checked against
  `balance − pendingFounding` less what earlier projects already committed this cycle, so two
  projects cannot spend the same money.
  **A good the source cannot supply this cycle counts as satisfied** in `achievableFraction` — the
  achievable-want rule; without it the median colony never completes.
- `capFor(p)` passed into `fundQueueWithFloor`: an ordinary `build` → the scalar cap; a colony with
  `charterPaid === false` → `0`; a written-off colony → the scalar cap; otherwise the scalar cap
  scaled by `achievableFraction`.
- After funding, absorbed work per project is recovered by diffing `workDone` by id (the
  `nextCycleGains` pattern, `construction-readout.ts:119-131`); the matching manifest share is
  appended to `stagedManifest`, its value accrued into `foundingDebitsByFaction`, and its lines
  emitted as `FoundingStagingDraw`s. Nothing stages for work that was not funded.
- `stalledCycles` increments on any cycle that stages nothing, and only once `charterPaid` is true;
  it resets on any staging. The write-off is `stalledCycles ≥ FOUNDING_STALL_COMPLETE_CYCLES` —
  **no fourth persisted field**, because a written-off project stages nothing thereafter, so the
  counter latches by construction.
- `applyFoundingStagingDraws(markets: WorldMarket[], draws: FoundingStagingDraw[]): WorldMarket[]` in
  `lib/world/tick.ts` — the source debit, clamped at debit time to live stock so conservation is this
  function's own property, mirroring `applyFoundingStock`'s clamp (`tick.ts:549-573`). Runs
  immediately after the processor, before `addMarketsForSettledSystems`.

Proves: `processors/__tests__/directed-build.test.ts` — (a) a colony whose founder can spare
*nothing* for the whole establish still completes and opens with an empty ledger (remove the
achievable-want rule and the project persists at `workDone > 0` forever with its target stuck
`inFlight` — the deadlock the spec names); (b) a colony whose founder is rich stages across many
cycles to a larger total than today's single draw; (c) a project that stages nothing for
`FOUNDING_STALL_COMPLETE_CYCLES` consecutive cycles completes on work alone.

Consumes: Tasks 1, 2, 3, 7.

### Task 9 — Delivery is credit-only; cancellation returns the goods

Files: `lib/world/tick.ts`; `lib/tick/world/directed-build-world.ts`;
`lib/services/construction-orders.ts`; `lib/world/__tests__/apply-developments.test.ts`;
`lib/services/__tests__/construction-orders.test.ts`.

Interface:
- `SystemDevelopment.stockManifest` (`directed-build-world.ts:61-74`) now carries the completed
  project's `stagedManifest` — the goods already out of the founder's markets. Its docstring stops
  describing a conserved move.
- `applyStagedManifestDelivery(markets: WorldMarket[], developments: SystemDevelopment[]): WorldMarket[]`
  replaces `applyFoundingStock` at `tick.ts:1097`: **credit-only**, target rows only, run after
  `addMarketsForSettledSystems` (`:1096`) because the colony has no market rows before then.
- `applyFoundingStock` (`tick.ts:549`) is **deleted** with its tests — it is stranded by this change,
  and re-using it would double-debit the founder and credit `min(staged, founder's remaining stock)`.
- `cancelOrder` (`construction-orders.ts:177-190`) gains: a cancelled `colony_establish` credits its
  `stagedManifest` back to `sourceSystemId`'s market rows, **uncapped** (returning stock cannot
  breach a reserve). Work and the charter stay forfeit.

Proves: `construction-orders.test.ts` — total founder stock is unchanged across order → stage →
cancel (the spec's conservation bar). `apply-developments.test.ts` — a completed colony opens holding
exactly its `stagedManifest` and the founder's stock is unchanged at the completion tick (swap the
credit-only delivery back to the conserving move and the founder is debited twice).

Consumes: Tasks 2, 8.

### Task 10 — The settler gate stops loosening as establishes lengthen

Files: `lib/engine/directed-build.ts`; `lib/engine/__tests__/directed-build.test.ts`.

Interface: the `hungry` count in `planFactionColonyProposals` (`:1156-1161`) adds one per in-flight
`colony_establish` — `openColonyProjects` is already a parameter, so no new plumbing. A forming
colony is `controlled` and therefore invisible to the developed-systems loop today, so lengthening
the forming window would silently admit more concurrent foundings.

Proves: `directed-build.test.ts` — with the same releasable settler supply, the admitted-proposal
count is unchanged when the number of in-flight establishes doubles (fails on today's code, where it
doubles too).

Consumes: —

### Task 11 — The player's colony verb pays the same price

Files: `lib/services/colony-eligibility.ts`; `lib/services/construction-orders.ts`;
`lib/services/build-options.ts`; `lib/types/colonisation.ts`; `lib/types/api.ts`;
`components/construction/colony-section.tsx`; `lib/services/__tests__/construction-orders.test.ts`;
`lib/services/__tests__/build-options.test.ts`.

Interface:
- `ColonyBlockReason` (`types/colonisation.ts:10`) gains `"insufficient_funds"`, with its
  `COLONY_BLOCK_COPY` line.
- `colonyEligibility` (`colony-eligibility.ts:49`) gains the money check as its last gate, against
  the faction's `balance − pendingFounding` and exactly `foundingCommitmentCost(...)` — the same
  function the planner calls. Its eligible branch returns `{ eligible: true; sourceSystemId; charter:
  number; projectedBill: number }` so the caller displays the price without recomputing it. It reads
  `ECONOMY_SCALE` from `lib/constants/economy-scale.ts` (a server-only service; the client-safe copy
  module stays import-free of it).
- `SystemBuildOptionsData`'s colony `preview` (`types/api.ts:329-336`) gains `charter` and
  `projectedBill`; `colony-section.tsx` labels the material figure **"up to"** (it is the
  uncapped-want upper bound).
- `orderColony` (`construction-orders.ts:137`) re-checks at the mutation boundary — a **hard** block —
  and mints the row with `charterPaid: false, stagedManifest: [], stalledCycles: 0`.

Proves: `construction-orders.test.ts` — a player faction short of `charter + headroom × bill` is
refused even though every physical gate passes (put the check only in the read service and the
mutation still succeeds, which is the exact failure: with colonisation automation off the planner
gate never runs for the player, so they would be the one faction founding free).

Consumes: Tasks 1, 2, 6.

### Task 12 — The construction readout shows why a colony is stuck

Files: `lib/engine/construction-readout.ts`; `lib/services/construction.ts`;
`components/construction/construction-row.tsx`; `lib/engine/__tests__/construction-readout.test.ts`.

Interface:
- `ConstructionProjectColonyRow` (`construction-readout.ts:54-60`) gains
  `stalledReason: "awaiting_charter" | "awaiting_funds" | "awaiting_materials" | null` (derived, not
  persisted) and `stagedFraction: number` (staged ÷ target want).
- `computeFactionConstruction` gains a `founding` argument carrying what the derivation needs: the
  faction's working balance and, per colony row, its source's market rows. `services/construction.ts`
  `readoutForFaction` supplies it from the world.
- Discrimination, one-to-one with the spec's three stall causes: `charterPaid === false` →
  `awaiting_charter`; else a stalled row (`stalledCycles > 0`) whose next share the working balance
  cannot pay → `awaiting_funds`; else stalled → `awaiting_materials`; else `null`.
- `etaCycles` reads `null` whenever `stalledReason !== null` — the field already documents null as
  the stalled signal.

Proves: `construction-readout.test.ts` — a charter-unpaid colony reads `awaiting_charter` with
`etaCycles === null`, and a normally-progressing one reads `null` with a finite ETA. Without this the
readout forecasts steady progress for a project structurally unable to make any.

Consumes: Tasks 1, 2, 8.

### Task 13 — Instrumentation survives per-cycle staging

Files: `lib/tick/types.ts`; `lib/tick/processors/directed-build.ts`;
`lib/tick-harness/build-analysis.ts`; `lib/tick-harness/runner.ts`;
`lib/tick-harness/__tests__/build-analysis.test.ts`.

Interface:
- `TickProcessorResult.foundingManifests` (`tick/types.ts:96-101`) becomes **per staging event**:
  `{ systemId, sourceSystemId, tonnage, goodIds, moneyCost, founderCover }`, with `founderCover`
  computed **at emission** inside the processor — post-tick reconstruction cannot attribute two
  colonies drawing from one founder in one cycle.
- `recordFoundingManifest` (`build-analysis.ts:91`) gains a **staging accumulator keyed by target
  system, independent of `foundedColonies`**, folded into the record when the colony is first
  tracked. Today it early-returns for untracked systems (`:98`) and every staging event fires while
  the target is still `controlled`, so it would drop every draw but the last.
- `FoundedColonyRecord.founderCoverAfter` is **redefined** as the minimum across staging draws (a
  unit change — A/B reads must not compare it to the baseline); the record gains
  `foundingMoneyCost`. `FoundingStockSummary` gains the mean money cost per colony.
- `runner.ts:215-231` drops its per-manifest `founderCoverAfter(...)` recomputation, since the cover
  now arrives with the event.

Proves: `build-analysis.test.ts` — one founder supplying two colonies in one cycle records two
distinct covers, and a colony staged across N cycles records N draws folded into one record (on
today's recorder both collapse to a single reading).

Consumes: Tasks 8, 9.

### Task 14 — The report prints what the acceptance bar reads

Files: `scripts/simulate.ts`; `lib/tick-harness/build-analysis.ts`;
`lib/tick-harness/treasury-analysis.ts`; `lib/tick-harness/runner.ts`; harness tests.

Interface, new reported rows (each named on the spec's acceptance bar and absent today):
- founding money cost per colony, and cumulative founding spend as a share of founding-era income —
  beside the existing `cost to founders:` line (`simulate.ts:495-503`);
- **cycles from commitment to completion**, per colony — the metric that separates "the gate refused"
  from "the construction pool got smaller";
- **stall cycles attributed by cause** (charter / funds / materials), with founder-event-driven
  material stalls counted separately (accepted flavour, not a fault);
- **concurrent in-flight establish count**, so Task 10's invariance is visible;
- `isShorted` reported founding-cycle-separated, so a charter-caused shortfall is distinguishable
  from the ambient startup tail;
- founder-cohort production and disuse-decay read, for the `sellingFactor` side of the sustained
  draw.

Proves: harness tests on each new aggregate (finite, non-negative, correct denominator over a
seeded fixture). The stall-attribution counter is the one that fails if Task 8's three stall causes
are collapsed into one.

Consumes: Tasks 8, 12, 13.

### Gate — calibration

Not a task: no files, no interface.

**Arms:** baseline = `main` at this branch point; treatment = Tasks 1-14 complete. Same seed (42),
600 systems, `ECONOMY_SCALE=100`, both horizons (1,000 and 10,000 ticks), cohorted.

**Reads** (all from the spec's acceptance section, all now printed by Task 14): founding cadence with
the 80% mark (baseline t≈1,500) alongside cycles-from-commitment-to-completion; cumulative founding
spend vs founding-era income and the balance trajectory (baseline 587 → 12,026); shorted
faction-cycle share over t>400 (baseline 1.95%) and minimum `funded.construction` (bar: ≥0.5); the
**distribution** of `funded.maintenance` across founding-era faction-cycles; opened-deprived count
(baseline 385/562) and colony rationing share (baseline 48%), with strike% split by pop cohort, never
galaxy-wide; mean manifest tonnage per colony and the founder `surplusDrawable`-suppressed cycle
share; the four pass/fail conservation identities.

**Merge condition:** founding still saturates the galaxy with a measurably later 80% mark; the
funding and maintenance-distribution bars hold; colonies open at or above baseline endowment (a worse
endowment is a bug, not a tradeoff — the staging target is unchanged and the aggregate draw rises);
all conservation identities exact. The four constants get their single coarse adjustment here and
values then stay coarse — **booked at this gate:** precision tuning of `CHARTER_FEE_SPEND_MULT` /
`FOUNDING_GATE_HEADROOM` waits for the sibling cost mechanics (priced logistics, military, industry
pricing) to land on the same treasury, per the standing calibration rule. If the gate over-reserves
enough to freeze founding, the spec's named fallback is to clip the projection by the source's live
`surplusDrawable` at proposal time — a spec-authored fallback, not a new design.

---

## Verification

**In the galaxy, not in fixtures.** `npm run simulate` at **both horizons**, cohorted, per the gate
above. Startup (1,000 t) answers the founding-era question this row exists for; equilibrium
(10,000 t) is the only valid basis for any constant. Neither is quoted at the other's question.

**New harness metrics are part of the feature** (Task 14), not follow-ups: cycles-from-commitment-to-
completion, stall attribution by cause, concurrent in-flight establishes, founding-cycle-separated
`isShorted`, and per-colony founding money cost. Each exists because its symptom hides inside an
aggregate the harness already prints — cadence alone cannot separate "the gate refused" from "the
construction pool shrank", and the median funding fraction reads 1.000 while the shorted tail triples.

**Gates before review**, per `docs/active/engineering/feature-process.md`:
`npx vitest run` · `npx next build --webpack` (the build gate — not `npm run build`) ·
red-proof on every new or changed test (break the premise, watch it fail, restore) ·
`npm run mutation -- --mutate "<changed lib files>"` scoped to this row's `lib/` files, every
survivor killed or justified.

**The S-invariance check is load-bearing and cannot be delegated to the suite.** Every unit test runs
pinned at S=1, where a missing `/ ECONOMY_SCALE` reads ≈115 and looks correct; at the live S=100 the
same bill reads ≈11,479 and freezes founding galaxy-wide. Task 1's re-import test is the only thing
standing between those two.

## Doc fold

On the branch, before the final review.

- **Promote** `docs/planned/colonisation-economics.md` into `docs/active/gameplay/colonisation.md` —
  present tense, no phase numbers, the mechanics headline first. The planned doc is then deleted.
- **`docs/SPEC.md`** — the Construction & Colonisation section (`:48-51`) and the
  **Directed Build → Colonisation → Economy** interaction row (`:169`) both still describe founding
  as costing only pool work; add the charter, the staged materials and the treasury edge. The Purse
  section gains the founding expense line.
- **`docs/active/gameplay/player-seat.md`** — the colony verb's new `insufficient_funds` block and
  the priced preview. **`docs/active/gameplay/player-seat-purse.md`** — the Founding ledger row and
  the `net` change.
- **`docs/active/gameplay/economy-autonomic-agency.md`** — the AI founding policy now prices
  candidates against a running balance.
- **`docs/ROADMAP.md`** — delete row 10 at ship.
- **`docs/build-plans/colonisation-economics.md`** (this file) — deleted at ship, after the fold.
- **Dead-doc citations.** The spec names two files citing the deleted
  `docs/planned/economy-colonisation-cost.md`; there are actually **six**:
  `lib/constants/colonisation.ts:3`, `lib/constants/expansion.ts:11`,
  `lib/engine/colonisation-value.ts:3`, `lib/engine/construction.ts:227`,
  `lib/engine/directed-build.ts:582`, `lib/engine/directed-build.ts:1077`. All six re-point at
  `docs/active/gameplay/colonisation.md` in this fold.

## Not covered

- **Live local market prices in the valuation seam.** *Booked* — the **Goods-pricing revisit**
  roadmap row (which already records "row 10 routes around live prices because of this"). The seam is
  built so the swap is a one-function change with no redesign.
- **Separating `surplusDrawable`'s triple duty** (logistics donor cap / build input gate / founding
  manifest cap). *Booked* to the same Goods-pricing revisit row. The coupling is deliberate here: a
  founder's willingness to part with stock stays one number.
- **Hauling founding freight with real ships.** *Booked* — the logistics-depth pass (memory
  `design-logistics-depth-inputs`). v1 stages source-local exactly as today's manifest does.
- **Un-parking the colony seed size vs the housing unit.** *Booked* — roadmap
  "[S] Colony seed size scaled against the housing unit". It un-parks **after** this ships and is
  measured; compounding two pacing changes in one measurement is what the spec forbids.
- **The equilibrium treasury hoard** (487-759× cycles of spend). *Dropped* — a one-time founding-era
  sink is ~1% of an equilibrium balance and cannot move that multiple. Recurring sinks are the
  sibling mechanics' job; claiming this row addresses hoarding would be false.
- **Pricing claims.** *Dropped* — a claim is a territorial intention; pricing it slows map paint
  without adding decision weight (spec, "What deliberately does not change").
- **Per-colony billing of establish work.** *Dropped* — the construction band stays one generic bill
  by design; the colony-specific money is the charter and the materials.
- **Old-save migration.** *Dropped* — `SAVE_FORMAT_VERSION` bumps and old saves fail cleanly. There
  is no field-defaulting path to write a grandfathering rule into (`lib/world/save.ts:78-83`), and any
  default would be a lie about whether an in-flight colony was paid for.
- **Precision tuning of the four new constants.** *Booked at the calibration gate* (see its merge
  condition), per the standing coarse-until-siblings-ship rule.

## Self-review record

Run by the author before committing this plan. What it changed or is worth carrying:

1. **Every named identifier grep-verified**, and every `file:line` citation verified by reading the
   range — not by grep alone. Two-same-named-module hazards checked: `surplusDrawable` is
   `lib/engine/directed-logistics.ts:87` (not the processor), and `planFoundingStock` is
   `lib/tick/processors/directed-build.ts:96` (not the engine). Every `(new)` name
   (`lib/engine/founding-cost.ts`, `applyFoundingStagingDraws`, `applyStagedManifestDelivery`,
   `FoundingStagingDraw`, `planStagingDraw`, `projectedManifestWant`, `foundingCommitmentCost`)
   confirmed absent from the tree.
2. **The `CONSTRUCTION_INTERVAL ≠ CYCLE_LENGTH` test configuration already exists** — the `build12`
   arm of `cadence-invariance.test.ts:79`. The spec reads as if it must be added; what is actually
   missing is a founding term in the compared totals. Recorded in Task 4 rather than silently
   building a duplicate arm.
3. **`applyFoundingStock` is deleted, not left behind.** The credit-only delivery strands it; its
   removal (with its tests) is inside Task 9, not a follow-up.
4. **The write-off needs no fourth persisted field** — `stalledCycles ≥
   FOUNDING_STALL_COMPLETE_CYCLES` latches by construction, because a written-off project stages
   nothing thereafter. Stated in Task 8 so nobody adds a fifth save field for it.
5. **Gate ordering is a non-decision.** The money gate and the settler-supply gate are both prefix
   truncations of the same value-ordered list, so their composition is order-independent. Recorded in
   Task 6 so it is not re-litigated at implementation.
6. **The dead-doc citation count is six, not two** (Doc fold). The spec undercounted; the extra four
   are engine modules.
7. **Nothing dropped between spec and plan.** Every row of the spec's hazard-3 interaction table
   lands in a task: events → Tasks 8 + 14 (stall attribution); population/migration → Task 10;
   unrest → Task 14's founder-cohort read; decay → Task 14; logistics → Task 8; directed build /
   planner → Tasks 6-8; colonisation manifest → Tasks 8-9; player orders → Tasks 9, 11; treasury →
   Tasks 4-5; save format → Task 2; harness metrics → Tasks 13-14. Factions/relations and
   industry/staffing are "none" in the spec and appear nowhere here, correctly. The only spec/plan
   scope difference is the list under **Not covered**.
8. **No code.** No task body carries a function body, a branch or a derived formula. The three
   formulas quoted (`value = (quantity / S) × basePrice`, `charter = max(min, mult × maintenanceBill)`,
   `commitment = charter + headroom × bill`) are quoted verbatim from the spec, which is the licence
   the skill grants.
9. **Shared quantities stay inside the spec's evidence.** Every symbol these tasks touch is in the
   spec's hazard-1 table (`FOUNDING_STOCK_COVER`, `surplusDrawable`, `basePrice`, `ECONOMY_SCALE`,
   `COLONY_ESTABLISH_WORK`, `balance`, `CONSTRUCTION_RATE_PER_WORK`), so its `npm run impact` output
   is the licence. No task leans on a symbol outside it, so the tool was not re-run.

Found while building Phase A and folded back in, rather than left for a later reader:

10. **The tick body's outer `hasWork` guard was missing from Task 7** — this plan's own miss, not the
    spec's. `tick.ts:1109-1110` gates whether the treasury processor runs at all, so Task 4's fix to
    the processor's internal guard is unreachable when it refuses. It goes false on exactly the
    workless construction cycles an unpaid charter creates. Task 7's interface now names it.
11. **`capFor` can only lower, never raise.** The scalar `cap` is the minimum-build-time floor; a
    callback able to return more than it would let a caller buy past that floor. Clamped inside
    `fundQueueWithFloor`, with a test.
