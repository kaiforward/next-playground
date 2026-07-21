# Band Reconciliation PR3 — Realized-Aware Logistics and Paced Construction — Implementation Plan

> **Slice:** PR3 of `band-reconciliation-umbrella.md`, implementing §2 of the approved
> `docs/planned/economy-band-reconciliation.md`. PR1/PR2 are merged into
> `feat/band-reconciliation` at `a0da9b5` / `f6a7f6c`. The feature-level `/spec-review` ran on
> 2026-07-20 and all 13 findings were folded into the spec; do not rerun it for this PR plan.

## Goal

- Put government consumption in the shared demand computation so tick, band, planner, logistics,
  seed, cover, and needs reads agree.
- Persist each economy assessment's reference-cycle realized production rate, causal
  strike/maintenance suppression flag, and rationing streak per market.
- Make logistics/build consume that persisted assessment on coincident and independent cadences.
- Draw only current structural exporters below the anchor, to a separate 0.75 × T reserve.
- Target 110% of demand, require two post-net construction assessments, cap each response at 40% of
  its remaining gap, and count in-flight work before proposing more.
- Add the two-pulse rationing feedback backstop with funding-bound and suppression exclusions.
- Add exact per-pulse production-level commitment instrumentation and an end-to-end ordering test.

PR3 does **not** change population/unrest/housing/colony mechanics, regime UI, needs severity,
`computeCoverLevels`, final calibration, or docs lifecycle. Those remain PR4/PR5.

## Branch and review contract

- Branch `feat/band-reconciliation-pr3-planner-logistics` from clean `feat/band-reconciliation` at
  `f6a7f6c`.
- Base the PR on the shared branch, open it before `/uber-review`, and review the checked-out PR head.
- Use the task/commit boundaries below. PR5 owns active-doc promotion and build-plan deletion.

## Locked interface decisions

### 1. Government demand enters at `consumptionRate`, exactly once

Require `GovernmentType` at these signatures:

```ts
consumptionBreakdown(goodId, basis, governmentType)
consumptionRate(goodId, basis, governmentType)
capacityGoodRates(buildings, population, yields, governmentType)
civilianDemandRateForGood(goodId, basis, governmentType)
totalDemandRateForGood(goodId, basis, buildings, yields, governmentType, labourState?)
getInitialStock(buildings, yields, population, goodId, governmentType)
```

`ConsumptionBreakdown` gains `government`. The rate sums base + technician + engineer + the
`ECONOMY_SCALE`-scaled additive boost. Unowned systems pass `frontier`.

Delete `govConsumptionBoost` from `TickEntryInput` and `govDef` from `MarketTickInput`; the economy
adapter supplies complete `baseConsumptionRate`. Event `consumptionMult` remains a later transient
multiplier. The needs tooltip adds a Government row so visible parts still sum to `want`.

### 2. Persist the completed economy assessment on `WorldMarket`

```ts
/** Reference-cycle realized output; missing => capacity fallback until first assessment. */
realizedProductionRate?: number;
/** Strike or maintenance reduced production; event modifiers deliberately excluded. */
productionSuppressed?: boolean;
/** Consecutive rationed economy assessments, saturated at 2; missing => 0. */
squeezePulses?: number;
/** Consecutive structural construction assessments, saturated at 2; missing => 0. */
proposalPulses?: number;
```

Do not bump `SAVE_FORMAT_VERSION`. Persisted rate is
`simulated[i].realized / catchUpFactor(economyInterval)`, finite and non-negative.
`EconomySignals.realizedProductionBySystem` stays the actual pulse quantity used by treasury.

`productionSuppressed` is exactly `strikeMultiplier × maintenanceMalus < 1`; event production
multipliers are not suppression exclusions.

### 3. Counter clocks are distinct

- Economy assessment: `satisfaction < 1` increments `squeezePulses`, full satisfaction resets, cap 2.
- Construction assessment: positive **post-net** residual increments `proposalPulses`, zero resets,
  cap 2.
- Build automation off still advances proposal counters; it gates proposal emission only.
- Off-pulse readers do not advance either clock. A stale assessment is never counted twice.

### 4. Shared state separates actual production from capacity

`toGoodMarketStates` returns:

- `production`: persisted `realizedProductionRate`; fallback to computed capacity only when missing;
- `capacityProduction`: `capacityGoodRates` output for target sizing/committed work.

It also threads suppression, satisfaction, both counters, and `logisticsFundingBound`. Logistics reads
actual production; build reads both. Never use treasury's pulse quantity as a rate.

### 5. Planner policy order is fixed

For each developed `(system, good)`:

