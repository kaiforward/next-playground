# Substrate-v2 P6 — Tick-cadence rework (scale-correct sharding)

> **Transient design note** (`docs/plans/`). Graduates into `docs/active/engineering/tick-engine.md` at ship — delete this then. The build-task breakdown lives in `economy-substrate-v2.md` P6. Source of truth thereafter is the code.

## Headline

The economy is sharded by **region** — a *territory* concept (faction borders, names) doing double duty as the *performance* clock. So a system's economy advances once every `regionCount` ticks (**24** default / **60** at 10k), applying one calibrated update. Two consequences:

1. **The economy's wall-clock speed depends on universe size.** At 10k it runs **2.5× slower per system** than the 600-system scale we calibrate at — so calibration never transfers to live. A performance knob silently sets a gameplay rate (the [[feedback-separate-gameplay-from-performance]] violation).
2. **The audit found worse:** `price-snapshots` rescans **all ~205k markets every 20 ticks** (a multi-second stall at 10k) and `trade-missions` does a heavy global pass every 5 ticks — both unsharded all-at-once work that scales with the universe.

P6 **decouples sharding from regions and pins the update interval to a fixed gameplay constant**, so every universe updates every system on the same clock regardless of scale, and folds the all-at-once offenders onto that shard so they stop full-scanning. Tick-rate, update-interval, and per-tick work become **three independent knobs** for post-playtest tuning and future horizontal scaling.

Verification is **coarse-health only**, at both 24 and 60 — **no precision re-calibration** ([[feedback-coarse-health-calibration]]). At the reference interval (24) the change is behavior-identical at default scale, so there is nothing to re-tune; 10k simply starts behaving like the calibrated reference.

## The decision: Option C (fixed-interval sharding). Option F rejected — measured.

We benched the real per-processor cost against the live Postgres DB at 10k (`scripts/bench-tick.ts`, 7886 systems / 205k markets / 11.7k edges, 140 steady ticks):

| | economy / tick | trade-flow / tick | est. total tick | vs 5000ms budget |
|---|---|---|---|---|
| Current (region round-robin) | 165ms | 116ms | ~1053ms | ok |
| **Option F** (process all every tick) | **9854ms** | **5324ms** | **~16,413ms** | ❌ ~3× over |
| **Option C** (fixed interval 24) | 411ms | 220ms | **~1413ms** | ✅ under |

Processing everything every tick is ~16 s/tick — dead. The fixed-interval shard (~2.5× today's per-tick economy work) fits comfortably. Decisive.

The bench also exposed the headline perf bugs (steady-state, 10k):

| processor | runs | avg | p95 / max | note |
|---|---|---|---|---|
| **price-snapshots** | every 20 | **~18s** | ~25s | loads ALL 205k markets (`snapshots.ts:22`); scales with universe; partly bench-inflated by back-to-back runs (no GC gaps), but multi-second and real at 10k |
| **trade-missions** | every 5 | ~2.3s | ~3.7s | heavy global pass |
| (non-snapshot tick) | — | ~1.05s | ~4.4s p95 | already tight before any change |

These are scale-gated — invisible at the 600-system default (where snapshots are ~0.7s), which is why live play hasn't shown a stall. (The cost *is* logged — every processor's ms appears in the `[TickEngine] Tick N …` summary line — but only on the 1-in-20 snapshot tick.)

## Processor audit (the full picture)

| Processor | Declared freq | Cadence mechanism | Scales with | P6 action |
|---|---|---|---|---|
| economy | 1 | round-robin, 1 region/tick | systems (interval = `regionCount`) | → fixed-interval system shard |
| trade-flow | 1 | 256-edge slice/tick | edges (interval = `edges/256`) | → fixed-interval edge shard |
| migration | 1 | 256-edge slice/tick | edges | → fixed-interval edge shard |
| op-missions | 1 | global housekeeping + round-robin region *generation* | systems | → generation on a long-interval shard; housekeeping stays responsive |
| population | 1 | scoped to economy's region | follows economy | follows new shard (no change) |
| price-snapshots | 20 | all systems at once | systems (burst) | → fold onto the economy shard |
| trade-missions | 5 | global price-extreme scan | systems | → generation on a long-interval shard; housekeeping stays responsive |
| events | 1 | advance/tick; spawn every 20 | active events | leave (semantic) |
| battles | 1 | rounds every 6 | active battles | leave (semantic) |
| relations | 3 | all faction-pairs | faction pairs (~fixed) | leave (semantic) |
| ship-arrivals | 1 | — | arriving ships | leave |
| notification-prune | 50 | — | notification volume | leave (semantic) |

