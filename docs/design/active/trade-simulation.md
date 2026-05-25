# Trade Simulation (Edge Flow)

Status: **Active** — shipped.

## Problem

The economy needs sustained inter-system trade pressure. Production and consumption alone have no spatial restoring force, so without trade every market drifts to its clamp boundary and systems sit at the stagnant prosperity multiplier (0.7×). Player density (10–50 players across 10K systems at scale) cannot supply that pressure on its own.

## Solution

Simulate trade as **goods flowing along graph edges** based on local price gradients, rate-limited per edge per tick. Flow is pure math on edges and markets — no entities are spawned. The aggregate metrics produced (per-edge flow events, per-system import/export volume) feed prosperity, mission generation, and the player-facing trade-flow surfaces.

The universe contains thousands of unseen merchants in lore; edge flow simulates the *economic effect* of that merchant traffic at O(edges) cost.

---

## Design

### Flow Mechanism

For each connection edge `(A, B)` shared between two systems in the same region, the processor picks the good with the steepest absolute price gradient and considers a move from the cheap side to the expensive side:

```
priceA = calculatePrice(market(A, g))
priceB = calculatePrice(market(B, g))
gradient = (priceB - priceA) / mA.basePrice    // signed, normalized

if |gradient| < GRADIENT_THRESHOLD: skip
if !isFinite(gradient): skip

fraction = min(1, |gradient| * GRADIENT_SENSITIVITY)
quantity = floor(min(FLOW_BUDGET, supplyHeadroom, supplyCapacity) * fraction)

if quantity > 0:
  move `quantity` units of g from cheap → expensive
  apply the same supply/demand deltas a player trade would (uses existing trade math)
  record flow event: { tick, from, to, goodId, quantity }
```

Key properties:
- **Rate-limited**: a per-edge per-run budget (`FLOW_BUDGET`) prevents unbounded equalization.
- **Threshold-gated**: small gradients don't trigger flow, avoiding noise-driven churn at equilibrium.
- **Reuses trade math**: flows hit markets identically to a player trade — supply decreases at source, demand decreases at destination, both increment the system's volume accumulator that feeds prosperity.
- **One good per edge per run**: the steepest-gradient good wins; multi-good coverage happens over successive runs as the gradient landscape shifts.

Chains emerge naturally: a system pulling food from a neighbor lowers that neighbor's supply, which then pulls from *its* neighbor, producing real supply chains without programming them.

### Tick Processing

Flow runs every tick, but the processor body picks **exactly one region per active tick** via round-robin:

```
regionIndex = floor(tick / PROCESS_EVERY_N_TICKS) % regions.length
```

The `floor` form (rather than `tick % regions.length`) avoids GCD pathologies where any common factor between `PROCESS_EVERY_N_TICKS` and `regions.length` would starve a sub-lattice of region indices.

A full universe sweep therefore takes `regions × PROCESS_EVERY_N_TICKS` ticks. There is a hard invariant:

```
regions × PROCESS_EVERY_N_TICKS < FLOW_HISTORY_TICKS
```

If violated, each region's flow events would be pruned before the round-robin returned, and the overlay would show permanent gaps. The processor logs a warning if the invariant is at risk.

The processor depends on `economy` (declared via `dependsOn: ["economy"]`) so flow runs after each region's price reversion settles for that tick.

### Aggregate Metrics

Two data surfaces are produced:

**Per-edge flow event log** (`TradeFlow` table) — every flow becomes one row:
- `{ tick, fromSystemId, toSystemId, goodId, quantity }`
- Rolling window — events older than `FLOW_HISTORY_TICKS` are pruned each active run.
- Indexed on `(tick)`, `(fromSystemId, tick)`, `(toSystemId, tick)`, `(goodId, tick)` for the route and per-system queries.
- Source of truth for both the map overlay and the per-system detail surfaces.

**Per-system trade volume** — each flow increments the source and destination system's volume accumulator on `Market`, in the same atomic write that adjusts supply/demand. This is the same accumulator player trades write to, so prosperity treats edge flow and player trade identically.

### Trade Route Inference

A trade route is a connected sequence of edges where the same good consistently moves in the same direction over a time window. Routes are computed on demand (not stored) — the underlying flow events are the truth.

```
For a given good g and time window [t-W, t]:
1. Group flow events by (fromSystemId, toSystemId, goodId), sum quantities
2. Filter edges below ROUTE_INFERENCE_FLOOR (noise)
3. Stitch edges into chains: (A→B) connects to (B→C) if both moved g in the window
4. Score by total volume and consistency
```

### Player Displacement

