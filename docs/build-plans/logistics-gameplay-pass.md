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

## Spec — the supplier floor

```
What changes:  A world that is kept topped up by regular deliveries of a good stops hoarding it.
               Today only a world that makes a good will ship it down to a thin reserve; every
               other world keeps a deep reserve and shares only what sits above that, so a chain
               of worlds each fills up before it passes anything on. After this change a world
               whose deliveries reliably cover what it uses behaves like a producer for that good:
               it keeps the same thin reserve and passes the rest down the line, while still asking
               for more when it runs low. A world that neither makes a good nor reliably receives
               it keeps the deep reserve, and how deep that reserve is becomes one faction-wide
               number the player can set.
Why:           Almost every served world waits more than a cycle for its goods, and the supplier
               one hop away is not empty — it is holding stock it is allowed to keep (Evidence,
               claims 1 and 4). Owner decisions this spec encodes, quoted:
               - "instead of extra cover just lowering the level they donate at works better? …
                 can't we just get it to donate down to 10X cover like a producer does?"
               - "realistically the only systems that should be holders are systems that are not
                 through worlds for goods or producers themselves … if goods are flowing you dont
                 need to waste loads of space storing them"
               - "this just ties back into the player controlled stockpile levels"
               - "we are just extending the producer/consumer behaviour to add a sort of 'supplier'
                 system type"
               - "do supplier floor only we already shipped the pricing haha, but we just include
                 the tweakable knob"
               - Depot / synthetic demand: "I would not build it yet" (assistant) — "Yeah" (Kai);
                 deferred pending the re-measure named in ## Idea.
Evidence:      - Claim 1 — almost every served world gets its goods more than a cycle after
                 dispatch. Licenses: latency is large for nearly all served worlds; says nothing
                 about unserved deficits or whether the latency hurts.
               - Claim 4 — the supplier next door is not drained, it is holding stock it is allowed
                 to keep; for gas/chemicals/minerals/biomass that stock is 2-40× the neighbour's
                 shortfall. Licenses: rules out spare-drained as a major cause (≤ 13% of near
                 candidates, both horizons); for ore and medicine the neighbourhood is short
                 together and a floor change alone does nothing; does NOT say the releasing world
                 stays safe.
               - Claim 3 — 56-64% of developed systems sit within a cycle of a supplier while a
                 neighbour within two hops waits over a cycle. Licenses: sites are common; the
                 "donor" is any source in the window, not a structural producer.
               - Claim 2 (killed the through-flow depot) — not load-bearing here.
Not claimed:   - No depot, no synthetic demand, no new want level: a world's *want* (the 40-cycle
                 warehousing target) is untouched for every role. Only the floor it gives down to
                 changes.
               - No change to hauling cost: work = quantity × congestion-priced route cost is
                 already billed at `LOGISTICS_RATE_PER_WORK` in its own funded band with its own
                 slider (`lib/constants/treasury.ts:26`, `components/factions/treasury-card.tsx:130`).
                 That constant is the tweak knob; this spec does not retune it.
               - No per-good valves and no per-system stockpile setting — the lever is one number
                 per faction.
               - No claim that a supplier world is as safe as today against a supply stop: its
                 reserve against one is the producer floor, not the deep reserve. That trade is
                 accepted and bounded in §3.
               - A world that does not consume a good at all is unchanged: at demand 0 its whole
                 stock is already drawable (`lib/engine/directed-logistics.ts:91-94`) and it never
                 asks for any — that "want without demand" is the deferred depot.
               - Nothing about who owns production or movement (companies, strata).
```

### 1. Three roles per (world, good)

Today a market is one of two things when the matcher looks at it as a source
(`surplusDrawable`, `lib/engine/directed-logistics.ts:104-118`): a **producer** (`production >
demand`, not strike-suppressed) gives down to `EXPORT_RESERVE_COVER` (10) cycles of its own demand;
anything else is an **ordinary donor** that gives only once stock clears `SURPLUS_MARGIN` (1.4) ×
its reserve and stops at the reserve, `DONOR_RESERVE_COVER` (40) cycles
(`lib/constants/directed-logistics.ts:28,40,89`; the reserve itself is authored at
`lib/tick/processors/good-market-state.ts:188`).

