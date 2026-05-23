# Trade Simulation (Edge Flow)

Status: **Planned** — design complete, depends on processor architecture refactor.

Replaces the earlier `npc-trade-bots.md` design. See "Why not NPC entities?" below for rationale.

## Problem

The economy needs sustained competitive trade pressure between systems. Without it, supply and demand drift to clamp boundaries because production/consumption alone has no spatial restoring force — every market evolves in isolation. Systems start at prosperity 0 (stagnant, 0.7x multiplier) and never recover without active trade.

Player density is far too sparse to provide this pressure: 10-50 players across 10,000 systems cannot create competitive markets through their actions alone.

## Solution: Edge Flow Trade Simulation

Simulate trade as **goods flowing along graph edges** based on local price gradients, rate-limited per edge per tick. No entities exist — flow is pure math on edges and markets. Aggregate metrics (per-system trade volume, per-edge flow history) are stored as data that drives prosperity, mission generation, and player-facing trade route visibility.

The universe contains thousands of unseen merchants in lore; simulating each one explicitly is infeasible at 10K-system scale. Edge flow simulates the *economic effect* of that merchant traffic without the entity overhead.

### Why not NPC entities?

| Concern | NPC entities | Edge flow |
|---|---|---|
| Cost per tick at 10K scale | ~800 strategy evaluations + DB churn | O(edges) of pure math |
| Spawn/despawn churn | High | None |
| Restoring force toward equilibrium | ✅ | ✅ |
| Natural trade routes | Emergent, stochastic | Emergent, deterministic |
| Player-facing route data | Aggregated from NPC movements | First-class table |
| Per-trader P&L sim calibration | ✅ | ❌ (use equilibrium-health metrics instead) |
| Interactable entities (pirate prey, escorts) | ✅ | ❌ (add a small named-convoy layer on top if needed) |
| Composability with factions/production/automation | Each adds NPC variants | Each adds flow rules |

Edge flow gets ~80% of the economic value at ~10-20% of the runtime cost. Interaction features (pirates, escorts, story hooks) can be added as a smaller "named convoy" layer that piggybacks on flow data, separate from the bulk economic simulation.

---

## Design

### Flow Mechanism

For each connection edge `(A, B)` and each tradeable good `g`:

```
priceA = market(A, g).price
priceB = market(B, g).price
gradient = priceB - priceA   // positive means flow goes A → B

if gradient > threshold:
    quantity = min(flowBudget, supplyAvailable, demandCapacity) * f(gradient)
    move `quantity` units of g from A to B
    apply same supply/demand impact a real trade would (uses existing trade math)
    record flow event: { tick, from: A, to: B, goodId: g, quantity }
```

Key properties:
- **Rate-limited**: a per-edge per-tick budget prevents unbounded equalization. Steeper gradients move more, but capped at `FLOW_BUDGET`.
- **Threshold-gated**: small gradients don't trigger flow (avoids noise-driven churn at equilibrium).
- **Reuses trade math**: flows hit markets identically to a player trade — supply decreases at source, demand decreases at destination, both shift `tradeVolumeAccum` to feed prosperity. Pricing layer already handles the rest.
- **One good per edge per evaluation**: simple, and the steepest-gradient good wins. Multiple goods can flow over many ticks.

Chains emerge naturally: a system pulling food from a neighbor lowers that neighbor's supply, which then pulls from *its* neighbor, and so on. This produces real supply chains without programming them.

### Tick Processing

Flow is **slow** — not every tick. Two reasons:

1. Trade should feel deliberate, not jittery. Realistic merchant traffic is on the order of hours, not seconds.
2. Performance: a 10K-system universe has ~30-60K edges. Processing all per tick is unnecessary and expensive.

Approach: process flow in a **round-robin per region** (matching the existing economy processor pattern), every N ticks. With ~25 systems per region and ~3 edges per system, that's ~75 edge evaluations per processor run.

Exact frequency is a tuning parameter (`FLOW_PROCESS_EVERY_N_TICKS`, default candidate: 3-5). The simulator will sweep this to find the value that produces healthy equilibrium without overshoot.

