# Stream 4: Star Map UI

## Overview

Interactive star map built with React Flow (`@xyflow/react` v12). Players can view the galaxy, see their current location, and navigate between connected systems.

## Components

### `components/map/star-map.tsx`

The main canvas component. Responsibilities:
- Converts `UniverseData` (systems + connections) into React Flow nodes and edges
- Deduplicates bidirectional connections into single edges with fuel cost labels
- Manages selected system and player location state
- Calls `onNavigate` prop when the player clicks "Navigate Here"
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

Shows system name, economy type label, and a pulsing ring animation when the player is at that system.

### `components/map/system-detail-panel.tsx`

Fixed right sidebar (320px) that appears when a system is selected:
- System name, economy type badge, description, coordinates
- "Navigate Here" button (disabled if already there)
- Close button

## Data Flow

1. `app/(game)/map/page.tsx` fetches universe data via `useUniverse()` hook and player state via `usePlayer()` hook
2. Passes data to `StarMap` along with an `onNavigate` callback
3. On navigate: POSTs to `/api/game/navigate`, refreshes player state on success
4. Player location updates the node highlight in real-time via `useMemo`

## Star System Layout

Systems are positioned on a 2D canvas using their x/y coordinates from the seed data. The map uses `fitView` with 0.3 padding to show all systems on load.
