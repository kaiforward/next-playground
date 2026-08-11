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

Not yet taken.
