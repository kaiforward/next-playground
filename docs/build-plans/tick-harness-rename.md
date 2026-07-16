# Tick-harness rename — retiring the "Sim" concept

**Delete this file when the work ships** (per the build-plans convention).

## Headline

There is one world model and one tick body. `runWorldTick` is the game; the live `TickLoop` and the
calibration harness both call it. But the vocabulary still describes a two-backend world that no
longer exists: the tick's own working types are named `Sim*` and live inside a directory called
`simulator/`, and a 259-line constants-override system survives that nothing reads.

This project removes the Sim-vs-World concept entirely. PR1–3 are **rename, move, and delete only —
no behaviour change**: every number the game produces must be identical afterward, and the harness
itself is the gate that proves it. PR4 then adds the one thing the harness genuinely lacks — the
ability to report what it ran — on a codebase already proven unchanged.

The market round-trip *perf* win is deliberately **out of scope** and sequenced after (see
Follow-ups). It is unlocked by this work: `TickMarket` is what gets deleted.

---

## Findings (the evidence base)

Established by reading the code, not from memory. Recorded because several of these correct beliefs
that are currently written down elsewhere.

### The harness does not diverge from the game

- `TickLoop.tickOnce()` (`lib/world/tick-loop.ts:123-152`) is `runWorldTick(getWorld())` →
  `setWorld(world)` → pacing, autosave, SSE broadcast. Nothing game-mechanical happens outside
  `runWorldTick`.
- `runSimulation()` (`lib/engine/simulator/runner.ts:91-116`) is `generateWorld()` → loop
  `runWorldTick(world)` → analyze.
- The only other `setWorld` callers are new-game/load (`lib/services/game.ts`) and the dev cheat
  panel (`lib/services/dev-tools.ts`). Neither is per-tick gameplay.

**The harness's entire upstream surface is two function calls — both the game's own — plus one env
load.** There is no second implementation and nothing for a feature to "miss".

### The analysis layer cannot cause divergence

Divergence risk is directional: only code *upstream* of the tick can change what the game does.
Code *downstream* can only mis-measure. The ~815 lines of analyzers are entirely downstream, and
they reuse the game's own math rather than reimplementing it:

- `market-analysis.ts:9` imports `spotPrice`, `curveForGood`, `marketBand`, `midPriceAt` from
  `lib/engine/market-pricing`.
- `event-analysis.ts:10` imports `spotPrice`, `curveForGood` from the same module.
- `population-analysis.ts` imports only a type; it is pure aggregation.
- `build-analysis.ts` reads constants, reimplements nothing.

The analyzers sit exactly where the UI sits — reading tick output and rendering it for a human.

### The structural bug

`SimSystem` is the tick's core working type. Every processor adapter uses it; `runWorldTick` is
built on it; it is on the hot path of every live tick. **It is defined in
`lib/engine/simulator/types.ts`.** Live game code (`lib/tick/adapters/memory/economy.ts`) imports
its row types from a directory named `simulator`. The directory name asserts a split the code does
not have — which is why the split keeps being believed, and why doc comments asserting it read as
plausible.

### The harness cannot report what it did not exercise

The harness's real weakness — a reporting gap, not a correctness or divergence one:

- **No analyzer measures logistics activity.** `market-analysis.ts:10` imports `DIRECTED_LOGISTICS`
  only to compute surplus/deficit *thresholds* (`:231-232`) — it measures market cover, never
  whether a transfer happened.
- `runner.ts:94-98` discards `result.events` entirely, taking only `.world` and `.markets`.
- `SimFlowEvent` is defined and unwired — the shape for exactly this measurement, never built.

By contrast `build-analysis.ts` has the instinct already: its own comment describes splitting
construction projects "to tell 'proposes nothing' from 'never funds'". Logistics has no equivalent.
The session-18 `Math.floor` bug survived review because the harness ran directed-logistics faithfully
and never reported that its seed fired zero transfers in 500 ticks.

This is the same shape as the ECONOMY_SCALE gap below: the harness is correct, and silent about it.

### Dead code

- `lib/engine/simulator/constants.ts` (259 lines) — `SimConstants`, `SimConstantOverrides`,
  `resolveConstants()`, `DEFAULT_SIM_CONSTANTS`, deep-partial merge machinery, an unknown-key
  `console.warn`, and a `bots` section for a bot layer that no longer exists. **Read by zero
  production code.** The per-run override channel it served was removed (`runner.ts:4-6`,
  `experiment.ts:3-9`); an experiment config now only names `seed`/`ticks`/`systemCount`.
