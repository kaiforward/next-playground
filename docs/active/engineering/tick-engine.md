# Tick Engine

The game clock and processor pipeline that advances the simulation. All game state changes happen through tick processors running in a deterministic sequence.

---

## Game Clock

- **Tick rate**: 5000ms (5 seconds) between ticks in production. Configurable via dev tools for testing.
- **Polling**: Engine checks every 1000ms if enough real time has elapsed to advance.
- **Advancement**: When elapsed >= tick rate, the tick counter increments and all active processors run.
- **Concurrency safety**: Optimistic locking ensures only one server instance advances the tick (important for multi-instance deployments).

---

## Processor Pipeline

12 processors run sequentially each tick in topologically sorted order. Processors declare dependencies to ensure correct execution order.

```
Ship Arrivals ────────────────────────────────────────┐
  └→ Battles (depends on: ship-arrivals) ─────────────┤
Events ──────────────────────────────────────────────┤
  └→ Economy (depends on: events) ─────────────────── ┤
  │    └→ Trade Flow (depends on: economy) ───────────┤
  │    └→ Population (depends on: economy) ──────────┤
  │         └→ Migration (depends on: population) ────┤
  │    └→ Trade Missions (depends on: events, economy)
  │    └→ Op Missions (depends on: events, economy)
  │    └→ Price Snapshots (depends on: economy) ──────┘
  └→ Relations (depends on: events, every 3 ticks)
Notification Prune (independent, every 50 ticks)
```

**Economy → Population in-memory handoff:** the economy processor records per-system satisfaction (`delivered_g / demanded_g` for each good it processes this tick) into `ctx.results` — a transient in-memory store that lives only for the duration of that tick. The population processor reads this from `ctx.results` in the same tick to compute dissatisfaction `D` and update `unrest` without an extra database round-trip. This data is never persisted or broadcast to clients.

### Processor Details

| Processor | Frequency | Dependencies | What It Does |
|---|---|---|---|
| Ship Arrivals | Every tick | None | Lands ships that have reached their arrival tick. Runs 5-stage cargo danger pipeline (hazard, tax, contraband, loss, hull/shield damage). Notifies players of arrivals and losses |
| Battles | Every tick | Ship Arrivals | Resolves active battle rounds (every 6 ticks). Updates strength/morale, checks for victory/defeat/retreat. Applies ship damage and credits rewards on resolution |
| Events | Every tick | None | Advances event phases, expires completed events, spreads events to neighbors, spawns new events (every 20 ticks) |
| Economy | Every tick | Events | Processes ~`total/ECONOMY_UPDATE_INTERVAL` systems each tick (sorted by id via `shardRange`), so every system refreshes every `ECONOMY_UPDATE_INTERVAL` (24) ticks at any scale. Applies event modifiers and government effects to each market's stock; applies strike suppression to production (derived from last tick's `unrest`). Applied rates × `catchUpFactor` (= 1 at the reference interval). Records per-system satisfaction (`delivered / demanded`) into `ctx.results` for the population processor |
| Trade Flow | Every tick (fixed-interval edge shard) | Economy | Simulates inter-system goods flow over the **intra-faction** edge graph (region lines ignored, faction borders closed), distance-attenuated by fuel cost. Each tick processes `shardRange(totalEdges, tick, ECONOMY_UPDATE_INTERVAL)` over the stable edge order — full sweep takes `ECONOMY_UPDATE_INTERVAL` ticks at any scale. Per-edge amount × `catchUpFactor`. Mutates stock at both endpoints, appends flow events, increments per-system volume. Recent player trade volume throttles edge budget toward zero (per-edge displacement). See [trade-simulation.md](../gameplay/trade-simulation.md) |
| Population | Every tick | Economy | Reads per-system satisfaction from `ctx.results`; updates `unrest` (convex demand-weighted dissatisfaction integral); applies logistic population growth/decline (gated by satisfaction + unrest); rewrites `StationMarket.demandRate` for each system's new population level |
| Migration | Every tick (fixed-interval edge shard) | Population | Relocates population (conserved) along the same intra-faction open-edge topology + fixed-interval edge shard as trade-flow; population flows down-unrest / up-headroom (`popCap − population`), distance-attenuated, per-edge amount × `catchUpFactor`. Gateways throttle migration as they do goods. Produces boom/bust geography over time |
| Trade Missions | Every tick | Events, Economy | Housekeeping (expiry) runs every tick. *Generation* runs on the mission-generation shard (`MISSION_GEN_INTERVAL`, 120): economy/price-extreme generation is sharded; event-driven generation stays responsive. Notifies players |
| Op Missions | Every tick | Events, Economy | Housekeeping (expiry/completion/failure) runs every tick. *Generation* runs on the `MISSION_GEN_INTERVAL` shard (patrol/survey/bounty/salvage/recon from danger levels and traits) |
| Relations | Every 3 ticks | Events | Drifts every faction pair's relation score (border length, cross-faction trade, doctrine, common enemies). Spawns `border_conflict`/`pact_under_negotiation`/`alliance_dissolved` events on threshold crossings, then resolves relations-owned event windows (forms/dissolves alliances, expires events). See [faction-system.md](../gameplay/faction-system.md) |
| Price Snapshots | Every tick | Economy | Folded onto the economy shard (`dependsOn: economy`): snapshots only the systems economy just processed, so each system is snapshotted every `ECONOMY_UPDATE_INTERVAL` (24) ticks. Retains a rolling history (max 50 snapshots per system) |
| Notification Prune | Every 50 ticks | None | Deletes old notifications past their max age to prevent unbounded growth |

