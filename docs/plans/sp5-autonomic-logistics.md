# SP5 — Autonomic-Light Directed Logistics (logistics-first slice)

> **Status: Planned (build plan).** Economy sub-project **SP5**, first slice — the *logistics* half of
> the autonomic-light agency mechanism, brought forward ahead of build-recovery and SP4 per the
> 2026-06-24 viability audit. Sits **on** the substrate-v2 available-space model + SP3.5 decay (both
> unchanged) and **beside** trade-flow diffusion + migration as a third flow on the shared edge topology.
> Roadmap home: [economy-simulation-vision.md](../planned/economy-simulation-vision.md) §12.2 / §13.
> North-star constraint: [negative-space-economy.md](../planned/negative-space-economy.md).
> Layering inputs: [sp5-war-layering-contract-audit.md](./sp5-war-layering-contract-audit.md).
>
> **Delete this file once the slice ships** — the functional design moves to
> `docs/active/gameplay/economy-directed-logistics.md` and the code becomes the source of truth.

---

## Headline — the mechanics in one breath

Most of the galaxy can't feed itself locally (~58% of systems are "suppliable" — a same-faction food
surplus sits ~2 hops away but market diffusion is too distance-attenuated to deliver it). Directed
logistics is the faction deliberately **moving its own surplus to its own deficits**, above the
diffusion cap, on a slow clock.

> **Each agency cycle (48 ticks), per faction:** greedy-match **surplus → deficit** across all goods
> (ranked by need × population × urgency, nearest surplus first), spending a **logistics budget**
> (work = quantity × distance; generated per-system, pooled faction-wide; **free** in v1). Most matched
> volume is **moved silently** on the cycle boundary (cheap; keeps the world alive). A tunable
> **fraction is exposed as Contracts** instead — a player hauls it (normal market buy + delivery, paid)
> or it **times out and the faction hauls it itself**. Budget is deliberately set **below** total need,
> so a permanent residual remains — the negative space, and the standing player opportunity.

Two layers, one matching engine. The silent bulk flow is the workhorse; Contracts are the legible,
profitable skim off the residual. The split between them is the dial: **few players → mostly silent +
cheap; many players → more Contracts, less silent** — same goods moved, just more of it player-mediated.

### What it is NOT (the guardrails)

- **Not a re-tuning of trade-flow.** Market diffusion stays deliberately leaky; this is an *additive*
  command flow with a different driver (faction need, not price gradient). See negative-space doc.
- **No treasury, no money.** v1 is free and capacity-bounded. The budget is a physical work allowance,
  not a cost. Treasury funding is the next SP5 slice (§ SP5+ hooks).
- **No build/recovery.** Moving goods only. Rebuilding the durable core is the *next* slice.
- **No embodied agents.** A faction is an abstract per-faction decision function. "A faction vehicle
  did it" is a bookkeeping move, not a unit on the map. (Visible convoys = deferred presentation.)
- **Staples are not special-cased.** The loop runs over *all* goods; the demand weight (civilian need +
  industrial draw) makes food/water dominate naturally without a hard-coded filter.

---

## How it composes with what exists

| Flow | Driver | Funded | Moves against gradient? | Legibility |
|---|---|---|---|---|
| **Market diffusion** (`tradeFlow`, exists) | local price gradient | self (profit) | no | ambient |
| **Migration** (exists) | unrest + headroom | n/a | n/a | ambient |
| **Directed logistics** (this slice) | faction need / surplus | free (v1) → treasury (later) | **yes** | Contracts + flow overlay |

Benign coupling, already noted in the negative-space doc: when logistics dumps food into a deficit
system its price drops, which *naturally* tapers the market diffusion into that system. No double-supply
— they compose. Logistics draws only from market stock **above the days-of-supply anchor** (`targetStock`),
so a donor market is never drawn below its own comfort target and locals keep their supply — this is the
v1 form of "civilian crowd-out" (emergent, target-protected; the explicit
pull-starves-downstream-→-revolt cascade is a later refinement).

---

## The pieces

### 1. The logistics budget (the primitive everything hangs off)

- **Per-system generation → faction pool.** Each system generates a logistics figure per cycle, a
  simple function of its population/infrastructure (reuse `population`; no new magic constant). These
  **sum to a faction-wide pool** — the amount the matcher may spend. Per-system-generates / faction-spends
  mirrors the §12.4 military-as-aggregate-industrial-base shape: grounded (capacity comes from the
  systems), displayable per-system, but pooled so a strong hub can fund a haul to a struggling neighbour.
