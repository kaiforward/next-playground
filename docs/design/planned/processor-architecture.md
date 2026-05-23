# Processor Architecture Refactor

Status: **Planned** — refactor scope, no new features. Prerequisite for trade simulation and future systems.

## Problem

The simulator and live tick engine run **two parallel orchestrators** over the same math:

- `lib/engine/simulator/economy.ts` (530 LOC) — in-memory `SimWorld`, runs events + economy + danger in one file
- `lib/tick/processors/economy.ts` (233 LOC) — Prisma-backed, runs as one of several split processors

The pure math is shared (`lib/engine/tick.ts`, `market-tick-builder.ts`, `events.ts`, `danger.ts`, `pricing.ts`). The drift surface is the orchestration: fetch → iterate → write. Same shape, different data source.

Recent commits show this is an ongoing concern:
- `4109930 Extract shared market tick builder to prevent sim/game divergence`
- `cbb0843 Remove demand side-effects from production/consumption`

Each new feature that touches orchestration has to land in both files. As more processors arrive (trade simulation, faction relations, war resolution, faction economy effects, player facilities, ship automation, etc.), the cost compounds. **Refactoring 7 processors now is much cheaper than refactoring 15-20 later.**

## Goal

One processor body per system, executed by both the live tick engine (against Prisma) and the simulator (against in-memory state). New features are written once.

Constraints:
- Simulator must stay fast (no DB calls during sim runs)
- Live game keeps its current transactional guarantees (Prisma `$transaction`, optimistic locking)
- Existing pure-engine modules stay as-is — they already share cleanly
- No functional changes — same outputs before and after

---

## Design

### Per-processor World interfaces

Each processor declares its data needs as a typed interface in `lib/tick/world/`. The processor depends only on the interface — never on Prisma types or `SimWorld` types directly.

```typescript
// lib/tick/world/economy-world.ts
export interface EconomyWorld {
  getMarketsForRegion(regionId: string): Promise<MarketView[]>;
  getModifiersForSystems(systemIds: string[]): Promise<ModifierRow[]>;
  getSystemSnapshot(systemId: string): Promise<SystemSnapshot>;
  applyMarketUpdates(updates: MarketUpdate[]): Promise<void>;
  updateProsperity(systemId: string, delta: number): Promise<void>;
  // ... only what this processor needs
}
```

Interface shape principles:
- **Domain-shaped, not data-shaped** — `getMarketsForRegion()`, not `query(sql)`. Adapters can implement either way internally.
- **Per-processor, not shared** — `EconomyWorld` is distinct from `MissionWorld`. Avoids leaky god-interface.
- **Mutations are explicit** — no exposing Prisma transactions or raw mutation handles. The interface defines what the processor can change.
- **Reads return views, not entities** — `MarketView` is a plain object with exactly the fields needed, not a Prisma model. Decouples processor from DB schema changes.

### Adapters

Two adapter implementations per interface:

**`PrismaEconomyWorld`** (live game):
- Holds a `TxClient` handle from the active `$transaction`
- Implements interface methods with Prisma queries
- Batch-writes via `unnest()` SQL where it makes sense
- Lives in `lib/tick/adapters/prisma/`

**`InMemoryEconomyWorld`** (simulator):
- Holds references to in-memory `SimWorld` slices
- Implements interface methods with array/map operations
- Lives in `lib/tick/adapters/memory/`

Common helpers can share a base class if useful — but interfaces are the contract, not the base classes.

### Processor body

Pure logic, depends only on the interface:

```typescript
// lib/tick/processors/economy.ts
export async function runEconomyProcessor(
  world: EconomyWorld,
  ctx: TickContext,
): Promise<TickProcessorResult> {
  const markets = await world.getMarketsForRegion(ctx.regionId);
  const modifiers = await world.getModifiersForSystems(markets.map(m => m.systemId));

  const updates: MarketUpdate[] = [];
  for (const market of markets) {
    const entry = resolveMarketTickEntry(/* shared engine */);
    const nextState = simulateEconomyTick(entry, /* params */);
    updates.push({ systemId: market.systemId, ...nextState });
  }

  await world.applyMarketUpdates(updates);
  return { /* result */ };
}
```

The live tick engine calls this with a `PrismaEconomyWorld`. The simulator calls it with an `InMemoryEconomyWorld`. Same processor body, identical math.

### What stays unchanged

- Pure engine modules (`tick.ts`, `pricing.ts`, `events.ts`, `danger.ts`, `market-tick-builder.ts`) — already share cleanly via well-defined inputs.
- Prisma schema and queries — only the *callsite* moves, the data layer doesn't.
- Tick engine pipeline (`lib/tick/engine.ts`) — still owns scheduling and round-robin. Just calls processors with `PrismaXxxWorld` instances.
- Simulator runner — still owns sim loop, RNG, metrics. Calls processors with `InMemoryXxxWorld` instances.

