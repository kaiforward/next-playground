# UI Cleanup Pass (WS3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip three deprecated concepts from the sim + UI — system traits (entirely, including their two scoring terms), economic-type colours/markers, and the region-colour ("Regions") map mode — plus remove the connection count from the system overview.

**Architecture:** This is removal-shaped work, not feature TDD. Each task deletes a coherent slice and rewires the seams the deletion exposes; the "test" for most tasks is that `tsc` + the existing Vitest suite + the webpack build stay green after the deletion, with trait-specific tests removed and the two behaviour-changing scoring functions re-pinned by updated tests. Traits are removed **usage-first** (scoring → UI → data model → docs) so the tree compiles at every task boundary. Because trait generation consumed seeded-RNG draws, same-seed galaxies will differ afterward — verification is **coherence** (the simulator still produces a healthy, colonising galaxy), not parity with old output.

**Tech Stack:** TypeScript 5 (strict), Next.js 16, Pixi/WebGL map, Vitest 4. Build gate: `npx next build --webpack`. Sim harness: `npm run simulate`.

## Global Constraints

- No `as` type assertions except `as const` / `lib/types/guards.ts` guards; no `unknown`; no postfix `!` (except `find(...)!` in tests).
- `World` stays JSON-serializable; determinism preserved (seeded `tickRng`, no `Date.now`/`Math.random` in tick/processor bodies).
- **Keep the `economyType` field** (events target on it) and **`regionId`** (region-targeted event modifiers/relations depend on it) — only their *visuals* are removed.
- Verify claims: quote real command output; never assert "tests pass" without running them. Gate every task on `npx tsc --noEmit`.
- Branch: work on `feat/economy-rework-base` (or a phase branch off it); commit per task.

---

### Task 1: Drop system traits from the two scoring paths

**Files:**
- Modify: `lib/engine/expansion.ts` (`ClaimCandidate`, `ExpansionScoreWeights`, `scoreClaimCandidate`)
- Modify: `lib/constants/expansion.ts:~25` (`EXPANSION.SCORE_WEIGHTS`)
- Modify: `lib/engine/faction-gen.ts:127-176` (`homeworldTraitQuality`, `placeHomeworlds`)
- Modify: `lib/constants/factions.ts:~132` (`HOMEWORLD_PLACEMENT.SCORE_WEIGHTS`)
- Modify: `lib/world/tick.ts:385-390,~731` (`sumTraitQuality`, the `ClaimCandidate` provider)
- Test: `lib/engine/__tests__/expansion.test.ts`, `lib/engine/__tests__/faction-gen.test.ts` (or wherever `placeHomeworlds`/`scoreClaimCandidate` are covered — grep first)

**Interfaces:**
- Produces: `ClaimCandidate` **without** `traitQuality`; `ExpansionScoreWeights` **without** `trait`; `scoreClaimCandidate(c, w)` scoring only `habitable·habitableSpace + diversity·resourceDiversity`, distance-discounted. `placeHomeworlds` scoring only `habitable·hab̂ + diversity·d̂ − danger·d̂anger`. Later tasks rely on `s.traits` still *existing* on `GeneratedSystem`/`SimSystem` (removed in Task 3).

- [ ] **Step 1: Update the expansion tests to the trait-free contract.** In `expansion.test.ts`, remove `traitQuality` from every `ClaimCandidate` fixture and `trait` from every weights fixture, and update any assertion that depended on the trait term. Add one case pinning the new behaviour:

```ts
it("scores claims on substrate × proximity with no trait term", () => {
  const w = { habitable: 1, diversity: 1, proximity: 0.1 };
  const near = { systemId: "a", minHops: 1, habitableSpace: 100, resourceDiversity: 3 };
  const far  = { systemId: "b", minHops: 4, habitableSpace: 100, resourceDiversity: 3 };
  expect(scoreClaimCandidate(near, w)).toBeGreaterThan(scoreClaimCandidate(far, w)); // proximity discount
  // identical substrate + hops ⇒ identical score (nothing trait-derived left)
  expect(scoreClaimCandidate({ ...near, systemId: "c" }, w)).toBeCloseTo(scoreClaimCandidate(near, w), 9);
});
```