When players are active in a region, edge flow throttles down so it doesn't compete with player trade:

```
playerVolume = sum(TradeHistory) over the last PLAYER_VOLUME_WINDOW_MS in the region
playerPressure = playerVolume / PROSPERITY_TARGET_VOLUME
displacement = clamp(playerPressure * PLAYER_DISPLACEMENT_FACTOR, 0, 1)
effectiveBudget = FLOW_BUDGET * (1 - displacement)
```

If `effectiveBudget < 1` the region is fully displaced and no flow occurs for that run (pruning still runs).

`PLAYER_VOLUME_WINDOW_MS` is a wall-clock sliding window so player activity bursts immediately throttle flow, regardless of tick cadence.

---

## Schema

```prisma
model TradeFlow {
  id           String @id @default(cuid())
  tick         Int
  fromSystemId String
  toSystemId   String
  goodId       String
  quantity     Int

  fromSystem StarSystem @relation("TradeFlowsFrom", fields: [fromSystemId], references: [id])
  toSystem   StarSystem @relation("TradeFlowsTo",   fields: [toSystemId],   references: [id])

  @@index([tick])
  @@index([fromSystemId, tick])
  @@index([toSystemId, tick])
  @@index([goodId, tick])
}
```

Pruning runs at the end of every active processor run: `deleteMany({ where: { tick: { lt: currentTick - FLOW_HISTORY_TICKS } } })`.

---

## Constants

Defined in `lib/constants/trade-simulation.ts`:

```typescript
export const TRADE_SIMULATION = {
  PROCESS_EVERY_N_TICKS: 1,        // every tick — round-robin picks one region per tick
  FLOW_BUDGET: 8,                  // max units moved per edge per run
  GRADIENT_THRESHOLD: 0.05,        // fraction of basePrice below which no flow fires
  GRADIENT_SENSITIVITY: 1.0,       // linear gradient → fraction response
  FLOW_HISTORY_TICKS: 200,         // rolling window for events and route inference
  PLAYER_DISPLACEMENT_FACTOR: 2.0, // player pressure that fully displaces flow
  PLAYER_VOLUME_WINDOW_MS: 60_000, // wall-clock window for "recent" player trade
  ROUTE_INFERENCE_FLOOR: 5,        // minimum cumulative edge flow for route inference
} as const;
```

Values are tuned via the simulator — sweep with `npm run simulate -- --config <file>` before promoting changes.

---

## Player-Facing Surfaces

### Map Overlay

A toggle on the floating overlay-controls cluster (default off) reveals a Pixi particle layer over the galaxy map. Edges with `totalVolume > ROUTE_INFERENCE_FLOOR` get directional flowing particles tinted by the dominant good's tier. Visibility-gated server-side: an edge appears only if at least one endpoint is in the player's visibility set.

A tier-colour legend sits beneath the toggle so first-time players can decode the colour story (raw → green, processed → amber, advanced → cyan). Tier colours live in `lib/constants/good-colors.ts` as the single source of truth.

### Per-System Trade Activity Panel

The system detail panel includes a "Trade Activity" card showing:
- **Top imports** — top goods by inbound volume, each with its top contributing source systems (linked into the detail panel for traversal).
- **Top exports** — mirror view by destination.
- **Volume history** — a 20-bucket sparkline of inbound vs outbound volume over the `FLOW_HISTORY_TICKS` window.

The panel is visibility-gated: an invisible system returns empty data instead of leaking activity intel.

---

## Future Hooks

Edge flow's data outputs enable several player-facing features without needing entities:

**Mission generation** — `TradeFlow` is a natural data source:
- Smuggler interception: high contraband flow on a route → spawn patrol/inspection.
- Trade route disruption: an event blocks an edge → quest to find an alternative.
- Cargo escort: high-value goods flowing along a dangerous route → escort opportunity.
- Market manipulation: dump goods at the destination of a known route to disrupt prices.

**Trade-skill tiered visibility** — once the player-progression system ships, route data can gate by skill: aggregate-only at low tiers, full chains at high tiers, predictive route shifts at master tier (compute forward a few ticks against current gradients).

**Named convoy layer** — if gameplay demand surfaces for interactable entities (pirate prey, escort targets), a small named-convoy layer can be added on top of flow data — visible entities driven by the same flow math, but rendered at far lower count than full NPC simulation would require.

---

## Implementation Notes

Built on the unified processor architecture — see `docs/design/active/processor-architecture.md`. Live game and simulator run the same pure processor body (`runTradeFlowProcessor`) against different adapters (Prisma vs in-memory).
