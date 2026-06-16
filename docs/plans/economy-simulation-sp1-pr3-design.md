# Economy Simulation — SP1 PR3: Rebuild + Reseed (design)

> Design for **PR3** of SP1 Part 1 of the [Economy Simulation Vision](../planned/economy-simulation-vision.md) /
> [SP1 Substrate spec](../planned/economy-simulation-substrate.md). PR1 (foundation) and PR2 (detach consumers)
> have shipped to the shared `feat/economy-simulation` branch. This doc settles the open forks the substrate
> spec deferred to "the build plan" (§12 + the foundation plan's PR3 roadmap) and is the design the PR3
> executable build plan hangs off. **Delete this doc (and the PR3 build plans) when SP1 ships to `main`.**

Read the [substrate spec](../planned/economy-simulation-substrate.md) first — this doc assumes its model
(sun → bodies → resource vectors → features, abstract population, derived economy-type shim) and only resolves
the concrete forks + the per-PR scope.

---

## 1. Goal

Replace trait-based generation with **sun → bodies → features → population**, persist it, full reseed, and run
the economy via the derived **economy-type shim** — so the game plays a coherent, healthy economy on the new
physical substrate while the economy *engine* stays untouched (Part 2 rewires it). After PR3, "Part 1" is done
(substrate spec §11).

PR1 already added every column this needs (`SystemBody`, `StarSystem.sunClass/population/popCap/agg*`), so PR3a
writes to existing schema — **no new migration** until PR3b's danger column.

---

## 2. Resolved decisions (this design's forks)

| Fork | Decision | Why |
|---|---|---|
| **PR slicing** | **2 PRs: PR3a (build + reseed) → PR3b (prune + reconnect)** | PR3a is purely additive "build the new universe & keep it running"; PR3b is the breaking "remove old scaffolding". Each holds full convention context (project 2–4-phase-PR convention). |
| **Sun-class rolls** | **IID per system** (weighted) | Food/garden-world producers sprinkle evenly across regions — the safe default for trade gameplay; minimizes catastrophic regional staple starvation. Regional correlation is a later evocative-geography polish. |
| **Economy acceptance bar** | **Coherent + healthy** (substrate-derived, not byte-identical) | Generation changes the economy-type distribution, so byte-parity is impossible (same posture as PR2). Tune `SUN_CLASSES` weights to pass the **resource-mix gate** rather than reproducing today's distribution (which Part 2 deletes anyway). |
| **Danger-from-bodies timing** | **PR3b** | Keeps PR3a a clean additive build; the window where volcanic systems lack environmental danger lives only on the shared branch (never player-visible), and PR3b regroups all body-reconnection work + the danger schema column together. |
| **Feature count** | **0–2 uniform** (drop the guaranteed-affinity first roll) | Features now carry no economy role, so special sites (ruins, anomalies, pirate strongholds) and survey/recon/salvage missions *should* be rare and noteworthy. Fallback to 1–3 if the mission-supply gate flags scarcity. |
| **Trait production bonus** | **Retire in PR3b** | `features carry no economy role` (spec §4.2). Part-1 economy becomes economy-type-flat (same-type systems produce identically modulo noise/events); per-system production richness returns in Part 2 from body resource magnitudes. Geographic variety still comes from the substrate-derived economy-type label. |

---

## 3. Generation algorithm (per system) — concrete

Lives in a new pure module `lib/engine/body-gen.ts` (sun/body/feature/population rolls + aggregate), called by a
rewritten `generateSystems` in `lib/engine/universe-gen.ts`. The economy-type shim lives in its own module
`lib/engine/economy-shim.ts` for a clean Part-2 deletion boundary. The connection/region/faction/gateway
generation is **unchanged** (SP1 touches what a system is *made of*, not the graph topology).

```
for each system:
  1. sunClass        = weightedPick(SUN_CLASSES[*].weight)          [IID per system]
  2. bodyCount       = randInt(sun.bodyCount.min, sun.bodyCount.max) (sun is the column, not a SystemBody row)
  3. per body:
       archetype     = weightedPick(sun.archetypeWeights)
       size          ∈ [0.5, 1.5] uniform, mean 1.0                 [TUNE]
       resourceBase  = makeResourceVector: each type = BODY_ARCHETYPES[arch].resourceBase[type] × size × jitter
                       jitter = 1 ± 0.25 [TUNE]; zero-base types stay zero (archetypes stay recognizable)
       richness      = with prob 0.18 [TUNE], pick one RICHNESS_MODIFIERS entry (weighted by rarity) whose
                       target resource is non-zero on this body; multiply that resource × modifier.multiplier;
                       push id to richnessModifiers[] (≤1 per body in PR3a)
       popCapWeight  = BODY_ARCHETYPES[arch].popCapWeight × size
  4. aggregate       = Σ body resourceBase   → agg* columns
     popCap          = Σ body popCapWeight × POP_SCALE (POP_SCALE = 100 [TUNE], abstract magnitude)
  5. population       = round(popCap × fill)
       fill           = clamp(0.1 + 0.6·popNorm + (rng−0.5)·0.2, 0.05, 0.9)        [TUNE]
       popNorm        = clamp(popCap / POP_REF, 0, 1)                              [TUNE]
       → frontier rocks seed near-empty; developed cores seed near (under) cap. Static in Part 1.
  6. features         = 0–2 uniform [TUNE], picked uniformly from the 31 survivors (no guaranteed-affinity roll),
                        quality per QUALITY_TIERS.rarity. Fallback band 1–3 if mission-supply gate flags scarcity.
  7. economyType      = deriveEconomyTypeLabel(aggregate, population)   [the shim, §4]
```

**`GeneratedSystem`** gains `sunClass`, `bodies: GeneratedBody[]`, `aggregate: ResourceVector`, `popCap`,
`population`.
**`GeneratedBody`** = `{ bodyType: BodyArchetypeId; habitable: boolean; size: number; resourceBase:
ResourceVector; popCapWeight: number; richnessModifiers: RichnessModifierId[] }`.

The substrate generation is shared with the **simulator** (it already calls `generateUniverse` in
`lib/engine/simulator/world.ts:59`), so the synthetic world carries the new bodies + shim economy-type for free —
no separate sim modelling in Part 1 (substrate spec §9).

---

## 4. Economy-type shim — `deriveEconomyTypeLabel(aggregate, population)`

A single pure function returning one of the 6 `EconomyType` values, keeping `getInitialStock`,
`ECONOMY_PRODUCTION/CONSUMPTION`, the economy tick, the sim world, and `Region.dominantEconomy` working
**unchanged**. Ordered heuristic over resource shares + population **[TUNE thresholds]**:

- high population + balanced resource mix → `core`
- high population + raw-input-heavy (ore/minerals/gas/radioactive) → `industrial`
- high population + low raw resources → `tech`
- arable/biomass-dominant → `agricultural`
- ore/minerals/gas/radioactive-dominant → `extraction`
- mixed raw + moderate population → `refinery`
- zero-aggregate fallback → `extraction` (matches today's `deriveEconomyType` fallback)

Tuned against `npm run simulate` to yield a sane 6-type distribution **and** enough `core` near map-center so
`selectStartingSystem` / `scoreHomeworldCandidate` (`faction-gen.ts:237-238`) still find a good spawn. **Deleted
in Part 2**, when production/consumption derive from bodies + population directly.

---

## 5. Persistence helpers (PR3a)

- **Column↔vector bridge** in `lib/engine/resources.ts` (now has callers): `bodyResourceColumns(v)` →
  `{ resGas, … }`, `aggregateColumns(v)` → `{ aggGas, … }`, `resourceVectorFromColumns(row)`,
  `sumResourceVectors(...)`.
- **DB guards** in `lib/types/guards.ts`: `toSunClass`, `toBodyArchetypeId`, `toResourceType`,
  `toRichnessModifierId` — for reading `SystemBody.bodyType` / `StarSystem.sunClass` /
  `SystemBody.richnessModifiers[]` back from the DB.
- **Seed rewrite** (`prisma/seed.ts`) — **batched**, fixing the existing per-system `await create` N+1 loop
  (the roadmap's "batch the market seed writes too" → yes):
  1. `createManyAndReturn` `StarSystem` rows (economyType, x/y, region, isGateway, description, **sunClass,
     population, popCap, agg***) → ids.
  2. `createManyAndReturn` `Station` rows (systemId) → station ids.
  3. `createMany` `StationMarket` (flatten systems × goods, `getInitialStock(econ, good)`).
  4. `createMany` `SystemBody` (systemId, bodyType, habitable, size, **res***, popCapWeight, richnessModifiers).
  5. `createMany` `SystemTrait` (feature rows only).
  Full reseed. (Seed runs outside a transaction so the 30s PG ceiling doesn't apply, but 10K sequential awaits
  are slow — batching matters at scale; see MEMORY "Batch all DB writes".)

---

## 6. PR3a scope — Build the new universe & keep it running (additive)

New / rewritten:
- `lib/engine/body-gen.ts` (+ test) — sun/body/feature/population rolls + aggregate.
- `lib/engine/economy-shim.ts` (+ test) — `deriveEconomyTypeLabel`.
- `lib/engine/resources.ts` — bridge helpers (+ test additions).
- `lib/types/guards.ts` — 4 substrate guards.
- `lib/engine/universe-gen.ts` — rewritten `generateSystems` (calls body-gen + shim); extended `GeneratedSystem`;
  rewritten `universe-gen.test.ts` assertions (sun-gated bodies, populated, resource-bearing).
- `prisma/seed.ts` — batched substrate persistence + full reseed.
- `lib/engine/trait-gen.ts` — remove `generateSystemTraits`, `deriveEconomyType`, `STRONG_AFFINITY_TRAIT_IDS`;
  **keep** `GeneratedTrait`, `computeTraitProductionBonus`, `computeTraitDanger` (the trait catalog is still full).

Untouched in PR3a (proves "keep running"): the `TRAITS` catalog + `TraitId` union, `LOCATIONS`, the economy
engine / tick / adapters, `computeSystemDanger`. Economy plays via the shim.

## 7. PR3b scope — Prune + reconnect to bodies (breaking)

- **Narrow `TraitId`** (`lib/types/game.ts`) to the 31 features; delete archetype/richness `TRAITS` entries
  (`lib/constants/traits.ts`); strip `economyAffinity` + `productionGoods` from `TraitDefinition`.
- **Retire `computeTraitProductionBonus`** (`trait-gen.ts:85-97`) + its market-tick call (`tick.ts:135`); update
  `trait-gen.test.ts`.
- **Rewire exploration locations** (`lib/constants/locations.ts`): `deriveSystemLocations` reads **bodies +
  features** instead of `traitRequirement: TraitId[]`. Body archetype → site (asteroid_belt → asteroid field,
  gas_giant → gas platform, habitable/garden/ocean/jungle/volcanic/frozen/arid → planet surface), richness →
  mining outpost, features → research/ruins/salvage/anomaly/smuggler sites. Plumb the system's bodies to the
  explore page (`explore/page.tsx:85-89`); rewrite `locations.test.ts:148-164`.
- **Danger from bodies**: add a denormalized danger column on `StarSystem` (small additive migration), populate
  at seed from `Σ BODY_ARCHETYPES[body.bodyType].dangerBaseline`, and add it inside `computeSystemDanger`
  (`lib/engine/danger.ts`) alongside the existing feature-danger + event + government terms.
- **Docs**: update `docs/active/gameplay/system-traits.md` (two-layer bodies/features model) + map docs; move the
  substrate spec `planned → active` per the SPEC lifecycle.

---

## 8. Verification gates

**PR3a**
- `npx vitest run` full suite green (rewritten generation/shim tests).
- `npx tsc --noEmit` + `npm run build` clean.
- `npx prisma db push` (no-op — columns exist) + full reseed succeed; `SystemBody` rows + `agg*`/`population`/
  `sunClass` populated.
- Generated universe **coherent**: sun-gated body sets, every system populated + resource-bearing, visible
  developed-core-vs-raw-frontier geography.
- `npm run simulate` **healthy** (not byte-identical).
- **Resource-mix gate**: every tier-0 resource adequately produced galaxy-wide; no region catastrophically
  starved of a staple (especially arable → food). Re-tune `SUN_CLASSES` weights if it fails. *Some* regional
  scarcity is wanted (it drives the need-cascade trade loop) — the gate only catches the pathological extreme.
- Mission/danger volumes sane (danger here is feature-only — body danger lands in PR3b).

**PR3b**
- `TraitId` narrow compiles (LOCATIONS rewired, `computeTraitProductionBonus` gone, fields stripped).
- Tests updated/green; build clean.
- `npm run simulate` still healthy with the trait-production-bonus retired.
- Danger now body-driven (volcanic systems regain environmental danger); mission volumes sane.

---

## 9. Open tuning knobs (defaulted here, calibrated via simulator)

Marked **[TUNE]** above; surfaced as constants in `lib/constants/` for the build plan to tune emergently:
`size` band [0.5, 1.5], resource `jitter` ±0.25, richness chance 0.18, `POP_SCALE` 100, `POP_REF` /
population `fill` curve, feature count band 0–2 (fallback 1–3), and the §4 shim thresholds. Population
*magnitude* is intentionally rough in Part 1 (nothing consumes it yet — it only feeds the shim and is static);
absolute calibration with per-capita rates is Part 2.

---

## 10. Out of scope (deferred)

No economy-engine change (Part 2), no pricing change (Part 3), no population growth/consequence loop (SP2), no
facilities/build-space (SP3), no event physical-perturbation redesign (SP4), no regional sun correlation, no
per-body survey targets / hazards (later polish). The PR3a and PR3b executable build plans are authored
separately (PR3a now; PR3b after PR3a ships, per the foundation plan's "each plan authored after the prior
ships" pattern).
