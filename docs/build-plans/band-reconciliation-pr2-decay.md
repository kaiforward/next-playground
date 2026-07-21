# Band Reconciliation PR2 — Selling Signal, Funding-Bound Protection, and Vacancy — Implementation Plan

> **Build slice:** PR2 of `band-reconciliation-umbrella.md` — the decay side of the approved
> `docs/planned/economy-band-reconciliation.md` (§1 selling/decay bullet, §5, and the constants in
> §7). PR1 is already merged into `feat/band-reconciliation` at `a0da9b5`: the production knee,
> true stock floor, scarcity-ramped draws, and persisted satisfaction are the starting point.
> The feature-level `/spec-review` gate already ran on 2026-07-20 and all 13 accepted findings are
> folded into the functional spec; do not run it again for this per-PR plan.

## Goal

Make infrastructure decay read the same healthy/glut geometry the economy now runs:

- the economy emits an isolated per-good `sellingFactor` equal to
  `productionCeiling(startStock, targetStock, HOLD_COVER)` — no labour, input-gate, strike,
  maintenance, event, or realized-output term;
- producer utilization becomes
  `count × min(effectiveFulfilment, min(1, sellingFactor + USED_SLACK))`, except a producer whose
  latest logistics assessment was funding-bound reads demand-backed and therefore fully selling;
- the Industry read path recomputes the same factor from current stock + band and consumes the same
  funding-bound marker, so panel `used` and decay cannot disagree;
- housing gets a 10% vacancy allowance and the base idle buffer doubles from 6 to 12 reference
  months;
- the legacy full-storage-band `outputUptake` / `selfLimitingFactor` machinery is deleted.

This PR removes the post-PR1 producer-decay incoherence. It does **not** make the planner
realized-aware, change logistics reserve policy, add squeeze/proposal counters, alter population
growth or housing construction, add regimes/UI chips, recalibrate the full economy, or fold docs.
Those remain PR3–PR5 exactly as assigned by the umbrella.

## Branch and review contract

- Start `feat/band-reconciliation-pr2-decay` from the clean shared branch `feat/band-reconciliation`.
- Keep this PR based on `feat/band-reconciliation`; never stack it on the PR1 branch.
- Commit each task below as one cohesive unit. The suggested subjects are implementation-oriented;
  the shared branch may squash them when this PR merges.
- Push and open the PR **before** `/uber-review`, then review PR2 against the shared feature branch.
- Do not update the active economy docs yet. PR5 owns the feature-wide docs fold after all interim
  states are gone.

## Locked interface decisions

These are resolved here so implementation does not rediscover them halfway through.

### 1. `sellingFactor` is the exact pre-flow ceiling term

For a produced market row, the economy pulse records:

```ts
productionCeiling(tickEntries[i].stock, tickEntries[i].targetStock, simParams.holdCover)
```

Use the tick entry's **start-of-entry** stock, not `simulated[i].stock` and not
`simulated[i].realized`. That is the exact stock observed by the production-knee call in the coupled
engine before this good's output and civilian draw are applied. The signal therefore remains pure
when labour, recipes, strikes, maintenance funding, or events suppress actual flow.

`EconomySignals.outputUptakeBySystem` is renamed to `sellingFactorBySystem`. A market with built
production capacity emits a factor even when current labour/skill fulfilment makes its effective
production rate zero; otherwise absence would silently turn an isolated signal into a staffing-
dependent one. Missing signals still default to `1` at consumers for compact engine fixtures.

### 2. Funding-bound state is persisted per market, with both endpoints marked

The logistics matcher returns a `FundingBoundMatch` whenever a reachable donor/deficit pairing has
positive wanted quantity but the remaining work budget cannot fund all of it. This includes zero
budget and a partially-funded final transfer; it excludes unreachable deficits, missing surplus,
and a transfer limited only by donor drawable.

The processor persists one optional field on **both** market endpoints:

```ts
/**
 * The latest logistics assessment found this row at one endpoint of a reachable
 * wanted-but-unfunded match. Source-side: demand-backed export capacity must not
 * be pruned as glut. Destination-side: PR3 must not answer the squeeze by building
 * local capacity. Missing => false.
 */
logisticsFundingBound?: boolean;
```

One field is sufficient because the consumers already know their role: decay only asks on a
produced/selling row, while PR3's backstop will ask on a rationed deficit. On every due logistics
assessment, all market rows belonging to the processed faction shard are explicitly refreshed
true/false, so a recovered budget or vanished route clears stale protection. Off-pulse and not-due
factions retain their latest completed assessment.

This is additive optional `World` state: missing reads false and **does not** bump
`SAVE_FORMAT_VERSION`.

### 3. Cadence is causal, never backward

