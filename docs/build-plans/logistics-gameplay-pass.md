# Logistics gameplay pass — working file

Roadmap row: **[L] Logistics gameplay pass**. Transient; deleted on the PR that finishes the work.

## Decisions so far (2026-09-06)

- **Hauling cost — already shipped, found at spec time (2026-09-06).** Work = quantity × the
  congestion-priced route cost, billed to the faction treasury at `LOGISTICS_RATE_PER_WORK`
  (`lib/constants/treasury.ts:26`) in its own funded band with its own slider
  (`components/factions/treasury-card.tsx:130`); the latched paid fraction scales the haul budget
  (`lib/tick/processors/directed-logistics.ts:176`). The roadmap's "hauling costs nothing" was
  stale. The rate constant is the tweak knob; nothing to build. Kai: "we already shipped the
  pricing haha, but we just include the tweakable knob." Who *owns* production and movement
  (faction, pop strata, companies) is the faction-direction design pass's question, not this one.
- **Hub/chain depth candidate: a depot** — a staffed, land-billed building whose stock is donor stock
  for logistics, sized per good from measured through-flow (the freight ledger's `routeEdges`), with
  restock ranked below real consumption. The latency case rests on the measurement below.

- **Depot direction after the measure (2026-09-06, Kai):** a depot is not a new building and not a
  through-flow reading. For a good it relays, a world uses the *producer's* donor floor
  (`EXPORT_RESERVE_COVER`, 10 cycles) instead of the ordinary donor's (`DONOR_RESERVE_COVER`, 40
  and clear 56), keeping the ordinary want level (`WAREHOUSE_COVER` 40, deficit below 32). The
  30-cycle band between is what it passes on. Both figures are denominated in cycles of the
  world's own demand, so a depot for a good it does not consume needs a **relayed demand** figure:
  the build planner's local unmet rate deficit for that good (the scan that already asks "is there
  reachable unmet demand nothing can serve") — where no factory can be proposed to close it, the
  same figure sizes the depot and proposes its placement. Placement and sizing are one calculation.
  Depot requests rank **below real consumption** in the matcher: an empty depot reads as zero cover
  and would otherwise jump the hungry-world queue under lowest-cover-first levelling. Open: how
  relayed demand stays honest as neighbours grow their own industry.
- **Dependency on the physical warehouse row** (roadmap, Unqueued): the depot is a market policy
  and needs no building, but its held cover needs physical room; when storage becomes a built
  product, the depot's holding target is that row's build target — one warehouse, not two
  buildings.

## Idea — the supplier floor (decided 2026-09-06; supersedes the depot as the first build)

**Problem.** Almost every served world waits more than a cycle for its goods (Evidence, claim 1),
and the supplier one hop away is not drained but *holding*: a non-producer keeps 40 cycles and
gives only above 56, so every link in a chain fills before it passes anything on (claim 4:
floor-bound is the dominant near-supplier state for the bulk goods; spare-drained ≤ 13%).
Hungry-first levelling orders who is served from what donors will give; it never touches what
they will give — the floor is applied before the matcher sees the stock
(`surplusDrawable`, `lib/engine/directed-logistics.ts:104`).

**Decision — a third market role, the supplier.** A world's export floor for a good follows how
reliably it is replenished. A *producer* has its own output and gives down to the producer floor
(`EXPORT_RESERVE_COVER`, 10). A *supplier* has a steady inbound stream of the good and gives
down to the same floor. A *consumer* has neither and keeps the deep reserve (`DONOR_RESERVE_COVER`
40, clear `SURPLUS_MARGIN`). Supplier status is a per-market rule read off one persisted field —
the rolling inbound rate the arrivals stage already knows at credit time
(`lib/tick/processors/goods-arrivals.ts:118`) — the same written-by-logistics / read-by-matcher
pattern as `squeezeCycles` and `logisticsFundingBound` (`lib/world/types.ts:589-600`). Nobody
nominates suppliers; the planner adds no proposal kind.

**The player's stockpile lever** is the consumer reserve depth: how many cycles a world holds when
it cannot count on being refilled. Coarse, one number, per Kai's exposure rule.

**Deferred, pending a re-measure after the floor rule ships — the depot (synthetic relayed
demand).** It serves only the minority cases the floor rule cannot: a neighbourhood short together
(ore, medicine in claim 4) and the ~half of late sinks with no same-faction system within a cycle
(claim 4). Re-run `temp/depot-diag.ts` claim 1 after the floor rule and decide on what remains.

**Killed.**
- *Through-flow-sized depot* — claim 2: diffuse and unstable.
- *Rate-scan depot* — the planner's scan nets against reachable spare with no latency term
  (`lib/engine/directed-build.ts:505`); reads zero exactly where supply is far.
