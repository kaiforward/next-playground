# Layer 2, Foundation PR 5 — Map Mode / Overlay Split + LOD Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the existing single overlay list into two independent axes — a single-select "Map Mode" (Political / Regions / None) and a multi-select "Overlays" group (Trade Flows + future) — and make territory tint visible at all zoom levels.

**Architecture:** Two-axis UI panel backed by two sibling React hooks (`useMapMode`, `useMapOverlays`). Both hooks persist independently via `sessionStorage` through the existing `map-session.ts` helpers. The Pixi canvas accepts a `mapMode` prop and flips the visibility of two existing territory layers; the LOD curves in `lod.ts` are widened so the territory layer never fully fades out. No data, service, or processor changes.

**Tech Stack:** Next.js 16 / React 19, TypeScript 5 strict, Pixi.js v8 (map canvas), `tailwind-variants` (UI styling), Vitest 4 (pure-logic tests).

**Spec:** `docs/design/implementation/layer-2-faction-foundation.md` Phase 6.

**Branch:** `feat/layer-2-foundation-pr-5` → PR into `feat/layer-2-foundation`.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `lib/types/map.ts` | `MapMode` union (`"political" \| "regions" \| "none"`) and `MAP_MODES` readonly array |
| `lib/hooks/use-map-mode.ts` | Session-persisted single-select map-mode state, mirrors `useMapOverlays` shape |
| `components/map/__tests__/map-session.test.ts` | Vitest unit tests for `parseOverlays` (drops legacy key) and the new `parseMode` parser |
| `components/map/pixi/__tests__/lod.test.ts` | Vitest unit tests for the new `showTerritories` / `territoryAlpha` curve |

**Modified files:**

| File | Change |
|---|---|
| `components/map/map-session.ts` | Add `mode?: MapMode` to `MapSessionState`; add `setModeInSession()`; drop `politicalTerritory` from `MapOverlaysState` and `parseOverlays` |
| `lib/hooks/use-map-overlays.ts` | Remove `politicalTerritory` from the interface, the default, the hydrate path, and the persist path |
| `components/map/map-overlay-controls.tsx` | Two-section panel: single-select Mode group + existing multi-select Overlay group |
| `components/map/pixi/pixi-map-canvas.tsx` | `politicalOverlay: boolean` prop → `mapMode: MapMode`; visibility effect handles three modes |
| `components/map/star-map.tsx` | Read `useMapMode`, pass `mode` + `setMode` to controls and `mapMode` to canvas |
| `components/map/pixi/lod.ts` | `showTerritories` always true; `territoryAlpha` curve floors at 0.6 |

---

## Task 1 — Add `MapMode` type and update `map-session.ts`

**Files:**
- Create: `lib/types/map.ts`
- Modify: `vitest.config.ts` (include `components/**/__tests__/`)
- Modify: `components/map/map-session.ts`
- Test: `components/map/__tests__/map-session.test.ts`

- [ ] **Step 1: Extend the Vitest unit project to pick up component tests**

The repo's `vitest.config.ts` currently only includes `lib/**/__tests__/`. Two test files in this PR live under `components/` (`map-session.test.ts`, `lod.test.ts`), so they need to be in scope.

In `vitest.config.ts`, replace:

```ts
        test: {
          name: "unit",
          include: ["lib/**/__tests__/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
        },
```

With:

```ts
        test: {
          name: "unit",
          include: [
            "lib/**/__tests__/**/*.test.ts",
            "components/**/__tests__/**/*.test.ts",
          ],
          exclude: ["**/*.integration.test.ts"],
        },
```

- [ ] **Step 2: Create `lib/types/map.ts`**

```ts
// ── Map-view types shared between hooks, components, and the Pixi canvas ──

/** Single-select tint applied to the territory polygons. `none` hides both. */
export type MapMode = "political" | "regions" | "none";

/** Iteration order also defines the UI render order in the Mode toggle group. */
export const MAP_MODES: readonly MapMode[] = ["political", "regions", "none"];

const MAP_MODE_SET: ReadonlySet<string> = new Set<MapMode>(MAP_MODES);

/** Narrows an unknown string to `MapMode` for sessionStorage hydration. */
export function isMapMode(value: unknown): value is MapMode {
  return typeof value === "string" && MAP_MODE_SET.has(value);
}
```

