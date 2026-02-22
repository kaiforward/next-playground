# Universe & Map

The game world — star systems, regions, connections, traits, and how players navigate the map.

---

## Universe Structure

### Scale
- **600 systems** across 24 regions (25 systems per region)
- **7000x7000** coordinate space (usable area ~4900² via Poisson-disc sampling with 800 minimum region distance)
- Procedurally generated from a fixed seed (deterministic — same seed always produces the same universe)
- Generated once at database seed, then immutable

### Regions

24 regions placed via Poisson-disc sampling. Each region is a geographic cluster with a neutral identity — names come from a flat pool of generic space names (Arcturus, Meridian, Vanguard, etc.), not themed by economy type.

Each region has:
- **Name**: From a pool of 28 generic space names, picked sequentially. Suffix `-N` on collision
- **Government type**: One of 4 types (federation, corporate, authoritarian, frontier), assigned with uniform 25% distribution. Coverage guarantee ensures all 4 types appear
- **Dominant economy**: The most common economy type among the region's systems, computed at seed time and stored on the Region model. Displayed as a subtitle on the map (e.g., "Arcturus — Extraction")

### System Traits

Every system has **2–4 traits** — permanent physical properties (stars, planets, moons, orbital features, resource deposits, anomalies) that define the system's character and economic potential. 45 traits across 5 categories: planetary, orbital, resource, phenomena, legacy.

Each trait has:
- **Quality tier** (1–3): Marginal, Solid, Exceptional. Rolled at generation with rarity weights: 50% tier 1, 35% tier 2, 15% tier 3
- **Economy affinity**: Per-economy-type scores (0 = irrelevant, 1 = minor, 2 = strong). Only strong affinities (value 2) drive economy derivation
- **Production goods**: Which goods the trait boosts production of. Quality tier scales the modifier magnitude (+15% at tier 1, +40% at tier 2, +80% at tier 3)

**Trait generation**: The first trait is guaranteed to have at least one strong (value 2) economy affinity, ensuring every system has a clear economy signal. Remaining traits are drawn from the full pool with uniform weights. No duplicate traits on a system.

**Strong affinity balance**: 45 traits distribute strong affinities evenly across 6 economy types (5–6 strong affinities each: tech 6, agricultural 6, extraction 5, industrial 5, refinery 5, core 5). This produces naturally even economy distributions without enforcement.

### Economy Derivation

Economy type is derived bottom-up from traits, not assigned directly:

```
For each economy type:
  score = sum of (quality) for all system traits WHERE trait affinity for that type === 2

Winner = economy type with highest score
Tiebreaker = seeded random selection
```

Minor affinities (value 1) do not influence economy derivation — they affect production modifiers and serve as secondary connections. This keeps the economy signal clean.

### Systems

Each system has:
- **Name**: Region-based naming (e.g., "Nexus-1-7")
- **Economy type**: One of 6 types (agricultural, extraction, refinery, industrial, tech, core), derived from trait affinities
- **Traits**: 2–4 system traits with quality tiers
- **Coordinates**: Fixed position within region scatter radius (875 units from center)
- **Station**: Exactly one station with a market carrying all 12 goods
- **Gateway flag**: 1-2 systems per region pair serve as inter-region connection points

### Connections
- **Intra-region**: Minimum spanning tree ensures all systems in a region are connected, plus ~50% extra edges for route variety
- **Inter-region**: MST on region centers plus bonus edges, connecting via gateway systems
- **All bidirectional**: Every connection works in both directions
- **~1778 connections** at 600 systems
- **Fuel cost**: Distance-scaled. Intra-region ~1-10 fuel per hop. Inter-region (gateway) 2.5x multiplier (~15-25 fuel)

---

## Map Display

### Dual-Level View

**Region View (default)**:
- 24 region nodes at their coordinates, neutral slate palette
- Shows: region name, dominant economy (coloured EconomyBadge), system count, docked ship count
- Inter-region connections shown as dashed lines
- Click a region to drill into system view

**System View (filtered to one region)**:
- 25 systems displayed at their coordinates, neutral node styling
- Shows: system name, economy type (EconomyBadge), docked ship count, active event badges
- Intra-region connections with fuel cost labels
- Click a system for full detail page

### Map Side Panel

When a system is selected on the map, the side panel shows:
- System name, economy type, region, government
- Compact trait list (top trait with quality stars, trait count)
- Docked ships and active events

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

## System Detail Page

When viewing a system, the detail page shows:
- System name, economy type badge, region name, government type
- **Traits section**: All traits with quality stars (★★☆ for quality 2), name, and quality-appropriate description
- Market, Missions, and Activity tabs

---

## Starting Position

New players spawn at a core-economy system in the region closest to the map center — a neutral starting point with balanced trading opportunities. Selection: find the region closest to (mapSize/2, mapSize/2), pick core economy systems, choose the one closest to the region center. Fallback: closest system to region center regardless of economy.

---

## Planned Changes

The current 600-system universe is a foundation. The faction system design targets 1,000-2,000 systems with region-based map rendering to handle the increased scale. Key changes:

- **Faction territory**: Systems will belong to factions, with colored territory visualization
- **Government migration**: Government type moves from per-region to per-faction (see [faction-system.md](../planned/faction-system.md) §1)
- **Dynamic borders**: Territory changes hands through wars, visually reflected on the map
- **Faction influence on economy**: Controlling faction's government can nudge economy derivation on close calls (see [system-enrichment.md](../planned/system-enrichment.md) §2.2)
- **Facilities**: Faction-owned strategic infrastructure seeded at systems based on traits (see [system-enrichment.md](../planned/system-enrichment.md) §5)
- **Scale increase**: More systems to accommodate faction territory needs (see [faction-system.md](../planned/faction-system.md) §7)

---

## System Interactions

- **Traits → Economy**: Trait affinities determine economy type. Trait quality scales production rates per good via the economy processor (see [economy.md](./economy.md))
- **Government → Economy**: Region government type determines market modifiers (volatility, equilibrium, taxes). See [economy.md](./economy.md)
- **Navigation**: Connection graph defines travel routes and fuel costs. Gateway systems are strategic chokepoints (see [navigation.md](./navigation.md))
- **Events**: Events spawn at specific systems based on economy type and affect neighboring systems via spread (see [events.md](./events.md))
- **Faction system** (planned): Factions will control systems, with government type tied to faction rather than region (see [faction-system.md](../planned/faction-system.md))
