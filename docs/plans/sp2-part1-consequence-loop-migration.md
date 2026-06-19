# SP2 Part 1 — The Consequence Loop + Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make population *move* and give unmet need *teeth* — per-good need-satisfaction accumulates into a stored `unrest` property that suppresses production (strikes) and damps growth, population grows/declines logistically toward `popCap`, and migration relocates people along the de-regioned intra-faction topology — producing visible boom/bust geography, calibrated stable-but-growing.

**Architecture:** Three new pieces hang off the SP1 substrate + the Part-0 de-regioned topology. (1) The **economy** processor (region round-robin, unchanged sharding) reads each system's stored `unrest` to suppress production, then measures per-system convex demand-weighted dissatisfaction `D` from post-tick stock and hands it forward in-memory. (2) A new **population** processor (`dependsOn: economy`, same region scope) integrates `D` into `unrest`, applies logistic growth/decline, and rewrites `demandRate`. (3) A new **migration** processor (`dependsOn: population`) is a trade-flow twin — a work-budget edge-slice over the same open intra-faction graph, flowing population down-unrest / up-headroom, distance-attenuated. Prosperity is retired (its production/consumption multiplier slot becomes the strike multiplier; its UI re-points to an unrest-derived stability readout). One full reseed at the start (`population` Int→Float, `unrest` added, prosperity columns dropped).

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Prisma 7 (`@prisma/adapter-pg` / PostgreSQL), the existing tick-processor World/adapter pattern, the Part-0 `buildOpenEdges` topology helper.

## Global Constraints

- **No `as` casts** except `as const` and in `lib/types/guards.ts`. No `unknown`, no `Record<string, unknown>`. (CLAUDE.md)
- **Full reseed, once, in PR 1** — `population` Int→Float, `unrest Float @default(0)` added, `prosperity`/`tradeVolumeAccum` dropped. PR 2 and PR 3 add **no** schema change. Seed command (Prisma 7): `npx tsx --tsconfig tsconfig.json prisma/seed.ts` (lives in `prisma.config.ts`, not `package.json`); schema push: `npx prisma db push`.
- **Pure body, two adapters** — every processor body (`runEconomyProcessor`, `runPopulationProcessor`, `runMigrationProcessor`) runs unchanged against the Prisma adapter (live) and the in-memory adapter (sim + unit tests). Unit tests exercise bodies through the memory adapter; the Prisma adapters are verified by `tsc` + the integration/sim run.
- **Engine functions stay pure & DB-free** (`lib/engine/*`). Bulk DB writes use `unnest()` / `createMany` — never per-row writes inside a `$transaction` (N+1 time bomb at 10K scale). Guard `NaN`/`Infinity` before raw SQL.
- **Float, not Int, for population** — growth/migration produce fractional per-tick deltas that round to zero on small systems as `Int`. The sim already models `population: number`; only the live schema/adapters change.
- **Coarse calibration only** — stable-but-growing = avoid the extremes (no total collapse, no instant saturation, no migration ping-pong). Localized boom/bust + isolated non-viable-faction decline are *success*. Do not over-tune — SP3/SP5 reshape the equilibrium.
- Test command: `npx vitest run <path>`; full suite: `npx vitest run`; types: `npx tsc --noEmit`; sim: `npm run simulate`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| **PR 1 — retire prosperity + reseed** | | |
| `prisma/schema.prisma` | DB schema | **Modify** — `population` Int→Float; `+ unrest Float @default(0)`; drop `prosperity`, `tradeVolumeAccum` |
| `lib/engine/tick.ts` | pure tick engine | **Modify** — delete `ProsperityParams`/`updateProsperity`/`getProsperityMultiplier`/`getProsperityLabel`/`ProsperityLabel`; drop `prosperity` from `buildMarketTickEntry`; **export** `selfLimitingFactor` (PR 2 reuses it) |
| `lib/engine/market-tick-builder.ts` | shared tick-entry builder | **Modify** — drop `prosperity` input + `prosperityParams` arg from `resolveMarketTickEntry` |
| `lib/constants/economy.ts` | economy tunables | **Modify** — delete all `PROSPERITY_*`; keep the value `50` as `TRADE_SIMULATION.PLAYER_VOLUME_TARGET` (moved) |
| `lib/constants/trade-simulation.ts` | trade-flow tunables | **Modify** — add `PLAYER_VOLUME_TARGET: 50` (the displacement normalizer, decoupled from the prosperity name) |
| `lib/tick/world/economy-world.ts` | economy data interface | **Modify** — delete `ProsperityView`/`ProsperityUpdate`/`getProsperity`/`applyProsperityUpdates`/`prosperityParams` |
| `lib/tick/processors/economy.ts` | economy processor | **Modify** — delete the prosperity compute block + params |
| `lib/tick/adapters/prisma/economy.ts` | live economy adapter | **Modify** — delete `getProsperity`/`applyProsperityUpdates` |
| `lib/tick/adapters/memory/economy.ts` | sim economy adapter | **Modify** — delete `getProsperity`/`applyProsperityUpdates` |
| `lib/tick/world/trade-flow-world.ts` | trade-flow data interface | **Modify** — delete `VolumeIncrement` + `applyVolumeIncrements`; rename `prosperityTargetVolume`→`playerVolumeTarget` |
| `lib/tick/processors/trade-flow.ts` | trade-flow processor | **Modify** — delete `volumeBySystem` + `applyVolumeIncrements` call; read `PLAYER_VOLUME_TARGET` |
| `lib/tick/adapters/{prisma,memory}/trade-flow.ts` | trade-flow adapters | **Modify** — delete `applyVolumeIncrements` |
| `lib/services/trade.ts` | player trade | **Modify** — delete the dead `tradeVolumeAccum` increment (`:242-246`) |
| `lib/services/convoy-trade.ts` | convoy trade | **Modify** — delete the dead `tradeVolumeAccum` increment (`:303-307`) |
| `lib/engine/simulator/bot.ts` | sim bot | **Modify** — delete the `tradeVolumeAccum` increment (`:160`) |
| `lib/engine/simulator/types.ts` | sim world model | **Modify** — `SimSystem`: drop `prosperity`/`tradeVolumeAccum`, add `unrest: number` |
| `lib/engine/simulator/world.ts` | sim world builder | **Modify** — drop `prosperity:0`/`tradeVolumeAccum:0`, add `unrest: 0` |
| `lib/engine/simulator/constants.ts` | sim constants | **Modify** — delete the `prosperity` SimConstants block + imports |
| `lib/engine/simulator/economy.ts` | sim economy orchestration | **Modify** — drop `prosperityParams` + `prosperityTargetVolume` |
| `lib/services/prosperity.ts`, `lib/utils/prosperity.ts` | prosperity service + ramp utils | **Delete** |
| `app/api/game/systems/prosperity/route.ts` | prosperity API | **Delete** (re-created as stability in PR 3) |
| `lib/hooks/use-prosperity.ts` | prosperity hook | **Delete** (re-created as stability in PR 3) |
| `components/ui/prosperity-badge.tsx` | prosperity badge | **Delete** (re-created as stability in PR 3) |
| `components/map/pixi/layers/prosperity-territory-layer.ts` | prosperity choropleth | **Delete** (re-created as stability layer in PR 3) |
| `lib/types/map.ts` | MapMode | **Modify** — drop `"prosperity"` from `MapMode`/`MAP_MODES` (re-added as `"stability"` in PR 3) |
| `components/map/map-overlay-controls.tsx` | overlay controls | **Modify** — drop the prosperity mode label/legend |
| `components/map/star-map.tsx` | map shell | **Modify** — drop `useProsperity` wiring |
| `components/map/pixi/pixi-map-canvas.tsx` | pixi canvas | **Modify** — drop the prosperity layer |
| `lib/types/{api,game}.ts`, `lib/query/keys.ts`, `lib/hooks/use-tick-invalidation.ts` | types + query plumbing | **Modify** — drop `ProsperityEntry`/`ProsperityResponse`/`queryKeys.prosperity` + its invalidation |
| **PR 2 — consequence loop** | | |
| `lib/engine/population.ts` | **NEW** pure population dynamics | **Create** — `dissatisfaction`, `accumulateUnrest`, `strikeMultiplier`, `populationDelta` |
| `lib/constants/population.ts` | **NEW** population tunables | **Create** — `UNREST_PARAMS`, `STRIKE_PARAMS`, `POPULATION_PARAMS` |
| `lib/engine/tick.ts`, `lib/engine/market-tick-builder.ts` | tick engine | **Modify** — add `productionSuppress` (production-only multiplier) |
| `lib/tick/types.ts` | processor result type | **Modify** — add `economySignals?: EconomySignals` (in-memory D handoff) |
| `lib/tick/world/economy-world.ts` + adapters | economy data | **Modify** — add `getUnrest(systemIds)`; `MarketView` unchanged |
| `lib/tick/processors/economy.ts` | economy processor | **Modify** — read unrest → strike multiplier → `productionSuppress`; compute + return per-system `D` |
| `lib/tick/world/population-world.ts` | **NEW** population data interface | **Create** |
| `lib/tick/processors/population.ts` | **NEW** population processor body + wiring | **Create** |
| `lib/tick/adapters/{prisma,memory}/population.ts` | **NEW** population adapters | **Create** |
| `lib/tick/registry.ts` | processor registry | **Modify** — register `populationProcessor` |
| `lib/engine/simulator/economy.ts` | sim orchestration | **Modify** — insert `runPopulationProcessor` after economy; thread `D`; mutate population; rewrite `demandRate` |
| `lib/engine/simulator/metrics.ts`, `scripts/simulate.ts` | sim metrics + summary | **Modify** — population trajectory + unrest band readout |
| **PR 3 — migration + calibration + stability UI** | | |
| `lib/engine/migration.ts` | **NEW** pure migration | **Create** — `migrationAttractiveness`, `migrationFlow` |
| `lib/services/topology.ts` | **NEW** shared open-edge source | **Create** — extract from the trade-flow adapter (DRY: two consumers now) |
| `lib/tick/world/migration-world.ts` | **NEW** migration data interface | **Create** |
| `lib/tick/processors/migration.ts` | **NEW** migration processor body + wiring | **Create** |
| `lib/tick/adapters/{prisma,memory}/migration.ts` | **NEW** migration adapters | **Create** |
| `lib/constants/population.ts` | tunables | **Modify** — add `MIGRATION_PARAMS` |
| `lib/tick/registry.ts` | registry | **Modify** — register `migrationProcessor` |
| `lib/engine/simulator/economy.ts` | sim orchestration | **Modify** — insert `runMigrationProcessor` after population |
| `lib/services/stability.ts`, `app/api/game/systems/stability/route.ts`, `lib/hooks/use-stability.ts` | **NEW** stability read path | **Create** (mirror the deleted prosperity path, source = `unrest`) |
| `components/map/pixi/layers/stability-territory-layer.ts`, `components/ui/stability-badge.tsx` | **NEW** stability UI | **Create** (mirror the deleted prosperity UI) |
| `lib/types/map.ts`, `components/map/map-overlay-controls.tsx`, `components/map/star-map.tsx`, `components/map/pixi/pixi-map-canvas.tsx` | map | **Modify** — add `"stability"` mode |
| docs: `economy.md`, `system-traits.md`, `trade-simulation.md`, `tick-engine.md`, `economy-simulation-living-world.md`, `SPEC.md` | docs | **Modify** — unrest/stability replaces prosperity; dynamic population; resolve §14 (SP2-complete marking deferred to PR 4) |
| **PR 4 — population & stability readouts (system UI)** | | |
| `lib/constants/market-economy.ts` | demand helper | **Modify** — add `demandFootprint(population)` (pure, beside `demandRateForGood`) |
| `lib/types/api.ts` | API types | **Modify** — add `PopulationDemandEntry`, `SystemPopulationData`, `SystemPopulationResponse` |
| `lib/services/system-population.ts` | **NEW** population read service | **Create** — visibility-gated single-system population/unrest/demand snapshot |
| `app/api/game/systems/[systemId]/population/route.ts` | **NEW** population API | **Create** — mirrors the substrate route |
| `lib/query/keys.ts` | query keys | **Modify** — add `systemPopulation(systemId)` |
| `lib/hooks/use-system-population.ts` | **NEW** read hook | **Create** — tick-invalidated (NOT `staleTime: Infinity` like substrate) |
| `lib/hooks/use-tick-invalidation.ts` | tick invalidation | **Modify** — invalidate `["systemPopulation"]` on `economyTick` |
| `components/system/population-panel.tsx` | **NEW** tab content | **Create** — magnitude/headroom + stability (reuses PR 3 `StabilityBadge`) + demand footprint |
| `app/(game)/@panel/system/[systemId]/population/page.tsx` | **NEW** tab page | **Create** — mirrors the astrography tab |
| `app/(game)/@panel/system/[systemId]/layout.tsx` | tab nav | **Modify** — add the `Population` tab |
| `app/(game)/@panel/system/[systemId]/page.tsx` | overview | **Modify** — add a Stability row to the System Summary |

### Shared contracts (every task below references these)

```typescript
// lib/engine/population.ts  (PR 2) — pure, DB-free
export interface GoodSatisfaction { satisfaction: number; demanded: number; }
export function dissatisfaction(goods: GoodSatisfaction[]): number;          // convex demand-weighted D ∈ [0,1]
export interface UnrestParams { gain: number; decay: number; }
export function accumulateUnrest(unrest: number, d: number, p: UnrestParams): number;   // ∈ [0,1]
export interface StrikeParams { threshold: number; floorMultiplier: number; }
export function strikeMultiplier(unrest: number, p: StrikeParams): number;   // ∈ [floorMultiplier,1]
export interface PopulationParams { growthRate: number; declineRate: number; }
export function populationDelta(population: number, popCap: number, d: number, unrest: number, p: PopulationParams): number;

// lib/engine/migration.ts  (PR 3) — pure, DB-free
export interface MigrationNode { unrest: number; population: number; popCap: number; }
export interface AttractivenessWeights { contentment: number; headroom: number; }
export function migrationAttractiveness(n: MigrationNode, w: AttractivenessWeights): number;
export interface MigrationFlowParams { weights: AttractivenessWeights; maxOutflowFraction: number; gradientThreshold: number; distanceDecay: number; }
export function migrationFlow(a: MigrationNode, b: MigrationNode, fuelCost: number, p: MigrationFlowParams): { fromIsA: boolean; quantity: number };

// lib/tick/types.ts  (PR 2) — in-memory economy→population handoff (transient, not persisted)
export interface EconomySignals { dissatisfactionBySystem: Map<string, number>; }

// lib/tick/world/population-world.ts  (PR 2)
export interface PopulationStateView { systemId: string; population: number; popCap: number; unrest: number; }
export interface PopulationUpdate { systemId: string; population: number; unrest: number; }
export interface PopulationWorld {
  getPopulationState(systemIds: string[]): Promise<PopulationStateView[]>;
  applyPopulationUpdates(updates: PopulationUpdate[]): Promise<void>;   // writes population + unrest
  rewriteDemandRates(pops: Array<{ systemId: string; population: number }>): Promise<void>;  // demandRate = max(perCapitaNeed·pop, MIN_DEMAND)
}

// lib/tick/world/migration-world.ts  (PR 3)
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";  // { aSystemId, bSystemId, fuelCost }
export interface MigrationNodeView { systemId: string; population: number; popCap: number; unrest: number; }
export interface MigrationDelta { systemId: string; delta: number; }   // signed; conserved (Σ = 0)
export interface MigrationWorld {
  getOpenEdges(): Promise<EdgeView[]>;                                  // same faction-bounded edges as trade-flow
  getNodesForSystems(systemIds: string[]): Promise<MigrationNodeView[]>;
  applyMigrationDeltas(deltas: MigrationDelta[]): Promise<void>;        // population += delta (+ demandRate rewrite)
}
```

---

# PR 1 — Retire prosperity, reseed, prepare the substrate

