# UI Overhaul — Overview Plan

Three interconnected workstreams that transform the game from a multi-page web app into a map-centric browser game with proper information management.

## Execution Order

```
Workstream A              Workstream B              Workstream C
Map-Centric UI            Map Renderer              Notifications & Data
────────────────          ────────────────          ────────────────
  Parallel routes           Pixi.js setup             Schema + service
  Detail panel shell        Camera system             Notification feed
  Migrate system detail     System view               Captain's log
  Migrate remaining pages   Region view               FilterBar component
  Dashboard dissolution     Navigation visuals         List screen rebuilds
  Polish + cleanup          Polish + cleanup           Cleanup old system
────────────────          ────────────────          ────────────────
        │                       │                         │
        └──── A first ──────────┘                         │
              B second ───────────────────────────────────┘
                                C third ──────────────────┘
```

### Why this order

**A first (Map-Centric UI)**: Foundational layout change. Establishes the game shell (map as base, parallel routes, detail panel component) that everything else builds on. The notification feed needs to know where it lives. The renderer swap needs the map to be the persistent base layer.

**B second (Map Renderer)**: Once the map is always visible, React Flow's limitations become more noticeable. Swapping the renderer while the layout is fresh and before building more features on top minimizes rework. The map-centric architecture is explicitly renderer-agnostic — the panel system doesn't care what draws the map.

**C third (Notifications & Data)**: Builds on both previous workstreams. Notification feed drops into the sidebar from A. Captain's log and list screens render as panels from A. The always-visible map from B means notifications can reference spatial context naturally.

Each workstream is independently shippable — the game works after each one.

## Design Docs

Detailed specs for each workstream:

| Workstream | Design doc | Key decisions |
|---|---|---|
| A — Map-Centric UI | [map-centric-ui.md](../planned/map-centric-ui.md) | Parallel routes (`@panel` slot), non-modal detail panel, two-tier system interaction, dashboard dissolution |
| B — Map Renderer | [map-renderer.md](../planned/map-renderer.md) | Pixi.js v8, procedural visuals (no assets), parallax starfield, glow effects, particle route animation |
| C — Notifications | [notification-system.md](../planned/notification-system.md) | Three-tier model (feed → log → list screens), server-persisted `PlayerNotification`, shared FilterBar pattern |

## Scope Summary

### What changes
- Game layout: multi-page → map-centric with overlay panels
- Map renderer: React Flow → Pixi.js (WebGL)
- Notifications: toasts → bell feed + persistent captain's log
- List screens: basic lists → filterable/searchable with shared pattern
- Dashboard: separate page → stats integrated into sidebar
- TopBar: breadcrumbs + bell → simplified or removed

### What doesn't change
- Game engine (`lib/engine/`) — untouched
- Services layer (`lib/services/`) — untouched
- API routes (`app/api/`) — untouched (one new endpoint for log)
- Data fetching hooks — preserved, just consumed differently
- Tick engine and SSE pipeline — preserved
- Auth system — untouched
- Cantina / mini-games — migrated to panel, content unchanged

## Estimated Complexity

| Workstream | New files | Modified files | Deleted files | Risk |
|---|---|---|---|---|
| A — Map-Centric UI | ~8 (layout, panel shell, defaults) | ~15 (move pages to panel routes) | ~3 (old pages) | Medium — routing restructure, verify all navigation paths |
| B — Map Renderer | ~12 (Pixi components, layers, objects) | ~3 (star-map, use-map-data) | ~3 (React Flow nodes, use-map-graph) | Medium — new rendering paradigm, visual tuning |
| C — Notifications | ~8 (model, service, API, feed, log, FilterBar) | ~10 (existing list screens, sidebar, SSE pipeline) | ~3 (toast container, activity panel) | Low — well-defined patterns, incremental migration |