- *Player-marked depots only* — AI factions get none; automation symmetry.
- *A separate depot building* — the physical warehouse row owns storage as a build product.
- *Nominated depot worlds* (the brainstorm's first direction) — superseded: the supplier rule
  needs no nomination and covers the dominant case.

**Hazards carried to the spec.**
- **Cascade.** In a chain producer → A → B → C, only the producer makes anything; if A, B, C all
  hold the shallow floor because deliveries were steady, one bad producer cycle empties all three
  at once. The reliability read must span several cycles (hysteresis), and the supplier floor is
  never below the ration line however steady the stream. The spec states both numbers.
- **First-release flood.** Switching consumers to suppliers releases up to ~30 cycles of stock
  per market at once; `npm run simulate` reads the transient at both horizons.
- **Events anchor shift** rides the donor reserve today (`lib/engine/directed-logistics.ts:136`);
  the supplier floor states whether it rides too.
- **`surplusDrawable` triple duty** (logistics donor / planner input gate / founding manifest —
  roadmap "Goods-pricing revisit"): a supplier's released stock is visible to all three; intended
  (a supplier is a supplier) but stated per reader.

**Premises.**
- (definitional, Kai 2026-09-06) "steady inbound counts like production" — the supplier role.
- (definitional, Kai) the consumer reserve depth is the player's coarse stockpile lever.
- (checkable, measured) claims 1, 3, 4 above.
- (checkable, next) after the floor rule: the share of served sinks with mean inbound latency
  > 24 ticks falls materially from 96% — the claim-1 instrument re-run is the falsifier for the
  rule having done anything. Kill line: if it is still ≥ 90% at 10K and 16K, the floor was not
  what withheld the stock and the reading of claim 4 was wrong.

## Evidence

### Claim 1 — served deficit worlds sit more than a cycle from their donors

Claim: at the equilibrium horizon, a material share of worlds served by directed logistics receive
their inbound goods from donors more than one economic cycle (24 ticks) of scheduled transit away.

Falsifier: if fewer than 10% of served sink worlds have a volume-weighted mean inbound latency above
24 ticks at **both** 10K and 16K (seed 42, 600 systems, per-faction cohorts reported), depots have no
latency case at this galaxy size and the depot direction goes back to brainstorm. 1K is read too
(pre-founding, homeworld-cluster hauls only) but cannot falsify on its own.

### Claim 2 — through-flow concentrates on few systems and is stable

Claim: haul volume that crosses a system as an intermediate (neither source nor sink) concentrates
on a small set of systems, and that set is stable from one window to the next.

Falsifier: if the top 5% of developed systems by through-volume carry under 30% of all
through-volume, **or** the top-10 through-flow set overlaps under 50% between consecutive
10-cycle windows, at 10K and 16K, the through-flow rule is too diffuse for a player to read and the
depot request rule goes back to brainstorm.

### Instrument

Scratch runner `temp/depot-diag.ts`, no processor hook: after every `runWorldTick` it captures new
`world.pendingArrivals` rows (id-deduped) — dispatch tick, arrival tick, route lanes, endpoints,
good, quantity, leg. Validation: outbound rows with arrival in a window must equal that window's
`flowEvents` count (the arrivals stage is `flowEvents`' only writer).

### Readings

**Claim 1 — CONFIRMED (far beyond the kill line).**

```
Meaning:    Almost every world logistics serves gets its goods more than a cycle after they were
            dispatched; multi-cycle transit is the norm, not a far tail.
Claim:      A material share of served deficit worlds receive inbound goods from donors more than
            one cycle (24 ticks) of scheduled transit away.
Number:     served sinks with volume-weighted mean inbound latency > 24 ticks: 96.5% (166/172) at
            10K, 96.3% (180/187) at 16K; median sink mean latency 63 ticks (10K), 54 ticks (16K);
            sinks whose *nearest used* donor is > 24 ticks: 54% (10K), 44% (16K); 81% of haul
            volume is in flight > 24 ticks at both horizons. Kill line was 10%.
Horizon:    10K (ticks 9601-9840, and 9361-9600) and 16K (15601-15840, and 15361-15600); 1K has
            no hauls (pre-founding).
Cohort:     every developed system that received ≥ 1 outbound haul in the window (98-99% of
            developed systems), seed 42, 600 systems; per-faction split shows every one of the 20
            factions with ≥ 3/4 of its sinks over the line.
Licenses:   supports "latency is large for nearly all served worlds" — the depot's latency case
            exists everywhere, not at a 6-hop tail. Does NOT say the latency hurts anything (no
            provision/famine read here) nor that a nearer buffer would be filled in time. Says
            nothing about unserved deficits (worlds with no haul at all are not in the cohort).
```

**Correction to the session's earlier claim:** "an ordinary lane ≈ 4 ticks, break-even ≈ 6 hops" was
a misreading of the spec's *four days*. The hop histogram (mode 2-3 hops) against the latency
histogram (mode 12-47 ticks, median sink mean 54-63) puts an ordinary hop at roughly 15-20 ticks,
consistent with the spec's "three-lane run ≈ two cycles". Break-even is therefore about two hops,
not six.

**Claim 2 — FALSIFIED.**

```
Meaning:    Goods in transit cross many systems thinly; no small set of systems carries a
            readable share of the through-traffic, and the busiest set reshuffles between windows.
Claim:      Through-flow concentrates on a small set of systems and that set is stable.
Number:     top 5% of developed systems (9-10 systems) carry 11.8% / 12.4% (10K) and 10.2% /
            10.9% (16K) of through-volume — kill line 30%. Top-10 overlap with the previous
            10-cycle window: 6-7/10 at 10K, 3/10 at 16K — kill line 5/10. Per-good top-3 share
            7-16% (one outlier: consumer_goods 22% at 16K). Through-flow touches 361-406 distinct
            systems while only 174-190 are developed, so most through-traffic crosses controlled
            or unclaimed corridor systems that could not host a staffed building.
Horizon:    10K and 16K, two windows each.
Cohort:     all outbound hauls dispatched in the window, all factions; intermediates = every
            system on the route except source and sink.
Licenses:   kills "size a depot from its own measured through-flow" as a legible rule at 600
            systems — the signal is diffuse and unstable. Does NOT kill depots: claim 1 gives
            them a latency case. Does NOT say concentration is absent at 2,000+ systems where
            corridors are longer (unmeasured).
```

### Outcome

Claim 1 confirmed, claim 2 falsified. The depot's *reason* stands (transit latency is
multi-cycle for nearly every served world); its *request rule* (through-flow) goes back to
`/brainstorm`. Two shapes the numbers point at, for the brainstorm, not decided here: the mean
haul crosses 2.2-2.6 intermediate systems, mostly undeveloped ones, so "where goods pass" is
not "where a depot could stand"; and with 96% of sinks over the line, a depot rule may be
better keyed to *what a world imports* (its own inbound, which is stable and local) than to
what passes through it.

### Raw output — `temp/depot-diag.ts 600 42 16000 1000,10000,16000` (2026-09-06, main at 9cf32fa9)

```
validation {"capturedOutbound": 187982, "returnLegs": 68, "flowMismatchTicks": 3, "flowMismatchRows": 4} wallSeconds 160
t1000: captured=0 hauls (pre-founding; first colony ~t4100, first hauls captured between t4000 and t5000)

== t10000 window ticks 9601-9840 hauls=4413 volume=664118.483 developed=174
latency volumeShareOver24=0.821 volumeShareOver48=0.574
hops 1h:607 2h:716 3h:761 4h:736 5h:545 6h:418 7h:282 8h:143 9h:68 10h:48 11h:38 12h:18 13h:15 14h:1 16h:3 17h:6 18h:4 20h:2 21h:2
sinks {"served": 172, "servedShareOfDeveloped": 0.989, "meanLatencyP50": 63.071, "meanLatencyP90": 112.266, "meanOver24": 166, "meanOver24Share": 0.965, "minOver24": 93, "minOver24Share": 0.541}
byFaction 624:5/6(min>24:4) 625:5/5(min>24:5) 626:11/11(min>24:4) 627:3/4(min>24:1) 628:5/6(min>24:1) 629:5/5(min>24:0) 630:13/13(min>24:13) 631:17/19(min>24:7) 632:9/9(min>24:7) 633:8/8(min>24:1) 634:15/15(min>24:4) 635:16/16(min>24:13) 636:9/9(min>24:4) 637:4/4(min>24:4) 638:6/6(min>24:4) 639:5/5(min>24:3) 640:3/4(min>24:2) 641:7/7(min>24:3) 642:12/12(min>24:5) 643:8/8(min>24:8)
through {"totalThroughVolume": 1738377.337, "throughOverHaulVolume": 2.618, "systemsWithThrough": 384, "top5pctN": 9, "top5pctShare": 0.118, "top10Share": 0.128, "top10OverlapWithPrevWindow": 6}
top10 Bastion-10[faction-636]:29716.874, Nexus-12[faction-632]:28593.823, Horizon-20[faction-642]:25883.844, Zenith-32[faction-633]:23621.67, Vanguard-28[faction-635]:21629.083, Horizon-23[faction-642]:19612.768, Vanguard-10[faction-635]:18928.058, Meridian-35[faction-639]:18807.107, Meridian-23[faction-639]:18351.782, Zenith-13[faction-633]:18202.601
byGood chemicals top3Share=0.102 | gas top3Share=0.112 | ore top3Share=0.121 | textiles top3Share=0.07 | minerals top3Share=0.107

== t10000 window ticks 9361-9600 hauls=4159 volume=573402.221 developed=174
latency volumeShareOver24=0.811 volumeShareOver48=0.525
hops 1h:528 2h:649 3h:738 4h:698 5h:498 6h:513 7h:205 8h:181 9h:55 10h:50 11h:31 12h:6 13h:1 15h:1 16h:4 20h:1
sinks {"served": 172, "servedShareOfDeveloped": 0.989, "meanLatencyP50": 60.137, "meanLatencyP90": 107.044, "meanOver24": 166, "meanOver24Share": 0.965, "minOver24": 93, "minOver24Share": 0.541}
byFaction 624:6/6(min>24:3) 625:5/5(min>24:5) 626:11/11(min>24:4) 627:4/4(min>24:1) 628:4/6(min>24:1) 629:5/5(min>24:0) 630:13/13(min>24:11) 631:17/19(min>24:7) 632:9/9(min>24:7) 633:6/8(min>24:1) 634:15/15(min>24:4) 635:16/16(min>24:15) 636:9/9(min>24:4) 637:4/4(min>24:4) 638:6/6(min>24:5) 639:5/5(min>24:3) 640:4/4(min>24:2) 641:7/7(min>24:3) 642:12/12(min>24:5) 643:8/8(min>24:8)
through {"totalThroughVolume": 1291158.005, "throughOverHaulVolume": 2.252, "systemsWithThrough": 361, "top5pctN": 9, "top5pctShare": 0.124, "top10Share": 0.136, "top10OverlapWithPrevWindow": 7}
top10 Vanguard-28[faction-635]:21915.252, Bastion-10[faction-636]:21765.938, Horizon-20[faction-642]:18899.237, Nexus-12[faction-632]:18250.28, Crucible-2[faction-625]:17465.31, Vanguard-10[faction-635]:16317.173, Horizon-23[faction-642]:15365.318, Citadel-3[faction-629]:15360.467, Nebula-12[faction-638]:15344.247, Citadel-1[faction-629]:14367.562
byGood textiles top3Share=0.084 | ore top3Share=0.115 | gas top3Share=0.107 | biomass top3Share=0.111 | chemicals top3Share=0.161

== t16000 window ticks 15601-15840 hauls=4662 volume=1113790.374 developed=190
latency volumeShareOver24=0.809 volumeShareOver48=0.49
hops 1h:711 2h:879 3h:858 4h:686 5h:487 6h:429 7h:324 8h:134 9h:81 10h:34 11h:23 12h:16
sinks {"served": 187, "servedShareOfDeveloped": 0.984, "meanLatencyP50": 53.658, "meanLatencyP90": 99.216, "meanOver24": 180, "meanOver24Share": 0.963, "minOver24": 82, "minOver24Share": 0.439}
byFaction 624:7/7(min>24:2) 625:7/7(min>24:7) 626:11/11(min>24:2) 627:3/4(min>24:1) 628:5/6(min>24:1) 629:3/4(min>24:0) 630:15/15(min>24:11) 631:20/20(min>24:8) 632:10/10(min>24:5) 633:7/8(min>24:1) 634:14/16(min>24:3) 635:18/18(min>24:12) 636:9/9(min>24:4) 637:7/7(min>24:5) 638:6/6(min>24:4) 639:5/5(min>24:3) 640:6/6(min>24:2) 641:8/8(min>24:3) 642:12/12(min>24:3) 643:7/8(min>24:5)
through {"totalThroughVolume": 2456524.904, "throughOverHaulVolume": 2.206, "systemsWithThrough": 394, "top5pctN": 10, "top5pctShare": 0.102, "top10Share": 0.102, "top10OverlapWithPrevWindow": 3}
top10 Crucible-2[faction-625]:32182.952, Bastion-10[faction-636]:31248.997, Zenith-32[faction-633]:28929.214, Horizon-23[faction-642]:24495.311, Crucible-5[faction-625]:23821.602, Bastion-21[faction-636]:23293.794, Meridian-23[faction-639]:22552.309, Horizon-20[faction-642]:21789.308, Crucible-8[faction-625]:21678.568, Nexus-12[faction-632]:21189.711
byGood gas top3Share=0.081 | ore top3Share=0.078 | minerals top3Share=0.07 | metals top3Share=0.104 | medicine top3Share=0.126

== t16000 window ticks 15361-15600 hauls=4812 volume=1176991.293 developed=190
latency volumeShareOver24=0.795 volumeShareOver48=0.484
hops 1h:699 2h:886 3h:891 4h:691 5h:531 6h:449 7h:317 8h:157 9h:91 10h:39 11h:28 12h:18 16h:2 17h:4 18h:1 19h:2 20h:1 21h:3 22h:1 23h:1
sinks {"served": 187, "servedShareOfDeveloped": 0.984, "meanLatencyP50": 53.457, "meanLatencyP90": 108.303, "meanOver24": 179, "meanOver24Share": 0.957, "minOver24": 82, "minOver24Share": 0.439}
byFaction 624:8/8(min>24:2) 625:7/7(min>24:7) 626:11/11(min>24:3) 627:3/4(min>24:1) 628:4/6(min>24:1) 629:4/5(min>24:1) 630:14/14(min>24:10) 631:19/19(min>24:7) 632:11/11(min>24:6) 633:7/8(min>24:1) 634:15/16(min>24:3) 635:18/18(min>24:12) 636:8/8(min>24:3) 637:7/7(min>24:5) 638:6/6(min>24:4) 639:4/5(min>24:3) 640:5/6(min>24:2) 641:8/8(min>24:3) 642:12/12(min>24:3) 643:8/8(min>24:5)
through {"totalThroughVolume": 2610794.565, "throughOverHaulVolume": 2.218, "systemsWithThrough": 406, "top5pctN": 10, "top5pctShare": 0.109, "top10Share": 0.109, "top10OverlapWithPrevWindow": 3}
top10 Nexus-12[faction-632]:35438.403, Sentinel-1[faction-641]:34808.321, Horizon-20[faction-642]:29946.094, Aegis-3[faction-641]:29131.3, Sentinel-5[faction-641]:28720.713, Rift-18[faction-632]:26534.021, Crucible-2[faction-625]:26373.33, Rift-8[faction-632]:26047.374, Cascade-17[faction-630]:23796.427, Horizon-2[faction-642]:23068.346
byGood ore top3Share=0.066 | gas top3Share=0.071 | metals top3Share=0.091 | minerals top3Share=0.109 | consumer_goods top3Share=0.223
```

### Claim 3 — depot sites exist (the Idea section's first checkable premise)

Site test, per window: for each of the five highest-volume goods, a developed system qualifies
**strictly** when ≥ 1 developed system within two hops (over lanes whose endpoints are own or
unclaimed) has volume-weighted mean inbound latency > 24 ticks for that good, AND the candidate's
own fuel-shortest path to the nearest donor of that good (any source of a haul in the window)
rounds to ≤ 24 ticks. **Relaxed** (secondary, not the falsifier): the worst late neighbour's
latency exceeds the candidate's donor distance by ≥ 24 ticks.

```
Meaning:    More than half of developed worlds sit within a cycle of a supplier of a top good
            while a neighbour within two hops waits over a cycle for that same good — and those
            neighbours get almost none of their inbound from anywhere near.
Claim:      A material share of developed systems qualify as a depot site for a top-five good.
Number:     strict sites (any of top-5 goods): 63.8% (111/174) at 10K, 56.3% (107/190) at 16K —
            kill line 10%. Relaxed: 71.3% / 65.3%. Per good, 29-55 strict sites of 174-190.
            Median relayed demand at a site (late neighbours' inbound per cycle): 29 (10K),
            92 (16K) vs median sink inbound per cycle 12 / 33 — a site relays ≥ 2 median consumers.
            **Of strict sites, 65-80% are self-donor** (the site itself shipped the good in the
            window: gas 29/43, textiles 45/55 at 10K; gas 26/43, medicine 25/34 at 16K), and late
            neighbours receive only **0.4-12% of their inbound from within one cycle's transit**
            (mean near-inbound share per good 0.035-0.119 at 10K, 0.004-0.038 at 16K).
Horizon:    10K (ticks 9601-9840) and 16K (15601-15840); 1K has no hauls.
Cohort:     all developed systems, per faction graph; top-5 goods by window haul volume (10K: gas,
            textiles, chemicals, ore, minerals; 16K: gas, ore, minerals, biomass, medicine).
Licenses:   supports "sites are common, and relayed demand is large enough to be worth hauling."
            Also supports a sharper finding: a supplier within a cycle of a late world is the
            NORM, yet it serves almost none of that world's inbound. Does NOT say why — two
            readings fit: the near supplier is an ordinary donor holding to its 40/56-cycle floor
            (the depot policy fixes exactly that), or it is spare-bound (its drawable stock is
            exhausted each run and the far hauls are the residual; a depot then helps only by
            pre-positioning far-sourced stock). Both keep the direction; they decide its scope.
            Under-counts sites slightly: friendly/allied foreign space is open in the game and
            closed here. "Donor" is any source in the window, not a structural producer.
```

**Outcome:** claim confirmed; the depot direction proceeds to `/feature-spec`. The floor-bound vs
spare-bound split is the spec's first hazard-4 row and needs a matcher hook (donor drawable at
each late deficit's turn) — not measured here.

### Raw output — site test, `temp/depot-diag.ts 600 42 16000 10000,16000` (2026-09-06, same run shape; validation unchanged)

```
== t10000 window ticks 9601-9840 {"topGoods": ["gas", "textiles", "chemicals", "ore", "minerals"], "developed": 174, "strictSitesAnyGood": 111, "strictShare": 0.638, "relaxedSitesAnyGood": 124, "relaxedShare": 0.713, "relayedDemandPerCycleMedian": 29.25168681957083, "medianSinkInboundPerCycle": 12.168159956355504}
  {"good": "gas", "donors": 37, "candidates": 174, "strictSites": 43, "strictSelfDonor": 29, "lateNeighbourNearInboundShareMean": 0.073, "relaxedSites": 60, "withLateNeighbour": 118, "withinCycleOfDonor": 63, "nearestDonorTicksP50": 33}
  {"good": "textiles", "donors": 68, "candidates": 174, "strictSites": 55, "strictSelfDonor": 45, "lateNeighbourNearInboundShareMean": 0.119, "relaxedSites": 65, "withLateNeighbour": 104, "withinCycleOfDonor": 94, "nearestDonorTicksP50": 17}
  {"good": "chemicals", "donors": 23, "candidates": 174, "strictSites": 29, "strictSelfDonor": 20, "lateNeighbourNearInboundShareMean": 0.05, "relaxedSites": 59, "withLateNeighbour": 99, "withinCycleOfDonor": 37, "nearestDonorTicksP50": 52}
  {"good": "ore", "donors": 46, "candidates": 174, "strictSites": 46, "strictSelfDonor": 31, "lateNeighbourNearInboundShareMean": 0.057, "relaxedSites": 61, "withLateNeighbour": 102, "withinCycleOfDonor": 75, "nearestDonorTicksP50": 29}
  {"good": "minerals", "donors": 34, "candidates": 174, "strictSites": 35, "strictSelfDonor": 21, "lateNeighbourNearInboundShareMean": 0.035, "relaxedSites": 63, "withLateNeighbour": 113, "withinCycleOfDonor": 55, "nearestDonorTicksP50": 40}
  sample: gas Eclipse-13[faction-630] donor=0t late=3 worst=240t relayed/cycle=569.8 | gas Eclipse-23[faction-630] donor=0t late=2 worst=240t relayed/cycle=199.8 | gas Horizon-12[faction-642] donor=14t late=1 worst=112t relayed/cycle=27.0 | gas Horizon-17[faction-642] donor=0t late=1 worst=44t relayed/cycle=25.2 | gas Solace-9[faction-642] donor=0t late=1 worst=44t relayed/cycle=25.2 | gas Horizon-18[faction-642] donor=24t late=1 worst=44t relayed/cycle=25.2
== t16000 window ticks 15601-15840 {"topGoods": ["gas", "ore", "minerals", "biomass", "medicine"], "developed": 190, "strictSitesAnyGood": 107, "strictShare": 0.563, "relaxedSitesAnyGood": 124, "relaxedShare": 0.653, "relayedDemandPerCycleMedian": 92.21787952312299, "medianSinkInboundPerCycle": 33.19153120181143}
  {"good": "gas", "donors": 45, "candidates": 190, "strictSites": 43, "strictSelfDonor": 26, "lateNeighbourNearInboundShareMean": 0.024, "relaxedSites": 69, "withLateNeighbour": 118, "withinCycleOfDonor": 83, "nearestDonorTicksP50": 31}
  {"good": "ore", "donors": 49, "candidates": 190, "strictSites": 36, "strictSelfDonor": 25, "lateNeighbourNearInboundShareMean": 0.03, "relaxedSites": 50, "withLateNeighbour": 73, "withinCycleOfDonor": 76, "nearestDonorTicksP50": 29}
  {"good": "minerals", "donors": 48, "candidates": 190, "strictSites": 37, "strictSelfDonor": 26, "lateNeighbourNearInboundShareMean": 0.004, "relaxedSites": 48, "withLateNeighbour": 101, "withinCycleOfDonor": 74, "nearestDonorTicksP50": 30}
  {"good": "biomass", "donors": 48, "candidates": 190, "strictSites": 42, "strictSelfDonor": 28, "lateNeighbourNearInboundShareMean": 0.031, "relaxedSites": 42, "withLateNeighbour": 80, "withinCycleOfDonor": 82, "nearestDonorTicksP50": 27}
  {"good": "medicine", "donors": 34, "candidates": 190, "strictSites": 34, "strictSelfDonor": 25, "lateNeighbourNearInboundShareMean": 0.038, "relaxedSites": 69, "withLateNeighbour": 149, "withinCycleOfDonor": 55, "nearestDonorTicksP50": 48}
  sample: gas Cascade-11[faction-630] donor=0t late=1 worst=27t relayed/cycle=21.6 | gas Eclipse-23[faction-630] donor=0t late=2 worst=280t relayed/cycle=224.1 | gas Horizon-12[faction-642] donor=14t late=1 worst=28t relayed/cycle=43.9 | gas Horizon-17[faction-642] donor=0t late=2 worst=66t relayed/cycle=573.3 | gas Solace-9[faction-642] donor=0t late=1 worst=51t relayed/cycle=43.6 | gas Horizon-18[faction-642] donor=24t late=1 worst=51t relayed/cycle=43.6
```

### Claim 4 — why a near supplier serves so little: floor-bound, not spare-bound

Hook inside `matchFactionTransfers` (temporary, reverted): per logistics run in the window, every
(system, good) row's stock, reserve, demand, production, classification and `surplusDrawable`,
plus each donor's drawable left after the pass. For every late sink (mean inbound latency > 24) in
each run it was a deficit, every same-faction developed system within 24 ticks of transit is
classified: *also_deficit* (short itself), *spare_drained* (had drawable stock, all taken this
run), *spare_left* (had drawable stock nobody took), *floor_bound_unlockable* (drawable 0, not a
producer, stock above the 10-cycle producer floor — the depot policy would release it),
*floor_bound_thin* (below even that), *empty*, *exporter_dry*.

```
Meaning:    The supplier next door is not drained; it is holding stock it is allowed to keep. The
            depot policy's floor change releases it, and for the bulk goods that stock is many
            times the neighbour's shortfall. Where it is not, the whole neighbourhood is short.
Claim:      Late worlds' near suppliers are floor-bound (holding to the ordinary donor line), not
            spare-bound (drained by earlier draws).
Number:     near-candidate-runs classed spare_drained: 2-13% (10K), 0-11% (16K); spare_left
            1-22%. floor_bound_unlockable: gas 49%, textiles 40%, chemicals 31%, ore 32%,
            minerals 37% (10K); gas 32%, ore 43%, minerals 82%, biomass 82%, medicine 5% (16K).
            also_deficit: 34-57% (10K), 16-62% bulk goods and 94% medicine (16K).
            Late-sink deficit runs where floor-unlockable stock within a cycle covers the whole
            shortfall: gas 40%, textiles 37%, chemicals 27%, ore 24%, minerals 33% (10K);
            gas 33%, ore 34%, minerals 80%, biomass 75%, medicine 6% (16K).
            Unlockable ÷ shortfall (summed): gas 15×/14×, chemicals 9×, minerals 18×/41×,
            textiles 2×, biomass 1.6×, ore 0.5×/0.6×, medicine 0.15×.
            Only 45-52% of late sinks have any same-faction developed system within 24 ticks.
Horizon:    10K (9601-9840, 10 runs) and 16K (15601-15840, 10 runs).
Cohort:     late sinks × runs in which they were a deficit; near = same-faction developed systems
            ≤ 24 transit ticks over own/unclaimed lanes; top-5 goods per horizon.
Licenses:   supports both halves of the direction with a split by good: for gas, chemicals,
            minerals, biomass (and textiles at 10K) the near stock exists and the FLOOR is what
            withholds it — the producer-floor policy alone releases it; for ore and medicine the
            neighbourhood is short together (also_deficit dominant, unlockable < shortfall) and only
            an imported, held depot stock (the added-demand half) can shorten their wait. Rules out
            spare-drained as a major cause at both horizons (≤ 13% of near candidates). Does NOT
            say releasing the stock leaves the releasing world safe — it drops to 10 cycles of its
            own demand; the spec decides whether depot status is gated on that world's own
            Provision. Half of late sinks have no near same-faction system at all: for them only
            the imported-stock half (or a claim) can help.
```

**Outcome:** confirmed. Floor-bound is the dominant fixable cause; spare-bound ruled out as a
major cause (both horizons, cohort above). The direction goes to `/feature-spec` with both halves:
the producer floor on relayed goods, and relayed demand where a neighbourhood is short together.

### Raw output — `temp/depot-floor-diag.ts 600 42 16000 10000,16000` with the matcher hook (reverted after the run)

```
hookRows 25480 wallSeconds 159
== t10000 window 9601-9840 runs=10 developed=174
  {"good": "gas", "lateSinks": 96, "lateSinksWithNearSystem": 45, "lateSinkDeficitRuns": 194, "runsWithNear": 87, "nearCandidateRuns": 112, "nearClassShares": {"floor_bound_unlockable": 0.491, "spare_left": 0.116, "also_deficit": 0.339, "spare_drained": 0.054}, "runsAnyFloorUnlock": 0.552, "runsFloorUnlockCoversShortfall": 0.402, "runsAnySpareLeftNear": 0.149, "unlockableOverShortfall": 15.398}
  {"good": "textiles", "lateSinks": 78, "lateSinksWithNearSystem": 34, "lateSinkDeficitRuns": 138, "runsWithNear": 62, "nearCandidateRuns": 80, "nearClassShares": {"floor_bound_unlockable": 0.4, "spare_left": 0.075, "also_deficit": 0.4, "spare_drained": 0.125}, "runsAnyFloorUnlock": 0.371, "runsFloorUnlockCoversShortfall": 0.371, "runsAnySpareLeftNear": 0.097, "unlockableOverShortfall": 2.027}
  {"good": "chemicals", "lateSinks": 86, "lateSinksWithNearSystem": 40, "lateSinkDeficitRuns": 291, "runsWithNear": 174, "nearCandidateRuns": 220, "nearClassShares": {"floor_bound_unlockable": 0.305, "also_deficit": 0.568, "empty": 0.041, "spare_drained": 0.05, "spare_left": 0.018, "floor_bound_thin": 0.018}, "runsAnyFloorUnlock": 0.374, "runsFloorUnlockCoversShortfall": 0.27, "runsAnySpareLeftNear": 0.023, "unlockableOverShortfall": 9.309}
  {"good": "ore", "lateSinks": 78, "lateSinksWithNearSystem": 37, "lateSinkDeficitRuns": 193, "runsWithNear": 118, "nearCandidateRuns": 139, "nearClassShares": {"floor_bound_unlockable": 0.324, "also_deficit": 0.547, "spare_left": 0.108, "spare_drained": 0.022}, "runsAnyFloorUnlock": 0.347, "runsFloorUnlockCoversShortfall": 0.237, "runsAnySpareLeftNear": 0.127, "unlockableOverShortfall": 0.488}
  {"good": "minerals", "lateSinks": 87, "lateSinksWithNearSystem": 46, "lateSinkDeficitRuns": 205, "runsWithNear": 110, "nearCandidateRuns": 120, "nearClassShares": {"also_deficit": 0.558, "floor_bound_thin": 0.042, "floor_bound_unlockable": 0.367, "spare_left": 0.033}, "runsAnyFloorUnlock": 0.4, "runsFloorUnlockCoversShortfall": 0.327, "runsAnySpareLeftNear": 0.036, "unlockableOverShortfall": 18.429}
== t16000 window 15601-15840 runs=10 developed=190
  {"good": "gas", "lateSinks": 86, "lateSinksWithNearSystem": 40, "lateSinkDeficitRuns": 208, "runsWithNear": 84, "nearCandidateRuns": 111, "nearClassShares": {"also_deficit": 0.622, "floor_bound_unlockable": 0.315, "spare_drained": 0.054, "spare_left": 0.009}, "runsAnyFloorUnlock": 0.393, "runsFloorUnlockCoversShortfall": 0.333, "runsAnySpareLeftNear": 0.012, "unlockableOverShortfall": 14.344}
  {"good": "ore", "lateSinks": 52, "lateSinksWithNearSystem": 29, "lateSinkDeficitRuns": 72, "runsWithNear": 47, "nearCandidateRuns": 54, "nearClassShares": {"spare_left": 0.222, "floor_bound_unlockable": 0.426, "spare_drained": 0.056, "also_deficit": 0.296}, "runsAnyFloorUnlock": 0.383, "runsFloorUnlockCoversShortfall": 0.34, "runsAnySpareLeftNear": 0.255, "unlockableOverShortfall": 0.614}
  {"good": "minerals", "lateSinks": 65, "lateSinksWithNearSystem": 34, "lateSinkDeficitRuns": 88, "runsWithNear": 45, "nearCandidateRuns": 51, "nearClassShares": {"floor_bound_unlockable": 0.824, "also_deficit": 0.157, "spare_left": 0.02}, "runsAnyFloorUnlock": 0.889, "runsFloorUnlockCoversShortfall": 0.8, "runsAnySpareLeftNear": 0.022, "unlockableOverShortfall": 40.709}
  {"good": "biomass", "lateSinks": 59, "lateSinksWithNearSystem": 22, "lateSinkDeficitRuns": 73, "runsWithNear": 24, "nearCandidateRuns": 28, "nearClassShares": {"floor_bound_unlockable": 0.821, "also_deficit": 0.071, "spare_drained": 0.107}, "runsAnyFloorUnlock": 0.875, "runsFloorUnlockCoversShortfall": 0.75, "runsAnySpareLeftNear": 0, "unlockableOverShortfall": 1.574}
  {"good": "medicine", "lateSinks": 130, "lateSinksWithNearSystem": 68, "lateSinkDeficitRuns": 859, "runsWithNear": 471, "nearCandidateRuns": 638, "nearClassShares": {"floor_bound_unlockable": 0.053, "also_deficit": 0.944, "spare_drained": 0.003}, "runsAnyFloorUnlock": 0.064, "runsFloorUnlockCoversShortfall": 0.055, "runsAnySpareLeftNear": 0, "unlockableOverShortfall": 0.152}
```

### Claim 5 — is the withheld stock on logistics-fed worlds? (spec-review finding C3)

Claim: the stock claim 4 found withheld behind the consumer floor sits mostly on markets that
logistics itself feeds — over a long window their credited inbound covers most of what they
consume — so an inbound-based supplier test would reach it.

Falsifier (committed before the run): over all non-producer markets holding stock above the
10-cycle producer floor with drawable 0 (the claim-4 floor-bound class, deficits included and
split out), for the five highest-volume goods at 10K and 16K, seed 42 / 600 systems: if **under
30% of the unlockable stock** (Σ stock − 10 × demand) sits on markets whose credited inbound over
the preceding **40 cycles** is ≥ 0.9 × 40 cycles of their demand, then no inbound-based supplier
test reaches the stock claim 4 found, and the role approach is re-assessed rather than re-cut
(Kai, 2026-09-06: "we might have to step back and re-asses"). The 10-cycle window and a 0.5 line
are reported beside it as secondary readings, never as the kill line.

```
Meaning:    By count, most worlds holding withheld stock are fed by logistics; by tonnage, the
            withheld stock splits by good — for the processed and consumer goods it sits on worlds
            that logistics or their own part-production keeps replenished, for ore and minerals it
            sits on worlds that neither make nor receive them, which are not consuming them either.
Claim:      The withheld stock sits mostly on logistics-fed markets (inbound over 40 cycles ≥ 0.9 ×
            40 cycles of demand).
Number:     COMMITTED KILL LINE (inbound only): 1.9% (10K), 5.0% (16K) of unlockable stock — under
            30% → FALSIFIED as committed. The spec's actual test (production + inbound ≥ 0.9 ×
            demand, 40-cycle window): 36.7% (10K), 32.8% (16K) overall; per good — gas 78% / 74%,
            textiles 100%, chemicals 99.5%, biomass 84%, medicine 99.9%; ore 1.2% / 5.4%,
            minerals 1.3% / 5.4%. Ore + minerals hold 58% (10K) / 62% (16K) of all unlockable
            tonnage. By market count, 70-80% of floor-bound markets are fed (ratio40 median ≈ 1.0).
            97-99% of the withheld tonnage sits at ≥ 32 cycles of cover (worlds that order nothing).
Horizon:    10K (window 8881-9840, classification at run 9840) and 16K (14881-15840, run 15840).
Cohort:     all non-producer markets with drawable 0 and stock > 10 × demand at the last run
            before the snapshot; top-5 goods per horizon by 10-cycle haul volume.
Licenses:   the inbound-only supplier test is dead: it reaches under 5% of the stock. The
            production + inbound test reaches 74-100% of the withheld processed/consumer-good
            stock and ~1-5% of the withheld ore/minerals stock. The ore/minerals holders neither
            produce, receive, nor (over 40 cycles at ≥ 32 cycles of cover) consume the good —
            consistent with stalled tier-1 industry whose `honestUseRate` counts a draw "when
            running" that is not running (hypothesis; not measured here). That stock is a
            different problem from the supplier floor and no inbound rule reaches it. Does NOT say
            the reachable stock would be released in time or safely (claims 1/4 Licenses stand).
```

**Outcome:** committed falsifier FALSIFIED; the spec's own test survives for five of seven goods
and is dead for the two tier-0 inputs. Owner decision pending (2026-09-06): proceed with the
supplier floor on production + inbound over a long window, scoped to what it reaches, or step
back.

### Raw output — `temp/depot-fed-diag.ts 600 42 16000 10000,16000` (matcher hook, reverted)

```
== t10000 window40 8881-9840 lastRun 9840 topGoods ['gas', 'textiles', 'chemicals', 'ore', 'minerals']
  all {"unlockable": 16494327.469, "shareFed40_09": 0.019, "shareFed40_05": 0.021, "shareFed10_09": 0.012, "shareFedPlusProd40_09": 0.367}
  {"good": "gas", "floorBoundMarkets": 130, "marketsFed40": 99, "marketsFedPlusProd40": 113, "shareFedPlusProd40_09": 0.778, "shareFedPlusProd10_09": 0.761, "unlockable": 4227500.984, "shareFed40_09": 0.034, "shareFed40_05": 0.036, "shareFed10_09": 0.018, "ratio40P50": 1.083, "ratio40P90": 1.423, "deficitShareOfUnlock": 0.007, "deficitFed40_09": 0.857, "highCoverShareOfUnlock": 0.987, "highCoverFed40_09": 0.022}
  {"good": "textiles", "floorBoundMarkets": 90, "marketsFed40": 72, "marketsFedPlusProd40": 88, "shareFedPlusProd40_09": 1, "shareFedPlusProd10_09": 0.922, "unlockable": 1457525.034, "shareFed40_09": 0.014, "shareFed40_05": 0.015, "shareFed10_09": 0.006, "ratio40P50": 1.152, "ratio40P90": 1.455, "deficitShareOfUnlock": 0.235, "deficitFed40_09": 0.003, "highCoverShareOfUnlock": 0.512, "highCoverFed40_09": 0.022}
  {"good": "chemicals", "floorBoundMarkets": 101, "marketsFed40": 81, "marketsFedPlusProd40": 92, "shareFedPlusProd40_09": 0.995, "shareFedPlusProd10_09": 0.982, "unlockable": 1199371.528, "shareFed40_09": 0.042, "shareFed40_05": 0.046, "shareFed10_09": 0.028, "ratio40P50": 1.108, "ratio40P90": 1.519, "deficitShareOfUnlock": 0.003, "deficitFed40_09": 0.984, "highCoverShareOfUnlock": 0.978, "highCoverFed40_09": 0.02}
  {"good": "ore", "floorBoundMarkets": 105, "marketsFed40": 73, "marketsFedPlusProd40": 75, "shareFedPlusProd40_09": 0.012, "shareFedPlusProd10_09": 0.011, "unlockable": 5943106.16, "shareFed40_09": 0.01, "shareFed40_05": 0.012, "shareFed10_09": 0.009, "ratio40P50": 1.007, "ratio40P90": 1.455, "deficitShareOfUnlock": 0.002, "deficitFed40_09": 0.887, "highCoverShareOfUnlock": 0.996, "highCoverFed40_09": 0.006}
  {"good": "minerals", "floorBoundMarkets": 126, "marketsFed40": 87, "marketsFedPlusProd40": 89, "shareFedPlusProd40_09": 0.013, "shareFedPlusProd10_09": 0.01, "unlockable": 3666823.764, "shareFed40_09": 0.012, "shareFed40_05": 0.014, "shareFed10_09": 0.009, "ratio40P50": 1.005, "ratio40P90": 1.295, "deficitShareOfUnlock": 0.003, "deficitFed40_09": 0.608, "highCoverShareOfUnlock": 0.992, "highCoverFed40_09": 0.006}
== t16000 window40 14881-15840 lastRun 15840 topGoods ['gas', 'ore', 'minerals', 'biomass', 'medicine']
  all {"unlockable": 15753899.284, "shareFed40_09": 0.05, "shareFed40_05": 0.071, "shareFed10_09": 0.022, "shareFedPlusProd40_09": 0.328}
  {"good": "gas", "floorBoundMarkets": 136, "marketsFed40": 101, "marketsFedPlusProd40": 116, "shareFedPlusProd40_09": 0.74, "shareFedPlusProd10_09": 0.702, "unlockable": 4379706.35, "shareFed40_09": 0.076, "shareFed40_05": 0.096, "shareFed10_09": 0.038, "ratio40P50": 1.016, "ratio40P90": 1.169, "deficitShareOfUnlock": 0.022, "deficitFed40_09": 0.945, "highCoverShareOfUnlock": 0.966, "highCoverFed40_09": 0.047}
  {"good": "ore", "floorBoundMarkets": 117, "marketsFed40": 50, "marketsFedPlusProd40": 64, "shareFedPlusProd40_09": 0.054, "shareFedPlusProd10_09": 0.026, "unlockable": 5861046.939, "shareFed40_09": 0.021, "shareFed40_05": 0.05, "shareFed10_09": 0.013, "ratio40P50": 0.816, "ratio40P90": 1.083, "deficitShareOfUnlock": 0.005, "deficitFed40_09": 0.609, "highCoverShareOfUnlock": 0.982, "highCoverFed40_09": 0.014}
  {"good": "minerals", "floorBoundMarkets": 119, "marketsFed40": 74, "marketsFedPlusProd40": 80, "shareFedPlusProd40_09": 0.054, "shareFedPlusProd10_09": 0.025, "unlockable": 3945224.117, "shareFed40_09": 0.04, "shareFed40_05": 0.052, "shareFed10_09": 0.014, "ratio40P50": 1.003, "ratio40P90": 1.12, "deficitShareOfUnlock": 0.004, "deficitFed40_09": 1, "highCoverShareOfUnlock": 0.984, "highCoverFed40_09": 0.028}
  {"good": "biomass", "floorBoundMarkets": 107, "marketsFed40": 75, "marketsFedPlusProd40": 89, "shareFedPlusProd40_09": 0.842, "shareFedPlusProd10_09": 0.749, "unlockable": 1069804.967, "shareFed40_09": 0.122, "shareFed40_05": 0.157, "shareFed10_09": 0.021, "ratio40P50": 1.008, "ratio40P90": 1.111, "deficitShareOfUnlock": 0.098, "deficitFed40_09": 0.146, "highCoverShareOfUnlock": 0.893, "highCoverFed40_09": 0.11}
  {"good": "medicine", "floorBoundMarkets": 102, "marketsFed40": 87, "marketsFedPlusProd40": 101, "shareFedPlusProd40_09": 0.999, "shareFedPlusProd10_09": 0.872, "unlockable": 498116.912, "shareFed40_09": 0.081, "shareFed40_05": 0.082, "shareFed10_09": 0.041, "ratio40P50": 1.069, "ratio40P90": 1.238, "deficitShareOfUnlock": 0.22, "deficitFed40_09": 0.098, "highCoverShareOfUnlock": 0.768, "highCoverFed40_09": 0.062}
```

### Claim 6 — why the withheld ore and minerals do not move (descriptive, no kill-line)

For every ore/minerals holder at ≥ 32 cycles of cover in the claim-5 class, at the last run of
each 40-cycle window: realised consumption over the window (`stock_start + inbound − stock_end`,
outbound 0 since drawable was 0 at both ends) against 40 cycles of its `demand`; the civilian
share of that demand; and whether the holding system produces the good's recipe consumer
(ore → metals; minerals → chemicals, alloys, components).

```
Meaning:    The ore and minerals hoards sit at refineries that exist and are producing, whose
            demand figure counts a full-rate input draw that is not actually happening — the
            stock is a 40-cycle reserve against consumption that has stopped.
Claim:      descriptive, no kill-line.
Number:     tonnage-weighted, holders at ≥ 32 cycles: not consuming (realised < 25% of expected)
            ore 99.4% / 96.3%, minerals 99.4% / 96.4% (10K / 16K); realised ÷ expected 1% / 12%
            (ore), 1% / 4.5% (minerals); civilian share of the demand figure 13-20%; sitting at a
            system that PRODUCES the consumer good 99-100%; at a system with consumer-good demand
            100%.
Horizon:    10K (window 8881-9840) and 16K (14881-15840).
Cohort:     ore/minerals non-producer markets, drawable 0, stock ≥ 32 × demand at the last run
            (73-97 markets per good).
Licenses:   supports "the tier-0 hoard is idle input at braked refineries": the use figure
            (`honestUseRate`, "staffing- and strike-gated draw when running") deliberately
            excludes the consuming factory's output brake (economy-autonomic-agency.md, the
            use-vs-draw split), so a refinery whose metals output is braked keeps a 40-cycle ore
            reserve against a draw the brake has stopped. Hypothesis, not measured here: that the
            brake is the specific reason the factory is not drawing (vs. an input gate on a
            second input, or labour) — the runner did not read the brake state. Does NOT say the
            stock should be released: on a restart the factory draws at full rate again.
```

### Raw output — tier-0 holders (same runner, third pass)

```
t10000 {"good": "ore", "holders": 73, "matchedStart": 61, "unlockable": 5917866.556, "shareNotConsuming": 0.994, "realisedOverExpected": 0.01, "civilianShareOfDemand": 0.131, "shareAtSystemsProducingConsumerGood": 0.998, "shareAtSystemsWithConsumerDemand": 1}
t10000 {"good": "minerals", "holders": 82, "matchedStart": 72, "unlockable": 3636510.975, "shareNotConsuming": 0.994, "realisedOverExpected": 0.01, "civilianShareOfDemand": 0.203, "shareAtSystemsProducingConsumerGood": 0.991, "shareAtSystemsWithConsumerDemand": 1}
t16000 {"good": "ore", "holders": 96, "matchedStart": 96, "unlockable": 5754125.514, "shareNotConsuming": 0.963, "realisedOverExpected": 0.118, "civilianShareOfDemand": 0.145, "shareAtSystemsProducingConsumerGood": 0.996, "shareAtSystemsWithConsumerDemand": 1}
t16000 {"good": "minerals", "holders": 97, "matchedStart": 97, "unlockable": 3881049.201, "shareNotConsuming": 0.964, "realisedOverExpected": 0.045, "civilianShareOfDemand": 0.201, "shareAtSystemsProducingConsumerGood": 0.996, "shareAtSystemsWithConsumerDemand": 1}
```

## Spec — reserves against what a world actually uses (the supplier floor, third cut)

Supersedes the first two cuts after two `/spec-review` passes (report
`.agent-reviews/spec-logistics-gameplay-pass-2026-09-06-213657.md`) and claims 5-6.

```
What changes:  A world keeps a deep reserve of a good only when it is really eating that good at
               full rate and nothing refills it. Today every world that does not make a good keeps
               a deep reserve regardless, so a chain of worlds each fills up before it passes
               anything on, and a refinery whose output is not selling sits on forty cycles of
               input it is not using. After this change a world that is steadily refilled by
               deliveries behaves like a producer for that good: it keeps a thin restart buffer
               and passes the rest on, asking for more only when it dips under that buffer. A
               world whose real consumption has fallen away keeps a reserve sized to what it
               actually uses, never below the same thin buffer. How deep the deep reserve is
               becomes one faction-wide number the player can set.
Why:           Almost every served world waits more than a cycle for its goods (claim 1). The
               supplier one hop away is holding, not empty (claim 4). The stock it holds splits
               by good: for processed and consumer goods it sits on worlds that deliveries or
               their own part-production keep replenished (claim 5); for ore and minerals it sits
               at refineries that are producing but not drawing their input (claim 6).
               Owner decisions, quoted:
               - "can't we just get it to donate down to 10X cover like a producer does?"
               - "realistically the only systems that should be holders are systems that are not
                 through worlds for goods or producers themselves … if goods are flowing you dont
                 need to waste loads of space storing them"
               - "this just ties back into the player controlled stockpile levels"
               - "we are just extending the producer/consumer behaviour to add a sort of 'supplier'
                 system type"
               - "we have separate sliders for how much we want and what level we donate at, those
                 handle all three types :) … we are using existing logistics data to identify when
                 a system should identify as a supplier and then updating the sliders for donation
                 and system stockpiling automatically"
               - "do supplier floor only we already shipped the pricing haha, but we just include
                 the tweakable knob"
               - on the three-case rule (reserve against what you actually use, unless something
                 refills you): "I think the spirit of that rule is essentially the same, let's
                 update the spec and then re-review"
               - on retiring the brake-ceiling ≤ donation-line invariant for a part-producer that
                 is kept topped up: "okay agree let it give"
               - on the stockpile dial as one multiplier on every line for every role: "okay that
                 makes sense agreed"
               - Depot / synthetic demand: deferred ("I would not build it yet" — "Yeah").
Evidence:      - Claim 1 — almost every served world gets its goods more than a cycle after
                 dispatch. Licenses: latency is large for nearly all served worlds; says nothing
                 about unserved deficits or whether the latency hurts.
               - Claim 4 — the supplier next door is holding, not drained (spare-drained ≤ 13%).
                 Licenses: for ore and medicine the neighbourhood is short together; does NOT say
                 the releasing world stays safe. No pre-committed falsifier (diagnostic split).
               - Claim 5 — the inbound-only supplier test is dead (reaches 2-5% of withheld
                 stock); production + inbound over 40 cycles reaches 74-100% of withheld
                 processed/consumer-good stock and 1-5% of withheld ore/minerals. Licenses: does
                 NOT say the reachable stock is released in time or safely.
               - Claim 6 (descriptive) — the withheld ore/minerals sit at producing refineries
                 consuming 1-12% of their demand figure over 40 cycles. Licenses: that the output
                 brake is the specific cause is a hypothesis; does NOT say the stock should go.
               - Claims 2, 3 — not load-bearing here (depot inputs).
Not claimed:   - No depot, no synthetic demand, no new matcher mechanism: every case is the two
                 existing per-market lines (want, give-down-to) set from three per-market
                 quantities — full-rate use, realised use, steady inbound.
               - No change to hauling cost: work = quantity × congestion-priced route cost is
                 billed at `LOGISTICS_RATE_PER_WORK` (`lib/constants/treasury.ts:30`) in its own
                 funded band with its own slider (`components/factions/treasury-card.tsx:130`).
                 That constant is the tweak knob; not retuned here.
               - No per-good valves, no per-system stockpile setting: one multiplier per faction.
               - No save-format version bump: every new field is an additive optional with an
                 absent-reads-as-unknown rule, the precedent the six existing optional market
                 signals set; the loader validates no market rows (`lib/world/save.ts:19-24`).
               - No claim a thin-buffer world is as safe as today against a supply stop; the trade
                 is accepted and bounded in §4.
               - A world with no use of a good at all (use 0) is unchanged: its whole stock is
                 drawable and it never asks (`lib/engine/directed-logistics.ts:91-94`).
               - Nothing about who owns production or movement.
```

### 1. Three per-market quantities

Every rule below is stated per (world, good) in cycles of one of three rates, all in units per
reference cycle, catch-up normalised, and each denominated exactly as the matcher's `demand`
(`lib/engine/directed-logistics.ts:140-144`):

| Quantity | Meaning | Producer today / new |
|---|---|---|
| **use** `u` | full-rate use: civilian want plus the staffing- and strike-gated recipe draw when running — the existing use figure | `WorldMarket.honestUseRate` (`lib/world/types.ts:553-566`), surfaced as `GoodMarketState.demand` by `toGoodMarketStates` (`lib/tick/processors/good-market-state.ts:124-127,181`) |
| **realised use** `r` | what the economy actually removed from **this good's** stock, averaged over the long window: civilian delivered plus recipe inputs actually drawn from it by every consuming factory in the system | **new** — the simulator accumulates a third per-good map, `drawnByGood`, mirroring `realisedByGood`/`deliveredByGood` (`lib/engine/supply-chain.ts:90-94`), summing `perOutput × actualOutput` at the draw site (`:143-146`) across every consuming recipe; each returned entry carries `used = delivered + drawnByGood(entry.goodId)` — what left *that* good's stock (the `maxStock` clamp at `:158` is overflow, not use, and is excluded). The economy processor folds it into a persisted rolling rate through the `MarketUpdate` it already writes per market (`lib/tick/processors/economy.ts:184-201` → `applyMarketUpdates`) |
| **steady inbound** `i` | goods credited to this market by the arrivals stage, outbound legs only, averaged over the long window | **new** — accumulated only inside the `credited > 0` block of the outbound path (`lib/tick/processors/goods-arrivals.ts:102-114`), never in the `row.leg === "return"` early credit at `:80-94`, through a widened `MarketCreditUpdate` (`lib/tick/world/goods-arrivals-world.ts:42-45`, today `{id, stock}`); folded by the **economy processor** in the same `MarketUpdate` as `r` (the population processor has no per-market write — `lib/tick/world/population-world.ts:72-86` exposes only `applyPopulationUpdates` and `rewriteDemandRates`). Both rates are absolute units per reference cycle; their denominator `u` is read fresh at the matcher (`good-market-state.ts:181`), never stored with them |
| **inbound latency** `l` | how long this market's deliveries take, averaged over the same window: `arrivalTick − dispatchTick` of each credited outbound row, volume-weighted | **new** — the same credit block knows both ticks (`goods-arrivals.ts:118` computes exactly this delay for the return leg); accumulated beside `i` and folded with it |

All three rolling figures are exponential averages with per-cycle weight `1 / RESERVE_WINDOW_CYCLES`
(proposal 40, §7 — one 8-cycle refill moves `i` by 0.2u; from `r = u`, the deep term `R × r`
falls under the buffer only after ~55 cycles of zero draw at R = 40, 69 at 32, 44 at 60), each
backed by persisted optional fields on the market row — the rate and the since-last-fold
accumulator (`steadyInbound?`, `inboundSinceFold?`, `realisedUse?`, `usedSinceFold?`,
`inboundLatency?`, `latencyVolumeSinceFold?`). The one fold, in the economy processor at the cycle
boundary, reads and zeroes the accumulators and divides by `catchUpFactor` as it already does for
its own rates (`economy.ts:176`). Absent reads as 0 for the accumulators and as "unknown" for the
rates, and an unknown rate makes the world a plain consumer on the deep reserve (the behaviour
every world has today), so an old save loads unchanged and earns its roles over the following
window. A freshly established colony starts unknown; the founding manifest's staged goods are not
arrivals credits (`processors/directed-build.ts:832`, a separate write path). **Abandonment:**
`resetAbandonedMarkets` (`lib/world/tick.ts:1014-1026`) deletes all six new fields alongside
`honestUseRate`, so a resettled world starts unknown and opens as a consumer on the deep reserve,
not as an idle market on a ten-cycle line.
`drawDemand` (`directed-logistics.ts:145-151`) is **not** read by anything here — its docstring
forbids sizing or reserving stock against it because the brake it carries can flicker cycle to
cycle, and a 40-cycle average of realised removals is the slow quantity that objection asks for.

### 2. Roles and the two lines

The matcher reads two lines per market, both authored at
`lib/tick/processors/good-market-state.ts:187-188`: the **want** (`logisticsTarget`, a world is
short below `DEFICIT_FRACTION` × want, `directed-logistics.ts:57`) and the **give-down-to** line
(`donorReserve`, `surplusDrawable` `:104-118`). This spec sets them per role from `u`, `r`, `i`:

| Role | Test (in this order) | Give-down-to | Want | Short below |
|---|---|---|---|---|
| **Producer** | `production > u` and not strike-suppressed (unchanged, `directed-logistics.ts:112`) | `F × u` (10) | never a sink — self-supply gate `:449` (unchanged) | — |
| **Supplier** | not a producer, `production + i ≥ SUPPLIER_REPLENISHMENT × u` (0.9), **and** `l ≤ SUPPLIER_MAX_LATENCY` (§4) | `F × u` (10) | `S × u` (`SUPPLIER_WANT_COVER`, 12) | `0.8 × 12 = 9.6` |
| **Consumer** | otherwise | `max(F × u, R × r)` | `max(S × u, W × r)` | `0.8 × want` |

with `F = EXPORT_RESERVE_COVER` (10), `S = SUPPLIER_WANT_COVER` (new, 12), `R = DONOR_RESERVE_COVER`
(40), `W = WAREHOUSE_COVER` (40) — **every line then multiplied by the faction's stockpile
scale** `k` (§3; default 1). "Supplier" names a *replenished* world: the test is passed by a steady
inbound stream, by a world's own part-production, or by the two together — stated so the name is
read as the rule, not as "has inbound".

What the consumer row does, in words: a world reserves `R` cycles of what it *actually* uses and
asks back up to `W` cycles of the same, never below a restart buffer of `F` cycles at full rate.
For a world consuming at full rate (`r = u`) both lines are exactly today's — 40 and 40 — so no
behaviour changes anywhere the new signals are not telling a different story. For a refinery that
has stopped drawing (`r → 0`) the lines collapse to the buffer: it gives down to 10 cycles of
full-rate use and re-orders under 9.6 — claim 6's 60% of withheld tonnage becomes drawable while
the factory keeps one full-rate restart buffer. For a supplier, `i` replaces production in the
producer's own test — "steady inbound counts like production" — and the same buffer applies.

**The band invariant holds in every case.** The shipped rule that a donor drawn to its give line
must not immediately read as short — `reserve ≥ want × DEFICIT_FRACTION`
(`lib/constants/directed-logistics.ts:74-77`, asserted by `band-constants.test.ts:63`) — is why
the first cut's supplier pair (10 under 11.2) was a per-cycle drain/refill loop. Here: producer and
supplier `10 ≥ 0.8 × 12 = 9.6`; consumer with `R × r` binding, `R × r ≥ 0.8 × W × r` ⇔ `R ≥ 32`
(the existing invariant); consumer with `F × u` binding and `W × r` the larger want,
`F × u ≥ R × r ≥ 0.8 × W × r`. The scale `k` multiplies both sides of every pair and the anchor
ride touches only the deep terms, so neither can create an inversion. The constraint list is in
§7; `band-constants.test.ts` gains the two new pairs.

**The brake-ceiling invariant is retired for role-authored lines — owner decision.** A second
shipped assertion (`band-constants.test.ts:78-88`) keeps the production brake's ceiling
(`BRAKE_RAMP × BRAKE_USE_COVER` = 52 cycles of use, `lib/constants/economy.ts:28-45`) at or below
the donation line (`SURPLUS_MARGIN × DONOR_RESERVE_COVER` = 56), so that "a world that produces
less than it uses should not dump stock it cannot replace". A part-producer that is kept topped
up now qualifies as a supplier on a ten-cycle margin-free line, far under its brake ceiling. The
argument for letting it: such a world runs a net loss every cycle (`production < u`), so nothing
of its own accumulates above its line and there is nothing of its own to export — what it passes
on is inbound, which is the relay working; the brake never engages because stock never climbs,
which means it produces at full rate where today it sits partly braked at forty cycles; and if
nothing downstream wants the output, stock climbs to the knee and the brake engages as before.
The test's fourth case is re-authored against the live lines: for every market, the brake ceiling
(`brakeKnee × BRAKE_RAMP`) must sit at or below the donation line **unless** the market's give
line is a buffer term (`F × u × k`) — i.e. the invariant now guards only deep-reserve markets.

**The 1.4 clearance** (`SURPLUS_MARGIN`, `surplusDrawable` `:116`) is a dead-band above the
*deep* reserve — its docstring's meaning (`constants/directed-logistics.ts:24-28`). It applies
when the consumer's give line is the `R × r` term; a give line that is the buffer (`F × u`, in any
role) is margin-free, as the producer's is today. Behaviourally: a world holding the buffer gives
everything above it; a world holding the deep reserve gives only what clears 1.4× it. The
margin-free flag is a shared quantity with the same readers as `donorReserve` and rides with it
everywhere the line does: on `GoodMarketState`, through `logisticsTargetsByKey` into the harness's
`computeCoverLevels` (`market-analysis.ts:227,255-256` reconstructs the same rule today), and as
a parameter of `surplusDrawable` read identically by its three engine callers (§5).