Prosperity was a trade-volume proxy for "people are happy → produce more"; SP1 already moved that smooth supply response onto `population` (`labourFactor` + per-capita consumption), so the proxy collapses into the real thing. This PR removes it whole — engine, constants, processor, world, adapters, services, API, hook, UI — and runs the one full reseed (`population` Float, `unrest` column added, prosperity columns dropped). It is a **removal + migration** PR; the `tsc` compiler and the existing suite are the gate. No new behaviour ships except the schema shape.

> **Equilibrium note:** prosperity is a multiplier applied **equally to production and consumption** (`0.7×` at the seed default `prosperity=0`). Removing it lifts both rates by the same factor, so the stock *equilibrium* (where production ≈ consumption) is roughly preserved while throughput rises. Step 7's `npm run simulate` confirms the SP1 targets still hold.

## Task 1: Retire prosperity end-to-end + reseed

One atomic cascade — deleting `ProsperityParams` and the prosperity columns breaks every reference until all are gone, so `tsc` only goes green at the end. Steps group by layer; commit once.

**Files:** all PR-1 rows in the File Structure table.

**Interfaces:**
- Produces: `SimSystem.unrest: number`; `StarSystem.population Float` + `StarSystem.unrest Float`; `TRADE_SIMULATION.PLAYER_VOLUME_TARGET`. Consumed by PR 2.

- [ ] **Step 1: Engine — strip prosperity from `lib/engine/tick.ts`**

Delete these exports entirely: `ProsperityParams` (`:149-158`), `updateProsperity` (`:165-182`), `getProsperityMultiplier` (`:192-200`), `ProsperityLabel` (`:202`), `getProsperityLabel` (`:207-213`). In `buildMarketTickEntry`, remove the `prosperity` field from `TickEntryInput` (`:113`) and the `prosperityParams` parameter (`:124`); delete the `prosperityMult` line (`:126`) and drop the `* prosperityMult` from the `productionRate`/`consumptionRate` returns (`:139-142`) so they become:

```typescript
  return {
    goodId: input.goodId,
    stock: input.stock,
    productionRate: productionBeforeProsperity != null ? productionBeforeProsperity : undefined,
    consumptionRate: consumptionBeforeProsperity != null ? consumptionBeforeProsperity : undefined,
    volatility: input.volatility,
  };
```

(Rename the now-misleading locals `productionBeforeProsperity`/`consumptionBeforeProsperity` to `productionRate`/`consumptionRate` inline if you prefer; keep `buildMarketTickEntry`'s signature otherwise intact.) Finally, **export** `selfLimitingFactor` (change `function selfLimitingFactor` at `:42` to `export function selfLimitingFactor`) — PR 2's economy processor reuses its consume branch for the satisfaction signal.

- [ ] **Step 2: Engine — strip prosperity from `lib/engine/market-tick-builder.ts`**

Remove `prosperity` from `MarketTickInput` (`:39-40`), drop the `prosperityParams` parameter from `resolveMarketTickEntry` (`:55`), and remove `prosperity: input.prosperity` + the `prosperityParams` argument from the `buildMarketTickEntry` call (`:65-77`). Remove the now-unused `ProsperityParams` import (`:14`).

- [ ] **Step 3: Constants — delete `PROSPERITY_*`, move the displacement target**

In `lib/constants/economy.ts`: delete everything from the `// ── Prosperity constants ──` banner (`:13`) through the end of `PROSPERITY_PARAMS` (`:64`), and the `import type { ProsperityParams }` (`:1`). `ECONOMY_CONSTANTS` (`:4-11`) stays. In `lib/constants/trade-simulation.ts`, add inside `TRADE_SIMULATION` (next to `PLAYER_DISPLACEMENT_FACTOR`):

```typescript
  /**
   * Per-system target trade volume that normalizes player-displacement pressure
   * (`edgeVolume / PLAYER_VOLUME_TARGET`). A throttle constant for NPC flow — was
   * `PROSPERITY_TARGET_VOLUME`, kept after prosperity's retirement (unrelated to it).
   */
  PLAYER_VOLUME_TARGET: 50,
```

- [ ] **Step 4: Economy + trade-flow processors/worlds/adapters**

*Economy* (`lib/tick/world/economy-world.ts`): delete `ProsperityView` (`:50-55`), `ProsperityUpdate` (`:71-75`), `getProsperity` (`:95`), `applyProsperityUpdates` (`:101`), the `prosperityParams` field of `EconomyProcessorParams` (`:111`), and the `ProsperityParams` import. In `lib/tick/processors/economy.ts`: delete the prosperity compute block (`:84-101`), the `prosperity:` arg to `resolveMarketTickEntry` (`:115`), the `prosperityParams` arg (`:119`), the `applyProsperityUpdates` call (`:135`), the module-level `prosperityParams` (`:160`), and the `prosperityParams` in the live wiring (`:179`); remove the dead imports (`updateProsperity`, `ProsperityParams`, `PROSPERITY_PARAMS`, `ProsperityUpdate`). In `lib/tick/adapters/prisma/economy.ts` delete `getProsperity` (`:122-133`) + `applyProsperityUpdates` (`:150-166`); in `lib/tick/adapters/memory/economy.ts` delete `getProsperity` (`:106-118`) + `applyProsperityUpdates` (`:137-153`).

*Trade-flow* (the dead `tradeVolumeAccum` write path): in `lib/tick/world/trade-flow-world.ts` delete `VolumeIncrement` (`:54-58`) + `applyVolumeIncrements` (`:82-83`), and rename the `prosperityTargetVolume` param of `TradeFlowProcessorParams` to `playerVolumeTarget`. In `lib/tick/processors/trade-flow.ts` delete the `volumeBySystem` map + its `.set(...)` lines + the `applyVolumeIncrements` block (`:143-147`), change the displacement `pressure` to read `params.playerVolumeTarget`, and in the live wiring pass `playerVolumeTarget: TRADE_SIMULATION.PLAYER_VOLUME_TARGET` (replacing `prosperityTargetVolume: PROSPERITY_TARGET_VOLUME`; drop the `PROSPERITY_TARGET_VOLUME` import). Delete `applyVolumeIncrements` from both `lib/tick/adapters/{prisma,memory}/trade-flow.ts`.

- [ ] **Step 5: Delete the dead `tradeVolumeAccum` writers**

The only reader was prosperity; remove the writes. In `lib/services/trade.ts` delete the standalone update at `:242-246`:

```typescript
      // Increment trade volume accumulator on the system for prosperity computation
      await tx.starSystem.update({
        where: { id: ship.systemId },
        data: { tradeVolumeAccum: { increment: quantity } },
      });
```

In `lib/services/convoy-trade.ts` delete the identical block at `:303-307`. In `lib/engine/simulator/bot.ts` (`:158-161`) remove the `tradeVolumeAccum` branch (the `? { ...s, tradeVolumeAccum: s.tradeVolumeAccum + totalTraded }` spread becomes a no-op — keep the system unchanged when only volume would have updated).

- [ ] **Step 6: Sim model — drop prosperity, add `unrest`; move the displacement target**

In `lib/engine/simulator/types.ts` `SimSystem`: delete `prosperity` (`:38`) + `tradeVolumeAccum` (`:39`), add `unrest: number;` with a doc comment. In `lib/engine/simulator/world.ts` (`:80-84`) replace `prosperity: 0, tradeVolumeAccum: 0,` with `unrest: 0,`.

In `lib/engine/simulator/constants.ts`: delete the `prosperity` block from `SimConstants` (`:71-80`), from `SimConstantOverrides` (`:108`), from `buildDefaults` (`:178-187`), from `resolveConstants` (`:221`), and the prosperity imports (`:8-15`). Add `playerVolumeTarget: number;` to the `tradeFlow` interface block (`:81-89`) and `playerVolumeTarget: TRADE_SIMULATION.PLAYER_VOLUME_TARGET,` to the `tradeFlow` defaults (`:188-196`).

In `lib/engine/simulator/economy.ts`: delete the `ProsperityParams` import (`:9`), the `const prosperityParams: ProsperityParams = constants.prosperity;` line (`:247`) and the `prosperityParams,` arg to `runEconomyProcessor` (`:258`); in `processSimTradeFlow` change `prosperityTargetVolume: constants.prosperity.targetVolume` (`:298`) to `playerVolumeTarget: constants.tradeFlow.playerVolumeTarget`.

- [ ] **Step 7: Delete the prosperity UI + read path; drop the map mode**

Delete files: `lib/services/prosperity.ts`, `lib/utils/prosperity.ts`, `app/api/game/systems/prosperity/route.ts`, `lib/hooks/use-prosperity.ts`, `components/ui/prosperity-badge.tsx`, `components/map/pixi/layers/prosperity-territory-layer.ts`. In `lib/types/game.ts` delete `ProsperityEntry` (`:360-363`); in `lib/types/api.ts` delete `ProsperityResponse` (`:62`); in `lib/query/keys.ts` delete `prosperity` (`:35`); in `lib/hooks/use-tick-invalidation.ts` delete the prosperity invalidation (`:34`). In `lib/types/map.ts` drop `"prosperity"` from `MapMode` (`:4`) and `MAP_MODES` (`:7`). In `components/map/map-overlay-controls.tsx` delete the `prosperity` label (`:20`), the `tooltip` ramp wiring (`:48-54`), and `PROSPERITY_RAMP`/`ProsperityRampLegend` (`:177-200`). In `components/map/star-map.tsx` delete the `useProsperity` import (`:20`) + call (`:63`) and the `prosperityBySystem` prop passed down. In `components/map/pixi/pixi-map-canvas.tsx` delete the `ProsperityTerritoryLayer` import (`:14`), the `prosperityBySystem` prop (`:43-44`), and the layer construction (`:69-70`) plus any `mapMode === "prosperity"` branch that drives it.

> The choropleth **rendering pipeline** (territory layer, map mode, hook, service, API) returns in PR 3 sourced from `unrest` ("same pipeline, new source", spec §4). PR 1 removes it cleanly so no half-wired prosperity overlay lingers; the map simply has no stability overlay between PR 1 and PR 3 (acceptable on the shared feature branch).

- [ ] **Step 8: Update / delete prosperity tests**

Delete: `lib/utils/__tests__/prosperity.test.ts`, `lib/services/__tests__/integration/prosperity.integration.test.ts`, `components/map/pixi/__tests__/prosperity-territory.test.ts`, and the `MapMode prosperity` case in `lib/types/__tests__/map.test.ts`. In `lib/engine/__tests__/tick.test.ts` delete the `updateProsperity`/`getProsperityMultiplier`/`getProsperityLabel` suites + imports, and remove `prosperity`/`prosperityParams` from the `buildMarketTickEntry` test (assert the un-multiplied `productionRate`/`consumptionRate`). In `lib/tick/processors/__tests__/integration/economy.integration.test.ts` drop `PROSPERITY_PARAMS`/`prosperityParams` (`:7,23,45-50`). In `lib/tick/processors/__tests__/{trade-flow,events}.test.ts` and `lib/engine/__tests__/trade-flow-integration.test.ts` remove `prosperity`/`tradeVolumeAccum` from `SimSystem` fixtures and add `unrest: 0`; drop any `applyVolumeIncrements`/`tradeVolumeAccum` assertions (trade-flow-integration `:199-203`).

- [ ] **Step 9: Schema migration + reseed**

In `prisma/schema.prisma` `StarSystem`: change `population Int @default(0)` (`:210`) to `population Float @default(0)`; delete `prosperity` (`:205`) + `tradeVolumeAccum` (`:206`); add after `popCap`:

```prisma
  unrest           Float   @default(0)          // 0…1 — integral of demand-weighted dissatisfaction (SP2)
```

Push + reseed:

```bash
npx prisma db push
npx tsx --tsconfig tsconfig.json prisma/seed.ts
```

> `body-gen.ts` already seeds `population = round(popCap × fill)` with `fill ∈ [0.05, 0.9]` (growth headroom) and `demandRate = max(perCapitaNeed × population, MIN_DEMAND)` — both unaffected by the type change. `population` simply stops rounding to an integer.

- [ ] **Step 10: Green the types + suite + sim**

Run: `npx tsc --noEmit` → clean (fix any straggler prosperity reference the table missed — the compiler enumerates them).
Run: `npx vitest run` → all green.
Run: `npm run simulate` → confirm the SP1 targets still hold with the prosperity multiplier gone: per-good stock in `[5, 200]`, real cross-system price dispersion, greedy ≫ random. If throughput shifts a target out of band, note it (calibration knobs `NOISE_AMPLITUDE` / `GOOD_PRODUCTION` coeffs are the levers) — but expect equilibrium to hold since the multiplier scaled both sides equally.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(economy): retire prosperity; population→Float + unrest column (SP2 Part 1 PR1)

Prosperity (a trade-volume proxy for supply response) is fully removed — engine,
constants, economy/trade-flow processors, services, API, hook, and the map
choropleth. SP1 already moved smooth supply response onto population, so the
proxy is redundant. tradeVolumeAccum (read only by prosperity) and its writers
are dropped. Schema: population Int→Float, +unrest Float, −prosperity,
−tradeVolumeAccum; one full reseed. selfLimitingFactor is exported for PR2's
satisfaction signal. The stability overlay returns in PR3 sourced from unrest."
```

## Self-check (PR 1)

- Prosperity gone from engine/constants/economy/trade-flow/services/sim/UI/types/tests → `tsc` clean is the proof. ✓
- `tradeVolumeAccum` has zero remaining writers/readers; column dropped. ✓
- `PLAYER_VOLUME_TARGET` preserves trade-flow displacement behaviour (value unchanged, name decoupled). ✓
- `population Float` + `unrest Float` exist; one reseed done; `selfLimitingFactor` exported. ✓
- Sim still hits SP1 targets. ✓

---

# PR 2 — The consequence loop (measure → accumulate → threshold → effect)

The economy processor reads each system's stored `unrest` to suppress production (strike), then measures per-system convex demand-weighted dissatisfaction `D` from post-tick stock and hands it forward in-memory. A new `population` processor (`dependsOn: economy`, same region scope) integrates `D` into `unrest`, applies logistic growth/decline, and rewrites `demandRate`. Headless — no UI; the simulator is where the loop is observed and coarsely tuned.

## Task 2: Pure population-dynamics engine module

**Files:**
- Create: `lib/engine/population.ts`
- Test: `lib/engine/__tests__/population.test.ts`

**Interfaces:**
- Produces: `dissatisfaction`, `accumulateUnrest`, `strikeMultiplier`, `populationDelta` (+ their param types) — consumed by Tasks 4, 5, 6 and PR 3.

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/population.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { dissatisfaction, accumulateUnrest, strikeMultiplier, populationDelta } from "../population";

describe("dissatisfaction (convex, demand-weighted)", () => {
  it("is 0 when fully satisfied and 0 when nothing is demanded", () => {
    expect(dissatisfaction([{ satisfaction: 1, demanded: 10 }, { satisfaction: 1, demanded: 2 }])).toBeCloseTo(0, 6);
    expect(dissatisfaction([])).toBe(0);
    expect(dissatisfaction([{ satisfaction: 0, demanded: 0 }])).toBe(0);
  });
  it("weights a high-demand good's deficit far above a low-demand good's (~demand share)", () => {
    const foodCut = dissatisfaction([{ satisfaction: 0, demanded: 18 }, { satisfaction: 1, demanded: 2 }]);
    const luxCut = dissatisfaction([{ satisfaction: 1, demanded: 18 }, { satisfaction: 0, demanded: 2 }]);
    expect(foodCut).toBeGreaterThan(luxCut * 5);
  });
  it("convexity: one deep shortage dominates broad shallow tightness", () => {
    const deep = dissatisfaction([{ satisfaction: 0, demanded: 10 }, { satisfaction: 1, demanded: 90 }]);
    const shallow = dissatisfaction([{ satisfaction: 0.9, demanded: 100 }]);
    expect(deep).toBeGreaterThan(shallow);
  });
});

describe("accumulateUnrest", () => {
  it("rises under sustained dissatisfaction, clamps at 1", () => {
    let u = 0;
    for (let i = 0; i < 1000; i++) u = accumulateUnrest(u, 1, { gain: 0.1, decay: 0.05 });
    expect(u).toBeLessThanOrEqual(1);
    expect(u).toBeGreaterThan(0.5);
  });
  it("decays toward 0 when satisfied; one bad tick is nearly harmless", () => {
    let u = 1;
    for (let i = 0; i < 1000; i++) u = accumulateUnrest(u, 0, { gain: 0.1, decay: 0.05 });
    expect(u).toBeCloseTo(0, 2);
    expect(accumulateUnrest(0, 1, { gain: 0.1, decay: 0.05 })).toBeCloseTo(0.1, 6);
  });
});

describe("strikeMultiplier", () => {
  it("is 1 below threshold, ramps smoothly to the floor at unrest = 1", () => {
    expect(strikeMultiplier(0.3, { threshold: 0.5, floorMultiplier: 0.2 })).toBe(1);
    expect(strikeMultiplier(1, { threshold: 0.5, floorMultiplier: 0.2 })).toBeCloseTo(0.2, 6);
    const mid = strikeMultiplier(0.75, { threshold: 0.5, floorMultiplier: 0.2 });
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1);
  });
});

describe("populationDelta (logistic, gated)", () => {
  const p = { growthRate: 0.02, declineRate: 0.02 };
  it("grows when fed + calm, asymptotes at popCap, declines when starved + unstable", () => {
    expect(populationDelta(500, 1000, 0, 0, p)).toBeGreaterThan(0);
    expect(populationDelta(1000, 1000, 0, 0, p)).toBeCloseTo(0, 6);
    expect(populationDelta(500, 1000, 0.8, 0.9, p)).toBeLessThan(0);
  });
  it("has no growth term when popCap is 0", () => {
    expect(populationDelta(100, 0, 0, 0, p)).toBeLessThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run lib/engine/__tests__/population.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `lib/engine/population.ts`**

```typescript
/**
 * Pure population-dynamics functions — zero DB dependency.
 *
 * The consequence spine (vision §5.3, §7): measure → accumulate → threshold → effect.
 *  - measure:    dissatisfaction() folds per-good satisfaction into one convex,
 *                demand-weighted number D for a system this tick.
 *  - accumulate: accumulateUnrest() integrates D into the stored unrest property.
 *  - threshold:  strikeMultiplier() derives the production-suppression regime from
 *                unrest — a smooth ramp, not a binary halt. Unrest's own integral
 *                is the hysteresis, so no separate stored strike flag is needed.
 *  - effect:     populationDelta() is the logistic growth/decline term.
 *
 * Each is a small, total function so additions to the spine are new terms, not
 * new branches (the §4 taxonomy is flexible by construction).
 */

import { clamp } from "@/lib/utils/math";

/** One consumed good's signal for a system this tick. */
export interface GoodSatisfaction {
  /** delivered / demanded ∈ [0,1]; 1 = well-fed, 0 = floor-pinned. */
  satisfaction: number;
  /** demanded_g = perCapitaNeed × population — the demand-share weight. */
  demanded: number;
}

/**
 * Convex, demand-weighted dissatisfaction D ∈ [0,1] for one system:
 *   D = Σ_g demandShare_g · (1 − satisfaction_g)²,  demandShare_g = demanded_g / Σ demanded
 * Importance comes from demand magnitude (people need ~8× more food than luxuries),
 * not a separate field; convexity makes a deep shortage dominate many shallow ones.
 * Returns 0 when nothing is demanded.
 */
export function dissatisfaction(goods: GoodSatisfaction[]): number {
  let totalDemand = 0;
  for (const g of goods) totalDemand += Math.max(0, g.demanded);
  if (totalDemand <= 0) return 0;
  let d = 0;
  for (const g of goods) {
    const share = Math.max(0, g.demanded) / totalDemand;
    const gap = 1 - clamp(g.satisfaction, 0, 1);
    d += share * gap * gap;
  }
  return d;
}

export interface UnrestParams {
  /** Gain: how much one run of full dissatisfaction adds to unrest. */
  gain: number;
  /** Decay: fraction of unrest shed per run when satisfied. */
  decay: number;
}

/**
 * Integrate dissatisfaction into unrest (the slow property):
 *   unrest ← clamp(unrest + gain·D − decay·unrest, 0, 1)
 * Catastrophe lives in the integral — one bad tick is harmless, chronic shortage
 * climbs toward 1 over many runs; relief decays it back.
 */
export function accumulateUnrest(unrest: number, d: number, params: UnrestParams): number {
  return clamp(unrest + params.gain * clamp(d, 0, 1) - params.decay * unrest, 0, 1);
}

export interface StrikeParams {
  /** Unrest below this → no suppression (multiplier 1). */
  threshold: number;
  /** Production multiplier at unrest = 1 (deepest strike); e.g. 0.25 = 75% cut. */
  floorMultiplier: number;
}

/**
 * Production-suppression multiplier from unrest ∈ [floorMultiplier, 1] — a smooth
 * ramp (markets drift, never teleport): 1 below threshold, linear to floorMultiplier
 * at unrest = 1. Derived each tick; consumption is never suppressed (people still eat).
 */
export function strikeMultiplier(unrest: number, params: StrikeParams): number {
  if (unrest <= params.threshold) return 1;
  const t = clamp((unrest - params.threshold) / (1 - params.threshold), 0, 1);
  return 1 - t * (1 - params.floorMultiplier);
}

export interface PopulationParams {
  /** Logistic growth rate toward popCap when fully satisfied. */
  growthRate: number;
  /** Decline rate scaled by unrest. */
  declineRate: number;
}

/**
 * Logistic population change for one run (vision §7):
 *   Δpop = growthRate·pop·(1 − pop/popCap)·(1 − D)  −  declineRate·pop·unrest
 * Fed + calm grows toward the hard popCap ceiling then asymptotes (no runaway);
 * starved / unstable net-declines. popCap = 0 yields no growth term.
 */
export function populationDelta(
  population: number,
  popCap: number,
  d: number,
  unrest: number,
  params: PopulationParams,
): number {
  const headroom = popCap > 0 ? Math.max(0, 1 - population / popCap) : 0;
  const satisfactionFactor = clamp(1 - d, 0, 1);
  const growth = params.growthRate * population * headroom * satisfactionFactor;
  const decline = params.declineRate * population * clamp(unrest, 0, 1);
  return growth - decline;
}
```

- [ ] **Step 4: Run + types**

Run: `npx vitest run lib/engine/__tests__/population.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/population.ts lib/engine/__tests__/population.test.ts
git commit -m "feat(economy): pure population-dynamics engine (dissatisfaction/unrest/strike/growth)"
```

## Task 3: Population constants

**Files:**
- Create: `lib/constants/population.ts`

- [ ] **Step 1: Create the constants** (starting values; sim-tuned in Task 6 / PR 3)

```typescript
import type { UnrestParams, StrikeParams, PopulationParams } from "@/lib/engine/population";

/**
 * Unrest integration. Rates are per *population-processor run* — i.e. per economy
 * round-robin visit (~every `regionCount` ticks: 24 default, 60 at 10K), not per
 * game tick. Sim-tuned in PR 2/3 for stable-but-growing.
 */
export const UNREST_PARAMS: UnrestParams = { gain: 0.15, decay: 0.05 };

/** Strike production-suppression regime derived from unrest. Sim-tuned. */
export const STRIKE_PARAMS: StrikeParams = { threshold: 0.5, floorMultiplier: 0.25 };

/** Logistic growth/decline rates (per population-processor run). Sim-tuned. */
export const POPULATION_PARAMS: PopulationParams = { growthRate: 0.02, declineRate: 0.03 };
```

- [ ] **Step 2: Commit**

```bash
git add lib/constants/population.ts
git commit -m "feat(economy): population/unrest/strike tunables"
```

## Task 4: Economy processor — strike suppression + measure D

The economy processor reads stored `unrest` (last tick) to suppress production, then surfaces per-system `D` in-memory. `productionSuppress` re-uses the multiplier slot prosperity vacated, but on **production only**.

**Files:**
- Modify: `lib/engine/tick.ts` (add `productionSuppress` to `TickEntryInput` + `buildMarketTickEntry`)
- Modify: `lib/engine/market-tick-builder.ts` (thread `productionSuppress` through `MarketTickInput`/`resolveMarketTickEntry`)
- Modify: `lib/tick/types.ts` (add `EconomySignals` + `economySignals?` on `TickProcessorResult`)
- Modify: `lib/tick/world/economy-world.ts` (add `getUnrest`; add `strikeParams` to `EconomyProcessorParams`)
- Modify: `lib/tick/adapters/{prisma,memory}/economy.ts` (implement `getUnrest`)
- Modify: `lib/tick/processors/economy.ts` (read unrest → strike → `productionSuppress`; compute + return `D`)
- Modify: `lib/tick/processors/__tests__/trade-flow.test.ts` etc. only if `MarketView` fixtures need `getUnrest` (they don't — separate world)
- Test: `lib/tick/processors/__tests__/integration/economy.integration.test.ts` (pass `strikeParams`; assert strike suppresses production)

**Interfaces:**
- Consumes: `strikeMultiplier`, `dissatisfaction`, `selfLimitingFactor` (Task 2 / PR 1), `STRIKE_PARAMS` (Task 3).
- Produces: `TickProcessorResult.economySignals.dissatisfactionBySystem` — consumed by Task 5.

- [ ] **Step 1: Add `productionSuppress` to the engine builder**

In `lib/engine/tick.ts`, add to `TickEntryInput` (after `traits`):

```typescript
  /** Production-only suppression multiplier (1 = none). Strike state from unrest. */
  productionSuppress?: number;
```

In `buildMarketTickEntry`'s return, multiply production (only) by it:

```typescript
    productionRate: productionRate != null ? productionRate * (input.productionSuppress ?? 1) : undefined,
```

(Leave `consumptionRate` un-multiplied.) In `lib/engine/market-tick-builder.ts`, add `productionSuppress?: number;` to `MarketTickInput`, and pass `productionSuppress: input.productionSuppress` in the `buildMarketTickEntry` call inside `resolveMarketTickEntry`.

- [ ] **Step 2: Add the in-memory handoff type** (`lib/tick/types.ts`)

```typescript
/**
 * Transient economy→population signal, threaded in-memory via `ctx.results`
 * (not broadcast, not persisted — the §4 taxonomy keeps signals transient).
 */
export interface EconomySignals {
  /** Per-system convex demand-weighted dissatisfaction D ∈ [0,1], for systems processed this tick. */
  dissatisfactionBySystem: Map<string, number>;
}
```

Add to `TickProcessorResult`:

```typescript
  /** Transient cross-processor signals (economy → population). Not broadcast. */
  economySignals?: EconomySignals;
```

- [ ] **Step 3: Add `getUnrest` to the economy world + adapters**

In `lib/tick/world/economy-world.ts`, add to `EconomyWorld`:

```typescript
  /** Current unrest (0…1) for the given systems — drives strike suppression. */
  getUnrest(systemIds: string[]): Promise<Map<string, number>>;
```

and add `strikeParams: StrikeParams;` to `EconomyProcessorParams` (import `StrikeParams` from `@/lib/engine/population`).

In `lib/tick/adapters/prisma/economy.ts` (replacing the deleted `getProsperity`):

```typescript
  async getUnrest(systemIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (systemIds.length === 0) return result;
    const rows = await this.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: { id: true, unrest: true },
    });
    for (const r of rows) result.set(r.id, r.unrest);
    return result;
  }
