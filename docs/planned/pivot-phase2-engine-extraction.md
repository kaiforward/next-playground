# Pivot Phase 2 — The Ant Farm (Engine Extraction)

Status: **planned — spec agreed 2026-07-06.** Phase 2 of the grand-strategy pivot ([grand-strategy-vision.md](./grand-strategy-vision.md) §8); follows the Phase 1 teardown (`ae904a6`). Build plan to follow in `docs/build-plans/`.

## Headline

The living galaxy runs locally as an observable simulation — **no Postgres, no login**. The world lives in memory inside the Next.js server process; services re-point from Prisma to it; save/load is JSON snapshots on local disk; a thin start screen (system count + seed) replaces auth as the entry point; and the tick runs under pause/speed controls up to a CPU-bound max. Every system is fully visible (no fog-of-war) until the player seat arrives in Phase 3. Ship/fleet UI is removed; ship travel and the fleet backend stay for Phase 3.

## Decisions

### Runtime: path A, held to path-B purity rules

The world is an in-memory singleton in the Next.js server process (vision §6 packaging path A). API routes, TanStack Query hooks, and the tick event stream survive nearly unchanged — the client doesn't know anything moved. The multiplayer SSE *fan-out* apparatus dies; a single-client tick stream remains as transport.

Path B later (engine in a Web Worker, fully client-side) stays a cheap transport swap **iff** Phase 2 holds these lines:

- **Engine, services, and world-gen are pure TS with no Node-only APIs** — no `fs`, no `process.env` reads, no Prisma inside anything that would move into a worker.
- **Service inputs/outputs are plain serializable data** (structured-clone-able) — no class instances or functions crossing the boundary.
- **Node-touching code lives at thin edges** — save-to-disk, env reads, and the HTTP layer are adapters nothing else knows about.

### Prisma / Postgres: wholesale deletion

- Delete `prisma/` (schema, seed, config), `lib/prisma.ts`, the Prisma tick adapters, all `@prisma/*` dependencies, `DATABASE_URL`, and the dev Postgres dependency.
- World-state types become hand-owned (needed for save files regardless); Prisma-generated types are replaced at the source.
- `*.integration.test.ts` either converts to plain unit tests against the in-memory world or is deleted where it tested DB mechanics that no longer exist.
- **The adapter split collapses.** With one backend there is no adapter layer: processors run directly against the single in-memory world, and the simulator and the live game finally run literally the same object. Most of the DB gotchas in CLAUDE.md retire with it.

### Start screen

Entry surface: **Continue** (rolling autosave) · **Load** (named saves) · **New game**.

- New game options: **system count** — a plain number input, default 600, Zod-validated to a sane range (50–20,000); **seed** — optional text input, random when blank. Nothing else until Phase 3 gives the player a seat to configure.
- World-gen is the seed script's successor: a pure in-process function invoked on New game. While generating, show a coarse stage label ("Generating systems… seeding factions…"), not a fake-precise progress bar. Profile 10K-scale gen time only if it proves slow.
- **`UNIVERSE_SCALE` dies entirely** (env var, `next.config.ts` `env` entry, and its client-bundle gotcha). Map extent derives from system count as a continuous function, becomes part of generated world state, and the client reads map dimensions from the API like everything else.

### Save / load

- A save is **one JSON snapshot of the whole world**, written to a local `saves/` directory via a thin API route (the server owns disk under path A).
- One rolling autosave (every N ticks and on pause) plus manual named saves.
- **Pre-1.0 rule: saves break on upgrade.** No format versioning or migration; old saves are declared invalid when world-state shape changes.
- No compression until file size proves it necessary.

### Tick & speed

- Tick cadence is now purely a game-feel dial — the old 5-second wall-clock existed for DB load and is dead.
- Speed steps: **pause · 1 tick/s · 5 ticks/s · max (uncapped)**.
- Max speed runs a yielding loop (batch a few ticks, yield to the event loop, repeat) so the API and map stay responsive; the UI reports *achieved* ticks/sec rather than promising a rate.
- Time fiction is deferred: the UI says "ticks" until Phase 3 decides what a day is.

### Surface: what stands in the ant farm

- **Auth deletes wholesale** — NextAuth, sessions, per-player state.
- **Ship/fleet UI pages delete**; ship travel and fleet models stay in the backend for Phase 3 fleets.
- **No fog-of-war** — every system fully viewable until factions/player arrive in Phase 3.
- Remaining pages: map (primary), system detail, economy inspection views, notifications feed. Page-per-screen routing is kept; the map-first single-surface redesign is a Phase 3+ question (vision §5.5).

### Multiplayer-someday guardrails

Paradox-style lockstep multiplayer needs **no database and no stateful server**: every machine runs the identical deterministic simulation and only player *commands* cross the network via a stateless relay ("faction 3 orders a shipyard in system X, effective tick 4,102"). Deleting Postgres closes no doors. What actually keeps the door open:

- **Determinism** (keep, from vision §6): seeded RNG, no wall-clock reads inside the tick.
- **Command boundary** (adopt with Phase 3 verbs): player mutations are serializable orders applied at tick boundaries, never mid-tick reaches into world state. Also pays for itself immediately — save-replay debugging, and AI factions using the identical order set.
- **Known constraint, deferred**: JS transcendental `Math` functions (`sin`, `pow`, …) are implementation-defined — different engines can diverge in the last bit and desync a lockstep session. Solve at MP time via same-engine desktop packaging or a deterministic math shim over the few call sites; not worth designing for now.

## Out of scope (Phase 3+)

Player seat, faction pick, treasury/budgets, build orders; small-cores world-gen and colonisation; fog-of-war; map-first UI redesign; time fiction; Electron/Tauri packaging; path B worker extraction.