1. Fold every open build project into effective buildings; recompute government-aware demand and
   capacity, including queued gates/factories and their industrial input demand.
2. Preserve realized standing output, then add only the non-negative capacity delta from queued work.
3. If suppressed: emit no local gap; capacity above demand counts as latent spare when netting other
   systems, preventing strike/maintenance replacement builds.
4. Else `capacityGap = max(0, 1.10 × demand - capacityProduction)`.
5. If `squeezePulses >= 2` and neither funding-bound nor suppressed:
   `feedbackGap = demand × (1 - satisfaction)`; otherwise 0.
6. Gross gap is `max(capacityGap, feedbackGap)`, never their sum.
7. Net reachable actual/latent exporter spare through the existing faction-wide algorithm.
8. Advance/reset proposal counter from this residual; only next value 2 is eligible.
9. Pass `0.40 × residual` to placement. Whole-level rounding may produce one level but may not restore
   the uncapped residual.

Add exact constants: `PROVISION_MARGIN = 0.10`, `PERSISTENCE_PULSES = 2`,
`BUILD_RATE_CAP = 0.40`. Speculative basics and housing remain unchanged.

### 6. Proposal planning returns decisions and persistence writes

```ts
interface ProposalPersistenceUpdate {
  systemId: string;
  goodId: string;
  proposalPulses: number;
}

interface FactionBuildPlan {
  proposals: BuildProposal[];
  persistenceUpdates: ProposalPersistenceUpdate[];
}
```

`planFactionProposals` returns `FactionBuildPlan`. `planFactionBuilds` may remain an immediate
low-level test surface, but both share gap math and `planFactionBundles`; no second planner.

The processor plans every due faction even when automation is off, persists updates, then discards
`plan.proposals` only for that player's disabled build domain. Colonisation remains independent.

### 7. Export reserve is separate policy

Add `DIRECTED_LOGISTICS.STRATEGIC_EXPORT_RESERVE_FRAC = 0.75`:

- `production > demand`: drawable to `0.75 × targetStock`;
- otherwise: existing `stock >= SURPLUS_MARGIN × targetStock` trigger and anchor floor.

Suppressed/input-starved former exporters cannot deep-draw but can ship ordinary excess above anchor.
Keep the initial seed reserve separate. Assert
`STRATEGIC_EXPORT_RESERVE_FRAC × TARGET_COVER > RATION_COVER`.

### 8. Persisted markets are the only cadence fallback

Do not pass economy `ctx.results` to logistics/build. Coincident pulses see economy's freshly persisted
fields; off-month pulses see the last assessment; old saves use documented defaults. One path avoids
same-tick/fallback divergence.

### 9. Timing stays economy → population → logistics → build

Patch same-tick logistics stock/funding into build rows, but never rewrite already-measured satisfaction
or squeeze. Imports affect those at the next economy assessment. Do not reorder or rerun economy.

## Global constraints

- Pure engine, deterministic tick, finite JSON world state.
- No forbidden `as`, postfix `!` outside test idiom, or `unknown`.
- Clamp persisted rates/counters at adapter boundaries; counters are integers in `[0,2]`.
- Developed systems only; controlled/unclaimed markets remain inert.
- Government boost is applied once; event consumption multiplier remains separate.
- PR2 funding marker and isolated selling/decay signal keep their semantics.
- Queue order stays committed → player → auto; manual work is not rate-capped or automation-gated.
- Constants remain scale-invariant. `computeCoverLevels` remains PR5 scope.

---

### Task 1: Fold government consumption into the shared demand spine

**Modify:** `physical-economy.ts`, `industry.ts`, `market-economy.ts`, engine tick/builder/pop-needs,
economy/population adapters, good-market-state, economy/logistics/build world types, world tick/gen,
world-index and population/industry/logistics services, API type, population tooltip.

**Test:** physical-economy, industry, market-economy, tick/builder, good-market-state, population,
generation, and affected service tests.

- [ ] Create the branch and verify PR2 ancestry:

```bash
git status --short
git switch -c feat/band-reconciliation-pr3-planner-logistics
git merge-base --is-ancestor f6a7f6c HEAD
```

- [ ] Write failing tests: militarist weapons/fuel includes scaled government; four breakdown fields
  sum to rate; capacity/civilian/total/planner/population/seed/needs inherit it; unowned is frontier;
  tick builder does not add again.
- [ ] Implement required government arguments everywhere. Add one version-cached
  `governmentByFactionId` service index; no repeated faction scans.
- [ ] Delete late builder addition and unused imports; preserve event multipliers.
- [ ] Add the fourth needs tooltip row/API comment; do not touch PR5 regimes/severity.
- [ ] Verify:

