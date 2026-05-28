# Tick Engine Redesign — Processor Pipeline

## Problem

The current `TickEngine` is a monolithic class where every tick-driven system (ship arrivals, economy simulation) lives inside a single `tick()` method in one Prisma transaction. Adding new systems (NPC trading, events, production) means editing this method directly, growing the transaction, and coupling unrelated concerns. This won't scale to hundreds of systems with thousands of goods.

## Design Goals

1. **Adding a system = adding one file + one registry line.** No modification to the engine itself.
2. **Each processor is independently testable** — pure-ish async functions with typed inputs/outputs.
3. **Frequency control with phase offsets** — processors declare a frequency (run every N ticks) and an optional offset (phase shift) so processors with the same frequency can be staggered across different ticks. At scale the tick rate stays reasonable but expensive systems run infrequently.
4. **Dependency graph** — processors declare what they depend on. Independent processors can run in parallel (future PostgreSQL). Priority is derived from the graph, not manually assigned.
5. **Future-proof for PostgreSQL** — shared transaction today (SQLite), independent parallel transactions later. Processor code doesn't change when the boundary changes.
6. **Per-player event scoping** — clients only receive events relevant to them.
7. **Error isolation** — one failing processor doesn't kill the tick.
8. **Idempotency-aware** — design accommodates per-processor completion tracking for the eventual move to independent transactions.

## Architecture Overview

```
lib/tick/
  engine.ts              — Scheduler: polls, advances tick, runs processors, emits events
  types.ts               — TickProcessor, TickContext, TickResult, event types
  registry.ts            — Registers all processors, topological sort on dependsOn
  processors/
    ship-arrivals.ts     — Every tick, no dependencies
    economy.ts           — Every N ticks, no dependencies (future: includes ambient NPC trade pressure)
    random-events.ts     — Every K ticks, no dependencies (future)
    production.ts        — Every J ticks, depends on: economy (future)
    npc-agents.ts        — Every M ticks, no dependencies (future, distinct gameplay NPCs only)
```

The existing `lib/tick-engine.ts` is replaced by `lib/tick/engine.ts`. The existing pure functions in `lib/engine/tick.ts` are reused inside the new processors.

## Core Types

```typescript
// lib/tick/types.ts

import type { PrismaClient } from "@/app/generated/prisma/client";

/** Transaction client type — works for both shared and independent transactions. */
type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Context passed to each processor. */
interface TickContext {
  /** Prisma transaction client for DB operations. */
  tx: TxClient;
  /** The new tick number being processed. */
  tick: number;
  /** Results from processors that have already completed (keyed by processor name). */
  results: Map<string, TickProcessorResult>;
}

/** Result returned by each processor. */
interface TickProcessorResult {
  /** Global events — broadcast to every connected client. */
  globalEvents?: Record<string, unknown[]>;
  /** Player-scoped events — only sent to the relevant player's SSE stream. */
  playerEvents?: Map<string, Record<string, unknown[]>>;
}

/** A tick processor — one per game system. */
interface TickProcessor {
  /** Unique name, used as key in results map and dependency references. */
  name: string;
  /** Run every N ticks. Default: 1 (every tick). */
  frequency?: number;
  /** Phase offset — staggers processors that share a frequency.
   *  Runs when: (tick - offset) % frequency === 0. Default: 0. */
  offset?: number;
  /** Names of processors that must complete before this one runs. */
  dependsOn?: string[];
  /** The processing function. */
  process(ctx: TickContext): Promise<TickProcessorResult>;
}

/** The full event payload sent to clients after a tick. */
interface TickEvent {
  currentTick: number;
  tickRate: number;
  /** Merged global events from all processors. */
  events: Record<string, unknown[]>;
  /** Player-scoped events (filtered per client in SSE route). */
  playerEvents: Record<string, unknown[]>;
  /** Which processors ran this tick (debug only — stripped in production). */
  processors?: string[];
}
```

## Engine Behavior

### Tick Loop

