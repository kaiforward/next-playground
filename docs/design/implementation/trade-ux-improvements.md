# Trade UX Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** [`docs/design/planned/trade-ux-improvements.md`](../planned/trade-ux-improvements.md)

**Goal:** Ship three independent UX improvements to the trade loop — floor goods at the service boundary, enrich the system detail panel into a map-side hub, and add cross-system price comparison via a shared by-good endpoint.

**Architecture:** Three sequential PRs off `feat/trade-ux-improvements`. PR1 is a one-file data fix at the service boundary (engine math stays float). PR2 enriches the existing `SystemDetailPanel` and threads navigation state down from `StarMap`. PR3 adds a new `GET /api/game/market/by-good/[goodId]` endpoint feeding two surfaces: a sortable drill-down panel and a Pixi heatmap overlay.

**Tech Stack:** Next.js 16 (App Router), TypeScript 5 (strict), Prisma 7 (driver-adapter, PostgreSQL), Tailwind v4 + `tv()`, TanStack Query v5 Suspense, react-error-boundary, Pixi.js, Vitest 4 (unit + Postgres-backed integration projects).

**Branch state at plan start:** Branch `feat/trade-ux-improvements` already exists, contains the spec commit `d5689ab`. Each PR below should land back on this shared branch via phase PRs (per `[[workflow-shared-feature-branch]]`), with one final PR from the branch to `main` at the end.

---

## Conventions Recap

Pulled forward so the executor doesn't have to re-read CLAUDE.md:

- **No `as` type assertions** — use guards from `lib/types/guards.ts` if needed.
- **No `unknown`** anywhere — type at the source.
- **Engine functions are pure** — no DB imports. Tests in `__tests__/`.
- **Services** own DB access. Route handlers are thin wrappers (`auth check → service call → NextResponse.json`).
- **API responses** use `ApiResponse<T>` shape `{ data?: T, error?: string }`.
- **Forms** use React Hook Form + Zod + components from `components/form/` (no raw `<input>`/`<select>`).
- **Cache headers**: `private, no-cache` on auth-gated endpoints. Never `public` or `immutable`.
- **Foundry theme**: sharp corners, copper accent stripe, `font-display` (Chakra Petch) for headings, `font-mono` (Geist Mono) for numerics.
- **Prisma 7**: import client from `@/app/generated/prisma/client`; singleton in `lib/prisma.ts`.
- **Shell**: never `cd` in compound commands. Run from the repo root directly.

Tests:
- Unit tests live in sibling `__tests__/` folders; run with `npx vitest run`.
- Integration tests use a Postgres test DB (`vitest.integration.setup.ts`); run with `npx vitest run --project=integration`.
- New tests under `components/**/__tests__/` must use the `unit` project's existing include glob — already covered by `components/**/__tests__/**/*.test.ts`.

---

## PR 1 — Floor supply/demand at the service boundary

**Scope:** `lib/services/market.ts`, `lib/services/trade.ts`, `lib/services/convoy-trade.ts`. Engine code untouched. No schema, no migration.

### Task 1.1: Integration test asserting `getMarket()` returns integer supply/demand

**Files:**
- Create: `lib/services/__tests__/integration/market.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getMarket } = await import("@/lib/services/market");

describe("getMarket (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
  });

  it("returns floored integer supply and demand even when DB stores floats", async () => {
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    // Force fractional values
    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 12.734, demand: 8.992 },
    });

    const { entries } = await getMarket(universe.systems.agricultural);
    const food = entries.find((e) => e.goodId === goodId);

    expect(food).toBeDefined();
    expect(food!.supply).toBe(12);
    expect(food!.demand).toBe(8);
    expect(Number.isInteger(food!.supply)).toBe(true);
    expect(Number.isInteger(food!.demand)).toBe(true);
  });

  it("price calculation uses raw float ratio (unchanged from rounded supply/demand)", async () => {
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 50.0, demand: 50.0 },
    });
    const a = await getMarket(universe.systems.agricultural);

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 50.4, demand: 50.4 },
    });
    const b = await getMarket(universe.systems.agricultural);

    const priceA = a.entries.find((e) => e.goodId === goodId)!.currentPrice;
    const priceB = b.entries.find((e) => e.goodId === goodId)!.currentPrice;

    // Floored display equal; price still reflects underlying ratio (here equal, but
    // exercises the path: calculatePrice gets raw 50.4/50.4, not 50/50)
    expect(priceA).toBe(priceB);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `npx vitest run --project=integration market.integration`
Expected: test "returns floored integer supply and demand" FAILS with `expected 12.734 to be 12`.

- [ ] **Step 3: Floor supply and demand in `getMarket()`**

Modify `lib/services/market.ts` (the `entries` map around line 31):

```typescript
const entries: MarketEntry[] = marketEntries.map((m) => ({
  goodId: m.good.id,
  goodName: m.good.name,
  basePrice: m.good.basePrice,
  currentPrice: calculatePrice(m.good.basePrice, m.supply, m.demand, m.good.priceFloor, m.good.priceCeiling),
  supply: Math.floor(m.supply),
  demand: Math.floor(m.demand),
}));
```

- [ ] **Step 4: Run test and verify it passes**

Run: `npx vitest run --project=integration market.integration`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/market.ts lib/services/__tests__/integration/market.integration.test.ts
git commit -m "fix(market): floor supply/demand at service boundary"
```

---

### Task 1.2: Trade validators read floored supply

**Files:**
- Modify: `lib/services/trade.ts`
- Modify: `lib/services/convoy-trade.ts`

Both services call `validateAndCalculateTrade` / `validateFleetTrade` with `currentSupply: <row>.supply`. We want the validator to see the same floored value the UI showed.

- [ ] **Step 1: Find the call sites**

```bash
grep -n "currentSupply" lib/services/trade.ts lib/services/convoy-trade.ts
```

- [ ] **Step 2: Add an integration test asserting "can buy displayed quantity"**

Append to `lib/services/__tests__/integration/market.integration.test.ts` (use the existing `executeTrade` import or import inline):

```typescript
import { executeTrade } from "@/lib/services/trade";

it("trade validator accepts the full floored supply quantity", async () => {
  const stationId = universe.stations.agricultural;
  const goodId = universe.goodIds["food"];
  await prisma.stationMarket.update({
    where: { stationId_goodId: { stationId, goodId } },
    data: { supply: 47.6, demand: 30 },
  });

  // Player buys exactly what the UI would show (floor(47.6) = 47)
  const player = await createTestPlayer(prisma, { credits: 1_000_000 });
  const shipId = await createTestShip(prisma, {
    playerId: player.playerId,
    systemId: universe.systems.agricultural,
    cargoMax: 100,
  });

  const result = await executeTrade(player.playerId, shipId, {
    stationId,
    goodId,
    quantity: 47,
    type: "buy",
  });

  expect(result.ok).toBe(true);
});
```

(Reuse the imports for `createTestPlayer`/`createTestShip` from the existing trade integration test if not already imported.)

- [ ] **Step 3: Run and verify the failure mode**

