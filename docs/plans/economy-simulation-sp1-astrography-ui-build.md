# Astrography UI (substrate read panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Companion design spec:** `docs/plans/economy-simulation-sp1-astrography-ui.md` (the "why"). This is the build plan (the "how"). **Delete both on ship** per the `docs/plans/` convention. Branch: `feat/economy-simulation-astrography-ui` (off shared `feat/economy-simulation`).

**Goal:** Add a read-only, player-facing **Astrography** tab to the system detail panel that surfaces the PR3a physical substrate (sun class, population/pop-cap, aggregate resource profile, per-body resource vectors + richness), and carries the substrate read-back path PR3a deferred — so PR3b stays a pure prune.

**Architecture:** A single visibility-gated read service `getSystemSubstrate` returns a discriminated union (`visible` with full data, or `unknown`). One TanStack hook (`useSystemSubstrate`, `useSuspenseQuery`, static `staleTime: Infinity`) feeds both the new tab and a one-line Overview teaser. A pure engine helper (`resourceVectorFromColumns`) inverts the PR3a column spreaders; pure bar-prep logic (`prepareResourceBars`) is unit-tested, leaving the new components as thin renderers. All substrate union-string columns are validated once at the service boundary via new guards.

**Tech Stack:** Next.js 16 (App Router, parallel-route `@panel` slot), TypeScript 5 strict, Prisma 7 (`prisma-client` + `@prisma/adapter-pg`), TanStack Query v5 (Suspense), Tailwind v4 + tailwind-variants, Vitest 4.

## Deviations from the design spec (read first)

The spec's §5.3/§5.5/§5.6 assumed the panel's "always-loaded detail" (`getSystemDetail`) carries a cheap substrate summary so the header renders instantly and only the body join is lazy. **That is not how the panel is wired:** the panel reads `StarSystemInfo` from the bulk universe payload via `useUniverse`/`useSystemInfo`; no client hook wraps the `getSystemDetail` route, and adding substrate to the universe payload would bloat every one of 600–10k systems. This plan therefore:

- **Does NOT touch `getSystemDetail` or `SystemDetailData`.** No `substrate` summary is added there.
- **Folds the header summary (`sunClass`/`population`/`popCap`) into `getSystemSubstrate`.** The header, aggregate strip, and body cards all come from one fetch inside one `QueryBoundary`. The body join is one system (2–5 rows) — sub-millisecond — so "header waits for the join" is a non-issue and the brief `QueryBoundary` fallback is acceptable.
- **The Overview teaser uses the same `useSystemSubstrate` hook** (shared query key → one fetch, pre-warms the tab). It renders `null` for `unknown` visibility via the return-empty pattern (no throw → no error boundary), mirroring `getSystemTradeFlow`.

Everything else in the design spec (UI layout, components, edge cases, conventions) stands.

## Global Constraints

Every task implicitly includes these (from CLAUDE.md). Copied verbatim where exact:

- **No `as` assertions** except `as const` and inside the `lib/types/guards.ts` converters that validate before returning. Nowhere else.
- **No `unknown`** and no `Record<string, unknown>` / untyped maps. `Record<string, number>` (typed values) is allowed and is used by `resourceVectorFromColumns`. The only `unknown` exception is `JSON.parse` at boundaries (not needed here).
- **Type at the boundary, trust downstream.** Validate substrate strings (`sunClass`, `bodyType`, `richnessModifiers[]`) once in the service via the new guards. Components/hooks never re-validate.
- **Layering:** engine functions are pure (no DB import); services own all DB/business logic; route handlers are thin `requirePlayer → service → NextResponse.json` wrappers. Read services throw `ServiceError`.
- **Prisma:** always import the singleton from `@/lib/prisma`. Client type from `@/app/generated/prisma/client` (not needed directly here).
- **API:** responses use `ApiResponse<T>` = `{ data?, error? }`. Auth-gated routes use `Cache-Control: private, no-cache` — never `public`/`immutable`.
- **Client data:** `useSuspenseQuery` via `apiFetch`; query keys centralized in `lib/query/keys.ts`; data-fetching sections wrapped in `QueryBoundary`.
- **Foundry theme:** no rounded corners on cards/buttons/badges (the `StarGlyph` is iconography — a literal circle — and is exempt); `font-display` (Chakra Petch) for headings; `font-mono` (Geist Mono) for numeric values; copper `border-l-accent` stripe on cards. Use existing primitives (`Card`, `Badge`, `SectionHeader`, `StatList`/`StatRow`, `ProgressBar`, `EmptyState`, `QueryBoundary`) — no raw markup duplicating a component.
- **Commits:** conventional, `economy` scope (e.g. `feat(economy): …`, `test(economy): …`), matching recent history. Commit after each task.

---

## File Structure

**Created:**
- `app/api/game/systems/[systemId]/substrate/route.ts` — thin GET wrapper for the substrate read.
- `lib/hooks/use-system-substrate.ts` — `useSystemSubstrate(systemId)` suspense hook.
- `lib/types/__tests__/guards.test.ts` — tests for the three new substrate guards.
- `lib/utils/__tests__/format.test.ts` — test for `formatNumber`.
- `components/system/star-glyph.tsx` — `StarGlyph` sun-class swatch.
- `components/system/resource-vector-bars.tsx` — `ResourceVectorBars` mini-bar strip.
- `components/system/body-card.tsx` — `BodyCard` for one `BodyView`.
- `components/system/astrography-teaser.tsx` — `AstrographyTeaser` one-line Overview summary.
- `app/(game)/@panel/system/[systemId]/astrography/page.tsx` — the Astrography tab page.

