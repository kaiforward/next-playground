# SP5 Stage 1 — Build Live-Wiring (Prisma Adapter + Registry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the (already-built, simulator-proven) `directed-build` processor a LIVE caller — a Prisma adapter that reads each system's capacity + markets and writes building-count increments to Postgres, plus the `directedBuildProcessor: TickProcessor` const registered in the tick registry — so the live game economy grows industry the same way the simulator does.

**Architecture:** A faithful mirror of the shipped `directed-logistics` LIVE wiring. `PrismaDirectedBuildWorld` mirrors `PrismaDirectedLogisticsWorld` (same per-faction sharded read, same market assembly) with two divergences: (1) it also reads the body-derived capacity columns persisted on `StarSystem` (`generalSpace`/`habitableSpace`/`slot*`), and (2) its write **increments building counts** via an insert-or-update (not the logistics market-stock UPDATE). The `directedBuildProcessor` const mirrors `directedLogisticsProcessor` exactly (build `PrismaDirectedBuildWorld(ctx.tx)` → `loadHopDistances()` → `routeCost` → call the pure `runDirectedBuildProcessor` body), registered to run **after** `directed-logistics`.

**Tech Stack:** TypeScript 5 (strict), Vitest 4 (`integration` Postgres project), Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), PostgreSQL. Reuses the shipped pure body `lib/tick/processors/directed-build.ts`, `PrismaDirectedLogisticsWorld` / `PrismaInfrastructureWorld` as patterns, `lib/services/hop-distances.ts`, `lib/engine/resources.ts` (`resourceVectorFromColumns`), `lib/constants/directed-build.ts`, `lib/constants/goods.ts` (`GOOD_NAME_TO_KEY`).

## Global Constraints

- **No `as` casts** except `as const` (project rule). No `unknown`, no `Record<string, unknown>`. **No postfix `!`** except `find(...)!` in tests.
- **Unit-loadability invariant (CRITICAL).** The pure body file `lib/tick/processors/directed-build.ts` is imported by the unit test `lib/tick/processors/__tests__/directed-build.test.ts`, and the `unit` Vitest project sets **no `DATABASE_URL`**. This plan ADDS a Prisma-adapter import + the processor const to that file. That is only safe because, exactly like the logistics pattern: (a) the new adapter `PrismaDirectedBuildWorld` imports **only types** from `@/lib/tick/types` (`TxClient`), `@/app/generated/prisma/client` (`Prisma`), and the world-type module — plus the **pure** `GOOD_NAME_TO_KEY` and `resourceVectorFromColumns` — and **NEVER `@/lib/prisma`**; and (b) `loadHopDistances` **defers** its `@/lib/prisma` import inside the function body. After wiring, the existing unit test MUST still load and pass with `DATABASE_URL` unset. This is a verification gate, not an assumption.
- **This plan does NOT change `prisma/schema.prisma`.** The capacity columns (`generalSpace`, `habitableSpace`, `slotGas`…`slotRadioactive`) and `SystemBuilding { systemId, buildingType, count: Float }` (with `@@unique([systemId, buildingType])`) already exist. No migration.
- **Building-count write policy (the precision/clamp decision the prior plan deferred):** counts are continuous `Float` by design — **no rounding, no upper clamp** (the engine is capacity-bounded upstream via `buildableUnits`). The ONLY write guard is finite + non-negative: `Number.isFinite(count) ? Math.max(0, count) : 0` (PG aborts the whole tx on `NaN`/`Infinity` — CLAUDE.md gotcha). This mirrors `PrismaInfrastructureWorld.applyBuildingDecays`.
- **Insert-or-update, not UPDATE-only.** Unlike the decay adapter (every seeded row exists because decay only lowers counts), build creates the FIRST unit of a type at a system that has no `SystemBuilding` row for it (seed only writes rows with `count > 0`). New `(systemId, buildingType)` pairs must be INSERTed; a raw `$executeRaw INSERT` cannot generate the `@default(cuid())` id (that default is Prisma-client-side, not a DB default), so new rows go through `tx.systemBuilding.createMany` (which generates cuids) and existing rows through a bulk `unnest()` UPDATE. No N+1 (CLAUDE.md): at most 3 bulk queries (one existence `findMany`, one UPDATE, one `createMany`).
- **Batch all writes in the tick transaction.** The adapter receives `ctx.tx`; all reads/writes use it. Set no per-query timeouts (the registry/worker owns the `$transaction({ timeout: 30_000 })`).
- **Mirror logistics; diverge only where stated.** Copy `getFactionShardKeys` verbatim from `PrismaDirectedLogisticsWorld`. Copy `getSystemsForFactions` and ADD the capacity selects + assembly. The processor const is a line-for-line mirror of `directedLogisticsProcessor` with build names/constants.
- Run unit tests with `DATABASE_URL` unset (`bash -lc 'unset DATABASE_URL; npx vitest run --project unit <path>'`). Integration tests run under the `integration` project against the test Postgres DB. The live smoke (Task 3) needs a seeded dev DB.

