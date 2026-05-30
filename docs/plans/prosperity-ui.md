# Prosperity UI + Market Colour Consistency — Build Plan

**Branch:** `feat/prosperity-ui` (off `main`) · **Ships as:** one PR (user decision)
**Status:** in-flight build plan — delete on ship; fold functional outcomes into `docs/active/`.

Bundles four items the user grouped together:

| Item | Source | Nature |
|---|---|---|
| Prosperity badge on system screens | GitHub #86 + prosperity-UI follow-up | mechanical |
| Prosperity map visualisation | prosperity-UI follow-up | design-heavy |
| Trend column sortable | GitHub #87 | trivial |
| Price-deviation colour consistency | GitHub #85 | design decision |

The four share two cross-cutting threads, which is why they ship together:
1. **One plumbing change** (`prosperity` → `getUniverse`/`StarSystemInfo`) feeds *both* the badge and the map mode.
2. **One colour language**, deliberately split across two axes so the map never overloads a hue (see below).

---

## The colour language (the unifying decision)

Two independent meanings, two disjoint palettes, so a colour never means two things on screen at once:

- **Green ↔ red = price deal quality** (vs base price). Green = good deal *for you*, red = bad deal. "Good" is perspective-dependent (buying vs selling) — see #85.
- **Cold ↔ warm = prosperity** (system economic health). Slate-blue (crisis) → grey (stagnant) → amber (booming). Reserves green/red for price; warm end sits on the Foundry copper theme.

Reusable principle that fell out of the map architecture, worth recording:

> **Area-fill metrics → map MODES** (a polygon can only hold one colour, so they're mutually exclusive by nature).
> **Point-local accents → OVERLAYS** (halos, pills, particles, routes occupy different visual channels, so they stack).

Prosperity colours *areas* → it's a mode. Price is a per-system halo → it stays an overlay. They coexist on different channels.

---

## Part 1 — Shared plumbing: a dedicated tick-scoped prosperity feed

`StarSystem.prosperity` (Float, −1..+1, `prisma/schema.prisma`) is computed/stored every tick but exposed to **zero** API/service/type/component today.

**Decision (revised after reading the map data-flow):** the map does **not** read `getUniverse` — it builds its `universe` from the static `atlas` payload, and overlays live per-system data (price) via a separate tick-scoped fetch (`PriceHeatmapDataFetcher` → `useMarketComparison`). And `getUniverse` is the heavy static identity payload (regions+systems+connections+factions); folding a *mutable* field into it would force the whole payload to refetch to refresh prosperity — the exact "don't tie tick-scoped data to a static payload" anti-pattern.

So both surfaces share **one dedicated tick-scoped feed**, mirroring `useTradeFlow`:
- `lib/types/game.ts` — add `ProsperityEntry { systemId: string; prosperity: number }`.
- `lib/types/api.ts` — add `ProsperityResponse = ApiResponse<{ systems: ProsperityEntry[] }>`.
- `lib/services/prosperity.ts` (new) — `getProsperityBySystem(): Promise<ProsperityEntry[]>` (`findMany` selecting `id, prosperity`).
- `app/api/game/systems/prosperity/route.ts` (new) — auth-gated (`requirePlayer`), `Cache-Control: private, no-cache` (per the auth-gated-cache memory rule).
- `lib/hooks/use-prosperity.ts` (new) — `useProsperity(active)` → `Map<systemId, number>`, `useQuery` with `staleTime: 10_000`, `enabled: active`. Shared `["prosperity"]` cache key.

Both consumers share the one cache entry: the **badge** (panel) calls `useProsperity(true)`; the **map** calls `useProsperity(mapMode === "prosperity")` — gated like the price overlay so we don't fetch when the choropleth isn't shown. `getUniverse`/`StarSystemInfo` stay untouched.

**Scale flag (verify in build):** the feed is all-systems; at 10K that's a 2-column, 10K-row query. Cheap and tick-cached, and the panel already pays an all-systems cost via `useUniverse`. If it ever matters, a per-system variant can back the badge — noted, not built.

---

## Part 2 — Prosperity badge (#86)

The Overview tab and Market tab **share one layout** (`app/(game)/@panel/system/[systemId]/layout.tsx`); its subtitle row (~L61–69) already holds `EconomyBadge` + `Gateway`. One `ProsperityBadge` dropped there covers **both tabs in a single insertion** — exactly what #86 asks for.

- **New** `components/ui/prosperity-badge.tsx` — props `{ prosperity: number }`. The badge itself shows **only the label** (`getProsperityLabel` from `lib/engine/tick.ts`, the existing pure helper), accented with the continuous cold→warm ramp colour (shared util, Part 5) — e.g. `Booming`.
- **Adjacent rich descriptor** — muted text next to the badge spelling out the mechanical effect: `Production & Consumption ×1.3`, with the factor from `getProsperityMultiplier(prosperity, PROSPERITY_*)`. It adapts across states — `×0.3` (Crisis) … `×0.7` (Stagnant) … `×1.3` (Booming) — so it's correct everywhere, not just when boosted. The multiplier is ~1.0× around *Active* (~+0.5); below that throughput is reduced, so the descriptor uses the **bare factor** (optionally suffixed "boosted"/"reduced") rather than a hard-coded "up by".
- Place after `EconomyBadge` in the layout subtitle. Always shown (Stagnant included). If badge + descriptor crowd the header subtitle, the descriptor falls back to a hover tooltip on the badge or the Overview summary card — but default is inline next to the badge per the design call.
- Badge accent uses the **same** `prosperityRampColor` as the map mode so the two surfaces speak one colour language (rather than the discrete `Badge` palette, which lacks enough warm steps).

---

## Part 3 — Trend column sortable (#87)

The "Trend" column in `components/trade/market-table.tsx` (~L81–105) is the only non-sortable column — it lacks `sortable: true` + a `getValue` accessor. The sort value already exists (`getPriceTrendPct` in `lib/utils/market.ts`). `DataTable` (`components/ui/data-table.tsx`) sortability is per-column opt-in.

```ts
{
  key: "priceTrend",
  label: "Trend",
  sortable: true,
  getValue: (row) => getPriceTrendPct(row.currentPrice, row.basePrice),
  render: (row) => { /* existing render — but recoloured, see Part 4 */ },
}
```

---

## Part 4 — Price-deviation colour consistency (#85)

**Finding:** market and map already share `priceRampColor` (low = green/bargain). The real inconsistency is the **Trend column**, which colours price-*above*-base green (stock-ticker "up = good") while everything else colours it red (buyer "expensive = bad"). Green means opposite things within the same market screen. The Trend column is also mislabelled — it computes `currentPrice − basePrice` (deviation from base), the *same metric* the ramp tints.

**Decision (user):** value model everywhere, **mode-aware** (green = "act here").

- `lib/utils/price-ramp.ts` — make the helper perspective-aware: `priceRampColor(currentPrice, basePrice, mode: "buy" | "sell")`, default `"buy"`. `"sell"` flips the ramp (high price = green). Keep `priceRampColorPixi` in sync. Single source of truth for both views.
- `components/market/market-comparison-panel.tsx` — the existing `FilterMode` (`all | buy | sell`, ~L18–20/76–78) now also drives colour mode (`buy`→buy ramp, `sell`→sell ramp, `all`→buy default). Near-free; the state already exists. Coloured cell at ~L177.
- **Map price overlay** — add a small **buy/sell sub-toggle** shown only when the price overlay is active (in the price panel / dock). Drives the halo + pill tint mode in `lib/hooks/use-map-data.ts` (~L321, `priceTint`) → `system-object.ts` `redrawHalo`/`redrawPricePill`.
- **Trend column** (Part 3 render) — recolour to the value convention on the default **buy** perspective: above base = red/premium, below = green/bargain. Keep the ↑/↓ arrow (it shows direction); only the colour flips. This kills the green-means-two-things problem.

Result: one mode-aware helper consumed by comparison panel, map overlay, and trend column.

---

## Part 5 — Prosperity map mode (the design-heavy piece)

**Representation (user-confirmed):** a **per-system Voronoi choropleth** — each system's own cell filled cold→warm — added as a **4th Territory mode**, not an overlay.

**Why it's cheap:** the faction/region fills are *already* per-system Voronoi cells (`computeTerritoryPolygons` via Delaunay in `components/map/pixi/territory-utils.ts`) that get grouped + unioned by `factionId`/`regionId`. For prosperity: group by `systemId` and skip the union → one filled cell per system. Reuses existing geometry + the `TerritoryLayer` rendering pattern. Territory fills render at alpha 0.4–1.0 across all zooms, so it's brightest at the far/mid strategic glance and faint under glyphs up close — same as existing fills, **no new zoom-gating work**. The expensive path (re-tinting the far-zoom point cloud, which bakes colour at particle creation) is **sidestepped entirely** because the fill layer already covers far zoom.

Work items:
- `lib/types/map.ts` — add `"prosperity"` to `MapMode` + `MAP_MODES` (currently `political | regions | none`, ~L3–7).
- **New** `lib/utils/prosperity-ramp.ts` — `prosperityRampColor(value): string` (CSS, for the badge) + `prosperityRampColorPixi(value): number` (for the layer). Mirrors `price-ramp.ts`. Diverging cold→warm: slate-blue (−1) → grey (0) → amber (+1). Shared by Part 2 and Part 5.
- **New** `components/map/pixi/layers/prosperity-territory-layer.ts` — copy `TerritoryLayer`, group by `systemId` (no union), fill each cell via `prosperityRampColorPixi(system.prosperity)`. ~80–120 lines.
- `components/map/pixi/pixi-map-canvas.tsx` — wire the new mode into the mode-activation logic (~L350–359), feeding per-system prosperity from the universe payload.
- `components/map/map-overlay-controls.tsx` (~L67–116) — add the `prosperity` radio to the mode group; **rename the section heading "Territory" → "Mode"** (these radios *are* the mutually-exclusive map modes; "regions" already colours by economy, not territory, so "Mode" is the accurate umbrella). Add a cold→warm **legend** like the price overlay has.
- `components/map/map-session.ts` — mode already persists to sessionStorage via `useMapMode`; the new enum value rides along (confirm no exhaustive switch breaks).

Coexistence: prosperity (mode, area fill) + price (overlay, halo) + trade-flow/fleet/events (overlays) all render together on distinct channels.

---

## Files touched (summary)

**Plumbing/types:** `lib/types/game.ts` (`ProsperityEntry`), `lib/types/api.ts`, `lib/types/map.ts` (`MapMode`), `lib/query/keys.ts`, `lib/constants/economy.ts` (`PROSPERITY_PARAMS`), `lib/tick/processors/economy.ts` (use the extracted const)
**New:** `lib/services/prosperity.ts`, `app/api/game/systems/prosperity/route.ts`, `lib/hooks/use-prosperity.ts`, `lib/utils/prosperity.ts`, `components/ui/prosperity-badge.tsx`, `components/map/pixi/layers/prosperity-territory-layer.ts`
**Badge:** `app/(game)/@panel/system/[systemId]/layout.tsx`
**#87/#85 market:** `components/trade/market-table.tsx`, `lib/utils/price-ramp.ts`, `components/market/market-comparison-panel.tsx`
**#85 map:** `lib/hooks/use-map-data.ts`, `components/map/pixi/objects/system-object.ts`, map price-overlay control (dock/panel)
**Map mode:** `components/map/pixi/pixi-map-canvas.tsx`, `components/map/map-overlay-controls.tsx`, `components/map/map-session.ts`

Reused (read-only): `lib/engine/tick.ts` (`getProsperityLabel`, `getProsperityMultiplier`), `lib/constants/economy.ts` (`PROSPERITY_*`), `components/map/pixi/territory-utils.ts`, `lib/utils/market.ts` (`getPriceTrendPct`), `components/ui/data-table.tsx`.

## Open implementation flags
- **Prosperity data freshness** on the map/badge — confirm tick-scoped refresh (Part 1).
- **Point-cloud tint** is *not* needed (fill covers far zoom) — confirm fill alpha is legible at universe zoom.
- **`getProsperityLabel` thresholds** (Crisis ≤−0.5, Disrupted ≤−0.1, Stagnant ≤0.3, Active ≤0.7, Booming >0.7) are the source of truth; the `economy.md` table's anchor points differ slightly — badge uses the code helper.
- Badge layout — label-only badge + adjacent `Production & Consumption ×N` descriptor (user decision). Watch header crowding; tooltip / Overview-card fallback if it's too busy.

## Out of scope (YAGNI)
- Turning "Trend" into a real time-series trend (vs last snapshot). Stays deviation-from-base; only recoloured.
- Prosperity history/sparkline, prosperity-driven mission generation, or any new economy *mechanic* — this is purely surfacing existing data + colour consistency.
- A buy/sell mode for the prosperity choropleth (prosperity isn't a deal; the cold→warm scale is perspective-neutral).