```

In `lib/tick/adapters/memory/economy.ts`:

```typescript
  getUnrest(systemIds: string[]): Promise<Map<string, number>> {
    const ids = new Set(systemIds);
    const result = new Map<string, number>();
    for (const s of this.systems) if (ids.has(s.id)) result.set(s.id, s.unrest);
    return Promise.resolve(result);
  }
```

- [ ] **Step 4: Wire strike + D into the processor body** (`lib/tick/processors/economy.ts`)

Add imports to `lib/tick/processors/economy.ts`: `import { simulateEconomyTick, selfLimitingFactor } from "@/lib/engine/tick";` (the file already imports `simulateEconomyTick` from there — add `selfLimitingFactor` alongside it), `import { dissatisfaction, strikeMultiplier, type GoodSatisfaction } from "@/lib/engine/population";`, `import { STRIKE_PARAMS } from "@/lib/constants/population";`, `import type { EconomySignals } from "@/lib/tick/types";`. Destructure `strikeParams` from `params` (or reference `params.strikeParams`).

After `const systemIds = [...]` and the modifier indexing, read unrest and build resolved entries with strike:

```typescript
  const unrestBySystem = await world.getUnrest(systemIds);

  const resolved = markets.map((m) =>
    resolveMarketTickEntry({
      goodId: m.goodId,
      stock: m.stock,
      baseProductionRate: m.baseProductionRate,
      baseConsumptionRate: m.baseConsumptionRate,
      govDef: GOVERNMENT_TYPES[m.governmentType] ?? undefined,
      traits: m.traits,
      productionSuppress: strikeMultiplier(unrestBySystem.get(m.systemId) ?? 0, params.strikeParams),
      modifiers: modifiersBySystem.get(m.systemId) ?? [],
      modifierCaps,
    }),
  );

  const tickEntries: MarketTickEntry[] = resolved.map((r) => r.entry);
  const simulated = simulateEconomyTick(tickEntries, simParams, rng);

  const marketUpdates: MarketUpdate[] = markets.map((m, i) => ({
    id: m.id, stock: simulated[i].stock, anchorMult: resolved[i].anchorMult,
  }));
  await world.applyMarketUpdates(marketUpdates);

  // Measure per-system convex demand-weighted dissatisfaction D from post-tick stock.
  // satisfaction_g = the consume self-limiting factor = sqrt((stock−min)/range).
  const goodsBySystem = new Map<string, GoodSatisfaction[]>();
  markets.forEach((m, i) => {
    const consumptionRate = tickEntries[i].consumptionRate;
    if (consumptionRate == null || consumptionRate <= 0) return;
    const demanded = consumptionRate * (tickEntries[i].consumptionMult ?? 1);
    const satisfaction = selfLimitingFactor(simulated[i].stock, simParams.minLevel, simParams.maxLevel, "consume");
    const arr = goodsBySystem.get(m.systemId) ?? [];
    arr.push({ satisfaction, demanded });
    goodsBySystem.set(m.systemId, arr);
  });
  const dissatisfactionBySystem = new Map<string, number>();
  for (const sysId of systemIds) {
    dissatisfactionBySystem.set(sysId, dissatisfaction(goodsBySystem.get(sysId) ?? []));
  }
  const economySignals: EconomySignals = { dissatisfactionBySystem };
```

Delete the old `applyProsperityUpdates`/prosperity lines (gone in PR 1). Change the `return` to include the signals:

```typescript
  return {
    globalEvents: { economyTick: [{ regionId: targetRegion.id, regionName: targetRegion.name, marketCount: markets.length }] },
    economySignals,
  };
```

Add `strikeParams: STRIKE_PARAMS` to the live wiring's `runEconomyProcessor` params.

- [ ] **Step 5: Update the economy integration test**

In `lib/tick/processors/__tests__/integration/economy.integration.test.ts`, add `strikeParams: STRIKE_PARAMS` to the `runEconomyProcessor` params (import from `@/lib/constants/population`). Add one assertion: seed a system's `unrest` high (≥ strike threshold), run the processor, and assert that good's production is suppressed (post-tick stock is lower than the same system run at `unrest = 0`). If the test harness's in-memory world doesn't expose `unrest`, set it on the `SimSystem` fixtures (default `unrest: 0`).

- [ ] **Step 6: Run + commit**

Run: `npx vitest run lib/tick/processors/__tests__/integration/economy.integration.test.ts` → PASS. `npx tsc --noEmit` → clean. `npx vitest run` → green.

```bash
git add lib/engine/tick.ts lib/engine/market-tick-builder.ts lib/tick/types.ts \
  lib/tick/world/economy-world.ts lib/tick/adapters/prisma/economy.ts \
  lib/tick/adapters/memory/economy.ts lib/tick/processors/economy.ts \
  lib/tick/processors/__tests__/integration/economy.integration.test.ts
