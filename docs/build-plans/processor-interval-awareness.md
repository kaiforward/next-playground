# Processor Interval Awareness — Design

Status: **Designed, awaiting implementation plan.** Supersedes the handover framing this doc
previously carried (problem statement + open questions — resolved 2026-07-17). Transient: deleted
when the work ships; the durable taxonomy moves to
`docs/active/engineering/processor-architecture.md`.

---

## 1. Problem

The monthly pulse interval reads as a tunable constant and is not one. `catchUpFactor(interval)`
(`lib/tick/shard.ts`) exists so a pulsed processor applies "elapsed-ticks worth" per run — tuning
the interval should change granularity, never wall-clock rate. It is wired into `economy.ts` and
`migration.ts` only. The other pulse riders take no scaling, so changing the interval silently
changes gameplay rates — a performance knob moving gameplay rules, the exact hazard CLAUDE.md names.

Goal: make every pulse rider interval-correct, so cadence becomes a real knob — including
**relative** cadence (construction or logistics pacing tuned independently of the societal pulse)
for game-feel adjustments later. All defaults stay 24; this ships behaviour-identical.

## 2. The taxonomy (design frame)

Every pulse-riding quantity is one of four shapes — three that scale, one that must never — and
each has exactly one correct treatment:

> **Scale flows and incomes by `catchUpFactor`. Count time in ticks, not runs. Never scale
> targets, stocks, or costs.**

| shape | examples | treatment |
|---|---|---|
| **Rate / flow** — "X per unit time" | production, consumption, migration, pop growth, unrest gain/decay, unrest teardown | multiply by `catchUpFactor(interval)` per run |
| **Counter / timer** — "after N months…" | `idleMonths` | accumulate `catchUpFactor` per run (fractional), thresholds keep reference units |
| **Budget income** — "points per pulse" | construction pool, absorption cap, pool floor, logistics haul budget | multiply income by `catchUpFactor` per run |
| **Target / stock / cost** — "fill to here", "costs this much" | `targetStock` anchor, logistics delivery quantities, `workCostPerLevel`, build ceilings | never scaled — levels are time-free |

The one previously-misdiagnosed system: **directed-logistics is a hybrid**. Its deliveries are
gap-fills toward the days-of-supply anchor and are correctly unscaled (the processor's own doc
comment already reasons this out — fill more often, each fill is smaller; total moved per wall-clock
≈ total consumed at any interval). But its haul **budget** (`Σ pop × GENERATION_PER_POP` per cycle,
exhaustion = deliberate under-serve) is per-pulse income, and in the budget-constrained regime the
mechanic is designed around, an unscaled budget paid more often inflates annual haul capacity
linearly. Scale the budget; leave deliveries alone.

Verified safe, no change needed:

- **The pricing anchor.** `WorldMarket.demandRate` is stored per-reference-pulse and consumed only
  as the pricing denominator (`market-pricing.ts`: `targetStock = TARGET_COVER × demandRate`); the
  economy scales its actual flows at the point of use and passes `demandRate` through unscaled —
  correct, not an omission.
- **Economy and migration** — already scaled.
- Relations (`RELATIONS_FREQUENCY = 3`) and events (`EVENT_SPAWN_INTERVAL = 5`) run on their own
  clocks, independent of the month — out of scope. (Relations has the same latent disease — per-run
  drift magnitudes — if its frequency is ever tuned; noted, not fixed here.)

## 3. Cadence structure: one cluster, two free knobs

