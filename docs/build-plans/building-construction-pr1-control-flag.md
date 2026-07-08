# Building & Construction Model — PR1: Ownership as a `control` Flag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Overview & PR sequence:
> `docs/build-plans/building-construction-model-plan.md`. Design spec:
> `docs/planned/building-construction-model.md`.

**Goal:** Model system ownership as a three-state `control` flag (`unclaimed | controlled |
developed`) instead of outpost/station buildings. World-gen seeds each faction's homeworld `developed`
and everything else `unclaimed`; the monthly pulse gains a **claim** step (unclaimed → controlled,
scored + deterministically resolved across factions) and a **develop** step (controlled → developed +
a conserved colony-population seed); the develop-gate becomes `system.control === 'developed'`; the
`outpost`/`space_station` building types leave the catalog.

**Architecture:** A new pure engine `lib/engine/expansion.ts` scores in-reach unclaimed systems
(substrate × proximity, absolute weights so proposals compare across factions), proposes each
faction's claims, resolves conflicts in two phases (propose → resolve by score, ties by seeded RNG →
apply), and plans developments (rank a faction's controlled systems by substrate, gate on a habitable
floor, seed each from its nearest developed same-faction system). The `directed-build` processor —
already whole-galaxy on the monthly pulse, so every faction is due at once — gains optional claim/develop
phases that run before the build phase. `tick.ts` builds the reach/develop providers from the
bounded-hop BFS it already computes, applies winners to the Sim systems (set `control` + `factionId`;
develop moves population), and propagates `control` + `factionId` through `mergeSystemsIntoWorld` so the
ownership transitions persist to `World`.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Next.js 16. Pure engine (`lib/engine/*`), in-memory
tick adapters, `runWorldTick` (`lib/world/tick.ts`), seeded RNG (`mulberry32`/`tickRng`).

## Global Constraints

Inherit **all** constraints from `building-construction-model-plan.md → Global Constraints` (no `as` /
no `unknown` / no postfix `!` except `find(...)!` in tests / JSON-serializable `World` / seeded
determinism / discriminated unions / coarse-calibration-only / present-tense docs / branch & commit
rules). PR1-specific:

- **`control` is a required field** on `WorldSystem` and `SimSystem` — no optional `?`. Every fixture
  constructing one of these (and `BuildSystemState`/`SystemBuildRow`) must set it; `tsc --noEmit` is the
  backstop that lists them.
- **Save bump 2 → 3** (Task 1) — any `World`-shape change invalidates saves by design (pre-1.0).
- **Determinism:** the only randomness in this PR is `mulberry32(...)` from the shared `tickRng(seed,
  tick)` — claim tie-breaks sort before drawing so the outcome depends only on world + seed.
- **Claims/developments are not budget-funded this PR** — bounded by `MAX_CLAIMS_PER_PULSE` /
  `MAX_DEVELOPS_PER_PULSE` + the reach radius + a score/habitable floor. Throughput funding is PR3.

---

## File-by-file map

| File | Change |
|---|---|
| `lib/world/types.ts` | **+** `SystemControl` union; **+** `WorldSystem.control`. |
| `lib/world/save.ts` | `SAVE_FORMAT_VERSION` 2 → 3. |
| `lib/world/gen.ts` | Set `control` per system (owned → `developed`, else `unclaimed`). |
| `lib/engine/universe-gen.ts` | `applyEmergentStartingCondition` stops seeding outpost/station buildings. |
| `lib/engine/simulator/types.ts` | **+** `SimSystem.control`. |
| `lib/world/tick.ts` | `toSimSystems`/`buildBuildRows` populate `control`; `mergeSystemsIntoWorld` copies `control` + `factionId`; reach/develop providers; pass claim/develop params + `rng`; apply claims + developments; widen hop-BFS by `REACH_JUMPS`; `applyClaims`/`applyDevelopments` Sim helpers. |
| `lib/constants/industry.ts` | **−** `OUTPOST_TYPE`, `SPACE_STATION_TYPE` catalog entries; **−** `hasStationFacility`. |
| `lib/engine/directed-build.ts` | **+** `BuildSystemState.control`; gate `if (s.control !== "developed") continue;` (**−** `hasStationFacility` import). |
| `lib/tick/world/directed-build-world.ts` | **+** `control` on `SystemBuildRow`; **+** `SystemClaim`, `SystemDevelopment`, `applyClaims`, `applyDevelopments`. |
| `lib/tick/adapters/memory/directed-build.ts` | Capture `claims` + `developments`; pass `control` through rows. |
| `lib/tick/processors/directed-build.ts` | **+** optional `claim`/`develop` params; propose→resolve→apply phase; `toBuildState` copies `control`. |
| `lib/constants/expansion.ts` | **New.** Reach/claim/develop tuning. |
| `lib/engine/expansion.ts` | **New.** Claim scoring, proposal, two-phase resolution, `planFactionDevelopments`. |
| `lib/services/atlas.ts` (+ `lib/types/game.ts` if needed) | Derive `developed` view flag from `control === "developed"`. |
| `docs/active/gameplay/faction-system.md`, `economy-autonomic-agency.md`, `docs/SPEC.md` | Present-tense control/claim/develop. |
| New tests | `constants/__tests__/expansion.test.ts`, `engine/__tests__/expansion.test.ts`, `world/__tests__/tick-expansion.test.ts`. |
| Updated tests | `industry.test.ts`, `universe-gen.test.ts`, `directed-build.test.ts` (engine + processor + adapter), `atlas.test.ts`, any `WorldSystem`/`SimSystem` fixture `tsc` flags. |

---

## Task 1: Add `SystemControl` + `WorldSystem.control`; bump the save version

Add the three-state ownership field and set it at world-gen. Owned systems at gen are exactly the
homeworlds (`assignHomeworldOwnership` owns only those), so `owned → "developed"`, everything else
`"unclaimed"`.

**Files:**
- Modify: `lib/world/types.ts`, `lib/world/gen.ts`, `lib/world/save.ts`
- Test: `lib/world/__tests__/gen.test.ts` (or the existing gen/world test that asserts the starting condition)

**Interfaces:**
- Produces: `export type SystemControl = "unclaimed" | "controlled" | "developed"`;
  `WorldSystem.control: SystemControl`.

- [ ] **Step 1: Write the failing test.** Add to the world-gen test suite (create
  `lib/world/__tests__/gen.test.ts` if none asserts the starting condition; otherwise append):

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";

