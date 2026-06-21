# Economy Substrate v2 — Available-Space Model — Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This is a transient build plan** (`docs/plans/`). Delete it when the milestone ships — the durable functional design is `docs/planned/economy-substrate-v2-available-space.md` (graduates to `docs/active/` at ship), and the code is the source of truth thereafter.

**Goal:** Rework the substrate so each body has one finite *available space* contested by deposit extractors (dedicated slots × quality band), population centres (habitable fraction), and production/other buildings (fungible general space) — replacing v1's abstract resource-magnitude vector.

**Architecture:** Total space comes from body **size** alone (`SPACE_PER_SIZE × size`). An archetype **weight vector** over `{7 resources + general}` partitions that space into per-resource **deposit slots** (dedicated) and **general space** (fungible); the **habitable fraction** of general space caps population. Each deposit rolls a **quality band** (poor/average/good/rich → yield multiplier). Per-body slots + quality **aggregate to per-system** denormalised columns (extractor-slot caps + an effective-yield multiplier per resource); the live tick adds exactly one new term — tier-0 extractor output × the system's yield multiplier. Population folds fully into built **population-centre** buildings on habitable land (no body baseline). Generation is a **single normalised partition** (no sequential-roll ordering bias), with a rare **volatility** spike.

**Tech Stack:** Next.js 16 / TypeScript 5 strict, Prisma 7 (`prisma-client` + `@prisma/adapter-pg`), PostgreSQL, Vitest 4. Pure engine in `lib/engine/`, constants in `lib/constants/`, schema in `prisma/`, sim in `lib/engine/simulator/`.

## Global Constraints

- **No `as`** except `as const` / `lib/types/guards.ts`. **No `unknown`** / `Record<string, unknown>` anywhere; type at the boundary, trust downstream. Use the typed `ResourceType` union map, never loose string keys.
- **Engine functions are pure** — zero DB import. Deterministic given the seeded `RNG` (`lib/engine/universe-gen.ts`). Never call `Math.random()` / `Date.now()` in engine code.
- **Unit project has NO `DATABASE_URL`** — never *top-level* import `@/lib/prisma` (or a module that does) into a unit-tested graph; it throws at module load. Keep prisma-tainted deps as dynamic imports inside functions. Verify a new unit test LOADS with `DATABASE_URL` unset.
- **Postgres scale**: all per-tick DB writes batched inside `$transaction` (`unnest()` UPDATE / `createMany`); guard against `NaN`/`Infinity` before raw SQL; `Int` columns cap at 2,147,483,647 (substrate columns are `Float`, fine).
- **Full reseed is mandatory** twice (Phase 2 additive columns; Phase 3 column drops). `npx prisma db push` then `npx prisma db seed`.
- **Calibration target is coarse**: markets span their per-market bands without pinning to floor/ceiling (Phase 4+; legacy global `[5,200]` before that), real cross-system price dispersion, bots profit, greedy ≫ random. NOT "differentiated/growing" — that's SP4/SP5.
- **Conventions**: API `ApiResponse<T>`; services own DB access, route handlers thin; TanStack Query hooks + `QueryBoundary`; Foundry theme (no rounding on cards; `font-mono` numerics). Commit after each task. Shared branch `feat/economy-substrate-v2`; one phase PR per phase into the shared branch; final squash/ff to `main`.

## Worked decisions (from brainstorming, 2026-06-20)

1. This doc's design parent is the spec; no duplicate spec.
2. **Per-system aggregation** of per-body slots + quality → denormalised `StarSystem` columns. `SystemBuilding` stays system-level. Goods sharing a resource (food/textiles ← arable) share its slot cap + yield. Seed fills best-quality slots first → effective yield = avg quality of filled slots.
3. **Richness modifiers retired** — folded into bands with generated `band × resource` names.
4. **Population full-fold** — no body baseline; `POP_BASELINE_FLOOR = 0` escape hatch.
5. **Panel redesign ships last** (Phase 5).

---

## The v2 model (concrete formulas — implement exactly; magnitudes are Phase-5 calibration knobs)

```
bodyAvailableSpace          = SPACE_PER_SIZE × size                         // size only (was BASE_SPACE × size × habitability)

# Partition (single normalised pass — no ordering bias):
weights[r]                  = archetype.weights[r]   for r in 7 resources   // reuse v1 resourceBase as weights
weights.general             = archetype.generalWeight
(volatility, prob VOLATILITY_CHANCE) → weights[pickedResource] ×= VOLATILITY_SPIKE   // BEFORE normalising
W                           = Σ weights                                     // over 7 resources + general
depositSpace[r]             = (weights[r] / W) × bodyAvailableSpace
generalSpace(body)          = (weights.general / W) × bodyAvailableSpace
habitableSpace(body)        = archetype.habitableFraction × generalSpace(body)
slots[r]                    = depositSpace[r] / DEPOSIT_SLOT_FOOTPRINT      // available extractor slots, resource r

# Quality (independent roll per deposit present on the body):
band                        = weightedPick(QUALITY_BANDS)                   // poor/average/good/rich
qualityMult[r]              = uniform(band.min, band.max)                   // per-body, per-resource

# Per-system aggregates (denormalised onto StarSystem):
availableSpace(sys)         = Σ_body bodyAvailableSpace
generalSpace(sys)           = Σ_body generalSpace(body)
habitableSpace(sys)         = Σ_body habitableSpace(body)
slotCap(sys)[r]             = Σ_body slots[r]                               // extractor-count ceiling for resource r
yieldMult(sys)[r]           = avg qualityMult[r] over the FILLED slots      // computed by the seeder (best-quality-first); default 1.0

# Seeding build-out (allocateIndustry, available-space):
extractors[g] (tier-0)      ≤ slotCap[resource(g)]                         // goods sharing a resource share the cap
popCentres                  on habitableSpace → popCap = Σ count × POP_CENTRE_DENSITY   (+ POP_BASELINE_FLOOR, =0)
factories (tier-1+)         on generalSpace (non-deposit), input-consistent as v1
built ≤ available everywhere (fill fraction < 1 leaves SP5 headroom)

# Live tick — the ONLY new term (tier-0 only):
production_g = Σ count × outputPerUnit × labourFulfillment × inputGate × (tier0(g) ? yieldMult[resource(g)] : 1)
```

Resource → tier-0 good map (from `GOOD_PRODUCTION`): `water←water, food←arable, textiles←arable, ore←ore, gas←gas, minerals←minerals, biomass←biomass, radioactives←radioactive`. `resource(g) = GOOD_PRODUCTION[g].resource`.

---

## Schema delta (exact)

**`StarSystem`** — drop `aggGas..aggRadioactive` (7), `buildSpace` (1); add:
```prisma
  availableSpace   Float @default(0)   // SPACE_PER_SIZE × Σ size
  generalSpace     Float @default(0)   // fungible (non-deposit) space
  habitableSpace   Float @default(0)   // habitable fraction of general — caps population centres
  slotGas          Float @default(0)   // extractor-slot caps (one per resource)
  slotMinerals     Float @default(0)
  slotOre          Float @default(0)
  slotBiomass      Float @default(0)
  slotArable       Float @default(0)
  slotWater        Float @default(0)
  slotRadioactive  Float @default(0)
  yieldGas         Float @default(1)   // effective quality multipliers (one per resource)
  yieldMinerals    Float @default(1)
  yieldOre         Float @default(1)
  yieldBiomass     Float @default(1)
  yieldArable      Float @default(1)
  yieldWater       Float @default(1)
  yieldRadioactive Float @default(1)
```
`population`, `popCap`, `unrest`, `sunClass`, `bodyDanger` stay (popCap meaning changes to Σ pop-centre density).

**`SystemBody`** — drop `resGas..resRadioactive` (7), `popCapWeight` (1), `richnessModifiers` (1); add:
```prisma
  generalSpace     Float @default(0)   // this body's general space
  habitableSpace   Float @default(0)   // this body's habitable space
  slotGas          Float @default(0)   // per-body slot counts (one per resource)
  slotMinerals     Float @default(0)
  slotOre          Float @default(0)
  slotBiomass      Float @default(0)
  slotArable       Float @default(0)
  slotWater        Float @default(0)
  slotRadioactive  Float @default(0)
  qualGas          Float @default(0)   // per-body quality multipliers (0 = no deposit)
  qualMinerals     Float @default(0)
  qualOre          Float @default(0)
  qualBiomass      Float @default(0)
  qualArable       Float @default(0)
  qualWater        Float @default(0)
  qualRadioactive  Float @default(0)
```
`bodyType`, `habitable`, `size` stay. (Phase 2 adds these *alongside* the old columns; Phase 3 drops the old ones.)

---

## File map

