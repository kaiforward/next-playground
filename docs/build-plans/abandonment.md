# Abandonment — working file

Transient working file for ROADMAP item 6's abandonment step (design context:
[supply-response.md](../planned/supply-response.md), "Struck worlds resolve"). Currently carries the
prerequisite measurement: **are the stuck worlds starving and shrinking, or fed and just small?**
Deleted when the item ships.

## Evidence

### Claim (pre-registered, before the instrument ran)

The stuck worlds at equilibrium — the chronically striking cohort and the parked pop 10–100
worlds — are **fed and just small**: held at near-constant population by the housing crowd brake,
not starving (their supply shortfall D is small) and not in sustained decline.

This is the supply-response doc's own untested "crowd-brake equilibrium" hypothesis, stated as a
claim so it can lose.

### Falsifier (committed before the instrument ran)

The claim is **false** if, at equilibrium (t = 10,000), **any** of:

1. ≥ 50% of the chronically striking cohort reads D ≥ 0.10 while crowdFactor > 0.9 — growth cut by
   shortfall with housing not binding (a starving fixed point);
2. the chronically striking cohort's median trailing-window population change ≤ −5% — they are
   shrinking, not parked;
3. ≥ 50% of the parked pop 10–100 cohort is shortfall-held rather than crowd-held (definitions
   below).

Falsified means: the stuck worlds are starving and/or shrinking, the crowd-brake explanation is
dead, and abandonment designs against a live dying cohort.

### Pre-registered definitions and conditions

- **Conditions:** 600 systems, seed 42, `ECONOMY_SCALE` 100 (the defaults — Gate 2 conditions).
  Horizons: startup t = 1,000 and equilibrium t = 10,000; both are read, the claim is judged at
  equilibrium (what parks a world is a steady-state question; startup is read alongside for the
  founding story).
- **Trailing window:** last 50 cycles (1,200 ticks) before the equilibrium horizon, last 25 cycles
  before the startup horizon, sampled once per cycle (`CYCLE_LENGTH` 24).
- **Chronically striking:** unrest ≥ `STRIKE_PARAMS.threshold` (0.65) in ≥ 80% of trailing-window
  samples — the trailing-window rule, because instantaneous striking count is churn, not health.
- **Parked:** |net population change| < 2% across the trailing window, and present (pop > 0) at the
  window start — a world founded inside the window is growing, not parked.
- **Binding growth brake** (read at the horizon): cf = `crowdFactor(pop, popCap, 1.15)`;
  sf = 1 − D, with D from the harness's own `perSystemSupplyState` fold (the same read Gate 2's
  numbers came from). **Crowd-held:** cf < sf and cf < 0.95. **Shortfall-held:** sf < cf and
  sf < 0.95. **Unbraked:** both ≥ 0.95.
- **Starving:** D ≥ 0.10 (Provision below the Supplied line). **Sustained decline:** trailing-window
  net change ≤ −5%.
- **Secondary readings** (recorded, not claim-bearing): the viability raw-field distribution over
  the stuck cohorts — total extractor slot cap, arable slots, habitable space — as input to the
  future `canSustainItself` predicate; emptied count (pop < 1) and popCap ≈ 0 count, both horizons.

### Instrument validation anchors (pre-registered)

Same seed and conditions as Gate 2, so before reading anything the instrument must roughly
reproduce: settled ≈ 582 at equilibrium, instantaneous striking ≈ 15 (2.6%), regime split
≈ 89.3 / 7.0 / 0.7 / 2.9 (Sup/Str/Rat/Sho). Approximate, because HEAD carries post-Gate-2 review
fixes; a mismatch beyond a few systems means suspect the instrument first.

### Reading (2026-08-10, instrument `temp/stuck-worlds-diag.ts`, gitignored)