The fixed tick order remains economy → decay → population/migration → logistics → build. A marker
written by logistics cannot protect decay earlier in the same tick. Decay therefore reads the latest
persisted logistics assessment (normally the previous logistics pulse); the current logistics pulse
then refreshes it for the next economy/decay assessment. This is the same deliberate assessment lag
the functional spec already owns for logistics → satisfaction, and it works when month/logistics
cadences diverge. Do not reorder processors, dry-run the matcher before decay, or duplicate matching
inside the economy stage.

### 4. Raw signal and policy exclusion stay separate

`sellingFactor` remains the raw isolated ceiling term everywhere. The funding-bound override is a
separate boolean in `UtilizationContext`; `buildingUsed` composes it as policy:

```ts
const canSell = ctx.logisticsFundingBound?.(goodId)
  ? 1
  : Math.min(1, ctx.sellingFactor(goodId) + USED_SLACK);
return count * Math.min(effectiveFulfilment(ctx.state, tier), canSell);
```

Do not write `1` into `sellingFactorBySystem` for a funding-bound row. PR5 needs the unmodified factor
to classify Glut honestly, and PR3 needs the separate funding explanation.

## Global constraints

- Engine functions remain pure. No `World`, filesystem, environment, or wall-clock reads enter
  `lib/engine/`.
- No `as` assertions, postfix `!` outside accepted test `find(...)!`, or new `unknown` types.
- `WorldMarket` remains JSON-serializable; the new marker is an optional boolean, never a `Set`/`Map`.
- Market IDs remain the existing `${systemId}|${goodId}` composite key. Do not introduce a second
  identity scheme for funding markers.
- Only developed systems participate. The marker is refreshed only through the existing logistics
  participant/shard path.
- Keep `minStock` as price geometry only. PR2 must not revive it as a selling, utilization, transfer,
  or draw boundary.
- The maintenance malus stays flow-only. Maintenance funding may scale the idle-buffer duration, but
  it cannot enter `sellingFactor` or the funding-bound override.
- Single-level overshoot protection remains emergent from `floor(count - used)`: at
  `sellingFactor = 0`, `USED_SLACK = 0.15` leaves only 0.85 of one level idle, so a one-level colony
  producer is not removed by ordinary glut decay.
- Funding-bound protection only affects buffered idle contraction. It does not suppress the existing
  catastrophic unrest teardown above `unrestThreshold`.
- No new harness metric in PR2. Use the existing final-world decay/population/construction readouts;
  PR3–PR5 own burst-build, saturation/migration, and regime-share instrumentation.

---

### Task 1: Emit the isolated selling factor from the economy pulse

**Files:**

- Modify: `lib/tick/types.ts` (`EconomySignals`)
- Modify: `lib/tick/processors/economy.ts`
- Modify: `lib/tick/adapters/memory/economy.ts`
- Modify: `lib/tick/world/economy-world.ts` (clarify zero-valued producer rate)
- Modify: every test fixture constructing `EconomySignals`
- Test: `lib/tick/processors/__tests__/economy.test.ts`
- Test: `lib/tick/processors/__tests__/population.test.ts`
- Test: `lib/tick/processors/__tests__/treasury.test.ts`
- Test: `lib/tick/processors/__tests__/infrastructure-decay.test.ts`

**Interfaces:**

- Consumes: PR1's `productionCeiling(stock, targetStock, holdCover)`.
- Produces:
  `EconomySignals.sellingFactorBySystem: Map<string, Map<string, number>>`.
- Retires from the transient interface: `outputUptakeBySystem`.
- Keeps unchanged: `dissatisfactionBySystem`, `realizedProductionBySystem`.

- [ ] **Step 1: Write the failing economy-signal tests**

Replace the old `outputUptake` describe in `economy.test.ts` with tests for:

1. **Knee geometry** — same produced good at stock `T`, `1.15 × T`, and `1.3 × T` emits `1`, `0.5`,
   and `0` (for `HOLD_COVER = 1.3`).
2. **Start-stock boundary** — choose production/consumption large enough that final stock differs
   materially from start stock; assert the signal equals `productionCeiling(startStock, ...)`, not a
   post-tick recompute.
3. **Suppression invariance** — identical output-good stock/band with:
   - calm vs strike-suppressed unrest,
   - full vs low maintenance output funding,
   - production-rate event multiplier vs no event,
   - ample vs starved recipe inputs,
   all emit the same raw factor.
4. **Zero-current-flow producer** — a built producer with zero labour/skill fulfilment still has its
   output good in `sellingFactorBySystem`; `realizedProductionBySystem` may remain absent/zero.
5. **Non-producer** — a consumed-only market is absent from the inner factor map.

- [ ] **Step 2: Run the focused test to prove the old storage-band signal fails**

```bash
npx vitest run lib/tick/processors/__tests__/economy.test.ts
```

