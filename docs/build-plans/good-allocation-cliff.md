# Good-allocation cliff — measure

Working file for the roadmap row "Good-allocation cliff — how logistics splits a scarce good across
demanding systems". Evidence only; no design here.

## Claim

When a faction's reachable drawable stock of a good is smaller than the summed shortfall of its
deficit systems in that good (a *scarce group*: one faction, one good, one logistics run), the
matcher fills deficits worst-first to their full `WAREHOUSE_COVER` (40-cycle) target, so within the
group at most one deficit receives a partial fill and every deficit behind it in the queue receives
nothing — and the tonnage actually placed in that group, spread evenly over the group's deficits,
would have put the zero-fill deficits above the `RATION_COVER` (2-cycle) line at which per-good
satisfaction reads 1.

Two halves, both about current behaviour, both read inside `matchFactionTransfers`:

- **A (fill shape).** In scarce groups, ≤ 1 partially-filled deficit per group and ≥ 1 zero-fill
  deficit whose reachable donors held drawable stock at the start of the run (drained, not
  stranded).
- **B (counterfactual reach).** Even-spread tonnage per deficit ≥ `RATION_COVER × demand` for the
  zero-fill deficits.

## Falsifier (committed before the instrument ran)

Read at **both** 1,000 and 10,000 ticks (plus 16,000, because 10K sits inside the founding
transient for late goods), 600 systems, seed 42.

- **A is false** if, over scarce groups at a horizon, the median number of partially-filled
  deficits per group exceeds 1, **or** fewer than half of scarce groups contain a zero-fill deficit
  whose reachable donors held drawable stock pre-run. Then the matcher is not producing a
  one-partial-then-zero cliff and the roadmap row's hypothesis is dead.
- **B is false** if, at both horizons, fewer than 25% of drained zero-fill deficits would clear
  `RATION_COVER × demand` under even spread of the group's placed tonnage. Then the cliff is
  scarcity, not allocation — an allocation policy could not move satisfaction — and the row goes
  back to brainstorm.
- **Confirmed** needs both A and B to survive at both horizons.

Descriptive companion (no kill-line): the per-good `satisfaction` histogram on developed worlds
below full Provision at each horizon, split by whether the market's stock is exactly 0 — to say how
much of the observed 0/1 bimodality is the satisfaction formula (0 stock ⇒ 0) rather than fill
shape.

## Instrument

Scratch hook inside `matchFactionTransfers` (`lib/engine/directed-logistics.ts`), recording one row
per deficit visited: run tick, faction, good, system, shortfall, use demand, filled quantity,
reachable drawable at visit (live), reachable drawable pre-run (donors' opening figure), budget-
stopped flag. Runner `temp/allocation-cliff-diag.ts` groups rows per (run, faction, good) and reads
A and B; it also snapshots the satisfaction histogram from persisted market rows at each horizon.
Validation: Σ filled per run must equal Σ `PlannedTransfer.quantity` the same run returns (hook vs
return value), and Σ filled over the flow window must sit within the in-flight lag of Σ delivered
`flowEvents` volume (the log's single writer).

The hook is reverted the same turn it is read.

## Evidence

(pending)
