# Universe & Map

The game world — star systems, regions, connections, and how the map is explored.

---

## Universe Structure

### Scale
- Universe size is chosen per game on the **New-game** screen: a system count (Zod-validated 50–20,000, default 600), a pre-filled editable seed, and up to ten optional galaxy-shape knobs — cluster count, size skew, cluster spacing, void floor, corridors per cluster, corridor style, cluster turbulence, star spacing, cluster tightness, and a map-size multiplier. Every knob defaults to a value derived from the system count (`genConfigForSystemCount`); an all-default New Game reproduces today's world byte-for-byte.
  - **600 systems** ≈ 24 clusters / ~7,000×7,000 map (default, quick to generate)
  - **~10,000 systems** ≈ 60 clusters / ~25,000×25,000 map (target production scale)
- Map size and star spacing are independent multiplier levers on top of the system-count derivation, so a player can generate a denser/sparser or larger/smaller galaxy without changing the system count. There is no `UNIVERSE_SCALE` env var; map extent lives in generated world state (`meta.mapSize`).
- Procedurally generated from a seed (deterministic — same seed, count and knobs always produce the same universe)
- Generated once, in-process, by `generateWorld` on New game (no database seed), then immutable for that world's life

### Regions

A region **is** a cluster. The galaxy's shape is authored by a coarse 0–1 density grid built from placed cluster seeds: an elliptical influence footprint per seed (size skewed toward a few large clusters and many small ones, stretch and orientation rolled per seed) falling off to exactly 0 at its edge, a large-scale warp-noise layer that roughens edges and occasionally merges neighbouring clusters, a small-scale texture-noise layer, and a void floor below which a cell reads as true emptiness rather than merely sparse. A per-cluster turbulence knob can dampen some clusters' peak density toward diffuse while others stay full. Each region's center is its cluster seed's position, and every system is assigned to its nearest seed. Names come from a flat pool of 28 generic space names (Arcturus, Meridian, Vanguard, etc.), not themed by economy type. At >28 regions, names are recycled with a `-N` suffix.

Each region has:
- **Name**: From a pool of 28 generic space names, picked sequentially. Suffix `-N` when pool is exhausted
- **Dominant economy**: The most common economy type among the region's systems, computed at world-gen and stored on the region. Displayed as a subtitle on the map (e.g., "Arcturus — Extraction")

Regions are purely geographic now — they group systems for naming, orientation, and dominant-economy display. They no longer carry a government type. Government is a property of the owning **faction**, sourced per-system from the faction that controls it (see [faction-system.md](./faction-system.md) §1). A region's "dominant government" shown on the map is derived from its most prevalent owning faction, not stored on the region.

### Economy Type

Every system is built from a **physical substrate** — one sun and 1–N bodies (planets, asteroid belts, gas giants), each with a resource vector. Economy type is derived **bottom-up** from a system's aggregate body resources and population, never assigned directly.

**Sun class** gates which body archetypes a system can roll and how many bodies it has (`SUN_CLASSES` in `lib/constants/bodies.ts`):

| Sun class | Character | Favours |
|---|---|---|
| Yellow (Sol-like) | Temperate, most permissive | Habitable subtypes, balanced mixes |
| Blue–white (hot) | High-energy inner system | Volcanic, barren rock, asteroid belts |
| Orange dwarf (cool) | Dim, long-lived | Ocean/ice worlds, gas, marginal habitables |
| Red dwarf (cold) | Faint frontier | Frozen worlds, gas giants, belts; sparse population |

`deriveEconomyTypeLabel` (`lib/engine/economy-type.ts`) reads each resource's effective deposit potential (slot capacity × yield quality, summed across the system's bodies) plus population, and maps a system to one of six types:

- **High-population systems** (population above a high threshold) read as developed: raw-dominant deposits → `industrial`; neither food- nor raw-dominant → `tech`; otherwise → `core`.
- **Sparse/mid-population systems** follow their dominant deposit: food-dominant (arable + biomass share) → `agricultural`; raw-dominant (ore + minerals + gas + radioactive share) → `extraction`; otherwise (a mixed raw base) → `refinery`.

Because raw building blocks are needed in huge volume and most bodies carry *some* extractable deposit, the galaxy reads **extraction-dominant by design** — see [Habitability & the Substrate](./habitability.md) for how deposit counts and habitability scores produce it — not a generation flaw. The label itself is **display-only**: nothing in the economy tick reads economy type — production derives from `WorldBuilding` counts and per-resource yield (see [economy.md](./economy.md)); the label drives only UI badges and `Region.dominantEconomy`.

### Systems

Each system has:
- **Name**: Region-based naming (e.g., "Nexus-1-7")
- **Economy type**: One of 6 types (agricultural, extraction, refinery, industrial, tech, core), derived from the system's aggregate body resources + population
- **Bodies**: a sun + 1–N bodies, each with a resource vector (the economic substrate)
- **Coordinates**: Density-aware Poisson-disc placement — tight spacing in cluster cores, sparse spacing along corridor bands, no placement in true void; assigned to its nearest cluster (region)
- **Market**: one market per system carrying all 26 goods (there is no separate station entity — the market is keyed by system)
- **Gateway flag**: set on the two anchor systems of each realised corridor — in each cluster, whichever placed system sits furthest toward the other cluster's seed