Expected: the new geometry/invariance tests fail against `outputUptakeBySystem`.

- [ ] **Step 3: Preserve producer identity in the memory economy adapter**

`buildingProduction(...)` legitimately returns `0` when labour or an academy ceiling binds. The
adapter currently converts every non-positive rate to `undefined`, erasing the fact that a building
for the good exists. During the existing one-per-system adapter pass, derive the set of goods with a
positive built producer count from `BUILDING_TYPES`; then set:

```ts
baseProductionRate: producedGoods.has(m.goodId) ? production : undefined,
```

Do not make a second `Object.entries(buildings)` scan per market row. The transient `Set` belongs in
the adapter cache alongside `labourBySystem`; it never enters `World`.

Update `MarketView.baseProductionRate`'s doc: `undefined` means no built producer; `0` means built
capacity currently produces no flow because staffing/skill fulfilment is zero.

- [ ] **Step 4: Replace the economy signal**

In `lib/tick/processors/economy.ts`:

- import `productionCeiling` instead of `outputUptake`;
- build `sellingFactorBySystem`;
- identify a produced row via `m.baseProductionRate !== undefined`, not the already-suppressed
  `tickEntries[i].productionRate > 0`;
- compute the factor from `tickEntries[i].stock`, `targetStock`, and `simParams.holdCover`;
- leave `simulated[i].realized` exclusively as the production-tax / PR3 realized-flow signal.

Update the comments to state explicitly that labour, input gates, strikes, maintenance, event
multipliers, and realized output are outside this term.

Rename the field in `EconomySignals` and update all object literals in population, treasury, and decay
tests. Do not rename `realizedProductionBySystem` or change its behavior.

- [ ] **Step 5: Run focused tests + typecheck**

```bash
npx vitest run lib/tick/processors/__tests__/economy.test.ts lib/tick/processors/__tests__/population.test.ts lib/tick/processors/__tests__/treasury.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add lib/tick/types.ts lib/tick/processors/economy.ts lib/tick/adapters/memory/economy.ts lib/tick/world/economy-world.ts lib/tick/processors/__tests__/
git commit -m "feat(economy): emit the isolated producer selling factor"
```

---

### Task 2: Rebase producer utilization and the Industry read path onto the shared factor

**Files:**

- Modify: `lib/constants/infrastructure.ts`
- Modify: `lib/engine/industry.ts`
- Modify: `lib/engine/infrastructure-decay.ts`
- Modify: `lib/tick/processors/infrastructure-decay.ts`
- Modify: `lib/services/universe.ts` only if its existing `bandOf` closure needs a naming/comment sweep
- Modify: `lib/engine/tick.ts` (delete legacy helpers)
- Test: `lib/engine/__tests__/industry.test.ts`
- Test: `lib/engine/__tests__/infrastructure-decay.test.ts`
- Test: `lib/engine/__tests__/tick.test.ts`
- Test: `lib/tick/processors/__tests__/infrastructure-decay.test.ts`

**Interfaces:**

- Adds leaf constant: `USED_SLACK = 0.15` in `lib/constants/infrastructure.ts`.
- Continues consuming PR1's `RATION_COVER` in the unchanged input-gate readout; producer selling
  utilization is independently based on `productionCeiling`.
- Renames `UtilizationContext.outputUptake` → `sellingFactor`.
- Renames `SystemDecayInput.outputUptake` → `sellingFactor`.
- `buildIndustryReadout` keeps its PR1 signature; its existing `bandOf` closure is enough to recompute
  the read-side factor.
- Deletes exported functions `outputUptake` and `selfLimitingFactor` from `lib/engine/tick.ts`.

- [ ] **Step 1: Write failing utilization tests**

In `industry.test.ts`, replace storage-band expectations with:

```ts
it("producer used composes staffing once with selling-factor slack", () => {
  // count 10, fulfil 0.8, sellingFactor 0.6 => canSell 0.75 => used 7.5
});

it("a producer at the anchor reads fully selling", () => {
  // current stock = targetStock => productionCeiling = 1 => used = staffed count
});

it("a genuine glut above the hold ceiling leaves only USED_SLACK in use", () => {
  // stock >= HOLD_COVER × T, full staffing, count 10 => used = 1.5
});

it("keeps a one-level overshoot safe from ordinary glut contraction", () => {
  // count 1, sellingFactor 0 => used .15 => floor(1 - .15) === 0
});

it("defaults a missing market band to selling factor 1", () => {});
```

Keep the existing labour/skill idle-reason tests, but move their stocks to at/below `targetStock` so
selling is flat at 1 and cannot confound the staffing assertion. The selling idle-reason test should
use stock at `HOLD_COVER × targetStock`, not `maxStock`/`minStock` language.

In `infrastructure-decay.test.ts`, add a direct whole-level witness:

