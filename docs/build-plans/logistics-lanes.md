# Logistics lanes — working file

## Idea

### Problem

Goods movement is invisible and decisionless. Space should make lanes scarce and governed — mass
traffic between two stars runs down essentially one corridor, like controlled airspace — but today
the player neither invests in lanes nor feels them, and cutting one means nothing. Routing between
systems does not exist in the simulation: a haul is a direct donor→deficit stock delta with route
cost = hop count × weight capped at 4 hops (`lib/world/tick.ts:1625-1627`,
`lib/constants/directed-logistics.ts:95`); no path is traversed, no edge is billed, and the
overlay's "routes" are stitched from the flow log for display only. Edge `fuelCost` is read by
migration attenuation only, never by goods.

### Chosen direction

**Lanes as first-class per-edge objects, one shared routing substrate, capacity from investable
infrastructure, scheduled virtual transit.**

- A jump lane becomes a persistent object carrying invested infrastructure → capacity. The player
  (and the autonomic planner, symmetrically) invests in lanes; routes form themselves — the player
  never authors a route.
- Every haul routes over an actual cheapest path and bills capacity on each edge it crosses; a
  saturated edge throttles or reroutes. Chokepoints, congestion and severing fall out of the graph.
- One path engine serves every mover — goods now; migration, colonist delivery and founding-manifest
  staging can be rehosted onto it.
- **Transit is scheduled, never positionally simulated**: dispatch computes arrival tick from route
  time; a pending-arrivals ledger applies the delta at arrival. Interdiction (war, environmental
  events) resolves lazily — query which scheduled flows cross the affected edge in the affected
  window. Nothing per-tick moves.
- Severed lanes are the war system's future strategic verb; this pass builds the substrate hook,
  not the war mechanics.
- **Map generation is a coupled lever, not a fixed given.** Star distribution need not be an even
  spread — clusters, corridors and voids are on the table precisely to give lane mechanics
  geography worth investing in. Whether the map-gen rework rides in this pass is decided by the
  flow-concentration measure below.

### Killed alternatives

- **Player-authored route objects (Anno-style)** — Vicky3 shipped manual routes 2022, deleted them
  1.9/2025 as decisionless clerical work; owner: "C is definitely out… we decide where to invest and
  which systems need the increased load most."
- **Positional transit simulation (per-tick ship movement)** — cost scales with traffic, and the
  information it produces (where exactly a shipment is) matters only when something interdicts it;
  the lazy query answers that on demand.
- **Bandwidth-only, no transit time (pure Vicky3 market-access)** — subsumed: the scheduled-arrival
  ledger delivers latency at negligible cost, and pure bandwidth loses the in-transit loss hook war
  needs.

### Premises

**Checkable** (→ `/measure`, step-1 form):

1. **Flow concentrates.** At equilibrium (10,000 ticks, default 600 systems), projecting the flow
   log's hauls onto shortest paths over the open-edge graph, the top decile of trafficked
   intra-faction edges carries ≥ 40% of edge-crossing haul volume.
2. **Routing workload is boundable.** Per logistics run at equilibrium, transfers and distinct
   donor→deficit pairs are small enough to path-find within budget — measure the actual counts and
   the current logistics processor's share of tick wall-clock at 600 and 10K systems.
3. **Correction is already slow relative to transit.** Median ticks from a system entering a
   survival-good deficit to recovery at equilibrium is ≥ one `LOGISTICS_INTERVAL` — i.e. a few
   ticks of scheduled transit latency is small against today's real correction time.
4. **Edge cost varies.** The intra-faction edge `fuelCost` distribution has real spread
   (p90/p10 ≥ 2) — else all lane differentiation must come from invested infrastructure alone.
5. **Long chains exist to serve.** Goods already effectively traverse > MAX_HOPS via relay through
   intermediate markets (visible in the flow log as stitched same-good chains) — the demand for
   real multi-hop routing is present, not hypothetical.

**Definitional** (owner decisions, quoted):