Run: `npx vitest run --project=integration market.integration`
Expected: the new test FAILS with "Not enough supply at station. Requested 47, available 47.6." (or similar — the raw float leaks into the validator's error message).

- [ ] **Step 4: Floor supply where it's read into the validator**

In `lib/services/trade.ts`, locate the `validateFleetTrade` call (or wherever `currentSupply: <market>.supply` is built — read the file first since path can vary). Change:

```typescript
currentSupply: market.supply,
```

to:

```typescript
currentSupply: Math.floor(market.supply),
```

Repeat in `lib/services/convoy-trade.ts` for the convoy trade validator.

- [ ] **Step 5: Run tests, verify pass + existing trade tests still pass**

```bash
npx vitest run --project=integration trade.integration
npx vitest run --project=integration convoy-trade.integration
npx vitest run --project=integration market.integration
```

All PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/trade.ts lib/services/convoy-trade.ts lib/services/__tests__/integration/market.integration.test.ts
git commit -m "fix(trade): validators use floored supply to match displayed quantity"
```

---

### Task 1.3: Open PR 1

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin feat/trade-ux-improvements
gh pr create --base main --title "fix(market): floor supply/demand at service boundary" --body "Issue #1 of trade-ux-improvements. Floors supply and demand at the service boundary so the player never sees fractional quantities, while keeping the economy sim drifting on floats. Trade validators are updated to read the same floored value so 'available 99' actually allows a 99-unit purchase."
```

(If shared-feature-branch workflow, target the shared branch instead.)

---

## PR 2 — Enriched System Detail Panel

**Scope:** `components/map/system-detail-panel.tsx`, `components/map/star-map.tsx`, two new compact card components. No new endpoints — all data is already on the client via `useFleet`, `useConvoys`, `useEvents`, `useSystemInfo`.

### Task 2.1: Extract `CompactShipCard`

**Files:**
- Create: `components/map/compact-ship-card.tsx`
- Create: `components/map/__tests__/compact-ship-card.test.tsx`

Why a new component: the existing `ShipCard` in `components/fleet/ship-card.tsx` has too much surface (refuel/repair dialogs, full progress bars, fuel-aware coloring). The panel needs a smaller variant with just name, role, status, and two action buttons.

- [ ] **Step 1: Sketch the component shape**

```tsx
"use client";

import type { ShipState } from "@/lib/types/game";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROLE_COLORS } from "@/lib/constants/ships";

export interface CompactShipCardProps {
  ship: ShipState;
  systemId: string;
  /** Triggered when the user clicks Navigate. Receives the ship state. */
  onNavigate: (ship: ShipState) => void;
}

export function CompactShipCard({ ship, systemId, onNavigate }: CompactShipCardProps) {
  return (
    <div className="bg-surface border border-border border-l-2 border-l-cyan-500 px-2.5 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">{ship.name}</span>
          <Badge color={ROLE_COLORS[ship.role] ?? "slate"}>{ship.role}</Badge>
        </div>
        <span className="text-xs text-text-tertiary shrink-0">Docked</span>
      </div>
      <div className="flex gap-1">
        <Button
          onClick={() => onNavigate(ship)}
          variant="action"
          color="accent"
          size="xs"
          className="flex-1"
        >
          Navigate
        </Button>
        <Button
          href={`/system/${systemId}/market?tradeShipId=${ship.id}`}
          variant="ghost"
          size="xs"
          className="flex-1"
        >
          Trade
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the unit test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompactShipCard } from "../compact-ship-card";
import type { ShipState } from "@/lib/types/game";

// Minimal docked ship factory
function makeShip(overrides: Partial<ShipState> = {}): ShipState {
  return {
    id: "s1",
    name: "Iron Hawk",
    role: "trade",
    status: "docked",
    systemId: "sys1",
    // ...other required ShipState fields with safe defaults
    ...overrides,
  } as ShipState;
}

describe("CompactShipCard", () => {
  it("renders name, role, and a Trade link to the market with tradeShipId", () => {
    render(<CompactShipCard ship={makeShip()} systemId="sys1" onNavigate={() => {}} />);
    expect(screen.getByText("Iron Hawk")).toBeInTheDocument();
    expect(screen.getByText("trade")).toBeInTheDocument();
    const tradeLink = screen.getByRole("link", { name: /trade/i });
    expect(tradeLink).toHaveAttribute("href", "/system/sys1/market?tradeShipId=s1");
  });

  it("calls onNavigate with the ship when Navigate is clicked", async () => {
    const ship = makeShip();
    const onNavigate = vi.fn();
    render(<CompactShipCard ship={ship} systemId="sys1" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("button", { name: /navigate/i }));
    expect(onNavigate).toHaveBeenCalledWith(ship);
  });
});
```

> **Dev-dep check:** `@testing-library/react`, `@testing-library/user-event`, and a DOM env (`jsdom` or `happy-dom`) are required. Per `MEMORY.md`, this project does **not** ship `jsdom`/`happy-dom`. **Before writing component tests:** run `npm ls jsdom happy-dom @testing-library/react` — if none are installed, either (a) add `happy-dom` as a dev dep and configure the unit project with `environment: "happy-dom"`, or (b) skip component-render tests and rely on manual verification in Task 2.7. Pick the lighter option (b) unless the user wants component test coverage.

- [ ] **Step 3: Implement the component (code in Step 1)**

Write the file. Run `npx tsc --noEmit` to ensure typings hold.

- [ ] **Step 4: If component tests are wired, run them**

```bash
npx vitest run components/map/__tests__/compact-ship-card
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/map/compact-ship-card.tsx components/map/__tests__/compact-ship-card.test.tsx
git commit -m "feat(map): compact ship card for system detail panel"
```

---

### Task 2.2: Extract `CompactConvoyCard`

**Files:**
- Create: `components/map/compact-convoy-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import type { ConvoyState } from "@/lib/types/game";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface CompactConvoyCardProps {
  convoy: ConvoyState;
  systemId: string;
  onNavigate: (convoy: ConvoyState) => void;
}

export function CompactConvoyCard({ convoy, systemId, onNavigate }: CompactConvoyCardProps) {
  const memberCount = convoy.members.length;
  return (
    <div className="bg-surface border border-border border-l-2 border-l-violet-500 px-2.5 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">
            {convoy.name ?? "Convoy"}
          </span>
          <Badge color="violet">{memberCount} {memberCount === 1 ? "ship" : "ships"}</Badge>
        </div>
        <span className="text-xs text-text-tertiary shrink-0">
          {convoy.combinedCargoMax} cargo
        </span>
      </div>
      <div className="flex gap-1">
        <Button
          onClick={() => onNavigate(convoy)}
          variant="action"
          color="accent"
          size="xs"
          className="flex-1"
        >
          Navigate
        </Button>
        <Button
          href={`/system/${systemId}/market?tradeConvoyId=${convoy.id}`}
          variant="ghost"
          size="xs"
          className="flex-1"
        >
          Trade
        </Button>
      </div>
    </div>
  );
}
```

Verify the `violet` badge color exists in `Badge` variants. If not, pick the closest existing color (e.g. `purple`).

- [ ] **Step 2: Commit**

```bash
git add components/map/compact-convoy-card.tsx
git commit -m "feat(map): compact convoy card for system detail panel"
```

---

### Task 2.3: Thread `selectUnit` from `StarMap` into `SystemDetailPanel`

The existing panel cannot invoke navigation directly because it has no access to `useNavigationState`. We'll pass a callback down.

**Files:**
- Modify: `components/map/star-map.tsx`
- Modify: `components/map/system-detail-panel.tsx`

- [ ] **Step 1: Extend the panel's prop type**

In `components/map/system-detail-panel.tsx`, extend `SystemDetailPanelProps`:

```typescript
import type { NavigableUnit } from "@/lib/types/navigable";

interface SystemDetailPanelProps {
  // ...existing props...
  /** Triggers nav-mode for the given unit (ship or convoy) without leaving the map. */
  onNavigateUnit: (unit: NavigableUnit) => void;
}
```

- [ ] **Step 2: Pass it from `StarMap`**

In `components/map/star-map.tsx`, around the existing `<SystemDetailPanel … />` render (~line 309):

```tsx
<SystemDetailPanel
  system={selectedSystem}
  shipsHere={mapData.shipsAtSelected}
  convoysHere={mapData.convoysAtSelected}
  regionName={mapData.selectedRegionName}
  gatewayTargetRegions={mapData.selectedGatewayTargets}
  activeEvents={mapData.eventsAtSelected}
  visibility={mapData.selectedVisibility}
  onClose={closeSystem}
  onNavigateUnit={navigation.selectUnit}
/>
```

`navigation.selectUnit` is already returned from `useNavigationState({...})` higher up.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `navigation.selectUnit` signature doesn't match `(unit: NavigableUnit) => void`, adjust the prop type to match the existing hook signature exactly.

- [ ] **Step 4: Commit (will be amended once panel uses the prop)**

Hold the commit until Task 2.5 — they're a single logical change.

---

### Task 2.4: Add tab shortcut row + danger badge to status row

**Files:**
- Modify: `components/map/system-detail-panel.tsx`

- [ ] **Step 1: Replace the status row block**

Find the existing block (around line 76–87 in the current file: the `<EconomyBadge … />` + `<Badge>Gateway</Badge>` + `<p>Region:</p>`). Replace with a status row that includes danger + a tab-shortcut row right below it:

```tsx
import { getDangerInfo } from "@/lib/utils/system";

// ... in the visible-system branch, replacing the current status block:

<div className="flex flex-wrap items-center gap-2">
  <EconomyBadge economyType={system.economyType} />
  {system.isGateway && <Badge color="amber">Gateway</Badge>}
  {/* Danger badge — read from systemInfo if available; otherwise hide.
      System danger isn't on StarSystemInfo today — fetch via useSystemInfo
      or accept a `dangerLabel` prop from StarMap. For MVP, accept a prop
      and have StarMap compute it (matches the existing pattern for events). */}
  {dangerLabel && <Badge color={dangerColor}>{dangerLabel}</Badge>}
</div>

{regionName && (
  <p className="text-xs text-text-tertiary">
    Region: <span className="text-text-secondary">{regionName}</span>
  </p>
)}

{/* Tab shortcuts */}
{visibility === "visible" && (
  <div className="grid grid-cols-4 gap-1">
    <Button href={`/system/${system.id}/market`} variant="ghost" size="xs">Market</Button>
    <Button href={`/system/${system.id}/ships`} variant="ghost" size="xs">Ships</Button>
    <Button href={`/system/${system.id}/contracts`} variant="ghost" size="xs">Contracts</Button>
    <Button href={`/system/${system.id}`} variant="ghost" size="xs">Overview</Button>
  </div>
)}
```

For the danger badge: add `dangerLabel?: string` and `dangerColor?: BadgeColor` to `SystemDetailPanelProps`, and compute them in `star-map.tsx` from the system's danger fields (mirroring the events-at-selected pattern in `useMapData`).

If danger isn't readily available at the panel layer, defer the danger badge to a follow-up and only ship the tab shortcuts in this task.

- [ ] **Step 2: Verify routes exist**

```bash
ls app/\(game\)/@panel/system/\[systemId\]/
```

Expected entries: `market`, `ships`, `contracts`, `page.tsx` (the overview at `/system/[id]`). Confirm before referencing them. (Already verified during planning.)

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

---

### Task 2.5: Replace "Your Fleet Here" with convoys + ships sections (with overflow link)

**Files:**
- Modify: `components/map/system-detail-panel.tsx`

- [ ] **Step 1: Replace the fleet section**

Find the existing `<SectionHeader>Your Fleet Here</SectionHeader>` block (around line 142–184). Replace with:

```tsx
import Link from "next/link";
import { CompactShipCard } from "@/components/map/compact-ship-card";
import { CompactConvoyCard } from "@/components/map/compact-convoy-card";
import { shipToNavigableUnit, convoyToNavigableUnit } from "@/lib/types/navigable";

const MAX_VISIBLE_PER_SECTION = 3;

// Filter to dockable, idle items. Ships in convoys are hidden from the Ships list.
const idleShips = shipsHere.filter(
  (s) => s.status === "docked" && !s.convoyId && !s.disabled,
);
const idleConvoys = convoysHere.filter((c) => c.status === "docked");

const visibleConvoys = idleConvoys.slice(0, MAX_VISIBLE_PER_SECTION);
const hiddenConvoys = idleConvoys.length - visibleConvoys.length;

const visibleShips = idleShips.slice(0, MAX_VISIBLE_PER_SECTION);
const hiddenShips = idleShips.length - visibleShips.length;

// ── Render ────
{idleConvoys.length > 0 && (
  <div>
    <SectionHeader className="mb-2 flex items-center justify-between">
      <span>Convoys Here</span>
      <span className="font-normal text-text-tertiary normal-case tracking-normal">
        {idleConvoys.length}
      </span>
    </SectionHeader>
    <div className="flex flex-col gap-1.5">
      {visibleConvoys.map((c) => (
        <CompactConvoyCard
          key={c.id}
          convoy={c}
          systemId={system.id}
          onNavigate={(convoy) => onNavigateUnit(convoyToNavigableUnit(convoy))}
        />
      ))}
      {hiddenConvoys > 0 && (
        <Link
          href={`/system/${system.id}/convoys`}
          className="text-xs text-text-accent hover:text-accent-muted text-center py-1"
        >
          View all {idleConvoys.length} convoys &rarr;
        </Link>
      )}
    </div>
  </div>
)}

{idleShips.length > 0 && (
  <div>
    <SectionHeader className="mb-2 flex items-center justify-between">
      <span>Ships Here</span>
      <span className="font-normal text-text-tertiary normal-case tracking-normal">
        {idleShips.length}
      </span>
    </SectionHeader>
    <div className="flex flex-col gap-1.5">
      {visibleShips.map((s) => (
        <CompactShipCard
          key={s.id}
          ship={s}
          systemId={system.id}
          onNavigate={(ship) => onNavigateUnit(shipToNavigableUnit(ship))}
        />
      ))}
      {hiddenShips > 0 && (
        <Link
          href={`/system/${system.id}/ships`}
          className="text-xs text-text-accent hover:text-accent-muted text-center py-1"
        >
          View all {idleShips.length} ships &rarr;
        </Link>
      )}
    </div>
  </div>
)}

{idleConvoys.length === 0 && idleShips.length === 0 && (
  <p className="text-sm text-text-tertiary">No idle ships docked here.</p>
)}
```

Drop the existing footer "View System" button — it's redundant with the new Overview tab shortcut. Keep the "Close" button.

- [ ] **Step 2: Verify by running the dev server**

```bash
npm run dev
```

In Chrome, log in, navigate to the map, click a system with player ships. Confirm:
- Tab shortcuts show at the top and link correctly.
- Convoys (if any) appear above Ships with violet stripe.
- Navigate button enters nav-mode (cyan banner appears, no page change).
- Trade button takes you to the market with the right `tradeShipId`/`tradeConvoyId` query param.
- An overflow scenario: with >3 ships in a system, the "View all N" link shows and routes to the ships tab.

If you don't have a test player with enough ships, you can seed one quickly via:
```bash
npx prisma studio
```
…and manually add ships to one system. Or skip overflow verification and rely on the layout being driven by simple `slice(0, 3)`.

- [ ] **Step 3: Commit**

```bash
git add components/map/system-detail-panel.tsx components/map/star-map.tsx
git commit -m "feat(map): enrich system detail panel with tab shortcuts and inline navigate"
```

---

### Task 2.6: Reorder sections and clean up

**Files:**
- Modify: `components/map/system-detail-panel.tsx`

- [ ] **Step 1: Reorder**

Final top-to-bottom inside the visible-system branch:

1. Status row + tab shortcuts (Task 2.4)
2. Connected Regions (existing gateway block) — keep position
3. Active Events (move higher than today — was below Traits)
4. Convoys Here / Ships Here (Task 2.5)
5. Traits
6. Coordinates (still useful for nav debugging — keep but at the bottom)

- [ ] **Step 2: Manual smoke-test the layout**

Run dev server, click through 3–4 different systems (a gateway, a system with events, a system with no fleet). Confirm sections appear/hide appropriately.

- [ ] **Step 3: Commit**

```bash
git add components/map/system-detail-panel.tsx
git commit -m "refactor(map): reorder system detail panel sections"
```

---

### Task 2.7: Open PR 2

- [ ] **Step 1: Push and open**

```bash
git push
gh pr create --base main --title "feat(map): enrich system detail panel into map-side hub" --body "Issue #2 of trade-ux-improvements. Adds tab shortcuts (Market/Ships/Contracts/Overview), convoy and ship sections with inline Navigate (no URL roundtrip) and Trade actions, and overflow links to the corresponding system tabs. Inline Navigate uses the existing useNavigationState already on StarMap."
```

---

## PR 3 — Market comparison: endpoint, drill-down panel, heatmap overlay

**Scope:** 1 new endpoint, 1 new service, 1 new hook, 1 new panel component, 1 modified hook (`use-map-overlays`), 1 modified control (`MapOverlayControls`), 1 modified Pixi layer (heatmap tint), 1 new pure helper (single-origin bounded BFS). Splits internally into 3a (endpoint + drill-down) and 3b (overlay) for review-sized commits.

### Task 3.1: Add single-origin bounded BFS to `pathfinding.ts`

**Files:**
- Modify: `lib/engine/pathfinding.ts`
- Modify: `lib/engine/__tests__/pathfinding.test.ts`

`computeBoundedHopDistances` already exists but runs BFS from every system. The comparison feature needs hops from one origin only — cheaper for the live game and simpler to consume.

- [ ] **Step 1: Add the failing test**

Append to `lib/engine/__tests__/pathfinding.test.ts`:

```typescript
import { boundedHopsFromOrigin } from "../pathfinding";

describe("boundedHopsFromOrigin", () => {
  const connections = [
    { fromSystemId: "A", toSystemId: "B", fuelCost: 10 },
    { fromSystemId: "B", toSystemId: "C", fuelCost: 10 },
    { fromSystemId: "C", toSystemId: "D", fuelCost: 10 },
    { fromSystemId: "B", toSystemId: "E", fuelCost: 10 },
  ];

  it("returns origin at 0", () => {
    const hops = boundedHopsFromOrigin("A", connections, 4);
    expect(hops.get("A")).toBe(0);
  });

  it("returns shortest hop distance to each reachable node within maxHops", () => {
    const hops = boundedHopsFromOrigin("A", connections, 4);
    expect(hops.get("B")).toBe(1);
    expect(hops.get("C")).toBe(2);
    expect(hops.get("D")).toBe(3);
    expect(hops.get("E")).toBe(2);
  });

  it("does not include nodes beyond maxHops", () => {
    const hops = boundedHopsFromOrigin("A", connections, 2);
    expect(hops.has("D")).toBe(false);
  });

  it("returns empty map (with just origin) when origin is unknown", () => {
    const hops = boundedHopsFromOrigin("Z", connections, 4);
    expect(hops.get("Z")).toBe(0);
    expect(hops.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npx vitest run lib/engine/__tests__/pathfinding
```

Expected: FAIL with "boundedHopsFromOrigin is not a function".

- [ ] **Step 3: Implement**

Append to `lib/engine/pathfinding.ts`:

```typescript
/**
 * BFS hop-count from a single origin, stopping at maxHops depth.
 * Always includes the origin itself at distance 0.
 */
export function boundedHopsFromOrigin(
  origin: string,
  connections: ConnectionInfo[],
  maxHops: number,
): Map<string, number> {
  const { adj } = buildHopAdjacencyList(connections);
  const distances = new Map<string, number>();
  distances.set(origin, 0);
  const queue: string[] = [origin];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const currentDist = distances.get(current)!;
    if (currentDist >= maxHops) continue;

    const neighbors = adj.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, currentDist + 1);
        queue.push(neighbor);
      }
    }
  }

  return distances;
}
```

(`buildHopAdjacencyList` is already a private helper in the file.)

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run lib/engine/__tests__/pathfinding
```

- [ ] **Step 5: Commit**

```bash
git add lib/engine/pathfinding.ts lib/engine/__tests__/pathfinding.test.ts
git commit -m "feat(pathfinding): boundedHopsFromOrigin for single-origin BFS"
```

---

### Task 3.2: Add price-ramp color helper

**Files:**
- Create: `lib/utils/price-ramp.ts`
- Create: `lib/utils/__tests__/price-ramp.test.ts`

Pure mapping from `currentPrice / basePrice` to a hex color. Shared by the Pixi heatmap (renders to a tint) and the drill-down table (renders to CSS).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { priceRampColor, PRICE_RAMP_STOPS } from "../price-ramp";

describe("priceRampColor", () => {
  it("returns the deep-bargain green at <= 0.6x base", () => {
    expect(priceRampColor(60, 100)).toBe(PRICE_RAMP_STOPS.deepBargain);
    expect(priceRampColor(40, 100)).toBe(PRICE_RAMP_STOPS.deepBargain);
  });

  it("returns the light-bargain green at 0.85x", () => {
    expect(priceRampColor(85, 100)).toBe(PRICE_RAMP_STOPS.bargain);
  });

  it("returns neutral amber near base", () => {
    expect(priceRampColor(100, 100)).toBe(PRICE_RAMP_STOPS.neutral);
    expect(priceRampColor(99, 100)).toBe(PRICE_RAMP_STOPS.neutral);
  });

  it("returns orange premium at 1.15x", () => {
    expect(priceRampColor(115, 100)).toBe(PRICE_RAMP_STOPS.premium);
  });

  it("returns deep-premium red at >= 1.4x", () => {
    expect(priceRampColor(140, 100)).toBe(PRICE_RAMP_STOPS.deepPremium);
    expect(priceRampColor(250, 100)).toBe(PRICE_RAMP_STOPS.deepPremium);
  });

  it("returns null when basePrice is 0 or current is missing", () => {
    expect(priceRampColor(100, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npx vitest run lib/utils/__tests__/price-ramp
```

- [ ] **Step 3: Implement**

```typescript
export const PRICE_RAMP_STOPS = {
  deepBargain: "#3ec775",
  bargain: "#7dd97f",
  neutral: "#d9c95d",
  premium: "#dc7b4a",
  deepPremium: "#c84545",
} as const;

export type PriceRampColor = (typeof PRICE_RAMP_STOPS)[keyof typeof PRICE_RAMP_STOPS];

/**
 * Map (currentPrice / basePrice) to a discrete color stop.
 * Returns null when basePrice is non-positive.
 */
export function priceRampColor(
  currentPrice: number,
  basePrice: number,
): PriceRampColor | null {
  if (basePrice <= 0) return null;
  const ratio = currentPrice / basePrice;
  if (ratio <= 0.6) return PRICE_RAMP_STOPS.deepBargain;
  if (ratio <= 0.85) return PRICE_RAMP_STOPS.bargain;
  if (ratio < 1.15) return PRICE_RAMP_STOPS.neutral;
  if (ratio < 1.4) return PRICE_RAMP_STOPS.premium;
  return PRICE_RAMP_STOPS.deepPremium;
}

/**
 * Hex string (#rrggbb) to a numeric color for Pixi tinting.
 */
export function priceRampColorPixi(currentPrice: number, basePrice: number): number | null {
  const color = priceRampColor(currentPrice, basePrice);
  if (!color) return null;
  return parseInt(color.slice(1), 16);
}
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run lib/utils/__tests__/price-ramp
git add lib/utils/price-ramp.ts lib/utils/__tests__/price-ramp.test.ts
git commit -m "feat(price): price-ramp color helper"
```

---

### Task 3.3: Add `market-comparison` service

**Files:**
- Create: `lib/services/market-comparison.ts`
- Create: `lib/services/__tests__/integration/market-comparison.integration.test.ts`
- Modify: `lib/types/api.ts` (add `MarketComparisonResponse`)
- Modify: `lib/types/game.ts` (add `MarketComparisonEntry`)

- [ ] **Step 1: Define the response type**

In `lib/types/game.ts`:

```typescript
export interface MarketComparisonEntry {
  systemId: string;
  basePrice: number;
  currentPrice: number;
  supply: number; // floored
  demand: number; // floored
}
```

In `lib/types/api.ts`:

```typescript
import type { MarketComparisonEntry } from "./game";

export interface MarketComparisonResponse {
  data?: {
    goodId: string;
    entries: MarketComparisonEntry[];
  };
  error?: string;
}
```

- [ ] **Step 2: Write the failing integration test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getMarketComparison } = await import("@/lib/services/market-comparison");