- [ ] **Step 3: Write the failing parser tests**

Create `components/map/__tests__/map-session.test.ts`:

```ts
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  getMapSessionState,
  setOverlaysInSession,
  setModeInSession,
} from "../map-session";

// The repo has no jsdom dev dependency and Vitest's unit project runs in Node
// by default. `map-session.ts` only touches `sessionStorage` inside its
// function bodies (not at module-evaluation time), so installing the stub in
// beforeAll runs before any test calls those functions.
beforeAll(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => {
        storage.clear();
      },
    },
  });
});

describe("map-session", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe("parseOverlays (via getMapSessionState)", () => {
    it("keeps tradeFlow when present", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { tradeFlow: true } }),
      );
      expect(getMapSessionState()?.overlays?.tradeFlow).toBe(true);
    });

    it("silently drops a legacy politicalTerritory key", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { politicalTerritory: true } }),
      );
      // Legacy key is gone from the parsed shape — and because it was the
      // only overlay, `overlays` itself collapses to undefined.
      expect(getMapSessionState()?.overlays).toBeUndefined();
    });

    it("keeps tradeFlow even when a legacy politicalTerritory is also present", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({
          overlays: { tradeFlow: true, politicalTerritory: true },
        }),
      );
      const overlays = getMapSessionState()?.overlays;
      expect(overlays?.tradeFlow).toBe(true);
      expect("politicalTerritory" in (overlays ?? {})).toBe(false);
    });
  });

  describe("mode persistence", () => {
    it("returns undefined when no mode is stored", () => {
      expect(getMapSessionState()?.mode).toBeUndefined();
    });

    it("round-trips a valid mode", () => {
      setModeInSession("political");
      expect(getMapSessionState()?.mode).toBe("political");
    });

    it("drops an invalid mode value during parse", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ mode: "not-a-mode" }),
      );
      expect(getMapSessionState()?.mode).toBeUndefined();
    });

    it("preserves overlays when setting mode independently", () => {
      setOverlaysInSession({ tradeFlow: true });
      setModeInSession("regions");
      const state = getMapSessionState();
      expect(state?.mode).toBe("regions");
      expect(state?.overlays?.tradeFlow).toBe(true);
    });

    it("preserves mode when setting overlays independently", () => {
      setModeInSession("political");
      setOverlaysInSession({ tradeFlow: true });
      const state = getMapSessionState();
      expect(state?.mode).toBe("political");
      expect(state?.overlays?.tradeFlow).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run components/map/__tests__/map-session.test.ts`

Expected: FAIL — `setModeInSession` is not exported; `state.mode` is undefined because the field isn't parsed; legacy-drop tests fail because `parseOverlays` still keeps `politicalTerritory`.

- [ ] **Step 5: Update `components/map/map-session.ts`**

Replace the whole file with:

```ts
// ── Session storage helpers for map view persistence ────────────

import { isMapMode, type MapMode } from "@/lib/types/map";

const SESSION_KEY = "stellarTrader:mapState";

export interface MapOverlaysState {
  tradeFlow?: boolean;
}

export interface MapSessionState {
  selectedSystemId?: string;
  mode?: MapMode;
  overlays?: MapOverlaysState;
}

function parseOverlays(value: unknown): MapOverlaysState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const out: MapOverlaysState = {};
  if ("tradeFlow" in value && typeof value.tradeFlow === "boolean") {
    out.tradeFlow = value.tradeFlow;
  }
  // Legacy `politicalTerritory` is silently dropped — it migrated to the
  // single-select `mode` axis. Users land on the default mode.
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseMode(value: unknown): MapMode | undefined {
  return isMapMode(value) ? value : undefined;
}

export function getMapSessionState(): MapSessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      selectedSystemId:
        "selectedSystemId" in parsed &&
        typeof parsed.selectedSystemId === "string"
          ? parsed.selectedSystemId
          : undefined,
      mode: "mode" in parsed ? parseMode(parsed.mode) : undefined,
      overlays:
        "overlays" in parsed ? parseOverlays(parsed.overlays) : undefined,
    };
  } catch {
    return null;
  }
}

function writeSessionState(state: MapSessionState): void {
  try {
    // Empty state — clear the key entirely instead of storing "{}".
    if (
      state.selectedSystemId === undefined &&
      state.mode === undefined &&
      (!state.overlays || Object.keys(state.overlays).length === 0)
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // SSR or storage full — ignore
  }
}

/**
 * Persist (or clear) the selected system without disturbing other fields.
 */
export function setSelectedSystemInSession(systemId: string | null): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({
    ...current,
    selectedSystemId: systemId ?? undefined,
  });
}

/**
 * Persist the overlay-toggle state without disturbing the selected system or mode.
 */
export function setOverlaysInSession(overlays: MapOverlaysState): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({ ...current, overlays });
}

/**
 * Persist the single-select map mode without disturbing the selected system or overlays.
 */
export function setModeInSession(mode: MapMode): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({ ...current, mode });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run components/map/__tests__/map-session.test.ts`

Expected: PASS — all eight cases green.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts lib/types/map.ts components/map/map-session.ts components/map/__tests__/map-session.test.ts
git commit -m "feat(map): add MapMode type and mode persistence to map-session"
```

---

## Task 2 — Create `useMapMode` hook and strip `politicalTerritory` from `useMapOverlays`

**Files:**
- Create: `lib/hooks/use-map-mode.ts`
- Modify: `lib/hooks/use-map-overlays.ts`

No unit tests — both hooks mirror the existing `useMapOverlays` pattern, which has no test precedent in this repo. They're verified end-to-end in the browser-walkthrough task at the end.

- [ ] **Step 1: Create `lib/hooks/use-map-mode.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMapSessionState,
  setModeInSession,
} from "@/components/map/map-session";
import type { MapMode } from "@/lib/types/map";

/**
 * Owns the single-select map mode (the territory tint). One of "political",
 * "regions", or "none". Default `"political"` — factions are the most
 * gameplay-relevant tint after the Layer 2 cutover. Persisted via the existing
 * `map-session` mechanism so a refresh preserves the user's last view.
 */

const DEFAULT_MODE: MapMode = "political";

function hydrateFromSession(): MapMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const session = getMapSessionState();
  return session?.mode ?? DEFAULT_MODE;
}

export function useMapMode(): {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
} {
  // SSR: render with the default; hydrate from session storage after mount so
  // we don't introduce a hydration mismatch on the first paint.
  const [mode, setModeState] = useState<MapMode>(DEFAULT_MODE);
  // Skip persisting on the initial mount — mode starts as DEFAULT and would
  // otherwise overwrite a previously-stored value before hydration runs.
  const skipPersist = useRef(true);

  useEffect(() => {
    setModeState(hydrateFromSession());
  }, []);

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    setModeInSession(mode);
  }, [mode]);

  const setMode = useCallback((next: MapMode) => {
    setModeState(next);
  }, []);

  return { mode, setMode };
}
```

- [ ] **Step 2: Update `lib/hooks/use-map-overlays.ts`**

Replace the whole file with:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMapSessionState,
  setOverlaysInSession,
  type MapOverlaysState,
} from "@/components/map/map-session";

/**
 * Owns which additive map overlays are toggled on. Overlays sit on top of
 * whatever map mode is active and can be stacked freely. State is persisted
 * via `map-session` so a refresh preserves the user's last view.
 *
 * Defaults to all-off so first-time players see a clean map.
 */
export interface MapOverlays {
  tradeFlow: boolean;
}

export type MapOverlayKey = keyof MapOverlays;

const DEFAULT_OVERLAYS: MapOverlays = {
  tradeFlow: false,
};

function hydrateFromSession(): MapOverlays {
  if (typeof window === "undefined") return DEFAULT_OVERLAYS;
  const session = getMapSessionState();
  const stored = session?.overlays;
  if (!stored) return DEFAULT_OVERLAYS;
  return {
    tradeFlow: stored.tradeFlow ?? DEFAULT_OVERLAYS.tradeFlow,
  };
}

export function useMapOverlays(): {
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
} {
  const [overlays, setOverlays] = useState<MapOverlays>(DEFAULT_OVERLAYS);
  const skipPersist = useRef(true);

  useEffect(() => {
    setOverlays(hydrateFromSession());
  }, []);

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    const stored: MapOverlaysState = {};
    if (overlays.tradeFlow) stored.tradeFlow = true;
    setOverlaysInSession(stored);
  }, [overlays]);

  const toggle = useCallback((key: MapOverlayKey) => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { overlays, toggle };
}
```

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc --noEmit`

Expected: Clean — no references to the removed `politicalTerritory` field outside the files updated later in this plan. If TS errors out on `pixi-map-canvas.tsx` or `star-map.tsx` consuming `overlays.politicalTerritory`, that's expected — those are fixed in Tasks 3-5. Note any other errors and stop before committing.

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-map-mode.ts lib/hooks/use-map-overlays.ts
git commit -m "feat(map): split mode hook from overlay hook"
```

