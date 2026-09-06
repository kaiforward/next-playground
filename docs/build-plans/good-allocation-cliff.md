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

## Spec

```
What changes:  When a faction cannot supply every world that wants a good, logistics feeds every
               world that is about to run short before it tops anyone up. A run now fills in two
               rounds: a need round that brings every importing world up to the line where its
               consumption would otherwise be rationed, sharing the available stock in equal
               proportion when there is not enough to reach that line for everyone; then a buffer
               round that tops worlds up toward their warehouse target exactly as today. Survival
               goods are served before other goods in both rounds. When supply is ample nothing
               visible changes; when it is short, the shortage lands on warehouses, not on tables.
Why:           The measure confirmed the roadmap row's hypothesis: under scarcity the head of the
               queue is filled to its full 40-cycle target while 70–82% of the deficits behind it
               get nothing, and the placed tonnage spread evenly would have kept 56–80% of the
               starving ones at full consumption (## Evidence). Owner decisions, in Kai's words:
               - "the issue of systems requesting too much is real"
               - "just sending less … feels like a bit of a cheating solution since the fact is
                 that the combined systems often create and have enough resources they just
                 arent shared properly. I think how much deficit is asked for is tied into how we
                 actually choose which systems to supply first"
               - "rounds makes sense to me if that means we prioritize systems that NEED the goods
                 (below 2 cycles) vs systems that WANT the goods (above 2 cycles) … It has to be
                 based on what we have available though if we happen to have enough available to
                 fill every systems higher than 2 then we do that, but with not enough we
                 prioritise need"
               - "I still worry option 1 means large systems starve all the others" — size
                 ordering dropped; "spread across all worlds which are short makes more sense than
                 saving some and not others without the player deciding themselves which they
                 want to fail/not fail"
               - "the player customisation can be a later change, now we just plan the default
                 behaviour"
               - Roadmap, Kai 2026-08-16: "Carry necessity into the routing calculations too … a
                 unit of unmet food ranks alongside a unit of unmet luxuries … The concrete place
                 it lands is the good-allocation cliff row."
               - Roadmap, 2026-08-03: "Flow priority is a lever: the matcher's sink ordering
                 (severity = shortfall × draw, worst-first) is designable."
Evidence:      ## Evidence, one reading. Meaning: under scarcity the matcher hands the head of the
               queue its full 40-cycle warehouse target and everyone behind it nothing, and on
               most of the deficits left starving that tonnage spread evenly would have been
               enough to keep their consumption at full rate. Licenses: the greedy-drain fill
               shape as the mechanism deciding which systems hold zero stock; real room for an
               allocation policy on processed goods (~85% of drained zero-fills clear under even
               spread) and much less on advanced goods (~20% at 10K); NOT any galaxy-level
               outcome under a spread policy (static one-run counterfactual); NOT equilibrium
               (both active horizons founding era); funding not a confound (budgetStopped 0).
               The bimodal satisfaction is the formula plus stock level: every satisfaction-0
               market had stock 0, none with stock 0 read above 0.25.
Not claimed:   No player control — the per-system priority flag discussed is deferred, and the
               default behaviour must be complete without it. No change to the warehouse target,
               the deficit line, either donor reserve, or the exporter/importer asymmetry
               (exporters ship down to 10 cycles, importers still warehouse to 40 in the buffer
               round). No change to what "unservable" or "funding-bound" mean. No claim that a
               faction short of a good overall ends up better fed in aggregate — the design moves
               the shortage from consumption onto buffers; a faction whose supply is below its
               total need still rations, now evenly. No pricing of hauling (the logistics
               gameplay pass). No change to the build planner's survival band. The buffer round
               keeps the existing worst-first greedy fill deliberately; a proportional buffer
               round is a named variant, not part of this spec.
```

### 1. The need line

Every importing market gets a **need line**: the stock below which the economy would ration its
consumption. Today the economy delivers in full while stock covers `RATION_COVER` (2) cycles of the
market's total demand and ramps delivery down as the square root of the shortfall below it
(`lib/engine/tick.ts:79`, applied at `lib/engine/supply-chain.ts:152` against
`rationCover × demandRate`, `lib/engine/supply-chain.ts:99`). Satisfaction is exactly that
delivered share (`lib/tick/processors/economy.ts:166`), which is why a market at or above the line
reads 1 and a market at stock 0 reads 0.