```
Meaning:    The fork was a false dichotomy. The chronically striking worlds are starving but NOT
            shrinking — permanent famine worlds held at exactly their housing cap by conserved
            colonist inflow replacing their dead every cycle — while the broader parked
            small-world cohort is mostly fed and crowd-held, exactly as the hypothesis said. A
            decline-keyed abandonment trigger would never fire on today's galaxy.
Claim:      Stuck worlds are fed and just small — crowd-brake-held, not starving, not declining.
Number:     F1: 11/11 (100%) chronic strikers read D ≥ 0.10 with crowdFactor > 0.9 — falsifies
            (threshold ≥50%). F2: their median trailing-window trend −0.00% — holds (≤ −5%
            falsifies). F3: parked pop 10–100 shortfall-held 10/49 = 20.4% — holds (≥50%
            falsifies). Verdict: FALSIFIED on F1.
Horizon:    both. Startup (t=1,000): zero chronic strikers, zero parked small worlds — the
            phenomenon does not exist yet (founding cohort still growing). Equilibrium
            (t=10,000): everything below. Claim judged at equilibrium as pre-registered.
Cohort:     chronic strikers (unrest ≥ 0.65 in ≥80% of 50 trailing cycle samples): n=11 of 582
            settled. Parked pop 10–100 (|trend| < 2%): n=49. Stuck union: n=51. Seed 42, 600
            systems, scale 100 — one galaxy's draw.
Licenses:   SUPPORTS: (1) a sustained-physical-decline abandonment trigger never fires today —
            the decline it would watch for is continuously masked by refill; (2) the strikers
            are permanent famine worlds (D 0.48–0.58, Shortage regime, unrest pinned at 1.00,
            pop == popCap exactly, all with slotArable = 0); (3) the modal parked small world is
            healthy (39/49 crowd-held, median D 0.051) — "parked" alone is not a defect; (4) the
            drafted three-way canSustainItself test (no deposits ∧ no arable ∧ nothing to build
            on) marks 0 of 51 stuck worlds — every one has deposits (extractor slots 130–1,048)
            and habitable space (2.3–11.3); the discriminating lack is arable alone (51/51).
            DOES NOT SUPPORT: which inflow path does the refilling — colonist delivery vs
            migration is unattributed (both are headroom-capped, which is why refill stops at
            exactly popCap; delivery's ascending-population water-fill with no provision/unrest
            gate is the shape that matches, receipt below). Does not license calling the
            strikers unviable — they have deposits and space; their famine is a logistics
            outcome (no local food, imports failing), not "nothing there". Does not license any
            unviable-world count (the predicate is still undesigned). Band shares from this run
            are not quotable as the galaxy state (validation note below).
```

**Mechanism receipts** (the arithmetic behind Meaning): at the strikers' readings,
`populationDelta` (`lib/engine/population.ts`) nets growth 0.015·pop·1.00·(1−≈0.5) ≈ +0.75%/cycle
against decline 0.015·pop·1.00 = −1.5%/cycle → ≈ −0.75%/cycle intrinsic, ≈ −31% over the 50-cycle
window; observed −0.00%. The refill paths are conserved and headroom-capped: `allocateColonists`
water-fills each faction's pool across developed systems by ascending population, capped by
`popCap − population`, with no provision/unrest/viability gate
(`lib/engine/colonist-delivery.ts:97-135`); migration is `destHeadroom`-gated
(`lib/engine/migration.ts`). Housing decay never tears below occupancy
(`lib/engine/infrastructure-decay.ts:157-162`), so popCap tracks pop — jointly pinning pop at
exactly popCap. Net effect: each striker consumes ~0.75%/cycle of its population in colonists
drawn from healthy worlds, forever.

**Validation:** startup anchors matched near-exactly (settled 253 vs Gate 2's 253; regimes
81.4/7.1/9.9/1.6 vs 80.6/7.9/9.9/1.6) and equilibrium settled matched exactly (582). Equilibrium
regime mix deviates (Strained 11.3% vs 7.0%; striking-now 12 vs 15): Gate 2 measured the
pre-review arm, and three major review fixes landed between that measurement and the shipped
merge, so drift is expected. The claim verdict rests on per-world attribution, not band shares;
this run's band shares should not be quoted as the galaxy state.

### Raw output (verbatim)