---

## Task 3 — Two-section `MapOverlayControls` panel

**Files:**
- Modify: `components/map/map-overlay-controls.tsx`

- [ ] **Step 1: Replace the file**

```tsx
"use client";

import { tv } from "tailwind-variants";
import {
  TIER_COLOR,
  TIER_LABEL,
  pixiHexToCss,
} from "@/lib/constants/good-colors";
import type { GoodTier } from "@/lib/types/game";
import { MAP_MODES, type MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";

const rowVariants = tv({
  base: [
    "group flex items-center justify-between gap-3 w-full",
    "px-3 py-1.5 text-xs font-medium uppercase tracking-wider",
    "border-l-2 transition-colors duration-150",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  ],
  variants: {
    active: {
      true: "border-l-accent bg-accent/10 text-text-accent hover:bg-accent/20",
      false:
        "border-l-transparent bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary",
    },
  },
});

const dotVariants = tv({
  base: "h-2 w-2 transition-colors duration-150",
  variants: {
    active: {
      true: "bg-accent shadow-[0_0_6px_var(--color-accent)]",
      false: "bg-border-strong group-hover:bg-text-secondary",
    },
  },
});

const MODE_LABELS: Record<MapMode, string> = {
  political: "Political",
  regions: "Regions",
  none: "None",
};

interface OverlayDef {
  key: MapOverlayKey;
  label: string;
}

/**
 * Order matters — this is also the rendered order in the cluster. Keep the
 * most-used overlay at the top.
 */
const OVERLAY_DEFS: ReadonlyArray<OverlayDef> = [
  { key: "tradeFlow", label: "Trade Flows" },
];

interface MapOverlayControlsProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
}

/**
 * Floating cluster anchored bottom-left of the map canvas. Two axes:
 *
 *   1. **Map Mode** (single-select) — paints the territory polygons. One tint
 *      at a time. `none` hides both territory layers.
 *   2. **Overlays** (multi-select) — additive layers on top of the polygons,
 *      stackable freely.
 *
 * Foundry theme: sharp corners, surface background, copper left-accent stripe
 * on the active row. The cluster intentionally has NO container-level stripe
 * — the active row carries the accent.
 */
export function MapOverlayControls({
  mode,
  setMode,
  overlays,
  toggle,
}: MapOverlayControlsProps) {
  return (
    <div className="absolute bottom-4 left-4 z-20 w-44 border border-border bg-surface/95 backdrop-blur shadow-lg">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-[10px] font-display font-bold uppercase tracking-[0.18em] text-text-secondary">
          Map
        </h3>
      </div>

      <ModeSection mode={mode} setMode={setMode} />

      <div className="border-t border-border px-3 pt-2 pb-1">
        <h4 className="text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
          Overlays
        </h4>
      </div>
      <ul role="group" aria-label="Map overlays">
        {OVERLAY_DEFS.map(({ key, label }) => {
          const active = overlays[key];
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={active}
                className={rowVariants({ active })}
              >
                <span>{label}</span>
                <span className={dotVariants({ active })} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {overlays.tradeFlow && <TradeFlowLegend />}
    </div>
  );
}

function ModeSection({
  mode,
  setMode,
}: {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
}) {
  return (
    <>
      <div className="px-3 pt-2 pb-1">
        <h4 className="text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
          Mode
        </h4>
      </div>
      <ul role="radiogroup" aria-label="Map mode">
        {MAP_MODES.map((m) => {
          const active = m === mode;
          return (
            <li key={m}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  if (!active) setMode(m);
                }}
                className={rowVariants({ active })}
              >
                <span>{MODE_LABELS[m]}</span>
                <span className={dotVariants({ active })} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Tier-colour legend shown only when the Trade Flows overlay is on. Colours
 * come from `TIER_COLOR` so they can't drift from the Pixi renderer.
 */
function TradeFlowLegend() {
  const tiers: GoodTier[] = [0, 1, 2];
  return (
    <div className="border-t border-border px-3 py-2">
      <h4 className="mb-1.5 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Good Tier
      </h4>
      <ul className="space-y-1">
        {tiers.map((tier) => (
          <li
            key={tier}
            className="flex items-center gap-2 text-[11px] text-text-secondary"
          >
            <span
              className="h-2 w-2 shrink-0"
              style={{ backgroundColor: pixiHexToCss(TIER_COLOR[tier]) }}
              aria-hidden
            />
            <span>{TIER_LABEL[tier]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: Errors only in `star-map.tsx` (still passing the old `overlays`/`toggle`-only props to the new component). Fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add components/map/map-overlay-controls.tsx
git commit -m "feat(map): two-section overlay controls (Mode + Overlays)"
```

