# Logistics gameplay pass — working file

Roadmap row: **[L] Logistics gameplay pass**. Transient; deleted on the PR that finishes the work.

## Decisions so far (2026-09-06)

- **Hauling cost is a funded pool** like build and logistics work: billed to the faction treasury per
  cycle, its own funding slider, one tunable constant. "Money is fuel, not capacity" holds. Who
  *owns* production and movement (faction, pop strata, companies) is a direction question for the
  faction-direction design pass, not this one.
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

## Idea — depots (brainstorm 2026-09-06)

**Problem.** Almost every world logistics serves waits more than a cycle for its goods (Evidence,
claim 1: 96% of served sinks at 10K and 16K). Nothing in the galaxy holds stock nearer to the
worlds that need it, because a world only asks for what it consumes, and only producers give freely.

**Chosen direction — the neighbourhood-latency depot.** A depot is a per-market policy, not a
building. For a good it relays, a world keeps the ordinary want (`WAREHOUSE_COVER` 40) and donates
down to the producer floor (`EXPORT_RESERVE_COVER` 10). Its want is a **relayed demand** figure:
the summed demand of developed worlds within the two-hop break-even whose inbound for that good
currently arrives more than a cycle late. The planner recomputes it each run and proposes the
policy where it is positive; as neighbours industrialise their inbound latency drops, relayed
demand falls, and the depot drains itself through its own floor — nothing persisted goes stale.
The matcher serves depot wants **after** real consumption at each necessity. Data flow: the
arrivals stage folds each credited haul's latency (`arrivalTick − dispatchTick`,
`lib/tick/processors/goods-arrivals.ts:118`) into one rolling per-market inbound-latency field,
the same written-by-logistics / read-by-planner pattern as `squeezeCycles` and
`logisticsFundingBound` (`lib/world/types.ts:589-600`, read at `lib/engine/directed-build.ts:458`);
the planner's two-hop sum rides its existing candidate × exporter reachability pass.

**Killed.**
- *Through-flow-sized depot* — Evidence claim 2: through-flow is diffuse (top 5% carry 10-12%)
  and unstable (top-10 overlap 3/10 at 16K); most of it crosses undeveloped corridor systems.
- *Rate-scan depot* (size from the planner's unmet rate deficit) — the scan nets gaps against
  reachable spare with no latency term (`lib/engine/directed-build.ts:505`); it reads zero exactly
  where a depot matters (supply exists, far away) and positive only where there is nothing to hold.
- *Player-marked depots only* — AI factions get none; hubs never shape the galaxy. Automation
  symmetry.
- *A separate depot building* — the physical warehouse row makes held cover a build target; a
  second building would duplicate it.

**Premises.**
- (checkable) *Sites exist:* at equilibrium, for the top-volume goods, a material share of
  developed worlds have ≥ 1 developed neighbour within two hops whose mean inbound latency for that
  good exceeds 24 ticks **and** are themselves within one cycle of a producer of it. Falsifiable
  sentence: "fewer than 10% of developed systems qualify as a depot site for any of the five
  highest-volume goods at 10K and 16K."
- (checkable) *Relayed demand is not tiny:* the summed relayed demand at qualifying sites is at
  least the demand of one median consumer world, so a depot's 30-cycle band is worth hauling.
- (definitional, Kai 2026-09-06) a depot's want is real demand the matcher serves, ranked below
  people eating; the donor floor for relayed goods is the producer's; depots are a market policy,
  no building this pass.
- (definitional, Kai) player exposure stays coarse — a depot is visible and toggleable per
  system, never a per-good valve; the AI planner runs the same rule under the lanes automation toggle.
- (hypothesis) events' anchor shift, which the donor reserve rides today
  (`lib/engine/directed-logistics.ts:136`), should ride the depot's reserve the same way — carried
  to the spec's hazard row, not decided.
- (hypothesis) letting depot stock count as drawable supply for the planner's input gate and the
  founding manifest (the `surplusDrawable` triple duty) is desirable — a depot is a supplier.

**Terminal falsifier.** If, at both 10K and 16K on seed 42 / 600 systems, fewer than 10% of
developed systems qualify as a depot site for any of the five highest-volume goods, the depot
direction is dead at this galaxy size and the latency problem needs a different answer (faster
freight, or producer placement) — back to brainstorm.

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