| File | Phase | Responsibility |
|---|---|---|
| `lib/constants/substrate-gen.ts` | 1 | Add `SPACE_PER_SIZE`, `DEPOSIT_SLOT_FOOTPRINT`, `QUALITY_BANDS`, `VOLATILITY_CHANCE/SPIKE`, `POP_BASELINE_FLOOR` |
| `lib/constants/bodies.ts` | 1 | Add `generalWeight` + `habitableFraction` to each archetype; (P3) delete `RICHNESS_MODIFIERS` |
| `lib/engine/substrate-space.ts` *(new)* | 1 | Pure: `partitionBody`, `rollQualityBand`, `bandForMultiplier`, `depositDisplayName` |
| `lib/engine/resources.ts` | 2 | Add `slotColumns`/`qualColumns`/`yieldColumns` spreaders + `*FromColumns` readers; (P3) drop `aggregateColumns`/`bodyResourceColumns` |
| `lib/engine/body-gen.ts` | 2/3 | (P2) produce new aggregates alongside old; (P3) drop old generation, drive seeder + yieldMult |
| `prisma/schema.prisma` | 2/3 | (P2) add new columns; (P3) drop old columns |
| `prisma/seed.ts` | 2/3 | (P2) write new columns; (P3) stop writing old |
| `lib/engine/industry.ts` | 1/3 | (P1) `POP_CENTRE_*`/full-fold `housingPopCap`; (P3) `bodyAvailableSpace`→space-from-size, thread `yields` into `buildingProduction`/`capacityGoodRates`/`buildIndustryReadout` |
| `lib/constants/industry.ts` | 3 | Space model: `SPACE_PER_SIZE` total; pop-centre density; drop `HABITABILITY_FACTOR` total-multiplier role |
| `lib/engine/industry-seed.ts` | 3 | `allocateIndustry` on available-space (slot caps, habitable space, full-fold, compute `yieldMult`) |
| `lib/engine/economy-type.ts` | 3 | Classifier reads `slotCap × yieldMult` instead of `aggregate` |
| `lib/constants/market-economy.ts` | 3 | `getInitialStock` off seeded buildings × yields (drop `physicalRates(aggregate)`) |
| `lib/engine/physical-economy.ts` | 3 | Delete the aggregate path (`physicalRates`, `substrateGoodRates`) if unused; keep `GOOD_PRODUCTION` coeffs |
| `lib/tick/adapters/prisma/economy.ts` + `world/` | 3 | Load `yield*` columns; pass to production |
| `lib/engine/simulator/world.ts` | 3 | `SimSystem` carries slot caps + yields + spaces; sim tick applies yield term |
| `lib/engine/market-pricing.ts` | 4 | `marketBand` — per-market `[minStock, maxStock]` from demand anchor + price clamps + `storageCapacity` |
| `lib/engine/tick.ts` | 4 | `MarketTickEntry` carries `minStock`/`maxStock`; `EconomySimParams` → `noiseFraction`; relative noise + per-entry clamp |
| `lib/engine/industry.ts` | 4 | `facilityStorageForGood(buildings, goodId)` — infrastructure depth term (also P1/P3 above) |
| `lib/constants/industry.ts` | 4 | `EXTRACTOR/PRODUCTION_STORAGE_PER_UNIT`, `POP_CENTRE_STORAGE*` (also P3 above) |
| `lib/constants/economy.ts` | 4 | Add `NOISE_FRACTION`; drop `MIN_LEVEL`/`MAX_LEVEL` |
| `lib/constants/market-economy.ts` | 4 | `getInitialStock` seeds within per-market band; drop `STOCK_MIN`/`STOCK_MAX` (also P3 above) |
| `prisma/schema.prisma` + `prisma/seed.ts` | 4 | `StationMarket.storageCapacity` column + seed-write via `facilityStorageForGood` |
| `lib/engine/market-tick-builder.ts` + `lib/tick/adapters/prisma/economy.ts` + `world/economy-world.ts` | 4 | Resolve per-market band; select/map `storageCapacity` |
| `lib/engine/simulator/world.ts` + `bot.ts` + `strategies/helpers.ts` + `market-analysis.ts` + `simulator/constants.ts` | 4 | `SimSystem` carries `demandRate`/`storageCapacity`; per-market band in bot/analysis (also P3 above) |
| `lib/services/{trade,convoy-trade,missions,market-entry,universe}.ts` + `lib/tick/{processors/trade-flow,adapters/prisma/events,adapters/memory/events}.ts` | 4 | Per-market band at every `STOCK_MIN/MAX` consumer |
| `lib/tick/processors/economy.ts` + `lib/engine/simulator/*` + `docs/active/engineering/tick-engine.md` | 6 | Cadence audit: measure round-robin vs flow/migration; maybe catch-up scaling |
| `lib/services/universe.ts` | 7 | Substrate + industry read services on new model; expose region/cadence for countdown |
| `components/system/*` | 7 | Panel redesign + cadence display + #5a/#7 display fixes |
| `scripts/substrate-coherence.ts` | 2 | Coherence report for the verification gate |

---

## Phase 1 — Engine foundation (pure, tested, unwired)

**Scope:** New constants + a pure `substrate-space` module + pop-centre constants. No schema, no generation wiring, no behaviour change. Ships as its own PR. The next phase wires it in.

**Interfaces produced (later phases consume):**
- `partitionBody(archetype: BodyArchetype, size: number, rng: RNG): BodyPartition` where `BodyPartition = { slots: ResourceVector; generalSpace: number; habitableSpace: number; availableSpace: number }`
- `rollQualityBand(rng: RNG): { band: QualityBandId; multiplier: number }`
- `bandForMultiplier(mult: number): QualityBandId`
- `depositDisplayName(resource: ResourceType, band: QualityBandId): string`
- Constants: `SUBSTRATE_GEN.SPACE_PER_SIZE`, `.DEPOSIT_SLOT_FOOTPRINT`, `.VOLATILITY_CHANCE`, `.VOLATILITY_SPIKE`, `.POP_BASELINE_FLOOR`; `QUALITY_BANDS`; `bodies.ts` archetypes gain `generalWeight`, `habitableFraction`; `industry.ts` `POP_CENTRE_DENSITY` (+ keep `HOUSING_TYPE` id, repurpose as pop-centre).

### Task 1.1: Quality-band constants + types

**Files:** Modify `lib/constants/substrate-gen.ts`; Modify `lib/types/game.ts` (add `QualityBandId` union); Test `lib/constants/__tests__/quality-bands.test.ts`.

- [ ] **Step 1 — Add the band type.** In `lib/types/game.ts` add `export type QualityBandId = "poor" | "average" | "good" | "rich";`
- [ ] **Step 2 — Write failing test** (`quality-bands.test.ts`): assert `QUALITY_BANDS` has 4 entries with non-overlapping ascending ranges covering `[0.4, 2.5]`, positive roll weights, and ids `poor/average/good/rich`.
```ts
import { QUALITY_BANDS } from "@/lib/constants/substrate-gen";
it("bands are ordered, non-overlapping, weighted", () => {
  const ids = QUALITY_BANDS.map((b) => b.id);
  expect(ids).toEqual(["poor", "average", "good", "rich"]);
  for (let i = 1; i < QUALITY_BANDS.length; i++)
    expect(QUALITY_BANDS[i].min).toBeGreaterThanOrEqual(QUALITY_BANDS[i - 1].max);
  expect(QUALITY_BANDS.every((b) => b.weight > 0 && b.min < b.max)).toBe(true);
});
```
- [ ] **Step 3 — Run, verify FAIL** (`npx vitest run lib/constants/__tests__/quality-bands.test.ts`).
- [ ] **Step 4 — Implement.** Add to `substrate-gen.ts`:
```ts
import type { QualityBandId } from "@/lib/types/game";
export interface QualityBand { id: QualityBandId; min: number; max: number; weight: number; }
/** Deposit yield multiplier bands — first-draft; calibrated Phase 4. */
export const QUALITY_BANDS: readonly QualityBand[] = [
  { id: "poor", min: 0.4, max: 0.7, weight: 25 },
  { id: "average", min: 0.8, max: 1.3, weight: 45 },
  { id: "good", min: 1.4, max: 1.8, weight: 22 },
  { id: "rich", min: 1.9, max: 2.5, weight: 8 },
] as const;
```
Also add to the `SUBSTRATE_GEN` object: `SPACE_PER_SIZE: 40`, `DEPOSIT_SLOT_FOOTPRINT: 1.0`, `VOLATILITY_CHANCE: 0.04`, `VOLATILITY_SPIKE: 6`, `POP_BASELINE_FLOOR: 0`.
- [ ] **Step 5 — Run, verify PASS.** Confirm test loads with `DATABASE_URL` unset (no prisma import in this graph).
- [ ] **Step 6 — Commit.** `git add -A && git commit -m "feat(economy): substrate-v2 P1 — quality-band + space constants"`

### Task 1.2: Archetype weight extensions

**Files:** Modify `lib/constants/bodies.ts`; Test `lib/constants/__tests__/archetype-weights.test.ts`.

- [ ] **Step 1 — Failing test:** every archetype has `generalWeight ≥ 0` and `habitableFraction ∈ [0,1]`; habitable archetypes have `habitableFraction > 0`, uninhabitable `≈ 0` (≤ 0.1); `garden_world.generalWeight` is the largest (most buildable land).
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement.** Extend `BodyArchetype` with `generalWeight: number; habitableFraction: number;` and add first-draft values per archetype (calibrated Phase 4):

| archetype | generalWeight | habitableFraction |
|---|--:|--:|
| garden_world | 9 | 0.7 |
| ocean_world | 6 | 0.45 |
| jungle_world | 7 | 0.5 |
| arid_world | 5 | 0.25 |
| volcanic_world | 2 | 0.03 |
| frozen_world | 3 | 0.05 |
| barren_rock | 3 | 0.05 |
| gas_giant | 1 | 0.02 |
| asteroid_belt | 2 | 0.02 |