- [ ] **Step 2: Run the tests to see them fail to compile.** Run: `npx vitest run lib/engine/__tests__/expansion.test.ts` — Expected: FAIL (type error — `trait`/`traitQuality` removed from fixtures but still in the interface).

- [ ] **Step 3: Remove the trait term from `expansion.ts`.** Delete `traitQuality` from `ClaimCandidate`, delete `trait` from `ExpansionScoreWeights`, and drop its line from `scoreClaimCandidate`:

```ts
export function scoreClaimCandidate(c: ClaimCandidate, w: ExpansionScoreWeights): number {
  const substrate =
    w.habitable * Math.max(0, c.habitableSpace) +
    w.diversity * Math.max(0, c.resourceDiversity);
  const proximity = 1 / (1 + w.proximity * Math.max(0, c.minHops));
  return substrate * proximity;
}
```

Update the `ClaimCandidate`/`ExpansionScoreWeights` doc comments to drop the trait mentions.

- [ ] **Step 4: Remove `trait` from the expansion weights constant.** In `lib/constants/expansion.ts`, delete the `trait: 2.0,` (or similar) entry from `EXPANSION.SCORE_WEIGHTS`. Leave `habitable`, `diversity`, `proximity`.

- [ ] **Step 5: Stop the tick provider from supplying trait quality.** In `lib/world/tick.ts`, delete `sumTraitQuality` (385-390) and remove the `traitQuality: sumTraitQuality(...)` field from the `ClaimCandidate` object it builds (~731).

- [ ] **Step 6: Remove traits from homeworld placement.** In `lib/engine/faction-gen.ts`: delete `homeworldTraitQuality` (127-131); in `placeHomeworlds`, drop the `maxTrait` tracking (remove from the init and the loop) and delete the `w.trait * (homeworldTraitQuality(s) / maxTrait) +` line from `score`. Update the JSDoc (140-149) to drop "trait quality". Result:

```ts
score:
  w.habitable * (s.habitableSpace / maxHab) +
  w.diversity * (homeworldResourceDiversity(s.slotCap) / RESOURCE_TYPES.length) -
  w.danger * (s.bodyDanger / maxDanger),
```

- [ ] **Step 7: Remove `trait` from the homeworld weights constant.** In `lib/constants/factions.ts`, delete the `trait:` entry from `HOMEWORLD_PLACEMENT.SCORE_WEIGHTS`. Update any `faction-gen.test.ts` fixture/assertion that referenced it.

- [ ] **Step 8: Run tsc + the affected suites.** Run: `npx tsc --noEmit` (Expected: clean) then `npx vitest run lib/engine/__tests__/expansion.test.ts lib/engine/__tests__/faction-gen.test.ts` (Expected: PASS).

- [ ] **Step 9: Coherence-check the generated galaxy.** Run: `npm run simulate` — Expected: completes without NaN/throw; homeworlds placed; colonies claim/develop (non-zero developed count, sane unrest). Note in the commit that same-seed output shifted by design.

- [ ] **Step 10: Commit.**

```bash
git add lib/engine/expansion.ts lib/constants/expansion.ts lib/engine/faction-gen.ts lib/constants/factions.ts lib/world/tick.ts lib/engine/__tests__/
git commit -m "refactor(worldgen): drop system-trait quality from homeworld & claim scoring"
```

---

### Task 2: Remove the trait UI surfaces

**Files:**
- Delete: `components/ui/trait-list.tsx`, `lib/utils/traits.ts`
- Modify: `components/system/system-danger-badge.tsx` (body danger only)
- Modify: `app/(game)/@panel/system/[systemId]/page.tsx` (enrich call ~97, "Traits" stat ~246-248, `TraitList` ~346, trait danger ~164-167)
- Modify: `components/map/system-detail-panel.tsx` (compact `TraitList` ~9,11,142)
- Modify: `lib/services/universe.ts` (trait fields ~42-46,80,125-127)
- Test: any `trait-list.test.tsx` / `traits.test.ts` (delete)

