# Build-Queue / Colony-Visibility UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, tick-live surface that makes in-flight construction visible — a per-system "Construction" section on the system Overview and a split "Construction" roll-up card on the faction detail page — for both `build` and `colony_establish` projects.

**Architecture:** One pure engine readout (`computeFactionConstruction`) turns a faction's open `constructionProjects` + systems into enriched, grouped, ETA-forecast rows. A thin service reads the world and calls it two ways (whole faction for the roll-up; filtered to a system for the per-system section). Route → tick-invalidated `useSuspenseQuery` hook → component, mirroring the existing industry vertical (`getSystemIndustry` → `/industry` route → `useSystemIndustry` → `IndustryPanel`).

**Tech Stack:** Next.js 16 App Router, TypeScript 5 (strict), TanStack Query v5 (Suspense), Vitest 4, Tailwind v4 + the Foundry theme.

**Branch:** Create `feat/build-queue-construction-ui` off the current shared base `feat/economy-rework-base`; each task commits; PR into the shared base when done.

## Global Constraints

Copied verbatim from the locked design (`docs/build-plans/build-queue-colony-visibility-ui.md`) and CLAUDE.md — every task's requirements implicitly include these:

- **No `as` type assertions** (only `as const` / guards). **No `unknown`.** Narrow discriminated unions by their `kind`/`visibility` discriminant, never a cast.
- **Discriminated-union result types**: `{ visibility } | …`, `{ kind: "build" } | { kind: "colony_establish" }`.
- **Reuse components**: `Card`/`CardHeader`/`CardContent`, `ProgressBar`, `EmptyState`, `SectionHeader`, `Badge` — never raw markup. `font-mono` for every numeric value; copper left-accent stripe is built into `Card variant="bordered"`.
- **Funding constants come from `CONSTRUCTION`** (`lib/constants/construction.ts`): `THROUGHPUT_PER_POP` (0.05) and `PER_BUILD_ABSORPTION_CAP` (4). Never hardcode these magnitudes — read the constant so a recalibration flows through.
- **Determinism / world safety**: the readout is pure and read-only; it never mutates `World` and never introduces `Infinity`/`NaN` (guard the ETA loop and progress divide).
- **Build gate**: `npx next build --webpack`. **Tests**: `npx vitest run`.

---

## File Structure

**Create:**
- `lib/engine/construction-readout.ts` — pure: `computeFactionConstruction`, row types, `buildingLabel`, `describeBuildProject`.
- `lib/engine/__tests__/construction-readout.test.ts` — engine tests (readout + `forecastEtaPulses`).
- `lib/services/construction.ts` — thin: `getFactionConstruction`, `getSystemConstruction`.
- `lib/services/__tests__/construction.test.ts` — service tests (seeded world).
- `lib/utils/construction-format.ts` — `formatEta`.
- `lib/utils/__tests__/construction-format.test.ts`.
- `app/api/game/systems/[systemId]/construction/route.ts`, `app/api/game/factions/[factionId]/construction/route.ts`.
- `lib/hooks/use-system-construction.ts`, `lib/hooks/use-faction-construction.ts`.
- `components/construction/construction-row.tsx` — the shared stat-block row.
- `components/construction/faction-construction-card.tsx`, `components/construction/system-construction-section.tsx`.

**Modify:**
- `lib/engine/construction.ts` — add `forecastEtaPulses`.
- `lib/types/api.ts` — add `SystemConstructionData`/`FactionConstructionData` + response aliases.
- `lib/query/keys.ts` — add construction keys.
- `lib/hooks/use-tick-invalidation.ts` — invalidate the construction keys on `economyTick`.
- `app/(game)/@panel/system/[systemId]/page.tsx` — render `SystemConstructionSection` after System Summary.
- `app/(game)/@panel/factions/[factionId]/page.tsx` — render `FactionConstructionCard` at the top.

---

## Task 1: ETA forecast (pure engine)

**Files:**
- Modify: `lib/engine/construction.ts` (append `forecastEtaPulses`)
- Test: `lib/engine/__tests__/construction-readout.test.ts`

**Interfaces:**
- Consumes: `fundQueue(projects, pool, cap)` and `WorldConstructionProject` (already in `construction.ts`).
- Produces: `forecastEtaPulses(projects: WorldConstructionProject[], pool: number, cap: number, maxPulses?: number): (number | null)[]` — index-aligned to `projects`; `null` = stalled.

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/construction-readout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { forecastEtaPulses } from "@/lib/engine/construction";
import type { WorldBuildProject } from "@/lib/world/types";

function build(id: string, workTotal: number, workDone: number): WorldBuildProject {
  return { kind: "build", id, factionId: "f1", systemId: "s1", buildingType: "housing", levels: 1, workTotal, workDone };
}