(The existing `resourceBase` vector stays — it is now the *resource weight* vector for the partition.)
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P1 — archetype general + habitable weights`

### Task 1.3: `substrate-space.ts` — partition

**Files:** Create `lib/engine/substrate-space.ts`; Test `lib/engine/__tests__/substrate-space.test.ts`.

- [ ] **Step 1 — Failing tests** (use a deterministic stub RNG, e.g. `const rng = () => 0.5`):
  - `partitionBody` returns `availableSpace === SPACE_PER_SIZE × size`.
  - `Σ depositSpace[r] + generalSpace === availableSpace` (within float ε) — partition is exhaustive.
  - `slots[r] === depositSpace[r] / DEPOSIT_SLOT_FOOTPRINT`.
  - `habitableSpace === habitableFraction × generalSpace`.
  - A resource with weight 0 on the archetype gets `slots[r] === 0`.
  - **No ordering bias:** for an archetype with two equal-weight resources, their slots are equal (deterministic RNG with volatility disabled).
  - **Volatility:** with `rng` forced below `VOLATILITY_CHANCE`, exactly one resource's share spikes and the partition still sums to `availableSpace`.
- [ ] **Step 2 — Run, verify FAIL** ("partitionBody is not a function").
- [ ] **Step 3 — Implement** `partitionBody`:
```ts
import type { BodyArchetype } from "@/lib/constants/bodies";
import type { ResourceVector } from "@/lib/types/game";
import { RESOURCE_TYPES, emptyResourceVector } from "./resources";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import type { RNG } from "./universe-gen";

export interface BodyPartition {
  availableSpace: number;
  generalSpace: number;
  habitableSpace: number;
  slots: ResourceVector;       // available extractor slots per resource
  depositSpace: ResourceVector;
}

export function partitionBody(arch: BodyArchetype, size: number, rng: RNG): BodyPartition {
  const availableSpace = SUBSTRATE_GEN.SPACE_PER_SIZE * Math.max(0, size);
  const w = emptyResourceVector();
  for (const r of RESOURCE_TYPES) w[r] = arch.resourceBase[r];
  let general = arch.generalWeight;
  // Rare volatility: spike one positive-weight resource BEFORE normalising.
  if (rng() < SUBSTRATE_GEN.VOLATILITY_CHANCE) {
    const present = RESOURCE_TYPES.filter((r) => w[r] > 0);
    if (present.length > 0) {
      const pick = present[Math.floor(rng() * present.length)];
      w[pick] *= SUBSTRATE_GEN.VOLATILITY_SPIKE;
    }
  }
  let total = general;
  for (const r of RESOURCE_TYPES) total += w[r];
  const depositSpace = emptyResourceVector();
  const slots = emptyResourceVector();
  if (total > 0) {
    for (const r of RESOURCE_TYPES) {
      depositSpace[r] = (w[r] / total) * availableSpace;
      slots[r] = depositSpace[r] / SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT;
    }
    general = (general / total) * availableSpace;
  } else {
    general = availableSpace;
  }
  return {
    availableSpace,
    generalSpace: general,
    habitableSpace: arch.habitableFraction * general,
    slots,
    depositSpace,
  };
}
```
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P1 — body space partition`

### Task 1.4: `substrate-space.ts` — quality + naming

**Files:** Modify `lib/engine/substrate-space.ts`; Modify `lib/engine/__tests__/substrate-space.test.ts`.

- [ ] **Step 1 — Failing tests:** `rollQualityBand` returns a `multiplier` inside the picked band's `[min,max]`; `bandForMultiplier(m)` round-trips (multiplier rolled from band `b` maps back to `b`); `depositDisplayName("ore","rich")` returns a non-empty generic string containing "ore" (case-insensitive) and no proper noun from the old richness catalog.
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement:**
```ts
import { QUALITY_BANDS, type QualityBand } from "@/lib/constants/substrate-gen";
import type { QualityBandId, ResourceType } from "@/lib/types/game";

export function rollQualityBand(rng: RNG): { band: QualityBandId; multiplier: number } {
  const total = QUALITY_BANDS.reduce((s, b) => s + b.weight, 0);
  let roll = rng() * total;
  let chosen: QualityBand = QUALITY_BANDS[QUALITY_BANDS.length - 1];
  for (const b of QUALITY_BANDS) { roll -= b.weight; if (roll <= 0) { chosen = b; break; } }
  return { band: chosen.id, multiplier: chosen.min + rng() * (chosen.max - chosen.min) };
}

export function bandForMultiplier(mult: number): QualityBandId {
  for (const b of QUALITY_BANDS) if (mult <= b.max) return b.id;
  return QUALITY_BANDS[QUALITY_BANDS.length - 1].id;
}

const BAND_ADJECTIVE: Record<QualityBandId, string> = {
  poor: "Marginal", average: "Modest", good: "Rich", rich: "Bountiful",
};
const RESOURCE_NOUN: Record<ResourceType, string> = {
  gas: "gas pocket", minerals: "mineral seam", ore: "ore body", biomass: "biomass bloom",
  arable: "arable belt", water: "ice/water reserve", radioactive: "radioactive lode",
};
/** Generic, generated deposit name — band × resource. Replaces the v1 named-modifier catalog. */
export function depositDisplayName(resource: ResourceType, band: QualityBandId): string {
  return `${BAND_ADJECTIVE[band]} ${RESOURCE_NOUN[resource]}`;
}
```
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P1 — quality roll + generated deposit names`

### Task 1.5: Pop-centre / full-fold constants

**Files:** Modify `lib/constants/industry.ts`; Modify `lib/engine/industry.ts`; Test `lib/engine/__tests__/industry.test.ts` (existing).

- [ ] **Step 1 — Failing test:** `housingPopCap({ housing: 3 })` (rename concept to pop-centre) returns `3 × POP_CENTRE_DENSITY`; with `POP_BASELINE_FLOOR = 0`, a system with zero pop-centres has `popCap === 0`.
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement:** rename `HOUSING_POP_PROVIDED` → `POP_CENTRE_DENSITY` (keep `HOUSING_TYPE = "housing"` id for DB stability; it is now "population centre" in copy) and export it; ensure `housingPopCap` reads it. (Full-fold wiring — dropping the body baseline from `popCap` — lands in Phase 3's seeder; this task only establishes the density constant and the floor.)
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P1 — pop-centre density + baseline floor`

**Phase 1 gate:** `npx vitest run` green; `npx tsc --noEmit` clean; no new prisma imports in unit graphs. **Open phase PR → shared branch.** No behaviour change (nothing calls the new module yet).

---

## Phase 2 — Generation + schema + aggregation (additive, reseed, verify coherence in isolation)

**Scope:** Add the new columns *alongside* the old; rewrite generation to produce the new available-space aggregates **in addition to** the unchanged old aggregate/buildSpace/popCap (the economy MODEL is unchanged — it still reads the old columns); seed writes both; a coherence script validates the new substrate. **No economy/seeder/UI consumer changes.** This is the "validate the new universe is coherent before touching the economy" gate.

**Why this is safe (coherence, not parity):** the old economy CODE is unchanged — it reads only `aggregate`, `buildSpace`, `popCap`, `buildings`, `population`, all still produced by the unchanged old generation logic. The new columns are populated but unread. The reseeded universe will NOT be bit-identical (new rng draws shift the shared per-system stream — `universe-gen.ts:375` threads one `mulberry32(seed)` across all systems), and that is fine: we are in dev with no live universe, so we verify by COHERENCE not parity ([[dev-coherence-over-parity]]). `yield*` defaults `1.0` (seeder computes real values in Phase 3).

### Task 2.1: Schema — add new columns (keep old)

**Files:** Modify `prisma/schema.prisma`.

- [ ] **Step 1 — Add** the new `StarSystem` columns (`availableSpace`, `generalSpace`, `habitableSpace`, `slot*`, `yield*`) and `SystemBody` columns (`generalSpace`, `habitableSpace`, `slot*`, `qual*`) from the Schema-delta section, **leaving `agg*`/`buildSpace`/`res*`/`popCapWeight`/`richnessModifiers` in place**.
- [ ] **Step 2 — Push:** `npx prisma db push` (expect: additive, no data loss warning beyond new columns).
- [ ] **Step 3 — Commit.** `feat(economy): substrate-v2 P2 — additive schema columns`

### Task 2.2: Resource helpers — slot/qual/yield spreaders

**Files:** Modify `lib/engine/resources.ts`; Test `lib/engine/__tests__/resources.test.ts`.

