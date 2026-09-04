# Logistics Lanes

> **Active.** Jump lanes are persistent objects the player and the autonomic planner invest in;
> every haul routes over a real cheapest path across them, bills the capacity it crosses, and takes
> scheduled transit time to arrive. Sits *on* [Directed Logistics & Autonomic
> Agency](./economy-autonomic-agency.md) (the matcher this substrate routes for) and the generated
> geography in [Universe & Map](./universe.md) (lane fuel costs, corridors, crossings). One shared
> routing substrate — ships and any future mover (migration, colonist delivery) can rehost onto it
> by swapping the traversability policy, never by touching the pathing or booking mechanics.

---

## Key mechanics (the headline)

A jump lane is no longer just a fuel-cost number on a connection — it is a persistent object with
an invested **level**, a **capacity** that rises with it, and a running record of how loaded it is.
Every haul the autonomic-agency matcher plans now travels a real cheapest route across these lanes,
booking capacity on every lane it crosses; a lane at capacity throttles or reroutes the next haul,
so busy corridors congest and an under-invested one bites. Transit is **scheduled, not
instantaneous** — dispatch computes an arrival tick from the whole route's distance, a pending-
arrivals ledger applies the delivery when it lands, and nothing in between is positionally
simulated. Nobody draws a route by hand: the player and the planner invest in lane capacity, and
routes fall out of the shared graph on their own.

---

## 1. The lane object

Every generated jump lane (`WorldLane`, one row per undirected system pair, `lib/world/types.ts`)
carries:

- **`level`** (float, ≥ 0) — the invested upgrade tier. Level 0 is the minimum transit allowance:
  every lane is traversable at a small baseline capacity with no investment at all. There is no
  impassable lane except a severed one — a war-era state this substrate only reserves a hook for
  (§3); nothing in the shipped game severs a lane.
- **`bookedLoad`** and **`blockedVolume`** — the running-total quota and the volume a saturated edge
  turned away, both written by the logistics processor and **reset every logistics run** (they read
  the *attempted load* of the run just finished, never a cumulative figure).
- **`idleCycles`** — the lane-decay countdown (below).

**Capacity** rises linearly with level (`laneCapacity`, `lib/engine/lanes.ts`):
`capacity(level) = BASE_LANE_CAPACITY × (1 + level)`, denominated as volume per reference cycle and
scaled by the run's catch-up factor at the booking site, exactly like the haul work budget — so a
congestion reading is invariant to how often the logistics cycle actually runs.

**Investability.** A faction may invest in a lane exactly when it controls both endpoint systems, at
`control` rank `controlled` or above (`laneInvestor`, `lib/engine/lanes.ts`). A lane with an
unclaimed endpoint is deliberately pinned at baseline capacity — that pressure is what makes
corridor systems worth claiming:

- **The player's claim verb** (`claimSystem`, `lib/services/claims.ts`) takes any unclaimed system
  adjacent to the player's own territory, free, rate-limited to one claim per
  `LANES.PLAYER_CLAIM_COOLDOWN` cycles. Reaching a system deep in a void corridor means claiming the
  chain toward it over several cycles — a deliberate, paced act. It surfaces on the system Overview
  as the Territory card for any unclaimed system bordering the player's own (`ClaimSection`,
  `components/construction/claim-section.tsx`), naming which of the player's systems it borders and
  the cooldown remaining.
- **AI claiming** is adjacency-bounded (candidates are systems one lane from owned territory,
  `EXPANSION.REACH_JUMPS = 1`) and floor-softened (`EXPANSION.SCORE_FLOOR` no longer excludes a
  zero-substrate candidate — it is simply claimable last), so factions absorb dead systems as they
  grow while staying one contiguous unit.

**Build and upkeep ride the existing purse.** A lane upgrade is a `kind: "lane_upgrade"` project
(`WorldLaneUpgradeProject`) in the shared `world.constructionProjects` queue, tagged
`origin: "auto" | "player"` like any build, funded work `= levels × UPGRADE_WORK_PER_LEVEL` from the
same per-faction construction pool. Upkeep is its own term — `laneUpkeepWork`
(`lib/engine/lanes.ts`), Σ each invested lane's `level × UPGRADE_WORK_PER_LEVEL` over the lanes a
faction is the investor of — summed into `bills.maintenance` beside the building bill (see [The
Purse](./player-seat-purse.md)); a lane with no investor (unclaimed or split endpoint) bills nobody,
though it still decays. Abandonment drops an open lane project the instant either endpoint stops
qualifying, refunding nothing, the same rule an ordinary build project follows.

**Lane decay** mirrors infrastructure decay's real shape rather than a bare rate
(`decayLanes`, `lib/engine/lanes.ts`): a lane accrues idle cycles only while a whole marginal level's
capacity sits unused, resets the counter the moment a run uses it, and at the idle buffer
(`LANES.IDLE_BUFFER_CYCLES`) sheds exactly one level and restarts. "Used" is **attempted** load —
booked plus congestion-diverted volume — so congestion pricing itself can never look like idleness
and ratchet an upgrade back down. A lane at level 0 has nothing to decay.

