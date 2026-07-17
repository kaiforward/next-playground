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

The body depends **only** on its World interface, never on concrete row storage. `runWorldTick` (`lib/world/tick.ts`) constructs an `InMemoryXxxWorld` over the current `World` and calls `run<Name>Processor(world, ctx, params)`. That single pipeline is what both the live `TickLoop` and the calibration harness (`lib/tick-harness/runner.ts`) invoke — see [tick-engine.md](./tick-engine.md) and [single-player-runtime.md](./single-player-runtime.md).

### Why keep the interface with one backend?

With a single backend, the World interface isn't a multi-backend abstraction — it's a thin, useful seam:

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

For processors that shard by system (economy) or by edge (migration), the shard selection lives in the **body**. The adapter exposes a stable-ordered id/edge list and a slice reader; the body processes `shardRange(total, ctx.tick, interval)` over it. The adapter only has to know how to fetch by id — it never needs `ctx.tick`.

### World → view joins

`World` (`lib/world/types.ts`) is schema-faithful flat rows and deliberately omits derived data some adapters expect inlined (a system's owning faction's `governmentType`, its building roster). `runWorldTick` performs those joins **once per tick** (`toTickSystems`/`toTickConnections`, exported so the harness's health analyzers reuse them) before handing the views to the adapters. The joined rows are the tick's own working types (`lib/tick/rows.ts`) — mutable per-tick copies, merged back into the next `World` at the end of the tick.

A row type earns a `Tick*` shape only by differing from its `World` row. Markets do not: `WorldMarket` **is** the tick's market row, so the adapters read and write it directly, with no join in and no merge back. A good's catalog constants (`basePrice`/`priceFloor`/`priceCeiling`) are code constants, not row state — read them from `GOODS[goodId]` at the point of use (`marketBandForRow(row, GOODS[row.goodId])`), never by widening the row to carry them. Joining constants onto every market row in the galaxy and stripping them back off once cost half of every tick.

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

---

## Cadence and interval awareness

Most processors resolve on a coarse **pulse** rather than every tick — the economy cluster monthly, construction and logistics on their own intervals. The pulse interval is a real knob: `catchUpFactor(interval) = interval / REFERENCE_INTERVAL` (`lib/tick/shard.ts`) lets a body apply "elapsed-ticks worth" per run, so tuning an interval changes granularity, not wall-clock rate. `REFERENCE_INTERVAL` (24) is the calibration anchor and is **not** a knob — it is the divisor that makes the reference cadence `catchUp = 1` and behaviour-identical.

Every pulse-riding quantity is one of four shapes, and the shape dictates the treatment:

| Shape | Examples | Treatment |
|---|---|---|
| **Rate / flow** — "X per unit time" | production, consumption, migration, population growth, unrest gain/decay, unrest teardown | multiply by `catchUpFactor` per run |
| **Counter / timer** — "after N months…" | decay's `idleMonths`, collapse debt | accrue `catchUpFactor` per run (fractional); thresholds stay in reference-months |
| **Budget income** — "points per pulse" | construction pool / absorption cap / floor, logistics haul budget | multiply the income by `catchUpFactor` per run |
| **Target / stock / cost** — "fill to here", "costs this" | days-of-supply anchor, logistics delivery gap-fills, `workCostPerLevel`, build ceilings | **never scale** — levels are time-free |

The one-line rule: **scale flows and incomes by `catchUpFactor`; count time in ticks, not runs; never scale targets, stocks, or costs.** Logistics is the instructive hybrid — its per-pulse haul *budget* scales, but its deliveries are gap-fills toward the anchor and must not (filling more often already means smaller fills; scaling them too would overshoot the anchor).

Scaling lives **inside the body** (constants stay reference-denominated; the body computes `catchUpFactor(interval)` and applies it at the point of use), so engine functions stay cadence-unaware.

**Two cadence clusters, not one clock.** Population, infrastructure-decay, and migration read the economy's same-tick signal and process its shard, so they are welded to the economy's `MONTH_LENGTH` — one societal accounting pass. Directed-build and directed-logistics are self-gated on their own `pulseShard(interval)` and coupled only through world state, so they carry independent knobs (`CONSTRUCTION_INTERVAL`, `LOGISTICS_INTERVAL`). Relations runs on its own `RELATIONS_FREQUENCY` (3) with the same latent property: its per-run drift magnitudes are denominated in that frequency and would need the same treatment if it were ever tuned.

**Testing.** Interval invariance is directly checkable — same seed and span, different interval, matching wall-clock rates — but only statistically: pulses land on different ticks (different RNG draws) and `fundQueue`'s non-homogeneous `remaining` term redistributes construction, so exact parity is impossible. `runWorldTick(world, { cadence })` takes an optional per-run override (the live loop never sets it; the harness threads it from an experiment's `cadence:` block) so the gate can run both cadences: `lib/world/__tests__/cadence-invariance.test.ts` for the societal + construction rates, and the full-scale `experiments/examples/cadence-invariance-*.yaml` pair for the budget-bound logistics regime CI can't reach.
