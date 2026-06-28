# Logistics Map Overlay (P3 — Flow-Type Visualisation)

> **Status: Designed, not built.** First of the two UI-first pieces of the
> [Economy Scaling & Trade-Logistics Rework](../planned/economy-scaling-and-trade-rework.md)
> (**P3 — map overlay by `flowType`**; P4 is the imports/exports dashboard). Model-agnostic:
> **pure visualisation, zero economy change** — it surfaces flows the engine already records.
> Ships *before* the scaling work. The engine already tags every `TradeFlow` row
> `"market"` (diffusion) or `"logistics"` (directed); this spec plumbs that tag through to the map.
> Roadmap home: [economy-simulation-vision.md](../planned/economy-simulation-vision.md) §13 (SP5
> autonomic-light, directed-logistics track). **Delete this plan once shipped** — the functional
> description moves to `docs/active/gameplay/`.

---

## Headline

The map's trade-flow overlay today merges *every* flow into one straight-line, tier-coloured
particle stream. But the engine records two physically different things:

- **Market diffusion** — passive, price-equalising stock seeping between **adjacent** systems. It
  rides the lane network, so its particles already flow along lines the player can see.
- **Directed logistics** — a faction **deliberately** hauling surplus → deficit, up to **4 hops**
  across open space with **no lane underneath it**. This is the silent intra-faction supply chain the
  later scaling/contract rework turns into player-contestable trade.

Drawn the same way, the long-range logistics hauls cut straight across empty space and unrelated
systems — illegible. This overlay separates them:

> **A new, independently-toggled "Logistics" overlay renders directed faction hauls as curved arcs
> that lift off the straight lane network — tier-coloured like the market overlay, arrow-headed toward
> the importing system. "Trade Flows" stays exactly as it is (market diffusion).**

---

## Design decisions (and why)

| Fork | Decision | Why |
|---|---|---|
| **How to draw long-range hauls** | **Curved arcs** (bezier), not straight chords, lane-routing, or source/sink glyphs. | Logistics transfers are **instant and point-to-point** — the engine moves stock `from→to` in one tick and stores **no path** (see `directed-logistics.ts`). So only the two endpoints are ground truth; an arc commits to nothing about the middle, while *routing along lanes (option C)* would draw a specific path the sim never computes **and** needs the whole intermediate chain loaded client-side (the map is tile/viewport-limited at scale). The curve also visually separates logistics from the straight lanes — the legibility win. Straight chords read too much like lanes; glyphs lose *who ships to whom*. |
| **Overlay structure** | A **separate** "Logistics" overlay checkbox, independent of "Trade Flows" (market). | The two are different *kinds* of flow with different geometry; the player should read either alone or both together. Keeps the existing market overlay untouched. |
| **Visibility gating** | **Spatial** — show a logistics arc if ≥1 endpoint is in the player's visibility set. **Identical to the market overlay.** | Consistent, no new concept, reuses the existing server-side `getPlayerVisibility` filter. A *friendly-faction intel* gate ("you can't see a rival's internal supply chain") is a better mechanic but wants a real player↔faction intel system — deferred (see below). |
| **Colour** | **Tier colours** (T0 green / T1 amber / T2 cyan), by the edge's dominant good's tier — the **same scheme + legend** as the market overlay. | There are too many goods for unique hues (the market overlay already solved this with tiers). The arc shape carries the "it's logistics" signal, so colour is free to carry "what tier is moving." One palette to learn, not two. |
| **Per-flow good detail** | **Deferred** — no hover-tooltip in P3. | Specific-good identity is already earmarked for "the future hover-tooltip iteration" (comment on `TIER_COLOR`) and is covered per-system by **P4** (imports/exports dashboard). Trade-flow edges have **zero** hit-testing today, so hover is net-new interaction work (curved-arc hit areas, hover state, canvas-anchored tooltip) — its own follow-up. The `perGood` data is already in the payload, ready for it. |
| **Direction** | Arrowhead at the destination (the deficit/importing system); reuse the existing net-direction logic. | Logistics is inherently directional (surplus→deficit) and rarely balanced both ways on a pair, so the dominant-good net direction already resolves correctly. |