```
1. Poll every 1s (unchanged)
2. Check if enough real time has elapsed since lastTickAt
3. Advance tick counter with optimistic lock (unchanged)
4. Determine which processors run this tick ((tick - offset) % frequency === 0)
5. Topological sort active processors by dependsOn
6. Run processors sequentially (shared transaction for SQLite)
   - Each processor receives TickContext with results from prior processors
   - Each processor is wrapped in try/catch for error isolation
   - On error: log warning, skip processor, continue
   - On success: store result in results map
7. Merge all processor results into a single TickEvent
8. Attach `processors` list to TickEvent (dev/debug only, stripped when NODE_ENV=production)
9. Emit TickEvent via EventEmitter
10. Log tick summary with per-processor timing
```

### Tick Overrun Handling

The expectation is that tick rates and frequencies will be tuned so processing time is well under the tick interval. Expensive systems (economy, NPC trading) will have high frequency values (e.g., every 500 ticks) so even if they take multiple seconds, nothing else is waiting.

If a tick does take longer than the interval, the engine simply waits — the next tick fires on the next poll after the current one completes. The 1s poll interval naturally handles this. An overrun warning is logged with timing details so frequencies can be tuned.

### Error Isolation

Each processor runs inside its own try/catch:

```typescript
for (const processor of activeProcessors) {
  try {
    const start = performance.now();
    const result = await processor.process(ctx);
    ctx.results.set(processor.name, result);
    timings.set(processor.name, performance.now() - start);
  } catch (error) {
    console.error(`[TickEngine] Processor "${processor.name}" failed on tick ${tick}:`, error);
    // Continue — don't abort the tick for one failing processor
  }
}
```

If a processor fails, its result is not added to `ctx.results`. Any downstream processor that `dependsOn` the failed one should check if the dependency result exists and handle absence gracefully.

### Transaction Boundaries

**Phase 1 (SQLite — current):** All processors run in a single `prisma.$transaction()`. Simple, correct, no partial completion concerns.

**Phase 2 (PostgreSQL — future):** Independent processors (no shared dependencies) get their own transactions and run in parallel via `Promise.all()`. Dependent processors wait for their dependencies. Per-processor completion is tracked in a `tick_processor_log` table for idempotency — on retry, completed processors are skipped.

Processor code is identical in both phases. The engine controls the transaction boundary; processors just use `ctx.tx`.

### Per-Player Event Filtering

The SSE route knows the connected player's ID (from auth). When emitting events:

1. Engine merges all processor results into `globalEvents` + `playerEvents` (keyed by playerId)
2. SSE route sends each client: all `globalEvents` + only their entry from `playerEvents`
3. Clients that have no relevant events still get the tick heartbeat (currentTick, tickRate)

This keeps bandwidth manageable and prevents information leaks between players.

## Example Processor: Ship Arrivals

```typescript
// lib/tick/processors/ship-arrivals.ts

import type { TickProcessor, TickContext, TickProcessorResult } from "../types";

interface ArrivedShip {
  shipId: string;
  systemId: string;
  playerId: string;
}

export const shipArrivalsProcessor: TickProcessor = {
  name: "ship-arrivals",
  frequency: 1, // every tick

  async process(ctx: TickContext): Promise<TickProcessorResult> {
    const arrivingShips = await ctx.tx.ship.findMany({
      where: {
        status: "in_transit",
        arrivalTick: { lte: ctx.tick },
      },
      select: { id: true, destinationSystemId: true, playerId: true },
    });

    if (arrivingShips.length === 0) {
      return {};
    }

    const arrived: ArrivedShip[] = [];

    // TODO: Replace with batch update when moving to PostgreSQL
    for (const ship of arrivingShips) {
      if (ship.destinationSystemId) {
        await ctx.tx.ship.update({
          where: { id: ship.id },
          data: {
            systemId: ship.destinationSystemId,
            status: "docked",
            destinationSystemId: null,
            departureTick: null,
            arrivalTick: null,
          },
        });
        arrived.push({
          shipId: ship.id,
          systemId: ship.destinationSystemId,
          playerId: ship.playerId,
        });
      }
    }

    // Group arrivals by player for scoped events
    const playerEvents = new Map<string, Record<string, unknown[]>>();
    for (const a of arrived) {
      const existing = playerEvents.get(a.playerId) ?? {};
      existing["shipArrived"] = [...(existing["shipArrived"] ?? []), a];
      playerEvents.set(a.playerId, existing);
    }

    return { playerEvents };
  },
};
```