---

## Task 4 — Update `PixiMapCanvas` to consume `mapMode`

**Files:**
- Modify: `components/map/pixi/pixi-map-canvas.tsx:24-37` (props), `:306-312` (visibility effect)

- [ ] **Step 1: Update the props interface (around line 24)**

Replace:

```ts
export interface PixiMapCanvasProps {
  atlasData: AtlasData;
  mapData: MapData;
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  onSystemClick: (system: StarSystemInfo) => void;
  onEmptyClick: () => void;
  centerTarget?: { x: number; y: number; zoom: number };
  onReady: () => void;
  regionInfos: { id: string; name: string }[];
  /** When true, paint faction-coloured territory; the economy layer hides. */
  politicalOverlay?: boolean;
  onViewportChange?: (bounds: ViewportBounds, zoom: number) => void;
}
```

With:

```ts
import type { MapMode } from "@/lib/types/map";

export interface PixiMapCanvasProps {
  atlasData: AtlasData;
  mapData: MapData;
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  onSystemClick: (system: StarSystemInfo) => void;
  onEmptyClick: () => void;
  centerTarget?: { x: number; y: number; zoom: number };
  onReady: () => void;
  regionInfos: { id: string; name: string }[];
  /**
   * Which territory tint to paint. `political` shows faction colours,
   * `regions` shows economy colours, `none` hides both layers.
   */
  mapMode?: MapMode;
  onViewportChange?: (bounds: ViewportBounds, zoom: number) => void;
}
```

Add `MapMode` to the existing top-of-file imports (group with the other type imports).

- [ ] **Step 2: Update the component signature (around line 56)**

Replace:

```ts
export function PixiMapCanvas({
  atlasData,
  mapData,
  selectedSystem,
  navigationMode,
  onSystemClick,
  onEmptyClick,
  centerTarget,
  onReady,
  regionInfos,
  politicalOverlay = false,
  onViewportChange,
}: PixiMapCanvasProps) {
```

With:

```ts
export function PixiMapCanvas({
  atlasData,
  mapData,
  selectedSystem,
  navigationMode,
  onSystemClick,
  onEmptyClick,
  centerTarget,
  onReady,
  regionInfos,
  mapMode = "political",
  onViewportChange,
}: PixiMapCanvasProps) {
```

- [ ] **Step 3: Update the visibility-toggle effect (around line 306)**

