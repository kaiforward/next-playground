# Economy Simulation — SP1 PR3b: Prune + reconnect to bodies (build plan)

> **Executable build plan** for PR3b — the last PR of SP1 Part 1. Hangs off the settled design
> `economy-simulation-sp1-pr3-design.md` §7 (read that first for the *why*; this doc is the *how*).
> **Branch**: `feat/economy-simulation-pr3b` (already created off the shared `feat/economy-simulation`,
> which includes the merged Astrography UI PR #93).
> **Delete this doc when SP1 ships to `main`.**

PR3b is the **breaking** half of PR3: it removes the trait-based scaffolding PR3a kept alive and reconnects
exploration + danger to the new physical substrate. PR3a (build + reseed, #92) and the Astrography UI (#93)
have shipped to the shared branch.

---

## Pre-flight — what is already done (do NOT redo)

- **DB read-back helpers shipped in #93** (the substrate's first DB reader): `resourceVectorFromColumns(source, prefix)`
  in `lib/engine/resources.ts`, and guards `toSunClass` / `toBodyArchetypeId` / `toRichnessModifierId` in
  `lib/types/guards.ts`. **`toResourceType` is NOT needed** — resource types come from the keyed column bridge,
  never validated per-row. Drop it from scope.
- **`useSystemSubstrate(systemId)` hook shipped in #93** → returns `{ visibility: "visible", …, bodies: BodyView[] } | { visibility: "unknown" }`.
  `BodyView` carries `bodyType: BodyArchetypeId`, `richness: RichnessModifierView[]`, resources, etc. **Phase 3 uses
  this hook to plumb bodies into the explore page.**
- **`BODY_ARCHETYPES[*].dangerBaseline` values already exist** (`lib/constants/bodies.ts`): `volcanic_world` = `0.05`,
  all others = `0`. Phase 2 only needs to *sum and persist* them.
- **Authoritative trait split** lives in `lib/constants/trait-migration.ts`: **8 archetype + 13 richness + 31 feature = 52**.

## Ordering invariant

Narrowing `TraitId` / deleting `TRAITS` entries breaks the build until every consumer is gone, so **retire
consumers first (Phases 1–3), narrow the union last (Phase 4)**. Each phase = one commit and must compile + pass
tests on its own. Phases 1 and 2 are independent of the union; Phase 3 removes the last archetype/richness `TraitId`
dependency; Phase 4 is then a clean compile.

---

## Phase 1 — Retire `computeTraitProductionBonus`

**Goal**: remove the trait production multiplier (Part 2 re-derives production from body resources). Economy keeps
playing via the economy-type shim. Independent of the union.

**Edits**
- `lib/engine/trait-gen.ts` — delete `computeTraitProductionBonus` (currently **lines 22–34**). **KEEP**
  `GeneratedTrait` (11–14) and `computeTraitDanger` (45–54). No imports become unused (`TRAITS`, `QUALITY_TIERS`
  are still used by `computeTraitDanger`).
- `lib/engine/tick.ts`:
  - Delete the value import on **line 15**: `import { computeTraitProductionBonus } from "@/lib/engine/trait-gen";`
    **KEEP** the type import on line 14 (`import type { GeneratedTrait }` — used by `TickEntryInput.traits`, line 118).
  - At **lines 135–137**, collapse:
    ```ts
    const traitBonus = computeTraitProductionBonus(input.traits, input.goodId);
    const productionBeforeProsperity =
      input.baseProductionRate != null ? input.baseProductionRate * (1 + traitBonus) : undefined;
    ```
    to:
    ```ts
    const productionBeforeProsperity =
      input.baseProductionRate != null ? input.baseProductionRate : undefined;
    ```
  - **Check**: after this, is `input.traits` referenced anywhere else in `tick.ts`? Danger is computed in the
    processors via `computeTraitDanger`, not in `tick.ts`. If `input.traits` is now unused in `tick.ts`, leave the
    field on `TickEntryInput` (other callers/danger still need it) but confirm no dead local destructuring remains.
- `lib/engine/__tests__/trait-gen.test.ts` — delete the `describe("computeTraitProductionBonus")` block
  (**lines 17–45**). **KEEP** `describe("computeTraitDanger")` (47/55–101).

**Verify**
- `npx vitest run lib/engine` green.
- `npm run simulate` — economy still **healthy** (production now flat per economy-type via the shim; this is the
  intended Part-1 posture, not a regression).

---

## Phase 2 — Danger from bodies

**Goal**: environmental danger comes from a system's bodies. Add a denormalized `bodyDanger` column, populate it at
generation/seed, and fold it into `computeSystemDanger`. Additive + independent of the union.

**Schema** (`prisma/schema.prisma`, `StarSystem` model ~lines 195–245)
- Add `bodyDanger Float @default(0)` after the `agg*` block (~line 219), before the `bodies` relation.
- `npx prisma db push` (additive column; no destructive migration). Full reseed at the end of the phase.

**Generation — single source of truth for the sum** (recommended)
- Add `bodyDanger: number` to `GeneratedSystem` (in `lib/engine/universe-gen.ts`), computed as
  `Σ BODY_ARCHETYPES[body.bodyType].dangerBaseline` over the system's generated bodies. This way **both** the seed
  (writes the column) and the **simulator** (reads it in-memory) share one computation — the simulator's
  `economy.ts` danger caller has no DB column to read.
  - *Alternative (simpler, but duplicates the sum)*: compute only at seed and have the simulator sum inline. Prefer
    the `GeneratedSystem` field. **[DECISION — confirm at build]**
- Update `universe-gen.test.ts` to assert `bodyDanger` is present and equals the body-baseline sum (volcanic-bearing
  systems > 0, others 0).

**Seed** (`prisma/seed.ts`, `StarSystem` `createManyAndReturn` ~lines 149–168)
- In the `data: batch.map((sys) => ({ … }))`, add `bodyDanger: sys.bodyDanger` (if computed on `GeneratedSystem`),
  or `bodyDanger: sys.bodies.reduce((s, b) => s + BODY_ARCHETYPES[b.bodyType].dangerBaseline, 0)` (seed-only path,
  needs `import { BODY_ARCHETYPES } from "@/lib/constants/bodies"`).

**Engine** (`lib/engine/danger.ts`, `computeSystemDanger` lines 131–141)
- Add a 4th param `bodyDanger: number`; include it in the clamped sum (line 137):
  ```ts
  export function computeSystemDanger(
    modifiers: ModifierRow[],
    govBaseline: number,
    traitDanger: number,
    bodyDanger: number,
  ): number {
    return clamp(
      aggregateDangerLevel(modifiers) + govBaseline + traitDanger + bodyDanger,
      0,
      DANGER_CONSTANTS.MAX_DANGER,
    );
  }
  ```
- Update `danger.test.ts` for the new param (add a body-danger term case; thread `0` where unchanged).

**Thread `bodyDanger` through the 4 callers** — each assembles danger inputs per system; each must now surface the
system's `bodyDanger`. **Trace each caller's system-data source and ensure the column is selected / the
World view exposes it.**
1. `lib/tick/processors/ship-arrivals.ts:114` — the processor's World loads destination systems; add `bodyDanger` to
   that selection (Prisma adapter `select`, memory adapter from the generated system) and pass it.
2. `lib/tick/processors/missions.ts:137` — same, for the region's systems.
3. `lib/engine/simulator/economy.ts:96` — in-memory; read `system.bodyDanger` off the generated system.
4. `lib/services/missions-v2.ts:462` — select `bodyDanger` on the destination system row and pass it.
   - *Note*: there is **no dedicated danger adapter** — these are independent assembly sites, so check each World
     interface / Prisma `select` / memory adapter that feeds them. Where a `World` type is involved
     (`lib/tick/world/*`), add `bodyDanger` to the system view and both adapters (`adapters/prisma`, `adapters/memory`).

**Verify**
- `npx prisma db push` + full reseed succeed; spot-check a volcanic-bearing system has `bodyDanger > 0`.
- `npx vitest run` green (danger + processor tests updated).
- `npm run simulate` healthy; **volcanic systems regain environmental danger**; mission/danger volumes sane.

---

## Phase 3 — Rewire `deriveSystemLocations` to bodies + features

**Goal**: exploration sites derive from a system's **bodies (archetype + richness)** + **feature traits**, not
`traitRequirement: TraitId[]`.

**`lib/constants/locations.ts`**
- Remove `traitRequirement: TraitId[] | null` from `LocationDefinition` (line 36) and the `TRAIT_TO_LOCATION` map.
  Station locations (`cantina`, `docking_bay`, `market_hall`, `repair_bay`) stay always-on.
- Change `deriveSystemLocations` (lines 276–315) signature to take bodies + features:
  `deriveSystemLocations(bodies: BodyView[], features: EnrichedTrait[]): DerivedLocation[]`.
- **Site derivation map** (preserves the current feature gating; archetype/richness move to body-derived):

  | Source | → Site |
  |---|---|
  | body `asteroid_belt` | `asteroid_field` |
  | body `gas_giant` | `gas_harvesting_platform` |
  | body `garden_world`/`ocean_world`/`jungle_world`/`arid_world`/`volcanic_world`/`frozen_world`/`barren_rock` | `planet_surface` |
  | any body richness modifier (13 ids) | `mining_outpost` |
  | feature `tidally_locked_world` | `planet_surface` |
  | feature `ancient_minefield`/`captured_rogue_body` | `asteroid_field` |
  | feature `crystalline_formations`/`geothermal_vents` | `mining_outpost` |
  | feature `lagrange_stations`/`deep_space_beacon`/`orbital_ring_remnant` | `orbital_platform` |
  | feature `exotic_matter_traces`/`gravitational_anomaly`/`signal_anomaly`/`xenobiology_preserve`/`bioluminescent_ecosystem`/`pulsar_proximity` | `research_station` |
  | feature `precursor_ruins`/`colonial_capital`/`seed_vault` | `ruins_expedition` |
  | feature `generation_ship_wreckage`/`derelict_fleet`/`abandoned_station`/`shipbreaking_yards` | `salvage_yard` |
  | feature `subspace_rift`/`nebula_proximity`/`dark_nebula`/`ion_storm_corridor`/`solar_flare_activity`/`binary_star` | `anomaly_site` |
  | feature `pirate_stronghold`/`smuggler_haven`/`ancient_trade_route`/`free_port_declaration` | `smuggler_den` |

  **Semantic shifts to confirm [DECISION]**: under the bodies+features model, richness modifiers (incl. the old
  `fertile_lowlands`/`coral_archipelago`, which used to gate `planet_surface`) now gate `mining_outpost`, while
  `planet_surface` comes from the habitable body itself. This is intended (the body *is* the planet; richness *is* the
  extraction site) — verify it reads well on the explore page.
- **Quality for body/richness-derived sites [DECISION]**: bodies have `size`/`popCapWeight` but no `QualityTier`,
  and richness has a `multiplier`. Feature-derived sites keep their trait quality tier as today. Decide how
  body/richness sites present: simplest is **no quality tier** (omit `quality`/`qualityLabel`), or map richness
  `multiplier` → a pseudo-tier. Pick the minimal option that keeps `DerivedLocation` honest; keep the
  highest-"quality" dedup rule for feature-derived sites.

**Explore page** (`app/(game)/@panel/system/[systemId]/explore/page.tsx`, call site lines 82–89)
- Today: `deriveSystemLocations(enrichTraits(systemInfo.traits))`.
- New: also read bodies via `const substrate = useSystemSubstrate(systemId)`; pass
  `substrate.visibility === "visible" ? substrate.bodies : []` plus `enrichTraits(systemInfo.traits)` (now only
  features, post-narrowing). `useSystemSubstrate` **suspends** — ensure the call sits inside a `QueryBoundary`
  (the page/panel already wraps content; confirm). Handle the `"unknown"` (unsurveyed) case → no body-derived sites.

**Tests** (`lib/constants/__tests__/locations.test.ts`, current ~lines 18–164)
- Rewrite the trait-driven cases to body+feature-driven: stations always present; a body archetype yields its site;
  a richness modifier yields `mining_outpost`; a feature yields its mapped site; dedup keeps the best per location.
- Replace the "all 52 traits map" coverage test (148–164) with: all 9 body archetypes + all 13 richness modifiers +
  every feature trait map to a valid site (no orphans).

**Verify**: `npx vitest run lib/constants` green; explore page renders sensible sites for visible systems.

---

## Phase 4 — Narrow `TraitId` (the breaking cleanup, last)

**Goal**: `TraitId` = the 31 features only; archetype/richness become *purely* `BodyArchetypeId`/`RichnessModifierId`.

**Edits** (use `lib/constants/trait-migration.ts` as the authoritative delete/keep list)
- `lib/types/game.ts` — narrow the `TraitId` union (lines 21–78): delete the **8 archetype** + **13 richness**
  members, keep the **31 features**.
- `lib/constants/traits.ts`:
  - `TraitDefinition` (lines 10–24): remove `economyAffinity` (line 15) and `productionGoods` (line 17). Feature
    defs keep `id`, `name`, `category`, `descriptions`, `dangerModifier?`, `negative?`.
  - `TRAITS` catalog: delete the **21 archetype/richness** entries; strip `economyAffinity` + `productionGoods` from
    the **31 feature** entries.
- `lib/types/guards.ts` — shrink the `TRAIT_IDS` set (lines 63–88) to the 31 features. `toTraitId` auto-narrows; no
  signature change. (`isTraitId` does not exist and isn't needed.)
- `lib/engine/__tests__/universe-gen-invariants.test.ts` — **delete** the affinity-balance test that iterates
  `def.economyAffinity` (~line 158 / block ~152–174); affinity-driven economy derivation is gone (the shim replaced it).
- `lib/constants/trait-migration.ts` — after narrowing, check whether it still has any runtime consumer. If it's now
  orphaned (only referenced by docs/the now-deleted paths), **delete it** (no-orphaned-code convention). **[DECISION]**

**Blast-radius audit (must all be resolved by end of Phase 4)** — full list of `economyAffinity`/`productionGoods`
+ archetype/richness-`TraitId` consumers found:
- `trait-gen.ts` `computeTraitProductionBonus` → removed in Phase 1.
- `locations.ts` `traitRequirement` arrays → rewired in Phase 3.
- `universe-gen-invariants.test.ts` affinity test → deleted here.
- `traits.ts` defs + `TraitDefinition` type → stripped here.
- `guards.ts` `TRAIT_IDS` → narrowed here.
- (`bodies.ts`, `missions.ts`, `schema.prisma` reference archetype/richness as *body* concepts — **no change**.)

**Verify**: `npx tsc --noEmit` **clean**, `npm run build` clean, `npx vitest run` full suite green,
`npm run simulate` healthy (production-bonus retired).

---

## Phase 5 — Docs

- `docs/active/gameplay/system-traits.md`: strip `economyAffinity`/`productionGoods` from §1 (lines 24–26); replace
  §2 "Trait-to-Economy Derivation" with the **body-driven** model (economy type from `deriveEconomyTypeLabel` over
  bodies + population) and a "features are narrative-only (quality, descriptions, `dangerModifier`)" section.
- Move `docs/planned/economy-simulation-substrate.md` → `docs/active/gameplay/` per the SPEC lifecycle; update
  `docs/SPEC.md`'s system map link.
- Grep `docs/active/` (`navigation.md`, `combat.md`, map docs) for trait-economy references; update to the
  bodies+features framing.
- **Leave** the `docs/plans/economy-simulation-sp1-*` plan docs (incl. this one) until SP1 → main, then delete the set.

---

## Verification gates (design §8 — PR3b)

- `TraitId` narrow **compiles** (LOCATIONS rewired, `computeTraitProductionBonus` gone, fields stripped): `tsc --noEmit` clean.
- Tests updated + green; `npm run build` clean.
- `npm run simulate` still **healthy** with the trait-production bonus retired.
- Danger now **body-driven** (volcanic systems regain environmental danger); mission volumes sane.

## Open decisions (resolve at build, all flagged `[DECISION]` above)

1. **`bodyDanger` source** — compute on `GeneratedSystem` (recommended; one sum shared by seed + simulator) vs seed-only.
2. **LOCATIONS quality** for body/richness-derived sites (bodies have no `QualityTier`) — omit quality vs map richness multiplier.
3. **LOCATIONS semantic shifts** — richness → `mining_outpost`, `planet_surface` from body — confirm reads well.
4. **`trait-migration.ts`** — delete if orphaned after narrowing.

## Suggested commits (one PR into `feat/economy-simulation`)

1. `refactor(economy): retire computeTraitProductionBonus` (Phase 1)
2. `feat(economy): danger from bodies — bodyDanger column + computeSystemDanger term` (Phase 2)
3. `refactor(economy): derive exploration locations from bodies + features` (Phase 3)
4. `refactor(economy): narrow TraitId to features; strip affinity/production fields` (Phase 4)
5. `docs(economy): substrate bodies+features model; spec planned→active` (Phase 5)