The autonomic planner proposes lane upgrades symmetrically for every faction (§4).

---

## 2. Routing

Every matched transfer routes over a real cheapest path, computed inside the logistics run itself.

- **Route cost** is the sum of each crossed lane's `fuelCost` — the distance-derived quantity
  generation already authors — times a **congestion multiplier**, linear in load and bounded above
  by `LANES.CONGESTION_MAX` (~3×) at load equal to capacity. A lane whose booked load *reaches*
  capacity is excluded from the route graph for the rest of the run (cost null, never priced past
  the bound), so an unroutable haul returns no path instead of an unaffordable one. The engine grows
  from the fuel-weighted Dijkstra `lib/engine/pathfinding.ts` already used for ship navigation
  (`dijkstra`'s `edgeCost` hook) into a stateful booker (`createRouteBooker`,
  `lib/engine/lane-routing.ts`) — one shared physical ledger every faction routes against in a run,
  so two factions booking the same edge see each other's load.
- **Traversable space:** own systems, unclaimed systems, and systems held by a faction the hauler
  holds at friendly or allied relation tier — neutral, unfriendly and hostile space is closed
  (`laneOpenFor`, `lib/engine/lane-access.ts`). Traversability is a **per-client policy**, not a
  substrate constant: it is passed in as the booker view's `openEdge` predicate, which is what makes
  a future mover with narrower traversal (e.g. same-faction-only migration) a client swap rather
  than a substrate change. Transit is fixed at dispatch — a relation dropping mid-flight does not
  re-path a haul already in transit; the interdiction query (§3) is how that state gets read later.
- **Booking a haul that outgrows the cheapest path's remaining room** ships up to that room on it and
  re-routes the remainder over the next-cheapest path, repeating until placed or no affordable path
  remains. **Capacity-blocked volume is its own signal**, recorded once on the first saturated edge
  of the cheapest path a haul could not fully use — never folded into `unservedShortfall`, which
  stays a donor-stock capacity measure. A saturated corridor therefore shows full lanes, longer
  detours elsewhere, and rising blocked volume on the choke edge, read by the planner (§4) and the
  map surfaces (§7).
- **Route cost is the work-budget price**: the same summed, congestion-priced cost bills the
  faction's logistics work, replacing the old hop-count price. There is no `MAX_HOPS` any more —
  reach is bounded by cost, not a hop cap, and an unaffordable draw against the faction's work
  budget ends only that one deficit's fill (a per-deficit skip), never the whole run's matching pass.

---

## 3. Scheduled transit

Transit is scheduled, never positionally simulated — nothing per-tick moves a haul along its route.

- **Dispatch** computes the arrival tick from the whole path at once:
  `arrival = now + max(0, round(Σ path fuelCost / FREIGHT_SPEED))` (`freightArrivalTick`,
  `lib/engine/freight.ts`) — a whole-path formula with no per-hop floor, so a high enough
  `FREIGHT_SPEED` collapses every arrival to the dispatch tick (instant delivery, with routing,
  capacity billing and blocking fully retained). Donor stock is debited at dispatch; the haul is
  written onto the scheduled-freight ledger (`WorldPendingArrival`, `world.pendingArrivals`),
  carrying its ordered `routeEdges` (lane keys) and which leg it is.
- **The goods-arrivals stage** (`runGoodsArrivalsProcessor`, `lib/tick/processors/goods-arrivals.ts`)
  is an unconditional per-tick stage, not a phase of the logistics processor — it runs every tick,
  head of the run order, and drains every ledger row due that tick before anything else classifies
  it. An **outbound** leg credits its destination up to the market's band cap and writes the
  `logistics`-tagged flow row for the credited quantity; any uncredited remainder is minted as a
  fresh **return** leg back toward the donor over the reversed route, at the same transit delay the
  outbound leg took, crediting the donor in full and uncapped on arrival (the cancelled-colony
  precedent — see [Player Seat](./player-seat.md) Cancel) — a return leg writes no flow row, so the
  flow log stays a record of goods actually delivered.
- **Deficit classification counts inbound.** The sink test reads `stock + scheduled inbound for that
  good` where it read stock alone before (`scheduledInbound`, `lib/engine/freight.ts`, outbound legs
  only); the donor test stays on physical stock. This is the oscillation guard scheduled latency
  needs: a system whose goods are already en route does not re-order and overshoot.
- **The interdiction query** — war's future verb, reserved by this pass but called by nothing yet:
  `flowsCrossingEdge(ledger, laneKey, fromTick, toTick)` (`lib/engine/freight.ts`) answers "which
  scheduled flows cross this lane in this window", read-only, straight off the ledger's
  `routeEdges`.

---

## 4. Investment agency — player and planner, symmetrically

- **Player verbs:** invest in (upgrade) any lane whose two endpoints the player controls
  (`orderLaneUpgrade`, `lib/services/construction-orders.ts`) — enters the construction queue tagged
  `origin: "player"`, cancellable like any player build; and claim an adjacent unclaimed system
  (§1). Both surface on the lane's route-docked panel (`/lane/:key`,
  `components/panels/lane-panel.tsx`) and the system Overview's Territory card respectively. **Lane
  automation is its own switch** — `world.player.automation.lanes` (default on, alongside `build`
  and `colonisation`) gates only the *autonomic* planner's lane-upgrade proposals for the player's
  faction; a manual invest order always goes through regardless of the switch.
