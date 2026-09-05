# Map Presentation — lane layering, a Lanes map mode, cell-fit labels

> **Planned, approved.** A presentation pass over the star map after the lane surfaces shipped:
> the always-on lane drawing goes quiet and structural, a **Lanes map mode** carries every lane
> meaning (investor, level, load, congested) and absorbs the logistics overlay, system selection
> becomes the cell alone, and a system name draws only when it fits inside its own cell. Sits on
> [Logistics Lanes](../active/gameplay/logistics-lanes.md) §6 (the lane surfaces this re-presents)
> and [Universe & Map](../active/gameplay/universe.md); rendering detail in
> [map-rendering.md](../active/engineering/map-rendering.md). Pure presentation — no world state,
> no processor and no tick read changes.

---

## Headline

Today one lane line carries fuel tier (width, alpha and dashes), invested level (width), load
(grey→amber) and blocked (red) all at once, on top of every map mode, and the selection ring on
a star competes with the cell outline. This pass splits that into two layers with one job each.

- **The base lane layer**, always on, says only *where the lanes are*: one thin uniform line per
  lane, a little wider with invested level, a heavier line for a major-tier lane (priced like a corridor
  crossing, the one case where fuel cost outruns length), a hover highlight, and the copper selection glow. No colour,
  no dashes. Fuel cost is read from the lane's literal length; congestion is left to the alert bar
  and the Lanes mode.
- **The Lanes map mode** carries the meaning. Zoomed in, each lane takes its investor faction's
  colour (grey when unowned or split), width for level, a stepped load band for brightness, and a
  red pulse when congested; dashed means *no investor*. The former Logistics overlay's convoy
  particles fold into this mode, with particle density reading load rather than cargo. Zoomed out,
  where the map already hides lanes, the mode tints every system's cell by the worst state among
  its lanes in three fixed bands — fine, busy, congested — the way EU5 reads a province.
- **Selection is the cell.** The star's own selection ring, hover ring and hover scale go; the cell
  outline is the one selection and hover state, and clicking the star is just clicking its cell.
- **A system name draws only when its text box fits inside the system's own cell.** No priority
  ordering is needed because cells never overlap, so neither can the names; zooming in grows cells
  on screen and reveals more. Selected and hovered systems always keep their name.

---

## 1. The base lane layer

Every lane draws, at any map mode, as a segment between its two systems:

- **Width** — a uniform thin base plus a small increment per invested level (the level is the one
  thing the player did to the lane). No fuel-tier width, no tier alpha.
- **Major-tier lanes** (`laneTier(fuelCost) === "major"`, priced at or beyond a corridor crossing;
  there is no crossing flag on a lane) draw slightly heavier. Every other fuel cost is proportional
  to the drawn length and needs no extra mark.
- **No dashes and no colour.** Dashes are freed for the Lanes mode (§2), and load/blocked colour
  leaves the base layer entirely.
- **Hover** — a lane within the click tolerance (`LANE_HIT_TOLERANCE_PX`) highlights, and while a
  lane is hovered the cell highlight is suppressed, so the pointer never lights both. The hit-test
  already decides which wins the click; hover now uses the same answer.
- **Selection** — the copper glow underlay, unchanged.
- **Zoom** — unchanged: the layer fades with the system layer and is hidden at universe zoom.

## 2. The Lanes map mode

A new entry in the `MapMode` radio beside political, regions and the value modes. Choosing it
dims the territory fill (political colours drop to a quiet backing) and replaces the additive
**Logistics** overlay checkbox, which is removed — the mode is where hauls are watched.

**Zoomed in (system tier, lanes visible):**

- **Colour** — the investor faction's colour. The investor is the faction holding *both*
  endpoints (the same rule that decides who pays lane upkeep); a lane with an unclaimed or split
  endpoint is grey.
