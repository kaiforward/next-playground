# Trade UX Improvements

Three independent UX improvements to the buy/sell/navigate loop. None are systemic — they pave existing cowpaths.

---

## 1. Integer supply and demand

### Problem

Markets used to render fractional supply/demand values (e.g. `Carbon Steel · supply 3.734`). The economy simulator persists floats because per-tick drift increments (small production rates, sub-unit noise) must accumulate to matter, but the player should never see a non-integer quantity.

### Behaviour

Supply and demand are **floored** for display and for trade validation, so the quantity shown is exactly the maximum the player can act on. The underlying economy math stays float — only the player-facing numbers are floored.

### Why floor and not round

Rounding `99.6` up to `100` would let the player attempt to buy 100 and then fail with "available 99.6". Flooring is conservative and never lies in the player's favour.

---

## 2. Enriched System Detail Panel

### Problem

Clicking a system on the galaxy map opened a thin panel showing only fleet **counts** and text links to the Ships/Convoys/Market tabs. The most common intent — navigate a ship from here — took the most clicks (open panel → Ships tab → leave map → find ship → Navigate → return to map → pick destination), and the panel had empty space.

### Approach

The panel is the **map-side hub** for both navigation and deep-linking to system tabs. Both intents — "navigate a ship from here" and "jump to a system tab" — become one click.

### Layout

Top to bottom, with sections shown only when they have content:

1. **Status row** — economy badge · gateway badge · danger badge · region · faction.
2. **Tab shortcuts** — a row of buttons (`Market` `Ships` `Contracts` `Overview`) linking straight to the relevant system route.
3. **Active events banner** (if any) — surfaced prominently since events affect trade.
4. **Convoys here** (if any) — violet-accent cards: name · member-count pill · combined cargo, with inline `Navigate` and `Trade` actions. Up to three shown; overflow rolls into a `View all N →` link.
5. **Ships here** (if any) — cyan-accent cards: name · role pill · status, with inline `Navigate` and `Trade` actions. Only docked, idle ships; ships in a convoy appear under their convoy entry instead. Up to three shown; overflow rolls into a `View all N →` link.
6. **Traits** — compact chip list.
7. **Coordinates** — compact, low priority.

### Inline Navigate behaviour

Because the panel is already on the map, the inline `Navigate` button drives the map's navigation state directly: clicking it closes the panel and the map enters "Select a destination for X" mode — no page change, no remount.

### Out of scope

Per-ship cargo summary in the card · refuel/repair from the panel (still reachable via the ship details page) · cross-system "send ship from anywhere" actions.

---

## 3. Cross-system market comparison

### Problem

Comparing prices for the same good across systems required opening each system's market page one at a time. There was no surface answering "where is good X cheapest / most expensive" across the systems you can see.

### Approach

A single by-good price lookup feeds two surfaces that answer different questions:

- **Map overlay** — a *planning view*: where in the universe is this good worth buying or selling?
- **Drill-down side panel** — a *decision view*: a sortable table of price/supply/demand across visible systems, with jump distance from the system you're looking at.

Both operate over the player's **visible** set of systems.

### Map overlay (price heatmap)

A `priceHeatmap` overlay, toggled alongside the other map overlays. When active it reveals a good picker; selecting a good tints visible systems by `currentPrice / basePrice` along a continuous, anchored colour ramp:

- `≤ 0.6×` → bright green (deep bargain to buy)
- `≤ 0.85×` → light green
- `≈ 1.0×` → amber (neutral)
- `≥ 1.15×` → orange
- `≥ 1.4×` → red (premium to sell)

Systems with no data stay at their normal map tint. A legend renders in the overlay control panel, plus a `Show all prices` button that opens the drill-down panel.

### Drill-down side panel

Opened from the overlay's `Show all prices` button or from a `Compare` action on each market-table row.

- Title: `[Good name] · prices across X visible systems`.
- Filter chips: `Buy` (sort ascending by price), `Sell` (sort descending), `All` (default).
- Sortable columns: **System** (name + faction colour dot) · **Jumps** (hops from the "from" system) · **Price** (coloured by the heatmap ramp) · **Supply** · **Demand** · **Go** (re-centres the map on that system and opens its detail panel).
- The "from" system row (zero jumps) is highlighted.
- Empty state when fewer than two visible systems carry the good.

**"From system" resolution** — when opened from a market page, it's that system; when opened from the map overlay, it's the most-recently-selected system (falling back to the first system that has a player ship).

**Jump distance** — hops from the "from" system through the universe connection graph, capped at a small number of hops to keep it bounded; unreachable systems show `—`.

### Out of scope

Layered in later if the trade loop is still confusing: a combined "best deal" score weighting price by fuel + distance · per-row "send this ship there" routing · cargo-aware sell suggestions · multi-good comparison matrices · caching last-known prices for systems that drop out of visibility.

---

## System Interactions

- **Economy** — prices, supply, and demand all come from the economy model; the floor and the comparison ramp read the same `calculatePrice` used elsewhere (see [economy.md](./economy.md)).
- **Trading** — these changes target the buy/sell/navigate loop directly (see [trading.md](./trading.md)).
- **Navigation** — the enriched panel's inline Navigate and the comparison panel's jump distances build on the navigation/pathfinding system (see [navigation.md](./navigation.md)).