**Slow up, fast down.** Roles are re-evaluated where the lines are authored, every logistics run.
Qualifying as a supplier is slow by construction — one ordinary refill (8 cycles of use in one
run, `directed-logistics.ts:685-687`; 30 off empty) moves a 40-cycle average by 0.2-0.75 of `u`,
so a consumer served once is not a supplier, and a world that is fed every time it dips is (its
ratio sits near 1.0: claim 5, ratio40 median 1.00-1.15). Losing the role is fast: a supplier that
has been short for `SUPPLIER_DROP_RUNS` consecutive runs (proposal 4) with nothing credited in
that span reverts to consumer on the spot, whatever its average still says. Losing the
"not-consuming" discount is likewise bounded: `r` is an average of removals, so a restarted
refinery's reserve grows toward `R × u` over the window while its stock sits at the buffer — the
buffer is what covers the restart, which is what it is for.

### 3. The stockpile lever

`stockpileScale` — one multiplier per faction, default 1: "my worlds hold more" or "my worlds hold
less", for every role. It multiplies every line in §2's table — a producer's ten cycles, a
supplier's ten and twelve, a consumer's deep reserve and want — so the ratios between lines, and
with them every invariant above, are untouched. Stepped control (proposal 0.75 / 1 / 1.5; the
floor keeps `0.75 × 0.8 × S = 7.2 > RATION_COVER`). Persisted on the faction's treasury row
(`WorldFactionTreasury`, `lib/world/types.ts:794-815`), written by the same policy command as the
funding sliders (`updateTreasuryPolicy`, `lib/services/treasury.ts:50`, whose Zod input widens),
set on the treasury card beside them. AI factions keep 1. `DONOR_RESERVE_COVER` stays a constant;
the second cut's per-faction `reserveCover` is withdrawn (review: it bound only on unfed full-rate
consumers, a cohort the measurements say is small).