- a healthy producer just above `T` with `sellingFactor + USED_SLACK` leaving less than one whole
  level idle does not advance its counter;
- a large genuinely glutted stack does advance and sheds at the buffer;
- a strike/input/maintenance suppression cannot be expressed through `SystemDecayInput` at all —
  the input only accepts the raw `sellingFactor` plus labour state.

- [ ] **Step 2: Run focused tests to verify failure**

```bash
npx vitest run lib/engine/__tests__/industry.test.ts lib/engine/__tests__/infrastructure-decay.test.ts lib/tick/processors/__tests__/infrastructure-decay.test.ts
```

- [ ] **Step 3: Implement the shared producer formula**

Add the named constant:

```ts
/** Slack on the isolated selling factor before a whole producer level can read idle. */
export const USED_SLACK = 0.15;
```

In `UtilizationContext`, rename the accessor to `sellingFactor`. In the `market_good` arm of
`buildingUsed`:

```ts
const canSell = Math.min(1, ctx.sellingFactor(output.goodId) + USED_SLACK);
return count * Math.min(effectiveFulfilment(ctx.state, tier), canSell);
```

This counts staffing once. Do not multiply fulfilment by the factor and do not add any flow/suppression
field to the context.

Thread the rename through `SystemDecayInput`, `computeSystemDecay`, and
`runInfrastructureDecayProcessor`. The processor reads
`signals.sellingFactorBySystem`; a missing system/good defaults to `1` as today.

- [ ] **Step 4: Recompute the Industry read-side factor from stock + band**

In `buildIndustryReadout`, replace the old `outputUptake(stock, minStock, maxStock)` closure with:

```ts
const sellingFactorOf = (goodId: string): number => {
  const band = bandOf(goodId);
  return band === undefined
    ? 1
    : productionCeiling(stockOf(goodId), band.targetStock, ECONOMY_CONSTANTS.HOLD_COVER);
};
```

Pass it to `UtilizationContext.sellingFactor`; use it again when naming the producer idle reason.
The existing input-gate/readout logic remains untouched. Update the function docs: `minStock` is no
longer part of utilization; `bandOf` supplies the anchor, and the same `productionCeiling` primitive
drives tick and read path.

`lib/services/universe.ts` already builds `bandByGood` and passes `bandOf`, so no new market-band
plumbing is required in this task. Only update stale comments if present.

- [ ] **Step 5: Delete the legacy curve**

Remove `outputUptake` and, once its only caller is gone, `selfLimitingFactor` from
`lib/engine/tick.ts`. Delete their describes/imports from `tick.test.ts`. Update `MarketTickEntry` and
`TickEntryInput` comments so `minStock` is solely the price-saturation point, not “retained for decay”.

Run:

```bash
rg -n "outputUptake|selfLimitingFactor" lib app components
```

Expected after fixture/comment renames: no live code references. Test names/comments should use
`sellingFactor` too; active docs are intentionally folded in PR5.

- [ ] **Step 6: Run focused tests + typecheck**

```bash
npx vitest run lib/engine/__tests__/tick.test.ts lib/engine/__tests__/industry.test.ts lib/engine/__tests__/infrastructure-decay.test.ts lib/tick/processors/__tests__/economy.test.ts lib/tick/processors/__tests__/infrastructure-decay.test.ts
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add lib/constants/infrastructure.ts lib/engine/tick.ts lib/engine/industry.ts lib/engine/infrastructure-decay.ts lib/tick/processors/infrastructure-decay.ts lib/services/universe.ts lib/engine/__tests__/ lib/tick/processors/__tests__/
git commit -m "feat(economy): rebase producer utilization onto the selling knee"
```

---

### Task 3: Make wanted-but-unfunded logistics observable and persistent

**Files:**

- Modify: `lib/engine/directed-logistics.ts`
- Modify: `lib/engine/__tests__/directed-logistics.test.ts`
- Modify: `lib/world/types.ts` (`WorldMarket.logisticsFundingBound?`)
- Modify: `lib/tick/world/directed-logistics-world.ts`
- Modify: `lib/tick/adapters/memory/directed-logistics.ts`
- Modify: `lib/tick/processors/directed-logistics.ts`
- Modify: `lib/tick/processors/__tests__/directed-logistics.test.ts`
- Modify: `lib/world/tick.ts` (carry/apply/patch the marker)
- Test: `lib/world/__tests__/save.test.ts`
- Test: `lib/world/__tests__/tick.test.ts`

**Interfaces:**

```ts
export interface FundingBoundMatch {
  goodId: string;
  fromSystemId: string;
  toSystemId: string;
}

export interface TransferMatchResult {
  transfers: PlannedTransfer[];
  fundingBound: FundingBoundMatch[];
}
```

