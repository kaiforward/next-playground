# Ship Map UX

Makes the player's fleet legible on the star map — a clear docked-ship indicator plus always-visible in-transit markers with on-demand routes.

---

## Problem

Tracking your fleet is a core part of the game, but ships were hard to see on the star map.

- **Docked ships** were signalled only by a faint cyan pulse ring and a small "N SHIPS" text label. Both were easily lost against the system glow, gateway dots, event dots, and fuel labels.
- **In-transit ships were not drawn at all.** A ship in transit vanished from the map entirely until it arrived — you could not tell from the map whether you had ships moving, or where they were.

## Goals

1. Make docked-ship presence **immediately scannable** at close zoom.
2. Make in-transit ships **visible and locatable** at all times, with their route and ETA available on demand.
3. Keep the default map **uncluttered** even with many ships, including several on the same lane.
4. One coherent "this is your fleet" visual language for docked and in-transit ships alike.

## Non-goals

- No new persistence. A multi-hop path is not stored on the ship — it collapses to origin → final destination plus departure/arrival ticks. The displayed route is reconstructed as the shortest path, matching what the navigation UI offers.
- No general "select any ship on the map" framework beyond the in-transit marker interaction described here.
- No changes to the zoomed-out fleet presence shown at universe zoom — it already reads acceptably.

---

## Visual language

The fleet cue uses the existing navigation **cyan/sky** colour family, kept deliberately distinct from event dots (red/amber/purple/green/blue/slate), economy glyphs, and the price/trade overlays. One look means "this is yours."

- **Docked pill** — a small rounded pill carrying a ship-chevron glyph and the docked count, badged on the system glyph (anchored to avoid the gateway, event, and price badges). Replaces the old pulse ring and "N SHIPS" text.
- **In-transit marker** — the same pill family used as a moving marker. The pill body stays **upright** so the glyph and count remain readable; a separate **direction chevron** points along the lane toward the destination. A solo ship shows just the ship glyph; a count appears only when clustering.
- **Cluster / convoy badge** — a copper-accent count badge on a pill that represents multiple units.
- **Compact transit card** — a Foundry-styled surface (copper left stripe, mono text) shown when an in-transit marker is selected.

Route styling: a faint dashed **ghost** route on hover, and a brighter solid **active** route (animated dash flow toward the destination) when a marker is selected or the "Ship Routes" overlay is on.

---

## Interaction model — progressive disclosure

- **Default:** markers only, no route lines. You always see *that* a ship is moving and roughly *where*.
- **Hover marker:** a ghost dashed route (origin → destination) plus a small tooltip "→ <Dest> · ETA <n>t". Transient; nothing persists.
- **Click marker:** selects it on the map. Draws the solid animated route in the travel direction and opens the compact transit card. The map stays visible — this is the map-native equivalent of selecting a ship. The selected marker is highlighted so the card ↔ marker link is clear; clicking empty space or another marker updates or clears the selection.
- **"Ship Routes" overlay toggle** (alongside Trade Flows / Price): draws *all* in-transit routes at once for a fleet overview. Independent of hover/click; markers remain always-on regardless of this toggle.

ETA is expressed in ticks (remaining ticks until arrival), matching the route-preview panel's formatting.

The compact transit card shows destination, cargo, and ETA, plus a link to the full ship page. It sits in a fixed panel (not pinned to the moving marker) to keep motion smooth.

---

## Motion

In-transit markers move smoothly between ticks rather than snapping each tick. Progress along the route is derived from how far the current tick has advanced toward the arrival tick, smoothed by sub-tick wall-clock time so markers glide at the live tick rate (and adapt automatically if the rate changes).

---

## Anti-clutter strategy

- **Convoys render as a single marker** with a member-count badge — they travel as one unit, eliminating a large source of overlap.
- **Separate solo ships** on a shared lane sit at different progress points (different departure ticks / speeds) and spread out naturally.
- When solos overlap within a small screen-space threshold, they **cluster into one pill + count badge**, splitting again as they separate.
- A direction chevron disambiguates opposing traffic on the same lane.
- Because route lines are on-demand, the default view never shows overlapping lines.

---

## Edge cases

- **Route not reconstructable** (disconnected systems, or origin = destination): fall back to a straight origin → destination line; the marker is still placed by progress along that line.
- **Degenerate timing** (arrival tick equal to or already past the current tick): the marker is clamped to the destination, and disappears on the next fleet refetch when the ship's status flips to docked.
- **Fog of war:** in-transit markers are the player's own ships, so they are always visible — even when the route crosses unknown systems.

---

## System Interactions

- **Navigation** — markers represent ships moving along the same routes the navigation/pathfinding system plots; ETAs use the same tick model (see [navigation.md](./navigation.md)).
- **Events** — event dots use a separate colour family so the fleet cue stays distinct on a busy map (see [events.md](./events.md)).
