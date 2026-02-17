# Universe & Map

The game world — star systems, regions, connections, and how players navigate the map.

---

## Universe Structure

### Scale
- **200 systems** across 8 regions (25 systems per region)
- **4000x4000** coordinate space
- Procedurally generated from a fixed seed (deterministic — same seed always produces the same universe)
- Generated once at database seed, then immutable

### Regions
8 regions, each a geographic cluster with a thematic identity:

| Identity | Count | Economy Focus |
|---|---|---|
| Trade Hub | 2 | 40% core, balanced mix of all types |
| Resource Rich | 2 | 30% extraction, balanced consumption |
| Industrial | 2 | 30% industrial, 20% refinery |
| Tech | 1 | 35% tech, 20% core |
| Agricultural | 1 | 35% agricultural, balanced consumption |

Each region has a government type (federation, corporate, authoritarian, or frontier) assigned with weighted randomness based on identity. The seed guarantees all 4 government types appear across the 8 regions.

### Systems
Each system has:
- **Name**: Region-based naming (e.g., "Nexus-1-7")
- **Economy type**: One of 6 types, weighted by region identity
- **Coordinates**: Fixed position within region scatter radius (875 units from center)
- **Station**: Exactly one station with a market carrying all 12 goods
- **Gateway flag**: 1-2 systems per region pair serve as inter-region connection points

### Connections
- **Intra-region**: Minimum spanning tree ensures all systems in a region are connected, plus ~50% extra edges for route variety
- **Inter-region**: MST on region centers (~7 edges) plus ~2 bonus edges, connecting via gateway systems
- **All bidirectional**: Every connection works in both directions
- **~270 bidirectional pairs** (~540 directed edges total)
- **Fuel cost**: Distance-scaled. Intra-region ~1-10 fuel per hop. Inter-region (gateway) 2.5x multiplier (~15-25 fuel)

---

## Map Display

### Dual-Level View

**Region View (default)**:
- 8 region nodes at their coordinates
- Shows: region name, system count, docked ship count
- Inter-region connections shown as dashed lines
- Click a region to drill into system view

**System View (filtered to one region)**:
- 25 systems displayed at their coordinates
- Shows: system name, economy type (color), docked ship count, active event badges
- Intra-region connections with fuel cost labels
- Click a system for full detail page

### Navigation Mode
When planning a route:
- **Origin**: Ship's current system (solid outline)
- **Reachable**: Systems the ship can reach with current fuel (normal display)
- **Unreachable**: Systems beyond fuel range (dimmed)
- **Route preview**: Selected path highlighted with estimated fuel cost and travel duration

### State Persistence
- Last viewed region and selected system stored in session
- URL params allow direct linking (`?systemId=abc`)

---

## Starting Position

New players spawn at the closest core-economy system in a trade hub region — a neutral starting point with balanced trading opportunities.

---

## Planned Changes

The current 200-system universe is a prototype. The faction system design targets 1,000-2,000 systems with region-based map rendering to handle the increased scale. Key changes:

- **Region-first map**: Region view becomes the strategic overview, system view shows one region at a time
- **Faction territory**: Systems will belong to factions, with colored territory visualization
- **Dynamic borders**: Territory changes hands through wars, visually reflected on the map
- **More regions**: Regions will increase to accommodate faction territory needs

See [faction-system.md](../planned/faction-system.md) §8 for system scale details.

---

## System Interactions

- **Economy**: Region government type determines market modifiers (volatility, equilibrium, taxes). Economy type determines production/consumption (see [economy.md](./economy.md))
- **Navigation**: Connection graph defines travel routes and fuel costs. Gateway systems are strategic chokepoints (see [navigation.md](./navigation.md))
- **Events**: Events spawn at specific systems based on economy type and affect neighboring systems via spread (see [events.md](./events.md))
- **Faction system** (planned): Factions will control regions/systems, with government type tied to faction rather than region (see [faction-system.md](../planned/faction-system.md))