`matchFactionTransfers(...)` returns `TransferMatchResult` instead of a bare transfer array.

World/row carrier:

```ts
logisticsFundingBound?: boolean; // missing => false
```

World adapter write:

```ts
export interface LogisticsFundingBoundUpdate {
  id: string;
  logisticsFundingBound: boolean;
}
```

Keep this separate from `LogisticsMarketUpdate { id, stock }`; a status refresh must not rewrite
stock from a stale row snapshot.

- [ ] **Step 1: Write failing matcher tests**

Update existing calls to read `.transfers`, then add:

1. **Partial budget** — the transfer quantity is capped by budget and the chosen donor/receiver/good
   appears once in `.fundingBound`.
2. **Zero budget** — no transfer is emitted, but a reachable donor/deficit pair is still observable.
   This requires removing the engine's early `budget <= 0` return before classification.
3. **Ample budget** — a fully-filled gap emits no funding-bound match.
4. **Drawable-bound only** — donor drawable caps the transfer while budget remains; no funding-bound
   match (capacity/spare ran out, money/work did not).
5. **Unreachable/no source** — no match; absence of logistics capacity is not “wanted but unfunded”.
6. **Budget exhausted before later deficits** — the engine continues classification-only scanning
   after budget reaches zero and reports the later reachable pair(s), while emitting no more transfers.

The matcher keeps its existing one-nearest-source-per-deficit allocation behavior. Do not expand this
PR into multi-source residual matching.

- [ ] **Step 2: Implement `TransferMatchResult`**

Retain the existing severity ordering and nearest-source selection. For each deficit with a reachable
best source:

- `wanted = min(deficit.shortfall, source.drawable)`;
- `affordable = budget / perUnit` (zero when budget is exhausted);
- transfer `min(wanted, affordable)` when positive;
- if `affordable < wanted`, append the endpoint triple to `fundingBound`;
- continue scanning after exhaustion to discover further funding-bound pairs, but never emit a zero
  or non-finite transfer.

The live matcher enumerates each deficit's candidates from the existing bounded-hop cache and then
filters that neighbourhood through the per-good surplus index. It must not scan every faction surplus
after exhaustion; the fallback all-system enumerator exists only for small standalone engine callers.

Deduplicate endpoint triples before returning if the existing iteration can reach the same triple
more than once. Do not attach money/funding percentages or quantities; PR2/PR3 only require the
explanatory boolean.

- [ ] **Step 3: Add the optional World/row carrier**

Add `logisticsFundingBound?: boolean` to `WorldMarket` with the locked doc block above, and thread it
through `MarketRowForLogistics` / `marketRowsBySystem`. Missing remains false; world-gen need not write
the field and save format stays version 8.

Add a save round-trip test that sets the marker true on one market and confirms it survives
`serializeWorld` → `deserializeWorld`. Also confirm an ordinary generated/old-shape row without the
field remains accepted.

- [ ] **Step 4: Persist true/false for every due row**

The directed-logistics processor should accumulate all match results, then:

- keep `allTransfers` exactly as today for stock/flow application;
- build a set of composite market IDs for **both** endpoints of every funding-bound triple;
- evaluate every market row in the due `rows`, then call `applyFundingBoundUpdates` only where the
  next boolean differs from `market.logisticsFundingBound ?? false`; this includes stale true rows
  that must be cleared without cloning every unchanged market;
- perform this refresh even when there are zero transfers or the funded fraction is zero;
- skip it on off-pulse / no-due-key paths, preserving the prior completed assessment.

Extend `MemoryDirectedLogisticsWorld` with a `fundingBoundUpdates: Map<string, boolean>` capture and a
separate apply method. Add processor tests for:

- partial/zero budget marks both `mDonor` and `mReceiver` true;
- unrelated rows in the same due faction refresh false;
- a second ample-budget assessment clears formerly true rows;
- unreachable pairs remain false;
- off-pulse makes no status writes.

- [ ] **Step 5: Fold adapter writes into `World` and same-tick build rows**

Replace the stock-only merge/patch helpers in `lib/world/tick.ts` with helpers that can apply both
captured maps without conflating them:

```ts
applyLogisticsMarketUpdates(markets, stockUpdates, fundingBoundUpdates)
patchLogisticsMarketRows(rowsBySystem, stockUpdates, fundingBoundUpdates)
```

The World merge updates `stock` only when a stock update exists and
`logisticsFundingBound` only when a status update exists. The row patch does the same before building
`SystemBuildRow`, so PR3 can consume the latest same-pulse destination marker without reopening PR2
plumbing. Keep untouched row arrays by reference where neither map mentions their system.

Add a `runWorldTick` test proving a marker written by directed logistics appears on both endpoint
`WorldMarket` rows and clears on the next due assessment when the match is fully funded/no longer
wanted.

