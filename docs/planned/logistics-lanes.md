# Logistics Lanes & Galaxy Geography

Functional spec. Evidence and brainstorm: `docs/build-plans/logistics-lanes.md`. Multi-PR feature
(the map-generation rework is its own sub-project), which is why this spec lives here rather than
in the working file's `## Spec` section.

---

## Header

**What changes:** Jump lanes become persistent objects the player and the AI factions invest in —
an upgraded lane carries more freight, an untouched one carries a small baseline, and the map draws
exactly where every investment sits. Goods hauls now travel a real cheapest route over those lanes,
take time proportional to the distance crossed, and bill each lane they use, so busy corridors
congest and cutting one somewhere hurts somewhere else. The galaxy itself gains geography worth
fighting over: system density varies by design — dense clusters, long sparse crossings, and true
voids no lane crosses — so traffic concentrates into corridors instead of spreading evenly.
Nobody ever draws a route: routes form themselves from where capacity was built.

**Why:** Goods movement is invisible and decisionless — no path is traversed, no edge is billed,
and cutting a lane means nothing (working file `## Idea`). Owner decisions this spec encodes,
quoted:

- Investment, never routing: "the player doesnt set the routes, but they invest in routes which
  need more capacity" / "we decide where to invest and which systems need the increased load most."
- Shared substrate: "whatever system we use here for the routing, should be able to be hijacked
  for other systems too" / "Treating the lanes as their own objects … is important for many other
  things."
- Virtual transit: "we dont update the transit location as we go along, we just check which ships
  should be in transit on that route at that tick if something happens on that route."
- War hook: "cutting off resources becomes a real strategic move in the war system."
- The player challenge: "balancing the different systems and having to make hard decisions about
  what to spend money or invest in."
- Measures diagnose, never veto: "I'm not keen on shaping our mechanics based on a measure, if the
  measure is off then we need to think of way to fix that because we've chosen the mechanics we
  think will make it fun."
- Map geography (2026-08-31): "greatly increasing the variance of distance between systems, some
  much closer and some much further, having large empty spaces that are similar to the oceans in a
  world based grand strategy game."
- Hop cap: "Yeah MAX_HOPS shouldnt survive I think."
- Traversable space: "unclaimed space is fair game, a minimum transit allowance for non-upgraded
  lanes makes sense"; foreign space "is definitely something that makes sense to add, although in
  most cases you'll never need to route internal goods through another faction."
- Distance is real: "we will have real ships later, for the war system and likely others, and in
  those cases the distance absolutely matters" / "we'rent we discussing and agreed on the idea
  that good delivery actually could take time?"
- The fallback: "we might need to fallback to instant delivery but blocked based on route, which
  gets us most of the way there if it proves too expensive … or confusing."
- Slot-in/out: "those parts that are uncertain will slot in/out well later without us having to
  pull the whole lane traversing mechanics we are adding, since this logic will be re-used for
  migration and possibly other mechanics."
- Our EU5 difference: "the difference between our game and EU5 is the unhabitable systems, which
  already must create some sort of chokepoints" / "in EU5 … where the roads are is really unclear
  wheras we can make it much clearer on our map."

