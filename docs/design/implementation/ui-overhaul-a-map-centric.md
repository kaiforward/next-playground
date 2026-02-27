# UI Overhaul — Workstream A: Map-Centric UI

Detailed implementation plan for restructuring the game so the star map is always visible and all detail screens render as non-modal overlay panels via Next.js parallel routes.

**Design spec**: [map-centric-ui.md](../planned/map-centric-ui.md)

---

## 1. How It Works — Parallel Routes

Next.js parallel routes render multiple pages simultaneously within the same layout. Each `@slot` folder becomes a prop on the layout. Slots are **not** route segments — they don't affect the URL.

### Key behaviors

| Navigation type | Children slot | Panel slot |
|---|---|---|
| **Soft nav** (Link, router.push) | Keeps previous content (map stays mounted) | Matches new URL or keeps previous if no match |
| **Hard nav** (refresh, direct URL) | Renders `default.tsx` (must exist in Next.js 16) | Matches new URL or renders `default.tsx` |

This means:
- Soft nav from `/` to `/system/abc` → children keeps the map, panel renders system detail
- Hard nav to `/system/abc` → children renders `default.tsx` (re-exports the map), panel renders system detail
- Soft nav from `/system/abc` to `/` → children keeps map, panel renders `page.tsx` (null)

### Closing the panel

During soft navigation, if a URL has **no match** in a slot, the slot **retains its previous content** (stale state). This is why `@panel` needs a `[...catchAll]/page.tsx` that returns `null` — it ensures any unmatched URL clears the panel. This is the documented pattern from Next.js, not a workaround.

### File structure

```
app/(game)/
  layout.tsx                        ← receives {children, panel}, passes to GameShell
  page.tsx                          ← map component (children slot, matches /)
  default.tsx                       ← re-exports page.tsx (children on hard nav to panel URLs)

  @panel/
    default.tsx                     ← returns null (panel fallback on hard nav)
    page.tsx                        ← returns null (no panel at /)
    [...catchAll]/
      page.tsx                      ← returns null (closes panel for unmatched routes)

    system/[systemId]/
      layout.tsx                    ← DetailPanel shell + system tabs
      page.tsx                      ← system overview
      market/page.tsx
      ships/page.tsx
      convoys/page.tsx
      shipyard/page.tsx
      shipyard/purchase/page.tsx
      shipyard/upgrades/page.tsx
      contracts/page.tsx

    ship/[shipId]/
      page.tsx                      ← ship detail

    convoy/[convoyId]/
      page.tsx                      ← convoy detail

    fleet/
      page.tsx                      ← fleet overview

    convoys/
      page.tsx                      ← all convoys

    events/
      page.tsx                      ← events list

    battles/
      page.tsx                      ← active battles

    cantina/
      page.tsx                      ← Void's Gambit
```

---

## 2. Component Design — DetailPanel

A shared wrapper component rendered by all `@panel` pages. Provides consistent panel chrome (title, close button, optional tabs) and handles close behavior.

### Behavior

- **Rendering**: Regular `<div>` positioned absolutely within the main content area. No `<dialog>` — avoids focus trap complexity and modal semantics we don't want.
- **Positioning**: Centered within `<main>` (which is already offset by sidebar margin). The map fills `<main>`, the panel sits on top.
- **Sizing**: ~80% width, ~90% height of the main content area, capped with max-width/max-height.
- **Backdrop**: Transparent click target (no visual dimming). Click outside the panel → close.
- **Close actions**: Close button (top-right), Escape key, click outside → all navigate to `/` via `router.push('/')`.
- **Scroll**: Panel body scrolls independently (`overflow-y-auto`).
- **Animation**: Subtle fade-in on mount via CSS transition (opacity 0→1, slight scale).

### Anatomy

