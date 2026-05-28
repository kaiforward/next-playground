# Trade UX Improvements

Three small, independent UX fixes addressing pain points in the buy/sell/navigate loop. None are systemic — they pave existing cowpaths.

**Status**: planned · agreed scope, no code yet.

---

## 1. Floor supply and demand at the service boundary

### Problem

Markets render fractional supply/demand values (e.g. `Carbon Steel · supply 3.734`). The economy simulator persists floats because per-tick drift increments (production rates like `0.3/tick`, sub-unit noise) must accumulate to make a difference. Rounding at the processor would break drift; rounding at every render site is fragmented and risks the validator showing one number and the display another.

### Approach

Floor supply and demand **once, at the service boundary**. Engine math stays float; the player never sees a non-integer quantity.

### Implementation

- `lib/services/market.ts` `getMarket()` — apply `Math.floor()` to `m.supply` and `m.demand` when constructing each `MarketEntry`. Pass the **raw float** values into `calculatePrice()` so price stays smooth.
- The trade validators in `lib/services/trade.ts` and `lib/services/convoy-trade.ts` read `m.supply` before calling `validateAndCalculateTrade` — floor it at that read so the displayed quantity matches the maximum the validator allows.
- No schema change. No migration.

### Why floor and not round

A `99.6` rendered as `100` would let the player attempt to buy 100 but fail with "available 99.6". Flooring is conservative and never lies in the user's favour.

### Out of scope

Snapshots (`priceSnapshots` only persist price, which is already integer-rounded by `calculatePrice`). Trade-flow processor (operates on raw market values upstream of this fix).

---

## 2. Enrich the System Detail Panel

### Problem

Clicking a system on the galaxy map opens a thin right-side panel that shows only fleet **counts** and text links to the Ships/Convoys/Market tabs. To navigate a ship from the map, the player currently does:

1. Click system → panel opens
2. Click "Ships tab" link → leaves map
3. Find ship card, click Navigate → returns to map with ship selected
4. Click destination

The panel has empty space and the most common intent (navigate a ship) takes the most clicks.

### Approach

Turn the panel into the **map-side hub** for both navigation and deep-linking to system tabs. Both intents — "navigate a ship from here" and "jump to a system tab" — become one click.

### Layout

Top to bottom, sections shown only when they have content:

1. **Status row**: economy badge · gateway badge · danger badge · region · faction.
2. **Tab shortcuts**: a row of four buttons — `Market` `Ships` `Contracts` `Overview`. Each is a `Link` to the existing route. The "View System" button at the bottom can stay as an Overview alias or be removed in favour of the tab button.
3. **Active events banner** (if any) — surface higher than today since they affect trade.
4. **Convoys Here** (if any): violet-accent cards.
   - Name · member-count pill · combined cargo.
   - Buttons: `Navigate` (inline, triggers nav-mode for the convoy) · `Trade` (links to `/system/[id]/market?tradeConvoyId=…`).
   - Show up to 3; overflow rolls into a `View all N →` link to `/system/[id]/convoys`.
5. **Ships Here** (if any): cyan-accent cards.
   - Name · role pill · status.
   - Buttons: `Navigate` (inline, triggers nav-mode) · `Trade` (links to `/system/[id]/market?tradeShipId=…`).
   - Only docked + idle ships. Ships that belong to a convoy are hidden here — they appear under their convoy entry.
   - Show up to 3; overflow rolls into a `View all N →` link to `/system/[id]/ships`.
6. **Traits** (compact chip list).
7. **Coordinates** (compact, low priority).

### Inline Navigate behaviour

The existing nav flow (`/?navigateShipId=…`) round-trips through the URL. Since the panel is already on the map, the inline `Navigate` button should call the local nav state directly (the existing `useNavigationState` returned from `StarMap` — exposed via context or prop drilling). Result: clicking Navigate closes the panel and the map enters "Select a destination for X" mode — no URL change, no remount.

### Files to touch

- `components/map/system-detail-panel.tsx` — most of the work.
- `components/map/star-map.tsx` — pass `navigation.selectUnit` down to the panel so inline Navigate can trigger it.
- Possibly extract a `CompactShipCard` / `CompactConvoyCard` from `components/fleet/ship-card.tsx` to avoid duplication.

### Out of scope

Per-ship cargo summary in the card · refuel/repair from the panel (still reachable via Details →) · cross-system "send ship from anywhere" actions.

---

## 3. Cross-system market comparison

### Problem

Comparing prices for the same good across systems requires opening each system's market page one at a time. There's no surface that shows "where is good X cheapest/most expensive" across visible systems.

### Approach

One aggregated endpoint feeds two surfaces that answer different questions:

- **Map overlay** — *planning view*: where in the universe is this good worth buying or selling?
- **Drill-down side panel** — *decision view*: sortable table of price/supply/demand across visible systems, with jump distance from the currently-viewed system.