## Example Processor: Economy Simulation

```typescript
// lib/tick/processors/economy.ts

import type { TickProcessor, TickContext, TickProcessorResult } from "../types";
import { simulateEconomyTick } from "@/lib/engine/tick";
// ... constants imports

export const economyProcessor: TickProcessor = {
  name: "economy",
  frequency: 10, // every 10 ticks (quick for dev — tune higher for production)

  async process(ctx: TickContext): Promise<TickProcessorResult> {
    const markets = await ctx.tx.stationMarket.findMany({
      include: {
        good: true,
        station: { include: { system: true } },
      },
    });

    const tickEntries = markets.map((m) => ({
      // ... map to MarketTickEntry (unchanged from current code)
    }));

    const simulated = simulateEconomyTick(tickEntries);

    // TODO: Replace with batch update when moving to PostgreSQL
    for (let i = 0; i < markets.length; i++) {
      await ctx.tx.stationMarket.update({
        where: { id: markets[i].id },
        data: {
          supply: simulated[i].supply,
          demand: simulated[i].demand,
        },
      });
    }

    // Economy changes are global — all players see market updates
    return {
      globalEvents: { economyTick: [{ marketCount: markets.length }] },
    };
  },
};
```

## Registry

```typescript
// lib/tick/registry.ts

import { shipArrivalsProcessor } from "./processors/ship-arrivals";
import { economyProcessor } from "./processors/economy";
import type { TickProcessor } from "./types";

/** All registered processors. Engine topologically sorts these by dependsOn. */
export const processors: TickProcessor[] = [
  shipArrivalsProcessor,
  economyProcessor,
  // Future (phase offsets stagger same-frequency processors):
  // productionProcessor,    // frequency: 10, offset: 5, dependsOn: ["economy"]
  // randomEventsProcessor,  // no dependencies
  // npcAgentsProcessor,     // gameplay NPCs only (not bulk trade — that's in economy)
];
```

## Migration Path

### Step 1: Implement pipeline ✅
- Created `lib/tick/` with types, engine, registry, and two processors (ship-arrivals, economy)
- Moved ship arrivals and economy simulation out of monolithic `tick()` into processors
- Updated SSE route with per-player event filtering (engine emits raw events, SSE route strips to connected player)
- Updated client hooks: `subscribeToEvent(name, cb)` API replaces arrivals-only subscription
- `useTickInvalidation` subscribes to `shipArrived` → fleet+market, `economyTick` → market
- Deleted old `lib/tick-engine.ts`
- All 58 existing tests pass, clean build

### Step 2: Regional economy, gateways, & batch writes ← CURRENT
Full design doc: [`docs/design/archive/economy-sim.md`](./economy-sim.md)

**2a — Schema + Seed + Universe Generation:**
- Add `Region` model, `regionId` and `isGateway` to `StarSystem`
- Procedural universe generation: ~200 systems across ~8 regions (~25 systems/region)
- Gateway systems (1-3 per region) are the only inter-region connection points
- Higher fuel cost for gateway jumps — deliberate cross-region travel
- Generic procedural names for now ("Forge-7"), curated name pools later
- Mean-reverting supply/demand formulas replace random walk drift
- New constants: `lib/constants/economy.ts`, `lib/constants/universe-gen.ts`
- Pure generation functions in `lib/engine/universe-gen.ts` (testable)

**2b — Economy Processor Upgrade:**
- Round-robin by region: `tick % regionCount` (each region updates every ~8 ticks)
- Batch writes via raw SQL `UPDATE ... FROM (VALUES ...)`
- Mean-reverting drift with equilibrium targets (producers: high supply/low demand, consumers: inverse)

**2c — Frontend Updates:**
- Two-level star map: region overview (~8 aggregate nodes) ↔ system detail (~25 nodes)
- Two-tier navigation: region-level Dijkstra (~8 nodes) + system-level Dijkstra (~25 nodes)
- Pathfinding is hard-capped at one region's systems — never operates on full graph
- Gateway system styling and "jump to region" action