**Interfaces:**
- Produces: `SystemDangerBadge` computing danger from `bodyDanger` only (no `computeTraitDanger`). `SystemInfo` (service payload) no longer carries `traits`.

- [ ] **Step 1: Rework the danger badge to body danger only.** In `system-danger-badge.tsx`, remove the trait-danger contribution so `baseDanger` = body danger (drop the `computeTraitDanger`/trait import and any `+ traitDanger` term). Keep the badge's tiers/rendering.

- [ ] **Step 2: Strip traits from the system detail page.** In `@panel/system/[systemId]/page.tsx`: remove the `enrichTraits(...)` call (~97), the "Traits" `StatRow`/count (~246-248), the `<TraitList .../>` render (~346), and the trait-danger wiring (~164-167) — the badge now takes body danger directly.

- [ ] **Step 3: Strip the compact trait list from the map panel.** In `components/map/system-detail-panel.tsx`, remove the `TraitList` import + its render (~9,11,142).

- [ ] **Step 4: Drop trait fields from the universe service.** In `lib/services/universe.ts`, remove the trait enrichment/fields (~42-46,80,125-127) from the returned `SystemInfo`. (The `traits` field on the `SystemInfo` type is deleted in Task 3; leaving it optional here is fine until then, but stop populating it.)

- [ ] **Step 5: Delete the now-orphaned files.** `git rm components/ui/trait-list.tsx lib/utils/traits.ts` and any co-located trait tests.

- [ ] **Step 6: tsc + build + components suite.** Run: `npx tsc --noEmit` (clean), `npx vitest run components/ lib/services/` (PASS), `npx next build --webpack` (✓ Compiled successfully).

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "refactor(ui): remove system-trait surfaces from system + map panels"
```

---

### Task 3: Remove the trait data model, generation & storage

**Files:**
- Delete: `lib/constants/traits.ts`, `lib/engine/trait-gen.ts`
- Modify: `lib/types/game.ts` (`TraitId`, `TraitCategory`, `QualityTier`, `SystemTraitInfo`, `SystemInfo.traits`)
- Modify: `lib/engine/body-gen.ts` (trait generation), `lib/engine/universe-gen.ts` (`GeneratedSystem.traits` ~39,397), `lib/world/gen.ts:174-181` (`World.traits` write)
- Modify: `lib/world/types.ts:351` (`WorldTrait`), `lib/engine/simulator/types.ts:41-42` (`SimSystem.traits`)
- Modify (dead economy-tick plumbing): `lib/world/tick.ts:142-175`, `lib/tick/adapters/memory/economy.ts:83`, `lib/tick/processors/economy.ts:110`, `lib/engine/market-tick-builder.ts:43,106`, `lib/engine/tick.ts:146,156-177` (`TickEntryInput.traits`)
- Test: delete `trait-gen` tests + any worldgen test asserting on `traits`

**Interfaces:**
- Produces: no `traits` anywhere in `GeneratedSystem`, `World`, `SimSystem`, or `TickEntryInput`. `RESOURCE_CLOSURE`/economy math unchanged (the plumbing was never read).

- [ ] **Step 1: Remove trait generation from substrate gen.** In `lib/engine/body-gen.ts`, delete the block that draws traits from `ALL_TRAIT_IDS`/`QUALITY_TIERS` (and the imports). In `universe-gen.ts`, remove `traits` from `GeneratedSystem` and stop populating it (~39,397).

- [ ] **Step 2: Remove trait storage.** In `lib/world/gen.ts`, delete the `World.traits` write (174-181); in `lib/world/types.ts`, delete `WorldTrait` and the `traits` collection; in `simulator/types.ts`, delete `SimSystem.traits`.

- [ ] **Step 3: Remove the dead economy-tick plumbing.** Delete the `traits` join/pass-through in `tick.ts:142-175`, `adapters/memory/economy.ts:83`, `processors/economy.ts:110`, `market-tick-builder.ts:43,106`, and `TickEntryInput.traits` + its unused read-site scaffolding in `engine/tick.ts:146,156-177`. (These never affect output — confirm no production/consumption math references `input.traits`.)

- [ ] **Step 4: Delete the type + catalog files.** In `lib/types/game.ts` remove `TraitId`/`TraitCategory`/`QualityTier`/`SystemTraitInfo` and `SystemInfo.traits`. `git rm lib/constants/traits.ts lib/engine/trait-gen.ts` and their tests.

- [ ] **Step 5: tsc + full suite + build + sim.** Run: `npx tsc --noEmit` (clean), `npx vitest run` (all PASS), `npx next build --webpack` (✓), `npm run simulate` (healthy galaxy). Fix any remaining references tsc surfaces.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "refactor(worldgen): delete the system-trait data model, generation, and dead tick plumbing"
```

