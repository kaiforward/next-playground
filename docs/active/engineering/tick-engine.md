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
| Economy | Every tick | Events | Simulates one region's markets per tick (round-robin). Applies event modifiers and government effects to each market's stock; applies strike suppression to production (derived from last tick's `unrest`). Records per-system satisfaction (`delivered / demanded`) into `ctx.results` for the population processor |
| Trade Flow | Every tick (work-budget edge slice) | Economy | Simulates inter-system goods flow over the **intra-faction** edge graph (region lines ignored, faction borders closed), distance-attenuated by fuel cost. Each tick processes a slice of `EDGES_PER_TICK` open edges as a cursor sweeps the stable edge order, mutating stock at both endpoints, appending flow events, and incrementing per-system volume. Recent player trade volume at an edge's endpoints throttles that edge's budget toward zero (per-edge displacement). See [trade-simulation.md](../gameplay/trade-simulation.md) |
| Population | Every tick | Economy | Reads per-system satisfaction from `ctx.results`; updates `unrest` (convex demand-weighted dissatisfaction integral); applies logistic population growth/decline (gated by satisfaction + unrest); rewrites `StationMarket.demandRate` for each system's new population level |
| Migration | Every tick (work-budget edge slice) | Population | Relocates population (conserved) along the same intra-faction open-edge topology + work-budget slice as trade-flow; population flows down-unrest / up-headroom (`popCap − population`), distance-attenuated. Gateways throttle migration as they do goods. Produces boom/bust geography over time |
| Trade Missions | Every 5 ticks | Events, Economy | Generates new missions from price extremes and active events. Expires unclaimed/overdue missions. Notifies players |
| Op Missions | Every tick | Events, Economy | Generates patrol/survey/bounty/salvage/recon missions from danger levels and traits. Expires unclaimed missions. Completes timed missions. Fails missions with destroyed/disabled ships |
| Relations | Every 3 ticks | Events | Drifts every faction pair's relation score (border length, cross-faction trade, doctrine, common enemies). Spawns `border_conflict`/`pact_under_negotiation`/`alliance_dissolved` events on threshold crossings, then resolves relations-owned event windows (forms/dissolves alliances, expires events). See [faction-system.md](../gameplay/faction-system.md) |
| Price Snapshots | Every 20 ticks | Economy | Records current prices for all systems into rolling history (max 50 snapshots per system) |
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

## Region Round-Robin

The economy processor doesn't update all markets every tick — it processes one region per tick in round-robin order. With 24 regions (default scale), each region's markets update once every 24 ticks.

This means:
- Markets in different regions can be temporarily out of sync (by up to 24 ticks at default scale)
- Keeps per-tick processing cost constant regardless of total system count
- Scales to 10,000+ systems without performance issues

---

## System Interactions

- **Economy**: Economy processor is the core simulation driver, processing markets with event modifiers (see [economy.md](../gameplay/economy.md))
- **Events**: Events processor manages lifecycle, must run before economy so modifiers are current (see [events.md](../gameplay/events.md))
- **Navigation**: Ship arrivals processor handles transit completion and cargo danger (see [navigation.md](../gameplay/navigation.md))
- **Trading**: Trade missions processor generates contracts from market state (see [trading.md](../gameplay/trading.md))
- **Combat**: Battles processor resolves pirate encounters from bounty missions (see [combat.md](../gameplay/combat.md))
- **Operational Missions**: Missions processor generates patrol/survey/bounty from danger levels and traits (see [combat.md](../gameplay/combat.md))
- **Relations**: Relations processor (every 3 ticks) drifts inter-faction scores and spawns relation events; runs after events so its drift drivers and threshold spawns see the current event state (see [faction-system.md](../gameplay/faction-system.md))
