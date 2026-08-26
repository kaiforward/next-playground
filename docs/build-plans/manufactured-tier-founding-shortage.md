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

## Round 2 — the roadmap row's two pre-design reads (2026-08-25)

The necessity-weighting planner row commits two reads before its single design pass (weighting +
derived demand together). Planner runs happen on construction boundary ticks (`tick %
CONSTRUCTION_INTERVAL(24) === 0`), all factions at once; "one planner run" = one
`planFactionBundles` invocation for one faction. Survival goods are water and food only
(`SURVIVAL_GOODS`, `lib/constants/physical-economy.ts:153`) — both tier-0, so survival
opportunities never touch the input gate.

**Claim 3 — survival/non-survival competition is common inside one planner run.** In
founding-era planner runs a material share of runs score BOTH bands, and within those runs the
ranking interleaves (at least one non-survival opportunity out-scores at least one survival
opportunity) — so a necessity weight would actually reorder builds. (Kai's prior: often.)

> Falsifier: if at both the 10K-era and 16K-era boundary windows fewer than 10% of planner runs
> with any scored opportunity score both bands, OR fewer than 10% of those both-band runs show
> any interleaving (every survival opportunity already out-ranks every non-survival one), the
> weighting has nothing to act on and the weighting half of the row goes back to brainstorm.

**Claim 4 — the input gate is the deadlock's dominant drop, on colonies.** At colony sites in
the founding era, `inputsAvailable` is where tier-1+ proposals die: a large share of tier-1+
site×good candidacies that clear the capacity check fail the input gate, and "no-input-supplier"
is the largest single reason among raw tier-1+ drops there.

> Falsifier: if at the 16K-era boundary window under 25% of colony-site tier-1+ candidacies
> reaching the input gate fail it, or "no-input-supplier" is not the largest raw tier-1+ drop
> reason at colony sites, the deadlock framing is false and the derived-demand direction goes
> back to brainstorm.

Horizons: boundary-tick windows ending at 1K (pre-founding — homeworlds only), 10K and 16K,
one 16K run (seed 42, 600 systems, defaults). Cohort: homeworld (`faction.homeworldId`) vs
colony, within developed systems (the planner only visits those).

### Reading 4 — survival vs non-survival competition per planner run (Claim 3)

```
Meaning:    In the founding era the two bands compete in most planner runs, and when they do
            the ranking always interleaves — some non-survival opportunity out-scores some
            survival opportunity in 100% of both-band runs, and the TOP opportunity is
            non-survival in ~95-98% of them. A necessity weight would reorder almost every
            run it applies to. Realised displacement today is small (survival builds still
            mostly land because take is shortfall-bounded), so the weight's effect is on
            claim/funding order, not on rescuing survival builds that currently die.
Number:     10K window: 80/84 runs scored anything; both bands 50 (62.5%); interleaved
            50/50 (100%); top non-survival while survival exists 49 (98.0%); non-survival
            landed while a survival opportunity was ranked-dropped: 4 (8.0%). Scored
            opportunities survival 723 vs non-survival 4,271.
            16K window: both bands 21/80 (26.3%); interleaved 21/21 (100%); top
            non-survival 20 (95.2%); realised 2 (9.5%). Scored survival 202 vs 4,386.
            1K window (pre-founding): both bands 1/40 (2.5%) — homeworlds only, nothing
            to weight yet.
Claim:      Claim 3 — survival/non-survival competition is common inside one planner run.
Horizon:    boundary windows ending at 1K, 10K, 16K of one 16K run (4 boundaries × 21
            factions each). 10K and 16K are both founding-era (first colony ~t=4,128);
            no equilibrium claim.
Cohort:     per-faction planner runs; scored opportunities split homeworld vs colony
            (10K: homeworld 67 surv / 1,179 non; colony 656 surv / 3,092 non).
Licenses:   confirms the weighting has a large surface to act on (coexistence common,
            inversion universal within it). Does NOT say survival builds are being starved
            today (realised displacement 8-9.5%); does NOT size the weight; says nothing
            about equilibrium behaviour.
Instrument: temp/planner-competition-diag.ts + temporary PLANNER_DIAG hook inside
            planFactionBundles (lib/engine/directed-build.ts; reverted same session, grep
            clean). Validated: per-system dedupe recomputed from raw rows at t=15984
            matches persisted world state exactly — buildBlocked 202/0, buildOpportunity
            201/0. First run sampled loop-index ticks and read all-zeroes: runWorldTick
            advances to currentTick + 1 before processors run, so boundary sampling must
            use t + 1 (counter-armed-on-wrong-tick, caught by the zero-row validation).
```

Raw rows (10K / 16K windows, verbatim):

```
===== window 10K — 84 planner runs (faction×boundary) =====
runs with any scored opportunity: 80/84
  both bands scored:      50 (62.5% of scored runs)
  interleaved (some non-survival above some survival): 50 (100.0% of both-band runs)
  top opportunity non-survival while survival exists:  49 (98.0%)
  realised competition (non-survival landed AND survival ranked-dropped): 4 (8.0%)
  scored opportunities: survival 723, non-survival 4271
  scored by site cohort: homeworld surv 67 / non 1179; colony surv 656 / non 3092
===== window 16K — 84 planner runs (faction×boundary) =====
runs with any scored opportunity: 80/84
  both bands scored:      21 (26.3% of scored runs)
  interleaved (some non-survival above some survival): 21 (100.0% of both-band runs)
  top opportunity non-survival while survival exists:  20 (95.2%)
  realised competition (non-survival landed AND survival ranked-dropped): 2 (9.5%)
  scored opportunities: survival 202, non-survival 4386
  scored by site cohort: homeworld surv 23 / non 890; colony surv 179 / non 3496
```

### Reading 5 — the input gate's raw drop share (Claim 4)

```
Meaning:    The deadlock is real, colony-specific, and the gate is where tier-1+ proposals
            die: at colony sites roughly seven in ten tier-1+ site×good candidacies that
            clear capacity fail inputsAvailable, and no-input-supplier is the largest raw
            tier-1+ drop reason there by far — while homeworlds fail the same gate exactly
            never. The colony tier-1+ pipeline is otherwise labour-limited, not
            consumer-limited.
Number:     16K window, colony sites: input gate fails 8,758/12,619 tier-1+ candidacies
            (69.4%); raw tier-1+ drop mix no-input-supplier 69.4%, no-labour 26.9%,
            no-consumer 3.7%. Homeworld sites: 0/1,327 gate failures (0.0%); drops there
            are no-labour 64.3% / no-consumer 35.7%. 10K window, colony: 9,325/11,788
            fail (79.1%). 1K window: zero tier-1+ candidacies exist at all (no tier-1+
            structural deficits assessed pre-founding).
Claim:      Claim 4 — the input gate is the deadlock's dominant drop, on colonies.
Horizon:    same three boundary windows of the same 16K run. Founding-era readings; the
            10K→16K drift (79.1% → 69.4%, machinery passes rising 0 → 96) shows the gate
            loosening very slowly as intermediates appear, consistent with the observed
            bottom-up unblock being far too slow rather than absent.
Cohort:     homeworld vs colony sites, developed systems only. Per-good failures at 16K
            led by weapons_systems 702, luxuries 696, ship_frames 691, targeting_arrays
            680, weapons 675, reactor_cores 646, consumer_goods 638, machinery 632.
Licenses:   confirms the proposal-deadlock mechanism and locates it on colonies at the
            gate. Does NOT say removing the gate is safe (no-labour is the next binder at
            26.9% and would catch some of what the gate releases); does NOT measure how
            much capacity derived demand would actually unblock; no equilibrium claim.
Instrument: same run and hook as Reading 4; same validation.
```

Raw rows (16K window, verbatim; 10K figures quoted above):

```
input gate (homeworld sites): 0/1327 tier-1+ candidacies fail (0.0%)
  raw tier-1+ drops (homeworld): total 1326 — no-labour 853 (64.3%), no-consumer 473 (35.7%)
input gate (colony sites): 8758/12619 tier-1+ candidacies fail (69.4%)
  top failing goods: weapons_systems 702 (passes 2), luxuries 696 (passes 32), ship_frames 691 (passes 13), targeting_arrays 680 (passes 24), weapons 675 (passes 50), reactor_cores 646 (passes 58), consumer_goods 638 (passes 54), machinery 632 (passes 96)
  raw tier-1+ drops (colony): total 12617 — no-input-supplier 8758 (69.4%), no-labour 3398 (26.9%), no-consumer 461 (3.7%)
tier-0 raw drops (all sites): total 492 — no-labour 301, no-consumer 191
validation vs persisted world state (t=15984): buildBlocked 202 match / 0 mismatch; buildOpportunity 201 match / 0 mismatch
```

## Spec — necessity weighting + derived demand in the build planner

```
What changes:  Colonies start building the supply chains for goods they cannot yet make. When a
               higher-tier good is short and one of its ingredients is the reason a factory can't
               be proposed, the planner now treats that missing ingredient as demanded too — and
               that demand keeps flowing down through missing ingredients until it reaches raw
               extraction, which can always be built. Separately, the planner puts food- and
               water-serving builds ahead of everything else when several goods are short at once,
               and extraction builds on rich ground now rank above the same build on poor ground.
Why:           The founding-era manufactured-tier collapse is a proposal deadlock (Round 1-2
               evidence). Owner decisions encoded, quoted:
               - "combine the weighting of input goods with the higher tier goods that require
                 them so if there is a high demand for luxuries, than demand spills down onto the
                 goods that supply it" (Kai, 2026-08-25)
               - "the demand spills down onto ALL lower tiers, and is gated by whatever thats
                 goods missing input is, if something is missing a tier-1 component but needs 3,
                 it only affects the missing component, which in turns affects any missing input
                 components all the way down to tier-0, and labor doesnt come into it" (Kai,
                 2026-08-25)
               - Roadmap row direction: "extend unmet tier-1/2 demand down the recipe chain as
                 derived demand on the unsatisfied inputs" and the survival-first half: "the
                 player gets survival-first advice by hand and the planner does not follow it
                 when automated — same data, two answers depending on a switch. This row closes
                 that." Plus the row's fold-in: tier-0 yield-awareness via marginalSlot.
Evidence:      R4 (competition): bands compete in 62.5%/26.3% of founding runs, interleaving
               100% — licenses "weighting has a large surface"; does NOT license "survival
               builds are starved" (realised displacement 8-9.5%). R5 (gate): colony tier-1+
               candidacies fail inputsAvailable 69-79%, homeworlds 0%, largest reason by 2.6× —
               licenses the deadlock mechanism and its colony location; does NOT license
               "removing the gate is safe" (no-labour 26.9% stands behind it). R1-R3 (Round 1):
               factories that exist are not starved; construction pool/funding not the
               constraint; the gate's mechanism with receipts. All founding-era horizons; no
               equilibrium claim anywhere in this spec.
Not claimed:   The inputsAvailable gate itself is unchanged — nothing is proposed where inputs
               are missing; the spill builds the inputs instead. Nothing here touches demandRate,
               market demand, pricing, satisfaction or Provision (the killed "necessity as
               demand-curve slope" precedent: demandRate is the unit of account). The no-labour
               binder (26.9% and rising) is NOT addressed — a released proposal may still fail
               staffing; per-level landing is queue item 2, separate. The 13× per-good unit bias
               inside a band is not corrected. No claim that survival builds are being rescued —
               the weighting changes claim/funding ORDER. No UI change; no save-shape change.
```

### Behaviour

**B1 — Derived demand (the spill).** Inside one faction planner run, after the structural pass
and the speculative floor have built `remainingByGood` (the same planner-internal seam the floor
already writes, `lib/engine/directed-build.ts:825-834`), the planner walks goods in REVERSE
recipe-topological order (`PRODUCTION_GOOD_ORDER` reversed, `lib/constants/recipes.ts:44` —
consumers before their inputs, so one pass cascades fully). For each system s with remaining
shortfall R(g,s) of a tier-1+ good g, and for each recipe input i of g (`GOOD_RECIPES`,
`lib/constants/recipes.ts:14`): if i is **missing at s**, add a derived shortfall
`D(i,s) = R(g,s) × recipe[g][i]` onto `remainingByGood[i][s]`. Inputs that are not missing get
nothing. **"Missing" is exactly `inputsAvailable`'s per-input predicate**
(`lib/engine/directed-build.ts:599-613`: no local production building of i, and no reachable
surplus source of i) — extracted into one shared helper so the spill exists precisely where the
gate blocks and the two can never disagree. Because the walk is reverse-topological, D lands on
components before components is visited, so its own missing inputs receive the cascade in turn;
tier-0 goods have no recipe and terminate it. Termination and bounding come from the recipe
graph's validated acyclicity (`PRODUCTION_GOOD_ORDER`'s own tests), NOT from tier depth:
intra-tier recipe edges make the worst real chain 4 hops (`ship_frames → hull_plating → alloys
→ metals → ore`), and single-input ratio-1 recipes (`metals: {ore: 1}`, `fuel: {gas: 1}`)
forward their full magnitude — only multi-input recipes split it. (Corrected at spec review; a
good can never feed back into itself.)

