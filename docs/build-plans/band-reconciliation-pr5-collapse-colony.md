# Band Reconciliation PR5 — Collapse Containment, Colony Survival, Planner Unblocking — Implementation Plan

> **Slice:** PR5 of `band-reconciliation-umbrella.md`, implementing the amended §2 suppression
> scoping, §3 regime/unrest changes, §4 founding stock, and §5 collapse rescope of
> `docs/planned/economy-band-reconciliation.md`. PR1–PR4 are merged into `feat/band-reconciliation`
> at `a0da9b5` / `f6a7f6c` / `d797c1b` / `1789c9a`. The feature-level `/spec-review` ran on
> 2026-07-20; the amendments this PR implements were design-approved in session on 2026-07-27 and
> folded into the spec before this plan was written — do not rerun the spec gate.
>
> **PR5 was resequenced.** It was "regime presentation + recalibration + docs fold"; that work is
> now PR6. PR5 is simulation-only. Rationale: the panels name regimes, and this PR changes what the
> regimes do, so building presentation against pre-PR5 behaviour would mean naming states about to
> be redefined.

## Why this slice exists

The 3000-tick equilibrium run at `1789c9a` (seed 42) does not converge — it compounds:

| Reading | Value | Design intent |
| --- | --- | --- |
| Median price / base | 1.94× (77% of markets "expensive") | ≈ 1.0, two-sided dispersion |
| Tier-1/2 cover | electronics 0.00×, consumer_goods 0.00×, polymers 0.00× | at/near anchor |
| Markets pinned at stock ≈ 0 | electronics 77%, consumer_goods 70%, medicine 52% | rare, crisis-only |
| Mean unrest | 0.721 (strike threshold is 0.65) | at the tax floor |
| Striking systems | 371 of 570 developed | a minority, transient |
| Systems collapsed to ≈ 0 buildings | 262 | genuine failures only |
| Colonies holding population at `popCap ≈ 0` | 246 | none — the state is a trap |

One reinforcing loop produces all of it, and each of its four amplifiers is a shipped decision
that is individually defensible and collectively fatal:

1. `supplyRegime` (`lib/engine/population.ts:70`) is a **worst-good** fold — any single demanded
   good below `SHORTAGE_SATISFACTION` selects `gainShortage`. `POPULATION_PARAMS`' own docstring
   states the barren galaxy carries an unavoidable chronic higher-tier deficit (D ≈ 0.4) at most
   systems, so the fast rate is the **ambient** grade rather than the exceptional one.
2. `accumulateUnrest` has no regime ceiling: equilibrium is `floor + (gain ÷ decay) × D`, i.e.
   `floor + 2D` under Shortage. At the normal tax floor (0.05), **D ≈ 0.35 settles a system above
   the 0.75 collapse threshold** — below the chronic deficit the galaxy design takes for granted.
3. The unrest-collapse channel (`lib/engine/infrastructure-decay.ts:119-123`) sheds one whole level
   **per building type per run** with no severity ramp, so a ten-type world loses ten levels a month
   the instant it crosses θ, and 0.76 unrest is indistinguishable from 1.00.
4. Housing is torn down with everything else. `popCap = 0` with residents present is
   near-absorbing: `crowdFactor` reads fully crowded so growth is exactly zero, overshoot-death
   fires, and the relief valve cannot rebuild until the system is fed — which requires the capacity
   just demolished.

Two further locks keep the galaxy from digging out: the backstop's suppression exclusion is set
**per system, not per good** (`lib/tick/processors/economy.ts:116-122` →
`lib/engine/directed-build.ts:295-299`), so all 371 striking systems are refused every build
proposal including goods they have zero capacity in; and `colony_establish` seeds **no market
stock**, so every colony is born at satisfaction 0 on every good and starts climbing immediately.

## Goal

- Make the unrest **rate** regime demand-weighted, so ambient tier-2 scarcity stops selecting the
  fast rate while a real food/water failure still does.
- Give each regime a **ceiling** on where unrest settles, so ordinary scarcity cannot reach a
  regime reserved for catastrophe. Rationing's ceiling sits below the strike threshold by
  construction.
- Rescope the unrest-collapse channel to **one level per run per system**, ramped by distance above
  θ, with **housing floored at resident occupancy**.
- Size colony-establish housing to the seed (`ceil(seedPop ÷ POP_CENTRE_DENSITY)`), dropping PR4's
  bundled `+1` level — containment by construction at both housing-sizing sites.