git commit -m "feat(economy): strike production-suppression from unrest + per-system dissatisfaction signal"
```

## Task 5: Population processor + adapters + demandRate rewrite

**Files:**
- Create: `lib/tick/world/population-world.ts`
- Create: `lib/tick/processors/population.ts`
- Create: `lib/tick/adapters/prisma/population.ts`
- Create: `lib/tick/adapters/memory/population.ts`
- Modify: `lib/tick/registry.ts` (register `populationProcessor`)
- Modify: `lib/constants/market-economy.ts` (add `demandRateForGood`; re-point `marketDemandRate` callers)
- Modify: `lib/engine/simulator/types.ts` (`SimSystem` gains `popCap: number`)
- Modify: `lib/engine/simulator/world.ts` (set `popCap: s.popCap`)
- Modify: `prisma/seed.ts`, `lib/engine/simulator/world.ts` (use `demandRateForGood`)
- Test: `lib/tick/processors/__tests__/population.test.ts`

**Interfaces:**
- Consumes: `EconomySignals` (Task 4), `accumulateUnrest`/`populationDelta` (Task 2), `UNREST_PARAMS`/`POPULATION_PARAMS` (Task 3), `demandRateForGood`.
- Produces: `PopulationWorld`, `runPopulationProcessor`, `populationProcessor`.

- [ ] **Step 1: Add `demandRateForGood`** (`lib/constants/market-economy.ts`)

Add (next to `marketDemandRate`, importing `GOOD_CONSUMPTION` from `@/lib/constants/physical-economy` if not already):

```typescript
/**
 * Days-of-supply demand denominator for one good = max(perCapitaNeed × population,
 * MIN_DEMAND). Population-only (consumption ignores the resource vector), so it is
 * the formula the population processor uses to rewrite demandRate as population moves.
 */
export function demandRateForGood(goodId: string, population: number): number {
  const need = GOOD_CONSUMPTION[goodId] ?? 0;
  return Math.max(need * Math.max(0, population), MIN_DEMAND);
}
```

Re-point the two `marketDemandRate(aggregate, population, goodKey)` callers (`prisma/seed.ts:199`, `lib/engine/simulator/world.ts:111`) to `demandRateForGood(goodKey, population)` and delete `marketDemandRate` (its aggregate arg is unused once consumption is the only term). Values are identical, so no reseed is required (the PR 1 reseed already wrote them).

- [ ] **Step 2: `SimSystem` gains `popCap`**

In `lib/engine/simulator/types.ts` add `popCap: number;` to `SimSystem` (after `population`). In `lib/engine/simulator/world.ts` add `popCap: s.popCap,` to the system literal (`s.popCap` exists on the generated system — same source seed uses).

- [ ] **Step 3: Write the failing processor test**

Create `lib/tick/processors/__tests__/population.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runPopulationProcessor } from "../population";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import type { TickContext } from "@/lib/tick/types";
import type { SimMarketEntry, SimSystem } from "@/lib/engine/simulator/types";

const PARAMS = { unrest: { gain: 0.1, decay: 0.05 }, population: { growthRate: 0.02, declineRate: 0.02 } };

function sys(id: string, population: number, popCap: number, unrest = 0): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", governmentType: "federation",
    aggregate: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    population, popCap, unrest, traits: [], bodyDanger: 0,
  };
}
function market(systemId: string, goodId: string): SimMarketEntry {
  return { systemId, goodId, basePrice: 100, stock: 100, anchorMult: 1, demandRate: 1, priceFloor: 10, priceCeiling: 500 };
}
function ctxWithD(d: Map<string, number>): TickContext {
  return { tx: undefined as never, tick: 0, results: new Map([["economy", { economySignals: { dissatisfactionBySystem: d } }]]) };
}

describe("population processor", () => {
  it("grows a fed system and leaves unrest at 0", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.unrest).toBe(0);
    expect(a.population).toBeGreaterThan(500);
  });
  it("raises unrest and rewrites demandRate for a starved system", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 1]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.unrest).toBeGreaterThan(0);
    const m = world.markets.find((mm) => mm.systemId === "a")!;
    expect(m.demandRate).toBeCloseTo(Math.max(0.004 * a.population, 0.05), 5); // food perCapitaNeed × new pop
  });
  it("no-ops when the economy left no signals", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000)], markets: [] });
    const before = world.systems[0].population;
    await runPopulationProcessor(world, { tx: undefined as never, tick: 0, results: new Map() }, PARAMS);
    expect(world.systems[0].population).toBe(before);
  });
});
```

Run: `npx vitest run lib/tick/processors/__tests__/population.test.ts` → FAIL (modules not found).

- [ ] **Step 4: The data interface** (`lib/tick/world/population-world.ts`)

```typescript
/**
 * PopulationWorld — data interface for the population processor.
 *
 * The processor runs over the systems the economy just processed this tick (the
 * round-robin region), reading the dissatisfaction the economy recorded for them.
 * Adapters in `lib/tick/adapters/{prisma,memory}/population.ts` implement this.
 */
export interface PopulationStateView {
  systemId: string;
  population: number;
  popCap: number;
  unrest: number;
}

export interface PopulationUpdate {
  systemId: string;
  population: number;
  unrest: number;
}

export interface PopulationWorld {
  /** population/popCap/unrest for the given systems. */
  getPopulationState(systemIds: string[]): Promise<PopulationStateView[]>;
  /** Bulk-write population + unrest. */
  applyPopulationUpdates(updates: PopulationUpdate[]): Promise<void>;
  /** Recompute demandRate = demandRateForGood(good, population) for those systems' markets. */
  rewriteDemandRates(pops: Array<{ systemId: string; population: number }>): Promise<void>;
}

