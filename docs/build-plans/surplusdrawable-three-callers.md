# surplusDrawable's three callers — which one produces the electronics regression?

Working file for roadmap item 1 (economy queue). Transient: deleted when the item ships, after
carrying durable outcomes into `docs/active/gameplay/economy-autonomic-agency.md`, the roadmap row,
or the `killed-designs` memory.

Context (from the item + `surplusDrawable`'s docstring): #211 moved the deficit side onto
`WAREHOUSE_COVER × real demand`; the donor side still reads the `MIN_DEMAND`-floored price anchor,
deliberately. Removing that floor was tried in session 63: a no-op for shipping (+0.0% drawable,
96.5% of hauls come from the exporter branch that never reads the target), yet `electronics`
consumer cover fell 0.78 → 0.21 and the cause was never established. The edit moved all three
callers at once. This measurement isolates them.

## Claim

Under a demand-denominated ordinary-donor anchor, the electronics consumer-cover collapse
(0.78 → 0.21 at equilibrium) is produced by the **build planner's input-supply gate** caller of
`surplusDrawable`, not by the logistics matcher's donor side or the colony founding manifest.

Why this caller is the named suspect (the lead being formalised, not evidence): build-loop stats
moved with the tried edit (tier-1+ industry 525 → 530, colony tier-1 projects 51 → 31), and the gate
is the one *binary* caller — `surplusDrawable(...) > 0` decides which systems count as reachable
input suppliers for tier-1+ industry, so small anchor changes can flip site eligibility outright.

## Falsifier, committed before any run

Five runs, all `npm run simulate` at the standard config (600 systems, seed 42,
`ECONOMY_SCALE=100`), reading the **electronics consumer-cohort median cover at equilibrium**,
startup recorded alongside:

- **R0** baseline, no edit — validity gate: must reproduce 0.70–0.86 (known 0.78). Miss ⇒
  INCONCLUSIVE (config drift): fix the instrument, do not reinterpret.
- **R1** all three callers on the demand anchor — validity gate: must reproduce ≤ 0.35 (known 0.21).
  Miss ⇒ INCONCLUSIVE (the reconstruction of the tried edit is wrong): back to the instrument.
- **R2** matcher only · **R3** build gate only · **R4** founding manifest only.

**The claim is FALSE if either:**

- R3 (gate only) reads **≥ 0.60** at equilibrium — the gate alone does not carry the regression; or
- R2 or R4 reads **≤ 0.40** at equilibrium — another caller carries it, alone or additionally.

A compound outcome — R1 reproduces but no single-caller run reads ≤ 0.40 — falsifies the claim as
stated (the regression needs two callers together). That is a finding, not a rescue.

Secondary discriminators, recorded per run but not falsifier bars: `ship_frames` consumer-empty %,
colony tier-1 project count, tier-1+ industry count, supplied %, waste.

## Variant under test (the reconstruction)

`surplusDrawable` gains a temporary optional `demandAnchor` argument used only by the
ordinary-donor branch (`anchor = demandAnchor ?? targetStock`, for both the margin test and the
subtrahend). The `targetStock <= 0` guard and the exporter branch are untouched — the tried edit
was a shipping no-op, so the guard cannot have moved. Call sites under test pass
`logisticsTarget` (`WAREHOUSE_COVER × real demand × anchorMult`, unfloored — the same figure the
deficit side moved to in #211); `BuildGoodState` gains a temporary optional `logisticsTarget`
field to carry it through the build planner. All edits are measuring instrument, never committed,
reverted before write-up.

## Evidence

### R0 — baseline · validity gate PASSED

Unmodified tree @ `1b4af1ba`, `npm run simulate` (600 systems, seed 42, `ECONOMY_SCALE=100`).
Every figure session 63's baseline is known by reproduces exactly. Raw excerpt, equilibrium
(10,000t / 416 cycles) unless marked:

```
Cover & price by market role (end of simulation):
Good             |   Exp n/med |  Self n/med |  Cons n/med |  Cons empty% |      Inert n |  Exp price x
electronics      |    242/0.25 |    163/0.29 |    152/0.78 |          34% |       25 (0) |         3.00
luxuries         |    212/0.25 |    154/0.49 |    150/0.81 |          37% |       66 (0) |         3.00
ship_frames      |    194/0.25 |    124/0.81 |    152/0.82 |          20% |      112 (0) |         3.00

startup (1000t):
electronics      |     19/0.30 |      1/0.17 |    193/0.83 |          36% |      130 (0) |         3.00
luxuries         |     19/0.29 |      1/0.19 |    128/0.93 |          12% |      195 (0) |         3.00
ship_frames      |     28/0.25 |      1/0.14 |     31/0.84 |           0% |      283 (0) |         3.00

Supply regimes: Supplied 209 (35.9%) | Rationing 353 (60.7%) | Shortage 20 (3.4%) | mean D 0.027
Colony build loop: with tier-1+ industry 525 | colony projects by kind: ... tier1=51 ...
Logistics: Transfers 1.1M | Quantity moved 858.5M | Systems participating 582
Founding stock: 562 colonies founded | opening satisfaction mean 0.42 | opened deprived (<0.50): 380
```

Matches the known baseline: electronics consumer 0.78 / 34% empty, luxuries 0.81 / 37%,
Supplied 209 (35.9%), tier-1+ industry 525, colony tier1 projects 51, ~1.1M transfers.

### R1 — all three callers on the demand anchor · validity gate PASSED (reproduces to the digit)

Variant applied exactly as specified above (`demandAnchor` param, ordinary-donor branch only;
matcher + build gate + founding manifest all pass `logisticsTarget`). `npm run simulate`, same
config as R0. Raw excerpt:

```
equilibrium (10,000t):
electronics      |    230/0.25 |    190/0.38 |    138/0.21 |          46% |       24 (0) |         3.00
luxuries         |    221/0.25 |    152/0.50 |    143/0.80 |          35% |       66 (0) |         3.00
ship_frames      |    184/0.25 |    131/0.80 |    153/0.82 |          34% |      114 (0) |         3.00

startup (1000t):
electronics      |     19/0.30 |      1/0.17 |    196/0.83 |          37% |      127 (0) |         3.00
luxuries         |     19/0.29 |      1/0.19 |    128/0.93 |          12% |      195 (0) |         3.00
ship_frames      |     28/0.25 |      1/0.14 |     31/0.84 |           0% |      283 (0) |         3.00

Supply regimes: Supplied 169 (29.0%) | Rationing 401 (68.9%) | Shortage 12 (2.1%) | mean D 0.030
Colony build loop: with tier-1+ industry 530 | colony projects by kind: ... tier1=31 ...
Logistics: Transfers 1.1M | Quantity moved 857.1M | Systems participating 582
Founding stock: 562 colonies founded | opening satisfaction mean 0.43 | opened deprived (<0.50): 380
```

Reproduces every session-63 under-edit figure exactly: electronics consumer **0.21 / 46% empty**
(gate: ≤ 0.35), ship_frames empty 34%, tier-1+ industry 530, colony tier1 projects 31, luxuries
0.80. Shipping unchanged (857.1M moved vs 858.5M baseline — the known no-op). Startup horizon is
essentially untouched (electronics consumer 0.83/37% vs 0.83/36% baseline): the regression is an
equilibrium phenomenon. The reconstruction is faithful; per-caller isolation is now meaningful.

### R2 — matcher donor side only · equilibrium 0.42 (above the ≤ 0.40 bar, barely)

Only the matcher call site passes `logisticsTarget`; build gate and founding manifest on the
unmodified anchor. Raw excerpt:

```
equilibrium (10,000t):
electronics      |    232/0.25 |    172/0.28 |    154/0.42 |          41% |       24 (0) |         3.00
luxuries         |    228/0.25 |    150/0.30 |    138/0.68 |          38% |       66 (0) |         3.00
ship_frames      |    188/0.25 |    124/0.82 |    156/0.82 |          33% |      114 (0) |         3.00

startup (1000t): identical rows to R1 (0.83/37%, 0.93/12%, 0.84/0%)

Supply regimes: Supplied 183 (31.4%) | Rationing/Shortage rest | mean D 0.032
Colony build loop: with tier-1+ industry 526 | colony projects by kind: ... tier1=35 ...
Logistics: Quantity moved 852.7M
Founding stock: 562 colonies founded | opening satisfaction mean 0.43 | opened deprived (<0.50): 380
```

Reading: matcher-only lands at 0.42 — above the ≤ 0.40 "another caller carries it" bar by 0.02,
but far below the 0.78 baseline: the matcher alone reproduces most of the collapse. Also moves
what the full edit did not: luxuries consumer 0.68 (R0 0.81, R1 0.80) and luxuries/electronics
self-supplier cover down to 0.30/0.28 (R0 0.49/0.29) — caller effects evidently offset each other
in R1. Build stats stay near baseline (526 vs 525 tier-1+; tier1 projects 35).

### R3 — build-planner input-supply gate only · equilibrium 0.82 → FALSIFIES the claim

Only the build gate call site passes `logisticsTarget`; matcher and founding manifest on the
unmodified anchor. Raw excerpt:

```
equilibrium (10,000t):
electronics      |    221/0.25 |    168/0.37 |    170/0.82 |          37% |       23 (0) |         3.00
luxuries         |    209/0.25 |    160/0.33 |    145/0.52 |          39% |       68 (0) |         3.00
ship_frames      |    189/0.28 |    125/0.83 |    155/0.83 |          20% |      113 (0) |         3.00

startup (1000t): baseline rows (electronics 193/0.83, 36%)

Supply regimes: Supplied 216 (37.1%) | mean D 0.031
Colony build loop: with tier-1+ industry 529 | colony projects by kind: ... tier1=41 ...
Logistics: Quantity moved 861.9M
Founding stock: 562 colonies founded | opening satisfaction mean 0.42 | opened deprived (<0.50): 380
```

Reading: 0.82 ≥ 0.60 — **the gate alone does not carry the regression; the claim is false.**
Electronics consumer cover is at/above baseline (0.78) with the gate alone changed. Oddity for the
record: build-gate-only *does* tank luxuries consumer cover (0.81 → 0.52) while leaving
electronics whole — the mirror image of what the claim predicted, and more evidence the callers
interact good-by-good rather than adding up.

### R4 — colony founding manifest only · equilibrium 0.83 · no regression

Only `planFoundingStock`'s call site passes `logisticsTarget`; matcher and build gate on the
unmodified anchor. Raw excerpt:

```
equilibrium (10,000t):
electronics      |    242/0.25 |    168/0.27 |    150/0.83 |          28% |       22 (0) |         3.00
luxuries         |    216/0.25 |    157/0.33 |    143/0.77 |          40% |       66 (0) |         3.00
ship_frames      |    201/0.27 |    111/0.81 |    157/0.82 |          25% |      113 (0) |         3.00

startup (1000t): baseline rows (electronics 193/0.83, 36%)

Supply regimes: Supplied 197 (33.8%) | mean D 0.022
Colony build loop: with tier-1+ industry 528 | colony projects by kind: ... tier1=39 ...
Logistics: Quantity moved 852.2M
Founding stock: 562 colonies founded | opening satisfaction mean 0.43 | opened deprived (<0.50): 380
```

Reading: the founding manifest alone regresses nothing (electronics 0.83, luxuries 0.77,
ship_frames 0.82/25%).

## Outcome — FALSIFIED, on two committed clauses at once

| Run | electronics cons (eq) | empty% | luxuries cons | ship_frames empty% | tier1 projects |
|---|---|---|---|---|---|
| R0 baseline | 0.78 | 34% | 0.81 | 20% | 51 |
| R1 all three | **0.21** | 46% | 0.80 | 34% | 31 |
| R2 matcher only | 0.42 | 41% | 0.68 | 33% | 35 |
| R3 build gate only | 0.82 | 37% | 0.52 | 20% | 41 |
| R4 founding only | 0.83 | 28% | 0.77 | 25% | 39 |

- **R3 tripped its bar** (0.82 ≥ 0.60): the build gate alone does not carry the regression — the
  claim's named suspect is exonerated outright.
- **The compound clause also tripped**: R1 reproduces 0.21 but no single-caller run reads ≤ 0.40 —
  the collapse as measured needs more than one caller changed together.
- R2 (0.42) sits 0.02 above its ≤ 0.40 bar. That bar was committed before the run and stands: the
  matcher alone does not formally "carry" the full collapse — but 0.78 → 0.42 is most of the
  distance, and the matcher is the only caller that moves electronics at all on its own.

```
Meaning:    The electronics collapse is not the build planner's — the logistics matcher's donor
            side carries most of it alone, and the full collapse only appears when the matcher
            changes together with another caller; the callers interact good-by-good rather than
            adding up.
Claim:      Under a demand-denominated ordinary-donor anchor, the electronics collapse is produced
            by the build planner's input-supply gate, not the matcher donor side or the founding
            manifest.
Number:     electronics consumer median cover at equilibrium — R0 0.78 · R1 (all) 0.21 ·
            R2 (matcher) 0.42 · R3 (build gate) 0.82 · R4 (founding) 0.83.
Horizon:    Both. Startup is flat across all five runs (consumer 0.83, 36-37% empty everywhere);
            the regression is equilibrium-only. Falsifier bars were equilibrium bars.
Cohort:     electronics consumer-role markets (n 138-170 by run), galaxy of 600 systems, seed 42,
            ECONOMY_SCALE=100. Secondary reads: luxuries/ship_frames consumer cohorts, colony
            build-loop stats.
Licenses:   Supports: dropping the build-gate-first theory; treating the matcher donor side as the
            primary carrier; requiring any future donor-anchor design to be tested against caller
            interaction, not per-caller in isolation. Does NOT support: a mechanism story for WHY
            the matcher change collapses electronics (unmeasured); "the build gate is harmless" in
            general (gate-only tanked LUXURIES 0.81 → 0.52, R3); reading R2's 0.42 as "the matcher
            is the whole cause"; any tuning.
```

Interaction evidence worth keeping: every single-caller run degrades *some* consumer cohort
(R2: luxuries 0.68; R3: luxuries 0.52; R4: luxuries 0.77/40% empty) yet R1 with all three leaves
luxuries at 0.80 — single-caller effects are not additive components of the full edit; they
partially cancel. Whatever mechanism is at work routes through caller interaction.

All `lib/` instrumentation was reverted before this write-up (`git checkout -- lib/`; greps for
`demandAnchor` / the instrument marker across `lib/` and `scripts/` return nothing). Raw sim
outputs for R1-R4 are in the session scratchpad only; the excerpts above are the durable record.

---

# Phase 2 — mechanism investigation

The attribution above says *where* (matcher donor side + caller interaction); this phase asks
*why*. Candidate mechanisms on the table: (1) buffer-strip — small consumers' standing stock
becomes drawable and is siphoned to worst-first deficits; (2) industry-map steering — perturbed
donor eligibility changes which tier-1+ sites get approved, compounding into a worse electronics
production topology; (3) exporter-flip cascade — input-starved producers flip off the protected
exporter branch and get drained past recovery; (4) cohort-mix artifact — the consumer median moves
because cohort membership moves. 1/4 are distribution stories, 2/3 are production stories.

## M1 claim — the first fork: production vs distribution

Under the full demand-anchor edit (all three callers, the R1 variant), the electronics collapse
is a **production collapse**: the galaxy's realized electronics production rate at equilibrium is
materially below baseline — not the same output held in different places.

## M1 falsifier, committed before any run

Instrument: `.superpowers/mechanism-diag.ts` (scratch, gitignored) — runs the real
`runWorldTick` to 10,000 ticks at the standard config (600 systems, seed 42, `ECONOMY_SCALE=100`),
snapshots every 250 ticks (per tracked good: role counts and per-role median cover via the
harness's own `computeRoleCoverLevels`, plus galaxy totals of stock / real demand / realized
production / building levels), and dumps a per-system CSV at the final frame. Tracked goods:
electronics, luxuries, ship_frames, components. Run twice: baseline (clean tree) and variant
(the R1 all-three-callers edit reapplied).

- **Validity gates** (instrument must reproduce the known R0/R1 report rows at its final frame,
  same seed and code path so digit-exact): baseline → electronics exp n 242, cons n 152, cons
  median 0.78, empty 34%; variant → 230 / 138 / 0.21 / 46%. Miss ⇒ INCONCLUSIVE — fix the
  instrument, do not reinterpret.
- **The claim is FALSE if** variant galaxy realized electronics production at t=10,000 is within
  **±10%** of baseline. (Then the distribution stories lead and the production stories 2/3 lose
  their shared premise.)
- Recorded alongside, not falsifier bars: electronics building levels (placement vs suppression:
  levels flat + production down ⇒ suppression/starvation; levels down ⇒ planner placement),
  consumer-cohort total stock, the first snapshot tick where variant consumer median cover drops
  below 0.60 (timing shape: smooth drain vs stepped), same series for luxuries/ship_frames.

### M1 result — FALSIFIED. Production is untouched; the collapse is a stalled late-game recovery

Both validity gates passed digit-exact (baseline final frame: electronics 242/0.25 · 163/0.29 ·
152/0.78 · 34%; variant: 230/0.25 · 190/0.38 · 138/0.21 · 46% — every figure matches the sim
reports). Raw series/CSVs in the session scratchpad (`mech/{baseline,variant}-{series.json,final.csv}`).

```
galaxy electronics @ t=10,000        baseline      variant       Δ
realized production rate             786,874.9     784,723.2     -0.3%   (bar was ±10%)
building levels                      2,621         2,688         +2.6%
total standing stock                 9,046,774     9,382,741     +3.7%
consumer-cohort standing stock       265,451       183,301       -31%

trajectory (electronics consumer median cover / empty%):
t=       5000   6000   7000   7500   8000   8500   9000   9500   10000
base     0.00   0.00   0.00   0.12   0.33   0.20   0.25   0.67   0.78
         /88%   /75%   /58%   /49%   /41%   /47%   /44%   /36%   /34%
variant  0.00   0.00   0.00   0.00   0.00   0.00   0.00   0.00   0.21
         /90%   /90%   /86%   /82%   /80%   /71%   /63%   /54%   /46%
consStock: base 43K→265K over the window; variant held at 21-87K until t~9000 (5-10x below)
```

Three findings on top of the falsification:

1. **Baseline 0.78 is not a steady state — it is a late-arriving recovery.** Baseline electronics
   consumers sit at ~0 cover, 80-90% empty, for the entire mid-game; shelves fill only from
   t≈7,000 on the back of a 13x production ramp (levels 137 → 2,621). The variant tracks the
   identical curve until t≈5,500, then stalls ~2,000+ ticks behind: at t=10,000 it sits where
   baseline was at t≈8,000-8,500, still rising. "0.78 vs 0.21" is two phases of the same curve.
2. **The depressed consumers are ABOVE-floor markets.** `WAREHOUSE_COVER` = `TARGET_COVER` = 40,
   so the two anchors are identical wherever real demand clears `MIN_DEMAND` — the edit perturbs
   below-floor markets only. Final-frame CSV split: the electronics consumer cohort is ~99%
   above-floor in both runs (151/152 and 136/138; median pop ~135 vs the ~50-pop floor threshold).
   Baseline above-floor consumers rest at fill 0.80 of the warehouse target — exactly the
   DEFICIT_FRACTION line, which is what "healthy 0.78" is. The variant's depressed consumers are
   markets whose own thresholds the edit does not touch: the starvation is imposed upstream.
3. Production stories (2: industry-map steering, 3: exporter-flip cascade) are dead at the galaxy
   scale: production, levels, and total stock are all at-or-above baseline. The mechanism is pure
   distribution: the same goods exist and consumers do not receive them for thousands of ticks.

## M2 claim — delay vs standing drain

The variant does not lower the electronics consumer equilibrium — it delays it. Run past 10,000
ticks, the variant consumer cohort continues along baseline's recovery curve to baseline's resting
level (the deficit line, ~0.78-0.82) instead of plateauing below it.

## M2 falsifier, committed before any run

Instrument: extended `mechanism-diag.ts` — both runs to 16,000 ticks, same snapshots, plus two
flow-composition windows (t=5,000-5,500 and t=12,000-12,500) aggregating `flowEvents` per window:
haul quantity sourced from below-floor donors vs above-floor, electronics quantity delivered into
consumer-role markets, and churn (system,good) pairs appearing as both source and sink within one
window. Endpoint classification uses a floor-status map refreshed every 50 ticks (post-tick state;
floor status drifts slowly — noted instrument caveat, composition aggregates only).

- **Validity gate:** each extended run must reproduce its own 10,000-tick final frame digit-exact
  at t=10,000 (deterministic same-seed prefix). Miss ⇒ INCONCLUSIVE, instrument fault.
- **The claim is FALSE if** at t=16,000 the variant electronics consumer median cover is ≤ 0.60,
  **or** the t=12,000→16,000 trend is flat (Δ < +0.05 across the window) while still below 0.70.
  Either reading means a standing drain holds the cohort down and the churn mechanism is the
  live suspect.
- Control prediction, recorded: baseline rests at ~0.78-0.82 (the deficit line) from t=10,000 on;
  materially exceeding it would mean the resting-state story of finding 2 is wrong.