**Evidence** (full frames in the working file's `## Evidence`):

- *P1 flow concentration, falsified:* the even map spreads flow (top-decile share 0.30–0.33 vs the
  0.40 line, drifting down with maturation). Licenses: the current topology does not concentrate
  flow at any measured horizon/seed; does NOT say no chokepoints exist (per-faction highs
  0.43–0.49) and is a founding-era read. → the map-gen rework rides in this pass (decision rule,
  second arm).
- *P2 routing workload, confirmed:* per-run haul sources ~80–130, BFS over the largest faction
  subgraph is microseconds; projected pathfinding is 5–19% of the logistics run's own current
  cost at 600 and 10,000 systems. Licenses: per-haul cheapest-path routing with per-source caching
  fits the tick budget; does NOT cover capacity accounting or the post-MAX_HOPS candidate growth.
- *P3 correction speed, falsified:* the median survival-good deficit clears within one logistics
  interval (75–85% single-run spells, every seed/horizon). Licenses: typical correction is fast —
  transit latency is a material addition, not a rounding error; a chronic tail (runs-to-weeks)
  coexists. → the oscillation hazard is first-class in this spec (§3), not waived.
- *P4 edge cost spread, falsified:* intra-faction `fuelCost` p90/p10 is 1.60–1.87, under the 2×
  line everywhere. Licenses: existing edge costs cannot differentiate lanes — invested
  infrastructure and map-gen geography must carry it. → the ≥ 2 line becomes the map-gen
  acceptance measure (§5).
- *P5 relay chains, falsified decisively:* re-exports are ≤ 0.09% of haul volume; the donor
  dead-band makes relaying structurally impossible. Licenses: routing beyond the current cap is a
  new capability serving latent unserved demand, never a formalisation of existing behaviour.

**Not claimed:** This spec does not design war interdiction mechanics (only the substrate query
they will call), transit rights through foreign space (a named future slot; borders stay closed to
routing this pass), the markets redesign (the substrate is deliberately market-agnostic so that
redesign swaps the client, not the substrate), or the rehosting of migration / colonist delivery /
founding-manifest staging onto the path engine (future passes; their current mechanics are
untouched). It does not commit tuning values — every constant below is a proposal carrying its
rationale, calibrated in the sim. Two wrong skimmer readings, disclaimed: (1) "goods now take long
realistic times" — freight latency is a few ticks against a 24-tick logistics interval and is a
single tunable that can be set to zero (instant delivery, routing and capacity retained) if it
proves confusing or destabilising; (2) "the map rework changes what is habitable" — habitability,
deposits and settleability distributions are untouched; only positions, spacing and the lane graph
change.

---

## Behaviour

### 1. The lane object

Every jump lane — today a pair of directed `WorldConnection` rows (`lib/world/types.ts:443-446`)
that nothing persists state on — gains one persistent, undirected lane record: **new world
collection** `world.lanes`, a JSON-serialisable array (no Map/Set — save rule), one row per
undirected system pair, carrying the invested **lane level** (float, ≥ 0) and its rolling
**per-run load** (for display and decay; written by the logistics processor).

- **Level 0 is the minimum transit allowance** (owner decision): every generated lane is
  traversable at a small baseline capacity with no investment. There is no impassable lane except
  a severed one (a war-era state this spec only reserves; nothing in this pass severs).
- **Capacity** rises with level: `capacity(level) = BASE_LANE_CAPACITY × (1 + level)` — proposal;
  linear first cut, one new constant pair (new — `lib/constants/lanes.ts`), calibrated so an
  unupgraded lane comfortably carries a young colony's resupply and a mature corridor cannot run
  on baseline alone.
- **Investability:** a faction may invest in a lane exactly when it controls both endpoint systems
  (`factionId` + `control` at `lib/world/types.ts:104-106`, `control ≥ controlled`). This is the
  rule that turns uninhabitable systems into chokepoint estate: claiming a dead system on a
  corridor (claims are free and near-instant — `docs/active/gameplay/colonisation.md`) is what
  makes the lanes through it upgradeable. No new colonisation mechanic ("waystation development"
  stays a possible later extension).
- **Build and upkeep ride the existing purse:** a lane upgrade is a construction project in the
  committed queue (`world.constructionProjects`, same `origin: "auto" | "player"` tagging —
  `docs/active/gameplay/player-seat.md`), funded by the construction band; built lane levels join
  the maintenance band's bill. Proposal: lane levels **decay toward used capacity** exactly as
  buildings decay toward use (the decay-ratchet symmetry), so an abandoned corridor's investment
  rots. Money stays fuel, not capacity.
- The autonomic planner proposes lane upgrades symmetrically for every faction (§4).

### 2. Routing

Every haul travels a real cheapest path over open lanes, computed per logistics run.

- **Route cost** of a path is the sum of its edges' `fuelCost` (`lib/world/types.ts:445`) —
  the distance-derived quantity generation already authors
  (`laneFuelCost`, `lib/engine/universe-gen.ts:421-428`: normalised distance × lane-class
  multiplier) — times a **congestion multiplier** per edge (proposal: cost multiplies smoothly as
  the edge's booked load approaches capacity; exact curve is a build-plan/calibration choice).
  The engine is the existing fuel-weighted Dijkstra
  (`lib/engine/pathfinding.ts:43` `buildFuelAdjacency`, Dijkstra loop at `:109-111`), today
  serving ship navigation only — one path engine for every mover, per the shared-substrate
  decision.
- **`MAX_HOPS` is removed for goods** (owner decision). Reach is bounded by cost: the existing
  population-funded work budget already prices a haul at `quantity × route cost`
  (`lib/constants/directed-logistics.ts:94-98`), so distant hauls are expensive rather than
  forbidden. The constant's other readers are deliberately untouched this pass:
  `DIRECTED_BUILD.MAX_HOPS` (`lib/world/tick.ts:1667`), `EXPANSION.REACH_JUMPS`
  (`lib/constants/expansion.ts:20`), and the market panel's own local cap
  (`components/market/market-comparison-panel.tsx:17`).
- **Traversable space:** a route may cross the hauling faction's own systems and **unclaimed**
  systems. Foreign systems are closed to routing this pass (the transit-rights slot). This
  *narrows* today's behaviour — the current hop BFS is faction-blind
  (`lib/world/tick.ts:1605-1614`, over all connections) — and the evidence says the narrowing
  strands almost nothing: the premise-1 projection over the stricter same-faction-only graph
  still reached 91–96% of hauls within 4 hops.
- **Capacity billing:** each haul books its quantity onto every edge it crosses for that run.
  When an edge is fully booked, later hauls (the matcher is already severity-ordered, worst-first
  — `docs/active/gameplay/economy-autonomic-agency.md`) route around it at higher cost or, if no
  affordable alternative exists, go unserved into the existing residual accounting
  (`unservedShortfall`, `lib/tick/processors/directed-logistics.ts:120-141`). Observable: a
  saturated corridor shows full lanes, longer detours, and rising unserved shortfall behind it.
- **Route cost stays the work-budget price**: the same summed edge cost bills the faction's
  logistics work (`workPerformedByFaction`, `lib/tick/processors/directed-logistics.ts:142-155`),
  replacing the hop-count price at `lib/world/tick.ts:1625-1628`. (Note: the docstring at
  `lib/constants/directed-logistics.ts:96-98` already *claims* fuel enters route cost; the code
  never did. This spec makes the docstring true and retires `HOP_WEIGHT`/`FUEL_WEIGHT` in favour
  of the edge-summed cost.)

### 3. Scheduled transit

Transit is scheduled, never positionally simulated (owner decision).

- **Dispatch** computes an arrival tick: `arrival = now + Σ edge traversal time` along the chosen
  path. Traversal time reuses the ship travel rule (`hopDuration`,
  `lib/engine/travel.ts:14-18`: ticks from `fuelCost` and a speed) with a **freight speed**
  (new constant, proposal) chosen so a typical intra-cluster haul arrives within ~a quarter of a
  logistics interval and a trans-void haul takes one to a few intervals. One distance→time rule
  shared by goods and (later) ships.
- **The pending-arrivals ledger** — new world collection, serialisable array of
  `(arrivalTick, systemId, goodId, quantity, routeEdges)` — is written at dispatch; the stock
  delta lands on the destination market row at the arrival tick. Donor stock is debited at
  dispatch (goods in flight belong to nobody's warehouse). Arrivals apply unconditionally: market
  rows survive abandonment with their stock (`docs/active/gameplay/colonisation.md`), so a
  delivery to a world that died in transit simply lands in the ghost market.
- **Deficit classification counts inbound.** The sink test reads
  `stock + scheduled inbound for that good` where it reads stock today
  (`classifyMarketState`, `lib/engine/directed-logistics.ts:35-43`, fed at
  `lib/tick/processors/directed-logistics.ts:54`); the donor test keeps physical stock only. This
  is the oscillation guard the premise-3 falsification demands: a system whose goods are en route
  does not re-order. **This rule is first-class, not optional** — the evidence says typical
  correction is currently faster than one interval, so uncompensated latency would create
  overshoot where none exists today.
- **Latency is one tunable.** Setting freight time to zero yields instant delivery with routing,
  capacity billing and blocking fully retained — the owner's named fallback, architecturally free
  because the killed "bandwidth-only" alternative is a strict subset of this design. The sim
  decides (§8) whether nonzero latency ships enabled.
- **The interdiction query** (war's future verb): a read-only function answering "which scheduled
  flows cross edge E in window [t₁,t₂]" from the ledger's route field. New — emitted by the lane
  substrate; consumed by nothing in this pass.

### 4. Investment agency — player and planner, symmetrically

- **Player:** an invest/upgrade verb on any lane whose two endpoints the player controls, from the
  lane's map surface (§7). Orders enter `world.constructionProjects` tagged `origin: "player"`,
  ride the existing queue priority (`orderOpenProjects` — `docs/active/gameplay/player-seat.md`)
  and are cancellable like any player build. The build/colonisation automation switches gain no
  third domain this pass: lane proposals ride the existing `build` switch (proposal — cheapest
  honest cut; revisit if lanes want their own toggle).
- **Autonomic planner:** a new opportunity type on the planner's existing ROI ordering
  (`docs/active/gameplay/economy-autonomic-agency.md`): where the past window's routing shows an
  edge congestion-binding (booked load at capacity, or unserved shortfall attributable to
  capacity), the planner proposes a lane upgrade scored by the throughput it unblocks — competing
  for the same construction pool as housing, industry and colonies. Requirement: the binding-edge
  signal is **new — emitted by the logistics processor per run** (per-lane booked load and
  capacity-blocked volume), persisted on the lane row; no processor reads it back except directed
  build's planner (and the alert/map read surfaces).

### 5. Galaxy geography (the map-generation co-requisite)

Today's placement is uniform by construction: Bridson Poisson-disk sampling with a hard minimum
distance and a [d, 2d] candidate annulus (`bridsonSample`, `lib/engine/universe-gen.ts:219-305`)
— which is exactly why premise 1 read flat (flow spreads over an even mesh) and premise 4 read
flat (`fuelCost` is normalised distance, and Poisson distances cluster near the minimum —
`lib/engine/universe-gen.ts:421-428,493-505`). The rework replaces the uniform field with authored
variance; the lane graph machinery on top (per-region MST + extra edges + gateway crossings,
`lib/engine/universe-gen.ts:475-605`) is retained and retuned, not redesigned.

Observable outcomes, stated as acceptance measures:

- **Clusters, crossings and voids.** System density varies across the map: dense clusters whose
  internal lanes are short and cheap; long sparse crossings between them; and true voids —
  ocean-like empty spans that no lane crosses, so traffic must go around. Regions, region naming,
  Voronoi boundaries and the gateway-system designation (`lib/world/types.ts:107`) survive.
- **Distance variance becomes cost variance:** intra-faction lane `fuelCost` p90/p10 ≥ 2 on the
  generated map (the premise-4 line, promoted from falsified premise to generation acceptance).
- **Geography concentrates flow:** candidate generators are scored with the premise-1 instrument
  (`temp/lane-flow-diag.ts` — shortest-path projection of the equilibrium flow window), accepted
  when the top-decile trafficked-edge share reads ≥ 0.40 at the equilibrium horizon *before* lane
  capacity mechanics are enabled — geography alone must supply the concentration the decision
  rule's second arm demands, so the two sub-projects stay independently verifiable.
- **Untouched:** habitability scoring, deposit authoring, the settleable fraction, homeworld
  prefab stamping (`stampHomeworldPrefabs`, `lib/engine/universe-gen.ts:617`), and homeworld
  spacing guarantees. New-game system-count scaling continues to derive extent/regions
  continuously (`docs/SPEC.md` Universe & Map).
- Seeds shift by design; verification is intrinsic coherence plus the acceptance measures, never
  parity with old output (AGENTS verification rule).

### 6. The substrate contract (what keeps the uncertain parts swappable)

The lane layer exposes exactly: nodes, open edges with capacity/cost/time, cheapest-path queries,
capacity booking, the scheduled-arrivals ledger, and the interdiction window query. It never reads
market rows, goods identities' meanings, demand, prices, or faction treasuries — the
surplus→deficit matcher is its first client, not its definition. This is the owner's slot-in/out
requirement made structural: transit time can drop to zero, foreign transit can open, migration
and colonist delivery can rehost, and an EU5-style multi-system market model can later *define
market membership from lane reachability* — each by swapping or adding a client, never by pulling
the traversal mechanics.

### 7. Surfaces

- **Map:** the logistics overlay stops inferring routes from the flow log
  (`lib/tick/world/trade-flow-topology.ts:50`, display-only stitching) and draws real lanes with
  real state: level (visual weight), booked load vs capacity (colour), and in-flight volume. The
  player sees exactly where every investment sits — the stated advantage over EU5's invisible
  roads. A lane is selectable; its card shows level, capacity, current load, upkeep, and the
  invest verb (enabled only under the endpoint-control rule, disabled state naming the missing
  endpoint).
- **System Logistics tab:** gains inbound/outbound in-transit rows with arrival ETAs (durations
  through the calendar's one auto-scaling rule — `docs/SPEC.md` The Calendar).
- **Copy:** new player-facing terms (lane, lane level, capacity, in transit, congested) go through
  the `/game-copy` glossary pass; "lane" must reconcile with the existing map-label vocabulary.
- **Alert bar:** no new category this pass (congestion surfaces on the map and the planner's
  existing blocked/unserved signals); revisit after play.

### 8. Calibration & verification

- New sim metrics: per-lane utilisation distribution, top-decile flow share (now first-class),
  in-transit volume, and the deficit spell-length distribution (the premise-3 instrument's shape,
  kept as a standing metric).
- **Conservation:** goods in the pending-arrivals ledger are part of the conservation identity —
  dispatch debit + ledger + arrival credit must net to zero; a failed identity blocks merge
  (AGENTS sim rule).
- **Oscillation gate:** with nonzero latency, the spell-length distribution and a new overshoot
  read (deliveries landing on systems already above target) must not degrade against the
  zero-latency arm — the explicit test of the carried hypothesis "scheduled-transit latency does
  not destabilise the equilibrium", now live per the premise-3 falsifier.
- Both horizons, cohorted, as always; coarse health bar until the full mechanism set ships.

---

## Hazard worksheet

### 1. One quantity, several unrelated jobs

`npm run impact -- fuelCost`: **40 references across 15 modules — HAZARD 1 APPLIES** (verbatim
verdict). Readers: `pathfinding` (10×), `navigation` (8×), `universe-gen` (4×), `migration` (3× —
`lib/engine/migration.ts:108-117`, diffusion attenuation `1/(1+decay×fuel)`), `trade-flow-topology`
(3×), `travel` (2×), `transit-position`, `rows`, `gen`, `tick`, `world/types`, + 4 UI/service
modules.

| Quantity | Readers today | This design moves | Intended? |
|---|---|---|---|
| `fuelCost` | 15 modules above | adds goods routing as a reader (cost + time) | **Yes — deliberate coupling**: one distance quantity for every mover is the point (ships, migration, goods share a geography). No existing reader's semantics change. |
| `DIRECTED_LOGISTICS.MAX_HOPS` | `lib/world/tick.ts:1610,1627`; `lib/services/colony-eligibility.ts:31` (shared BFS radius max) | deleted for goods routing | Yes — **separation stated**: `DIRECTED_BUILD.MAX_HOPS`, `EXPANSION.REACH_JUMPS` and the market panel's local cap are deliberately untouched; the shared-radius `Math.max` at tick.ts:1610 loses one term. |
| `HOP_WEIGHT` / `FUEL_WEIGHT` | `lib/world/tick.ts:1627` (weight); docstring `directed-logistics.ts:96-98` | retired — route cost becomes edge-summed | Yes; the docstring already described the edge-summed form the code never implemented. |
| `flowEvents` | 6 modules (impact run): tick (write+retention `tick.ts:1655,2043`), gen, types, `trade-flow`, `world-index`, harness runner | rows unchanged in shape; the overlay's route inference is replaced by real lane loads | Yes — flow rows stay the per-haul record; display stops deriving paths from them. |
| `classifyMarketState` / `logisticsTarget` | matcher only (`lib/tick/processors/directed-logistics.ts:54` via `toGoodMarketStates`) | sink test gains inbound-awareness | Yes — single-reader site, the safe place for it. |
| `world.constructionProjects` | build planner, funding, UI (player-seat spec) | gains a lane-upgrade project kind | Yes — deliberately the same queue/pool (one ROI axis, owner decision). |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
|---|---|---|---|
| `fuelCost` (`laneFuelCost`, `universe-gen.ts:417-428`) | "Fuel cost of one lane, normalised against the average intra-region hop… `multiplier` prices a lane class above the intra-region baseline (gateways cost more)" | distance-derived per-edge cost/time base | Yes — distance-derived by authorship. Caveat carried: it is *classed* distance (gateway lanes ride a multiplier), which is intended — gateway crossings should cost more. |
| `hopDuration` (`travel.ts:14-18`) | ship travel ticks from fuel and speed | freight traversal time with a freight speed | Yes — same authored meaning (time from distance), new speed parameter. |
| `MAX_HOPS` (`directed-logistics.ts:94-95`) | "Max hops a logistics transfer may span (beyond this… unreachable)" | deleted | Read correctly; premise 1's hop-cliff shows it binding, premise 5 shows nothing routes around it. |
| `GENERATION_PER_POP` (`directed-logistics.ts:8-16`) | work-budget ceiling, "deliberately ample… deficits persist only for physical reasons" | unchanged; becomes the cost bound that replaces the hop cap | Yes — but flagged: with real (larger) route costs the budget may start to bind, which its docstring says must stay a deliberate signal. Calibration watches the funding-bound count. |
| `FLOW_HISTORY_TICKS` (`trade-simulation.ts:8`) | "flow history retention and route inference" window | unchanged retention; "route inference" clause becomes obsolete | Yes — docstring updated when the overlay switches. |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | None today — post-#275 the relations trio neither reads topology nor targets lanes (`docs/active/gameplay/events.md`). The severed-lane state is reserved as the future event/war verb; nothing in this pass creates one. | — |
| Population + migration | Migration keeps its own single-hop diffusion reading edge `fuelCost` (`migration.ts:108-117`) — untouched, future rehost client. Population feels lanes only through delivery timing (inbound-aware classification prevents double-ordering; famine-gate unchanged). | — |
| Unrest / regime | Indirect only: slower/blocked corridors → provision dips → existing grievance path. No new unrest reader/writer. | — |
| Industry + staffing | Input-gated production feels arrival timing; no new coupling. Lane upgrades bill no labour beyond the construction pool they already compete in. | — |
| Infrastructure decay | Lane levels adopt the same decay-toward-use shape (proposal, §1) — a new *instance* of the mechanism, not a change to building decay. | — |
| Directed logistics | The client being rebuilt: real routing, capacity billing, scheduled arrivals, inbound-aware classification (§2–3). | — |
| Directed build / planner | Gains the lane-upgrade opportunity type on the existing ROI ordering (§4); reads the new binding-edge signal. | — |
| Colonisation + founding manifest | Founding-manifest staging keeps its current (non-routed) draw this pass — rehost slot only. Colony ROI is *indirectly* moved: a colony behind a void is more expensive to supply once routing is real; accepted, watched in calibration. Claims gain a new motive (chokepoint estate) with zero mechanic change. | — |
| Treasury / purse | Lane builds fund from the construction band; lane upkeep joins the maintenance bill; logistics band unchanged (work budget already exists). No fourth band. | — |
| Factions + relations | No relations input this pass (border friction already reads cross-faction lanes — unchanged). Foreign-transit rights are the named future hook. | — |
| Save format (`World` shape) | **Breaks saves** (pre-1.0 policy): new `world.lanes`, new pending-arrivals collection, map-gen output differs. All new state JSON-serialisable arrays. | — |
| Harness metrics | New metrics §8; conservation identity extended over the in-transit ledger; interval-invariance must hold for arrival scheduling (`catchUpFactor` discipline). | — |

### 4. Symptom claims and their measurements

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| Flow does not concentrate on the even map | top-decile share 0.296–0.328 | 10K + 16K, 1K empty | intra-faction trafficked edges, both projections, 2 seeds |
| Routing workload is affordable | projected pathfind = 5–19% of the logistics run's own ms | 10K/16K, both sizes | equilibrium-window runs, all factions |
| Typical survival correction ≤ 1 interval | median spell 1 run; 75–85% single-run | 10K + 16K, 2 seeds | (developed system, water/food) completed spells, equilibrium window |
| Edge cost spread too flat | p90/p10 1.60–1.87 | horizon-stable | same-faction undirected edges, end-state |
| No relay chains | re-export ≤ 0.09% of volume | 10K + 16K | trailing 200-tick flow window |
| Routing today is faction-blind pass-through | `lib/world/tick.ts:1605-1614` (BFS over all connections) | — | code fact |
| Placement is uniform by construction | `bridsonSample` annulus [d,2d], `universe-gen.ts:219-305` | — | code fact |
| Goods routing never reads fuel | `lib/world/tick.ts:1625-1628` (hop-only cost) | — | code fact |

### 5. Primitives this design consumes

| Consumes | Produced at | Actual shape today | Design assumes |
|---|---|---|---|
| `fuelCost` per edge | `universe-gen.ts:421-428` → `gen.ts:176` → `types.ts:445` | normalised distance × class multiplier, rounded 0.1, floor 1; observed p10/p50/p90 ≈ 7.1/8.5/12.7 | distance-proportional base cost — holds; spread widens via §5 |
| Fuel-weighted Dijkstra | `pathfinding.ts:43` (adjacency), Dijkstra `:109-111`, reachability `:182-187` | directional, fuel-weighted, pure | reusable as the route engine (congestion multiplier is an added edge-weight input — new) |
| `hopDuration` | `travel.ts:14-18` | `max(1, ceil(fuelCost/2))` scaled by speed | time-from-distance rule; freight speed is a new parameter |
| Work budget & billing | `systemLogisticsGeneration` + matcher cost (`directed-logistics.ts` engine; ledger at processor `:142-155`) | per-cycle capacity ceiling, `quantity × route cost` | same formula, real route cost |
| Deficit/surplus classification | `lib/engine/directed-logistics.ts:35-43` | demand-denominated warehousing bands | sink test gains inbound term (new input, same producer) |
| Construction queue/pool | `world.constructionProjects` + funding (player-seat + purse specs) | build levels + colony_establish, origin-tagged | one new project kind slots in |
| Per-lane load/binding signal | **new — emitted by the logistics processor per run**, persisted on the lane row | — | read by planner + surfaces only, never by the tick's other processors |
| Pending-arrivals ledger | **new — written at dispatch by the logistics processor, drained by arrival application** | — | serialisable array; conservation-counted |

### 6. Aggregates that move for other reasons

| Metric | Read at cohort | What else moves it |
|---|---|---|
| Top-decile flow share | intra-faction trafficked edges, per projection, per seed | developed-system count (drifts down as galaxy matures — measured 0.317→0.296), faction count/size mix; read per-faction beside the aggregate |
| Deficit spell median | completed equilibrium-window spells | chronic/no-donor tail vs transient mix; abandonment ends spells; read with single-run share + p90, never alone |
| Logistics share of tick wall-clock | equilibrium boundary ticks | every other processor's cost (events strip moved it); quote absolute ms beside the share |
| Funding-bound count | per-faction ledger | real route costs raise spend against an unchanged budget — a rise here is the budget binding, not a logistics fault |

---

## Falsifiers (provenance)

Premise 1's decision rule, committed at `fd266fde` (reframed as a diagnostic decision rule at
`89e83fe8` — owner-directed), moved here unedited:

> - **If the top 10% of trafficked intra-faction edges carry ≥ 40% of edge-crossing haul volume**, the
>   current topology already concentrates flow — lane mechanics land on the map as generated, and the
>   map-gen rework (clustered/uneven star distribution) can follow as its own pass.
> - **If below**, the map is too uniform for chokepoints — the map-generation rework (clusters,
>   corridors, voids) becomes a co-requisite of this pass, so geography supplies the structure the
>   even spread lacks. The lane mechanics are unchanged either way.

Measured 0.296–0.328 → the second arm fired; this spec is the two-part pass it prescribes.

Premises 2–5, committed at `0e8cfe7a` before instrumenting, moved here unedited:

> - **Premise 2 (routing workload).** The raw counts (per-run transfers, distinct donor→deficit
>   pairs, route-cost evaluations, and the logistics processor's wall-clock share) are *descriptive,
>   no kill-line*. The one kill-line: **if measured per-run distinct haul sources × a measured
>   single-source BFS over the largest faction's open-edge subgraph projects to more than the
>   current directed-logistics run's own wall-clock** (real pathfinding would at least double the
>   processor), the workload premise is falsified and the route dictionary is promoted from
>   engineering hypothesis to spec requirement.
> - **Premise 3 (correction already slow).** Measured as consecutive-logistics-run deficit spells per
>   (system, survival good) using `classifyMarketState` where the matcher reads it: **if the median
>   spell is a single run (deficit cleared by the next run, i.e. correction ≤ one
>   `LOGISTICS_INTERVAL` = 24 ticks) at both the 10K and 16K horizons**, the premise is falsified —
>   scheduled-transit latency is then a real addition to correction time, and the oscillation
>   hazard gets first-class treatment in the spec instead of a "small against today" waiver.
> - **Premise 4 (edge cost varies).** **If intra-faction edge `fuelCost` p90/p10 < 2 on both seeds at
>   equilibrium**, falsified — existing edge costs cannot differentiate lanes, and all lane
>   differentiation must come from invested infrastructure plus map-gen geography.
> - **Premise 5 (long chains exist).** **If under 5% of edge-crossing haul volume in the equilibrium
>   flow window departs a donor that itself received the same good within the window** (re-export
>   stitching), relays are rare and the premise is falsified — routing beyond `MAX_HOPS` serves
>   demand that does not yet exist and the spec must not lean on it. The premise-1 hop-histogram
>   cliff at `MAX_HOPS` shows the cap *binds*; it does not show relaying, so it cannot confirm this
>   premise on its own.

Outcomes: P2 confirmed (kill-line clear by >5×, worst ratio 0.19); P3, P4, P5 falsified — their
committed consequences are §3's first-class inbound-aware rule, §5's acceptance measures, and the
"new capability, not formalisation" framing respectively.
