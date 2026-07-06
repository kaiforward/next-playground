# Pivot Phase 2 — Engine Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The living galaxy runs locally as an in-memory single-player simulation — no Postgres, no login — with a start screen (system count + seed), JSON save/load, and pause/1×/5×/max speed controls.

**Architecture:** Promote the simulator's in-memory world to be *the* game world (`lib/world/`): hand-owned types, pure world-gen (composing the already-pure `generateUniverse` with the market/faction derivations currently in `prisma/seed.ts`), and a `runWorldTick` promoted from `simulateWorldTick`. A new in-process tick loop replaces the worker-thread/`$transaction` engine. Services re-point from Prisma to world reads; auth and Prisma delete wholesale. Spec: `docs/planned/pivot-phase2-engine-extraction.md`.

**Tech Stack:** Next.js 16, TypeScript strict, TanStack Query v5, Vitest 4. Removed by this plan: Prisma 7, PostgreSQL, NextAuth v5, bcryptjs.

## Global Constraints

- All CLAUDE.md conventions apply: no `as` (except `as const`/guards), no `unknown`, discriminated-union results for mutations, `ServiceError` for read services, services own logic / routes are thin, form components from `components/form/`.
- **Path-B purity rules (from the spec, non-negotiable):** `lib/engine/`, `lib/world/` (except `save-files.ts`), and `lib/services/` must contain no Node-only APIs — no `fs`, no `process.env`, no Prisma. Node-touching code lives only in explicitly-named edge files (`lib/world/save-files.ts`, route handlers, `instrumentation.ts`).
- **Determinism:** no `Date.now()`/`new Date()`/`Math.random()` inside tick math. Wall-clock is allowed only for loop *pacing*, autosave cadence, and logging. Tick RNG is derived per tick from the world seed (Task 5).
- Serializable boundaries: everything in the `World` type must survive `JSON.parse(JSON.stringify(world))` — no `Map`/`Set`/`Date`/class instances in world state.
- Work happens on shared branch `feat/pivot-phase2` off main; each PR below is a phase branch squashed into it; final squash/ff to main.
- Gates after every task: `npx tsc --noEmit` and `npx vitest run` green. Gate at each PR boundary additionally: `npx next build --webpack` and `npm run simulate` green.

---

## PR 1 — World substrate (additive; live app untouched)

### Task 1: World types + store

**Files:**
- Create: `lib/world/types.ts`, `lib/world/store.ts`
- Test: `lib/world/__tests__/store.test.ts`

**Interfaces:**
- Produces: `World`, `WorldMeta` and all `World*` entity types; `getWorld(): World`, `setWorld(w: World): void`, `hasWorld(): boolean`, `getWorldVersion(): number`, `clearWorld(): void` (tests only).

- [ ] **Step 1: Write `lib/world/types.ts`.** Hand-owned world-state types, transcribed from `prisma/schema.prisma` world-state models (NOT imported from Prisma). Start from the `Sim*` types in `lib/engine/simulator/types.ts` and widen to full schema fidelity:

```ts
export interface WorldMeta {
  seed: number;
  systemCount: number;
  mapSize: number;
  currentTick: number;
  startingSystemId: string;
}

export interface World {
  meta: WorldMeta;
  regions: WorldRegion[];        // Region: id, name, dominantEconomy, x, y
  systems: WorldSystem[];        // StarSystem: all ~40 columns (identity, position,
                                 //   economyType, factionId, substrate: sunClass, population,
                                 //   popCap, unrest, bodyDanger, *Space, slot*×7, yield*×7)
  bodies: WorldBody[];           // SystemBody: all ~24 columns
  buildings: WorldBuilding[];    // { systemId, buildingType, count }
  traits: WorldTrait[];          // { systemId, traitId, quality }
  connections: WorldConnection[];// { fromId, toId, fuelCost } (bidirectional pairs, as seeded)
  markets: WorldMarket[];        // StationMarket minus stationId: keyed (systemId, goodId);
                                 //   stock, anchorMult, demandRate, storageCapacity
  factions: WorldFaction[];      // Faction: name, governmentType, doctrine, homeworldId, color, createdAtTick
  relations: WorldFactionRelation[]; // pairwise score + history (factionAId < factionBId)
  alliancePacts: WorldAlliancePact[];
  events: WorldEvent[];          // GameEvent incl. metadata; modifiers separate as today
  modifiers: WorldEventModifier[];
  ships: WorldShip[];            // Ship minus playerId: stats, status, systemId,
                                 //   destinationSystemId, departureTick, arrivalTick
  flowEvents: WorldFlowEvent[];  // TradeFlow log rows (pruned by trade-flow processor)
  nextId: number;                // synthetic id counter (carried over from SimWorld)
}
```

Decisions locked here: **`Station` collapses** (it was 1:1 with `StarSystem`; markets key on `systemId`); **`Good` is not world state** (the catalog is code constants — `getGoods` reads constants in Task 8); **`Player` does not exist** (credits die with it — faction treasury is Phase 3); **ships are ownerless** in Phase 2. Field names/types must match what the memory adapters and `lib/engine` functions already consume (check `lib/tick/adapters/memory/*` and `lib/engine/simulator/types.ts` — where a Sim type already names a field, keep that name).