---

## The seam map

```
 engine (UNCHANGED)            service                       client
 ┌───────────────────┐   ┌──────────────────────┐   ┌────────────────────────────┐
 │ trade-flow proc   │   │ getTradeFlowEdges()   │  │ useTradeFlow(mkt, logi)     │
 │  → flowType="market" ─┤  groupBy + flowType   ├─►│  fires if either toggle on  │
 │ directed-logistics│   │  partition into two   │  └─────────────┬──────────────┘
 │  → flowType="logistics"│  { marketEdges,        │                ▼
 │                   │   │    logisticsEdges }    │  ┌────────────────────────────┐
 │ TradeFlow rows    │   │  (same collapse logic, │  │ use-map-data: two flowEdges │
 │  (have flowType)  │   │   run per flowType)    │  │  maps (market / logistics)  │
 └───────────────────┘   └──────────────────────┘   └─────────────┬──────────────┘
                                                                    ▼
                                       ┌─────────────────────────────────────────────┐
                                       │ Pixi: TradeFlowLayer (market, straight)       │
                                       │       LogisticsFlowLayer (arced convoys)      │  ← new
                                       │  share one polyline particle emitter          │
                                       └─────────────────────────────────────────────┘
                                       ┌─────────────────────────────────────────────┐
                                       │ MapOverlayControls: + "Logistics" checkbox    │  ← new key
                                       │  legend: tiers + "arc = directed haul →"       │
                                       └─────────────────────────────────────────────┘
```

Schema: **no change** (`TradeFlow.flowType` already exists). Simulator: **unaffected** (no economy change).

---

## Service — partition by `flowType`

`getTradeFlowEdges(playerId)` (`lib/services/trade-flow.ts`) today groups by
`(fromSystemId, toSystemId, goodId)` and **discards `flowType`**. Change:

1. Add `flowType` to the `groupBy` `by` clause (still one indexed query over the window).
2. Partition the grouped rows by `flowType`, then run the **existing** collapse-to-undirected-edge
   logic (net direction, dominant tier, `perGood`, visibility gate) **once per flow type**.
3. Return `{ marketEdges: TradeFlowEdgeInfo[]; logisticsEdges: TradeFlowEdgeInfo[] }`.
   The per-edge type `TradeFlowEdgeInfo` is **unchanged** — just two collections. (Update
   `TradeFlowResponse` in `lib/types/api.ts` accordingly.)

The visibility filter and the net-direction/dominant-tier logic are reused verbatim — only the
partition is new. The whole computation stays one DB round-trip; the unused array is ignored
client-side when only one overlay is on.

### Calibration note — the route-inference floor

The service drops any undirected edge whose cumulative volume over `FLOW_HISTORY_TICKS` (200) is below
`ROUTE_INFERENCE_FLOOR` (**5**). That floor is tuned for **market** magnitudes. Logistics flows are
**sparse** (one transfer per faction-shard sweep, every `INTERVAL = 2× ECONOMY_UPDATE_INTERVAL` ticks)
**and small in the current pre-scale economy** — so the market floor may hide most logistics arcs
exactly when "UI before scaling" wants them visible.

**Decision:** give logistics its **own** inference floor (e.g. `LOGISTICS_ROUTE_FLOOR`, low — likely
`1`) rather than reusing 5. Verify during the manual smoke (below) that arcs actually appear in the
current economy; the floor lifts naturally once `ECONOMY_SCALE` lands. Keep the same 200-tick window
for both (consistent overlay liveness).

---

## Rendering — the arc

Reuse the particle machinery; the only genuinely new geometry is the curve.

- **Path.** Each logistics edge bakes a **quadratic bezier** sampled into a short polyline. Particles
  advance by **arc-length** along that polyline (so they keep constant on-screen speed regardless of
  curve length), exactly as the straight edge advances along its 2-point line today.
- **Shared abstraction (DRY).** Generalise today's `TradeFlowEdge` (which bakes a straight 2-point
  path) into a **polyline-path particle emitter** with a style (particle radius, glow, speed). Market =
  a 2-point straight polyline (behaviour preserved); logistics = a sampled-arc polyline. The two
  overlays are then thin layers over one emitter — no duplicated particle code.