Replace:

```tsx
  // ── Toggle which territory layer is visible ────────────────────────
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;
    p.territoryLayer.container.visible = !politicalOverlay;
    p.politicalTerritoryLayer.setActive(politicalOverlay);
  }, [politicalOverlay, pixiReady]);
```

With:

```tsx
  // ── Toggle which territory layer is visible ────────────────────────
  // Three modes: "political" shows the faction layer, "regions" shows the
  // economy layer, "none" hides both. Per-frame LOD logic still runs on the
  // hidden layers (cheap) so swapping back is instant.
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;
    p.territoryLayer.container.visible = mapMode === "regions";
    p.politicalTerritoryLayer.setActive(mapMode === "political");
  }, [mapMode, pixiReady]);
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: Errors only in `star-map.tsx` (still passing `politicalOverlay={overlays.politicalTerritory}`). Fixed in Task 5.

- [ ] **Step 5: Commit**

```bash
git add components/map/pixi/pixi-map-canvas.tsx
git commit -m "feat(map): PixiMapCanvas accepts mapMode prop"
```

---

## Task 5 — Wire `useMapMode` into `StarMap`

**Files:**
- Modify: `components/map/star-map.tsx:17` (import), `:53` (hook call), `:247-262` (props passed)

- [ ] **Step 1: Add the import (top of file, near other hook imports around line 17)**

Add the line:

```ts
import { useMapMode } from "@/lib/hooks/use-map-mode";
```

- [ ] **Step 2: Call the hook (around line 53, alongside `useMapOverlays`)**

Replace:

```ts
  // ── Overlay toggles (Trade Flows, future: danger, factions, etc.) ──
  const { overlays, toggle } = useMapOverlays();
  const { edges: tradeFlowEdges } = useTradeFlow(overlays.tradeFlow);
```

With:

```ts
  // ── Map mode (single-select tint) + additive overlay toggles ──
  const { mode: mapMode, setMode: setMapMode } = useMapMode();
  const { overlays, toggle } = useMapOverlays();
  const { edges: tradeFlowEdges } = useTradeFlow(overlays.tradeFlow);
```

- [ ] **Step 3: Update the JSX (around lines 247-262)**

Replace:

```tsx
      <PixiMapCanvas
        atlasData={atlas}
        mapData={mapData}
        selectedSystem={selectedSystem}
        navigationMode={mode}
        onSystemClick={onSystemClick}
        onEmptyClick={onEmptyClick}
        centerTarget={centerTarget}
        onReady={handleReady}
        regionInfos={regionInfos}
        politicalOverlay={overlays.politicalTerritory}
        onViewportChange={onViewportChange}
      />

      {/* Map overlay toggle cluster (bottom-left) */}
      <MapOverlayControls overlays={overlays} toggle={toggle} />
```

With:

```tsx
      <PixiMapCanvas
        atlasData={atlas}
        mapData={mapData}
        selectedSystem={selectedSystem}
        navigationMode={mode}
        onSystemClick={onSystemClick}
        onEmptyClick={onEmptyClick}
        centerTarget={centerTarget}
        onReady={handleReady}
        regionInfos={regionInfos}
        mapMode={mapMode}
        onViewportChange={onViewportChange}
      />

      {/* Map mode + overlay controls (bottom-left) */}
      <MapOverlayControls
        mode={mapMode}
        setMode={setMapMode}
        overlays={overlays}
        toggle={toggle}
      />
```

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit`

Expected: Clean — zero errors.

- [ ] **Step 5: Commit**

```bash
git add components/map/star-map.tsx
git commit -m "feat(map): wire useMapMode into StarMap"
```

---

## Task 6 — LOD curve adjustments

**Files:**
- Modify: `components/map/pixi/lod.ts:93-99`
- Test: `components/map/pixi/__tests__/lod.test.ts`

- [ ] **Step 1: Write the failing LOD tests**