```bash
npx vitest run lib/engine/__tests__/physical-economy.test.ts lib/engine/__tests__/industry.test.ts lib/constants/__tests__/market-economy.test.ts lib/engine/__tests__/tick.test.ts lib/tick/processors/__tests__/good-market-state.test.ts lib/tick/processors/__tests__/population.test.ts lib/world/__tests__/gen.test.ts lib/services/__tests__/system-population.test.ts lib/services/__tests__/system-industry.test.ts
npx tsc --noEmit
```

- [ ] Commit: `feat(economy): unify government-adjusted demand`.

---

### Task 2: Persist realized production, suppression, and squeeze streaks

**Modify:** `lib/world/types.ts`, economy world/adapter/processor, `lib/world/gen.ts`, exact-row fixtures.

**Test:** economy processor/adapter, save, world tick.

- [ ] Failing tests cover normalized rate while treasury quantity stays raw; explicit zero; same rate
  at intervals 12/24/48; strike/maintenance true but event-only false; squeeze 0→1→2 saturation/full
  reset; non-consumer zero; optional round-trip and omission at save v8.
- [ ] Add fields/boundary types. Cache one operational suppression per system and reuse it for tick
  resolution + persisted flag.
- [ ] Persist finite `realized/catchUp`, boolean, and saturated squeeze count for every assessed market.
  Explicitly store 0 for assessed zero output; adapter clamps invalid numeric values to 0.
- [ ] Generate counters as 0; leave rate/suppression absent until first economy assessment.
- [ ] Verify/commit:

```bash
npx vitest run lib/tick/processors/__tests__/economy.test.ts lib/tick/adapters/memory/__tests__/economy.test.ts lib/world/__tests__/save.test.ts lib/world/__tests__/tick.test.ts
npx tsc --noEmit
git add lib
git commit -m "feat(economy): persist planner assessment signals"
```

---

### Task 3: Make shared classification realized-aware and add exporter reserve

**Modify:** directed-logistics/build constants/engines, good-market-state, logistics/build world rows,
world tick row builders.

**Test:** directed-logistics/build, good-market-state, logistics processor, scale invariance.

- [ ] Failing tests: persisted rate including 0; missing-only capacity fallback; separate capacity and
  flags; former producer realized 0 is sink; exporter 0.90 T draws to 0.75 T; non-producer 0.90 T
  cannot; stock-holder stops at T; suppressed/input-starved cannot deep-draw; reserve/ration invariant.
- [ ] Add government to system rows and assessment fields to market rows; populate both row builders.
- [ ] Extend `GoodMarketState`/`BuildGoodState` with required `capacityProduction` and optional policy
  fields. Keep one `toGoodMarketStates` derivation.
- [ ] Implement two-path `surplusDrawable`; update comments claiming every donor stops at anchor.
- [ ] Verify/commit:

```bash
npx vitest run lib/engine/__tests__/directed-logistics.test.ts lib/engine/__tests__/directed-build.test.ts lib/tick/processors/__tests__/good-market-state.test.ts lib/tick/processors/__tests__/directed-logistics.test.ts lib/engine/__tests__/economy-scale-invariance.test.ts
npx tsc --noEmit
git add lib
git commit -m "feat(logistics): classify realized supply with exporter reserves"
```

---

### Task 4: Implement margin, feedback, persistence, and cap in the pure planner

**Modify:** `lib/constants/directed-build.ts`, `lib/engine/directed-build.ts`.

**Test:** directed-build; construction/centre only for result-shape helpers.

- [ ] Add exact constants 0.10 / 2 / 0.40.
- [ ] Gap tests: capacity=demand yields margin, 110% none; reachable spare nets first; suppression
  makes no local gap and latent spare avoids remote replacement; two squeezes activate feedback;
  funding/suppression exclude it; gaps use max; sufficient input-starved final capacity does not grow.
- [ ] Persistence/cap tests: first residual counter1/no proposal; second counter2/proposal; recovery reset;
  saturation; 10 exposes 4; whole rounding cannot restore 10; 60-level residual is capped; multi-system
  total remains 40% of combined residual.
- [ ] In-flight tests: slow project counts before landing; queued consumer adds input demand; queued
  gates fold; same level is not re-proposed; manual/auto capacity count identically.
- [ ] Refactor effective states from buildings + open projects. Preserve realized standing output, add
  non-negative committed delta, follow locked policy order, return `FactionBuildPlan`, and keep one
  placement implementation.
- [ ] Existing placement/ROI fixtures start `proposalPulses: 1` and read `plan.proposals`; dedicated
  tests own counter behavior. Do not weaken labour/space/gate/colony/ROI assertions.
