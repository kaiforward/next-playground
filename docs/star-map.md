# Stream 4: Star Map UI

## Overview

Interactive star map built with React Flow (`@xyflow/react` v12). Two-level view: **region overview** (~8 aggregate nodes) and **system detail** (~25 nodes within one region). Players can view the galaxy, see ship positions, and navigate ships between systems via multi-hop route planning.

## Components

### `components/map/star-map.tsx`

The main canvas component. Manages two view levels:

**Region view (zoomed out):**
- Each region renders as a `RegionNode` showing: region name, identity, system count, ship count
- Inter-region gateway connections shown as edges between region nodes
- ~8 nodes — trivially fast to render
- Clicking a region transitions to system view for that region

**System view (zoomed in):**
- Shows all ~25 systems within one region as `SystemNode` components
- Intra-region connections with fuel cost labels
- Gateway systems have distinct styling and show connections to other regions
- Navigation mode operates within this view
- Back button returns to region view

Additional responsibilities:
- Deduplicates bidirectional connections into single edges with fuel cost labels
- Integrates `useNavigationState` hook for 3-phase navigation flow
- Dynamic node styling (navigation state variants) and edge styling (route highlighting)
- Accepts `initialSelectedShipId` prop to auto-enter navigation mode from URL
- Dark theme with dot background, styled controls, and colour-coded minimap

**Important:** `nodeTypes` is defined outside the component to prevent infinite re-renders (React Flow compares by reference).

### `components/map/region-node.tsx`

Custom React Flow node for region-level view. Shows region name, economic identity with colour coding, system count, and ship count badge. Identity colours match the economy type palette.

### `components/map/system-node.tsx`

Custom React Flow node using `tailwind-variants` for economy-type colour coding:

| Economy | Colour |
|---|---|
| Agricultural | Green |
| Mining | Amber |
| Industrial | Slate |
| Tech | Blue |
| Core | Purple |

Shows system name, economy type label, and a pulsing ring animation when the player has ships there.

**Navigation state variants** — applied during navigation mode:

| State | Visual |
|---|---|
| `origin` | Cyan ring + scale up |
| `reachable` | Bright border, hover scale |
| `unreachable` | Dimmed (opacity-30), grayscale, no pointer |
| `route_hop` | Sky-blue ring (intermediate stops) |
| `destination` | Emerald ring + scale up |

### `components/map/system-detail-panel.tsx`

Fixed right sidebar (320px) that appears when a system is selected:
- System name, economy type badge, description, coordinates
- "Your Ships Here" list with **Navigate** and **Trade** buttons per ship
- Navigate button triggers the navigation state machine (ship-first flow)
- Hidden during active navigation mode

### `components/map/route-preview-panel.tsx`

Bottom-centre overlay shown during `route_preview` phase:
- Ship name and destination
- Hop-by-hop breakdown (system names, per-hop fuel cost and tick duration)
- Totals: fuel used / current fuel, total travel ticks
- Confirm and Cancel buttons

## Navigation Flow

Multi-hop navigation uses a 3-phase state machine (`lib/hooks/use-navigation-state.ts`):

1. **Default** — Normal map interaction. Click a system to open the detail panel.
2. **Ship Selected** — Player clicked "Navigate" on a ship. All reachable systems are highlighted, unreachable systems are dimmed. A banner shows the selected ship. Click a reachable system to preview the route, or Cancel.
3. **Route Preview** — Optimal path computed via Dijkstra. Route edges highlighted on the map. Route preview panel shows hop-by-hop breakdown. Confirm sends the ship, Cancel returns to ship selection.

Deep linking: `/map?shipId=X` auto-enters navigation mode for ship X on load.

## Data Flow

1. `app/(game)/map/page.tsx` fetches universe data via `useUniverse()` and fleet via `useFleet()`
2. Reads `?shipId` from URL search params for deep linking
3. Passes data to `StarMap` along with `onNavigateShip(shipId, route)` callback
4. On navigate: POSTs `{ route }` to `/api/game/ship/[shipId]/navigate`, invalidates fleet query on success
5. Ship positions and navigation states update nodes in real-time via `useMemo`
6. Region utilities (`lib/utils/region.ts`) handle filtering connections and systems by region

## Layout

**Region view:** Regions are positioned using their center coordinates from the seed data. `fitView` shows all regions.

**System view:** Systems within a region are positioned using their x/y coordinates. `fitView` scopes to the selected region's systems. Gateway systems are visually distinct and positioned at region borders.

**Utilities** (`lib/utils/region.ts`):
- `buildSystemRegionMap` — Maps system IDs to their region
- `getIntraRegionConnections` — Connections within a single region
- `getInterRegionConnections` — Gateway connections between regions
- `getGatewayTargetRegions` — Which regions a gateway system connects to