Create `components/map/pixi/__tests__/lod.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeLOD } from "../lod";

describe("computeLOD — territory visibility curve (PR 5/5 polish)", () => {
  it("never culls the territory layer regardless of zoom", () => {
    for (const zoom of [0.05, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0]) {
      expect(computeLOD(zoom).showTerritories).toBe(true);
    }
  });

  it("renders at full opacity in universe view", () => {
    expect(computeLOD(0.1).territoryAlpha).toBe(1);
    expect(computeLOD(0.3).territoryAlpha).toBe(1);
  });

  it("eases between universe and system view", () => {
    const mid = computeLOD(0.5).territoryAlpha;
    // Between the 0.3 start and 0.7 end of the ease, alpha is mid-way through
    // the 1.0 → 0.6 range.
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(1.0);
  });

  it("floors at ~0.6 at deep system zoom (never fully transparent)", () => {
    for (const zoom of [0.7, 1.0, 1.5, 2.0]) {
      const alpha = computeLOD(zoom).territoryAlpha;
      // Allow a tiny float-equality slack.
      expect(alpha).toBeGreaterThanOrEqual(0.59999);
      expect(alpha).toBeLessThanOrEqual(0.60001);
    }
  });

  it("territoryAlpha is monotonically non-increasing across the zoom range", () => {
    const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0];
    const alphas = samples.map((z) => computeLOD(z).territoryAlpha);
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1] + 1e-9);
    }
  });
});

describe("computeLOD — unchanged adjacent curves (regression guards)", () => {
  it("regionLabelAlpha still fades to zero past 0.5", () => {
    // Labels follow their existing curve — they're text, not tint.
    expect(computeLOD(0.6).regionLabelAlpha).toBe(0);
  });

  it("tradeFlowAlpha still fades in across 0.4 → 0.6", () => {
    expect(computeLOD(0.3).tradeFlowAlpha).toBe(0);
    expect(computeLOD(0.7).tradeFlowAlpha).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/map/pixi/__tests__/lod.test.ts`

Expected: FAIL — `showTerritories` is `false` past zoom 0.5; `territoryAlpha` reaches 0 by zoom 0.5 in the current curve.

- [ ] **Step 3: Update `components/map/pixi/lod.ts`**

Find the block (lines 93-99):

```ts
    // Territories visible in universe/crossfade, fade out in system view
    showTerritories: zoom < 0.5,
    territoryAlpha: 1 - smoothStep(0.3, 0.5, zoom),

    // Region labels visible in universe view, fade at same range as territories
    showRegionLabels: zoom < 0.5,
    regionLabelAlpha: 1 - smoothStep(0.3, 0.5, zoom),
```

Replace with:

```ts
    // Territories visible at every zoom level — they're the spatial frame for
    // both Political and Regions modes. Alpha eases from 1.0 in universe view
    // to a 0.6 floor in deep system view so individual systems still read
    // cleanly against the tint. Tune the floor here if it feels too heavy.
    showTerritories: true,
    territoryAlpha: 1 - 0.4 * smoothStep(0.3, 0.7, zoom),

    // Region labels still fade out past 0.5 — text clutters individual-system
    // inspection. Polygons stay; labels go.
    showRegionLabels: zoom < 0.5,
    regionLabelAlpha: 1 - smoothStep(0.3, 0.5, zoom),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/map/pixi/__tests__/lod.test.ts`

Expected: PASS — all six cases green.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npx vitest run`

Expected: All previously-passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add components/map/pixi/lod.ts components/map/pixi/__tests__/lod.test.ts
git commit -m "feat(map): territory tint persists at close zoom (LOD polish)"
```

---

## Task 7 — Manual browser verification

No code changes — verify the feature works end-to-end.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Wait for the Turbopack-ready line, then open the running app in a browser.

- [ ] **Step 2: Verify Mode toggle behavior**

Navigate to the map. Expected state on first visit:
- Mode panel shows **Political** selected, Regions and None unselected.
- Faction-coloured territory polygons render.
- Overlays section shows **Trade Flows** unchecked.

Click each mode in turn and confirm:
- **Political** → faction colours.
- **Regions** → economy-by-region colours.
- **None** → no polygon tint; starfield + connections + systems only.

- [ ] **Step 3: Verify Overlay independence**