- **Work unit = quantity × route cost**, where route cost combines **hop count and total fuel cost**
  (Σ `fuelCost` along the path — `PathResult` already returns `totalFuelCost`; hops fall out of the
  path length). This single choice does triple duty:
  1. **Limiter** — match until the pool is spent, then stop. Pool < total need ⇒ residual ⇒ negative space.
  2. **Logistics unit** — free + population-scaled in v1; treasury-funded + upgrade-multiplied later.
  3. **Distance-as-cost for free** — near deficits are cheap, distant ones expensive, so the matcher
     feeds nearby suppliable systems and leaves the stranded ~1% unfed, *exactly* as designed —
     without a money model.
- **Rate, not stock (v1).** Fresh pool each cycle, no carry-over. Accumulation ("save for a push") is a
  treasury-era addition.

### 2. The matching engine (pure, unit-tested)

Per faction, per cycle (sharded over systems for scale; see Cadence):

1. **Deficits** — system+good where `stock < targetStock × DEFICIT_FRACTION` (below the days-of-supply
   anchor; `DEFICIT_FRACTION = 0.8` leaves a comfortable dead-band). Severity = shortfall ×
   demand rate (civ + industrial, per the demand basis below). Worst-first. **Self-supply gate:** a
   system that produces at least its own demand (`production ≥ demand`) is *never* a deficit sink for
   that good — its low standing stock is throughput, not need; importing into it only piles stock toward
   the storage ceiling, where infrastructure-decay reads the producer as not-selling and tears down its
   own extractors. Net-negative producers (make some, need more) are still sinks. *(Live audit
   2026-06-27: removed the ~49% of logistics tonnage that had been landing in self-sufficient producers;
   matcher-only, the build planner is unchanged.)* *(Sim audit 2026-06-26:
   the market keeps almost all stock above the band floor, so a floor-triggered deficit almost never
   fires; anchoring to `targetStock` is the deficit-side twin of the surplus anchor fix in Task 8.)*
2. **Surpluses** — system+good holding above its days-of-supply anchor: `stock ≥ targetStock ×
   SURPLUS_MARGIN` (where `targetStock = TARGET_COVER × demandRate`; margin > 1 leaves a deliberate
   residual). Drawable = `stock − targetStock` (donor never drops below its own target, so moving
   goods never creates a new deficit). *(The original near-ceiling definition — `stock ≥ maxStock × 0.9`
   — almost never fired because `maxStock` includes a large `storageCapacity` term; the anchor-relative
   rule corrects this, per 2026-06-26 simulator diagnosis.)*
3. **Match** — for each ranked deficit, find the nearest same-faction surplus of that good within a hop
   budget; allocate `transfer = min(deficit shortfall, surplus drawable, remaining_pool / distance_cost)`.
   Spend the pool; advance; stop when exhausted.
4. **Residual** — deficits left unserved (pool spent or surplus too far) are the negative space; a slice
   becomes Contracts (layer split below).