## File Structure

- `lib/tick/adapters/prisma/directed-build.ts` (NEW) — `PrismaDirectedBuildWorld implements DirectedBuildWorld`. Reads (capacity + markets + buildings) + insert-or-update write. Prisma-singleton-free (types only).
- `lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts` (NEW) — integration coverage of the two methods with real logic: capacity read, and the insert-or-update + clamp write.
- `lib/tick/processors/directed-build.ts` (MODIFY) — append the `directedBuildProcessor: TickProcessor` const after the pure body; add the adapter/service/constant imports.
- `lib/tick/registry.ts` (MODIFY) — import + register `directedBuildProcessor` immediately after `directedLogisticsProcessor`.

---

### Task 1: `PrismaDirectedBuildWorld` adapter + integration test

The live `DirectedBuildWorld`. Mirrors `PrismaDirectedLogisticsWorld` for sharding + market assembly; adds the capacity-column reads the build engine needs; writes building-count increments via insert-or-update.

**Files:**
- Create: `lib/tick/adapters/prisma/directed-build.ts`
- Create: `lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts`

**Interfaces:**
- Consumes: `TxClient` (`lib/tick/types`); `Prisma` (`@/app/generated/prisma/client`, type-only); `DirectedBuildWorld`, `SystemBuildRow`, `BuildBuildingUpdate` (`lib/tick/world/directed-build-world`); `GOOD_NAME_TO_KEY` (`lib/constants/goods`); `resourceVectorFromColumns` (`lib/engine/resources`).
- Produces: `class PrismaDirectedBuildWorld implements DirectedBuildWorld` with `getFactionShardKeys()`, `getSystemsForFactions(factionKeys)`, `applyBuildingIncreases(updates)`.

- [ ] **Step 1: Write the failing integration test**

