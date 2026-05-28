# Map Layer & Symbol Reconciliation

A visual-design redesign of the Pixi map's per-system furniture, z-order, level-of-detail (LOD), and the overlay control panel. This is a delta document against the active map ([universe.md](../active/gameplay/universe.md), [map-data-loading.md](../active/engineering/map-data-loading.md)) and design system ([theme.md](../active/design-system/theme.md)). When implemented, fold the relevant parts into those active docs and delete this file.

**Motivation.** The map's glyph furniture — economy core, glow, navigation rings, docked-ship pills, gateway dot, event dots, the price-heatmap ring + badge, in-transit markers — accreted feature-by-feature. The result is competing elements at the same screen location (the old gateway dot and the price delta badge both lived top-right), three potential concentric rings with no radial budget, inconsistent marker sizing (docked pills scale with zoom; transit pills hold constant screen size), an overloaded colour palette (purple = core economy *and* precursor events *and* the proposed gateway), and an overlay control panel whose per-overlay legends stack vertically and consume height. This doc reconciles all of it into one coherent system with explicit rules.

---

## 1. Mental Model

Three independent controls decide what a player sees. They compose without fighting:

1. **Zoom** decides *shape vs. content*. Far out, every pill is a coloured rounded shape in a fixed corner — pre-attentive, no text. Zoom in and contents (counts, %, icons), then names, then economy labels and fuel costs reveal progressively.
2. **Overlays** decide *channels*. Fleet, Price, Events, Trade-flow are toggleable. Each is pinned to a fixed glyph corner so the player builds spatial muscle memory and can read a system without a legend.
3. **Hover / select** decides *depth*. Hover = peek (one system's content fills in even when zoomed out; a moving ship's route + ETA). Select = focus (route/connections highlight, navigation rings, detail panel).

Two anchoring rules that fall out of this:

- **Core = identity, halo = lens.** The inner core circle always shows the system's intrinsic economy colour. The translucent soft-body halo around it recolours to the *active overlay* (economy tint by default, the price ramp when Price is on, and is the channel future per-system overlays like danger/prosperity reuse).
- **Shapes are forgiving, text is not.** Translucent discs and rings may overlap neighbours freely (they read as ambient). Opaque info pills must not overlap — they live in fixed corners and cluster/offset to stay separate.

---

## 2. Glyph Anatomy & Radial Budget

Each concentric element occupies a fixed radius band so price, gateway, and navigation indicators never collide. Radii below are in glyph-local world units (current core radius is 12; see `components/map/pixi/theme.ts` `SIZES`). Exact values are tuning targets for implementation, not hard requirements.

| Band | Element | Radius (approx) | Always-on? | Notes |
|---|---|---|---|---|
| 0 | Economy core (inner circle) | r ≤ 12 | Yes | Solid economy colour. Intrinsic identity. Carries the existing top-left highlight dot. |
| 1 | Soft-body halo | r ≈ 18–22 | Yes | Translucent. **The overlay lens** — economy tint by default, price-ramp tint when Price overlay is on. Overlap-forgiving. |
| 2 | ~~Price ring~~ | — | — | **Removed.** Folded into the halo lens (band 1) + the price corner pill (§3). |
| 3 | Gateway ring | r ≈ 26–30 | Yes (gateways only) | Bright **magenta** stroke (`#e879f9`). Replaces the old amber gateway dot. |
| 4 | Navigation-state ring | r ≈ 33–37 (outermost) | No (routing only) | **Big, obvious, dashed.** Appears only on the origin + destination during route planning, plus a subtle selection ring on the selected system. Not every reachable node. |

Everyday systems therefore show **0–1 rings** (gateway ring only if applicable). The worst case — a gateway that is also a route endpoint — tops out at 2 rings at clearly separated radii. `unreachable` systems dim (alpha ≈ 0.3) rather than drawing a ring.

---

## 3. Corner Pills