- `lib/engine/__tests__/sim-constants.test.ts` (~160 lines) — tests that override mechanism. It
  passes. It guards a door into an empty room.
- `SimRegion`, `SimFlowEvent` — defined in `simulator/types.ts`, zero usages.

### Doc rot

- `lib/engine/tick.ts:115` and `lib/tick/adapters/memory/events.ts:27` describe "DB vs SimWorld".
  `SimWorld`, `SimPlayer`, `SimShip` exist only in prose.
- `lib/tick/world/events-world.ts:113-117` documents `/** Live: scaleEventCaps result. Sim:
  SimConstants.events caps. */` for fields that now have exactly one source.

### ECONOMY_SCALE is already structurally correct

`lib/constants/economy-scale.ts:30` resolves `process.env.ECONOMY_SCALE ?? "100"` — **the code
default is the scale the game is played at**, so game and harness match with no `.env` present.
The `import "dotenv/config"` in `scripts/simulate.ts` only honours a deliberate override.

This corrects an earlier belief that the match depended on convention. It does not. What remains is
narrower — see "ECONOMY_SCALE hardening" below.

### Correction to docs/BACKLOG.md

The backlog's market round-trip entry proposes reference-identity against the `toSimMarkets` output
as the cheap dirty-check, flagging in-place row mutation as the risk to verify first. **Verified:
the adapters never mutate the caller's rows** — every adapter constructor deep-copies
(`economy.ts:40`, `events.ts:51`, `population.ts:18`). So the feared aliasing hazard does not exist,
but the identity check is dead on arrival for the opposite reason: each adapter unconditionally
returns a fresh array of fresh row objects whether or not anything changed, so the check would
report "dirty" every tick. It fails safe (no correctness bug, no win). A dirty flag is the only one
of the two proposed variants that survives. Fold this into the perf project.

---

## Scope

**In:** renaming, moving, and deleting the Sim concept (PR1–3); doc fixes; and, in PR4 only, the
ECONOMY_SCALE hardening and the logistics-activity metric.

**Out:** any change to the simulation's numbers — in *any* PR, including PR4, whose additions are
report-only; the market round-trip perf work; the tick-boundary-gating work (parked on
`perf/tick-boundary-gating`).

There is no harness-coverage workstream — it was considered and dissolved (see Follow-ups).

---

## Target state

### Directory

`lib/engine/simulator/` → `lib/tick-harness/`.

Out of `lib/engine/`, which CLAUDE.md reserves for pure game logic — a dev instrument is not game
logic. The name encodes the scope boundary: the harness tests the tick processors and the data they
consume/produce, and nothing else. A reader asking "should save/load tests go here?" is answered by
the name.

### Row types — move to `lib/tick/rows.ts`

New file. `lib/tick/types.ts` is the tick's *plumbing* (`TickContext`, `TickProcessorResult`,
`EconomySignals`, broadcast payloads); the row types are the tick's *data*. Keeping them apart keeps
both files focused and makes `TickMarket`'s eventual deletion in the perf project a single-file
change.

| Now | Becomes |
|---|---|
| `SimSystem` | `TickSystem` |
| `SimConnection` | `TickConnection` |
| `SimMarketEntry` | `TickMarket` |
| `SimEvent` | `TickEvent` |
| `toSimSystems` / `toSimMarkets` / `toSimConnections` (`lib/world/tick.ts`) | `toTickSystems` / `toTickMarkets` / `toTickConnections` |

These are **mutable per-tick working copies**, not read-only views — `mergeSystemsIntoWorld`
(`tick.ts:212`) and `flattenBuildings` (`tick.ts:231`) write them back into `World`. Their doc
comments must say so. They deliberately do **not** live next to `World` in `lib/world/types.ts`,
which is the persisted, JSON-serializable contract; a mutable non-persisted scratch type there would
invite the assumption that it saves.

### Name collision

`TickEventRaw` (`lib/tick/types.ts`) is a *broadcast payload*, not an event; `SimEvent` is a *world
event* (a strike, a shortage). Rename `TickEventRaw` → `TickBroadcastRaw`, matching `TickBroadcast`
in `tick-loop.ts` — which is what it actually is — freeing `TickEvent` for the world-event row.

