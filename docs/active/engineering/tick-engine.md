# Tick Engine

The game clock and processor pipeline that advances the simulation. All game state changes happen through tick processors running in a deterministic sequence.

---

## Game Clock

The tick advances against an **in-memory world** paced by a single in-process loop (`TickLoop`, `lib/world/tick-loop.ts`) — see [single-player-runtime.md](./single-player-runtime.md) for the store, save format, and lifecycle.

- **Speed dial**: cadence is a pure game-feel control — `paused · 1 tick/s · 5 ticks/s · max`. There is no fixed real-time tick rate.
- **Max speed**: a yielding loop — tick for a ~50 ms budget, then yield the event loop so HTTP requests and the map stay responsive; the UI reports *achieved* ticks/sec rather than promising a rate.
- **Advancement**: each fire increments `meta.currentTick` and runs `runWorldTick` (all active processors). One loop owns advancement, so ticks never contend — there is no optimistic lock and no multi-instance coordination.
- **Determinism**: `Date.now`/timers pace the loop only; tick math takes a seeded per-tick RNG (`tickRng(seed, tick)`) and never reads the wall clock.

---

## Processor Pipeline

10 processors run sequentially each tick in topologically sorted order. Processors declare dependencies to ensure correct execution order.

```
Ship Arrivals ────────────────────────────────────────┐
Events ──────────────────────────────────────────────┤
  └→ Economy (depends on: events) ─────────────────── ┤
  │    └→ Trade Flow (depends on: economy) ───────────┤
  │    └→ Infrastructure Decay (depends on: economy) ─┤
  │    └→ Population (depends on: economy, infra-decay)┤
  │         └→ Migration (depends on: population) ────┤
  │    └→ Directed Logistics (depends on: economy) ───┤
  │         └→ Directed Build (depends on: d-logistics)┘
  └→ Relations (depends on: events, every 3 ticks)
```

**Economy → Population in-memory handoff:** the economy processor records per-system satisfaction (`delivered_g / demanded_g` for each good it processes this tick) into `ctx.results` — a transient in-memory store that lives only for the duration of that tick. The population processor reads this from `ctx.results` in the same tick to compute dissatisfaction `D` and update `unrest` — no second pass over world state. This data is never persisted or broadcast to clients.

### Processor Details

| Processor | Frequency | Dependencies | What It Does |
|---|---|---|---|
| Ship Arrivals | Every tick | None | Docks ships that have reached their arrival tick (status → docked, destination/arrival fields cleared) and emits `shipArrived` events. Currently dormant — world-gen seeds no ships (player fleets are planned) — but present in the pipeline |
| Events | Every tick | None | Advances event phases, expires completed events, spreads events to neighbors, spawns new events (every 20 ticks) |
| Economy | Every tick | Events | Processes ~`total/ECONOMY_UPDATE_INTERVAL` systems each tick (sorted by id via `shardRange`), so every system refreshes every `ECONOMY_UPDATE_INTERVAL` (24) ticks at any scale. Applies event modifiers and government effects to each market's stock; applies strike suppression to production (derived from last tick's `unrest`). Applied rates × `catchUpFactor` (= 1 at the reference interval). Records per-system satisfaction (`delivered / demanded`) into `ctx.results` for the population processor |
| Trade Flow | Every tick (fixed-interval edge shard) | Economy | Simulates inter-system goods flow over the **intra-faction** edge graph (region lines ignored, faction borders closed), distance-attenuated by fuel cost. Each tick processes `shardRange(totalEdges, tick, ECONOMY_UPDATE_INTERVAL)` over the stable edge order — full sweep takes `ECONOMY_UPDATE_INTERVAL` ticks at any scale. Per-edge amount × `catchUpFactor`. Mutates stock at both endpoints, appends flow events, increments per-system volume. See [trade-simulation.md](../gameplay/trade-simulation.md) |
| Infrastructure Decay | Every tick (economy shard) | Economy | Shrinks `WorldBuilding.count` **downward only** toward what is *used* — disuse decay where built exceeds staffed-and-selling (`count × min(labourFulfillment, outputUptake)`) or housing occupancy (`population / POP_CENTRE_DENSITY`), plus a catastrophic unrest teardown above θ_decay. Acts only on the economy's just-processed shard (read off `ctx.results`, incl. per-good output uptake); applies `count` deltas in one pass and recomputes `popCap` live from the surviving housing. Never raises a count or goes below 0 |
| Population | Every tick | Economy, Infrastructure Decay | Reads per-system satisfaction from `ctx.results`; updates `unrest` (convex demand-weighted dissatisfaction integral); applies logistic population growth/decline against the **live** post-decay `popCap`; housing-overshoot (`population > popCap`, the unrest-snowball case) sheds the excess as unrest-weighted death (the conserved migration half rides the migration processor); rewrites `WorldMarket.demandRate` for each system's new population level |
| Migration | Every tick (fixed-interval edge shard) | Population | Relocates population (conserved) along the same intra-faction open-edge topology + fixed-interval edge shard as trade-flow; population flows down-unrest / up-headroom (`popCap − population`), distance-attenuated, per-edge amount × `catchUpFactor`. Gateways throttle migration as they do goods. Produces boom/bust geography over time |
| Directed Logistics | Every tick (economy shard) | Economy | Silent, budgeted surplus→deficit goods redistribution within each faction — routes stock from surplus systems to deficit systems the passive trade flow can't reach. See [economy-autonomic-agency.md](../gameplay/economy-autonomic-agency.md) |
| Directed Build | Every tick (economy shard) | Directed Logistics | Autonomic construction: proactive housing where population wants to grow, labour-gated industry where staffing and input self-supply support it. See [economy-autonomic-agency.md](../gameplay/economy-autonomic-agency.md) |
| Relations | Every 3 ticks | Events | Drifts every faction pair's relation score (border length, cross-faction trade, doctrine, common enemies). Spawns `border_conflict`/`pact_under_negotiation`/`alliance_dissolved` events on threshold crossings, then resolves relations-owned event windows (forms/dissolves alliances, expires events). See [faction-system.md](../gameplay/faction-system.md) |