```
┌─ DetailPanel ──────────────────────────────────────┐
│  ┌─ Header ──────────────────────────────────────┐ │
│  │  [BackLink?] [Title]              [× Close]   │ │
│  │  [Subtitle?]                                  │ │
│  └───────────────────────────────────────────────┘ │
│  ┌─ Tabs (optional) ────────────────────────────┐ │
│  │  Overview | Market | Ships | Convoys | ...    │ │
│  └───────────────────────────────────────────────┘ │
│  ┌─ Content (scrollable) ───────────────────────┐ │
│  │                                               │ │
│  │  {children}                                   │ │
│  │                                               │ │
│  └───────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

### Props

```typescript
interface DetailPanelProps {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Width variant */
  size?: "md" | "lg" | "xl";
}
```

Close behavior is internal — the component uses `useRouter().push('/')` on close button, Escape, and click-outside. No close callback needed from parent.

### Layering

```
Sidebar:        z-40 (fixed, left)
Map canvas:     z-0 (within main)
Map overlays:   z-10 (within map container — back button, nav banner, route preview)
Panel backdrop: z-20 (within main — transparent click target)
Panel content:  z-30 (within main — the actual panel)
Toasts:         z-[100] (global — above everything, kept for now)
```

---

## 3. Layout Changes

### `app/(game)/layout.tsx`

Add `panel` slot prop, pass to GameShell:

```typescript
export default async function GameLayout({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  // ... auth check, cookie read (unchanged)
  return (
    <AuthSessionProvider>
      <GameQueryProvider>
        <GameShell
          userEmail={session.user?.email ?? null}
          defaultSidebarCollapsed={sidebarCollapsed}
          panel={panel}
        >
          {children}
        </GameShell>
      </GameQueryProvider>
    </AuthSessionProvider>
  );
}
```

### `components/game-shell.tsx`

Add `panel` prop, render alongside children in main:

```typescript
interface GameShellProps {
  userEmail: string | null;
  defaultSidebarCollapsed?: boolean;
  panel?: React.ReactNode;      // ← new
  children: React.ReactNode;
}

// In GameShellInner render:
<main className="flex-1 relative overflow-hidden">
  {children}
  {panel}
</main>
```

The map component fills `<main>` as before. The `panel` slot renders the DetailPanel overlay (or null when no panel route matches).

### TopBar

Keep as-is for workstream A. Breadcrumbs still function (they read pathname). Bell icon stays. Clean up in workstream C.

---

## 4. Map Page Changes

### Move from `app/(game)/map/page.tsx` to `app/(game)/page.tsx`

The map becomes the root page of the game. Key changes:

- Remove sidebar auto-collapse on mount (map is always visible now — sidebar should respect user preference via cookie as it does for all pages)
- Remove `?systemId` search param handling (this becomes a panel route `/system/[id]`)
- Keep `?shipId` and `?convoyId` search params (these trigger navigation mode on the map, not a panel)
- Change height from `h-[calc(100vh-var(--topbar-height))]` to `h-full` (fill the main area, which is already sized by the flex layout)

### `app/(game)/default.tsx`

Re-exports the map page so it renders on hard navigation to panel URLs:

```typescript
export { default } from './page';
```

### System detail panel integration

Currently, clicking a system on the map calls `selectSystem(system)` which opens the `SystemDetailPanel` (the quick-preview sidebar). This stays as tier 1.

New: the "View System" button in `SystemDetailPanel` (and double-click on a system node) navigates to `/system/[id]` instead of the old full-page route. This opens the tier 2 detail panel.

The `SystemDetailPanel` should close when a tier 2 panel opens. This happens naturally: when `selectedSystem` is set but we navigate to a panel route, we can clear the selection. Or: the `SystemDetailPanel` component checks `useSelectedLayoutSegment('panel')` — if a panel is active, it hides itself.

---

## 5. Migrating Pages to Panel Routes

Each existing page moves from `app/(game)/` to `app/(game)/@panel/`. The page content stays largely the same — the main change is wrapping in `DetailPanel` instead of `PageContainer`.

### System detail (has sub-routes with tabs)

**Current**: `app/(game)/system/[systemId]/layout.tsx` renders `PageContainer` + header + `TabList` + `{children}`

**New**: `app/(game)/@panel/system/[systemId]/layout.tsx` renders `DetailPanel` + header + `TabList` + `{children}`

Changes:
- `PageContainer` → `DetailPanel` (with system name as title)
- `BackLink` to `/map?systemId=X` → removed (close button handles this)
- Tab hrefs stay the same: `/system/${id}`, `/system/${id}/market`, etc.
- Tab active detection stays the same (reads `pathname`)
- All sub-page content (`page.tsx`, `market/page.tsx`, etc.) moves unchanged

### Entity detail pages (ship, convoy)

**Current**: `app/(game)/ship/[shipId]/page.tsx` uses `PageContainer`

**New**: `app/(game)/@panel/ship/[shipId]/page.tsx` uses `DetailPanel`

Changes:
- `PageContainer` → `DetailPanel` (with ship/convoy name as title)
- Back links → removed
- Content unchanged

### List pages (fleet, convoys, events, battles)

**Current**: `app/(game)/fleet/page.tsx` uses `PageContainer`

**New**: `app/(game)/@panel/fleet/page.tsx` uses `DetailPanel`

Same pattern — swap wrapper, remove back links, content unchanged.

### Cantina

**Current**: `app/(game)/cantina/page.tsx`

**New**: `app/(game)/@panel/cantina/page.tsx` wrapped in `DetailPanel`

---

## 6. Sidebar Changes

### Nav item href updates

| Current | New | Notes |
|---|---|---|
| `/dashboard` | `/` (or remove) | Dashboard dissolves — stats stay in sidebar |
| `/map` | Remove | Map is always visible, no nav link needed |
| `/cantina` | `/cantina` | Unchanged — opens panel |
| `/fleet` | `/fleet` | Unchanged — opens panel |
| `/convoys` | `/convoys` | Unchanged — opens panel |
| `/events` | `/events` | Unchanged — opens panel |
| `/battles` | `/battles` | Unchanged — opens panel |

### Active state detection

The existing `isActive` function (`pathname === href || pathname.startsWith(href + "/")`) continues to work because panel routes produce real pathnames.

### Logo link

Change from `/dashboard` to `/` (closes any open panel, shows just the map).

### Dashboard stats

The status section (credits, ships, tick) already exists in the sidebar. Dashboard page content (`PlayerSummary`, `ActiveMissionsCard`) is more detailed — for now, these are accessible via the dashboard page. In workstream A we can either:
- Keep a simplified dashboard as a panel (accessible from sidebar)
- Or dissolve it entirely (sidebar stats are sufficient)

**Decision**: Keep dashboard as a panel in workstream A. Dissolving it is a separate task once we determine if any dashboard content is still needed post-notification-system.

---

## 7. Link Updates Across the Codebase

Internal links that point to game pages need auditing. Most will continue to work because URLs don't change — `/system/abc/market` is still `/system/abc/market`, it just renders as a panel now. The key changes:

| Old link | New link | Where used |
|---|---|---|
| `/map` | `/` | Sidebar, any "back to map" links |
| `/map?systemId=X` | `/system/X` (or just `/` if we only want to center) | System detail BackLink, gateway jumps |
| `/dashboard` | `/` or `/dashboard` (if kept as panel) | Sidebar, logo |

Links to `/system/X`, `/ship/X`, `/fleet`, etc. are unchanged.

---

## 8. Implementation Phases

### Phase 1: Routing scaffolding

**Goal**: Parallel route structure works. Map renders at `/`. Empty panel slot works.

Files to create:
- `app/(game)/@panel/default.tsx` → returns `null`
- `app/(game)/@panel/page.tsx` → returns `null`
- `app/(game)/@panel/[...catchAll]/page.tsx` → returns `null`
- `app/(game)/default.tsx` → re-exports `page.tsx`
- `components/ui/detail-panel.tsx` → DetailPanel component

Files to modify:
- `app/(game)/layout.tsx` → add `panel` prop, pass to GameShell
- `components/game-shell.tsx` → add `panel` prop, render in main
- `app/(game)/map/page.tsx` → move to `app/(game)/page.tsx`, remove sidebar collapse, remove `?systemId` param, adjust height
- `components/game-sidebar.tsx` → update logo link from `/dashboard` to `/`

Files to delete:
- `app/(game)/map/page.tsx` (moved, not deleted — becomes `app/(game)/page.tsx`)

**Verify**:
- `npm run build` passes
- Navigate to `/` → map renders, no panel
- Navigate to `/fleet` (old page still exists) → old fleet page still works (parallel route has no match, catch-all returns null, children shows map via soft nav)
- Hard refresh at `/` → map renders

### Phase 2: Migrate system detail (the most complex page)

**Goal**: System pages render as a panel overlay on the map.

Files to create:
- `app/(game)/@panel/system/[systemId]/layout.tsx` → DetailPanel + system header + tabs
- `app/(game)/@panel/system/[systemId]/page.tsx` → system overview content
- `app/(game)/@panel/system/[systemId]/market/page.tsx`
- `app/(game)/@panel/system/[systemId]/ships/page.tsx`
- `app/(game)/@panel/system/[systemId]/convoys/page.tsx`
- `app/(game)/@panel/system/[systemId]/shipyard/page.tsx`
- `app/(game)/@panel/system/[systemId]/shipyard/purchase/page.tsx`
- `app/(game)/@panel/system/[systemId]/shipyard/upgrades/page.tsx`
- `app/(game)/@panel/system/[systemId]/contracts/page.tsx`

Files to modify:
- `components/map/system-detail-panel.tsx` → "View System" button changes href from `/system/[id]` to use `router.push('/system/[id]')`, or stays as Link (Link works with parallel routes)

Files to delete (after verifying panel works):
- `app/(game)/system/[systemId]/layout.tsx`
- `app/(game)/system/[systemId]/page.tsx`
- `app/(game)/system/[systemId]/market/page.tsx`
- `app/(game)/system/[systemId]/ships/page.tsx`
- `app/(game)/system/[systemId]/convoys/page.tsx`
- `app/(game)/system/[systemId]/shipyard/page.tsx`
- `app/(game)/system/[systemId]/shipyard/purchase/page.tsx`
- `app/(game)/system/[systemId]/shipyard/upgrades/page.tsx`
- `app/(game)/system/[systemId]/contracts/page.tsx`

**Verify**:
- Click system on map → quick preview panel opens (tier 1, unchanged)
- Click "View System" → system detail panel opens over the map (tier 2)
- Tab navigation within system panel works (market, ships, etc.)
- Map is visible around the panel edges
- Close panel (× button, Escape, click outside) → returns to map-only view
- Hard refresh at `/system/abc/market` → map + system panel with market tab
- Browser back from `/system/abc` → returns to `/`

### Phase 3: Migrate remaining entities

**Goal**: All game pages render as panel overlays.

Files to create (one page each, wrapped in DetailPanel):
- `app/(game)/@panel/ship/[shipId]/page.tsx`
- `app/(game)/@panel/convoy/[convoyId]/page.tsx`
- `app/(game)/@panel/fleet/page.tsx`
- `app/(game)/@panel/convoys/page.tsx`
- `app/(game)/@panel/events/page.tsx`
- `app/(game)/@panel/battles/page.tsx`
- `app/(game)/@panel/cantina/page.tsx`
- `app/(game)/@panel/dashboard/page.tsx` (kept as panel for now)

Files to delete (old page routes, after verifying):
- `app/(game)/ship/[shipId]/page.tsx`
- `app/(game)/convoy/[convoyId]/page.tsx`
- `app/(game)/fleet/page.tsx`
- `app/(game)/convoys/page.tsx`
- `app/(game)/events/page.tsx`
- `app/(game)/battles/page.tsx`
- `app/(game)/cantina/page.tsx`
- `app/(game)/dashboard/page.tsx`

**Verify**:
- Each panel opens correctly from sidebar nav
- Each panel closes correctly (×, Escape, click outside)
- Internal links between panels work (e.g., clicking a ship in system panel → ship panel)
- Browser back/forward works across panel navigations

### Phase 4: Sidebar + navigation cleanup

**Goal**: Sidebar reflects the new architecture. Dead nav items removed.

Files to modify:
- `components/game-sidebar.tsx`:
  - Remove "Dashboard" nav item (or change to open dashboard panel)
  - Remove "Star Map" nav item (map is always visible)
  - Logo links to `/`
  - Possibly default sidebar to collapsed (since map is primary)
- `components/map/system-detail-panel.tsx`:
  - Update "View System" href (if not already done in phase 2)
  - Remove any links that referenced `/map?systemId=X` pattern
- Audit and update all internal links across components that reference old routes

**Verify**:
- All sidebar links open correct panels
- No broken links anywhere in the app
- Logo click returns to map-only view

### Phase 5: Polish

**Goal**: Smooth transitions, visual coherence.

Tasks:
- Add panel open/close CSS transitions (fade + subtle scale)
- Add map auto-pan when system panel opens (center the selected system, offset for panel)
- Add system highlight on map when system panel is open (pulsing ring or selection indicator via a `highlightedSystemId` prop on StarMap)
- Hide `SystemDetailPanel` (tier 1 quick preview) when a tier 2 panel is open for the same system
- Test responsive behavior at different viewport sizes
- Verify keyboard navigation (Escape closes panel, Tab works within panel)
- Performance check — map stays smooth while panel is open

---

## 9. Risk Areas

| Risk | Mitigation |
|---|---|
| `default.tsx` re-export causes SSR issues (map component is `"use client"`) | Test hard navigation early in phase 1. Client components in `default.tsx` should work fine. |
| Stale panel content on soft nav | `[...catchAll]` in `@panel` handles this. Test edge cases. |
| Map state resets when children re-renders | Soft navigation preserves children — map should stay mounted. Verify in phase 2. |
| Tab links in system panel conflict with parallel route matching | Tab hrefs like `/system/abc/market` should match `@panel/system/[systemId]/market/page.tsx`. Test carefully. |
| `usePathname()` behavior with parallel routes | Pathname reflects the full URL regardless of which slot is active. Tab active detection should work unchanged. |
| Search params (`?shipId`, `?convoyId`) on the map page | These stay on the root URL. Test that `useSearchParams()` works correctly in the map component rendered from both `page.tsx` and `default.tsx`. |
| `useSelectedLayoutSegment('panel')` for conditional UI | Need to verify this works for detecting if a panel is open (e.g., to hide the map quick-preview). |
