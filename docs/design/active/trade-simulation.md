# Trade Simulation (Edge Flow)

Status: **Active** — shipped.

## Problem

The economy needs sustained inter-system trade pressure. Production and consumption alone have no spatial restoring force, so without trade every market drifts to its clamp boundary and systems sit at the stagnant prosperity multiplier (0.7×). Player density (10–50 players across 10K systems at scale) cannot supply that pressure on its own.

## Solution

Trade is simulated as **goods flowing along graph edges** driven by local price differences. There are no merchant entities — the universe contains thousands of unseen merchants in lore, and the simulation captures the *economic effect* of their traffic at a fraction of the cost. Each flow is recorded as an event, and the same supply/demand bookkeeping a player trade would produce is applied to both endpoints.

---

## Design

### How a Flow is Decided

For every connection edge between two systems in the currently-processed region, the simulator looks at every good both systems trade. For each candidate good, it asks the same question: how much cheaper is it at one end than at the other, relative to that good's base price? That normalized price difference is the "gradient." Comparing as a fraction of base price keeps water and luxuries on the same scale.

Only the steepest gradient on the edge gets to move that run — multi-good coverage emerges naturally as the price landscape shifts and a different good takes the lead next time the edge fires. If the steepest gradient is below the configured threshold, the edge sits idle: tiny price wobbles shouldn't trigger churn.

When a gradient clears the threshold, the simulator decides how many units to move by taking the smallest of three constraints — how much room the destination has, how much surplus the source can spare without dropping below its floor, and the per-edge budget — and then scales that by the gradient's strength. Steeper gradients move closer to the full budget; near-threshold gradients move only a sliver. The result is rounded down to whole units.

The chosen quantity then flows from the cheap side to the expensive side. Both markets see the exact deltas a player trade would produce: supply leaves the source and arrives at the destination, with a smaller demand signal applied in the opposite direction to mirror the buy/sell intent. Mid-run state is mutated in place so later edges in the same region see the new prices and adapt — chains emerge when one move opens up a new gradient for a neighboring edge.

### Tick Cadence

The processor runs every tick, but each tick it picks **one region** to work on, cycling through the universe in round-robin order. The position in the cycle is derived from `floor(tick / interval) % regions`, rather than the more obvious `tick % regions`, because the latter starves a fixed subset of regions whenever the cadence interval shares a factor with the region count.

A full universe sweep therefore takes `regions × cadence_interval` ticks. There is one hard invariant: the sweep must finish before flow events get pruned. If a region's events were aged out before the round-robin returned to it, the player-facing overlay would show permanent gaps in that region's history. The processor logs a warning if the invariant is in danger of being violated.

By design, the trade-flow processor declares a dependency on the economy processor: within a single tick, the region's prices settle from production, consumption, and reversion *before* the trade simulator reads them. This avoids flow firing against stale gradients.

### What Gets Recorded

Two surfaces come out of each run:

- **A per-edge event log.** Every flow appended to a rolling-window table that captures the tick, the direction, the good, and the quantity. Indexes by source, destination, and good give the map overlay and the per-system detail panel cheap queries. A pruning step on every active run drops anything older than the configured history window.
- **Per-system volume increments.** Both endpoints of the move have the volume accumulator on their `Market` row incremented in the same atomic write that adjusts supply and demand. This is the exact accumulator player trades write to, so the prosperity processor cannot tell — and does not need to tell — whether the volume came from a player or from edge flow. Active regions become booming whether or not players show up.

### Trade Routes

A "trade route" in the player's mind is a connected chain of edges all moving the same good in the same direction for a sustained period. Routes are not stored — they are computed on demand by walking the flow events for the relevant window: group by edge and good, drop edges below the noise floor, stitch surviving edges into chains by matching endpoints, and rank by total volume and consistency. The event log is the truth; routes are a presentation layer.

### Player Displacement

When players are actively trading in a region, edge flow scales itself back so it isn't competing with them. The processor sums recent player trade volume in that region — using a wall-clock sliding window so bursts of player activity take effect immediately regardless of tick cadence — and uses it to compute a displacement value between 0 and 1. That value linearly throttles the per-edge budget. Full displacement means the per-edge budget rounds to zero and the processor skips its work for that region (pruning still runs); zero displacement means the budget is unaffected.