- Player invests, never routes: "the player doesnt set the routes, but they invest in routes which
  need more capacity" / "we decide where to invest and which systems need the increased load most."
- Lanes are shared objects: "whatever system we use here for the routing, should be able to be
  hijacked for other systems too" / "Treating the lanes as their own objects … is important for
  many other things."
- Virtual transit: "we dont update the transit location as we go along, we just check which ships
  should be in transit on that route at that tick if something happens on that route."
- War hook: "cutting off resources becomes a real strategic move in the war system."
- The player challenge is allocation: "balancing the different systems and having to make hard
  decisions about what to spend money or invest in."

**Hypotheses** (carried forward, labelled):

- The generated jump-lane graph is sparse enough at cuts (gateways) that capacity investment is a
  choice, not a uniform upgrade everywhere. *(hypothesis — premise 1 measures the flow side; the
  graph-structural side stays open until measured)*
- Scheduled-transit latency at realistic travel times does not destabilise the equilibrium (no
  shortage-response oscillation). *(hypothesis — not cheaply checkable before a prototype)*
- A route dictionary keyed on (faction, source, destination), invalidated on topology/ownership
  change, keeps pathfinding affordable at 10K systems. *(engineering hypothesis)*

### Decision rule (owner-reframed: the measure diagnoses, it does not veto)

The direction is a design commitment, not a hypothesis under test. Owner (2026-08-31): "I'm not
keen on shaping our mechanics based on a measure, if the measure is off then we need to think of
way to fix that because we've chosen the mechanics we think will make it fun."

The measurement stays, with its consequence redirected: at equilibrium (10,000 ticks, default
600-system galaxy), project every directed-logistics haul in the flow window onto its shortest
open-edge path.

- **If the top 10% of trafficked intra-faction edges carry ≥ 40% of edge-crossing haul volume**, the
  current topology already concentrates flow — lane mechanics land on the map as generated, and the
  map-gen rework (clustered/uneven star distribution) can follow as its own pass.
- **If below**, the map is too uniform for chokepoints — the map-generation rework (clusters,
  corridors, voids) becomes a co-requisite of this pass, so geography supplies the structure the
  even spread lacks. The lane mechanics are unchanged either way.

## Premises 2–5 — falsifiers (committed before measurement)

Same diagnostic posture as premise 1: a falsified premise redirects the spec, it never kills the
chosen mechanics.

- **Premise 2 (routing workload).** The raw counts (per-run transfers, distinct donor→deficit
  pairs, route-cost evaluations, and the logistics processor's wall-clock share) are *descriptive,
  no kill-line*. The one kill-line: **if measured per-run distinct haul sources × a measured
  single-source BFS over the largest faction's open-edge subgraph projects to more than the
  current directed-logistics run's own wall-clock** (real pathfinding would at least double the
  processor), the workload premise is falsified and the route dictionary is promoted from
  engineering hypothesis to spec requirement.
- **Premise 3 (correction already slow).** Measured as consecutive-logistics-run deficit spells per
  (system, survival good) using `classifyMarketState` where the matcher reads it: **if the median
  spell is a single run (deficit cleared by the next run, i.e. correction ≤ one
  `LOGISTICS_INTERVAL` = 24 ticks) at both the 10K and 16K horizons**, the premise is falsified —
  scheduled-transit latency is then a real addition to correction time, and the oscillation
  hazard gets first-class treatment in the spec instead of a "small against today" waiver.
- **Premise 4 (edge cost varies).** **If intra-faction edge `fuelCost` p90/p10 < 2 on both seeds at
  equilibrium**, falsified — existing edge costs cannot differentiate lanes, and all lane
  differentiation must come from invested infrastructure plus map-gen geography.
- **Premise 5 (long chains exist).** **If under 5% of edge-crossing haul volume in the equilibrium
  flow window departs a donor that itself received the same good within the window** (re-export
  stitching), relays are rare and the premise is falsified — routing beyond `MAX_HOPS` serves
  demand that does not yet exist and the spec must not lean on it. The premise-1 hop-histogram
  cliff at `MAX_HOPS` shows the cap *binds*; it does not show relaying, so it cannot confirm this
  premise on its own.

