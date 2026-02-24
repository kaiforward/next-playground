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

7 processors run sequentially each tick in topologically sorted order. Processors declare dependencies to ensure correct execution order.

```
Ship Arrivals ──────────────────────────────────┐
  └→ Battles (depends on: ship-arrivals) ───────┤
Events ─────────────────────────────────────────┤
  └→ Economy (depends on: events) ──────────────┤
       └→ Trade Missions (depends on: events, economy)
       └→ Op Missions (depends on: events, economy)
       └→ Price Snapshots (depends on: economy) ┘
```

### Processor Details

| Processor | Frequency | Dependencies | What It Does |
|---|---|---|---|
| Ship Arrivals | Every tick | None | Lands ships that have reached their arrival tick. Runs 4-stage cargo danger pipeline (hazard, tax, contraband, loss). Activates operational missions on arrival (bounty → battle creation, patrol/survey → commitment start). Notifies players of arrivals and losses |
| Battles | Every tick | Ship Arrivals | Resolves active battle rounds (every 6 ticks). Updates strength/morale, checks for victory/defeat/retreat. Applies ship damage and credits rewards on resolution |
| Events | Every tick | None | Advances event phases, expires completed events, spreads events to neighbors, spawns new events (every 20 ticks) |
| Economy | Every tick | Events | Simulates one region's markets per tick (round-robin). Applies event modifiers and government effects to supply/demand |
| Trade Missions | Every 5 ticks | Events, Economy | Generates new missions from price extremes and active events. Expires unclaimed/overdue missions. Notifies players |
| Op Missions | Every 5 ticks | Events, Economy | Generates patrol/survey/bounty missions from danger levels and traits. Expires unclaimed missions. Completes timed missions (patrol/survey). Fails missions with destroyed/disabled ships |
| Price Snapshots | Every 20 ticks | Economy | Records current prices for all systems into rolling history (max 50 snapshots per system) |

### Execution Model
- All processors run inside a single transaction — all updates commit atomically
- If one processor fails, others still run (error isolation with logging)
- Performance is monitored: warns if total tick processing exceeds 80% of tick rate

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

The economy processor doesn't update all markets every tick — it processes one region per tick in round-robin order. With 8 regions, each region's markets update once every 8 ticks.

This means:
- Markets in different regions can be temporarily out of sync (by up to 8 ticks)
- Keeps per-tick processing cost constant regardless of total system count
- Scales to 1000+ systems without performance issues

---

## System Interactions

- **Economy**: Economy processor is the core simulation driver, processing markets with event modifiers (see [economy.md](./economy.md))
- **Events**: Events processor manages lifecycle, must run before economy so modifiers are current (see [events.md](./events.md))
- **Navigation**: Ship arrivals processor handles transit completion and cargo danger (see [navigation.md](./navigation.md))
- **Trading**: Trade missions processor generates contracts from market state (see [trading.md](./trading.md))
- **Combat**: Battles processor resolves pirate encounters from bounty missions (see [combat.md](./combat.md))
- **Operational Missions**: Missions processor generates patrol/survey/bounty from danger levels and traits (see [combat.md](./combat.md))
