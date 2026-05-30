# Prosperity UI + Market Colour Consistency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface system prosperity (a badge on system screens + a per-system choropleth map mode) and unify price-deviation colour into one mode-aware convention across the market and map.

**Architecture:** Two disjoint colour axes — green↔red = price deal-quality (mode-aware buy/sell), cold↔warm = prosperity. Prosperity rides one dedicated tick-scoped feed (`useProsperity`, like `useTradeFlow`) shared by the badge and the map. The choropleth is a 4th map MODE reusing the existing per-system Voronoi machinery; price stays a per-system halo OVERLAY (orthogonal channel).

**Tech Stack:** Next.js 16, TypeScript 5 (strict, no `as`/`unknown`), Prisma 7, TanStack Query v5 (`useQuery` for tick-scoped feeds), Pixi.js v12, Vitest 4 (no jsdom — DOM-touching code needs stubs; Pixi/React wiring is verified manually).

**Design doc:** `docs/plans/prosperity-ui.md`. **Branch:** `feat/prosperity-ui` (already created, design doc committed).

**Testing note:** The unit project runs `lib/**/__tests__/**` and `components/**/__tests__/**`, no jsdom. Pure functions (ramps, params, enum guard, Voronoi grouping) get real Vitest TDD. React components and Pixi layers can't be unit-tested here, so those steps pair exact code with a **manual verification** (`npm run dev`, observe). Run pure tests with `npx vitest run <path>`.

---

## Part A — Price-deviation colour consistency (#85, #87)

### Task 1: Make `priceRampColor` mode-aware (buy/sell)

**Files:**
- Modify: `lib/utils/price-ramp.ts`
- Test: `lib/utils/__tests__/price-ramp.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// lib/utils/__tests__/price-ramp.test.ts
import { describe, it, expect } from "vitest";
import { priceRampColor, PRICE_RAMP_STOPS } from "@/lib/utils/price-ramp";

describe("priceRampColor mode-awareness", () => {
  it("buy mode (default): cheap = green, expensive = red", () => {
    expect(priceRampColor(50, 100)).toBe(PRICE_RAMP_STOPS.deepBargain); // 0.5× → green
    expect(priceRampColor(200, 100)).toBe(PRICE_RAMP_STOPS.deepPremium); // 2.0× → red
  });

  it("sell mode: expensive = green, cheap = red (mirror of buy)", () => {
    // 2.0× to sell is great → green; mirror lookup uses base/current = 0.5
    expect(priceRampColor(200, 100, "sell")).toBe(PRICE_RAMP_STOPS.deepBargain);
    // 0.5× to sell is bad → red; mirror uses base/current = 2.0
    expect(priceRampColor(50, 100, "sell")).toBe(PRICE_RAMP_STOPS.deepPremium);
  });

  it("neutral (at base) is neutral in both modes", () => {
    expect(priceRampColor(100, 100, "buy")).toBe(PRICE_RAMP_STOPS.neutral);
    expect(priceRampColor(100, 100, "sell")).toBe(PRICE_RAMP_STOPS.neutral);
  });

  it("returns null for non-positive prices", () => {
    expect(priceRampColor(100, 0)).toBeNull();
    expect(priceRampColor(0, 100, "sell")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/utils/__tests__/price-ramp.test.ts`
Expected: FAIL — `priceRampColor` does not accept a 3rd arg / sell cases wrong.

- [ ] **Step 3: Implement mode-awareness**

Replace the two functions in `lib/utils/price-ramp.ts` (keep `PRICE_RAMP_STOPS` and `PriceRampColor` as-is):

```ts
export type PriceMode = "buy" | "sell";

/**
 * Map (currentPrice / basePrice) to a discrete deal-quality colour.
 * Green = good deal for the player, red = bad. "Good" is perspective-dependent:
 *   - buy (default): low price is good (you pay less)
 *   - sell: high price is good (you receive more) — the ratio is mirrored.
 * Returns null when either price is non-positive.
 */
export function priceRampColor(
  currentPrice: number,
  basePrice: number,
  mode: PriceMode = "buy",
): PriceRampColor | null {
  if (basePrice <= 0 || currentPrice <= 0) return null;
  const ratio =
    mode === "sell" ? basePrice / currentPrice : currentPrice / basePrice;
  if (ratio <= 0.6) return PRICE_RAMP_STOPS.deepBargain;
  if (ratio <= 0.85) return PRICE_RAMP_STOPS.bargain;
  if (ratio < 1.15) return PRICE_RAMP_STOPS.neutral;
  if (ratio < 1.4) return PRICE_RAMP_STOPS.premium;
  return PRICE_RAMP_STOPS.deepPremium;
}

/** Hex string (#rrggbb) to a numeric color for Pixi tinting. */
export function priceRampColorPixi(
  currentPrice: number,
  basePrice: number,
  mode: PriceMode = "buy",
): number | null {
  const color = priceRampColor(currentPrice, basePrice, mode);
  if (!color) return null;
  return parseInt(color.slice(1), 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/utils/__tests__/price-ramp.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/price-ramp.ts lib/utils/__tests__/price-ramp.test.ts
git commit -m "feat(market): mode-aware price ramp (buy/sell)"
```