describe("forecastEtaPulses", () => {
  it("funds front-first: the head project lands before the tail", () => {
    // cap 4, pool 4 → only 4 points/pulse, all to the head until it lands.
    const eta = forecastEtaPulses([build("a", 8, 0), build("b", 8, 0)], 4, 4);
    expect(eta).toEqual([2, 4]);
  });

  it("spreads leftover pool across parallel fronts", () => {
    // cap 4, pool 8 → 4 to each per pulse; both land on pulse 2.
    const eta = forecastEtaPulses([build("a", 8, 0), build("b", 8, 0)], 8, 4);
    expect(eta).toEqual([2, 2]);
  });

  it("returns null (stalled) for every project when the pool is zero", () => {
    expect(forecastEtaPulses([build("a", 8, 0)], 0, 4)).toEqual([null]);
  });

  it("returns null past the guard cap without spinning", () => {
    // Huge work, tiny pool that still funds → guard trims it to stalled at maxPulses.
    expect(forecastEtaPulses([build("a", 100000, 0)], 1, 4, 5)).toEqual([null]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/construction-readout.test.ts`
Expected: FAIL — `forecastEtaPulses` is not exported.

- [ ] **Step 3: Append the implementation to `lib/engine/construction.ts`**

```ts
/**
 * Forward-simulate `fundQueue` at a CONSTANT pool + cap to find the pulse each project lands on.
 * Returns an array aligned to `projects` by index: the 1-based pulse count until that project
 * completes, or `null` when it never will at this rate ("stalled" — a zero/invalid pool, or the
 * guard cap hit). Coarse by design: the real pool grows with population and is shared across the
 * queue, so this is an estimate at the current rate, not a countdown. The progress bar
 * (`workDone/workTotal`) is exact; only the ETA is approximate.
 */
export function forecastEtaPulses(
  projects: WorldConstructionProject[],
  pool: number,
  cap: number,
  maxPulses = 999,
): (number | null)[] {
  // A zero/invalid pool funds nothing — everything is stalled (also avoids a maxPulses spin).
  if (!Number.isFinite(pool) || pool <= 0 || !Number.isFinite(cap) || cap <= 0) {
    return projects.map(() => null);
  }
  const landedAt = new Map<string, number>();
  let queue = projects.map((p) => ({ ...p }));
  for (let pulse = 1; pulse <= maxPulses && queue.length > 0; pulse++) {
    const { projects: open, landed } = fundQueue(queue, pool, cap);
    for (const l of landed) landedAt.set(l.id, pulse);
    queue = open;
  }
  return projects.map((p) => landedAt.get(p.id) ?? null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/construction-readout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/construction.ts lib/engine/__tests__/construction-readout.test.ts
git commit -m "feat(construction): coarse ETA forecast over the funded queue"
```

---

## Task 2: Faction construction readout (pure engine)

**Files:**
- Create: `lib/engine/construction-readout.ts`
- Test: `lib/engine/__tests__/construction-readout.test.ts` (extend)

**Interfaces:**
- Consumes: `factionThroughputPool`, `forecastEtaPulses` (Task 1); `GOODS` (`lib/constants/goods`); `HOUSING_TYPE`, `VOCATIONAL_SCHOOL_TYPE`, `RESEARCH_INSTITUTE_TYPE`, `COMPLEX_BY_TYPE` (`lib/constants/industry`); `SystemControl`, `WorldConstructionProject` (`lib/world/types`).
- Produces:
  - `ConstructionSystemInfo { id; name; control: SystemControl; population: number }`
  - `ConstructionProjectBuildRow`, `ConstructionProjectColonyRow`, `ConstructionProjectRow` (union)
  - `FactionConstructionReadout { pool; expandCount; buildCount; expansion: ConstructionProjectColonyRow[]; buildOut: ConstructionProjectBuildRow[]; all: ConstructionProjectRow[] }`
  - `computeFactionConstruction(projects, systems, throughputPerPop, cap): FactionConstructionReadout`
  - `buildingLabel(buildingType): string`, `describeBuildProject(buildingType): string`

- [ ] **Step 1: Write the failing tests (append to the Task 1 test file)**

```ts
import {
  computeFactionConstruction, buildingLabel, describeBuildProject,
  type ConstructionSystemInfo,
} from "@/lib/engine/construction-readout";
import type { WorldConstructionProject } from "@/lib/world/types";

describe("buildingLabel / describeBuildProject", () => {
  it("labels the non-good building types and falls back to the good name", () => {
    expect(buildingLabel("housing")).toBe("Housing");
    expect(buildingLabel("vocational_school")).toBe("Vocational School");
    expect(describeBuildProject("housing")).toContain("population capacity");
    expect(describeBuildProject("vocational_school")).toContain("technician");
  });
});

describe("computeFactionConstruction", () => {
  const systems: ConstructionSystemInfo[] = [
    { id: "dev1", name: "Vela Prime", control: "developed", population: 100 },
    { id: "dev2", name: "Corvus Gate", control: "developed", population: 50 },
    { id: "ctrl", name: "Kepler Reach", control: "controlled", population: 0 },
  ];
  const projects: WorldConstructionProject[] = [
    { kind: "colony_establish", id: "c1", factionId: "f1", systemId: "ctrl", sourceSystemId: "dev1", seedPop: 340, housingLevels: 3, workTotal: 100, workDone: 62 },
    { kind: "build", id: "b1", factionId: "f1", systemId: "dev1", buildingType: "housing", levels: 4, workTotal: 40, workDone: 32 },
  ];

  it("pools only economically-active systems and splits expansion vs build-out", () => {
    const r = computeFactionConstruction(projects, systems, 0.05, 4);
    expect(r.pool).toBeCloseTo((100 + 50) * 0.05, 6); // controlled pop 0 contributes nothing
    expect(r.expandCount).toBe(1);
    expect(r.buildCount).toBe(1);
    expect(r.expansion[0].kind).toBe("colony_establish");
    expect(r.expansion[0].sourceSystemName).toBe("Vela Prime");
    expect(r.expansion[0].systemName).toBe("Kepler Reach");
    expect(r.expansion[0].progress).toBeCloseTo(0.62, 6);
    expect(r.buildOut[0].buildingLabel).toBe("Housing");
    expect(r.buildOut[0].progress).toBeCloseTo(0.8, 6);
    expect(r.buildOut[0].etaPulses === null || typeof r.buildOut[0].etaPulses === "number").toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/construction-readout.test.ts`
Expected: FAIL — `construction-readout` module not found.

- [ ] **Step 3: Create `lib/engine/construction-readout.ts`**

```ts
/**
 * Pure display readout for a faction's committed construction — turns open `constructionProjects`
 * plus the faction's systems into enriched, grouped, ETA-forecast rows. Read-only; the funding math
 * itself lives in `construction.ts`. Two consumers read this: the faction roll-up (whole readout,
 * grouped) and the per-system section (filtered to one system via `all`).
 */
import type { SystemControl, WorldConstructionProject } from "@/lib/world/types";
import { factionThroughputPool, forecastEtaPulses } from "@/lib/engine/construction";
import { GOODS } from "@/lib/constants/goods";
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, COMPLEX_BY_TYPE,
} from "@/lib/constants/industry";

/** The faction-system fields the readout needs: identity (name) + pool inputs (control, population). */
export interface ConstructionSystemInfo {
  id: string;
  name: string;
  control: SystemControl;
  population: number;
}

interface ConstructionRowBase {
  id: string;
  systemId: string;
  systemName: string;
  /** Exact workDone/workTotal in [0,1]. */
  progress: number;
  workDone: number;
  workTotal: number;
  /** Coarse ≈pulses to completion at the current rate; null = stalled. */
  etaPulses: number | null;
}

export interface ConstructionProjectBuildRow extends ConstructionRowBase {
  kind: "build";
  /** "Housing", "Foundry", "Vocational School", … */
  buildingLabel: string;
  levels: number;
  /** "role · what it unblocks" — static from the building type (the served-demand rationale isn't persisted). */
  detail: string;
}

export interface ConstructionProjectColonyRow extends ConstructionRowBase {
  kind: "colony_establish";
  sourceSystemId: string;
  sourceSystemName: string;
  seedPop: number;
  housingLevels: number;
}

export type ConstructionProjectRow = ConstructionProjectBuildRow | ConstructionProjectColonyRow;

export interface FactionConstructionReadout {
  /** Σ population × throughputPerPop over developed systems — the per-pulse funding rate. */
  pool: number;
  expandCount: number;
  buildCount: number;
  /** colony_establish rows, soonest-ETA first (stalled last). */
  expansion: ConstructionProjectColonyRow[];
  /** build rows, soonest-ETA first (stalled last). */
  buildOut: ConstructionProjectBuildRow[];
  /** Every row in queue order — the per-system section filters this by systemId. */
  all: ConstructionProjectRow[];
}

/** Human label for a build project's building type (mirrors the industry panel's `label`). */
export function buildingLabel(buildingType: string): string {
  if (buildingType === HOUSING_TYPE) return "Housing";
  if (buildingType === VOCATIONAL_SCHOOL_TYPE) return "Vocational School";
  if (buildingType === RESEARCH_INSTITUTE_TYPE) return "Research Institute";
  return COMPLEX_BY_TYPE[buildingType]?.label ?? GOODS[buildingType]?.name ?? buildingType;
}

/** "role · what it unblocks" for a build row, keyed by building type (not the live deficit — that isn't stored). */
export function describeBuildProject(buildingType: string): string {
  if (buildingType === HOUSING_TYPE) return "housing · adds population capacity";
  if (buildingType === VOCATIONAL_SCHOOL_TYPE) return "workforce · licenses technician-grade work";
  if (buildingType === RESEARCH_INSTITUTE_TYPE) return "workforce · licenses engineer-grade work";
  const complex = COMPLEX_BY_TYPE[buildingType];
  if (complex) return `specialisation · anchors ${complex.label} yield`;
  return `industry · produces ${GOODS[buildingType]?.name ?? buildingType}`;
}

function progressOf(p: WorldConstructionProject): number {
  return p.workTotal > 0 ? Math.min(1, Math.max(0, p.workDone / p.workTotal)) : 0;
}

/** Soonest-ETA first; stalled (null) last; ties by system name — a total, deterministic order. */
function byEta(a: ConstructionRowBase, b: ConstructionRowBase): number {
  const ae = a.etaPulses ?? Number.POSITIVE_INFINITY;
  const be = b.etaPulses ?? Number.POSITIVE_INFINITY;
  if (ae !== be) return ae - be;
  return a.systemName.localeCompare(b.systemName);
}

/**
 * Build the faction readout: pool from the developed systems, ETA forecast over the queue as stored
 * (in-flight first — the order the tick funds it), then rows split into Expansion (colonies) and
 * Build-out (builds), each sorted soonest-first. `projects` must be one faction's open projects.
 */
export function computeFactionConstruction(
  projects: WorldConstructionProject[],
  systems: ConstructionSystemInfo[],
  throughputPerPop: number,
  cap: number,
): FactionConstructionReadout {
  const nameById = new Map(systems.map((s) => [s.id, s.name]));
  const pool = factionThroughputPool(systems, throughputPerPop);
  const etas = forecastEtaPulses(projects, pool, cap);

  const all: ConstructionProjectRow[] = [];
  const expansion: ConstructionProjectColonyRow[] = [];
  const buildOut: ConstructionProjectBuildRow[] = [];

  projects.forEach((p, i) => {
    const base: ConstructionRowBase = {
      id: p.id,
      systemId: p.systemId,
      systemName: nameById.get(p.systemId) ?? p.systemId,
      progress: progressOf(p),
      workDone: p.workDone,
      workTotal: p.workTotal,
      etaPulses: etas[i],
    };
    if (p.kind === "colony_establish") {
      const row: ConstructionProjectColonyRow = {
        ...base,
        kind: "colony_establish",
        sourceSystemId: p.sourceSystemId,
        sourceSystemName: nameById.get(p.sourceSystemId) ?? p.sourceSystemId,
        seedPop: p.seedPop,
        housingLevels: p.housingLevels,
      };
      all.push(row);
      expansion.push(row);
    } else {
      const row: ConstructionProjectBuildRow = {
        ...base,
        kind: "build",
        buildingLabel: buildingLabel(p.buildingType),
        levels: p.levels,
        detail: describeBuildProject(p.buildingType),
      };
      all.push(row);
      buildOut.push(row);
    }
  });

  expansion.sort(byEta);
  buildOut.sort(byEta);

  return { pool, expandCount: expansion.length, buildCount: buildOut.length, expansion, buildOut, all };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/construction-readout.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/construction-readout.ts lib/engine/__tests__/construction-readout.test.ts
git commit -m "feat(construction): pure faction construction readout (grouped, ETA-enriched rows)"
```

---

## Task 3: Construction service + API types + routes (server read path)

**Files:**
- Modify: `lib/types/api.ts` (add the two data shapes + response aliases)
- Create: `lib/services/construction.ts`
- Create: `app/api/game/systems/[systemId]/construction/route.ts`
- Create: `app/api/game/factions/[factionId]/construction/route.ts`
- Test: `lib/services/__tests__/construction.test.ts`

**Interfaces:**
- Consumes: `computeFactionConstruction`, `ConstructionSystemInfo`, `FactionConstructionReadout`, the row types (Task 2); `getWorld` (`lib/world/store`); `ServiceError` (`lib/services/errors`); `CONSTRUCTION` (`lib/constants/construction`); `withServiceErrors` (`lib/api/with-service-errors`).
- Produces:
  - `SystemConstructionData = { visibility: "hidden" } | { visibility: "empty"; control: "controlled" } | { visibility: "visible"; projects: ConstructionProjectRow[] }`
  - `FactionConstructionData { factionId; factionName; pool; expandCount; buildCount; expansion: ConstructionProjectColonyRow[]; buildOut: ConstructionProjectBuildRow[] }`
  - `getFactionConstruction(factionId): FactionConstructionData`, `getSystemConstruction(systemId): SystemConstructionData`
  - Routes `GET /api/game/systems/[systemId]/construction`, `GET /api/game/factions/[factionId]/construction`.

- [ ] **Step 1: Add the API types to `lib/types/api.ts`**

Add near the industry types (after `SystemIndustryResponse`):

```ts
import type {
  ConstructionProjectRow, ConstructionProjectColonyRow, ConstructionProjectBuildRow,
} from "@/lib/engine/construction-readout";

/** Per-system Construction section state. `hidden` renders nothing (developed with nothing building);
 *  `empty` is the controlled-not-yet-colonised state; `visible` carries the rows for this system. */
export type SystemConstructionData =
  | { visibility: "hidden" }
  | { visibility: "empty"; control: "controlled" }
  | { visibility: "visible"; projects: ConstructionProjectRow[] };

/** Faction roll-up card state — pool header + the two locked groups. */
export interface FactionConstructionData {
  factionId: string;
  factionName: string;
  pool: number;
  expandCount: number;
  buildCount: number;
  expansion: ConstructionProjectColonyRow[];
  buildOut: ConstructionProjectBuildRow[];
}

export type SystemConstructionResponse = ApiResponse<SystemConstructionData>;
export type FactionConstructionResponse = ApiResponse<FactionConstructionData>;
```

> Note: `lib/types/api.ts` may keep its imports grouped at the top — put the `import type { ConstructionProject… }` line with the other top-of-file imports rather than inline if the file's lint rules require it.

- [ ] **Step 2: Write the failing service test**

Create `lib/services/__tests__/construction.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getFactionConstruction, getSystemConstruction } from "@/lib/services/construction";
import { ServiceError } from "@/lib/services/errors";
import type { World, WorldSystem } from "@/lib/world/types";

let world: World;
let dev: WorldSystem;      // a developed system with a faction
let ctrlWithColony: WorldSystem;
let ctrlEmpty: WorldSystem;
let factionId: string;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 14 });
  const developed = [...world.systems]
    .filter((s) => s.control === "developed" && s.factionId !== null)
    .sort((a, b) => b.population - a.population);
  dev = developed[0];
  if (!dev || dev.factionId === null) throw new Error("fixture: expected a developed faction system");
  factionId = dev.factionId;
  // Repurpose two other systems of the same faction into controlled test fixtures.
  const others = world.systems.filter((s) => s.id !== dev.id);
  ctrlWithColony = others[0];
  ctrlEmpty = others[1];
  for (const s of [ctrlWithColony, ctrlEmpty]) { s.factionId = factionId; s.control = "controlled"; s.population = 0; }

  world.constructionProjects = [
    { kind: "build", id: "b1", factionId, systemId: dev.id, buildingType: "housing", levels: 4, workTotal: 40, workDone: 32 },
    { kind: "colony_establish", id: "c1", factionId, systemId: ctrlWithColony.id, sourceSystemId: dev.id, seedPop: 340, housingLevels: 3, workTotal: 100, workDone: 62 },
  ];
  setWorld(world);
});

afterEach(() => { clearWorld(); });

describe("getFactionConstruction", () => {
  it("groups expansion and build-out with a positive pool", () => {
    const data = getFactionConstruction(factionId);
    expect(data.pool).toBeGreaterThan(0);
    expect(data.expandCount).toBe(1);
    expect(data.buildCount).toBe(1);
    expect(data.expansion[0].kind).toBe("colony_establish");
    expect(data.buildOut[0].buildingLabel).toBe("Housing");
  });
  it("throws ServiceError(404) for an unknown faction", () => {
    expect(() => getFactionConstruction("nope")).toThrow(ServiceError);
  });
});

describe("getSystemConstruction", () => {
  it("shows the build on a developed system", () => {
    const data = getSystemConstruction(dev.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.projects[0].kind).toBe("build");
  });
  it("shows the colony on a controlled system that is establishing", () => {
    const data = getSystemConstruction(ctrlWithColony.id);
    expect(data.visibility).toBe("visible");
  });
  it("is empty (not hidden) on a controlled system with nothing under way", () => {
    expect(getSystemConstruction(ctrlEmpty.id)).toEqual({ visibility: "empty", control: "controlled" });
  });
  it("hides on a developed system with nothing building", () => {
    world.constructionProjects = [];
    setWorld(world);
    expect(getSystemConstruction(dev.id)).toEqual({ visibility: "hidden" });
  });
  it("throws ServiceError(404) for an unknown system", () => {
    expect(() => getSystemConstruction("nope")).toThrow(ServiceError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/services/__tests__/construction.test.ts`
Expected: FAIL — `lib/services/construction` not found.

- [ ] **Step 4: Create `lib/services/construction.ts`**

```ts
/**
 * Construction read services — thin marshallers over the pure `computeFactionConstruction` readout.
 * The faction roll-up reads the whole readout; the per-system section reads it filtered to one system
 * (ETA needs the whole faction queue, so both go through one faction-scoped computation). Read-only.
 */
import { getWorld } from "@/lib/world/store";
import { ServiceError } from "@/lib/services/errors";
import { CONSTRUCTION } from "@/lib/constants/construction";
import {
  computeFactionConstruction,
  type ConstructionSystemInfo,
  type FactionConstructionReadout,
} from "@/lib/engine/construction-readout";
import type { SystemConstructionData, FactionConstructionData } from "@/lib/types/api";

function readoutForFaction(factionId: string): { factionName: string; readout: FactionConstructionReadout } {
  const world = getWorld();
  const faction = world.factions.find((f) => f.id === factionId);
  if (!faction) throw new ServiceError("Faction not found.", 404);

  const systems: ConstructionSystemInfo[] = world.systems
    .filter((s) => s.factionId === factionId)
    .map((s) => ({ id: s.id, name: s.name, control: s.control, population: s.population }));
  const projects = world.constructionProjects.filter((p) => p.factionId === factionId);

  const readout = computeFactionConstruction(
    projects, systems, CONSTRUCTION.THROUGHPUT_PER_POP, CONSTRUCTION.PER_BUILD_ABSORPTION_CAP,
  );
  return { factionName: faction.name, readout };
}

export function getFactionConstruction(factionId: string): FactionConstructionData {
  const { factionName, readout } = readoutForFaction(factionId);
  return {
    factionId,
    factionName,
    pool: readout.pool,
    expandCount: readout.expandCount,
    buildCount: readout.buildCount,
    expansion: readout.expansion,
    buildOut: readout.buildOut,
  };
}

export function getSystemConstruction(systemId: string): SystemConstructionData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);
  // Unclaimed/independent systems have no faction pool → nothing to show.
  if (!system.factionId) return { visibility: "hidden" };

  const { readout } = readoutForFaction(system.factionId);
  const projects = readout.all.filter((r) => r.systemId === systemId);
  if (projects.length > 0) return { visibility: "visible", projects };
  // Nothing under way here: a controlled world still shows the section (that's the question you
  // bring to it); a developed world hides it (avoids clutter on the common case).
  if (system.control === "controlled") return { visibility: "empty", control: "controlled" };
  return { visibility: "hidden" };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/services/__tests__/construction.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Create the two routes**

`app/api/game/systems/[systemId]/construction/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSystemConstruction } from "@/lib/services/construction";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemConstructionResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/systems/[systemId]/construction", async () => {
    const { systemId } = await params;
    const data = getSystemConstruction(systemId);
    return NextResponse.json<SystemConstructionResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
```

`app/api/game/factions/[factionId]/construction/route.ts`:

```ts
import { NextResponse } from "next/server";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getFactionConstruction } from "@/lib/services/construction";
import type { FactionConstructionResponse } from "@/lib/types/api";

export function GET(
  _req: Request,
  ctx: { params: Promise<{ factionId: string }> },
) {
  return withServiceErrors("GET /api/game/factions/[factionId]/construction", async () => {
    const { factionId } = await ctx.params;
    const data = getFactionConstruction(factionId);
    return NextResponse.json<FactionConstructionResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
```

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/types/api.ts lib/services/construction.ts lib/services/__tests__/construction.test.ts app/api/game/systems/[systemId]/construction/route.ts app/api/game/factions/[factionId]/construction/route.ts
git commit -m "feat(construction): read services + API routes for system/faction construction"
```

---

## Task 4: Query keys, hooks, tick invalidation (client data layer)

**Files:**
- Modify: `lib/query/keys.ts`
- Create: `lib/hooks/use-system-construction.ts`, `lib/hooks/use-faction-construction.ts`
- Modify: `lib/hooks/use-tick-invalidation.ts`

**Interfaces:**
- Consumes: `SystemConstructionData`, `FactionConstructionData` (Task 3); `apiFetch` (`lib/query/fetcher`); `useSuspenseQuery`.
- Produces: `useSystemConstruction(systemId): SystemConstructionData`, `useFactionConstruction(factionId): FactionConstructionData`; query keys `systemConstruction(All)`, `factionConstruction(All)`.

- [ ] **Step 1: Add query keys to `lib/query/keys.ts`**

Add after the `systemLogistics` keys:

```ts
  // Per-system construction section — tick-invalidated (progress advances each funded pulse).
  systemConstructionAll: ["systemConstruction"] as const,
  systemConstruction: (systemId: string) => ["systemConstruction", systemId] as const,
  // Per-faction construction roll-up — tick-invalidated.
  factionConstructionAll: ["factionConstruction"] as const,
  factionConstruction: (factionId: string) => ["factionConstruction", factionId] as const,
```

- [ ] **Step 2: Create the two hooks**

`lib/hooks/use-system-construction.ts`:

```ts
"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemConstructionData } from "@/lib/types/api";

/** In-flight construction for one system. Tick-invalidated (see useTickInvalidation). */
export function useSystemConstruction(systemId: string): SystemConstructionData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemConstruction(systemId),
    queryFn: () => apiFetch<SystemConstructionData>(`/api/game/systems/${systemId}/construction`),
  });
  return data;
}
```

`lib/hooks/use-faction-construction.ts`:

```ts
"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { FactionConstructionData } from "@/lib/types/api";

/** A faction's construction roll-up (expansion + build-out). Tick-invalidated. */
export function useFactionConstruction(factionId: string): FactionConstructionData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.factionConstruction(factionId),
    queryFn: () => apiFetch<FactionConstructionData>(`/api/game/factions/${factionId}/construction`),
  });
  return data;
}
```

- [ ] **Step 3: Register invalidation in `lib/hooks/use-tick-invalidation.ts`**

Inside the `subscribeToEvent("economyTick", …)` callback, after the `systemLogisticsAll` line, add:

```ts
        // Construction advances every funded pulse (same monthly economy tick) — refresh both surfaces.
        queryClient.invalidateQueries({ queryKey: queryKeys.systemConstructionAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.factionConstructionAll });
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/query/keys.ts lib/hooks/use-system-construction.ts lib/hooks/use-faction-construction.ts lib/hooks/use-tick-invalidation.ts
git commit -m "feat(construction): tick-invalidated query hooks for both surfaces"
```

---

## Task 5: `formatEta` util + shared `ConstructionRow`

**Files:**
- Create: `lib/utils/construction-format.ts`
- Test: `lib/utils/__tests__/construction-format.test.ts`
- Create: `components/construction/construction-row.tsx`

**Interfaces:**
- Consumes: `ConstructionProjectRow` (Task 2); `ProgressBar` (`components/ui/progress-bar`); `formatMagnitude` (`lib/utils/format`); `Link`.
- Produces: `formatEta(etaPulses: number | null): string`; `ConstructionRow({ row: ConstructionProjectRow; showSystem: boolean })`.

- [ ] **Step 1: Write the failing `formatEta` test**

Create `lib/utils/__tests__/construction-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatEta } from "@/lib/utils/construction-format";

describe("formatEta", () => {
  it("renders stalled for null", () => { expect(formatEta(null)).toBe("stalled"); });
  it("singularises one pulse", () => { expect(formatEta(1)).toBe("≈1 pulse"); });
  it("pluralises many pulses", () => { expect(formatEta(4)).toBe("≈4 pulses"); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/utils/__tests__/construction-format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/utils/construction-format.ts`**

```ts
/** Coarse ETA label for a construction row. `null` = the funding guard tripped (stalled). */
export function formatEta(etaPulses: number | null): string {
  if (etaPulses === null) return "stalled";
  return `≈${etaPulses} pulse${etaPulses === 1 ? "" : "s"}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/utils/__tests__/construction-format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `components/construction/construction-row.tsx`**

```tsx
"use client";

import Link from "next/link";
import type { ConstructionProjectRow } from "@/lib/engine/construction-readout";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatMagnitude } from "@/lib/utils/format";
import { formatEta } from "@/lib/utils/construction-format";

/**
 * One stat-block construction row (the locked style B): title · detail line · exact full-width
 * progress bar, with a coarse ETA. `showSystem` appends "— <system>" to the title on the faction
 * roll-up (where rows span systems); the per-system section omits it (the system is the page).
 */
export function ConstructionRow({ row, showSystem }: { row: ConstructionProjectRow; showSystem: boolean }) {
  const stalled = row.etaPulses === null;
  const suffix = showSystem ? ` — ${row.systemName}` : "";
  const title =
    row.kind === "colony_establish"
      ? `Establish Colony${suffix}`
      : `${row.buildingLabel} ×${row.levels}${suffix}`;

  return (
    <div className="border-b border-border/40 py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-sm text-text-primary">{title}</span>
        <span
          className={`ml-auto font-mono text-[11px] ${stalled ? "text-status-amber-light" : "text-text-secondary"}`}
        >
          {formatEta(row.etaPulses)}
        </span>
      </div>

      <p className="mt-0.5 mb-1.5 text-xs text-text-secondary">
        {row.kind === "colony_establish" ? (
          <>
            seed <span className="font-mono text-text-primary">{formatMagnitude(row.seedPop)}</span> pop ·{" "}
            <span className="font-mono text-text-primary">{row.housingLevels}</span> housing bundled ·{" "}
            <span className="text-text-tertiary">from </span>
            <Link
              href={`/system/${row.sourceSystemId}`}
              className="text-text-accent hover:text-text-accent-hover transition-colors"
            >
              {row.sourceSystemName}
            </Link>
          </>
        ) : (
          row.detail
        )}
      </p>

      <ProgressBar
        label=""
        value={row.workDone}
        max={row.workTotal}
        formatValue={formatMagnitude}
        color={stalled ? "amber" : "copper"}
        ariaLabel={`${title}: ${Math.round(row.progress * 100)}% complete`}
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/utils/construction-format.ts lib/utils/__tests__/construction-format.test.ts components/construction/construction-row.tsx
git commit -m "feat(construction): shared stat-block row + ETA label"
```

---

## Task 6: Faction roll-up card + wire into the faction page

**Files:**
- Create: `components/construction/faction-construction-card.tsx`
- Modify: `app/(game)/@panel/factions/[factionId]/page.tsx`

**Interfaces:**
- Consumes: `useFactionConstruction` (Task 4); `ConstructionRow` (Task 5); `Card`/`CardHeader`/`CardContent`, `EmptyState`, `SectionHeader`; `formatMagnitude`.
- Produces: `FactionConstructionCard({ factionId: string })`.

- [ ] **Step 1: Create `components/construction/faction-construction-card.tsx`**

```tsx
"use client";

import { useFactionConstruction } from "@/lib/hooks/use-faction-construction";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { ConstructionRow } from "@/components/construction/construction-row";
import { formatMagnitude } from "@/lib/utils/format";

/**
 * The faction's construction roll-up: pool header + two locked groups (Expansion on top — the
 * colony-discoverability headline — then Build-out). Lives at the top of the faction detail page.
 */
export function FactionConstructionCard({ factionId }: { factionId: string }) {
  const data = useFactionConstruction(factionId);
  const empty = data.expansion.length === 0 && data.buildOut.length === 0;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader
        title="Construction"
        subtitle={`pool ${formatMagnitude(data.pool)}/pulse · ${data.expandCount} forming · ${data.buildCount} building`}
      />
      <CardContent>
        {empty ? (
          <EmptyState message="No active construction or expansion." />
        ) : (
          <>
            <p className="mb-3 font-mono text-[10px] text-text-tertiary">
              ≈ estimates at the current funding rate — the bar (work done) is exact.
            </p>
            {data.expansion.length > 0 && (
              <div className="mb-4">
                <SectionHeader as="h4" className="mb-2">Expansion</SectionHeader>
                {data.expansion.map((row) => <ConstructionRow key={row.id} row={row} showSystem />)}
              </div>
            )}
            {data.buildOut.length > 0 && (
              <div>
                <SectionHeader as="h4" className="mb-2">Build-out</SectionHeader>
                {data.buildOut.map((row) => <ConstructionRow key={row.id} row={row} showSystem />)}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into `app/(game)/@panel/factions/[factionId]/page.tsx`**

Add the import with the other component imports:

```tsx
import { FactionConstructionCard } from "@/components/construction/faction-construction-card";
```

Then render it immediately after the `<FactionCard … className="mb-6" />` line and before the `<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">`:

```tsx
      <FactionCard faction={faction} size="md" className="mb-6" />

      <FactionConstructionCard factionId={faction.id} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/construction/faction-construction-card.tsx "app/(game)/@panel/factions/[factionId]/page.tsx"
git commit -m "feat(construction): faction roll-up card at the top of the faction detail page"
```

---

## Task 7: Per-system section + wire into the Overview page

**Files:**
- Create: `components/construction/system-construction-section.tsx`
- Modify: `app/(game)/@panel/system/[systemId]/page.tsx`

**Interfaces:**
- Consumes: `useSystemConstruction` (Task 4); `ConstructionRow` (Task 5); `Card`/`CardHeader`/`CardContent`, `EmptyState`.
- Produces: `SystemConstructionSection({ systemId: string })` — returns `null` when hidden.

- [ ] **Step 1: Create `components/construction/system-construction-section.tsx`**

```tsx
"use client";

import { useSystemConstruction } from "@/lib/hooks/use-system-construction";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ConstructionRow } from "@/components/construction/construction-row";

/**
 * The system Overview's Construction section. Hidden on a developed world with nothing building;
 * shown (even empty) on a controlled world — where it's the page's primary live content while a
 * colony forms. Renders nothing when hidden so no empty card appears on the common case.
 */
export function SystemConstructionSection({ systemId }: { systemId: string }) {
  const data = useSystemConstruction(systemId);
  if (data.visibility === "hidden") return null;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader title="Construction" />
      <CardContent>
        {data.visibility === "empty" ? (
          <EmptyState message="Controlled, not yet colonised. No colony effort under way here yet." />
        ) : (
          <>
            <p className="mb-3 font-mono text-[10px] text-text-tertiary">
              ≈ estimates at the current funding rate — the bar (work done) is exact.
            </p>
            {data.projects.map((row) => <ConstructionRow key={row.id} row={row} showSystem={false} />)}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into `app/(game)/@panel/system/[systemId]/page.tsx`**

Add the import with the other component imports:

```tsx
import { SystemConstructionSection } from "@/components/construction/system-construction-section";
```

Then render it between the System Summary `</Card>` and the Market row `<div>` (after the System Summary Card block, before `{/* Market row — snapshot + pie chart */}`):

```tsx
      </Card>

      {/* Construction — in-flight builds / a forming colony (hidden when nothing is under way on a developed world) */}
      <SystemConstructionSection systemId={systemId} />

      {/* Market row — snapshot + pie chart */}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/construction/system-construction-section.tsx "app/(game)/@panel/system/[systemId]/page.tsx"
git commit -m "feat(construction): per-system Construction section on the Overview tab"
```

---

## Task 8: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all pass (including the three new test files).

- [ ] **Step 2: Run the production build gate**

Run: `npx next build --webpack`
Expected: build succeeds, no type errors.

- [ ] **Step 3: Manual smoke (user-driven)**

Start the dev server (`npm run dev`), begin/continue a game, let a few monthly pulses run, then verify:
- A faction detail page shows the **Construction** card at the top with a pool header; if the faction is expanding, an **Expansion** group lists forming colonies above **Build-out**.
- A developed system that's building shows the **Construction** section after System Summary; one with nothing building shows no such card.
- A controlled system that's forming a colony shows the **Construction** section as the main live content (pop 0, no market); the source system link works.
- ETAs read `≈N pulses`; progress bars advance a tick after an `economyTick` (tick-invalidated, no manual refresh).

> This is a checkpoint — pause here for the user to run the visual smoke (per the UI-collaborative convention) before the docs task.

- [ ] **Step 4: Commit (only if the smoke surfaced fixes)**

```bash
git add -A
git commit -m "fix(construction): smoke-pass adjustments"
```

---

## Task 9: Docs promotion + build-plan cleanup (on-branch, before merge)

**Files:**
- Modify: `docs/SPEC.md`
- Delete: `docs/build-plans/build-queue-colony-visibility-ui.md`, `docs/build-plans/build-queue-colony-visibility-ui-plan.md`

- [ ] **Step 1: Add a SPEC.md line** documenting the surface: the per-system Construction section (Overview) and the faction Construction roll-up (split Expansion/Build-out, coarse ETA) as the player-facing read of `world.constructionProjects`. Place it with the economy/colonisation surfaces; present tense, headline-first.

- [ ] **Step 2: Delete both transient build-plan docs** (the design capture and this plan) — the surface is now code + the SPEC line.

```bash
git rm docs/build-plans/build-queue-colony-visibility-ui.md docs/build-plans/build-queue-colony-visibility-ui-plan.md
```

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs(construction): promote build-queue UI to SPEC; drop transient build plans"
```

- [ ] **Step 4: Open the PR** into the shared base `feat/economy-rework-base`.

---

## Self-Review (completed against the locked design)

- **Spec coverage:** scope B (per-system + faction roll-up) → Tasks 6–7; architecture (one `computeFactionConstruction`, read two ways) → Tasks 2–3; row style B → Task 5; §1 split Expansion/Build-out → Task 6; §2 per-system placement + hide/empty rules + controlled variant → Tasks 3 & 7; §3 Overview-only → no Industry-tab task (deliberate); §4 pool header → Task 6; §5 top faction placement → Task 6; §6 ETA `≈N`/`stalled`/caption → Tasks 5–7; coarse ETA forward-sim / exact bar → Task 1.
- **Placeholder scan:** none — every step carries real code, exact paths, and expected command output.
- **Type consistency:** `ConstructionProjectRow`/`…BuildRow`/`…ColonyRow`, `FactionConstructionReadout`, `ConstructionSystemInfo`, `computeFactionConstruction`, `forecastEtaPulses`, `getFactionConstruction`/`getSystemConstruction`, `useFactionConstruction`/`useSystemConstruction`, `formatEta` — names/signatures match across engine → service → api → hooks → components. Funding magnitudes read `CONSTRUCTION.THROUGHPUT_PER_POP` / `.PER_BUILD_ABSORPTION_CAP` everywhere (no hardcode).