**Principle:** *performance-sharded / all-at-once* processors (top group) get unified onto one fixed-interval shard; *semantic-cadence* processors (relations/3, battles-rounds/6, events-spawn/20, notification-prune/50) are intentional gameplay rhythms and are left alone.

## Architecture

### 1. Decouple sharding from regions

Introduce a shard schedule that is **independent of the region/territory concept**. A small pure module owns it:

```
lib/tick/shard.ts  (pure, no DB)
  shardRange(total, tick, interval) → { start, end }   // stable window over a sorted item list
  catchUpFactor(interval) → interval / REFERENCE_INTERVAL
```

Each sharded processor sorts its items by a stable key (system id / edge order) and processes `shardRange(total, tick, interval)` each tick. Regions go back to being *only* territory.

### 2. Pin the interval; the constants don't change

`ECONOMY_UPDATE_INTERVAL` (default **24**) is a fixed *gameplay* constant — every system updates every 24 ticks **at all scales**. Per-tick work = `ceil(totalSystems / interval)` (≈329 systems/tick at 10k — ≈411ms by the extrapolation above).

The per-update amount uses a **catch-up normalization** so the *interval becomes a pure granularity/perf knob and the economic rate stays constant and separately tunable**:

```
applied per update = catchUpFactor(interval) × (one calibrated application)
                   = (interval / REFERENCE_INTERVAL) × rates
```

- At `interval = REFERENCE_INTERVAL = 24`: factor = 1 → **identical to today's default scale. Zero constant change, zero re-tune.**
- At any scale: wall-clock rate = `applied / interval = rates / REFERENCE_INTERVAL` — **constant, scale-invariant**, and independent of the interval. Changing the interval changes only *granularity* (chunkier vs smoother), never the rate.

> **Simplification noted during design:** because we *fix* the interval rather than keep `regionCount`, catch-up collapses to a factor of 1 at the shipping interval — so there is literally no constant arithmetic to do for the default config. The factor only earns its keep when someone tunes the interval away from 24 (then it holds the rate steady). This is the divide-by-24 idea, generalized and made a no-op at the reference.

This closes the three open questions the plan carried into P6:
- **Bursty vs catch-up:** fixed interval + catch-up normalization; F rejected by measurement.
- **Cross-cadence coherence:** trade-flow/migration move onto the *same* shard interval as economy, so production and flow share one clock at every scale.
- **Population-signal cadence:** confirmed intended — population already follows the economy's processed set; it follows the new shard unchanged.

### 3. Three independent knobs (configurability)

| Knob | Meaning | Where | Default |
|---|---|---|---|
| **Tick rate** | wall-clock ms per tick | `gameWorld.tickRate` (dev-tools settable) | 5000 |
| **Update interval** (per-processor) | game-ticks between refreshes of a given item | `ECONOMY_UPDATE_INTERVAL` = 24 (economy/flow/migration/snapshots, shared); `MISSION_GEN_INTERVAL` ≫ 24 (mission generation) | see right |
| **Throughput / shard size** | systems-or-edges processed per tick | *derived* (`total / interval`); ceiling is the perf limit | derived |

Wall-clock cadence = `interval × tickRate`. Slowing ticks slows the economy coherently; lowering the interval speeds the economy without touching tick rate.