## Evidence

### Premise 1 — flow concentration (measured 2026-08-31)

```
Meaning:  Logistics flow spreads broadly over each faction's lane graph — the busiest tenth of
          lanes carries about three times its uniform share, far short of dominant corridors, and
          no small edge set carries the galaxy's freight. A few individual factions do read
          concentrated (0.43-0.49), so chokepoints exist locally, not structurally.
Claim:    At equilibrium-horizon, projecting the flow log's hauls onto shortest open-edge paths,
          the top decile of trafficked intra-faction edges carries ≥ 40% of edge-crossing volume.
Number:   Top-decile share (even-split projection): 0.317 (seed 42, 10K), 0.328 (seed 43, 10K),
          0.296 (seed 42, 16K). Deterministic-path projection within 2 points of even-split on
          every run — tie-breaking is not hiding concentration. Top-10-edges absolute share only
          0.10-0.15. Per-faction top-decile ranges 0.26-0.49; above 0.40 in 2 of 6 (s42 10K),
          2 of 5 (s43 10K), 2 of 8 (s42 16K) factions with ≥20 trafficked edges.
Horizon:  1000t: zero flow events (pre-founding — 20 seeded homeworlds, no intra-faction edges;
          validated against the known first-establish ~t=4128). 10,000t: both seeds. 16,000t:
          trajectory check — share drifts DOWN (0.317 → 0.296) as the galaxy develops (188 → 212
          developed), so maturation spreads flow further; the reading is not a transient low.
Cohort:   All directed-logistics hauls in the trailing FLOW_HISTORY_TICKS=200 window (~8 logistics
          runs, 2371-3001 events), projected onto the end-state open-edge graph; per-faction rows
          gated at ≥20 trafficked edges.
Licenses: Supports: the current even-spread topology does not concentrate flow to the 40% line at
          any measured horizon or seed. Does NOT support: "no chokepoints exist" (per-faction highs
          0.43-0.49); any mature-galaxy claim (~31-35% of systems developed even at 16K — founding
          era per measurement-traps). Instrument noise: 3.6-8.6% of hauls project unreachable or
          >MAX_HOPS because ownership at snapshot differs from ownership at haul time
          (abandonment); conserved-volume validation passed exactly on all runs.
Raw:      temp/lane-flow-10k-s42.json, temp/lane-flow-10k-s43.json, temp/lane-flow-16k-s42.json
          (temp/lane-flow-diag.ts; headline rows inline below)
            s42 10K  split topDecile 0.3171  det 0.3011  edges 339  hauls 2739  unreachable 99
            s43 10K  split topDecile 0.3280  det 0.3241  edges 277  hauls 2371  unreachable 203
            s42 16K  split topDecile 0.2964  det 0.2866  edges 394  hauls 3001  unreachable 126
```

**Outcome: falsified — the decision rule's second arm fires.** The map as generated is too uniform
for lane capacity to bite; the map-generation rework (clustered stars, corridors, voids) joins this
pass as a co-requisite. Side observation for premise 5: the hop histogram is roughly uniform across
1-4 hops then cliffs at 5 — `MAX_HOPS` visibly binds; ~45% of hauls already run 3-4 hops.

*Correction (2026-08-31, premises 2-5 instrument):* the 1000t parenthetical above overstated —
intra-faction edges DO exist at 1000t (the claim wave finishes by ~t=700, freezing the faction
partition; 702 same-faction edges on s42). What is absent pre-founding is developed-to-developed
flow: zero flow events stands.

### Premises 2–5 (measured 2026-08-31)