The intent is conservation of attention: in dead regions, the simulator provides the trade pressure; in busy regions, the players are the trade pressure.

---

## Data

A single new table tracks flow events. Each row records the tick, the directional edge (source and destination systems), the good, and the quantity. Indexes on tick, on each endpoint paired with tick, and on good paired with tick cover the overlay aggregation, the per-system top-imports/exports lookup, and the route-chain stitching, respectively. Foreign keys to `StarSystem` use named relations (`TradeFlowsFrom` / `TradeFlowsTo`).

The window is bounded — the pruning step at the end of every active run keeps the table size proportional to `flow events per active run × history window`, not unbounded growth.

The exact schema lives in `prisma/schema.prisma`.

---

## Tuneable Constants

Defined in `lib/constants/trade-simulation.ts`. These are the dials the simulator exposes for calibration — change them, sweep with `npm run simulate -- --config <file>`, then promote the value that holds equilibrium prices inside the target band.

| Constant | Purpose |
|---|---|
| `PROCESS_EVERY_N_TICKS` | How often the round-robin advances. Bigger means slower, more deliberate trade; must satisfy `regions × this < FLOW_HISTORY_TICKS`. |
| `FLOW_BUDGET` | Cap on how many units one edge can move in a single run. |
| `GRADIENT_THRESHOLD` | Minimum normalized price gap, as a fraction of base price, before an edge fires at all. |
| `GRADIENT_SENSITIVITY` | How aggressively the move size responds to gradient strength. 1.0 means a full-`basePrice` gap saturates the budget. |
| `FLOW_HISTORY_TICKS` | Rolling window in ticks for retained events and route inference. |
| `PLAYER_DISPLACEMENT_FACTOR` | How quickly player trade pressure throttles edge flow. Larger means edge flow gets out of the player's way sooner. |
| `PLAYER_VOLUME_WINDOW_MS` | Wall-clock window summed for "recent" player trade volume when computing displacement. |
| `ROUTE_INFERENCE_FLOOR` | Minimum cumulative flow on an edge before it counts as part of a route or shows on the overlay. |

---

## Player-Facing Surfaces

### Map Overlay

A toggle on the floating overlay-controls cluster (default off) reveals a Pixi particle layer over the galaxy map. Edges with cumulative flow above the route-inference floor get directional flowing particles tinted by the dominant good's tier. Visibility is gated server-side: an edge is returned only if at least one endpoint is in the player's visibility set.

A tier-colour legend sits beneath the toggle so first-time players can decode the colour story (raw → green, processed → amber, advanced → cyan). Tier colours live in `lib/constants/good-colors.ts` as the single source of truth shared by the legend and the Pixi tinting layer.

### Per-System Trade Activity Panel

The system detail panel includes a "Trade Activity" card showing:

- **Top imports** — the goods with the highest inbound volume, each with the top contributing source systems linked into the detail panel.
- **Top exports** — mirror view by destination.
- **Volume history** — a bucketed sparkline of inbound vs outbound volume over the history window.

The panel is visibility-gated: an invisible system returns empty data rather than leaking activity intel.

---

## Future Hooks

The flow event log is a natural data source for several player-facing features without growing the simulation:

- **Mission generation** — smuggler interception on high-contraband routes, cargo escort opportunities on dangerous high-value routes, "find an alternative" quests when an event blocks an edge, market manipulation by dumping at a known route's destination.
- **Trade-skill tiered visibility** — once the player-progression system ships, route data can be gated by skill: aggregate-only at low tiers, full chains at high tiers, predictive route shifts at master tier by running the gradient math forward a few ticks against current state.
- **Named convoy layer** — if interactable entities become valuable (pirate prey, escort targets), a small named-convoy layer can be added on top of the same flow data: visible entities driven by the same math, but rendered at far lower count than full NPC simulation would require.

---

## Implementation Notes

Built on the unified processor architecture — see `docs/design/active/processor-architecture.md`. Live game and simulator run the same pure processor body against different adapters (Prisma vs in-memory), so simulator sweeps observe the same scheduling and same logic the live tick does.
