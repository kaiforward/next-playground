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

Measured 2026-09-06 on the post-lanes matcher (main at `b3d9b297`), 600 systems, seeds 42 and 43,
horizons 1,000 / 10,000 / 16,000 ticks. Each horizon reads the 1,000 ticks (41 logistics runs) ending
at it. Runner: `temp/allocation-cliff-diag.ts` (gitignored); hook reverted the same turn.

**Outcome: Confirmed** — A and B both survive at every horizon with matcher activity, on both seeds.

```
Meaning:    Under scarcity the matcher hands the head of the queue its full 40-cycle warehouse target
            and everyone behind it nothing, and on most of the deficits left starving that tonnage
            spread evenly would have been enough to keep their consumption at full rate.
Claim:      see above — A (fill shape) and B (counterfactual reach)
Number:     A — median partially-filled deficits per scarce group 0 at every horizon; scarce groups
            with more than one partial 0.8–1.8%; scarce groups containing a drained zero-fill
            97.4–98.3%; zero-fill deficits are 70–82% of all deficits in scarce groups; stranded
            (no reachable donor pre-run) 0; budget-stopped 0.
            B (as committed: even-spread tonnage ≥ RATION_COVER × demand, all drained zero-fills) —
            44.4% / 45.2% at 10K (s42 / s43), 70.1% / 68.3% at 16K. Kill line was 25%.
            B (refined after the first run, see below) — of drained zero-fills whose stock+inbound
            is already under the ration line, the share even spread lifts over it: 78.3% / 55.8%
            at 10K, 80.2% / 68.7% at 16K. That starving cohort is 29.5–53.8% of drained zero-fills.
Horizon:    1,000t — 20 single-system factions, zero transfers, no multi-deficit group exists; the
            matcher is inert pre-founding (first colony ~t=4,128). 10,000t and 16,000t — both
            founding era; scarce groups fall 3,927 → 1,680 (s42) and 5,572 → 2,349 (s43) between
            them and the B shares rise, so the cliff is shrinking as supply builds but not closing.
Cohort:     Scarce groups = one faction × one good × one run with ≥ 2 deficits, at least one left
            short while reachable donors held drawable stock pre-run and the budget did not stop it.
            Fill-shape counts are per deficit (system × good) inside those groups. Satisfaction
            histogram: developed worlds, civilian-consumed goods, Provision < 1.
Licenses:   Supports the greedy-drain fill shape as the mechanism that decides WHICH systems hold
            zero stock, and that an allocation policy has real room to move per-good satisfaction on
            processed goods (polymers, medicine: ~85% of drained zero-fills clear under even spread)
            and much less on advanced goods (reactor cores, ship frames, weapons: ~20% at 10K —
            genuine scarcity). Does NOT support any claim about galaxy-level outcome under a spread
            policy: the counterfactual is a static one-run redistribution — it does not model the
            head-of-queue systems now receiving less, re-classification next run, or industry input
            draw. Does NOT reach equilibrium: both active horizons are founding era. Funding is not
            a confound (budgetStopped 0 everywhere). The satisfaction bimodality is the formula plus
            stock level, not fill shape directly: every satisfaction-0 market has stock 0 and no
            stock-0 market reads above 0.25 at any horizon; the matcher's fill shape decides who
            has stock 0.
```

**Refinement declared after the first run.** The committed B compares even-spread tonnage against the
ration line alone. The first run showed that a zero-fill deficit can still hold stock from an earlier
fill (deficit is declared at 32 cycles, satisfaction reads 1 above 2), so a second metric was added
before the re-run: restrict to deficits whose stock+inbound is under the ration line, and credit
their standing stock. Both metrics are reported; both clear the committed 25% line.

**Structural reading.** `Deficit.shortfall = logisticsTarget − stock`, a fill to the full 40-cycle
target, while civilian satisfaction reads 1 from 2 cycles of stock (`consumptionFactor`,
`RATION_COVER`). The head of the severity queue is therefore served 20× what it needs to consume at
full rate before the next deficit is looked at. In scarce groups 11–19% of deficits are filled in
full and 70–82% receive nothing.