```
scale=100 systems=600 seed=42 ticks=10000 cycle=24 strikeT=0.65 brakeEnd=1.15

STARTUP — t=1000, window [400, 1000], 25 cycle samples
VALIDATION: settled=253 (readings 253)  striking-now=0 (0.0%)
  regimes: Sup 81.4%  Str 7.1%  Rat 9.9%  Sho 1.6%
  emptied (pop<1)=0  popCap≈0 with pop>0=0
CHRONIC STRIKERS (striking in ≥80% of window samples): n=0
PARKED (|window trend| < 2%, present at window start): n=11 of 253 settled
  pop >=1K     n= 11  crowd-held   8  shortfall-held   0  unbraked   3  median r=1.03  median cf=0.88  median D=0.000  median unrest=0.07
PARKED pop 10-100 detail: n=0
FALSIFIER LINES (STARTUP): F1 0/0  F2 NaN  F3 0/0 → claim holds on this horizon

EQUILIBRIUM — t=10000, window [8800, 10000], 50 cycle samples
VALIDATION: settled=582 (readings 582)  striking-now=12 (2.1%)
  regimes: Sup 86.3%  Str 11.3%  Rat 0.2%  Sho 2.2%
  emptied (pop<1)=0  popCap≈0 with pop>0=0

CHRONIC STRIKERS (striking in ≥80% of window samples): n=11
  name                         pop    popCap      r     cf      D      P unrest   trend%  strk%      held    regime xslots arable    habit
  Cascade-2                   20.0      20.0   1.00   1.00  0.480  0.520   1.00    -0.00    100 shortfall  shortage  477.9      0      2.4
  Aegis-4                     20.0      20.0   1.00   1.00  0.492  0.508   1.00    -0.00    100 shortfall  shortage  177.5      0      3.2
  Aegis-5                     20.0      20.0   1.00   1.00  0.492  0.508   1.00    -0.00    100 shortfall  shortage  367.9      0      4.2
  Aegis-18                    20.0      20.0   1.00   1.00  0.503  0.497   1.00    -0.00    100 shortfall  shortage  130.5      0      2.3
  Nexus-3                     20.0      20.0   1.00   1.00  0.480  0.520   1.00     0.00    100 shortfall  shortage  207.0      0      3.7
  Nexus-8                     20.0      20.0   1.00   1.00  0.480  0.520   1.00     0.00    100 shortfall  shortage  854.6      0      6.5
  Nexus-12                    20.0      20.0   1.00   1.00  0.480  0.520   1.00     0.00    100 shortfall  shortage  319.4      0      5.7
  Citadel-16                  20.0      20.0   1.00   1.00  0.497  0.503   1.00     0.00    100 shortfall  shortage  504.8      0      2.7
  Citadel-15                  79.9      80.0   1.00   1.00  0.582  0.418   1.00    -0.07    100 shortfall  shortage  707.3      0      4.0
  Solace-29                  100.0     100.0   1.00   1.00  0.582  0.418   1.00     0.04    100 shortfall  shortage 1047.6      0      6.0
  Solace-20                  219.7     220.0   1.00   1.00  0.496  0.504   1.00    -0.12    100 shortfall  shortage  969.1      0     11.3

PARKED (|window trend| < 2%, present at window start): n=482 of 582 settled
  pop 10-100   n= 49  crowd-held  39  shortfall-held  10  unbraked   0  median r=1.10  median cf=0.22  median D=0.051  median unrest=0.20
  pop 100-1K   n=100  crowd-held  96  shortfall-held   4  unbraked   0  median r=1.11  median cf=0.19  median D=0.020  median unrest=0.17
  pop >=1K     n=333  crowd-held 332  shortfall-held   1  unbraked   0  median r=1.12  median cf=0.09  median D=0.000  median unrest=0.09

PARKED pop 10-100 detail: n=49
  starving (D≥0.10): 18 (36.7%)
  striking chronically: 9

VIABILITY RAW FIELDS over stuck (chronic ∪ parked 10-100): n=51
  no extractor slots: 0   no arable: 51   habitable ≤ 0: 0   all three: 0

FALSIFIER LINES (EQUILIBRIUM):
  F1 chronic strikers with D≥0.10 ∧ cf>0.9: 11/11 = 100.0%  (falsifies at ≥50%)
  F2 chronic strikers' median window trend: -0.00%  (falsifies at ≤ −5%)
  F3 parked 10-100 shortfall-held: 10/49 = 20.4%  (falsifies at ≥50%)
  → EQUILIBRIUM: CLAIM FALSIFIED on this horizon
```

### Outcome

**Falsified** (on F1; F2 and F3 held). The stuck worlds are neither of the fork's two answers: the
strikers are **starving and perpetually refilled**, the parked small cohort is fed and crowd-held.
Direction, one sentence, for the spec to own: abandonment's trigger cannot key on population
decline (the delivery/migration pump masks it structurally) — the design has to either gate the
pump away from doomed worlds or key on sustained famine-state directly, and the three-way
viability test as drafted identifies none of the worlds actually stuck.

Open follow-up measurement if the spec needs it: attribute the refill between colonist delivery
and migration (needs a processor hook counting per-system inflow by path).