- [ ] Verify/commit:

```bash
npx vitest run lib/engine/__tests__/directed-build.test.ts lib/engine/__tests__/construction.test.ts lib/engine/__tests__/construction-centre.test.ts
npx tsc --noEmit
git add lib/constants/directed-build.ts lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts lib/engine/__tests__/construction.test.ts lib/engine/__tests__/construction-centre.test.ts
git commit -m "feat(construction): pace persistent structural deficits"
```

---

### Task 5: Persist proposal counters through directed build and world tick

**Modify:** directed-build world interface/adapter/processor, `lib/world/tick.ts`.

**Test:** directed-build processor, world tick, save.

- [ ] Tests: due developed rows write increment/reset; off-pulse none; counters advance with player
  build automation off but proposals do not; colony automation independent; fresh same-tick
  funding-bound blocks feedback; persisted suppression blocks construction-only feedback;
  committed/manual work continues funding.
- [ ] Add `{ id, proposalPulses }` update and `applyProposalPersistenceUpdates`; memory adapter captures
  `Map<marketId, number>` with integer `[0,2]` clamp.
- [ ] Plan every due faction, translate natural system/good updates using existing composite id, discard
  proposals only after assessment when automation is off, and leave colony/centre/order/funding intact.
  Persist counters independent of ROI/funding outcome.
- [ ] Add narrow `applyBuildMarketUpdates` after directed build; change only `proposalPulses` and
  preserve same-tick patched logistics/economy fields.
- [ ] Divergent-cadence world test: construction-only advances proposal only; economy-only advances
  squeeze only; stale reads do not advance the other clock; result saves.
- [ ] Verify/commit:

```bash
npx vitest run lib/tick/processors/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-logistics.test.ts lib/world/__tests__/tick.test.ts lib/world/__tests__/save.test.ts
npx tsc --noEmit
git add lib
git commit -m "feat(construction): persist proposal pressure across pulses"
```

---

### Task 6: Lock logistics-to-assessment timing end to end

**Modify/Test:** `lib/world/__tests__/tick.test.ts`; focused logistics test only if helper needed.

- [ ] Coincident-pulse fixture: two developed same-faction systems; recipient below ration cover with
  demand above realized production; donor has realized spare/stock/funding/route. After tick, flow and
  stock change, but satisfaction/squeeze/unrest describe pre-import assessment. At next economy pulse,
  satisfaction becomes supplied and squeeze resets. Assert direction, not PR4 recovery magnitude.
- [ ] Non-coincident fixture: logistics-only changes stock but retains assessment until economy.
- [ ] Verify and commit `test(economy): lock logistics assessment ordering`.

---

### Task 7: Add exact build-burst harness instrumentation

**Modify:** tick result types, directed-build processor, world tick return, harness types/runner/
experiment, `scripts/simulate.ts`.

**Test:** directed-build processor, build-analysis, experiment.

- [ ] Tests count new autonomic production-good levels by good; exclude housing/gates/centres/colonies/
  old work; include same-pulse completion; store per-good maxima/global worst good+tick; empty zero/null;
  experiment JSON includes summary.
- [ ] Add optional `buildCommitmentsByGood: Map<string, number>` to `TickProcessorResult`; populate from
  new autonomic proposal items filtered by `GOODS[buildingType]`. Count proposal levels, not final queue.
- [ ] Expose it under separate `runWorldTick().instrumentation`, never `TickBroadcastRaw`/SSE/world.
- [ ] Harness adds deterministic descending `byGood { goodId, maxLevelsPerPulse, tick }`, global max,
  worst good/tick to results, saved experiment, and console build-loop section.
- [ ] Verify/commit:

```bash
npx vitest run lib/tick/processors/__tests__/directed-build.test.ts lib/tick-harness/__tests__/build-analysis.test.ts lib/tick-harness/__tests__/experiment.test.ts
npx tsc --noEmit
git add lib scripts/simulate.ts
git commit -m "feat(sim): report per-pulse construction bursts"
```

---

### Task 8: Cross-layer regression sweep

- [ ] Search demand paths:

```bash
rg -n "govConsumptionBoost|govDef|consumptionBoosts|consumptionRate\(|capacityGoodRates\(|civilianDemandRateForGood\(|totalDemandRateForGood\(|getInitialStock\(" lib components
```

Every live helper gets government; no late addition; event multiplier remains; reads agree.

- [ ] Search carrier/classification paths:

```bash
rg -n "realizedProductionRate|productionSuppressed|squeezePulses|proposalPulses|realizedProductionBySystem|production: prodByKey|surplusDrawable\(" lib
```