**Demand basis = total local demand = civilian consumption (`GOOD_CONSUMPTION × population`) +
industrial input demand (`inputDemandForGood`, already computed for pricing's `demandRate`).** Both are
cheap and already in scope, so the deficit signal captures a starved population *and* a starved factory
from day one — and it's the **same number the supply/demand chart shows** (UI below), so chart and
matcher share one definition. Industrial demand is **local consumption, not a flow**, so it stays
consistent with "the chart excludes imports/exports." *Calibration caveat:* civilian staples are
expected to dominate, and industrial demand entangles with the SP3 input-gating cascade, so we validate
civ-staple-dominant behaviour first — but the terms simply add, so that's a tuning order, not a rewrite.
The *strategic* bottleneck-relief weighting (faction-wide chokepoint targeting, doctrine-biased,
§12.3 priority 3) stays deferred — only the demand **term** is in v1.

### 3. The two-layer split (silent bulk vs Contract skim)

A matched transfer is one object (`PlannedTransfer`: `{ good, fromSystem, toSystem, quantity, distance }`)
materialised one of two ways:

- **Silent bulk** (the majority): apply the stock deltas on the cycle boundary (`from.stock -= q`,
  `to.stock += q`, both band-clamped) and append a **`TradeFlow` row** (`flowType: "logistics"`). Cheap;
  the visible artifact is the flow arc, no persistent business row.
- **Contract skim** (a tunable fraction `f`): create a `TradeMission` (origin = surplus system, dest =
  deficit system, good, quantity, reward, deadline, `origin: "logistics"`). Then:
  - **Player fills it** → they buy the goods through the *normal* market (stock/price/countdown all
    normal) and deliver; on delivery the destination market `stock += quantity` (the deficit fills) and
    the player is paid. No special source decrement at creation.
  - **Times out unfilled** → the faction hauls it: apply the surplus→deficit stock deltas + a `logistics`
    `TradeFlow` row, then close the Contract. (So an unfilled Contract still does real work — your
    refinement.) Stale Contracts age out naturally as the economy shifts each cycle.

`f` (and total exposed volume) scales with player population/activity — the performance/agency dial.

**Stock never vanishes at Contract creation.** Goods move only at (a) the cycle boundary (silent or
timeout-resolve — the same moment the existing economy-cycle countdown already cues) or (b) a player's
own purchase. Combined with the `minStock` floor reserving local supply and the existing TOCTOU
re-read-in-transaction discipline, there's no "stock disappeared mid-browse" surprise — and no need to
split market stock into separate retail/logistics pools (the floor is the soft separation).

### 4. Routing through systems (cheap now, the SP5 hook)

Full route pathfinding already exists (`lib/engine/pathfinding.ts` → `PathResult.path: string[]`;
`transit-position.ts` already walks ships through intermediate systems; `hop-distances` is cached and
invalidated on lane changes).

- **v1** derives a transfer's route **on demand** and recomputes at resolve time — so a transfer
  automatically respects *current* topology. The only en-route rule v1 needs: if the path no longer
  exists (a lane was severed), the transfer fails. Reuses the existing open-edge/sever lever.
- **Work stays bounded** — we only path the *matched* transfers (capped by the pool), never all-pairs.
- **SP5+ bolts onto the stored `path[]`**: per-system transit cost (cost = Σ over path), event-based
  blocking ("a system on the route is in revolt → halt"), and cargo damage — all cheap gates over the
  route, designed against the same primitive without re-architecting.

---

## Data model changes (small)

- **`TradeFlow.flowType`** — `String` discriminator (`"market"` | `"logistics"`), default `"market"`.
  Lets the map overlay render directed hauls distinctly and the Logistics tab filter them.
- **`TradeMission.origin`** (or `kind`) — discriminator (`"economy"`* | `"event"` | `"logistics"`) so
  the timeout-resolve knows which Contracts to haul, and the Contracts tab can badge them.
  (*the `"economy"` price-gen path is retired — see processor rework — but the field stays general.)
- **`FactionLogistics` summary row** — capacity-per-cycle / spent / remaining / updatedTick, written by
  the processor each cycle. Few factions ⇒ trivially few rows; powers the tab's used/remaining readout.

No new column for per-system generation — derive it from `population` (+ infra later).

---

## Processor architecture

Follows the project convention (typed `World` interface · Prisma adapter · in-memory adapter ·
pure body — see `docs/active/engineering/processor-architecture.md`).

- **New `directedLogistics` processor** — owns the new work: matching → silent bulk moves (stock deltas
  + `logistics` flow rows) → Contract creation (the skim) → timeout-resolve of unfilled logistics
  Contracts. Runs on the agency clock (Cadence below), `dependsOn: ["economy"]` so bands/stock are current.
  `DirectedLogisticsWorld` interface + `PrismaDirectedLogisticsWorld` + in-memory adapter for
  simulator/unit tests; pure `runDirectedLogisticsProcessor` body. Reuses `marketBandForRow`,
  `capacityGoodRates`/consumption, `findShortestPath`, `loadHopDistances`.
- **`tradeMissions` processor reworked** — its price-ratio/random-destination generator
  (`selectEconomyCandidates` in `lib/engine/missions.ts`) is **retired** (the thing that doesn't read
  the new system props). It keeps the generic **player lifecycle** (accept/deliver/expire/notify) for
  all trade missions; event-themed generation (`selectEventCandidates`) stays untouched (orthogonal;
  events come last in the roadmap). Logistics-Contract *creation* and *timeout-resolve* live in the new
  processor (it holds the surplus source + budget); the exact seam is an implementation detail.
- **Operational missions (`missions` processor: patrol/bounty/survey/…) — untouched.** Different domain
  (danger + traits), separate processor. They share *infrastructure* only: the Contract/mission table
  conventions, the mission-card UI, and a useful **precedent** — op-missions already
  "complete timed missions on a timer → credit players" (`getCompletableTimedMissions` →
  `completeMissions` → `creditPlayers`), almost exactly our timeout-resolve shape.

### Cadence

`LOGISTICS_INTERVAL = 2 × ECONOMY_UPDATE_INTERVAL` (= 48 ticks; economy is 24) — a big, slow,
predictable current, per the "nothing vanishes while you watch" legibility requirement. Reuse the
existing fixed-interval shard machinery (`shardRange` / `catchUpFactor`) so every faction/system is
swept once per interval at any scale.

### Integration note (from the layering audit)

`topology.ts getOpenEdges()` caches faction-bounded edges once per process and `factionId` is written
only at seed. **Fine for this slice** (faction membership is static — no capture/rebellion yet). It
becomes a shared concern (cache invalidation on ownership change) when capture/rebellion land in a later
SP5/war slice — logged here so we don't trip over it then.

---

## UI

- **New Logistics tab** in the system dialog (sub-route
  `app/(game)/@panel/system/[systemId]/logistics/page.tsx` + nav entry in `layout.tsx`; read endpoint
  `app/api/game/systems/[systemId]/logistics/route.ts` + service + TanStack hook + query key). Purely
  **informational**, ordered so each row explains the next:
  1. **Capacity** — this system's generation/cycle + the faction pool (used / remaining, so you can see
     how stretched the faction's haulage is).
  2. **Supply/demand balance** — the renamed `SubstrateTradeBars` (see below): production vs need →
     net surplus/deficit per good. The structural gap — *why* logistics targets this system.
  3. **Actual flows** — the Overview import/export chart (`trade-activity-panel.tsx`) relocated here,
     now `flowType`-aware (market vs logistics). The *response* servicing the gap.
  4. **Contracts pointer** — read-only "N logistics contracts available here →" deep-linking to the
     Contracts tab. Information points to action; action lives where players expect it.
- **Rename `SubstrateTradeBars` → `SupplyDemandBars`** (drop "Substrate"/"Trade" — it shows a
  production/demand *balance*, not trades). Its `consumption` term extends to **total local demand
  (civ + industrial)** so it equals the matcher's deficit signal (extend `capacityGoodRates`'s
  consumption field with `inputDemandForGood`). Still **pure intrinsic** — imports/exports (flows) must
  **not** count, or the net gap (the whole signal) cancels out; industrial demand is local consumption,
  so it belongs. Move it off the industry panel onto Logistics and tighten density. (De-clutters
  `industry-panel.tsx`.)