Create `lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

// Imported after the prisma mock so any module-level prisma resolves to the integration client.
const { PrismaDirectedBuildWorld } = await import("@/lib/tick/adapters/prisma/directed-build");

describe("PrismaDirectedBuildWorld (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
  });

  it("getSystemsForFactions reads persisted capacity columns into SystemBuildRow", async () => {
    const sysId = universe.systems.industrial;
    await prisma.starSystem.update({
      where: { id: sysId },
      data: { generalSpace: 100, habitableSpace: 40, slotArable: 7 },
    });
    const { factionId } = await prisma.starSystem.findUniqueOrThrow({
      where: { id: sysId },
      select: { factionId: true },
    });

    const rows = await prisma.$transaction((tx) =>
      new PrismaDirectedBuildWorld(tx).getSystemsForFactions([factionId]),
    );

    const row = rows.find((r) => r.systemId === sysId);
    expect(row).toBeDefined();
    if (!row) return; // narrow for TS; the expect above is the real assertion
    expect(row.generalSpace).toBe(100);
    expect(row.habitableSpace).toBe(40);
    expect(row.slotCap.arable).toBe(7);
    // Markets + buildings still assembled (mirrors logistics).
    expect(Array.isArray(row.markets)).toBe(true);
    expect(typeof row.buildings).toBe("object");
  });

  it("applyBuildingIncreases UPDATES an existing row and INSERTS a brand-new (system,type) pair", async () => {
    const sysId = universe.systems.industrial;
    // Existing food row at count 2; guarantee NO water row exists.
    await prisma.systemBuilding.upsert({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "food" } },
      create: { systemId: sysId, buildingType: "food", count: 2 },
      update: { count: 2 },
    });
    await prisma.systemBuilding.deleteMany({ where: { systemId: sysId, buildingType: "water" } });

    await prisma.$transaction((tx) =>
      new PrismaDirectedBuildWorld(tx).applyBuildingIncreases([
        { systemId: sysId, buildingType: "food", count: 5 },   // existing → UPDATE to absolute 5
        { systemId: sysId, buildingType: "water", count: 3 },  // new → INSERT count 3
      ]),
    );

    const food = await prisma.systemBuilding.findUniqueOrThrow({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "food" } },
      select: { count: true },
    });
    const water = await prisma.systemBuilding.findUniqueOrThrow({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "water" } },
      select: { count: true },
    });
    expect(food.count).toBe(5);
    expect(water.count).toBe(3);
  });

  it("applyBuildingIncreases clamps non-finite / negative counts to 0", async () => {
    const sysId = universe.systems.tech;
    await prisma.systemBuilding.upsert({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "food" } },
      create: { systemId: sysId, buildingType: "food", count: 9 },
      update: { count: 9 },
    });

    await prisma.$transaction((tx) =>
      new PrismaDirectedBuildWorld(tx).applyBuildingIncreases([
        { systemId: sysId, buildingType: "food", count: Number.NaN },
      ]),
    );

    const food = await prisma.systemBuilding.findUniqueOrThrow({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "food" } },
      select: { count: true },
    });
    expect(food.count).toBe(0);
  });
});
```

> Notes for the implementer: (1) the unique-constraint accessor is `systemId_buildingType` (Prisma derives it from `@@unique([systemId, buildingType])`); confirm the exact name in the generated client and adjust if it differs. (2) `seedTestUniverse` returns `universe.systems.{agricultural,industrial,tech}` (see `@/lib/test-utils/fixtures`); if those exact keys differ, use whatever the fixture exposes for two distinct systems. (3) `findUniqueOrThrow` keeps the test `!`-free. Do not weaken the UPDATE-vs-INSERT assertion — it is the novel write path.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project integration lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts`
Expected: FAIL — `Cannot find module '@/lib/tick/adapters/prisma/directed-build'` (adapter not created yet).

> If the `integration` project / test Postgres DB is not available in your environment, capture that, still write the test (it is the spec), and proceed to implement; flag in your report that the integration test is written-but-unrun so the controller routes it to the live DB (the Task 3 smoke also exercises the write path end-to-end).

- [ ] **Step 3: Create the adapter**

Create `lib/tick/adapters/prisma/directed-build.ts`:

```typescript
import type { TxClient } from "@/lib/tick/types";
import type { Prisma } from "@/app/generated/prisma/client";
import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
} from "@/lib/tick/world/directed-build-world";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { resourceVectorFromColumns } from "@/lib/engine/resources";