- [ ] **Step 2: Write the failing store test** (`lib/world/__tests__/store.test.ts`): `hasWorld()` false initially; `getWorld()` throws `ServiceError` with status 409; after `setWorld(fake)` `getWorld()` returns it and `getWorldVersion()` has incremented; `clearWorld()` resets. Build the fake `World` inline with empty arrays.
- [ ] **Step 3: Run** `npx vitest run --project unit lib/world` — expect FAIL (module not found).
- [ ] **Step 4: Implement `lib/world/store.ts`:**

```ts
import { ServiceError } from "@/lib/services/errors";
import type { World } from "./types";

interface WorldStore { world: World | null; version: number }
const globalStore: { __world?: WorldStore } = globalThis;
const store: WorldStore = (globalStore.__world ??= { world: null, version: 0 });

export function hasWorld(): boolean { return store.world !== null; }
export function getWorld(): World {
  if (!store.world) throw new ServiceError("No world loaded", 409);
  return store.world;
}
export function setWorld(world: World): void { store.world = world; store.version += 1; }
export function getWorldVersion(): number { return store.version; }
export function clearWorld(): void { store.world = null; store.version += 1; }
```

(`globalThis` caching survives dev HMR, same pattern as `lib/prisma.ts`. Type the `globalStore` line without `as` — declare a module-scoped interface merge or a typed const as shown.) The version counter is what the module-level caches (adjacency/topology/hop-distances, Task 8) key on instead of "cleared on reseed".

- [ ] **Step 5: Run test → PASS; `npx tsc --noEmit`; commit** `feat(world): world-state types and in-memory store`.

### Task 2: Continuous generation parameters

**Files:**
- Modify: `lib/constants/universe-gen.ts`
- Test: `lib/constants/__tests__/universe-gen.test.ts` (create or extend)

**Interfaces:**
- Produces: `genConfigForSystemCount(systemCount: number): UniverseGenConfig` — same shape as today's `UNIVERSE_GEN`, derived continuously from N. Existing `UNIVERSE_GEN`/`ACTIVE_SCALE` exports stay until Task 13 removes them.

- [ ] **Step 1: Write failing tests:** `genConfigForSystemCount(600)` ≈ today's default config (each numeric knob within 5% of `BASE_CONFIG`), `genConfigForSystemCount(10_000)` ≈ today's `SCALE_OVERRIDES["10k"]` values, and monotonicity (mapSize grows with N).
- [ ] **Step 2: Implement.** Inspect every knob `SCALE_OVERRIDES["10k"]` overrides. For each, interpolate in √N space anchored at the two known points: `value(N) = a + b·√N` where `b = (v10k − v600)/(√10000 − √600)` and `a = v600 − b·√600`. For mapSize this yields `mapSize(N) ≈ 1160 + 238·√N` (7000 @ 600, 25000 @ 10k). Round to integers; clamp any knob that must stay ≥ its base value. Knobs NOT overridden by the 10k preset stay constants.
- [ ] **Step 3: Tests PASS; commit** `feat(world): continuous universe-gen config from system count`.

### Task 3: `generateWorld` — pure world-gen

**Files:**
- Create: `lib/world/gen.ts`
- Test: `lib/world/__tests__/gen.test.ts`
- Reference (read, don't modify): `prisma/seed.ts`, `lib/engine/universe-gen.ts`, `lib/engine/faction-gen.ts`, `lib/constants/market-economy.ts`

**Interfaces:**
- Consumes: `generateUniverse(params, REGION_NAMES)`, `genConfigForSystemCount` (Task 2), `getInitialStock` / `demandRateForGood` / `facilityStorageForGood` (`lib/constants/market-economy.ts`), `deriveDominantEconomy` (`lib/engine/faction-gen.ts`), `mulberry32` (`lib/engine/universe-gen.ts`).
- Produces: `generateWorld(options: { systemCount: number; seed: number }): World`.

- [ ] **Step 1: Write failing tests** against a small world (`generateWorld({ systemCount: 120, seed: 42 })`): systems.length ≈ requested count (gen may under-fill; assert within the tolerance `generateUniverse` itself exhibits); every system × every good has exactly one market row; every system has a factionId or null per seeding rules; regions have dominantEconomy set; relations cover all faction pairs exactly once with `factionAId < factionBId`; `meta.startingSystemId` is a real system; determinism — two calls with the same options are `toEqual`-identical; different seeds differ.
- [ ] **Step 2: Implement `generateWorld`** by transcribing `prisma/seed.ts`'s post-generation derivations into pure array-building (no Prisma): call `generateUniverse(buildGenParams(seed, genConfigForSystemCount(systemCount)), REGION_NAMES)`, then build regions/systems/bodies/buildings/traits/connections exactly as seed.ts maps them to rows; markets for every system×good seeded via `getInitialStock`/`demandRateForGood`/`facilityStorageForGood`; region dominant-economy via `deriveDominantEconomy` (replacing seed.ts's `unnest` UPDATE); factions + all-pairs relations; `meta` from the gen result (`mapSize` from the config, `currentTick: 0`, `startingSystemId` from `selectStartingSystem`). **Seed no ships** (ships are ownerless and nothing issues movement until Phase 3 — an empty roster is correct; `ship-arrivals` no-ops).
- [ ] **Step 3: Tests PASS; commit** `feat(world): pure generateWorld from seed + system count`.

