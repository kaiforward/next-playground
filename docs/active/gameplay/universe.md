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
- **Dominant economy**: The most common economy type among the region's systems, computed at seed time and stored on the Region model. Displayed as a subtitle on the map (e.g., "Arcturus — Extraction")

Regions are purely geographic now — they group systems for naming, orientation, and dominant-economy display. They no longer carry a government type. Government is a property of the owning **faction**, sourced per-system from the faction that controls it (see [faction-system.md](./faction-system.md) §1). A region's "dominant government" shown on the map is derived from its most prevalent owning faction, not stored on the region.

### System Traits & Economy Type

Every system has **2–4 permanent traits** (quality tiers 1–3) that define its character and drive its economy type. Economy is derived **bottom-up** — summing the strong trait affinities, never assigned directly — and the first trait is guaranteed a strong affinity so every system has a clear economic signal. Trait quality also scales per-good production bonuses. The full trait catalog, affinity scoring, and derivation rules live in [system-traits.md](./system-traits.md).

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
- Full SystemObject rendering — layered glyph with economy core, overlay halo, rings, and four corner pills (see [System Glyph Anatomy](#system-glyph-anatomy))
- System names and economy badges
- Connection lines between systems (dashed for intra-region, solid for gateway/route) with fuel cost labels
- Effect layer: route particles and pulse ring animations

**Crossfade (0.3–0.4)**: Smooth alpha transition between tiers using cubic smoothstep. SystemObject creation begins slightly before the crossfade (zoom 0.28) so objects are ready when they fade in.

**LOD within detail tier**: Additional smoothstep fades control progressive disclosure. Pill *shapes* appear with the system layer as it fades in; pill *content* (counts, %, icons) reveals one band closer (~0.5–0.6) alongside system names; economy/fuel labels follow (~0.6–0.7); glow/halo shows above ~0.45.

**Background**: Parallax starfield with 3 depth layers, independent of the world container.

**Performance**: Frustum culling skips off-screen systems and connections each frame. SystemObjects are created on demand (batched per frame) and hidden on deactivation rather than destroyed — constructor cost is high (~10 display objects each). Viewport change callbacks are throttled to avoid 60 setState calls/sec during pan/zoom. `setLOD` runs every frame per visible glyph but short-circuits via a dirty flag when neither the glyph's data nor the LOD bands it reads have changed.

### System Glyph Anatomy

Each system renders as a layered glyph with a fixed radial budget so indicators never collide. Geometry lives in `components/map/pixi/theme.ts` (`GLYPH`/`PILL`); the glyph is assembled in `components/map/pixi/objects/system-object.ts`.

- **Core (r ≤ 12)** — solid economy colour; the system's intrinsic identity, with a small highlight dot.
- **Halo (r ≈ 20) — the overlay lens.** A translucent disc carrying the *active overlay*: a faint economy tint by default, recoloured to the price ramp when the Price overlay is on. Overlap-forgiving; the halo channel is designed to host future per-system lenses (danger, prosperity).
- **Gateway ring (r ≈ 28)** — bright magenta (`#e879f9`, a hue reserved for gateways) stroke on inter-region gateway systems.
- **Navigation ring (r ≈ 34, outermost, dashed)** — drawn only during routing, on the origin/destination, plus a subtle dashed focus ring on the selected system. `reachable` nodes keep a thin solid ring; `unreachable` dim to ~0.3 alpha.

**Corner pills.** Four fixed corners, all sharing one height and radial offset, each pinned to a channel so the map reads without a legend:

| Corner | Channel | Content |
|---|---|---|
| Top-left | Fleet | docked ships (blue) + convoys (copper), stacked, with counts |
| Top-right | Price | signed % deviation from base price (ramp-tinted, matches halo) |
| Bottom-right | Events | dominant event icon + count, bordered by the event's colour |
| Bottom-left | *reserved* | future channel |

Pills are deliberately **rounded** — Pixi aliases sharp corners and tiny text at these sizes — so the WebGL map diverges from the Foundry sharp-edge HTML rule (see [theme.md](../design-system/theme.md)). Their two-stage reveal (shape early, content near) is covered in the LOD notes above.

### Fleet on the Map

The player's own fleet is always legible, in a consistent fleet visual language (blue solo ships, copper convoys) kept distinct from event / economy / price cues:

- **Docked ships** show as top-left count pills on the system glyph — blue for solo ships, copper for convoys, stacked when both are present.
- **In-transit ships** show as always-visible directional markers that move smoothly along their route between ticks (a chevron points toward the destination). Convoys render as a single marker; markers that overlap on screen cluster into one pill with a count.
- **Routes on demand** (progressive disclosure): hovering a marker shows a ghost route + ETA tooltip; clicking it draws the solid animated route and opens a compact transit card (destination, cargo, ETA); a "Ship Routes" overlay can draw every in-transit route at once.

In-transit markers are the player's own ships, so they stay visible even across unexplored systems.

### Overlays & Control Panel

A compact panel anchored bottom-left (`components/map/map-overlay-controls.tsx`, state in `lib/hooks/use-map-overlays.ts`) governs three independent axes:

- **Presets** — one-click overlay bundles: **Default** (Fleet + Events), **Trader** (Price + Events), **Navigator** (Fleet + Routes). The map opens on Default; toggling any single overlay by hand drops to a derived **Custom**. The pure preset↔overlay mapping lives in `lib/utils/map-presets.ts`.
- **Territory** (segmented single-select) — Political / Regions / None faction/region polygons (the map mode).
- **Overlays** (2-column toggle grid) — Fleet, Events, Price, Trade-flow, Ship Routes. Each chip carries its glyph element's colour so the panel doubles as the key; the price-ramp, trade-flow tier, and routes legends live in hover tooltips so they cost no permanent height. The Price good-picker + "Show all prices" button stay inline, shown only when Price is on.

Overlays govern *ambient* clutter, not data access: with Fleet or Events off, a system's pills are hidden ambiently but still **reveal on hover or selection**. The always-on skeleton — economy core, halo, gateway ring, jump lanes, moving ships — is never gated by a toggle. Overlay and preset state persist per session.

### Fog of War / Visibility

The map shows you the *stars* but not the *story*. The galaxy's topology — every system's position, connections, region, economy type, and name — is public "star chart" knowledge, visible to everyone at every zoom. What's hidden is the dynamic state: live events, danger levels, and ship presence. You can see a system is there; you don't know what's happening at it unless you have eyes nearby.

- **Explored / visible**: A system is visible when one of your ships is within sensor range of it. Sensor range is measured in connection hops, and varies by ship role — scouts see furthest (3 hops), trade and support ships 2, combat and stealth 1. A convoy sees the union of its members' ranges, so a scout escort extends a freighter's awareness. Visible systems render at full brightness with their event icons, danger coloring, and "you have ships here" indicators.
- **Unknown**: Systems outside any ship's sensor range are dimmed. Their dot and name still show (star-chart data), but no live overlays — and clicking one yields atlas-level info only, with no current intel on prices, events, or ships.

This is the player's *own* map knowledge: visibility is computed per-player from their fleet positions, not a global reveal. It makes exploration meaningful and information a resource worth investing in. The current model is binary (visible or unknown) with no stale/snapshot memory.

The data plumbing behind this — how visibility is computed, cached per tick, and used to gate live data — is in [map-data-loading.md](../engineering/map-data-loading.md).

> **Planned**: additional visibility sources beyond your own ships — allied-faction territory (see Friendly+ reputation), purchased time-limited intel, and mission reveals — plus a "stale snapshot" state that remembers a system's last-known state after you lose sight of it.

### Map Side Panel

When a system is selected on the map, the side panel shows:
- System name, economy type, region, government
- Compact trait list (top trait with quality stars, trait count)
- Docked ships and active events

### Navigation Mode
When planning a route (navigation rings, see [glyph anatomy](#system-glyph-anatomy)):
- **Origin**: Ship's current system — dashed navigation ring
- **Destination**: Chosen endpoint — dashed navigation ring
- **Reachable**: Systems the ship can reach with current fuel — thin solid ring
- **Unreachable**: Systems beyond fuel range (dimmed to ~0.3 alpha)
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

The configurable universe and tile-based map renderer are in place — scale ceiling is a performance target, not a design constraint. The faction foundation has also shipped: systems belong to factions with colored territory visualization, and government type is sourced per-faction rather than per-region (see [faction-system.md](./faction-system.md)). Remaining planned changes are war- and facility-oriented:

- **Dynamic borders**: Territory changes hands through wars, visually reflected on the map
- **Faction influence on economy**: Controlling faction's government can nudge economy derivation on close calls (see [system-traits.md](./system-traits.md) §2.2)
- **Facilities**: Faction-owned strategic infrastructure seeded at systems based on traits (see [facilities.md](../../planned/facilities.md))

---

## System Interactions

- **Traits → Economy**: Trait affinities determine economy type. Trait quality scales production rates per good via the economy processor (see [economy.md](./economy.md))
- **Government → Economy**: A system's government type — sourced from its owning faction — determines its market modifiers (volatility, equilibrium, taxes). See [economy.md](./economy.md) and [faction-system.md](./faction-system.md) §1
- **Navigation**: Connection graph defines travel routes and fuel costs. Gateway systems are strategic chokepoints (see [navigation.md](./navigation.md))
- **Events**: Events spawn at specific systems based on economy type and affect neighboring systems via spread (see [events.md](./events.md))
- **Faction system**: Factions control systems, with government type tied to faction rather than region (see [faction-system.md](./faction-system.md)). Territory is rendered as colored polygons on the map
