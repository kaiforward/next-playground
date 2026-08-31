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
change. Also not in this pass: the **player map-drawing tool** (a future second author of the same
density grid §5 defines) and any **open-space travel mechanic** (a future tech may add a
deep-space crossing lane class; free positional travel through voids is not designed).

---

## Behaviour

### 1. The lane object

Every jump lane — today a pair of directed `WorldConnection` rows (`lib/world/types.ts:443-446`)
that nothing persists state on — gains one persistent, undirected lane record: **new world
collection** `world.lanes`, a JSON-serialisable array (no Map/Set — save rule), one row per
undirected system pair, carrying the invested **lane level** (float, ≥ 0), its rolling **per-run
booked load**, and its **capacity-blocked volume** (§2) — the last two written by the logistics
processor per run; booked + blocked is the "attempted load" figure decay reads (decay bullet
below).

- **Level 0 is the minimum transit allowance** (owner decision): every generated lane is
  traversable at a small baseline capacity with no investment. There is no impassable lane except
  a severed one (a war-era state this spec only reserves; nothing in this pass severs).
- **Capacity** rises with level: `capacity(level) = BASE_LANE_CAPACITY × (1 + level)` — proposal;
  linear first cut, one new constant pair (new — `lib/constants/lanes.ts`), calibrated so an
  unupgraded lane comfortably carries a young colony's resupply and a mature corridor cannot run
  on baseline alone. Capacity is denominated as **volume per reference cycle** and scaled by
  `catchUpFactor(LOGISTICS_INTERVAL)` at the booking site — exactly as the haul budget already is
  (`lib/tick/processors/directed-logistics.ts:52,90`) — so congestion readings are
  interval-invariant. **Booked load is a per-run quota that resets each logistics run**; the
  in-flight volume §7 displays is a separate quantity read from the arrivals ledger, not the
  congestion input.
- **Investability:** a faction may invest in a lane exactly when it controls both endpoint systems
  (`factionId` + `control` at `lib/world/types.ts:104-106`, `control ≥ controlled`). A lane with an
  unclaimed endpoint is **deliberately pinned at baseline capacity** — that pressure is what makes
  corridor systems worth claiming. Spec review showed the claiming machinery cannot reach this as
  shipped — claims are autonomic-only (no player verb exists), scored on substrate × proximity with
  a floor excluding zero-substrate systems (`scoreClaimCandidate` /
  `proposeFactionClaims`, `lib/engine/expansion.ts:64-92`; `MIN_CLAIM_SCORE`,
  `lib/constants/expansion.ts:23-28`) — so claiming changes in two owner-decided ways
  (2026-08-31: "let's add a really simple mechanic for now that allows players to claim, only 1
  per X cycles… Dead systems are still useful real estate factions want to control as much as
  possible… most AI factions only claim territory next to existing territory and choose the best
  option amongst those so factions largely stay as one unit"):
  - **Player claim verb** (new — §4): claim any unclaimed system adjacent (one lane) to owned
    territory, free, rate-limited to one claim per `PLAYER_CLAIM_COOLDOWN` cycles (new constant,
    proposal). Reaching a mid-void corridor system means claiming the chain toward it over several
    cycles — extending a corridor is a deliberate, paced act.
  - **AI claiming stays substrate-ranked but turns adjacency-bounded and floor-softened**:
    candidates are systems adjacent to owned territory (replacing the 3-jump reach), ranked by the
    existing score, and `MIN_CLAIM_SCORE` stops excluding zero-substrate systems — a barren
    adjacent system is claimable, just last in line — so factions absorb dead systems as they
    grow while staying one contiguous unit. (Dead-system claims also bank future value: later
    tech is expected to unlock uses on those system types — flavour rationale, nothing specced.)
  "Waystation development" stays a possible later extension.
- **Build and upkeep ride the existing purse:** a lane upgrade is a construction project in the
  committed queue (`world.constructionProjects`, same `origin: "auto" | "player"` tagging —
  `docs/active/gameplay/player-seat.md`), funded by the construction band. Upkeep: lane levels
  **cannot ride `maintenanceBill`** — it is keyed by building type and priced by
  `workCostPerLevel(buildingType)` (`lib/engine/treasury.ts:104-118`) and a lane has neither — so
  lane upkeep is its own term with its own per-level rate, summed into `bills.maintenance` beside
  the building bill. That coupling is **deliberate and named**: `funded.maintenance` is a
  faction-wide ratio driving `maintenanceOutputMalus` and `maintenanceBufferScale` on every world
  (`lib/engine/treasury.ts:186-197`), and maintenance settles first on the ladder
  (`lib/engine/treasury.ts:120,132-141`), so lane upkeep competes with — and can crowd out — the
  logistics band that funds hauling; §8 gates on the funded-ratio distributions.
- **Lane decay** follows the building mechanism's real shape, not a bare rate — spec review showed
  the dead band IS the stability mechanism (congestion keeps realised load below capacity, so a
  continuous decay-toward-load would ratchet every upgrade back to baseline): a lane level decays
  only after a sustained idle buffer (the lane analogue of `idleBufferCycles`), only when a whole
  level's capacity goes unused, with the counter reset by any run that uses it (mirroring
  `idleLevels` + hysteresis, `lib/engine/infrastructure-decay.ts:95-96,130-137`) — and "used" is
  **attempted** load (booked plus congestion-diverted volume), so congestion pricing cannot itself
  drive decay. Owner watch-item stands: "we'll see how it plays out in practice, building decay
  was quite complex and difficult to manage" — no unrest-teardown term, nothing beyond the dead
  band. Money stays fuel, not capacity.