**Population, infrastructure-decay, and migration are structurally welded to the economy's pulse**:
population and decay consume the economy's same-tick dissatisfaction signal
(`ctx.results.get("economy")`) and process exactly the system set the economy just resolved;
migration is likewise driven off the economy's output. They form one societal accounting pass and
share one interval. Decoupling them is explicitly out of scope (it would need own data reads and
staleness rules, for independence these systems shouldn't have).

**Directed-build and directed-logistics are free**: self-gated via `pulseShard` on their own
`interval` params, coupled to the economy through state (stocks, prices), not same-tick signals.
They get independent knobs.

`lib/constants/tick-cadence.ts` becomes the single home of pulse cadence — three knobs, one anchor:

```ts
/** Calibration anchor — NOT a knob. The divisor in catchUpFactor; frozen at the tuned cadence. */
export const REFERENCE_INTERVAL = 24;
/** Societal pulse: economy, population, infrastructure-decay, migration. */
export const MONTH_LENGTH = 24;
/** Directed-build's pulse. Independent of MONTH_LENGTH. */
export const CONSTRUCTION_INTERVAL = 24;
/** Directed-logistics' pulse. Independent of MONTH_LENGTH. */
export const LOGISTICS_INTERVAL = 24;
```

The alias chain dies: `ECONOMY_UPDATE_INTERVAL` is deleted (uses become `MONTH_LENGTH`);
`DIRECTED_BUILD.INTERVAL` and `DIRECTED_LOGISTICS.INTERVAL` are deleted in favour of the new
constants. Aliases of one value are what let #180's wrong-constant binding bug happen — three
genuinely distinct constants make every binding site honest.

### Cadence override (testability)

`runWorldTick(world)` currently binds the constants directly, which would make the knob
compile-time-only and the invariance gate impossible. It gains an optional override:

```ts
runWorldTick(world, opts?: { cadence?: { month: number; construction: number; logistics: number } })
```

Defaults come from the constants; the live loop passes nothing. The harness runner threads an
optional `cadence` block from YAML config through to it. This is a dev/test surface, not a gameplay
setting — saves store no interval, and pulse boundaries are pure clock math (`tick % interval`), so
a cadence change between runs shifts boundaries harmlessly.

## 4. Per-processor changes

Scaling lives **inside processor bodies**, following the `economy.ts`/`migration.ts` precedent:
constants stay reference-denominated, the body computes `catchUpFactor(interval)` once and applies
it at the point of use. Engine functions stay pure and cadence-unaware — they receive
already-scaled inputs — with one exception (decay, below) where the scaled quantity is internal to
the engine's loop.

- **`population.ts`** — gains `interval` in its params (wired to `MONTH_LENGTH`). The population
  delta is multiplied by the factor; unrest's `gain` and `decay` are both pre-scaled before the
  engine call (rescaling a linear filter's time step). First-order rate equivalence is the bar —
  compounding differences across intervals land inside the statistical gate's tolerance.
- **`infrastructure-decay.ts`** — `computeSystemDecay` gains a catch-up factor argument
  (default `1`, so existing callers/tests are untouched):
  - The idle countdown accumulates `+catchUp` per run instead of `+1`. Fractional counting;
    `idleBufferMonths: 6` keeps its name, value, and meaning (reference-pulses). Fractions are
    JSON-safe; no save migration.
  - **Unrest teardown becomes debt-based** (see §5) — `+catchUp` collapse debt per run above
    threshold, tear down `floor(debt)` levels, carry the remainder.
- **`directed-build.ts`** — computes `catchUpFactor(params.interval)` (interval wired to
  `CONSTRUCTION_INTERVAL`) and scales the three per-pulse point quantities **together**:
  `THROUGHPUT_PER_POP` (pool income), `PER_BUILD_ABSORPTION_CAP`, `POOL_FLOOR_BASE`. Scaling all
  three preserves the invariants: wall-clock minimum build time (`work ÷ cap` pulses × interval
  ticks = constant), parallel-front count (`pool ÷ cap` unchanged), and the floor's relative
  strength against the pool. Work costs, ceilings, proposals, colony establish-work: untouched.
- **`directed-logistics.ts`** — scales **only** the haul budget: `generation × catchUp` when
  building `SystemLogisticsState` (interval wired to `LOGISTICS_INTERVAL`). Deliveries stay
  unscaled; the processor's existing no-catch-up comment is extended to state both halves of the
  rule (budget scales, gap-fills don't).
- **`tick.ts`** — each stage's pulse gate binds its own constant (societal gates + off-pulse
  payload → `MONTH_LENGTH`; build stage → `CONSTRUCTION_INTERVAL`; logistics stage →
  `LOGISTICS_INTERVAL`), taking the cadence override when present.
- **Sweep**: UI/services consumers of the interval (e.g. the "next economy update" countdown via
  `ticksUntilShard`) rebind to `MONTH_LENGTH`. Enumerated at plan time.

## 5. New state: collapse debt

Unrest teardown is a rate the handover analysis missed: above `unrestThreshold`, decay removes one
whole level **per run** (`lib/engine/infrastructure-decay.ts`, the `removed += 1` unrest branch) —
at interval 12 catastrophic collapse eats buildings twice as fast in wall-clock. Whole levels can't
be fractionally removed, so scaling needs memory:

- New per-(system, buildingType) fractional accumulator alongside `buildingIdleMonths` (working
  name `buildingCollapseDebt`), default empty.
- Per run above threshold: `debt += catchUp`; remove `floor(debt)` levels; keep the remainder.
  Below threshold the debt resets (collapse is a regime, not a ledger — leaving sub-level debt
  armed after unrest recovers would turn a survived crisis into a delayed demolition).
- At reference interval: `+1 → remove 1 → remainder 0`, bit-identical to today.
- World-state shape change: world row + type + guard + gen default `{}`; old saves deserialize with
  the default. The only state-shape change in this work.

## 6. Validation gate

Interval-invariance is directly testable and is this work's definition of done: **same seed, same
wall-clock span, different interval → same rates**. Two runs draw different RNG streams (pulses
land on different ticks), so the comparison is statistical — rate metrics within tolerance, not
parity. With a fixed seed the outcome is still deterministic (no CI flake — it always passes or
always fails on given code). Exact parity is additionally *impossible* for construction:
`fundQueueWithFloor` is non-homogeneous in its `remaining` term (the killed slice's
exact-arithmetic finding), so distributions differ across intervals even as rates match.

Three layers:

1. **CI vitest sim test** — small world, fixed seed, baseline all-24 vs turned-knob runs over the
   same tick span; asserts rate metrics match within loose-but-real tolerances: population growth,
   buildings landed per wall-clock, decay teardowns, unrest trajectory. Prefer turning each knob in
   isolation (societal 12 / construction 12 / logistics 12 vs baseline); collapse to a single
   all-knobs-turned comparison only if CI runtime forces it. World size, span, and tolerances tuned
   empirically at plan time; sized well under the CI timeout (heavy-sim flake history).
2. **Full-scale harness gate (manual, pre-ship)** — `npm run simulate --config` at 24 vs 12 via the
   cadence override, checking the same rates plus what a small world can't reach: the
   budget-constrained logistics regime (goods hauled per wall-clock, under-serve behaviour) and
   whole-galaxy health (no NaN/runaway/pinning).
3. **Unit tests** where a property is provable in isolation — idle/collapse counters hit teardown
   at the same wall-clock tick at any interval; scaled pool+cap preserve minimum build time and
   front count. Supporting evidence only; the sim layers carry the gate (CLAUDE.md: prove outcomes
   via the real tick, not engine fixtures).

## 7. Non-goals / scope edges

- **No default changes.** Everything ships at 24; knobs get turned later, by feel.
- **No tick re-basing.** Finer base ticks multiply the cost of the ~87% of an off-pulse tick that
  runs every tick (post-#180: events + `toTickSystems`), to buy resolution nothing needs yet.
  Interval-awareness is what makes re-basing cheap whenever something concrete (armies) demands it.
- **No processor reordering.** The economy-reads-before-build boundary artifact stays as booked.
- **No relations/events cadence work** — separate clocks, one doc line acknowledging relations'
  latent version of the same issue.
- **No re-tuning.** `REFERENCE_INTERVAL` stays 24 and is not a knob; calibrated magnitudes are
  untouched by construction (at reference, every `catchUpFactor` is 1).

## 8. Docs on ship

- Taxonomy (§2's rule + table) → `docs/active/engineering/processor-architecture.md` as the durable
  rule for future processors.
- `docs/SPEC.md` tick section: the three cadence knobs + the invariance property.
- This doc: deleted (booked items verified landed first, per the doc-deletion convention).

---

## Appendix A — Why the construction-cadence slice was killed (2026-07-17)

Recorded so nobody re-proposes it from the same premises. It planned to split construction's
decision cadence (monthly) from its execution cadence (per-tick). Design and an 8-task plan were
written; never built. Two verified technical failures, and a deciding motivational one:

1. **The neutrality claim was false.** The economy runs *before* directed-build in the same tick,
   so a building landing on a boundary is invisible to that boundary's economy and waits a full
   month. Per-tick landing removes that lag — a real economic acceleration, not a neutral change.
2. **Slicing equivalence fails in EXACT arithmetic** (not FP). `fundQueueWithFloor` is homogeneous
   in `(pool, cap, reserved)` except the `remaining = workTotal − workDone` term. Verified with the
   real function: equivalence holds while the queue is stable and breaks permanently the moment a
   project lands mid-cycle — the feature's entire point.

   ```
   contended, no landing        lump  A=4.00 B=1.00 C=0.00
                                sliced A=4.00 B=1.00 C=0.00   ← identical
   contended, A lands mid-cycle lump  B=4.00 C=0.00
                                sliced B=3.25 C=0.75          ← divergent, never re-converges
   ```

3. **The motivations did not survive a Vic3 check.** The queue-timing "exploit" (queue at tick 23
   vs 25) is a standard Paradox cadence artifact — Vic3's window is ~28 base ticks, *larger* than
   our 24, and under a monthly-accounting fiction it is a budget cycle, not an exploit. Vic3's
   construction bars also move once per weekly tick; freeze-and-jump is what it ships. And per-tick
   funding would have made construction the only system finer than the economy.

If per-tick construction is ever revisited it needs a new justification ("we are not Vic3, smooth
bars are worth an economic change") — the neutrality argument does not hold. Note §3 of this design
deliberately still allows `CONSTRUCTION_INTERVAL < MONTH_LENGTH` as a *knob setting* — that is
moderate relative pacing with correct scaling, a different thing from 24× finer execution with
unscaled funding.

## Appendix B — Side-findings (booked elsewhere, pointers only)

- Economy-before-build ordering artifact (boundary-landing recognition lag) — BACKLOG.
- `popCap`'s only rise path has no test — BACKLOG.
- `demandRate` naming collision — BACKLOG.
- Stale "48-tick agency clock" doc claims — BACKLOG.
