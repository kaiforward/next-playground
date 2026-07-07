# Trade Simulation (Edge Flow)

Status: **Active** — shipped.

## Problem

The economy needs sustained inter-system trade pressure. Production and consumption alone have no spatial restoring force, so without trade every market drifts to its clamp boundary. Simulated edge flow is the mechanism that supplies that spatial pressure.

## Solution

Trade is simulated as **goods flowing along graph edges** driven by local price differences. There are no merchant entities — the universe contains thousands of unseen merchants in lore, and the simulation captures the *economic effect* of their traffic at a fraction of the cost. Each flow is recorded as an event, and a single stock delta is applied to both endpoints.

---

## Design

### Topology — Which Edges Carry Flow

Flow runs over the **intra-faction jump-lane graph**. An edge is *open* — eligible to carry goods — only when its two endpoints belong to the same faction; cross-faction edges are **closed**, so goods never diffuse across a sovereign border ("factions don't trade at all" until SP5 opens relation-weighted borders). Two adjacent **independent** systems (no faction on either side) are open to each other under the same rule, forming a permeable pool — but under current world-gen the faction flood-fill claims every system, so this independent-trade path is a **latent capability with no live data**, not an active gameplay route today. It activates when SP5 introduces faction agency and unclaimed space.

Crucially, **region lines are no longer a flow boundary.** A faction's territory is grown by flood-filling the jump-lane graph outward from its homeworld, so it routinely spans several regions — and goods cross a region border freely whenever both sides share a faction. Regions remain a territory, aggregation, and gateway-rendering concept; the only hard wall is the sovereign (faction) border. This deliberately separates the *gameplay* boundary (who may trade) from the *performance* concern (how work is sharded).

The open-edge list is built once and cached for the process: each connection is deduped to a single unordered edge, tagged with its fuel cost, and sorted by a stable key so the work cursor is deterministic across runs. It changes only when a new world is generated (cleared via `invalidateAdjacencyCache`).

### Distance Attenuation

A jump's fuel cost stands in for its length. Each open edge scales its flow by `1 / (1 + DISTANCE_DECAY · fuelCost)`, so cheap local hops move close to the full budget while long, fuel-expensive jumps move only a fraction — most visibly the high-cost gateways that bridge two regions of the same faction. The effect is **distance-graded price dispersion**: staple goods equalize locally and vary little across the map, while high-value goods (notably luxuries) sustain larger price gaps across distance, rewarding long-haul arbitrage. At `DISTANCE_DECAY = 0` attenuation is off (every edge moves the full budget).

### How a Flow is Decided

For every open edge in the current work slice, the simulator looks at every good both endpoints trade. For each candidate good, it asks the same question: how much cheaper is it at one end than at the other, relative to that good's base price? That normalized price difference is the "gradient." Comparing as a fraction of base price keeps water and luxuries on the same scale.

Only the steepest gradient on the edge gets to move that run — multi-good coverage emerges naturally as the price landscape shifts and a different good takes the lead next time the edge fires. If the steepest gradient is below the configured threshold, the edge sits idle: tiny price wobbles shouldn't trigger churn.

When a gradient clears the threshold, the simulator decides how many units to move by taking the smallest of three constraints — how much room the destination has, how much surplus the source can spare without dropping below its floor, and the per-edge budget — and then scales that by the gradient's strength. Steeper gradients move closer to the full budget; near-threshold gradients move only a sliver. The result is rounded down to whole units.

The chosen quantity then flows from the cheap side to the expensive side: a single stock value leaves the source and arrives at the destination. Mid-run state is mutated in place so later edges in the same slice see the new prices and adapt — chains emerge when one move opens up a new gradient for a neighboring edge.

### Scheduling — Fixed-Interval Edge Shard

The processor runs every tick and processes `shardRange(totalEdges, tick, ECONOMY_UPDATE_INTERVAL)` open edges over the stable open-edge order — a fixed-interval edge shard. A full universe sweep therefore takes `ECONOMY_UPDATE_INTERVAL` (24) ticks **at any scale**.

This decouples per-tick work from territory size: a sprawling empire and a city-state cost the same per tick, differing only in how many ticks their edges take to sweep. The faction topology owns the gameplay boundary (who may trade); the shard owns the work budget — each tunable independently. The shard runs on the same interval as the economy processor, so production and flow advance on one unified clock. See `docs/active/engineering/tick-engine.md` for the full cadence model.

There is one hard invariant: the sweep must finish before flow events get pruned. If an edge's events were aged out before the cursor returned to it, the map overlay would show permanent gaps. So the sweep length (`ECONOMY_UPDATE_INTERVAL`, 24) must stay below `FLOW_HISTORY_TICKS` — at 24 ≪ 200 this holds with room to spare at any scale.

By design, the trade-flow processor declares a dependency on the economy processor: within a single tick, prices settle from production and consumption *before* the trade simulator reads them. This avoids flow firing against stale gradients.

### One Topology, Two Flows: Goods and People

The same intra-faction open-edge topology and fixed-interval edge shard that carry goods also carry **population migration** (see [economy.md](./economy.md) — population dynamics and migration). Migration is a separate processor (`dependsOn: population`), but it reuses the same `SystemConnection` adjacency cache, the same distance-attenuation formula (`1 / (1 + DISTANCE_DECAY · fuelCost)`), and the same fixed-interval edge shard.