### Execution Model
- All processors run inside a single transaction — all updates commit atomically
- If one processor fails, the error is re-thrown and the entire tick transaction aborts (PostgreSQL invalidates the connection after any query error, so continuing would cascade failures). The tick counter only advances if all processors succeed.
- Performance is monitored via per-processor timing logged after each tick

---

## Event Delivery (SSE)

After all processors complete, results are broadcast to connected clients via Server-Sent Events.

### Two Event Scopes
- **Global events**: Broadcast to every connected client (economy ticks, event notifications, mission updates, price snapshots)
- **Player-scoped events**: Sent only to the specific player (ship arrivals, cargo losses, mission expirations)

### Client Integration
- Clients connect to SSE endpoint on page load
- Initial tick state is seeded from a REST endpoint (so transit ETAs are correct before SSE connects)
- Client-side hook dispatches events to listeners
- Query invalidation hook automatically refreshes relevant TanStack Query caches when events arrive (e.g., ship arrival invalidates fleet + market data)

---

## Shard schedule

The economy, trade-flow, migration, and price-snapshot processors all run every tick but each only process a *slice* of their data — a fixed-interval shard that spreads work evenly across `ECONOMY_UPDATE_INTERVAL` (24) ticks. Mission *generation* (trade and operational) runs on its own longer shard (`MISSION_GEN_INTERVAL`, 120); mission housekeeping stays every tick.

**Scale-invariant by design.** The shard is decoupled from the region/territory concept — regions are *only* territory now (faction borders, names, gateway rendering). Under the old region round-robin, economy advanced once every `regionCount` ticks, so a 10k universe (60 regions) ran 2.5× slower per system than the 600-system default (24 regions). The fixed-interval shard pins every system to refresh every `ECONOMY_UPDATE_INTERVAL` ticks regardless of universe size.

**`catchUpFactor` normalization.** Each sharded processor multiplies its applied amounts by `catchUpFactor(interval) = interval / REFERENCE_INTERVAL`. At the reference interval (24), the factor is 1 — the default scale is behavior-identical to before. At any other interval the economic *rate* (applied amount per tick) stays constant: `rate = factor × calibrated_amount / interval = calibrated_amount / REFERENCE_INTERVAL`. This makes the interval a pure **granularity/perf knob** — changing it speeds or slows per-tick work without touching gameplay rates.

**Three independent knobs:**

| Knob | Meaning | Default |
|---|---|---|
| **Tick rate** | wall-clock ms per tick | 5000ms |
| **Update interval** | game-ticks between refreshes per item | `ECONOMY_UPDATE_INTERVAL` = 24 (economy/flow/migration/snapshots); `MISSION_GEN_INTERVAL` = 120 (mission generation) |
| **Throughput / shard size** | items processed per tick | *derived* (`total / interval`); ceiling is the perf limit |

**Cross-cadence coherence.** Trade-flow and migration share the same `ECONOMY_UPDATE_INTERVAL` as economy, so production and flow advance on one unified clock at every scale. Price snapshots are folded onto the economy shard and fire immediately after economy processes each system, keeping snapshot cadence aligned.

**Resolved design questions:**
- *Bursty vs catch-up* — fixed interval + `catchUpFactor`; processing-everything-per-tick was ~16s/tick at 10k (3× over budget, measured).
- *Cross-cadence coherence* — flow/migration on the same clock as economy; one unified economy clock at all scales.
- *Population-signal cadence* — population already follows the economy's processed set (reads `ctx.results`); it follows the new shard unchanged.

---

## System Interactions

- **Economy**: Economy processor is the core simulation driver, processing markets with event modifiers (see [economy.md](../gameplay/economy.md))
- **Events**: Events processor manages lifecycle, must run before economy so modifiers are current (see [events.md](../gameplay/events.md))
- **Navigation**: Ship arrivals processor handles transit completion and cargo danger (see [navigation.md](../gameplay/navigation.md))
- **Trading**: Trade missions processor generates contracts from market state (see [trading.md](../gameplay/trading.md))
- **Combat**: Battles processor resolves pirate encounters from bounty missions (see [combat.md](../gameplay/combat.md))
- **Operational Missions**: Missions processor generates patrol/survey/bounty from danger levels and traits (see [combat.md](../gameplay/combat.md))
- **Relations**: Relations processor (every 3 ticks) drifts inter-faction scores and spawns relation events; runs after events so its drift drivers and threshold spawns see the current event state (see [faction-system.md](../gameplay/faction-system.md))
