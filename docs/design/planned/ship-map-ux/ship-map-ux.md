# Ship Map UX

Make the player's fleet legible on the star map — a clear docked-ship indicator plus always-visible in-transit markers with on-demand routes.

**Status**: planned · approved design, no code yet.
**Date**: 2026-05-28
**Visual reference**: [`mockup.html`](./mockup.html) — the final visuals must match this v2 mockup (open it in a browser; it is the source of truth for colours, shapes, and sizing).

---

## Problem

Ships are hard to track on the star map — and tracking your fleet is a core part of the game.

- **Docked ships** are signalled by a faint cyan pulse ring (`effect-layer.ts → syncPulseRings`, alpha 0.4→0 over a 2s cycle) plus a small yellow "N SHIPS" text label on the `SystemObject`. Both are easily lost against the system glow, gateway dots, event dots, and fuel labels. Confirmed visually on the live map.
- **In-transit ships are not drawn at all.** `useMapData` only counts `docked` ships for `shipCount`. A ship in transit vanishes from the map entirely until it arrives — you cannot tell from the map whether you have ships moving or where they are.

## Goals

1. Make docked-ship presence **immediately scannable** at close zoom.
2. Make in-transit ships **visible and locatable** at all times, with their route and ETA available on demand.
3. Keep the default map **uncluttered** even with many ships, including several on the same lane.
4. One coherent "this is your fleet" visual language for docked and in-transit alike.

## Non-goals

- No new persistence. The multi-hop path is **not** stored on the ship (it collapses to origin → final destination + departure/arrival ticks at departure time). We reconstruct it client-side; this matches what the navigation UI sends, since the nav UI only ever offers the shortest path.
- No general "select any ship on the map" framework beyond the in-transit marker interaction described here.
- No changes to the zoomed-out fleet-dot layer (`fleet-dot-layer.ts`) — it already represents fleet presence acceptably at universe zoom.

---

## Visual language (must match the v2 mockup)

Fleet cue colour is the existing nav/fleet **cyan/sky** family, kept distinct from event dots (red/amber/purple/green/blue/slate), economy glyphs, and the price/trade overlays.

| Token | Value | Use |
|---|---|---|
| Fleet pill fill | `0x38bdf8` (sky-400) | docked pill + in-transit pill body |
| Fleet pill glyph/text | `0x0a1018` (near-black) | ship chevron glyph + count on the pill |
| Route — hover (ghost) | `0x38bdf8`, alpha `0.45`, width `1.8`, animated dash flow | transient hover route |
| Route — active/overlay | `0x22d3ee` (cyan-400), alpha `0.9`, width `2.4`, animated dash flow toward dest | selected route + "Ship Routes" overlay |
| Cluster count badge | circle `0xd06a42` (copper accent), text `0x0a1018` | cluster/convoy member count |
| Ship card | surface `0x161b22`, border `0x3a4350`, copper left stripe `0xd06a42`, mono text | compact in-transit card |

Pill corner radius: ~2–3px, consistent with the existing price-heatmap badge (`BADGE_CORNER = 2`). The map already establishes small badge rounding as the in-Pixi exception to the Foundry "no rounded corners" rule, so the fleet pills are consistent with that precedent.

### Docked pill
Rounded pill (~42×22) carrying a small ship chevron glyph + the docked count, badged on the system glyph. Replaces the pulse ring and the "N SHIPS" text.

### In-transit marker (Style B — directional pill)
Same pill family, used as a moving marker:
- **Pill body stays upright** so the glyph/count remain readable.
- A **direction chevron** (pointed leading edge / nub) points along the lane toward the destination, rotated to the current segment's heading. We do **not** rotate the pill body or its text.
- Count shown only when clustering (see below); a solo ship shows just the ship glyph.

---

## Architecture

### New: `components/map/pixi/layers/fleet-transit-layer.ts`
Owns all in-transit visuals. Two sub-containers in z-order: `routeLines` (below) and `markers` (above).

Responsibilities:
- Render an upright directional pill per **transit unit** at its interpolated position along the reconstructed route.
- Render route lines **on demand**: ghost on hover, solid when selected, and (when the "Ship Routes" overlay is on) all routes at once.
- Hit-test markers for hover/click; surface those interactions to React via callbacks (same `getCallbacks()` ref pattern as `setupInteractions`).
- Cluster overlapping markers (screen-space threshold) into one pill + count badge.