### Step 3: Ambient NPC trade pressure & inter-region trade
- Enhance economy processor with data-driven NPC trade flows (Tier 1 NPCs — see NPC Architecture)
- Inter-region trade flows via gateway stations: surplus goods flow out, scarce goods flow in
- Gateway stations become the points where inter-region economic pressure manifests
- Trade flows between regions happen at a lower frequency (every full region cycle)
- This creates the core gameplay loop: players discover and exploit regional price differences
- **Extends `docs/design/archive/economy-sim.md`** with NPC pressure parameters and inter-region flow model

### Step 4: New processors (future PRs)
- Production processor (dependsOn: economy, staggered via offset)
- Random events processor
- NPC agents processor (Tier 2 — distinct gameplay NPCs with decision trees, missions, rivals)
- Each is one file + one line in registry

### Step 5: PostgreSQL migration (future)
- Swap Prisma adapter from better-sqlite3 to pg
- Engine splits independent processors into parallel transactions
- Add `tick_processor_log` table for idempotency
- Region processors could run fully parallel across workers
- No processor code changes needed

## Client-Side Impact (Step 1 — Implemented)

### TickEvent type
The flat `{ arrivedShipIds: string[] }` was replaced with a structured event object:
- `events: Record<string, unknown[]>` — merged global events from all processors
- `playerEvents: Record<string, unknown[]>` — filtered per client by SSE route
- `processors?: string[]` — debug only (stripped in production)

### Client hooks
- `useTick` — generic `subscribeToEvent(name, cb)` API + backward-compat `subscribeToArrivals`
- `useTickInvalidation` — subscribes to `shipArrived` and `economyTick` events
- `useTickContext` — exposes both subscription methods via React context

### SSE route
- Reads `session.user.id`, filters `playerEvents` per connected client
- Sends merged `globalEvents` + only the connected player's events
- Unchanged: heartbeat, reconnect behavior

## Observability

Each tick logs a summary line with per-processor timing:

```
[TickEngine] Tick 4501 (23ms) — ship-arrivals: 8ms (3 arrived), economy: 15ms (48 markets)
```

If a tick exceeds 80% of the tick rate, log a warning:

```
[TickEngine] WARN Tick 4502 took 4200ms (84% of 5000ms tick rate) — economy: 4100ms
```

This gives immediate visibility into which processors need frequency tuning or batch optimization.

## NPC Architecture (Three-Tier)

NPC behavior is split into three tiers based on server cost and gameplay impact:

### Tier 1: Ambient NPC Trade Pressure (economy processor)
Statistical/aggregate trade flows baked into the economy simulation. "Station X imported 200 units of ore this tick." No individual agents — just supply/demand adjustments that make the economy feel alive. Runs as part of the economy processor. Cheap to compute, scales to thousands of stations. **Implemented as a future enhancement to the economy processor, not a separate processor.**

### Tier 2: Gameplay NPC Agents (npc-agents processor, future)
Distinct NPCs with decision trees — quest givers, rivals, convoy escorts. These interact with specific players and are relatively few in number. Separate processor, low frequency, only simulates NPCs relevant to active players. Expensive per-agent but limited count keeps it manageable.

### Tier 3: Client-Only NPCs (no server cost)
Mission flavor, local encounters, ambient dialogue. Rendered client-side based on mission state. Other players don't see them because they're not "real" in the world model. Zero server load.

## Scaling Strategy

The processor pipeline is designed to scale from the initial ~200 systems to a much larger universe. The key levers:

### Regional Round-Robin (Step 2)
Systems are grouped into ~8 regions of ~25 systems each (~200 total). The economy processor processes one region per tick, cycling through all regions. This means:
- Each tick: ~25 systems × 6 goods = ~150 market rows. Fast even on SQLite.
- Full economy cycle: every ~8 ticks all regions are updated. At a 5s tick rate = ~40s full cycle.
- Adding systems = adding them to a region. No processor or registry changes.
- Scales to 1,000+ systems by increasing region count (e.g., 20 regions × 50 systems).