This spec adds a third role between them:

| Role | Test | Gives down to | Asks for more below |
|---|---|---|---|
| Producer | `production > demand` (unchanged) | producer floor, 10 cycles (unchanged) | never — self-supply gate (`lib/engine/directed-logistics.ts:445`) |
| **Supplier** | `production + steadyInbound ≥ SUPPLIER_REPLENISHMENT × demand`, and not a producer | **producer floor, 10 cycles** | the ordinary deficit line, `DEFICIT_FRACTION × WAREHOUSE_COVER` = 32 cycles (unchanged) |
| Consumer | otherwise | the faction's **reserve depth** (default 40), clearing `SURPLUS_MARGIN` (unchanged mechanics) | 32 cycles (unchanged) |

The supplier test is the producer test with steady inbound added to the supply side — "steady
inbound counts like production". A supplier never rides the SURPLUS_MARGIN dead-band: like a
producer, everything above its floor is drawable.

Requirement: `steadyInbound` — new, emitted per (market, good) by the goods-arrivals stage at the
credit site (`lib/tick/processors/goods-arrivals.ts:102-112`), §2. `SUPPLIER_REPLENISHMENT` — new
constant, proposal 0.9 (rationale §7).

### 2. The steady-inbound signal

`steadyInbound` is a per-market rolling per-cycle rate of goods actually credited by arrivals —
outbound legs only, never return legs (a return is goods going back to a donor,
`lib/tick/processors/goods-arrivals.ts:115-129`). Observable behaviour:

- It is denominated exactly as `demand` is (units per reference cycle, catch-up normalised), so
  the §1 test compares like with like. Producer of the denominator: `WorldMarket.demand`
  (`lib/world/types.ts:553-566`).
- It smooths over `SUPPLIER_WINDOW_CYCLES` (proposal 4) — an exponential average with that
  time constant, updated once per economy cycle from the quantity credited since the last update.
  One cycle of bulk fill does not make a supplier; four cycles of steady top-ups do; four cycles
  of silence unmake one. This is the cascade's hysteresis (§3).
- It is persisted on the market row, optional, absent reads as 0 (a consumer) — the same
  written-by-logistics / read-by-the-matcher pattern as `squeezeCycles` and
  `logisticsFundingBound` (`lib/world/types.ts:589-600`, read at
  `lib/engine/directed-build.ts:458`). Save format bumps (`SAVE_FORMAT_VERSION`,
  `lib/world/save.ts:61`); an old save loads with every world a consumer and earns supplier
  status over the next window.
- A freshly established colony starts at 0. The founding manifest's staged goods are not
  arrivals-credited inbound and do not count.

### 3. Floors, the matcher, and the cascade bound

**A supplier must be able to give while it is still asking.** Today classification is exclusive:
a market below 32 cycles is a deficit and is never a source in that run
(`lib/engine/directed-logistics.ts:443-495`: the source branch runs only for non-deficits). Under
scarcity the water level sits below 32, so a supplier that could only give when *balanced* would
hoard to 32 before passing anything on — the chain problem moved from 56 to 32, not removed.
Rejected for that reason.

Requirement: within one logistics run, a supplier below its want is **both** a world in the
levelling (it draws toward the water level like any deficit) **and** a source whose drawable is
`stock − floor` (it gives down to the level). Observable invariant, checkable in a fixture: after
a run, no supplier holds stock above the run's final water level for that good while any world in
the same pool that could reach it is below that level — the level is shared, floors are personal.
Producers stay exempt from sinking (the self-supply gate is unchanged). How the matcher represents
dual membership is `/build-plan`'s.

**Cascade, bounded.** In producer → A → B → C, only the producer makes anything. If deliveries stop,
each supplier keeps giving down to 10 cycles until its own `steadyInbound` decays below the test —
at most `SUPPLIER_WINDOW_CYCLES` cycles — then reverts to a consumer and stops giving. During those
cycles it consumes at most ~4 of its 10-cycle floor, so it reverts holding ≥ 6 cycles, three times
the ration line (`RATION_COVER` 2, `lib/constants/economy.ts:66`). The accepted trade: the reserve a
supplier holds against a supply stop is ~10 cycles, not 40. The producer floor is never lowered by
this spec; if a later tune wants it lower, the constraint is `floor − SUPPLIER_WINDOW_CYCLES >
RATION_COVER`.

