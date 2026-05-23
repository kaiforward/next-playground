# Processor Architecture

Status: **Active** — implemented in feat/processor-refactor (Phases 1–5).

## Goal

One processor body per game system, executed by both the live tick engine (against Prisma) and the simulator (against in-memory state). New features are written once.

The refactor's motivating problem was orchestration drift: live and sim each had their own loop over the same pure-engine math, and every feature that touched a processor had to land in two files. The pattern below eliminates the second file.

---

## The pattern

Each processor has three pieces:

```
lib/tick/world/<name>-world.ts          ← typed data interface
lib/tick/adapters/prisma/<name>.ts      ← live-game adapter (TxClient-backed)
lib/tick/adapters/memory/<name>.ts      ← simulator adapter (in-memory)
lib/tick/processors/<name>.ts           ← pure processor body + live wiring
```

The processor body depends **only** on its World interface — never on Prisma types or `SimWorld` types directly. The live `TickProcessor` constructs a `PrismaXxxWorld(ctx.tx)` and calls the body. The simulator constructs an `InMemoryXxxWorld(...)` and calls the same body.

### Interface shape principles

- **Domain-shaped, not data-shaped:** `getMarketsForRegion(regionId)`, not `query(sql)`. Adapters can implement either way internally.
- **Per-processor, not shared:** `EconomyWorld` is distinct from `OpMissionsWorld`. Avoids a leaky god-interface even when fields overlap.
- **Reads return plain views:** `MarketView`, not a Prisma model. Decouples the processor from schema changes.
- **Mutations are explicit method calls:** no exposing transactions or raw query handles. The interface defines what the processor can change.

### Per-tick params

Knobs that differ between live and sim (RNG source, scaled caps, modifier caps, event definitions, sim-only injections) come in via a `XxxProcessorParams` object alongside the world. This keeps the body deterministic given `(world, ctx, params)`.

### Where round-robin lives

For processors that pick one region per tick (economy, missions), the round-robin selection lives in the processor body. The adapter exposes `getRegions()` (sorted alphabetically) and `getXxxForRegion(regionId)`; the body picks `regions[ctx.tick % regions.length]`. Live and sim both see the same selection.

---

## Current state

| Processor | World interface | Prisma adapter | Memory adapter |
|---|---|---|---|
| price-snapshots | ✓ | ✓ | ✓ |
| events | ✓ | ✓ | ✓ |
| economy | ✓ | ✓ | ✓ |
| trade-missions | ✓ | ✓ | — (no sim need yet) |
| missions (operational) | ✓ | ✓ | — (no sim need yet) |
| battles | ✓ | ✓ | — (no sim need yet) |
| ship-arrivals | ✓ | ✓ | — (sim keeps its own path, see below) |
| notification-prune | — | — | — (16-line service wrapper; abstraction not warranted) |

**Sim ship-arrivals exception:** The simulator's `processSimShipArrivals` in `lib/engine/simulator/economy.ts` still owns ship arrivals in the sim path. Migrating it to the unified processor would require expanding `SimWorld` with cargo IDs, convoy membership, and upgrade slots — meaningful scope that exceeds the consistency goal of this refactor. The structural pattern is in place; future sim work can add the memory adapter when those fields land.

**notification-prune:** Skipped on purpose. It calls one service function. Adding a World there would be ceremony without payoff. The rule for future processors: introduce the abstraction when there's real orchestration to share OR a sim path that needs it.

---

## What stays unchanged

- Pure engine modules (`lib/engine/tick.ts`, `pricing.ts`, `events.ts`, `danger.ts`, `combat.ts`, `market-tick-builder.ts`) — already share cleanly via well-defined inputs.
- Prisma schema and queries — only the *callsite* moves, the data layer doesn't.
- Tick engine pipeline (`lib/tick/engine.ts`) — still owns scheduling and processor ordering. It calls `TickProcessor.process(ctx)`, which constructs the live adapter and dispatches to the body.
- Simulator runner — still owns sim loop, RNG, metrics. Calls processor bodies with `InMemoryXxxWorld` instances via `simulateWorldTick`.

---

## Adding a new processor

1. Define `lib/tick/world/<name>-world.ts` with the read methods, write methods, and any view types the body needs.
2. Implement `lib/tick/adapters/prisma/<name>.ts`. Bulk-write via `unnest()` where the writes are list-shaped (see `prisma/events.ts`, `prisma/economy.ts` for reference).
3. If the processor will run in the simulator, implement `lib/tick/adapters/memory/<name>.ts`.
4. Write the body as `run<Name>Processor(world, ctx, params)` in `lib/tick/processors/<name>.ts`. Export the live `TickProcessor` from the same file.
5. Register the processor in `lib/tick/registry.ts`.

Adding it to the sim is then: construct the memory adapter, call the body, copy state back into `SimWorld`. See `processSimEconomy` for the template.

---

## Migration history

| Phase | Commit | What landed |
|---|---|---|
| 1 | 89a0347 | `price-snapshots` proved the pattern with the simplest case. |
| 2 | 1cbbbee | `events` validated the pattern on a real drift case; sim's bespoke event lifecycle replaced. |
| 3 | 450929c | `economy` — the highest-drift processor. Sim's economy orchestrator replaced. |
| 4 | 752ec26 | `trade-missions`, `missions`, `battles`, `ship-arrivals` — consistency pass. |
| 5 | — | Doc + CLAUDE.md updates. |

---

## Design decisions made along the way

- **Round-robin lives in the processor body, not the adapter.** Tried both. Body-side is simpler because the adapter only has to know how to fetch by region — it doesn't need to know `ctx.tick`.
- **Memory adapters mutate in-place, then expose the final state via public fields.** The simulator reads back `world.markets`, `world.systems`, etc. after the processor returns. Cleaner than threading return values through every interface method.
- **Sim's `tradeVolumeAccum` reset uses `Math.max(0, current - captured)`, matching live's `GREATEST(0, vol - captured)`.** Both adapters subtract the volume that fed into the prosperity calc rather than resetting to 0, so trades committed between read and write aren't silently lost. In sim this is moot (no concurrent writers) but matching behavior keeps adapters interchangeable.
- **`unknown` stays banned at the boundary.** Adapters narrow Prisma's string-typed columns to validated unions via `lib/types/guards.ts` once, on the way out. The processor body receives `EconomyType`, `GovernmentType`, `EventTypeId`, etc. directly.

---

## Success criteria — final check

- Identical simulator output for any seeded experiment configuration before vs after the refactor — confirmed via `npm run simulate` runs on each phase.
- All existing integration tests pass — 740/740 at Phase 4.
- Adding a new processor requires writing it exactly once — yes, by construction.
- Sim's bespoke orchestrator can be deleted — done for economy and events; ship-arrivals path remains by design (see exception above).
- "Do I follow pattern A or pattern B?" — answer is always "the World pattern", with the documented exceptions for trivial wrappers (notification-prune).