**Plumb.** `toGoodMarketStates` has no faction in scope (`MarketStateSource`,
`good-market-state.ts:76-84`) and is called from eight live sites (`directed-logistics.ts:74`,
`directed-build.ts:158/290/403`, `construction.ts:58`, `cohort-analysis.ts:85/114`,
`market-analysis.ts:496`). It takes `stockpileScale` as a number in its options; each caller
resolves it from the owning faction's treasury row, and passes 1 where there is no faction (the
independent `factionId === null` group, `directed-logistics.ts:174-176`, has no treasury row —
`lib/world/gen.ts:244` mints one per faction) or no row. The harness call sites pass the owning
faction's value so `npm run simulate` reads the same lines the tick does.

### 4. The cascade bound and the first release

**Cascade.** In producer → A → B → C only the producer makes anything. If deliveries stop, each
supplier holds 10-12 cycles, keeps giving down to 10 until it has been short for
`SUPPLIER_DROP_RUNS` runs with nothing credited, then reverts to consumer and stops giving. In
those runs it consumes at most `SUPPLIER_DROP_RUNS` cycles of use from a floor of 10, so it
reverts holding ≥ 6 cycles, three times the ration line (`RATION_COVER` 2,
`lib/constants/economy.ts:67`). Accepted trade: a supplier's reserve against a supply stop is
10-12 cycles, not 40. Constraint, in cycles (a run is `LOGISTICS_INTERVAL / CYCLE_LENGTH` cycles,
1 today, `lib/constants/tick-cadence.ts:23,48`):
`F − SUPPLIER_DROP_RUNS × (LOGISTICS_INTERVAL / CYCLE_LENGTH) > RATION_COVER`.

