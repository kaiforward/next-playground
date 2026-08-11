# Provision band edges — where the labels should cut

The Provisioned axis currently carries three descriptive ranges (Supplied ≥ 0.90, Strained
[0.70, 0.90), Rationing < 0.70) plus Shortage, a survival punch-through that owns no span of the
axis. `SUPPLIED_PROVISION`'s docstring states, and `npm run impact -- RATIONING_PROVISION`
confirms, that no gameplay effect reads the band: the edges are legibility lines only, and the
only non-display reader is the classifier that assigns the word.

That freedom is the problem. Rationing owns 70% of the bar's width and says the same thing about a
world at 65% as about one at 5%. The owner's rule for re-cutting: **put the edges where the
mechanics underneath change character** — the labels do not drive the mechanics, but the mechanics
drive the number the labels are derived from.

The supply→unrest math has exactly one discontinuity (`lib/engine/population.ts:311-327`). The
grievance channel is linear in `expectation − provision` with no special values. The crisis channel
reads exactly zero until a survival good falls below `SHORTAGE_SATISFACTION` or some good falls
below `CRITICAL_SATISFACTION`, at which point unrest stops answering to memory and answers to
absolutes. Both triggers are **per-good**, so their position on the Provision axis is statistical,
not algebraic — which is what this measurement is for.

## Claim

Worlds with the crisis channel firing (survival shortfall, or `criticalWeight > 0`) occupy a
distinct low range of the Provision axis — separated from non-crisis worlds sharply enough to place
a band edge on the boundary — at both horizons.

## Falsifier

Written before any instrument ran.

If, at **either** horizon, the crisis and non-crisis cohorts overlap broadly across the axis — the
crisis cohort's interquartile range spanning more than half the axis, **or** the two cohorts'
medians differing by less than 0.15 Provision — then Provision carries no natural mechanical edge,
the claim is false, and band cuts must be chosen on legibility grounds alone rather than presented
as tracking a change in the mechanics.

Secondary reading, same run, no separate falsifier: the Provision value at which settled unrest
(`floor + supply term`, capped at 1) crosses the strike threshold. If that crossing is spread across
more than 0.2 of the axis it is a band of its own, not a line, and cannot anchor an edge either.

## Instrument

Scratch runner in `temp/` (gitignored), reading the persisted per-system state after a real
`runWorldTick` run at 1000 and 10,000 ticks. No hook patched into `lib/`: `provision`,
`supplyBand`, `criticalWeight` and `unrest` are all already persisted on the system
(`lib/world/types.ts`), and `supplyBand === "shortage"` is a strict biconditional with
`survivalShortfall`, so the survival bit is recoverable from the band. Cohorted by world cohort and
by crisis-channel state; both horizons read, per the both-horizons rule.

## Evidence

Instrument: `temp/provision-edge-diag.ts` (scratch, gitignored). 600 systems, seed 42,
`ECONOMY_SCALE=100`, one continuous run snapshotted at 1000 and 10,000 ticks. No hook was patched
into `lib/` — every quantity read is already persisted per system — so there is no instrumentation
to revert. Validation passed at both horizons before any figure below was read: band↔provision
coherence mismatches 0, shortage-banded rows missing `criticalWeight` 0, crisis cohort non-empty,
assessed-vs-developed 92.9% at startup and 100% at equilibrium.

### Reading 1 — the crisis channel's position on the axis

```
Meaning:    The crisis channel does not mark a place on the Provisioned axis. It fires on worlds
            spread across almost the whole axis, most of them fully provisioned, so its trigger
            cannot anchor a band edge.
Claim:      Worlds with the crisis channel firing occupy a distinct low range of the Provision
            axis, separated from non-crisis worlds sharply enough to place a band edge.
Number:     Cohort median gap 0.019 (startup) and 0.034 (equilibrium) — the falsifier's line was
            0.15. Crisis-cohort median Provision 0.981 / 0.966; silent-cohort median 1.000 / 1.000.
Horizon:    Both. Startup 1000t and equilibrium 10,000t agree, and neither is marginal.
Cohort:     All assessed systems (235 at startup, 582 at equilibrium), split by crisis-channel
            state; re-split at median population as a mix guard, which agreed (crisis median
            Provision 0.915/0.989 startup, 0.967/0.926 equilibrium across the two halves).
Licenses:   Kills the idea of cutting a band where the crisis trigger fires. Says nothing about
            where the crisis channel BITES — the trigger is binary, the effect is not (Reading 2).
            Does not license any claim about famine worlds specifically: only 4 and 7 of them exist
            at the two horizons.
```

Raw, both horizons:

```
STARTUP (1000 ticks)
  crisis channel firing      147  (62.6%)
    · survival shortfall     4  (1.7%)
    · criticalWeight only    143  (60.9%)
  crisis firing:  n=147  min 0.000  p25 0.780  MEDIAN 0.981  p75 0.989  max 0.996
  crisis silent:  n=88   min 0.984  p25 1.000  MEDIAN 1.000  p75 1.000  max 1.000
  crisis-cohort IQR width: 0.209   falsified if > 0.5   survives
  cohort median gap:       0.019   falsified if < 0.15  *** FALSIFIED ***

EQUILIBRIUM (10000 ticks)
  crisis channel firing      217  (37.3%)
    · survival shortfall     7  (1.2%)
    · criticalWeight only    210  (36.1%)
  crisis firing:  n=217  min 0.443  p25 0.888  MEDIAN 0.966  p75 0.988  max 1.000
  crisis silent:  n=365  min 0.861  p25 1.000  MEDIAN 1.000  p75 1.000  max 1.000
  crisis-cohort IQR width: 0.100   falsified if > 0.5   survives
  cohort median gap:       0.034   falsified if < 0.15  *** FALSIFIED ***
```

### Reading 2 — what actually varies along the axis

```
Meaning:    The consequences of low Provision rise smoothly along the axis rather than switching on
            anywhere. There is no mechanical cliff to anchor an edge to — but the outcomes do change
            character across the middle of the axis, from quiet, through visibly strained, to
            striking.
Claim:      (secondary reading, no separate falsifier) The Provision value at which settled unrest
            crosses the strike threshold.
Number:     10%→90% striking spread 0.379 of the axis — a band, not a line. Cumulative striking
            share reaches 0.9 below Provision 0.534, 0.5 below 0.799, 0.1 below 0.913. Mean unrest
            by Provision bin at equilibrium: 0.123 (0.9-1.0), 0.322 (0.8-0.9), 0.472 (0.7-0.8),
            0.604 (0.6-0.7), 0.882 (0.5-0.6), 0.872 (0.4-0.5).
Horizon:    Both taken; only equilibrium is informative — zero systems were striking at 1000 ticks.
Cohort:     All assessed systems. NOTE the low bins are thin at equilibrium: 2, 6, 4 and 5 systems
            in 0.4-0.5 through 0.7-0.8, against 512 in 0.9-1.0.
Licenses:   Supports the shape of the gradient — that consequence rises steadily with the shortfall
            and becomes strike-grade somewhere in the 0.5-0.7 region. Does NOT support any specific
            edge value: the bins that would place one hold single-digit system counts, and 8
            striking systems total is a churn-prone reading (judge over a trailing window before
            tuning anything to it). Startup licenses nothing here at all.
```

Raw, equilibrium:

```
BY PROVISION BIN  (strike threshold unrest > 0.65):
  bin        n     crisis%   survival%  absWin%   meanCrisisT  meanGrievT  meanUnrest  striking%   medianPop
  0.4-0.5      2    100.0%     100.0%   100.0%        1.306       0.429       0.872     100.0%         74
  0.5-0.6      6    100.0%      83.3%   100.0%        1.060       0.169       0.882      83.3%         59
  0.6-0.7      4    100.0%       0.0%   100.0%        0.549       0.102       0.604      25.0%       1192
  0.7-0.8      5    100.0%       0.0%   100.0%        0.395       0.032       0.472       0.0%        188
  0.8-0.9     53     98.1%       0.0%    98.1%        0.215       0.022       0.322       0.0%        195
  0.9-1.0    512     28.9%       0.0%    28.9%        0.014       0.002       0.123       0.0%       2356

STRIKE TRANSITION (cumulative from the low end):
  striking rows in this snapshot: 8 (1.4%)
  share ≥ 0.1 holds up to provision 0.913
  share ≥ 0.5 holds up to provision 0.799
  share ≥ 0.9 holds up to provision 0.534
  10%→90% spread: 0.379   "a band not a line" if > 0.2   BAND
```

### Why the trigger and the effect disagree

`supplyUnrestTerm` takes the larger of a memory-relative reading and an absolute one, and the
absolute one is scaled by `d = 1 − Provision` (`lib/tick/processors/population.ts:97,100`). So a
world at 0.99 Provisioned with one good collapsed fires the crisis channel and contributes
`~0.01 × slope` — firing, biting nothing. The binary trigger lands all over the axis; the term it
produces is continuous in Provision. Measured: the absolute channel wins the `max()` on 100% of
crisis-firing rows at both horizons, so in practice the crisis channel governs and the memory
channel is near-zero wherever it fires (median grievance term 0.000 at both horizons).

**Approximation stated rather than hidden:** the grievance figures recompute `readExpectation` from
the persisted (already advanced) expectation, while the tick reads cycle-start memory. That is one
cycle's advance out of date — directionally sound, not exact. It does not affect Reading 1, and in
Reading 2 it can only understate the memory channel, which is already the losing one.

## Outcome

**Falsified.** The claim that the crisis trigger marks a place on the Provisioned axis is dead at
both horizons, and cheaply — one measurement instead of a band edge cut in the wrong place.

Direction, one sentence and no further: since consequence rises smoothly with the shortfall rather
than switching on, the edges are a legibility choice after all, and the evidence supports spacing
them across the range where outcomes visibly change (roughly 0.5 to 0.9) rather than leaving 70% of
the axis under one word.