### Delete

- All of `lib/engine/simulator/constants.ts`
- `lib/engine/__tests__/sim-constants.test.ts`
- `SimRegion`, `SimFlowEvent`

`SimFlowEvent` is deleted **even though PR4 adds the logistics metric it was evidently meant for**.
It is a near-duplicate of `WorldFlowEvent`, which already exists and is already populated by
directed-logistics (`tick.ts:675-676`); PR4 reads that instead. Note `world.flowEvents` is pruned to
`TRADE_SIMULATION.FLOW_HISTORY_TICKS` (`tick.ts:679-680`), so a whole-run count must accumulate
per-tick rather than read the final world.

Two live tests currently reach real values *through* the dead indirection and must import directly
instead — which is the point:

- `lib/tick/processors/__tests__/economy.test.ts:38` — `DEFAULT_SIM_CONSTANTS.events.modifierCaps`
  → `MODIFIER_CAPS` from `lib/constants/events`
- `lib/engine/simulator/__tests__/economy-scale-pressure.test.ts:6` — `resolveConstants()` → the
  underlying constants directly

### Harness internals

| Now | Becomes |
|---|---|
| `SimConfig` | `HarnessConfig` |
| `SimResults` | `HarnessResults` |
| `runSimulation` | `runTickHarness` |

`SimConstants` / `SimConstantOverrides` are deleted, not renamed.

### Keep `npm run simulate`

*Simulate* as a **verb** is honest — the game is a simulation, and the harness simulates the
universe for N ticks. What was wrong was "the Sim" as a **noun** naming a separate thing that does
not exist. Kill the noun, keep the verb. Renaming the npm script would churn CLAUDE.md, docs, and
muscle memory for no clarity gain.

### ECONOMY_SCALE hardening

**Lands in PR4**, not PR3 — it adds output, and PR1–3 must stay byte-identical (see Verification).

The coupling is already correct by default (see Findings). Two narrow gaps remain:

1. **The harness never reports the scale it ran at.** Print the resolved `ECONOMY_SCALE` in the
   `npm run simulate` header and include it in the experiment JSON. A scale mismatch becomes
   visible instead of silent — this, not the coupling itself, is what makes a mismatch expensive to
   diagnose.
2. **The import-order invariant is comment-guarded.** `import "dotenv/config"` must precede any
   import transitively reaching `economy-scale.ts`, which resolves at module load. Replace the
   comment with an assert in `scripts/simulate.ts`: after imports, if `process.env.ECONOMY_SCALE` is
   set and disagrees with the resolved `ECONOMY_SCALE`, throw with a message naming the import-order
   cause. Converts silent wrong-numbers into a loud crash.

There is no `import/order` or `simple-import-sort` rule in the eslint config, so nothing will
auto-reorder the dotenv import; the risk is a human adding an import above it.

**Not doing:** making the scale lazily-read. `economy-scale.ts` is deliberately the root of the
constants-magnitude graph and imports nothing; making it lazy would turn every derived constant into
a function — enormous churn to fix a landmine a 3-line assert defuses.

### Doc fixes

- `lib/engine/tick.ts:115`, `lib/tick/adapters/memory/events.ts:27` — drop "DB vs SimWorld"
- `lib/tick/world/events-world.ts:113-117` — collapse "Live: X. Sim: Y." to the single source
- `docs/active/engineering/processor-architecture.md` — the "World → view joins" section and the
  `simulator/runner.ts` references
- `CLAUDE.md` — the harness paragraph under Commands, and the `lib/engine/` layer description

---

## Verification

PR1–3 are a rename, a move, or a deletion of unreferenced code. **No number may change, and no
output may be added.** The harness is deterministic (seeded `tickRng`; no wall-clock in processor
bodies), so it proves this directly:

```
npm run simulate -- --json    # before, fixed seed → capture
<refactor>
npm run simulate -- --json    # after, same seed → must match
```

Any diff is a real behaviour change the refactor smuggled in.

**This gate is the reason the project is safe, and it is deliberately kept absolute for PR1–3.** All
new output — the ECONOMY_SCALE print, the logistics metric — is quarantined in PR4 precisely so this
comparison stays "identical, no exceptions" rather than the weaker "identical except the new fields".
PR4 then adds output to a codebase already proven unchanged, and its own gate is the narrower
"every pre-existing field unchanged; new fields additive".