### Aggregate Metrics

Two new data surfaces:

**Per-system rolling counters** (on `Market` or a sibling table — pick during implementation):
- `recentImportVolume` — units imported in the last N ticks (per good or aggregated)
- `recentExportVolume` — units exported in the last N ticks
- Used for prosperity, mission triggers, system "trade activity" labels

**Per-edge flow event log** (`TradeFlow` table):
- `{ tick, fromSystemId, toSystemId, goodId, quantity }`
- Rolling window — events older than `FLOW_HISTORY_TICKS` (e.g. 200 ticks) are pruned
- Indexed on `(tick, fromSystemId)` and `(tick, toSystemId)` for route queries
- Source of truth for route inference and gameplay-facing visibility

### Trade Route Inference

A trade route is a connected sequence of edges where the same good consistently moves in the same direction over a time window. Inference is a derived query on `TradeFlow`:

```
For a given good g and time window [t-W, t]:
1. Group flow events by (fromSystemId, toSystemId, goodId), sum quantities
2. Filter edges with cumulative flow above a noise floor
3. Stitch edges into chains: edge (A→B) connects to edge (B→C) if both moved g in the window
4. Score routes by total volume and consistency
```

Routes are computed on demand (not stored) — the underlying flow events are the truth, routes are a presentation layer over them. Cheaper to recompute when queried than to maintain an updated route table.

### Adaptive Scaling (Player Displacement)

When players are active in a region, flow throttles down — players provide the trade pressure, edge flow shouldn't compete with them.

```
playerPressure = recentPlayerVolume / TARGET_VOLUME
displacement = clamp(playerPressure * DISPLACEMENT_FACTOR, 0, 1)
effectiveFlowBudget = FLOW_BUDGET * (1 - displacement)
```

`recentPlayerVolume` comes from `TradeHistory` filtered to this region (already exists). Easier to tune than NPC despawn — it's just turning down the dial.

---

## Schema Additions

Minimum new state. Most data lives on existing models.

```prisma
model TradeFlow {
  id            String   @id @default(cuid())
  tick          Int
  fromSystemId  String
  toSystemId    String
  goodId        String
  quantity      Int

  fromSystem    StarSystem @relation("TradeFlowsFrom", fields: [fromSystemId], references: [id])
  toSystem      StarSystem @relation("TradeFlowsTo", fields: [toSystemId], references: [id])

  @@index([tick])
  @@index([fromSystemId, tick])
  @@index([toSystemId, tick])
  @@index([goodId, tick])
}
```

Rolling window — a pruning step runs at the end of the flow processor: `DELETE FROM TradeFlow WHERE tick < currentTick - FLOW_HISTORY_TICKS`.

Open question (defer to implementation): do per-system aggregate counters get their own columns on `Market`, or are they computed on demand from `TradeFlow`? Trade-off is read cost (per-tick aggregate query) vs write cost (counter updates every flow). Likely a derived materialized view or cached counters on Market.

---

## Constants

New constants in `lib/constants/trade-simulation.ts`:

```typescript
export const TRADE_SIMULATION = {
  /** Process flow every N ticks (round-robin per region). */
  PROCESS_EVERY_N_TICKS: 4,
  /** Max units of one good moved per edge per processor run. */
  FLOW_BUDGET: 8,
  /** Price gradient threshold below which no flow occurs. */
  GRADIENT_THRESHOLD: 0.05,
  /** How aggressively flow responds to gradient (1.0 = linear). */
  GRADIENT_SENSITIVITY: 1.0,
  /** Window for flow history retention and route inference. */
  FLOW_HISTORY_TICKS: 200,
  /** Player activity fully displaces edge flow at this multiple of TARGET_VOLUME. */
  PLAYER_DISPLACEMENT_FACTOR: 2.0,
  /** Minimum cumulative flow on an edge to count toward route inference. */
  ROUTE_INFERENCE_FLOOR: 5,
} as const;
```