Four fixed corners around the glyph. All pills share **the same height and the same radial offset** from the glyph centre so the layout reads as symmetric.

| Corner | Channel | Content | Colour |
|---|---|---|---|
| Top-left | **Fleet** | Docked ships (blue) and convoys (copper), stacked when both present; count text | ship `#38bdf8` / convoy `#d06a42` |
| Top-right | **Price** | Signed % deviation from base price | price-ramp tint (matches halo) |
| Bottom-right | **Events** | Simple event icon + count | dark fill, accent-coloured border by dominant event |
| Bottom-left | *reserved* | — | future channel |

**Shape style.** Pills are **rounded** (small corner radius). This is deliberate and diverges from the Foundry sharp-edge rule: Pixi rasterises sharp corners and tiny text into visible aliasing at the small sizes these markers occupy, whereas rounded shapes stay clean. The map is treated as its own immersive WebGL surface for this purpose; the surrounding HTML UI stays sharp-edged per [theme.md](../active/design-system/theme.md).

**Two-stage LOD reveal (per pill).** The coloured pill *shape* reveals at a farther zoom than its *content*:

- **Shape** appears as soon as the host system view fades in — a bare coloured rounded rect, no text/icon. Its colour + corner already communicate "ships here / pricey / event here."
- **Content** (count, %, icon) reveals only at a closer zoom, alongside or just after system names. Text far out was distracting and pixelated; text up close is useful.

This staging also resolves the prior inconsistency where docked pills scaled with zoom: pills are held at a stable screen presence like the transit markers, and only gain text when close.

---

## 4. Colour Reconciliation

The map palette was doing double and triple duty. Reconciled assignments:

- **Economy** owns the core + default halo hues (green/amber/cyan/slate/blue/purple — unchanged, `ECONOMY_COLORS`).
- **Price** owns the ramp (`PRICE_RAMP_STOPS`) — applied to both the halo (when Price is on) and the top-right pill.
- **Gateway** gets a **reserved unique hue: magenta `#e879f9`**, used by nothing else. Resolves the prior purple collision with core-economy systems and precursor events.
- **Fleet** owns blue (`#38bdf8`) for solo ships and copper (`#d06a42`) for convoys, consistently across docked pills, in-transit markers, and the universe-zoom presence dots.
- **Navigation** state keeps its cyan/white/emerald set, now expressed only via the outermost dashed ring (origin/destination) and dimming (unreachable).
- **Events** keep their per-type accent colours, but on the map they read primarily as an *icon* in the bottom-right pill rather than as a colour that competes with economy.

---

## 5. Z-Order (bottom → top)

1. Jump lanes (connection layer)
2. Economy core + soft-body halo
3. Gateway ring (magenta)
4. Navigation-state ring (routing only)
5. Corner pills (fleet / price / events)
6. Ship navigation paths (routes — hover ghost, selected, show-all)
7. **Moving ships** (in-transit markers) — topmost, never occluded

Moving ships render above everything because they are the player's live, dynamic assets. Routes sit above the static glyph furniture but below the pills so the most-read info stays legible. The price ring is gone from the stack entirely.

---

## 6. Overlays Model

Overlays are toggleable display channels. Each maps to a fixed glyph corner (or the halo, for Price) and obeys the §3 zoom staging.

| Overlay | Glyph element | Default |
|---|---|---|
| Fleet | Top-left pills | **On** |
| Events | Bottom-right pills | **On** |
| Territory (map mode) | Faction/region polygons | **On** (political) |
| Price | Halo lens + top-right pill | Off |
| Trade-flow | Particle streams on lanes | Off |
| Ship routes (show-all) | All transit routes drawn | Off |

**Overlay-off still reveals on demand.** Toggling an overlay off only suppresses its *ambient* display. Hovering or selecting a system still surfaces that system's fleet/price/event content (subject to the same zoom staging), and selecting a moving ship still shows its route. Overlays govern ambient clutter, not data access.

