# Purse Plan 3 — Player Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the faction treasury to the player — read API, player-gated policy mutations (tax level + band sliders), the ledger-stack treasury card, a treasury vital tile, and the construction-card funded readout.

**Architecture:** Pure read-and-mutate surfaces over state Plans 1–2 already persist on `WorldFactionTreasury` — no tick/engine changes anywhere. One GET+PATCH route pair per faction; a single `useFactionTreasury` hook feeds the vital tile, the treasury card, and the construction readout (shared query key → one fetch). Mutations are hard-gated server-side to `world.player.controlledFactionId`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, TanStack Query v5 (Suspense), Zod v4, Tailwind v4 + tailwind-variants, Vitest 4.

**Spec:** `docs/planned/player-seat-purse.md` — §UI surfaces (design settled 2026-07-20: ledger-stack card, set-vs-runs bars, collapsible maintenance breakdown default-collapsed, 5-segment tax stepper) and §Remaining build wiring (Plan 3).

**Branch / PR:** `feat/purse-surfaces` off `main`; single PR to `main` (matches Plans 1–2).

## Global Constraints

- No `as` assertions (only `as const` / guards in `lib/types/guards.ts`); no `unknown` outside JSON boundaries; no postfix `!` (exception: `find(...)!` in tests).
- Discriminated unions for mutation results: `{ ok: true; data } | { ok: false; error }`.
- Read services throw `ServiceError`; route handlers are thin wrappers; `ApiResponse<T>` everywhere; `Cache-Control: private, no-cache` (never `immutable`).
- The maintenance slider floor is `TREASURY.MAINTENANCE_SLIDER_FLOOR` (0.5) and must be enforced at **every** write boundary: Zod schema, service clamp, and slider `min`.
- World state stays JSON-serializable; services mutate only via `setWorld`.
- Form controls come from `components/form/` — never raw `<input>`/`<select>` outside that directory.
- Comments describe the code, never the plan/PR that produced it.
- Build gate: `npx next build --webpack`. Tests: `npx vitest run`.

---

### Task 1: API types + treasury read service

**Files:**
- Modify: `lib/types/api.ts` (append near `FactionVitalsData`, ~line 366)
- Create: `lib/services/treasury.ts`
- Test: `lib/services/__tests__/treasury.test.ts`

**Interfaces:**
- Consumes: `WorldFactionTreasury`, `WorldTreasurySettlement` (`lib/world/types.ts:287-313`), `TreasuryBands` (`lib/engine/treasury.ts:16-20`), `ServiceError` (`lib/services/errors.ts`), `getWorld` (`lib/world/store.ts`).
- Produces: `FactionTreasuryData`, `FactionTreasuryResponse`, `TreasuryPolicyData`, `UpdateTreasuryPolicyResponse` (types), `getFactionTreasury(factionId: string): FactionTreasuryData` (service). Task 2 adds the mutation to the same service file; Tasks 3–6 consume these types.

- [ ] **Step 1: Add the API types**

In `lib/types/api.ts`, after the `FactionVitalsResponse` block, append:

```ts
// ── Faction treasury (the purse — player surfaces) ───────────────
import type { TreasuryBands } from "@/lib/engine/treasury";
import type { WorldTreasurySettlement } from "@/lib/world/types";
import type { TaxLevel } from "@/lib/types/game";

/**
 * One faction's treasury surface — read straight off the persisted
 * `WorldFactionTreasury` (no recomputation; the settlement snapshot exists so
 * UI reads never touch transients). Not player-gated: the faction screen is a
 * god-view; only writes are seat-gated.
 */
export interface FactionTreasuryData {
  factionId: string;
  /** ≥ 0 — no debt instrument. */
  balance: number;
  taxLevel: TaxLevel;
  /** Funding sliders (0-1); maintenance ≥ 0.5 at every write boundary. */
  bands: TreasuryBands;
  /** Latched paid-fractions from the last settlement — what each band's consumers run at ("runs"). */
  funded: TreasuryBands;
  /** Last settlement's income − money paid; 0 before the first settlement. */
  net: number;
  lastSettlement: WorldTreasurySettlement | null;
}
export type FactionTreasuryResponse = ApiResponse<FactionTreasuryData>;

/** The mutable policy pair the PATCH route returns after a successful write. */
export interface TreasuryPolicyData {
  taxLevel: TaxLevel;
  bands: TreasuryBands;
}
export type UpdateTreasuryPolicyResponse = ApiResponse<TreasuryPolicyData>;
```

(`lib/types/api.ts` already has `import type` blocks mid-file — e.g. line 309 — so the placement is idiomatic. If `TaxLevel` is already imported at the top of the file, drop the duplicate import line.)

- [ ] **Step 2: Write the failing service tests**