---

### Task 4: Retire the traits doc + scrub references

**Files:**
- Delete: `docs/active/gameplay/system-traits.md`
- Modify: `docs/active/gameplay/navigation.md:~49`, `docs/active/gameplay/economy.md`, `docs/active/gameplay/universe.md`, `docs/SPEC.md` (any trait mention/link)

- [ ] **Step 1: Delete the doc.** `git rm docs/active/gameplay/system-traits.md`.
- [ ] **Step 2: Scrub references.** Grep `git grep -in "trait" docs/` and remove trait sentences/links from `navigation.md`, `economy.md`, `universe.md`, and any SPEC link/interaction entry — present-tense, no "removed"/change-history framing (state the current reality).
- [ ] **Step 3: Verify no dangling links.** Run: `git grep -n "system-traits" docs/` — Expected: no matches.
- [ ] **Step 4: Commit.** `git commit -am "docs: retire system-traits spec and scrub references"`

---

### Task 5: Remove economic-type colours & markers

**Files:**
- Modify: `components/map/pixi/theme.ts` (delete `ECONOMY_COLORS`; add a neutral glyph colour)
- Modify: `components/map/pixi/layers/point-cloud-layer.ts:61`
- Modify: `components/map/pixi/objects/system-object.ts:182,192-196,207-209,277`
- Delete: `components/ui/economy-badge.tsx`
- Modify (badge consumers): `components/map/system-detail-panel.tsx:75`, `app/(game)/@panel/system/[systemId]/layout.tsx:49`, `app/(game)/@panel/system/[systemId]/page.tsx:212`, `app/(game)/@panel/factions/[factionId]/page.tsx:194`

**Interfaces:**
- Produces: a `NEUTRAL_GLYPH = { core, glow }` const in `theme.ts` replacing `ECONOMY_COLORS[type]` at both render sites; no `ECON` label on the glyph; no economy badge anywhere.

- [ ] **Step 1: Add the neutral glyph colour, remove the palette.** In `theme.ts`, delete `ECONOMY_COLORS` and add:

```ts
// Interim single glyph colour — WS1 (map overhaul) recolours the glyph by star type.
export const NEUTRAL_GLYPH = { core: 0xcbd5e1, glow: 0x64748b } as const; // slate-300 / slate-500
```

- [ ] **Step 2: Retint the point cloud.** In `point-cloud-layer.ts:61`, replace `ECONOMY_COLORS[sys.economyType].core` with `NEUTRAL_GLYPH.core`.

- [ ] **Step 3: Retint the system glyph + drop the ECON label.** In `system-object.ts`: replace the economy core fill (182,192-196) with `NEUTRAL_GLYPH.core`; replace the halo fallback tint (277) with `NEUTRAL_GLYPH.glow`; delete the `ECON` text block (207-209). If the `showEconomyLabels` LOD flag (`lod.ts`) and `SIZES.systemEconLabelSize` are now unused, delete them too (tsc/build will confirm).

