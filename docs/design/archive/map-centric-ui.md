# Map-Centric UI Architecture

Restructure the game so the star map is the persistent base layer and all detail screens render as non-modal dialog panels overlaying the map. Replaces the current multi-page navigation model with a map-always-visible approach inspired by Stellaris/EU4.

**Replaces**: Current separate page routes (`/dashboard`, `/system/[id]`, `/ship/[id]`, `/fleet`, `/convoys`, `/events`, `/battles`) as distinct full-page navigations away from the map.

**Depends on**: Nothing — this is a foundational layout change. [notification-system.md](./notification-system.md) adapts to the final layout.

---

## 1. Core Concept

The game has three persistent UI layers:

```
┌──────────┬──────────────────────────────────────┐
│          │                                      │
│ Sidebar  │            Star Map                  │
│ (nav +   │         (always mounted)             │
│  status) │                                      │
│          │     ┌──────────────────────────┐     │
│          │     │                          │     │
│          │     │      Detail Panel        │     │
│          │     │   (non-modal dialog)     │     │
│          │     │    ~70-80% viewport      │     │
│          │     │                          │     │
│          │     └──────────────────────────┘     │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

**Layer 1 — Sidebar**: Always visible. Navigation, player status (credits, fleet count, tick), notification bell indicator. Collapsible as today.

**Layer 2 — Star Map**: Always mounted, never unmounts during gameplay. Pan, zoom, click systems, view regions. The existing map quick-preview panel (system detail sidebar) stays as a lightweight "tier 1" interaction.

**Layer 3 — Detail Panel**: Non-modal `<dialog>` centered over the map. Large enough (~70-80% viewport) for complex content (system market tables, ship detail, fleet lists). Map visible around the edges for spatial context. Click outside or press Escape to close. One panel open at a time.

---

## 2. Two-Tier System Interaction

**Tier 1 — Quick preview** (existing map sidebar):
- Click a system node on the map
- Existing `SystemDetailPanel` slides in on the right
- Shows: system name, economy, traits, gateway info, fleet presence, active events summary
- Lightweight, no route change, client-side state only
- "Open" button or double-click to escalate to tier 2

**Tier 2 — Full detail panel** (new):
- Opens the system's full detail as a non-modal dialog centered on the map
- Contains all current system sub-pages: overview, market, ships, convoys, shipyard, contracts
- Tabbed layout within the panel (same tabs as current system layout)
- URL-addressable via Next.js parallel routes

---

## 3. Next.js Routing Architecture

### Parallel routes with a named slot

The `@panel` slot renders overlay content while the map remains the base page:

```
app/(game)/
  layout.tsx              ← GameShell: sidebar + providers
  page.tsx                ← Star map (always rendered as base)
  @panel/
    default.tsx           ← Returns null (no panel open)
    system/[systemId]/
      layout.tsx          ← Panel shell with system tabs
      page.tsx            ← System overview (current system/[systemId]/page.tsx content)
      market/page.tsx     ← Market tab
      ships/page.tsx      ← Ships at system tab
      convoys/page.tsx    ← Convoys at system tab
      shipyard/
        page.tsx          ← Shipyard hub
        purchase/page.tsx
        upgrades/page.tsx
      contracts/page.tsx  ← Missions/contracts tab
    ship/[shipId]/
      page.tsx            ← Ship detail (current ship/[shipId]/page.tsx content)
    convoy/[convoyId]/
      page.tsx            ← Convoy detail
    fleet/
      page.tsx            ← Fleet overview
    convoys/
      page.tsx            ← All convoys
    events/
      page.tsx            ← Events screen (with FilterBar)
    battles/
      page.tsx            ← Active battles
    log/
      page.tsx            ← Captain's log
    cantina/
      page.tsx            ← Void's Gambit mini-game
```

### How navigation works

- **Sidebar links** navigate to panel routes: clicking "Fleet" in sidebar navigates to `/fleet`, which fills the `@panel` slot with fleet content while the map stays rendered
- **Map system click → tier 2**: navigates to `/system/[id]`, which fills the `@panel` slot
- **Close panel**: navigates back (or to `/` base route), `@panel` slot returns to `default.tsx` (null)
- **Deep links work**: navigating directly to `/system/abc123/market` renders the map + system panel on market tab
- **Browser back/forward**: natural — closing and reopening panels follows browser history

### URL structure

Current → New:
- `/dashboard` → `/` (map is home, dashboard stats in sidebar)
- `/map` → `/` (map is the base, always visible)
- `/system/[id]` → `/system/[id]` (same URL, now renders as panel overlay)
- `/system/[id]/market` → `/system/[id]/market` (same, panel with market tab)
- `/ship/[id]` → `/ship/[id]` (panel overlay)
- `/fleet` → `/fleet` (panel overlay)
- `/convoys` → `/convoys` (panel overlay)
- `/events` → `/events` (panel overlay)
- `/battles` → `/battles` (panel overlay)
- `/cantina` → `/cantina` (panel overlay)

---

## 4. Detail Panel Component

A shared `DetailPanel` wrapper that all panel routes render inside:

### Behavior
- **Rendering**: Non-modal `<dialog>` using `.show()` (not `.showModal()`)
- **Positioning**: Centered in the map area (offset by sidebar width)
- **Sizing**: ~70-80% of available viewport, max-width/max-height capped, responsive
- **Backdrop**: None — no dimming layer. Map fully visible around edges.
- **Close**: Escape key, close button (top-right), or click outside the panel
- **Close action**: Router navigation back to `/` (clears `@panel` slot)
- **Scroll**: Panel content scrolls independently (overflow-y-auto on panel body)
- **Animation**: Subtle fade-in/scale-up on open, reverse on close

### Anatomy
```
┌─ Detail Panel ─────────────────────────────────┐
│  [Title]                              [× Close] │
│  [Tab bar — if applicable]                      │
│ ┌─────────────────────────────────────────────┐ │
│ │                                             │ │
│ │  Panel content                              │ │
│ │  (scrollable)                               │ │
│ │                                             │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- **Title area**: Entity name (system name, ship name, "Fleet", etc.) + optional subtitle
- **Tab bar**: For entities with sub-views (system has overview/market/ships/etc.)
- **Content area**: Scrollable body, renders the page component content
- **Close button**: Top-right, always visible