### Endpoint

`GET /api/game/market/by-good/[goodId]`

- Auth-gated (`requirePlayer`).
- Returns: `{ systems: Array<{ systemId, currentPrice, basePrice, supply, demand }> }`.
- Service: `lib/services/market-comparison.ts` →
  - Read `getPlayerVisibility(playerId)` to get the visible set.
  - Read all `StationMarket` rows for that `goodId` whose station's `systemId` is in the visible set.
  - Build entries with the same `calculatePrice` used elsewhere; floor supply/demand per issue #1.
- Caching header: `Cache-Control: private, no-cache` (auth-gated, per-tick dynamic).
- Tick invalidation: register in `lib/query/keys.ts` + `useTickInvalidation`.

### Map overlay

Extend `lib/hooks/use-map-overlays.ts` and `components/map/map-overlay-controls.tsx`:

- New overlay key: `priceHeatmap`.
- When active, the overlay control reveals a good picker (`SelectInput`).
- Selecting a good fires the comparison query and the Pixi renderer tints visible systems per `currentPrice / basePrice`.
- Colour ramp (continuous, but anchored):
  - `≤ 0.6×` → bright green `#3ec775` (deep bargain to buy)
  - `≤ 0.85×` → light green `#7dd97f`
  - `≈ 1.0×` → amber `#d9c95d` (neutral)
  - `≥ 1.15×` → orange `#dc7b4a`
  - `≥ 1.4×` → red `#c84545` (premium to sell)
- Out-of-range / no-data systems stay at their normal map tint.
- Legend rendered in the overlay control panel (mirrors the trade-flow legend pattern).
- The overlay control panel gets a `Show all prices` button when the price overlay is active — opens the drill-down panel.

### Drill-down side panel

A new component, e.g. `components/market/market-comparison-panel.tsx`, opened over the map or alongside the market page.

Entry points:
- Map: `Show all prices` in the overlay control.
- System market page: a new `Compare` button on each `MarketTable` row (additional column or icon-only button).

Content:
- Title: `[Good name] · prices across X visible systems`.
- Optional filter chips: `Buy` (sort ascending by price), `Sell` (sort descending), `All` (default).
- Sortable table columns:
  - **System** — name + faction colour dot.
  - **Jumps** — hops from the "from system" (see below).
  - **Price** — coloured by the same ramp as the heatmap.
  - **Supply** — floored, integer.
  - **Demand** — floored, integer.
  - **Go** — re-centres the map on the system and opens the (enriched) detail panel for it. No ship context required — the player completes the navigation using the panel's ship cards.
- Highlight the "from system" row (zero jumps).
- Empty state when fewer than 2 visible systems carry the good.

"From system" resolution:
- If opened from the market page: the system whose page you're on.
- If opened from the map overlay: the most-recently-selected system on the map (`view.selectedSystem` from `useMapViewState`). If none, fall back to the first system that has a player ship.

Jump calculation:
- BFS through `universeData.connections` from the "from system". Cap at e.g. 6 hops to keep the calc bounded; unvisited / unreachable systems show `—`.
- Pure function in `lib/engine/pathfinding.ts` (extend or reuse the existing pathfinder). Build adjacency once per render via `useMemo`.

### Files to touch

- New: `app/api/game/market/by-good/[goodId]/route.ts`, `lib/services/market-comparison.ts`, `lib/hooks/use-market-comparison.ts`, `components/market/market-comparison-panel.tsx`.
- Modified: `lib/hooks/use-map-overlays.ts`, `components/map/map-overlay-controls.tsx`, `components/map/pixi/pixi-map-canvas.tsx` (heatmap tint), `components/trade/market-table.tsx` (Compare button), `lib/query/keys.ts`, `lib/hooks/use-tick-invalidation.ts`.

### Out of scope

Layered in later if the trade loop is still confusing:

- Single combined "best deal" score that weights price by fuel + distance.
- Ship-context routing (per-row "Send this ship there" with a pre-resolved route).
- Cargo-aware sell suggestions ("you have 40 Carbon Steel — sell it at Anvil for max profit").
- Multi-good comparison (matrix of N goods × M systems).
- Caching last-known prices for systems that drop out of visibility.

---

## Build Order

Independent enough to ship as three small PRs in this order:

1. **#1 — Goods floor** (smallest; ~5 lines). One PR.
2. **#2 — Enriched panel** (no new endpoint; client data already loaded). One PR.
3. **#3 — Market comparison** (endpoint + service + overlay + panel). Two PRs:
   - 3a: endpoint + service + drill-down panel + Compare button.
   - 3b: map overlay + good picker + heatmap rendering.

Each PR small enough to hold full convention context (per the 2–4-phase PR rule in `CLAUDE.md`).