- [ ] **Step 4: Delete the economy badge + its uses.** `git rm components/ui/economy-badge.tsx` and remove the `<EconomyBadge .../>` render + import from the four consumers (system-detail-panel, system layout, system page, faction page).

- [ ] **Step 5: tsc + build.** Run: `npx tsc --noEmit` (clean), `npx next build --webpack` (✓). (Manual map smoke — glyph reads neutral, no ECON label — happens at the pass's end.)

- [ ] **Step 6: Commit.** `git commit -am "refactor(map): remove economic-type colours, glyph label, and economy badge"`

---

### Task 6: Remove the "Regions" map mode (region colours)

**Files:**
- Modify: `lib/types/map.ts` (drop `"regions"` from `MapMode` + `MAP_MODES`)
- Delete: `components/map/pixi/layers/territory-layer.ts`
- Modify: `components/map/pixi/pixi-map-canvas.tsx:12,171,327,343` (import, instantiation, visibility toggle)
- Modify: `components/map/map-overlay-controls.tsx:18-24,49` (the "Regions" radio option)
- Modify: `lib/hooks/use-map-mode.ts` (stale docstring)

**Interfaces:**
- Produces: `MapMode = "political" | "stability" | "population" | "development" | "none"`; `isMapMode("regions")` now returns `false`, so a stored `"regions"` in sessionStorage falls back to the default.

- [ ] **Step 1: Remove the mode value.** In `lib/types/map.ts`, delete `"regions"` from the `MapMode` union and from `MAP_MODES`. `isMapMode`/`MAP_MODE_SET` follow automatically.

- [ ] **Step 2: Confirm hydration fallback.** In `lib/hooks/use-map-mode.ts`, verify a persisted `"regions"` (now failing `isMapMode`) resolves to the default mode; fix the fallback if not, and correct the stale docstring (it lists modes that no longer match).

- [ ] **Step 3: Delete the Regions layer + its wiring.** `git rm components/map/pixi/layers/territory-layer.ts`. In `pixi-map-canvas.tsx`, remove the `TerritoryLayer` import (12), the `new TerritoryLayer()` instantiation (171), and the `territoryLayer.container.visible = mapMode === "regions"` toggle + any add-to-stage line (327,343).

- [ ] **Step 4: Remove the toggle option.** In `map-overlay-controls.tsx`, remove the "Regions" radio entry + label (18-24,49) so the Mode group lists only the surviving modes.

- [ ] **Step 5: tsc + build.** Run: `npx tsc --noEmit` (clean), `npx next build --webpack` (✓).

- [ ] **Step 6: Commit.** `git commit -am "refactor(map): remove the region-colour Regions map mode (keep regionId)"`

---

### Task 7: Remove the connection count from the system overview

**Files:**
- Modify: `app/(game)/@panel/system/[systemId]/page.tsx:106-109,249-250`

- [ ] **Step 1: Remove the count + its row.** Delete the `connectionCount` `useMemo` (106-109) and the `<StatRow label="Connections">…{connectionCount}…</StatRow>` (249-250). Drop any now-unused `universeData.connections` reference if it was only for this.
- [ ] **Step 2: tsc + build.** Run: `npx tsc --noEmit` (clean), `npx next build --webpack` (✓).
- [ ] **Step 3: Commit.** `git commit -am "refactor(ui): remove connection count from the system overview"`

---

### Final: whole-pass verification

- [ ] `npx tsc --noEmit` clean · `npx vitest run` all green · `npx next build --webpack` ✓ · `npm run simulate` healthy.
- [ ] Manual map smoke (user): glyphs read neutral with no ECON label; Mode toggle has no Regions option; system panel has no traits/connection-count; a fresh **New game** generates + colonises normally.
- [ ] Update `docs/planned/ui-overhaul.md` WS3 to done (or delete this build plan when the pass ships).