/**
 * Live-game adapter for the directed-build processor. Mirrors
 * PrismaDirectedLogisticsWorld (per-faction sharded reads, identical market
 * assembly), with two divergences: it also reads the body-derived capacity
 * columns persisted on StarSystem (generalSpace / habitableSpace / slot*), and
 * its write INCREMENTS building counts.
 *
 * Write path: SystemBuilding rows exist only for count>0 (the seed filters
 * them), so a system building its FIRST unit of a type has no row. New
 * (systemId,buildingType) pairs are INSERTed via createMany (Prisma generates
 * the cuid id — a raw INSERT can't, since @default(cuid()) is client-side, not a
 * DB default); existing pairs are bulk-UPDATEd via unnest(). Counts are
 * continuous Float; the only write policy is the finite/non-negative guard (PG
 * aborts the tx on NaN/Infinity).
 *
 * Imports are TYPES + pure helpers only (never @/lib/prisma), so the processor
 * file that imports this class stays unit-loadable without a DATABASE_URL.
 */
export class PrismaDirectedBuildWorld implements DirectedBuildWorld {
  constructor(private readonly tx: TxClient) {}

  async getFactionShardKeys(): Promise<Array<string | null>> {
    const rows = await this.tx.starSystem.findMany({
      distinct: ["factionId"],
      select: { factionId: true },
    });
    // Stable deterministic order so the shard split is consistent across ticks.
    // null (independents) sorts last. (Verbatim from PrismaDirectedLogisticsWorld.)
    return rows
      .map((r) => r.factionId)
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  }