**Seam ordering (spec-review F5):** `surplusSystemsByGood` — the reachable-donor map the
missingness helper reads — is today built AFTER the named seam
(`lib/engine/directed-build.ts:841-852` vs the floor at :825-834). Its construction moves ahead
of the spill; semantics-neutral, since the speculative floor does not read it.

**Death rule (the roadmap's Don't):** derived demand is never persisted — it is recomputed from
live shortfalls and live missingness every planner run, and vanishes by construction the run its
parent shortfall closes or its input stops being missing. There is no decay rule because there
is no state.

**What serves a derived deficit:** the existing opportunity machinery unchanged — D(i,s) sits at
the consuming system s in `remainingByGood`, so any site reachable to s (including s itself,
which wins on `selfCost`) scores an opportunity to serve it, extraction sites included. No new
proposal kind, no new gate.

**Amendment — the spill nets against reachable supply instead of the binary missing test (Kai,
2026-08-26).** The shipped first cut spilled all-or-nothing per input via `inputMissingAt` (no
donor at all → full spill; any donor → none). Owner call, quoted: "we already do the same for
ordinary deficits… it wouldnt ever make sense to build stuff without actually getting the
resources if they are using imports." The spill now mirrors the structural pass's flow-aware
cancellation (`assessStructuralDeficits`'s `coveredFraction = min(1, Σ spare ÷ Σ reachable
gaps)`, `lib/engine/directed-build.ts:390-400` docstring): per input i, the raw derived need
`N(i,s) = R(g,s) × ratio` is netted to `D(i,s) = N(i,s) × (1 − coveredFraction_i)`, where
coverage pools the RATE spare (realised `production − demand`, strike-idled capacity excluded —
the structural pass's own spare definition, :448) of reachable producers of i across ALL of this
run's derived claims on i, exactly as structural gaps share exporter spare. No donors → full
spill (unchanged); full coverage → zero spill; partial coverage → proportional. The cascade
consumes NETTED amounts (a lower hop sees what its consumer genuinely cannot import, not the raw
chain). Two deliberate simplifications, stated: spare is not decremented for its structural-gap
use first (mild over-netting, conservative — errs toward building less); and the GATE keeps its
own stock-based binary predicate unchanged — the gate asks "could a factory here be fed at all",
the spill now asks "how much flow do imports genuinely not cover", and they are allowed to
answer differently. B1's earlier "spill condition ≡ gate-fail condition" identity is superseded
by this amendment.

**Queued inputs count as available — accepted, deliberate (spec-review F2, owner call).**
`effectiveBuildSystems` folds queued project levels into `buildings`
(`lib/engine/directed-build.ts:351-354`) before planning, and the missingness/gate test reads
`buildings[input] > 0` (:609) — so the cycle after a spill-triggered input extractor is queued,
the factory above it can be proposed while its supply is still under construction. This is
accepted as pipelining, not tightened: the chain builds ahead of itself so the factory finishes
soon after its input does, rather than waiting serially ("it actually makes more sense in that
way build ahead of time, so the factory needing input is finished soon after the input factory"
— Kai, 2026-08-25). The bound: the factory idles only for the construction gap (the economy's
`inputGate` throttles it meanwhile; decay cannot shed for recipe-input idleness by design;
founding-era pool is near idle, R2), and the per-level landing row (roadmap queue item 2)
shrinks that gap to months. Consistent with the fold's own authored intent ("Queued consumers
also expose their input draw before they land, keeping the supply chain honest", :340).

**B2 — Necessity weighting (survival band).** Two ordering points change; no score formula
changes. (1) The opportunity claim order: the descending-score sort
(`lib/engine/directed-build.ts:993`) becomes band-then-score — opportunities whose built good is
in `SURVIVAL_GOODS` (water, food — `lib/constants/physical-economy.ts:153`) rank above all
others, score-descending within each band. This is the same rule the engine already applies when
persisting the per-system best opportunity (`recordScoredOpportunity`,
`lib/engine/directed-build.ts:776-786`) and the alert bar applies on read
(`lib/services/alerts.ts:149`) — one rule, now applied where builds are actually chosen. (2) The
funding order: `orderProposals` (`lib/engine/construction.ts:279`) becomes housing →
survival-serving industry bundles by descending ROI → everything else (industry, colonies,
centres) by descending ROI, tiebreaks unchanged. **Resolver (spec-review F4):** `BuildProposal`
gains an explicit `producedGood` field (new — set where the industry bundle is emitted,
`lib/engine/directed-build.ts:1159`, from `opp.goodId`; absent/undefined on housing bundles),
and the survival test reads `producedGood ∈ SURVIVAL_GOODS` — never a positional read of
`items` (whose gate-first order puts production LAST, and whose existing tiebreak reads
`items[0]`, the wrong end). Banding is by the good being BUILT; derived demand never changes a
good's band.

**B3 — Tier-0 yield-awareness: REMOVED (Kai, 2026-08-26), measured harmful in both directions.**
Built as specced (a `marginalGround` vector threaded to the planner, multiplying the tier-0
score), then killed by the 24K attribution runs and reverted. The score is one shared scale
across both tiers, and ground values run 0.4-2.5 (`QUALITY_BANDS`,
`lib/constants/substrate-gen.ts:26-31`): unclamped, rich ground inflated the whole tier-0 band
against tier-1+ and extraction out-claimed factories at the shared labour pool (colonies with
tier-1+ industry at 24K: 80 vs 100 on main, B3 alone reproducing the full regression); clamped
at `min(1, groundValue)`, poor-ground demotion starved exactly the colonies whose extraction
feeds the input gate (84 vs 100). Owner's call, quoted: "once your on a system, demand is demand,
you shouldnt build a water extractor just because the yield is high if everyone really needs
fuel" — yield preference is a colonisation-time concern (`colonyValue` already prices deposit
richness), not a build-ranking one. Nothing of the thread survives in code; this block is the
record of why nobody rebuilds it.

**Edges.** Zero shortfall → zero spill. A suppressed (striking) local producer of i still counts
as "not missing" — mirrors `inputsAvailable` exactly, stated deliberately. Automation off: the
assessment (and so the spill) still runs — the switch gates proposal emission only
(`lib/tick/processors/directed-build.ts:470-471`) — so the alert bar's Build opportunity chip
now surfaces derived-demand-driven tier-0 opportunities to a manual player; same data, same
answer as the automated planner, which is the row's point. Determinism: pure function of the
run's inputs, no RNG, no wall-clock. Save/load: nothing persisted, no `World` shape change.

### Acceptance (sim-observable, founding-era)

- Colony-site tier-1+ input-gate failure share (R5's instrument or its BuildDropReport proxy)
  falls materially below the 69.4%/79.1% baseline at the same boundary windows, same seed.
- 16K electronics/machinery producing-market count rises above the baseline 20 (colonies gain
  producers); manufactured-tier consumer cover at 16K lifts off 0.00.
- Survival guard: food/water consumer cover at 1K/10K/16K never reads below baseline (the band
  must not be needed for this — R4 says survival mostly lands today — but it must not regress).
- Conservation identities hold; both horizons quoted on the PR per AGENTS.md.

### Hazard worksheet

**1. One quantity, several jobs.**

| Quantity | Readers today | This design moves | Intended? |
|---|---|---|---|
| `remainingByGood` (planner-run-local map) | `planFactionBundles` only — opportunity construction and take-decrement (`directed-build.ts:813-836, 858, 1008`) | Adds derived entries before opportunity construction | Yes — the seam `speculativeFloorExtra` already uses; run-local, so no cross-system reader exists |
| `SURVIVAL_GOODS` | impact run pasted below: 10 refs / 5 modules — population (unrest fold), tick, alerts (band), directed-build (`recordScoredOpportunity`), constants. HAZARD 1 APPLIES | Adds two readers (opportunity sort, `orderProposals`) | Yes — deliberately COUPLED: one necessity definition everywhere; the alert-bar band and the planner band must never diverge (the row exists because they did) |
| `GOOD_RECIPES` | impact: 22 refs / 8 modules (industry input draw, treasury, colonisation-value, homeworld-prefab, supply-chain, industry-panel, directed-build) | Adds the spill as a reader (via shared missing-input helper) | Yes — coupled by meaning: the spill must use the same production graph the economy runs. NOTE its docstring's "Nothing consumes this table yet" is stale — correct it in this work |
| `surplusDrawable` | fresh impact (spec review): `SHARED — 8 references across 3 modules: directed-build, directed-logistics, construction` — logistics donor, build input gate, founding manifest, PLUS `lib/services/construction.ts:69` (`foundingSupplyBySource`, read-only UI mirror of the founding staging draw) | Read via the missing-input predicate, unchanged; the UI mirror unaffected (no write path) | Yes — deliberately unchanged; narrowing it is out of scope and flagged Not-claimed |
| `marginalSlot` | impact: CONTAINED, 2 modules (worked-deposits producer, industry worked-prefix maths) | Adds the tier-0 score as a third reader | Yes — read-only lookup of authored ground value; the score reads the same ground the build would realise |

`npm run impact -- SURVIVAL_GOODS` (verdict block, verbatim): `SHARED — 10 references across 5
modules: physical-economy, directed-build, population, tick, alerts. HAZARD 1 APPLIES.`
`npm run impact -- GOOD_RECIPES`: `SHARED — 22 references across 8 modules: industry, recipes,
treasury, colonisation-value, directed-build, homeworld-prefab, supply-chain, industry-panel.`
`npm run impact -- marginalSlot`: `CONTAINED — 3 references across 2 module(s): industry,
worked-deposits.` `npm run impact -- assessStructuralDeficits`: `CONTAINED — 3 references across
1 module(s): directed-build.` `npm run impact -- orderProposals`: `CONTAINED — 4 references
across 2 module(s): construction, directed-build.` `npm run impact -- surplusDrawable` (spec
review): `SHARED — 8 references across 3 modules: directed-build, directed-logistics,
construction.`

**2. Constants read for their authored meaning.**

| Constant | Docstring says | Used as | Same? |
|---|---|---|---|
| `GOOD_RECIPES` | "produced good → input good: units consumed per unit output… input *structure* is fixed, quantities first-draft" (`recipes.ts:3-13`) | Input structure for missingness; quantities for D's magnitude | Yes — structure is the load-bearing part; magnitudes inherit the same first-draft status as the recipe itself |
| `SURVIVAL_GOODS` | "the survival goods" fold basis, water+food (`physical-economy.ts:153`) | The band membership | Yes — same authored meaning the unrest fold and alert bar use |
| `PRODUCTION_GOOD_ORDER` | "every good appears after all of its recipe inputs… Kahn's over GOOD_RECIPES, validated acyclic" (`recipes.ts:37-43`) | Reversed, as the spill's cascade order | Yes — the acyclicity its tests pin is exactly what makes one reverse pass complete |
| `groundValue` (DepositSlot) | worked-prefix realised yield component (quality × modifier) | Tier-0 score scaling | Yes — the score predicts the same figure production realises |

**3. A system not thought about.**

| System | Interaction | Reason if none |
|---|---|---|
| Events | Indirect only: event modifiers move production/demand, which move the shortfalls the spill reads — automatic, no event-specific code path | — |
| Population + migration | More colony industry → jobs pull migration (existing chain); spill itself reads nothing population-side and writes nothing | — |
| Unrest / regime | None — unrest folds read satisfaction/Provision, which this never touches | Planner-local quantities only |
| Industry + staffing | The labour gate (`fitFor`) and one-unit lead bound every released proposal exactly as today; no-labour expected to RISE as the gate stops firing first (R5 licenses this) — acceptance reads it. Queued inputs count as available (B1's accepted-pipelining block, spec-review F2): a released factory may idle input-starved for the construction gap, throttled by the economy `inputGate` |  |
| Infrastructure decay | Built-ahead-of-staffing risk unchanged: the one-unit lead is decay-safe by the existing whole-idle-level rule | — |
| Directed logistics | Deliberately none: logistics reads market demand, not planner deficits — derived demand creates NO hauls until real factories exist and draw real inputs | — |
| Directed build / planner | The subject | — |
| Colonisation + founding manifest | Colony proposals rank in orderProposals' third band — they now sit behind survival industry; intended (feeding existing worlds precedes founding new ones), and expected small on R2's receipts: construction funded fraction median 1.000/p10 1.000 over 13.0K billed cycles with the pool near idle, so a reorder rarely changes which proposal a cycle funds — read at the acceptance run | — |
| Treasury / purse | More funded construction work → bigger construction-band bill; R2 measured funded fraction median 1.000 and pool near idle, so headroom exists at founding; equilibrium bill growth is a tuning read, not a design risk | — |
| Factions + relations | None — per-faction planner, no cross-faction read | — |
| Save format | None — nothing persisted | Run-local recomputation |
| Harness metrics | BuildDropReport reason mix shifts (fewer no-input-supplier, more no-labour/landed); cover metrics move — acceptance reads them cohorted | — |

**4. Symptoms asserted with measurement.** All claims this spec rests on carry R1-R5's frames
(horizon + cohort) above; no new behavioural claims are introduced beyond them.

**5. Primitives that must exist.**

| Consumes | Produced at | Shape today | Design assumes |
|---|---|---|---|
| Per-input missingness | `inputsAvailable` body, `directed-build.ts:608-612` | boolean per input: local building OR reachable surplus source | Same predicate, extracted shared |
| `remainingByGood` seam | `directed-build.ts:813-836` | `Map<goodId, Map<systemId, shortfall>>`, mutated by the floor already | Additive writes compose (they do — floor precedent) |
| Reverse topological order | `PRODUCTION_GOOD_ORDER`, `recipes.ts:44-62` | array, inputs-first; validated acyclic | Reversing gives consumers-first |
| `marginalSlot` | `worked-deposits.ts:206` | `DepositSlot \| null` with `groundValue` — needs `DepositSlot[]`, which the planner's input types do NOT carry (spec-review F1) | Consumed adapter-side only, never in the planner |
| `marginalGround: ResourceVector` | NEW — adapter-side, computed with the other body-folded vectors and threaded through `SystemBuildRow`/`BuildSystemState` | per-resource groundValue of next unworked slot, neutral 1.0 when none | B3's score multiplier |
| Survival band rule | `recordScoredOpportunity` (`directed-build.ts:776-786`), `alerts.ts:149` | band-then-score, first-scored tie | Same rule at sort + funding |

**6. Aggregates that move for other reasons.**

| Metric | Cohort read at | What else moves it |
|---|---|---|
| Tier-1+ gate-failure share | Colony sites, boundary windows, per horizon | Colony COUNT grows over founding — read the share, not the raw count, and quote candidacy totals beside it |
| Manufactured-tier cover | Consumer-market cohort, 16K | Cohort mix (new colonies enter as zero-cover consumers) — read cohorted per the simulate report, both horizons |
| Producing-market count | Per good, colonies vs homeworlds | Nothing else adds producers at colonies today (R5: 0 gate passes → near-zero colony producers), so this is the clean signal |
| Survival cover guard | Consumer cohort, all three windows | Founding cohort mix — compare same-seed baseline, same windows |

### Falsifiers (provenance)

Committed at `535e4134` before the instruments ran, moved here unedited:

> Falsifier: if at both the 10K-era and 16K-era boundary windows fewer than 10% of planner runs
> with any scored opportunity score both bands, OR fewer than 10% of those both-band runs show
> any interleaving (every survival opportunity already out-ranks every non-survival one), the
> weighting has nothing to act on and the weighting half of the row goes back to brainstorm.

> Falsifier: if at the 16K-era boundary window under 25% of colony-site tier-1+ candidacies
> reaching the input gate fail it, or "no-input-supplier" is not the largest raw tier-1+ drop
> reason at colony sites, the deadlock framing is false and the derived-demand direction goes
> back to brainstorm.

Both survived (Round 2 outcome below).

## Build plan

Pure engine + one adapter thread; no UI tasks. Single `feat/*` branch, one PR (AGENTS.md owns
the PR unit); tasks are check-in pauses, not PRs.

### Resolution table

| Measure (spec prose) | State | Producer |
|---|---|---|
| Derived shortfall `D(i,s) = R(g,s) × recipe[g][i]` | new | Task 2 |
| `remainingByGood` seam | exists | `lib/engine/directed-build.ts:813-836` (read this session) |
| Per-input missingness predicate | exists → extracted | `inputsAvailable` body `:608-612`; Task 1 extracts unchanged |
| `surplusSystemsByGood` (moved earlier) | exists | `:841-852`; Task 1 moves construction ahead of the floor |
| Reverse topological order | exists | `PRODUCTION_GOOD_ORDER`, `lib/constants/recipes.ts:44-62`, reversed |
| Recipe ratios | exists | `GOOD_RECIPES`, `lib/constants/recipes.ts:14-35` |
| Survival band membership | exists | `SURVIVAL_GOODS`, `lib/constants/physical-economy.ts:153` |
| Band-then-score comparator precedent | exists | `recordScoredOpportunity`, `lib/engine/directed-build.ts:776-786` |
| `producedGood` on industry proposals | new | Task 3 (set from `opp.goodId` at bundle emission `:1159`) |
| Funding-order bands | exists → changed | `orderProposals`, `lib/engine/construction.ts:279-304` |
| `marginalGround: ResourceVector` | new | Task 4 (adapter-side fold; `ResourceVector` at `lib/types/game.ts:34`, `unitResourceVector` at `lib/engine/resources.ts:18`) |
| Good → resource mapping (tier-0) | exists | `BUILDING_TYPES[goodId].resource`, used at `directed-build.ts:536` |
| Marginal slot lookup | exists | `marginalSlot`, `lib/engine/worked-deposits.ts:206`; bodies via `slottedBodiesBySystem` (`lib/world/tick.ts:57` import) |
| Row build site for the thread | exists | `buildBuildRows`, `lib/world/tick.ts:466-482`; consumer adapter `lib/tick/adapters/memory/directed-build.ts:49` |
| Colony gate-failure share (verification) | exists (instrument) | `temp/planner-competition-diag.ts` + its PLANNER_DIAG hook re-patch (gitignored; memory: temp-diag-runners) |

### Task 1 — Move the surplus map ahead of the demand seam and extract the shared missingness helper

Files:      lib/engine/directed-build.ts
Interface:  `inputMissingAt(input: string, site: BuildSystemState, surplusSystemsByGood: Map<string, string[]>, routeCost: RouteCost): boolean` — the exact per-input term of today's `inputsAvailable` (`:608-612`), negated naming for the spill's reading; `inputsAvailable` reconsumes it. `surplusSystemsByGood` construction relocated above the speculative-floor loop (before any `remainingByGood` mutation); the early-return at `:836` keeps its position relative to the floor.
Proves:     the gate's verdict is bit-identical to today on every existing engine test (pure refactor); a site with a local producing building of the input reads not-missing; a surplus donor reachable only beyond maxHops reads missing; the relocated map is built from unmutated market state (the floor's `remainingByGood` writes cannot feed it); the helper and the gate can never disagree on the same inputs (one body, two callers).
Consumes:   nothing.

### Task 2 — The spill: derived demand onto missing inputs, reverse-topologically

Files:      lib/engine/directed-build.ts
Interface:  internal to `planFactionBundles`: after the speculative-floor loop, a pass over `[...PRODUCTION_GOOD_ORDER].reverse()` adds `D(i,s) = R(g,s) × GOOD_RECIPES[g][i]` to `remainingByGood[i][s]` for every tier-1+ good g with remaining shortfall at s and every input i where `inputMissingAt(...)` is true. No new exported symbols, no persistence, no World-shape change.
Proves:     a good missing 1 of 3 inputs spills onto exactly that one (the other two receive zero); the 4-hop chain cascades (a ship_frames shortfall with everything missing reaches ore, scaled by the product of the ratios on the path); a single-input ratio-1 recipe forwards full magnitude; a QUEUED input building suppresses the spill for that input (the effective-buildings fold); zero parent shortfall spills nothing; a spilled tier-0 deficit is served by the ordinary opportunity machinery (an extractor opportunity appears at or near s and can land).
Consumes:   Task 1 (`inputMissingAt`, relocated `surplusSystemsByGood`).

### Task 3 — Survival band at the claim order and the funding order

Files:      lib/engine/directed-build.ts, lib/engine/construction.ts
Interface:  `PlannedBundle` and `BuildProposal` gain `producedGood?: string` — set to `opp.goodId` on industry bundles at emission (`directed-build.ts:1159` and the bundle→proposal join in `planFactionProposals`), absent on housing; `opportunities.sort` (`:993`) becomes band-then-score with band = `SURVIVAL_GOODS.includes(goodId)` (comparator mirrors `recordScoredOpportunity`'s rule); `orderProposals` (`construction.ts:279`) orders housing → `producedGood ∈ SURVIVAL_GOODS` by descending ROI → everything else by descending ROI, existing tiebreaks unchanged within bands.
Proves:     a higher-scored non-survival opportunity ranks below any survival opportunity at the sort (and claims shared deficit capacity after it); within one band, order is still by score/ROI; housing still leads everything; a colony proposal funds in the third band; `producedGood` is present on every industry bundle and absent on every housing bundle (the vacuity check: the survival test read `producedGood`, never `items[0]`); determinism — equal inputs in permuted order produce the identical queue.
Consumes:   nothing from Tasks 1-2 (same file; ordered here to serialise edits).

### Task 4 — marginalGround: fold, thread, and fold into the tier-0 score

Files:      lib/engine/worked-deposits.ts, lib/world/tick.ts, lib/tick/world/directed-build-world.ts, lib/tick/processors/directed-build.ts, lib/engine/directed-build.ts, plus every engine/adapter/processor test fixture constructing a `SystemBuildRow`/`BuildSystemState` (required field, `extractionEff` precedent — the docstring at `directed-build-world.ts:27-30` is the model)
Interface:  `marginalGroundVector(bodies: SlottedBody[], workedOf: (r: ResourceType) => number): ResourceVector` (new, `worked-deposits.ts`) — per resource, the `groundValue` of `marginalSlot(depositSlotOrder(bodies, r), workedOf(r))`, neutral 1.0 when null. Worked counts are passed IN by the caller (`extractorsOnResource` lives in `directed-build.ts:517`; `worked-deposits.ts` must not import from it — cycle); `SystemBuildRow.marginalGround: ResourceVector` (required) computed in `buildBuildRows` (`lib/world/tick.ts:466`) from the `slottedBodiesBySystem` fold already in scope in `runWorldTick`; threaded through `toBuildState` into `BuildSystemState`; the tier-0 score's `perUnit` (`directed-build.ts:897`) multiplied by `site.marginalGround[resource]` (resource via `BUILDING_TYPES[goodId].resource`). Fixtures pass `unitResourceVector()` for the neutral reading.
Proves:     two sites with equal shortfall service and unequal next-slot ground rank rich-first; the multiplier reads the NEXT unworked slot, not the worked average (a site whose worked prefix is rich but next slot poor ranks by the poor slot); neutral 1.0 when no unworked slot remains (and such a site is already capUnits-gated); take/served arithmetic and realised production unchanged (score-only); omitting the field in a fixture is a compile error, not a silent neutral.
Consumes:   nothing (independent of Tasks 1-3 except shared-file serialisation).

### Task 5 — net the spill against reachable rate spare (the 2026-08-26 amendment)

Files:      lib/engine/directed-build.ts
Interface:  the spill loop's per-input arm replaces its `inputMissingAt` test with proportional
            netting: per input good i, one per-run `coveredFraction_i = min(1, Σ reachable rate
            spare of i ÷ Σ this run's raw derived claims on i)` mirroring the structural pass's
            formula and spare definition (realised production − demand, suppressed excluded);
            `D(i,s) = R(g,s) × ratio × (1 − coveredFraction_i)`. Reverse-topological cascade
            unchanged but consumes netted amounts. `inputMissingAt` stays gate-only.
Proves:     (1) full rate coverage → zero spill even though the OLD binary test would have
            spilled (a donor with ample spare); (2) partial coverage nets proportionally (spare
            = half the pooled claims → half the raw need spills); (3) spare is POOLED across
            claimants — two colonies claiming one donor's spare are both netted by the shared
            fraction, never each by the full spare; (4) no reachable spare → full spill
            (unchanged); (5) the cascade propagates netted, not raw, amounts down a 2-hop
            chain; (6) a strike-suppressed producer's idle capacity is not spare (mirrors
            structural).
Consumes:   Task 2 (the spill loop), Task 1 (reachability via routeCost; `inputMissingAt`
            untouched).

### Gate — sim verification (after Task 5)

Arms: `npm run build`; `npx vitest run`; `npm run simulate` (both horizons) plus the 16K config used for R1-R5 (seed 42, 600 systems); re-patch the PLANNER_DIAG hook and re-run `temp/planner-competition-diag.ts` (same windows).
Reads: colony-site tier-1+ input-gate failure share vs 69.4%/79.1% baseline (16K/10K windows); electronics/machinery producing-market counts vs baseline 20 (colonies must gain producers); manufactured-tier consumer cover at 16K vs 0.00 — all cohorted; survival guard: food/water consumer cover at 1K/10K/16K not below baseline; conservation identities green.
Merge condition: gate-failure share materially down AND colony producers appear AND survival cover not regressed AND identities hold; the PR quotes both horizons per AGENTS.md. Hook reverted after the re-run (grep PLANNER_DIAG over lib/ clean).

### Verification

The gate above is the feature proof — sim metrics at both horizons, cohorted (homeworld vs
colony), never fixtures alone. No new committed harness metric: the drop-share read lives in the
gitignored diag (booked in memory temp-diag-runners with its re-patch instructions); the
simulate report already carries cover and producing-market counts cohorted.

### Doc fold (on the branch, before final review)

- `docs/active/gameplay/economy-autonomic-agency.md` — planner section gains the spill, the
  survival band, the tier-0 ground-value scaling, and the accepted queued-inputs pipelining
  statement (present tense, no history).
- `docs/SPEC.md` — the Directed Logistics & Autonomic Agency paragraph's planner sentences
  updated to match.
- `docs/ROADMAP.md` — queue item 1 (necessity weighting) deleted at ship; its non-shipped
  remainders move per Not covered below.
- This working file deleted at ship (evidence worth keeping is already in the roadmap row's
  history and the active-doc fold).

### Not covered

- **No-labour binder (26.9% of colony tier-1+ drops, rising as the gate opens)** — deliberately
  untouched (spec Not-claimed). Booked: the per-level landing row is roadmap queue item 2; the
  binder itself is re-read at this plan's gate (its share is in the diag output the gate quotes).
- **Within-band 13× per-good unit bias** — dropped, with reason: the band removes the
  cross-band consequence the roadmap row cared about; within-band bias is the same score
  semantics as today, and re-scaling it is tuning this spec's evidence does not license.
- **Necessity in logistics routing** — booked already: the goods-pillar row's "carry necessity
  into the routing calculations too" line (`docs/ROADMAP.md`, good-allocation cliff row); not
  duplicated here.
- **`surplusDrawable` three-way (now four-way) share** — dropped from this feature, with reason:
  spec review confirmed the fourth reader is a read-only UI mirror; narrowing the shared
  denominator is its own design conversation, flagged in the hazards file already.

### Net-new UI

None — no task touches a component; the alert bar already renders banded opportunities and
inherits the planner's signals unchanged.

### Round 2 outcome

Claim 3 **confirmed** (falsifier needed <10% both-band runs or <10% interleaving; actual
62.5%/26.3% and 100%/100%). Claim 4 **confirmed** (falsifier needed <25% gate failure or a
larger rival reason; actual 69-79% and largest by 2.6×). Both pre-design reads the roadmap row
committed are now taken; next is the single design pass covering necessity weighting + derived
demand together. Two evidence-shaped notes for that pass: the weight's leverage is ordering
(claim priority and funding order), not rescuing survival builds that currently die; and
no-labour (26.9% and rising as the gate loosens) is the binder standing behind the gate, so
derived demand's unblock estimate must not assume a released proposal lands.