- Give `colony_establish` a **founding stock endowment** drawn and conserved from the founding
  system's markets, sized on the colony's own demand basket.
- Scope the **suppression exclusion** to the shortfall suppression explains, per (system, good),
  and count exporter spare on realized rather than latent output.
- Harness: striking share and stranded population (`popCap ≈ 0` holding population) become headline
  metrics; run the §8 unrest/tax and treasury recalibration this PR moves.

PR5 does **not** touch regime UI/chips, `needSeverity` bands, `computeCoverLevels`,
`RATION_EXIT_EPS` hysteresis, the regime-share metric, seed-size policy, migration weights, or the
docs lifecycle. Those are PR6 (or explicitly deferred — see Deferred below). Sim acceptance is
**directional and discussed, not gated in-plan**: striking share, stranded population, mean unrest,
median price/base, and floor-pinned share should all move toward the §8 targets.

### Deferred, on the record

- **Seed size scaled against the housing unit.** A 2-pop seed against a 20-pop housing level means
  no colony can open looking anything but empty. Sizing the seed instead (e.g. what the founder can
  spare up to a whole level) is the deeper fix; it changes colonisation pacing and needs a founding
  policy, so it is out of scope. Recorded in spec §5.
- **Luxuries weighted higher for engineers.** The engineer basket already carries luxuries at 50×
  the ordinary per-capita rate; whether that weight is *high enough* is a demand-tuning question,
  revisited once the galaxy is not starving.
- **`idleBufferMonths` as a lever** if the tighter colony opening absorption proves too slow.

## Branch and review contract

- Branch `feat/band-reconciliation-pr5-collapse-colony` from clean `feat/band-reconciliation` at
  `1789c9a`.
- Base the PR on the shared branch, open it before `/uber-review`, and review the checked-out PR
  head.
- Use the task/commit boundaries below. PR6 owns active-doc promotion and build-plan deletion.

## Execution protocol

- The coordinating agent reads the full plan once and carries the Locked Interface Decisions and
  Global Constraints through every task.
- Execute Tasks 1–6 sequentially. Do not parallelize implementation tasks: later tasks consume
  interfaces introduced by earlier tasks. (Task 1 is parked on a design decision — see its header;
  nothing downstream consumes it, so execution runs 2–6 and returns to it.)
- Use one fresh implementation agent per task, sized to the task's integration and reasoning needs.
  Give it that task, the relevant locked decisions and global constraints, and only the interfaces
  produced by completed tasks that it needs.
- After each task commit, use an independent review agent to assess both acceptance/spec compliance
  and code quality/repository conventions. Fix Important/Critical findings and re-review before
  starting the next task.
- The coordinating agent owns the pre-flight conflict scan, progress tracking, Tasks 7–8,
  cross-task integration, simulator interpretation, PR creation, and the final `/uber-review`.
- Continue between tasks without requesting confirmation. Stop only for a genuine plan
  contradiction, an unresolved blocker, or an action requiring new user authority.
- Keep task briefs and reviews scoped to their task. The final `/uber-review` remains the broad
  whole-PR review and does not replace the per-task gates.

## Locked interface decisions

### 1. Demand-weighted rate regime (`lib/engine/population.ts`, `lib/constants/economy.ts`)

`supplyRegime(goods: GoodSatisfaction[])` keeps its signature, return type, and its role as the
*rate* selector. Its fold changes from worst-good to demand-share:

- `shortShare` = Σ `demanded_g` over goods with `satisfaction_g < SHORTAGE_SATISFACTION`, ÷ Σ
  `demanded_g` over all demanded goods.
- `"shortage"` when `shortShare >= SHORTAGE_DEMAND_SHARE`; else `"rationing"` when any demanded
  good has `satisfaction < 1`; else `"supplied"`.
- Zero-demand goods ignored; no demanded goods ⇒ `"supplied"`; total demand ≤ 0 ⇒ `"supplied"`.

New shared constant `SHORTAGE_DEMAND_SHARE` on `ECONOMY_CONSTANTS` beside `SHORTAGE_SATISFACTION`,
**initial 0.25**. Sanity of that cut against the shipped unskilled basket (water 0.007, food 0.006,
consumer_goods 0.0015, medicine 0.001, electronics 0.001, luxuries 0.0005 → water 41%, food 35%,
consumer_goods 8.8%, medicine 5.9%, electronics 5.9%, luxuries 2.9%):

