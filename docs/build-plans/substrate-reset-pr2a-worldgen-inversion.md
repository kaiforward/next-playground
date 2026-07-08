# Substrate Reset — PR2a: World-Gen Inversion + Ownership Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert world-gen from a pre-populated, 100%-owned galaxy to **one developed homeworld per faction in a mostly-empty galaxy** (seed-biased + min-distance spaced), and add the **three-state ownership model's static half** — outpost + space-station-facility building types, with existing development builds **gated** on the station's presence. The runtime expansion claim step is PR2b.

**Architecture:** Three coupled changes. (1) Two non-producing building types (`outpost`, `space_station`) enter the catalog; a `hasStationFacility()` gate makes `planFactionBuilds` build only at stationed systems. (2) `faction-gen`'s BFS flood-fill (`assignSystemFactions` claims 100% of systems) is replaced by `placeHomeworlds` — a quality-scored, min-distance-spaced picker that returns one homeworld index per faction; every other system stays `factionId: null`. The archetype-relative minor placement (buffer/frontier/enclave/cluster) and the minor-territory floor are deleted — all factions now get the same spaced-homeworld treatment, and major/minor status emerges from expansion (PR2b). (3) A post-placement `applyEmergentStartingCondition` step develops each homeworld (adds outpost + station on top of its substrate industry) and zeroes every other system's population + buildings, so the mostly-empty galaxy is inert negative space until factions grow into it.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Next.js 16. Pure engine + world-gen (`lib/engine/*`, `lib/world/gen.ts`); the shared tick (`lib/world/tick.ts`) and the calibration harness both run `generateWorld`.

## Global Constraints

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown`** anywhere (except `JSON.parse` at true boundaries, narrowed immediately).
- **No postfix `!`** except `find(...)!` in tests (accepted project idiom).
- **World stays JSON-serializable:** no `Map`/`Set`/`Date`/`Infinity`/`NaN` in world state. (PR2a adds no `World` *fields* — `factionId` is already `string | null`, `buildingType` is already `string` — but bumps `SAVE_FORMAT_VERSION` because the starting-condition regime changes and pre-2a saves are semantically invalid.)
- **Determinism:** world-gen draws only from `generateUniverse`'s seeded `mulberry32`; never `Date.now`/`Math.random`/`new Date()`. Same `{ systemCount, seed }` ⇒ byte-identical world through JSON. Placement is pure-deterministic (sorted, no RNG draw) — see the RNG-stream note in Task 4.
- **Unit tests:** `npx vitest run <path>` for one file; `npx vitest run` for all.
- **Build gate:** `npx next build --webpack` (webpack is the stable PR gate; Turbopack build has other quirks).
- **Calibration bar this PR:** coarse only — the harness runs without `NaN`/`Infinity`/runaway/pinning over the new sparse regime. No precise tuning (deferred; the flow-merge + goods re-point in SP3 moves the target again).
- **Active docs are present-tense** (no change-history, no phase nicknames/numbers). Deferred bits (expansion) stated as present-fact + a minimal pointer to the planned spec.
- Branch: `feat/substrate-reset-pr2-worldgen-expansion` (off the shared `feat/substrate-reset`). Commit after every task.

---

## File-by-file map

| File | Change |
|---|---|
| `lib/constants/industry.ts` | Add `OUTPOST_TYPE`, `SPACE_STATION_TYPE`, their catalog entries, and `hasStationFacility()`. |
| `lib/constants/__tests__/industry.test.ts` | Assert the two new types exist, are non-producing, and the gate helper. |
| `lib/engine/directed-build.ts` | Gate `planFactionBuilds`' `working` set to stationed systems only. |
| `lib/engine/__tests__/directed-build.test.ts` | Add the station-facility gate suite. |
| `lib/constants/factions.ts` | Add `HOMEWORLD_PLACEMENT` consts; **remove** `MINOR_ARCHETYPE_DISTRIBUTION`, `MinorFactionArchetype`, `MIN_MINOR_TERRITORY`. |
| `lib/constants/__tests__/factions.test.ts` | Remove the `MINOR_ARCHETYPE_DISTRIBUTION` describe block + import. |
| `lib/engine/faction-gen.ts` | Add `placeHomeworlds` + `assignHomeworldOwnership`; rewrite `generateFactions`; delete the flood-fill + archetype + anchor machinery; drop the `archetype` field. |
| `lib/engine/__tests__/faction-gen.test.ts` | Add `placeHomeworlds` unit suite (keep the `deriveDominantEconomy` suite). |
| `lib/engine/universe-gen.ts` | Add `applyEmergentStartingCondition`; wire new placement + ownership into `generateUniverse`; drop the `MIN_MINOR_TERRITORY`/`assignSystemFactions` imports. |
| `lib/engine/__tests__/universe-gen.test.ts` | Rewrite the ownership test; delete the min-territory + archetype tests; add the developed-homeworld/inert-frontier test. |
| `lib/world/gen.ts` | Map `assignment === -1 → factionId: null`. |
| `lib/world/__tests__/gen.test.ts` | Invert the "every system owned" test to "only homeworlds owned; rest null & unpopulated". |
| `lib/world/save.ts` | `SAVE_FORMAT_VERSION` `1 → 2`. |
| `docs/active/gameplay/faction-system.md` | Present-tense rewrite of the ownership/placement sections to the emergent model. |
| `docs/SPEC.md` | Reconcile any world-gen/ownership description to the emergent-civ starting condition. |

**Unaffected (verified):** `lib/engine/__tests__/universe-gen-invariants.test.ts` inspects only `economyType` + `traits`, both physical substrate this PR does **not** zero — leave it untouched (the full-suite gate in Task 6 confirms).

---

## Task 1: Outpost + space-station building types + facility gate

**Files:**
- Modify: `lib/constants/industry.ts`
- Test: `lib/constants/__tests__/industry.test.ts`

**Interfaces:**
- Produces: `OUTPOST_TYPE = "outpost"`, `SPACE_STATION_TYPE = "space_station"` (string consts); `BUILDING_TYPES[OUTPOST_TYPE]`/`[SPACE_STATION_TYPE]` non-producing entries (`spaceCost` only); `hasStationFacility(buildings: Record<string, number>): boolean`.

- [ ] **Step 1: Write the failing test.** Append to `lib/constants/__tests__/industry.test.ts` (and add the imports it needs — read the file's existing import line first and extend it):

```ts
import {
  OUTPOST_TYPE, SPACE_STATION_TYPE, hasStationFacility, BUILDING_TYPES,
} from "../industry";