Treasury uses pulse quantity; planners use persisted rate; fallback is missing-only; counters saturate;
one market derivation remains.

- [ ] Run focused suite, scale bridge, full suite, typecheck:

```bash
npx vitest run lib/engine/__tests__/physical-economy.test.ts lib/engine/__tests__/industry.test.ts lib/constants/__tests__/market-economy.test.ts lib/engine/__tests__/tick.test.ts lib/engine/__tests__/directed-logistics.test.ts lib/engine/__tests__/directed-build.test.ts lib/engine/__tests__/construction.test.ts lib/engine/__tests__/construction-centre.test.ts lib/tick/processors/__tests__/economy.test.ts lib/tick/processors/__tests__/good-market-state.test.ts lib/tick/processors/__tests__/directed-logistics.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/tick/processors/__tests__/population.test.ts lib/world/__tests__/tick.test.ts lib/world/__tests__/save.test.ts lib/world/__tests__/gen.test.ts lib/tick-harness/__tests__/build-analysis.test.ts lib/tick-harness/__tests__/experiment.test.ts
npx vitest run lib/engine/__tests__/economy-scale-invariance.test.ts
npx vitest run
npx tsc --noEmit
```

Keep interval/scale assertions ratio-based. Commit only genuine corrections with a narrow subject.

---

### Task 9: Simulator validation, build gate, PR, and review

- [ ] Confirm clean branch/log:

```bash
git status --short
git log --oneline --decorate feat/band-reconciliation..HEAD
```

- [ ] Run:

```bash
npm run simulate -- --config experiments/examples/equilibrium-calibration.yaml
npm run simulate
```

Judge PR3 scope only:

- no NaN/Infinity/runaway/new pins, broken saves, or dead logistics;
- government goods' band/planner demand matches live draw;
- suppressed/input-starved capacity is not a deep exporter; structural exporters use 0.75 T without
  reaching ration threshold;
- burst metric is finite and materially below observed ~60 levels; counters contain only 0/1/2;
- funding/suppression does not mint replacements; a cleared persistent residual builds;
- imported stock changes satisfaction at the next assessment;
- do not chase PR4 population/housing/unrest or PR5 regimes/cover.

Record worst burst good/tick + top five, logistics, price/cover, queue, population/unrest, and treasury
funding in the PR body. Tune only margin within 0.10–0.15 or cap within 0.33–0.50 if initial values are
nonfunctional, and document it.

- [ ] Final gates:

```bash
npx vitest run
npx next build --webpack
```

- [ ] Push/open before review:

```bash
git push -u origin feat/band-reconciliation-pr3-planner-logistics
gh pr create --base feat/band-reconciliation --title "feat(economy): PR3 — realized-aware agency" --body "<shared demand + persisted units/defaults + clocks + reserve + timing + sim/burst + interim notes>"
```

PR body explicitly records: shared government chokepoint; normalized persisted rate vs treasury pulse
quantity; optional defaults/no save bump; separate reserve/funding marker; in-flight accounting,
two-pulse persistence, 40% cap; causal lag test; sim readout and PR4/PR5 interim symptoms.

- [ ] Run `/uber-review` on checked-out PR head, fix in-scope findings, rerun gates, and
  squash/fast-forward into `feat/band-reconciliation`. Do not merge shared to main before PR5.

## Self-review checklist

- [ ] Every umbrella PR3 sentence maps to a task/test.
- [ ] Government boost appears exactly once across tick/planner/band/seed/needs/read paths.
- [ ] Persisted rate and treasury quantity have distinct units/names.
- [ ] Optional defaults are explicit; no save bump.
- [ ] Squeeze counts economy assessments; proposal persistence counts post-net build assessments.
- [ ] Suppression excludes strike/maintenance, not events; funding-bound stays separate.
- [ ] In-flight manual/auto work counts against auto proposals.
- [ ] Cap occurs before whole rounding and cannot be undone.
- [ ] Export/initial reserves are distinct constants.
- [ ] Timing tests cover coincident/divergent cadences.
- [ ] Burst instrumentation is transient, same-pulse exact, JSON-reported, not SSE.
- [ ] PR4/PR5 work remains excluded.

## Spec-to-task traceability

- §2 realized-aware classification → Tasks 2–3.
- §2 government chokepoint → Task 1.
- §2 margin/backstop/pacing → Tasks 4–5.
- §2 strategic reserve → Task 3.
- §2 off-month fallback → Tasks 2–3 + Task 5 cadence test.
- §2 timing → Task 6.
- Umbrella burst metric → Task 7.
- PR2 funding marker → Tasks 3–5 unchanged.
- PR1 satisfaction → Tasks 2/4.
