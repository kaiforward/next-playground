# Economy Simulation — SP1 PR2: Detach Consumers (build plan)

> Phase 2 of SP1 Part 1. Branch: `feat/economy-simulation-pr-2` (off shared `feat/economy-simulation`, which now has PR1's squash commit `3d6020a`). PRs into the shared branch. **Delete this doc when PR2 ships.**

## Goal

Sever the danger / mission / rendering consumers from the trait fields that PR3 will prune, so PR3 can reduce the `TRAITS` catalog to the 31 "feature" survivors and strip economy fields without breaking these consumers. **Economy coupling (`productionGoods` / `economyAffinity` / `STRONG_AFFINITY_TRAIT_IDS` / `computeTraitProductionBonus`) is explicitly OUT of scope — that's PR3's economy-shim work.**

## Design decision (resolved)

**Danger = sum of `dangerModifier` over feature-kind traits only.** The 3 danger-bearing traits that get reclassified — `volcanic_world` (+0.05 → archetype), `habitable_world` (−0.03 → archetype), `radioactive_deposits` (+0.04 → richness) — stop contributing trait-danger in PR2. No transition shim. Body-type danger (incl. `volcanic_world`'s 0.05 via `BODY_ARCHETYPES.dangerBaseline`) is wired from real `SystemBody` rows in **PR3**, where it belongs.

**Why this is safe:** PR2 + PR3 both accumulate on the shared branch before any merge to `main`, so the intermediate danger delta is never player-visible; PR3's full reseed recomputes danger from bodies before the final shared→main merge. The deltas are tiny (≤0.05) and clamped to `[0, 0.5]`.

**Consequence for verification:** `npm run simulate` after PR2 will **not** be byte-identical to pre-PR2 (danger shifts slightly on volcanic/habitable/radioactive systems). The gate is "still passes / healthy equilibrium," not byte-parity. The 8 feature danger traits (binary_star, lagrange_stations, solar_flare_activity, dark_nebula, subspace_rift, ion_storm_corridor, ancient_minefield, pirate_stronghold) are unchanged.

## Code map (verified, from exploration)

- `computeTraitDanger` — `lib/engine/trait-gen.ts:102-111` (sums `TRAITS[id].dangerModifier` over **all** traits). Wrapped by `computeSystemDanger` — `lib/engine/danger.ts:131-141` (+ event nav modifiers + gov baseline, clamped `[0,0.5]`). Danger is **not persisted** — computed on the fly.
- `computeTraitDanger` call sites (4): `lib/tick/processors/ship-arrivals.ts:111`, `lib/tick/processors/missions.ts:133`, `lib/services/missions-v2.ts:461`, `lib/engine/simulator/economy.ts:90`.
- `enrichTraits` — `lib/utils/traits.ts:16-30`; call sites: `app/(game)/@panel/system/[systemId]/page.tsx:91`, `.../explore/page.tsx:87`, `.../layout.tsx:49`, `components/map/system-detail-panel.tsx:255`.
- Mission selectors — `lib/engine/mission-gen.ts`: survey `:111`, salvage `:203`, recon `:252` (read `traitId` + `quality` only, against `*_ELIGIBLE_TRAITS` from `lib/constants/missions.ts`).
- Events — `lib/engine/events.ts:208` `selectEventToSpawn`; `SystemSnapshot` (`:32`) is `{ id, economyType, regionId }` — **already trait-free**. No change needed.
- `TRAIT_MIGRATION` — `lib/constants/trait-migration.ts`; `TRAITS` catalog — `lib/constants/traits.ts:44`; `TraitId` — `lib/types/game.ts:21`.

## Tasks (TDD: failing test → implementation → green)

### Task 1 — `features` accessor
- Add `getFeatureTraits(traits)` to `lib/utils/traits.ts`: keep entries where `TRAIT_MIGRATION[t.traitId].kind === "feature"`. Type the param to match the existing `SystemTraitInfo`/trait-pair shape `enrichTraits` already uses.
- Test (`lib/utils/__tests__/traits.test.ts` or extend existing): feature kept, archetype/richness dropped; stable order.

### Task 2 — Danger re-base
- Change `computeTraitDanger` (`lib/engine/trait-gen.ts:102`) to sum `dangerModifier` only over feature-kind traits (reuse Task 1's filter / inline the `kind === "feature"` check on the trait id). No archetype baseline in PR2.
- Update the danger test to assert: feature-trait danger summed; archetype/richness danger excluded. Add a comment pointing to this doc's design-decision section.
- Leave `computeSystemDanger` (event + gov + clamp) untouched — the 4 call sites need no change (signature stable).

### Task 3 — Route rendering through the accessor
- At the 4 `enrichTraits` call sites (or inside `enrichTraits`/a wrapper), filter to `getFeatureTraits` first so the system-detail panels show only narrative features. Decide one consistent insertion point (prefer filtering once, centrally). Verify `<TraitList>` still renders.

### Task 4 — Route mission selectors through the accessor (belt-and-suspenders)
- Survey/salvage/recon (`lib/engine/mission-gen.ts`) filter candidate traits through `getFeatureTraits` before matching the eligible sets. Behaviour-preserving today (all eligible traits are features — PR1 test guarantees it); makes the prune safe. Keep minimal.

### Task 5 — Events: confirm decoupled (no code)
- Confirm `selectEventToSpawn` / `selectEventsToSpawn` read only `economyType`/`regionId` (already verified). Note in the PR description; no change.

### Task 6 — Verify
- `npx vitest run` full suite green (danger test updated to new behaviour).
- `npx tsc --noEmit` + `npm run build` clean.
- `npm run simulate` still passes with a **healthy** equilibrium (not byte-identical — expected, per the design decision). Eyeball that danger-driven outputs (patrol/bounty/recon volumes) are sane.

## Out of scope (PR3)
Generation rewrite, economy-type shim, column↔vector bridge, DB guards, seed rewrite, catalog prune + economy-field strip, real body-type danger. See the PR3 roadmap in `economy-simulation-sp1-part1-foundation.md`.