  async getSystemsForFactions(
    factionKeys: Array<string | null>,
  ): Promise<SystemBuildRow[]> {
    if (factionKeys.length === 0) return [];

    const ids = factionKeys.filter((k): k is string => k !== null);
    const includeNull = factionKeys.some((k) => k === null);

    const where: Prisma.StarSystemWhereInput =
      includeNull && ids.length > 0
        ? { OR: [{ factionId: { in: ids } }, { factionId: null }] }
        : includeNull
          ? { factionId: null }
          : { factionId: { in: ids } };

    // Pull columns + buildings separately to avoid the concurrent sub-query
    // issue (CLAUDE.md pg gotcha). relationLoadStrategy: "join" consolidates the
    // station→markets sibling relation into a single LATERAL JOIN.
    const [systems, buildingRows] = await Promise.all([
      this.tx.starSystem.findMany({
        where,
        relationLoadStrategy: "join",
        select: {
          id: true,
          factionId: true,
          population: true,
          generalSpace: true,
          habitableSpace: true,
          slotGas: true,
          slotMinerals: true,
          slotOre: true,
          slotBiomass: true,
          slotArable: true,
          slotWater: true,
          slotRadioactive: true,
          yieldGas: true,
          yieldMinerals: true,
          yieldOre: true,
          yieldBiomass: true,
          yieldArable: true,
          yieldWater: true,
          yieldRadioactive: true,
          station: {
            select: {
              markets: {
                select: {
                  id: true,
                  stock: true,
                  anchorMult: true,
                  demandRate: true,
                  storageCapacity: true,
                  good: {
                    select: {
                      name: true,
                      basePrice: true,
                      priceFloor: true,
                      priceCeiling: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.tx.systemBuilding.findMany({
        where: { system: where },
        select: { systemId: true, buildingType: true, count: true },
      }),
    ]);

    const buildingsBySystem = new Map<string, Record<string, number>>();
    for (const b of buildingRows) {
      const map = buildingsBySystem.get(b.systemId) ?? {};
      map[b.buildingType] = b.count;
      buildingsBySystem.set(b.systemId, map);
    }

    return systems.map((s): SystemBuildRow => {
      const buildings = buildingsBySystem.get(s.id) ?? {};

      const yields = resourceVectorFromColumns(
        {
          yieldGas: s.yieldGas,
          yieldMinerals: s.yieldMinerals,
          yieldOre: s.yieldOre,
          yieldBiomass: s.yieldBiomass,
          yieldArable: s.yieldArable,
          yieldWater: s.yieldWater,
          yieldRadioactive: s.yieldRadioactive,
        },
        "yield",
      );

      const slotCap = resourceVectorFromColumns(
        {
          slotGas: s.slotGas,
          slotMinerals: s.slotMinerals,
          slotOre: s.slotOre,
          slotBiomass: s.slotBiomass,
          slotArable: s.slotArable,
          slotWater: s.slotWater,
          slotRadioactive: s.slotRadioactive,
        },
        "slot",
      );

      const markets = (s.station?.markets ?? []).map((m) => ({
        id: m.id,
        goodId: GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name,
        stock: m.stock,
        basePrice: m.good.basePrice,
        anchorMult: m.anchorMult,
        demandRate: m.demandRate,
        priceFloor: m.good.priceFloor,
        priceCeiling: m.good.priceCeiling,
        storageCapacity: m.storageCapacity,
      }));

      return {
        systemId: s.id,
        factionId: s.factionId,
        population: s.population,
        buildings,
        yields,
        slotCap,
        generalSpace: s.generalSpace,
        habitableSpace: s.habitableSpace,
        markets,
      };
    });
  }

  async applyBuildingIncreases(updates: BuildBuildingUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    // Continuous Float counts. Only policy: finite + non-negative (PG aborts the
    // tx on NaN/Infinity). No rounding, no upper clamp — capacity-bounded upstream.
    const clean = updates.map((u) => ({
      systemId: u.systemId,
      buildingType: u.buildingType,
      count: Number.isFinite(u.count) ? Math.max(0, u.count) : 0,
    }));

    // Which (systemId,buildingType) rows already exist? (one bulk read). Nested
    // Set keyed by systemId — no concatenated string keys (CLAUDE.md \uXXXX note).
    const systemIds = [...new Set(clean.map((u) => u.systemId))];
    const existingRows = await this.tx.systemBuilding.findMany({
      where: { systemId: { in: systemIds } },
      select: { systemId: true, buildingType: true },
    });
    const existingBySystem = new Map<string, Set<string>>();
    for (const e of existingRows) {
      const set = existingBySystem.get(e.systemId) ?? new Set<string>();
      set.add(e.buildingType);
      existingBySystem.set(e.systemId, set);
    }
    const exists = (u: { systemId: string; buildingType: string }): boolean =>
      existingBySystem.get(u.systemId)?.has(u.buildingType) ?? false;

    const toUpdate = clean.filter((u) => exists(u));
    const toInsert = clean.filter((u) => !exists(u));

    // Bulk UPDATE existing rows to the new absolute count.
    if (toUpdate.length > 0) {
      const ids = toUpdate.map((u) => u.systemId);
      const types = toUpdate.map((u) => u.buildingType);
      const counts = toUpdate.map((u) => u.count);
      await this.tx.$executeRaw`
        UPDATE "SystemBuilding" AS sb
        SET "count" = batch."count"
        FROM unnest(${ids}::text[], ${types}::text[], ${counts}::double precision[])
          AS batch("systemId", "buildingType", "count")
        WHERE sb."systemId" = batch."systemId" AND sb."buildingType" = batch."buildingType"`;
    }

    // Bulk INSERT brand-new pairs (createMany generates the cuid ids).
    if (toInsert.length > 0) {
      await this.tx.systemBuilding.createMany({
        data: toInsert.map((u) => ({
          systemId: u.systemId,
          buildingType: u.buildingType,
          count: u.count,
        })),
      });
    }
  }
}
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npx vitest run --project integration lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts`
Expected: PASS — all three cases (capacity read; update-existing + insert-new; clamp). If the integration DB is unavailable, record it unrun and rely on Task 3's live smoke.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirms the `Prisma.StarSystemWhereInput` where-clause type, the `relationLoadStrategy` option, and the `select` field names all line up with the generated client.)

- [ ] **Step 6: Commit**

```bash
git add lib/tick/adapters/prisma/directed-build.ts lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts
git commit -m "feat(build): live PrismaDirectedBuildWorld adapter (capacity read + insert-or-update writes)"
```

---

### Task 2: `directedBuildProcessor` const + registry registration

Append the live processor const to the pure-body file (mirroring `directedLogisticsProcessor`), then register it to run after `directed-logistics`. The critical gate is that the existing unit test still loads with no `DATABASE_URL`.

**Files:**
- Modify: `lib/tick/processors/directed-build.ts` (append const + imports)
- Modify: `lib/tick/registry.ts` (import + register)

**Interfaces:**
- Consumes: `PrismaDirectedBuildWorld` (Task 1); `loadHopDistances` (`lib/services/hop-distances`); `DIRECTED_BUILD` (`lib/constants/directed-build`); `TickProcessor` (`../types`); `RouteCost` (already imported in the body from `@/lib/engine/directed-logistics`); `runDirectedBuildProcessor`, `TickProcessorResult` (already in the file).
- Produces: `export const directedBuildProcessor: TickProcessor`.

- [ ] **Step 1: Add the const’s imports to `lib/tick/processors/directed-build.ts`**

The file currently imports `type { TickContext, TickProcessorResult } from "../types"`. Change that to also import `TickProcessor`, and add the three new imports. Add at the top of the file (next to the existing imports):

```typescript
import type { TickProcessor } from "../types";
import { PrismaDirectedBuildWorld } from "@/lib/tick/adapters/prisma/directed-build";
import { loadHopDistances } from "@/lib/services/hop-distances";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
```

> If `../types` is already imported with `import type { TickContext, TickProcessorResult } from "../types";`, either add `TickProcessor` to that list or add the separate `import type { TickProcessor }` line above — both are fine. Do not duplicate `RouteCost` / `runDirectedBuildProcessor` / `TickProcessorResult` imports (already present from the body task).

- [ ] **Step 2: Append the processor const (after the pure `runDirectedBuildProcessor` body)**

At the END of `lib/tick/processors/directed-build.ts`, add:

```typescript
/**
 * Live tick processor. Mirrors directedLogisticsProcessor: build the Prisma
 * world from ctx.tx, load the cached hop distances into a RouteCost, and run the
 * pure body. frequency:1 — the per-faction shard window is computed inside the
 * body from ctx.tick + interval. Runs AFTER directed-logistics so it only fills
 * structural gaps logistics could not serve.
 */
export const directedBuildProcessor: TickProcessor = {
  name: "directed-build",
  frequency: 1,
  dependsOn: ["directed-logistics"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaDirectedBuildWorld(ctx.tx);
    const hops = await loadHopDistances();
    const routeCost: RouteCost = (fromId, toId) => {
      const h = hops.get(fromId)?.get(toId);
      if (h === undefined || h > DIRECTED_BUILD.MAX_HOPS) return null;
      return h * DIRECTED_BUILD.HOP_WEIGHT;
    };
    return runDirectedBuildProcessor(world, ctx, {
      interval: DIRECTED_BUILD.INTERVAL,
      routeCost,
    });
  },
};
```

- [ ] **Step 3: Verify the unit-loadability invariant still holds (CRITICAL GATE)**

Run: `bash -lc 'unset DATABASE_URL; npx vitest run --project unit lib/tick/processors/__tests__/directed-build.test.ts'`
Expected: PASS — all 4 existing body tests still load and pass with no `DATABASE_URL`. This proves the newly-imported adapter did not drag `@/lib/prisma` into the unit graph.

> If this FAILS with a prisma/`DATABASE_URL` module-load error, the adapter (or something it imports) is pulling the prisma singleton. Fix the adapter to import types only (compare its import block to `PrismaDirectedLogisticsWorld`); do NOT work around it by changing the test.

- [ ] **Step 4: Register in `lib/tick/registry.ts`**

Add the import alongside the other processor imports (match the file's existing import style), then insert `directedBuildProcessor` into the `processors` array immediately after `directedLogisticsProcessor`:

```typescript
import { directedBuildProcessor } from "@/lib/tick/processors/directed-build";
```

```typescript
export const processors: TickProcessor[] = [
  // …unchanged entries…
  tradeFlowProcessor,
  directedLogisticsProcessor,
  directedBuildProcessor,   // ← runs after logistics (dependsOn: ["directed-logistics"])
  tradeMissionsProcessor,
  // …unchanged entries…
];
```

> Ordering: `sortProcessors()` topologically sorts on `dependsOn`. `dependsOn: ["directed-logistics"]` guarantees build runs after logistics (which itself runs after economy, and after infrastructure-decay via registry order) — matching the simulator's economy → … → decay → logistics → build order. The array position is for readability; the dep is what enforces order.

- [ ] **Step 5: Typecheck + any registry unit test**

Run: `npx tsc --noEmit`
Then, if a registry/`sortProcessors` unit test exists (check `lib/tick/__tests__/`), run it:
`bash -lc 'unset DATABASE_URL; npx vitest run --project unit lib/tick/__tests__'`
Expected: no type errors; registry tests green (the new processor sorts in without a dependency cycle).

- [ ] **Step 6: Commit**

```bash
git add lib/tick/processors/directed-build.ts lib/tick/registry.ts
git commit -m "feat(build): register directedBuildProcessor in the live tick (after logistics)"
```

---

### Task 3: Live validation (seed → advance ticks → inspect)

Prove the wired processor runs in the REAL tick pipeline against Postgres without error/timeout and writes sane (finite, non-negative, capacity-bounded) building counts. This is the live smoke; the deterministic mechanism is already proven by the Task-4 body unit tests + the simulator wiring.

**Files:** none (validation only).

- [ ] **Step 1: Identify the full-registry tick entrypoint**

Read `scripts/bench-tick.ts` and `app/api/dev/advance-ticks/route.ts` (and `lib/services/dev-tools.ts`). Confirm which one runs the **full `processors` registry** (not a subset) inside the `$transaction`. Use that as the tick driver. Record which one you chose and why.

- [ ] **Step 2: Seed a fresh dev DB**

Run (no schema change this plan — capacity columns already exist):
```bash
npx prisma db push
npx prisma db seed
```
Expected: completes; `SystemBuilding`, `StarSystem` (with `generalSpace`/`habitableSpace`/`slot*`), and `StationMarket` populated.

- [ ] **Step 3: Capture the pre-run building total**

Record `SELECT COUNT(*) AS rows, COALESCE(SUM("count"),0) AS total FROM "SystemBuilding";` (via the dev tooling, a quick `prisma` script in scratch, or psql). Note rows + total.

- [ ] **Step 4: Advance enough ticks to fire at least one build shard for every faction**

`DIRECTED_BUILD.INTERVAL = 2 × ECONOMY_UPDATE_INTERVAL = 48`. Advance **≥ 100 ticks** so every faction's per-faction shard window fires at least once (ideally twice). Use the entrypoint from Step 1.
Expected: every tick completes with no thrown error, no `$transaction` timeout (CLAUDE.md: 30 s budget), no `P2020`/NaN/`Infinity` PG error in the logs.

- [ ] **Step 5: Capture the post-run total + assert sanity**

Re-run the Step 3 query. Assert:
- No `NaN`/`Infinity`/negative counts: `SELECT COUNT(*) FROM "SystemBuilding" WHERE "count" < 0 OR "count" <> "count";` returns 0. (`"count" <> "count"` catches NaN.)
- Counts stayed finite and the run did not crash or time out.
- New `(systemId, buildingType)` rows may have appeared (first-of-type builds) — expected, not a failure.
Record pre/post rows + totals in the task report.

> Expectation to record, not a failure (per [[feedback-coarse-health-calibration]] and the simulator result): against the current mature seed the live build will be **active** (the in-memory sim grew totals ~6.5× to a capacity plateau). The bar here is purely operational — runs cleanly in the live pipeline, no NaN/timeout/crash, counts bounded + non-negative. Macro magnitude validation belongs to the minimal-core seeder + age-forward harness (next plans). If you observe any NaN, negative count, tx timeout, or unbounded growth that never plateaus, STOP and report it as a failure.

> Live-smoke handoff: the user may prefer to run this smoke themselves and review the numbers before sign-off (their workflow). If so, hand off Steps 2–5 with the exact commands + what to check, and wait for their go-ahead.

- [ ] **Step 6: Commit (if any validation scratch was wired as a reusable instrument)**

No code change is expected. If you added a reusable inspection instrument, wire it properly (npm-aliased or a committed script) per [[feedback-scripts-one-off-vs-instrument]]; one-off diagnostics stay in scratch and are NOT committed. Otherwise nothing to commit — record results in the task report only.

---

## What this plan deliberately defers (follow-on plans)

- **Minimal-core seeder** — shrink the seeder to a few self-sufficient tier-0 subsistence cores per faction + inert frontier, so the build planner (not the hand-authored seed) owns industry allocation. This is what makes the live/sim macro validation meaningful.
- **Age-forward snapshot harness** + the **validation pass** — run the full agency stack N-thousand ticks and snapshot the matured galaxy back as the canonical seed.
- **Display-only Industry-tab direction cue** (developing/stable/declining from the building-count trend) — UI, deferred; no construction queue/progress bar (count is a continuous Float).
- **Stage 2** — un-owned space + dynamic `factionId` + colonisation; deliberate demolish/treasury/strategic build (full faction agency).

## Self-Review

- **Spec coverage:** Implements the build-processor plan's deferred "live Prisma adapter (`PrismaDirectedBuildWorld`: body-capacity reads + count-increment writes) + the `directedBuildProcessor: TickProcessor` const + registry registration." Task 1 = adapter + integration test (capacity read + the novel insert-or-update write). Task 2 = const + registry + the unit-loadability gate. Task 3 = live-pipeline smoke. The prior plan's open question — "whether building-count writes need a clamp/precision policy on the live Float columns" — is resolved in Global Constraints + the adapter: finite/non-negative guard only, no rounding, no upper clamp (capacity-bounded upstream).
- **Placeholder scan:** Tasks 1–2 carry complete code + exact commands. Task 3 is validation with concrete commands; its one "read the entrypoint and pick" step points at named existing files (`scripts/bench-tick.ts`, `app/api/dev/advance-ticks/route.ts`) because the repo has more than one tick driver and the implementer must confirm which runs the full registry. The integration test's two hedges (the `systemId_buildingType` accessor name; the `seedTestUniverse` system keys) point at concrete generated/fixture code to confirm, not invent.
- **Type consistency:** `PrismaDirectedBuildWorld` implements the shipped `DirectedBuildWorld` (`getFactionShardKeys`/`getSystemsForFactions`/`applyBuildingIncreases`) and returns the shipped `SystemBuildRow` / consumes `BuildBuildingUpdate` unchanged. `directedBuildProcessor` satisfies the shipped `TickProcessor`. `runDirectedBuildProcessor` / `RouteCost` / `TickProcessorResult` come from earlier work unchanged. `resourceVectorFromColumns(_, "slot"|"yield")`, `GOOD_NAME_TO_KEY`, `loadHopDistances`, `DIRECTED_BUILD` are all verified against the live code.
- **Unit-loadability:** Task 2 Step 3 is an explicit gate proving the adapter import did not taint the unit graph with `@/lib/prisma` — the one real risk of attaching a Prisma const to the pure-body file. The adapter imports types + pure helpers only, exactly mirroring `PrismaDirectedLogisticsWorld` (verified: that file imports no `@/lib/prisma`), and `loadHopDistances` defers its prisma import.