Create `lib/services/__tests__/treasury.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getFactionTreasury } from "@/lib/services/treasury";
import { ServiceError } from "@/lib/services/errors";
import type { World, WorldTreasurySettlement } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({
    systemCount: 60,
    seed: 13,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "expansionist" },
  });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

function playerFactionId(): string {
  const id = getWorld().player?.controlledFactionId;
  if (!id) throw new Error("test world has no player seat");
  return id;
}

const settlementFixture: WorldTreasurySettlement = {
  tick: 24,
  headsIncome: 100,
  productionIncome: 60,
  incomeBySystem: [{ systemId: "s1", heads: 100, production: 60 }],
  maintenanceBill: 90,
  maintenanceByType: [{ buildingType: "housing", amount: 90 }],
  logisticsBill: 20,
  constructionBill: 50,
  paid: { maintenance: 90, logistics: 20, construction: 30 },
};

describe("getFactionTreasury", () => {
  it("throws ServiceError(404) for an unknown factionId", () => {
    expect(() => getFactionTreasury("does-not-exist")).toThrow(ServiceError);
    try {
      getFactionTreasury("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });

  it("returns the persisted treasury verbatim with net 0 before the first settlement", () => {
    const factionId = playerFactionId();
    const row = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    const data = getFactionTreasury(factionId);
    expect(data.factionId).toBe(factionId);
    expect(data.balance).toBe(row.balance);
    expect(data.taxLevel).toBe(row.taxLevel);
    expect(data.bands).toEqual(row.bands);
    expect(data.funded).toEqual(row.funded);
    expect(data.lastSettlement).toBeNull();
    expect(data.net).toBe(0);
  });

  it("computes net as settlement income minus money paid", () => {
    const factionId = playerFactionId();
    const w = getWorld();
    setWorld({
      ...w,
      treasuries: w.treasuries.map((t) =>
        t.factionId === factionId ? { ...t, lastSettlement: settlementFixture } : t,
      ),
    });
    const data = getFactionTreasury(factionId);
    // 100 + 60 − (90 + 20 + 30)
    expect(data.net).toBe(20);
    expect(data.lastSettlement).toEqual(settlementFixture);
  });

  it("reads AI factions too (god-view; only writes are seat-gated)", () => {
    const other = getWorld().factions.find((f) => f.id !== playerFactionId())!;
    expect(getFactionTreasury(other.id).factionId).toBe(other.id);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/services/__tests__/treasury.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/treasury'` (or equivalent resolve error).

- [ ] **Step 4: Implement the read service**

Create `lib/services/treasury.ts`:

```ts
/**
 * Faction treasury surfaces — reads come straight off the persisted
 * `WorldFactionTreasury` row (Plans 1–2 persist everything the UI shows, so
 * there is nothing to recompute); the policy write is the player seat's only
 * treasury verb and is gated to `world.player.controlledFactionId`.
 */
import { getWorld } from "@/lib/world/store";
import { ServiceError } from "./errors";
import type { FactionTreasuryData } from "@/lib/types/api";

export function getFactionTreasury(factionId: string): FactionTreasuryData {
  const world = getWorld();
  const treasury = world.treasuries.find((t) => t.factionId === factionId);
  if (!treasury) {
    throw new ServiceError(`Faction ${factionId} not found.`, 404);
  }
  const s = treasury.lastSettlement;
  const net = s
    ? s.headsIncome +
      s.productionIncome -
      (s.paid.maintenance + s.paid.logistics + s.paid.construction)
    : 0;
  return {
    factionId,
    balance: treasury.balance,
    taxLevel: treasury.taxLevel,
    bands: treasury.bands,
    funded: treasury.funded,
    net,
    lastSettlement: s,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/services/__tests__/treasury.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/types/api.ts lib/services/treasury.ts lib/services/__tests__/treasury.test.ts
git commit -m "feat(purse): treasury read service + API types"
```

---

### Task 2: Policy schema + player-gated mutation service

**Files:**
- Create: `lib/schemas/treasury.ts`
- Modify: `lib/services/treasury.ts` (append)
- Test: `lib/schemas/__tests__/treasury.test.ts`, `lib/services/__tests__/treasury.test.ts` (append)

**Interfaces:**
- Consumes: `TREASURY.MAINTENANCE_SLIDER_FLOOR` (`lib/constants/treasury.ts:30`), `ALL_TAX_LEVELS` (`lib/types/guards.ts:183`), `clamp` (`lib/utils/math.ts`), `hasWorld`/`setWorld` (`lib/world/store.ts`), `TreasuryPolicyData` (Task 1).
- Produces: `treasuryPolicySchema`, `TreasuryPolicyInput` (schema + type); `updateTreasuryPolicy(factionId: string, input: TreasuryPolicyInput): UpdateTreasuryPolicyResult` where `UpdateTreasuryPolicyResult = { ok: true; data: TreasuryPolicyData } | { ok: false; error: string }`. Task 3's PATCH route consumes both.

- [ ] **Step 1: Write the failing schema tests**

Create `lib/schemas/__tests__/treasury.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { treasuryPolicySchema } from "@/lib/schemas/treasury";
import { ALL_TAX_LEVELS } from "@/lib/types/guards";

const validBands = { maintenance: 0.8, logistics: 1, construction: 0.5 };

describe("treasuryPolicySchema", () => {
  it("accepts taxLevel alone, bands alone, and both", () => {
    expect(treasuryPolicySchema.safeParse({ taxLevel: "high" }).success).toBe(true);
    expect(treasuryPolicySchema.safeParse({ bands: validBands }).success).toBe(true);
    expect(treasuryPolicySchema.safeParse({ taxLevel: "low", bands: validBands }).success).toBe(true);
  });

  it("rejects an empty payload", () => {
    expect(treasuryPolicySchema.safeParse({}).success).toBe(false);
  });

  it("accepts every canonical tax level and rejects unknown ones", () => {
    for (const level of ALL_TAX_LEVELS) {
      expect(treasuryPolicySchema.safeParse({ taxLevel: level }).success).toBe(true);
    }
    expect(treasuryPolicySchema.safeParse({ taxLevel: "confiscatory" }).success).toBe(false);
  });

  it("rejects maintenance below the 0.5 floor and any band outside [0,1]", () => {
    expect(treasuryPolicySchema.safeParse({ bands: { ...validBands, maintenance: 0.4 } }).success).toBe(false);
    expect(treasuryPolicySchema.safeParse({ bands: { ...validBands, logistics: -0.1 } }).success).toBe(false);
    expect(treasuryPolicySchema.safeParse({ bands: { ...validBands, construction: 1.1 } }).success).toBe(false);
  });

  it("rejects a partial bands object", () => {
    expect(treasuryPolicySchema.safeParse({ bands: { maintenance: 0.8 } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run schema tests to verify they fail**

Run: `npx vitest run lib/schemas/__tests__/treasury.test.ts`
Expected: FAIL — cannot resolve `@/lib/schemas/treasury`.

- [ ] **Step 3: Implement the schema**

Create `lib/schemas/treasury.ts`:

```ts
import { z } from "zod";
import { TREASURY } from "@/lib/constants/treasury";