- [ ] **Step 1 — Failing tests:** `slotColumns(v)` → `{ slotGas, …, slotRadioactive }`; `qualColumns(v)`; `yieldColumns(v)` (default 1s honoured); `slotVectorFromColumns(row)` round-trips. Mirror the existing `aggregateColumns` test shape.
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement** `slotColumns`, `qualColumns`, `yieldColumns` (spreaders) and a generalised reader (extend `resourceVectorFromColumns` to accept prefixes `"slot" | "qual" | "yield"`). Keep `aggregateColumns`/`bodyResourceColumns` (deleted Phase 3).
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P2 — slot/qual/yield column helpers`

### Task 2.3: Generation — produce new aggregates alongside old

**Files:** Modify `lib/engine/body-gen.ts`; Test `lib/engine/__tests__/body-gen.test.ts`.

> **Coherence, not parity (decided P2, 2026-06-20):** we are NOT chasing bit-identical reseeds. The shared PRNG is threaded across every system (`universe-gen.ts` — one `mulberry32(seed)` fed to `generateSubstrate` in a loop), so adding new `rng()` draws shifts the whole universe — and that is fine in dev (no live universe to preserve; P3 reseeds differently anyway). Verify the NEW aggregates by intrinsic coherence; do NOT snapshot old fields against pre-change values. The old generation LOGIC stays untouched (we only ADD) — the existing generation tests still passing is the guard that we didn't break it. See [[dev-coherence-over-parity]].

- [ ] **Step 1 — Failing tests (coherence of the new fields):** `generateSubstrate(rng)` now also returns, per body, `slots`/`quality`/`generalSpace`/`habitableSpace`; and per system `availableSpace`/`generalSpace`/`habitableSpace`/`slotCap` (= Σ body slots). Assert: `slotCap[r] === Σ bodies slots[r]`; `availableSpace === SPACE_PER_SIZE × Σ size` (ε); each body's deposit partition is exhaustive (Σ depositSpace + generalSpace ≈ availableSpace); `quality[r] > 0` only for present resources (`arch.resourceBase[r] > 0`) and within a band range; `slots[r] === 0` for absent resources. (NO old-field snapshot.)
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement.** Extend `GeneratedBody` with `slots: ResourceVector; quality: ResourceVector; generalSpace: number; habitableSpace: number`. In `rollBody`, after the existing (unchanged) old path, call `partitionBody(arch, size, rng)` and `rollQualityBand` per present resource → fill the new fields. Extend `GeneratedSubstrate` with the new per-system aggregates (`availableSpace`, `generalSpace`, `habitableSpace`, `slotCap`); `yieldMult` stays absent/1.0 here (seeder computes it in P3). The old `aggregate`/`buildSpace`/`popCap`/`buildings` computation stays exactly as today — ADD new code only, do not alter old draws/logic.
- [ ] **Step 4 — Run, verify PASS** (incl. the existing generation tests, which guard the old logic).
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P2 — generate available-space aggregates (additive)`

### Task 2.4: Seed — write new columns

**Files:** Modify `prisma/seed.ts`.

- [ ] **Step 1 — Implement:** in the system batch-create, spread `slotColumns(sys.slotCap)` + `availableSpace/generalSpace/habitableSpace` (+ `yieldColumns` defaulting 1s); in the body batch-create, spread `slotColumns(b.slots)`/`qualColumns(b.quality)`/per-body spaces. Keep writing the old `aggregateColumns`/`buildSpace`/`bodyResourceColumns`/`popCapWeight`/`richnessModifiers`.
- [ ] **Step 2 — Reseed:** `npx prisma db push && npx prisma db seed`. Expect success, no errors.
- [ ] **Step 3 — Commit.** `feat(economy): substrate-v2 P2 — seed new substrate columns`

### Task 2.5: Coherence script (the verification gate)

**Files:** Create `scripts/substrate-coherence.ts` (or extend the existing one referenced in `substrate-gen.ts`).

- [ ] **Step 1 — Implement** a read-only report over a generated universe (no DB needed — call `generateUniverse` directly): distribution of `availableSpace`, `generalSpace`, `habitableSpace`; mean slot caps per resource by sun class; quality-band histogram; volatility-extreme count; % systems with zero habitable space; and an **invariant check** that `Σ depositSpace + generalSpace ≈ availableSpace` for every body. Print a table.
- [ ] **Step 2 — Run** `npx tsx scripts/substrate-coherence.ts`; eyeball for coherence (garden worlds dominate habitable space; belts dominate ore/mineral slots; no all-zero-space systems; volatility ~4%).
- [ ] **Step 3 — Commit.** `chore(economy): substrate-v2 P2 — coherence report script`

**Phase 2 gate (coherence, not parity):** `npx vitest run` green; `npx tsc --noEmit` clean; `npx prisma db seed` succeeds with no errors; the coherence report (Task 2.5) looks sane **on its own merits** (no all-zero-space systems, slot caps distributed sensibly, partitions exhaustive, volatility ~4%); the economy runs CLEAN on the reseeded universe (`npm run dev` smoke — markets/prices/trade work, no NaN); `npm run simulate` completes and hits its equilibrium targets (stocks in band, dispersion exists, greedy ≫ random) — judged INTRINSICALLY, NOT compared to a pre-branch baseline (parity is not a dev-stage goal — see [[dev-coherence-over-parity]]). **Open phase PR → shared branch.**

---

## Phase 3 — Economy cutover + deletes (atomic, reseed)

**Scope:** Swap every consumer onto the new model and delete the old columns/code. This is the atomic cutover (the model changes all at once, like SP3 Part 3). After this the economy runs on available-space but is *uncalibrated* (Phase 5 tunes).

### Task 3.1: Build-space + production yield term (engine)

**Files:** Modify `lib/engine/industry.ts`, `lib/constants/industry.ts`; Test `lib/engine/__tests__/industry.test.ts`.

- [ ] **Step 1 — Failing tests:**
  - `buildingProduction(buildings, "ore", fulfillment, yields)` multiplies tier-0 ore output by `yields.ore`; a tier-1 good (`metals`) ignores `yields`.
  - `capacityGoodRates(buildings, population, yields)` applies the yield term to tier-0 only.
  - `bodyAvailableSpace(size)` (renamed/retargeted) returns `SPACE_PER_SIZE × size` (no habitability multiplier).
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement:** add a `yields: ResourceVector` param to `buildingProduction`, `capacityGoodRates`, `inputDemandForGood`, `buildIndustryReadout`; for each production type, look up `GOOD_PRODUCTION[good].resource` and multiply output by `yields[resource]` when tier-0 (`GOOD_TIER_BY_KEY[good] === 0`), else ×1. Repoint build-space: total available space is `SPACE_PER_SIZE × size` (drop `HABITABILITY_FACTOR` as a *total* multiplier — habitability is now the general-space fraction, already baked into `generalSpace`). Pop-centre full-fold: `popCap = housingPopCap(buildings) + POP_BASELINE_FLOOR`.
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P3 — tier-0 yield term + size-only space`

### Task 3.2: Seeder on available-space

**Files:** Modify `lib/engine/industry-seed.ts`, `lib/engine/body-gen.ts`; Test `lib/engine/__tests__/industry-seed.test.ts`.

- [ ] **Step 1 — Failing tests:** `allocateIndustry` caps tier-0 extractor count by `slotCap[resource]` (goods sharing arable share the cap); pop-centre count × density ≤ `habitableSpace / spaceCost`; factories consume only `generalSpace`; `built ≤ available` for slots, habitable, and general; returns `yieldMult[r]` = mean quality of the filled slots for resource `r` (best-quality-first), `1.0` when no slots filled.
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement:** change `AllocateInput` to `{ bodies: GeneratedBody[]; slotCap: ResourceVector; generalSpace: number; habitableSpace: number; fill: number }`. Tier-0: place `min(slotCap[r] × fill × jitter, slotsAffordableInGeneral?)` — extractors sit on deposit slots (dedicated), so they are capped by `slotCap[r]`, not general space. Pop-centres: `min(popDesired, habitableSpace / spaceCost)`. Factories: input-consistent as today, bounded by remaining `generalSpace`. Compute `yieldMult[r]` from the chosen extractor count against the body-level `quality[r]` values sorted desc. Drop `bodyBaselinePopCap` (full-fold). In `body-gen.ts`, drive the new seeder and write `yieldMult` into the per-system aggregates; **delete the old aggregate/`bodyBuildSpace`/`popCapWeight`/old-`allocateIndustry` path**.
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P3 — available-space seeder + yield aggregation`

### Task 3.3: getInitialStock + classifier off the aggregate

**Files:** Modify `lib/constants/market-economy.ts`, `lib/engine/economy-type.ts`, `lib/engine/physical-economy.ts`; Tests alongside.