**Transit exposure.** `RATION_COVER`'s docstring states today's safety argument: the deficit line
sits ~30 cycles above the ration knee, "a system that starves never ran out of warning"
(`constants/economy.ts:60-64`). A supplier re-orders at `0.8 × S × k = 9.6` cycles, so its warning
is `(0.8 × S − RATION_COVER) × k` = 7.6 cycles = 182 ticks, and claim 1 measures what that has to
cover: median sink mean inbound latency 54-63 ticks (2.2-2.6 cycles), P90 99-112 ticks (4.1-4.7
cycles), individual sinks at 240 ticks. So the role is gated on the world's own measured inbound
latency `l` (§1): a world whose deliveries take longer than `SUPPLIER_MAX_LATENCY` (proposal 4
cycles = 96 ticks, under the 7.6-cycle warning with a 3.6-cycle margin, and above the P90 sink so
most fed worlds qualify) keeps the deep reserve however steady its stream — far-served worlds
are exactly the ones that need it. Constraint: `SUPPLIER_MAX_LATENCY < 0.8 × S × k_min − RATION_COVER`.

**First release.** On the first run a world's lines drop, everything between its old 56-cycle
clearance and its new give line becomes drawable at once — up to ~46 cycles of use per market.
It is drawn only for a specific deficit's raise (`directed-logistics.ts:525-618,690`), never into
the void, and arrivals that overshoot a destination's band return (`goods-arrivals.ts:97-133`),
but galaxy-wide it is a transient; §6 names the harness reads that judge it.