**First release.** On the first run after a world qualifies, everything between its old reserve
line and 10 cycles becomes drawable at once — up to ~46 cycles of demand per market. It flows only
to deficits in the levelling, never into the void, but galaxy-wide it is a transient; §6 names the
harness reads that judge it.

### 4. The stockpile lever

The consumer reserve depth stops being a global constant read and becomes **one number per
faction**, `reserveCover`, default `DONOR_RESERVE_COVER` (40): "how many cycles a world holds when
it cannot count on being refilled." It replaces the constant at the reserve's one producer
(`lib/tick/processors/good-market-state.ts:188`) and at the planner's fallback
(`lib/engine/directed-build.ts:998`); the harness's role read (`lib/tick-harness/cohort-analysis.ts:47`)
follows the same definition. AI factions keep the default. The player sets it on the faction's
treasury card beside the funding sliders (§5), a stepped control over a small range
(proposal 20 / 40 / 60 cycles) — coarse by decision ("never raw per-good warehouse valves",
roadmap row). It moves the *floor* only; the 40-cycle want is not a lever.

Requirement: `reserveCover` — new, persisted on the faction's treasury row
(`WorldFactionTreasury`, `lib/world/types.ts:794-815`, the only persisted per-faction tick-mutable
state), written by the same policy command that writes the funding sliders
(`updateTreasuryPolicy`, `lib/services/treasury.ts:50`).

### 5. Surfaces

- **System → Logistics tab, per good:** the role reads as a word — Producer / Supplier / Consumer
  — and the reserve line reads "gives down to N cycles". A supplier's row also shows its steady
  inbound beside its demand, which is the number that made it one. Copy goes through
  `/game-copy`.
- **Treasury card:** the reserve-depth control under the Funding sliders, labelled in cycles.
- **Map:** nothing new. The Provision and Lanes modes already show the outcome.
- **Harness (`npm run simulate`):** the market-role cohort gains *supplier* (three stocked roles
  become four, `lib/tick-harness/cohort-analysis.ts:60`), cover distributions read per role, and a
  new **inbound-latency** metric — the claim-1 instrument (`temp/depot-diag.ts`, share of served
  sinks with volume-weighted mean inbound latency > 24 ticks) promoted into
  `lib/tick-harness/lane-analysis.ts`, because it is the re-measure falsifier and the depot decision
  reads it.

### 6. Edges

- **demand = 0:** unchanged — whole stock drawable, never a sink, role reads Producer-like
  (`lib/engine/directed-logistics.ts:91-94`). Not called a supplier; the test divides by demand.
- **Strike:** a producer whose output is suppressed already drops to the ordinary path
  (`productionSuppressed`, `lib/engine/directed-logistics.ts:112`); the supplier test uses
  realised `production` the same way, so a struck part-producer keeps supplier status only if its
  inbound alone covers the test.
- **Events:** an anchor shift scales the consumer reserve and the want together
  (`good-market-state.ts:185-188`); the producer floor does not ride it
  (`directed-logistics.ts:111`). The supplier floor is the producer floor and does not ride it
  either — a supplier's reserve is a physical hold, not a price band. Stated, intended.
- **Save/load:** `steadyInbound` absent → 0; `reserveCover` absent → default. No migration beyond
  the version bump.
- **In-flight hauls:** the sink test already counts scheduled inbound
  (`directed-logistics.ts:443`); `steadyInbound` counts only credited arrivals, so a world with a
  big convoy en route is not yet a supplier — by design, it has not been *steadily* fed.
- **Catch-up:** the rate is normalised per reference cycle at update, like `demand`; a longer
  logistics interval does not inflate it.

### 7. Constants (proposals — defaults from measurement later, definitions from meaning)