import type { UnrestParams, PopulationParams } from "@/lib/engine/population";
/** Per-run params (sim and live differ; calibratable). */
export interface PopulationProcessorParams {
  unrest: UnrestParams;
  population: PopulationParams;
}
```

- [ ] **Step 5: The processor body + live wiring** (`lib/tick/processors/population.ts`)

```typescript
import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { accumulateUnrest, populationDelta } from "@/lib/engine/population";
import { UNREST_PARAMS, POPULATION_PARAMS } from "@/lib/constants/population";
import { PrismaPopulationWorld } from "@/lib/tick/adapters/prisma/population";
import type {
  PopulationProcessorParams, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";

/**
 * Pure processor body. Reads the per-system dissatisfaction D the economy
 * processor recorded this tick (via ctx.results), integrates it into unrest,
 * applies logistic growth/decline, and rewrites demandRate for the new
 * population. Scoped to the economy's round-robin region (D's key set), so
 * per-tick work is bounded and the satisfaction signal is fresh.
 */
export async function runPopulationProcessor(
  world: PopulationWorld,
  ctx: TickContext,
  params: PopulationProcessorParams,
): Promise<TickProcessorResult> {
  const signals = ctx.results.get("economy")?.economySignals;
  if (!signals || signals.dissatisfactionBySystem.size === 0) return {};

  const systemIds = [...signals.dissatisfactionBySystem.keys()];
  const states = await world.getPopulationState(systemIds);

  const popUpdates: PopulationUpdate[] = [];
  const demandPops: Array<{ systemId: string; population: number }> = [];
  for (const s of states) {
    const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
    const unrest = accumulateUnrest(s.unrest, d, params.unrest);
    const population = Math.max(0, s.population + populationDelta(s.population, s.popCap, d, unrest, params.population));
    popUpdates.push({ systemId: s.systemId, population, unrest });
    demandPops.push({ systemId: s.systemId, population });
  }

  await world.applyPopulationUpdates(popUpdates);
  await world.rewriteDemandRates(demandPops);
  return {};
}

// ── Live-game wiring ──────────────────────────────────────────────

export const populationProcessor: TickProcessor = {
  name: "population",
  frequency: 1,
  dependsOn: ["economy"],
  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaPopulationWorld(ctx.tx);
    return runPopulationProcessor(world, ctx, { unrest: UNREST_PARAMS, population: POPULATION_PARAMS });
  },
};
```

- [ ] **Step 6: The Prisma adapter** (`lib/tick/adapters/prisma/population.ts`)

```typescript
import type { TxClient } from "@/lib/tick/types";
import type {
  PopulationStateView, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { demandRateForGood } from "@/lib/constants/market-economy";

/**
 * Live-game adapter for the population processor. Bulk writes via unnest() — no
 * per-row writes inside the transaction. demandRate is recomputed adapter-side
 * (it owns the system→market→good join) from each system's new population.
 */
export class PrismaPopulationWorld implements PopulationWorld {
  constructor(private tx: TxClient) {}

  async getPopulationState(systemIds: string[]): Promise<PopulationStateView[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: { id: true, population: true, popCap: true, unrest: true },
    });
    return rows.map((r) => ({ systemId: r.id, population: r.population, popCap: r.popCap, unrest: r.unrest }));
  }

  async applyPopulationUpdates(updates: PopulationUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const ids = updates.map((u) => u.systemId);
    const pops = updates.map((u) => (isFinite(u.population) ? Math.max(0, u.population) : 0));
    const unrests = updates.map((u) => (isFinite(u.unrest) ? Math.max(0, Math.min(1, u.unrest)) : 0));
    await this.tx.$executeRaw`
      UPDATE "StarSystem" AS ss
      SET "population" = batch."population", "unrest" = batch."unrest"
      FROM unnest(${ids}::text[], ${pops}::double precision[], ${unrests}::double precision[])
        AS batch("id", "population", "unrest")
      WHERE ss."id" = batch."id"`;
  }

  async rewriteDemandRates(pops: Array<{ systemId: string; population: number }>): Promise<void> {
    if (pops.length === 0) return;
    const popBySystem = new Map(pops.map((p) => [p.systemId, p.population]));
    const markets = await this.tx.stationMarket.findMany({
      where: { station: { systemId: { in: [...popBySystem.keys()] } } },
      select: { id: true, good: { select: { name: true } }, station: { select: { systemId: true } } },
    });
    const ids: string[] = [];
    const rates: number[] = [];
    for (const m of markets) {
      const population = popBySystem.get(m.station.systemId);
      if (population == null) continue;
      const goodKey = GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name;
      const rate = demandRateForGood(goodKey, population);
      ids.push(m.id);
      rates.push(isFinite(rate) ? rate : 1);
    }
    if (ids.length === 0) return;
    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "demandRate" = batch."rate"
      FROM unnest(${ids}::text[], ${rates}::double precision[])
        AS batch("id", "rate")
      WHERE sm."id" = batch."id"`;
  }
}
```

- [ ] **Step 7: The memory adapter** (`lib/tick/adapters/memory/population.ts`)

```typescript
import type {
  PopulationStateView, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";
import type { SimMarketEntry, SimSystem } from "@/lib/engine/simulator/types";
import { demandRateForGood } from "@/lib/constants/market-economy";

/** In-memory adapter for the population processor (sim + unit tests). */
export class InMemoryPopulationWorld implements PopulationWorld {
  systems: SimSystem[];
  markets: SimMarketEntry[];

  constructor(initial: { systems: SimSystem[]; markets: SimMarketEntry[] }) {
    this.systems = initial.systems.map((s) => ({ ...s }));
    this.markets = initial.markets.map((m) => ({ ...m }));
  }

  getPopulationState(systemIds: string[]): Promise<PopulationStateView[]> {
    const ids = new Set(systemIds);
    const out: PopulationStateView[] = [];
    for (const s of this.systems) {
      if (!ids.has(s.id)) continue;
      out.push({ systemId: s.id, population: s.population, popCap: s.popCap, unrest: s.unrest });
    }
    return Promise.resolve(out);
  }

  applyPopulationUpdates(updates: PopulationUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const bySystem = new Map(updates.map((u) => [u.systemId, u]));
    this.systems = this.systems.map((s) => {
      const u = bySystem.get(s.id);
      if (!u) return s;
      return {
        ...s,
        population: Math.max(0, isFinite(u.population) ? u.population : 0),
        unrest: Math.max(0, Math.min(1, isFinite(u.unrest) ? u.unrest : 0)),
      };
    });
    return Promise.resolve();
  }

  rewriteDemandRates(pops: Array<{ systemId: string; population: number }>): Promise<void> {
    if (pops.length === 0) return Promise.resolve();
    const popBySystem = new Map(pops.map((p) => [p.systemId, p.population]));
    this.markets = this.markets.map((m) => {
      const population = popBySystem.get(m.systemId);
      if (population == null) return m;
      return { ...m, demandRate: demandRateForGood(m.goodId, population) };
    });
    return Promise.resolve();
  }
}
```

- [ ] **Step 8: Register the processor** (`lib/tick/registry.ts`)

Import `populationProcessor` and insert it **after** `economyProcessor` and **before** `tradeFlowProcessor` in the `processors` array (the topo-sort tie-break then runs population before trade-flow; `dependsOn: ["economy"]` enforces the hard constraint regardless).

- [ ] **Step 9: Run the unit test + types**

Run: `npx vitest run lib/tick/processors/__tests__/population.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 10: Commit**

```bash
git add lib/tick/world/population-world.ts lib/tick/processors/population.ts \
  lib/tick/adapters/prisma/population.ts lib/tick/adapters/memory/population.ts \
  lib/tick/registry.ts lib/constants/market-economy.ts \
  lib/engine/simulator/types.ts lib/engine/simulator/world.ts prisma/seed.ts \
  lib/tick/processors/__tests__/population.test.ts
git commit -m "feat(economy): population processor — unrest accumulation, growth/decline, demandRate rewrite"
```

## Task 6: Wire population into the simulator + coarse calibration

**Files:**
- Modify: `lib/engine/simulator/economy.ts` (capture economy's `D`; insert `processSimPopulation`)
- Modify: `lib/engine/simulator/constants.ts` (add a `population` block: `unrest`, `dynamics`, `strike`)
- Modify: `lib/engine/simulator/runner.ts` (snapshot initial population total for the trajectory readout)
- Create: `lib/engine/simulator/population-analysis.ts` (pure summary)
- Modify: `scripts/simulate.ts` (print the population/unrest section)

- [ ] **Step 1: Add a `population` block to `SimConstants`**

In `lib/engine/simulator/constants.ts` import `UNREST_PARAMS`, `STRIKE_PARAMS`, `POPULATION_PARAMS` from `@/lib/constants/population`. Add to the `SimConstants` interface, `SimConstantOverrides`, `buildDefaults`, and `resolveConstants`:

```typescript
  // interface SimConstants:
  population: {
    unrest: { gain: number; decay: number };
    dynamics: { growthRate: number; declineRate: number };
    strike: { threshold: number; floorMultiplier: number };
  };
  // buildDefaults():
    population: {
      unrest: { ...UNREST_PARAMS },
      dynamics: { ...POPULATION_PARAMS },
      strike: { ...STRIKE_PARAMS },
    },
  // SimConstantOverrides: population?: { unrest?: Partial<...>; dynamics?: Partial<...>; strike?: Partial<...> };
  // resolveConstants(): population: {
  //   unrest: { ...base.population.unrest, ...overrides.population?.unrest },
  //   dynamics: { ...base.population.dynamics, ...overrides.population?.dynamics },
  //   strike: { ...base.population.strike, ...overrides.population?.strike },
  // },
```

- [ ] **Step 2: Thread economy `D` and run the population processor** (`lib/engine/simulator/economy.ts`)

Import `runPopulationProcessor` + `InMemoryPopulationWorld` + `EconomySignals`. Change `processSimEconomy` to return both the world and the signals, pass `strikeParams: constants.population.strike` to `runEconomyProcessor`, and add `processSimPopulation`:

```typescript
async function processSimEconomy(
  world: SimWorld, rng: RNG, constants: SimConstants,
): Promise<{ world: SimWorld; signals: EconomySignals | undefined }> {
  const economyWorld = new InMemoryEconomyWorld(
    { systems: world.systems, markets: world.markets, modifiers: world.modifiers },
    world.regions,
  );
  const tickCtx: TickContext = { tx: undefined as never, tick: world.tick, results: new Map() };
  const result = await runEconomyProcessor(economyWorld, tickCtx, {
    rng,
    simParams: buildSimParams(constants),
    strikeParams: constants.population.strike,
    modifierCaps: constants.events.modifierCaps,
  });
  return {
    world: { ...world, systems: economyWorld.systems, markets: economyWorld.markets },
    signals: result.economySignals,
  };
}

async function processSimPopulation(
  world: SimWorld, signals: EconomySignals | undefined, constants: SimConstants,
): Promise<SimWorld> {
  if (!signals) return world;
  const popWorld = new InMemoryPopulationWorld({ systems: world.systems, markets: world.markets });
  const tickCtx: TickContext = {
    tx: undefined as never, tick: world.tick,
    results: new Map([["economy", { economySignals: signals }]]),
  };
  await runPopulationProcessor(popWorld, tickCtx, {
    unrest: constants.population.unrest,
    population: constants.population.dynamics,
  });
  return { ...world, systems: popWorld.systems, markets: popWorld.markets };
}
```

In `simulateWorldTick`, thread them (order: economy → population → trade flow):

```typescript
  const eco = await processSimEconomy(w, rng, ctx.constants);
  w = await processSimPopulation(eco.world, eco.signals, ctx.constants);
  w = await processSimTradeFlow(w, ctx.constants);
```

Update the function's doc comment ("ship arrivals → events → economy → population → trade flow").

- [ ] **Step 3: Population summary tooling** (`lib/engine/simulator/population-analysis.ts`)

```typescript
import type { SimSystem } from "./types";

export interface PopulationSummary {
  totalStart: number;
  totalEnd: number;
  growthPct: number;
  meanUnrest: number;
  maxUnrest: number;
  /** systems within 2% of popCap (saturation watch). */
  saturatedCount: number;
  /** systems with population ≤ 1 (ghost-town watch). */
  emptiedCount: number;
  /** systems with unrest ≥ strikeThreshold (striking). */
  strikingCount: number;
}

export function summarizePopulation(
  systems: SimSystem[], totalStart: number, strikeThreshold: number,
): PopulationSummary {
  let totalEnd = 0, unrestSum = 0, maxUnrest = 0, saturatedCount = 0, emptiedCount = 0, strikingCount = 0;
  for (const s of systems) {
    totalEnd += s.population;
    unrestSum += s.unrest;
    if (s.unrest > maxUnrest) maxUnrest = s.unrest;
    if (s.popCap > 0 && s.population >= s.popCap * 0.98) saturatedCount++;
    if (s.population <= 1) emptiedCount++;
    if (s.unrest >= strikeThreshold) strikingCount++;
  }
  const n = Math.max(1, systems.length);
  return {
    totalStart, totalEnd,
    growthPct: totalStart > 0 ? ((totalEnd - totalStart) / totalStart) * 100 : 0,
    meanUnrest: unrestSum / n, maxUnrest, saturatedCount, emptiedCount, strikingCount,
  };
}
```

- [ ] **Step 4: Capture initial population + print the summary**

In `lib/engine/simulator/runner.ts`, before the tick loop, snapshot `const initialPopulationTotal = world.systems.reduce((sum, s) => sum + s.population, 0);` and thread it into the returned run result (add a field). In `scripts/simulate.ts`, after the market-health section, compute and print `summarizePopulation(finalWorld.systems, initialPopulationTotal, constants.population.strike.threshold)` as a small table (Total start/end, Growth %, Mean/Max unrest, Saturated, Emptied, Striking).

> If `runner.ts` doesn't already return the final `world`, add it to the run result so `simulate.ts` can read `world.systems`.

- [ ] **Step 5: Coarse calibration loop (run-observe-adjust, not TDD)**

Run: `npm run simulate`. Read the new population section. Tune `lib/constants/population.ts` toward **stable-but-growing**:
- **Growth %** mildly positive over 500 ticks (a viable core grows), not explosive (saturation) or negative (collapse). Lever: `POPULATION_PARAMS.growthRate` / `declineRate`.
- **Mean unrest** low (well-supplied systems calm); **Max unrest** elevated only on genuinely starved systems. Levers: `UNREST_PARAMS.gain`/`decay`.
- **Striking count** small and localized (not universal). Lever: `STRIKE_PARAMS.threshold`.
- **Emptied / Saturated** counts small. A few ghost towns on resource-awkward faction territories are *success* (§2 viability); universal emptying or universal saturation is failure.
- The SP1 economy targets still hold (stocks `[5,200]`, dispersion, greedy ≫ random) — now with `demandRate` tracking population.

Remember the cadence: unrest/population update once per `regionCount` ticks (~24 default), so coefficients are per-visit, not per-tick. Coarse only — do not chase geography (that's PR 3's migration + SP3's build space).

- [ ] **Step 6: Commit**

```bash
git add lib/engine/simulator/economy.ts lib/engine/simulator/constants.ts \
  lib/engine/simulator/runner.ts lib/engine/simulator/population-analysis.ts \
  scripts/simulate.ts lib/constants/population.ts
git commit -m "feat(economy): simulate dynamic population + unrest; coarse stable-but-growing calibration"
```

## Self-check (PR 2)

- Economy reads unrest → strike-suppresses production (smooth) → measures convex demand-weighted `D` → hands it forward in-memory. ✓ (Task 4)
- Population processor integrates `D`→unrest, logistic growth/decline, rewrites `demandRate`; region-scoped; `dependsOn economy`. ✓ (Task 5)
- One-tick feedback loop (unrest written this tick suppresses production next visit), all bounded per tick. ✓
- Sim models population dynamics; coarse-calibrated stable-but-growing; SP1 targets hold. ✓ (Task 6)
- No UI yet (stability overlay is PR 3). Population is `Float` end-to-end; `demandRate` tracks population. ✓

---

# PR 3 — Migration, stable-but-growing calibration, stability UI

Migration relocates existing population (conserved) along the **same** de-regioned intra-faction topology as goods — a trade-flow twin: a work-budget edge-slice, attractiveness gradient (contentment + headroom), distance-attenuated (gateways throttle like goods; a gateway-preferred-migration term is a deliberate future addition). Then the full stable-but-growing calibration, and the map's stability overlay sourced from `unrest`.

## Task 7: Pure migration engine module

**Files:**
- Create: `lib/engine/migration.ts`
- Test: `lib/engine/__tests__/migration.test.ts`

**Interfaces:**
- Produces: `migrationAttractiveness`, `migrationFlow` (+ param types) — consumed by Task 9.

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/migration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { migrationAttractiveness, migrationFlow } from "../migration";

const W = { contentment: 1, headroom: 1 };
const FLOW = { weights: W, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1 };

describe("migrationAttractiveness", () => {
  it("rises with contentment (low unrest) and with headroom", () => {
    expect(migrationAttractiveness({ unrest: 0, population: 0, popCap: 1000 }, W))
      .toBeGreaterThan(migrationAttractiveness({ unrest: 1, population: 0, popCap: 1000 }, W));
    expect(migrationAttractiveness({ unrest: 0, population: 100, popCap: 1000 }, W))
      .toBeGreaterThan(migrationAttractiveness({ unrest: 0, population: 1000, popCap: 1000 }, W));
  });
});

describe("migrationFlow", () => {
  it("moves people toward the calmer, roomier neighbour", () => {
    const a = { unrest: 0.9, population: 1000, popCap: 1000 };
    const b = { unrest: 0.0, population: 100, popCap: 1000 };
    const { fromIsA, quantity } = migrationFlow(a, b, 10, FLOW);
    expect(fromIsA).toBe(true);
    expect(quantity).toBeGreaterThan(0);
  });
  it("caps at the destination's headroom (conserved, no overflow)", () => {
    const a = { unrest: 0.9, population: 1000, popCap: 1000 };
    const b = { unrest: 0.0, population: 995, popCap: 1000 };
    expect(migrationFlow(a, b, 10, FLOW).quantity).toBeLessThanOrEqual(5);
  });
  it("moves less over a costlier jump", () => {
    const a = { unrest: 0.9, population: 1000, popCap: 1000 };
    const b = { unrest: 0.0, population: 100, popCap: 1000 };
    expect(migrationFlow(a, b, 1, FLOW).quantity).toBeGreaterThan(migrationFlow(a, b, 100, FLOW).quantity);
  });
  it("no flow below the gradient threshold", () => {
    const a = { unrest: 0.5, population: 1000, popCap: 1000 };
    expect(migrationFlow(a, { ...a }, 10, FLOW).quantity).toBe(0);
  });
});
```

Run: `npx vitest run lib/engine/__tests__/migration.test.ts` → FAIL.

- [ ] **Step 2: Implement `lib/engine/migration.ts`**

```typescript
/**
 * Pure migration functions — zero DB dependency. Population flows down-unrest /
 * up-headroom along the unified intra-faction topology (the same open edges as
 * goods diffusion, §8), distance-attenuated. Conserved: migration relocates,
 * never creates/destroys (that is growth/decline). Attractiveness is a data-driven
 * weighted sum, so future appeal terms (amenities, gateway bias, destination
 * prosperity) are additive entries — the §4 taxonomy, applied to migration.
 */

import { clamp } from "@/lib/utils/math";

export interface MigrationNode {
  unrest: number;       // 0…1
  population: number;
  popCap: number;
}

export interface AttractivenessWeights {
  /** Weight on contentment (1 − unrest) — "how happy is the destination". */
  contentment: number;
  /** Weight on relative headroom ((popCap − pop)/popCap) — "is there room". */
  headroom: number;
}

/**
 * Migration appeal of a system — a weighted sum of contentment (1 − unrest) and
 * relative headroom. The extension slot for future appeal terms.
 */
export function migrationAttractiveness(node: MigrationNode, weights: AttractivenessWeights): number {
  const contentment = 1 - clamp(node.unrest, 0, 1);
  const headroom = node.popCap > 0 ? clamp((node.popCap - node.population) / node.popCap, 0, 1) : 0;
  return weights.contentment * contentment + weights.headroom * headroom;
}

export interface MigrationFlowParams {
  weights: AttractivenessWeights;
  /** Max fraction of the source population that may leave per run. */
  maxOutflowFraction: number;
  /** Appeal-gradient threshold below which no one moves. */
  gradientThreshold: number;
  /** Distance attenuation: factor = 1/(1 + distanceDecay·fuelCost). */
  distanceDecay: number;
}

/**
 * Population moved across one edge this run (≥ 0), from the less-attractive
 * endpoint toward the more-attractive one. Conserved; capped by the source
 * outflow fraction and the destination's headroom; distance-attenuated. The
 * caller resolves from/to from `fromIsA` and applies ±quantity.
 */
export function migrationFlow(
  a: MigrationNode, b: MigrationNode, fuelCost: number, params: MigrationFlowParams,
): { fromIsA: boolean; quantity: number } {
  const gradient = migrationAttractiveness(b, params.weights) - migrationAttractiveness(a, params.weights);
  if (Math.abs(gradient) < params.gradientThreshold) return { fromIsA: true, quantity: 0 };

  const fromIsA = gradient > 0; // flow toward the more attractive endpoint
  const source = fromIsA ? a : b;
  const dest = fromIsA ? b : a;

  const distanceFactor = 1 / (1 + params.distanceDecay * fuelCost);
  const outflow = source.population * params.maxOutflowFraction * Math.abs(gradient) * distanceFactor;
  const destHeadroom = Math.max(0, dest.popCap - dest.population);
  const quantity = Math.max(0, Math.min(outflow, source.population, destHeadroom));
  return { fromIsA, quantity };
}
```

Run: `npx vitest run lib/engine/__tests__/migration.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/engine/migration.ts lib/engine/__tests__/migration.test.ts
git commit -m "feat(economy): pure migration engine (attractiveness gradient + conserved edge flow)"
```

## Task 8: Extract the shared open-edge topology source (DRY)

Migration needs the **same** faction-bounded open-edge list as trade-flow. Extract the cached builder so both consume one source + one cache.

**Files:**
- Create: `lib/services/topology.ts`
- Modify: `lib/tick/adapters/prisma/trade-flow.ts` (delegate `getOpenEdges` to the service; drop its local cache)
- Modify: `lib/services/adjacency.ts` (import + call the renamed invalidation)
- Test: `lib/services/__tests__/topology.test.ts` (optional — the existing trade-flow tests already cover `buildOpenEdges`; add only if convenient)

- [ ] **Step 1: Create `lib/services/topology.ts`**

```typescript
import type { TxClient } from "@/lib/tick/types";
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";
import { getSystemFactionMap } from "@/lib/services/adjacency";

/**
 * Cached faction-bounded open-edge list (both endpoints share a faction; adjacent
 * independents via null===null), deduped + sorted by "${a}|${b}". The connection
 * graph + faction assignments are static after seed, so build once per process.
 * Shared by the trade-flow and migration processors — one topology, one cache.
 */
let cachedOpenEdges: EdgeView[] | null = null;

export async function getOpenEdges(tx: TxClient): Promise<EdgeView[]> {
  if (cachedOpenEdges) return cachedOpenEdges;
  const sysFaction = await getSystemFactionMap();
  const conns = await tx.systemConnection.findMany({
    select: { fromSystemId: true, toSystemId: true, fuelCost: true },
  });
  cachedOpenEdges = buildOpenEdges(conns, sysFaction);
  return cachedOpenEdges;
}

export function invalidateOpenEdgeCache(): void {
  cachedOpenEdges = null;
}
```

- [ ] **Step 2: Delegate from the trade-flow adapter**

In `lib/tick/adapters/prisma/trade-flow.ts`, delete the local `cachedOpenEdges` + `getOpenEdgesCached` (and the prior `invalidateTradeFlowEdgeCache` if it lived here) and make the class method delegate:

```typescript
import { getOpenEdges as getOpenEdgesShared } from "@/lib/services/topology";
// ...
  getOpenEdges(): Promise<EdgeView[]> {
    return getOpenEdgesShared(this.tx);
  }
```

In `lib/services/adjacency.ts`, replace the `invalidateTradeFlowEdgeCache()` import + call inside `invalidateAdjacencyCache()` with `invalidateOpenEdgeCache()` from `@/lib/services/topology`.

- [ ] **Step 3: Run + commit**

Run: `npx vitest run` → green (trade-flow tests still pass — same topology). `npx tsc --noEmit` → clean.

```bash
git add lib/services/topology.ts lib/tick/adapters/prisma/trade-flow.ts lib/services/adjacency.ts
git commit -m "refactor(economy): extract shared open-edge topology source (trade-flow + migration)"
```

## Task 9: Migration processor + adapters

**Files:**
- Create: `lib/tick/world/migration-world.ts`
- Create: `lib/tick/processors/migration.ts`
- Create: `lib/tick/adapters/prisma/migration.ts`
- Create: `lib/tick/adapters/memory/migration.ts`
- Modify: `lib/constants/population.ts` (add `MIGRATION_PARAMS`, `MIGRATION_EDGES_PER_TICK`)
- Modify: `lib/tick/registry.ts` (register `migrationProcessor`)
- Test: `lib/tick/processors/__tests__/migration.test.ts`

**Interfaces:**
- Consumes: `migrationFlow` (Task 7), `getOpenEdges` (Task 8), `buildOpenEdges` (Part 0), `EdgeView`.
- Produces: `MigrationWorld`, `runMigrationProcessor`, `migrationProcessor`.

- [ ] **Step 1: Constants** (`lib/constants/population.ts`, append)

```typescript
import type { MigrationFlowParams } from "@/lib/engine/migration";

/**
 * Migration over the de-regioned intra-faction topology (same open edges + work-
 * budget slice as trade-flow). Gateways throttle like goods (high fuelCost → strong
 * distance attenuation); a gateway-preferred-migration term is a deliberate future
 * addition, not SP2. Sim-tuned for stable-but-growing (no ping-pong).
 */
export const MIGRATION_PARAMS: MigrationFlowParams = {
  weights: { contentment: 1, headroom: 1 },
  maxOutflowFraction: 0.05,
  gradientThreshold: 0.02,
  distanceDecay: 0.1, // matches TRADE_SIMULATION.DISTANCE_DECAY (shared topology)
};
/** Work-budget slice for migration — mirrors TRADE_SIMULATION.EDGES_PER_TICK. */
export const MIGRATION_EDGES_PER_TICK = 256;
```

- [ ] **Step 2: Write the failing processor test** (`lib/tick/processors/__tests__/migration.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { runMigrationProcessor } from "../migration";
import { InMemoryMigrationWorld } from "@/lib/tick/adapters/memory/migration";
import type { TickContext } from "@/lib/tick/types";
import type { SimConnection, SimSystem } from "@/lib/engine/simulator/types";

const PARAMS = {
  edgesPerTick: 100,
  flow: { weights: { contentment: 1, headroom: 1 }, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1 },
};

function sys(id: string, factionId: string | null, population: number, popCap: number, unrest: number): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId, governmentType: "federation",
    aggregate: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    population, popCap, unrest, traits: [], bodyDanger: 0,
  };
}
const conn = (a: string, b: string, fuelCost = 10): SimConnection => ({ fromSystemId: a, toSystemId: b, fuelCost });
const ctx = (tick: number): TickContext => ({ tx: undefined as never, tick, results: new Map() });

describe("migration processor", () => {
  it("relocates population from a tense full system to a calm roomy neighbour, conserved", async () => {
    const systems = [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f1", 100, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    const before = world.systems.reduce((s, x) => s + x.population, 0);
    await runMigrationProcessor(world, ctx(0), PARAMS);
    expect(world.systems.find((s) => s.id === "a")!.population).toBeLessThan(1000);
    expect(world.systems.find((s) => s.id === "b")!.population).toBeGreaterThan(100);
    expect(world.systems.reduce((s, x) => s + x.population, 0)).toBeCloseTo(before, 5);
  });
  it("does not migrate across a faction border", async () => {
    const systems = [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f2", 100, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    await runMigrationProcessor(world, ctx(0), PARAMS);
    expect(world.systems.find((s) => s.id === "a")!.population).toBe(1000);
  });
});
```

Run: `npx vitest run lib/tick/processors/__tests__/migration.test.ts` → FAIL.

- [ ] **Step 3: The data interface** (`lib/tick/world/migration-world.ts`)

```typescript
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import type { MigrationFlowParams } from "@/lib/engine/migration";

export interface MigrationNodeView { systemId: string; population: number; popCap: number; unrest: number; }
/** Signed population change for one system (Σ over a run = 0 — conserved). */
export interface MigrationDelta { systemId: string; delta: number; }

export interface MigrationWorld {
  /** Faction-bounded open edges (same source as trade-flow), stably ordered. */
  getOpenEdges(): Promise<EdgeView[]>;
  /** population/popCap/unrest for the sliced systems. */
  getNodesForSystems(systemIds: string[]): Promise<MigrationNodeView[]>;
  /** Apply signed population deltas (population += delta, floored at 0). */
  applyMigrationDeltas(deltas: MigrationDelta[]): Promise<void>;
}

export interface MigrationProcessorParams {
  /** Work-budget slice size: edges processed per tick (bounds per-tick DB work). */
  edgesPerTick: number;
  flow: MigrationFlowParams;
}
```

- [ ] **Step 4: The processor body + live wiring** (`lib/tick/processors/migration.ts`)

```typescript
import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { migrationFlow, type MigrationNode } from "@/lib/engine/migration";
import { MIGRATION_PARAMS, MIGRATION_EDGES_PER_TICK } from "@/lib/constants/population";
import { PrismaMigrationWorld } from "@/lib/tick/adapters/prisma/migration";
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import type {
  MigrationDelta, MigrationProcessorParams, MigrationWorld,
} from "@/lib/tick/world/migration-world";

/**
 * Pure processor body — a trade-flow twin for people. A work-budget slice of the
 * same faction-bounded open edges; population flows toward the more attractive
 * (calmer, roomier) endpoint, distance-attenuated, conserved. Deltas compose
 * across edges within the tick so a hub touched by several edges nets correctly.
 */
export async function runMigrationProcessor(
  world: MigrationWorld,
  ctx: TickContext,
  params: MigrationProcessorParams,
): Promise<TickProcessorResult> {
  const edges = await world.getOpenEdges();
  if (edges.length === 0) return {};

  const total = edges.length;
  const count = Math.min(params.edgesPerTick, total);
  const start = (ctx.tick * params.edgesPerTick) % total;
  const slice: EdgeView[] = [];
  for (let i = 0; i < count; i++) slice.push(edges[(start + i) % total]);

  const systemIds = new Set<string>();
  for (const e of slice) { systemIds.add(e.aSystemId); systemIds.add(e.bSystemId); }
  const nodes = await world.getNodesForSystems([...systemIds]);
  const nodeById = new Map(nodes.map((n) => [n.systemId, n]));

  // Local per-tick population deltas, so several edges touching one system compose.
  const popDelta = new Map<string, number>();
  const liveNode = (id: string): MigrationNode | null => {
    const n = nodeById.get(id);
    if (!n) return null;
    return { unrest: n.unrest, population: n.population + (popDelta.get(id) ?? 0), popCap: n.popCap };
  };

  for (const edge of slice) {
    const a = liveNode(edge.aSystemId);
    const b = liveNode(edge.bSystemId);
    if (!a || !b) continue;
    const { fromIsA, quantity } = migrationFlow(a, b, edge.fuelCost, params.flow);
    if (quantity <= 0) continue;
    const fromId = fromIsA ? edge.aSystemId : edge.bSystemId;
    const toId = fromIsA ? edge.bSystemId : edge.aSystemId;
    popDelta.set(fromId, (popDelta.get(fromId) ?? 0) - quantity);
    popDelta.set(toId, (popDelta.get(toId) ?? 0) + quantity);
  }

  const deltas: MigrationDelta[] = [];
  for (const [systemId, delta] of popDelta) if (delta !== 0) deltas.push({ systemId, delta });
  if (deltas.length > 0) await world.applyMigrationDeltas(deltas);
  return {};
}

// ── Live-game wiring ──────────────────────────────────────────────

export const migrationProcessor: TickProcessor = {
  name: "migration",
  frequency: 1,
  dependsOn: ["population"],
  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaMigrationWorld(ctx.tx);
    return runMigrationProcessor(world, ctx, { edgesPerTick: MIGRATION_EDGES_PER_TICK, flow: MIGRATION_PARAMS });
  },
};
```

> **demandRate lag (documented, accepted):** migration changes `population` but not `demandRate`; a migration-grown system's pricing denominator catches up on its next economy/population visit (≤ `regionCount` ticks). Consumption itself auto-scales (the live adapter reads `population`), so only pricing lags — within the one-tick-ish drift tolerance.

- [ ] **Step 5: The Prisma adapter** (`lib/tick/adapters/prisma/migration.ts`)

```typescript
import type { TxClient } from "@/lib/tick/types";
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import type {
  MigrationDelta, MigrationNodeView, MigrationWorld,
} from "@/lib/tick/world/migration-world";
import { getOpenEdges } from "@/lib/services/topology";

/** Live-game adapter for the migration processor. Bulk writes via unnest(). */
export class PrismaMigrationWorld implements MigrationWorld {
  constructor(private tx: TxClient) {}

  getOpenEdges(): Promise<EdgeView[]> {
    return getOpenEdges(this.tx);
  }

  async getNodesForSystems(systemIds: string[]): Promise<MigrationNodeView[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: { id: true, population: true, popCap: true, unrest: true },
    });
    return rows.map((r) => ({ systemId: r.id, population: r.population, popCap: r.popCap, unrest: r.unrest }));
  }

  async applyMigrationDeltas(deltas: MigrationDelta[]): Promise<void> {
    if (deltas.length === 0) return;
    const ids = deltas.map((d) => d.systemId);
    const amounts = deltas.map((d) => (isFinite(d.delta) ? d.delta : 0));
    await this.tx.$executeRaw`
      UPDATE "StarSystem" AS ss
      SET "population" = GREATEST(0, ss."population" + batch."delta")
      FROM unnest(${ids}::text[], ${amounts}::double precision[])
        AS batch("id", "delta")
      WHERE ss."id" = batch."id"`;
  }
}
```

- [ ] **Step 6: The memory adapter** (`lib/tick/adapters/memory/migration.ts`)

```typescript
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import type {
  MigrationDelta, MigrationNodeView, MigrationWorld,
} from "@/lib/tick/world/migration-world";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";
import type { SimConnection, SimSystem } from "@/lib/engine/simulator/types";

/**
 * In-memory adapter for the migration processor (sim + unit tests). Open edges
 * are built from the same faction-bounded topology helper as trade-flow.
 */
export class InMemoryMigrationWorld implements MigrationWorld {
  systems: SimSystem[];
  private openEdgesCache: EdgeView[] | null = null;

  constructor(
    initial: { systems: SimSystem[] },
    private readonly connections: SimConnection[],
  ) {
    this.systems = initial.systems.map((s) => ({ ...s }));
  }

  getOpenEdges(): Promise<EdgeView[]> {
    if (this.openEdgesCache) return Promise.resolve(this.openEdgesCache);
    const sysFaction = new Map(this.systems.map((s) => [s.id, s.factionId]));
    this.openEdgesCache = buildOpenEdges(this.connections, sysFaction);
    return Promise.resolve(this.openEdgesCache);
  }

  getNodesForSystems(systemIds: string[]): Promise<MigrationNodeView[]> {
    const ids = new Set(systemIds);
    const out: MigrationNodeView[] = [];
    for (const s of this.systems) {
      if (!ids.has(s.id)) continue;
      out.push({ systemId: s.id, population: s.population, popCap: s.popCap, unrest: s.unrest });
    }
    return Promise.resolve(out);
  }

  applyMigrationDeltas(deltas: MigrationDelta[]): Promise<void> {
    if (deltas.length === 0) return Promise.resolve();
    const bySystem = new Map<string, number>();
    for (const d of deltas) bySystem.set(d.systemId, (bySystem.get(d.systemId) ?? 0) + (isFinite(d.delta) ? d.delta : 0));
    this.systems = this.systems.map((s) => {
      const delta = bySystem.get(s.id);
      if (delta == null) return s;
      return { ...s, population: Math.max(0, s.population + delta) };
    });
    return Promise.resolve();
  }
}
```

- [ ] **Step 7: Register** (`lib/tick/registry.ts`)

Import `migrationProcessor` and insert it after `populationProcessor` (it has `dependsOn: ["population"]`).

- [ ] **Step 8: Run + commit**

Run: `npx vitest run lib/tick/processors/__tests__/migration.test.ts` → PASS. `npx tsc --noEmit` → clean. `npx vitest run` → green.

```bash
git add lib/tick/world/migration-world.ts lib/tick/processors/migration.ts \
  lib/tick/adapters/prisma/migration.ts lib/tick/adapters/memory/migration.ts \
  lib/constants/population.ts lib/tick/registry.ts \
  lib/tick/processors/__tests__/migration.test.ts
git commit -m "feat(economy): migration processor — conserved population flow on the unified topology"
```

## Task 10: Wire migration into the simulator + stable-but-growing calibration

**Files:**
- Modify: `lib/engine/simulator/economy.ts` (insert `processSimMigration` after population)
- Modify: `lib/engine/simulator/constants.ts` (add a `migration` block)
- Modify: `lib/engine/simulator/population-analysis.ts` (add a ping-pong detector)
- Modify: `lib/engine/simulator/runner.ts`, `scripts/simulate.ts` (population snapshots + ping-pong readout)

- [ ] **Step 1: Sim `migration` constants** (`lib/engine/simulator/constants.ts`)

Add a `migration` block to `SimConstants`/`SimConstantOverrides`/`buildDefaults`/`resolveConstants`, defaults from `MIGRATION_PARAMS` + `MIGRATION_EDGES_PER_TICK`:

```typescript
  // interface SimConstants:
  migration: {
    edgesPerTick: number;
    weights: { contentment: number; headroom: number };
    maxOutflowFraction: number;
    gradientThreshold: number;
    distanceDecay: number;
  };
  // buildDefaults():
    migration: {
      edgesPerTick: MIGRATION_EDGES_PER_TICK,
      weights: { ...MIGRATION_PARAMS.weights },
      maxOutflowFraction: MIGRATION_PARAMS.maxOutflowFraction,
      gradientThreshold: MIGRATION_PARAMS.gradientThreshold,
      distanceDecay: MIGRATION_PARAMS.distanceDecay,
    },
```

- [ ] **Step 2: Run migration in the sim tick** (`lib/engine/simulator/economy.ts`)

Add `processSimMigration` (mirrors `processSimTradeFlow`, using `InMemoryMigrationWorld` + `runMigrationProcessor`), and call it after population in `simulateWorldTick`:

```typescript
async function processSimMigration(world: SimWorld, constants: SimConstants): Promise<SimWorld> {
  const migWorld = new InMemoryMigrationWorld({ systems: world.systems }, world.connections);
  const tickCtx: TickContext = { tx: undefined as never, tick: world.tick, results: new Map() };
  await runMigrationProcessor(migWorld, tickCtx, {
    edgesPerTick: constants.migration.edgesPerTick,
    flow: {
      weights: constants.migration.weights,
      maxOutflowFraction: constants.migration.maxOutflowFraction,
      gradientThreshold: constants.migration.gradientThreshold,
      distanceDecay: constants.migration.distanceDecay,
    },
  });
  return { ...world, systems: migWorld.systems };
}
// simulateWorldTick: ... population → migration → trade flow
  w = await processSimPopulation(eco.world, eco.signals, ctx.constants);
  w = await processSimMigration(w, ctx.constants);
  w = await processSimTradeFlow(w, ctx.constants);
```

- [ ] **Step 3: Ping-pong detector** (`lib/engine/simulator/population-analysis.ts`)

```typescript
/**
 * Migration ping-pong: a system whose population direction reverses many times
 * across snapshots is oscillating (two systems trading the same people). Counts
 * systems with ≥ minReversals sign changes in successive population deltas.
 */
export function detectPingPong(
  snapshots: Array<Map<string, number>>, minReversals = 4,
): number {
  if (snapshots.length < 3) return 0;
  const ids = snapshots[0].keys();
  let count = 0;
  for (const id of ids) {
    let reversals = 0;
    let prevSign = 0;
    for (let i = 1; i < snapshots.length; i++) {
      const delta = (snapshots[i].get(id) ?? 0) - (snapshots[i - 1].get(id) ?? 0);
      const sign = Math.sign(delta);
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) reversals++;
      if (sign !== 0) prevSign = sign;
    }
    if (reversals >= minReversals) count++;
  }
  return count;
}
```

In `runner.ts`, alongside the existing market snapshots (every `SNAPSHOT_INTERVAL`), capture a `Map<systemId, population>` snapshot; thread the array out in the run result. In `scripts/simulate.ts`, print `detectPingPong(populationSnapshots)` in the population section.

- [ ] **Step 4: Full stable-but-growing calibration (run-observe-adjust)**

Run `npm run simulate` and tune `lib/constants/population.ts` (`UNREST_PARAMS`, `STRIKE_PARAMS`, `POPULATION_PARAMS`, `MIGRATION_PARAMS`) against **all** of §10:
- **No total collapse / no instant saturation:** Growth % mildly positive; `emptiedCount`/`saturatedCount` small.
- **No migration ping-pong:** `detectPingPong` count ≈ 0. If it spikes, lower `MIGRATION_PARAMS.maxOutflowFraction` or raise `gradientThreshold` (over-eager flow overshoots and rebounds).
- **Bounded unrest in well-supplied systems; spikes localized** to genuinely starved ones (mean low, max high, striking count small).
- **Localized boomtowns/ghost towns** and isolated non-viable-faction decline are **success** — do not tune them away.
- **Existing economy targets hold:** stocks `[5,200]`, dispersion, greedy ≫ random, now with `demandRate` recomputed as population moves.

Coarse only — SP3 (build space) and SP5 (faction trade) reshape the equilibrium; do not over-fit.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/simulator/economy.ts lib/engine/simulator/constants.ts \
  lib/engine/simulator/population-analysis.ts lib/engine/simulator/runner.ts \
  scripts/simulate.ts lib/constants/population.ts
git commit -m "feat(economy): simulate migration; calibrate SP2 stable-but-growing (no collapse/saturation/ping-pong)"
```

## Task 11: Stability map overlay (unrest-derived)

Re-introduce the choropleth pipeline PR 1 removed, sourced from `unrest` ("same pipeline, new source", §4). Semantics invert: **high unrest = low stability** (hot), low unrest = stable (cool).

**Files:**
- Create: `lib/services/stability.ts`, `app/api/game/systems/stability/route.ts`, `lib/hooks/use-stability.ts`
- Create: `components/map/pixi/layers/stability-territory-layer.ts`, `components/ui/stability-badge.tsx`
- Modify: `lib/types/{game,api}.ts`, `lib/query/keys.ts`, `lib/hooks/use-tick-invalidation.ts`
- Modify: `lib/types/map.ts`, `components/map/map-overlay-controls.tsx`, `components/map/star-map.tsx`, `components/map/pixi/pixi-map-canvas.tsx`

- [ ] **Step 1: Service + types + API + hook** (mirror the deleted prosperity path, source = `unrest`)

`lib/types/game.ts`: `export interface StabilityEntry { systemId: string; unrest: number; }`. `lib/types/api.ts`: `export type StabilityResponse = ApiResponse<{ systems: StabilityEntry[] }>;`. `lib/services/stability.ts`:

```typescript
import { prisma } from "@/lib/prisma";
import type { StabilityEntry } from "@/lib/types/game";

/** Per-system unrest (0…1) for the stability choropleth. */
export async function getStabilityBySystem(): Promise<StabilityEntry[]> {
  const rows = await prisma.starSystem.findMany({ select: { id: true, unrest: true } });
  return rows.map((r) => ({ systemId: r.id, unrest: r.unrest }));
}
```

`app/api/game/systems/stability/route.ts` mirrors the old prosperity route (`requirePlayer` → `getStabilityBySystem` → `NextResponse.json<StabilityResponse>`, `Cache-Control: private, no-cache`). `lib/query/keys.ts`: `stability: ["stability"] as const,`. `lib/hooks/use-stability.ts` mirrors `use-prosperity` (returns `Map<string, number>` of unrest, `enabled: active`). In `lib/hooks/use-tick-invalidation.ts` add `queryClient.invalidateQueries({ queryKey: queryKeys.stability })` on `economyTick` (population moves on the economy tick).

- [ ] **Step 2: Map mode + controls**

`lib/types/map.ts`: add `"stability"` to `MapMode` and `MAP_MODES`. `components/map/map-overlay-controls.tsx`: add the `stability: "Stability"` label and a `StabilityRampLegend` (cool→hot by unrest band: Stable → Tense → Unrest → Strike → Collapse). `components/map/star-map.tsx`: `const stabilityBySystem = useStability(mapMode === "stability");` and pass it down. `components/map/pixi/pixi-map-canvas.tsx`: construct the stability layer + a `mapMode === "stability"` branch feeding it.

- [ ] **Step 3: The territory layer + badge**

Recreate the choropleth layer from the PR-1-deleted prosperity layer's structure (`git show <pre-PR1-commit>:components/map/pixi/layers/prosperity-territory-layer.ts`), renamed `StabilityTerritoryLayer`, consuming a `Map<systemId, unrest>` and colouring per the band ramp below (inverted from prosperity — **low unrest = cool/stable**):

```
unrest < 0.2  → Stable   (cool / green)
unrest < 0.4  → Calm     (teal)
unrest < 0.6  → Tense    (amber)
unrest < 0.8  → Unrest   (orange)
unrest ≥ 0.8  → Strike   (red)
```

`components/ui/stability-badge.tsx` mirrors the deleted `prosperity-badge`, mapping unrest → the band label above (a small pure `stabilityLabel(unrest)` helper local to the badge or in `lib/engine/population.ts`).

- [ ] **Step 4: Run + commit**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → green. `npm run dev` and confirm the Stability overlay renders (hot on starved/striking systems, cool elsewhere).

```bash
git add lib/services/stability.ts app/api/game/systems/stability/route.ts lib/hooks/use-stability.ts \
  components/map/pixi/layers/stability-territory-layer.ts components/ui/stability-badge.tsx \
  lib/types/game.ts lib/types/api.ts lib/query/keys.ts lib/hooks/use-tick-invalidation.ts \
  lib/types/map.ts components/map/map-overlay-controls.tsx components/map/star-map.tsx \
  components/map/pixi/pixi-map-canvas.tsx
git commit -m "feat(map): stability overlay sourced from unrest (replaces the prosperity choropleth)"
```

## Task 12: Docs + retire the plan

**Files:** `docs/active/gameplay/economy.md`, `docs/active/gameplay/system-traits.md`, `docs/active/gameplay/trade-simulation.md`, `docs/active/engineering/tick-engine.md`, `docs/planned/economy-simulation-living-world.md`, `docs/SPEC.md`.

- [ ] **Step 1: Update the active docs**

- `economy.md`: prosperity retired; population is **dynamic** (grows/declines, migrates); `unrest` is the new stored property; `demandRate` recomputed per tick; strike suppresses production. Replace any prosperity prose.
- `system-traits.md`: if it references prosperity/stability, re-point to unrest.
- `trade-simulation.md`: note migration rides the **same** open-edge topology + work-budget slice (one topology, two flows: goods + people); gateways throttle both.
- `tick-engine.md`: add the `population` (`dependsOn economy`) and `migration` (`dependsOn population`) processors to the pipeline/ordering; note the economy→population in-memory `D` handoff.

- [ ] **Step 2: Document the gameplay; defer the "complete" marking to PR 4**

In `docs/planned/economy-simulation-living-world.md`: resolve the §14 open questions inline (gateways: unified, deferred gateway-preference; migration: separate processor; handoff: in-memory `ctx.results`; strike: derived + smooth; no independents). In `docs/SPEC.md`: update the system-interaction map (population dynamics, unrest, strikes, migration; prosperity removed). **Do not** mark Part 1 fully shipped here — the population/stability UI lands in PR 4, so PR 4 marks the sub-project complete.

- [ ] **Step 3: Retire Part 0's stale plan (this plan survives until PR 4)**

Per the `docs/plans/` convention (code-heavy build plans are deleted once the feature ships), delete `docs/plans/sp2-part0-deregion-diffusion.md` (Part 0 shipped; its plan lingered). Leave **this** plan (`sp2-part1-consequence-loop-migration.md`) in place — PR 4's tasks live in it; PR 4 (Part 1's final PR) deletes it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(economy): document dynamic population/unrest/migration; mark SP2 complete (SP2 Part 1)"
```

## Self-check (PR 3)

- Migration relocates population (conserved) on the **same** open-edge topology + work-budget slice as goods, distance-attenuated (gateways throttle), faction borders closed. ✓ (Tasks 7–9)
- Attractiveness = contentment + headroom, data-driven for future terms. ✓
- `D` handoff, strike, growth/decline, migration all calibrated stable-but-growing (no collapse/saturation/ping-pong); SP1 targets hold. ✓ (Task 10)
- Stability UI reads from `unrest`. ✓ (Task 11)
- Migration/stability gameplay docs updated; Part 0's stale plan retired; the SP2-complete marking + this plan's deletion deferred to PR 4. ✓ (Task 12)

---

# PR 4 — Population & stability readouts (system UI)

PR 2 made population/`unrest` dynamic and PR 3 surfaced `unrest` on the **map** (stability choropleth + `StabilityBadge`). But the *numbers* — population magnitude, how close a system is to `popCap`, its `unrest` level, and the demand its inhabitants generate — aren't visible on the **system screen**. This PR adds a dedicated **Population tab** (the social/economic counterpart to the physical Astrography tab) and a stability row on the **Overview**.

**Key boundary (why a new read path, not an extension of `/substrate`):** the physical substrate (sun, bodies, resource aggregate) only changes on reseed, so `useSystemSubstrate` is `staleTime: Infinity` and is **not** tick-invalidated. Population and `unrest` change **every economy tick**, so they need a *separate* read path that **is** tick-invalidated. Folding per-tick fields into the static `/substrate` endpoint would either serve stale data or force `/substrate` to lose its `Infinity` cache. Static metadata and changing data get separate read paths, cached by change cadence.

**Ordering:** lands **after** PR 3 — it reuses PR 3's `StabilityBadge` (and its `unrest → band` thresholds) so the tab/overview and the map choropleth agree. No schema change.

**Scope (locked in brainstorming, 2026-06-19):** Population tab + Overview stability row. **Deferred** to a later pass: a population **trend/sparkline** (needs time-series storage we don't have) and surfacing population/stability on the **map quick-detail panel** (`components/map/system-detail-panel.tsx`).

### Shared contracts (PR 4)

```typescript
// lib/types/api.ts
/** One good's per-tick demand from this system's population (drives StationMarket.demandRate). */
export interface PopulationDemandEntry { goodId: string; goodName: string; demandRate: number; }

/** Dynamic population & social state for one system — discriminated on fog-of-war visibility. */
export type SystemPopulationData =
  | {
      visibility: "visible";
      population: number;     // Float magnitude
      popCap: number;
      unrest: number;         // 0…1
      striking: boolean;      // unrest ≥ STRIKE_PARAMS.threshold (production suppressed)
      demand: PopulationDemandEntry[];  // top consumed goods, descending by demandRate
    }
  | { visibility: "unknown" };
export type SystemPopulationResponse = ApiResponse<SystemPopulationData>;

// lib/constants/market-economy.ts
export function demandFootprint(population: number): Array<{ goodId: string; demandRate: number }>;

// lib/hooks/use-system-population.ts
export function useSystemPopulation(systemId: string): SystemPopulationData;
```

Consumes from PR 3: `StabilityBadge` (`components/ui/stability-badge.tsx`) — a component taking `unrest: number` and rendering the band label (Stable → Tense → Unrest → Strike → Collapse). If PR 3's badge prop differs, adapt the two call sites (Task 16/17) — that is the only PR 3 coupling.

## Task 13: `demandFootprint` pure helper

**Files:**
- Modify: `lib/constants/market-economy.ts`
- Test: `lib/constants/__tests__/market-economy.test.ts` (exists)

**Interfaces:**
- Consumes: `demandRateForGood`, `MIN_DEMAND`, `GOOD_CONSUMPTION` (all already in `market-economy.ts` / imported there).
- Produces: `demandFootprint(population)` — consumed by Task 14.

- [ ] **Step 1: Write the failing test**

Append to `lib/constants/__tests__/market-economy.test.ts` (import `demandFootprint` + `MIN_DEMAND` + `demandRateForGood` from `../market-economy`):

```typescript
describe("demandFootprint", () => {
  it("lists consumed goods descending by demand, scaled by population", () => {
    const f = demandFootprint(10_000);
    expect(f.length).toBeGreaterThan(0);
    for (let i = 1; i < f.length; i++) {
      expect(f[i - 1].demandRate).toBeGreaterThanOrEqual(f[i].demandRate);
    }
    expect(f[0].demandRate).toBeCloseTo(demandRateForGood(f[0].goodId, 10_000), 6);
    // water/food carry the highest per-capita need (0.004), so they lead at scale.
    expect(["water", "food"]).toContain(f[0].goodId);
  });
  it("floors every good at MIN_DEMAND for a zero population", () => {
    expect(demandFootprint(0).every((e) => e.demandRate === MIN_DEMAND)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run lib/constants/__tests__/market-economy.test.ts` → FAIL (`demandFootprint` not exported).

- [ ] **Step 3: Implement**

Add to `lib/constants/market-economy.ts` (next to `demandRateForGood`):

```typescript
/**
 * Per-good demand a population of this size generates, descending by magnitude —
 * the consumption footprint that drives each market's demandRate. Only goods with
 * a positive per-capita need appear; each entry equals demandRateForGood (so it
 * floors at MIN_DEMAND). Pure, population-only — matches demandRateForGood.
 */
export function demandFootprint(population: number): Array<{ goodId: string; demandRate: number }> {
  return Object.keys(GOOD_CONSUMPTION)
    .filter((goodId) => GOOD_CONSUMPTION[goodId] > 0)
    .map((goodId) => ({ goodId, demandRate: demandRateForGood(goodId, population) }))
    .sort((a, b) => b.demandRate - a.demandRate);
}
```

- [ ] **Step 4: Run + types**

Run: `npx vitest run lib/constants/__tests__/market-economy.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/market-economy.ts lib/constants/__tests__/market-economy.test.ts
git commit -m "feat(economy): demandFootprint — per-good population demand, descending"
```

## Task 14: Population read path (types + service + route + hook + tick invalidation)

The single-system social snapshot. One cohesive deliverable: the service is the testable gate; the route/hook/key/invalidation are thin wiring verified by `tsc`.

**Files:**
- Modify: `lib/types/api.ts` (add the three types from Shared contracts)
- Create: `lib/services/system-population.ts`
- Create: `app/api/game/systems/[systemId]/population/route.ts`
- Modify: `lib/query/keys.ts` (add `systemPopulation`)
- Create: `lib/hooks/use-system-population.ts`
- Modify: `lib/hooks/use-tick-invalidation.ts`
- Test: `lib/services/__tests__/integration/system-population.integration.test.ts`

**Interfaces:**
- Consumes: `demandFootprint` (Task 13), `STRIKE_PARAMS` (`@/lib/constants/population`), `GOODS` (`@/lib/constants/goods`), `getPlayerVisibility` (`@/lib/services/visibility-cache`), `ServiceError` (`@/lib/services/errors`), `prisma` (`@/lib/prisma`).
- Produces: `SystemPopulationData`, `getSystemPopulation`, `useSystemPopulation` — consumed by Tasks 15, 16.

- [ ] **Step 1: Add the API types**

In `lib/types/api.ts`, add the `PopulationDemandEntry`, `SystemPopulationData`, and `SystemPopulationResponse` declarations from the Shared contracts block above (place near `SystemSubstrateData`).

- [ ] **Step 2: Write the failing service test**

Create `lib/services/__tests__/integration/system-population.integration.test.ts`, mirroring the player+visibility setup of `lib/services/__tests__/integration/market.integration.test.ts` (same harness: seed a world, create a player, make the target system visible). Core assertions:

```typescript
import { describe, it, expect } from "vitest";
import { getSystemPopulation } from "@/lib/services/system-population";
// + the shared integration harness imports/setup mirrored from market.integration.test.ts

describe("getSystemPopulation (integration)", () => {
  it("returns the population snapshot for a visible system", async () => {
    // arrange: player with `system` visible (harness)
    const data = await getSystemPopulation(playerId, system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.population).toBeGreaterThanOrEqual(0);
    expect(data.popCap).toBeGreaterThan(0);
    expect(data.unrest).toBeGreaterThanOrEqual(0);
    expect(data.unrest).toBeLessThanOrEqual(1);
    expect(data.striking).toBe(data.unrest >= 0.5); // STRIKE_PARAMS.threshold
    expect(data.demand.length).toBeGreaterThan(0);
    expect(data.demand[0].demandRate).toBeGreaterThanOrEqual(data.demand[1].demandRate);
    expect(typeof data.demand[0].goodName).toBe("string");
  });
  it("returns { visibility: 'unknown' } for an unsurveyed system", async () => {
    const data = await getSystemPopulation(playerId, hiddenSystem.id);
    expect(data).toEqual({ visibility: "unknown" });
  });
});
```

Run: `npx vitest run --project integration system-population` → FAIL (service not found).

- [ ] **Step 3: Implement the service** (`lib/services/system-population.ts`)

```typescript
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/services/errors";
import { getPlayerVisibility } from "@/lib/services/visibility-cache";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { demandFootprint } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import type { SystemPopulationData } from "@/lib/types/api";

/** How many goods to surface in the demand footprint (top by demand). */
const DEMAND_FOOTPRINT_LIMIT = 6;

/**
 * Dynamic population & social state for one system — population, popCap, unrest,
 * a strike flag, and the demand footprint. Visibility-gated (an unsurveyed system
 * returns `{ visibility: "unknown" }` so a direct URL can't leak survey data),
 * mirroring getSystemSubstrate. Unlike the substrate read, these fields change
 * every economy tick, so the hook (Step 6) is tick-invalidated.
 */
export async function getSystemPopulation(
  playerId: string,
  systemId: string,
): Promise<SystemPopulationData> {
  const [{ visibleSet }, system] = await Promise.all([
    getPlayerVisibility(playerId),
    prisma.starSystem.findUnique({
      where: { id: systemId },
      select: { population: true, popCap: true, unrest: true },
    }),
  ]);

  if (!system) throw new ServiceError("System not found.", 404);
  if (!visibleSet.has(systemId)) return { visibility: "unknown" };

  const demand = demandFootprint(system.population)
    .slice(0, DEMAND_FOOTPRINT_LIMIT)
    .map((e) => ({
      goodId: e.goodId,
      goodName: GOODS[e.goodId]?.name ?? e.goodId,
      demandRate: e.demandRate,
    }));

  return {
    visibility: "visible",
    population: system.population,
    popCap: system.popCap,
    unrest: system.unrest,
    striking: system.unrest >= STRIKE_PARAMS.threshold,
    demand,
  };
}
```

- [ ] **Step 4: Run the service test**

Run: `npx vitest run --project integration system-population` → PASS.

- [ ] **Step 5: The route** (`app/api/game/systems/[systemId]/population/route.ts`)

Mirror the substrate route exactly:

```typescript
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getSystemPopulation } from "@/lib/services/system-population";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemPopulationResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/population",
    async () => {
      const auth = await requirePlayer();
      if (isErrorResponse(auth)) return auth;

      const { systemId } = await params;
      const data = await getSystemPopulation(auth.playerId, systemId);
      return NextResponse.json<SystemPopulationResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
```

- [ ] **Step 6: Query key + hook + tick invalidation**

In `lib/query/keys.ts`, add next to `systemSubstrate`:

```typescript
  systemPopulation: (systemId: string) => ["systemPopulation", systemId] as const,
```

Create `lib/hooks/use-system-population.ts`:

```typescript
"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemPopulationData } from "@/lib/types/api";

/**
 * Dynamic population & social state (population, popCap, unrest, demand footprint)
 * for one system. Changes every economy tick — so, unlike the static substrate
 * read, it uses the default staleTime and is tick-invalidated (see
 * useTickInvalidation). Visibility-gated server-side.
 */
export function useSystemPopulation(systemId: string): SystemPopulationData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemPopulation(systemId),
    queryFn: () =>
      apiFetch<SystemPopulationData>(`/api/game/systems/${systemId}/population`),
  });
  return data;
}
```

In `lib/hooks/use-tick-invalidation.ts`, inside the existing `economyTick` subscriber (population is written on the economy tick), add:

```typescript
        queryClient.invalidateQueries({ queryKey: ["systemPopulation"] });
```

(Prefix match invalidates every per-system entry; mirrors the `["priceHistory"]` invalidation already in this file. Background refetch — `useSuspenseQuery` keeps prior data, so no per-tick re-suspend/flicker.)

- [ ] **Step 7: Types + commit**

Run: `npx tsc --noEmit` → clean. `npx vitest run --project integration system-population` → PASS.

```bash
git add lib/types/api.ts lib/services/system-population.ts \
  app/api/game/systems/[systemId]/population/route.ts lib/query/keys.ts \
  lib/hooks/use-system-population.ts lib/hooks/use-tick-invalidation.ts \
  lib/services/__tests__/integration/system-population.integration.test.ts
git commit -m "feat(economy): system population read path (population/unrest/demand, tick-invalidated)"
```

## Task 15: Population tab (panel + page + tab nav)

**Files:**
- Create: `components/system/population-panel.tsx`
- Create: `app/(game)/@panel/system/[systemId]/population/page.tsx`
- Modify: `app/(game)/@panel/system/[systemId]/layout.tsx`

**Interfaces:**
- Consumes: `useSystemPopulation` (Task 14), `StabilityBadge` (PR 3), `Card`/`SectionHeader`/`StatList`/`StatRow`/`ProgressBar`/`EmptyState` (existing UI), `formatNumber` (`@/lib/utils/format`).

- [ ] **Step 1: The panel component** (`components/system/population-panel.tsx`)

Mirrors `AstrographyContent`'s structure (Card + StatList + ProgressBar + visibility-gated `EmptyState`):

```typescript
"use client";

import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { StabilityBadge } from "@/components/ui/stability-badge";
import { formatNumber } from "@/lib/utils/format";

export function PopulationPanel({ systemId }: { systemId: string }) {
  const pop = useSystemPopulation(systemId);

  if (pop.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to assess its population." />
    );
  }

  const { population, popCap, unrest, striking, demand } = pop;
  const popCapInt = Math.round(popCap);

  return (
    <div className="space-y-6">
      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-3">Population</SectionHeader>
        <StatList>
          <StatRow label="Inhabitants">
            <span className="font-mono text-sm text-text-primary">{formatNumber(population)}</span>
          </StatRow>
          <StatRow label="Capacity">
            <span className="font-mono text-sm text-text-primary">{formatNumber(popCapInt)}</span>
          </StatRow>
        </StatList>
        <ProgressBar label="Utilisation" value={population} max={Math.max(1, popCapInt)} color="copper" />
      </Card>

      <Card variant="bordered" padding="md">
        <div className="mb-3 flex items-center justify-between">
          <SectionHeader as="h4">Stability</SectionHeader>
          <StabilityBadge unrest={unrest} />
        </div>
        <ProgressBar label="Unrest" value={unrest} max={1} color="copper" />
        {striking && (
          <p className="mt-2 text-sm text-amber-300">Production suppressed — workers are striking.</p>
        )}
      </Card>

      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-1">Demand footprint</SectionHeader>
        <p className="mb-3 text-xs text-text-tertiary">
          What these inhabitants consume each tick — this is what drives the system&apos;s market demand.
        </p>
        {demand.length === 0 ? (
          <EmptyState message="No demand." />
        ) : (
          <ul className="space-y-1.5">
            {demand.map((d) => (
              <li key={d.goodId} className="flex items-center justify-between py-1.5 px-3 bg-surface">
                <span className="text-sm text-text-primary">{d.goodName}</span>
                <span className="text-sm font-mono text-text-secondary">{d.demandRate.toFixed(2)}/t</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

> If PR 3's `StabilityBadge` takes a different prop than `unrest`, adjust the one line here (and Task 16). That is the only PR 3 coupling.

- [ ] **Step 2: The tab page** (`app/(game)/@panel/system/[systemId]/population/page.tsx`)

Mirrors `astrography/page.tsx`:

```typescript
"use client";

import { use } from "react";
import { PopulationPanel } from "@/components/system/population-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

export default function PopulationPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return (
    <QueryBoundary>
      <PopulationPanel systemId={systemId} />
    </QueryBoundary>
  );
}
```

- [ ] **Step 3: Add the tab to the nav** (`app/(game)/@panel/system/[systemId]/layout.tsx`)

In the `tabs` array, insert after the `Astrography` entry:

```typescript
    { label: "Population", href: `${basePath}/population`, active: pathname.startsWith(`${basePath}/population`), badge: 0 },
```

- [ ] **Step 4: Types + manual check + commit**

Run: `npx tsc --noEmit` → clean. Then `npm run dev`, open a surveyed system, click the **Population** tab → magnitude/utilisation, stability badge + unrest bar (+ strike line when unrest ≥ 0.5), and the demand footprint render; an unsurveyed system shows the locked `EmptyState`. (No unit test — rendering needs no jsdom; the data is covered by Task 14.)

```bash
git add components/system/population-panel.tsx \
  "app/(game)/@panel/system/[systemId]/population/page.tsx" \
  "app/(game)/@panel/system/[systemId]/layout.tsx"
git commit -m "feat(ui): system Population tab — magnitude, stability, demand footprint"
```

## Task 16: Overview stability row

**Files:**
- Modify: `app/(game)/@panel/system/[systemId]/page.tsx`

**Interfaces:**
- Consumes: `useSystemPopulation` (Task 14), `StabilityBadge` (PR 3).

- [ ] **Step 1: Wire the hook + render a Stability row**

In `SystemOverviewContent` (`app/(game)/@panel/system/[systemId]/page.tsx`), add the imports:

```typescript
import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { StabilityBadge } from "@/components/ui/stability-badge";
```

Call the hook alongside the existing `useSystemSubstrate` call:

```typescript
  const populationState = useSystemPopulation(systemId);
```

In the System Summary `StatList`, add a `Stability` row immediately after the existing `Population` row (`<StatRow label="Population">…</StatRow>`):

```typescript
              <StatRow label="Stability">
                {populationState.visibility === "visible" ? (
                  <StabilityBadge unrest={populationState.unrest} />
                ) : (
                  <span className="text-sm text-text-tertiary">—</span>
                )}
              </StatRow>
```

(The hook suspends within the page's existing `QueryBoundary` on first load, same as `useSystemSubstrate`; tick invalidation triggers a background refetch, not a re-suspend, so the Overview does not flicker.)

- [ ] **Step 2: Types + manual check + commit**

Run: `npx tsc --noEmit` → clean. `npm run dev` → the Overview's System Summary shows a Stability badge under Population; it updates as ticks change `unrest`.

```bash
git add "app/(game)/@panel/system/[systemId]/page.tsx"
git commit -m "feat(ui): show system stability on the Overview summary"
```

## Task 17: Docs + mark SP2 Part 1 complete + retire the plan

**Files:** `docs/active/gameplay/economy.md`, `docs/planned/economy-simulation-living-world.md`, `docs/SPEC.md`, and the plan docs.

- [ ] **Step 1: Document the readouts**

- `economy.md`: add that the system screen surfaces dynamic population + stability — a **Population tab** (magnitude, `popCap` utilisation, unrest/stability, strike state, and the per-good demand footprint) and a stability row on the Overview. Note the read path is tick-invalidated (separate from the static Astrography/substrate read).
- `docs/planned/economy-simulation-living-world.md`: add a one-line note that Part 1's UI scope includes the population/stability readouts (Population tab + Overview row), beyond §4's map "stability UI". Then **mark Part 1 shipped** (date + calibrated constants) and the sub-project complete — the marking PR 3 Task 12 deferred here.
- `docs/SPEC.md`: note the Population tab / stability readout in the system-UI description.

- [ ] **Step 2: Retire the build plan**

Per the `docs/plans/` convention, delete `docs/plans/sp2-part1-consequence-loop-migration.md` (this plan — Part 1 has now fully shipped). (`sp2-part0-deregion-diffusion.md` was already removed in PR 3 Task 12.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(economy): document the population/stability readouts; mark SP2 Part 1 complete"
```

## Self-check (PR 4)

- Static substrate vs per-tick population are **separate read paths** — `/population` is tick-invalidated, `/substrate` stays `staleTime: Infinity`. ✓ (Task 14)
- `demandFootprint` is pure + unit-tested; the service is integration-tested (visibility gating + shape); no Prisma mocking. ✓ (Tasks 13–14)
- Population tab reuses PR 3's `StabilityBadge` (shared thresholds); Overview shows the stability row. ✓ (Tasks 15–16)
- No `as`/`unknown`; `SystemPopulationData` is a discriminated union; route uses `ApiResponse<T>` + `Cache-Control: private, no-cache`. ✓
- Deferred items (trend/sparkline, map quick-detail panel) explicitly out of scope. ✓
- SP2 Part 1 marked complete; this plan deleted. ✓ (Task 17)

---

## Self-Review (whole plan vs `economy-simulation-living-world.md`)

**Spec coverage:**
- §2 prosperity retired → PR 1. ✓  | population Int→Float → PR 1 Step 9. ✓
- §4 taxonomy (magnitude/ceiling/signals/properties/states-effects) → `population`(Float)/`popCap`/satisfaction(transient)/`unrest`(column)/strike+growth+migration(derived). ✓
- §6 need-satisfaction → convex demand-weighted `D` → unrest: `dissatisfaction` + `accumulateUnrest` (PR 2 Task 2), measured in the economy processor from post-tick stock (Task 4). ✓
- §7 logistic growth/decline gated by satisfaction, damped by unrest → `populationDelta` (Task 2), population processor (Task 5). ✓
- §8 migration on the unified topology, attractiveness = low-unrest + headroom, conserved, distance-attenuated, work-budget sharded → PR 3 Tasks 7–9. ✓
- §9 one-tick feedback loop (strike from last tick's unrest; economy→population handoff; `demandRate` rewrite) → Task 4 + Task 5. ✓
- §10 stable-but-growing calibration → Task 6 + Task 10. ✓
- §11 full reseed → PR 1 Step 9. ✓
- §4 prosperity UI re-points to unrest-derived stability → PR 3 Task 11. ✓
- **Beyond spec** — population/stability *readouts* on the system screen (Population tab + Overview stability row) → PR 4 (Tasks 13–17). A UI scope addition agreed 2026-06-19; the spec gets a one-line note in PR 4 Task 17. ✓
- §14 open questions resolved: distance-attenuation reused; work-budget slice = `MIGRATION_EDGES_PER_TICK`; `k`/`decay`/strike threshold = `UNREST_PARAMS`/`STRIKE_PARAMS` (sim-tuned), strike derived (no stored flag); growth/migration coeffs sim-discovered; handoff = in-memory `ctx.results` (`EconomySignals`); migration = separate processor; no independents (flood-fill leaves none — `null===null` stays defensive); schema specifics in PR 1 Step 9 + PR 2. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". Calibration steps (PR 2 Task 6, PR 3 Task 10) are procedural by nature (run-observe-adjust) with exact commands + named levers. The two "mirror the deleted prosperity file" steps (PR 3 Task 11 Step 3) reference a concrete `git show` source + give the exact band ramp — a mechanical recreation, not a vague instruction.

**Type consistency:** `EconomySignals.dissatisfactionBySystem: Map<string,number>` is produced by `runEconomyProcessor` (Task 4) and read by `runPopulationProcessor` via `ctx.results.get("economy")?.economySignals` (Task 5) — same shape. `PopulationStateView`/`PopulationUpdate`, `MigrationNodeView`/`MigrationDelta`, `EdgeView` (reused from trade-flow), `strikeMultiplier`/`dissatisfaction`/`populationDelta`/`migrationFlow` signatures match across interface, adapters, body, wiring, and tests. `demandRateForGood(goodId, population)` is used identically in both population adapters + `seed.ts` + `world.ts`. `productionSuppress` flows `MarketTickInput` → `TickEntryInput` → `buildMarketTickEntry` (production only). ✓

> **Reseed reminder:** only PR 1 reseeds. After PR 1, run the game/sim against the reseeded DB for PR 2/PR 3; no further `db push`/seed is needed.