| Case | Short share | Regime |
| --- | --- | --- |
| Water empty | 41% | shortage |
| Food empty | 35% | shortage |
| All three tier-2 civilian goods empty (the barren-galaxy chronic case) | 21% | rationing |
| Luxuries empty | 2.9% | rationing |

The demand weights already vary per system (skilled baskets are folded into `demanded`), so an
engineer-heavy system genuinely can reach the threshold on luxuries while a mining colony cannot —
this is required behaviour, not a side effect. **No per-good "vital" list**: rejected in spec §3 as
a magic list that cannot express the same good mattering differently to different populations.

Rewrite the `supplyRegime` docstring and the `ECONOMY_CONSTANTS` comment at
`lib/constants/economy.ts:30` — both currently describe the worst-good fold.

### 2. Regime unrest ceilings (`lib/engine/population.ts`, `lib/constants/population.ts`)

`accumulateUnrest`'s **shape is unchanged** (the spec's prohibition on multiplying the whole
integrator still holds). What changes is where the gains come from. `UnrestParams` replaces
`gainRationing` / `gainShortage` with `ceilingRationing` / `ceilingShortage`, and the function
derives `gain = ceiling × k` internally, where `k` is the already-selected relaxation rate.

- Equilibrium becomes `floor + ceiling × D` by construction, for any `decay`.
- `floor` remains the exact equilibrium at D = 0 — tax semantics untouched.
- Monotonicity and one-bad-pulse recoverability are preserved (same integrator).
- Ordering invariant: `ceilingShortage > ceilingRationing`, asserted in a test.

Initial cuts: `ceilingRationing = 0.45`, `ceilingShortage = 0.90`; `decay` and `recoveryDecay`
unchanged at 0.06 / 0.12.

**Containment is two assertions, not one — decided 2026-07-27.** Very-high tax is *allowed* to push
a chronically rationed, overcrowded world into striking: overcrowded + deprived + heavily taxed
earning a strike is intended policy cost, even when the deprivation is in lower-tier goods. What
remains forbidden at every tax stance is infrastructure collapse from ordinary scarcity.

| Assertion | Sum at the initial cuts | Bound |
| --- | --- | --- |
| `ceilingRationing + TAX_LEVEL_UNREST_PRESSURE.normal + CROWDING.PRESSURE_MAX` < `STRIKE_PARAMS.threshold` | 0.45 + 0.05 + 0.05 = 0.55 | 0.65 |
| `ceilingRationing + max(TAX_LEVEL_UNREST_PRESSURE) + CROWDING.PRESSURE_MAX` < `INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold` | 0.45 + 0.18 + 0.05 = 0.68 | 0.75 |

Both are computed from the shared constants, never from hardcoded sums, so a later ceiling or tax
change trips them. The intended gradient falls out: `high` tax (0.1) reaches 0.60 and does not
strike; only `very_high` (0.18) crosses. Record that gradient in the constant's docstring —
including that only genuine famine (the Shortage ceiling) can reach the collapse regime.

The catch-up pre-scaling stays in the processor (`lib/tick/processors/population.ts:37-38`) and now
scales the derived gains, not the ceilings; `k` stays clamped to [0,1] after scaling.

### 3. Proportionate unrest-collapse channel (`lib/engine/infrastructure-decay.ts`)

The **idle channel is untouched** — same whole-level trigger, same `idleBufferMonths`, same
per-type countdown. Only the catastrophic channel changes.

- **Storage shape changes**: per-type `buildingCollapseDebt: Record<string, number>` retires in
  favour of a single per-system `collapseDebt: number`. Missing ⇒ 0 on old saves, which is harmless
  — the debt is transient and resets whenever unrest drops to or below θ. Touches
  `lib/tick/world/infrastructure-world.ts`, `lib/tick/adapters/memory/infrastructure.ts`,
  `lib/tick/processors/infrastructure-decay.ts`, `lib/world/types.ts`, and the decay engine's
  input/result interfaces.
- **Severity ramp**: `severity = clamp((unrest − θ) ÷ (1 − θ), 0, 1)`; debt accrues
  `catchUp × severity` per run. Total for every input: θ ≥ 1 must not divide by zero (guard →
  severity 1 above θ). At unrest 1.0 this reproduces today's one-level-per-run pace; at 0.80 it is
  one level per five runs.