Instrument: `temp/lane-premise-diag.ts` + two temporary measuring patches (directed-logistics block
timing + routeCost call counter in `lib/world/tick.ts`; per-run deficit/transfer census via
`classifyMarketState` at the matcher call site in `lib/tick/processors/directed-logistics.ts`),
both reverted after the runs. Validation: with hooks installed, s42/600/10K reproduced premise 1's
run exactly (developed 188, flowEvents 2739) — the instrument does not perturb the world; and on
every run the hook's transfer count over the flow window equals the flow log exactly
(single-writer cross-check). Startup horizon: structurally empty for all flow-derived metrics
(zero flow events at 1000t, validated premise 1). Equilibrium windows: run stats over ticks ≥ 60%
of horizon. Raw: `temp/lane-premise-600-s42-t10000.json`, `…-600-s43-t10000.json`,
`…-600-s42-t16000.json`, `…-10000-s42-t10000.json`, `…-600-s42-t1000.json`.

#### Premise 2 — routing workload is boundable

```
Meaning:  Real cheapest-path routing is comfortably affordable at current traffic on both galaxy
          sizes — per-run haul-source counts are around a hundred, a single-source BFS over the
          largest faction's lane graph is microseconds, and the projected pathfinding bill is a
          small fraction of what the logistics run already spends building its own state.
Claim:    Per logistics run at equilibrium, transfers and distinct donor→deficit pairs are small
          enough to path-find within budget.
Number:   600 systems (s42 10K / s43 10K / s42 16K), per-run medians: transfers 236/229/359;
          distinct pairs 133/132/249; distinct haul sources 81/80/130; routeCost calls 355/336/690;
          deficit rows 1874/1799/2271; surplus rows 304/306/537. Logistics run wall-clock median
          9.0/9.2/13.3 ms; logistics share of total tick wall-clock (equilibrium) 7.3%/7.2%/8.6%.
          Largest faction subgraph 35-38 nodes; BFS ≈ 0.006 ms → projected per-run pathfinding
          0.50-0.81 ms = 5.4-6.1% of the run's own current cost. 10,000-system galaxy (s42 10K):
          transfers 400, pairs 211, sources 123, routeCost calls 578; run 17.6 ms; share 2.2%;
          largest faction 407 nodes, BFS 0.027 ms → projected 3.3 ms = 19% of the run's cost.
Horizon:  1000t structurally empty (no flow); 10,000t both seeds; 16,000t trajectory: counts grow
          roughly with developed-system count (transfers 236 → 359 as developed 188 → 212), so the
          workload tracks development, not galaxy size.
Cohort:   Equilibrium-window logistics runs (167 runs at 10K, 250 at 16K), all factions; census
          taken where the matcher reads its state.
Licenses: Supports: per-haul shortest-path routing with per-source path caching fits today's tick
          budget at 600 and 10,000 systems — the committed kill-line (projected pathfind > the
          run's own wall-clock) fires nowhere (worst ratio 0.19). Does NOT support: the cost of
          per-edge capacity accounting or congestion-aware re-routing (not modeled); workload
          after lanes remove MAX_HOPS (reach grows, sources see more candidates); a mature-galaxy
          claim (both sizes still founding-era — 403/10,000 developed at the large size).
Outcome:  CONFIRMED (kill-line clear by >5×; the route-dictionary hypothesis stays an
          optimisation, not a requirement).
```

#### Premise 3 — correction is already slow relative to transit

