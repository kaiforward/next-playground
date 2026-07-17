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

9 processors run sequentially each tick in topologically sorted order. Processors declare dependencies to ensure correct execution order. Two cadences interleave: a **daily heartbeat** (ship arrivals, events) advances every tick, while a **monthly resolution pulse** (economy → infrastructure decay → population → migration → directed logistics → directed build) resolves the whole galaxy together on the month boundary and no-ops on every other tick. See [Cadence](#cadence-daily-heartbeat--monthly-resolution-pulse).

```
Ship Arrivals ────────────────────────────────────────┐
Events ──────────────────────────────────────────────┤
  └→ Economy (depends on: events) ─────────────────── ┤
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
| Ship Arrivals | Daily (every tick) | None | Docks ships that have reached their arrival tick (status → docked, destination/arrival fields cleared) and emits `shipArrived` events. Currently dormant — world-gen seeds no ships (player fleets are planned) — but present in the pipeline |
| Events | Daily (every tick) | None | Advances event phases, expires completed events, spreads events to neighbors, spawns new events (every 20 ticks) |
| Economy | Monthly pulse | Events | On the month boundary (`tick % MONTH_LENGTH === 0`) resolves the **whole galaxy** at once (`pulseShard`); no-ops otherwise. Applies event modifiers and government effects to each market's stock; applies strike suppression to production (derived from last month's `unrest`). Applied rates × `catchUpFactor` (= 1 at the reference interval → one full month's magnitude per resolution). Records per-system satisfaction (`delivered / demanded`) into `ctx.results` for infrastructure-decay and population |
| Infrastructure Decay | Monthly pulse | Economy | Shrinks `WorldBuilding.count` **downward only** toward what is *used* — disuse decay where built exceeds staffed-and-selling (`count × min(labourFulfillment, outputUptake)`) or housing occupancy (`population / POP_CENTRE_DENSITY`), plus a catastrophic unrest teardown above θ_decay. Runs only when the economy resolved this tick (reads its `economySignals` off `ctx.results`, incl. per-good output uptake), so it inherits the monthly pulse; applies `count` deltas in one pass and recomputes `popCap` live from the surviving housing. Never raises a count or goes below 0 |
| Population | Monthly pulse | Economy, Infrastructure Decay | Runs only when the economy resolved this tick (same `economySignals` gate → monthly). Reads per-system satisfaction from `ctx.results`; updates `unrest` (convex demand-weighted dissatisfaction integral); applies logistic population growth/decline against the **live** post-decay `popCap`; housing-overshoot (`population > popCap`, the unrest-snowball case) sheds the excess as unrest-weighted death (the conserved migration half rides the migration processor); rewrites `WorldMarket.demandRate` for each system's new population level |
| Migration | Monthly pulse | Population | On the month boundary relocates population (conserved) over the whole intra-faction open-edge topology (`pulseShard`); population flows down-unrest / up-headroom (`popCap − population`), distance-attenuated, per-edge amount × `catchUpFactor`. Gateways throttle migration as they do goods. Produces boom/bust geography over time |
| Directed Logistics | Monthly pulse | Economy | On the month boundary every faction redistributes surplus→deficit goods within its territory (`pulseShard`) — the sole mechanism that moves goods between systems. See [economy-autonomic-agency.md](../gameplay/economy-autonomic-agency.md) |
| Directed Build | Monthly pulse | Directed Logistics | On the month boundary every faction plans construction (`pulseShard`): proactive housing where population wants to grow, labour-gated industry where staffing and input self-supply support it. See [economy-autonomic-agency.md](../gameplay/economy-autonomic-agency.md) |
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

## Cadence: daily heartbeat + monthly resolution pulse

Two clocks interleave inside the single tick loop.

**Daily heartbeat — every tick.** Ship arrivals and event progression advance on every tick.

**Monthly resolution pulse — one tick a month.** On the month boundary (`tick % MONTH_LENGTH === 0`, `MONTH_LENGTH` = 24) the whole galaxy's faction-scale accounting resolves together, in dependency order: **economy → infrastructure decay → population → migration → directed logistics → directed build**. This is synchronized, not round-robin — every system's economy and every faction's logistics/build fire on the *same* tick, so a Paradox-style monthly settle replaces the old per-item rolling shard. Economy, migration, directed-logistics and directed-build gate on `pulseShard` (whole list on the boundary, empty otherwise); infrastructure-decay and population run only when the economy produced `economySignals` this tick, so they inherit the same monthly cadence automatically.

The pulse stages' **setup** — their adapters, the participation set, the open-edge graph, the per-system market row groups — is gated in `runWorldTick` on `isPulseTick`, the same predicate `pulseShard` is built from, rather than built off-pulse and discarded. The gate is an optimisation and the bodies still bail internally; the shared predicate is what keeps the two from drifting apart. Off-pulse the economy stage emits the same `economyTick` broadcast the body would have (`economyOffPulsePayload`), so the per-tick signal the UI invalidates on is unchanged.

**`catchUpFactor` normalization.** The rate-based resolvers (economy, migration) multiply their applied amounts by `catchUpFactor(interval) = interval / REFERENCE_INTERVAL`. At the pulse period (24 = the reference interval) the factor is 1, so one monthly resolution applies exactly one calibrated month's worth of production/consumption/migration — the per-system magnitude is unchanged from a rolling shard that touched each system once per `ECONOMY_UPDATE_INTERVAL`. Directed logistics (a level-fill toward the days-of-supply anchor) and directed build (a pool-funded per-cycle commitment toward the physical ceilings) take **no** catch-up scaling — scaling an absolute fill by the interval would overshoot the target.

**Scale-invariance.** The pulse resolves the whole galaxy in one pass regardless of universe size. Sharding is a pure performance/topology concern — decoupled from the region/territory concept (regions are *only* territory: faction borders, names, gateway rendering).

**Knobs:**

| Knob | Meaning | Default |
|---|---|---|
| **Tick rate** | wall-clock pacing per tick | player speed dial (`paused` / `1`/s / `5`/s / `max`) |
| **Month length** | ticks between whole-galaxy resolution pulses | `MONTH_LENGTH` = 24 |

---

## System Interactions

- **Economy**: Economy processor is the core simulation driver, processing markets with event modifiers (see [economy.md](../gameplay/economy.md))
- **Events**: Events processor manages lifecycle, must run before economy so modifiers are current (see [events.md](../gameplay/events.md))
- **Navigation**: Ship arrivals processor handles transit completion (see [navigation.md](../gameplay/navigation.md))
- **Relations**: Relations processor (every 3 ticks) drifts inter-faction scores and spawns relation events; runs after events so its drift drivers and threshold spawns see the current event state (see [faction-system.md](../gameplay/faction-system.md))