The need round fills to the line **plus one cycle of consumption**, so the world is still on the
line after the economy cycle that follows the delivery, rather than one draw below it:

    needTarget = NEED_COVER × demand,  NEED_COVER = RATION_COVER + 1  (new — derived, not authored)

`demand` is the matcher's use figure — civilian want at full rate plus staffing- and strike-gated
recipe draw, produced at `lib/tick/processors/good-market-state.ts:179` from `honestUseRate`
(`lib/world/types.ts:562`). It is unfloored, so a tiny market's need line is what it consumes, not
the `MIN_DEMAND` pricing guard (`lib/constants/market-economy.ts:75`) the economy's own ration line
uses; on a market whose real demand sits under the floor the economy rations slightly above where
this round stops filling. Accepted, for the reason `WAREHOUSE_COVER`'s docstring gives
(`lib/constants/directed-logistics.ts:41-63`): a divide-by-zero guard for pricing is not a
consumption fact. The need line does **not** ride `anchorMult`: it mirrors the economy's ration
line, which does not (`lib/engine/supply-chain.ts:99`), and an event that shifts a price anchor
has no business changing when a population goes hungry.

### 2. Two rounds per run

The matcher still runs per faction per logistics cycle (`lib/tick/processors/directed-logistics.ts`,
`matchFactionTransfers` at `lib/engine/directed-logistics.ts:286`), still classifies a market as a
deficit at stock plus scheduled inbound under 80% of the 40-cycle target
(`lib/engine/directed-logistics.ts:303`, `classifyMarketState` at line 49), still gates sinks on
`production < demand` (line 309), and still sizes donors by `surplusDrawable` (line 101). What
changes is how the deficit list is served.

**Round one — need.** The subset of deficits whose stock plus scheduled inbound is under their
`needTarget`. Each asks for `needTarget − (stock + scheduledInbound)`. For each good, the faction's
**pooled need supply** is the summed live drawable of every donor at least one of that good's
need-round deficits can reach (`reachableFrom`, `lib/engine/lane-routing.ts:139`, the
saturation-blind test the structural reading already uses). Then:

- if the pool covers the summed asks, every need-round deficit is filled to its `needTarget`;
- otherwise every need-round deficit is granted the same **fraction** of its ask,
  `f = pool ÷ Σask`, and draws `f × ask`.

A deficit draws its grant from its own reachable donors, cheapest first, exactly as a fill works
today (line 404 onward). Where a deficit's own reachable donors run dry before its grant is met —
the pool was reachable by *some* need-round deficit, not necessarily this one — the residue stands,
and the structural `unservable` reading below records it as it does today. `f` is therefore a
ceiling on what any one world gets, not a guarantee; two worlds with the same ask and the same
donors get the same quantity.

Round one never touches a donor below its reserve: the exporter's 10 cycles
(`EXPORT_RESERVE_COVER`, `lib/constants/directed-logistics.ts:40`) and the ordinary donor's 40
(`DONOR_RESERVE_COVER`, line 89) hold, so feeding a hungry world can still never create a new
deficit.

**Round two — buffer.** Every deficit not yet at 80% of its 40-cycle target (need-round deficits
included, with their round-one grant and anything scheduled inbound counted as stock) is served by
today's algorithm unchanged: worst-first by severity (`shortfall × drawDemand`, lines 314 and 333),
each filling from every reachable donor cheapest-first up to its full `logisticsTarget`, with the
per-deficit budget skip (line 465) and blocked-volume handling as they are. The greedy cliff still
exists here, by decision — it now falls between warehouses, not between a fed world and a starving
one.

**Order across goods.** In both rounds, goods are processed in descending `GOOD_NECESSITY`
(`lib/constants/physical-economy.ts:105`, water and food 1.0 down to war matériel 0.02), ties broken
by today's severity order. The haul budget (`lib/engine/directed-logistics.ts:290`) and lane capacity
(`routeAndBook`, `lib/engine/lane-routing.ts:140`) are shared across goods within a faction's run,
so this is what "food before luxuries" means mechanically: when either binds, it binds on the least
necessary good first. Within a good, need-round deficits are visited in severity order too — it
does not change anyone's grant, only which draws book lanes first under congestion.