**Modified:**
- `lib/engine/resources.ts` — add `resourceVectorFromColumns`, `prepareResourceBars` (+ `ResourceBarEntry`/`ResourceBars` types).
- `lib/engine/__tests__/resources.test.ts` — add tests for the two new helpers.
- `lib/types/guards.ts` — add `is/to` guards for `SunClass`, `BodyArchetypeId`, `RichnessModifierId`.
- `lib/types/api.ts` — add `RichnessModifierView`, `BodyView`, `SystemSubstrateData`, `SystemSubstrateResponse`.
- `lib/services/universe.ts` — add `getSystemSubstrate(playerId, systemId)`.
- `lib/query/keys.ts` — add `systemSubstrate(systemId)`.
- `lib/constants/ui.ts` — add `SUN_CLASS_COLORS`.
- `lib/utils/format.ts` — add `formatNumber`.
- `app/(game)/@panel/system/[systemId]/layout.tsx` — add the `Astrography` tab.
- `app/(game)/@panel/system/[systemId]/page.tsx` — mount the Overview teaser.

No new `default.tsx` is needed: the existing `app/(game)/@panel/default.tsx` covers the parallel-route slot, and the sibling tabs (`market/`, `ships/`, …) are plain `page.tsx` under the shared `[systemId]/layout.tsx` — Astrography follows that exact pattern.

---

## Task 1: Engine helpers — `resourceVectorFromColumns` + `prepareResourceBars`

Pure, DB-free, fully unit-tested. `resourceVectorFromColumns` inverts the existing `aggregateColumns`/`bodyResourceColumns` spreaders; `prepareResourceBars` holds the sort/normalize/trace logic so the bar component stays a dumb renderer.

**Files:**
- Modify: `lib/engine/resources.ts`
- Test: `lib/engine/__tests__/resources.test.ts`

**Interfaces:**
- Consumes: `ResourceType`, `ResourceVector` (from `@/lib/types/game`); existing `emptyResourceVector`, `RESOURCE_TYPES`, `aggregateColumns`, `bodyResourceColumns` in the same file.
- Produces:
  - `resourceVectorFromColumns(source: Record<string, number>, prefix: "agg" | "res"): ResourceVector`
  - `interface ResourceBarEntry { type: ResourceType; value: number; fraction: number }`
  - `interface ResourceBars { entries: ResourceBarEntry[]; trace: ResourceType[] }`
  - `prepareResourceBars(vector: ResourceVector, opts?: { sort?: boolean; collapseTrace?: boolean }): ResourceBars`

- [ ] **Step 1: Write the failing tests** — append to `lib/engine/__tests__/resources.test.ts`:

```ts
import {
  emptyResourceVector, makeResourceVector, aggregateColumns, bodyResourceColumns,
  sumResourceVectors, resourceVectorFromColumns, prepareResourceBars,
} from "../resources";
// (replace the existing import line with the one above — it adds the two new helpers)

describe("resourceVectorFromColumns", () => {
  it("round-trips with aggregateColumns (agg prefix)", () => {
    const v = makeResourceVector({ gas: 1, ore: 2, water: 3, radioactive: 4 });
    expect(resourceVectorFromColumns(aggregateColumns(v), "agg")).toEqual(v);
  });

  it("round-trips with bodyResourceColumns (res prefix)", () => {
    const v = makeResourceVector({ minerals: 5, biomass: 2, arable: 1 });
    expect(resourceVectorFromColumns(bodyResourceColumns(v), "res")).toEqual(v);
  });

  it("defaults missing columns to zero", () => {
    expect(resourceVectorFromColumns({ aggGas: 7 }, "agg")).toEqual(
      makeResourceVector({ gas: 7 }),
    );
  });
});

describe("prepareResourceBars", () => {
  it("keeps canonical order with all seven entries and no trace by default", () => {
    const v = makeResourceVector({ gas: 1, ore: 2 });
    const { entries, trace } = prepareResourceBars(v);
    expect(entries.map((e) => e.type)).toEqual([
      "gas", "minerals", "ore", "biomass", "arable", "water", "radioactive",
    ]);
    expect(trace).toEqual([]);
  });

  it("normalizes fractions to the vector max", () => {
    const { entries } = prepareResourceBars(makeResourceVector({ gas: 1, ore: 4 }));
    const byType = Object.fromEntries(entries.map((e) => [e.type, e.fraction]));
    expect(byType.ore).toBe(1);
    expect(byType.gas).toBeCloseTo(0.25);
    expect(byType.water).toBe(0);
  });

  it("sorts rich-first when sort is true", () => {
    const { entries } = prepareResourceBars(
      makeResourceVector({ gas: 1, ore: 4, water: 2 }),
      { sort: true },
    );
    expect(entries[0].type).toBe("ore");
    expect(entries[1].type).toBe("water");
    expect(entries[2].type).toBe("gas");
  });

  it("collapses zero and near-zero resources into trace", () => {
    const { entries, trace } = prepareResourceBars(
      makeResourceVector({ ore: 100, gas: 1 }), // gas is 1% of max → trace
      { collapseTrace: true, sort: true },
    );
    expect(entries.map((e) => e.type)).toEqual(["ore"]);
    expect(trace).toContain("gas");
    expect(trace).toContain("water");
  });

  it("puts every type in trace for an all-zero vector when collapsing", () => {
    const { entries, trace } = prepareResourceBars(emptyResourceVector(), {
      collapseTrace: true,
    });
    expect(entries).toEqual([]);
    expect(trace).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/resources.test.ts`
Expected: FAIL — `resourceVectorFromColumns`/`prepareResourceBars` are not exported.

- [ ] **Step 3: Implement the helpers** — append to `lib/engine/resources.ts`:

```ts
/** A single resource's bar: raw value + its fraction of the vector's max (0–1). */
export interface ResourceBarEntry {
  type: ResourceType;
  value: number;
  fraction: number;
}

/** Prepared bars for one vector: rendered entries plus collapsed trace types. */
export interface ResourceBars {
  entries: ResourceBarEntry[];
  trace: ResourceType[];
}

/** Resources below this fraction of the vector max collapse into "trace". */
const TRACE_FRACTION = 0.05;

/**
 * Inverse of aggregateColumns / bodyResourceColumns: read a flat column bag
 * back into a ResourceVector. prefix "agg" reads aggGas…aggRadioactive;
 * prefix "res" reads resGas…resRadioactive. Missing columns default to 0.
 */
export function resourceVectorFromColumns(
  source: Record<string, number>,
  prefix: "agg" | "res",
): ResourceVector {
  const v = emptyResourceVector();
  for (const type of RESOURCE_TYPES) {
    const key = `${prefix}${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    v[type] = source[key] ?? 0;
  }
  return v;
}

/**
 * Turn a ResourceVector into renderable bars. Bars normalize to the vector's
 * own max (so the dominant resource reads full-width); the raw value is kept
 * for display. With `sort`, entries read rich-first. With `collapseTrace`,
 * zero / near-zero resources move into `trace` instead of rendering a bar.
 */
export function prepareResourceBars(
  vector: ResourceVector,
  opts: { sort?: boolean; collapseTrace?: boolean } = {},
): ResourceBars {
  const { sort = false, collapseTrace = false } = opts;
  const types = [...RESOURCE_TYPES];
  if (sort) types.sort((a, b) => vector[b] - vector[a]);
  const max = Math.max(0, ...types.map((t) => vector[t]));

  const entries: ResourceBarEntry[] = [];
  const trace: ResourceType[] = [];
  for (const type of types) {
    const value = vector[type];
    const isTrace =
      collapseTrace && (value <= 0 || (max > 0 && value / max < TRACE_FRACTION));
    if (isTrace) {
      trace.push(type);
    } else {
      entries.push({ type, value, fraction: max > 0 ? value / max : 0 });
    }
  }
  return { entries, trace };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/resources.test.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/resources.ts lib/engine/__tests__/resources.test.ts
git commit -m "feat(economy): substrate resource-vector read + bar-prep helpers"
```

---

## Task 2: Substrate type guards

Validate the three substrate union-string columns once at the service boundary. Follows the existing `is*`/`to*` pattern in `guards.ts` (e.g. `isEconomyType`/`toEconomyType`). Sets are built from the catalog keys (DRY — like `MODULE_IDS = new Set(Object.keys(MODULES))`), so they can't drift from `bodies.ts`.

**Files:**
- Modify: `lib/types/guards.ts`
- Test: `lib/types/__tests__/guards.test.ts` (create)

**Interfaces:**
- Consumes: `SunClass`, `BodyArchetypeId`, `RichnessModifierId` (from `./game`); `SUN_CLASSES`, `BODY_ARCHETYPES`, `RICHNESS_MODIFIERS` (from `@/lib/constants/bodies`).
- Produces: `isSunClass`, `toSunClass`, `isBodyArchetypeId`, `toBodyArchetypeId`, `isRichnessModifierId`, `toRichnessModifierId`.

- [ ] **Step 1: Write the failing tests** — create `lib/types/__tests__/guards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isSunClass, toSunClass,
  isBodyArchetypeId, toBodyArchetypeId,
  isRichnessModifierId, toRichnessModifierId,
} from "../guards";

describe("isSunClass / toSunClass", () => {
  it("accepts catalog sun classes", () => {
    expect(isSunClass("yellow")).toBe(true);
    expect(isSunClass("red_dwarf")).toBe(true);
    expect(toSunClass("blue_white")).toBe("blue_white");
  });
  it("rejects unknown values", () => {
    expect(isSunClass("green")).toBe(false);
    expect(isSunClass("")).toBe(false);
    expect(() => toSunClass("green")).toThrow();
  });
});

describe("isBodyArchetypeId / toBodyArchetypeId", () => {
  it("accepts catalog archetypes", () => {
    expect(isBodyArchetypeId("garden_world")).toBe(true);
    expect(toBodyArchetypeId("asteroid_belt")).toBe("asteroid_belt");
  });
  it("rejects unknown values", () => {
    expect(isBodyArchetypeId("moon")).toBe(false);
    expect(() => toBodyArchetypeId("moon")).toThrow();
  });
});