### Connections
- **Intra-cluster**: A relative-neighbourhood graph over each cluster's own systems — planar by construction (no two of its own lanes cross) and provably contains the Euclidean minimum spanning tree, so every cluster with ≥2 systems stays connected. An optional prune knob (default 0 — measured lane density already lands in the target band) can trim surplus cycle edges afterward without ever breaking connectivity.
- **Cross-cluster**: Lanes exist only along the galaxy's planned corridors — a minimum spanning tree over cluster seeds, plus a configurable number of extra pairs per cluster (an extra is dropped when it would fan near-parallel to an already-accepted corridor at the same cluster). Each corridor realises as one of two styles: **band** — a chain of waypoint lanes through a thin strip of raised density between the two clusters — or **crossing** — a single long lane directly between the two anchor systems. A crossing pair demotes to band-style realisation when its anchor-to-anchor line no longer reads as genuinely empty space (nearby placed systems, or populated grid beyond tolerance).
- **Repair pass**: any component a corridor failed to reach (a cluster that rolled zero placed systems) gets a direct repair lane to the nearest system outside its component — a rare safety net, not the routine connectivity mechanism.
- **All bidirectional**: Every connection works in both directions
- Lanes avoid crossing each other where the graph's own connectivity requirements permit
- **Fuel cost**: Distance-scaled. Intra-cluster and band-corridor lanes ~1-10 fuel per hop. Crossing-style lanes carry a 2.5x multiplier over the intra-cluster baseline (~15-25 fuel) — the only lane class priced above baseline

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
- Connection lines between systems — one uniform slate line, no colour and no dashes on this base layer, a little wider per invested level and wider again for a lane priced at or beyond a crossing at typical spacing (so a corridor's crossing lane reads slightly heavier because of its cost, and a long intra-cluster lane priced the same way reads the same); a **Lanes** map mode (see [map-rendering.md](../engineering/map-rendering.md)) carries the investor/level/load meaning instead

**Crossfade (0.3–0.4)**: Smooth alpha transition between tiers using cubic smoothstep. SystemObject creation begins slightly before the crossfade (zoom 0.28) so objects are ready when they fade in.

**LOD within detail tier**: Additional smoothstep fades control progressive disclosure. Pill *shapes* appear with the system layer as it fades in; pill *content* (counts, %, icons) reveals one band closer (~0.5–0.6) alongside system names; economy/fuel labels follow (~0.6–0.7); glow/halo shows above ~0.45.

**Background**: Parallax starfield with 3 depth layers, independent of the world container.

**Performance**: Frustum culling skips off-screen systems and connections each frame. SystemObjects are created on demand (batched per frame) and hidden on deactivation rather than destroyed — constructor cost is high (~10 display objects each). Viewport change callbacks are throttled to avoid 60 setState calls/sec during pan/zoom. `setLOD` runs every frame per visible glyph but short-circuits via a dirty flag when neither the glyph's data nor the LOD bands it reads have changed.

### System Glyph Anatomy

Each system renders as a layered glyph with a fixed radial budget so indicators never collide. Geometry lives in `components/map/pixi/theme.ts` (`GLYPH`/`PILL`); the glyph is assembled in `components/map/pixi/objects/system-object.ts`.

- **Core (r ≤ 12)** — solid economy colour; the system's intrinsic identity, with a small highlight dot.
- **Halo (r ≈ 20) — the overlay lens.** A translucent disc carrying the *active overlay*: a faint economy tint by default, recoloured to the price ramp when the Price overlay is on. Overlap-forgiving; the halo channel is designed to host future per-system lenses (danger, stability).
- **No ring on the glyph.** The cell outline (`CellHighlightLayer`) is the sole selected/hovered state, and the star itself takes no pointer events. A navigation ring (origin/destination, reachable/unreachable shading) belongs to the planned player-fleet routing layer and is not drawn today.

There is no per-glyph gateway ring — gateway status now reads through the amber colour it shares with the priciest lanes (a corridor-endpoint system is where a crossing lane, or a band chain, actually terminates), a larger dot in the universe-zoom point cloud, and an amber "Gateway" badge in the system side panel.

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

The map's controls float at the bottom-right in a dock (`components/map/map-controls-dock.tsx`) that stacks panels upward. The main panel (`map-overlay-controls.tsx`, state in `lib/hooks/use-map-overlays.ts`) holds two vertically-stacked sections:

- **Mode** (single-select) — Political / Regions / Stability / None. Political and Regions paint faction/region polygons; **Stability** paints a per-system Voronoi choropleth tinted by each system's stability (the inverse of `unrest` — Stable, Tense, Unrest, Strike, Collapse), with an inline legend under the selector. None hides the territory band.
- **Overlays** (multi-select) — Events, Logistics, Price. Each row carries its glyph element's colour so the panel doubles as the key; the price-ramp and logistics tier legends appear in hover tooltips beside the row so they cost no permanent height.

The **Logistics** overlay renders the one inter-system goods flow the economy records (see [Autonomic-Light Agency](./economy-autonomic-agency.md)): *directed faction hauls* — a faction deliberately moving surplus to deficit, up to several hops across open space with no lane underneath — as tier-coloured **curved arcs** that lift off the straight lane network, arrow-headed toward the importing system, with glowing "convoy" particles. The arc commits to nothing about the path (logistics is instant point-to-point — only the endpoints are ground truth); the curve is purely a legibility device that separates long-range hauls from the lanes. It carries a tier-colour legend and a spatial visibility gate (an arc shows if at least one endpoint is in view).

When the Price overlay is on, a separate **Price panel** (`map-price-panel.tsx`) — the good-picker, a **buy/sell sub-toggle** that flips the deal-quality tint perspective, plus a jump to cross-system comparison — floats above the main panel, kept independent so picking a good never reflows the main panel. The price overlay (a per-system halo) is orthogonal to the Mode tint, so it can ride on top of the stability choropleth. The dock is the single owner of panel layout; further context panels slot in as siblings.

Overlays govern *ambient* clutter, not data access: with Events off, a system's event pill is hidden ambiently but still **reveals on hover or selection**. The always-on skeleton — economy core, halo, jump lanes — is never gated by a toggle. Overlay state persists per session.

### Fog of War / Visibility (planned)

There is **no fog of war** — every system is fully visible. All live overlays (events, danger) are available everywhere, the visibility endpoint returns every system, and clicking any system shows full intel.

Per-player, ship-based fog of war is planned: the galaxy's topology stays public "star chart" knowledge, while a system's *dynamic* state (live events, danger, ship presence) is revealed only when one of your ships is within sensor range (measured in connection hops, varying by ship role). The visibility engine (`lib/engine/visibility.ts`) and the data plumbing ([map-data-loading.md](../engineering/map-data-loading.md)) are in place for it; the full design is in the [grand-strategy vision](../../planned/grand-strategy-vision.md).

### Map Side Panel

When a system is selected on the map, the side panel shows:
- System name, economy type, region, government
- Active events

### Route Planning (planned)

There is no interactive route planning — only the cell outline selection. Route planning (origin/destination navigation rings, reachable/unreachable fuel shading, a route preview with fuel + travel-duration estimate) is part of the planned player-fleet layer; the underlying travel model (fuel range, `speed` → transit ticks, the ship-arrivals processor) is in the backend.

### State Persistence
- Selected system and camera position stored in session
- URL params allow direct linking (`?systemId=abc`)

---

## System Detail Page

When viewing a system, the detail page shows:
- System name, economy type badge, region name, government type
- Detail tabs: Overview, Market, Industry, Logistics, Population, Astrography

---

## Starting Position

The player authors a faction on New Game (name/government/doctrine); world-gen seeds it as an additional major placed like every other faction, and records the seat as `world.player`. There is no reserved start *system* — the map auto-focuses the player's homeworld on entry. See [faction-system.md](./faction-system.md#5-homeworlds) and [single-player-runtime.md](../engineering/single-player-runtime.md).

---

## Planned Changes

The configurable universe and tile-based map renderer are in place — scale ceiling is a performance target, not a design constraint. The faction foundation has also shipped: systems belong to factions with colored territory visualisation, and government type is sourced per-faction rather than per-region (see [faction-system.md](./faction-system.md)). Remaining planned changes are war- and facility-oriented:

- **Dynamic borders**: Territory changes hands through wars, visually reflected on the map
- **Faction influence on economy**: Controlling faction's government can nudge economy derivation on close calls
- **World-gen start state**: the grand-strategy pivot ([grand-strategy-vision.md](../../planned/grand-strategy-vision.md) §5.4) replaces "factions own everything at seed" with small developed faction cores in a mostly-unclaimed galaxy (colonisation becomes a core loop)

---

## System Interactions

- **Substrate → Economy**: A system's aggregate body resources + population determine its economy-type label; production/consumption then run off that label (see [economy.md](./economy.md))
- **Government → Navigation**: A system's government type — sourced from its owning faction — sets its danger baseline. It carries no economic modifier. See [economy.md](./economy.md) and [faction-system.md](./faction-system.md) §1
- **Navigation**: Connection graph defines travel routes and fuel costs. Gateway systems are strategic chokepoints (see [navigation.md](./navigation.md))
- **Events**: Events spawn at specific systems based on economy type and affect neighboring systems via spread (see [events.md](./events.md))
- **Faction system**: Factions control systems, with government type tied to faction rather than region (see [faction-system.md](./faction-system.md)). Territory is rendered as colored polygons on the map