- [ ] **Step 6: Run focused tests + typecheck**

```bash
npx vitest run lib/engine/__tests__/directed-logistics.test.ts lib/tick/processors/__tests__/directed-logistics.test.ts lib/world/__tests__/save.test.ts lib/world/__tests__/tick.test.ts
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add lib/engine/directed-logistics.ts lib/engine/__tests__/directed-logistics.test.ts lib/world/types.ts lib/tick/world/directed-logistics-world.ts lib/tick/adapters/memory/directed-logistics.ts lib/tick/processors/directed-logistics.ts lib/tick/processors/__tests__/directed-logistics.test.ts lib/world/tick.ts lib/world/__tests__/
git commit -m "feat(logistics): persist wanted-but-unfunded market matches"
```

---

### Task 4: Consume funding-bound protection in decay and Industry readout

**Files:**

- Modify: `lib/engine/industry.ts` (`UtilizationContext`, `buildingUsed`, readout accessor)
- Modify: `lib/engine/infrastructure-decay.ts` (`SystemDecayInput`)
- Modify: `lib/tick/world/infrastructure-world.ts` (`InfrastructureProcessorParams`)
- Modify: `lib/tick/processors/infrastructure-decay.ts`
- Modify: `lib/world/tick.ts` (latest-assessment map passed before decay)
- Modify: `lib/services/universe.ts`
- Test: `lib/engine/__tests__/industry.test.ts`
- Test: `lib/engine/__tests__/infrastructure-decay.test.ts`
- Test: `lib/tick/processors/__tests__/infrastructure-decay.test.ts`
- Test: `lib/services/__tests__/universe.test.ts` or the existing service test that asserts Industry
  readout utilization (locate with `rg "getSystemIndustry" lib/services/__tests__`)
- Test: `lib/world/__tests__/tick.test.ts`

**Interfaces:**

- Adds optional `UtilizationContext.logisticsFundingBound?: (goodId: string) => boolean`.
- Adds the same optional accessor to `SystemDecayInput` (missing → false).
- Adds transient
  `InfrastructureProcessorParams.logisticsFundingBoundBySystem?: ReadonlyMap<string, ReadonlySet<string>>`.
- Appends optional `logisticsFundingBoundOf?: (goodId: string) => boolean` to
  `buildIndustryReadout` **after** the existing optional `demandRateOf`, avoiding churn in all existing
  five-argument fixtures.

- [ ] **Step 1: Write failing policy-composition tests**

Add engine tests proving:

1. a fully-staffed producer at `sellingFactor = 0` is glut-idle when unmarked;
2. the same producer with `logisticsFundingBound(goodId) === true` reads fully used and gets no
   `selling` idle reason;
3. funding-bound protection does not hide labour/skill shortage — fulfilment still binds;
4. funding-bound protection does not stop catastrophic unrest teardown;
5. a missing accessor behaves exactly like false.

Add a processor test where `sellingFactorBySystem` says `0`, the funding map contains the produced
good, and buffered idle contraction does not occur. Repeat without the marker and assert contraction.

- [ ] **Step 2: Compose the policy in `buildingUsed`**

Use the locked formula from the interface section. Keep `sellingFactor` raw and add the optional
funding accessor separately. Thread it through `computeSystemDecay` and the Industry readout context.

In `buildIndustryReadout`, default the appended accessor to false. The service collects
`row.logisticsFundingBound ?? false` alongside stock/band/demand and passes a typed closure.

- [ ] **Step 3: Feed decay from the latest persisted logistics assessment**

On an economy pulse in `runWorldTick`, derive a transient nested map from current `markets` after the
economy adapter has committed its stock/satisfaction updates (the optional marker survives its row
spread). Include only true rows; do not allocate inner sets for systems with no marker.

Pass it through `InfrastructureProcessorParams`; the processor supplies per-system accessors to
`computeSystemDecay`. Do **not** add the map to `EconomySignals`: it is logistics-owned persisted state,
not an economy measurement.

Add an end-to-end timing test:

- begin an economy pulse with a pre-existing true marker on a glutted producer;
- assert this pulse's buffered decay is protected;
- let logistics refresh/clear the marker later in the tick;
- on the next economy pulse, assert ordinary glut idle behavior resumes.

This pins the causal one-assessment lag and prevents a future “fix” from reordering the pipeline.

- [ ] **Step 4: Run focused tests + typecheck**

```bash
npx vitest run lib/engine/__tests__/industry.test.ts lib/engine/__tests__/infrastructure-decay.test.ts lib/tick/processors/__tests__/infrastructure-decay.test.ts lib/world/__tests__/tick.test.ts lib/services/__tests__
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add lib/engine/industry.ts lib/engine/infrastructure-decay.ts lib/tick/world/infrastructure-world.ts lib/tick/processors/infrastructure-decay.ts lib/world/tick.ts lib/services/universe.ts lib/engine/__tests__/ lib/tick/processors/__tests__/ lib/world/__tests__/tick.test.ts lib/services/__tests__/
git commit -m "feat(economy): protect funding-bound exporters from idle decay"
```