| Constant | Proposal | Meaning |
|---|---|---|
| `SUPPLIER_REPLENISHMENT` | 0.9 | Inbound + production must cover this share of demand to count as replenished. Below 1 so a world topped up to exactly what it eats does not flicker at the boundary. |
| `SUPPLIER_WINDOW_CYCLES` | 4 | Smoothing time constant of `steadyInbound`; the cascade bound (§3). Must satisfy `EXPORT_RESERVE_COVER − window > RATION_COVER`. |
| `reserveCover` default | 40 (= `DONOR_RESERVE_COVER`) | Unchanged behaviour for AI factions and for a player who never touches the control. |
| `EXPORT_RESERVE_COVER` | 10 (unchanged) | Now also the supplier floor. |
| `LOGISTICS_RATE_PER_WORK` | 0.4 (unchanged) | The haul-cost knob; already shipped. |

### 8. Hazard worksheet

**1. One quantity, several jobs** (`npm run impact`, 2026-09-06):

```
surplusDrawable — SHARED — 8 references across 3 modules: directed-build, directed-logistics, construction
  directed-build   lib/engine/directed-build.ts:19 (import), :999 (input gate "could a factory here be fed")
  construction     lib/services/construction.ts:24 (import), :70 (founding manifest draw)
  directed-logistics  lib/engine/directed-logistics.ts:104 (definition), :492 (the matcher's source)
DONOR_RESERVE_COVER — SHARED — 3 modules: directed-build (:998 fallback), good-market-state (:188 producer), market-analysis (harness role read)
EXPORT_RESERVE_COVER — CONTAINED — directed-logistics (:111)
SURPLUS_MARGIN — CONTAINED — directed-logistics (classifyMarketState :60, surplusDrawable :116)
LOGISTICS_RATE_PER_WORK — CONTAINED — treasury, tick
```

| Quantity | Every reader today | Which this design moves | Intended? |
|---|---|---|---|
| `surplusDrawable` | matcher source (`directed-logistics.ts:492`), planner input gate (`directed-build.ts:999`), founding manifest (`construction.ts:70`) | all three, identically: the supply term becomes `production + steadyInbound` | Yes — kept coupled on purpose: a supplier is a supplier to a factory and to a founding colony exactly as to a deficit world. Each reader's adapter must carry `steadyInbound` or the reader silently sees a consumer. |
| `DONOR_RESERVE_COVER` | reserve producer (`good-market-state.ts:188`), planner fallback (`directed-build.ts:998`), harness role (`cohort-analysis.ts:47`) | all three read the faction's `reserveCover` instead | Yes — separated from the constant; the constant survives as the default. |
| `EXPORT_RESERVE_COVER` | `surplusDrawable` only | gains a second role (supplier floor) inside the same function | Yes — one floor for "replenished" worlds. |
| `WorldMarket.demand` | every warehousing quantity (`types.ts:553-566`) | unchanged; new reader (§1 test) | Yes. |
| `anchorMult` | want + consumer reserve (`good-market-state.ts:187-188`) | not read by the supplier floor | Yes, §6. |

**2. A constant read for a meaning it was not authored to have:**

| Constant | Docstring says | This design uses it as | Same? |
|---|---|---|---|
| `EXPORT_RESERVE_COVER` | "Cycles of its own demand a structural exporter keeps on hand before shipping the rest … immune to anchor_shift … well above RATION_COVER so exporting never rations the exporter" (`constants/directed-logistics.ts:29-39`) | the reserve of any world whose replenishment covers its demand | Yes — the docstring's reason (output refills it; never rations) holds for a replenished world; docstring to be widened. |
| `DONOR_RESERVE_COVER` | "Cycles of its own REAL demand an ordinary (non-exporter) donor keeps for itself before it will give" (:66-88) | the default of the per-faction reserve depth | Yes. |
| `RATION_COVER` | "the gap between the logistics deficit signal … and this knee … a system that starves never ran out of warning" (`constants/economy.ts:58-66`) | the line the supplier floor must stay above after the window drains | Yes — read as the ration line, which is what it is. |
| `WorldMarket.demand` | "what this system's population and industry actually USE … every warehousing quantity is denominated in it" (`types.ts:553-566`) | the denominator of the supplier test | Yes. |

**3. A system you did not think about:**