**Anchor shifts.** `anchorMult` scales today's want and reserve together
(`good-market-state.ts:185-188`; clamp [0.1, 4.0], `lib/constants/events.ts:46,48`). Here the
deep terms `R × r` and `W × r` ride it as today; the buffer terms `F × u` and `S × u` do not,
exactly as the producer floor does not (`directed-logistics.ts:111`) and for the reason
`EXPORT_RESERVE_COVER`'s docstring gives ("immune to anchor_shift … no business moving warehouse
policy", `constants/directed-logistics.ts:35-36`). Consequence, stated: a supplier's or
not-consuming world's lines are anchor-immune while its full-rate neighbours' move. The
re-order line can therefore never be pushed under the ration knee by an event: constraint
`0.8 × S > RATION_COVER` (§7).

### 5. Every reader of the changed quantities

`npm run impact` (2026-09-06; re-run unabridged):

```
surplusDrawable — SHARED — 8 refs / 3 modules: directed-build (engine :19,:999; processor :190), directed-logistics (:104,:492), construction (:24,:70)
DONOR_RESERVE_COVER — SHARED — 3 modules: directed-build (:998, fixture-only fallback per its docstring :66-69), good-market-state (:188), market-analysis (:256)
EXPORT_RESERVE_COVER — CONTAINED — directed-logistics (:111)
SURPLUS_MARGIN — CONTAINED — directed-logistics (classifyMarketState :60, surplusDrawable :116)
WAREHOUSE_COVER — good-market-state (:187), market-analysis (:256 ratio)
```

