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

### Raw output

(appended after the run)