Performance: player ship/convoy counts are small (tens, not thousands), so no per-system frustum batching is required. Paths are reconstructed only when the transit set changes (memoised by a key of unit ids + ticks), not per frame. Per-frame work is cheap position interpolation + `position.set`. Frustum-cull route-line drawing when the overlay is on.

### Pure, testable math: `lib/engine/transit-position.ts`
Engine module (zero DB, Vitest-tested). The Pixi layer stays a thin renderer.

- `reconstructTransitPath(originId, destId, connections, speed)` → ordered `{ systemId, cumulativeDuration }[]` using `findShortestPath` + `hopDuration`. Total duration = last cumulative.
- `interpolateTransit(path, positions, progress)` → `{ x, y, angleRad, segmentIndex }`. Walk cumulative durations to find the segment containing `progress × total`, then lerp between the two system positions; `angleRad` is that segment's heading (for the direction chevron).
- `clusterMarkers(markers, thresholdPx)` → grouped markers with counts (pure; operates on already-projected screen positions).
- Guards: `arrivalTick === departureTick` (clamp), `progress` clamped to `[0,1]`, `findShortestPath` returns null (caller falls back to a straight origin→dest line).

### Modified: `components/map/pixi/objects/system-object.ts`
- Replace the `shipLabel` text with a **docked pill** graphic (rounded rect + ship chevron + count), anchored **top-left** of the core. (Top-right is already occupied by the gateway dot, event dots, and price badge — anchor top-left to avoid collision; confirm visually during build.)
- Keep the existing rules: count comes from the player's own fleet, shown regardless of fog-of-war; visible at the `showShipLabels` LOD.

### Modified: `components/map/pixi/layers/effect-layer.ts`
- Remove `syncPulseRings` and its `PulseRing` machinery (no longer used). **Keep** `syncRoute`/route particles — the navigation route-preview still uses them.

### Modified: `components/map/pixi/pixi-map-canvas.tsx`
- Construct the `FleetTransitLayer` above the system layer; within it, route lines render below the markers. (The compact ship card is a **DOM overlay** rendered in `star-map.tsx`, like `SystemDetailPanel` — not a Pixi object.)
- Pass it: transit units, system positions, connections, `currentTick`, `tickRateMs`, the "Ship Routes" overlay flag, the selected transit id, and hover/click callbacks.
- Per-frame: advance marker interpolation and route dash animation; apply frustum culling to route lines.
- Destroy the layer in cleanup.