- **Contracts tab** — add a **"logistics" badge / filter** for `origin: "logistics"` Contracts, so a
  faction haul reads differently from a generic/event contract. Keep Contracts the single operational
  home — no sub-tab, no duplication.
- **Map overlay** — honour `flowType` in `star-map.tsx` / `map-overlay-controls.tsx` (distinct arc
  colour/style for logistics). The deferred Phase-2 "visible convoys" upgrade later renders these same
  `logistics` `TradeFlow` rows as haulers (in-transit markers already exist).

---

## Success criteria (coarse, audit-grounded)

On a multi-thousand-tick run the decay-only ratchet visibly **bends for the suppliable ~58%**: pop
decline arrested rather than trending down, striking-system count plateaus instead of climbing, the
suppliable class survives where it currently hollows — while the **self-sufficient core and the stranded
~1% are untouched**. Coarse health-bar, not precision (per the calibrate-to-shape stance): no NaN /
runaway / pinning; logistics never draws a donor market below its own target; budget < need leaves a visible
residual. Validate in the simulator first, then live observation.

---

## Build phases (each shippable; PR-sized)

1. **Logistics primitive + matching engine + silent bulk moves.** Budget (per-system generation →
   faction pool, work = qty × distance), deficit/surplus detection, greedy matching; apply silent stock
   moves + `TradeFlow` rows (`flowType` added). New `directedLogistics` processor (World/adapter/body) on
   the 48-tick clock. Engine pure + unit-tested. **No Contracts yet** — prove the bulk flow bends decay
   in the simulator.