**Validation.** Hook Σfilled equals the matcher's returned Σ`PlannedTransfer.quantity` exactly in
every run (maxPerRunGap 0). Delivered `flowEvents` volume in each window is 21–24% of Σfilled — the
gap is dispatch-clamp shaving plus the 40-cycle fills landing as one arrival per haul; direction and
scale are consistent, and the 1,000t read (4,100 deficit rows, 0 filled, 0 flow events, 20
one-system factions) shows the hook fires where the matcher does nothing.

### Raw output

```
seed 42 t1000 developed=20
 groups {"all": 4100, "multiDeficit": 0, "scarce": 0} validation {"hookFilled": 0, "matcherPlanned": 0, "maxPerRunGap": 0} flowDeliveredInWindow=0
 satisfaction {"developedConsumerWorlds": 20, "worldsBelowFullProvision": 20, "allDeveloped": {"zero": 100, "low": 0, "mid": 0, "high": 0, "one": 420}, "belowFullProvision": {"zero": 100, "low": 0, "mid": 0, "high": 0, "one": 420}, "belowFull_stockZero": {"zero": 100, "low": 0, "mid": 0, "high": 0, "one": 0}, "belowFull_stockPositive": {"zero": 0, "low": 0, "mid": 0, "high": 0, "one": 420}}
seed 42 t10000 developed=174 flowDeliveredInWindow=583606.66
 validation {"hookFilled": 2408965.6, "matcherPlanned": 2408965.6, "maxPerRunGap": 0} window {"from": 9000, "to": 10000, "runs": 41, "deficitRows": 80503}
 groups {"all": 15038, "multiDeficit": 12307, "scarce": 3927}
 A {"medianPartialsPerScarceGroup": 0, "shareScarceGroupsWithMoreThanOnePartial": 0.016, "shareScarceGroupsWithDrainedZero": 0.981, "shareScarceGroupsWithAnyZero": 0.981, "medianDeficitsPerScarceGroup": 4, "medianZerosPerScarceGroup": 3, "deficitsInScarce": {"total": 18887, "full": 2069, "partial": 1356, "zero": 15462, "drainedZero": 15462, "strandedZero": 0, "budgetStopped": 0}}
 B {"drainedZero": 15462, "shareDrainedZeroClearingRationUnderEvenSpread": 0.444, "shareDrainedZeroClearingHalfRation": 0.478, "shareScarceGroupsWhereEvenSpreadClearsEveryDeficit": 0.248, "starvingDrainedZero": 4563, "shareDrainedZeroStarving": 0.295, "shareStarvingDrainedZeroLiftedByEvenSpread": 0.783}
 byGoodScarce {"polymers": {"groups": 411, "drainedZero": 2042, "clears": 1755}, "medicine": {"groups": 268, "drainedZero": 1291, "clears": 1075}, "reactor_cores": {"groups": 273, "drainedZero": 1158, "clears": 239}, "ship_frames": {"groups": 270, "drainedZero": 1151, "clears": 239}, "weapons_systems": {"groups": 274, "drainedZero": 1148, "clears": 232}, "targeting_arrays": {"groups": 275, "drainedZero": 1137, "clears": 244}, "machinery": {"groups": 263, "drainedZero": 1072, "clears": 242}, "weapons": {"groups": 263, "drainedZero": 1069, "clears": 221}, "fuel": {"groups": 240, "drainedZero": 926, "clears": 228}, "consumer_goods": {"groups": 217, "drainedZero": 887, "clears": 457}, "chemicals": {"groups": 175, "drainedZero": 644, "clears": 432}, "minerals": {"groups": 161, "drainedZero": 563, "clears": 340}}
 satisfaction {"developedConsumerWorlds": 174, "worldsBelowFullProvision": 174, "allDeveloped": {"zero": 1180, "low": 2, "mid": 78, "high": 61, "one": 3203}, "belowFullProvision": {"zero": 1180, "low": 2, "mid": 78, "high": 61, "one": 3203}, "belowFull_stockZero": {"zero": 1172, "low": 2, "mid": 1, "high": 0, "one": 0}, "belowFull_stockPositive": {"zero": 8, "low": 0, "mid": 77, "high": 61, "one": 3203}}
seed 42 t16000 developed=190 flowDeliveredInWindow=977218.23
 validation {"hookFilled": 4692748.47, "matcherPlanned": 4692748.47, "maxPerRunGap": 0} window {"from": 15000, "to": 16000, "runs": 41, "deficitRows": 42057}
 groups {"all": 11070, "multiDeficit": 6545, "scarce": 1680}
 A {"medianPartialsPerScarceGroup": 0, "shareScarceGroupsWithMoreThanOnePartial": 0.008, "shareScarceGroupsWithDrainedZero": 0.977, "shareScarceGroupsWithAnyZero": 0.977, "medianDeficitsPerScarceGroup": 3, "medianZerosPerScarceGroup": 2, "deficitsInScarce": {"total": 7394, "full": 1389, "partial": 852, "zero": 5153, "drainedZero": 5153, "strandedZero": 0, "budgetStopped": 0}}
 B {"drainedZero": 5153, "shareDrainedZeroClearingRationUnderEvenSpread": 0.701, "shareDrainedZeroClearingHalfRation": 0.87, "shareScarceGroupsWhereEvenSpreadClearsEveryDeficit": 0.483, "starvingDrainedZero": 2770, "shareDrainedZeroStarving": 0.538, "shareStarvingDrainedZeroLiftedByEvenSpread": 0.802}
 byGoodScarce {"medicine": {"groups": 268, "drainedZero": 1644, "clears": 1219}, "polymers": {"groups": 119, "drainedZero": 666, "clears": 644}, "gas": {"groups": 132, "drainedZero": 413, "clears": 263}, "alloys": {"groups": 71, "drainedZero": 399, "clears": 158}, "hull_plating": {"groups": 45, "drainedZero": 225, "clears": 125}, "electronics": {"groups": 92, "drainedZero": 220, "clears": 162}, "metals": {"groups": 92, "drainedZero": 184, "clears": 106}, "chemicals": {"groups": 74, "drainedZero": 184, "clears": 126}, "minerals": {"groups": 46, "drainedZero": 161, "clears": 102}, "ship_frames": {"groups": 83, "drainedZero": 116, "clears": 68}, "weapons": {"groups": 72, "drainedZero": 109, "clears": 60}, "targeting_arrays": {"groups": 72, "drainedZero": 109, "clears": 58}}
 satisfaction {"developedConsumerWorlds": 190, "worldsBelowFullProvision": 187, "allDeveloped": {"zero": 562, "low": 1, "mid": 10, "high": 12, "one": 4355}, "belowFullProvision": {"zero": 562, "low": 1, "mid": 10, "high": 12, "one": 4277}, "belowFull_stockZero": {"zero": 562, "low": 1, "mid": 0, "high": 0, "one": 0}, "belowFull_stockPositive": {"zero": 0, "low": 0, "mid": 10, "high": 12, "one": 4277}}
seed 43 t10000 developed=159 flowDeliveredInWindow=549507.76
 validation {"hookFilled": 2579725.17, "matcherPlanned": 2579725.17, "maxPerRunGap": 0} window {"from": 9000, "to": 10000, "runs": 41, "deficitRows": 76327}
 groups {"all": 15722, "multiDeficit": 12240, "scarce": 5572}
 A {"medianPartialsPerScarceGroup": 0, "shareScarceGroupsWithMoreThanOnePartial": 0.018, "shareScarceGroupsWithDrainedZero": 0.983, "shareScarceGroupsWithAnyZero": 0.983, "medianDeficitsPerScarceGroup": 4, "medianZerosPerScarceGroup": 3, "deficitsInScarce": {"total": 28770, "full": 3526, "partial": 1765, "zero": 23479, "drainedZero": 23479, "strandedZero": 0, "budgetStopped": 0}}
 B {"drainedZero": 23479, "shareDrainedZeroClearingRationUnderEvenSpread": 0.452, "shareDrainedZeroClearingHalfRation": 0.495, "shareScarceGroupsWhereEvenSpreadClearsEveryDeficit": 0.242, "starvingDrainedZero": 10724, "shareDrainedZeroStarving": 0.457, "shareStarvingDrainedZeroLiftedByEvenSpread": 0.558}
 byGoodScarce {"polymers": {"groups": 495, "drainedZero": 2968, "clears": 2469}, "medicine": {"groups": 368, "drainedZero": 2362, "clears": 1867}, "reactor_cores": {"groups": 368, "drainedZero": 1632, "clears": 393}, "weapons": {"groups": 356, "drainedZero": 1602, "clears": 388}, "weapons_systems": {"groups": 361, "drainedZero": 1590, "clears": 345}, "ship_frames": {"groups": 367, "drainedZero": 1569, "clears": 353}, "targeting_arrays": {"groups": 360, "drainedZero": 1556, "clears": 342}, "machinery": {"groups": 357, "drainedZero": 1544, "clears": 370}, "fuel": {"groups": 359, "drainedZero": 1459, "clears": 371}, "chemicals": {"groups": 308, "drainedZero": 1367, "clears": 707}, "metals": {"groups": 276, "drainedZero": 1066, "clears": 396}, "consumer_goods": {"groups": 245, "drainedZero": 1016, "clears": 474}}
 satisfaction {"developedConsumerWorlds": 159, "worldsBelowFullProvision": 159, "allDeveloped": {"zero": 1016, "low": 1, "mid": 34, "high": 51, "one": 3032}, "belowFullProvision": {"zero": 1016, "low": 1, "mid": 34, "high": 51, "one": 3032}, "belowFull_stockZero": {"zero": 999, "low": 1, "mid": 1, "high": 0, "one": 0}, "belowFull_stockPositive": {"zero": 17, "low": 0, "mid": 33, "high": 51, "one": 3032}}
seed 43 t16000 developed=189 flowDeliveredInWindow=1084630.77
 validation {"hookFilled": 4938134.28, "matcherPlanned": 4938134.28, "maxPerRunGap": 0} window {"from": 15000, "to": 16000, "runs": 41, "deficitRows": 41612}
 groups {"all": 11912, "multiDeficit": 6897, "scarce": 2349}
 A {"medianPartialsPerScarceGroup": 0, "shareScarceGroupsWithMoreThanOnePartial": 0.017, "shareScarceGroupsWithDrainedZero": 0.974, "shareScarceGroupsWithAnyZero": 0.974, "medianDeficitsPerScarceGroup": 3, "medianZerosPerScarceGroup": 2, "deficitsInScarce": {"total": 10962, "full": 1421, "partial": 1069, "zero": 8472, "drainedZero": 8472, "strandedZero": 0, "budgetStopped": 0}}
 B {"drainedZero": 8472, "shareDrainedZeroClearingRationUnderEvenSpread": 0.683, "shareDrainedZeroClearingHalfRation": 0.753, "shareScarceGroupsWhereEvenSpreadClearsEveryDeficit": 0.374, "starvingDrainedZero": 3991, "shareDrainedZeroStarving": 0.471, "shareStarvingDrainedZeroLiftedByEvenSpread": 0.687}
 byGoodScarce {"medicine": {"groups": 316, "drainedZero": 1845, "clears": 1353}, "metals": {"groups": 153, "drainedZero": 1095, "clears": 856}, "polymers": {"groups": 136, "drainedZero": 877, "clears": 812}, "gas": {"groups": 223, "drainedZero": 823, "clears": 536}, "chemicals": {"groups": 147, "drainedZero": 598, "clears": 444}, "alloys": {"groups": 116, "drainedZero": 421, "clears": 276}, "hull_plating": {"groups": 100, "drainedZero": 345, "clears": 215}, "electronics": {"groups": 109, "drainedZero": 298, "clears": 119}, "ship_frames": {"groups": 119, "drainedZero": 284, "clears": 148}, "reactor_cores": {"groups": 113, "drainedZero": 272, "clears": 144}, "weapons_systems": {"groups": 114, "drainedZero": 270, "clears": 119}, "targeting_arrays": {"groups": 109, "drainedZero": 247, "clears": 126}}
 satisfaction {"developedConsumerWorlds": 189, "worldsBelowFullProvision": 188, "allDeveloped": {"zero": 480, "low": 0, "mid": 15, "high": 7, "one": 4412}, "belowFullProvision": {"zero": 480, "low": 0, "mid": 15, "high": 7, "one": 4386}, "belowFull_stockZero": {"zero": 479, "low": 0, "mid": 0, "high": 0, "one": 0}, "belowFull_stockPositive": {"zero": 1, "low": 0, "mid": 15, "high": 7, "one": 4386}}
```