| Reader | What it does today | Under this spec |
|---|---|---|
| matcher source (`directed-logistics.ts:492`) | `surplusDrawable(stock, donorReserve, demand, production, suppressed)` | reads the role-authored `donorReserve` and the margin-free flag (a new parameter, read identically by all three engine callers); the producer branch unchanged |
| planner input gate (`engine/directed-build.ts:993-1004`) | "could a factory here be fed" — any reachable market with drawable > 0 enters `surplusSystemsByGood` | **split by role**: a supplier's stock is a flow and stays a feedable source; an idle world's released stock (`R × r < F × u`) is a one-off level, not a rate, and must not license a factory — the gate reads a market's drawable only where `production + i > 0`. A deliberate separation of `surplusDrawable`'s jobs, stated in §9 row 1. |
| founding staging plan (`processors/directed-build.ts:190`, moves goods) and its readout (`construction.ts:70`) | plans the manifest draw as the founder's drawable | **capped at the founder's deep line `R × u`** (what a full-rate consumer keeps), whatever its role: a colony never draws a relay or idle world below what a consumer would have held. Proposal — owner call at review. |
| `founderCover` (`processors/directed-build.ts:778-779`, surfaced `:791`) | post-draw stock ÷ `donorReserve`; docstring "below 1 means the draw left the founder under the floor it keeps for itself" (`lib/tick/types.ts:209-213`) | ÷ `R × u × k` explicitly, and the docstring is re-authored: it becomes cover against the deep line a full-rate consumer would hold and stops meaning "under its own floor", which is now role-dependent; the harness's `founderCoverAfter` / `medianFounderCoverAfter` (`lib/tick-harness/build-analysis.ts:147-148,190,309-343`) inherit the new meaning and their comments follow |
| harness cover (`market-analysis.ts:254-271`) | reconstructs the give line from `DONOR_RESERVE_COVER / WAREHOUSE_COVER` | `logisticsTargetsByKey` (`cohort-analysis.ts:104-117`) carries the row's `donorReserve` and `computeCoverLevels` reads it |
| harness role (`cohort-analysis.ts:47-60`) | exporter / self-supplier / consumer / inert on production vs demand | four logistics roles — producer / supplier / consumer / idle (consumer with `R × r < F × u`) — and the existing `self-supplier` renamed `part-producer` so the two taxonomies cannot be confused |
| `WAREHOUSE_COVER` | want line for every market | the consumer's `W × r` term only |
| `anchorMult` | want + reserve | deep terms only (§4) |

### 6. Surfaces and harness

- **System → Logistics tab, per good:** the role as a word — Producer / Supplier / Consumer /
  Idle — and "gives down to N cycles". A supplier's row shows steady inbound and delivery time
  beside its use; an idle row shows realised use beside full-rate use — the numbers that decided
  it. Copy through `/game-copy`.
- **Treasury card:** the stockpile-scale control under the Funding sliders.
- **Map:** nothing new.
- **Harness:** the four-role cohort with cover per role; the re-measure metric (share of served
  sinks with volume-weighted mean inbound latency > 24 ticks, from `temp/depot-diag.ts`, promoted
  into `lib/tick-harness/lane-analysis.ts`) **with its guards beside it** — served-sink count,
  median raise size, hauls per served sink, and the unweighted per-haul latency distribution, so
  a fall driven by more, smaller, nearer raises reads differently from stock released nearer;
  famine share and Provision by world cohort at both horizons against the same-seed baseline for
  the first-release transient; a first-cycle read of released tonnage; **total logistics work and
  billed work per unit of delivered tonnage** at both horizons against baseline (relaying bills
  every leg — a unit that made one hop to a holder now makes two, so work rises with chain depth
  while delivered tonnage does not; the funding band bounds it, §9 decay row) and the
  `logisticsFundingBound` incidence by faction; and the **primary cover read for this feature is
  stock ÷ the row's own role-authored give line** — the harness's `medianCover` is stock ÷ the
  price-anchor target (`market-analysis.ts:246-252`, `TARGET_COVER × demandRate × anchorMult`),
  which this spec leaves untouched while the resting stock of every fed market drops to 10-12
  cycles, so `medianCover` and the per-role cover tables fall to roughly a quarter on that cohort
  **by construction** and must never be read as a regression. Displayed mid prices on those
  markets rise correspondingly (`midPriceAt`, k = 1); no tick reader consumes them.

### 7. Constants (proposals; defaults from measurement, definitions from meaning)