---

## 5. Sidebar Changes

### Dashboard integration

Current dashboard content is redistributed:

- **Player status** (credits, ship count, active missions count): stays in sidebar status section, always visible — this replaces the dashboard page
- **Active missions summary**: accessible via sidebar "Missions" link → missions panel
- **Quick stats/graphs**: if any remain, add a "Stats" panel accessible from sidebar

### Navigation updates

Sidebar nav items open panels instead of navigating to separate pages:

- Dashboard → removed (stats in sidebar, detail in panels)
- Star Map → removed (map is always visible, no need for a link to it)
- Cantina → opens cantina panel
- Fleet → opens fleet panel
- Convoys → opens convoys panel
- Events → opens events panel
- Battles → opens battles panel
- Log → opens captain's log panel (new)

### Notification bell

Moves from `TopBar` to sidebar header area (or remains in a minimal top bar if retained).

---

## 6. Map Integration

### Existing behaviors preserved
- Region overview ↔ system drill-down (two-level view)
- Navigation mode (unit select → route preview → confirm)
- System quick-preview panel (tier 1 — stays as-is)
- Route preview panel (bottom center — stays as-is)
- Session persistence (remember last region/system view)

### New behaviors
- **System click → panel**: Double-click or "Open" button in quick preview navigates to `/system/[id]`, opening the detail panel. Single click still shows quick preview.
- **Ship click in panel → ship panel**: Clicking a ship name in the system panel navigates to `/ship/[id]`, swapping the panel content.
- **Map auto-pan**: When opening a system/ship panel, optionally pan the map to center the relevant system (with the panel offset accounted for).
- **Panel ↔ map context**: The panel could highlight the relevant system on the map (pulsing ring or selection indicator) so the player always knows where they're looking.

---

## 7. TopBar Changes

The current `TopBar` (breadcrumbs + bell icon) is simplified or removed:

- **Breadcrumbs**: No longer needed — the panel title shows what you're looking at, and the map provides spatial context
- **Bell icon**: Moves to sidebar header
- **Result**: TopBar can be removed entirely, or reduced to a minimal strip if needed for future features

---

## 8. Migration Strategy

### Phase 1: Routing restructure
- Set up parallel route structure (`@panel` slot)
- Create `DetailPanel` shell component
- Move map to be the base `page.tsx` under `app/(game)/`
- Create `@panel/default.tsx` (returns null)

### Phase 2: Migrate system detail
- Move `system/[systemId]` pages into `@panel/system/[systemId]/`
- Wrap in `DetailPanel`
- Verify tabs, data fetching, and interactions work within the panel
- Wire tier 1 → tier 2 transition (quick preview "Open" → panel route)

### Phase 3: Migrate remaining entities
- Ship detail → `@panel/ship/[shipId]/`
- Convoy detail → `@panel/convoy/[convoyId]/`
- Fleet → `@panel/fleet/`
- Convoys list → `@panel/convoys/`
- Events → `@panel/events/`
- Battles → `@panel/battles/`
- Cantina → `@panel/cantina/`

### Phase 4: Dashboard dissolution
- Move player stats into sidebar status section
- Remove `/dashboard` page
- Update sidebar nav (remove Dashboard and Star Map links)

### Phase 5: Polish
- Remove TopBar (or reduce to minimal)
- Add panel open/close animations
- Add map auto-pan on panel open
- Add system highlight when panel is open for a system
- Test all deep links and browser history behavior
- Verify SSR rendering for direct URL access

---

## 9. Renderer Independence

This architecture is **renderer-agnostic** — the star map component is a self-contained layer that the panel system overlays on top of. Whether the map uses React Flow, custom SVG, Pixi.js, or any other renderer, the panel system works the same way. The map renderer swap (separate workstream) can happen before, after, or in parallel with this UI restructure.

The only contract between the map and the panel system:
- Map exposes system click handlers (single-click → quick preview, double-click → navigate to panel route)
- Map accepts a `highlightedSystemId` prop for panel-context highlighting
- Map respects the sidebar width for centering calculations