### Task 4: Save serialization + disk adapter

**Files:**
- Create: `lib/world/save.ts` (pure), `lib/world/save-files.ts` (Node edge)
- Test: `lib/world/__tests__/save.test.ts`
- Modify: `.gitignore` (add `saves/`)

**Interfaces:**
- Produces (pure): `serializeWorld(world: World): string`; `deserializeWorld(json: string): { ok: true; world: World } | { ok: false; error: string }`.
- Produces (edge): `listSaves(): Promise<SaveInfo[]>` (`{ name, tick, savedAt, bytes }`), `writeSave(name: string, world: World): Promise<void>`, `readSave(name: string): Promise<string>`, `AUTOSAVE_NAME = "autosave"`.

- [ ] **Step 1: Write failing round-trip test** (pure part only): `deserializeWorld(serializeWorld(w))` deep-equals `w` for a `generateWorld({ systemCount: 60, seed: 7 })` world; malformed JSON and a JSON object missing `meta` both return `{ ok: false }`.
- [ ] **Step 2: Implement.** `serializeWorld` = `JSON.stringify({ formatVersion: 1, world })`. `deserializeWorld` narrows the parse result with `typeof`/`in` checks per the JSON-boundary rule (checks: object, `formatVersion === 1`, `world.meta` present with numeric `currentTick`/`seed` — structural spot-checks, not exhaustive validation; pre-1.0 saves are trusted local files). Bump `formatVersion` manually whenever `World` changes shape — old saves then fail `deserializeWorld` cleanly ("saves break on upgrade").
- [ ] **Step 3: Implement `save-files.ts`** with `node:fs/promises` against `saves/` at repo root (`mkdir` recursive on write; names sanitized to `[a-z0-9-_]`; file `saves/<name>.json`). This file is the ONLY `fs` import in `lib/`.
- [ ] **Step 4: Tests PASS; commit** `feat(world): JSON save serialization and saves/ disk adapter`.

### Task 5: `runWorldTick` — the one tick pipeline

**Files:**
- Create: `lib/world/tick.ts`, `lib/tick/adapters/memory/ship-arrivals.ts`
- Delete: `lib/engine/simulator/bot.ts`, `lib/engine/simulator/strategies/` (whole dir), `lib/engine/simulator/economy.ts` (absorbed into `lib/world/tick.ts`), `lib/engine/simulator/world.ts` (absorbed into `generateWorld`), `lib/engine/simulator/pathfinding-cache.ts` (if bots are its only consumer — verify with grep first)
- Modify: `lib/engine/simulator/types.ts`, `lib/engine/simulator/runner.ts`, `lib/engine/simulator/metrics.ts`, `lib/engine/simulator/experiment.ts` (+ analysis modules where field paths move), `scripts/simulate.ts`
- Test: `lib/world/__tests__/tick.test.ts`

**Interfaces:**
- Consumes: pure processor bodies (`run…Processor` in `lib/tick/processors/`), memory adapters (`lib/tick/adapters/memory/`), `World` (Task 1).
- Produces: `runWorldTick(world: World): { world: World; events: TickEventRaw }` — pure; returns the next world (immutable-spread style, as `simulateWorldTick` does today) plus the tick's global events for broadcast. Per-tick RNG: `tickRng(seed, tick) = mulberry32((seed ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0)` — deterministic and save/load-safe with no hidden RNG state to persist.

- [ ] **Step 1: Write `InMemoryShipArrivalsWorld`** implementing `ShipArrivalsWorld` (`lib/tick/world/ship-arrivals-world.ts`: `getArrivingShips`, `dockShip`) over `World.ships`, mirroring the copy-in/read-back pattern of `lib/tick/adapters/memory/economy.ts`. Unit-test it beside the other memory-adapter tests (ship with `arrivalTick <= tick` docks; others untouched).
- [ ] **Step 2: Write failing `tick.test.ts`:** generate `{ systemCount: 100, seed: 42 }`, run 50 ticks; assert `meta.currentTick === 50`, no `NaN`/`Infinity` in any market stock or system population, at least one market stock changed, determinism (same world + same tick count twice → deep-equal), and **relations frequency**: with `RELATIONS_FREQUENCY = f`, relations history length reflects ⌊50/f⌋ runs, not 50.
- [ ] **Step 3: Implement `runWorldTick`** by transplanting `simulateWorldTick`'s stage pipeline (`lib/engine/simulator/economy.ts:425-441`) onto `World`, with three additions: (a) `ship-arrivals` runs via the new memory adapter instead of the sim-only `processSimShipArrivals`; (b) the `relations` processor is wired in (memory adapter exists), gated by its `frequency`/`offset` exactly as `lib/tick/registry.ts` filters (`tick % frequency === offset`); (c) each stage's `rng` param receives the per-tick `tickRng` stream. Stage order = registry topo order (ship-arrivals → events → economy → infrastructure-decay → population → migration → trade-flow → directed-logistics → directed-build → relations). Economy signals flow between stages via the same in-memory results map the sim uses. Hop distances via `computeBoundedHopDistances` on world.connections (as sim does) — Task 8 adds caching.
- [ ] **Step 4: Shrink the simulator to a calibration harness — and kill the bots.** The bot layer (`bot.ts`, `strategies/`) simulates player arbitrage trading, a mechanic the pivot deleted; its synthetic stock mutations now correspond to nothing in the live game and would distort calibration. Delete it. `SimWorld` is replaced by `World` (sim-only types — `SimPlayer`, bot/strategy/trade-log types — die with the bots); `createSimWorld`/`simulateWorldTick` are deleted in favor of `generateWorld`/`runWorldTick`. The runner becomes: generate world → loop `runWorldTick` → snapshot/analyze. `metrics.ts` loses bot-profit/trade metrics; `experiment.ts` + `scripts/simulate.ts` drop strategy/bot config from the YAML shape and CLI. **Health checks re-anchor on intrinsic metrics** the analyzers already compute (no NaN/runaway, price dispersion, stock liquidity, population viability) — the greedy≫random signal is retired with the bots. **Coherence, not parity** (project rule): sim output needn't be bit-identical to pre-refactor; `npm run simulate` must stay healthy on the intrinsic bar.
- [ ] **Step 5: Full gates:** `npx vitest run`, `npm run simulate`, `npx tsc --noEmit` — all green. Commit `feat(world): runWorldTick shared pipeline; simulator converges onto World`.