- **Dashed** — no investor at all (level 0 and no faction holding both ends). Solid otherwise.
- **Width** — invested level, a stronger ramp than the base layer's.
- **Brightness** — the load band, stepped, not a continuous ramp: fine, busy, congested (see
  bands below).
- **Congested** — a red pulse on the lane, animated only for lanes with `blockedVolume > 0` this
  run (a small set), never a per-lane ticker across the whole layer.
- **Convoy particles** — the existing lane-riding particles (`getTradeFlowEdges`, one segment per
  lane a haul is physically crossing) stay, but their count per lane scales with the lane's load
  band: a few on a fine lane, many on a busy or congested one. They no longer encode the good.

**Zoomed out (universe tier, lanes hidden):**

- Every system's cell tints by the **worst state among the lanes touching it**: congested > busy
  > fine, so a system whose lanes are all fine reads green. A system with no lanes at all is absent
  (black, like an unassessed cell in the provision mode). All systems, owned or not, like the other
  modes; restricting to owned/friendly is a later filter over the same data.
- Three fixed bands, stepped like the provision mode, with the same banded legend shape.

**Bands** (one definition, used by lane brightness, particle density and cell tint):

| Band | Rule |
| --- | --- |
| congested | `blockedVolume > 0` this run — the glossary's word and the Lane congested alert's condition |
| busy | not congested and `bookedLoad ÷ capacity` at or above a new presentation-only constant (`LANE_BUSY_LOAD_FRACTION`, default set on the prototype) |
| fine | otherwise |

Colours come from the theme's status set (a green / amber / red triple); the exact hexes are
settled on the prototype against `theme.md`.

## 3. Selection is the cell

- The star's selection ring, hover ring and hover scale-up are removed; the cell outline
  (`CellHighlightLayer`) is the sole selected/hovered state. The star stops taking pointer events
  at all — the stage resolves every click and hover.
- Click resolution drops the star-radius step: faction (zoomed out) → lane → cell. Because every
  lane ends on a star, the lane hit-test ignores a short stretch at each end of the segment so a
  click at the star lands on the cell, not on one of its lanes.

## 4. Cell-fit labels

- A system name draws when its label box lies inside the system's Voronoi cell polygon; otherwise
  it is hidden. The cell polygons already exist from the territory build.
- **Names become screen-constant** (drawn at `systemLabelSize` pixels whatever the zoom, the way
  the choropleth numbers already are) instead of world-scaled. This is what makes the fit test
  zoom-dependent: a world-scaled name has a fixed world-unit box, so its fit would never change
  with zoom and a tight cluster would never reveal a name. The label sits a screen-constant gap
  below the glyph, the same lift formula the system-tier numbers use.
- Evaluated once per zoom-band change and on frustum entry, never per frame; a system's answer is
  cached with the zoom it was computed at.
- The selected system and the hovered system always draw their name.
- The existing zoom gate (names above zoom 0.8) stays as the outer bound; the fit rule only hides
  further.

## 5. What this pass does not claim

- No new world state, save field or tick read. Every quantity drawn already exists on `WorldLane`
  or the scheduled-freight ledger.
- No change to lane mechanics, the lane card, or the Lane congested alert.
- No label priority scheme beyond selected/hovered. Tight clusters hide most names until zoomed
  well in; revisit after play.
- The migration-arrow half of [ui-ws2-map-modes.md](./ui-ws2-map-modes.md) P2 stays planned; only
  its logistics half is settled here.

## 6. Hazards

- **Per-frame cost.** The congested pulse animates a small set; the cell-fit test is cached per
  zoom band; particle counts change only on the tick that changes a band. `pixi-map-canvas.tsx`
  and `system-object.ts` are perf-sensitive (map-rendering.md guardrails).
- **Two views must agree.** The band definition is one function shared by lane, particle and cell
  tint so the zoomed-in and zoomed-out reads never disagree.
- **Losing the default-view congestion cue** is deliberate: the alert bar names an actionable
  congested lane, and the Lanes mode is one click away.