**Timing fields must be stripped before comparing** — the results carry `elapsedMs`, which is
wall-clock. Confirm which fields `buildExperimentResult` leaks (at minimum `elapsedMs`) and exclude
them; do not assume the set.

Layered gates, per CLAUDE.md: `npx tsc`, `npx vitest run`, `npx next build --webpack`.

Note the suite's test count **drops** in PR1 — `sim-constants.test.ts` is deleted along with the
mechanism it guards. That is the intended outcome, not a regression: those tests assert that
`resolveConstants({economy: {holdCover: 1.5}})` returns `1.5`, which is true and meaningless. Do not
treat a falling count here as a gate failure.

---

## Sequencing

Four PRs, **straight to main**, delete first.

| PR | Contents | Gate |
|---|---|---|
| **1. Delete the corpse** | `constants.ts`, `sim-constants.test.ts`, `SimRegion`, `SimFlowEvent`; redirect the two tests reaching through the dead indirection. Pure deletion, no rename — shrinks what PR2 must rename. | byte-identical |
| **2. Move + rename the row types** | `Sim*` → `Tick*` into `lib/tick/rows.ts`; `toSim*` → `toTick*`; `TickEventRaw` → `TickBroadcastRaw`. The large mechanical diff, isolated. | byte-identical |
| **3. Move the harness** | Directory move to `lib/tick-harness/`; `HarnessConfig`/`HarnessResults`/`runTickHarness`; all doc fixes. | byte-identical |
| **4. Make the harness say what it ran** | ECONOMY_SCALE print + assert; logistics-activity metric. The only PR that changes output. Delete this build plan. | pre-existing fields unchanged; new fields additive |

PR1–3 carry the absolute gate independently. PR4 is deliberately last so the three mechanical PRs
are provable against an unweakened comparison.

**Deliberate deviation from CLAUDE.md**, agreed with the user: the convention says multi-PR features
use a shared feature branch. These are not phases of one feature — each is independently shippable
and valuable, with no intermediate broken state. A shared branch would buy atomic-feature history
for something that is not one feature. They are sequential, so each rebases onto the last.

---

## Follow-ups (out of scope, booked)

**There is no separate "harness coverage" project.** It was considered and dissolved: the harness
runs the same code as the game, so there is no "does the sim implement X" question to investigate —
the rename is what keeps that answered. Of the three gaps originally grouped under it, save/load and
player actions are both outside the harness's scope by definition (the harness tests the tick
processors and the data they consume/produce, nothing else), and the third — "seeds have gaps" — is
a permanent condition of testing, not a deliverable. What was real in it is the reporting gap, now
PR4.

To `docs/BACKLOG.md` rather than a project:

- **[S] Alarm the ECONOMY_SCALE invariance bridge** — `vitest.config.ts:14` pins
  `ECONOMY_SCALE: "1"`, so the whole suite tests a scale nobody plays at. This is defensible **only
  because** `economy-scale-invariance.test.ts` and `economy-scale-dynamic-invariance.test.ts` prove
  S-invariance; those two tests are the load-bearing bridge that makes S=1 testing valid for an
  S=100 game. When invariance broke in session 18 (the directed-logistics `Math.floor`), the bridge
  collapsed and every magnitude assertion in the suite silently became meaningless, with nothing
  detecting it. Worth making that dependency explicit and alarmed.

Larger, sequenced after this project:

1. **The market round-trip perf win** — `TickMarket` differs from `WorldMarket` by three static
   `GOODS` constants (`basePrice`, `priceFloor`, `priceCeiling`). `mergeMarketsIntoWorld` costs
   27.1ms/tick at 2,400 systems (49.9% of an off-boundary tick) stripping them back off. Deleting
   the round-trip — processors reading `GOODS[goodId]` at point of use — is the fix, not caching
   it. See the BACKLOG correction above for why the proposed identity check cannot work.

2. **Tick-boundary gating** — parked on `perf/tick-boundary-gating`. Its scoping assumed the market
   round-trip cost stays; if follow-up 1 lands first, re-measure before designing it. Its gating
   targets (economy/migration/logistics/build) are ~13% of wall time, versus the round-trip's ~50%,
   so the ordering matters.
