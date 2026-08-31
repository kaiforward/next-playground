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