---

### Task 5: Add housing vacancy allowance and double the idle buffer

**Files:**

- Modify: `lib/constants/infrastructure.ts`
- Modify: `lib/engine/industry.ts` (`capacityUsed` pop-cap arm)
- Test: `lib/engine/__tests__/industry.test.ts`
- Test: `lib/engine/__tests__/infrastructure-decay.test.ts`
- Test: `lib/tick/processors/__tests__/infrastructure-decay.test.ts` only for fixtures whose boundary
  shifts under vacancy slack

**Interfaces:**

- Adds leaf constant: `VACANCY_SLACK = 0.10`.
- Changes `INFRASTRUCTURE_DECAY_PARAMS.idleBufferMonths` from `6` to `12` reference months.
- Keeps `housingUsed(population)` as **literal occupancy**. Only the decay/readout utilization path
  applies vacancy allowance.

- [ ] **Step 1: Write failing housing-geometry tests**

Pin the exact distinction:

```ts
it("housingUsed remains literal occupancy", () => {
  // population for 9.2 levels => housingUsed === 9.2, not 10
});

it("buildingUsed grants housing the 10% vacancy allowance", () => {
  // count 10, occupancy 9.2 => min(10, 9.2 × 1.1) === 10
});

it("genuine emptying still leaves a whole idle housing level", () => {
  // count 10, occupancy 8 => used 8.8, floor(10 - 8.8) === 1
});

it("the PR4 relief target is structurally inside the vacancy allowance", () => {
  // occupancy ratio .92 × 1.10 >= 1; use the literal .92 here until PR4 names its constant
});
```

Add a decay test showing 8% vacancy resets/holds the idle counter while materially empty housing
still accrues and sheds. Keep exact `housingUsed` assertions unchanged.

- [ ] **Step 2: Implement vacancy-aware housing utilization**

In the `capacity/pop_cap` arm only:

```ts
return Math.min(count, housingUsed(ctx.population) * (1 + VACANCY_SLACK));
```

Do not change `housingPopCap`, population, migration headroom, or the panel's occupancy ratio. PR4 owns
those mechanics; this PR changes only the decay-relevant “used” amount.

- [ ] **Step 3: Set the base buffer to 12**

Update `INFRASTRUCTURE_DECAY_PARAMS.idleBufferMonths` and its comments to current-reality language.
Maintenance funding continues to multiply the base exactly as shipped:

- funded scale `1` → 12 reference months;
- full-maintenance scale `1.25` → 15;
- insolvency scale `0.25` → 3.

Do not retune `maintenanceBufferScale`, `unrestThreshold`, collapse debt, or cadence.

- [ ] **Step 4: Run focused tests + typecheck**

```bash
npx vitest run lib/engine/__tests__/industry.test.ts lib/engine/__tests__/infrastructure-decay.test.ts lib/tick/processors/__tests__/infrastructure-decay.test.ts lib/constants/__tests__/treasury.test.ts
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add lib/constants/infrastructure.ts lib/engine/industry.ts lib/engine/__tests__/industry.test.ts lib/engine/__tests__/infrastructure-decay.test.ts lib/tick/processors/__tests__/infrastructure-decay.test.ts
git commit -m "feat(economy): allow healthy housing vacancy before decay"
```

---

### Task 6: Cross-layer regression sweep

**Files:** whichever tests/comments fail the sweep; no new mechanic.

- [ ] **Step 1: Search the retired vocabulary and geometry**

```bash
rg -n "outputUptake|selfLimitingFactor" lib app components
rg -n "sellingFactorBySystem|logisticsFundingBound|USED_SLACK|VACANCY_SLACK" lib
rg -n "minStock.*decay|minStock.*uptake|storage band.*decay" lib app components
```

Expected:

- no `outputUptake` / `selfLimitingFactor` code or test references;
- one raw selling-factor producer (economy), two consumers (decay + Industry read path through the
  shared `buildingUsed` context), and explicit funding-bound carrier plumbing;
- no use of `minStock` outside price/band math, price tests, and row shapes that still carry it for
  pricing.

Do not edit active docs in this task; their coordinated present-tense fold is PR5 scope.

- [ ] **Step 2: Run the full unit suite**

```bash
npx vitest run
```

Fix fixtures that encoded the old storage-band meaning. Keep magnitude assertions range-y. Pay
special attention to:

- `EconomySignals` object literals;
- Industry `used` values (producer slack and housing vacancy intentionally change them);
- one-level decay fixtures (glut slack may now protect them by design);
- interval-awareness tests (12 is a reference-month base, catch-up behavior is unchanged);
- save/world equality fixtures (optional marker missing is false, not an error).