### Modified: `lib/hooks/use-map-data.ts`
- Expose `transitUnits: TransitUnit[]` built from solo in-transit ships (`status === "in_transit" && !convoyId`) **and** in-transit convoys (`status === "in_transit"`, rendered as one unit).
- `TransitUnit`: `{ id; kind: "ship" | "convoy"; name; originSystemId; destinationSystemId; departureTick; arrivalTick; speed; memberCount; cargoUsed; cargoMax }`. (`speed` = ship speed, or convoy's slowest member.)
- Docked counts (`shipsAtSystem`, `shipsAtSelected`, `convoysAtSelected`) unchanged.

### Modified: overlay plumbing
- `lib/hooks/use-map-overlays.ts` + `components/map/map-session.ts`: add `shipRoutes` to `MapOverlays`, `DEFAULT_OVERLAYS` (off), `hydrateFromSession`, and `MapOverlaysState`.
- `components/map/map-overlay-controls.tsx`: add a "Ship Routes" row to `OVERLAY_DEFS` and a short legend.

### Modified: `components/map/star-map.tsx`
- Source `currentTick` from `useTickContext` (already provided by `TickProvider` on the page); source the tick rate from world state (`GameWorld.tickRate` — confirm units; the game ticks every 5s).
- Hold selected-transit state (`selectedTransitId | null`); render the **compact in-transit card** (reuse/extend `compact-ship-card.tsx`) when a marker is selected, positioned near the marker, with destination/cargo/ETA and a link to the full ship page. Clicking empty space or another marker updates/clears selection.
- Feed `transitUnits` + interaction handlers into `PixiMapCanvas`.

### Theme: `components/map/pixi/theme.ts`
Add a `FLEET` constants block (pill fill/text, route hover/active styles, cluster badge colour, pill geometry) matching the table above. Remove the now-unused pulse-ring constants from `ANIM` (`pulseRingPeriod`, `pulseRingMaxRadius`).

---

## Interaction model — progressive disclosure

- **Default:** markers only. No route lines. You always see *that* a ship is moving and roughly *where*.
- **Hover marker:** ghost dashed route (origin→dest) + a small tooltip "→ <Dest> · ETA <n>t". Transient; nothing persists.
- **Click marker:** select on the map. Draw the solid animated route in travel direction + the compact ship card. The map stays visible (this is the map-native "ship selection" — there is no such concept elsewhere, and the ship detail page hides the map).
- **"Ship Routes" overlay toggle** (next to Trade Flows / Price): draw *all* in-transit routes at once for the fleet overview. Independent of hover/click. Markers remain always-on regardless of this toggle.

ETA is expressed in ticks: `arrivalTick − currentTick` (tick rate is 5s; the route-preview panel uses tick-based ETAs already — match its formatting).

---

## Position interpolation (smooth motion)

Marker progress is a function of the discrete `currentTick`, but ticks land every 5s — snapping would make markers jump. Smooth it with a sub-tick wall-clock fraction:

```
nowTick   = currentTick + clamp((Date.now() − lastTickChangeAt) / tickRateMs, 0, 1)
progress  = clamp((nowTick − departureTick) / (arrivalTick − departureTick), 0, 1)
```

The layer records `lastTickChangeAt = Date.now()` whenever the `currentTick` prop changes, and re-interpolates each frame. Self-correcting on every tick; no change to the tick context required. `tickRateMs` comes from `GameWorld.tickRate` (already available in world state).

---

## Anti-clutter strategy

- **Convoys render as a single marker** with a member-count badge — they travel as one unit, eliminating a large source of overlap for free.
- **Separate solo ships** on a shared lane sit at different progress points (different departure ticks / speeds) and spread out naturally.
- When solos overlap within a screen-space threshold, **cluster into one pill + count badge**, splitting as they separate (`clusterMarkers`).
- A direction chevron disambiguates opposing traffic on the same lane.
- Because route lines are on-demand, the default view never shows overlapping lines.

---

## Edge cases

- **Path not reconstructable** (disconnected, or `origin === dest`): fall back to a straight origin→dest line for the route; still place the marker by progress along that straight segment.
- **`arrivalTick === departureTick`:** clamp progress to 1 (marker at destination).
- **`currentTick > arrivalTick`** (arrived but tick not yet processed client-side): clamp to destination; the marker disappears on the next fleet refetch when status flips to `docked` (ship-arrival invalidation already refetches the fleet).
- **Fog of war:** in-transit markers are the player's own ships → always visible, even when the route crosses unknown systems. System positions are always available from the atlas, so destination/path positions resolve even outside the loaded viewport detail.

---

## Testing

- **Vitest (pure engine):** `lib/engine/transit-position.ts` — `reconstructTransitPath`, `interpolateTransit` (segment selection, lerp, angle, clamping), `clusterMarkers`. Cover the edge cases above.
- **Pixi layer:** not unit-tested (no jsdom in this repo); kept thin by delegating all math to the engine module.
- **Manual / browser:** verify on the live map with at least one solo ship and one convoy in transit, plus two solos on the same lane to confirm clustering and direction chevrons. Confirm docked pill placement doesn't collide with gateway/event/price badges.

---

## Build plan (≈2 PRs)

**PR1 — Docked pill + remove pulse** (small, self-contained)
- Add `FLEET` theme constants.
- `SystemObject`: docked pill replacing `shipLabel`; anchor top-left; LOD-gated.
- `effect-layer.ts`: remove `syncPulseRings`; stop calling it from `pixi-map-canvas.tsx`; drop unused `ANIM` pulse constants.

**PR2 — In-transit markers + routes + interaction + overlay**
- `lib/engine/transit-position.ts` + Vitest tests.
- `fleet-transit-layer.ts` (markers, route lines, hit-testing, clustering).
- `useMapData` `transitUnits`; overlay plumbing (`use-map-overlays`, `map-session`, `map-overlay-controls`).
- `pixi-map-canvas.tsx` wiring; `star-map.tsx` selection state + compact ship card; `useTickContext` for `currentTick`/`tickRate`.

Both PRs land on a shared `feat/ship-map-ux` branch, then one PR to `main` (per the shared-feature-branch workflow).