- **One level per run for the system**: whole levels shed = `floor(debt)`, taken from eligible
  building types **least-used first** (lowest `buildingUsed ÷ count`), ties broken by ascending
  building-type id so the result is deterministic. Debt carries its fractional remainder forward.
  A system with fewer eligible types than levels owed sheds what it can; the remainder is not
  banked beyond the fractional carry.
- **Housing floor**: housing is eligible only while `count − 1 >= ceil(housingUsed(population))`,
  i.e. shedding a level must not drop `popCap` below the resident population. A system holding
  population can therefore never reach `popCap = 0` through this channel. Housing with zero
  residents is fully eligible (a genuinely abandoned colony still cleans up), and the **idle**
  channel continues to prune empty housing independently.

### 4. Colony housing sized to seed (`lib/engine/directed-build.ts`)

`sizeColonyEstablish` drops the `+ 1`:
`housingLevels = min(maxHousingLevels, ceil(seedPop ÷ POP_CENTRE_DENSITY))`. Viability guard
(`housingLevels < 1 || seedPop <= 0 ⇒ null`) and the habitable clamp are unchanged, and the player's
direct-colony verb keeps sharing the helper.

The PR2/PR4 containment assertion in `lib/constants/__tests__/band-constants.test.ts` widens to
cover **both** housing-sizing sites: relief (`RELIEF_TARGET × (1 + VACANCY_SLACK) >= 1`) and colony
establish (for a representative sweep of seed sizes, `idleLevels(housingLevels, housingUsed(seedPop)
× (1 + VACANCY_SLACK)) === 0`). Rewrite `sizeColonyEstablish`'s docstring — it currently promises a
headroom level.

### 5. Suppression exclusion scoped to the shortfall (`lib/tick/processors/economy.ts`, `lib/engine/directed-build.ts`)

- `productionSuppressedBySystem` (a `Map<string, boolean>` set from `productionSuppress < 1` at
  `economy.ts:122`) becomes a per-(system, good) signal. The system-wide read is the failure: a
  single striking industry zeroes every good's need at that system.
- In `assessStructural` (`directed-build.ts:289-314`) the exclusion applies only where the system
  **has capacity in that good**:
  - `capacityGap = max(0, (1 + PROVISION_MARGIN) × demand − capacity)` — computed **unconditionally**.
    Full-staffed capacity below demand is a structural shortfall no strike explains, and `capacity
    = 0` is its ordinary case.
  - `feedbackGap` excludes only when the good is suppressed **and** the system has non-zero capacity
    in it; the funding-bound exclusion is unchanged.
  - `spare = max(0, production − demand)` **always** — the `suppressed ? capacity − demand` branch
    is deleted. Planning against output that is not being produced overstates galaxy spare.
- `surplusDrawable`'s `productionSuppressed` parameter (`directed-logistics.ts:47-62`) keeps its
  current meaning — it guards a *drawdown* decision, not a build decision, and correctly refuses to
  treat a suppressed system as a free-flowing exporter. Do not conflate the two call sites.

### 6. Colony founding stock endowment (`lib/engine/directed-build.ts`, `lib/tick/world/directed-build-world.ts`, `lib/world/tick.ts`)

- **Policy**: a landed colony opens with a share of a full days-of-supply cover on what its seed
  population actually uses — `FOUNDING_STOCK_ANCHOR_FRAC` in `lib/constants/colonisation.ts`, initial
  value equal to world-gen's `INITIAL_RESERVE_ANCHOR_FRAC` (0.75), named separately so calibration can
  diverge them.
- **Want**, per good the seed population consumes: `frac × TARGET_COVER × consumptionRate(colony basket)`
  via the shared `consumptionRate` chokepoint (which already folds the government boost — PR3). The
  RAW rate, not the good's pricing anchor: that anchor floors at `MIN_DEMAND`, which at a 2-pop seed
  flattens nearly every good to one figure and would erase the basket's shape. Goods the seed does not
  demand get nothing; no vital-goods list.
- **Source and conservation**: drawn from the founding system's markets, capped by
  `surplusDrawable(...)` at the source so provisioning a colony can never ration its founder, and
  capped again by a running per-source balance across the pulse so two establishments sharing a
  source draw from the same shrinking balance — exactly the `available` pattern
  `applyDevelopments` already uses for seed population (`lib/world/tick.ts:465-477`). A source that
  holds none of a good sends none.
