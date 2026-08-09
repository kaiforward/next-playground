# Measure: is `patchLogisticsMarketRows` observationally inert?

Standalone measurement for a mutation fix-wave flag (2026-08-09 batch, world cluster, 24 mutants).
The fix-wave agent found that replacing the whole function with a passthrough left a 200-tick,
90-system world byte-identical. That read is one seed inside the startup transient; deleting a
piece of the shared tick body on it would be a "ruled out" below the evidence bar.

## Claim

Replacing `patchLogisticsMarketRows` (lib/world/tick.ts:354) with a passthrough of its unpatched
`bySystem` input produces a byte-identical world state at BOTH horizons (1,000 and 10,000 ticks)
on every seed tested.

## Falsifier

Committed before any instrument runs:

> If ANY seed at ANY horizon produces a world-state hash that differs between the live function
> and the passthrough, the claim is false — the function is live, the 24 flagged mutants stay
> accepted-as-untestable-at-this-scale rather than dead-code, and deletion is off the table.

Secondary discrimination (this is the part the end-state hash alone cannot see):

> A same-tick counter inside the function records how often it actually alters a row that
> directed-build then reads. If the counter is >0 while the A/B hashes stay identical at both
> horizons, the function is LIVE BUT MASKED — its effect is being erased downstream — and the
> finding is a possible bug, not dead code. If the counter is 0 everywhere, the function's
> patch condition simply never fires, and the question becomes why (cadence phasing?).

Plan: A-A determinism validation first (same seed, live function, twice — hashes must match, else
the instrument is invalid); then A/B at seeds 42 and 1337, hashes at tick 1,000 and 10,000, with
the fire-counter recorded per run.

## Evidence

```
Meaning:    patchLogisticsMarketRows is load-bearing — removing it changes the galaxy's evolution
            within the first 1,000 ticks on every seed tested; the fix-wave "inert" reading was an
            artifact of a 200-tick window in which the patch never fired with changed values.
Claim:      Replacing patchLogisticsMarketRows with a passthrough produces a byte-identical world
            at BOTH horizons on every seed tested.
Number:     Live-vs-passthrough world hashes DIFFER at every checkpoint on both seeds; the
            function fires 398 times per 10k ticks, changing ~232-245k row values.
Horizon:    startup (1,000t) AND equilibrium (10,000t) — divergence already present at 1,000t.
Cohort:     whole-world SHA-1 (all systems, markets, buildings, projects), 90-system galaxy,
            seeds 42 and 1337.
Licenses:   Supports: keeping the function; rejecting the dead-code reading; re-classifying the
            24 flagged mutants as accepted (killable only at simulation scale — a value-changing
            same-tick logistics update ahead of a build decision needs a full-pipeline world).
            Does NOT support: any claim about gameplay-visible magnitude (a hash flips on any
            divergence, however small); nor a fault in the fix-wave fixture on its own terms —
            its 200-tick window genuinely was byte-identical, because the patch condition first
            fires with changed values later than that.
```

Raw output (verbatim; A/B arms differ only in the function's return, counters computed
identically in both arms):

```
RUN seed=42 systems=90 ticks=10000 arm=LIVE      (run A)
CHECKPOINT t=1000  hash=aa0310cf69e2a44586633322ce8ab398820092ae entered=23  rowsChanged=15853
CHECKPOINT t=10000 hash=9f1629aa1eb449c11199298a38919976193fe952 entered=398 rowsChanged=232401

RUN seed=42 systems=90 ticks=10000 arm=LIVE      (run B — A-A determinism validation)
CHECKPOINT t=1000  hash=aa0310cf69e2a44586633322ce8ab398820092ae entered=23  rowsChanged=15853
CHECKPOINT t=10000 hash=9f1629aa1eb449c11199298a38919976193fe952 entered=398 rowsChanged=232401

RUN seed=42 systems=90 ticks=10000 arm=SKIP
CHECKPOINT t=1000  hash=6a33bda24605e0d474dd18c70f0283aac5e400e5 entered=23  rowsChanged=15861
CHECKPOINT t=10000 hash=f5f4294fc9505d3208ecd8f0ae11b7ee20e53393 entered=398 rowsChanged=232438

RUN seed=1337 systems=90 ticks=10000 arm=LIVE
CHECKPOINT t=1000  hash=1e9416e93786428b4d665faf15fa0363dfc552e1 entered=23  rowsChanged=16075
CHECKPOINT t=10000 hash=e1c910fb6a475e65b3521ea4f7698d4a71f09913 entered=398 rowsChanged=244816

RUN seed=1337 systems=90 ticks=10000 arm=SKIP
CHECKPOINT t=1000  hash=56735a818bbfb5592dfbdce83f6480789e03467f entered=23  rowsChanged=16102
CHECKPOINT t=10000 hash=7cd16e7db277161790a2681ad50bd366c2fb8225 entered=398 rowsChanged=233951
```

Instrument validation: A-A pair identical at both checkpoints (determinism holds; hash includes
no volatile field). Counters match across arms up to divergence, as constructed. Instrument:
`temp/patch-inert-diag.ts` + a DIAG_PATCH_HOOK in lib/world/tick.ts, reverted the same turn
(grep-verified absent from lib/ and scripts/).

## Outcome

**Falsified.** The function stays. The 24 flagged mutants in the world ledger are re-classified
ACCEPTED — killable only at simulation scale; pointer to this file. This measurement cost one
scratch diagnostic instead of a deleted load-bearing function.