// Literal enum (Zod needs a tuple); the schema test pins it to ALL_TAX_LEVELS
// so the two can never drift.
const taxLevelSchema = z.enum(["very_low", "low", "normal", "high", "very_high"]);

const fraction = (min: number) =>
  z
    .number("Band funding must be a number")
    .min(min, `Band funding must be at least ${min}`)
    .max(1, "Band funding must be at most 1");

export const treasuryPolicySchema = z
  .object({
    taxLevel: taxLevelSchema.optional(),
    bands: z
      .object({
        maintenance: fraction(TREASURY.MAINTENANCE_SLIDER_FLOOR),
        logistics: fraction(0),
        construction: fraction(0),
      })
      .optional(),
  })
  .refine((v) => v.taxLevel !== undefined || v.bands !== undefined, {
    message: "Provide taxLevel and/or bands.",
  });

export type TreasuryPolicyInput = z.infer<typeof treasuryPolicySchema>;
```

- [ ] **Step 4: Run schema tests to verify they pass**

Run: `npx vitest run lib/schemas/__tests__/treasury.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing mutation-service tests**

Append to `lib/services/__tests__/treasury.test.ts` (add `updateTreasuryPolicy` to the existing import from `@/lib/services/treasury`):

```ts
describe("updateTreasuryPolicy", () => {
  it("rejects when the world has no player seat", () => {
    const seatless = generateWorld({ systemCount: 60, seed: 13 });
    setWorld(seatless);
    const anyFaction = seatless.factions[0];
    const result = updateTreasuryPolicy(anyFaction.id, { taxLevel: "high" });
    expect(result).toEqual({ ok: false, error: "This world has no player seat." });
  });

  it("rejects mutating a faction the player does not control", () => {
    const other = getWorld().factions.find((f) => f.id !== playerFactionId())!;
    const result = updateTreasuryPolicy(other.id, { taxLevel: "high" });
    expect(result).toEqual({ ok: false, error: "You do not control this faction." });
  });

  it("writes taxLevel and bands, clamping maintenance to the floor", () => {
    const factionId = playerFactionId();
    const result = updateTreasuryPolicy(factionId, {
      taxLevel: "very_high",
      bands: { maintenance: 0.5, logistics: 0.25, construction: 0 },
    });
    expect(result.ok).toBe(true);
    const row = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    expect(row.taxLevel).toBe("very_high");
    expect(row.bands).toEqual({ maintenance: 0.5, logistics: 0.25, construction: 0 });
  });

  it("leaves the untouched half of the pair and other treasuries alone", () => {
    const factionId = playerFactionId();
    const before = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    const othersBefore = getWorld().treasuries.filter((t) => t.factionId !== factionId);

    const result = updateTreasuryPolicy(factionId, { taxLevel: "low" });
    expect(result.ok).toBe(true);

    const after = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    expect(after.taxLevel).toBe("low");
    expect(after.bands).toEqual(before.bands);
    expect(after.balance).toBe(before.balance);
    expect(after.funded).toEqual(before.funded);
    expect(getWorld().treasuries.filter((t) => t.factionId !== factionId)).toEqual(othersBefore);
  });

  it("defensively clamps service-level input even past the schema", () => {
    const factionId = playerFactionId();
    const result = updateTreasuryPolicy(factionId, {
      bands: { maintenance: 0.1, logistics: 1.5, construction: -2 },
    });
    expect(result.ok).toBe(true);
    const row = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    expect(row.bands).toEqual({ maintenance: 0.5, logistics: 1, construction: 0 });
  });
});
```

- [ ] **Step 6: Run service tests to verify the new block fails**

Run: `npx vitest run lib/services/__tests__/treasury.test.ts`
Expected: FAIL — `updateTreasuryPolicy` is not exported.

- [ ] **Step 7: Implement the mutation**

Append to `lib/services/treasury.ts` (extend the imports: `hasWorld`, `setWorld` from `@/lib/world/store`; `clamp` from `@/lib/utils/math`; `TREASURY` from `@/lib/constants/treasury`; `TreasuryPolicyData` from `@/lib/types/api`; `TreasuryPolicyInput` from `@/lib/schemas/treasury`; `TreasuryBands` from `@/lib/engine/treasury`):