- **Bow rule.** Bow perpendicular to the directed `from→to` chord, **always to a consistent side** of
  travel, magnitude **∝ chord length** (clamped to a max), so parallel hauls fan apart instead of
  overlapping and the curve direction stays readable. Deterministic (no per-frame jitter).
- **Convoy style.** Logistics particles are **larger + glowing** (Pixi `shadowBlur`/additive) and a
  touch faster than market's small ambient dots, so the two read apart even when both overlays are on
  and even when they share a tier colour (shape + glow disambiguate). An **arrowhead** sits at the
  destination, tangent to the curve.
- **Colour.** `getGoodColor(dominantGoodId)` → tier colour, same as market.
- **Theme constants.** Add a `LOGISTICS_FLOW` block in `components/map/pixi/theme.ts` (arc-bow
  factor + clamp, particle radius, glow, speed, particle caps) mirroring `TRADE_FLOW`. Leave
  `TRADE_FLOW` untouched. Keep the existing `maxTotalParticles` global cap discipline.
- **LOD / culling.** Reuse the existing per-frame frustum-cull + LOD-alpha path; the arc's bounding
  box is the polyline's AABB.

---

## Controls & legend

- `lib/hooks/use-map-overlays.ts` — add a `logistics` overlay key alongside `tradeFlow`.
- `MapOverlayControls` — add a "Logistics" checkbox to `OVERLAY_DEFS` (after "Trade Flows"), with a
  tooltip legend. The legend **reuses the tier ramp** and adds the shape cue: *straight dots = market
  diffusion; arc = directed faction haul; arrow points to the importer*. Both overlays share the
  tier colours and differ by **shape**.

---

## Out of scope / deferred (do NOT build here)

- **Per-flow hover-tooltip** (top-N goods on an edge) — own follow-up; `perGood` already in payload.
- **Friendly-faction intel gate** — show only allied factions' logistics. Wants a real player↔faction
  intel system; layer on later. P3 uses the spatial gate.
- **Blockade / dangerous-system gating** — because logistics is instant point-to-point, danger would
  gate *generation* (the matcher/diffusion skips those systems), not interrupt a haul mid-flight. The
  overlay just shows the resulting absence. Belongs with the blockade/danger mechanic, not here.
- **Transit-time for silent moves** — deferred enabler in the rework doc; does not affect this overlay.
- **Lane-routed rendering (option C)** — revisit only if/when corridors become *mechanically*
  meaningful (transit-time + blockades). Would need server-computed paths + a polyline rewrite.

---

## Testing

- **Service (integration, Postgres project).** Fixture with both `market` and `logistics` rows on the
  **same** endpoint pair → asserts two separate edges in the two collections, correct net direction,
  correct dominant tier, `perGood` intact. Keep/extend the **visibility-gate** assertion (an
  out-of-view edge is excluded). Assert the **logistics floor** admits a small-volume logistics edge
  that the market floor would have dropped.
- **Engine (unit, pure).** Extract the arc geometry (bezier sampling + arc-length param + bow-rule)
  into a pure helper and unit-test: arc-length sampling is monotonic/constant-speed; the bow rule is
  deterministic and bows to the correct side for a given direction.
- **Pixi.** Rendering isn't unit-tested — covered by the **manual visual smoke** (user-run): toggle
  Logistics on, confirm arcs appear (floor check), curve off the lanes, tier-colour, arrowhead toward
  the importer, and read cleanly with Trade Flows also on.

---

## Suggested build order

Small enough for one PR, but naturally three commits:

1. **Service + types** — `flowType` partition, `{ marketEdges, logisticsEdges }`, logistics floor,
   integration tests.
2. **Pixi** — generalise the emitter to a polyline path; add arc geometry + convoy style + the
   `LogisticsFlowLayer`; engine unit tests for the geometry.
3. **Controls** — `logistics` overlay key, checkbox, legend; wire `use-map-data` to feed two edge
   maps. Manual smoke.

A detailed step plan follows from the `writing-plans` pass.