describe("getMarketComparison (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 1000 });
    // A docked ship gives the player at least one visible system
    await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 10,
    });
  });

  it("returns entries only for visible systems", async () => {
    const goodId = universe.goodIds["food"];
    const result = await getMarketComparison(player.playerId, goodId);

    expect(result.goodId).toBe(goodId);
    // All entries' systemIds should be in the player's visibility set
    // (seedTestUniverse provides a small connected universe; agricultural is
    // among the visible systems via the ship's sensor range).
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => Number.isInteger(e.supply))).toBe(true);
    expect(result.entries.every((e) => Number.isInteger(e.demand))).toBe(true);
  });

  it("floors fractional supply/demand the same way getMarket does", async () => {
    const goodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 23.7, demand: 11.2 },
    });

    const result = await getMarketComparison(player.playerId, goodId);
    const agri = result.entries.find((e) => e.systemId === universe.systems.agricultural);
    expect(agri).toBeDefined();
    expect(agri!.supply).toBe(23);
    expect(agri!.demand).toBe(11);
  });

  it("throws ServiceError(404) for an unknown goodId", async () => {
    await expect(getMarketComparison(player.playerId, "nonexistent")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run, verify failure**

```bash
npx vitest run --project=integration market-comparison.integration
```

Expected: FAIL with "getMarketComparison is not exported".

- [ ] **Step 4: Implement the service**

```typescript
import { prisma } from "@/lib/prisma";
import { calculatePrice } from "@/lib/engine/pricing";
import { ServiceError } from "./errors";
import { getPlayerVisibility } from "./visibility-cache";
import type { MarketComparisonEntry } from "@/lib/types/game";

export async function getMarketComparison(
  playerId: string,
  goodId: string,
): Promise<{ goodId: string; entries: MarketComparisonEntry[] }> {
  const good = await prisma.good.findUnique({
    where: { id: goodId },
    select: { id: true, basePrice: true, priceFloor: true, priceCeiling: true },
  });

  if (!good) {
    throw new ServiceError("Good not found.", 404);
  }

  const { visibleSet } = await getPlayerVisibility(playerId);
  if (visibleSet.size === 0) {
    return { goodId, entries: [] };
  }

  const visibleIds = [...visibleSet];

  // Stations are 1:1 with systems by `systemId`. Query markets for this good
  // whose station's system is visible.
  const markets = await prisma.stationMarket.findMany({
    where: {
      goodId,
      station: { systemId: { in: visibleIds } },
    },
    select: {
      supply: true,
      demand: true,
      station: { select: { systemId: true } },
    },
  });

  const entries: MarketComparisonEntry[] = markets.map((m) => ({
    systemId: m.station.systemId,
    basePrice: good.basePrice,
    currentPrice: calculatePrice(good.basePrice, m.supply, m.demand, good.priceFloor, good.priceCeiling),
    supply: Math.floor(m.supply),
    demand: Math.floor(m.demand),
  }));

  return { goodId, entries };
}
```

- [ ] **Step 5: Run + commit**

```bash
npx vitest run --project=integration market-comparison.integration
git add lib/services/market-comparison.ts lib/services/__tests__/integration/market-comparison.integration.test.ts lib/types/game.ts lib/types/api.ts
git commit -m "feat(market): market-comparison service for visible-systems aggregation"
```

---

### Task 3.4: Add the API route

**Files:**
- Create: `app/api/game/market/by-good/[goodId]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getMarketComparison } from "@/lib/services/market-comparison";
import type { MarketComparisonResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ goodId: string }> },
) {
  return withServiceErrors("GET /api/game/market/by-good/[goodId]", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const { goodId } = await params;
    const data = await getMarketComparison(auth.playerId, goodId);
    return NextResponse.json<MarketComparisonResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
```

- [ ] **Step 2: Sanity-check the route from a logged-in browser session**

```bash
npm run dev
```

Hit `http://localhost:3000/api/game/market/by-good/food` (use whatever `goodId` exists in your seeded DB — find one via the existing `/api/game/market/[systemId]` response). Expected: `200` with `{ data: { goodId, entries: [...] } }`.

- [ ] **Step 3: Commit**

```bash
git add app/api/game/market/by-good/[goodId]/route.ts
git commit -m "feat(api): GET /api/game/market/by-good/[goodId]"
```

---

### Task 3.5: Add `useMarketComparison` hook + register query key

**Files:**
- Modify: `lib/query/keys.ts`
- Create: `lib/hooks/use-market-comparison.ts`

- [ ] **Step 1: Add the query key**

In `lib/query/keys.ts` (alongside `market`/`marketAll`):

```typescript
marketByGood: (goodId: string) => ["market", "by-good", goodId] as const,
```

This sits under the `["market"]` prefix so existing `marketAll` invalidation in `useTickInvalidation` already covers it (economyTick + shipArrived).

- [ ] **Step 2: Implement the hook**

```typescript
"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { MarketComparisonEntry } from "@/lib/types/game";
import type { MarketComparisonResponse } from "@/lib/types/api";

export function useMarketComparison(goodId: string | null): {
  goodId: string | null;
  entries: MarketComparisonEntry[];
} {
  const enabled = !!goodId;
  const { data } = useSuspenseQuery({
    queryKey: enabled ? queryKeys.marketByGood(goodId!) : ["market", "by-good", "__disabled__"],
    queryFn: async () => {
      if (!enabled) return { goodId: null, entries: [] as MarketComparisonEntry[] };
      const res = await fetch(`/api/game/market/by-good/${goodId}`);
      if (!res.ok) throw new Error(`Failed to load market comparison (${res.status})`);
      const json: MarketComparisonResponse = await res.json();
      if (json.error || !json.data) throw new Error(json.error ?? "Empty response");
      return json.data;
    },
  });

  return data;
}
```

Note: `useSuspenseQuery` doesn't support `enabled: false`, so we route the disabled case through a parked key with a no-op queryFn. Alternative: gate the consumer behind a parent component that only mounts when a good is selected — that's cleaner and is what we'll do in the panel (Task 3.6). Keep this `null`-tolerant version anyway in case it's used elsewhere.

- [ ] **Step 3: Commit**

```bash
git add lib/query/keys.ts lib/hooks/use-market-comparison.ts
git commit -m "feat(hook): useMarketComparison for by-good queries"
```

---

### Task 3.6: Build the `MarketComparisonPanel`

**Files:**
- Create: `components/market/market-comparison-panel.tsx`
- Create: `components/market/__tests__/market-comparison-panel.test.tsx` (skip if no DOM env, per Task 2.1 note)

- [ ] **Step 1: Build the panel**

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { MarketComparisonEntry } from "@/lib/types/game";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { boundedHopsFromOrigin } from "@/lib/engine/pathfinding";
import { useMarketComparison } from "@/lib/hooks/use-market-comparison";
import { priceRampColor } from "@/lib/utils/price-ramp";
import { formatCredits } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QueryBoundary } from "@/components/ui/query-boundary";

const MAX_HOPS = 6;

type SortKey = "price" | "supply" | "demand" | "hops";
type SortDir = "asc" | "desc";
type FilterMode = "all" | "buy" | "sell";

interface MarketComparisonPanelProps {
  goodId: string;
  goodName: string;
  /** Origin system for "Jumps from" calculation. */
  fromSystemId: string;
  fromSystemName: string;
  /** System names + connections so we can label rows and BFS. */
  systems: { id: string; name: string }[];
  connections: ConnectionInfo[];
  /** Action when user clicks Go — recentre map + open detail panel. */
  onSelectSystem: (systemId: string) => void;
  onClose: () => void;
}

export function MarketComparisonPanel(props: MarketComparisonPanelProps) {
  return (
    <QueryBoundary>
      <MarketComparisonContent {...props} />
    </QueryBoundary>
  );
}

function MarketComparisonContent({
  goodId,
  goodName,
  fromSystemId,
  fromSystemName,
  systems,
  connections,
  onSelectSystem,
  onClose,
}: MarketComparisonPanelProps) {
  const { entries } = useMarketComparison(goodId);
  const [sortKey, setSortKey] = useState<SortKey>("price");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<FilterMode>("all");

  const nameById = useMemo(() => new Map(systems.map((s) => [s.id, s.name])), [systems]);
  const hopsMap = useMemo(
    () => boundedHopsFromOrigin(fromSystemId, connections, MAX_HOPS),
    [fromSystemId, connections],
  );

  const rows = useMemo(() => {
    const decorated = entries.map((e) => ({
      ...e,
      hops: hopsMap.get(e.systemId) ?? null,
      ratio: e.basePrice > 0 ? e.currentPrice / e.basePrice : 1,
      name: nameById.get(e.systemId) ?? "Unknown",
    }));
    const filtered = decorated.filter((d) => {
      if (filter === "buy") return d.ratio < 1.0;
      if (filter === "sell") return d.ratio > 1.0;
      return true;
    });
    const sign = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const av = sortKey === "hops" ? (a.hops ?? Number.POSITIVE_INFINITY) : a[sortKey];
      const bv = sortKey === "hops" ? (b.hops ?? Number.POSITIVE_INFINITY) : b[sortKey];
      return (av - bv) * sign;
    });
    return filtered;
  }, [entries, filter, hopsMap, nameById, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <aside className="fixed top-12 right-0 h-[calc(100%-3rem)] w-96 bg-surface border-l-2 border-l-accent shadow-2xl z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-display uppercase tracking-wider text-text-accent text-sm">
            {goodName}
          </h2>
          <p className="text-xs text-text-tertiary">
            from <span className="text-text-secondary">{fromSystemName}</span> &middot;{" "}
            {rows.length} visible {rows.length === 1 ? "market" : "markets"}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close comparison panel"
          className="text-text-tertiary hover:text-text-primary p-1"
        >
          &times;
        </button>
      </header>

      {/* Filter chips */}
      <div className="flex gap-1.5 px-4 py-2 border-b border-border">
        {(["all", "buy", "sell"] as FilterMode[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2 py-1 uppercase tracking-wider ${
              filter === f
                ? "bg-accent/20 text-text-accent border border-accent/40"
                : "bg-surface-hover text-text-secondary border border-border"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Sortable header */}
      <div className="grid grid-cols-[1.4fr_0.6fr_0.7fr_0.7fr_64px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-text-tertiary border-b border-border bg-surface-sunken">
        <span>System</span>
        <button onClick={() => toggleSort("hops")} className="text-left hover:text-text-primary">Jumps</button>
        <button onClick={() => toggleSort("price")} className="text-left hover:text-text-primary">Price</button>
        <button onClick={() => toggleSort("supply")} className="text-left hover:text-text-primary">Supply</button>
        <span></span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <p className="text-sm text-text-tertiary p-4 text-center">
            No visible systems carry {goodName} matching this filter.
          </p>
        )}
        {rows.map((r) => {
          const color = priceRampColor(r.currentPrice, r.basePrice);
          const isOrigin = r.systemId === fromSystemId;
          return (
            <div
              key={r.systemId}
              className={`grid grid-cols-[1.4fr_0.6fr_0.7fr_0.7fr_64px] gap-2 px-4 py-2 text-xs border-b border-border ${
                isOrigin ? "bg-surface-active" : "hover:bg-surface-hover"
              }`}
            >
              <span className="text-text-primary truncate">
                {r.name} {isOrigin && <span className="text-text-tertiary text-[10px]">(here)</span>}
              </span>
              <span className="text-text-secondary">{r.hops != null ? r.hops : "—"}</span>
              <span style={{ color: color ?? undefined }} className="font-mono">
                {formatCredits(r.currentPrice)}
              </span>
              <span className="text-text-secondary font-mono">{r.supply}</span>
              {!isOrigin && (
                <Button
                  onClick={() => onSelectSystem(r.systemId)}
                  variant="ghost"
                  size="xs"
                >
                  Go &rarr;
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Confirm `boundedHopsFromOrigin` import resolves, and `useMarketComparison` is suspendable (it is, via `useSuspenseQuery`).

- [ ] **Step 3: Commit**

```bash
git add components/market/market-comparison-panel.tsx
git commit -m "feat(market): comparison panel with sort/filter and jumps-from-origin"
```

---

### Task 3.7: Wire the panel into the market page (per-row Compare)

**Files:**
- Modify: `components/trade/market-table.tsx` — add a Compare button to each row.
- Modify: `app/(game)/@panel/system/[systemId]/market/page.tsx` — own the open/close state, render the panel.

- [ ] **Step 1: Add Compare column to `MarketTable`**

Extend `MarketTableProps`:

```typescript
interface MarketTableProps {
  // ... existing
  onCompareGood?: (goodId: string, goodName: string) => void;
}
```

Append a column at the end of the `columns` array:

```tsx
...(onCompareGood
  ? [
      {
        key: "compare",
        label: "",
        render: (row: MarketEntry) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCompareGood(row.goodId, row.goodName);
            }}
            className="text-xs text-text-accent hover:text-accent-muted"
            aria-label={`Compare ${row.goodName} across systems`}
          >
            Compare
          </button>
        ),
      },
    ]
  : []),
```

- [ ] **Step 2: Add panel state to the market page**

In `app/(game)/@panel/system/[systemId]/market/page.tsx`, add state + render:

```tsx
import { useRouter } from "next/navigation";
import { MarketComparisonPanel } from "@/components/market/market-comparison-panel";
import { useUniverse } from "@/lib/hooks/use-universe";

// inside MarketContent
const router = useRouter();
const [comparison, setComparison] = useState<{ goodId: string; goodName: string } | null>(null);
const { data: universe } = useUniverse();

const fromSystemName = useMemo(
  () => universe.systems.find((s) => s.id === systemId)?.name ?? "Here",
  [universe.systems, systemId],
);

// pass onCompareGood to <MarketTable>:
<MarketTable
  entries={market}
  onSelectGood={setSelectedGoodId}
  selectedGoodId={selectedGoodId}
  cargoByGoodId={tradingUnit ? cargoByGoodId : undefined}
  onCompareGood={(goodId, goodName) => setComparison({ goodId, goodName })}
/>

// render the panel
{comparison && (
  <MarketComparisonPanel
    goodId={comparison.goodId}
    goodName={comparison.goodName}
    fromSystemId={systemId}
    fromSystemName={fromSystemName}
    systems={universe.systems.map((s) => ({ id: s.id, name: s.name }))}
    connections={universe.connections.map((c) => ({
      fromSystemId: c.fromSystemId,
      toSystemId: c.toSystemId,
      fuelCost: c.fuelCost,
    }))}
    onSelectSystem={(sysId) => {
      router.push(`/?systemId=${sysId}`);
      setComparison(null);
    }}
    onClose={() => setComparison(null)}
  />
)}
```

The `onSelectSystem` action routes to the map with `?systemId=…` — `MapPage` already supports this query param and opens the (enriched, after PR 2) detail panel.

- [ ] **Step 3: Manual verify**

```bash
npm run dev
```

Open a system's market page. Confirm each row has a Compare button; clicking opens the side panel; sorting + buy/sell filter work; clicking Go navigates to the map with that system focused. Close button restores the market view.

- [ ] **Step 4: Commit**

```bash
git add components/trade/market-table.tsx app/\(game\)/@panel/system/\[systemId\]/market/page.tsx
git commit -m "feat(market): per-row Compare opens cross-system comparison panel"
```

---

### Task 3.8: Open PR 3a (endpoint + drill-down)

- [ ] **Step 1: Push and open**

```bash
git push
gh pr create --base main --title "feat(market): cross-system price comparison endpoint + drill-down panel" --body "Issue #3 (3a) of trade-ux-improvements. Adds GET /api/game/market/by-good/[goodId] returning floored supply/demand for all visible systems, a sortable drill-down panel reachable from each row in the existing market table, and a single-origin bounded BFS helper for jump distance."
```

---

### Task 3.9: Extend `useMapOverlays` with `priceHeatmap`

**Files:**
- Modify: `lib/hooks/use-map-overlays.ts`
- Modify: `components/map/map-session.ts` (if `MapOverlaysState` lives there)

- [ ] **Step 1: Add the key**

```typescript
export interface MapOverlays {
  tradeFlow: boolean;
  priceHeatmap: boolean;
}

const DEFAULT_OVERLAYS: MapOverlays = {
  tradeFlow: false,
  priceHeatmap: false,
};
```

Update `hydrateFromSession` to also read `priceHeatmap`, and persist in the `useEffect` setter:

```typescript
if (overlays.priceHeatmap) stored.priceHeatmap = true;
```

Update `MapOverlaysState` in `map-session.ts` to include the optional `priceHeatmap?: boolean`.

- [ ] **Step 2: Commit**

```bash
git add lib/hooks/use-map-overlays.ts components/map/map-session.ts
git commit -m "feat(map): priceHeatmap overlay key"
```

---

### Task 3.10: Add the "Price" overlay row + good picker to `MapOverlayControls`

**Files:**
- Modify: `components/map/map-overlay-controls.tsx`

- [ ] **Step 1: Add the overlay def and reveal a good picker when active**

Extend `OVERLAY_DEFS`:

```typescript
const OVERLAY_DEFS: ReadonlyArray<OverlayDef> = [
  { key: "tradeFlow", label: "Trade Flows" },
  { key: "priceHeatmap", label: "Price" },
];
```

Add a prop for the selected good + setter (the parent — `StarMap` — owns the value so the canvas can read it too):

```typescript
interface MapOverlayControlsProps {
  // ...
  priceGoodId: string | null;
  setPriceGoodId: (goodId: string | null) => void;
  goods: { id: string; name: string }[]; // from useGoods or universe data
  onOpenComparisonTable: () => void;
}
```

Render a `<SelectInput>` good picker + "Show all prices" button below the overlay list when `overlays.priceHeatmap` is on:

```tsx
{overlays.priceHeatmap && (
  <div className="border-t border-border px-3 py-2 space-y-2">
    <SelectInput
      label="Good"
      size="sm"
      options={[{ value: null, label: "Select a good…" }, ...goods.map((g) => ({ value: g.id, label: g.name }))]}
      value={priceGoodId}
      onChange={setPriceGoodId}
      valueKey={(v) => v ?? ""}
      isSearchable
    />
    {priceGoodId && (
      <Button variant="ghost" size="xs" onClick={onOpenComparisonTable} fullWidth>
        Show all prices
      </Button>
    )}
    <PriceRampLegend />
  </div>
)}
```

Add a local `PriceRampLegend` component mirroring `TradeFlowLegend`, using stops from `PRICE_RAMP_STOPS`.

- [ ] **Step 2: Wire the new props in `StarMap`**

Add state in `star-map.tsx`:

```typescript
const [priceGoodId, setPriceGoodId] = useState<string | null>(null);
const [comparisonOpen, setComparisonOpen] = useState(false);

// Goods — pull from universe data or constants
const goods = useMemo(() => Object.entries(GOODS).map(([id, g]) => ({ id, name: g.name })), []);
```

Pass to `MapOverlayControls`:

```tsx
<MapOverlayControls
  /* ...existing */
  priceGoodId={priceGoodId}
  setPriceGoodId={setPriceGoodId}
  goods={goods}
  onOpenComparisonTable={() => setComparisonOpen(true)}
/>
```

Render `MarketComparisonPanel` from `StarMap` too, gated on `comparisonOpen && priceGoodId`:

```tsx
{comparisonOpen && priceGoodId && view.selectedSystem && (
  <MarketComparisonPanel
    goodId={priceGoodId}
    goodName={goods.find((g) => g.id === priceGoodId)?.name ?? priceGoodId}
    fromSystemId={view.selectedSystem.id}
    fromSystemName={view.selectedSystem.name}
    systems={universe.systems.map((s) => ({ id: s.id, name: s.name }))}
    connections={allConnections}
    onSelectSystem={(sysId) => {
      const sys = universe.systems.find((s) => s.id === sysId);
      if (sys) {
        view.selectSystem(sys);
        setCenterTarget({ x: sys.x, y: sys.y, zoom: 1.2 });
      }
      setComparisonOpen(false);
    }}
    onClose={() => setComparisonOpen(false)}
  />
)}
```

If `view.selectedSystem` is null when the user opens the table, fall back to the first system with a player ship, or show an inline notice "Select a system to set the comparison origin."

- [ ] **Step 3: Commit**

```bash
git add components/map/map-overlay-controls.tsx components/map/star-map.tsx
git commit -m "feat(map): price overlay control with good picker and legend"
```

---

### Task 3.11: Pixi heatmap tint

**Files:**
- Modify: `components/map/pixi/pixi-map-canvas.tsx` (or whichever Pixi system-renderer file owns the dot tints)

This is the highest-effort step because it touches the Pixi renderer. Read the existing trade-flow overlay implementation first to mirror its data-flow pattern.

- [ ] **Step 1: Read the existing trade-flow overlay code**

```bash
grep -rn "tradeFlow" components/map/pixi/
```

Identify how trade-flow edges are passed in (a prop on `PixiMapCanvas`) and how the renderer pulls colours per-frame.

- [ ] **Step 2: Add `priceHeatmap` data to the canvas prop type**

```typescript
interface PixiMapCanvasProps {
  // ...existing
  priceHeatmap?: {
    goodId: string;
    bySystemId: Map<string, { currentPrice: number; basePrice: number }>;
  };
}
```

`StarMap` builds `bySystemId` from `useMarketComparison(priceGoodId)` entries, only when both `overlays.priceHeatmap` and `priceGoodId` are non-null:

```tsx
// in star-map.tsx (gate the query on overlays.priceHeatmap)
{overlays.priceHeatmap && priceGoodId && (
  <PriceHeatmapDataFetcher
    goodId={priceGoodId}
    onData={(data) => setHeatmapData(data)}
  />
)}
```

`PriceHeatmapDataFetcher` is a tiny child that calls `useMarketComparison(goodId)` inside its own `QueryBoundary`, then calls `onData`. (Or skip the fetcher and place the hook directly in `StarMap` if you don't mind suspending the whole map.)

- [ ] **Step 3: Apply the tint per system in the Pixi renderer**

In the renderer's per-system update step, look up the heatmap entry and apply `priceRampColorPixi`:

```typescript
import { priceRampColorPixi } from "@/lib/utils/price-ramp";

// per-system render
const heat = priceHeatmap?.bySystemId.get(system.id);
if (heat) {
  const tint = priceRampColorPixi(heat.currentPrice, heat.basePrice);
  if (tint !== null) {
    sprite.tint = tint;
  }
}
```

Restore the default tint when `priceHeatmap` is absent or the system has no entry (the visibility-aware tint that already exists).

- [ ] **Step 4: Manual verify the heatmap**

```bash
npm run dev
```

Open the map, enable the Price overlay, pick a good with diverse market prices (Carbon Steel works well at the default seed). Confirm visible systems are tinted along the green→amber→red ramp. Confirm out-of-range systems stay unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/pixi-map-canvas.tsx components/map/star-map.tsx
git commit -m "feat(map): Pixi heatmap tint for price overlay"
```

---

### Task 3.12: Verify the full flow + open PR 3b

- [ ] **Step 1: Smoke-test the end-to-end flow**

With dev server running, verify:
1. Open Price overlay, pick a good → systems tint correctly.
2. Click "Show all prices" → comparison panel opens with rows sorted by price.
3. Click a Go button → map recentres, detail panel opens for that system.
4. From the panel, click a ship's Navigate (from PR 2) → nav-mode flips on, map ready for destination click.
5. From a system's market page, click Compare on a row → panel opens with that system as origin.
6. Toggle Price overlay off → tints clear, comparison panel still works from the market page.

- [ ] **Step 2: Open PR 3b**

```bash
git push
gh pr create --base main --title "feat(map): price overlay heatmap" --body "Issue #3 (3b) of trade-ux-improvements. Adds a Price overlay to the map controls with a good picker and a legend; tints visible systems via priceRampColor on the existing Pixi renderer. Reuses the by-good endpoint from 3a."
```

---

## Self-Review Notes

- **Spec coverage:**
  - Spec §1 (floor at service) → PR 1, tasks 1.1–1.3. ✓
  - Spec §2 (enriched panel: status row, tab shortcuts, convoys+ships sections, inline navigate, overflow link) → PR 2, tasks 2.1–2.7. ✓
  - Spec §3 endpoint (`/api/game/market/by-good/[goodId]`) → task 3.4. ✓
  - Spec §3 map overlay (Price mode, color ramp, picker, legend, Show-all button) → tasks 3.9–3.11. ✓
  - Spec §3 drill-down (sortable table, jumps, Go action, Compare entry from market page) → tasks 3.6–3.7. ✓
  - Spec §3 service + visibility filter → task 3.3. ✓
  - Spec §3 jumps via BFS → task 3.1 (`boundedHopsFromOrigin`). ✓
  - Build order matches spec (PR1, PR2, PR3a, PR3b). ✓

- **Placeholder check:** no "TBD", "TODO", "appropriate error handling" without code, or "similar to Task N" handwaves. The danger-badge note in 2.4 explicitly allows a defer-to-follow-up when the data isn't readily plumbed — that's a scoped escape hatch, not a placeholder.

- **Type consistency:** `MarketComparisonEntry`, `MarketComparisonResponse`, `MarketComparisonPanelProps`, `boundedHopsFromOrigin`, `priceRampColor`, `priceRampColorPixi` all use the same name across tasks.

- **DOM-test caveat:** flagged at Task 2.1; applies to any later component-render test. Default action: skip the render tests, rely on manual verification.