```ts
export type UpdateTreasuryPolicyResult =
  | { ok: true; data: TreasuryPolicyData }
  | { ok: false; error: string };

/**
 * The player seat's treasury verb: set the tax level and/or the three band
 * sliders. Clamps again at this boundary (schema-independent) — the
 * maintenance floor is enforced at every write boundary by design.
 */
export function updateTreasuryPolicy(
  factionId: string,
  input: TreasuryPolicyInput,
): UpdateTreasuryPolicyResult {
  if (!hasWorld()) return { ok: false, error: "No world loaded." };
  const world = getWorld();
  if (!world.player) return { ok: false, error: "This world has no player seat." };
  if (world.player.controlledFactionId !== factionId) {
    return { ok: false, error: "You do not control this faction." };
  }
  const treasury = world.treasuries.find((t) => t.factionId === factionId);
  if (!treasury) return { ok: false, error: `Faction ${factionId} has no treasury.` };

  const bands: TreasuryBands = input.bands
    ? {
        maintenance: clamp(input.bands.maintenance, TREASURY.MAINTENANCE_SLIDER_FLOOR, 1),
        logistics: clamp(input.bands.logistics, 0, 1),
        construction: clamp(input.bands.construction, 0, 1),
      }
    : treasury.bands;
  const taxLevel = input.taxLevel ?? treasury.taxLevel;

  setWorld({
    ...world,
    treasuries: world.treasuries.map((t) =>
      t.factionId === factionId ? { ...t, taxLevel, bands } : t,
    ),
  });
  return { ok: true, data: { taxLevel, bands } };
}
```

- [ ] **Step 8: Run the full treasury test files**

Run: `npx vitest run lib/services/__tests__/treasury.test.ts lib/schemas/__tests__/treasury.test.ts`
Expected: PASS (9 service+schema tests).

- [ ] **Step 9: Commit**

```bash
git add lib/schemas/treasury.ts lib/schemas/__tests__/treasury.test.ts lib/services/treasury.ts lib/services/__tests__/treasury.test.ts
git commit -m "feat(purse): player-gated treasury policy mutation + Zod schema"
```

---

### Task 3: Route, query keys, tick invalidation, hooks

**Files:**
- Create: `app/api/game/factions/[factionId]/treasury/route.ts`
- Create: `lib/hooks/use-faction-treasury.ts`
- Modify: `lib/query/keys.ts`, `lib/query/fetcher.ts`, `lib/hooks/use-tick-invalidation.ts`

**Interfaces:**
- Consumes: Task 1–2 exports; `withServiceErrors` (`lib/api/with-service-errors.ts`), `parseJsonBody` (`lib/api/parse-json.ts`).
- Produces: `GET/PATCH /api/game/factions/[factionId]/treasury`; `queryKeys.factionTreasuryAll` / `queryKeys.factionTreasury(factionId)`; `apiPatch<T>(url, body)`; `useFactionTreasury(factionId): FactionTreasuryData`; `useUpdateTreasuryPolicy(factionId)` (TanStack mutation taking `TreasuryPolicyInput`). Tasks 4–6 consume the hooks.

No new unit tests in this task: route handlers are thin wrappers by convention (the vitals/automation routes have none), and both sides of the wrapper were tested in Tasks 1–2. `tsc` and the Task 7 gates cover the wiring.

- [ ] **Step 1: Add the query keys**

In `lib/query/keys.ts`, after the `factionVitals` entries (line 57), add:

```ts
  // Per-faction treasury (balance/policy/settlement snapshot) — tick-invalidated.
  factionTreasuryAll: ["factionTreasury"] as const,
  factionTreasury: (factionId: string) => ["factionTreasury", factionId] as const,
```

- [ ] **Step 2: Add the PATCH fetch helper**

In `lib/query/fetcher.ts`, after `apiMutate`, add:

```ts
/**
 * Typed PATCH wrapper for partial-update API routes that return `ApiResponse<T>`.
 */
export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json: ApiResponse<T> = await res.json();

  if (json.error || !json.data) {
    throw new ApiError(json.error ?? "Unknown API error", res.status);
  }

  return json.data;
}
```

- [ ] **Step 3: Create the route**

Create `app/api/game/factions/[factionId]/treasury/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getFactionTreasury, updateTreasuryPolicy } from "@/lib/services/treasury";
import { treasuryPolicySchema } from "@/lib/schemas/treasury";
import { parseJsonBody } from "@/lib/api/parse-json";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type {
  ApiResponse,
  FactionTreasuryResponse,
  UpdateTreasuryPolicyResponse,
} from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ factionId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/factions/[factionId]/treasury",
    async () => {
      const { factionId } = await params;
      return NextResponse.json<FactionTreasuryResponse>(
        { data: getFactionTreasury(factionId) },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ factionId: string }> },
) {
  const { factionId } = await params;
  const body = await parseJsonBody<{
    taxLevel?: string;
    bands?: { maintenance?: number; logistics?: number; construction?: number };
  }>(request);
  const parsed = treasuryPolicySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }
  const result = updateTreasuryPolicy(factionId, parsed.data);
  if (!result.ok) {
    return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 403 });
  }
  return NextResponse.json<UpdateTreasuryPolicyResponse>({ data: result.data });
}
```

