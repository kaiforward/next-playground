# Manufactured-tier founding shortage — measurement working file

Standing question (Kai, 2026-08-25): the manufactured tier (electronics, machinery, medicine,
consumer goods, fuel, polymers) reads ~0.00 median consumer cover at the 16,000-tick horizon, on
main and on `feat/per-body-industry` identically. Why? Candidate causes: recipe-input starvation
of existing factories, logistics/distribution failure, labour/skill gating, or build-planner
behaviour (housing/extraction-first sequencing leaving factory capacity unbuilt).

Context that frames every horizon read: under current timescales the first colony completes
~t=4,128 and 10K is founding era; 16K is still deep founding (the 80% founding mark of a 16K run
is t=8,976). The stale trajectory in `measurement-traps.md` ("recovers to ~0.90 by 16K") predates
the timescale change and must not be read against these runs.

## Claims and falsifiers (committed before instruments run)

**Claim 1 — missing colony capacity, not input-starved homeworlds.** The manufactured-tier floor
at 16K is missing production capacity: tier-1+ output comes almost entirely from the ~20
homeworlds while colony demand grows, and the homeworld factories that exist run at (or near)
their labour-limited capacity — recipe-input gating is not the binding term on them.

> Falsifier: if an in-tick read over electronics- and machinery-producing markets at t≈15,900
> shows the input gate below the labour-fulfilment term on a majority of producing systems (i.e.
> inputs, not labour/capacity, bind), Claim 1 is false and the cause is input starvation
> cascading through the chain.

**Claim 2 — planner choice, not construction scarcity (Kai's sequencing theory, sharpened).**
Colonies under-build tier-1+ because of what the planner proposes and how proposals are gated
(ranking, skill/academy prerequisites, demand thresholds), not because construction resources are
scarce — the pool and treasury would absorb factory projects if proposed.

> Falsifier: if the construction pool is saturated (queue ≫ pool throughput) or construction
> funding was shorted in a material share of founding-era cycles, Claim 2 is false and the
> shortage is a construction-capacity/timescale problem, not an allocation one.

Descriptive (no kill-line): which gates in the build planner's proposal path a young colony must
pass before a tier-1+ building can be proposed at all, with file:line.

## Evidence

### Reading 1 — homeworld factory binding term (Claim 1)

```
Meaning:    Existing factories are NOT starved — they run near capacity, fully staffed, with
            recipe inputs flowing; the shortage is missing capacity, not throttled capacity.
Claim:      Claim 1 — the manufactured-tier floor is missing colony capacity; homeworld
            factories are not input-gated.
Number:     electronics, 20 producing markets, final cycle of 16K: staffing eff/cap median
            1.000, inputGate median 1.000, ceiling median 1.000; total output 53,116 vs
            capacity 58,805 (90%); binding term counts: gate 1, staffing 4, ceiling 0,
            unbound 15. machinery: same shape (output 8,863 vs cap 9,977; gate 1 / staffing
            4 / ceiling 1 / unbound 14). Worst single input drawRatio 0.698 (one machinery
            market's components).
Horizon:    16,000 ticks only — the claim names the 16K-era state; 1K/10K context is the Gate
            A pair in the per-body-industry ledger. Cohort trajectory (cover falling
            monotonically 10K→16K) rules out reading this as equilibrium.
Cohort:     all producing markets of electronics and machinery (the 20 homeworlds; colonies
            host none of either).
Licenses:   kills "input starvation of existing factories" and "logistics fails to feed
            factories" as causes of the 16K floor. Does NOT say demand is met (cover is 0.00
            — output is consumed instantly); does NOT say anything about equilibrium; does
            NOT locate why capacity fails to grow (Reading 2/3's job).
Instrument: temp/mfg-gate-diag.ts driving the real runWorldTick (seed 42, 600 systems,
            default cadence, scale 100 — seed-matched to the 16K simulate) with a temporary
            in-tick hook at the actualOutput site (lib/engine/supply-chain.ts:133), enabled
            for the final CYCLE_LENGTH ticks; hook reverted same session. Validated: 20 rows
            per good == the 16K report's producing-market counts for both goods.
```

### Reading 2 — construction resources are not the constraint (Claim 2)

```
Meaning:    The galaxy has idle construction capacity and full funding while the shortage
            stands — whatever limits factory growth, it is not the ability to build.
Claim:      Claim 2 — colonies under-build tier-1+ because of planner proposal behaviour,
            not construction scarcity.
Number:     16K report (branch, seed 42): construction queue 1.7K work remaining ≈ 3.7 cycles
            at current pool; founding-era construction funded fraction median 1.000, p10
            1.000 (min 0.052, one cycle) over 13.0K billed cycles; colony queue at 16K: 81
            tier-0, 40 housing, 21 tier-1+, 7 academy, 1 complex projects. 37 of 182
            colonies have any tier-1+ industry; all 182 have housing and tier-0.
Horizon:    16,000 ticks (whole-run funding figures cover t=401–15,984). Same justification
            as Reading 1.
Cohort:     all 20 factions' construction ledgers; all 182 colonies.
Licenses:   kills "construction pool saturated" and "construction funding shorted" as causes.
            Supports (does not alone prove) planner-allocation as the cause. Does NOT
            quantify how often tier-1+ proposals are dropped at the input-supplier gate —
            that read (BuildDropReport "no-input-supplier" share) was not taken.
```

### Reading 3 — where the planner gates a colony factory (descriptive, no kill-line)

```
Meaning:    A factory can only be proposed at a site that already sees every recipe input
            either produced locally or held in surplus by a reachable system — in a
            founding-era galaxy where the intermediates themselves run at deficit, most
            sites cannot pass this gate, so factory proposals are structurally rare while
            tier-0 (no such gate) and housing (pass 1, unconditional relief) flow freely.
Claim:      descriptive — the tier-1+ proposal path's gates, with receipts.
Number:     lib/engine/directed-build.ts:881 (`!isTier0 && !inputsAvailable(...)` → drop
            "no-input-supplier"); inputsAvailable at :599-613 (every recipe input needs
            local production or a reachable surplusDrawable donor); housing is pass 1 at
            :788-807 (unconditional crowding relief, funding stage leads housing);
            electronics recipe needs components + chemicals, machinery needs metals +
            components (lib/constants/recipes.ts:27-28); the score for proposals that do
            pass is served-demand ÷ route cost × staffing (:899-969).
Horizon:    n/a (code fact, HEAD of main d7b14a54 / branch identical here).
Cohort:     n/a.
Licenses:   explains the mechanism by which shortage self-perpetuates (deficit intermediates
            → no surplus donors → no new factories proposed → deficit persists). Does NOT
            measure the gate's actual drop share — a follow-up read of the harness's
            BuildDropReport reasons would quantify it.
```

### Outcome

Claim 1 **confirmed** (falsifier required input gate binding on a majority; it binds on 1 of
20). Claim 2 **confirmed** (falsifier required pool saturation or funding shortfall; neither
holds). The owner's housing-sequencing theory is adjacent-but-not-the-mechanism: housing does
build first by design, but the construction pool is not saturated, so housing does not crowd
factories out of construction — factories are missing because they are rarely *proposed*
(Reading 3's gate) while demand grows with every founded colony.

Direction (one sentence, design not started): the lever is the planner's tier-1+ proposal
path in a founding-era galaxy — e.g. how `inputsAvailable` treats a deficit-everywhere good —
and any design pass should first take the missing read (BuildDropReport "no-input-supplier"
share over a 16K run).