- **Carrier**: `SystemDevelopment` gains `stockManifest: Array<{ goodId: string; quantity: number }>`
  (empty array when nothing is drawable). Computed in the directed-build processor where
  `SystemBuildRow.goods` carries the source's stock/demand/production; **not** in the pure planner
  helper, which has no market write path.
- **Application**: a new pure `applyFoundingStock(markets, developments)` in `lib/world/tick.ts`,
  applied in the same monthly block as `applyDevelopments`, alongside the existing
  `applyBuildMarketUpdates(markets, dbWorld.proposalPulseUpdates)` call at `tick.ts:998`. Source
  stock decreases and target stock increases by the same quantity in one pass — conservation is
  asserted in a test, including the shared-source case.
- **Honest scoping note**: at the shipped 2-pop seed the endowment is a fraction of a percent of a
  homeworld's own anchor, so the "founder feels the cost" brake on over-expansion is **negligible in
  practice today**. The conservation is architecturally correct and the brake becomes real only if
  seed sizing later scales up (Deferred, above). Do not claim expansion-pacing benefit from this
  change in the PR description or the sim read.

### 7. Harness metrics (`lib/tick-harness/population-analysis.ts`, `scripts/simulate.ts`)

- **Striking share** — already counted (`Striking (≥threshold)`); promote it to a share of developed
  systems alongside the count, since the count alone reads differently as the galaxy grows.
- **Stranded population** — new: count of systems with `population > 0` and `popCap ≈ 0`, plus the
  total population held in them. This is the metric that names the trap the collapse rescope closes;
  it should go to ~0.
- Both belong in the existing Population & Unrest block. No new report section.
- The regime-share metric stays PR6.

## Global constraints

- Pure engine, deterministic tick, finite JSON world state. Every new/changed function is total: no
  `Infinity`/`NaN` for any input (`popCap ≤ 0`, zero demand, θ ≥ 1, negative stock, `catchUp > 1`).
- No forbidden `as`, no postfix `!` outside the test idiom, no `unknown`.
- `catchUpFactor` scaling stays in the processors, not the engine.
- Developed systems only; controlled/unclaimed markets remain inert.
- PR1 `satisfaction`, PR2 selling-factor/funding-bound marker, PR3 squeeze/proposal counters keep
  their semantics untouched. `VACANCY_SLACK` and `USED_SLACK` are consumed, not changed.
- The PR1/PR2/PR5 decay-signal invariant holds: the selling factor still contains no
  labour/input/strike/maintenance/event term. Task 5 changes what the *planner* does with
  suppression, never what the decay signal reads.
- Constants remain `ECONOMY_SCALE`-invariant — every new term is a ratio (demand shares,
  satisfactions, pop/popCap, unrest) or an anchor-relative fraction.
- No UI changes. Regime chips, occupancy overshoot, stability surface, `needSeverity` re-base and
  the docs fold are PR6.
- Comments describe the code, not the plan: no "PR5"/phase references in shipped comments, and fix
  any stale ones the tasks touch.

---

### Task 1: Unrest engine — demand-weighted rate regime and regime ceilings

> **PARKED — blocked on a design decision.** The summed-demand-share fold below cannot deliver its
> own goal at any threshold: measured against the shipped 26-good basket, grading a total water
> failure as Shortage needs a cut `≤ 0.166` while keeping the barren-chronic deficit at Rationing
> needs `> 0.387`. The sanity table below is wrong — it was computed over a six-good subset, but
> every settled system carries a row for every good and the fold sees all of them. Locked
> Decision 1 and the `SHORTAGE_DEMAND_SHARE = 0.25` cut are void. The intended replacement is the
> necessity primitive in `docs/planned/necessity-weighted-unrest.md`, which carries the measured
> basket, every rejected fold with its disqualifying evidence, and the stopgap fallback; spec §3
> points at it. Elasticity is its own slice, not part of this PR. The ceilings
> half is parked with the fold rather than shipped alone — the containment guarantee is a claim
> about the pair, and ceilings under the shipped worst-good fold would assert protection that does
> not hold. Tasks 2–6 do not depend on this task and proceed; resume here once the fold is decided,
> and re-run Task 8 with both halves in place.

**Modify:** `lib/engine/population.ts`, `lib/constants/population.ts`, `lib/constants/economy.ts`,
`lib/tick/processors/population.ts`.

**Test:** `lib/engine/__tests__/population.test.ts`,
`lib/constants/__tests__/band-constants.test.ts`, `lib/tick/processors/__tests__/population.test.ts`.