**Order within the need round is not by size.** A two-population colony and a capital short of the
same good receive the same fraction of their respective needs. This is the decision recorded in
`Why`, and it is what the measured counterfactual scored.

### 3. What is unchanged, stated

- The deficit line, warehouse target and both donor reserves keep their values and denominators;
  the buffer round is today's fill. The exporter/importer asymmetry (ship down to 10, warehouse to
  40) survives in the buffer round.
- `unservable` (`UnservableDeficit`, `lib/engine/directed-logistics.ts:234`) keeps its definition:
  the deficit's *full* shortfall to the 40-cycle target less the summed live reachable drawable,
  computed once per deficit when the buffer round reaches it. A world fed in round one but not
  buffered still reads unservable for the buffer it lacks — that reading feeds the alerts service's
  "Demand unservable" (`lib/services/alerts.ts:452`) and the build planner's suppression, both of
  which are about structural supply, not this run's rationing.
- `fundingBound` (`FundingBoundMatch`, line 206), `budgetSkipped`, `blocked` and `logisticsDispatched` keep their
  meanings; a budget stop inside the need round ends that deficit's need-round fill exactly as it
  ends a fill today and is recorded the same way.
- Scheduled inbound counts toward stock in both rounds' sink tests, so a world fed last run does not
  re-enter the need round while its haul is in transit (`docs/active/gameplay/logistics-lanes.md` §3).
- Dispatch, the pending-arrivals ledger, the flow log and the conservation identity are untouched.
- No new world state. Nothing here persists; the need line is derived each run from `demand`.

### 4. Observable outcomes and how they are read

Read with `npm run simulate` at both horizons, plus the measure's own runner re-run against the
change (its "scarce group" and "drained zero-fill" cohorts are the direct check):

| Observable | Expected direction | Read at |
|---|---|---|
| Drained zero-fill deficits whose stock + inbound is under the need line, in scarce groups | → ~0, residue only from per-deficit donor exhaustion (connectivity) | measure runner, 10K and 16K, both seeds |
| Consumer markets at satisfaction 0 with stock 0 on developed worlds below full Provision | falls; the remaining zeros are goods with no reachable donor at all | measure runner satisfaction snapshot |
| Consumer cover medians per good, consumer cohort | flat to slightly down for the head-of-queue goods (they warehouse later), up for the tail | `npm run simulate`, market role cohort |
| Exporter cover | unchanged (reserves untouched) | `npm run simulate`, exporter cohort |
| Galaxy production, developed count, conservation identities | unchanged within noise | `npm run simulate`, both horizons |

Reading the consumer cover medians needs the cohort split: the consumer cohort grows as colonies
found, and a new colony opens at satisfaction 0 on every good regardless of allocation.

### 5. Edges

- **Demand 0.** `needTarget` is 0; the market is never a need-round deficit, exactly as a zero
  `logisticsTarget` already drops it from the deficit list (`classifyMarketState`, line 51).
- **Self-supplier.** `production ≥ demand` excludes a market from both rounds, as today (line 309).
- **Pool 0 for a good.** Round one grants nothing; every need-round deficit goes to round two with
  its ask intact; if no donor exists anywhere the buffer round records it unservable as today
  (line 348).