| Constant | Proposal | Meaning / constraint |
|---|---|---|
| `SUPPLIER_REPLENISHMENT` | 0.9 | production + steady inbound must cover this share of full-rate use; below 1 so a world topped up to what it eats does not flicker |
| `RESERVE_WINDOW_CYCLES` | 40 | time constant of both rolling rates; one refill of 8 cycles moves the average 0.2 |
| `SUPPLIER_DROP_RUNS` | 4 | consecutive short runs with nothing credited that end supplier status; `F − SUPPLIER_DROP_RUNS × (LOGISTICS_INTERVAL / CYCLE_LENGTH) > RATION_COVER` |
| `SUPPLIER_WANT_COVER` | 12 | a supplier's want; `F ≥ 0.8 × S` (band invariant) and `0.8 × S × k_min > RATION_COVER` |
| `SUPPLIER_MAX_LATENCY` | 4 cycles (96 ticks) | a world whose deliveries take longer keeps the deep reserve; `< 0.8 × S × k_min − RATION_COVER` |
| `stockpileScale` `k` | default 1; player steps 0.75 / 1 / 1.5 | multiplies every line for every role of the faction's markets; ratios and invariants unchanged |
| `DONOR_RESERVE_COVER` `R` | 40 (unchanged) | the deep reserve in cycles of realised use; `R ≥ 0.8 × W` (band invariant, unchanged) |
| `EXPORT_RESERVE_COVER` | 10 (unchanged) | the restart buffer for every role; docstring widens |
| `WAREHOUSE_COVER`, `DEFICIT_FRACTION`, `SURPLUS_MARGIN`, `LOGISTICS_RATE_PER_WORK` | unchanged | — |

### 8. Edges

- **use = 0:** unchanged (§ Not claimed).
- **Strike:** a struck producer drops to the ordinary path today (`:112`); it is then tested as a
  supplier (`production + i`, with the struck production as realised) and otherwise as a consumer
  — whose `r` falls as the strike suppresses its own draw, so its reserve shrinks toward the
  buffer over the window. Stated, intended: a striking refinery is not hoarding input.
- **Save/load:** six optional market fields, one optional treasury field, all additive with an
  absent-reads-as-unknown rule — no `SAVE_FORMAT_VERSION` bump (`lib/world/save.ts:55-61`: the
  bump is for shapes an old save cannot satisfy; the six existing optional market signals set the
  precedent), and no guard changes (the loader validates no market rows, `:19-24`).
- **In-flight hauls:** the sink test counts scheduled inbound (`:443`); `i` counts only credited
  arrivals, so a convoy en route does not make a supplier.
- **Catch-up:** both rates normalised per reference cycle at fold; a longer interval does not
  inflate them.
- **Independents / unowned:** `stockpileScale` 1; roles apply as to any market.

### 9. Hazard worksheet

**1. One quantity, several jobs** — §5's table with the impact output above. Kept coupled on
purpose: `surplusDrawable`'s three engine readers see the same role-authored line and the same
margin-free flag. Separated: the planner's input gate no longer reads an idle world's one-off
release as supply (§5); `founderCover` and the founding staging cap → the deep line explicitly;
every line scaled by one per-faction `stockpileScale`. `SURPLUS_MARGIN` keeps one meaning
(dead-band above the deep reserve) and is never used to build a want — the first cut's misuse.

**2. Constant read against its meaning:**

| Constant | Docstring says | Used as | Same? |
|---|---|---|---|
| `EXPORT_RESERVE_COVER` | "cycles of its own demand a structural exporter keeps before shipping the rest … immune to anchor_shift … above RATION_COVER" (`constants/directed-logistics.ts:29-39`) | the restart buffer for any world that is refilled or not consuming | yes — output refills a producer; deliveries refill a supplier; an idle world's buffer is for its restart. Widen the docstring. |
| `DONOR_RESERVE_COVER` | "cycles of its own REAL demand an ordinary donor keeps … invariant ≥ WAREHOUSE_COVER × DEFICIT_FRACTION" (`:66-88`) | the default of `reserveCover`, now in cycles of realised use | yes; the invariant becomes a range constraint |
| `SURPLUS_MARGIN` | "a surplus when stock ≥ target × this; an ordinary donor gives only once stock clears reserve × this … a deliberate residual" (`:24-28`) | the dead-band above the deep reserve only | yes — and explicitly NOT a want multiplier |
| `WAREHOUSE_COVER` | "cycles of a system's REAL demand directed logistics tries to keep on hand" (`:41-63`) | the consumer's want in cycles of realised use | yes, with the denominator moved from full-rate to realised use for the consumer only — stated |
| `drawDemand` | "nothing that sizes or reserves stock may touch it" (`directed-logistics.ts:145-151`) | not read | — (the reason it is not read is the reason `r` is a 40-cycle average of removals) |
| `honestUseRate` | "what this system's population and industry actually USE … every warehousing quantity is denominated in it … missing reads as a live recompute, never 0" (`types.ts:553-566`) | `u`, the denominator of the supplier test and the buffer terms | yes; the fold must read the same resolved figure and its never-0 rule |
| `RATION_COVER` | the ration knee, and the "~30 logistics cycles of warning" argument (`constants/economy.ts:58-67`) | the line the buffer and the re-order line stay above; the warning shrinks to 7.6 cycles for suppliers, which is why the role is latency-gated (§4) | yes, with the shortened warning stated and bounded |
| `BRAKE_USE_COVER` / `BRAKE_RAMP` | the brake knee and its taper, "a self-supplier with margin capacity rests just above its knee" (`constants/economy.ts:28-45`) | unchanged for the brake; the brake-ceiling ≤ donation-line pairing (`band-constants.test.ts:78-88`) is retired for buffer-line markets by owner decision (§2) | meaning kept; the pairing re-scoped |

**3. Systems:**

| System | Interaction | Reason if none |
|---|---|---|
| Events | anchor shift rides the deep terms only; buffer terms immune; re-order line cannot go under the ration knee (§4, §7). No event writes the new fields. | — |
| Population + migration | population processor folds `i` after rewriting `honestUseRate`; migration unchanged. Indirect: thinner reserves reach Provision sooner on a supply stop (§4 bound). | consumption itself never changes |
| Unrest / regime | same indirect path; famine floor and critical override untouched. | — |
| Industry + staffing | economy emits `used`; the planner's input gate sees supplier/idle stock as feedable. A restarted refinery draws from its 10-cycle buffer while `r` recovers. | no capacity added |
| Infrastructure decay | **indirect**: decay reads `logisticsFundingBound` (`lib/engine/infrastructure-decay.ts:113-119`), a gate that also suppresses planner proposals (`constants/directed-logistics.ts:90-100`), and this change can raise its incidence by raising total haul work through relayed multi-leg delivery (each leg billed, `processors/directed-logistics.ts:176`). Bounded by the funding band; read by the §6 harness guards (work per delivered unit, funding-bound incidence by faction). | — |
| Directed logistics | the change: role test, lines, margin-free flag, drop rule. | — |
| Directed build / planner | input gate (:999) unchanged call; founding staging plan (:190) capped at the deep line; `founderCover` (:778) re-denominated; structural scan (:426-538) unchanged (rate-based). | — |
| Colonisation + founding manifest | the cap above (implementable at the plan's seed site `processors/directed-build.ts:188-190`, which governs every later line for the key and the readout at `construction.ts:70` alike); a fresh colony is a consumer with unknown rates → deep reserve; abandonment resets the six fields (§1). | — |
| Treasury / purse | `stockpileScale` on the treasury row; policy command widens; haul cost unchanged in rate, higher in volume where chains relay (§6 guard). | — |
| Factions + relations | none — traversal and same-faction giving unchanged. | — |
| Save format | six optional market fields, one optional treasury field, no bump (§8). | — |
| Harness | four-role cohort, `donorReserve` threaded, latency metric + guards, transient reads (§6). Conservation identities are tonnage-based and role-blind (`conservation-analysis.ts:403-409,228,286`). | — |

**4. Claims with measurement** — every mechanic sentence above carries a `file:line`; the numbers
are claims 1, 4, 5, 6 in `## Evidence` with horizon and cohort; claim 6's brake attribution is
labelled hypothesis. Claim 4 carries no pre-committed falsifier (diagnostic split) and is read
only through claims 5-6, which do.

**5. Signals that must exist:**

| Consumes | Produced at | Shape | Assumes |
|---|---|---|---|
| `u` | `good-market-state.ts:124-127,181` from `honestUseRate` | ≥ 0 float, never 0-by-absence | same |
| `production`, `productionSuppressed` | economy signals → `GoodMarketState` | ≥ 0 float; boolean | same |
| civilian `delivered` per entry | `supply-chain.ts:35-36,153-155` | per run, ≥ 0 | summed into `used` — **new** |
| inputs actually drawn per entry | drawn in recipe order `supply-chain.ts:70,137-140`, not emitted | — | **new** emission beside `delivered`/`realised` |
| `used` fold → `realisedUse` | **new** — economy processor, beside `satisfaction` (`economy.ts:181-188`) | rolling rate | — |
| credited outbound quantity | `goods-arrivals.ts:102-114` | per tick per row | **new** accumulation via widened `MarketCreditUpdate` |
| `inboundSinceFold` fold → `steadyInbound` | **new** — economy processor, same `MarketUpdate` as `r` | rolling rate | — |
| `stockpileScale` | **new** — treasury policy command; 1 where absent | 0.75-1.5 | — |
| `l` (inbound latency) | **new** — same credit block as `i` (`goods-arrivals.ts:102-118`) | rolling ticks | — |
| water level | `solveWaterLevel` (`shelf-levelling.ts:23-33`) | capped at each world's `targetCover` | unchanged — no raise exceeds a world's own want |

**6. Aggregates that move for other reasons:**

| Metric | Read at | What else moves it |
|---|---|---|
| served-sink share with mean inbound latency > 24 | per faction, per good, both horizons, with served-sink count | route lengths, freight speed, cohort (who orders at all), **haul-size mix** — thinner wants mean more, smaller, nearer raises; the guards in §6 separate that from stock released nearer |
| cover per role | four roles side by side | role migration alone empties the consumer cohort's top; never read the consumer median alone |
| famine share / Provision | by world cohort, both horizons, vs same-seed baseline at the same tick | founding-era transient |
| released tonnage, first cycle | galaxy total and per good | the size of the withheld pool at that tick (claims 5-6 give the baseline: ~16M units unlockable across the top-5 goods) |
| harness `medianCover` and per-role cover | every role, both horizons | **this change, by construction** — the denominator is the unchanged price anchor while fed markets' resting stock drops to 10-12 cycles; never read as a regression (§6) |
| logistics work per delivered unit; `logisticsFundingBound` incidence | per faction, both horizons, vs baseline | chain depth (relaying), lane congestion, funding slider |

### 10. Falsifiers (moved unedited)

Committed at `b0b3407c`, moved here unedited:

> (checkable, next) after the floor rule: the share of served sinks with mean inbound latency
> > 24 ticks falls materially from 96% — the claim-1 instrument re-run is the falsifier for the
> rule having done anything. Kill line: if it is still ≥ 90% at 10K and 16K, the floor was not
> what withheld the stock and the reading of claim 4 was wrong.

Read with §6's guards beside it. Claim 5's falsifier (committed `1c50f8f0`) was failed as
committed and is recorded so in `## Evidence`; this spec rests on the survivor (production +
inbound) and on claim 6.

### 11. Next stage

Cross-mechanic → third `/spec-review` pass on this cut, then `/build-plan`.