2. **Contract layer.** `TradeMission.origin`; the silent/Contract split dial; logistics-Contract
   creation (skim) + timeout-resolve (bulk haul); retire `selectEconomyCandidates`; delivery adds to
   destination stock. Contracts badge/filter.
3. **Map overlay `flowType`.** Render market vs logistics flows distinctly.
4. **Logistics tab.** Read endpoint/service/hook; the tab (capacity + renamed `SupplyDemandBars` +
   relocated flows chart + Contracts pointer); de-clutter the industry panel.

Phases 1–2 are the economic core; 3–4 are legibility/UI. Bundle into 2–3 PRs per the project's
phase-PR convention.

---

## SP5+ hooks (deferred — designed against, not built here)

- **Treasury funds the budget** — the §12.1 logistics-efficiency band multiplies per-system generation;
  the "payout < faction self-haul cost" asymmetry switches on (makes the faction *prefer* a player did
  it) once self-haul actually costs something.
- **Route-based cost + interdiction** — per-system transit cost, event/revolt blocking, cargo damage,
  all over the stored `path[]`.
- **Strategic bottleneck-relief weighting** — faction-wide chokepoint targeting + doctrine bias (§12.3
  priority 3). The input-demand *term* is already in v1; this is the prioritisation strategy on top.
- **Accumulation** — budget becomes a storable stock ("save for a push").
- **Doctrine / government weighting** — bias deficit ranking + pull strength (faction economic personality).
- **Visible convoys** — render `logistics` `TradeFlow` rows as NPC haulers (presentation only; unlocks
  convoy-raiding).
- **Topology/`factionId` cache invalidation** — required when capture/rebellion make membership dynamic.

---

## Open questions / tuning (settle in the plan or via simulator)

- Budget generation formula (population coefficient; infra term later).
- Silent/Contract split `f` as a function of player count/activity.
- Deficit/surplus thresholds (below-floor margin; near-ceiling margin); hop budget / max logistics distance.
- Contract reward — revisit `calculateReward` at implementation; decide if it still makes sense.
- Hop/fuel blend in the work-cost (relative weight of hop count vs total fuel cost).
- Validation order: loop all goods + both demand terms, but sim-validate civ-staple-dominant behaviour
  before leaning on industrial-demand relief.

### Phase 2 resolutions (2026-06-27 — see `sp5-logistics-phase2-impl-plan.md`)

- **Split dial = constant top-K, not a fraction.** Each cycle the **top `CONTRACTS_PER_CYCLE` (=5)
  most valuable** transfers per faction (ranked by `cost` ≈ quantity × distance ≈ player payout) become
  Contracts; the rest move silently. Player-activity scaling stays an SP5+ hook. Pure helper
  `splitContractTransfers`.
- **Contracts ARE the demand-driven trade missions.** `selectEconomyCandidates` (price-ratio + random
  destination — never read the substrate-v2 demand figures) is **deleted**. After Phase 2 the only
  trade-mission generators are the logistics matcher (demand-driven) and `selectEventCandidates`
  (event-themed). The bulk of player trade opportunity remains open-ended market arbitrage + the
  budget-unreached residual (negative space), not missions.
- **`origin` is internal only.** Needed so timeout-resolve knows which expired Contracts the faction
  self-hauls (`origin === "logistics"`) vs which just expire (events). **No player-facing badge or
  filter** — every contract reads as one undifferentiated transport contract; faction-supply framing is
  deferred to the Phase 4 Logistics tab.
- **Timeout-resolve lives in `directedLogistics`** (re-reads drawable, band-clamps, hauls + logistics
  flow row, closes). `trade-missions` `expireUnclaimedMissions` excludes `origin:"logistics"`. Deadline
  = one INTERVAL so resolve lands on the owning faction's next shard run.
- **Reward** reuses `calculateReward(quantity, hops, tier, false)`. **Delivery-adds-to-destination-stock
  already shipped** (`lib/services/missions.ts`) — reused unchanged.
- **Sim** passes `contractCount: 0` → pure-silent (Phase-1 curve unchanged); Contract paths covered by
  unit + integration tests.

## Out of scope (explicit)

Build/recovery half · treasury & money · strategic bottleneck-relief prioritisation (the demand *term*
is in v1) · war/interdiction consequences · player-trade unit rescale (separately backlogged) ·
embodied NPC agents (Tier-2) · visible convoys.
