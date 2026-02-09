# Stream 4: Star Map UI

## Overview

Interactive star map built with React Flow (`@xyflow/react` v12). Players can view the galaxy, see ship positions, and navigate ships between systems via multi-hop route planning.

## Components

### `components/map/star-map.tsx`

The main canvas component. Responsibilities:
- Converts `UniverseData` (systems + connections) into React Flow nodes and edges
- Deduplicates bidirectional connections into single edges with fuel cost labels
- Manages selected system state and navigation mode
- Integrates `useNavigationState` hook for 3-phase navigation flow
- Dynamic node styling (navigation state variants) and edge styling (route highlighting)
- Accepts `initialSelectedShipId` prop to auto-enter navigation mode from URL
- Dark theme with dot background, styled controls, and colour-coded minimap

**Important:** `nodeTypes` is defined outside the component to prevent infinite re-renders (React Flow compares by reference).

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
4. On navigate: POSTs `{ route }` to `/api/game/ship/[shipId]/navigate`, refreshes fleet on success
5. Ship positions and navigation states update nodes in real-time via `useMemo`

## Star System Layout

Systems are positioned on a 2D canvas using their x/y coordinates from the seed data. The map uses `fitView` with 0.3 padding to show all systems on load.