- [ ] **Step 1 — Failing tests:** `getInitialStock(buildings, yields, population, goodId)` seeds a net producer (high `production`) deep/cheap and a net consumer shallow/dear, using `capacityGoodRates` (NOT `physicalRates`); `classifyEconomyType(slotCap, yieldMult, population)` reproduces sensible labels (ore-slot-dominant → extraction; arable-dominant → agricultural; high-pop balanced → core).
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement:** rewrite `getInitialStock` to take seeded `buildings` + `yields` and derive net balance from `capacityGoodRates`. Rewrite the classifier to read `slotCap[r] × yieldMult[r]` (effective deposit potential) instead of `aggregate[r]`. Delete `physicalRates`/`substrateGoodRates` and the `aggregate` param threads **if now unused** (grep first); keep `GOOD_PRODUCTION` (used by `OUTPUT_PER_UNIT`) and `GOOD_CONSUMPTION`.
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P3 — seed stock + economy-type off available-space`

### Task 3.4: Live tick + simulator wiring

**Files:** Modify `lib/tick/world/economy.ts` (interface), `lib/tick/adapters/prisma/economy.ts`, `lib/tick/adapters/memory/*`, `lib/tick/processors/economy.ts`, `lib/engine/simulator/world.ts`; Tests + `*.integration.test.ts`.

- [ ] **Step 1 — Failing tests:** the economy `World` row type carries `yields: ResourceVector`; the prisma adapter selects `yield*` columns and maps them; `simulateCoupledEconomyTick`/`resolveMarketTickEntry` pass `yields` into `buildingProduction`. Sim `SimSystem` carries `slotCap`/`yields`/spaces and the sim tick applies the yield term. An integration test (`trade-flow` or a new `substrate-v2.integration.test.ts`) runs N ticks against Postgres and asserts stocks stay finite and in-band-ish.
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement** the threading: add `yields` to the economy world row, select/​map `yield*` in the prisma + memory adapters, pass through the market-tick builder into production; update `SimSystem` + `createSimWorld` to copy slot caps + yields + spaces from `GeneratedSubstrate` and apply the yield term in the sim economy tick.
- [ ] **Step 4 — Run, verify PASS** (unit + the integration smoke).
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P3 — thread yields through tick + simulator`

### Task 3.5: Drop old columns + retire richness

**Files:** Modify `prisma/schema.prisma`, `prisma/seed.ts`, `lib/engine/resources.ts`, `lib/constants/bodies.ts`, `lib/engine/body-gen.ts`, `lib/types/game.ts`.

- [ ] **Step 1 — Delete** `agg*`/`buildSpace` (StarSystem), `res*`/`popCapWeight`/`richnessModifiers` (SystemBody) from schema; delete `aggregateColumns`/`bodyResourceColumns` + their writes in seed; delete `RICHNESS_MODIFIERS`/`RichnessModifierId`/`rollRichness`. Grep for every reference first (`rg "aggGas|buildSpace|richnessModifiers|RICHNESS"`), fix all call sites.
- [ ] **Step 2 — Push + reseed:** `npx prisma db push` (expect drop-column warnings — accept) `&& npx prisma db seed`.
- [ ] **Step 3 — Verify:** `npx vitest run` green; `npx tsc --noEmit` clean; `rg "\\bas\\b|unknown"` shows no new violations.
- [ ] **Step 4 — Commit.** `refactor(economy): substrate-v2 P3 — drop v1 substrate columns + richness`

**Phase 3 gate:** full unit + integration suites green; reseed succeeds; `npm run dev` smoke — system screens load, markets trade, no NaN prices; `npm run simulate` runs to completion (values uncalibrated — Phase 5). **Open phase PR → shared branch.**

---

## Phase 4 — Market pricing band: demand-priced, infrastructure-stocked

**Scope:** Replace the global `[5, 200]` stock band (`STOCK_MIN`/`STOCK_MAX` = `ECONOMY_CONSTANTS.MIN_LEVEL`/`MAX_LEVEL`) with a **per-market band** — demand-driven `targetStock`/`minStock`, infrastructure-driven `maxStock` (demand-headroom + Σ per-building storage) — plus **relative noise**. A denormalised `StationMarket.storageCapacity` column carries the facility-storage sum so every consumer derives the band from the market row alone (mirrors how `baseProductionRate` is sourced). Threads through the live tick, the simulator, and all player/service consumers. Reseed (initial stock magnitudes change). **Mechanism, not tuning** — magnitudes are first-draft; Phase 5 calibrates. Ships *before* calibration so calibration runs against a model that holds at scale. Functional design: `docs/planned/economy-relative-stock-band.md`.

**Why now (not in calibration):** the fixed band is an *absolute* scale while the price anchor (`TARGET_COVER × demandRate`) is *population-relative*; on any sizeable world the anchor outgrows the band and the price curve runs clipped (a heavy producer reads *expensive*). Tuning constants against that is wasted work — the band must become demand/infrastructure-relative first.

**Schema delta:** `StationMarket` adds `storageCapacity Float @default(0)` — the facility-storage sum for this `(station, good)`; seed-written, recomputed on build-out in SP5. Additive; reseed.

**Interfaces produced (later tasks/phases consume):**
- `facilityStorageForGood(buildings: Record<string, number>, goodId: string): number` — `lib/engine/industry.ts`
- `marketBand(input: MarketBandInput): MarketBand`, where `MarketBandInput = { demandRate: number; storageCapacity: number; priceFloor: number; priceCeiling: number; k?: number; anchorMult?: number }` and `MarketBand = { targetStock: number; minStock: number; maxStock: number }` — `lib/engine/market-pricing.ts`
- `MarketTickEntry` gains `minStock: number; maxStock: number`; `EconomySimParams` replaces `{ noiseAmplitude, minLevel, maxLevel }` with `{ noiseFraction: number }` — `lib/engine/tick.ts`
- Constants `EXTRACTOR_STORAGE_PER_UNIT`, `PRODUCTION_STORAGE_PER_UNIT`, `POP_CENTRE_STORAGE_DEFAULT`, `POP_CENTRE_STORAGE` (per-good map), `ECONOMY_CONSTANTS.NOISE_FRACTION` — `lib/constants/industry.ts`, `lib/constants/economy.ts`

### Task 4.1: Building storage catalog + per-good aggregation (pure)

**Files:** Modify `lib/constants/industry.ts`; Modify `lib/engine/industry.ts`; Test `lib/engine/__tests__/industry.test.ts`.

- [ ] **Step 1 — Failing test** (`industry.test.ts`): `facilityStorageForGood` sums per-good storage by building function.
```ts
import { facilityStorageForGood } from "@/lib/engine/industry";
import {
  EXTRACTOR_STORAGE_PER_UNIT, PRODUCTION_STORAGE_PER_UNIT,
  POP_CENTRE_STORAGE, POP_CENTRE_STORAGE_DEFAULT, HOUSING_TYPE,
} from "@/lib/constants/industry";

it("extractor stores its own resource good; factory stores its output", () => {
  expect(facilityStorageForGood({ ore: 3 }, "ore")).toBe(3 * EXTRACTOR_STORAGE_PER_UNIT);
  expect(facilityStorageForGood({ metals: 2 }, "metals")).toBe(2 * PRODUCTION_STORAGE_PER_UNIT);
  expect(facilityStorageForGood({ ore: 3 }, "metals")).toBe(0); // ore extractor doesn't store metals
});
it("population centres hold nominal-broad storage, generous on consumer goods", () => {
  expect(facilityStorageForGood({ [HOUSING_TYPE]: 5 }, "consumer_goods")).toBe(5 * POP_CENTRE_STORAGE.consumer_goods);
  expect(facilityStorageForGood({ [HOUSING_TYPE]: 5 }, "ore")).toBe(5 * POP_CENTRE_STORAGE_DEFAULT); // consumed staple, default
});
it("sums across a mixed build-out", () => {
  expect(facilityStorageForGood({ ore: 2, [HOUSING_TYPE]: 4 }, "ore"))
    .toBe(2 * EXTRACTOR_STORAGE_PER_UNIT + 4 * POP_CENTRE_STORAGE_DEFAULT);
});
```
- [ ] **Step 2 — Run, verify FAIL** (`npx vitest run lib/engine/__tests__/industry.test.ts`).
- [ ] **Step 3 — Implement.** Add to `lib/constants/industry.ts`:
```ts
/** Storage one tier-0 extractor adds for its own resource's good (mined on-site, held for shipment). First-draft; Phase-5 calibrated. */
export const EXTRACTOR_STORAGE_PER_UNIT = 40;
/** Storage one tier-1+ factory adds for its output good (output buffer). */
export const PRODUCTION_STORAGE_PER_UNIT = 15;
/** Nominal storage a population centre adds per good it consumes (retail/utility/government holdings). */
export const POP_CENTRE_STORAGE_DEFAULT = 2;
/** Pop-centre storage overrides for consumer-facing goods — people keep more of what they buy. */
export const POP_CENTRE_STORAGE: Record<string, number> = {
  consumer_goods: 12, food: 8, water: 8, medicine: 6, luxuries: 6, textiles: 5,
};
```
Add to `lib/engine/industry.ts`:
```ts
import {
  BUILDING_TYPES, HOUSING_TYPE,
  EXTRACTOR_STORAGE_PER_UNIT, PRODUCTION_STORAGE_PER_UNIT,
  POP_CENTRE_STORAGE, POP_CENTRE_STORAGE_DEFAULT,
} from "@/lib/constants/industry";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";

/**
 * Storage capacity the system's built buildings provide for one good — the
 * infrastructure term of maxStock. Extractors/factories store what they handle;
 * population centres hold nominal retail stock (generous on consumer goods).
 * See docs/planned/economy-relative-stock-band.md.
 */
export function facilityStorageForGood(buildings: Record<string, number>, goodId: string): number {
  let storage = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (type === HOUSING_TYPE) {
      const per = POP_CENTRE_STORAGE[goodId] ?? ((GOOD_CONSUMPTION[goodId] ?? 0) > 0 ? POP_CENTRE_STORAGE_DEFAULT : 0);
      storage += count * per;
      continue;
    }
    const def = BUILDING_TYPES[type];
    if (def?.outputGood === goodId) {
      storage += count * (def.resource ? EXTRACTOR_STORAGE_PER_UNIT : PRODUCTION_STORAGE_PER_UNIT);
    }
  }
  return storage;
}
```
- [ ] **Step 4 — Run, verify PASS.** Confirm the test loads with `DATABASE_URL` unset (no prisma import in this graph).
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P4 — building storage catalog + per-good aggregation`

### Task 4.2: `marketBand` engine (pure)

**Files:** Modify `lib/engine/market-pricing.ts`; Test `lib/engine/__tests__/market-pricing.test.ts`.