### Gateway-Based Inter-Region Travel (Step 2)
Each region has 1-3 gateway systems — the only connection points to other regions. This provides:
- **Hard pathfinding cap** — Dijkstra never exceeds ~25 nodes (one region). Cross-region routing decomposes into region-level (~8 nodes) + system-level (~25 nodes) calls.
- **Natural map layering** — Regions are physically separated. Zoomed out: ~8 aggregate region nodes. Zoomed in: ~25 system nodes within one region.
- **Strategic gameplay** — Gateways are chokepoints for trade, future faction control, events.
- **Scales linearly** — Adding regions doesn't increase per-region pathfinding cost.

### Batch Writes (Step 5 — with PostgreSQL)
Sequential Prisma `update` calls inside a shared transaction are used today. At ~150 market rows per region tick, this is fast enough on SQLite (single commit, no network round trips). True batch SQL (`UPDATE ... FROM VALUES`) is deferred to the PostgreSQL migration where it can use parameterized queries and parallel transactions.
- 25 systems × 6 goods = ~150 market updates per region tick — fine for SQLite
- PostgreSQL: parameterized batch SQL in a shared utility for order-of-magnitude improvement at scale

### Inter-Region Trade (Step 3)
Regions don't exist in isolation. A lower-frequency phase of the economy processor computes trade flows between neighboring regions via gateway stations — surplus goods flow out, scarce goods flow in. This:
- Creates natural price gradients across the map
- Makes gateway stations and cross-region trade routes strategically valuable
- Runs less frequently than intra-region updates (e.g., every full region cycle)

### PostgreSQL Parallelism (Step 5)
With independent transactions, region processing can be fully parallel — each region in its own transaction on its own connection. Combined with batch writes, this scales to tens of thousands of systems.

## Resolved Decisions

1. **Frequency values** — keep frequencies quick for dev/testing (economy every ~10 ticks). Processors that share a frequency use `offset` to stagger across different ticks (e.g., economy at offset 0, production at offset 5). Production values will be much higher — tuned based on observability logs.
2. **Processor names in events** — `TickEvent` includes a `processors` field listing which processors ran. Stripped when `NODE_ENV=production` to avoid leaking implementation details.
3. **NPC trading scope** — bulk trade simulation is part of the economy processor (Tier 1). Distinct gameplay NPCs are a separate future processor (Tier 2). Some NPCs are client-only (Tier 3). See NPC Architecture section above.
4. **Regional economy** — ~200 systems across ~8 regions (~25 systems/region) for initial scale. Economy processor round-robins one region per tick internally. Architecture supports scaling to 1,000+ by increasing generation parameters. Batch writes deferred to PostgreSQL migration (Step 5) — individual Prisma updates in a shared transaction are sufficient for SQLite at this scale.
5. **Gateway-based inter-region travel** — Only designated gateway systems (1-3 per region) can connect to other regions. Higher fuel cost for gateway jumps. This bounds pathfinding to ~25 nodes per call and creates strategic chokepoints. Normal systems only connect within their region.
6. **Two-level map** — Region overview (aggregate nodes, ~8) and system detail (one region's systems, ~25). React Flow handles both levels easily — no virtualization needed. Smooth zoom transition between levels.
7. **Procedural universe generation** — Fully procedural for now (generic names like "Forge-7"). Hybrid approach (procedural placement + curated name/identity pools) planned for a future polish pass. Deterministic given a seed value.
8. **Universe migration** — Re-seed and re-register for dev/testing. Production migration strategy deferred.

## Design Docs

| Doc | Status | Covers |
|---|---|---|
| [`docs/design/archive/economy-sim.md`](./economy-sim.md) | ✅ Complete | Regional model, gateways, two-tier navigation, mean-reverting formulas, batch writes, universe generation, map visualization |
| `docs/design/archive/economy-sim.md` expansion | Before Step 3 | Ambient NPC trade pressure parameters, inter-region trade flow model, price gradient propagation |
| `docs/npc-agents.md` | Before Step 4 | Tier 2 NPC decision trees, mission framework, player interaction model |