In **Political** mode, click **Trade Flows**:
- Trade-flow particles render on top of faction colours.

Switch to **Regions**:
- Trade-flow particles persist on top of region colours (overlay state unchanged).

Switch to **None**:
- Trade-flow particles persist on top of the bare starfield.

Untoggle Trade Flows. Switch modes again. Confirm overlay stays off.

- [ ] **Step 4: Verify LOD behavior**

Set mode to **Political**. Zoom from universe view (mouse-wheel out) all the way down to a single system (mouse-wheel in deeply).
- Territory tint is visible at every zoom level.
- Tint is brightest at universe zoom, eases to ~60% at deep system zoom.
- Individual systems read clearly against the tint at close zoom.
- Region labels fade out around mid-zoom (unchanged behaviour).
- Trade flows (if on) fade in as you zoom past 0.4.

Repeat for **Regions** mode — same behaviour expected.

- [ ] **Step 5: Verify session persistence**

Pick a non-default state: mode = **Regions**, Trade Flows = **on**.
- Refresh the page (F5).
- Confirm mode is still **Regions** and Trade Flows is still **on**.

Pick another state: mode = **None**, Trade Flows = **off**.
- Refresh.
- Confirm restored.

- [ ] **Step 6: Verify legacy-key migration**

In DevTools → Application → Session Storage, manually set the key `stellarTrader:mapState` to:

```json
{"overlays":{"politicalTerritory":true}}
```

Refresh the page.
- Mode lands on the default (**Political**) — the legacy key is silently dropped.
- DevTools shows the key is either gone or now contains `{}` / a clean state on next change.

- [ ] **Step 7: Stop the dev server**

`Ctrl+C` in the terminal running `npm run dev`.

---

## Task 8 — Open the PR

- [ ] **Step 1: Confirm clean working tree**

Run: `git status`

Expected: clean — every commit landed.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/layer-2-foundation-pr-5
```

- [ ] **Step 3: Open the PR against the shared feature branch**

```bash
gh pr create \
  --base feat/layer-2-foundation \
  --title "feat(map): map-mode/overlay split + LOD polish (PR 5/5)" \
  --body "$(cat <<'EOF'
## Summary
- Split the single overlay list into two axes: **Map Mode** (single-select: Political / Regions / None) and **Overlays** (multi-select: Trade Flows for now).
- Default mode is **Political** — factions are the most gameplay-relevant tint after the Layer 2 cutover.
- Territory tint stays visible at every zoom level (eases 1.0 → 0.6, never culled).
- No data, service, or processor changes — map UI only.

See `docs/design/implementation/layer-2-faction-foundation.md` Phase 6 and `docs/design/implementation/layer-2-pr-5-map-modes.md` for the design and step-by-step plan.

## Test plan
- [ ] `npx vitest run` — all green
- [ ] `npx tsc --noEmit` — clean
- [ ] Browser: mode toggle cycles Political / Regions / None
- [ ] Browser: Trade Flows overlay persists across mode changes
- [ ] Browser: territory tint visible at all zoom levels; eases as zoom increases
- [ ] Browser: refresh preserves `mode` + `overlays.tradeFlow` independently
- [ ] Browser: legacy `overlays.politicalTerritory` sessionStorage value is silently dropped
EOF
)"
```

Note the PR URL printed by `gh pr create` and share it with the user.

---

## Verification Checklist

- All previously-passing Vitest tests still pass (`npx vitest run`).
- `npx tsc --noEmit` is clean.
- The new test files (`map-session.test.ts`, `lod.test.ts`) cover:
  - Legacy `politicalTerritory` sessionStorage drop.
  - `parseMode` rejects invalid values.
  - `mode` and `overlays` persist independently.
  - `showTerritories` true at every zoom.
  - `territoryAlpha` curve floors at 0.6 and is monotonically non-increasing.
  - Adjacent LOD curves (`regionLabelAlpha`, `tradeFlowAlpha`) unchanged.
- Manual browser walkthrough passes every check in Task 7.
- PR opened against `feat/layer-2-foundation` (not `main`).
