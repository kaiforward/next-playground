# Universe & Map

The game world — star systems, regions, connections, traits, and how players navigate the map.

---

## Universe Structure

### Scale
- Configurable via `UNIVERSE_SCALE` env var. The goal is to scale as high as possible. Current presets:
  - **default**: 600 systems / 24 regions / 7,000×7,000 map (small, for quick testing)
  - **10k**: ~10,000 systems / 60 regions / 25,000×25,000 map (target production scale)
- Generation parameters (region count, system count, map size, Poisson distances) scale with the preset
- Procedurally generated from a fixed seed (deterministic — same seed always produces the same universe)
- Generated once at database seed, then immutable

### Regions

Regions placed via Poisson-disc sampling (count scales with preset). Each region is a geographic cluster with a neutral identity — names come from a flat pool of 28 generic space names (Arcturus, Meridian, Vanguard, etc.), not themed by economy type. At >28 regions, names are recycled with a `-N` suffix.

Each region has:
- **Name**: From a pool of 28 generic space names, picked sequentially. Suffix `-N` when pool is exhausted
- **Government type**: One of 4 types (federation, corporate, authoritarian, frontier), assigned with uniform 25% distribution. Coverage guarantee ensures all 4 types appear
- **Dominant economy**: The most common economy type among the region's systems, computed at seed time and stored on the Region model. Displayed as a subtitle on the map (e.g., "Arcturus — Extraction")

### System Traits

Every system has **2–4 traits** — permanent physical properties (stars, planets, moons, orbital features, resource deposits, anomalies) that define the system's character and economic potential. 52 traits across 5 categories: planetary, orbital, resource, phenomena, legacy.

Each trait has:
- **Quality tier** (1–3): Marginal, Solid, Exceptional. Rolled at generation with rarity weights: 50% tier 1, 35% tier 2, 15% tier 3
- **Economy affinity**: Per-economy-type scores (0 = irrelevant, 1 = minor, 2 = strong). Only strong affinities (value 2) drive economy derivation
- **Production goods**: Which goods the trait boosts production of. Quality tier scales the modifier magnitude (+15% at tier 1, +40% at tier 2, +80% at tier 3)

**Trait generation**: The first trait is guaranteed to have at least one strong (value 2) economy affinity, ensuring every system has a clear economy signal. Remaining traits are drawn from the full pool with uniform weights. No duplicate traits on a system.

**Strong affinity balance**: 52 traits distribute strong affinities evenly across 6 economy types (5–6 strong affinities each: agricultural 6, tech 6, extraction 5, refinery 5, industrial 5, core 5). This produces naturally even economy distributions without enforcement.

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
- **Coordinates**: Fixed position via Poisson-disc sampling, assigned to nearest region
- **Station**: Exactly one station with a market carrying all 12 goods
- **Gateway flag**: 1-2 systems per region pair serve as inter-region connection points

### Connections
- **Intra-region**: Minimum spanning tree ensures all systems in a region are connected, plus ~50% extra edges for route variety
- **Inter-region**: MST on region centers plus bonus edges, connecting via gateway systems
- **All bidirectional**: Every connection works in both directions
- Connection count scales with system count (~1,778 at 600 systems)
- **Fuel cost**: Distance-scaled. Intra-region ~1-10 fuel per hop. Inter-region (gateway) 2.5x multiplier (~15-25 fuel)

---

## Map Display

### Two-Tier Rendering Pipeline

The map uses a WebGL canvas (Pixi.js) with two rendering tiers that crossfade based on zoom level:

**Point cloud tier (universe zoom, <0.3)**:
- All systems rendered as lightweight dots from atlas data (loaded once at mount, covers entire universe)
- Voronoi-derived region boundaries with territory fills and player presence highlighting
- Region name labels at each region's centroid
- Fleet presence dots — prominent glowing markers at systems where the player has ships

**Detail tier (system zoom, >0.4)**:
- Tile-based viewport loading — only systems in visible tiles are fetched from the API
- Full SystemObject rendering with economy-colored cores, glow effects, and hit areas
- System names, economy badges, ship counts, event indicator dots
- Connection lines between systems (dashed for intra-region, solid for gateway/route) with fuel cost labels
- Effect layer: route particles and pulse ring animations

**Crossfade (0.3–0.4)**: Smooth alpha transition between tiers using cubic smoothstep. SystemObject creation begins slightly before the crossfade (zoom 0.28) so objects are ready when they fade in.

**LOD within detail tier**: Additional smoothstep fades control progressive disclosure — system names (0.45–0.55), event dots (0.5–0.6), economy/ship/fuel labels (0.6–0.7), glow effects (>0.45).

**Background**: Parallax starfield with 3 depth layers, independent of the world container.

**Performance**: Frustum culling skips off-screen systems and connections each frame. SystemObjects are created on demand (batched per frame) and hidden on deactivation rather than destroyed — constructor cost is high (~10 display objects each). Viewport change callbacks are throttled to avoid 60 setState calls/sec during pan/zoom.

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
- Selected system and camera position stored in session
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

The configurable universe and tile-based map renderer are in place — scale ceiling is a performance target, not a design constraint. Remaining planned changes are faction-oriented:

- **Faction territory**: Systems will belong to factions, with colored territory visualization
- **Government migration**: Government type moves from per-region to per-faction (see [faction-system.md](../planned/faction-system.md) §1)
- **Dynamic borders**: Territory changes hands through wars, visually reflected on the map
- **Faction influence on economy**: Controlling faction's government can nudge economy derivation on close calls (see [system-enrichment.md](../planned/system-enrichment.md) §2.2)
- **Facilities**: Faction-owned strategic infrastructure seeded at systems based on traits (see [system-enrichment.md](../planned/system-enrichment.md) §5)

---

## System Interactions

- **Traits → Economy**: Trait affinities determine economy type. Trait quality scales production rates per good via the economy processor (see [economy.md](./economy.md))
- **Government → Economy**: Region government type determines market modifiers (volatility, equilibrium, taxes). See [economy.md](./economy.md)
- **Navigation**: Connection graph defines travel routes and fuel costs. Gateway systems are strategic chokepoints (see [navigation.md](./navigation.md))
- **Events**: Events spawn at specific systems based on economy type and affect neighboring systems via spread (see [events.md](./events.md))
- **Faction system** (planned): Factions will control systems, with government type tied to faction rather than region (see [faction-system.md](../planned/faction-system.md))
