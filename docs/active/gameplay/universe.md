# Universe & Map

The game world — star systems, regions, connections, traits, and how the map is explored.

---

## Universe Structure

### Scale
- Universe size is chosen per game on the **New-game** screen: a system count (Zod-validated 50–20,000, default 600). The goal is to scale as high as possible.
  - **600 systems** ≈ 24 regions / ~7,000×7,000 map (default, quick to generate)
  - **~10,000 systems** ≈ 60 regions / ~25,000×25,000 map (target production scale)
- Generation parameters (region count, map size, Poisson distances) are derived continuously from the system count (`genConfigForSystemCount`) — there is no `UNIVERSE_SCALE` env var; map extent lives in generated world state (`meta.mapSize`).
- Procedurally generated from a seed (deterministic — same seed + count always produces the same universe)
- Generated once, in-process, by `generateWorld` on New game (no database seed), then immutable for that world's life

### Regions

Regions placed via Poisson-disc sampling (count scales with preset). Each region is a geographic cluster with a neutral identity — names come from a flat pool of 28 generic space names (Arcturus, Meridian, Vanguard, etc.), not themed by economy type. At >28 regions, names are recycled with a `-N` suffix.

Each region has:
- **Name**: From a pool of 28 generic space names, picked sequentially. Suffix `-N` when pool is exhausted
- **Dominant economy**: The most common economy type among the region's systems, computed at world-gen and stored on the region. Displayed as a subtitle on the map (e.g., "Arcturus — Extraction")

Regions are purely geographic now — they group systems for naming, orientation, and dominant-economy display. They no longer carry a government type. Government is a property of the owning **faction**, sourced per-system from the faction that controls it (see [faction-system.md](./faction-system.md) §1). A region's "dominant government" shown on the map is derived from its most prevalent owning faction, not stored on the region.

### System Traits & Economy Type

Every system is built from a **physical substrate** — a sun and its bodies (planets, asteroid belts, gas giants), each holding a resource vector — plus **0–2 narrative features**. Economy type is derived **bottom-up** from the system's aggregate body resources and population, never assigned directly. Features (precursor ruins, anomalies, derelict fleets) carry no economic role — they modify danger baselines and gate exploration sites (the exploration layer is planned — see the [grand-strategy vision](../../planned/grand-strategy-vision.md)). The substrate model, feature catalog, and derivation rules live in [system-traits.md](./system-traits.md).

### Systems

Each system has:
- **Name**: Region-based naming (e.g., "Nexus-1-7")
- **Economy type**: One of 6 types (agricultural, extraction, refinery, industrial, tech, core), derived from the system's aggregate body resources + population
- **Bodies**: a sun + 1–N bodies, each with a resource vector (the economic substrate)
- **Features**: 0–2 narrative traits with quality tiers
- **Coordinates**: Fixed position via Poisson-disc sampling, assigned to nearest region
- **Market**: one market per system carrying all 26 goods (there is no separate station entity — the market is keyed by system)
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
- Voronoi-derived region/faction territory fills
- Region name labels at each region's centroid