```
Meaning:  The typical survival-good deficit is corrected within a single logistics interval — the
          median spell is one run at every seed and horizon — so a few ticks of scheduled transit
          latency would be a material addition to the typical correction, not a rounding error on
          an already-slow one. A heavy tail of chronic deficits (weeks-long spells) coexists with
          the fast median.
Claim:    Median ticks from a system entering a survival-good deficit to recovery at equilibrium
          ≥ one LOGISTICS_INTERVAL (24 ticks).
Number:   Median spell = 1 run (i.e. cleared by the next run, correction ≤ 24 ticks) on every run:
          single-run share 77.0% (s42 10K, n=1080), 75.5% (s43 10K, n=661), 85.3% (s42 16K,
          n=681), 82.1% (10K-system, n=3511). p90 = 2-3 runs; max 33-158 runs (chronic tail).
Horizon:  10,000t (both seeds) and 16,000t — falsified at both; 1000t structurally empty (no
          survival deficits recorded among the 20 self-sufficient homeworld prefabs).
Cohort:   (developed system, water|food) deficit spells classified by classifyMarketState at each
          logistics run, spells starting inside the equilibrium window and completed before the
          end (censored spells 0-23 per run, excluded).
Licenses: Supports: typical correction is fast — the premise's "latency rides free" waiver is
          gone. Does NOT support: "all correction is fast" (the p90+ tail is runs-to-weeks long —
          the chronic/no-donor class); an exact sub-interval correction time (resolution is one
          run, so median 1 run means ≤ 24 ticks, not a point value). A system leaving the
          developed set mid-spell ends its spell (abandonment conflation, small share).
Outcome:  FALSIFIED — per the committed falsifier, scheduled-transit latency gets first-class
          oscillation-hazard treatment in the spec; the carried "latency does not destabilise"
          hypothesis is now live, not waivable.
```

#### Premise 4 — edge cost varies

```
Meaning:  Intra-faction jump-lane fuel costs are nearly uniform — the spread between cheap and
          expensive lanes is well under the committed 2× line on every seed and size — so the
          existing edge-cost field cannot differentiate lanes on its own.
Claim:    Intra-faction edge fuelCost p90/p10 ≥ 2 at equilibrium.
Number:   p90/p10 = 1.79 (s42, 702 edges), 1.87 (s43, 692 edges), 1.60 (10K-system galaxy,
          10,123 edges). p10/p50/p90 ≈ 7.1/8.5/12.7. Identical at 1000t/10K/16K on s42 — the
          faction partition freezes when the claim wave completes (~t=700), so the cohort is
          horizon-stable.
Horizon:  Both horizons read (identical by structure); equilibrium quoted.
Cohort:   Undirected same-faction edges at end-state, all control states (claimed fringe
          included).
Licenses: Supports: lane differentiation cannot come from existing fuelCost spread — invested
          infrastructure and map-gen geography must carry it (converges with premise 1's
          second-arm outcome). Does NOT support: fuelCost being meaningless (a 1.6-1.9× spread
          exists and migration already reads it); the trafficked-edge sub-cohort's spread was not
          measured separately.
Outcome:  FALSIFIED on both seeds.
```

#### Premise 5 — long chains exist to serve

```
Meaning:  Relay chains essentially do not exist — virtually no haul departs a system that itself
          received the same good in the window. MAX_HOPS binds (premise 1's hop cliff) and the
          demand beyond it is simply unserved, not served indirectly; the donor dead-band makes
          relaying structurally impossible (a deficit fills to ~32-40 cycles of cover but only
          donates above ~56), so multi-hop service can never emerge from warehouse stitching.
Claim:    Goods already effectively traverse > MAX_HOPS via relay through intermediate markets.
Number:   Re-export share of edge-crossing haul volume (donor received same good earlier in the
          window): 0.054% (s42 10K), 0.094% (s43 10K), 0.000% (s42 16K), 0.040% (10K-system) —
          two orders below the committed 5% line. Stitched chains whose origin out-reaches
          MAX_HOPS to the final destination: 0-4 events per window. Same-run re-export: 0 in all
          runs.
Horizon:  10,000t (both seeds) and 16,000t; 1000t structurally empty.
Cohort:   All hauls in the trailing FLOW_HISTORY_TICKS=200 window (~8 logistics runs,
          2371-4684 events) against arrivals in the same window.
Licenses: Supports: no current service beyond MAX_HOPS — the spec must treat >4-hop routing as a
          new capability serving latent demand, not a formalisation of existing behaviour. Does
          NOT support: "no demand beyond 4 hops" (the hop cliff and the unreachable/unservable
          residuals say the demand is there and unserved). Window-bounded: a relay slower than
          ~8 runs would be invisible — but the donor dead-band argument above rules that out
          structurally, not just observationally.
Outcome:  FALSIFIED — decisively.
```