- [ ] **Step 1 — Failing test:** band derivation + the structural `maxStock > minStock` guarantee.
```ts
import { marketBand } from "@/lib/engine/market-pricing";
import { TARGET_COVER } from "@/lib/constants/market-economy";

it("demand sets anchor + reserve; storage inflates only the ceiling", () => {
  const b = marketBand({ demandRate: 4, storageCapacity: 0, priceFloor: 0.5, priceCeiling: 2.0 });
  expect(b.targetStock).toBeCloseTo(TARGET_COVER * 4);          // 160
  expect(b.minStock).toBeCloseTo(b.targetStock / 2.0);          // 80
  expect(b.maxStock).toBeCloseTo(b.targetStock / 0.5);          // 320
  const withStore = marketBand({ demandRate: 4, storageCapacity: 500, priceFloor: 0.5, priceCeiling: 2.0 });
  expect(withStore.maxStock).toBeCloseTo(b.maxStock + 500);     // storage adds to ceiling only
  expect(withStore.minStock).toBeCloseTo(b.minStock);           // ...not the reserve
});
it("maxStock > minStock structurally, even with zero storage and tiny demand", () => {
  const b = marketBand({ demandRate: 0.05, storageCapacity: 0, priceFloor: 0.5, priceCeiling: 2.0 });
  expect(b.maxStock).toBeGreaterThan(b.minStock);
});
```
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement** in `market-pricing.ts`:
```ts
export interface MarketBandInput {
  demandRate: number;
  storageCapacity: number;
  priceFloor: number;    // good.priceFloor (min price multiple)
  priceCeiling: number;  // good.priceCeiling (max price multiple)
  k?: number;
  anchorMult?: number;
}
export interface MarketBand { targetStock: number; minStock: number; maxStock: number; }

/**
 * Per-market stock band. Demand sets the price anchor (`targetStock`) and the
 * scarcity reserve (`minStock`); built infrastructure (`storageCapacity`) sets
 * the depth (`maxStock`). `maxStock > minStock` holds structurally because
 * priceFloor < priceCeiling. Callers pass an already-floored demandRate
 * (StationMarket.demandRate is floored at seed). See
 * docs/planned/economy-relative-stock-band.md.
 */
export function marketBand(input: MarketBandInput): MarketBand {
  const k = input.k ?? DEFAULT_ELASTICITY;
  const anchorMult = input.anchorMult ?? 1;
  const targetStock = TARGET_COVER * Math.max(0, input.demandRate) * anchorMult;
  const minStock = targetStock / input.priceCeiling ** (1 / k);
  const maxStock = targetStock / input.priceFloor ** (1 / k) + Math.max(0, input.storageCapacity);
  return { targetStock, minStock, maxStock };
}
```
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P4 — per-market band engine`

### Task 4.3: Relative-noise tick (per-entry band)

**Files:** Modify `lib/constants/economy.ts`; Modify `lib/engine/tick.ts`; Test `lib/engine/__tests__/tick.test.ts` (create if absent).

> **Connected refactor:** changing `MarketTickEntry` / `EconomySimParams` breaks the processor + sim callers until Tasks 4.5/4.6 update them. `tick.ts`'s own unit tests pass at the end of this task; the full suite goes green at Task 4.8. (Same shape as Phase 3's cross-cutting wiring.)

- [ ] **Step 1 — Add the constant.** In `lib/constants/economy.ts` add `NOISE_FRACTION: 0.02` to `ECONOMY_CONSTANTS` (keep `MIN_LEVEL`/`MAX_LEVEL` for now — Task 4.7 retires them once all sites migrate).
- [ ] **Step 2 — Failing test** (`tick.test.ts`): noise scales with band width; self-limiting + clamp use the per-entry band.
```ts
import { simulateEconomyTick, selfLimitingFactor } from "@/lib/engine/tick";

it("clamps to the per-entry band and scales noise to band width", () => {
  const entry = { goodId: "ore", stock: 50, minStock: 10, maxStock: 90, productionRate: 0, consumptionRate: 0 };
  const high = simulateEconomyTick([entry], { noiseFraction: 0.02 }, () => 1)[0]; // +max noise
  expect(high.stock).toBeLessThanOrEqual(90);
  expect(high.stock).toBeGreaterThan(50);                       // band-width-scaled, not ±3
});
it("self-limiting uses the entry's own min/max", () => {
  expect(selfLimitingFactor(10, 10, 90, "consume")).toBe(0);   // at floor → no consumption
  expect(selfLimitingFactor(90, 10, 90, "produce")).toBe(0);   // at ceiling → no production
});
```
- [ ] **Step 3 — Run, verify FAIL.**
- [ ] **Step 4 — Implement** in `tick.ts`:
  - Add `minStock: number; maxStock: number;` to `MarketTickEntry`.
  - Change `EconomySimParams` to `{ noiseFraction: number }` (drop `noiseAmplitude`/`minLevel`/`maxLevel`).
  - `selfLimitingFactor(value, min, max, direction)` is already per-call min/max — unchanged.
  - In `simulateEconomyTick`, read `minStock`/`maxStock` from each entry; production/consumption self-limit against them; noise becomes `(rng()*2-1) * noiseFraction * (entry.maxStock - entry.minStock) * (entry.volatility ?? 1)`; clamp to `[entry.minStock, entry.maxStock]`.
  - `buildMarketTickEntry` / `TickEntryInput` gain `minStock`/`maxStock` pass-through (resolved upstream by callers).
- [ ] **Step 5 — Run, verify PASS** (tick unit tests only).
- [ ] **Step 6 — Commit.** `feat(economy): substrate-v2 P4 — relative-noise tick on per-entry band`

### Task 4.4: Schema column, seed storageCapacity, seed stock within band

**Files:** Modify `prisma/schema.prisma`; Modify `prisma/seed.ts`; Modify `lib/constants/market-economy.ts`; Test `lib/constants/__tests__/market-economy.test.ts`.

- [ ] **Step 1 — Schema.** Add `storageCapacity Float @default(0)` to `StationMarket`. Push: `npx prisma db push`.
- [ ] **Step 2 — Failing test** (`market-economy.test.ts`): `getInitialStock` seeds inside the per-market band, and a producer (built extractors → depth) seeds deeper than a bare consumer.
```ts
import { getInitialStock, demandRateForGood } from "@/lib/constants/market-economy";
import { marketBand } from "@/lib/engine/market-pricing";
import { facilityStorageForGood } from "@/lib/engine/industry";
import { GOODS } from "@/lib/constants/goods";
import { unitResourceVector } from "@/lib/engine/resources";

it("seeds within the per-market band; producer deeper than consumer", () => {
  const pop = 800, good = "ore", producer = { ore: 6 }, consumer = {};
  const g = GOODS[good];
  const band = marketBand({
    demandRate: demandRateForGood(good, pop),
    storageCapacity: facilityStorageForGood(producer, good),
    priceFloor: g.priceFloor, priceCeiling: g.priceCeiling,
  });
  const seedProducer = getInitialStock(producer, unitResourceVector(), pop, good);
  const seedConsumer = getInitialStock(consumer, unitResourceVector(), pop, good);
  expect(seedProducer).toBeGreaterThanOrEqual(Math.floor(band.minStock));
  expect(seedProducer).toBeLessThanOrEqual(Math.ceil(band.maxStock));
  expect(seedProducer).toBeGreaterThan(seedConsumer); // producer is deeper-stocked (cheaper)
});
```
- [ ] **Step 3 — Implement.** Rewrite `getInitialStock(buildings, yields, population, goodId)` to compute the band via `marketBand({ demandRate, storageCapacity: facilityStorageForGood(buildings, goodId), priceFloor, priceCeiling })` (sourcing `priceFloor`/`priceCeiling` from `GOODS[goodId]`, `demandRate` from `demandRateForGood`/`totalDemandRateForGood`) and clamp the cover-derived seed to `[minStock, maxStock]` instead of `[STOCK_MIN, STOCK_MAX]`. In `seed.ts`, write `storageCapacity: facilityStorageForGood(systemBuildings, goodId)` per `StationMarket`.
- [ ] **Step 4 — Reseed:** `npx prisma db push && npx prisma db seed`. Expect success, no NaN.
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P4 — storageCapacity column + band-aware seed`

### Task 4.5: Thread the band through the live tick

**Files:** Modify `lib/engine/market-tick-builder.ts`, `lib/tick/world/economy-world.ts`, `lib/tick/adapters/prisma/economy.ts`, `lib/tick/processors/economy.ts`; Tests + `*.integration.test.ts`.