---

### Task 2: Trend column — sortable (#87) + value-convention recolour (#85)

**Files:**
- Modify: `components/trade/market-table.tsx:81-105` (the `priceTrend` column)

The "Trend" column computes `currentPrice − basePrice` (deviation from base) but colours it stock-ticker style (above-base = green). Recolour it to the value convention via `priceRampColor` (above-base = red/premium, below = green/bargain) and add sorting. No jsdom → verify manually.

- [ ] **Step 1: Add the import**

In `components/trade/market-table.tsx`, line 4 already imports `getPriceTrendPct`. Add `priceRampColor`:

```ts
import { getPriceTrendPct } from "@/lib/utils/market";
import { priceRampColor } from "@/lib/utils/price-ramp";
```

- [ ] **Step 2: Replace the `priceTrend` column (lines 81-105)**

```tsx
    {
      key: "priceTrend",
      label: "Trend",
      sortable: true,
      getValue: (row) => getPriceTrendPct(row.currentPrice, row.basePrice),
      render: (row) => {
        const diff = row.currentPrice - row.basePrice;
        if (diff === 0) return <span className="text-text-secondary">--</span>;
        const pct = getPriceTrendPct(row.currentPrice, row.basePrice).toFixed(1);
        // Value convention (default buy perspective): above base = premium (red),
        // below = bargain (green). Arrow still shows direction.
        const color = priceRampColor(row.currentPrice, row.basePrice) ?? undefined;
        return (
          <span style={{ color }} className="font-medium">
            <TrendIcon direction={diff > 0 ? "up" : "down"} className="mr-1" />
            {diff > 0 ? "+" : ""}{pct}%
          </span>
        );
      },
    },
```

- [ ] **Step 3: Verify build + manual check**

Run: `npx tsc --noEmit` → Expected: no new errors.
Run: `npm run dev`, open a system Market tab. Expected: the Trend column header is now clickable (▲/▼ on click, sorts by % deviation); a good priced **above** base shows **red** with an up-arrow, **below** base shows **green** with a down-arrow (matching the comparison panel / map, not inverted).

- [ ] **Step 4: Commit**

```bash
git add components/trade/market-table.tsx
git commit -m "fix(market): Trend column sortable + value-convention colours (#87, #85)"
```

---

### Task 3: Comparison panel — colour follows buy/sell filter (#85)

**Files:**
- Modify: `components/market/market-comparison-panel.tsx:177`

The panel already has a `buy | sell | all` filter (`filter` state). Drive the price colour from it.

- [ ] **Step 1: Make the colour mode-aware (line ~177)**

Replace:
```tsx
          const color = priceRampColor(r.currentPrice, r.basePrice);
```
with:
```tsx
          const color = priceRampColor(
            r.currentPrice,
            r.basePrice,
            filter === "sell" ? "sell" : "buy",
          );
```

(`priceRampColor` is already imported at line 7. `filter` is in scope from the component state.)

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, open Price overlay → "Show all prices" (or a Compare action) → the comparison panel. Toggle the filter chips. Expected: in **buy**, cheap systems are green; switch to **sell** and the colours invert (expensive systems become green). "all" stays buy-coloured.

- [ ] **Step 3: Commit**

```bash
git add components/market/market-comparison-panel.tsx
git commit -m "feat(market): comparison panel colours follow buy/sell filter (#85)"
```

---

### Task 4: Map price overlay — buy/sell sub-toggle (#85)

**Files:**
- Modify: `lib/hooks/use-map-data.ts` (accept `priceMode`, pass to `priceRampColorPixi`)
- Modify: `components/map/map-price-panel.tsx` (render the toggle)
- Modify: `components/map/map-controls-dock.tsx` (thread `priceMode`/`setPriceMode`)
- Modify: `components/map/star-map.tsx` (own the `priceMode` state)

- [ ] **Step 1: `use-map-data.ts` — add `priceMode` option**

In `UseMapDataOptions` (after `priceHeatmap`, ~line 119) add:
```ts
  priceMode: "buy" | "sell";
```
Destructure it in the hook signature (add `priceMode,` near `priceHeatmap,`). In the `systems` memo (line ~321) change:
```ts
      const priceTint = price ? priceRampColorPixi(price.currentPrice, price.basePrice) : null;
```
to:
```ts
      const priceTint = price ? priceRampColorPixi(price.currentPrice, price.basePrice, priceMode) : null;
```
Add `priceMode` to that memo's dependency array (line ~343).

- [ ] **Step 2: `map-price-panel.tsx` — render the toggle**