**PR 1 boundary:** `npx next build --webpack` green (nothing live touched). PR: `feat/pivot-phase2-pr1-world-substrate` → squash into `feat/pivot-phase2`.

---

## PR 2 — Runtime cutover (engine, services, auth, Prisma all flip)

The app is fully functional again at the END of this PR (via dev-bootstrap); intermediate tasks gate on tsc/vitest only.

### Task 6: Tick loop, lifecycle API, SSE re-point

**Files:**
- Create: `lib/world/tick-loop.ts`, `app/api/game/new/route.ts`, `app/api/game/speed/route.ts`, `lib/schemas/game-setup.ts`
- Modify: `app/api/game/tick-stream/route.ts`, `app/api/game/world/route.ts`, `lib/services/world.ts`, `instrumentation.ts`, `lib/tick/types.ts`
- Delete: `lib/tick/engine.ts`, `lib/tick/worker.ts`, `lib/tick/worker-types.ts`, `lib/tick/registry.ts`, `app/api/dev/tick-control/route.ts` (+ `controlTick` in `lib/services/dev-tools.ts`)
- Test: `lib/world/__tests__/tick-loop.test.ts`

**Interfaces:**
- Produces: `tickLoop` singleton (globalThis-cached like the store): `setSpeed(s: Speed)`, `getSpeed(): Speed`, `getAchievedTps(): number`, `subscribe(fn: (e: TickBroadcast) => void): () => void`, `stop()`; `type Speed = "paused" | 1 | 5 | "max"`; `TickBroadcast = { currentTick: number; speed: Speed; achievedTps: number; events: GlobalEventArray }`.
- Produces routes: `POST /api/game/new` body `{ systemCount: number; seed?: number }` (Zod: int 50–20000; seed optional int, defaulted to a random int **in the route handler** — the only permissible `Math.random`, it's outside the tick); `POST /api/game/speed` body `{ speed: "paused" | 1 | 5 | "max" }`; `GET /api/game/world` → `{ meta: WorldMeta; speed: Speed; achievedTps: number }`.

- [ ] **Step 1: Write failing tick-loop tests** (fake timers where needed): starts `"paused"`; `setSpeed(1)` advances `currentTick` via `runWorldTick` on interval; `setSpeed("paused")` stops; at `"max"` a subscriber receives monotonically increasing ticks and the loop yields (test: an awaited `setImmediate` promise resolves while max is running); subscribers receive `TickBroadcast` shape.
- [ ] **Step 2: Implement `tick-loop.ts`.** Paced speeds: `setInterval(() => this.tickOnce(), 1000 / n)`. Max: an async loop — run ticks until a ~50ms `Date.now()` budget elapses, `await new Promise<void>((r) => setImmediate(r))`, repeat while speed is `"max"` (pacing wall-clock only — allowed). `tickOnce()` = `const { world, events } = runWorldTick(getWorld()); setWorld(world); emit(...)`. Track achieved TPS over a rolling 1s window. **Broadcast throttle:** subscribers get at most 4 emits/sec (latest-wins) so max speed can't melt SSE/TanStack; always emit on pause and on speed change. **Autosave:** while unpaused, every 60s wall-clock and on every transition to `"paused"`, fire-and-forget `writeSave(AUTOSAVE_NAME, world)` (dynamic-import `save-files.ts` so the loop module stays pure).
- [ ] **Step 3: Routes + wiring.** `new/route.ts`: validate → `setWorld(generateWorld(...))` → loop starts `"paused"` → `{ data: meta }`. `speed/route.ts`: validate → `tickLoop.setSpeed` → `{ data: { speed } }`. Reshape `lib/services/world.ts` `getGameWorld` to read store+loop. Rewrite `tick-stream/route.ts`: drop `getSessionPlayerId`/401 and per-player `playerEvents` filtering; subscribe to `tickLoop`; frame `TickBroadcast` as today's SSE `data:` frames. `instrumentation.ts`: **dev-bootstrap** — if `!hasWorld()`, `setWorld(generateWorld({ systemCount: 600, seed: 42 }))` (replaced by the start screen in Task 10; keeps the app runnable through this PR). Slim `lib/tick/types.ts`: delete `TxClient` and `PlayerEventMap`; `TickContext` loses `tx`.
- [ ] **Step 4: Delete the old engine files** listed above; fix imports (`processors/*.ts` live-wiring blocks that construct Prisma adapters are removed in Task 7 — here just ensure nothing imports `engine.ts`). Gates: tsc + vitest. Commit `feat(engine): in-process tick loop with speed controls; retire worker engine`.

### Task 7: Services re-point + de-auth routes

**Files:**
- Modify: every service in the table below; every route in `app/api/game/` and `app/api/dev/`
- Delete: `lib/services/visibility-cache.ts`, `lib/services/fleet.ts`, `lib/services/navigation.ts`, `lib/services/refuel.ts`, `lib/api/require-player.ts`, `lib/auth/serialize.ts`, `app/api/game/fleet/route.ts`, `app/api/game/ship/**`, `app/api/game/systems/visibility/route.ts` → **keep route, see below**
- Test: convert `lib/services/__tests__/integration/*.integration.test.ts` → `lib/services/__tests__/*.test.ts`

**Exemplar transformation** (apply to every read service):

```ts
// BEFORE (lib/services/stability.ts)
export async function getStabilityBySystem(): Promise<StabilityEntry[]> {
  const systems = await prisma.starSystem.findMany({ select: { id: true, unrest: true } });
  return systems.map((s) => ({ systemId: s.id, unrest: s.unrest }));
}
// AFTER — sync, reads the world; route handlers need no change beyond dropping auth
export function getStabilityBySystem(): StabilityEntry[] {
  return getWorld().systems.map((s) => ({ systemId: s.id, unrest: s.unrest }));
}
```

Per-service worklist (all lose `playerId` params; "all-visible" = visibility filtering removed, `visibility: "visible"` hardcoded in responses that carry the field — `SystemVisibility` type stays for Phase 3):

| Service | Change |
|---|---|
| `world.ts` | done in Task 6 |
| `atlas.ts`, `universe.ts`, `goods.ts`, `market.ts`, `factions.ts`, `stability.ts`, `population-map.ts`, `static-tiles.ts`, `system-cadence.ts` | mechanical world reads (`goods.ts` reads the constants catalog directly) |
| `dynamic-tiles.ts`, `events.ts`, `market-comparison.ts`, `trade-flow.ts`, `system-population.ts` | world reads + drop playerId + all-visible |
| `universe.ts` detail fns (`getSystemDetail/Substrate/Industry`) | same; replace `relationLoadStrategy`/counts with array scans |
| `adjacency.ts`, `topology.ts`, `hop-distances.ts` | keep module-level caches, rebuild from `getWorld()` when `getWorldVersion()` changed (store version from Task 1); drop the lazy prisma import |
| `dev-tools.ts` | `advanceTicks` → run `runWorldTick` N times synchronously; `spawnEvent`/`resetEconomy`/`getEconomySnapshot` → world mutations/reads; DELETE `giveCredits`, `teleportShip` (player-scale), `controlTick` (Task 6) |
| `visibility-cache.ts` | DELETE. `lib/engine/visibility.ts` (pure BFS) and its tests STAY for Phase 3 fog. |

- [ ] **Step 1:** Re-point the mechanical read services (row 2), converting their routes: delete `requirePlayer` calls (keep `withServiceErrors` wrapper). Gate: tsc.
- [ ] **Step 2:** Re-point the formerly player-gated services (rows 3–4). `/api/game/systems/visibility/route.ts` stays but returns all system ids (`getWorld().systems.map(s => s.id)`) so the untouched client keeps working; the dormant client fog branches are Phase 3's to reactivate. Gate: tsc.
- [ ] **Step 3:** Caches (row 5) + dev-tools (row 6). Delete `lib/api/require-player.ts` and fix remaining imports. Delete fleet/navigation/refuel services + their routes (`/api/game/fleet`, `/api/game/ship/[shipId]/navigate|refuel`) and `lib/auth/serialize.ts` (its only consumers). The processors' live-wiring blocks (`…Processor: TickProcessor` objects constructing `new Prisma…World(ctx.tx)`) are deleted from each `lib/tick/processors/*.ts`, leaving only the pure `run…Processor` bodies + their types. Gate: tsc.
- [ ] **Step 4: Convert the 8 service integration tests** to unit tests: each builds a small world (`generateWorld({ systemCount: 60, seed: N })`), `setWorld`s it (with `clearWorld` in `afterEach`), and asserts against the re-pointed sync services. DELETE the 5 processor/adapter integration tests (`lib/tick/**/integration/`) — the memory-adapter unit tests already cover those bodies. Delete navigation/fleet-related integration tests with their services. Gate: `npx vitest run` green. Commit `feat(services): re-point all services to the in-memory world; drop player gating`.

### Task 8: Auth deletion wholesale

**Files:**
- Delete: `lib/auth/` (whole dir), `app/(auth)/` (whole dir), `app/api/auth/`, `app/api/register/route.ts`, `components/providers/session-provider.tsx`, `lib/schemas/auth.ts`, `proxy.ts`
- Modify: `app/(game)/layout.tsx`, `components/game-shell.tsx`, `components/game-sidebar.tsx`

- [ ] **Step 1:** `app/(game)/layout.tsx`: remove `auth()`/`getSessionPlayerId()`/`redirect("/login")` and the `AuthSessionProvider` wrapper; add `if (!hasWorld()) redirect("/start")` (server import of the store — `/start` 404s until Task 10; dev-bootstrap makes this branch unreachable meanwhile). Drop the `session.user.email` prop through `GameShell`.
- [ ] **Step 2:** `game-sidebar.tsx`: delete the Sign Out button + user section and the `next-auth/react` import.
- [ ] **Step 3:** Delete the listed files/dirs. Search-and-destroy: `next-auth`, `bcryptjs`, `@/lib/auth`, `requirePlayer` must have zero hits outside this plan doc. Gates: tsc + vitest. Commit `feat(auth): delete authentication wholesale — single-player`.

### Task 9: Prisma/Postgres deletion wholesale

**Files:**
- Delete: `prisma/` (schema, seed, migrations), `prisma.config.ts`, `lib/prisma.ts`, `app/generated/prisma/`, `lib/tick/adapters/prisma/` (whole dir + its tests), `docker-compose.yml`, `scripts/init-test-db.sql`, `vitest.integration.setup.ts`, `lib/test-utils/integration.ts`
- Modify: `package.json`, `vitest.config.ts`, `.env` / `.env.example`, `next.config.ts`

- [ ] **Step 1:** Delete files/dirs above. Remove the `integration` project from `vitest.config.ts` (unit project remains; drop the integration exclude).
- [ ] **Step 2:** `package.json`: remove deps `@auth/prisma-adapter`, `@prisma/adapter-pg`, `@prisma/client`, `prisma`, `pg`, `@types/pg`, `bcryptjs`, `@types/bcryptjs`, `next-auth`; remove the `prisma.seed` block and `test:integration`; DELETE DB-bound scripts `bench:tick`, `find:smoke-systems`, `audit:economy` (the simulator is the bench now; re-add world-based instruments only when a need appears). `npm install` to update the lockfile.
- [ ] **Step 3:** `.env`: remove `DATABASE_URL`, `NEXTAUTH_*`/`AUTH_*`. (`UNIVERSE_SCALE` dies in Task 13; `ECONOMY_SCALE` stays, server-only.)
- [ ] **Step 4:** Search-and-destroy: `@/lib/prisma`, `generated/prisma`, `DATABASE_URL`, `$transaction` — zero hits in source. Full gates: tsc, `npx vitest run`, `npm run simulate`, `npx next build --webpack`, then `npm run dev` and manually verify: map renders from the dev-bootstrap world, `POST /api/game/speed {"speed":1}` makes the sidebar tick counter advance, system panels populate. Commit `feat(engine): delete Prisma and PostgreSQL — the world is in memory`.

**PR 2 boundary:** full gates green. PR: `feat/pivot-phase2-pr2-runtime-cutover` → squash into `feat/pivot-phase2`.

---

## PR 3 — Game surface (start screen, saves, speed UI, ship-UI removal, scale env)

### Task 10: Start screen + save/load

**Files:**
- Create: `app/start/page.tsx` (+ small client components under `components/start/`), `app/api/game/saves/route.ts` (GET list / POST create), `app/api/game/load/route.ts`
- Modify: `lib/schemas/game-setup.ts` (save-name schema), `instrumentation.ts` (remove dev-bootstrap)

**Interfaces:**
- Consumes: `generateWorld`, `setWorld`, `listSaves`/`writeSave`/`readSave`/`AUTOSAVE_NAME`, `deserializeWorld`.
- Produces: `GET /api/game/saves` → `{ data: SaveInfo[] }`; `POST /api/game/saves` `{ name }` → save current world; `POST /api/game/load` `{ name }` → `deserializeWorld(readSave(name))`, discriminated-union error on version/shape mismatch ("incompatible save").

- [ ] **Step 1:** Saves/load routes (thin wrappers; mutation services return discriminated unions per convention — put `newGame`/`loadGame`/`saveGame` logic in `lib/services/game-lifecycle.ts`, routes stay thin).
- [ ] **Step 2:** Start page — a standalone page (own minimal centered layout, Foundry theme: Card + copper accent, `font-display` title; no game shell/providers beyond a local QueryClient or plain `fetch`+RHF). Sections: **Continue** (shown only when autosave exists → load autosave), **New Game** (RHF + Zod: `NumberInput` systemCount default 600, `TextInput` seed optional; submit → `POST /api/game/new` with a "Generating…" pending state on the button), **Load Game** (list from GET saves; click → load). On any success: `window.location.href = "/"` — the **hard navigation is deliberate** (fresh TanStack cache; every `staleTime: Infinity` query re-fetches against the new world).
- [ ] **Step 3:** Remove the dev-bootstrap from `instrumentation.ts` — `/start` is now the real entry. Add a "Save" affordance + "Exit to menu" (link to `/start`) in the sidebar user-section slot freed by Task 8. Manual verify: fresh boot → redirected to `/start` → new game 600 → map; save named; load it back; Continue works after a pause-triggered autosave. Commit `feat(game): start screen, save/load, new-game flow`.

### Task 11: Speed controls UI

**Files:**
- Create: `components/speed-controls.tsx`
- Modify: `components/game-sidebar.tsx` (status section), `lib/hooks/use-tick.ts`, `lib/hooks/use-dev-tools.ts` (drop `useTickControlMutation`), `components/dev-tools/tick-control-section.tsx` (delete; dev panel keeps advance-ticks)

- [ ] **Step 1:** `SpeedControls`: four `Button`s (⏸ / 1× / 5× / ⏩ max) + achieved-TPS readout (`font-mono`), driven by a `useSpeedMutation` hook (`POST /api/game/speed`) and current speed/TPS from the SSE payload (extend `use-tick.ts` to surface `speed`/`achievedTps` from `TickBroadcast`). Active speed = filled variant. Mount in the sidebar status section beside the tick display.
- [ ] **Step 2:** Delete the dev tick-control section (superseded); keep dev advance-ticks (useful while paused). Manual verify: pause/resume/max from the UI; TPS readout moves at max. Commit `feat(ui): speed controls with achieved-TPS readout`.

### Task 12: Ship/fleet UI removal + map decoupling

**Files:**
- Delete: `app/(game)/@panel/fleet/`, `app/(game)/@panel/ship/`, `app/(game)/@panel/system/[systemId]/ships/`, `components/fleet/` (whole dir), `components/map/pixi/layers/fleet-dot-layer.ts`, `fleet-transit-layer.ts`, `lib/hooks/use-fleet.ts`, `use-navigate-mutation.ts`, `use-refuel-mutation.ts`, `use-navigation-state.ts`
- Modify: `components/map/star-map.tsx`, `components/map/pixi/pixi-map-canvas.tsx`, `lib/hooks/use-map-data.ts`, `lib/hooks/use-map-overlays.ts`, `components/top-bar.tsx`, `app/(game)/@panel/system/[systemId]/layout.tsx`, `lib/constants/system-tabs.ts`, `components/game-sidebar.tsx`, `lib/query/keys.ts`, `lib/hooks/use-tick-invalidation.ts`, `app/(game)/page.tsx`

- [ ] **Step 1:** Delete the panel routes/components/hooks listed. Sidebar: remove the Fleet nav group. System panel: remove the Ships tab + docked-count badge (`system-tabs.ts` + panel layout).
- [ ] **Step 2:** Decouple the map: `star-map.tsx` loses `ships`/`onNavigateShip` props and the `useFleet`/navigation-state wiring in `app/(game)/page.tsx`; `pixi-map-canvas.tsx` drops the fleet layers + `showFleet`/`showShipRoutes` flags; `use-map-overlays.ts` drops those toggles; `use-map-data.ts` drops ship-count/transit derivation; `top-bar.tsx` drops `useFleet` ship-name breadcrumbs.
- [ ] **Step 3:** Sweep the data layer: remove `queryKeys.fleet`; `use-tick-invalidation.ts` drops `shipArrived` subscriptions (and `use-tick.ts` drops `subscribeToArrivals`) — ship arrival events stay server-side in `GlobalEventMap` for Phase 3. Quality-checklist sweep for orphans (unused props, dead imports, empty dirs). Gates: tsc, vitest, build, manual map check (renders, panels open, overlays fine). Commit `feat(ui): remove ship/fleet UI; decouple map from fleet data`.

### Task 13: `UNIVERSE_SCALE` removal — map extent from world state

**Files:**
- Modify: `lib/engine/tiles.ts`, `lib/hooks/use-static-tiles.ts`, `lib/services/atlas.ts` (+ `AtlasData` type), `components/map/pixi/layers/territory-layer.ts`, `political-territory-layer.ts`, `population-territory-layer.ts`, `stability-territory-layer.ts`, `components/map/star-map.tsx` / `pixi-map-canvas.tsx` (thread `mapSize`), `lib/constants/universe-gen.ts`, `next.config.ts`, `.env`
- Test: extend `lib/engine/__tests__/tiles.test.ts`

- [ ] **Step 1:** `tiles.ts`: `TILE_COLS`/`TILE_ROWS` stay 16; `systemToTile`, `tileBounds`, `frustumToTiles` gain a `mapSize: number` parameter replacing the module-level `TILE_WIDTH`/`TILE_HEIGHT` (test: existing cases pass with `mapSize` passed explicitly; half-open `[min, max)` invariant preserved).
- [ ] **Step 2:** `AtlasData` gains `meta: { mapSize: number; systemCount: number; seed: number }` from world meta. Client: `use-static-tiles.ts` takes `mapSize` (from the atlas query its callers already hold) — tile query key becomes `staticTile(col, row, mapSize)`; the `?scale=` param dies (`static-tiles` service reads the world). Territory layers + canvas take `mapSize` via props instead of `UNIVERSE_GEN.MAP_SIZE`.
- [ ] **Step 3:** `lib/constants/universe-gen.ts`: delete `resolveScale`/`ACTIVE_SCALE`/`SCALE_OVERRIDES` and the `UNIVERSE_GEN` export once nothing imports them (Task 2's `genConfigForSystemCount` + `BASE_CONFIG` remain). Remove the `env` block from `next.config.ts` and `UNIVERSE_SCALE` from `.env`. Search-and-destroy: `UNIVERSE_SCALE`, `ACTIVE_SCALE`, `MAP_SIZE` — zero source hits. Gates: tsc, vitest, build, manual map check at a non-600 system count (e.g. new game at 2,000 — tiles and territory extents must track the generated size). Commit `feat(map): map extent from world state; delete UNIVERSE_SCALE env`.

**PR 3 boundary:** full gates + a real playthrough: new game → watch at 5× → max for 2k ticks → save → load → continue. PR: `feat/pivot-phase2-pr3-game-surface` → squash into `feat/pivot-phase2`.

---

## PR 4 — Docs lifecycle + cleanup (on the feature branch, before merge)

### Task 14: Documentation + final review

**Files:**
- Modify: `CLAUDE.md`, `docs/SPEC.md`, `docs/active/engineering/tick-engine.md`, `docs/active/engineering/processor-architecture.md`, `docs/active/engineering/map-data-loading.md`, `docs/planned/grand-strategy-vision.md`, `docs/BACKLOG.md`, `.claude/skills/uber-review/rules/code-standards.md`
- Move: `docs/planned/pivot-phase2-engine-extraction.md` → `docs/active/engineering/single-player-runtime.md` (rewritten as shipped-state doc)
- Delete: this build plan

- [ ] **Step 1: CLAUDE.md rewrite:** Commands (drop prisma seed/db push/simulate DB caveats; add save-dir + start-screen notes; simulate text updates), Tech Stack (drop Prisma/NextAuth/Postgres lines), Project Structure (`lib/world/` added; `lib/tick/` description updated — no adapters split), Gotchas (**delete the whole "Prisma 7 / PostgreSQL" block, the `DATABASE_URL` unit-test gotcha, the Caching-API TOCTOU/Cache-Control lines that assume auth**; keep Tailwind/Pixi/testing gotchas; add: "world is process state — dev-server restart loses unsaved progress; autosave covers it"). Mirror removed gotchas' review slugs out of `uber-review/rules/code-standards.md`.
- [ ] **Step 2: Docs lifecycle:** spec → `docs/active/engineering/single-player-runtime.md` (present tense, code-is-truth); update tick-engine/processor-architecture docs (worker + adapters gone, tick loop + speed model, world store, save format), map-data-loading (mapSize from atlas), SPEC.md overview + system sections touched by Phase 2, vision doc §8 Phase 2 marked shipped; BACKLOG purge of anything Phase 2 killed. Delete this plan file.
- [ ] **Step 3: Final review:** run `/uber-review` on the shared branch (diff vs main), fix findings per severity policy. Full gates one last time.
- [ ] **Step 4:** PR `feat/pivot-phase2` → main, **squash** (phase-commit subjects carry PR noise). Delete branches.

---

## Deviations from spec (agreed or flagged)

- **Autosave cadence:** spec said "every N ticks and on pause"; at max speed (100s–1000s TPS) tick-count cadence is absurd — implemented as every 60s wall-clock while running + on pause. Wall-clock here is pacing, not tick math.
- **Credits die with `Player`.** Phase 1 kept credits plumbing; Phase 2 deletes the `Player` model, and credits have no owner until the Phase 3 faction treasury. Flagged to user in plan review.
- **Fleet/navigate/refuel routes+services delete** (they are player verbs on player-owned ships); the Ship model, travel fields, `ship-arrivals` processor, and `lib/engine/ship-factory.ts` stay — that's the "backend kept" for Phase 3 fleets. World-gen seeds no ships until fleets mean something.
- **SSE broadcast throttled to ~4 Hz** at high speed — clients render latest-wins snapshots; per-tick delivery was never a contract.
- **World-gen progress is a single "Generating…" pending state**, not the spec's staged labels — generation is one synchronous server call; streaming stage labels would require chunked responses for a wait we expect to be seconds. Revisit only if 10K+ gen proves slow.
- **Sim bots and strategies are deleted** (agreed 2026-07-06): they simulated player arbitrage trading, dead since the pivot; the simulator shrinks to a headless calibration harness over the real engine. Health checks re-anchor on intrinsic metrics; greedy≫random retires.
- **Market/pricing simplification is deliberately NOT in Phase 2.** The curve/anchor pricing apparatus is arbitrage-era and likely over-built for a cost signal, but changing market mechanics mid-extraction would destroy the coherence baseline (extracted engine must behave like the pre-extraction engine so differences attribute to bugs). It is booked into the Phase 4 economy re-point (vision §5.5) with the single recalibration — informed by real max-speed profiling from the ant farm. Implementers: do not "helpfully" simplify pricing in this phase.