- [ ] **Step 3: Run both invariance bridges unmodified**

Locate the exact filenames with `rg --files lib | rg "invariance.*test"`, then run the economy-scale
and cadence-invariance tests. Neither selling geometry nor boolean funding explanation may introduce
scale/cadence-dependent math. If a bridge fails, fix implementation; do not loosen the bridge.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit only if the sweep found real stragglers**

Use a narrow subject naming what was corrected; do not create a generic “fix tests” commit.

---

### Task 7: Simulator validation, build gate, PR, and review

**Files:** none expected — verification and delivery.

- [ ] **Step 1: Confirm a clean implementation branch**

```bash
git status --short
git log --oneline --decorate feat/band-reconciliation..HEAD
```

- [ ] **Step 2: Run the equilibrium calibration experiment**

```bash
npm run simulate -- --config experiments/examples/equilibrium-calibration.yaml
npm run simulate
```

Read the report against PR2's landed scope:

- **Must hold:** no NaN/Infinity, runaway stock, or new floor/ceiling pinning; median price/base and
  satisfaction/unrest remain in PR1's sane coarse band; colonies continue to develop/populate.
- **Must improve:** producer stacks resting near `T` no longer shed because of the old storage-band
  uptake; final built-base decay should fall materially versus PR1's interim run unless the removed
  levels are attributable to real understaffing, genuine glut, or unrest collapse.
- **Housing expectation:** normal ~8% vacancy is decay-safe and base churn should fall, but the housing
  treadmill is only half-fixed until PR4 flips autonomic housing to pressure relief.
- **Funding expectation:** a treasury/logistics funding dip may leave demand-backed stock at the hold
  ceiling, but the persisted marker prevents ordinary idle pruning; catastrophic unrest teardown still
  applies.
- **Expected and not chased:** capacity-blind planner classification, burst proposals, old proactive
  housing/growth equilibrium, and missing regime UI. Those are PR3–PR5.

Record the before/after `decayedPct`, population/unrest/strike readout, market price/cover readout, and
treasury funded means in the PR body. Do not precision-tune PR3/PR4 symptoms from this interim state.

- [ ] **Step 3: Final gates**

```bash
npx vitest run
npx next build --webpack
```

- [ ] **Step 4: Push and open PR2**

```bash
git push -u origin feat/band-reconciliation-pr2-decay
gh pr create --base feat/band-reconciliation --title "feat(economy): PR2 — honest decay signals and vacancy" --body "<summary + spec pointers + signal/carrier timing + sim readout + interim PR3/PR4 notes>"
```

The PR body must explicitly state:

- selling factor is the isolated pre-flow production-ceiling term;
- `logisticsFundingBound` marks both endpoints and is consumed with one completed-assessment lag by
  decay because pipeline order is unchanged;
- the funding marker is optional/save-compatible and raw selling factor remains unmodified;
- housing gets decay slack only — population/housing build behavior is still PR4 scope;
- simulator before/after values and the remaining interim symptoms.

- [ ] **Step 5: Run `/uber-review` on the checked-out PR head**

Use PR mode so findings land as comments. Fix cheap, self-contained findings that touch this PR;
rerun focused tests plus the full build gate after changes. When green, squash/fast-forward PR2 into
`feat/band-reconciliation` per the shared-branch workflow. Do not merge the shared branch to `main`
until PR5 completes the feature and docs lifecycle.

---

## Self-review checklist (run before implementation)

- Spec §1 isolated selling term → Tasks 1–2.
- Spec §1/§5 purse flow-only guarantee → Task 1 suppression-invariance tests + Task 2 type surface.
- Spec-review M2 funding-shortage ratchet → Tasks 3–4, with both matcher endpoints persisted.
- Umbrella `sellingFactorBySystem` shape → Task 1, exact name and nested maps.
- Umbrella funding-bound shape “decided in PR2” → Task 3 optional per-market boolean + matcher triples.
- Spec §5 `USED_SLACK = 0.15`, `VACANCY_SLACK = 0.10`, buffer 12 → Tasks 2 and 5.
- Existing whole-level pacing, collapse debt, academy/complex utilization, single-level protection →
  explicitly preserved and tested.
- Industry display vs decay consistency → shared `buildingUsed`, same `productionCeiling`, same persisted
  funding marker in Tasks 2 and 4.
- Independent month/logistics cadences → persisted latest assessment; no backward dependency or reorder.
- PR3 handoff → same-pulse build rows receive refreshed `logisticsFundingBound`; destination role is ready
  without reopening World/adapter plumbing.
- PR4/PR5 scope → no planner/population/regime/UI/docs-fold work pulled forward.