All values are placeholders for sim-driven tuning.

---

## Gameplay Hooks

Edge flow's data outputs (trade volume per system, flow chains, route data) enable several player-facing features without needing entities:

### Trade-Skill Tiered Visibility

Player trade skill (future progression stat) gates how much flow data they see:

| Skill Tier | What players see |
|---|---|
| None | Their own trade history only |
| Local | Aggregate import/export volume for their current system |
| Regional | Trade volume heat map across their current region |
| Galactic | Cross-region route chains (which goods flow where over time) |
| Master | Predictive route shifts — "this route will reverse in N ticks based on current gradients" |

Master-tier predictions are computed by running the flow math forward a few ticks against current gradients. A real economic edge for high-skill traders.

### Mission Generation Hooks

`TradeFlow` becomes a data source for procedurally generated missions:

- **Smuggler interception**: high contraband flow on a route → spawn patrol/inspection mission
- **Trade route disruption**: an event blocks an edge → quest to find an alternative
- **Cargo escort**: high-value goods flowing along a dangerous route → escort opportunity
- **Market manipulation**: dump goods at the destination of a known route to disrupt prices
- **Supply intelligence**: faction missions to report on routes through rival territory

### Visualizations

- Map overlay: edge thickness = recent flow volume, edge color = good type or direction
- System detail panel: "Trade Activity" label (already in prosperity tiers from `economy-tuning.md`) + top imported/exported goods
- Route browser screen at high trade skill — explore the chains visible to the player

---

## Implementation Phases

Depends on processor architecture refactor landing first — see `docs/design/planned/processor-architecture.md`.

### Phase 1: Core flow processor
- `TradeFlow` Prisma model + indexes
- `lib/constants/trade-simulation.ts`
- Flow processor written against the new processor interface — pure math, operates on adapter
- Edge enumeration + gradient calculation + budget-limited movement
- Reuse existing trade math (supply/demand impact, prosperity contribution)
- Flow event logging + rolling window prune

### Phase 2: Aggregate metrics + prosperity wiring
- Per-system import/export volume (column or derived view, decide during build)
- Wire into existing prosperity calculation (treat flow volume same as player trade volume)
- Expose in dynamic tiles API for map visualization
- "Trade Activity" label on system detail panel

### Phase 3: Route inference + map visualization
- Route query: stitch flow events into chains, score by volume
- Map overlay for edge flow (thickness, color)
- System detail "top imports/exports" list

### Phase 4: Gameplay integration
- Trade skill visibility tiers (depends on player progression doc)
- Mission generation hooks (depends on Layer 2/3 mission system)
- Tuning sweep across `PROCESS_EVERY_N_TICKS`, `FLOW_BUDGET`, `GRADIENT_THRESHOLD`

---

## Risks

- **Over-equalization**: if `FLOW_BUDGET` is too high or `GRADIENT_THRESHOLD` too low, prices flatten across the universe. Mitigation: budget is small (single-digit units per edge per run), threshold is non-trivial, frequency is slow. Sim sweeps will pin the right values.
- **Flow oscillation**: a flow A→B that lowers A's price below B's could trigger reverse flow next tick. Mitigation: threshold prevents micro-reversals; in practice production/consumption between flows lets the gradient stabilize.
- **TradeFlow table growth**: at full scale this could be 60K edges × multiple events per window. Pruning is critical. Index strategy needs validation under load.
- **Loss of interaction surface**: no NPC ships means no pirate prey, no escort targets, no flavour of "ship arrives at station." If those features matter, a smaller named-convoy layer can be added on top — driven by flow data but rendered as visible entities at much lower count than full NPC simulation would require.

---

## Open Questions

- Whether per-system aggregate counters live as columns on `Market` or are computed from `TradeFlow` on demand. Depends on read frequency in UI.
- Whether flow processes goods individually or batches them per edge. Individual is simpler; batched might be more efficient.
- Whether the named-convoy interaction layer ships in v1 or waits for explicit demand from gameplay (recommended: wait — ship the cheap thing first, see what's missing).