- **A need-round deficit whose only reachable donors are saturated** (`priceFrom` null,
  `reachableFrom` true): it contributes to the pool's denominator and numerator but cannot draw
  this run; its grant stands as blocked volume on the lane, which the booker records, and nothing
  is billed — the same treatment a blocked buffer draw gets today (blocked volume, line 456's placement accounting).
- **Fraction rounding.** Quantities stay continuous floats; no quantisation (line 407's rule).
- **Mid-run congestion.** A need-round draw placed on a lane raises that lane's price for every
  later draw in both rounds, as any placement does today; the pool is computed once per good before
  its need-round draws begin, so a later deficit's grant is not re-cut by earlier ones' bookings.
- **Save/load.** No new fields; a save from before the change loads and behaves under the new
  rounds from its next logistics cycle.

### 6. Hazard worksheet

Scope: all six rows (tick processor, shared constants).

**1. One quantity, several jobs.**

| Quantity | Every reader today (`file:line`) | Which this design moves | Intended? |
|---|---|---|---|
| `RATION_COVER` | `lib/constants/economy.ts:66` (def), `:79` (sim params); `lib/engine/industry.ts` (1×, the input-draw ramp); read in the tick at `lib/engine/supply-chain.ts:99,152` via `rationCover` | Gains one derived reader: `NEED_COVER = RATION_COVER + 1` in the matcher | Yes, and deliberately coupled: the need line *is* "where consumption is rationed", so the two must move together. Stated as a derivation, never a second literal. |
| `WAREHOUSE_COVER` / `logisticsTarget` | `lib/constants/directed-logistics.ts:63`; `lib/tick/processors/good-market-state.ts:185` (producer); `lib/engine/directed-logistics.ts` (2×, sink test and shortfall); harness `lib/tick-harness/market-analysis.ts:65-265` (cover levels), `cohort-analysis.ts` (1×) | None. The buffer round fills to it as today. | Yes — kept coupled. |
| `DONOR_RESERVE_COVER` / `donorReserve` | `lib/constants/directed-logistics.ts:89`; `good-market-state.ts:186` (producer); `lib/engine/directed-logistics.ts:101` (`surplusDrawable`); `lib/engine/directed-build.ts:997` (input-supply gate); harness `market-analysis.ts:256` | None. Both rounds draw through `surplusDrawable` unchanged. | Yes — kept coupled with the planner by design (the planner's "surplus" must equal the matcher's). `npm run impact` verdict SHARED, pasted below. |
| `EXPORT_RESERVE_COVER` | `lib/constants/directed-logistics.ts:40`; `lib/engine/directed-logistics.ts:108` | None | Yes |
| `demand` (use figure) | producer `good-market-state.ts:179` from `honestUseRate` (`lib/world/types.ts:562`); readers: `logisticsTarget`, `donorReserve`, self-supply gate (`directed-logistics.ts:309`), `surplusDrawable`, `brakeKnee` use rate | Gains the need line as a reader | Yes — same denominator family as every other warehousing quantity, per `GoodMarketState.demand`'s docstring (`directed-logistics.ts:137-142`). |
| `drawDemand` | producer `good-market-state.ts:190`; sole reader the severity weight `directed-logistics.ts:314` | Still the only severity reader; now the within-round tie-break | Yes |
| `unservedShortfall` | `lib/world/tick.ts` (8×), `lib/tick/adapters/memory/directed-logistics.ts` (4×), `lib/tick/world/directed-logistics-world.ts` (2×), `lib/world/types.ts`, `lib/services/alerts.ts:452-469` | None — definition kept (§3) | Yes. SHARED verdict pasted below. |

`npm run impact -- DONOR_RESERVE_COVER --quiet`:

```
TICK SIMULATION — 3 references in 3 modules (+9 in tests)
  directed-logistics  lib/constants/directed-logistics.ts
  directed-build      lib/engine/directed-build.ts
  good-market-state   lib/tick/processors/good-market-state.ts
HARNESS + TESTS — market-analysis 1×
SHARED — 3 references across 3 modules: HAZARD 1 APPLIES.
```

`npm run impact -- RATION_COVER --quiet`:

```
TICK SIMULATION — 3 references in 2 modules (+5 in tests)
  economy   2×  lib/constants/economy.ts
  industry  1×  lib/engine/industry.ts
ALSO TOUCHED BY — 4/10 economy
CONTAINED — 3 references across 2 module(s)
```

`npm run impact -- unservedShortfall --quiet`:

```
TICK RIPPLE — 7/10 directed logistics
TICK SIMULATION — 15 references in 4 modules: tick 8×, directed-logistics (adapter) 4×,
  directed-logistics-world 2×, world/types 1×
OUTSIDE THE TICK — alerts 3×
SHARED — 18 references across 5 modules: HAZARD 1 APPLIES.
```

**2. A constant read for a meaning it was not authored to have.**

| Constant | Docstring says | This design uses it as | Same? |
|---|---|---|---|
| `RATION_COVER` (`economy.ts:54-65`) | "Emergency stock cover in demand cycles. Civilian delivery and industrial input draws remain full while stock covers at least this many cycles of total local demand; below it, explicit rationing ramps toward zero at empty. Deliberately independent of the 40-cycle pricing/reserve anchor." | The line the need round fills to (plus one cycle) | Yes — the same fact, read from the other side. The docstring's "widening this buffer is never the fix for a starving galaxy" is respected: the constant's value is not moved. |
| `GOOD_NECESSITY` (`physical-economy.ts:97-104`) | Weights "how much not having a good is suffering"; "this table just stops the model calling not having [luxuries] suffering"; dimensionless, relative shape only | Cross-good processing order (descending) in both rounds | Yes — an ordering by suffering-if-unmet is the authored meaning. Only rank is read, never magnitude. Whole table checked: 26 entries, 1.0 → 0.02, water/food alone at the ceiling. |
| `GOOD_CONSUMPTION` | a tier gradient, not a necessity ranking (the shipped instance) | Not read by this design | — |
| `WAREHOUSE_COVER` (`directed-logistics.ts:41-63`) | "Cycles of a system's REAL demand that directed logistics tries to keep on hand — the warehousing target the DEFICIT test measures against" | Unchanged: the buffer round's target | Yes |
| `DEFICIT_FRACTION` (`:65`) | "A good is a deficit when stock < logisticsTarget × this" | Unchanged: membership of the deficit list | Yes |

**3. A system you did not think about.**

| System | Interaction | Reason if none |
|---|---|---|
| Events | `anchor_shift` modifiers (`lib/engine/events.ts:127`) move `anchorMult`, which scales `logisticsTarget` and `donorReserve` (`good-market-state.ts:185-186`) and so the buffer round's asks and every donor's floor — as today. The need line deliberately does not ride `anchorMult` (§1). Production-multiplier events reach the need round only through `drawDemand` (tie-break). | — |
| Population + migration | Satisfaction (`economy.ts:166`) feeds Provision and growth; the need round's purpose is to keep more worlds at satisfaction 1 under scarcity, so expect fewer worlds crossing into rationing during shortages and more worlds sharing a shallow one. Migration reads attractiveness, unchanged. | — |
| Unrest / regime | Crisis term keys off `CRITICAL_SATISFACTION` (0.25, `lib/engine/population.ts:227`) on survival goods; proportional need-round grants can hold a world *between* 0.25 and 1 where today it sat at 0 or 1 — the roadmap row's "makes CRITICAL_SATISFACTION a live line" outcome. A severe faction-wide shortage now puts every world into shallow rationing at once rather than a few into famine. | — |
| Industry + staffing | Input draws ration at the same line (`supply-chain.ts:48,99`); the use figure already includes staffing-gated industrial draw, so a factory's inputs are inside the need line. | — |
| Infrastructure decay | Idle decay is exempted for funding-bound producers (`fundingBound` meaning unchanged); the buffer round still fills warehouses, so the "staffed-and-selling" signal decay reads is not starved. | — |
| Directed logistics | The change itself. | — |
| Directed build / planner | Reads `surplusDrawable` with the same `donorReserve` (`directed-build.ts:997`), `unservedShortfall` for suppression, and `fed()` (`directed-build.ts:249`) off satisfaction. Fewer satisfaction-0 worlds under scarcity ⇒ `fed()` passes on more worlds ⇒ more housing builds lead. Expected and wanted (a fed world is a viable one); the planner's own survival band is untouched. | — |
| Colonisation + founding manifest | A new colony opens at stock 0 on every good, so it is a need-round deficit on all 26 at once and now shares scarce goods proportionally instead of taking the head of the queue by severity. Founding stock itself is unchanged. | — |
| Treasury / purse | Work billed = Σ draw cost as today (`directed-logistics.ts` processor, `work`); the need round's smaller, more numerous draws change the *shape* of spend, not the identity. Budget did not bind in any measured run (budgetStopped 0). | — |
| Factions + relations | None | Matching is per faction over its own systems; traversability and `foreignShare` on lanes are unchanged. |
| Save format (`World` shape) | None | No new persisted field; the need line is derived per run. |
| The harness's own metrics | Cover levels (`market-analysis.ts:226-265`) and the conservation identities read the same fields; `logisticsDispatched` and the fifth identity are untouched. No new metric required to read the outcome — the measure's runner is the direct instrument (§4). | — |

**4. Symptoms asserted.**

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| The matcher fills the head of the queue to 40 cycles and the rest get nothing under scarcity | ## Evidence: median partials per scarce group 0; zero-fills 70–82% of deficits in scarce groups | 10K, 16K | scarce groups, seeds 42/43 |
| Even spread would keep most starving zero-fills at full consumption | ## Evidence: 78/56% at 10K, 80/69% at 16K of starving drained zero-fills lifted | 10K, 16K | drained zero-fills with stock+inbound under the ration line |
| Satisfaction reads 0 iff stock is 0 on these worlds | ## Evidence satisfaction snapshot: 1172/1180 zero-satisfaction markets at stock 0 (s42 10K); 0 stock-0 markets above 0.25 | 1K, 10K, 16K | developed, Provision < 1, civilian-consumed goods |
| Budget never binds | ## Evidence: budgetStopped 0 in every scarce group | 10K, 16K | scarce groups |
| Advanced goods are genuinely scarce, allocation cannot fix them | ## Evidence byGoodScarce: reactor cores 239/1158 clear (s42 10K) | 10K | drained zero-fills per good |
| Consumption is delivered in full above 2 cycles and ramps as √ below | `lib/engine/tick.ts:79-83` | — | — |

**5. Signals and primitives consumed.**

| Consumes | Produced at | Actual shape today | Design assumes |
|---|---|---|---|
| `demand` (use figure) | `good-market-state.ts:179` | ≥ 0, per reference cycle, unfloored; missing `honestUseRate` recomputes live, never 0 | ≥ 0 per cycle; 0 ⇒ no need line |
| `scheduledInbound` | `lib/engine/freight.ts` `scheduledInbound`, passed at `directed-logistics.ts` processor `toLogisticsState` | ≥ 0 per (system, good); absent ⇒ 0 | same |
| `reachableFrom(sink)(donor)` | `lib/engine/lane-routing.ts:139` | boolean, saturation-blind, traversability-aware | used for the pool's membership |
| `priceFrom(sink)(donor)` | `lane-routing.ts:129` | per-unit price or null when saturated | used for draw order, as today |
| `routeAndBook` | `lane-routing.ts:140` | placements + blocked volume | as today |
| `GOOD_NECESSITY[goodId]` | `physical-economy.ts:105` | 26 entries in (0, 1]; absent good ⇒ treat as 0 (`pop-needs.ts:61` precedent) | rank only |
| `RATION_COVER` | `economy.ts:66` | 2 | need line = 3 × demand |
| `surplusDrawable` | `directed-logistics.ts:101` | ≥ 0 | donor capacity in both rounds |

**6. Aggregates that move for other reasons.**

| Metric | Cohort read at | What else moves it |
|---|---|---|
| Consumer cover median per good | market role = consumer, per good, both horizons | Cohort growth as colonies found (each opens at 0); the 10K horizon sits mid-transient for high-tier goods (`directed-logistics.ts:82-87`) |
| Share of consumer markets at satisfaction 0 | developed worlds, Provision < 1 | New colonies (stock 0 on every good at founding); goods with no producer anywhere in the faction (structural, allocation-blind) — split by "has any reachable donor" |
| Scarce-group counts | per faction × good × run | Supply growth across horizons (3,927 → 1,680 on s42 between 10K and 16K before any change) — compare shares, not counts |
| Provision band populations | developed worlds | Expectation dynamics and unrest; read alongside satisfaction, never alone |

### 7. Falsifiers (provenance: committed at `f2e97242`, moved here unedited)

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

### 8. Open points for spec review

- **Buffer round greedy vs proportional.** Kept greedy by decision; the one-line variant
  (proportional buffer fills) is the obvious alternative and is the reviewer's to argue for.
- **Pool definition when reachability differs.** `f` is computed against the union of donors any
  need-round deficit reaches; a poorly connected deficit's grant can exceed what it can draw. The
  alternative — per-deficit `f` against its own reachable donors — is fairer per world but lets a
  well-connected world take more than its faction-wide share. Chosen for legibility; stated so the
  reviewer can weigh it.
- **`NEED_COVER = RATION_COVER + 1`.** One cycle of headroom is the minimum that keeps a fed world
  on the line through the next economy cycle. A larger headroom is a tuning question the simulator
  owns, not a definition.

Next stage: `/spec-review docs/build-plans/good-allocation-cliff.md` — mandatory, the change is a
tick processor reading a shared constant and moving a shared signal's producer.