| System | Interaction | Reason if none |
|---|---|---|
| Events | Anchor shift scales want and consumer reserve; supplier floor does not ride it (§6). No event writes `steadyInbound`. | — |
| Population + migration | None directly. Indirect: a supplier's stock sits lower, so a supply stop reaches Provision sooner (§3 bound). Migration reads unrest/headroom, not stock. | consumption never changes; only what is held after consumption |
| Unrest / regime | Same indirect path via Provision. The famine floor and critical-good override are untouched. | — |
| Industry + staffing | The planner's input gate sees supplier stock as feedable input (hazard 1). No building, no staffing. | no capacity is added |
| Infrastructure decay | None. Decay reads staffed-and-selling and occupancy, not stock. | — |
| Directed logistics | The change itself: role test, floor, dual membership in a run (§3), harness role. | — |
| Directed build / planner | Reads `reserveCover` at :998 and supplier stock via `surplusDrawable` at :999; the structural-deficit scan (`:426-538`) is unchanged — it nets against *rate* spare, not stock. | — |
| Colonisation + founding manifest | The manifest may draw a supplier's stock down to its floor (`construction.ts:70`). Intended (hazard 1). | — |
| Treasury / purse | `reserveCover` lives on the treasury row (§4). Haul cost unchanged. | — |
| Factions + relations | None. Traversal policy is untouched; a supplier gives only to its own faction's deficits, as any donor. | — |
| Save format | `WorldMarket.steadyInbound?`, `WorldFactionTreasury.reserveCover?`; version bump. | — |
| Harness metrics | Supplier role in cohorts; inbound-latency metric added (§5); read famine share and Provision at both horizons for the first-release transient. | — |

**4. Symptoms with measurements:** every mechanic claim in this spec carries a `file:line`; the
three numbers it rests on are claims 1, 3 and 4 in ## Evidence with horizon and cohort.

**5. Signals that must exist:**

| Consumes | Produced at | Shape today | Design assumes |
|---|---|---|---|
| `demand` per market | `good-market-state.ts` (use figure) | ≥ 0 float, units/cycle | same |
| `production` per market (realised) | economy signals → `GoodMarketState.production` | ≥ 0 float | same |
| `productionSuppressed` | strike state → `GoodMarketState` | boolean | same |
| credited arrival quantity | `goods-arrivals.ts:102-112` | per tick, per row | summed per market per cycle — **new** accumulation |
| `steadyInbound` | **new** — goods-arrivals + a per-cycle fold | — | float ≥ 0, units/cycle |
| `reserveCover` | **new** — treasury policy command | — | one of a small set of cycle counts |
| water level per good | `solveWaterLevel` (`shelf-levelling.ts`) | cover float | unchanged |

**6. Aggregates that move for other reasons:**

| Metric | Read at | What else moves it |
|---|---|---|
| share of served sinks with mean inbound latency > 24 (the re-measure falsifier) | per faction, per good, both horizons | route lengths (lane investment), freight speed, which worlds are served at all (cohort) — quote the served-sink count beside it |
| consumer cover | per role (now 4 roles) — a consumer becoming a supplier *leaves* the cohort | role migration alone lowers "consumer" median cover; read the four roles side by side |
| famine share / Provision | per world cohort, both horizons | founding-era transient; compare against a same-seed baseline at the same tick |

### 9. Falsifiers (moved from ## Idea unedited)

Committed at `b0b3407c`, moved here unedited:

> (checkable, next) after the floor rule: the share of served sinks with mean inbound latency
> > 24 ticks falls materially from 96% — the claim-1 instrument re-run is the falsifier for the
> rule having done anything. Kill line: if it is still ≥ 90% at 10K and 16K, the floor was not
> what withheld the stock and the reading of claim 4 was wrong.

Committed at `d57d4df5` (claim 1) and `baeee32c` (claim 3, as the brainstorm's terminal falsifier),
both already compared in ## Evidence — confirmed, text unchanged there.

### 10. Next stage

Cross-mechanic (the matcher, the planner's input gate, the founding manifest, a shared constant's
read, a new persisted market field, a harness cohort) → `/spec-review` is mandatory.
