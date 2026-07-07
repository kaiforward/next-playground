# Processor Architecture

Status: **Active**.

## Goal

One processor body per game system, run against the single in-memory world. Each feature is written once, and the live game and the calibration harness execute **literally the same objects** — there is one backend and one tick body, so there is no second orchestration to keep in sync.

The pattern exists to prevent orchestration drift: without it, the live game and the calibration harness would each keep their own loop over the same pure math, and every feature touching a processor would have to land in two files.

---

## The pattern

Each processor has three pieces:

```
lib/tick/world/<name>-world.ts        ← typed data interface (what the body may read/write)
lib/tick/adapters/memory/<name>.ts    ← the in-memory adapter (the only backend)
lib/tick/processors/<name>.ts         ← pure processor body
```

The body depends **only** on its World interface, never on concrete row storage. `runWorldTick` (`lib/world/tick.ts`) constructs an `InMemoryXxxWorld` over the current `World` and calls `run<Name>Processor(world, ctx, params)`. That single pipeline is what both the live `TickLoop` and the calibration harness (`lib/engine/simulator/runner.ts`) invoke — see [tick-engine.md](./tick-engine.md) and [single-player-runtime.md](./single-player-runtime.md).

### Why keep the interface with one backend?

With a single backend, the World interface isn't a live/sim abstraction — it's a thin, useful seam:

- **Boundary narrowing** — the adapter narrows any string-typed columns to validated unions (via `lib/types/guards.ts`) once, on the way out, so the body receives `EconomyType`/`GovernmentType`/`EventTypeId` directly and `unknown` stays banned at the edge.
- **Explicit read/write surface** — the interface documents exactly what a processor may touch; the body can't reach into unrelated world state.
- **Testability** — bodies are tested against the memory adapter with hand-built fixtures, no runtime harness.
- **A door left open** — a future backend (a path-B worker store, or re-introduced persistence) is an adapter swap, not a body rewrite.

Fully collapsing the seam (bodies mutating `World` rows directly) is a possible later simplification, but wasn't taken in the extraction — it would have churned every processor for no immediate gain.

### Interface shape principles

- **Domain-shaped, not data-shaped:** `getMarketsForSystems(ids)`, not `query(sql)`.
- **Per-processor, not shared:** `EconomyWorld` is distinct from `MigrationWorld`. Avoids a leaky god-interface even when fields overlap.
- **Reads return plain views:** `MarketView`, not a raw storage row. Decouples the body from row-shape changes.
- **Mutations are explicit method calls:** the interface defines what the body can change; no raw handles leak through.

### Per-tick params

Knobs that a body shouldn't hard-code (RNG source, scaled caps, modifier caps, event definitions) arrive via a `XxxProcessorParams` object alongside the world. This keeps the body deterministic given `(world, ctx, params)`.

### Where the shard selection lives

For processors that shard by system (economy) or by edge (trade-flow, migration), the shard selection lives in the **body**. The adapter exposes a stable-ordered id/edge list and a slice reader; the body processes `shardRange(total, ctx.tick, interval)` over it. The adapter only has to know how to fetch by id — it never needs `ctx.tick`.

### World → view joins

`World` (`lib/world/types.ts`) is schema-faithful flat rows and deliberately omits catalog/derived data the adapters expect inlined (a good's `basePrice`/`floor`/`ceiling`, a system's owning faction's `governmentType`). `runWorldTick` performs those joins **once per tick** (`toSimSystems`/`toSimMarkets`/`toSimConnections`, exported so the harness's health analyzers reuse them) before handing the views to the adapters.

---

## Current processors

| Processor | World interface | In-memory adapter |
|---|---|---|
| ship-arrivals | ✓ | ✓ |
| events | ✓ | ✓ |
| economy | ✓ | ✓ |
| infrastructure-decay | ✓ | ✓ |
| population | ✓ | ✓ |
| migration | ✓ | ✓ |
| trade-flow | ✓ | ✓ |
| directed-logistics | ✓ | ✓ |
| directed-build | ✓ | ✓ |
| relations | ✓ | ✓ |

---

## Stable boundaries

- Pure engine modules (`lib/engine/tick.ts`, `pricing.ts`, `events.ts`, `danger.ts`, `market-tick-builder.ts`) share cleanly via well-defined inputs.
- The processor **bodies** depend only on their World interface — never on how rows are stored, so a backend swap doesn't reach them.
- The stage order and dependency topology live in `runWorldTick`, which runs the bodies in strict topological order.

---

## Adding a new processor

1. Define `lib/tick/world/<name>-world.ts` with the read methods, write methods, and any view types the body needs.
2. Implement `lib/tick/adapters/memory/<name>.ts` over the relevant `World` rows.
3. Write the body as `run<Name>Processor(world, ctx, params)` in `lib/tick/processors/<name>.ts`.
4. Wire it into the pipeline in `lib/world/tick.ts` at its topological position, constructing the adapter and passing the params it needs.

---

## Design decisions

- **Shard selection lives in the body, not the adapter.** Body-side is simpler because the adapter only has to fetch by id — it doesn't need to know `ctx.tick`.
- **Adapters mutate in-place, then expose final state via public fields.** After a body returns, `runWorldTick` reads back `world.markets`, `world.systems`, etc. Cleaner than threading return values through every interface method.
- **`Math.max(0, current - captured)` accumulator resets** keep concurrent-safe numeric semantics (a `GREATEST(0, …)`-style floor); moot with a single writer, but harmless and keeps the intent obvious.
- **`unknown` stays banned at the boundary.** Adapters narrow string columns to validated unions once, on the way out. Bodies never re-validate.