---

## Migration Plan

Migrate processor-by-processor. Each migration is one PR (small enough to review, large enough to be coherent). New processors written against the pattern from day one.

### Phase 1: Establish the pattern

Refactor **one simple processor** to prove the pattern with minimal risk. Candidate: `price-snapshots` or `notification-prune` — minimal data needs, no sim counterpart (in-memory adapter is trivial).

Deliverables:
- `lib/tick/world/` directory + first interface
- `lib/tick/adapters/prisma/` + `lib/tick/adapters/memory/` directory structure
- Base helpers (if needed)
- One processor migrated
- Updated tests confirming same behavior
- Pattern documented inline in interface file

### Phase 2: Events processor

`events` has a real sim counterpart (sim's `economy.ts` does phase transitions inline). High drift risk. Migrating this proves the pattern works for a complex case while shrinking the sim orchestrator.

Deliverables:
- `EventsWorld` interface, Prisma + memory adapters
- `events` processor body extracted
- Simulator's event logic switched to call the processor via memory adapter
- Sim's `economy.ts` shrinks

### Phase 3: Economy processor (the big one)

The largest and riskiest migration. Highest drift today.

Deliverables:
- `EconomyWorld` interface, Prisma + memory adapters
- `economy` processor body extracted, calling shared engine math
- Simulator's economy logic switched to call processor via memory adapter
- Simulator's `economy.ts` orchestrator shrinks to just the runner

### Phase 4: Remaining processors

`missions`, `battles`, `ship-arrivals`, `trade-missions`. These have no current sim counterparts, so the in-memory adapter can be a stub (or skipped entirely if a processor never needs to run in the sim). Refactoring them is about consistency — a future feature should never wonder "do I follow the new pattern or the old?"

### Phase 5: Cleanup

- Delete simulator's parallel orchestrator code
- Simulator runner becomes a thin wrapper: instantiate in-memory adapter → call processors → collect metrics
- Update CLAUDE.md / docs to describe the pattern

---

## Order rationale

Phases 1 → 4 escalate in scope. Phase 1 proves the pattern with low risk. Phase 2 validates it on a real drift case. Phase 3 takes the biggest risk once we trust the pattern. Phase 4 is mechanical cleanup. Phase 5 deletes dead code.

Alternative considered: do `economy` first because it has the worst drift. Rejected — refactoring the most complex case before validating the pattern is high-variance. A wrong interface design discovered in Phase 1 is easy to fix; the same mistake in Phase 3 means rework across 530 LOC.

---

## Open Questions

- **Should `TickContext` include the adapter, or is it passed separately?** Probably separately — `world` and `ctx` have different lifetimes (`world` per processor, `ctx` per tick).
- **How do we handle processors that don't need sim equivalents?** Options: (a) write a no-op in-memory adapter, (b) make sim parity optional via processor metadata, (c) skip them entirely. Decide during Phase 4.
- **Do interfaces own pagination/batching?** Probably yes for any read returning >100 rows. Adapters implement; processor body doesn't think about it.
- **Should adapters be transaction-aware or transaction-managed?** Live adapter holds an open `TxClient`; sim adapter has no transaction concept. The interface should not expose transactions — adapters internalize them.
- **Do we need a base class or just interfaces?** Start with interfaces only. Extract base helpers only when duplication forces it.

---

## Risks

- **Bugs from refactor without obvious symptoms** — economy is subtle; a wrong write pattern could cause slow divergence over hundreds of ticks. Mitigation: run identical sim configs before/after each phase, compare outputs.
- **Test coverage gaps** — current tests cover engine math (well) but not orchestration. Each phase adds integration tests against the interface.
- **Interface design churn** — getting the right shape takes iteration. Phase 1 may need a small redo once Phase 2 reveals a bad assumption. Accept this — better than locking a bad pattern.
- **Scope creep** — "while I'm in there, let me also fix..." This refactor is structural only. New features stay out. The trade simulation processor is the first feature to use the pattern, not part of the refactor.

---

## Success Criteria

- Identical simulator output for any seeded experiment configuration before vs after the refactor (validate via diff on existing experiment results)
- All existing integration tests pass
- Adding a new processor requires writing it exactly once, with both Prisma and memory adapters wired up by a clear pattern
- Sim's bespoke orchestrator (`lib/engine/simulator/economy.ts`) can be deleted
- The "do I follow pattern A or pattern B?" question never comes up for new processor work

---

## Out of Scope

- New features. Trade simulation, factions, war, production, etc. — all wait. They land on top of the new pattern.
- Schema changes. The refactor doesn't touch Prisma models.
- Math changes. Equilibrium tuning, new event types, etc. — all unaffected.
- Simulator runner rewrite. Phases 1-4 leave the runner alone; Phase 5 simplifies it because by then the parallel orchestrator code is unused.