### Execution Model
- `runWorldTick` (`lib/world/tick.ts`) runs the processor bodies against in-memory adapters and produces the next world. It is the **one shared tick body** — the live loop and the calibration harness both call it (see [processor-architecture.md](./processor-architecture.md)).
- Atomicity comes from the store, not a transaction: the loop only `setWorld`s a **fully-successful** tick. If any processor throws, the error propagates, the loop **hard-pauses**, the broken world is never committed or autosaved, and `currentTick` does not advance.
- Signals hand off between stages through the transient in-memory `TickContext.results` map (never persisted, never broadcast).

---

## Event Delivery (SSE)

After a successful tick, the `TickLoop` broadcasts a `TickBroadcast` frame (`{ currentTick, speed, achievedTps, events }`) to SSE subscribers. Single-player, so the stream is **single-client transport** — the old multiplayer fan-out and per-player event scoping are gone.

- **Throttled to ~4 emits/sec** (250 ms, latest-wins) so `max` speed can't melt the client — per-tick delivery was never a contract.
- A connecting client seeds its tick state from `GET /api/game/world` so its position is correct before the first frame.
- A client-side hook dispatches events to listeners; a query-invalidation hook refreshes the relevant TanStack Query caches as the world advances.

---

## Shard schedule

The economy, trade-flow, and migration processors all run every tick but each only process a *slice* of their data — a fixed-interval shard that spreads work evenly across `ECONOMY_UPDATE_INTERVAL` (24) ticks.

**Scale-invariant by design.** The shard is decoupled from the region/territory concept — regions are *only* territory now (faction borders, names, gateway rendering). Under the old region round-robin, economy advanced once every `regionCount` ticks, so a 10k universe (60 regions) ran 2.5× slower per system than the 600-system default (24 regions). The fixed-interval shard pins every system to refresh every `ECONOMY_UPDATE_INTERVAL` ticks regardless of universe size.

**`catchUpFactor` normalization.** Each sharded processor multiplies its applied amounts by `catchUpFactor(interval) = interval / REFERENCE_INTERVAL`. At the reference interval (24), the factor is 1 — the default scale is behavior-identical to before. At any other interval the economic *rate* (applied amount per tick) stays constant: `rate = factor × calibrated_amount / interval = calibrated_amount / REFERENCE_INTERVAL`. This makes the interval a pure **granularity/perf knob** — changing it speeds or slows per-tick work without touching gameplay rates.

**Three independent knobs:**

| Knob | Meaning | Default |
|---|---|---|
| **Tick rate** | wall-clock pacing per tick | player speed dial (`paused` / `1`/s / `5`/s / `max`) |
| **Update interval** | game-ticks between refreshes per item | `ECONOMY_UPDATE_INTERVAL` = 24 (economy/flow/migration) |
| **Throughput / shard size** | items processed per tick | *derived* (`total / interval`); ceiling is the perf limit |

**Cross-cadence coherence.** Trade-flow and migration share the same `ECONOMY_UPDATE_INTERVAL` as economy, so production and flow advance on one unified clock at every scale.

**Resolved design questions:**
- *Bursty vs catch-up* — fixed interval + `catchUpFactor`; processing-everything-per-tick was ~16s/tick at 10k (3× over budget, measured).
- *Cross-cadence coherence* — flow/migration on the same clock as economy; one unified economy clock at all scales.
- *Population-signal cadence* — population already follows the economy's processed set (reads `ctx.results`); it follows the new shard unchanged.

---

## System Interactions

- **Economy**: Economy processor is the core simulation driver, processing markets with event modifiers (see [economy.md](../gameplay/economy.md))
- **Events**: Events processor manages lifecycle, must run before economy so modifiers are current (see [events.md](../gameplay/events.md))
- **Navigation**: Ship arrivals processor handles transit completion (see [navigation.md](../gameplay/navigation.md))
- **Relations**: Relations processor (every 3 ticks) drifts inter-faction scores and spawns relation events; runs after events so its drift drivers and threshold spawns see the current event state (see [faction-system.md](../gameplay/faction-system.md))