Add to `MapPricePanelProps`:
```ts
  priceMode: "buy" | "sell";
  setPriceMode: (mode: "buy" | "sell") => void;
```
Destructure them, and inside the `px-3 py-2 space-y-2` block, **above** the `SelectInput`, add:
```tsx
        <div className="flex gap-1.5">
          {(["buy", "sell"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPriceMode(m)}
              className={`flex-1 text-[10px] px-2 py-1 uppercase tracking-wider ${
                priceMode === m
                  ? "bg-accent/20 text-text-accent border border-accent/40"
                  : "bg-surface-hover text-text-secondary border border-border"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
```

- [ ] **Step 3: `map-controls-dock.tsx` — thread the props**

Add `priceMode: "buy" | "sell"` and `setPriceMode: (m: "buy" | "sell") => void` to `MapControlsDockProps`, destructure, and pass both into `<MapPricePanel ... priceMode={priceMode} setPriceMode={setPriceMode} />`.

- [ ] **Step 4: `star-map.tsx` — own the state and wire it through**

After the price overlay state (line ~71) add:
```ts
  const [priceMode, setPriceMode] = useState<"buy" | "sell">("buy");
```
Add `priceMode,` to the `useMapData({ ... })` call (near `priceHeatmap: heatmapData,`, line ~201). Add `priceMode={priceMode}` and `setPriceMode={setPriceMode}` to `<MapControlsDock ... />` (line ~338).

- [ ] **Step 5: Verify build + manual**

Run: `npx tsc --noEmit` → no new errors.
Run: `npm run dev`, enable Price overlay, pick a good. Expected: a buy/sell toggle appears in the Price panel; switching to **sell** inverts the heatmap (systems where the good is expensive turn green). The top-right `±%` pill is unchanged (raw deviation).

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/use-map-data.ts components/map/map-price-panel.tsx components/map/map-controls-dock.tsx components/map/star-map.tsx
git commit -m "feat(map): price overlay buy/sell sub-toggle (#85)"
```

---

## Part B — Prosperity data feed

### Task 5: Prosperity util (colour ramp + effect label) and shared params

**Files:**
- Modify: `lib/constants/economy.ts` (add `PROSPERITY_PARAMS`)
- Modify: `lib/tick/processors/economy.ts:173-182` (use the extracted const)
- Create: `lib/utils/prosperity.ts`
- Test: `lib/utils/__tests__/prosperity.test.ts` (create)

- [ ] **Step 1: Extract `PROSPERITY_PARAMS` in `lib/constants/economy.ts`**

Below the `PROSPERITY_MULT_AT_MAX` line (line 53), add:
```ts
import type { ProsperityParams } from "@/lib/engine/tick"; // (move to top with other imports)

/** Assembled live-game prosperity params — shared by the economy processor and UI helpers. */
export const PROSPERITY_PARAMS: ProsperityParams = {
  decayRate: PROSPERITY_DECAY_RATE,
  maxGain: PROSPERITY_MAX_GAIN,
  targetVolume: PROSPERITY_TARGET_VOLUME,
  min: PROSPERITY_MIN,
  max: PROSPERITY_MAX,
  multAtMin: PROSPERITY_MULT_AT_MIN,
  multAtZero: PROSPERITY_MULT_AT_ZERO,
  multAtMax: PROSPERITY_MULT_AT_MAX,
};
```
(The `import type` is erased at compile time; `tick.ts` does not import `economy.ts`, so there's no runtime cycle. Put the import at the top of the file with the other imports.)

- [ ] **Step 2: Use it in the processor (`lib/tick/processors/economy.ts:173-182`)**

Replace the inline object:
```ts
const prosperityParams: ProsperityParams = {
  decayRate: PROSPERITY_DECAY_RATE,
  ...
};
```
with:
```ts
const prosperityParams: ProsperityParams = PROSPERITY_PARAMS;
```
Add `PROSPERITY_PARAMS` to the existing `@/lib/constants/economy` import. (The `PROSPERITY_*` individual imports may now be unused there — remove any that are.)

- [ ] **Step 3: Write the failing test for the util**

```ts
// lib/utils/__tests__/prosperity.test.ts
import { describe, it, expect } from "vitest";
import {
  prosperityRampColor,
  prosperityRampColorPixi,
  prosperityEffectLabel,
  PROSPERITY_RAMP_STOPS,
} from "@/lib/utils/prosperity";

describe("prosperity ramp colours (cold→warm by label)", () => {
  it("maps anchor values to the right stop", () => {
    expect(prosperityRampColor(-1)).toBe(PROSPERITY_RAMP_STOPS.crisis);
    expect(prosperityRampColor(-0.5)).toBe(PROSPERITY_RAMP_STOPS.crisis); // ≤ -0.5
    expect(prosperityRampColor(-0.1)).toBe(PROSPERITY_RAMP_STOPS.disrupted); // ≤ -0.1
    expect(prosperityRampColor(0)).toBe(PROSPERITY_RAMP_STOPS.stagnant);
    expect(prosperityRampColor(0.7)).toBe(PROSPERITY_RAMP_STOPS.active); // ≤ 0.7
    expect(prosperityRampColor(1)).toBe(PROSPERITY_RAMP_STOPS.booming);
  });
  it("pixi variant returns the numeric form", () => {
    expect(prosperityRampColorPixi(1)).toBe(
      parseInt(PROSPERITY_RAMP_STOPS.booming.slice(1), 16),
    );
  });
});

describe("prosperityEffectLabel", () => {
  it("shows the bare multiplier factor, correct in both directions", () => {
    expect(prosperityEffectLabel(1)).toBe("Production & Consumption ×1.3");
    expect(prosperityEffectLabel(0)).toBe("Production & Consumption ×0.7");
    expect(prosperityEffectLabel(-1)).toBe("Production & Consumption ×0.3");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run lib/utils/__tests__/prosperity.test.ts`
Expected: FAIL — module `@/lib/utils/prosperity` not found.

- [ ] **Step 5: Implement `lib/utils/prosperity.ts`**

```ts
import { getProsperityLabel, getProsperityMultiplier, type ProsperityLabel } from "@/lib/engine/tick";
import { PROSPERITY_PARAMS } from "@/lib/constants/economy";

/** Cold→warm diverging stops, one per prosperity label. Reserves green/red for price. */
export const PROSPERITY_RAMP_STOPS: Record<ProsperityLabel, string> = {
  Crisis: "#4f6d9e",    // cold slate-blue
  Disrupted: "#5fa1b3", // muted cyan
  Stagnant: "#8a8f99",  // neutral grey
  Active: "#cf9a4e",    // warm light amber
  Booming: "#e07b2e",   // deep amber / copper
};

/** CSS hex for a prosperity value (badge accent + legend). */
export function prosperityRampColor(prosperity: number): string {
  return PROSPERITY_RAMP_STOPS[getProsperityLabel(prosperity)];
}

/** Numeric colour for Pixi tinting (choropleth fill). */
export function prosperityRampColorPixi(prosperity: number): number {
  return parseInt(prosperityRampColor(prosperity).slice(1), 16);
}

/** Muted descriptor of the mechanical effect, e.g. "Production & Consumption ×1.3". */
export function prosperityEffectLabel(prosperity: number): string {
  const mult = getProsperityMultiplier(prosperity, PROSPERITY_PARAMS);
  return `Production & Consumption ×${mult.toFixed(1)}`;
}
```

- [ ] **Step 6: Run tests (new + the economy suite, to confirm the param extraction didn't regress)**

Run: `npx vitest run lib/utils/__tests__/prosperity.test.ts lib/engine/__tests__/tick.test.ts lib/tick/processors/__tests__`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/constants/economy.ts lib/tick/processors/economy.ts lib/utils/prosperity.ts lib/utils/__tests__/prosperity.test.ts
git commit -m "feat(prosperity): shared params const + cold→warm ramp/effect util"
```

---

### Task 6: Prosperity feed — types, service, route, hook

**Files:**
- Modify: `lib/types/game.ts` (add `ProsperityEntry`)
- Modify: `lib/types/api.ts` (add `ProsperityResponse`)
- Modify: `lib/query/keys.ts` (add `prosperity` key)
- Create: `lib/services/prosperity.ts`
- Create: `app/api/game/systems/prosperity/route.ts`
- Create: `lib/hooks/use-prosperity.ts`

No jsdom → verified by build + manual. (Service is integration-territory; covered by the manual map/badge checks downstream.)

- [ ] **Step 1: `lib/types/game.ts` — add the entry type**

After `MarketComparisonEntry` (line ~330) add:
```ts
export interface ProsperityEntry {
  systemId: string;
  prosperity: number;
}
```

- [ ] **Step 2: `lib/types/api.ts` — add the response type**

Add (next to `TradeFlowResponse`, importing `ProsperityEntry` from `@/lib/types/game`):
```ts
export type ProsperityResponse = ApiResponse<{ systems: ProsperityEntry[] }>;
```

- [ ] **Step 3: `lib/query/keys.ts` — add the key**

After the `tradeFlow` key (line ~33) add:
```ts
  prosperity: ["prosperity"] as const,
```

- [ ] **Step 4: `lib/services/prosperity.ts` — the read service**

```ts
import { prisma } from "@/lib/prisma";
import type { ProsperityEntry } from "@/lib/types/game";

/** All systems' current prosperity (-1..+1). Tick-scoped; refetched on a short staleTime. */
export async function getProsperityBySystem(): Promise<ProsperityEntry[]> {
  const rows = await prisma.starSystem.findMany({
    select: { id: true, prosperity: true },
  });
  return rows.map((r) => ({ systemId: r.id, prosperity: r.prosperity }));
}
```

- [ ] **Step 5: `app/api/game/systems/prosperity/route.ts` — the route**

```ts
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getProsperityBySystem } from "@/lib/services/prosperity";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { ProsperityResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/prosperity", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const systems = await getProsperityBySystem();
    return NextResponse.json<ProsperityResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
```

- [ ] **Step 6: `lib/hooks/use-prosperity.ts` — the shared feed**

```ts
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { ProsperityEntry } from "@/lib/types/game";

/**
 * All-systems prosperity, keyed by systemId. Tick-scoped (no viewport dep),
 * mirrors `useTradeFlow`. Gated by `active` so callers that don't need it
 * (map mode off) don't pay the request; the badge calls it always-on. The
 * shared `["prosperity"]` key means the map and the panel reuse one fetch.
 */
export function useProsperity(active: boolean = true): Map<string, number> {
  const { data } = useQuery({
    queryKey: queryKeys.prosperity,
    queryFn: () =>
      apiFetch<{ systems: ProsperityEntry[] }>("/api/game/systems/prosperity"),
    staleTime: 10_000,
    gcTime: 30_000,
    enabled: active,
  });

  return useMemo(() => {
    const m = new Map<string, number>();
    if (active && data) {
      for (const s of data.systems) m.set(s.systemId, s.prosperity);
    }
    return m;
  }, [active, data]);
}
```

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit` → no new errors.
Run: `npm run dev`; while logged in, hit `http://localhost:3000/api/game/systems/prosperity`. Expected: JSON `{ "data": { "systems": [{ "systemId": "...", "prosperity": 0 }, ...] }}`.

- [ ] **Step 8: Commit**

```bash
git add lib/types/game.ts lib/types/api.ts lib/query/keys.ts lib/services/prosperity.ts app/api/game/systems/prosperity/route.ts lib/hooks/use-prosperity.ts
git commit -m "feat(prosperity): tick-scoped all-systems prosperity feed (service + route + hook)"
```

---

## Part C — Prosperity badge (#86)

### Task 7: `ProsperityBadge` component + wire into the system layout

**Files:**
- Create: `components/ui/prosperity-badge.tsx`
- Modify: `app/(game)/@panel/system/[systemId]/layout.tsx`

No jsdom → manual verification.

- [ ] **Step 1: Create `components/ui/prosperity-badge.tsx`**

```tsx
import { getProsperityLabel } from "@/lib/engine/tick";
import { prosperityRampColor, prosperityEffectLabel } from "@/lib/utils/prosperity";

interface ProsperityBadgeProps {
  prosperity: number;
}

/**
 * Label-only badge (e.g. "Booming") accented with the cold→warm prosperity
 * ramp, plus a muted descriptor of the mechanical effect next to it. Uses the
 * same ramp colour as the map's prosperity mode so the two surfaces match.
 */
export function ProsperityBadge({ prosperity }: ProsperityBadgeProps) {
  const label = getProsperityLabel(prosperity);
  const color = prosperityRampColor(prosperity);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider"
        style={{ color, borderColor: `${color}66`, backgroundColor: `${color}1a` }}
      >
        {label}
      </span>
      <span className="text-[11px] text-text-tertiary">
        {prosperityEffectLabel(prosperity)}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Wire into `layout.tsx`**

Add imports (near line 15):
```tsx
import { ProsperityBadge } from "@/components/ui/prosperity-badge";
import { useProsperity } from "@/lib/hooks/use-prosperity";
```
Inside `SystemPanelContent` (after `const { systemInfo, regionInfo } = useSystemInfo(systemId);`, line 27) add:
```tsx
  const prosperity = useProsperity().get(systemId);
```
In the `subtitle` JSX (lines 61-69), add the badge after the `EconomyBadge` line:
```tsx
      {systemInfo && <EconomyBadge economyType={systemInfo.economyType} />}
      {prosperity !== undefined && <ProsperityBadge prosperity={prosperity} />}
```

- [ ] **Step 3: Verify manually**

Run: `npx tsc --noEmit` → no new errors.
Run: `npm run dev`, open any system's Overview tab, then its Market tab. Expected: a coloured prosperity badge (e.g. "Stagnant" grey, "Booming" amber) with "Production & Consumption ×N" beside it appears in the header subtitle on **both** tabs, next to the economy badge. If the header looks crowded, note it for the design-call fallback (tooltip) — but default inline.

- [ ] **Step 4: Commit**

```bash
git add components/ui/prosperity-badge.tsx "app/(game)/@panel/system/[systemId]/layout.tsx"
git commit -m "feat(prosperity): badge on system overview + market screens (#86)"
```

---

## Part D — Prosperity map mode (the choropleth)

### Task 8: Add `prosperity` to `MapMode`; rename dock heading to "Mode"; add legend

**Files:**
- Modify: `lib/types/map.ts`
- Modify: `components/map/map-overlay-controls.tsx`
- Test: `lib/types/__tests__/map.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// lib/types/__tests__/map.test.ts
import { describe, it, expect } from "vitest";
import { isMapMode, MAP_MODES } from "@/lib/types/map";

describe("MapMode prosperity", () => {
  it("includes prosperity in the mode set and ordering", () => {
    expect(MAP_MODES).toContain("prosperity");
    expect(isMapMode("prosperity")).toBe(true);
  });
  it("rejects unknown modes", () => {
    expect(isMapMode("bogus")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/types/__tests__/map.test.ts`
Expected: FAIL — `MAP_MODES` does not contain "prosperity".

- [ ] **Step 3: Add the mode (`lib/types/map.ts:4-7`)**

```ts
export type MapMode = "political" | "regions" | "prosperity" | "none";

/** Iteration order also defines the UI render order in the Mode toggle group. */
export const MAP_MODES: readonly MapMode[] = ["political", "regions", "prosperity", "none"];
```
(`isMapMode` and the session `parseMode` derive from `MAP_MODES`/the set, so persistence supports it automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/types/__tests__/map.test.ts`
Expected: PASS.

- [ ] **Step 5: Dock label + legend (`map-overlay-controls.tsx`)**

Add the import at the top:
```ts
import { PROSPERITY_RAMP_STOPS } from "@/lib/utils/prosperity";
```
Add the label (in `MODE_LABELS`, line ~16):
```ts
const MODE_LABELS: Record<MapMode, string> = {
  political: "Political",
  regions: "Regions",
  prosperity: "Prosperity",
  none: "None",
};
```
Rename the section heading (line ~82): `<SectionHeading>Territory</SectionHeading>` → `<SectionHeading>Mode</SectionHeading>`, and update the `RadioGroup` `ariaLabel="Territory"` → `ariaLabel="Mode"`.
Add a legend below the `RadioGroup` (after line ~89, before the `<div className="border-t border-border" />`):
```tsx
        {mode === "prosperity" && <ProsperityRampLegend />}
```
And define the legend component (next to `PriceRampLegend`):
```tsx
const PROSPERITY_RAMP = [
  PROSPERITY_RAMP_STOPS.Crisis,
  PROSPERITY_RAMP_STOPS.Disrupted,
  PROSPERITY_RAMP_STOPS.Stagnant,
  PROSPERITY_RAMP_STOPS.Active,
  PROSPERITY_RAMP_STOPS.Booming,
].join(", ");

function ProsperityRampLegend() {
  return (
    <div className="px-3 pb-2">
      <div
        className="h-2 w-full"
        style={{ background: `linear-gradient(to right, ${PROSPERITY_RAMP})` }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-[9px] font-mono text-text-secondary">
        <span>Crisis</span>
        <span>Booming</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit` → no new errors (a "Prosperity" radio now appears under a "Mode" heading; selecting it shows the legend but paints nothing until Task 9-10).

- [ ] **Step 7: Commit**

```bash
git add lib/types/map.ts lib/types/__tests__/map.test.ts components/map/map-overlay-controls.tsx
git commit -m "feat(map): add prosperity map mode + 'Mode' heading + legend"
```

---

### Task 9: `ProsperityTerritoryLayer` (per-system Voronoi choropleth)

**Files:**
- Create: `components/map/pixi/layers/prosperity-territory-layer.ts`
- Test: `components/map/pixi/__tests__/prosperity-territory.test.ts` (create — tests the pure grouping, not Pixi)

The layer reuses `computeTerritoryPolygons` with a per-system group key (each system = its own cell, no union), caches the geometry, and redraws fills from a live `Map<systemId, prosperity>` — mirroring `TerritoryLayer`'s `drawFills`/`setPlayerPresence` split.

- [ ] **Step 1: Write the failing test (pure grouping — no Pixi import)**

```ts
// components/map/pixi/__tests__/prosperity-territory.test.ts
import { describe, it, expect } from "vitest";
import { Delaunay } from "d3-delaunay";
import { computeTerritoryPolygons } from "@/components/map/pixi/territory-utils";

describe("per-system Voronoi grouping (prosperity choropleth geometry)", () => {
  it("produces one polygon group per system when keyed by id", () => {
    const pts: [number, number][] = [
      [100, 100], [900, 100], [500, 900], [500, 500],
    ];
    const ids = ["a", "b", "c", "d"];
    const voronoi = Delaunay.from(pts).voronoi([0, 0, 1000, 1000]);
    const cells = computeTerritoryPolygons(pts.length, voronoi, (i) => ids[i]);
    expect(cells.size).toBe(4);
    for (const id of ids) {
      const poly = cells.get(id);
      expect(poly).toBeDefined();
      // single cell wrapped as one MultiPolygon (one poly, one exterior ring)
      expect(poly!.length).toBe(1);
      expect(poly![0][0].length).toBeGreaterThanOrEqual(3);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes — see note)**

Run: `npx vitest run components/map/pixi/__tests__/prosperity-territory.test.ts`
Expected: PASS already (this exercises existing `computeTerritoryPolygons` with a new key). This is a **guard test** locking in the per-system contract the new layer depends on. If it fails, stop — the layer's geometry assumption is wrong.

- [ ] **Step 3: Implement the layer**

```ts
// components/map/pixi/layers/prosperity-territory-layer.ts
import { Container, Graphics } from "pixi.js";
import { Delaunay } from "d3-delaunay";
import type { LODState } from "../lod";
import { TERRITORY } from "../theme";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";
import { computeTerritoryPolygons } from "../territory-utils";
import { prosperityRampColorPixi } from "@/lib/utils/prosperity";
import type { AtlasSystem } from "@/lib/types/game";

/**
 * Per-system prosperity choropleth. Geometry (one Voronoi cell per system) is
 * computed from atlas positions in sync() and cached; fills are redrawn from a
 * live prosperity map in setProsperity() — same geometry-vs-fill split as
 * TerritoryLayer. Sits in the territory band; only one map MODE is visible at a
 * time, so it never stacks with the faction/region fills.
 */
export class ProsperityTerritoryLayer {
  readonly container = new Container();
  private graphics = new Graphics();
  private cachedCells: Map<string, [number, number][][][]> | null = null;
  private prosperity = new Map<string, number>();

  constructor() {
    this.container.addChild(this.graphics);
  }

  /** Compute per-system Voronoi cells from atlas positions (not per frame). */
  sync(systems: AtlasSystem[]) {
    if (systems.length < 3) {
      this.clear();
      return;
    }
    const points: [number, number][] = systems.map((s) => [s.x, s.y]);
    const size = UNIVERSE_GEN.MAP_SIZE;
    const voronoi = Delaunay.from(points).voronoi([0, 0, size, size]);
    this.cachedCells = computeTerritoryPolygons(
      systems.length,
      voronoi,
      (i) => systems[i].id,
    );
    this.drawFills();
  }

  /** Update per-system prosperity values and redraw fills (cheap — no recompute). */
  setProsperity(prosperity: Map<string, number>) {
    this.prosperity = prosperity;
    this.drawFills();
  }

  private drawFills() {
    if (!this.cachedCells) return;
    this.graphics.clear();
    for (const [systemId, multiPoly] of this.cachedCells) {
      const value = this.prosperity.get(systemId);
      if (value === undefined) continue;
      const color = prosperityRampColorPixi(value);
      for (const poly of multiPoly) {
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;
        this.graphics.poly(exterior.flat());
        this.graphics.fill({ color, alpha: TERRITORY.fillAlpha });
        this.graphics.poly(exterior.flat());
        this.graphics.stroke({
          color,
          alpha: TERRITORY.strokeAlpha,
          width: TERRITORY.strokeWidth,
        });
      }
    }
  }

  /** Per-frame LOD update (same gating as the other territory layers). */
  updateVisibility(lod: LODState) {
    this.graphics.visible = lod.showTerritories;
    this.graphics.alpha = lod.territoryAlpha;
  }

  private clear() {
    this.cachedCells = null;
    this.graphics.clear();
  }

  destroy() {
    this.graphics.destroy();
    this.container.destroy({ children: true });
  }
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit` → no new errors. (`TERRITORY` is exported from `../theme` — confirm `fillAlpha`/`strokeAlpha`/`strokeWidth` keys exist there; `TerritoryLayer` uses the same.)

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/layers/prosperity-territory-layer.ts components/map/pixi/__tests__/prosperity-territory.test.ts
git commit -m "feat(map): prosperity choropleth layer (per-system Voronoi fill)"
```

---

### Task 10: Wire the choropleth into the canvas + feed it from `star-map`

**Files:**
- Modify: `components/map/pixi/pixi-map-canvas.tsx`
- Modify: `components/map/star-map.tsx`

- [ ] **Step 1: `pixi-map-canvas.tsx` — import + ref + prop**

Import (near line 13):
```ts
import { ProsperityTerritoryLayer } from "./layers/prosperity-territory-layer";
```
Add to `PixiRefs` (after `politicalTerritoryLayer`, line 65):
```ts
  prosperityTerritoryLayer: ProsperityTerritoryLayer;
```
Add to `PixiMapCanvasProps` (after `mapMode?`, line ~41):
```ts
  /** Per-system prosperity for the choropleth, or null when the mode is off. */
  prosperityBySystem?: Map<string, number> | null;
```
Destructure `prosperityBySystem` in the component params (near `mapMode = "political",`).

- [ ] **Step 2: Create + register the layer in the mount effect**

After the `politicalTerritoryLayer` block (line ~192) add:
```ts
      const prosperityTerritoryLayer = new ProsperityTerritoryLayer();
      world.addChild(prosperityTerritoryLayer.container);
```
Add it to the `pixiRef.current = { ... }` object (line ~293):
```ts
        politicalTerritoryLayer, prosperityTerritoryLayer, fleetDotLayer, tradeFlowLayer,
```
Add to the cleanup destroy block (line ~315):
```ts
          refs.prosperityTerritoryLayer.destroy();
```

- [ ] **Step 3: Per-frame visibility (render loop, line ~268-270)**

After `politicalTerritoryLayer.updateVisibility(lod);` add:
```ts
        prosperityTerritoryLayer.updateVisibility(lod);
```

- [ ] **Step 4: Sync geometry (territory sync effect, line ~342-348)**

After the `politicalTerritoryLayer.sync(...)` line add:
```ts
    p.prosperityTerritoryLayer.sync(atlasData.systems);
```

- [ ] **Step 5: Mode toggle (line ~354-359)**

In the mode effect add:
```ts
    p.prosperityTerritoryLayer.container.visible = mapMode === "prosperity";
```

- [ ] **Step 6: Push live prosperity fills (new effect)**

After the player-presence effect (line ~373) add:
```ts
  // ── Prosperity choropleth fills (lightweight redraw on data change) ──
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;
    p.prosperityTerritoryLayer.setProsperity(prosperityBySystem ?? new Map());
  }, [prosperityBySystem, pixiReady]);
```

- [ ] **Step 7: `star-map.tsx` — fetch and pass through**

Import (near line 19):
```ts
import { useProsperity } from "@/lib/hooks/use-prosperity";
```
After the map-mode hook (line ~61) add:
```ts
  const prosperityBySystem = useProsperity(mapMode === "prosperity");
```
Pass it to the canvas (in the `<PixiMapCanvas ... />` props, near `mapMode={mapMode}`, line ~316):
```tsx
        prosperityBySystem={prosperityBySystem}
```

- [ ] **Step 8: Verify build + manual**

Run: `npx tsc --noEmit` → no new errors.
Run: `npm run dev`, open the map, select the **Prosperity** mode radio. Expected: territory cells fill with the cold→warm ramp (most systems grey "Stagnant" near 0; any booming systems amber). Switching back to Political/Regions restores those fills; the price overlay can be toggled **on top** of prosperity mode (halos coexist with the fill). Zoom out — the choropleth reads as a regional heat map; zoom in — it fades under the glyphs like the other territory fills.

- [ ] **Step 9: Commit**

```bash
git add components/map/pixi/pixi-map-canvas.tsx components/map/star-map.tsx
git commit -m "feat(map): wire prosperity choropleth mode end-to-end"
```

---

## Part E — Docs + final verification

### Task 11: Update active docs and run the full suite

**Files:**
- Modify: `docs/active/gameplay/economy.md` (prosperity now has UI surfaces)
- Modify: `docs/active/gameplay/universe.md` (map gains a prosperity mode)
- Modify: `docs/SPEC.md` (Economy / Universe blurbs mention the surfaces)

- [ ] **Step 1: Economy doc**

In `docs/active/gameplay/economy.md`, under the "Prosperity System" section, add a short "UI surfaces" note: the per-system prosperity is shown as a label badge (+ "Production & Consumption ×N" effect descriptor) on the system Overview and Market screens, and as a cold→warm per-system choropleth map mode. Note the colour-language split (green/red = price deal-quality, cold/warm = prosperity).

- [ ] **Step 2: Universe/map doc**

In `docs/active/gameplay/universe.md`, where it lists the map-mode toggle (political/regions/none), add `prosperity` as a fourth mode (per-system Voronoi choropleth, cold→warm), and note the price overlay now has a buy/sell sub-toggle.

- [ ] **Step 3: SPEC.md**

Update the Universe & Map and Economy blurbs to mention the prosperity mode and the prosperity UI surfaces.

- [ ] **Step 4: Full verification**

Run: `npx vitest run` → Expected: all pass (incl. the 3 new test files).
Run: `npx tsc --noEmit` → Expected: clean.
Run: `npm run build` → Expected: succeeds.
Run: `npm run simulate` → Expected: completes (confirms the `PROSPERITY_PARAMS` extraction didn't change economy behaviour — equilibrium metrics unchanged vs baseline).

- [ ] **Step 5: Manual smoke (whole bundle)**

`npm run dev` and confirm in one pass: (a) Market Trend column sorts + correct colours; (b) comparison panel colours flip with buy/sell filter; (c) map price overlay buy/sell toggle flips the heatmap; (d) prosperity badge on Overview + Market; (e) prosperity map mode paints the choropleth and coexists with the price halo overlay.

- [ ] **Step 6: Commit**

```bash
git add docs/active/gameplay/economy.md docs/active/gameplay/universe.md docs/SPEC.md
git commit -m "docs: prosperity UI surfaces + price colour convention"
```

- [ ] **Step 7: Delete the build plans (feature shipped)**

Per the `docs/plans/` convention (delete on ship), once the PR is approved remove `docs/plans/prosperity-ui.md` and `docs/plans/prosperity-ui-implementation.md` — the functional spec now lives in `docs/active/`.

---

## Self-review notes (coverage map)

- **#85 (colour consistency):** Tasks 1 (helper), 2 (Trend recolour), 3 (comparison panel), 4 (map buy/sell). One mode-aware helper feeds all three surfaces. ✔
- **#87 (Trend sortable):** Task 2 (`sortable` + `getValue`). ✔
- **#86 / badge:** Tasks 6 (feed), 7 (badge + layout). Label-only + effect descriptor, both tabs via shared layout. ✔
- **Prosperity map mode:** Tasks 8 (enum/dock/legend), 9 (layer), 10 (wiring + feed). Per-system Voronoi choropleth, 4th MODE, coexists with price overlay. ✔
- **Colour-axis separation:** green/red reserved for price (Task 1), cold/warm for prosperity (Task 5). ✔

**Open flags carried into build (from design doc):** badge header crowding (tooltip/Overview fallback if needed); choropleth fill legibility + draw cost at 10K scale; prosperity mode shows fills only (region name labels omitted — acceptable for the strategic view, addable later).