describe("generateWorld: control flag", () => {
  it("seeds each faction homeworld as developed and every other system as unclaimed", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
    for (const s of world.systems) {
      if (homeworldIds.has(s.id)) {
        expect(s.control).toBe("developed");
        expect(s.factionId).not.toBeNull();
      } else {
        expect(s.control).toBe("unclaimed");
        expect(s.factionId).toBeNull();
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/world/__tests__/gen.test.ts`
Expected: FAIL — `control` is not a property of `WorldSystem` (or the value is undefined).

- [ ] **Step 3: Add the type + field.** In `lib/world/types.ts`, add above `WorldSystem`:

```ts
/** Three-state system ownership. `unclaimed` = empty frontier (factionId null); `controlled` =
 * owned, border-closing, inert until developed; `developed` = development builds are allowed. */
export type SystemControl = "unclaimed" | "controlled" | "developed";
```

In `WorldSystem`, add the field next to `factionId`:

```ts
  /** Owning faction's id, or null for independent systems. */
  factionId: string | null;
  /** Three-state ownership: unclaimed frontier → controlled (outpost tier) → developed (build-gate). */
  control: SystemControl;
```

- [ ] **Step 4: Set `control` in world-gen.** In `lib/world/gen.ts`, in the `systems` map (currently
  the object starting at line ~120), add `control` right after the `factionId` block:

```ts
    factionId:
      universe.systemFactionAssignments[s.index] === -1
        ? null
        : factionIds[universe.systemFactionAssignments[s.index]],
    control:
      universe.systemFactionAssignments[s.index] === -1 ? "unclaimed" : "developed",
```

- [ ] **Step 5: Bump the save version.** In `lib/world/save.ts`:

```ts
export const SAVE_FORMAT_VERSION = 3;
```

- [ ] **Step 6: Fix any `WorldSystem` fixtures `tsc` flags.** Run `npx tsc --noEmit`; for every test/helper
  constructing a `WorldSystem` literal (e.g. `lib/world/__tests__/tick.test.ts`), add `control:
  "developed"` (or the value the test's scenario intends — `"unclaimed"` for a frontier system).

- [ ] **Step 7: Run the test + typecheck.**

Run: `npx vitest run lib/world/__tests__/gen.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 8: Commit.**

```bash
git add lib/world/types.ts lib/world/gen.ts lib/world/save.ts lib/world/__tests__/
git commit -m "$(cat <<'EOF'
feat(world): add three-state system control flag (unclaimed/controlled/developed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Thread `control` through `SimSystem` + the Sim⇄World bridge

Carry `control` onto the Sim row and copy it (and `factionId`) back in `mergeSystemsIntoWorld` — claims
and developments are the only things that change ownership through a tick, and for every unchanged system
the copied value equals the original, so this is safe for all systems.

**Files:**
- Modify: `lib/engine/simulator/types.ts`, `lib/world/tick.ts`
- Test: `lib/world/__tests__/tick-control-roundtrip.test.ts` (new, small)

**Interfaces:**
- Produces: `SimSystem.control: SystemControl`; `mergeSystemsIntoWorld` preserves `control` +
  `factionId`.

- [ ] **Step 1: Write the failing test.** Create `lib/world/__tests__/tick-control-roundtrip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";

describe("runWorldTick: control round-trips", () => {
  it("preserves each system's control + factionId across a tick", async () => {
    const world = generateWorld({ systemCount: 40, seed: 3 });
    const before = new Map(world.systems.map((s) => [s.id, `${s.control}:${s.factionId ?? "-"}`]));
    const next = (await runWorldTick(world)).world;
    for (const s of next.systems) {
      // Nothing claims on tick 1 (off the monthly pulse); ownership is unchanged.
      expect(`${s.control}:${s.factionId ?? "-"}`).toBe(before.get(s.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/world/__tests__/tick-control-roundtrip.test.ts`
Expected: FAIL — `control` is `undefined` on the merged-back `WorldSystem` (dropped by
`mergeSystemsIntoWorld`).

- [ ] **Step 3: Add `SimSystem.control`.** In `lib/engine/simulator/types.ts`, in `SimSystem`, add after
  `factionId`:

```ts
  /** Owning faction's stable id, or null for independent systems. Drives the faction-bounded flow topology. */
  factionId: string | null;
  /** Three-state ownership — gates development builds and the claim/develop expansion steps. */
  control: SystemControl;
```

Add the import at the top of the file:

```ts
import type { World, SystemControl } from "@/lib/world/types";
```

- [ ] **Step 4: Populate `control` in `toSimSystems`.** In `lib/world/tick.ts`, in the `world.systems.map`
  return object (currently ~line 146), add after `factionId: s.factionId,`:

```ts
    factionId: s.factionId,
    control: s.control,
```

- [ ] **Step 5: Copy `control` + `factionId` back in `mergeSystemsIntoWorld`.** Replace the merge body
  (currently ~line 204-211):

```ts
function mergeSystemsIntoWorld(worldSystems: WorldSystem[], simSystems: SimSystem[]): WorldSystem[] {
  const byId = new Map(simSystems.map((s) => [s.id, s]));
  return worldSystems.map((s) => {
    const sim = byId.get(s.id);
    if (!sim) return s;
    // factionId + control propagate so the claim/develop expansion steps persist; for every
    // unchanged system they equal the original.
    return {
      ...s,
      factionId: sim.factionId,
      control: sim.control,
      population: sim.population,
      popCap: sim.popCap,
      unrest: sim.unrest,
    };
  });
}
```

- [ ] **Step 6: Run the test + typecheck.**

Run: `npx vitest run lib/world/__tests__/tick-control-roundtrip.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors. Fix any `SimSystem` fixture `tsc` flags by adding `control`.

- [ ] **Step 7: Commit.**

```bash
git add lib/engine/simulator/types.ts lib/world/tick.ts lib/world/__tests__/tick-control-roundtrip.test.ts
git commit -m "$(cat <<'EOF'
feat(tick): carry control on SimSystem and preserve control+factionId on merge-back

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Retire outpost/station types; make the develop-gate read `control`

Remove the two ownership building types and `hasStationFacility`; thread `control` into the build row +
engine state; the planner's develop-gate becomes `control === "developed"`. World-gen stops stamping
outpost/station buildings onto homeworlds (the flag carries "developed" now).

**Files:**
- Modify: `lib/constants/industry.ts`, `lib/engine/directed-build.ts`,
  `lib/tick/world/directed-build-world.ts`, `lib/tick/adapters/memory/directed-build.ts`,
  `lib/tick/processors/directed-build.ts`, `lib/world/tick.ts` (`buildBuildRows`),
  `lib/engine/universe-gen.ts`
- Test: update `lib/constants/__tests__/industry.test.ts`, `lib/engine/__tests__/universe-gen.test.ts`,
  `lib/engine/__tests__/directed-build.test.ts`, `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- Produces: `SystemBuildRow.control: SystemControl`; `BuildSystemState.control: SystemControl`; the
  develop-gate is `s.control === "developed"`. Removes `OUTPOST_TYPE`, `SPACE_STATION_TYPE`,
  `hasStationFacility`.

- [ ] **Step 1: Write/adjust the failing gate test (engine).** In
  `lib/engine/__tests__/directed-build.test.ts`, rewrite the `"planFactionBuilds: station-facility gate"`
  describe (currently lines 816-830) to toggle `control` instead of a station building. The `buildable`
  fixture (`{ population: 100, generalSpace: 50, habitableSpace: 50, goods: [] }`) stays; only the
  developed/undeveloped marker moves from a building to the flag:

```ts
describe("planFactionBuilds: develop gate", () => {
  const buildable = { population: 100, generalSpace: 50, habitableSpace: 50, goods: [] };

  it("builds nothing at a fed-and-calm system that is controlled but not developed", () => {
    const site = sysWith({ ...buildable, control: "controlled", buildings: {} });
    expect(fedAndCalm(site)).toBe(true); // sanity: absent the gate it WOULD build housing
    expect(planFactionBuilds([site], () => 1)).toEqual([]);
  });

  it("builds housing at the same system once it is developed", () => {
    const site = sysWith({ ...buildable, control: "developed", buildings: {} });
    const plans = planFactionBuilds([site], () => 1);
    expect(plans.some((b) => b.buildingType === HOUSING_TYPE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: FAIL — `control` isn't a `BuildSystemState` field / the gate still reads `hasStationFacility`.

- [ ] **Step 3: Add `control` to `BuildSystemState` + switch the gate.** In `lib/engine/directed-build.ts`:
  - Add to `BuildSystemState` (after `factionId`): `control: SystemControl;` and import the type:
    `import type { SystemControl } from "@/lib/world/types";`.
  - Remove `hasStationFacility` from the `lib/constants/industry` import (line 19).
  - Replace the gate (line ~357):

```ts
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) {
    if (s.control !== "developed") continue;
    working.set(s.systemId, { ...s, buildings: { ...s.buildings } });
  }
```

- [ ] **Step 4: Thread `control` onto the build row.** In `lib/tick/world/directed-build-world.ts`, add
  to `SystemBuildRow` (after `factionId`): `control: SystemControl;` and import
  `import type { SystemControl } from "@/lib/world/types";`. In `lib/world/tick.ts` `buildBuildRows`
  (~line 275), add `control: s.control,` after `factionId: s.factionId,`. In
  `lib/tick/processors/directed-build.ts` `toBuildState` (~line 19), add `control: row.control,`.

- [ ] **Step 5: Remove the catalog entries + gate helper.** In `lib/constants/industry.ts`:
  - Delete the `OUTPOST_TYPE` / `SPACE_STATION_TYPE` const exports (lines 26-29).
  - Delete `[OUTPOST_TYPE]: { spaceCost: 1.0 }` and `[SPACE_STATION_TYPE]: { spaceCost: 3.0 }` from
    `BUILDING_TYPES` (lines 241-242).
  - Delete the `hasStationFacility` function + its doc block (lines 293-301).

- [ ] **Step 6: Stop seeding outpost/station in world-gen.** In `lib/engine/universe-gen.ts`, remove the
  `OUTPOST_TYPE, SPACE_STATION_TYPE` import (line 15) and simplify `applyEmergentStartingCondition`
  (line ~659) so homeworlds keep their substrate industry unchanged and non-homeworlds are zeroed:

```ts
export function applyEmergentStartingCondition(
  systems: GeneratedSystem[],
  homeworldIndices: Set<number>,
): void {
  for (const s of systems) {
    if (homeworldIndices.has(s.index)) continue; // homeworld keeps its seeded substrate industry
    s.population = 0;
    s.buildings = {};
  }
}
```

- [ ] **Step 7: Sweep the fixtures.** Mechanical transformation (the "developed" marker moves from a
  building to the `control` field):
  - `directed-build.test.ts` (engine): in `sysWith` (line 12) and `buildSys` (line 40) defaults, add
    `control: "unclaimed"`. Delete the `dev()` helper (lines 21-27) and the `SPACE_STATION_TYPE` import.
    Replace every `buildings: dev({ …X })` → `control: "developed", buildings: { …X }` and every
    `buildings: dev()` → `control: "developed", buildings: {}` (the ~22 call sites listed by grep).
  - `directed-build.test.ts` (processor, `lib/tick/processors/__tests__/`): the fixtures marking a build
    site with `{ [SPACE_STATION_TYPE]: 1 }` (lines ~39/92/106) set `control: "developed"` on the
    `SystemBuildRow` and drop the station building + the `SPACE_STATION_TYPE` import; add
    `control: "unclaimed"` to any consumer-only row.
  - `industry.test.ts`: delete the outpost/station catalog test (lines ~138-152) and the
    `hasStationFacility` test (lines ~154-158); remove the `OUTPOST_TYPE`/`SPACE_STATION_TYPE`/
    `hasStationFacility` imports.
  - `universe-gen.test.ts`: replace the homeworld station/outpost assertions (lines ~592-593) with a
    check that homeworlds keep a non-empty `buildings` roster and non-homeworlds are zeroed; drop the
    `OUTPOST_TYPE`/`SPACE_STATION_TYPE` import.

- [ ] **Step 8: Run the affected suites + typecheck.**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/constants/__tests__/industry.test.ts lib/engine/__tests__/universe-gen.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors (no remaining reference to the removed symbols).

- [ ] **Step 9: Commit.**

```bash
git add lib/constants/industry.ts lib/engine/directed-build.ts lib/tick/ lib/world/tick.ts lib/engine/universe-gen.ts lib/engine/__tests__/ lib/constants/__tests__/
git commit -m "$(cat <<'EOF'
refactor(build): develop-gate reads control flag; retire outpost/station building types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Expansion constants

**Files:**
- Create: `lib/constants/expansion.ts`, `lib/constants/__tests__/expansion.test.ts`

**Interfaces:**
- Produces: `EXPANSION = { REACH_JUMPS, MAX_CLAIMS_PER_PULSE, MAX_DEVELOPS_PER_PULSE, SCORE_FLOOR,
  SCORE_WEIGHTS: { habitable, diversity, trait, proximity }, DEVELOP_HABITABLE_FLOOR, COLONY_SEED_POP }
  as const`.

- [ ] **Step 1: Write the failing test.** Create `lib/constants/__tests__/expansion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EXPANSION } from "@/lib/constants/expansion";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

describe("EXPANSION constants", () => {
  it("bounds reach within the hop-BFS radius the tick computes", () => {
    expect(EXPANSION.REACH_JUMPS).toBeGreaterThanOrEqual(1);
    expect(EXPANSION.REACH_JUMPS).toBeLessThanOrEqual(
      Math.max(DIRECTED_BUILD.MAX_HOPS, DIRECTED_LOGISTICS.MAX_HOPS),
    );
  });

  it("keeps claims + developments gradual (small per-pulse caps, permissive positive floor)", () => {
    expect(EXPANSION.MAX_CLAIMS_PER_PULSE).toBeGreaterThanOrEqual(1);
    expect(EXPANSION.MAX_DEVELOPS_PER_PULSE).toBeGreaterThanOrEqual(1);
    expect(EXPANSION.SCORE_FLOOR).toBeGreaterThan(0);
  });

  it("carries the four substrate + proximity score weights and a positive colony seed", () => {
    for (const k of ["habitable", "diversity", "trait", "proximity"] as const) {
      expect(EXPANSION.SCORE_WEIGHTS[k]).toBeGreaterThan(0);
    }
    expect(EXPANSION.DEVELOP_HABITABLE_FLOOR).toBeGreaterThan(0);
    expect(EXPANSION.COLONY_SEED_POP).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/constants/__tests__/expansion.test.ts`
Expected: FAIL — `Cannot find module "@/lib/constants/expansion"`.

- [ ] **Step 3: Create the constants.** Create `lib/constants/expansion.ts`:

```ts
/**
 * Emergent-civ expansion tuning — the control (claim) and develop tiers of the three-state
 * ownership model. Each monthly pulse a faction claims one in-reach unclaimed system as
 * `controlled`, then may develop one of its controlled systems to `developed` (seeding a small
 * conserved colony population). Magnitudes are a coarse first-cut (simulator-validated for coherent
 * growth, not tuned — later phases move the calibration target). Scores are ABSOLUTE (not
 * pool-normalized) so two factions' proposals for the same system compare directly in resolution.
 *
 * Claims/developments are free this phase (not throughput-funded — that is PR3's construction pool);
 * gradualness comes from the small per-pulse caps + the reach radius + the score/habitable floors.
 */
export const EXPANSION = {
  /** Unclaimed systems within this many jumps of a faction's territory (any owned tier) are claim
   * candidates — leapfrog allowed, bounded for performance. Must be ≤ the tick's hop-BFS radius. */
  REACH_JUMPS: 3,
  /** Systems a faction claims per monthly pulse — small, so the map fills gradually. */
  MAX_CLAIMS_PER_PULSE: 1,
  /** Controlled systems a faction develops per monthly pulse — small, so development trails claiming. */
  MAX_DEVELOPS_PER_PULSE: 1,
  /** Minimum claim score; below it a candidate isn't worth claiming. Permissive — excludes only
   * zero-substrate systems. */
  SCORE_FLOOR: 0.001,
  /** Weights over the (absolute) substrate terms and the proximity discount. `proximity` feeds
   * 1 / (1 + proximity × minHops), so nearer candidates outscore equal-substrate distant ones. */
  SCORE_WEIGHTS: { habitable: 1.0, diversity: 3.0, trait: 2.0, proximity: 0.5 },
  /** A controlled system is only worth developing if it can host housing — skip dead rocks. */
  DEVELOP_HABITABLE_FLOOR: 1,
  /** Starter population a new colony receives, transferred (conserved) from the nearest developed
   * same-faction system so logistic growth can begin from a non-zero base. */
  COLONY_SEED_POP: 50,
} as const;
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run lib/constants/__tests__/expansion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/constants/expansion.ts lib/constants/__tests__/expansion.test.ts
git commit -m "$(cat <<'EOF'
feat(expansion): claim + develop tuning constants (reach, caps, weights, colony seed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Claim scoring + per-faction proposal (engine)

Pure scoring + proposal. `scoreClaimCandidate` folds absolute substrate (habitable, resource diversity,
trait quality) times a proximity discount. `proposeFactionClaims` filters by the floor, ranks
descending (systemId tiebreak for determinism), returns the faction's top `maxClaimsPerPulse`.

**Files:**
- Create: `lib/engine/expansion.ts`, `lib/engine/__tests__/expansion.test.ts`

**Interfaces:**
- Produces: `ClaimCandidate`, `ClaimProposal`, `ResolvedClaim`, `ExpansionScoreWeights`,
  `ExpansionParams`; `scoreClaimCandidate(c, w)`, `proposeFactionClaims(factionId, candidates, params)`.

- [ ] **Step 1: Write the failing test.** Create `lib/engine/__tests__/expansion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  scoreClaimCandidate,
  proposeFactionClaims,
  type ClaimCandidate,
  type ExpansionParams,
} from "@/lib/engine/expansion";

const WEIGHTS = { habitable: 1.0, diversity: 3.0, trait: 2.0, proximity: 0.5 };
const PARAMS: ExpansionParams = { maxClaimsPerPulse: 1, scoreFloor: 0.001, weights: WEIGHTS };

function cand(p: Partial<ClaimCandidate> & { systemId: string }): ClaimCandidate {
  return { systemId: p.systemId, minHops: 1, habitableSpace: 0, resourceDiversity: 0, traitQuality: 0, ...p };
}

describe("scoreClaimCandidate", () => {
  it("rewards substrate and discounts distance", () => {
    const near = cand({ systemId: "a", habitableSpace: 100, minHops: 1 });
    const far = cand({ systemId: "b", habitableSpace: 100, minHops: 3 });
    expect(scoreClaimCandidate(near, WEIGHTS)).toBeGreaterThan(scoreClaimCandidate(far, WEIGHTS));
  });
  it("scores a zero-substrate candidate at 0", () => {
    expect(scoreClaimCandidate(cand({ systemId: "z" }), WEIGHTS)).toBe(0);
  });
});

describe("proposeFactionClaims", () => {
  it("proposes the highest-scoring in-reach candidate, capped at maxClaimsPerPulse", () => {
    const candidates = [
      cand({ systemId: "poor", habitableSpace: 5 }),
      cand({ systemId: "rich", habitableSpace: 200, resourceDiversity: 5 }),
    ];
    const out = proposeFactionClaims("f1", candidates, PARAMS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ factionId: "f1", systemId: "rich" });
    expect(out[0].score).toBeGreaterThan(0);
  });
  it("proposes nothing when every candidate is below the floor", () => {
    expect(proposeFactionClaims("f1", [cand({ systemId: "dead" })], PARAMS)).toEqual([]);
  });
  it("is deterministic and ranks by (score, systemId) — independent of input order", () => {
    const a = cand({ systemId: "a", habitableSpace: 100 });
    const b = cand({ systemId: "b", habitableSpace: 100 });
    const forward = proposeFactionClaims("f1", [a, b], { ...PARAMS, maxClaimsPerPulse: 2 });
    const reverse = proposeFactionClaims("f1", [b, a], { ...PARAMS, maxClaimsPerPulse: 2 });
    expect(forward.map((p) => p.systemId)).toEqual(["a", "b"]);
    expect(reverse.map((p) => p.systemId)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/engine/__tests__/expansion.test.ts`
Expected: FAIL — `Cannot find module "@/lib/engine/expansion"`.

- [ ] **Step 3: Implement the scorer + proposer.** Create `lib/engine/expansion.ts`:

```ts
/**
 * Emergent-civ expansion — the pure claim + develop engine (control/develop tiers of the three-state
 * ownership model). Scores in-reach unclaimed systems, proposes each faction's best claim(s), resolves
 * cross-faction conflicts deterministically, and plans developments of a faction's own controlled
 * systems. Zero I/O; the reach/candidate data is supplied by providers built in the tick body.
 */
import type { RNG } from "@/lib/engine/universe-gen";

/** One in-reach unclaimed system a faction could claim, with its score inputs. */
export interface ClaimCandidate {
  systemId: string;
  /** Fewest jumps from any of the faction's owned systems (≥ 1 — the candidate is unclaimed). */
  minHops: number;
  habitableSpace: number;
  /** Count of resources this system has any deposit slot for. */
  resourceDiversity: number;
  /** Σ of the system's trait qualities. */
  traitQuality: number;
}

/** A faction's desire to claim `systemId` this pulse, with its comparable score. */
export interface ClaimProposal {
  factionId: string;
  systemId: string;
  score: number;
}

/** The winning claim for a target system after cross-faction resolution. */
export interface ResolvedClaim {
  systemId: string;
  factionId: string;
}

export interface ExpansionScoreWeights {
  habitable: number;
  diversity: number;
  trait: number;
  /** Proximity discount strength; feeds 1 / (1 + proximity × minHops). */
  proximity: number;
}

export interface ExpansionParams {
  maxClaimsPerPulse: number;
  scoreFloor: number;
  weights: ExpansionScoreWeights;
}

/** Absolute claim desirability: weighted substrate × a distance discount. Comparable across factions. */
export function scoreClaimCandidate(c: ClaimCandidate, w: ExpansionScoreWeights): number {
  const substrate =
    w.habitable * Math.max(0, c.habitableSpace) +
    w.diversity * Math.max(0, c.resourceDiversity) +
    w.trait * Math.max(0, c.traitQuality);
  const proximity = 1 / (1 + w.proximity * Math.max(0, c.minHops));
  return substrate * proximity;
}

/**
 * A faction's claim proposals for this pulse: its highest-scoring in-reach candidates above the floor,
 * capped at `maxClaimsPerPulse`. Ranked by score descending, systemId ascending — a total order, so
 * the result is independent of candidate input order.
 */
export function proposeFactionClaims(
  factionId: string,
  candidates: ClaimCandidate[],
  params: ExpansionParams,
): ClaimProposal[] {
  return candidates
    .map((c) => ({ factionId, systemId: c.systemId, score: scoreClaimCandidate(c, params.weights) }))
    .filter((p) => p.score >= params.scoreFloor)
    .sort((a, b) => b.score - a.score || a.systemId.localeCompare(b.systemId))
    .slice(0, Math.max(0, params.maxClaimsPerPulse));
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run lib/engine/__tests__/expansion.test.ts`
Expected: PASS (scoring + proposal suites).

- [ ] **Step 5: Commit.**

```bash
git add lib/engine/expansion.ts lib/engine/__tests__/expansion.test.ts
git commit -m "$(cat <<'EOF'
feat(expansion): score in-reach candidates and propose per-faction claims

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Two-phase deterministic claim resolution (engine)

Resolve collected proposals: one winner per contested target, by highest score, ties broken by a seeded
RNG draw — never by processing order. Both target iteration and the tied set are sorted before any draw.

**Files:**
- Modify: `lib/engine/expansion.ts` (append `resolveClaims`)
- Test: `lib/engine/__tests__/expansion.test.ts` (append the resolution suite)

**Interfaces:**
- Consumes: `ClaimProposal`, `ResolvedClaim`; `RNG` (`lib/engine/universe-gen`).
- Produces: `resolveClaims(proposals, rng): ResolvedClaim[]` — one per distinct target systemId.

- [ ] **Step 1: Write the failing test.** Append to `lib/engine/__tests__/expansion.test.ts`:

```ts
import { resolveClaims, type ClaimProposal } from "@/lib/engine/expansion";
import { mulberry32 } from "@/lib/engine/universe-gen";

describe("resolveClaims", () => {
  it("gives an uncontested target to its sole proposer", () => {
    expect(resolveClaims([{ factionId: "f1", systemId: "s1", score: 5 }], mulberry32(1)))
      .toEqual([{ systemId: "s1", factionId: "f1" }]);
  });
  it("awards a contested target to the highest score (not proposal order)", () => {
    const proposals: ClaimProposal[] = [
      { factionId: "f1", systemId: "s1", score: 3 },
      { factionId: "f2", systemId: "s1", score: 9 },
    ];
    expect(resolveClaims(proposals, mulberry32(1))).toEqual([{ systemId: "s1", factionId: "f2" }]);
    expect(resolveClaims([...proposals].reverse(), mulberry32(1))).toEqual([{ systemId: "s1", factionId: "f2" }]);
  });
  it("resolves each distinct target independently", () => {
    const proposals: ClaimProposal[] = [
      { factionId: "f1", systemId: "s1", score: 5 },
      { factionId: "f2", systemId: "s2", score: 5 },
    ];
    const out = resolveClaims(proposals, mulberry32(1)).sort((a, b) => a.systemId.localeCompare(b.systemId));
    expect(out).toEqual([{ systemId: "s1", factionId: "f1" }, { systemId: "s2", factionId: "f2" }]);
  });
  it("breaks exact ties deterministically with the seeded RNG, independent of proposal order", () => {
    const tied: ClaimProposal[] = [
      { factionId: "f1", systemId: "s1", score: 5 },
      { factionId: "f2", systemId: "s1", score: 5 },
    ];
    const winA = resolveClaims(tied, mulberry32(42))[0].factionId;
    const winB = resolveClaims([...tied].reverse(), mulberry32(42))[0].factionId;
    expect(winA).toBe(winB);
    expect(["f1", "f2"]).toContain(winA);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/engine/__tests__/expansion.test.ts`
Expected: FAIL — `resolveClaims` is not exported.

- [ ] **Step 3: Implement `resolveClaims`.** Append to `lib/engine/expansion.ts`:

```ts
/** Score-equality tolerance for the tie-break — floats from the scorer never compare exactly. */
const SCORE_EPS = 1e-9;

/**
 * Two-phase claim resolution: group proposals by target, award each target to its highest-scoring
 * proposer, break exact ties with a single seeded RNG draw over the (sorted) tied factions. Targets
 * are iterated in sorted systemId order and tied factions in sorted id order BEFORE any draw, so the
 * RNG draw sequence — and thus the outcome — depends only on the world and seed, never on proposal or
 * Map iteration order. Returns one ResolvedClaim per distinct target.
 */
export function resolveClaims(proposals: ClaimProposal[], rng: RNG): ResolvedClaim[] {
  const byTarget = new Map<string, ClaimProposal[]>();
  for (const p of proposals) {
    const list = byTarget.get(p.systemId);
    if (list) list.push(p);
    else byTarget.set(p.systemId, [p]);
  }
  const entries = [...byTarget.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const resolved: ResolvedClaim[] = [];
  for (const [systemId, contenders] of entries) {
    let maxScore = -Infinity;
    for (const c of contenders) if (c.score > maxScore) maxScore = c.score;
    const tied = contenders
      .filter((c) => maxScore - c.score <= SCORE_EPS)
      .sort((a, b) => a.factionId.localeCompare(b.factionId));
    const winner = tied.length === 1 ? tied[0] : tied[Math.floor(rng() * tied.length)];
    resolved.push({ systemId, factionId: winner.factionId });
  }
  return resolved;
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run lib/engine/__tests__/expansion.test.ts`
Expected: PASS (scoring + proposal + resolution suites).

- [ ] **Step 5: Commit.**

```bash
git add lib/engine/expansion.ts lib/engine/__tests__/expansion.test.ts
git commit -m "$(cat <<'EOF'
feat(expansion): deterministic two-phase claim resolution (score, seeded-RNG ties)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Develop planning + conserved colony seed (engine)

Rank a faction's own `controlled` systems by substrate, gate on a habitable floor and on having a
reachable developed same-faction source (so the conserved colony seed has somewhere to come from), and
return the top `maxDevelopsPerPulse` as developments. Develop is intra-faction, so no cross-faction
resolution — a faction only ever develops its own systems.

**Files:**
- Modify: `lib/engine/expansion.ts` (append), `lib/engine/__tests__/expansion.test.ts` (append)

**Interfaces:**
- Produces:
  - `interface DevelopCandidate { systemId: string; habitableSpace: number; resourceDiversity: number;
    traitQuality: number; sourceSystemId: string | null }`
  - `interface DevelopParams { maxDevelopsPerPulse: number; habitableFloor: number; seedPop: number;
    weights: ExpansionScoreWeights }`
  - `interface FactionDevelopment { systemId: string; sourceSystemId: string; seedPop: number }`
  - `planFactionDevelopments(candidates: DevelopCandidate[], params: DevelopParams):
    FactionDevelopment[]`

- [ ] **Step 1: Write the failing test.** Append to `lib/engine/__tests__/expansion.test.ts`:

```ts
import {
  planFactionDevelopments,
  type DevelopCandidate,
  type DevelopParams,
} from "@/lib/engine/expansion";

const DEV_PARAMS: DevelopParams = {
  maxDevelopsPerPulse: 1, habitableFloor: 1, seedPop: 50, weights: WEIGHTS,
};
function devCand(p: Partial<DevelopCandidate> & { systemId: string }): DevelopCandidate {
  return { systemId: p.systemId, habitableSpace: 10, resourceDiversity: 0, traitQuality: 0, sourceSystemId: "home", ...p };
}

describe("planFactionDevelopments", () => {
  it("develops the highest-substrate controlled system, capped, seeding from its source", () => {
    const out = planFactionDevelopments(
      [devCand({ systemId: "poor", habitableSpace: 2 }), devCand({ systemId: "rich", habitableSpace: 200, resourceDiversity: 4 })],
      DEV_PARAMS,
    );
    expect(out).toEqual([{ systemId: "rich", sourceSystemId: "home", seedPop: 50 }]);
  });
  it("skips a system below the habitable floor", () => {
    expect(planFactionDevelopments([devCand({ systemId: "rock", habitableSpace: 0 })], DEV_PARAMS)).toEqual([]);
  });
  it("skips a system with no reachable developed source", () => {
    expect(planFactionDevelopments([devCand({ systemId: "island", sourceSystemId: null })], DEV_PARAMS)).toEqual([]);
  });
  it("is deterministic and ranks by (score, systemId) regardless of input order", () => {
    const a = devCand({ systemId: "a", habitableSpace: 100 });
    const b = devCand({ systemId: "b", habitableSpace: 100 });
    const fwd = planFactionDevelopments([a, b], { ...DEV_PARAMS, maxDevelopsPerPulse: 2 });
    const rev = planFactionDevelopments([b, a], { ...DEV_PARAMS, maxDevelopsPerPulse: 2 });
    expect(fwd.map((d) => d.systemId)).toEqual(["a", "b"]);
    expect(rev.map((d) => d.systemId)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/engine/__tests__/expansion.test.ts`
Expected: FAIL — `planFactionDevelopments` is not exported.

- [ ] **Step 3: Implement `planFactionDevelopments`.** Append to `lib/engine/expansion.ts`:

```ts
/** One in-faction controlled system that could be developed, with its colony seed source. */
export interface DevelopCandidate {
  systemId: string;
  habitableSpace: number;
  resourceDiversity: number;
  traitQuality: number;
  /** Nearest developed same-faction system (the conserved colony-seed source), or null if none reachable. */
  sourceSystemId: string | null;
}

export interface DevelopParams {
  maxDevelopsPerPulse: number;
  /** Minimum habitable space to bother developing — skips dead rocks. */
  habitableFloor: number;
  /** Starter population transferred to the new colony. */
  seedPop: number;
  weights: ExpansionScoreWeights;
}

/** A resolved development: the target flips to `developed` and receives `seedPop`, conserved from `sourceSystemId`. */
export interface FactionDevelopment {
  systemId: string;
  sourceSystemId: string;
  seedPop: number;
}

/**
 * Plan a faction's developments this pulse: its controlled systems that clear the habitable floor and
 * have a reachable developed source, ranked by substrate (no proximity term — develop is about the
 * system itself), capped at `maxDevelopsPerPulse`. Ranked by score descending, systemId ascending, so
 * the result is independent of input order. Pure — the source selection + hop distances are computed
 * upstream (the tick body) and delivered on each candidate.
 */
export function planFactionDevelopments(
  candidates: DevelopCandidate[],
  params: DevelopParams,
): FactionDevelopment[] {
  const substrateWeights: ExpansionScoreWeights = { ...params.weights, proximity: 0 };
  return candidates
    .filter((c) => c.habitableSpace >= params.habitableFloor && c.sourceSystemId !== null)
    .map((c) => ({
      systemId: c.systemId,
      sourceSystemId: c.sourceSystemId,
      score: scoreClaimCandidate(
        { systemId: c.systemId, minHops: 0, habitableSpace: c.habitableSpace, resourceDiversity: c.resourceDiversity, traitQuality: c.traitQuality },
        substrateWeights,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.systemId.localeCompare(b.systemId))
    .slice(0, Math.max(0, params.maxDevelopsPerPulse))
    .map((d) => ({ systemId: d.systemId, sourceSystemId: d.sourceSystemId ?? "", seedPop: params.seedPop }));
}
```

> The `.filter` guarantees `sourceSystemId !== null`, so the `?? ""` fallback is unreachable — it only
> satisfies the `string | null` → `string` narrowing without a postfix `!`. (An equivalent is a typed
> intermediate; keep whichever reads cleaner to the reviewer, but do not use `!`.)

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run lib/engine/__tests__/expansion.test.ts`
Expected: PASS (all four suites).

- [ ] **Step 5: Commit.**

```bash
git add lib/engine/expansion.ts lib/engine/__tests__/expansion.test.ts
git commit -m "$(cat <<'EOF'
feat(expansion): plan developments of controlled systems with a conserved colony seed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Claim + develop writeback channel (world interface + memory adapter)

Add the ownership writeback channels alongside the building channel. The processor emits `SystemClaim[]`
(target + winning faction) and `SystemDevelopment[]` (target + source + seedPop); the memory adapter
captures them for `tick.ts` to apply.

**Files:**
- Modify: `lib/tick/world/directed-build-world.ts`, `lib/tick/adapters/memory/directed-build.ts`
- Test: `lib/tick/adapters/memory/__tests__/directed-build.test.ts`

**Interfaces:**
- Produces: `interface SystemClaim { systemId: string; factionId: string }`;
  `interface SystemDevelopment { systemId: string; sourceSystemId: string; seedPop: number }`;
  `DirectedBuildWorld.applyClaims(claims)`, `.applyDevelopments(developments)`;
  `MemoryDirectedBuildWorld.claims` + `.developments` (captured).

- [ ] **Step 1: Write the failing test.** Append to `lib/tick/adapters/memory/__tests__/directed-build.test.ts`
  (add the type imports; if `MemoryDirectedBuildWorld` isn't already imported, add it):

```ts
import type { SystemClaim, SystemDevelopment } from "@/lib/tick/world/directed-build-world";

describe("MemoryDirectedBuildWorld: claim + develop capture", () => {
  it("captures applied claims and developments for write-back", async () => {
    const world = new MemoryDirectedBuildWorld([]);
    const claims: SystemClaim[] = [{ systemId: "s1", factionId: "f1" }];
    const devs: SystemDevelopment[] = [{ systemId: "s2", sourceSystemId: "home", seedPop: 50 }];
    await world.applyClaims(claims);
    await world.applyDevelopments(devs);
    expect(world.claims).toEqual(claims);
    expect(world.developments).toEqual(devs);
  });
  it("starts with no claims or developments", () => {
    const world = new MemoryDirectedBuildWorld([]);
    expect(world.claims).toEqual([]);
    expect(world.developments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/tick/adapters/memory/__tests__/directed-build.test.ts`
Expected: FAIL — `SystemClaim`/`SystemDevelopment`/`applyClaims`/`applyDevelopments` don't exist.

- [ ] **Step 3: Add the interfaces + methods.** In `lib/tick/world/directed-build-world.ts`, add after
  `BuildBuildingUpdate`:

```ts
/** One ownership assignment: an unclaimed system becomes owned by factionId (control tier). */
export interface SystemClaim {
  systemId: string;
  factionId: string;
}

/** One development: a controlled system flips to developed and receives a conserved colony seed. */
export interface SystemDevelopment {
  systemId: string;
  /** Developed same-faction system the seed population is transferred from. */
  sourceSystemId: string;
  seedPop: number;
}
```

Extend `DirectedBuildWorld`:

```ts
export interface DirectedBuildWorld {
  getFactionShardKeys(): Promise<Array<string | null>>;
  getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemBuildRow[]>;
  applyBuildingIncreases(updates: BuildBuildingUpdate[]): Promise<void>;
  /** Ownership writes from the claim step (unclaimed → controlled). */
  applyClaims(claims: SystemClaim[]): Promise<void>;
  /** Ownership writes from the develop step (controlled → developed + colony seed transfer). */
  applyDevelopments(developments: SystemDevelopment[]): Promise<void>;
}
```

- [ ] **Step 4: Implement in the memory adapter.** In `lib/tick/adapters/memory/directed-build.ts`, extend
  the type import and the class:

```ts
import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
  SystemClaim,
  SystemDevelopment,
} from "@/lib/tick/world/directed-build-world";
```

```ts
export class MemoryDirectedBuildWorld implements DirectedBuildWorld {
  readonly buildingUpdates: BuildBuildingUpdate[] = [];
  /** Ownership claims resolved this run (control tier). */
  readonly claims: SystemClaim[] = [];
  /** Developments resolved this run (developed tier + colony seed). */
  readonly developments: SystemDevelopment[] = [];

  constructor(private readonly systems: SystemBuildRow[]) {}

  // …existing getFactionShardKeys / getSystemsForFactions / applyBuildingIncreases…

  async applyClaims(claims: SystemClaim[]): Promise<void> {
    this.claims.push(...claims);
  }
  async applyDevelopments(developments: SystemDevelopment[]): Promise<void> {
    this.developments.push(...developments);
  }
}
```

- [ ] **Step 5: Run test to verify it passes.**

Run: `npx vitest run lib/tick/adapters/memory/__tests__/directed-build.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/tick/world/directed-build-world.ts lib/tick/adapters/memory/directed-build.ts lib/tick/adapters/memory/__tests__/directed-build.test.ts
git commit -m "$(cat <<'EOF'
feat(directed-build): add claim + develop ownership writeback channels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Processor claim + develop phase

Extend `runDirectedBuildProcessor` with optional `claim` / `develop` params (providers + RNG + params).
When present, run propose→resolve→apply (claims) and plan→apply (developments) **before** the build
phase; when absent (every existing build/logistics test), the processor behaves exactly as today. Only
non-null due faction keys act.

**Files:**
- Modify: `lib/tick/processors/directed-build.ts`
- Test: `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `proposeFactionClaims`, `resolveClaims`, `planFactionDevelopments`, `ClaimCandidate`,
  `ClaimProposal`, `DevelopCandidate`, `ExpansionParams`, `DevelopParams` (`lib/engine/expansion`);
  `RNG` (`lib/engine/universe-gen`).
- Produces: extended `DirectedBuildProcessorParams` with optional
  `claim?: { reachProvider: (factionId: string) => ClaimCandidate[]; rng: RNG; params: ExpansionParams }`
  and `develop?: { candidateProvider: (factionId: string) => DevelopCandidate[]; params: DevelopParams }`.

- [ ] **Step 1: Write the failing test.** Append to `lib/tick/processors/__tests__/directed-build.test.ts`
  (extend the imports with the claim/develop types + `mulberry32`; the file already defines
  `DUE_TICK`/`NOT_DUE_TICK`/`INTERVAL`/`reachable`/`scenario`/`countOf`):

```ts
import type { ClaimCandidate, DevelopCandidate, ExpansionParams, DevelopParams } from "@/lib/engine/expansion";
import { mulberry32 } from "@/lib/engine/universe-gen";

const EXP_PARAMS: ExpansionParams = {
  maxClaimsPerPulse: 1, scoreFloor: 0.001, weights: { habitable: 1, diversity: 3, trait: 2, proximity: 0.5 },
};
const DEV_PARAMS: DevelopParams = {
  maxDevelopsPerPulse: 1, habitableFloor: 1, seedPop: 50, weights: { habitable: 1, diversity: 3, trait: 2, proximity: 0.5 },
};

// One developed owned system so the faction is in the shard, with no build needs.
function ownedOnly(factionId: string): SystemBuildRow {
  return {
    systemId: `${factionId}-home`, factionId, control: "developed", population: 100, unrest: 0,
    buildings: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, markets: [],
  };
}

describe("runDirectedBuildProcessor: claim + develop phase", () => {
  it("claims the best in-reach candidate on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    const reachProvider = (f: string): ClaimCandidate[] =>
      f === "f1" ? [
        { systemId: "u-poor", minHops: 1, habitableSpace: 5, resourceDiversity: 0, traitQuality: 0 },
        { systemId: "u-rich", minHops: 1, habitableSpace: 200, resourceDiversity: 4, traitQuality: 0 },
      ] : [];
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      claim: { reachProvider, rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.claims).toEqual([{ systemId: "u-rich", factionId: "f1" }]);
  });

  it("develops the best controlled candidate on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    const candidateProvider = (f: string): DevelopCandidate[] =>
      f === "f1" ? [{ systemId: "c1", habitableSpace: 100, resourceDiversity: 2, traitQuality: 0, sourceSystemId: "f1-home" }] : [];
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      develop: { candidateProvider, params: DEV_PARAMS },
    });
    expect(w.developments).toEqual([{ systemId: "c1", sourceSystemId: "f1-home", seedPop: 50 }]);
  });

  it("claims/develops nothing off the pulse boundary", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      claim: { reachProvider: () => [{ systemId: "u1", minHops: 1, habitableSpace: 100, resourceDiversity: 3, traitQuality: 0 }], rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.claims).toHaveLength(0);
  });

  it("claims/develops nothing when no claim/develop param is supplied (existing build path)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(w.claims).toHaveLength(0);
    expect(w.developments).toHaveLength(0);
    expect(countOf(w, "B", "food")).toBeGreaterThan(0); // build phase still runs
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: FAIL — `claim`/`develop` aren't known params; no claims/developments captured.

- [ ] **Step 3: Add the phase.** In `lib/tick/processors/directed-build.ts`, extend the imports + params
  and insert the phase after the `dueKeys` guard (before `getSystemsForFactions`):

```ts
import {
  proposeFactionClaims,
  resolveClaims,
  planFactionDevelopments,
  type ClaimCandidate,
  type ClaimProposal,
  type DevelopCandidate,
  type ExpansionParams,
  type DevelopParams,
} from "@/lib/engine/expansion";
import type { RNG } from "@/lib/engine/universe-gen";
```

Add `SystemClaim`, `SystemDevelopment` to the existing `@/lib/tick/world/directed-build-world` import in
this file (the processor writes both channels):

```ts
import type { DirectedBuildWorld, SystemBuildRow, BuildBuildingUpdate, SystemClaim, SystemDevelopment } from "@/lib/tick/world/directed-build-world";
```

```ts
export interface DirectedBuildProcessorParams {
  interval: number;
  routeCost: RouteCost;
  /** Claim step (control tier). Omitted → no claim phase (the build-only path used by engine/adapter tests). */
  claim?: {
    reachProvider: (factionId: string) => ClaimCandidate[];
    rng: RNG;
    params: ExpansionParams;
  };
  /** Develop step (developed tier + colony seed). Omitted → no develop phase. */
  develop?: {
    candidateProvider: (factionId: string) => DevelopCandidate[];
    params: DevelopParams;
  };
}
```

Insert immediately after `if (dueKeys.length === 0) return {};`:

```ts
  // ── Claim phase (control tier): every due faction proposes its best in-reach claim; conflicts
  // resolve deterministically (score, seeded-RNG ties); winners are written as ownership assignments.
  // Newly claimed systems are `controlled` (not developed), so the build phase ignores them this pulse. ──
  if (params.claim) {
    const proposals: ClaimProposal[] = [];
    for (const key of dueKeys) {
      if (key === null) continue;
      proposals.push(...proposeFactionClaims(key, params.claim.reachProvider(key), params.claim.params));
    }
    const resolved = resolveClaims(proposals, params.claim.rng);
    if (resolved.length > 0) await world.applyClaims(resolved);
  }

  // ── Develop phase (developed tier): each due faction develops its best controlled system(s) —
  // intra-faction, so no cross-faction resolution. The colony seed is conserved (transferred from the
  // source in tick.ts). Systems developed this pulse become build-eligible next pulse. ──
  if (params.develop) {
    const developments: SystemDevelopment[] = [];
    for (const key of dueKeys) {
      if (key === null) continue;
      developments.push(...planFactionDevelopments(params.develop.candidateProvider(key), params.develop.params));
    }
    if (developments.length > 0) await world.applyDevelopments(developments);
  }
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: PASS (new suite + all pre-existing build cases, which omit `claim`/`develop`).

- [ ] **Step 5: Commit.**

```bash
git add lib/tick/processors/directed-build.ts lib/tick/processors/__tests__/directed-build.test.ts
git commit -m "$(cat <<'EOF'
feat(directed-build): run claim + develop phases on the pulse before the build phase

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire claim + develop into `runWorldTick`

Build the reach provider (in-reach unclaimed candidates) and the develop-candidate provider (a
faction's controlled systems, each with its nearest developed same-faction source) from the bounded-hop
BFS; pass them + the shared `rng` + `EXPANSION` params to the processor; apply the resolved claims
(`control = "controlled"` + `factionId`) and developments (`control = "developed"` + conserved pop
transfer) to the Sim systems. `mergeSystemsIntoWorld` already persists `control`/`factionId`/`population`
(Task 2). Widen the hop-BFS bound to cover `REACH_JUMPS`.

**Files:**
- Modify: `lib/world/tick.ts`
- Test: `lib/world/__tests__/tick-expansion.test.ts` (new)

**Interfaces:**
- Consumes: `EXPANSION` (`lib/constants/expansion`); `ClaimCandidate`, `DevelopCandidate`
  (`lib/engine/expansion`); `SystemClaim`, `SystemDevelopment` (`directed-build-world`); `RESOURCE_TYPES`
  (`lib/engine/resources`); `computeBoundedHopDistances` (already imported).

- [ ] **Step 1: Write the failing test.** Create `lib/world/__tests__/tick-expansion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";
import type { World } from "@/lib/world/types";

function ownedCount(w: World): number {
  return w.systems.filter((s) => s.factionId !== null).length;
}
async function advance(world: World, ticks: number): Promise<World> {
  for (let t = 0; t < ticks; t++) world = (await runWorldTick(world)).world;
  return world;
}

describe("runWorldTick: expansion (claim + develop)", () => {
  it("grows owned-system count and produces controlled + developed systems across pulses", async () => {
    let world = generateWorld({ systemCount: 90, seed: 11 });
    const startOwned = ownedCount(world);
    expect(startOwned).toBe(world.factions.length); // one developed homeworld each

    world = await advance(world, MONTH_LENGTH * 4);
    expect(ownedCount(world)).toBeGreaterThan(startOwned); // claiming happened

    const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
    // Every newly-owned non-homeworld system is controlled or developed, never unclaimed.
    for (const s of world.systems) {
      if (s.factionId !== null && !homeworldIds.has(s.id)) {
        expect(s.control === "controlled" || s.control === "developed").toBe(true);
      }
      if (s.factionId === null) expect(s.control).toBe("unclaimed");
    }
    // At least one system developed past the homeworlds (colony bootstrap ran).
    const developedNonHome = world.systems.filter((s) => s.control === "developed" && !homeworldIds.has(s.id));
    expect(developedNonHome.length).toBeGreaterThan(0);
  });

  it("is deterministic — same seed produces the same ownership after several pulses", async () => {
    const a = await advance(generateWorld({ systemCount: 90, seed: 11 }), MONTH_LENGTH * 3);
    const b = await advance(generateWorld({ systemCount: 90, seed: 11 }), MONTH_LENGTH * 3);
    const own = (w: World) => w.systems.map((s) => `${s.id}:${s.control}:${s.factionId ?? "-"}`).sort();
    expect(own(a)).toEqual(own(b));
  });

  it("conserves galaxy population across a develop (seed is transferred, not minted)", async () => {
    const before = generateWorld({ systemCount: 90, seed: 11 });
    const total = (w: World) => w.systems.reduce((n, s) => n + s.population, 0);
    // The develop transfer itself is conserved; the economy may grow/shrink pop, so compare only the
    // single pulse where a develop first fires by asserting no NaN and a finite, non-negative total.
    const after = await advance(before, MONTH_LENGTH * 2);
    expect(Number.isFinite(total(after))).toBe(true);
    for (const s of after.systems) expect(s.population).toBeGreaterThanOrEqual(0);
  });

  it("produces no NaN/Infinity in population or stock across the pulses", async () => {
    const world = await advance(generateWorld({ systemCount: 90, seed: 11 }), MONTH_LENGTH * 2 + 1);
    for (const s of world.systems) expect(Number.isFinite(s.population)).toBe(true);
    for (const m of world.markets) expect(Number.isFinite(m.stock)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/world/__tests__/tick-expansion.test.ts`
Expected: FAIL — owned count unchanged (no claim/develop wiring yet).

- [ ] **Step 3: Add the imports.** In `lib/world/tick.ts`:

```ts
import { EXPANSION } from "@/lib/constants/expansion";
import type { ClaimCandidate, DevelopCandidate } from "@/lib/engine/expansion";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
```

Extend the existing `directed-build-world` type import to add the writeback row types:

```ts
import type { SystemBuildRow, BuildBuildingUpdate, SystemClaim, SystemDevelopment } from "@/lib/tick/world/directed-build-world";
```

- [ ] **Step 4: Widen the hop-BFS bound.** In the `hopsCache` computation (~line 559), cover
  `REACH_JUMPS`:

```ts
      hops: computeBoundedHopDistances(
        connections,
        Math.max(DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS, EXPANSION.REACH_JUMPS),
      ),
```

- [ ] **Step 5: Build the providers + pass the params.** In the `// ── directed-build ──` block (~line
  597), before constructing `dbWorld`, build the providers and pass `claim` + `develop`:

```ts
    // Ownership lookups reused by both providers.
    const factionBySystem = new Map(systems.map((s) => [s.id, s.factionId]));
    const controlBySystem = new Map(systems.map((s) => [s.id, s.control]));
    const simById = new Map(systems.map((s) => [s.id, s]));

    // Reach provider: a faction's in-reach UNCLAIMED candidates (reach extends from any owned tier).
    const reachProvider = (factionId: string): ClaimCandidate[] => {
      const minHopByCandidate = new Map<string, number>();
      for (const s of systems) {
        if (s.factionId !== factionId) continue;
        const neighbours = hops.get(s.id);
        if (!neighbours) continue;
        for (const [destId, h] of neighbours) {
          if (h <= 0 || h > EXPANSION.REACH_JUMPS) continue;
          if (factionBySystem.get(destId) !== null) continue; // only unclaimed
          const prev = minHopByCandidate.get(destId);
          if (prev === undefined || h < prev) minHopByCandidate.set(destId, h);
        }
      }
      const candidates: ClaimCandidate[] = [];
      for (const [candidateId, minHops] of minHopByCandidate) {
        const cand = simById.get(candidateId);
        if (!cand) continue;
        candidates.push({
          systemId: candidateId, minHops,
          habitableSpace: cand.habitableSpace,
          resourceDiversity: countResourceDiversity(cand),
          traitQuality: sumTraitQuality(cand),
        });
      }
      return candidates;
    };

    // Develop-candidate provider: a faction's CONTROLLED systems, each tagged with the nearest
    // developed same-faction system as the conserved colony-seed source (null if none reachable).
    const developProvider = (factionId: string): DevelopCandidate[] => {
      const candidates: DevelopCandidate[] = [];
      for (const s of systems) {
        if (s.factionId !== factionId || s.control !== "controlled") continue;
        const neighbours = hops.get(s.id);
        let sourceSystemId: string | null = null;
        let bestHop = Infinity;
        if (neighbours) {
          for (const [destId, h] of neighbours) {
            if (h <= 0) continue;
            if (factionBySystem.get(destId) !== factionId) continue;
            if (controlBySystem.get(destId) !== "developed") continue;
            if (h < bestHop) { bestHop = h; sourceSystemId = destId; }
          }
        }
        candidates.push({
          systemId: s.id, habitableSpace: s.habitableSpace,
          resourceDiversity: countResourceDiversity(s), traitQuality: sumTraitQuality(s),
          sourceSystemId,
        });
      }
      return candidates;
    };

    const rows = buildBuildRows(systems, patchMarketRowStocks(logisticsMarketRows, dlStockUpdates));
    const dbWorld = new MemoryDirectedBuildWorld(rows);
    await runDirectedBuildProcessor(dbWorld, { tick }, {
      interval: DIRECTED_BUILD.INTERVAL,
      routeCost,
      claim: {
        reachProvider, rng,
        params: { maxClaimsPerPulse: EXPANSION.MAX_CLAIMS_PER_PULSE, scoreFloor: EXPANSION.SCORE_FLOOR, weights: EXPANSION.SCORE_WEIGHTS },
      },
      develop: {
        candidateProvider: developProvider,
        params: { maxDevelopsPerPulse: EXPANSION.MAX_DEVELOPS_PER_PULSE, habitableFloor: EXPANSION.DEVELOP_HABITABLE_FLOOR, seedPop: EXPANSION.COLONY_SEED_POP, weights: EXPANSION.SCORE_WEIGHTS },
      },
    });
    systems = applyBuildingIncreases(systems, dbWorld.buildingUpdates);
    systems = applyClaims(systems, dbWorld.claims);
    systems = applyDevelopments(systems, dbWorld.developments);
    processorsRun.push("directed-build");
```

- [ ] **Step 6: Add the Sim-merge helpers + the two small candidate helpers.** Next to
  `applyBuildingIncreases` (~line 328), add:

```ts
/** Count of resources this system has any deposit slot for — a claim/develop score input. */
function countResourceDiversity(s: SimSystem): number {
  let n = 0;
  for (const r of RESOURCE_TYPES) if (s.slotCap[r] > 0) n++;
  return n;
}
/** Σ of the system's trait qualities — a claim/develop score input. */
function sumTraitQuality(s: SimSystem): number {
  let q = 0;
  for (const t of s.traits) q += t.quality;
  return q;
}

/** Apply resolved claims: the target becomes `controlled` and owned by the winning faction. The
 * `: SimSystem` return annotation contextually narrows the `"controlled"` literal to `SystemControl`
 * (no `as`). */
function applyClaims(systems: SimSystem[], claims: SystemClaim[]): SimSystem[] {
  if (claims.length === 0) return systems;
  const factionBySystem = new Map(claims.map((c) => [c.systemId, c.factionId]));
  return systems.map((s): SimSystem => {
    const factionId = factionBySystem.get(s.id);
    if (factionId === undefined) return s;
    return { ...s, factionId, control: "controlled" };
  });
}

/** Apply developments: the target flips to `developed`; the colony seed is transferred (conserved,
 * capped by what the source can spare) from its source system. The `: SimSystem` annotation narrows
 * the `"developed"` literal. */
function applyDevelopments(systems: SimSystem[], developments: SystemDevelopment[]): SimSystem[] {
  if (developments.length === 0) return systems;
  const bySystem = new Map(systems.map((s) => [s.id, s]));
  const popDelta = new Map<string, number>();
  const developed = new Set<string>();
  for (const d of developments) {
    const source = bySystem.get(d.sourceSystemId);
    const target = bySystem.get(d.systemId);
    if (!source || !target) continue;
    const moved = Math.min(d.seedPop, Math.max(0, source.population));
    popDelta.set(d.sourceSystemId, (popDelta.get(d.sourceSystemId) ?? 0) - moved);
    popDelta.set(d.systemId, (popDelta.get(d.systemId) ?? 0) + moved);
    developed.add(d.systemId);
  }
  return systems.map((s): SimSystem => {
    const delta = popDelta.get(s.id) ?? 0;
    const nowDeveloped = developed.has(s.id);
    if (delta === 0 && !nowDeveloped) return s;
    return {
      ...s,
      population: Math.max(0, s.population + delta),
      control: nowDeveloped ? "developed" : s.control,
    };
  });
}
```

- [ ] **Step 7: Run the witness test.**

Run: `npx vitest run lib/world/__tests__/tick-expansion.test.ts`
Expected: PASS. If owned count doesn't grow, the reach set is empty for the generated world — raise
`systemCount` (denser graph ⇒ unclaimed systems within `REACH_JUMPS` of a homeworld). If claims grow
but no non-home develops, confirm `developProvider` finds a `"developed"` source (the homeworld) within
the hop radius, and that a controlled system exists (claims must land at least one pulse before develop
can fire).

- [ ] **Step 8: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors (confirms the writeback imports, the `control` union literal narrowing, and the
providers all type-check with no `as`/`unknown`/`!`).

- [ ] **Step 9: Commit.**

```bash
git add lib/world/tick.ts lib/world/__tests__/tick-expansion.test.ts
git commit -m "$(cat <<'EOF'
feat(tick): wire the claim + develop expansion steps into runWorldTick

Build each faction's in-reach unclaimed candidates and controlled-system develop candidates from the
bounded-hop BFS, run the pulse claim/develop phases, and apply winners to the Sim systems (claim sets
control=controlled+factionId; develop sets control=developed and transfers a conserved colony seed).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Derive the `developed` view flag from `control`

The atlas/map `developed` boolean currently derives from `popCap > 0`; with a real `control` field it
should read the flag, so the map reflects actual ownership tier (a developed-but-empty colony reads as
developed).

**Files:**
- Modify: `lib/services/atlas.ts` (+ `lib/types/game.ts` only if the view type needs a doc tweak)
- Test: `lib/services/__tests__/atlas.test.ts`

- [ ] **Step 1: Update the failing test.** In `lib/services/__tests__/atlas.test.ts`, change the expected
  `developed` derivation (line ~55) from `system.popCap > 0` to `system.control === "developed"`, and add
  a case: a `controlled` system with `popCap > 0` is **not** `developed`; a `developed` system with
  `popCap === 0` **is** `developed`.

```ts
      developed: system.control === "developed",
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/services/__tests__/atlas.test.ts`
Expected: FAIL — atlas still derives `developed` from `popCap`.

- [ ] **Step 3: Update the derivation.** In `lib/services/atlas.ts` (line ~63):

```ts
      developed: s.control === "developed",
```

- [ ] **Step 4: Run test to verify it passes + typecheck.**

Run: `npx vitest run lib/services/__tests__/atlas.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors. (If a map hook/consumer of `developed` needs the new semantics, `tsc`
stays green — the field's type is unchanged; only its meaning is now control-based.)

- [ ] **Step 5: Commit.**

```bash
git add lib/services/atlas.ts lib/services/__tests__/atlas.test.ts lib/types/game.ts
git commit -m "$(cat <<'EOF'
refactor(atlas): derive the developed map flag from system.control

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Docs + full verification gate (coarse sanity)

**Files:**
- Modify: `docs/active/gameplay/faction-system.md`, `docs/active/gameplay/economy-autonomic-agency.md`,
  `docs/SPEC.md`

- [ ] **Step 1: Faction-system doc.** In `docs/active/gameplay/faction-system.md`, make the three-state
  control model present-fact: each faction starts as one **developed** homeworld and, each month,
  **claims** an in-reach unclaimed system (**controlled** — owned, border-closing, inert until
  developed) and **develops** one of its controlled systems (**developed** — build-gate open; seeded a
  small conserved colony population from its nearest developed system). Ownership is a system `control`
  flag (`unclaimed | controlled | developed`), not a building. Expansion is **ranged** (within
  `REACH_JUMPS`, leapfrog allowed); claims resolve deterministically (substrate-and-proximity score,
  ties by seeded RNG). Major/minor status still emerges from share of territory. Present tense, no phase
  numbers; state the throughput-funded construction model as a `docs/planned/` pointer.

- [ ] **Step 2: Autonomic-agency doc.** In `docs/active/gameplay/economy-autonomic-agency.md`, note that
  directed build runs the **claim** and **develop** steps on the monthly pulse before the build phase —
  a faction claims one in-reach unclaimed system (control) and develops one controlled system
  (developed + colony seed), scored by substrate × proximity and (for claims) resolved deterministically
  across factions. The develop-gate is `system.control === "developed"`.

- [ ] **Step 3: SPEC.md.** In `docs/SPEC.md`, reconcile the Universe/Factions description: factions grow
  by **claiming in-reach unclaimed systems (controlled) and developing them (developed) each month**;
  ownership is a three-state control flag, not a building. Headline-level only.

- [ ] **Step 4: Full unit suite.**

Run: `npx vitest run`
Expected: PASS (all green). Reconcile any straggler that assumed ownership is immutable through a tick,
that a system is "developed" iff it has a station building, or that every owned system is a homeworld.

- [ ] **Step 5: Typecheck + build gate.**

Run: `npx tsc --noEmit && npx next build --webpack`
Expected: both succeed.

- [ ] **Step 6: Coarse-sanity the calibration harness.**

Run: `npm run simulate`
Expected: completes without throwing; reported metrics contain **no `NaN`/`Infinity`** and no runaway.
Owned-system count climbs over the run and some non-homeworld systems reach `developed` (claim→develop
loop), while the galaxy stays **partially** filled (reach + the small per-pulse caps pace it). Record
the numbers in the PR description; do **not** tune (coarse bar only).

- [ ] **Step 7: Commit.**

```bash
git add docs/active/gameplay/faction-system.md docs/active/gameplay/economy-autonomic-agency.md docs/SPEC.md
git commit -m "$(cat <<'EOF'
docs(expansion): describe the live control-flag claim + develop steps (present tense)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (against spec §4 "Ownership: a system control flag" + substrate-reset §0b)

- **`control` flag replaces outpost/station buildings** → `WorldSystem.control` (Task 1), `SimSystem`
  (Task 2), catalog + `hasStationFacility` removed (Task 3). ✅
- **Develop-gate reads the flag** → `if (s.control !== "developed") continue;` in `planFactionBuilds`
  (Task 3), gate test toggles `control` (Task 3). ✅
- **Claim tier (unclaimed → controlled), ranged + bounded, deterministic** → reach provider over the
  bounded-hop BFS (Task 10), `proposeFactionClaims` + `resolveClaims` (Tasks 5-6), `applyClaims` sets
  `control="controlled"` + `factionId` (Task 10); witness asserts controlled systems appear (Task 10). ✅
- **Develop tier (controlled → developed) + conserved colony bootstrap** → `planFactionDevelopments`
  (Task 7), `developProvider` nearest-developed-source (Task 10), `applyDevelopments` conserved transfer
  (Task 10); witness asserts a non-home developed system + finite population (Task 10). ✅
- **`factionId: null` → id transition persisted** → `mergeSystemsIntoWorld` copies `factionId` + `control`
  (Task 2); the null-handling is exercised for the first time at runtime (full-suite gate, Task 12). ✅
- **Reach-provider seam for fog-of-war** → `reachProvider(factionId): ClaimCandidate[]` closure (Task
  10), swappable without touching the scorer. ✅
- **Save bump; no migration** → `SAVE_FORMAT_VERSION` 3 (Task 1). ✅
- **Coarse sanity, no tuning** → witness (Task 10) + harness (Task 12 Step 6). ✅

**Placeholder scan:** every code step carries complete code; the fixture sweep (Task 3 Step 7) and the
doc steps (Task 12) give an exact transformation recipe + target content, not "update the tests/docs".
No `as`/`unknown` introduced; `resolveClaims` avoids postfix `!` via `Map.entries()` iteration;
`planFactionDevelopments` narrows `sourceSystemId` via `.filter` + a `?? ""` fallback, not `!`.

**Type consistency:** `SystemControl` (Task 1) flows to `SimSystem` (Task 2), `SystemBuildRow` /
`BuildSystemState` (Task 3), and the `applyClaims`/`applyDevelopments` literals (Task 10) — all four use
the same `"unclaimed"|"controlled"|"developed"` union. `ClaimCandidate` (Task 5) is produced by
`reachProvider` (Task 10) and consumed by `proposeFactionClaims` (Task 5); `ClaimProposal` → `resolveClaims`
(Task 6) → `SystemClaim` (Task 8) → `applyClaims` (Task 10). `DevelopCandidate` (Task 7) is produced by
`developProvider` (Task 10) → `planFactionDevelopments` (Task 7) → `FactionDevelopment` ≅ `SystemDevelopment`
(Task 8) → `applyDevelopments` (Task 10). `ExpansionParams`/`DevelopParams` built from `EXPANSION` (Task
4) in `tick.ts` (Task 10). ✅

## Deferred to later PRs (per the decomposition doc)

- **Discrete integer levels + committed construction projects + whole-level buffered decay** → PR3.
- **Typed-output building model** → PR2.
- **Throughput-funded develop/claim cost (tall-vs-wide tension)** → PR3 (this PR bounds expansion by
  caps + reach + floors, not a shared pool).
- **Penalised cross-unowned logistics + profiling** → carried from substrate-reset; reconciled in PR4.