- The autonomic planner proposes lane upgrades symmetrically for every faction (§4).

### 2. Routing

Every haul travels a real cheapest path over open lanes, computed per logistics run.

- **Route cost** of a path is the sum of its edges' `fuelCost` (`lib/world/types.ts:445`) —
  the distance-derived quantity generation already authors
  (`laneFuelCost`, `lib/engine/universe-gen.ts:421-428`: normalised distance × lane-class
  multiplier) — times a **congestion multiplier** per edge, **bounded above by a stated constant**
  (`CONGESTION_MAX`, proposal ~3×; exact curve is a build-plan/calibration choice). An edge whose
  booked load reaches capacity is **excluded from the route graph for the rest of the run** (route
  cost null), never priced unboundedly — so an unroutable haul returns no path instead of an
  unaffordable one. The engine grows from the existing fuel-weighted Dijkstra
  (`lib/engine/pathfinding.ts:43` `buildFuelAdjacency`, Dijkstra loop at `:109-111` — noting its
  real shape: a linear-scan queue documented "fine for small graphs", module-private, no per-edge
  output), today serving ship navigation only — one path engine for every mover, per the
  shared-substrate decision. The matcher's interface changes with it: the pure
  `RouteCost` `(from, to) → number | null` (`lib/engine/directed-logistics.ts:220-221`), priced
  and sorted before any quantity exists (`:332-344`), becomes a stateful
  `routeAndBook(from, to, quantity) → { perUnit, edges } | null` consulted inside the fill loop;
  `PlannedTransfer` carries `edges` so the arrivals ledger and the interdiction query have a path
  to record. Within one deficit's donor fan-out, prices are frozen at the moment the severity
  queue reaches that deficit (candidate order stays the pre-booking order — re-sorting per draw is
  a build-plan cost question, not a behaviour promise); across deficits, prices reflect prior
  bookings.