- **The autonomic planner** proposes a lane upgrade wherever the last run's routing shows an edge
  congestion-binding — scored by that lane's `blockedVolume`, on the same ROI ordering as housing,
  industry and colony proposals (`docs/active/gameplay/economy-autonomic-agency.md`,
  `docs/active/gameplay/colonisation.md`). Two anti-thrash gates, adopted verbatim from the existing
  opportunity types: the opportunity scores against the **effective level** (built plus levels
  already queued in an open project for that lane), and a lane with an open upgrade project
  generates no further proposal until it lands.

---

## 6. The substrate contract

The lane layer exposes exactly: nodes, open edges with capacity/cost/time, cheapest-path queries,
capacity booking, the scheduled-arrivals ledger, and the interdiction window query. It never reads
market rows, goods identities, demand or faction treasuries — the surplus→deficit matcher is its
first client, not its definition. **Traversability is a per-client policy, not a substrate
constant** (§2): goods route over own + unclaimed + friendly-or-allied space, while population
migration keeps its own, narrower same-faction-only traversal — the open-edge predicate is a
parameter of the cheapest-path query, which is what would let a future migration rehost land as a
client swap rather than a substrate change. Negotiated transit rights beyond the relation-tier rule
(treaties, tolls, per-lane grants) are a named future slot, not built.

---

## 7. Surfaces

- **Map.** Every lane draws as a segment between its two systems, styled by `laneStyle`
  (`components/map/pixi/objects/lane-style.ts`) from its fuel-cost tier (base weight/alpha,
  unchanged from generation), its invested level (widens the line further), and its load
  (`bookedLoad ÷ capacity`, colours grey → amber) — turning red only when `blockedVolume > 0` this
  run, never merely "nearly full". There is no separate chord overlay any more: the Logistics
  overlay's convoy particles ride the lane network itself, one segment per lane a haul's route
  crosses, fed straight from the scheduled-freight ledger's `routeEdges`
  (`getTradeFlowEdges`, `lib/services/trade-flow.ts`). A lane is selectable — within a screen-pixel
  tolerance of its segment, behind a direct star hit — and opens its route-docked card
  (`/lane/:key`) naming level, capacity, current load vs capacity, upkeep, cargo currently in flight,
  the open upgrade project, and the invest verb (disabled, naming the missing endpoint, unless the
  player controls both ends). See [map-rendering.md](../engineering/map-rendering.md) for the lane
  layer and selection-precedence detail.
- **System Logistics tab.** Inbound and outbound in-transit rows list every scheduled-freight ledger
  entry touching the system, with the good, the other endpoint, quantity, and a duration-formatted
  ETA — disappearing the tick their arrival lands.
- **Faction construction card** gains a third compact link list, `Lanes`, alongside `Building` and
  `Colonies forming`, and a third automation checkbox (`Autonomic lanes`) beside `Autonomic build`
  and `Autonomic colonisation`.
- **Copy.** Lane, lane level, lane capacity, in transit, congested and blocked volume are glossary
  terms (`docs/active/glossary.md`); crossing lane's entry was corrected to describe today's
  reality — a lane priced above baseline that draws on the map by its fuel-cost tier like any other
  lane, not a separately-flagged line style.

---

## 8. Calibration

Shipped defaults, read at equilibrium on the default 600-system galaxy against the flat lane-off
baseline: all five conservation identities pass (including the goods-mass identity — Σ dispatch
debits = Σ arrival credits + in-flight + returned, residual ≤ 1.2e-8); lane utilisation sits at p50
0 / p90 ~0.3 with 2.5–3% of lane-samples saturated — the differentiator the generated fuel-cost
spread alone could not supply; blocked volume runs a few million against tens of millions moved,
concentrated on a few hundred lanes each carrying a queued upgrade (the planner working as
intended); real top-decile booked share reads a little above the lanes-off flow-concentration
projection; median survival-good deficit spells and single-cycle share are unchanged from the
zero-latency arm, so nonzero freight latency does not destabilise the equilibrium; return-leg
volume reads at or near zero (dispatch already sizes against scheduled inbound, so there is little
left to bounce); the tier traversability rule strands a small share of volume against a
faction-blind baseline in exchange for a materially lower foreign-transit share and zero contention
shortfall, and costs far less wall-clock — the reason it ships over the faction-blind alternative.
The logistics processor's wall-clock share of tick rises from generation's baseline but stays under
the ~3× regression line at 600 systems; the new per-tick goods-arrivals stage adds a further single-
digit percentage share on top. `BASE_LANE_CAPACITY`, `FREIGHT_SPEED` and the tier traversability
rule are the calibrated shipped defaults; a route dictionary or per-source path cache remains
unbuilt, needed only if a much larger galaxy's wall-clock share fails the same line.