**The interval is per-processor, and it does double duty:** a *larger* interval means both a *less-frequent* refresh and a *thinner* per-tick slice (spread evenly, no spike). Economy/flow/migration/snapshots share the tight `interval = 24` (A: one clock for the coupled economy). **Mission generation gets its own long interval** — players need real time to complete missions, so frequent regeneration is wasted churn, and a long interval also trickles its cost out instead of the current 2.3s every-5-tick spike. (Completion/expiry *housekeeping* stays responsive — see per-processor treatment.) Future **horizontal scaling** (N workers each taking 1/N of the slice) raises the throughput ceiling → lets you lower the interval or grow the universe with **zero gameplay change**. The shard key is chosen to make that parallel split a later drop-in — **not built now** (YAGNI).

## Per-processor treatment

- **economy** — replace region round-robin (`economy.ts:52`) with `shardRange` over systems sorted by id; multiply the applied rates by `catchUpFactor`. Live + sim share the body (sim already calls `runEconomyProcessor`).
- **population** — no logic change; it consumes whatever systems economy emitted signals for.
- **trade-flow / migration** — replace the fixed 256-edge slice with `edges/interval` per tick over the stable edge order; apply `catchUpFactor` to flow/migration amounts. Keep the `ceil(sweep) < FLOW_HISTORY_TICKS(200)` invariant (24 ≪ 200 ✓).
- **op-missions** — *generation* moves onto a long-interval system shard (`MISSION_GEN_INTERVAL`); expiry/completion **housekeeping stays responsive** (every tick, or whatever cadence keeps mission crediting prompt — verify where completion is actually credited before changing it; cheap, ~29ms).
- **price-snapshots** — **drop the global scan**; snapshot the shard's systems right after economy ticks them, reusing the markets economy already loaded. Per-system snapshot cadence becomes every `interval` ticks (24) instead of 20 — negligible for a 50-deep rolling history.
- **trade-missions** — *generation* onto the long-interval shard from each slice's just-computed price extremes; expiry/completion housekeeping stays responsive. (Size `MISSION_GEN_INTERVAL` by mission **lifetime**, not the current every-5 fire rate — missions persist until claimed/expired, so generate no faster than players consume them; ≫ economy's 24.) **Watch-item:** trade-missions currently picks extremes from a *global* pass — per-shard generation only sees one slice's extremes, so mission *distribution* changes (per-region availability vs global-best). Confirm that reads acceptably, or aggregate extremes across a full cycle before generating.

## Verification (coarse-health, no re-calibration)

- Re-run `scripts/bench-tick.ts` at 10k after the change: confirm total tick (incl. the now-folded snapshots) sits comfortably under the 5000ms budget across ticks (including the heavy ones).
- Sim coarse-health at interval 24 **and** a 60-interval config: no NaN/runaway/pinning, greedy ≫ random, dispersion exists, markets liquid. Do **not** re-tune to old magnitudes.
- Confirm the `pg` "concurrent query on one client" deprecation (seen during benching — a processor issuing overlapping queries on the tx connection) is logged as a separate follow-up; not in P6 scope unless it falls out of the shard rework.

## Non-goals

- Precision re-calibration (deferred to post-SP5 — [[feedback-coarse-health-calibration]]).
- Building horizontal scaling (design stays compatible; not implemented).
- The honest **cadence display** (per-cycle label + "next update in N ticks" countdown) stays **P7** — still needed (updates remain bursty every `interval` ticks), just now scale-consistent.
- Fixing the `pg` concurrent-query warning — **booked as a quick follow-up immediately after P6** (user-requested): trace the `Promise.all`-over-`tx` site(s) via `--trace-deprecation`, then serialize the awaits (or move the reads off the pinned transaction connection). Out of P6 scope; tracked here so it isn't lost.

## Risks / open questions

1. **Intervals (decided).** Economy/flow/migration/snapshots **share `interval = 24`** (one clock for the coupled economy — A). Mission *generation* runs on a separate **long** interval (B); exact value is a playtest knob.
2. **Trade-mission distribution** under per-shard generation (watch-item above).
3. **Snapshot fold** must preserve the price-history overlay/chart semantics (cadence 20→24 only).
4. **p95 tick headroom** — non-snapshot ticks are already ~4.4s p95 at 10k (driven by `events` spikes + `trade-missions`); Option C adds ~250–350ms. Folding snapshots/missions onto the shard should *reduce* the worst spikes, but re-bench to confirm p95 stays under budget.