**Detail tier (system zoom, >0.4)**:
- Tile-based viewport loading — only systems in visible tiles are fetched from the API
- Full SystemObject rendering — layered glyph with economy core, overlay halo, rings, and corner pills (see [System Glyph Anatomy](#system-glyph-anatomy))
- System names and economy badges
- Connection lines between systems (dashed for intra-region, solid for gateway) with fuel cost labels

**Crossfade (0.3–0.4)**: Smooth alpha transition between tiers using cubic smoothstep. SystemObject creation begins slightly before the crossfade (zoom 0.28) so objects are ready when they fade in.

**LOD within detail tier**: Additional smoothstep fades control progressive disclosure. Pill *shapes* appear with the system layer as it fades in; pill *content* (counts, %, icons) reveals one band closer (~0.5–0.6) alongside system names; economy/fuel labels follow (~0.6–0.7); glow/halo shows above ~0.45.

**Background**: Parallax starfield with 3 depth layers, independent of the world container.

**Performance**: Frustum culling skips off-screen systems and connections each frame. SystemObjects are created on demand (batched per frame) and hidden on deactivation rather than destroyed — constructor cost is high (~10 display objects each). Viewport change callbacks are throttled to avoid 60 setState calls/sec during pan/zoom. `setLOD` runs every frame per visible glyph but short-circuits via a dirty flag when neither the glyph's data nor the LOD bands it reads have changed.

### System Glyph Anatomy

Each system renders as a layered glyph with a fixed radial budget so indicators never collide. Geometry lives in `components/map/pixi/theme.ts` (`GLYPH`/`PILL`); the glyph is assembled in `components/map/pixi/objects/system-object.ts`.

- **Core (r ≤ 12)** — solid economy colour; the system's intrinsic identity, with a small highlight dot.
- **Halo (r ≈ 20) — the overlay lens.** A translucent disc carrying the *active overlay*: a faint economy tint by default, recoloured to the price ramp when the Price overlay is on. Overlap-forgiving; the halo channel is designed to host future per-system lenses (danger, stability).
- **Gateway ring (r ≈ 28)** — bright magenta (`#e879f9`, a hue reserved for gateways) stroke on inter-region gateway systems.
- **Navigation ring (r ≈ 34, outermost, dashed)** — drawn only during routing, on the origin/destination, plus a subtle dashed focus ring on the selected system. `reachable` nodes keep a thin solid ring; `unreachable` dim to ~0.3 alpha.

**Corner pills.** Four fixed corners, all sharing one height and radial offset, each pinned to a channel so the map reads without a legend:

| Corner | Channel | Content |
|---|---|---|
| Top-left | *reserved* | free channel (player fleets are planned) |
| Top-right | Price | signed % deviation from base price (ramp-tinted, matches halo) |
| Bottom-right | Events | dominant event icon + count, bordered by the event's colour |
| Bottom-left | *reserved* | future channel |

Pills are deliberately **rounded** — Pixi aliases sharp corners and tiny text at these sizes — so the WebGL map diverges from the Foundry sharp-edge HTML rule (see [theme.md](../design-system/theme.md)). Their two-stage reveal (shape early, content near) is covered in the LOD notes above.

### Player Fleet on the Map (planned)

There is no player fleet, so the map has no fleet layer — no fleet-presence dots, docked-ship pill, in-transit ship markers, route drawing, or Fleet/Ship-Routes overlays. Player fleets and their map presence (a blue fleet visual language distinct from event/economy/price cues, in-transit chevrons, routes-on-demand) are planned — see the [grand-strategy vision](../../planned/grand-strategy-vision.md).

### Overlays & Control Panel

The map's controls float at the bottom-left in a dock (`components/map/map-controls-dock.tsx`) that stacks panels upward. The main panel (`map-overlay-controls.tsx`, state in `lib/hooks/use-map-overlays.ts`) holds two vertically-stacked sections:

- **Mode** (single-select) — Political / Regions / Stability / None. Political and Regions paint faction/region polygons; **Stability** paints a per-system Voronoi choropleth tinted by each system's stability (the inverse of `unrest` — Stable, Tense, Unrest, Strike, Collapse), with an inline legend under the selector. None hides the territory band.
- **Overlays** (multi-select) — Events, Trade-flow, Logistics, Price. Each row carries its glyph element's colour so the panel doubles as the key; the price-ramp and trade-flow tier legends appear in hover tooltips beside the row so they cost no permanent height.

The two trade overlays render the two physically different flows the economy records (see [Autonomic-Light Agency](./economy-autonomic-agency.md)). **Trade-flow** draws *market diffusion* — passive, price-equalising stock seeping between adjacent systems — as straight, tier-coloured ambient particle streams that ride the visible lane network. **Logistics** draws *directed faction hauls* — a faction deliberately moving surplus to deficit, up to several hops across open space with no lane underneath — as tier-coloured **curved arcs** that lift off the straight network, arrow-headed toward the importing system, with larger glowing "convoy" particles so the two read apart even when both overlays are on and share a tier colour. The arc commits to nothing about the path (logistics is instant point-to-point — only the endpoints are ground truth); the curve is purely a legibility device that separates long-range hauls from the lanes. Both overlays share the tier-colour legend and the spatial visibility gate (an arc shows if at least one endpoint is in view), and differ by **shape**.

When the Price overlay is on, a separate **Price panel** (`map-price-panel.tsx`) — the good-picker, a **buy/sell sub-toggle** that flips the deal-quality tint perspective, plus a jump to cross-system comparison — floats above the main panel, kept independent so picking a good never reflows the main panel. The price overlay (a per-system halo) is orthogonal to the Mode tint, so it can ride on top of the stability choropleth. The dock is the single owner of panel layout; further context panels slot in as siblings.

Overlays govern *ambient* clutter, not data access: with Events off, a system's event pill is hidden ambiently but still **reveals on hover or selection**. The always-on skeleton — economy core, halo, gateway ring, jump lanes — is never gated by a toggle. Overlay state persists per session.

### Fog of War / Visibility (planned)

There is **no fog of war** — every system is fully visible. All live overlays (events, danger) are available everywhere, the visibility endpoint returns every system, and clicking any system shows full intel.

Per-player, ship-based fog of war is planned: the galaxy's topology stays public "star chart" knowledge, while a system's *dynamic* state (live events, danger, ship presence) is revealed only when one of your ships is within sensor range (measured in connection hops, varying by ship role). The visibility engine (`lib/engine/visibility.ts`) and the data plumbing ([map-data-loading.md](../engineering/map-data-loading.md)) are in place for it; the full design is in the [grand-strategy vision](../../planned/grand-strategy-vision.md).

### Map Side Panel

When a system is selected on the map, the side panel shows:
- System name, economy type, region, government
- Compact trait list (top trait with quality stars, trait count)
- Active events

### Route Planning (planned)

There is no interactive route planning — only the selection focus ring on a glyph. Route planning (origin/destination navigation rings, reachable/unreachable fuel shading, a route preview with fuel + travel-duration estimate) is part of the planned player-fleet layer; the underlying travel model (fuel range, `speed` → transit ticks, the ship-arrivals processor) is in the backend.

### State Persistence
- Selected system and camera position stored in session
- URL params allow direct linking (`?systemId=abc`)

---

## System Detail Page

When viewing a system, the detail page shows:
- System name, economy type badge, region name, government type
- **Traits section**: All traits with quality stars (★★☆ for quality 2), name, and quality-appropriate description
- Detail tabs: Overview, Market, Industry, Logistics, Population, Astrography

---

## Starting Position

World-gen records a `startingSystemId` on `meta` — a core-economy system in the region closest to the map center — as the reserved start point for the planned player seat. No player spawns there yet. Selection: find the region closest to (mapSize/2, mapSize/2), pick core economy systems, choose the one closest to the region center. Fallback: closest system to region center regardless of economy.

---

## Planned Changes

The configurable universe and tile-based map renderer are in place — scale ceiling is a performance target, not a design constraint. The faction foundation has also shipped: systems belong to factions with colored territory visualization, and government type is sourced per-faction rather than per-region (see [faction-system.md](./faction-system.md)). Remaining planned changes are war- and facility-oriented:

- **Dynamic borders**: Territory changes hands through wars, visually reflected on the map
- **Faction influence on economy**: Controlling faction's government can nudge economy derivation on close calls (see [system-traits.md](./system-traits.md) §2.2)
- **World-gen start state**: the grand-strategy pivot ([grand-strategy-vision.md](../../planned/grand-strategy-vision.md) §5.4) replaces "factions own everything at seed" with small developed faction cores in a mostly-unclaimed galaxy (colonisation becomes a core loop)

---

## System Interactions

- **Substrate → Economy**: A system's aggregate body resources + population determine its economy-type label; production/consumption then run off that label (see [economy.md](./economy.md))
- **Government → Economy**: A system's government type — sourced from its owning faction — determines its market modifiers (volatility, equilibrium, taxes). See [economy.md](./economy.md) and [faction-system.md](./faction-system.md) §1
- **Navigation**: Connection graph defines travel routes and fuel costs. Gateway systems are strategic chokepoints (see [navigation.md](./navigation.md))
- **Events**: Events spawn at specific systems based on economy type and affect neighboring systems via spread (see [events.md](./events.md))
- **Faction system**: Factions control systems, with government type tied to faction rather than region (see [faction-system.md](./faction-system.md)). Territory is rendered as colored polygons on the map