- [ ] **Step 1 — Failing tests:** the economy world row carries `demandRate` + `storageCapacity`; `resolveMarketTickEntry` resolves the per-market band (via `marketBand`, folding `anchorMult` into `targetStock`) onto `entry.minStock`/`maxStock`; the prisma adapter selects `storageCapacity` and computes per-good storage; the processor passes `{ noiseFraction }`.
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement:** add `demandRate`/`storageCapacity`/good `priceFloor`/`priceCeiling` to `MarketTickInput`; in `resolveMarketTickEntry` call `marketBand(...)` and set `entry.minStock`/`maxStock` (anchorMult already in hand — fold it into the band so the band tracks event shifts). Add `storageCapacity` to the economy `World` row type + the prisma adapter select/map. Change the processor's `simParams` to `{ noiseFraction: ECONOMY_CONSTANTS.NOISE_FRACTION }`.
- [ ] **Step 4 — Run, verify PASS** (unit + the economy integration test, updating its `minLevel`/`maxLevel` setup to the per-market band).
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P4 — thread per-market band through live tick`

### Task 4.6: Thread the band through the simulator

**Files:** Modify `lib/engine/simulator/world.ts`, `lib/tick/adapters/memory/economy.ts`, `lib/engine/simulator/constants.ts`, `lib/engine/simulator/bot.ts`, `lib/engine/simulator/strategies/helpers.ts`, `lib/engine/simulator/market-analysis.ts`; Tests.

- [ ] **Step 1 — Failing tests:** `SimSystem` markets carry `demandRate` + `storageCapacity` (computed via `facilityStorageForGood` from the seeded buildings); the sim economy tick applies the per-entry band + relative noise; `bot.ts`/`helpers.ts` reserve/capacity checks use the per-market `marketBand` instead of global `STOCK_MIN`/`STOCK_MAX`; `market-analysis.ts` floor/ceiling bands derive from the per-market band.
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement:** copy `demandRate`/`storageCapacity` into `SimSystem` in `createSimWorld`; thread the band into the memory adapter + sim tick entries; replace `STOCK_MIN`/`STOCK_MAX` references in `bot.ts`/`helpers.ts`/`market-analysis.ts` with per-market `marketBand(...).minStock`/`maxStock`; switch `simulator/constants.ts` economy params to `{ noiseFraction }`.
- [ ] **Step 4 — Run, verify PASS.**
- [ ] **Step 5 — Commit.** `feat(economy): substrate-v2 P4 — thread per-market band through simulator`

### Task 4.7: Thread the band through player/service consumers + retire the global band

**Files:** Modify `lib/services/trade.ts`, `lib/services/convoy-trade.ts`, `lib/services/missions.ts`, `lib/services/market-entry.ts`, `lib/services/universe.ts`, `lib/tick/adapters/prisma/events.ts`, `lib/tick/adapters/memory/events.ts`, `lib/tick/processors/trade-flow.ts`, `lib/constants/economy.ts`, `lib/constants/market-economy.ts`; Tests.

- [ ] **Step 1 — Failing tests:** buy is capped at `floor(stock − minStock)` and sell at `floor(maxStock − stock)` using the **per-market** band (a big/deep market is more liquid than a small one); the events stock clamp and trade-flow clamp use the per-market band; `STOCK_MIN`/`STOCK_MAX` and `MIN_LEVEL`/`MAX_LEVEL` no longer exist.
- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement:** at each site, derive the band from the `StationMarket` row (`demandRate`, `storageCapacity`) + `GOODS[goodId]` price clamps via `marketBand(...)`, replacing the global constants. Delete `STOCK_MIN`/`STOCK_MAX` from `market-economy.ts` and `MIN_LEVEL`/`MAX_LEVEL` from `economy.ts` (keep `NOISE_FRACTION`); grep `rg "STOCK_MIN|STOCK_MAX|MIN_LEVEL|MAX_LEVEL"` and fix every call site (including the events/trade-flow processors that pass `minLevel`/`maxLevel`).
- [ ] **Step 4 — Run, verify PASS** (unit + integration; update `economy.integration.test.ts` / `market.integration.test.ts` / `trade.test.ts` / `market-economy.test.ts` band expectations).
- [ ] **Step 5 — Commit.** `refactor(economy): substrate-v2 P4 — per-market band everywhere; drop the global [5,200] band`

### Task 4.8: Reseed + verification gate

- [ ] **Step 1 — Reseed:** `npx prisma db push && npx prisma db seed` — succeeds, no NaN.
- [ ] **Step 2 — Verify:** `npx vitest run` green; `npx tsc --noEmit` clean; `rg "\bas\b|unknown|STOCK_MIN|STOCK_MAX|MIN_LEVEL|MAX_LEVEL"` shows no new violations / no surviving global-band refs.
- [ ] **Step 3 — Smoke:** `npm run dev` — system screens load, markets trade, prices vary across systems, a low-pop producer reads *cheap and liquid* in its own good (the bug case), no NaN. `npm run simulate` runs to completion (values uncalibrated — Phase 5).
- [ ] **Step 4 — Commit** any test-fixture updates. **Open phase PR → shared branch.**

**Phase 4 gate:** full unit + integration suites green; reseed succeeds; the per-market band is the only band (no `[5,200]` globals remain); a heavy low-pop producer is cheap + liquid in its own good; `npm run simulate` completes (uncalibrated). **Open phase PR → shared branch.**

---

## Phase 5 — Calibration

**Scope:** Pure constant-tuning + docs. No structural change. Empirical — the deliverable is the tuned constant set, found by iterating the simulator. **Also absorbs the playtest-driven content/tuning notes** surfaced before the build: over-habitability (#1), food over-abundance (#2), "everything core" labelling (#6), population needs (#5b).

**Knobs (all already in constants):**
- *generation:* `SUN_CLASSES` body-count ranges + `archetypeWeights` (habitable-planet density — #1), archetype `resourceBase` weights + `generalWeight` + `habitableFraction`, `QUALITY_BANDS` weights/ranges, `VOLATILITY_CHANCE/SPIKE`, `SPACE_PER_SIZE`, `DEPOSIT_SLOT_FOOTPRINT`.
- *population:* `POP_CENTRE_DENSITY`, seed `fill` curve (`POP_FILL_*`, `PRODUCTION_SHARE`), `POP_BASELINE_FLOOR` (last resort).
- *economy / labels:* `economy-type.ts` classifier thresholds (`ECON_POP_HIGH`, …) (#6), `GOOD_CONSUMPTION` per-capita needs (#5b), `OUTPUT_PER_UNIT` overrides.
- *pricing band (Phase 4):* `TARGET_COVER`, per-good `priceFloor`/`priceCeiling`, `EXTRACTOR_STORAGE_PER_UNIT` / `PRODUCTION_STORAGE_PER_UNIT` / `POP_CENTRE_STORAGE*`, `NOISE_FRACTION`.

- [ ] **5.1** Run `npm run simulate` (all strategies, 500 ticks, seed 42); record whether markets span their per-market bands (or pin to floor/ceiling), cross-system price dispersion, greedy-vs-random spread. **Also record the playtest symptoms:** economy-label distribution (#6 — is everything "core"?), food production/abundance per system (#2), habitable-planet count per system (#1).
- [ ] **5.2 — Generation rebalance first (the dominant lever).** Cut habitable-planet density via `SUN_CLASSES` body-count ranges + `archetypeWeights` so most systems have few habitable bodies (closer to the Sol ratio — ~1 in 8, not 4–5) (#1). This cascades into food over-abundance (#2) and the "everything core" labelling (#6); finish #6 with the `economy-type.ts` classifier thresholds. Verify a healthy mix of economy types remains and food is no longer universally abundant.
- [ ] **5.3 — Economy tuning.** Tune toward the target (markets span their per-market bands with real cross-system dispersion, bots profit, greedy ≫ random). Order of levers: `TARGET_COVER` + per-good `priceFloor`/`priceCeiling` (price dynamic range) → storage constants + `NOISE_FRACTION` (depth/liquidity + jitter) → `GOOD_CONSUMPTION` per-capita needs (#5b) + `OUTPUT_PER_UNIT` (per-good supply/demand balance) → `SPACE_PER_SIZE`/`DEPOSIT_SLOT_FOOTPRINT`/`generalWeight` (extractor-vs-housing-vs-factory mix) → `POP_CENTRE_DENSITY` + `fill` (population magnitude). Touch `POP_BASELINE_FLOOR` only if pop is too swingy *and* pop-centre tuning fails first (locked decision #4).
- [ ] **5.4** Re-run the coherence script + a fresh reseed + `npm run dev` manual play. Commit the tuned constants: `perf(economy): substrate-v2 P5 — calibrate available-space + pricing-band economy`.
- [ ] **5.5** Docs: update `docs/active/gameplay/economy.md` + `system-traits.md` to the available-space model **and** the demand-priced / infrastructure-stocked band; **promote** `docs/planned/economy-substrate-v2-available-space.md` → `docs/active/gameplay/` and **fold** `docs/planned/economy-relative-stock-band.md` into `economy.md` (then delete it); update `docs/SPEC.md` "System Substrate & Traits" + the Substrate→Economy interaction line + the economy pricing summary; delete this build plan. Commit: `docs(economy): substrate-v2 P5 — promote designs to active + SPEC`.

**Phase 5 gate:** simulator hits the coarse target (markets span their bands, dispersion exists, greedy ≫ random); habitable-planet density + economy-label mix are realistic (#1/#2/#6 resolved); docs reflect reality. **Open phase PR → shared branch.**

## Phase 6 — Tick-cadence audit (design + targeted fix)

**Scope:** Resolve the economy-cadence semantics the substrate work surfaced, BEFORE the panel visualises rates. The economy processor is **round-robin — one region per tick** (`regionIndex = tick % regionCount`; regionCount = **24** default / **60** at 10K, `lib/constants/universe-gen.ts`), with **no catch-up**: a system's market updates once every `regionCount` ticks and applies exactly *one* tick's worth (`lib/tick/processors/economy.ts:52`). The simulator replicates this (`lib/engine/simulator/economy.ts:254`), so calibration is consistent — the stated rates are *per economy cycle*, not per wall-clock tick. This phase decides what (if anything) to change in the tick model; the panel (Phase 7) then reflects the decision. **Sits after calibration so the substrate is calibrated once against the chosen cadence; sits before the panel so the panel shows the final model.**

**Start with a brainstorm.** This is a design fork, not a mechanical task — when you reach this phase, invoke `superpowers:brainstorming` to settle the questions below before touching code.

### The questions to settle
1. **Bursty vs catch-up.** Keep one-tick-per-cycle (bursty: a system's stock jumps every `regionCount` ticks) and fix it purely in display (relabel + countdown), OR apply **catch-up scaling** (a region applies `×regionCount` worth when it runs) so production reads continuous and "per tick" is literal. Catch-up changes the tick → forces a re-calibration (Phase 5 redo).
2. **Cross-cadence coherence.** The economy advances per-region every `regionCount` ticks, but **trade-flow and migration sweep a work-budget slice *every* tick** over the open-edge graph — systems that feed each other run on different clocks. Measure whether the production-vs-flow balance is stable, and whether it drifts between scales (production slows as `1/regionCount` 24→60; flow slows as `1/(edges÷workBudget)` — different functions of scale).
3. **Population-signal cadence.** The population processor runs every tick but only receives fresh `dissatisfactionBySystem` for the **one** region the economy processed this tick (`economy.ts` → `economySignals`) — confirm that is intended and not starving the other regions of fresh signal.

### Tasks
- [ ] **6.1 — Brainstorm + decide.** `superpowers:brainstorming` over questions 1–3; record the decision in `docs/active/engineering/tick-engine.md` (or a short cadence design note). Output: a locked decision on catch-up vs display-only, cross-scale handling, and the population-signal behaviour.
- [ ] **6.2 — Instrument + measure.** Extend the simulator report (`lib/engine/simulator/`) to surface per-system economy-update interval, the production-vs-flow throughput ratio, and a 24-region vs 60-region comparison run. Confirm or refute the cross-scale-drift hypothesis with numbers *before* committing to a fix.
- [ ] **6.3 — Implement the decided change (if any).** If catch-up: scale the per-region application by `regionCount` inside `runEconomyProcessor` (live + sim share the body) — guard `NaN`/`Infinity`, keep production/consumption symmetric, re-check the trade-flow/migration balance. If display-only: no tick change here (handled in Phase 7).
- [ ] **6.4 — Re-calibrate if the tick changed.** If 6.3 altered the tick, redo the Phase-5 simulator pass against the new cadence (markets span their per-market bands, dispersion, greedy ≫ random) + reseed. If display-only, skip.
- [ ] **6.5 — Commit + phase PR.** `feat(economy): substrate-v2 P6 — tick-cadence <decision>`.

**Phase 6 gate:** the cadence model is decided + documented; simulator (and any re-calibration) green; the per-system cycle behaviour the panel will show is final.

---

## Phase 7 — UI revisit: system screens + map + panel redesign + cadence display

**Scope:** Surface the finished model across the **whole UI it touched — the system screens (astrography / industry / population panels) AND the galaxy map.** Read services + panel show available-vs-built headroom, deposit slots + quality bands (using `bandForMultiplier`/`depositDisplayName`), the habitable/general space partition, population-as-land, and **the per-market band** (stock vs its reserve/ceiling, infrastructure depth) — plus the **honest cadence display** decided in Phase 6. Also handles the **undeveloped/uninhabited systems** the barren-but-alive model created (P5), the **fractional-population display**, and **map representation of uninhabited systems** (economy-type colour/label for a system that has a substrate label but no real economy). Clears the display-bug notes (#5a, #7, #8). The current UI keeps working until replaced.

- [ ] **7.1** Extend the substrate read service (`lib/services/universe.ts` `getSystemSubstrate`) to return per-body slots + quality bands + spaces and per-system slot caps + yields + available/general/habitable space + built-vs-available headroom. Type the response in `lib/types/`; validate union fields with guards. (Tasks expand to bite-sized at execution.)
- [ ] **7.2** Update the industry read service (`getSystemIndustry`) for the available-space headroom (built ≤ available per use).
- [ ] **7.3** Redesign the Astrography substrate tab + Industry panel (`components/system/*`): a space-partition bar (deposits / habitable / general-built / headroom), deposit rows with band-coloured quality, population-centre land use, supply-chain throttle (unchanged). Foundry theme; `font-mono` numerics; existing `components/ui` primitives; `QueryBoundary`.
- [ ] **7.4 — Cadence display (from Phase 6).** If display-only: relabel production/consumption as **per economy cycle** (not per tick) and add a per-system **"next economy update in N ticks"** countdown (derive from `tick % regionCount` + the system's region index; expose via the industry read service or a small tick-aware hook — countdown is tick-derived, not a new fetch). If Phase 6 chose catch-up: present continuous per-tick rates instead. Foundry theme; `font-mono` numerics.
- [ ] **7.5 — Display-bug fixes (playtest notes #5a, #7, #8).**
  - **#5a — demand footprint truncated.** `lib/services/system-population.ts` slices `demandFootprint` to `DEMAND_FOOTPRINT_LIMIT`, dropping mid-pack goods (e.g. `consumer_goods`). Raise/remove the limit or make the panel list scrollable so the full consumption footprint shows.
  - **#7 — stability label mismatch.** `lib/utils/stability.ts` `stabilityLabel(unrest)` is fed/labelled inconsistently (a value shown as "Stability 0.30" reads "Calm"). Trace the call site (`components/system/*`), confirm whether it passes *unrest* or *stability* (= 1 − unrest), and fix the axis/wiring so the number and the word agree.
  - **#8 — supply-chain throttle always 0% (PRE-EXISTING, surfaced in P4 smoke 2026-06-21).** `getSystemIndustry` (`lib/services/universe.ts`) keys `marketStock` by the Good **CUID** (`marketStock[row.goodId] = row.stock`) but `buildIndustryReadout` (`lib/engine/industry.ts`) indexes it by good **key** (`stockOf("ore")` from `outputGood`/`GOOD_RECIPES`). Lookup never matches → every good falls back to `minLevel` → `drawable = 0` → `inputGate = 0` for ALL tier-1+ goods, so the Industry tab shows everything throttled regardless of real stock. Production is UNAFFECTED (the live tick maps correctly via `GOOD_NAME_TO_KEY` in `adapters/prisma/economy.ts:101`); display only. Fix in the panel rebuild: select `good.name` and map CUID→key (mirror the tick adapter) before keying `marketStock`. While here, replace the flat `minLevel` floor (currently a hardcoded `5`, lifted from the retired global band) with each good's per-market `minStock` so the throttle reflects the real band.
- [ ] **7.6 — Undeveloped/uninhabited systems + fractional population (P5 smoke notes, 2026-06-21).** The barren-but-alive model produces (a) ~2% genuinely **undeveloped** systems (popCap 0 → no buildings, no population, substrate-only) and (b) a band of **tiny outposts** with fractional populations.
  - **System screen:** for an undeveloped system, show an honest "undeveloped — deposits present, no industry/population" state and **hide or relabel the irrelevant tabs** (industry/economy/population). Astrography still shows the deposits (the colonisation hook). Preserve visibility-gating.
  - **Fractional-population display:** population is now a continuous magnitude (`pop 0.3` … `pop 12,567`) — format it readably (units/abbreviation), never a bare `0.3000001`; a true `0` reads as "uninhabited".
  - **Map:** decide how to colour/label **uninhabited & undeveloped** systems by economy type — a system can carry a substrate-derived economy-type label (e.g. "extraction") yet have no population/economy; the map needs a clear visual for "labelled potential, not yet developed" vs a live economy. Keep in-transit ship markers always-on (existing decision).
- [ ] **7.7** Any other UI polish surfaced during the milestone.
- [ ] **7.8** Commit per component. Phase PR → shared branch.

**Phase 7 gate:** system screens + map render the real substrate + per-market band + honest cadence; undeveloped systems read as undeveloped (irrelevant tabs hidden, deposits still shown) and fractional populations display readably; the map clearly distinguishes labelled-but-undeveloped from live-economy systems; #5a/#7/#8 fixed; visibility-gating preserved (unsurveyed → `{ visibility: "unknown" }`); static vs tick-dynamic split preserved (substrate `staleTime: Infinity`, industry tick-invalidated; the countdown is tick-derived, not a new query).

---

## Final integration

After Phase 7: open the **single final PR** `feat/economy-substrate-v2` → `main` (squash if phase-commit subjects carry `Pn` noise, else ff for clean atomic history — per the clean-history convention). Verify `main` reseeds + plays. Delete the shared + phase branches and this build plan.

---

## Self-review — spec coverage

| Spec requirement (design doc §) | Task(s) |
|---|---|
| Total space from size only (`SPACE_PER_SIZE × size`) | 1.1, 1.3, 3.1 |
| Archetype weight vector incl. `general` + habitable fraction | 1.2, 1.3 |
| Deposit slots dedicated per resource; partition not sequential | 1.3, 2.3 |
| Quality bands (poor/avg/good/rich × yield) | 1.1, 1.4, 2.3 |
| Volatility extreme | 1.3 |
| Generated generic deposit names; richness retired | 1.4, 3.5 |
| Per-system aggregation (slot cap + effective-yield mult) | 2.3, 3.2 |
| Tier-0 production × yield (one tick term) | 3.1, 3.4 |
| Population full-fold (no baseline; floor=0) | 1.5, 3.1, 3.2 |
| Built ≤ available headroom | 3.2, 7.1 |
| Reseed (×3) | 2.4, 3.5, 4.8 |
| **Pricing band** — demand anchor + reserve (`minStock`) | 4.2, 4.5 |
| **Pricing band** — infrastructure ceiling (`maxStock` = headroom + Σ building storage) | 4.1, 4.2, 4.4 |
| **Pricing band** — per-building storage (extractor/factory/pop-centre/depot) | 4.1 |
| **Pricing band** — relative noise (`NOISE_FRACTION` × band width) | 4.3 |
| **Pricing band** — retire global `[5,200]`; per-market band everywhere | 4.5, 4.6, 4.7 |
| **Pricing band** — `storageCapacity` column + band-aware seed | 4.4 |
| Calibration to coarse target | 5.1–5.3 |
| Playtest notes — over-habitability / food-abundance / labels / pop-needs (#1/#2/#6/#5b) | 5.1–5.3 |
| Playtest notes — demand-footprint limit / stability label (#5a/#7) | 7.5 |
| Tick-cadence audit (bursty/catch-up, cross-cadence, pop-signal) | 6.1–6.4 |
| Honest cadence display (relabel + countdown) | 7.4 |
| Panel visualises final model | 7.1–7.3 |
| Docs planned→active + SPEC | 5.5 |