(Mirror `app/api/game/player/automation/route.ts` if `parseJsonBody`'s actual signature differs — that file is the canonical usage.)

- [ ] **Step 4: Create the hooks**

Create `lib/hooks/use-faction-treasury.ts`:

```ts
"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { apiFetch, apiPatch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { FactionTreasuryData, TreasuryPolicyData } from "@/lib/types/api";
import type { TreasuryPolicyInput } from "@/lib/schemas/treasury";

/**
 * One faction's treasury surface. Tick-dynamic (the settlement snapshot moves
 * on the month pulse) — tick-invalidated via useTickInvalidation. The vital
 * tile, the treasury card, and the construction readout share this key, so
 * co-rendered surfaces cost one fetch.
 */
export function useFactionTreasury(factionId: string): FactionTreasuryData {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.factionTreasury(factionId),
    queryFn: () => apiFetch<FactionTreasuryData>(`/api/game/factions/${factionId}/treasury`),
  });
  return data;
}

/** Set the player faction's tax level and/or band sliders (`PATCH .../treasury`). */
export function useUpdateTreasuryPolicy(factionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TreasuryPolicyInput) =>
      apiPatch<TreasuryPolicyData>(`/api/game/factions/${factionId}/treasury`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.factionTreasuryAll });
    },
  });
}
```

- [ ] **Step 5: Wire tick invalidation**

In `lib/hooks/use-tick-invalidation.ts`, inside the `economyTick` subscription block after the `factionVitalsAll` line (line 43), add:

```ts
        // Treasury settles on the month pulse; funded fractions + snapshot move then.
        queryClient.invalidateQueries({ queryKey: queryKeys.factionTreasuryAll });
```

- [ ] **Step 6: Type-check and smoke the route**

Run: `npx tsc --noEmit`
Expected: clean.

Run (dev server must be up — `npm run dev` — with a world loaded via the start screen; skip if none is running and rely on Task 7's manual smoke):
`curl -s http://localhost:3000/api/game/factions/does-not-exist/treasury`
Expected: `{"error":"Faction does-not-exist not found."}` with HTTP 404.

- [ ] **Step 7: Commit**

```bash
git add app/api/game/factions/[factionId]/treasury/route.ts lib/hooks/use-faction-treasury.ts lib/query/keys.ts lib/query/fetcher.ts lib/hooks/use-tick-invalidation.ts
git commit -m "feat(purse): treasury route, query keys, tick invalidation, hooks"
```

---

### Task 4: FundingSlider form control + TaxLevelStepper

**Files:**
- Create: `components/form/funding-slider.tsx`
- Create: `components/factions/tax-level-stepper.tsx`
- Modify: `lib/constants/ui.ts` (append `TAX_LEVEL_LABELS`)

**Interfaces:**
- Consumes: `TaxLevel` + `ALL_TAX_LEVELS` (`lib/types/guards.ts`), form slot styles (`components/form/form-slots.ts` — read it before writing; reuse its label/hint slots like `range-input.tsx` does).
- Produces:
  - `FundingSlider` props: `{ label: string; set: number; runs: number; floor?: number; interactive: boolean; onCommit: (value: number) => void }` — all fractions 0–1.
  - `TaxLevelStepper` props: `{ value: TaxLevel; interactive: boolean; onChange: (level: TaxLevel) => void }`.
  - `TAX_LEVEL_LABELS: Record<TaxLevel, string>`.

Design reference (settled): one bar per band — copper fill = `runs` (latched paid fraction), white thumb = `set` (slider), hatched zone marks `floor`, amber "shorted" tag when `runs < set` beyond rounding. Commit on release, not per-pixel drag.

No component tests (no jsdom in the Vitest config); correctness rides typecheck + the Task 7 manual smoke.

- [ ] **Step 1: Add the tax-level labels**

In `lib/constants/ui.ts`, append (import `TaxLevel` from `@/lib/types/game` if the file doesn't already):

```ts
/** Display names for the five-step faction tax stance. */
export const TAX_LEVEL_LABELS: Record<TaxLevel, string> = {
  very_low: "Very low",
  low: "Low",
  normal: "Normal",
  high: "High",
  very_high: "Very high",
};
```

- [ ] **Step 2: Create FundingSlider**

Create `components/form/funding-slider.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { formSlots } from "./form-slots";

export interface FundingSliderProps {
  label: string;
  /** Player-set funding fraction (0-1) — drawn as the thumb position. */
  set: number;
  /** Latched effective fraction from the last settlement (0-1) — drawn as the fill. */
  runs: number;
  /** Un-slidable lower bound (0-1) — hatched zone + the input's min (e.g. maintenance 0.5). */
  floor?: number;
  /** Sliders render but don't respond on AI factions. */
  interactive: boolean;
  /** Fired once on release (pointer up / key up) with the new fraction. */
  onCommit: (value: number) => void;
}

const pct = (fraction: number) => Math.round(fraction * 100);

/**
 * One budget band's funding bar: copper fill = what actually runs (last
 * settlement's paid fraction), thumb = the set slider. The two diverge only
 * when the settlement ladder shorts the band — tagged explicitly, since the
 * divergence is the insolvency signal.
 */
export function FundingSlider({ label, set, runs, floor = 0, interactive, onCommit }: FundingSliderProps) {
  // Draft holds the thumb during a drag; the server value re-adopts on refresh.
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => setDraft(null), [set]);

  const thumb = draft ?? pct(set);
  const shorted = pct(runs) < pct(set);

  const commit = () => {
    if (draft !== null && draft !== pct(set)) onCommit(draft / 100);
  };

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className={formSlots.label}>{label}</span>
        <span className="font-mono text-xs text-text-secondary">
          set {thumb}% ·{" "}
          <span className={shorted ? "text-status-warning" : "text-text-primary"}>
            runs {pct(runs)}%{shorted && " — shorted"}
          </span>
        </span>
      </div>
      <div className="relative h-2 bg-surface-active">
        {floor > 0 && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(45deg,var(--color-border),var(--color-border)_3px,transparent_3px,transparent_6px)]"
            style={{ width: `${pct(floor)}%` }}
          />
        )}
        <span aria-hidden className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct(runs)}%` }} />
        <input
          type="range"
          min={pct(floor)}
          max={100}
          step={1}
          value={thumb}
          disabled={!interactive}
          aria-label={`${label} funding`}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default
            [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-text-primary
            [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-[10px] [&::-moz-range-thumb]:border
            [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-text-primary [&::-moz-range-thumb]:rounded-none"
        />
      </div>
    </div>
  );
}
```

Adjust the two theme token names to what `globals.css` actually defines (check `@theme` for the warning/amber token — e.g. `--color-status-warning` vs `--color-status-amber` — and the exact surface/border token names used by `vital-tile.tsx`; reuse those).

- [ ] **Step 3: Create TaxLevelStepper**

Create `components/factions/tax-level-stepper.tsx`:

```tsx
"use client";

import { ALL_TAX_LEVELS } from "@/lib/types/guards";
import { TAX_LEVEL_LABELS } from "@/lib/constants/ui";
import type { TaxLevel } from "@/lib/types/game";

export interface TaxLevelStepperProps {
  value: TaxLevel;
  /** Segments render but don't respond on AI factions. */
  interactive: boolean;
  onChange: (level: TaxLevel) => void;
}

/** Five-segment tax stance control — segments fill up to the current level. */
export function TaxLevelStepper({ value, interactive, onChange }: TaxLevelStepperProps) {
  const currentIndex = ALL_TAX_LEVELS.indexOf(value);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-text-primary">{TAX_LEVEL_LABELS[value]}</span>
      <div className="flex gap-1" role="radiogroup" aria-label="Tax level">
        {ALL_TAX_LEVELS.map((level, i) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={level === value}
            aria-label={TAX_LEVEL_LABELS[level]}
            title={TAX_LEVEL_LABELS[level]}
            disabled={!interactive}
            onClick={() => onChange(level)}
            className={`h-3 w-7 transition-colors ${i <= currentIndex ? "bg-accent" : "bg-surface-active"} ${
              interactive ? "cursor-pointer hover:opacity-80" : "cursor-default"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. (If `formSlots.label` is a function-style slot rather than a string, mirror how `range-input.tsx` invokes it.)

- [ ] **Step 5: Commit**

```bash
git add components/form/funding-slider.tsx components/factions/tax-level-stepper.tsx lib/constants/ui.ts
git commit -m "feat(purse): FundingSlider + TaxLevelStepper controls"
```

---

### Task 5: Treasury card + faction page wiring (card, vital tile, ghost shrink)

**Files:**
- Create: `components/factions/treasury-card.tsx`
- Modify: `app/(game)/@panel/factions/[factionId]/page.tsx`

**Interfaces:**
- Consumes: `useFactionTreasury` / `useUpdateTreasuryPolicy` (Task 3), `FundingSlider` / `TaxLevelStepper` (Task 4), `Card`/`CardHeader`/`CardContent` (`components/ui/card.tsx` — read for exact props), `formatMagnitude`, `formatUnitsShort` (`lib/utils/format.ts`), `BUILDING_TYPES` (`lib/constants/industry.ts`) for maintenance-line display names.
- Produces: `TreasuryCard` props `{ factionId: string; interactive: boolean }`.

Card structure (settled design — ledger stack): header row (balance big-mono + net/month), **Income** (heads, production), **Expenses** (collapsible maintenance with by-type breakdown default-collapsed; logistics; construction — amounts are last settlement's *paid* money, the by-type lines are the *bill* composition), **Funding** (three `FundingSlider`s), divider, tax row (`TaxLevelStepper`). Before the first settlement, ledger sections show a single quiet placeholder line.

- [ ] **Step 1: Create the card**

Create `components/factions/treasury-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { FundingSlider } from "@/components/form/funding-slider";
import { TaxLevelStepper } from "@/components/factions/tax-level-stepper";
import { useFactionTreasury, useUpdateTreasuryPolicy } from "@/lib/hooks/use-faction-treasury";
import { TREASURY } from "@/lib/constants/treasury";
import { BUILDING_TYPES } from "@/lib/constants/industry";
import { formatMagnitude } from "@/lib/utils/format";
import type { TaxLevel } from "@/lib/types/game";
import type { TreasuryBands } from "@/lib/engine/treasury";

function money(n: number): string {
  return formatMagnitude(n);
}

function signedMoney(n: number): string {
  return `${n < 0 ? "−" : "+"}${money(Math.abs(n))}`;
}

function LedgerRow({ label, amount, indent = false }: { label: string; amount: string; indent?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between py-0.5 text-sm ${indent ? "pl-4 text-text-tertiary" : ""}`}>
      <span className={indent ? "" : "text-text-secondary"}>{label}</span>
      <span className="font-mono text-xs">{amount}</span>
    </div>
  );
}

function buildingTypeName(buildingType: string): string {
  return buildingType in BUILDING_TYPES ? BUILDING_TYPES[buildingType].name : buildingType;
}

/**
 * The faction treasury — a single-column ledger (balance, itemised income and
 * expenses from the last settlement) over the policy controls (band funding
 * sliders + tax stance). Renders on every faction's panel; `interactive` is
 * true only for the player's faction — AI factions show the same values
 * static. Expense amounts are money actually paid; the maintenance breakdown
 * shows the bill's composition by building type.
 */
export function TreasuryCard({ factionId, interactive }: { factionId: string; interactive: boolean }) {
  const data = useFactionTreasury(factionId);
  const update = useUpdateTreasuryPolicy(factionId);
  const [showMaintenance, setShowMaintenance] = useState(false);

  const s = data.lastSettlement;

  const commitBand = (band: keyof TreasuryBands) => (value: number) =>
    update.mutate({ bands: { ...data.bands, [band]: value } });
  const commitTaxLevel = (taxLevel: TaxLevel) => update.mutate({ taxLevel });

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader
        title="Treasury"
        subtitle={
          <>
            <span className="font-mono text-text-primary">{money(data.balance)}</span> ·{" "}
            <span className={`font-mono ${data.net < 0 ? "text-status-danger" : "text-status-success"}`}>
              net {signedMoney(data.net)} / month
            </span>
          </>
        }
      />
      <CardContent>
        {!s ? (
          <p className="mb-4 text-sm text-text-tertiary">
            No settlement yet — the first collection lands on the next month pulse.
          </p>
        ) : (
          <>
            <h4 className="mb-1 font-display text-[10px] font-semibold tracking-wider text-text-accent uppercase">
              Income — last settlement
            </h4>
            <LedgerRow label="Heads tax" amount={signedMoney(s.headsIncome)} />
            <LedgerRow label="Production tax" amount={signedMoney(s.productionIncome)} />

            <h4 className="mt-3 mb-1 font-display text-[10px] font-semibold tracking-wider text-text-accent uppercase">
              Expenses
            </h4>
            <button
              type="button"
              className="flex w-full items-baseline justify-between py-0.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
              aria-expanded={showMaintenance}
              onClick={() => setShowMaintenance((v) => !v)}
            >
              <span>Maintenance {showMaintenance ? "▾" : "▸"}</span>
              <span className="font-mono text-xs">{signedMoney(-s.paid.maintenance)}</span>
            </button>
            {showMaintenance &&
              s.maintenanceByType.map((line) => (
                <LedgerRow
                  key={line.buildingType}
                  label={buildingTypeName(line.buildingType)}
                  amount={signedMoney(-line.amount)}
                  indent
                />
              ))}
            <LedgerRow label="Logistics" amount={signedMoney(-s.paid.logistics)} />
            <LedgerRow label="Construction" amount={signedMoney(-s.paid.construction)} />
          </>
        )}

        <h4 className="mt-4 mb-2 font-display text-[10px] font-semibold tracking-wider text-text-accent uppercase">
          Funding
        </h4>
        <FundingSlider
          label="Maintenance"
          set={data.bands.maintenance}
          runs={data.funded.maintenance}
          floor={TREASURY.MAINTENANCE_SLIDER_FLOOR}
          interactive={interactive}
          onCommit={commitBand("maintenance")}
        />
        <FundingSlider
          label="Logistics"
          set={data.bands.logistics}
          runs={data.funded.logistics}
          interactive={interactive}
          onCommit={commitBand("logistics")}
        />
        <FundingSlider
          label="Construction"
          set={data.bands.construction}
          runs={data.funded.construction}
          interactive={interactive}
          onCommit={commitBand("construction")}
        />

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm text-text-secondary">Tax level</span>
          <TaxLevelStepper value={data.taxLevel} interactive={interactive} onChange={commitTaxLevel} />
        </div>
      </CardContent>
    </Card>
  );
}
```

Adjust to the real component APIs as you write: `CardHeader`'s actual prop names, the theme's success/danger token names (reuse whatever existing cards/badges use — read `components/ui/card.tsx` and one status usage first), and the section-heading idiom (if `SectionHeader` from `components/ui/section-header.tsx` fits, use it instead of the raw `h4`s — DRY wins over the literal snippet above).

If `BUILDING_TYPES[buildingType]` string-indexing trips strict mode, use the `in`-guard shown (`buildingType in BUILDING_TYPES` narrows the access legally — same idiom as `construction-orders.ts:61`).

- [ ] **Step 2: Wire the faction page**

In `app/(game)/@panel/factions/[factionId]/page.tsx`:

1. Add imports:

```tsx
import { TreasuryCard } from "@/components/factions/treasury-card";
import { useFactionTreasury } from "@/lib/hooks/use-faction-treasury";
```

2. In `FactionOverviewContent`, fetch the treasury (same key the card uses — one fetch):

```tsx
const treasury = useFactionTreasury(factionId);
```

3. Replace the `GhostVitalTile` block (lines 64-74) with a real Treasury tile + a 3-span ghost:

```tsx
        <VitalTile
          label="Treasury"
          dotColor="var(--color-accent)"
          value={formatUnitsShort(treasury.balance)}
          hint={`net ${treasury.net < 0 ? "−" : "+"}${formatUnitsShort(Math.abs(treasury.net))} / month`}
        />
        <GhostVitalTile
          label="Future vitals"
          colSpan={3}
          future={<>control · tax base</>}
        />
```

4. Render the card between the government card and the construction card:

```tsx
      <TreasuryCard factionId={faction.id} interactive={faction.isPlayer} />

      <FactionConstructionCard factionId={faction.id} />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Visual smoke (dev server)**

Run `npm run dev`, open a game (Continue or New game), open any faction panel:
- Treasury card renders with balance; before tick ~24 the ledger shows the no-settlement placeholder; after a month pulse the income/expense lines populate.
- On the player faction: drag a band slider (commits on release — one PATCH in the network tab), click a tax segment; both persist across a tick.
- On an AI faction: identical card, controls inert.
- Vitals grid: Treasury tile in row 2, ghost shrunk to "control · tax base" spanning 3.

- [ ] **Step 5: Commit**

```bash
git add components/factions/treasury-card.tsx app/(game)/@panel/factions/[factionId]/page.tsx
git commit -m "feat(purse): treasury card + vital tile on the faction panel"
```

---

### Task 6: Construction-card funded readout

**Files:**
- Modify: `components/construction/faction-construction-card.tsx`

**Interfaces:**
- Consumes: `useFactionTreasury` (Task 3) — `funded.construction` (runs) and `bands.construction` (set).
- Produces: a funding line in the construction card header area; no new exports.

- [ ] **Step 1: Add the readout**

In `components/construction/faction-construction-card.tsx`:

1. Import the hook:

```tsx
import { useFactionTreasury } from "@/lib/hooks/use-faction-treasury";
```

2. In `FactionConstructionCard`, after `const data = useFactionConstruction(factionId);`:

```tsx
  const treasury = useFactionTreasury(factionId);
  const runsPct = Math.round(treasury.funded.construction * 100);
  const shorted = runsPct < Math.round(treasury.bands.construction * 100);
```

3. Extend the `CardHeader` `subtitle` fragment (after the `centres` span, before `orderedCount`):

```tsx
            {" "}· funded{" "}
            <span className={`font-mono ${shorted ? "text-status-warning" : "text-text-secondary"}`}>
              {runsPct}%
            </span>
            {shorted && <span className="text-status-warning"> (shorted)</span>}
```

(Use the same warning token name Task 4 settled on.)

- [ ] **Step 2: Type-check + visual check**

Run: `npx tsc --noEmit` — clean.
Dev server: faction panel construction card subtitle now reads `pool N/pulse · N base + N centres · funded 100%` (amber + "(shorted)" only when the ladder shorted the band).

- [ ] **Step 3: Commit**

```bash
git add components/construction/faction-construction-card.tsx
git commit -m "feat(purse): construction card funded-fraction readout"
```

---

### Task 7: Gates, PR, doc lifecycle

**Files:**
- Modify: `docs/planned/player-seat-purse.md` → move to `docs/active/gameplay/player-seat-purse.md`
- Modify: `docs/planned/player-seat-roadmap.md` (receive the Deferred-by-design items)
- Modify: `docs/SPEC.md` (treasury entry now includes player surfaces; pointer moves to active doc)
- Delete: `docs/build-plans/purse-plan-3-player-surfaces.md` (this file)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 2: Build gate**

Run: `npx next build --webpack`
Expected: clean build (this also catches any Tailwind-scan issues the doc moves could introduce).

- [ ] **Step 3: Quality checklist pass**

Verify against CLAUDE.md's checklist: typed keys (no `Record<string, ...>` snuck in), existing components reused (`Card`, `SectionHeader`, form components), no duplicated markup between `TreasuryCard` rows (the `LedgerRow` helper is the dedup), `"use client"` only on components with hooks/state, no dead imports.

- [ ] **Step 4: Push and open the PR (before review, per house rule)**

```bash
git push -u origin feat/purse-surfaces
gh pr create --title "feat(purse): Plan 3 — player surfaces (treasury card, policy controls, funded readouts)" --body "..."
```

PR body: summarise the surfaces + the seat-gating; note zero tick/engine changes; end with the standard generated-with footer.

- [ ] **Step 5: Wait for the user's visual smoke, then run `/uber-review`**

The user does the manual/visual smoke themselves — wait for their go-ahead before launching the review (house rule). Findings land as PR comments; fix cheap+self-contained Minors in-task.

- [ ] **Step 6: Doc lifecycle on the branch BEFORE merge**

1. Promote: `git mv docs/planned/player-seat-purse.md docs/active/gameplay/player-seat-purse.md`.
2. Edit the promoted doc: strip the "Planned spec / Plans 1–2 SHIPPED" banner and the "Remaining build wiring (Plan 3)" section (now built — code is the source of truth); rewrite in present tense.
3. Migrate the whole "Deferred by design" section into `docs/planned/player-seat-roadmap.md` **with resume-context intact** (the spec's own instruction: do not reduce to one-liners).
4. Update `docs/SPEC.md`'s treasury/purse entry to point at the active doc and mention the player surfaces.
5. Booking check before deleting this build plan: grep it for routed work — it routes none (Deferred-by-design migration is step 3 above) — then `git rm docs/build-plans/purse-plan-3-player-surfaces.md`.
6. Commit: `git commit -m "docs(purse): promote purse spec to active, migrate deferrals, retire build plan"`.

- [ ] **Step 7: Squash-merge to main, delete branch, update memory**

Squash-merge the PR (never a regular merge commit), confirm CI green first (never merge over red). Then update `MEMORY.md`'s Last Session line and retire the purse thread from "Next up".

---

## Self-review notes

- **Spec coverage:** treasury card (Task 5), band sliders + 0.5 floor at every boundary (Tasks 2/4/5), tax-level control (Tasks 4/5), construction funded readout (Task 6), vital tile + ghost shrink (Task 5), services/API/Zod (Tasks 1–3), all-factions read + player-only write (Tasks 1/2/5). Spec's §UI surfaces and §Remaining build wiring fully mapped.
- **Known intentional choices:** expense ledger lines show *paid* money (honest money-out) while the maintenance breakdown shows *bill* composition — commented in the card; `net` derives in the service so tile and card agree; no optimistic updates (tick cadence makes staleness windows irrelevant).
- **Snippet-vs-reality rule:** Tasks 4–6 mark the spots where the exact theme-token / component-prop names must be read from the codebase at implementation time (`form-slots.ts`, `card.tsx`, status tokens). The snippets are complete logic; token names are the only sanctioned deviation.