describe("ownership building types", () => {
  it("registers outpost and space-station as non-producing catalog entries", () => {
    for (const type of [OUTPOST_TYPE, SPACE_STATION_TYPE]) {
      const def = BUILDING_TYPES[type];
      expect(def).toBeDefined();
      expect(def.outputGood).toBeUndefined();   // control markers produce nothing
      expect(def.popProvided).toBeUndefined();   // and house nobody
      expect(def.labour).toBeUndefined();        // and staff nobody
      expect(def.spaceCost).toBeGreaterThan(0);
    }
  });

  it("the station is a heavier build than the outpost (dev gate vs cheap marker)", () => {
    expect(BUILDING_TYPES[SPACE_STATION_TYPE].spaceCost)
      .toBeGreaterThan(BUILDING_TYPES[OUTPOST_TYPE].spaceCost);
  });

  it("hasStationFacility is true only when a station is present", () => {
    expect(hasStationFacility({})).toBe(false);
    expect(hasStationFacility({ [OUTPOST_TYPE]: 1 })).toBe(false);
    expect(hasStationFacility({ [SPACE_STATION_TYPE]: 1 })).toBe(true);
    expect(hasStationFacility({ [SPACE_STATION_TYPE]: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts`
Expected: FAIL — `OUTPOST_TYPE`/`SPACE_STATION_TYPE`/`hasStationFacility` are not exported.

- [ ] **Step 3: Add the constants + catalog entries.** In `lib/constants/industry.ts`, near the other building-type id consts (after `RESEARCH_INSTITUTE_TYPE`, ~line 25):

```ts
/** Control marker — cheap sovereignty over an owned system; produces/houses/staffs nothing. */
export const OUTPOST_TYPE = "outpost";
/** Development gate — an expensive orbital facility that unlocks the other build types in-system. */
export const SPACE_STATION_TYPE = "space_station";
```

In the `BUILDING_TYPES` object literal (currently ends with the two academy entries, ~line 233-247), add the two entries alongside `HOUSING_TYPE`:

```ts
  [OUTPOST_TYPE]: { spaceCost: 1.0 },
  [SPACE_STATION_TYPE]: { spaceCost: 3.0 },
```

- [ ] **Step 4: Add the gate helper.** Append to `lib/constants/industry.ts` (near `effectiveSpaceCost`):

```ts
/**
 * A system can host development builds (housing, extractors, factories, academies,
 * complexes) only once it holds a space-station facility. Unclaimed and
 * controlled-but-undeveloped (outpost-only) systems have none, so directed build
 * skips them. The facility is seeded on every faction homeworld at world-gen.
 */
export function hasStationFacility(buildings: Record<string, number>): boolean {
  return (buildings[SPACE_STATION_TYPE] ?? 0) > 0;
}
```

- [ ] **Step 5: Run test to verify it passes.**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/constants/industry.ts lib/constants/__tests__/industry.test.ts
git commit -m "$(cat <<'EOF'
feat(industry): add outpost + space-station building types and the station gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Gate `planFactionBuilds` on the station facility

The build planner already never develops an unowned system (a null-faction group has ~0 population ⇒ ~0 budget ⇒ early return). The gate makes the rule **explicit and load-bearing for PR2b**: a controlled-but-undeveloped (outpost-only) system must not be developed either. The cleanest single-point gate is to build the planner's `working` site map only from stationed systems — both the housing pass and the industry-opportunity pass iterate `working.values()` as candidate sites, so gating the map gates both. Deficit/surplus detection still reads the full `systems` list (correct — an undeveloped system holds no markets stock and contributes no demand anyway).

**Files:**
- Modify: `lib/engine/directed-build.ts:351-353` (the `working` map construction) + imports (line 16-20)
- Test: `lib/engine/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `hasStationFacility`, `SPACE_STATION_TYPE` (Task 1).

- [ ] **Step 1: Write the failing test.** Append to `lib/engine/__tests__/directed-build.test.ts` (extend the existing `@/lib/constants/industry` import on line 5 to include `SPACE_STATION_TYPE, HOUSING_TYPE`; `sysWith`, `fedAndCalm`, `planFactionBuilds` are already imported):

```ts
describe("planFactionBuilds: station-facility gate", () => {
  const buildable = { population: 100, generalSpace: 50, habitableSpace: 50, goods: [] };

  it("builds nothing at a fed-and-calm system that has no space-station facility", () => {
    const site = sysWith({ ...buildable, buildings: {} });
    expect(fedAndCalm(site)).toBe(true); // sanity: absent the gate it WOULD build housing
    expect(planFactionBuilds([site], () => 1)).toEqual([]);
  });

  it("builds housing at the same system once a station facility is present", () => {
    const site = sysWith({ ...buildable, buildings: { [SPACE_STATION_TYPE]: 1 } });
    const plans = planFactionBuilds([site], () => 1);
    expect(plans.some((b) => b.buildingType === HOUSING_TYPE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: FAIL — the first case returns a housing build (the planner currently ignores the station gate).

- [ ] **Step 3: Add the gate.** In `lib/engine/directed-build.ts`, extend the `@/lib/constants/industry` import (line 16-20) to include `hasStationFacility`:

```ts
import {
  BUILDING_TYPES, OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY,
  VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, SKILL1_PER_SCHOOL, SKILL2_PER_INSTITUTE, labourTotal,
  FAMILY_BY_GOOD, COMPLEX_TYPES, ANCHOR_CAP, ANCHOR_RATED_COVERAGE, ANCHOR_MIN_THROUGHPUT, hasStationFacility,
} from "@/lib/constants/industry";
```

Then change the `working` map construction (currently lines 351-353):

```ts
  // Mutable per-system working copy so capacity/labour reflect builds made this pass.
  // Only developed systems (those holding a space-station facility) can host builds —
  // unclaimed and outpost-only systems are skipped here, gating both the housing and
  // industry passes in one place. Deficit/surplus detection below still reads all `systems`.
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) {
    if (!hasStationFacility(s.buildings)) continue;
    working.set(s.systemId, { ...s, buildings: { ...s.buildings } });
  }
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: PASS (the new suite plus every pre-existing directed-build test — the older fixtures either have budget 0 or must be re-checked in Step 5).

- [ ] **Step 5: Reconcile pre-existing planner tests.** Some existing `planFactionBuilds` tests build fixtures **without** a station (e.g. `buildSys`/`tier0Sys` set `buildings: {}` or `{ food: n }`) and assert non-empty plans. Those now return `[]` under the gate. For each such failing test, add `[SPACE_STATION_TYPE]: 1` to the fixture's `buildings` so the system is developed and the test's intent (does the planner target this deficit / cap this extractor) still holds. Run the file again after editing:

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: PASS. (If a test's `buildings` uses a spread like `{ food: n }`, change it to `{ food: n, [SPACE_STATION_TYPE]: 1 }`. Do **not** weaken any assertion — only make the fixture developed.)

- [ ] **Step 6: Commit.**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "$(cat <<'EOF'
feat(directed-build): gate development builds on the space-station facility

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `placeHomeworlds` — spaced, seed-biased homeworld placement

Pure placement primitive. Scores every system's substrate desirability (habitable base, resource diversity, trait quality, low danger — each normalized to [0,1] across the pool so weights are comparable), sorts descending, then greedily picks `count` systems each ≥ a spacing threshold from those already picked. The threshold starts aspirational (a fraction of `mapSize`) and **relaxes** on failure so a small/dense galaxy degrades gracefully rather than failing.

**Files:**
- Modify: `lib/constants/factions.ts` (add `HOMEWORLD_PLACEMENT`)
- Modify: `lib/engine/faction-gen.ts` (add `placeHomeworlds` + private `scoreHomeworld` helpers)
- Test: `lib/engine/__tests__/faction-gen.test.ts`

**Interfaces:**
- Produces: `HOMEWORLD_PLACEMENT` (const); `placeHomeworlds(systems: GeneratedSystem[], count: number, mapSize: number): number[]` — returns `count` distinct system indices (or fewer only if `systems.length < count`).

- [ ] **Step 1: Add the placement constants.** Append to `lib/constants/factions.ts`:

```ts
// ── Emergent-civ homeworld placement ─────────────────────────────
/**
 * Homeworlds are the only seeded ownership under emergent world-gen: one decent,
 * well-spaced home per faction, chosen from raw substrate. Weights + spacing are a
 * coarse first-cut (simulator-validated for coherence, not tuned — SP3 moves the
 * calibration target). Score terms are normalized to [0,1] across the candidate
 * pool so the weights are directly comparable.
 */
export const HOMEWORLD_PLACEMENT = {
  /** Aspirational minimum spacing between homeworlds, as a fraction of mapSize. */
  MIN_DISTANCE_FRACTION: 0.18,
  /** Threshold multiplier applied each time the full set can't be placed at the current spacing. */
  RELAX_RATE: 0.85,
  /** Relaxation steps before falling back to pure quality order (spacing ignored). */
  MAX_RELAX_STEPS: 12,
  /** Seed-bias weights over the four normalized substrate terms. */
  SCORE_WEIGHTS: { habitable: 1.0, diversity: 0.8, trait: 0.5, danger: 0.7 },
} as const;
```

- [ ] **Step 2: Write the failing test.** Create the placement suite at the top of `lib/engine/__tests__/faction-gen.test.ts` (keep the existing `deriveDominantEconomy` suite below). Add these imports to the file's import block:

```ts
import { placeHomeworlds } from "../faction-gen";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { GeneratedSystem } from "../universe-gen";
import { HOMEWORLD_PLACEMENT } from "@/lib/constants/factions";
```

Then add a compact `GeneratedSystem` factory and the tests:

```ts
// Minimal GeneratedSystem for placement tests — only the fields placeHomeworlds reads
// (index, x, y, habitableSpace, bodyDanger, traits, slotCap) matter; the rest are inert defaults.
function mkSys(p: Partial<GeneratedSystem> & { index: number }): GeneratedSystem {
  return {
    index: p.index, name: `s${p.index}`, economyType: "extraction", sunClass: "yellow",
    bodies: [], popCap: 0, population: 0, bodyDanger: 0, traits: [], buildings: {},
    availableSpace: 0, generalSpace: 0, habitableSpace: 0,
    slotCap: emptyResourceVector(), yieldMult: emptyResourceVector(),
    x: 0, y: 0, regionIndex: 0, isGateway: false, description: "",
    ...p,
  };
}

describe("placeHomeworlds", () => {
  it("returns `count` distinct homeworld indices", () => {
    const systems = Array.from({ length: 30 }, (_, i) => mkSys({ index: i, x: (i % 6) * 20, y: Math.floor(i / 6) * 20 }));
    const hw = placeHomeworlds(systems, 8, 120);
    expect(hw).toHaveLength(8);
    expect(new Set(hw).size).toBe(8);
    for (const i of hw) expect(i).toBeGreaterThanOrEqual(0);
  });

  it("prefers a clearly-better substrate (high habitable, diverse, low danger) over a dud", () => {
    const slotCap = emptyResourceVector();
    slotCap.arable = 3; slotCap.water = 2; slotCap.ore = 4; // diverse
    const good = mkSys({ index: 0, x: 10, y: 10, habitableSpace: 100, bodyDanger: 0, slotCap });
    const dud = mkSys({ index: 1, x: 90, y: 90, habitableSpace: 1, bodyDanger: 100, slotCap: emptyResourceVector() });
    expect(placeHomeworlds([good, dud], 1, 100)).toEqual([0]); // good dominates on habitable + diversity + low danger
  });

  it("spaces homeworlds apart — skips a high-scoring neighbour that is too close", () => {
    // mapSize 100 → threshold 18. A(10,10) best, B(15,10) dist 5 (< 18, too close), C(90,90) far.
    const a = mkSys({ index: 0, x: 10, y: 10, habitableSpace: 100 });
    const b = mkSys({ index: 1, x: 15, y: 10, habitableSpace: 90 });
    const c = mkSys({ index: 2, x: 90, y: 90, habitableSpace: 50 });
    expect(placeHomeworlds([a, b, c], 2, 100)).toEqual([0, 2]);
  });

  it("relaxes gracefully — still returns `count` when spacing cannot be satisfied", () => {
    // Three systems all within the initial threshold of each other → relaxation lets all fit.
    const cluster = [
      mkSys({ index: 0, x: 10, y: 10, habitableSpace: 30 }),
      mkSys({ index: 1, x: 12, y: 11, habitableSpace: 20 }),
      mkSys({ index: 2, x: 11, y: 13, habitableSpace: 10 }),
    ];
    const hw = placeHomeworlds(cluster, 3, 100);
    expect(hw).toHaveLength(3);
    expect(new Set(hw).size).toBe(3);
  });

  it("is deterministic — same input produces the same placement", () => {
    const systems = Array.from({ length: 20 }, (_, i) => mkSys({ index: i, x: (i * 7) % 100, y: (i * 13) % 100, habitableSpace: (i * 17) % 50 }));
    expect(placeHomeworlds(systems, 6, 100)).toEqual(placeHomeworlds(systems, 6, 100));
  });
});
```

- [ ] **Step 3: Run test to verify it fails.**

Run: `npx vitest run lib/engine/__tests__/faction-gen.test.ts`
Expected: FAIL — `placeHomeworlds` is not exported.

- [ ] **Step 4: Implement `placeHomeworlds`.** In `lib/engine/faction-gen.ts`: add `ResourceVector` to the `@/lib/types/game` import, add the `HOMEWORLD_PLACEMENT` import, add `RESOURCE_TYPES` from resources, then add the function (place it after the output-type interfaces, near the top of the placement section):

```ts
// (extend existing imports)
import type { Doctrine, EconomyType, GovernmentType, ResourceVector } from "@/lib/types/game";
import { FACTION_ROSTER, MINOR_ADJECTIVES, MINOR_NOUNS, HOMEWORLD_PLACEMENT } from "@/lib/constants/factions";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
```

```ts
// ── Homeworld placement (spaced + seed-biased) ──────────────────

function homeworldTraitQuality(s: GeneratedSystem): number {
  let q = 0;
  for (const t of s.traits) q += t.quality;
  return q;
}

/** Count of resources this system has any deposit slot for — the "resource diversity" term. */
function homeworldResourceDiversity(slotCap: ResourceVector): number {
  let n = 0;
  for (const r of RESOURCE_TYPES) if (slotCap[r] > 0) n++;
  return n;
}

/**
 * Pick one well-spaced, high-substrate homeworld per faction. Score = weighted sum
 * of normalized (habitable base, resource diversity, trait quality) minus normalized
 * danger; greedy-select highest score first, requiring each pick to sit at least the
 * spacing threshold from all prior picks. The threshold relaxes on failure so a dense
 * galaxy degrades to "as spaced as it can be" rather than throwing. Deterministic:
 * scores derive from already-seeded substrate; ties break on index.
 */
export function placeHomeworlds(systems: GeneratedSystem[], count: number, mapSize: number): number[] {
  if (count <= 0 || systems.length === 0) return [];

  let maxHab = 1, maxDanger = 1, maxTrait = 1;
  for (const s of systems) {
    if (s.habitableSpace > maxHab) maxHab = s.habitableSpace;
    if (s.bodyDanger > maxDanger) maxDanger = s.bodyDanger;
    const tq = homeworldTraitQuality(s);
    if (tq > maxTrait) maxTrait = tq;
  }

  const w = HOMEWORLD_PLACEMENT.SCORE_WEIGHTS;
  const scored = systems
    .map((s) => ({
      idx: s.index,
      x: s.x,
      y: s.y,
      score:
        w.habitable * (s.habitableSpace / maxHab) +
        w.diversity * (homeworldResourceDiversity(s.slotCap) / RESOURCE_TYPES.length) +
        w.trait * (homeworldTraitQuality(s) / maxTrait) -
        w.danger * (s.bodyDanger / maxDanger),
    }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  let threshold = mapSize * HOMEWORLD_PLACEMENT.MIN_DISTANCE_FRACTION;
  for (let step = 0; step <= HOMEWORLD_PLACEMENT.MAX_RELAX_STEPS; step++) {
    const picked: { idx: number; x: number; y: number }[] = [];
    for (const c of scored) {
      if (picked.length === count) break;
      if (picked.every((p) => distance(c.x, c.y, p.x, p.y) >= threshold)) picked.push(c);
    }
    if (picked.length === count) return picked.map((p) => p.idx);
    threshold *= HOMEWORLD_PLACEMENT.RELAX_RATE;
  }
  // Fully relaxed and still short (fewer than `count` spaceable systems) → take the top-scoring.
  return scored.slice(0, count).map((p) => p.idx);
}
```

> Note: this step only **adds** `placeHomeworlds` and its two private helpers — it does not yet touch `generateFactions` or delete anything (that's Task 4), so `faction-gen.ts` and its callers still compile. The `RESOURCE_TYPES` and `ResourceVector`/`HOMEWORLD_PLACEMENT` imports are additive.

- [ ] **Step 5: Run test to verify it passes.**

Run: `npx vitest run lib/engine/__tests__/faction-gen.test.ts`
Expected: PASS (placement suite + the pre-existing `deriveDominantEconomy` suite).

- [ ] **Step 6: Commit.**

```bash
git add lib/constants/factions.ts lib/engine/faction-gen.ts lib/engine/__tests__/faction-gen.test.ts
git commit -m "$(cat <<'EOF'
feat(worldgen): add spaced, seed-biased homeworld placement

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Invert world-gen — homeworld-only ownership + emergent starting condition

Replace the flood-fill with homeworld-only placement and wire the emergent starting condition. This lands `faction-gen` and `universe-gen` **together** (the `generateFactions` signature change forces the `universe-gen` update to compile), plus their three test files. After this task the generated galaxy is: one developed homeworld per faction (its substrate industry + a seeded outpost + station), every other system `factionId: null`, population 0, no buildings.

**Determinism / RNG-stream note:** placement is pure (no RNG draw), whereas the old anchor/archetype placement consumed RNG. Removing those draws shifts the downstream RNG stream that names/colors minors — so minors get different (still deterministic) names/colors than before. This is expected: we validate the new gen by intrinsic coherence, not parity with old output. Same `{ systemCount, seed }` still ⇒ identical world.

**Files:**
- Modify: `lib/engine/faction-gen.ts` (rewrite `generateFactions`; add `assignHomeworldOwnership`; delete dead code; drop `archetype`)
- Modify: `lib/constants/factions.ts` (remove `MINOR_ARCHETYPE_DISTRIBUTION`, `MinorFactionArchetype`, `MIN_MINOR_TERRITORY`)
- Modify: `lib/constants/__tests__/factions.test.ts` (remove the archetype block)
- Modify: `lib/engine/universe-gen.ts` (add `applyEmergentStartingCondition`; wire `generateUniverse`)
- Test: `lib/engine/__tests__/universe-gen.test.ts`

**Interfaces:**
- Consumes: `placeHomeworlds` (Task 3), `OUTPOST_TYPE`/`SPACE_STATION_TYPE` (Task 1).
- Produces: `assignHomeworldOwnership(systemCount: number, factions: GeneratedFaction[]): number[]` (owned = faction index at each homeworld, `-1` elsewhere); `applyEmergentStartingCondition(systems: GeneratedSystem[], homeworldIndices: Set<number>): void` (mutates systems in place); `generateFactions(rng, systems, params: { minorFactionCount; mapSize })` (dropped `regions` + `minMinorTerritory`); `GeneratedFaction` **without** the `archetype` field.

- [ ] **Step 1: Update the constants + their test (make them red first).** In `lib/constants/factions.ts`, delete the entire `// ── Minor faction archetypes ──` section: the `MinorFactionArchetype` type, `MINOR_ARCHETYPE_DISTRIBUTION`, and `MIN_MINOR_TERRITORY` (lines ~116-141). In `lib/constants/__tests__/factions.test.ts`, delete the whole `describe("MINOR_ARCHETYPE_DISTRIBUTION", …)` block and remove `MINOR_ARCHETYPE_DISTRIBUTION` from the top import (leave `FACTION_ROSTER`).

- [ ] **Step 2: Rewrite the ownership + starting-condition tests (red).** In `lib/engine/__tests__/universe-gen.test.ts`:

Add these imports (extend the existing industry import if one exists, else add):
```ts
import { OUTPOST_TYPE, SPACE_STATION_TYPE } from "@/lib/constants/industry";
```
Delete these three now-obsolete tests: `"every system is assigned to some faction"`, `"every minor faction holds at least 5 systems (minimum floor)"`, `"minor archetypes total to the configured count"`, and `"frontier minors are placed near the map edge"`. Replace the first of them with the emergent-ownership pair:

```ts
it("owns only faction homeworlds; every other system is unclaimed (-1)", () => {
  const u = generateUniverse(defaultParams(), REGION_NAMES);
  const homeworlds = new Set(u.factions.map((f) => f.homeworldSystemIndex));
  for (let i = 0; i < u.systems.length; i++) {
    if (homeworlds.has(i)) expect(u.systemFactionAssignments[i]).toBeGreaterThanOrEqual(0);
    else expect(u.systemFactionAssignments[i]).toBe(-1);
  }
  const owned = u.systemFactionAssignments.filter((a) => a >= 0).length;
  expect(owned).toBe(u.factions.length); // exactly one owned system per faction
});

it("develops each homeworld (outpost + station) and leaves every other system unpopulated & unbuilt", () => {
  const u = generateUniverse(defaultParams(), REGION_NAMES);
  const homeworlds = new Set(u.factions.map((f) => f.homeworldSystemIndex));
  for (const s of u.systems) {
    if (homeworlds.has(s.index)) {
      expect(s.buildings[SPACE_STATION_TYPE]).toBeGreaterThan(0);
      expect(s.buildings[OUTPOST_TYPE]).toBeGreaterThan(0);
    } else {
      expect(s.population).toBe(0);
      expect(Object.keys(s.buildings)).toHaveLength(0);
    }
  }
});
```
Keep the two `selectStartingSystem` tests, the determinism test, and `"seeds 8 majors plus the configured minor count"` / `"majors cover all 8 government types"` / `"every faction has a distinct homeworld system"` / `"every faction has a unique name"` — all still valid. (If `distance` becomes an unused import after deleting the frontier test, remove it; Step 7's `tsc` will flag it.)

- [ ] **Step 3: Run tests to verify they fail.**

Run: `npx vitest run lib/constants/__tests__/factions.test.ts lib/engine/__tests__/universe-gen.test.ts`
Expected: FAIL / compile error — `MINOR_ARCHETYPE_DISTRIBUTION` gone, `systemFactionAssignments` still fully populated, homeworlds still developed-everywhere.

- [ ] **Step 4: Rewrite `generateFactions` + add `assignHomeworldOwnership`; delete the dead machinery.** In `lib/engine/faction-gen.ts`:

Remove from the `GeneratedFaction` interface the `archetype` field (and its doc line). Remove the `MinorFactionArchetype` import. In `FactionGenParams`, delete `mapSize`? — **no**, keep `mapSize` (placement needs it) and delete `minMinorTerritory`. Replace the whole `generateFactions` body with:

```ts
/**
 * Generate the faction roster (8 majors from FACTION_ROSTER + `minorFactionCount`
 * procedurally-named minors), then place one spaced, seed-biased homeworld per
 * faction. Majors and minors get identical treatment — status (major/minor
 * dominance) emerges from expansion, not seeding. Identities only differ by
 * name/government/doctrine/color.
 */
export function generateFactions(
  rng: RNG,
  systems: GeneratedSystem[],
  params: FactionGenParams,
): GeneratedFaction[] {
  const factions: GeneratedFaction[] = [];
  const usedHues: number[] = [];

  // ── Majors: one per government, from the fixed roster ──
  for (let i = 0; i < FACTION_ROSTER.length; i++) {
    const def = FACTION_ROSTER[i];
    factions.push({
      index: i,
      key: def.key,
      name: def.name,
      description: def.description,
      governmentType: def.governmentType,
      doctrine: def.doctrine,
      color: def.color,
      isMajor: true,
      homeworldSystemIndex: -1, // assigned by placeHomeworlds below
    });
    usedHues.push(hexToHue(def.color));
  }

  // ── Minors: procedurally named/colored, random government + doctrine ──
  const usedMinorNames = new Set<string>();
  for (let k = 0; k < params.minorFactionCount; k++) {
    const index = factions.length;
    const color = makeMinorColor(rng, usedHues);
    usedHues.push(hexToHue(color));
    factions.push({
      index,
      key: `minor_${index}`,
      name: makeMinorName(rng, usedMinorNames),
      description: "",
      governmentType: pickRandomGovernment(rng),
      doctrine: pickRandomDoctrine(rng),
      color,
      isMajor: false,
      homeworldSystemIndex: -1,
    });
  }

  // ── Placement: every faction gets a spaced, seed-biased homeworld ──
  const homeworlds = placeHomeworlds(systems, factions.length, params.mapSize);
  for (let i = 0; i < factions.length; i++) {
    factions[i].homeworldSystemIndex = homeworlds[i];
  }

  return factions;
}

/**
 * Ownership at emergent world-gen: only faction homeworlds are owned; every other
 * system is unclaimed (-1). Downstream (`gen.ts`) maps -1 → factionId null.
 */
export function assignHomeworldOwnership(
  systemCount: number,
  factions: GeneratedFaction[],
): number[] {
  const owner = new Array<number>(systemCount).fill(-1);
  for (const f of factions) owner[f.homeworldSystemIndex] = f.index;
  return owner;
}
```

Then **delete** the now-dead functions and their doc comments: `pickAnchorRegions`, `selectHomeworld`, `scoreHomeworldCandidate`, `computeArchetypeCounts` + `ArchetypeAllocation`, `pickMinorAnchor`, `pickBufferAnchor`, `pickFrontierAnchor`, `pickEnclaveAnchor`, `pickClusterAnchor`, `findNearestUnused`, `DOCTRINE_RANK`, `beatsTiebreak`, `assignSystemFactions`, and `enforceMinorMinimum`. Also drop the now-unused imports (`ALL_DOCTRINES`/`ALL_GOVERNMENT_TYPES` stay — used by `pickRandom*`; `MINOR_ARCHETYPE_DISTRIBUTION`, `GeneratedConnection`, `GeneratedRegion`, `randInt` — remove any that are no longer referenced; `tsc` in Step 7 confirms). Keep: `makeMinorName`, `makeMinorColor`, `hexToHue`, `hueDistance`, `hslToHex`, `pickRandomGovernment`, `pickRandomDoctrine`, `deriveDominantEconomy`, and the Task-3 placement helpers. Update the file's top doc comment to describe emergent homeworld-only placement (present tense).

- [ ] **Step 5: Add `applyEmergentStartingCondition` + wire `generateUniverse`.** In `lib/engine/universe-gen.ts`:

Change the faction-gen import and drop the minor-territory import:
```ts
import {
  generateFactions,
  assignHomeworldOwnership,
  applyEmergentStartingCondition, // defined below — or keep this helper here (see note)
  type GeneratedFaction,
} from "./faction-gen";
```
> Placement of `applyEmergentStartingCondition`: it shapes `GeneratedSystem` state, a universe-gen concern — **define it in `universe-gen.ts`** (not faction-gen), so drop it from the import above and add the import for the building-type ids instead:
```ts
import { OUTPOST_TYPE, SPACE_STATION_TYPE } from "@/lib/constants/industry";
```
Remove the `MIN_MINOR_TERRITORY` import. Add the helper (near `selectStartingSystem`):
```ts
/**
 * Apply the emergent starting condition to the freshly-scattered systems: develop
 * each faction homeworld (its substrate industry plus a seeded outpost + space-station
 * facility, so it's ungated and can grow), and zero every other system's population
 * and buildings. The physical substrate (space, slots, yields, danger, traits) is
 * left intact — expansion (PR2b) grows into it. Mutates `systems` in place.
 */
export function applyEmergentStartingCondition(
  systems: GeneratedSystem[],
  homeworldIndices: Set<number>,
): void {
  for (const s of systems) {
    if (homeworldIndices.has(s.index)) {
      s.buildings = { ...s.buildings, [OUTPOST_TYPE]: 1, [SPACE_STATION_TYPE]: 1 };
    } else {
      s.population = 0;
      s.buildings = {};
    }
  }
}
```
Rewrite the tail of `generateUniverse` (currently the `generateFactions` → `assignSystemFactions` → `selectStartingSystem` block):
```ts
  const factions = generateFactions(rng, systems, {
    minorFactionCount: params.minorFactionCount,
    mapSize: params.mapSize,
  });

  const homeworldIndices = new Set(factions.map((f) => f.homeworldSystemIndex));
  applyEmergentStartingCondition(systems, homeworldIndices);

  const systemFactionAssignments = assignHomeworldOwnership(systems.length, factions);

  const startingSystemIndex = selectStartingSystem(
    systems,
    factions,
    systemFactionAssignments,
    params.mapSize,
  );

  return {
    regions,
    systems,
    connections,
    factions,
    systemFactionAssignments,
    startingSystemIndex,
  };
```
> `selectStartingSystem` needs no change: with ownership now `-1` off-homeworld, `acceptedFactionIndices.has(assignments[s.index])` matches only the Federation homeworld, and the core-preference filter falls through to it. Its two tests still hold.

- [ ] **Step 6: Run the changed tests to verify they pass.**

Run: `npx vitest run lib/constants/__tests__/factions.test.ts lib/engine/__tests__/universe-gen.test.ts lib/engine/__tests__/faction-gen.test.ts lib/engine/__tests__/universe-gen-invariants.test.ts`
Expected: PASS (invariants unaffected — it reads only `economyType` + `traits`).

- [ ] **Step 7: Typecheck the whole graph.**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any dangling references to the deleted symbols (`assignSystemFactions`, `MIN_MINOR_TERRITORY`, `MINOR_ARCHETYPE_DISTRIBUTION`, `MinorFactionArchetype`, `.archetype`) and remove now-unused imports (`distance` in the universe-gen test, `randInt`/`GeneratedConnection`/`GeneratedRegion` in faction-gen if unreferenced).

- [ ] **Step 8: Commit.**

```bash
git add lib/engine/faction-gen.ts lib/engine/universe-gen.ts lib/constants/factions.ts \
  lib/constants/__tests__/factions.test.ts lib/engine/__tests__/universe-gen.test.ts
git commit -m "$(cat <<'EOF'
feat(worldgen): invert to homeworld-only ownership in a mostly-empty galaxy

Replace the BFS flood-fill (100% owned) + archetype minor placement with one
spaced, seed-biased homeworld per faction; develop homeworlds (outpost + station),
leave every other system unclaimed and unpopulated. Major/minor status now emerges
from expansion.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `gen.ts` null-ownership mapping + save-format bump

`generateWorld` currently does `factionId: factionIds[universe.systemFactionAssignments[s.index]]`, which now indexes `-1` for unclaimed systems (⇒ `factionIds[-1]` is `undefined`). Map `-1 → null`. Population/buildings/markets for unclaimed systems already come out empty because `applyEmergentStartingCondition` zeroed the substrate they derive from. Bump the save version.

**Files:**
- Modify: `lib/world/gen.ts:120-140` (the `systems` map)
- Modify: `lib/world/save.ts:16`
- Test: `lib/world/__tests__/gen.test.ts`

**Interfaces:**
- Consumes: `assignHomeworldOwnership`'s `-1` sentinel (Task 4).

- [ ] **Step 1: Rewrite the ownership test (red).** In `lib/world/__tests__/gen.test.ts`, replace the test `"assigns every system a factionId that resolves to a real faction (current gen never leaves a system unclaimed)"` with:

```ts
it("owns only faction homeworlds — every other system is null, unpopulated, and unbuilt", () => {
  const factionIds = new Set(world.factions.map((f) => f.id));
  const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
  const buildingsBySystem = new Map<string, number>();
  for (const b of world.buildings) {
    buildingsBySystem.set(b.systemId, (buildingsBySystem.get(b.systemId) ?? 0) + 1);
  }

  let ownedCount = 0;
  for (const sys of world.systems) {
    if (homeworldIds.has(sys.id)) {
      ownedCount++;
      expect(sys.factionId).not.toBeNull();
      if (sys.factionId !== null) expect(factionIds.has(sys.factionId)).toBe(true);
    } else {
      expect(sys.factionId).toBeNull();
      expect(sys.population).toBe(0);
      expect(buildingsBySystem.get(sys.id) ?? 0).toBe(0);
    }
  }
  expect(ownedCount).toBe(world.factions.length); // one owned homeworld per faction
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/world/__tests__/gen.test.ts`
Expected: FAIL — currently every system is owned (or `factionIds[-1]` produced an `undefined` id).

- [ ] **Step 3: Map `-1 → null` in `gen.ts`.** In `lib/world/gen.ts`, in the `systems` map (line ~128), change the `factionId` line:

```ts
    factionId:
      universe.systemFactionAssignments[s.index] === -1
        ? null
        : factionIds[universe.systemFactionAssignments[s.index]],
```

- [ ] **Step 4: Bump the save format version.** In `lib/world/save.ts`, change line 16:

```ts
export const SAVE_FORMAT_VERSION = 2;
```

- [ ] **Step 5: Run the gen suite.**

Run: `npx vitest run lib/world/__tests__/gen.test.ts`
Expected: PASS — including the round-trip, determinism, market-count, and region tests (markets are still one row per system×good; the round-trip still holds because `null` serializes cleanly).

- [ ] **Step 6: Commit.**

```bash
git add lib/world/gen.ts lib/world/save.ts lib/world/__tests__/gen.test.ts
git commit -m "$(cat <<'EOF'
feat(worldgen): map unclaimed systems to factionId null; bump save format to 2

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Docs + full verification gate (coarse sanity)

**Files:**
- Modify: `docs/active/gameplay/faction-system.md`
- Modify: `docs/SPEC.md`

- [ ] **Step 1: Rewrite the faction-system ownership/placement docs.** In `docs/active/gameplay/faction-system.md`, search for `flood-fill`, `archetype`, `buffer`/`frontier`/`enclave`/`cluster`, `MIN_MINOR_TERRITORY`, and any "every system belongs to a faction" wording, and rewrite those sections to the present-tense emergent model: each faction starts as **one developed homeworld** (seeded outpost + space-station facility + substrate industry), spaced apart and seed-biased for good substrate; every other system starts **unclaimed** (`factionId: null`, unpopulated); **major/minor status emerges** from expansion (the roster supplies identities — name/government/doctrine/color — only). State expansion/colonisation as a present pointer, not a mechanic: "Factions grow by claiming territory (see `docs/planned/substrate-reset.md`)." No change-history, no phase numbers.

- [ ] **Step 2: Reconcile SPEC.md.** In `docs/SPEC.md`, find the world-gen / faction-ownership description in the system map and update it to the emergent-civ starting condition (one developed homeworld per faction; mostly-empty galaxy; the three ownership states named, with only *unclaimed* and *developed-homeworld* live this phase and *controlled/outpost* + expansion arriving with the claim step). Keep it a headline-level description; details stay in the design docs.

- [ ] **Step 3: Run the full unit suite.**

Run: `npx vitest run`
Expected: PASS (all projects green). Reconcile any straggler that referenced deleted world-gen symbols or assumed a fully-owned galaxy.

- [ ] **Step 4: Coarse-sanity the calibration harness.**

Run: `npm run simulate`
Expected: completes without throwing; reported metrics contain **no `NaN`/`Infinity`** and no runaway/pinning. The galaxy is now mostly-empty — total population/production read far lower than the pre-inversion fully-owned galaxy (only ~8 + minor-count developed homeworlds), and most systems are inert. That sparse profile is expected and correct; the bar is intrinsic health (no NaN/runaway), not magnitude. Record the numbers in the PR description; do **not** tune.

- [ ] **Step 5: Run the build gate.**

Run: `npx next build --webpack`
Expected: build succeeds.

- [ ] **Step 6: Commit.**

```bash
git add docs/active/gameplay/faction-system.md docs/SPEC.md
git commit -m "$(cat <<'EOF'
docs(worldgen): describe the emergent-civ starting condition (present tense)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (against spec §0b, "Starting condition" + "Three ownership states")

- **One developed homeworld per faction; every other system unclaimed/unpopulated** → `placeHomeworlds` (Task 3) + `applyEmergentStartingCondition` (Task 4) + `-1 → null` (Task 5); asserted in Tasks 4-5. ✅
- **Seed bias (habitable fraction, resource diversity, low danger)** → normalized substrate score in `placeHomeworlds` (Task 3), tested for quality preference. ✅
- **Min-distance spacing with graceful relaxation** → relaxing threshold + top-N fallback (Task 3), tested for spacing + relaxation. ✅
- **Player spacing free** → all faction homeworlds are spaced by construction; whichever the player picks in SP1 is spaced (no player at gen time). ✅
- **Emergent status; roster = identities only** → archetype placement + minor-territory floor deleted; all factions get identical spaced treatment (Task 4). ✅
- **Three ownership states — unclaimed / controlled(outpost) / developed(station)** → the two building types + `hasStationFacility` gate (Tasks 1-2). *Controlled/outpost as a runtime state (claiming) is PR2b; this PR ships the types + gate + developed-homeworld seeding.* ✅ (scoped)
- **Existing build types gated on the facility** → `planFactionBuilds` `working`-set gate (Task 2), tested. ✅
- **`factionId: null` + its null-handling exercised** → `toSimSystems` government fallback + relations territory skip already handle null (no change needed; verified in the full-suite gate). ✅
- **Save invalidation** → `SAVE_FORMAT_VERSION → 2` (Task 5). ✅
- **Coarse sanity, no tuning** → Task 6 Step 4. ✅

**Placeholder scan:** every code step carries complete code. The docs steps (Task 6) give exact search terms + the target present-tense content, not "update the docs". The Task 2 Step 5 reconciliation and Task 4 Step 4 deletion list name the exact fixtures/symbols to touch. No `as`/`unknown`/postfix-`!` introduced. ✅

**Type consistency:** `placeHomeworlds(systems, count, mapSize): number[]` (Task 3) is consumed by `generateFactions` (Task 4); `assignHomeworldOwnership(systemCount, factions): number[]` returns the `-1`-sentinel array `gen.ts` reads (Task 5); `hasStationFacility(Record<string,number>)` (Task 1) is called with `s.buildings`/`site.buildings` (Task 2). `GeneratedFaction` loses `archetype` in one place (Task 4) with no remaining reader. ✅

## Deferred to PR2b (expansion claim step) and PR3

- **Controlled state as a runtime outcome** — the claim step (`null → factionId` + outpost), the reach provider (`systemsInReach`), two-phase deterministic claim resolution, shared-pool cost tiers, and colony population bootstrap (seed transfer). Needs the new `factionId`-writeback plumbing (directed-build output types + adapter methods + `tick.ts` merge). → PR2b, planned after this lands.
- **Penalised cross-unowned logistics + profiling/coarse-calibration at 600/5k/20k** → PR3.
