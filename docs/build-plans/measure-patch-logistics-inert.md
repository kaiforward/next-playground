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

(recorded after the runs)