describe("isRichnessModifierId / toRichnessModifierId", () => {
  it("accepts catalog richness ids", () => {
    expect(isRichnessModifierId("fertile_soil")).toBe(true);
    expect(toRichnessModifierId("helium3")).toBe("helium3");
  });
  it("rejects unknown values", () => {
    expect(isRichnessModifierId("magic_dust")).toBe(false);
    expect(() => toRichnessModifierId("magic_dust")).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/types/__tests__/guards.test.ts`
Expected: FAIL — the guards are not exported.

- [ ] **Step 3: Implement the guards** — in `lib/types/guards.ts`:

Add to the import of types from `./game` (the existing block at the top) these three names: `SunClass`, `BodyArchetypeId`, `RichnessModifierId`. Then add a catalog import near the other constant imports (e.g. below the `MODULES` import):

```ts
import { SUN_CLASSES, BODY_ARCHETYPES, RICHNESS_MODIFIERS } from "@/lib/constants/bodies";
```

Add the lookup sets near the other `ReadonlySet` declarations:

```ts
const SUN_CLASS_IDS: ReadonlySet<string> = new Set(Object.keys(SUN_CLASSES));
const BODY_ARCHETYPE_IDS: ReadonlySet<string> = new Set(Object.keys(BODY_ARCHETYPES));
const RICHNESS_MODIFIER_IDS: ReadonlySet<string> = new Set(Object.keys(RICHNESS_MODIFIERS));
```

Add the guards near the other converters (e.g. after the trait guards):

```ts
export function isSunClass(value: string): value is SunClass {
  return SUN_CLASS_IDS.has(value);
}
export function toSunClass(value: string): SunClass {
  if (!SUN_CLASS_IDS.has(value)) {
    throw new Error(`Invalid sun class: "${value}"`);
  }
  return value as SunClass;
}

export function isBodyArchetypeId(value: string): value is BodyArchetypeId {
  return BODY_ARCHETYPE_IDS.has(value);
}
export function toBodyArchetypeId(value: string): BodyArchetypeId {
  if (!BODY_ARCHETYPE_IDS.has(value)) {
    throw new Error(`Invalid body archetype id: "${value}"`);
  }
  return value as BodyArchetypeId;
}

export function isRichnessModifierId(value: string): value is RichnessModifierId {
  return RICHNESS_MODIFIER_IDS.has(value);
}
export function toRichnessModifierId(value: string): RichnessModifierId {
  if (!RICHNESS_MODIFIER_IDS.has(value)) {
    throw new Error(`Invalid richness modifier id: "${value}"`);
  }
  return value as RichnessModifierId;
}
```

(The `as` casts here are the sanctioned guards-file exception — they validate before returning, exactly like `toEconomyType`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/types/__tests__/guards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/types/guards.ts lib/types/__tests__/guards.test.ts
git commit -m "feat(economy): substrate type guards (sun class, body archetype, richness)"
```

---

## Task 3: Substrate read service + API types

The first DB reader of the substrate. Visibility-gated via the cached `getPlayerVisibility` (consistent with `getSystemTradeFlow`); resolves catalog display data (archetype name, richness name/resource/multiplier) server-side, mirroring how `getSystemDetail` resolves trait names. No unit test (DB service — the codebase tests engine purely; `getSystemDetail` likewise has none); verified by typecheck and the Task 6 manual checklist.

**Files:**
- Modify: `lib/types/api.ts`
- Modify: `lib/services/universe.ts`

**Interfaces:**
- Consumes: `resourceVectorFromColumns` (Task 1); `toSunClass`/`toBodyArchetypeId`/`toRichnessModifierId` (Task 2); `getPlayerVisibility` (`./visibility-cache`); `BODY_ARCHETYPES`/`RICHNESS_MODIFIERS` (`@/lib/constants/bodies`); `ServiceError`; `prisma`.
- Produces:
  - `interface RichnessModifierView { id: RichnessModifierId; name: string; resource: ResourceType; multiplier: number }`
  - `interface BodyView { id: string; bodyType: BodyArchetypeId; archetypeName: string; habitable: boolean; size: number; popCapWeight: number; resources: ResourceVector; richness: RichnessModifierView[] }`
  - `type SystemSubstrateData = { visibility: "visible"; sunClass: SunClass; population: number; popCap: number; aggregate: ResourceVector; bodies: BodyView[] } | { visibility: "unknown" }`
  - `type SystemSubstrateResponse = ApiResponse<SystemSubstrateData>`
  - `getSystemSubstrate(playerId: string, systemId: string): Promise<SystemSubstrateData>`

- [ ] **Step 1: Add the API types** — in `lib/types/api.ts`:

Extend the existing top-of-file `import type { … } from "./game";` block to also import `ResourceType`, `ResourceVector`, `SunClass`, `BodyArchetypeId`, `RichnessModifierId`. Then add, next to `SystemDetailData` / `SystemTraitResponse`:

```ts
// ── System substrate (economy-simulation SP1) ────────────────────
export interface RichnessModifierView {
  id: RichnessModifierId;
  name: string;
  resource: ResourceType;
  multiplier: number;
}
export interface BodyView {
  id: string;
  bodyType: BodyArchetypeId;
  archetypeName: string;
  habitable: boolean;
  size: number;
  popCapWeight: number;
  resources: ResourceVector;
  richness: RichnessModifierView[];
}
/** Physical substrate for one system — discriminated on fog-of-war visibility. */
export type SystemSubstrateData =
  | {
      visibility: "visible";
      sunClass: SunClass;
      population: number;
      popCap: number;
      aggregate: ResourceVector;
      bodies: BodyView[];
    }
  | { visibility: "unknown" };
export type SystemSubstrateResponse = ApiResponse<SystemSubstrateData>;
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The new types are not yet consumed; this confirms they're well-formed.

- [ ] **Step 3: Implement the service** — in `lib/services/universe.ts`:

Add imports at the top (alongside the existing ones):

```ts
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { toSunClass, toBodyArchetypeId, toRichnessModifierId } from "@/lib/types/guards";
import { BODY_ARCHETYPES, RICHNESS_MODIFIERS } from "@/lib/constants/bodies";
import { getPlayerVisibility } from "./visibility-cache";
import type { SystemDetailData, SystemSubstrateData, BodyView } from "@/lib/types/api";
```

(Replace the existing `import type { SystemDetailData } from "@/lib/types/api";` line with the combined `import type { … }` above.)

Append the service at the end of the file:

```ts
/**
 * Physical substrate for one system — the first DB reader of the PR3a
 * substrate columns. Visibility-gated: an unsurveyed (invisible) system
 * returns `{ visibility: "unknown" }` so a direct URL can't leak survey data.
 * Resolves catalog display data (archetype + richness names) server-side,
 * mirroring how getSystemDetail resolves trait names.
 */
export async function getSystemSubstrate(
  playerId: string,
  systemId: string,
): Promise<SystemSubstrateData> {
  const [{ visibleSet }, system] = await Promise.all([
    getPlayerVisibility(playerId),
    prisma.starSystem.findUnique({
      where: { id: systemId },
      select: {
        sunClass: true,
        population: true,
        popCap: true,
        aggGas: true, aggMinerals: true, aggOre: true, aggBiomass: true,
        aggArable: true, aggWater: true, aggRadioactive: true,
        bodies: {
          select: {
            id: true, bodyType: true, habitable: true, size: true, popCapWeight: true,
            resGas: true, resMinerals: true, resOre: true, resBiomass: true,
            resArable: true, resWater: true, resRadioactive: true,
            richnessModifiers: true,
          },
        },
      },
    }),
  ]);

  if (!system) {
    throw new ServiceError("System not found.", 404);
  }
  if (!visibleSet.has(systemId)) {
    return { visibility: "unknown" };
  }

  const aggregate = resourceVectorFromColumns(
    {
      aggGas: system.aggGas, aggMinerals: system.aggMinerals, aggOre: system.aggOre,
      aggBiomass: system.aggBiomass, aggArable: system.aggArable,
      aggWater: system.aggWater, aggRadioactive: system.aggRadioactive,
    },
    "agg",
  );

  const bodies: BodyView[] = system.bodies.map((b) => {
    const bodyType = toBodyArchetypeId(b.bodyType);
    return {
      id: b.id,
      bodyType,
      archetypeName: BODY_ARCHETYPES[bodyType].name,
      habitable: b.habitable,
      size: b.size,
      popCapWeight: b.popCapWeight,
      resources: resourceVectorFromColumns(
        {
          resGas: b.resGas, resMinerals: b.resMinerals, resOre: b.resOre,
          resBiomass: b.resBiomass, resArable: b.resArable,
          resWater: b.resWater, resRadioactive: b.resRadioactive,
        },
        "res",
      ),
      richness: b.richnessModifiers.map((id) => {
        const richnessId = toRichnessModifierId(id);
        const def = RICHNESS_MODIFIERS[richnessId];
        return {
          id: richnessId,
          name: def.name,
          resource: def.resource,
          multiplier: def.multiplier,
        };
      }),
    };
  });

  return {
    visibility: "visible",
    sunClass: toSunClass(system.sunClass),
    population: system.population,
    popCap: system.popCap,
    aggregate,
    bodies,
  };
}
```

- [ ] **Step 4: Verify the service compiles**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors, no `as`, no `unknown`.

- [ ] **Step 5: Commit**

```bash
git add lib/types/api.ts lib/services/universe.ts
git commit -m "feat(economy): getSystemSubstrate read service + substrate API types"
```

---

## Task 4: Endpoint plumbing — query key, API route, hook

Thin client-server bridge. Route mirrors `…/trade-flow/route.ts` exactly (auth → service → `private, no-cache`). Hook mirrors `useSystemTradeFlow`, but `staleTime: Infinity` / `gcTime: Infinity` because substrate is static (only changes on reseed) — it is **not** tick-invalidated.

**Files:**
- Modify: `lib/query/keys.ts`
- Create: `app/api/game/systems/[systemId]/substrate/route.ts`
- Create: `lib/hooks/use-system-substrate.ts`

**Interfaces:**
- Consumes: `getSystemSubstrate` (Task 3); `SystemSubstrateResponse`/`SystemSubstrateData` (Task 3); `requirePlayer`/`isErrorResponse`; `withServiceErrors`; `apiFetch`; `queryKeys`.
- Produces:
  - `queryKeys.systemSubstrate(systemId: string)` → `["systemSubstrate", systemId]`
  - `GET /api/game/systems/[systemId]/substrate`
  - `useSystemSubstrate(systemId: string): SystemSubstrateData`

- [ ] **Step 1: Add the query key** — in `lib/query/keys.ts`, inside the `queryKeys` object (near `systemTradeFlow`):

```ts
  // Per-system physical substrate (Astrography panel) — static, not tick-scoped.
  systemSubstrate: (systemId: string) => ["systemSubstrate", systemId] as const,
```

- [ ] **Step 2: Create the API route** — `app/api/game/systems/[systemId]/substrate/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getSystemSubstrate } from "@/lib/services/universe";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemSubstrateResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/substrate",
    async () => {
      const auth = await requirePlayer();
      if (isErrorResponse(auth)) return auth;

      const { systemId } = await params;
      const data = await getSystemSubstrate(auth.playerId, systemId);
      return NextResponse.json<SystemSubstrateResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
```

- [ ] **Step 3: Create the hook** — `lib/hooks/use-system-substrate.ts`:

```ts
"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { SystemSubstrateData } from "@/lib/types/api";

/**
 * Physical substrate (sun class, population, aggregate resources, bodies) for
 * one system. Static — only changes on reseed — so staleTime is Infinity and
 * it is not tick-invalidated. Visibility-gated server-side: unsurveyed systems
 * return `{ visibility: "unknown" }` so the panel renders a locked state.
 */
export function useSystemSubstrate(systemId: string): SystemSubstrateData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.systemSubstrate(systemId),
    queryFn: () =>
      apiFetch<SystemSubstrateData>(`/api/game/systems/${systemId}/substrate`),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data;
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/query/keys.ts app/api/game/systems/[systemId]/substrate/route.ts lib/hooks/use-system-substrate.ts
git commit -m "feat(economy): substrate API route + useSystemSubstrate hook + query key"
```

---

## Task 5: Presentation primitives — `SUN_CLASS_COLORS`, `formatNumber`, `StarGlyph`, `ResourceVectorBars`

The leaf building blocks the page composes. `formatNumber` gets a (locale-tolerant) unit test; the components are thin renderers over Task-1 logic / catalog data, verified by typecheck + build (no jsdom in the unit project, so no render test — the testable logic already lives in `prepareResourceBars`).

**Files:**
- Modify: `lib/constants/ui.ts`
- Modify: `lib/utils/format.ts`
- Test: `lib/utils/__tests__/format.test.ts` (create)
- Create: `components/system/star-glyph.tsx`
- Create: `components/system/resource-vector-bars.tsx`

**Interfaces:**
- Consumes: `SunClass` (`@/lib/types/game`); `SUN_CLASSES` (`@/lib/constants/bodies`); `ResourceVector`; `prepareResourceBars` (Task 1).
- Produces:
  - `SUN_CLASS_COLORS: Record<SunClass, string>`
  - `formatNumber(value: number): string`
  - `StarGlyph({ sunClass, size?, className? })` where `size` is `"sm" | "md"` (default `"md"`)
  - `ResourceVectorBars({ vector, sort?, collapseTrace? })`

- [ ] **Step 1: Write the failing `formatNumber` test** — create `lib/utils/__tests__/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatNumber } from "../format";

describe("formatNumber", () => {
  it("rounds to the nearest integer", () => {
    // strip locale separators so the assertion is locale-independent
    expect(formatNumber(1234.7).replace(/\D/g, "")).toBe("1235");
    expect(formatNumber(1234.4).replace(/\D/g, "")).toBe("1234");
  });
  it("groups thousands", () => {
    expect(formatNumber(4210)).toMatch(/^4\D?210$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/utils/__tests__/format.test.ts`
Expected: FAIL — `formatNumber` is not exported.

- [ ] **Step 3: Implement `formatNumber`** — append to `lib/utils/format.ts`:

```ts
/** Format a plain number with locale thousands separators, rounded (no suffix). */
export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/utils/__tests__/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `SUN_CLASS_COLORS`** — in `lib/constants/ui.ts`:

Add `import type { SunClass } from "@/lib/types/game";` to the top imports, then add near the other color maps (e.g. above `GOOD_COLORS`):

```ts
/** Star-glyph swatch color per sun class (presentation only; the display label
 *  comes from the SUN_CLASSES catalog). */
export const SUN_CLASS_COLORS: Record<SunClass, string> = {
  yellow: "#facc15",
  blue_white: "#93c5fd",
  orange_dwarf: "#fb923c",
  red_dwarf: "#f87171",
};
```

- [ ] **Step 6: Create `StarGlyph`** — `components/system/star-glyph.tsx`:

```tsx
import { tv, type VariantProps } from "tailwind-variants";
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { SUN_CLASS_COLORS } from "@/lib/constants/ui";
import type { SunClass } from "@/lib/types/game";

const glyphVariants = tv({
  base: "inline-block rounded-full shrink-0",
  variants: {
    size: { sm: "h-3 w-3", md: "h-6 w-6" },
  },
  defaultVariants: { size: "md" },
});

type GlyphVariants = VariantProps<typeof glyphVariants>;

interface StarGlyphProps extends GlyphVariants {
  sunClass: SunClass;
  className?: string;
}

/**
 * Colored circular swatch for a sun class. Round by design (it's a star) — the
 * Foundry no-rounding rule targets cards/buttons/badges, not iconography.
 */
export function StarGlyph({ sunClass, size, className }: StarGlyphProps) {
  const color = SUN_CLASS_COLORS[sunClass];
  return (
    <span
      aria-hidden
      title={SUN_CLASSES[sunClass].name}
      className={glyphVariants({ size, className })}
      style={{
        background: `radial-gradient(circle at 35% 35%, ${color}, ${color}99 60%, ${color}33)`,
      }}
    />
  );
}
```

- [ ] **Step 7: Create `ResourceVectorBars`** — `components/system/resource-vector-bars.tsx`:

```tsx
import { prepareResourceBars } from "@/lib/engine/resources";
import type { ResourceVector } from "@/lib/types/game";

interface ResourceVectorBarsProps {
  vector: ResourceVector;
  /** Sort rich-first (default false → canonical order). */
  sort?: boolean;
  /** Collapse near-zero resources into a muted trace line (default false). */
  collapseTrace?: boolean;
}

/**
 * Renders a ResourceVector as a labeled mini-bar strip. Bars normalize to the
 * vector's own max; the raw value is always shown so magnitude isn't lost.
 */
export function ResourceVectorBars({
  vector,
  sort = false,
  collapseTrace = false,
}: ResourceVectorBarsProps) {
  const { entries, trace } = prepareResourceBars(vector, { sort, collapseTrace });
  return (
    <div className="space-y-1">
      {entries.map((e) => (
        <div key={e.type} className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs capitalize text-text-tertiary">
            {e.type}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden bg-surface-active">
            <div className="h-full bg-accent" style={{ width: `${e.fraction * 100}%` }} />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-xs text-text-secondary">
            {e.value.toFixed(1)}
          </span>
        </div>
      ))}
      {trace.length > 0 && (
        <p className="text-xs capitalize text-text-tertiary">
          Trace: {trace.join(", ")}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/constants/ui.ts lib/utils/format.ts lib/utils/__tests__/format.test.ts components/system/star-glyph.tsx components/system/resource-vector-bars.tsx
git commit -m "feat(economy): star glyph, resource-vector bars, formatNumber, sun-class colors"
```

---

## Task 6: Compose the Astrography tab — `BodyCard`, page, tab link, Overview teaser

Assembles the primitives into the tab and wires it into the panel. Verified by typecheck, production build, and the manual checklist (the only place to confirm the real DB read + render).

**Files:**
- Create: `components/system/body-card.tsx`
- Create: `components/system/astrography-teaser.tsx`
- Create: `app/(game)/@panel/system/[systemId]/astrography/page.tsx`
- Modify: `app/(game)/@panel/system/[systemId]/layout.tsx`
- Modify: `app/(game)/@panel/system/[systemId]/page.tsx`

**Interfaces:**
- Consumes: `BodyView`/`SystemSubstrateData` (Task 3); `useSystemSubstrate` (Task 4); `StarGlyph`/`ResourceVectorBars` (Task 5); `formatNumber` (Task 5); `SUN_CLASSES`; `Card`, `Badge`, `SectionHeader`, `StatList`/`StatRow`, `ProgressBar`, `EmptyState`, `QueryBoundary`.
- Produces: `BodyCard({ body })`, `AstrographyTeaser({ systemId })`, the `astrography/page.tsx` route, the Astrography tab entry, the teaser mount.

- [ ] **Step 1: Create `BodyCard`** — `components/system/body-card.tsx`:

```tsx
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResourceVectorBars } from "./resource-vector-bars";
import type { BodyView } from "@/lib/types/api";

/**
 * One physical body in a system's substrate. Habitable bodies get a green
 * left-accent stripe (overriding the default copper). Resources read rich-first
 * with trace resources collapsed.
 */
export function BodyCard({ body }: { body: BodyView }) {
  return (
    <Card padding="sm" className={body.habitable ? "border-l-status-green" : undefined}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-display text-sm font-semibold text-text-primary">
          {body.archetypeName}
        </h4>
        {body.habitable && <Badge color="green">Habitable</Badge>}
      </div>
      <div className="mb-3 flex gap-4 text-xs text-text-tertiary">
        <span>
          Size <span className="font-mono text-text-secondary">{body.size.toFixed(2)}</span>
        </span>
        <span>
          Pop weight{" "}
          <span className="font-mono text-text-secondary">{body.popCapWeight.toFixed(0)}</span>
        </span>
      </div>
      <ResourceVectorBars vector={body.resources} sort collapseTrace />
      {body.richness.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {body.richness.map((r) => (
            <Badge key={r.id} color="amber" variant="outline">
              {r.name} ×{r.multiplier} {r.resource}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Create the Astrography page** — `app/(game)/@panel/system/[systemId]/astrography/page.tsx`:

```tsx
"use client";

import { use } from "react";
import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StarGlyph } from "@/components/system/star-glyph";
import { ResourceVectorBars } from "@/components/system/resource-vector-bars";
import { BodyCard } from "@/components/system/body-card";
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { formatNumber } from "@/lib/utils/format";

function AstrographyContent({ systemId }: { systemId: string }) {
  const substrate = useSystemSubstrate(systemId);

  if (substrate.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to survey its astrography." />
    );
  }

  const { sunClass, population, popCap, aggregate, bodies } = substrate;
  const popCapInt = Math.round(popCap);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card variant="bordered" padding="md">
        <div className="mb-4 flex items-center gap-3">
          <StarGlyph sunClass={sunClass} />
          <h3 className="font-display text-lg font-semibold text-text-primary">
            {SUN_CLASSES[sunClass].name}
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <StatList>
              <StatRow label="Population">
                <span className="font-mono text-sm text-text-primary">
                  {formatNumber(population)}
                </span>
              </StatRow>
              <StatRow label="Capacity">
                <span className="font-mono text-sm text-text-primary">
                  {formatNumber(popCapInt)}
                </span>
              </StatRow>
            </StatList>
            <ProgressBar
              label="Utilisation"
              value={population}
              max={Math.max(1, popCapInt)}
              color="copper"
            />
          </div>
          <div>
            <SectionHeader as="h4" className="mb-1">
              Resource profile · system aggregate
            </SectionHeader>
            <p className="mb-2 text-xs text-text-tertiary">Development potential</p>
            <ResourceVectorBars vector={aggregate} />
          </div>
        </div>
      </Card>

      {/* Bodies */}
      <div>
        <SectionHeader className="mb-3">System Bodies · {bodies.length}</SectionHeader>
        {bodies.length === 0 ? (
          <EmptyState message="No charted bodies in this system." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {bodies.map((b) => (
              <BodyCard key={b.id} body={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AstrographyPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return (
    <QueryBoundary>
      <AstrographyContent systemId={systemId} />
    </QueryBoundary>
  );
}
```

- [ ] **Step 3: Add the Astrography tab** — in `app/(game)/@panel/system/[systemId]/layout.tsx`, insert into the `tabs` array immediately after the `Overview` entry (between `Overview` and `Market`):

```ts
    { label: "Astrography", href: `${basePath}/astrography`, active: pathname.startsWith(`${basePath}/astrography`), badge: 0 },
```

- [ ] **Step 4: Create the Overview teaser** — `components/system/astrography-teaser.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { StarGlyph } from "./star-glyph";
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { formatNumber } from "@/lib/utils/format";

/**
 * One-line Astrography summary on the Overview tab, linking across to the
 * Astrography tab. Renders nothing for unsurveyed (unknown) systems.
 */
export function AstrographyTeaser({ systemId }: { systemId: string }) {
  const substrate = useSystemSubstrate(systemId);
  if (substrate.visibility === "unknown") return null;

  const { sunClass, bodies, population } = substrate;
  return (
    <Link
      href={`/system/${systemId}/astrography`}
      className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
    >
      <StarGlyph sunClass={sunClass} size="sm" />
      <span>{SUN_CLASSES[sunClass].name}</span>
      <span className="text-text-tertiary">·</span>
      <span>{bodies.length} {bodies.length === 1 ? "body" : "bodies"}</span>
      <span className="text-text-tertiary">·</span>
      <span>
        pop <span className="font-mono">{formatNumber(population)}</span>
      </span>
      <span className="text-text-accent">→</span>
    </Link>
  );
}
```

- [ ] **Step 5: Mount the teaser on Overview** — in `app/(game)/@panel/system/[systemId]/page.tsx`:

Add the import near the other `components/system` import (`TradeActivityPanel`):

```ts
import { AstrographyTeaser } from "@/components/system/astrography-teaser";
```

Then, immediately after the closing `</Card>` of the **System Summary** card (the one with `<CardHeader title="System Summary" />`) and before the `{/* Market row … */}` grid, insert:

```tsx
      {/* Astrography teaser — own boundary so its substrate fetch never blocks
          the overview, and pre-warms the Astrography tab's cache. */}
      <div className="mb-6">
        <QueryBoundary>
          <AstrographyTeaser systemId={systemId} />
        </QueryBoundary>
      </div>
```

(`QueryBoundary` is already imported in this file.)

- [ ] **Step 6: Verify typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS — clean typecheck and a successful production build (no `as`, no `unknown`, no lint/type errors).

- [ ] **Step 7: Run the full unit suite (regression check)**

Run: `npx vitest run`
Expected: PASS — all tests green (Tasks 1, 2, 5 included; nothing else regressed).

- [ ] **Step 8: Manual verification** (`npm run dev`, then in the browser)

- [ ] Open a **surveyed** (visible) system → the panel shows an **Astrography** tab between Overview and Market.
- [ ] Astrography header: colored `StarGlyph` matching the sun class + class name; Population and Capacity in `font-mono` with thousands separators; Utilisation bar fills proportionally; aggregate resource strip shows all seven labeled bars under "Resource profile · system aggregate / Development potential".
- [ ] System Bodies: one `BodyCard` per body; habitable bodies show the **Habitable** badge and a green left stripe; resources read rich-first; near-zero resources fold into a "Trace: …" line; richness pills render as `Name ×mult resource` when present.
- [ ] Overview tab shows the one-line teaser (`glyph · class · N bodies · pop N →`); clicking it navigates to Astrography (and the tab loads instantly from the pre-warmed cache).
- [ ] Open an **unsurveyed** (unknown) system → Astrography tab shows the "Scan this system…" EmptyState; the Overview teaser is **absent** (no error boundary, no leaked data).
- [ ] A system with no bodies (if reachable) shows the "No charted bodies" EmptyState rather than an empty grid.

- [ ] **Step 9: Commit**

```bash
git add components/system/body-card.tsx components/system/astrography-teaser.tsx "app/(game)/@panel/system/[systemId]/astrography/page.tsx" "app/(game)/@panel/system/[systemId]/layout.tsx" "app/(game)/@panel/system/[systemId]/page.tsx"
git commit -m "feat(economy): Astrography tab — substrate panel + Overview teaser"
```

---

## Self-Review (performed against the design spec)

**Spec coverage:**
- §2 read-back plumbing — `resourceVectorFromColumns` (T1), guards (T2), service + types (T3), route + hook + key (T4). ✅
- §4.1 header (glyph + class name, population + pop-cap utilisation, aggregate strip) — T6 page + T5 `StarGlyph`/`ResourceVectorBars`. ✅
- §4.2 body cards (habitable badge + green stripe, size/popCapWeight, rich-first resources, trace, richness pills) — T6 `BodyCard`. ✅
- §4.3 Overview teaser — T6 `AstrographyTeaser`. ✅
- §4.4 bar scaling (normalize to vector max, raw value shown) — `prepareResourceBars` + `ResourceVectorBars` (T1/T5). ✅
- §7 edge cases — unknown visibility → service returns `{visibility:"unknown"}`, tab shows EmptyState, teaser hidden (T3/T6); no bodies → EmptyState (T6); `popCap = 0` → `Math.max(1, popCapInt)` avoids divide-by-zero (T6); no `immutable` cache header — route uses `private, no-cache` (T4). ✅
- §8 testing — engine round-trip + bar tests (T1), guard tests (T2), `formatNumber` test (T5), build/typecheck (T3/T4/T6). ✅

**Deviations (intentional, see top section):** §5.3/§5.5/§5.6 `getSystemDetail` substrate summary is dropped; the header summary is folded into `getSystemSubstrate` and the teaser shares that hook. Rationale documented above.

**Placeholder scan:** none — every code step contains the full content.

**Type consistency:** `getSystemSubstrate(playerId, systemId)` signature matches its route call and `getSystemTradeFlow`'s arg order; `SystemSubstrateData`/`BodyView`/`RichnessModifierView` names are identical across T3 (definition), T4 (hook return), and T6 (consumers); `StarGlyph` `size` prop (`"sm"|"md"`) matches its two call sites (teaser `sm`, header default `md`); `prepareResourceBars` opts (`sort`, `collapseTrace`) match `ResourceVectorBars` props and `BodyCard` usage.

---

## Sequencing

1. **This PR** — Astrography UI + substrate read-back path (branch `feat/economy-simulation-astrography-ui` → shared `feat/economy-simulation`).
2. **PR3b** (after) — the destructive prune (TraitId pruning, strip economy fields, LOCATIONS→bodies, danger-from-bodies), now a clean pure-prune because the read slice lives here.