- **`DIRECTED_LOGISTICS.MAX_HOPS` is deleted** (owner decision) — deleted, not merely unused.
  Reach is bounded by cost: the existing population-funded work budget already prices a haul at
  `quantity × route cost` (`lib/constants/directed-logistics.ts:94-98`), so distant hauls are
  expensive rather than forbidden — and the budget binds **gradually**, which the shipped matcher
  does not do: today one unaffordable draw zeroes the faction's whole run budget
  (`budget = 0; break`, `lib/engine/directed-logistics.ts:375-379`), and with route costs rescaled
  ~8.5× (fuel p50 8.5 vs `HOP_WEIGHT` 1.0) that cliff becomes routinely reachable and would flip
  `logisticsFundingBound` — a gameplay gate read by the build planner
  (`lib/engine/directed-build.ts:445`), idle decay (`lib/engine/infrastructure-decay.ts:63,119`)
  and `canSell` (`lib/engine/industry.ts:418`) — across whole factions. This pass therefore (a)
  replaces the run-terminating clamp with a **per-deficit skip** (an unaffordable draw ends that
  deficit's fill; the remaining budget stays available to cheaper deficits behind it), and (b)
  **re-denominates `GENERATION_PER_POP`** against the new route-cost scale so aggregate spend
  keeps today's small fraction of budget — its own docstring requires funding-bound outcomes stay
  "rare, deliberate signals" (`lib/constants/directed-logistics.ts:8-16`). Candidate donors need
  no hop radius once the cap is gone: donors are same-faction systems holding drawable surplus, a
  set bounded by faction size. Deletion cleanup, stated: `COLONY_REACH_HOPS`
  (`lib/services/colony-eligibility.ts:30`) restates its `Math.max` over the two surviving radii —
  unchanged at 4 only because `DIRECTED_BUILD.MAX_HOPS` carries the same value, a coincidence that
  stops being load-bearing — and two invariant tests are re-authored
  (`band-constants.test.ts:608-613`, `tick-logistics-reach.test.ts:73-80`). Untouched readers:
  `DIRECTED_BUILD.MAX_HOPS` (`lib/world/tick.ts:1667`), `EXPANSION.REACH_JUMPS`
  (`lib/constants/expansion.ts:20` — though AI claiming's reach changes separately, §1), and the
  market panel's own local cap (`components/market/market-comparison-panel.tsx:17`).
- **Traversable space:** a route may cross the hauling faction's own systems and **unclaimed**
  systems. Foreign systems are closed to routing this pass (the transit-rights slot). This
  *narrows* today's behaviour — the current hop BFS is faction-blind
  (`lib/world/tick.ts:1605-1614`, over all connections). **How much the narrowing strands is
  unmeasured**: the premise-1 projection ran only on the same-faction graph, and its 3.6–8.6%
  unreachable residual is licensed as instrument noise from abandonment, not a stranding
  estimate — no faction-blind baseline was ever produced. Resolved by the §8 calibration A/B
  (own+unclaimed vs faction-blind arm; unserved shortfall and cross-faction-dependent haul
  volume, cohorted, both horizons).
- **Capacity billing:** each haul books its quantity onto every edge it crosses for that run.
  **Booked load is pooled per lane across all factions** — a lane is one physical corridor; all
  factions match in the same boundary tick (`cycleStartShard`, `lib/tick/shard.ts:81-84`), in a
  fixed, stated order (faction id ascending — deterministic, named so the first-mover advantage
  on contested unclaimed corridors is a known quantity and a §8 calibration read). When an edge is
  fully booked, later hauls (the matcher is already severity-ordered, worst-first —
  `docs/active/gameplay/economy-autonomic-agency.md`) route around it at higher cost or, if no
  affordable path remains, go unserved. A haul that exceeds the remaining capacity on its cheapest
  path ships up to that capacity on it and re-routes the remainder over the next-cheapest path,
  repeating until placed or no affordable path remains. **Capacity-blocked volume is its own
  signal, never folded into `unservedShortfall`** — that field is authored as a donor-stock
  capacity measure (`UnservableDeficit`, `lib/engine/directed-logistics.ts:180-212`, sole emission
  `:402-408`) and rendered to the player as such (`lib/services/alerts.ts:437-461`); folding lane
  congestion in would tell the player and the build planner to build production where the answer
  is a lane. Emission rule: when a haul's cheapest path is unavailable or partially unusable
  because an edge is at capacity, the processor records the affected quantity as blocked volume on
  **the first saturated edge of that cheapest path**, whether the haul then detours or goes
  unserved — a per-lane accumulator persisted on the lane row, read by the §4 planner and the map
  surfaces only. Observable: a saturated corridor shows full lanes, longer detours, and rising
  blocked volume on the choke edge.
- **Route cost stays the work-budget price**: the same summed edge cost bills the faction's
  logistics work (`workPerformedByFaction`, `lib/tick/processors/directed-logistics.ts:142-155`),
  replacing the hop-count price at `lib/world/tick.ts:1625-1628`. (Note: the docstring at
  `lib/constants/directed-logistics.ts:96-98` already *claims* fuel enters route cost; the code
  never did. This spec makes the docstring true and retires `HOP_WEIGHT`/`FUEL_WEIGHT` in favour
  of the edge-summed cost.)

### 3. Scheduled transit

Transit is scheduled, never positionally simulated (owner decision).

- **Dispatch** computes an arrival tick from the whole path at once:
  `arrival = now + max(0, round(Σ path fuelCost / FREIGHT_SPEED))` (`FREIGHT_SPEED` new constant,
  proposal) — deliberately **not** a sum of per-hop `hopDuration` calls, because that primitive
  floors every hop at one tick at any speed (`max(1, …)` twice, `lib/engine/travel.ts:18,24`),
  which would make time hop-proportional rather than distance-proportional and put the
  instant-delivery fallback permanently out of reach. Tuning target: a typical intra-cluster haul
  arrives within ~a quarter of a logistics interval; a trans-void haul takes one to a few
  intervals. Ships keep `hopDuration` unchanged; unifying the two onto one rule is the ship
  system's decision when it gets a player surface, not this pass's.
- **The pending-arrivals ledger** — new world collection, serialisable array of
  `(arrivalTick, systemId, goodId, quantity, routeEdges)` — is written at dispatch; donor stock is
  debited at dispatch (goods in flight belong to nobody's warehouse). **Arrival application is its
  own unconditional per-tick stage** at the head of the run order, modelled on ship-arrivals
  (`lib/world/tick.ts:1323-1330`) — NOT a phase of the directed-logistics processor, which
  structurally cannot run off its boundary tick (`cycleStartShard` returns an empty window,
  `lib/tick/shard.ts:81-84`; block gate `lib/world/tick.ts:1567`); without a per-tick stage every
  arrival would quantise up to the next logistics boundary and the zero-latency fallback would
  deliver a cycle late. The stage drains due rows **before** anything classifies that tick, so a
  shipment is counted exactly once — scheduled inbound while in flight, stock from its arrival
  tick, never neither. **Overflow is returned, never destroyed**: a haul is sized at dispatch
  against `maxStock − stock − scheduled inbound` at the destination, and at arrival the credit
  applies up to the band cap (`marketBandForRow(...).maxStock` — the clamp that today lives at the
  transfer site, `lib/tick/processors/directed-logistics.ts:177-181`; the economy's own clamp
  `lib/engine/supply-chain.ts:158` silently discards, which is exactly what must never happen to
  in-flight goods) with any remainder staying in the ledger as a return leg toward the donor —
  an explicitly-accounted balance the §8 identity counts. The **flow row is emitted at arrival**
  with the actually-credited quantity, so the flow log stays a record of delivered goods
  (consumers: the system panel window-sums, the sparkline, the overlay, the harness's whole-run
  capture); dispatch writes only the ledger. Market rows survive abandonment with their stock
  (`docs/active/gameplay/colonisation.md`), so a delivery to a world that died in transit simply
  lands in the ghost market.
- **Deficit classification counts inbound.** The sink test reads
  `stock + scheduled inbound for that good` where it reads stock today
  (`classifyMarketState`, `lib/engine/directed-logistics.ts:35-43`, fed at
  `lib/tick/processors/directed-logistics.ts:54`); the donor test keeps physical stock only. This
  is the oscillation guard the premise-3 falsification demands: a system whose goods are en route
  does not re-order. **This rule is first-class, not optional** — the evidence says typical
  correction is currently faster than one interval, so uncompensated latency would create
  overshoot where none exists today. The inbound term is added **at the matcher's feed site
  only**: `classifyMarketState` itself has two further readers — the harness's demand-hunting
  sample (`lib/tick-harness/market-analysis.ts:351`) and the inlined threshold in
  `computeCoverLevels` — which deliberately keep PHYSICAL stock (§8: a world still lacking goods
  is still in deficit for welfare, and the spell metric must stay comparable to its premise-3
  baseline).
- **Latency is one tunable.** A high enough `FREIGHT_SPEED` drives every arrival time to zero —
  same-tick delivery through the same ledger and stage, with routing, capacity billing and
  blocking fully retained (reachable precisely because the formula above has no per-hop floor) —
  the owner's named fallback, architecturally free because the killed "bandwidth-only" alternative
  is a strict subset of this design. The sim decides (§8) whether nonzero latency ships enabled.
- **The interdiction query** (war's future verb): a read-only function answering "which scheduled
  flows cross edge E in window [t₁,t₂]" from the ledger's route field. New — emitted by the lane
  substrate; consumed by nothing in this pass.

### 4. Investment agency — player and planner, symmetrically

- **Player:** an invest/upgrade verb on any lane whose two endpoints the player controls, from the
  lane's map surface (§7). Orders enter `world.constructionProjects` tagged `origin: "player"`,
  ride the existing queue priority (`orderOpenProjects` — `docs/active/gameplay/player-seat.md`)
  and are cancellable like any player build. A lane project carries its undirected lane key (two
  endpoints), not a single `systemId` — per-system queue folds that assume one
  (`queuedBuildLevelsBySystem`, `lib/engine/directed-build.ts:325-334`) treat lane projects as
  their own kind. **A lane project is dropped when either endpoint stops satisfying §1's
  investability rule**, extending `dropAbandonedBuildProjects` past its `kind: "build"` filter
  (`lib/world/tick.ts:1028-1034` — the function exists exactly to stop the pool funding work into
  territory the faction lost). The player additionally gets the **claim verb** (§1): claim an
  adjacent unclaimed system, free, one per `PLAYER_CLAIM_COOLDOWN` cycles. **Lane automation is
  its own domain**: a third per-domain switch (`world.player.automation.lanes`, default on,
  alongside `build` and `colonisation`) gating lane-upgrade proposal generation for the player's
  faction only — owner decision: "I do think it should be its own kind of automation, we will want
  many features to be independently toggleable." (Implementation note: the automation toggle
  mutation rebuilds the object from scratch today, `lib/services/construction-orders.ts:230-232`
  — it must spread the existing object so a later-added domain cannot be dropped by a toggle of
  another; the field's five sites: `lib/world/types.ts:49`, `lib/types/api.ts:368`,
  `lib/schemas/construction-orders.ts:12`, `lib/world/gen.ts:226`, the mutation.)
- **Autonomic planner:** a new opportunity type on the planner's existing ROI ordering
  (`docs/active/gameplay/economy-autonomic-agency.md`): where the past window's routing shows an
  edge congestion-binding, the planner proposes a lane upgrade scored by the blocked volume it
  unblocks (§2's per-lane accumulator — the signal is **new, emitted by the logistics processor
  per run**: per-lane booked load and capacity-blocked volume, persisted on the lane row; no
  processor reads it back except directed build's planner and the alert/map read surfaces) —
  competing for the same construction pool as housing, industry and colonies. Two anti-thrash
  gates the planner's existing opportunity types already carry, adopted verbatim: the opportunity
  scores against **effective level** (built plus levels already queued in open projects for that
  lane, following `queuedBuildLevelsBySystem`, `lib/engine/directed-build.ts:325-356`), and a lane
  with an open upgrade project generates **no further proposal** (following the colony in-flight
  gate, `lib/engine/directed-build.ts:1570-1574`) — otherwise the congestion signal re-proposes
  the same edge every cycle until the first upgrade lands, then overshoots into §1's decay. AI
  claiming changes per §1: candidates adjacent to owned territory, best-scoring first, floor
  softened to admit barren systems.

### 5. Galaxy geography (the map-generation co-requisite)

Today's placement is uniform by construction: Bridson Poisson-disk sampling with a hard minimum
distance and a [d, 2d] candidate annulus (`bridsonSample`, `lib/engine/universe-gen.ts:219-305`)
— which is exactly why premise 1 read flat (flow spreads over an even mesh) and premise 4 read
flat (`fuelCost` is normalised distance, and Poisson distances cluster near the minimum —
`lib/engine/universe-gen.ts:421-428,493-505`). The rework replaces the uniform field with authored
variance; the lane graph machinery on top (per-region MST + extra edges + gateway crossings,
`lib/engine/universe-gen.ts:475-605`) is retained and retuned, not redesigned.

**How the map is authored** (owner-settled 2026-08-31: "that mental model works for now for
sure"). The principle: noise never authors the map — placed, countable objects do; noise roughens
their edges.

- **The density grid is the single authoring interface**: a coarse grid over the map (proposal
  128×128), each cell 0–1 star-friendliness — new, produced by generation ahead of placement and
  consumed only by placement. Everything that shapes the galaxy writes this grid, which is what
  keeps the future player **drawing tool** a pure second author ("if we can plug a drawing tool
  into the grid later using the same system then Im happy to focus on generation first" — not in
  this pass).
- **Cluster seeds author the structure**: K seeds (K derived from system count, as region count is
  today) placed by the existing spaced-center machinery (`generateRegions`,
  `lib/engine/universe-gen.ts:161`), each rolling a size from a deliberately skewed distribution
  (a few big, many small) and an ellipse stretch/orientation. Cell density = the strongest nearby
  seed's influence under distance falloff — islands of density, emptiness as the complement, so
  void count and size are explicit knobs (seed spacing minus seed sizes), never accidents.
- **Two noise layers decorate**: one large-scale layer warps cluster edges and occasionally merges
  neighbours into continents-with-peninsulas; one small-scale layer adds local texture; cells
  below a floor become true void. Seeded RNG throughout (`mulberry32`,
  `lib/engine/universe-gen.ts:86`) — grid + seed → identical galaxy.
- **Corridors are chosen at the structure level, not emergent**: the neighbour graph over cluster
  seeds (the same MST shape that connects regions today, `lib/engine/universe-gen.ts:543-547`)
  picks which cluster pairs connect; each connection is realised as either a thin raised-density
  band (a sparse chain of waypoint stars) or a single long **crossing lane** — the mix is an open
  taste question resolved by generating candidates and looking (below), not by argument.
- **Placement**: the existing sampler (`bridsonSample`, `lib/engine/universe-gen.ts:219-305`) runs
  with its minimum distance varying by local cell density — tight in clusters, sparse on
  corridors, nothing in voids. Lanes inside a cluster build as today (per-cluster MST + extra
  edges); between clusters, only along the chosen corridors.

**Regions and gateways are reworked, not preserved** (owner: "the old regions + joining region
lanes doesnt really make sense in this system"): **region becomes cluster** — regions are the
Voronoi partition over cluster seeds, so region names and boundaries follow real geography — and
**gateway becomes corridor endpoint**: the old cross-region gateway-pair phase
(`lib/engine/universe-gen.ts:549-604`) is replaced by corridor realisation, with the persisted
`isGateway` flag (`lib/world/types.ts:107`) kept, now marking corridor-endpoint systems (its
readers are cosmetic throughout: map styling, two panel badges at
`components/panels/system-panel.tsx:128` / `components/panels/faction-territory.tsx:39`, and a
gateways-first territory sort at `lib/services/factions.ts:246` — none break under the new
meaning; badge copy joins the /game-copy pass).

**Empty space is represented as absence, not as a rule**: a void is simply where no systems and no
lanes are — "you cannot cross" means no lane exists, no new movement mechanic. All land stays
joined via corridors (owner: "if we dont allow travel at all across the empty bits then we need
all the land to be joined together somehow"). This deliberately keeps the future open on the
cheap: a later tech can add a slow, expensive **deep-space crossing lane class** across a void
(the lane-class cost multiplier already exists — `laneFuelCost`'s `multiplier`,
`lib/engine/universe-gen.ts:421-428`), which the owner flagged as the likelier shape ("maybe some
kind of special travel lanes that cross empty space might make sense"); free ocean-style
positional travel would be a new movement system and is not designed here.

**The generation preview**: the New Game screen gains a knob-preview surface — the structure knobs
(cluster count, size skew, spacing, void floor, corridors per cluster) plus seed, rendering a fast
impression of the candidate galaxy (density field + star dots) and regenerating on change (owner:
"It would be really cool if we could make an interface to basically tweak those knobs and see an
impression of the generated map before you play"). It doubles as the dev instrument for choosing
the shipped defaults, and its canvas is the surface the future drawing tool paints onto.
UI-prototype-first rule applies (browser-viewable prototype approved before implementation).

Observable outcomes, stated as acceptance measures:

- **Clusters, crossings and voids.** System density varies across the map: dense clusters whose
  internal lanes are short and cheap; long sparse crossings between them; and true voids —
  ocean-like empty spans that no lane crosses, so traffic must go around.
- **Distance variance becomes cost variance:** intra-faction lane `fuelCost` p90/p10 ≥ 2 on the
  generated map (the premise-4 line, promoted from falsified premise to generation acceptance) —
  measured over the premise-4 cohort (undirected same-faction edges) **and over the
  trafficked-edge sub-cohort** (edges carrying nonzero projected flow in the equilibrium window).
  The second is the one routing decisions actually read: the all-edges aggregate is gameable by
  long untrafficked fringe edges the rework itself adds, which raise p90 while differentiating no
  corridor anyone uses.
- **Geography concentrates flow:** candidate generators are scored with a **corrected** projection
  instrument matching the shipped routing rule — adjacency over own-plus-unclaimed systems and
  fuel-weighted shortest paths (reusing `buildFuelAdjacency` + the Dijkstra,
  `lib/engine/pathfinding.ts:43,109-111`) — not the premise-1 instrument as-is, whose
  same-faction-only, hop-BFS projection (`temp/lane-flow-diag.ts:24-72`) diverges from the shipped
  router exactly as distance variance grows. **The ≥ 0.40 line is re-derived on the corrected
  instrument before it gates anything** (its committed value was calibrated on the old
  projection); acceptance is read at the equilibrium horizon *before* lane capacity mechanics are
  enabled, so geography and lanes verify independently. The shipped, congestion-aware share is
  expected to read below the lanes-off projection (rerouting de-concentrates by design) and is
  reported but not gated.
- **Migration crosses the new geography too:** diffusion is attenuated by
  `1/(1 + distanceDecay × fuelCost)` (`lib/engine/migration.ts:117`; `distanceDecay` 0.1,
  `lib/constants/population.ts:159`) — calibrated against today's narrow spread, so long
  crossings would cut migrant inflow several-fold to exactly the colonies geography makes
  expensive to supply. §5 acceptance therefore includes cross-crossing migrant flow and colony
  population trajectory, cohorted by cluster-interior vs beyond-a-crossing, at both horizons; and
  `distanceDecay` is re-calibrated against the generated distribution rather than inherited.
- **Relations read the lane graph:** border friction counts cross-faction connection rows,
  uncapped (`getBorderLengthsBetween`, `lib/tick/adapters/memory/relations.ts:146-157`;
  `perBorderFriction` −0.02 per row vs baseline bias −0.05, `lib/constants/relations.ts:23-25`) —
  re-authoring the lane graph moves every bordering pair's drift and the border_conflict spawn
  rate with it. §5 acceptance includes the cross-faction lane count, and the sim reports the
  relations-score distribution and border_conflict count on the generated map at both horizons.
- **Untouched:** habitability scoring, deposit authoring, the settleable fraction, homeworld
  prefab stamping (`stampHomeworldPrefabs`, `lib/engine/universe-gen.ts:617`), and homeworld
  spacing guarantees. New-game system-count scaling continues to derive extent and cluster count
  continuously (`docs/SPEC.md` Universe & Map).
- **Sequencing (owner decision):** the map-generation sub-project builds and ships **first**, with
  the lane mechanics following — every lane constant is calibrated against the generated fuel
  distribution, the acceptance measures are lanes-off by design, and the falsified premise 1 says
  lanes on the flat map would not bite. The open taste questions (corridor style mix; how hard the
  size skew goes) are resolved during that sub-project by generating candidates and looking, using
  the preview surface and the acceptance instruments.
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
the traversal mechanics. **Traversability is a per-client policy, not a substrate constant**: goods
route over own + unclaimed (§2), while migration today crosses only same-faction edges with both
endpoints developed (`lib/tick/world/trade-flow-topology.ts:41-42`, filtered at
`lib/world/tick.ts:1581-1583`) — the open-edge predicate is a parameter of the cheapest-path
query, which is exactly what makes the future migration rehost a client swap rather than a
substrate change.

### 7. Surfaces

- **Map:** the logistics overlay stops drawing a direct chord per donor→sink pair — today's
  overlay does no route inference at all: `getTradeFlowEdges` (`lib/services/trade-flow.ts:24-53`)
  feeds `buildFlowEdges` (`lib/engine/trade-flow-edges.ts:32`), which groups flow rows by endpoint
  pair and emits one straight edge each — and instead draws real lanes with
  real state: level (visual weight), booked load vs capacity (colour), and in-flight volume (from
  the arrivals ledger). The per-good payload the chords carried (`dominantGoodId`, `perGood`)
  moves to the lane card, joined back from the ledger's `routeEdges`. The
  player sees exactly where every investment sits — the stated advantage over EU5's invisible
  roads. A lane is selectable; its card shows level, capacity, current load, upkeep, and the
  invest verb (enabled only under the endpoint-control rule, disabled state naming the missing
  endpoint).
- **System Logistics tab:** gains inbound/outbound in-transit rows with arrival ETAs (durations
  through the calendar's one auto-scaling rule — `docs/SPEC.md` The Calendar).
- **Copy:** new player-facing terms (lane, lane level, capacity, in transit, congested) go through
  the `/game-copy` glossary pass; "lane" must reconcile with the existing map-label vocabulary.
- **Alert bar:** no new category this pass (congestion surfaces on the map via the blocked-volume
  signal; `unservedShortfall` and its "Demand unservable" category keep their donor-capacity
  meaning untouched); revisit after play. One existing category is a **required fix, not a
  follow-up**: "Survival stock falling" reads `WorldMarket.stockChange`, whose one-tick capture
  window only sees hauls because logistics lands on the same tick it samples — an accepted cadence
  coincidence documented in the code itself (`lib/world/tick.ts:1881-1890`). Scheduled arrivals
  land on arbitrary ticks and would vanish from the reported change, sending the alert permanent
  on every net importer (`lib/services/alerts.ts:420-421`). `stockChange` becomes a cross-tick
  accumulator over the cycle (the solution the code comment itself names), and the sim quotes the
  category's instance count before and after at both horizons.

### 8. Calibration & verification

- New sim metrics: per-lane utilisation distribution, top-decile flow share (now first-class),
  in-transit volume, the deficit spell-length distribution (the premise-3 instrument's shape, kept
  as a standing metric — **measured on PHYSICAL stock**, not the inbound-aware figure, so it stays
  comparable to its premise-3 baseline and reads welfare rather than ordering state), the
  per-faction funding-bound market count and post-clamp skipped-deficit count (the C3 gates: a
  material rise against the pre-change baseline blocks — `GENERATION_PER_POP` is retuned instead),
  per-faction unserved shortfall attributable to shared-corridor contention (the match-order
  first-mover read), queued lane levels against realised load (the overshoot-then-decay watch),
  and the §2 traversability A/B (own+unclaimed vs faction-blind arm).
- **Wall-clock gate:** the logistics processor's run median and share of total tick time are read
  at both horizons and both galaxy sizes against the measured baseline (9.0–13.3 ms / 7.2–8.6% of
  tick at 600 systems; 17.6 ms / 2.2% at 10,000 — equilibrium-window runs, all factions). The P2
  affordability evidence explicitly does not license the congestion regime (its Licenses line
  excludes capacity accounting and post-cap candidate growth), so this gate is the measurement
  that replaces it; a regression past ~3× the baseline share blocks merge (proposal).
- **Conservation:** a goods-mass identity **does not exist today** — the harness's four identities
  are all colonisation/treasury (`lib/tick-harness/conservation-analysis.ts`). This pass adds a
  fifth: Σ dispatch debits = Σ arrival credits + Σ in-flight ledger + Σ returned-overflow balance,
  over independently-recorded sides per that module's own rule, red-proofed by breaking the ledger
  drain; a failed identity blocks merge (AGENTS sim rule).
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
| `classifyMarketState` / `logisticsTarget` | THREE readers: the matcher (`lib/tick/processors/directed-logistics.ts:54` via `toGoodMarketStates`), the harness demand-hunting sample (`lib/tick-harness/market-analysis.ts:351`), and the inlined threshold in `computeCoverLevels` | sink test gains inbound-awareness at the matcher's feed site only; the harness readers keep physical stock (§3, §8) | Yes — separation stated per reader. |
| `logisticsFundingBound` | build planner (`lib/engine/directed-build.ts:445`), idle-decay exemption (`lib/engine/infrastructure-decay.ts:63,119`), `canSell` (`lib/engine/industry.ts:418`), UI (`lib/services/system-industry-readout.ts:91`) | route-cost rescale makes the budget cliff reachable — a gameplay gate, not telemetry | Guarded, not moved: §2's per-deficit skip + `GENERATION_PER_POP` re-denomination + the §8 funding-bound gate exist to keep this flag's meaning ("shortfall persists because of money, rarely") intact. |
| `bills.maintenance` / `funded.maintenance` | settlement ladder (`lib/engine/treasury.ts:120-141`), `maintenanceOutputMalus` + `maintenanceBufferScale` (`:186-197`, written per system at `lib/world/tick.ts:1311-1316`), treasury UI | lane upkeep joins the bill | **Deliberate coupling, named**: lane upkeep competes with production health and the logistics band; §8 gates on the funded-ratio distributions. |
| `maxStock` (market band cap) | delivery clamp (`lib/tick/processors/directed-logistics.ts:177-181`), economy clamp (`lib/engine/supply-chain.ts:158`), band pricing | the delivery clamp moves from transfer-time to a dispatch-sizing + arrival-cap pair | Yes — §3's overflow rule exists because the arrival-time clamp would otherwise destroy goods. |
| `unservedShortfall` | alert bar "Demand unservable" (`lib/services/alerts.ts:437-461`), planner reads, map surfaces | nothing — capacity-blocked volume is a NEW separate signal (§2) | Yes — deliberately NOT reused; its authored donor-capacity meaning is untouched. |
| `world.constructionProjects` | build planner, funding, UI (player-seat spec) | gains a lane-upgrade project kind | Yes — deliberately the same queue/pool (one ROI axis, owner decision). |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
|---|---|---|---|
| `fuelCost` (`laneFuelCost`, `universe-gen.ts:417-428`) | "Fuel cost of one lane, normalised against the average intra-region hop… `multiplier` prices a lane class above the intra-region baseline (gateways cost more)" | distance-derived per-edge cost/time base | Yes — distance-derived by authorship. Caveat carried: it is *classed* distance (gateway lanes ride a multiplier), which is intended — gateway crossings should cost more. |
| `hopDuration` (`travel.ts:14-18`) | ship travel ticks from fuel and speed | freight traversal time with a freight speed | Yes — same authored meaning (time from distance), new speed parameter. |
| `MAX_HOPS` (`directed-logistics.ts:94-95`) | "Max hops a logistics transfer may span (beyond this… unreachable)" | deleted | Read correctly; premise 1's hop-cliff shows it binding, premise 5 shows nothing routes around it. |
| `GENERATION_PER_POP` (`directed-logistics.ts:8-16`) | work-budget ceiling, "deliberately ample… deficits persist only for physical reasons" | unchanged; becomes the cost bound that replaces the hop cap | Yes — but flagged: with real (larger) route costs the budget may start to bind, which its docstring says must stay a deliberate signal. Calibration watches the funding-bound count. |
| `FLOW_HISTORY_TICKS` (`trade-simulation.ts:8`) | "flow history retention and route inference" window | unchanged retention; the overlay's chord-per-pair aggregation is replaced but the retention window and the overlay flow floor both survive (system panel, sparkline, harness all window-sum it) | Yes. |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | None today — post-#275 the relations trio neither reads topology nor targets lanes (`docs/active/gameplay/events.md`). The severed-lane state is reserved as the future event/war verb; nothing in this pass creates one. | — |
| Population + migration | Migration's mechanic is untouched but its INPUT is re-authored by §5: `1/(1 + 0.1 × fuelCost)` (`migration.ts:117`) cuts cross-crossing inflow several-fold under the new distance distribution — §5 carries a migration acceptance measure and `distanceDecay` is re-calibrated. Population feels lanes through delivery timing (inbound-aware classification prevents double-ordering; famine-gate unchanged). | — |
| Unrest / regime | Indirect only: slower/blocked corridors → provision dips → existing grievance path. No new unrest reader/writer. | — |
| Industry + staffing | Input-gated production feels arrival timing; no new coupling. Lane upgrades bill no labour beyond the construction pool they already compete in. | — |
| Infrastructure decay | Lane levels adopt building decay's REAL shape — whole-level idle threshold + idle buffer + reset-on-use (`lib/engine/infrastructure-decay.ts:95-96,130-137`), measured on attempted load (§1) — because the dead band is the stability mechanism; a bare decay-toward-load rate would ratchet every upgrade to baseline under congestion pricing. Building decay itself unchanged. | — |
| Directed logistics | The client being rebuilt: real routing, capacity billing, scheduled arrivals, inbound-aware classification (§2–3). | — |
| Directed build / planner | Gains the lane-upgrade opportunity type on the existing ROI ordering (§4); reads the new binding-edge signal. | — |
| Colonisation + founding manifest | Founding-manifest staging keeps its current (non-routed) draw this pass — rehost slot only. Colony ROI is *indirectly* moved: a colony behind a void is more expensive to supply once routing is real; accepted, watched in calibration. Claims gain a new motive (chokepoint estate) with zero mechanic change. | — |
| Treasury / purse | Lane builds fund from the construction band. Lane upkeep is a new TERM beside the building bill (`maintenanceBill` is buildingType-keyed and cannot carry it, `lib/engine/treasury.ts:104-118`), summed into `bills.maintenance` — deliberately coupling into `funded.maintenance`'s two faction-wide consumers and the ladder's crowd-out of the logistics band (§1, hazard-1 row). No fourth band. | — |
| Factions + relations | The relations MECHANIC is unchanged but its input is not: border friction counts cross-faction connection rows uncapped (`lib/tick/adapters/memory/relations.ts:146-157`), and §5 re-authors the lane graph — drift rates and border_conflict spawn rates move with it (§5 acceptance measure). Claiming changes (§1) also reshape borders. Foreign-transit rights are the named future hook. | — |
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
| Fuel-weighted Dijkstra | `pathfinding.ts:43` (adjacency), Dijkstra `:109-111`, reachability `:182-187` | directional, fuel-weighted, pure — but a linear-scan queue ("fine for small graphs", `:75-79`), module-private, and its exported results carry no per-edge cost list | grows into `routeAndBook` (§2); the §8 wall-clock gate is the check that this shape survives the congestion regime P2's licence excludes |
| `maintenanceBill` | `lib/engine/treasury.ts:104-118` | `(levelsByType: Map<buildingType, levels>, rate)` — priced by `workCostPerLevel(buildingType)`; lanes have no type and no system | lane upkeep is its own term summed into `bills.maintenance` beside this bill (§1), with its own UI line kind |
| Arrival drain stage | **new — an unconditional per-tick stage at the head of the run order**, modelled on ship-arrivals (`lib/world/tick.ts:1323-1330`) | — | drains before any classification that tick (§3) |
| Player claim verb + AI adjacency claiming | **new — §1/§4**; changes `proposeFactionClaims`' candidate set and `MIN_CLAIM_SCORE`'s exclusion (`lib/engine/expansion.ts:64-92`, `lib/constants/expansion.ts:21-28`) | — | rate-limited by `PLAYER_CLAIM_COOLDOWN` (new constant) |
| `hopDuration` | `travel.ts:14-18` | `max(1, ceil(fuelCost/2))` scaled by speed — floored at 1 tick per hop at ANY speed (`:18,24`) | NOT reused for freight (the floor blocks the zero-latency fallback and makes time hop-proportional); goods use the path-summed formula in §3, ships keep this unchanged |
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
| Funding-bound count | per-faction ledger | real route costs raise spend against an unchanged budget — a rise here is the budget binding, not a logistics fault; §2 re-denominates the budget and §8 gates on it |
| Intra-faction `fuelCost` p90/p10 | same-faction edges, split trafficked / untrafficked | fringe and void-spanning edge count — the rework adds long low-traffic edges that raise the aggregate without differentiating any used corridor (§5 reads both cohorts) |
| Top-decile flow share (map-gen gate) | corrected projection (own+unclaimed, fuel-weighted), per faction beside the aggregate | instrument-vs-router divergence (hop-BFS vs cost paths — corrected per §5); congestion rerouting de-concentrates the shipped reading below the lanes-off projection by design |

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