**Always-on skeleton** (never a toggle, never gated by text since they carry none): economy core, soft-body halo, gateway ring, jump lanes, moving ships.

---

## 7. Hover & Select

- **Hover = peek.** Pointing at a system fills in its pill content even when zoomed too far out to show content normally, and reveals its name. Pointing at a moving ship draws its route ghost + an ETA label (current behaviour, retained).
- **Select = focus.** Selecting a system shows the subtle selection ring, can surface navigation rings during routing, highlights its connections/route, and opens the detail panel. Selecting keeps full content visible regardless of zoom.

---

## 8. Control Panel Rework (Direction A — compact anchored panel)

The panel stays anchored bottom-left but is restructured to add presets and stop the per-overlay legends from stacking. Component: `components/map/map-overlay-controls.tsx`; overlay state: `lib/hooks/use-map-overlays.ts`.

**Structure (top → bottom):**

1. **Preset row** — chips that set the whole overlay set at once: **Default** (Fleet + Events — the startup set, §6), **Trader** (Price + Events), **Navigator** (Fleet + Routes), **Custom** (manual). The map opens on **Default**. Toggling any individual overlay switches the active preset to Custom. Presets govern the overlay set only; Territory is its own control below.
2. **Territory** — segmented single-select control: Political / Regions / None (the existing map mode).
3. **Overlays** — a compact 2-column grid of toggle chips: Fleet, Events, Price, Trade-flow, Routes. Each chip carries **its element's own colour** (blue/amber/orange/cyan/blue) so the panel doubles as the key.

**Legends move to hover tooltips.** The price ramp, trade-flow tier swatches, and routes explanation no longer occupy permanent vertical space. Hovering an overlay chip shows its detailed legend in a tooltip. This is the core fix for the "legends stack and take too much room" problem — roughly a third of the previous height.

**Interactive controls stay inline.** The Price good-picker and "Show all prices" button are interactive, not informational, so they remain inline and appear only when the Price overlay is on (current behaviour, kept compact).

The horizontal HUD-dock alternative (relocating controls to a bottom toolbar) was considered and **deferred** — it frees the left edge but competes with the route-preview/detail panels that already dock at the bottom, and is a larger rework. Kept as a future option.

---

## 9. Out of Scope / Open Questions

- **In-transit markers at universe zoom.** Currently always-on at all zooms (they persist past the host systems at galactic zoom). Left as-is for now; revisit if it reads inconsistently once the rest lands.
- **Horizontal HUD dock** (control-panel Direction C) — deferred, not discarded.
- **Reachable-node treatment during routing.** Only origin/destination get the outer ring; whether reachable nodes need any additional affordance beyond the existing subtle treatment is a tuning question for implementation.
- **Additional halo-lens overlays** (danger, prosperity) — the halo channel is designed to support them, but they are not specified here.

---

## 10. Files Likely Touched

Pointers for the implementation plan (not a build sequence):

- `components/map/pixi/objects/system-object.ts` — consolidate halo lens, gateway ring, nav ring, and all four corner pills here for uniform layout/offset/LOD; two-stage shape/content reveal.
- `components/map/pixi/lod.ts` — add per-pill shape-vs-content thresholds; retune ring/label bands.
- `components/map/pixi/theme.ts` — magenta gateway constant, radial-budget radii, unified pill geometry.
- `components/map/pixi/layers/price-heatmap-layer.ts` — price data now feeds the halo + top-right pill; the standalone ring is removed (layer may dissolve into the system layer's data feed).
- `components/map/pixi/layers/fleet-transit-layer.ts` — confirm topmost z-order; align marker sizing with docked pills.
- `components/map/pixi/pixi-map-canvas.tsx` — z-order of layer containers per §5.
- `components/map/map-overlay-controls.tsx` + `lib/hooks/use-map-overlays.ts` — presets, Fleet/Events as overlays, hover-tooltip legends, 2-column chip grid.