The shared topology means goods and people always move on the **same map**: a system bleeding population to a booming neighbour can still receive food shipments from it along the same jump lanes. Gateways (high fuel-cost connections between faction territory clumps) throttle both flows equally under the attenuation formula — a deliberate design choice that gives gateways strategic significance without building special-case gateway logic into either flow.

Migration drives an **attractiveness gradient** rather than a price gradient: population flows toward neighbours with low unrest and high headroom (`popCap − population`), attenuated by distance. The flow is conserved (population relocated, not created or destroyed) and capped per tick to prevent ping-pong.

### What Gets Recorded

Two surfaces come out of each run:

- **A per-edge event log.** Every flow is appended to a rolling-window log (`world.flowEvents`) capturing the tick, the direction, the good, and the quantity. The map overlay and the per-system detail panel read it by source, destination, and good. A pruning step on every active run drops anything older than the configured history window.
- **Per-system volume increments.** Both endpoints of the move have their owning system's per-tick volume accumulator incremented in the same tick pass that adjusts stock.

### Trade Routes

A "trade route" is a connected chain of edges all moving the same good in the same direction for a sustained period. Routes are not stored — they are computed on demand by walking the flow events for the relevant window: group by edge and good, drop edges below the noise floor, stitch surviving edges into chains by matching endpoints, and rank by total volume and consistency. The event log is the truth; routes are a presentation layer.

---

## Data

Flow events are a rolling in-memory list on the world (`world.flowEvents`, row type `WorldFlowEvent` in `lib/world/types.ts`). Each entry records the tick, the directional edge (source and destination systems), the good, and the quantity — enough for the overlay aggregation, the per-system top-imports/exports lookup, and the route-chain stitching.

The window is bounded — the pruning step at the end of every active run keeps the list size proportional to `flow events per active run × history window`, not unbounded growth.

---

## Tuneable Constants

Defined in `lib/constants/trade-simulation.ts`. These are the dials the simulator exposes for calibration — change them, sweep with `npm run simulate -- --config <file>`, then promote the value that holds equilibrium prices inside the target band.

| Constant | Purpose |
|---|---|
| `DISTANCE_DECAY` | Strength of distance attenuation in `1 / (1 + DISTANCE_DECAY · fuelCost)`. Higher means long jumps move less and dispersion concentrates on long-haul goods. Calibrated to **0.1**; `0` disables it. |
| `FLOW_BUDGET` | Cap on how many units one edge can move in a single run. |
| `GRADIENT_THRESHOLD` | Minimum normalized price gap, as a fraction of base price, before an edge fires at all. |
| `GRADIENT_SENSITIVITY` | How aggressively the move size responds to gradient strength. 1.0 means a full-`basePrice` gap saturates the budget. |
| `FLOW_HISTORY_TICKS` | Rolling window in ticks for retained events and route inference. |
| `ROUTE_INFERENCE_FLOOR` | Minimum cumulative flow on an edge before it counts as part of a route or shows on the overlay. |

---

## Player-Facing Surfaces

### Map Overlay

A toggle on the floating overlay-controls cluster (default off) reveals a Pixi particle layer over the galaxy map. Edges with cumulative flow above the route-inference floor get directional flowing particles tinted by the dominant good's tier.

A tier-colour legend sits beneath the toggle so first-time players can decode the colour story (raw → green, processed → amber, advanced → cyan). Tier colours live in `lib/constants/good-colors.ts` as the single source of truth shared by the legend and the Pixi tinting layer.

### Logistics Tab

The system detail panel has a **Logistics** tab (between Industry and Market) pairing two diverging-bar charts over a full-width volume-over-time series. It is a legibility instrument for the per-system trade picture — where the price overlay surfaces *opportunity*, this tab gives the *precise per-good breakdown*.

**Internal** (left column): production vs consumption for all goods, per-cycle rates, solid bars. Relocated from the Industry tab's "Trade balance" card. Dense on inhabited systems (~all 26 goods present).

**External** (right column): imports vs exports over the rolling `FLOW_HISTORY_TICKS` window, cumulative volume. Each bar splits by **flow type** — solid for directed **logistics** (autonomic), diagonal-hatched for **market** diffusion — the same two-layer distinction as the map overlay. Per-row hover tooltips list the top source/destination partner systems.

Both columns share a single **tier-grouped, net-descending** row order (raw → processed → advanced; net-descending within tier) so each good aligns across both columns. Un-traded goods render blank on the External side. Each column normalises to its own maximum (per-cycle rates vs cumulative volume are incommensurable), so the cross-column comparison is qualitative — sign and within-column relative size, not absolute magnitude.

A full-width Recharts line series below the charts shows bucketed import/export volume over the history window.

*Replaces* the Overview "Trade Activity" panel and the Industry "Trade balance" card.

---

## Future Hooks

The flow event log is a natural data source for several player-facing features without growing the simulation:

- **Trade-skill tiered visibility** — once the player-progression system ships, route data can be gated by skill: aggregate-only at low tiers, full chains at high tiers, predictive route shifts at master tier by running the gradient math forward a few ticks against current state.
- **Named convoy layer** — if interactable entities become valuable (pirate prey, escort targets), a small named-convoy layer can be added on top of the same flow data: visible entities driven by the same math, but rendered at far lower count than full NPC simulation would require.

---

## Implementation Notes

Built on the shared processor architecture — see `docs/active/engineering/processor-architecture.md`. The live game and the calibration harness run the same pure processor body against the single in-memory backend, so harness sweeps observe the same scheduling and logic the live tick does.