- [ ] Create the branch and verify PR4 ancestry:

```bash
git status --short
git switch -c feat/band-reconciliation-pr5-collapse-colony
git merge-base --is-ancestor 1789c9a HEAD
git add docs/build-plans/band-reconciliation-pr5-collapse-colony.md \
        docs/build-plans/band-reconciliation-umbrella.md \
        docs/planned/economy-band-reconciliation.md
git commit -m "docs(plan): PR5 collapse/colony plan + spec amendments"
```

The spec (§2/§3/§4/§5/§7/§8) and umbrella (PR5→PR6 resequence) amendments are already written to
disk and ride this first commit — they are the design this plan implements, not a follow-up.

- [ ] Add `SHORTAGE_DEMAND_SHARE` (0.25) to `ECONOMY_CONSTANTS` beside `SHORTAGE_SATISFACTION`;
  rewrite the surrounding comment, which describes the worst-good fold.
- [ ] Rewrite `supplyRegime` per Locked Decision 1, including the docstring. Keep the signature.
- [ ] Replace `UnrestParams.gainRationing`/`gainShortage` with `ceilingRationing`/`ceilingShortage`;
  derive `gain = ceiling × k` inside `accumulateUnrest`. Rewrite the docstring's equilibrium
  statement.
- [ ] Update `UNREST_PARAMS` and its docstring (it currently states "Shortage accumulates twice as
  fast as Rationing" as a gain ratio).
- [ ] Update the processor's catch-up pre-scaling to scale derived gains, not ceilings.
- [ ] Record the tax gradient in the ceiling constants' docstring: normal/high tax cannot strike a
  chronically rationed crowded world, `very_high` deliberately can, and no tax stance can collapse
  its infrastructure (Locked Decision 2).
- [ ] Tests: demand-share fold boundary cases (empty water ⇒ shortage; all tier-2 civilian empty ⇒
  rationing; luxuries-only ⇒ rationing; engineer-heavy luxuries ⇒ shortage; zero demand ⇒ supplied);
  equilibrium equals `floor + ceiling × D` for both regimes at several `decay` values; `floor` is the
  exact equilibrium at D = 0 for every tax level; ordering `ceilingShortage > ceilingRationing`;
  **both** containment assertions from the constants (strike-safe at normal tax, collapse-safe at
  every tax); monotonicity in D; one bad pulse recoverable.

**Commit:** `feat(population): demand-weighted unrest regime and per-regime unrest ceilings`

### Task 2: Proportionate unrest-collapse channel

**Modify:** `lib/engine/infrastructure-decay.ts`, `lib/constants/infrastructure.ts`,
`lib/tick/world/infrastructure-world.ts`, `lib/tick/adapters/memory/infrastructure.ts`,
`lib/tick/processors/infrastructure-decay.ts`, `lib/world/types.ts`.

**Test:** `lib/engine/__tests__/infrastructure-decay.test.ts`,
`lib/tick/processors/__tests__/infrastructure-decay.test.ts`.

- [ ] Migrate `buildingCollapseDebt: Record<string, number>` → per-system `collapseDebt: number`
  through the world type, adapter, processor and engine interfaces. Missing ⇒ 0.
- [ ] Implement the severity ramp, the one-level-per-run-per-system budget with least-used-first
  deterministic selection, and the housing occupancy floor (Locked Decision 3).
- [ ] Leave the idle channel byte-for-byte unchanged; assert in a test that it still prunes a
  genuinely idle production level on the same schedule.
- [ ] Tests: teardown rate is independent of building-type count (a 1-type and a 10-type system at
  identical unrest shed identically); severity ramp (just above θ is slow, unrest 1.0 reproduces one
  level per run); debt resets at or below θ; fractional carry accumulates correctly across runs;
  **a system holding population never reaches `popCap = 0`**; a zero-population system's housing is
  fully eligible; totality at θ ≥ 1, `catchUp = 2`, zero counts.

**Commit:** `feat(decay): proportionate unrest collapse with a housing occupancy floor`

### Task 3: Colony housing sized to the seed

**Modify:** `lib/engine/directed-build.ts`.

**Test:** `lib/engine/__tests__/directed-build.test.ts`,
`lib/constants/__tests__/band-constants.test.ts`.

- [ ] Drop the `+ 1` in `sizeColonyEstablish`; rewrite the docstring (it promises headroom).
- [ ] Widen the containment assertion to both housing-sizing sites (Locked Decision 4), sweeping
  seed sizes across and around whole-level boundaries (1, 2, 19, 20, 21, 40, 41).
- [ ] Verify the player's direct-colony verb still shares the helper and lands `popCap >= seedPop`.
- [ ] Check `applyDevelopments`' `popCap` raise and its docstring still read correctly with the
  tighter sizing.

**Commit:** `feat(colonisation): size colony housing to the seed, inside the vacancy slack`

### Task 4: Suppression exclusion scoped to the shortfall it explains

**Modify:** `lib/tick/processors/economy.ts`, `lib/tick/processors/good-market-state.ts`,
`lib/tick/world/directed-build-world.ts` (row type, if the flag's shape changes there),
`lib/engine/directed-build.ts`.

**Test:** `lib/engine/__tests__/directed-build.test.ts`,
`lib/tick/processors/__tests__/economy.test.ts`,
`lib/tick/processors/__tests__/good-market-state.test.ts`.

- [ ] Make the suppression signal per-(system, good) at the economy processor and thread it through
  `toGoodMarketStates` to the planner rows.
- [ ] Apply Locked Decision 5 in `assessStructural`: unconditional `capacityGap`; `feedbackGap`
  excluded only where suppressed **and** capacity > 0; `spare` always on realized production.
- [ ] Leave `surplusDrawable`'s suppression parameter alone; add a comment naming why the two call
  sites differ, and a test pinning that difference.
- [ ] Tests: a system with **zero capacity** in a good and unrest above the strike threshold still
  produces a structural deficit for it; a system whose capacity covers 60% of demand while striking
  proposes the missing 40%; a system whose capacity covers 120% while striking proposes nothing;
  a striking exporter contributes only realized spare to the pool.

**Commit:** `feat(planner): scope the suppression exclusion to the shortfall it explains`

### Task 5: Colony founding stock endowment

**Modify:** `lib/constants/colonisation.ts`, `lib/engine/directed-build.ts`,
`lib/tick/world/directed-build-world.ts`, `lib/tick/processors/directed-build.ts`,
`lib/tick/adapters/memory/directed-build.ts`, `lib/world/tick.ts`, `lib/world/types.ts`.

**Test:** `lib/engine/__tests__/directed-build.test.ts`,
`lib/tick/processors/__tests__/directed-build.test.ts`, `lib/world/__tests__/tick.test.ts`.

- [ ] Add `FOUNDING_STOCK_ANCHOR_FRAC` with a docstring stating the policy parity with world-gen
  and that it is separately named so calibration can diverge it.
- [ ] Extend `SystemDevelopment` with `stockManifest`; compute it in the directed-build processor
  from the source's `SystemBuildRow.goods`, honouring `surplusDrawable` and the running per-source
  balance (Locked Decision 6).
- [ ] Add `applyFoundingStock(markets, developments)` in `lib/world/tick.ts` and wire it into the
  monthly block beside `applyDevelopments`.
- [ ] Tests: conservation (source loss equals target gain, per good); two colonies sharing one
  source draw from a single shrinking balance; a source holding nothing sends nothing and the
  colony still lands; the manifest never draws a source below its own drawable floor; the manifest
  is weighted like the colony's real basket (mostly food/water at a 2-pop seed, trace luxuries);
  an empty manifest serialises cleanly.

**Commit:** `feat(colonisation): founding stock endowment conserved from the founding system`

### Task 6: Harness — striking share and stranded population

**Modify:** `lib/tick-harness/population-analysis.ts`, `scripts/simulate.ts`.

**Test:** `lib/tick-harness/__tests__/population-analysis.test.ts`.

- [ ] Add striking share (alongside the count) and the stranded-population count + held population
  to `PopulationSummary`; render both in the Population & Unrest block.
- [ ] Fix any stale comments the metrics touch. Do not add the regime-share metric (PR6).

**Commit:** `feat(harness): striking share and stranded-population metrics`

### Task 7: Cross-layer regression sweep

- [ ] `npx vitest run` green, including the `ECONOMY_SCALE` invariance bridges. Fixture magnitudes
  will shift — update them; keep assertions range-y per the coarse-health standard.
- [ ] Grep for surviving readers of the retired `gainRationing`/`gainShortage` and
  `buildingCollapseDebt` names across `lib/`, `app/`, `components/` and fixtures.
- [ ] Confirm no read service or component re-derives a regime, unrest equilibrium, or suppression
  flag locally (the PR6 chips must have exactly one definition to adopt).
- [ ] `npx next build --webpack` green.
- [ ] Save round-trip: a pre-PR5 save loads, the missing `collapseDebt` reads 0, and a tick runs
  without NaN/Infinity entering world state.

**Commit:** `test(band): PR5 cross-layer regression sweep`

### Task 8: Simulator validation, recalibration, build gate, PR, review

- [ ] Re-run `npm run simulate -- --config experiments/examples/equilibrium-calibration.yaml`
  (3000 ticks, seed 42) and compare against the `1789c9a` baseline table at the top of this plan.
- [ ] Report **striking share, stranded population, mean unrest, median price/base, floor-pinned
  share per good, collapsed systems, colonies with housing, and colonies populated-but-industry-less**.
  Interpret cohort composition explicitly: cover medians span all markets, so a change in the
  living/dead mix moves them independently of supply — quote live-cohort figures and per-good
  production/demand alongside any cover claim.
- [x] Run the §8 **unrest/tax recalibration** — **moot**: the ceilings are parked with Task 1, so no
  equilibrium moved and there is nothing to re-derive. Resumes with that slice.
- [x] Run the §8 **treasury recalibration** (realized output rises → production-tax income moves) —
  **done and flat**: the planner unblocking and exporter-spare change do lift realized output, but
  measured treasury figures stayed inside the existing ranges, so no constants or magnitude-test
  bounds are touched. Recorded here so the step reads as measured, not skipped.
- [ ] If striking share and stranded population have not moved decisively toward zero, stop and
  report rather than tuning constants to mask a structural miss — the amplifiers above are the
  hypothesis under test.
- [ ] Open the PR against `feat/band-reconciliation`, then run `/uber-review` against the checked-out
  PR head. Fix findings, then squash/fast-forward into `feat/band-reconciliation`. Do not merge
  shared to main before PR6.

## Self-review checklist

- [ ] Every umbrella PR5 bullet and every amended spec bullet (§2 suppression scoping, §3 regime
  weighting + ceilings + colony housing, §4 founding stock, §5 collapse rescope) maps to a task/test.
- [ ] `supplyRegime` is demand-weighted with no per-good vital list; both its docstring and the
  `ECONOMY_CONSTANTS` comment are rewritten, not left describing the worst-good fold.
- [ ] Unrest equilibrium is `floor + ceiling × D` by construction; tax is still the exact equilibrium
  at D = 0; both containment assertions compute from the shared constants rather than hardcoded
  sums, and the deliberate very-high-tax strike overlap is documented, not silently absorbed.
- [ ] Collapse teardown is independent of building-type count, ramped by severity, and a system
  holding population can never reach `popCap = 0`.
- [ ] The idle channel is unchanged — housing is contained by sizing at **both** sites, not by an
  exemption.
- [ ] `capacityGap` is unconditional; a zero-capacity system is always buildable; exporter spare is
  realized, never latent; `surplusDrawable`'s separate meaning is preserved and pinned by a test.
- [ ] Founding stock is conserved from the source, floored by `surplusDrawable`, shares one balance
  per source per pulse, and carries no expansion-pacing claim.
- [ ] All new functions are total; no `Infinity`/`NaN` can enter world state; no `as`/`unknown`.
- [ ] No UI changes; PR6 scope (chips, `needSeverity`, `computeCoverLevels`, `RATION_EXIT_EPS`,
  regime-share metric, docs fold) untouched.
- [ ] Deferred items (seed sizing, engineer luxury weighting, idle buffer as a lever) are recorded
  in the spec, not silently dropped.

## Spec-to-task traceability

- §3 demand-weighted rate regime → Task 1.
- §3 per-regime unrest ceilings + containment assertion → Task 1.
- §5 collapse channel: per-system rate, severity ramp, housing occupancy floor → Task 2.
- §3/§5 colony housing sized to seed + widened containment assertion → Task 3.
- §2 suppression exclusion scoped per (system, good) → Task 4.
- §2 exporter spare on realized output → Task 4.
- §4 colony founding stock endowment + conservation → Task 5.
- §8 striking share + stranded population metrics → Task 6.
- §8 unrest/tax and treasury recalibration → Task 8.
- §8 collapse/colony validation assertions → Tasks 1–5 (unit) and Task 8 (sim read).
