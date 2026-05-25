# Trade Simulation (Edge Flow) — Implementation Plan

## Context

The economy has no spatial restoring force. Production and consumption alone move every market toward clamp boundaries, so without inter-system trade pressure prosperity stagnates at the 0.7× multiplier. Player density (10–50 across 10K systems at scale) cannot supply that pressure. The merged processor refactor (PR #61) cleared the architectural way for this feature.

We will simulate trade as **goods flowing along graph edges** driven by local price gradients — pure math on edges and markets, no NPC entities. Flow events feed prosperity and become the data source for a player-facing map overlay. Full design at `docs/design/active/trade-simulation.md`.

This plan ships in **three PRs** (data → overlay → details), each small enough to review against the quality checklist independently.

Status:
- **PR 1 — shipped** (commit `d9e6d57` on `feat/trade-flow`). 7 unit + 2 integration tests added; full suite 749/749.
- **PR 2 — next**.
- **PR 3 — planned**.

---

## PR 1 — Flow Processor + Data Foundation _(shipped)_

Build the simulation; no UI yet. Validate via sim sweeps and an integration test that confirms flow restores prosperity in a stagnant region.

### New files

- **`lib/constants/trade-simulation.ts`** — `TRADE_SIMULATION` constants per the design doc (`PROCESS_EVERY_N_TICKS`, `FLOW_BUDGET`, `GRADIENT_THRESHOLD`, `GRADIENT_SENSITIVITY`, `FLOW_HISTORY_TICKS`, `PLAYER_DISPLACEMENT_FACTOR`, `ROUTE_INFERENCE_FLOOR`). Mirrors `lib/constants/economy.ts` shape.
- **`lib/tick/world/trade-flow-world.ts`** — World interface (read: regions, region edges, markets-on-edge endpoints, recent player volume per region; write: bulk market deltas via existing path, append flow events, prune flow events).
- **`lib/tick/adapters/prisma/trade-flow.ts`** — Prisma adapter. Bulk writes via `createMany` for flow events and `unnest()` UPDATE for market deltas. Pruning is one `deleteMany({ where: { tick: { lt: currentTick - FLOW_HISTORY_TICKS } } })`. Follows the pattern from `lib/tick/adapters/prisma/economy.ts`.
- **`lib/tick/adapters/memory/trade-flow.ts`** — In-memory adapter for the simulator. Mirrors the Prisma adapter against arrays; flow events stored as `SimFlowEvent[]`.
- **`lib/tick/processors/trade-flow.ts`** — Pure `runTradeFlowProcessor(world, ctx, params)` body + `tradeFlowProcessor` `TickProcessor` wrapper. Frequency 1 tick (gating is internal — round-robin per region every N ticks). `dependsOn: ["economy"]` so flow runs after price reversion settles for the picked region. Round-robin in body: `regions[ctx.tick % regions.length]` exactly as `runEconomyProcessor` does.
- **`prisma/schema.prisma` addition** — `TradeFlow` model from the design doc (indexes on `(tick)`, `(fromSystemId, tick)`, `(toSystemId, tick)`, `(goodId, tick)`). Relations on `StarSystem` as `tradeFlowsFrom` / `tradeFlowsTo`.
- **`lib/tick/processors/__tests__/trade-flow.test.ts`** — Unit tests against the memory adapter (gradient threshold honored, budget caps quantity, no flow at equilibrium, displacement reduces budget under player pressure).
- **`lib/engine/__tests__/trade-flow-integration.test.ts`** — Integration test using the existing sim harness (seeded RNG per memory): a region of producer/consumer pairs should converge to non-zero `tradeVolumeAccum` and rising prosperity within N ticks. Replaces the part of `simulator-integration.test.ts` that currently demonstrates stagnation.

### Modified files

- **`lib/tick/registry.ts`** — Add `tradeFlowProcessor` to the processors array. Position after `economyProcessor` (declared via `dependsOn`).
- **`lib/engine/simulator/economy.ts`** — Wire `InMemoryTradeFlowWorld` into the sim tick loop alongside the existing economy adapter so sim sweeps include flow effects. (Sim orchestration lives here, not in `runner.ts`/`scripts/simulate.ts` as the original plan assumed.)
- **`lib/engine/simulator/constants.ts`** — Add `tradeFlow` to `DEFAULT_SIM_CONSTANTS` so sim runs pick up the same defaults the live processor uses.
- **`lib/engine/simulator/types.ts` / `world.ts`** — Extend `SimWorld` and add `SimFlowEvent` / `SimConnection` so the flow adapter has the shapes it needs.
- **`lib/engine/simulator/experiment.ts`** — Surface flow constants in the YAML override schema (`overrides.tradeFlow`) so sweeps can tune `FLOW_BUDGET` / `PROCESS_EVERY_N_TICKS` / `GRADIENT_THRESHOLD` against the equilibrium targets in `docs/design/active/economy-tuning.md`.
- **`docs/design/planned/trade-simulation.md` → `docs/design/active/trade-simulation.md`** — Promote on PR 1 ship. Update the implementation-phases section with what actually shipped.

### Reused pieces (do not re-create)

- Market mutation math: `resolveMarketTickEntry()` in `lib/engine/market-tick-builder.ts` — flow applies the same supply/demand deltas a player trade would.
- `tradeVolumeAccum` write path: increment the accumulator in the same Prisma update that adjusts supply/demand. Captured-volume subtraction handled downstream by the existing `applyProsperityUpdates` (no double-reset).
- Connection enumeration: `SystemConnection` table queried via the adjacency cache (`lib/services/adjacency.ts:getAdjacencyList()`). Filter to within-region edges in the adapter.
- Region structure: existing `SimRegion` type and `world.getRegions()` already deliver alphabetically sorted regions.
- Player pressure source: `TradeHistory` filtered by region (already exists per the design doc); read once per processor run via the adapter.

### Decisions resolved here

- **Per-system aggregate counters**: defer storage. We will compute "recent import/export volume" on demand from `TradeFlow` events (cheap with the `(toSystemId, tick)` / `(fromSystemId, tick)` indexes; window is bounded by `FLOW_HISTORY_TICKS`). If profiling shows the queries dominate, PR 3 can promote them to columns on `Market`. Avoids dual-write maintenance now.
- **One good per edge per run**: design's "steepest-gradient good wins" rule. Simple, deterministic, multi-tick coverage of all goods.

### Verification

- `npx vitest run` — new unit + integration tests pass.
- `npm run simulate` — baseline + with-flow comparison: with flow enabled, regions should show non-zero `tradeVolumeAccum` and prosperity > 0.
- `npm run simulate -- --config experiments/trade-flow-sweep.yaml` — sweep `FLOW_BUDGET` × `GRADIENT_THRESHOLD` × `PROCESS_EVERY_N_TICKS`. Pick the values where equilibrium prices stay inside the bands from `economy-tuning.md` and prosperity climbs without overshoot.
- `npx prisma db push` then `npm run dev` — manually verify the tick log shows `tradeFlow` entries and no transaction timeouts at default seed scale.

---

## PR 2 — Tick-Scoped Flow API + Map Overlay

Surface PR 1's `TradeFlow` data on the galaxy map as a new Pixi layer with directional flowing-particle animation along high-volume edges.

### New files

- **`app/api/game/systems/trade-flow/route.ts`** — `GET /api/game/systems/trade-flow`. Returns aggregate flow per edge over the last `FLOW_HISTORY_TICKS`: `{ edges: Array<{ fromSystemId, toSystemId, totalVolume, dominantGoodId, perGood: Record<goodId, number> }> }`. **Visibility-gated server-side**: edges returned only if at least one endpoint is in the player's visibility set (`computeVisibility(playerId)` from the visibility service — same source `useVisibility` consumes). Trade-flow volume is dynamic data per `docs/design/planned/visibility-system.md` §1, so it must follow the same gating rules as prices/events. Auth-gated → `Cache-Control: private, max-age=...` per memory's auth-gated rule. Single query against `TradeFlow` with `groupBy([fromSystemId, toSystemId, goodId])`, post-processed into edge shape, then visibility-filtered.
- **`lib/hooks/use-trade-flow.ts`** — TanStack Query hook on the tick-scoped pattern. Modeled exactly on `lib/hooks/use-dynamic-tiles.ts`. Query key `queryKeys.tradeFlow` (no viewport bounds — fetch once per tick, filter client-side). **Only enabled when the trade-flow map overlay is active** (`enabled: overlays.tradeFlow`) so we don't pay the request cost when toggled off. 10s stale time, 30s cache.
- **`components/map/pixi/layers/trade-flow-layer.ts`** — New Pixi layer. Z-order between `ConnectionLayer` and `TerritoryLayer`. For each in-frustum edge with `totalVolume > ROUTE_INFERENCE_FLOOR`:
  - One `ParticleContainer` of directional dots flowing from→to. Particle speed proportional to volume; spawn rate capped per frame (same `MAX_CREATES_PER_FRAME` discipline as `SystemLayer`).
  - Particle tint pulled from a `goodId → color` map keyed on `--color-status-*` tokens (food→green, metals→amber, etc.).
  - Edge thickness emphasized via a thin underlay graphics call (additive on top of the existing connection).
- **`components/map/pixi/objects/trade-flow-edge.ts`** — Per-edge particle emitter. Handles direction, speed, color, and per-frame advance/recycle. Modeled on the existing route-particle code inside `EffectLayer`.
- **`lib/constants/good-colors.ts`** — Centralized `goodId → themeToken` map (food, metals, fuel, tech, contraband, neutral fallback). Imported by both the Pixi tint mapper and any later legend UI.
- **`components/map/map-overlay-controls.tsx`** — Floating control cluster, top-right of the map. PR 2 ships a single toggle button (`Trade Flows`); the cluster is structured to accept more overlay toggles later (danger heatmap, faction control, etc.) without re-architecting. Foundry theme: copper accent stripe, sharp corners, icon + label, active state shows copper fill. Each toggle is an independent boolean — overlays combine, not mutually exclusive.
- **`lib/hooks/use-map-overlays.ts`** — Client hook that owns the overlay-toggle state (`{ tradeFlow: boolean }`) and persists it via the existing `map-session.ts` mechanism (extend `MapSessionState` with an `overlays` field). Default off. Returns `{ overlays, toggle(key) }`.

### Modified files

- **`lib/query/keys.ts`** — Add `tradeFlow: ['trade-flow'] as const`.
- **`lib/hooks/use-tick-invalidation.ts`** — Invalidate `tradeFlow` on `shipArrived` (post-tick boundary) so the overlay refreshes when new flow ticks commit.
- **`lib/hooks/use-map-data.ts`** — Merge flow data into `MapData` shape (`flowEdges: Map<edgeKey, FlowEdge>` keyed by `${fromId}|${toId}`). Pass through to `PixiMapCanvas`. Flow edges are empty when the overlay toggle is off (hook gated by `overlays.tradeFlow`).
- **`components/map/star-map.tsx`** — Mount `MapOverlayControls` over the canvas (absolute, top-right). Wire `useMapOverlays()` and pass the active overlays into `useMapData` / `PixiMapCanvas` so the trade-flow layer activates accordingly.
- **`components/map/map-session.ts`** — Extend `MapSessionState` with `overlays?: { tradeFlow?: boolean }` and the corresponding parse/persist branches. Keep the parser strict (typeof guards) per the existing pattern.
- **`components/map/pixi/pixi-map-canvas.tsx`** — Instantiate `TradeFlowLayer`, add to world container in the correct z-position, call `.sync(flowEdges)` in the per-frame update. Layer's `visible` flag is driven by the overlay toggle (cheap early-out when off).
- **`components/map/pixi/lod.ts`** (or wherever LOD bands live) — Add `showTradeFlow` / `tradeFlowAlpha` to `LODState`. Visible from zoom ≥ 0.4 (matches systems); fully opaque by 0.6. Below 0.4 the universe view shows territory + fleet dots; flow overlay would be noise. **Note**: LOD only governs zoom-based fade; final visibility is `LOD.showTradeFlow && overlays.tradeFlow`.
- **`components/map/pixi/theme.ts`** — Particle base size, max-on-screen cap, direction-arrow style if any. Trade-route colors live in `good-colors.ts` and import here.

### Reused pieces

- Tick-scoped data pattern: `useDynamicData` is the exact precedent — fetch once per tick, no viewport in the key, invalidate via `useTickInvalidation`.
- Particle precedent: `components/map/pixi/layers/effect-layer.ts` already runs flowing route particles for navigation preview — copy its frame-loop structure.
- Frustum culling: `components/map/pixi/frustum.ts` + the per-edge culling pattern in `ConnectionLayer.sync()`.
- Theme tokens: `app/globals.css` `@theme inline { --color-status-* }`.

### Decisions resolved here

- **Aggregate per request, not per tick**: the API computes edge aggregates on demand from `TradeFlow` (PR 1 keeps the raw events). Indexes on `(tick, fromSystemId)` make this cheap; one query per dashboard refresh, not per write.
- **Particle density caps**: hard limit on total active particles (e.g. 2000) regardless of edges. At galactic zoom this prevents framerate cliff if many edges are simultaneously hot.
- **Overlay toggle, not always-on**: trade flows are visually busy and the map is gaining more overlay candidates (danger, faction control, scan ranges). Establishing the overlay-toggle pattern in PR 2 — even with just one toggle — costs little now and avoids retrofitting later. Default off so first-time users see the clean map.
- **Visibility gating at the API boundary**: per the visibility design doc, dynamic data is gated by the player's visibility set. An edge appears if **at least one endpoint** is in the visibility set — strict "both endpoints" hides too much (a trader at a system you can see should be visible even if the partner is dark), and unfiltered would leak galaxy-wide commerce intel. Filtering server-side keeps payloads small and prevents the "I can see hidden flow data in devtools" leak.
- **Toggle disables the query, not just the layer**: when the overlay is off, `useTradeFlow` is gated (`enabled: false`). We don't pay the request, the DB groupBy, or the visibility filter for off-by-default overlays. This matters at 10K scale.
- **Visual treatment is owned by the Pixi layer alone, not the data pipeline.** The API/hook/`MapData` shape carries only volume + dominant good + per-good breakdown — no rendering concepts (particle count, dash length, glow radius, etc.). If the dots-along-edges treatment doesn't read well, the swap is confined to `trade-flow-layer.ts` and `trade-flow-edge.ts`; nothing upstream changes. Alternatives explicitly kept open: animated dashed lines, glowing intensity lines, recoloring the existing `ConnectionLayer`, midpoint arrows. **Do not bake particle assumptions into the API response or the `FlowEdge` type.**

### Carried over from PR 1 review

PR 1's code review (PR #62) deferred a few items here because PR 2's surface area is the right place to address them. Don't ship PR 2 without folding these in:

- **Lift `getEdgesForRegion` onto the adjacency cache.** `lib/tick/adapters/prisma/trade-flow.ts` currently calls `tx.systemConnection.findMany` every active tick. PR 2's aggregate API needs the full graph anyway for path inference — same patch can wire `lib/services/adjacency.ts:getAdjacencyList()` into the PR 1 adapter and avoid the per-tick scan. Filter to intra-region edges in JS via a `systemId → regionId` map.
- **Calibrate `PROCESS_EVERY_N_TICKS` and `FLOW_BUDGET` against `economy-tuning.md` bands before the overlay ships.** The integration test forces `processEveryNTicks: 1`, so the production defaults (`4` / `8`) haven't been validated end-to-end. Run the sim sweep from PR 1's verification section (`experiments/trade-flow-sweep.yaml`) and pick values that keep equilibrium prices inside the bands. Players will see the overlay before they tune the constants, so wrong defaults read as "trade is broken."
- **Defensive `isFinite()` guard at the gradient site.** `lib/tick/processors/trade-flow.ts` computes `gradient = (priceB - priceA) / mA.basePrice`. Clamps prevent `Infinity` today, but a `if (!isFinite(gradient)) continue;` at the gradient comparison future-proofs against schema/clamp tweaks. Cheap to add when the file is already open for PR 2.
- **Gate `[tradeFlow]` console logs behind a debug flag.** At 10K scale + every-N-tick cadence the per-region log is noise. Drop to one summary per full region cycle, or gate behind `DEBUG_TRADE_FLOW=1`. Same treatment for the per-region `[economy]` log if it's noisy in production logs.

### Verification

- `npm run dev`, open the galaxy map at default seed. Confirm overlay toggle is off by default and `/api/game/systems/trade-flow` does NOT fire on load.
- Toggle Trade Flows on, manually verify edges show particles after ~50 ticks of sim.
- Move ships to extend visibility, toggle off+on, confirm new edges appear that match the player's expanded visibility set. Edges where neither endpoint is visible must not appear in the network payload.
- Refresh the page with the toggle on, confirm state is restored from session storage.
- Pan/zoom check: particles cull off-screen, don't reappear at lower zoom (LOD), don't flicker on viewport change (tick-scoped query keys per memory's flicker gotcha).
- Open browser devtools, watch network — `/api/game/systems/trade-flow` fires once per tick when on, not per pan, and zero requests when off.
- Pixi performance: zoom out to galactic with overlay on, confirm 60fps with full overlay; if not, lower the particle cap.

---

## PR 3 — System Detail Panel Surfaces

Player-facing route information at the per-system level. Builds on PR 2's API by adding a system-scoped endpoint.

### New files

- **`app/api/game/systems/[systemId]/trade-flow/route.ts`** — `GET /api/game/systems/[systemId]/trade-flow`. Returns: `{ topImports: GoodFlow[], topExports: GoodFlow[], inboundEdges: EdgeSummary[], outboundEdges: EdgeSummary[], volumeHistory: Array<{ tick, importVolume, exportVolume }> }`. `volumeHistory` is bucketed (e.g. 10-tick buckets over `FLOW_HISTORY_TICKS`) so the sparkline is bounded.
- **`lib/hooks/use-system-trade-flow.ts`** — `useSystemTradeFlow(systemId)` hook. Tick-scoped invalidation.
- **`components/system/trade-activity-panel.tsx`** — Section component for the detail panel. Three sub-sections:
  - Top imports list (good + volume + source systems, top 5) — `<dl>` semantic markup with `Badge` for goods, `font-mono` for numbers.
  - Top exports list (mirror) — destination systems linked into the detail panel for traversal.
  - Volume sparkline — Recharts `LineChart` modeled on `components/trade/price-chart.tsx`. Two lines (imports / exports) over the rolling window. Uses `CHART_THEME` from `lib/constants/ui.ts`.

### Modified files

- **`app/(game)/@panel/system/[systemId]/page.tsx`** — Insert `<TradeActivityPanel systemId={systemId} />` after the existing market snapshot section, wrapped in `QueryBoundary` like the other data sections.
- **`lib/query/keys.ts`** — Add `systemTradeFlow: (id: string) => ['system-trade-flow', id] as const`.
- **`lib/hooks/use-tick-invalidation.ts`** — Invalidate `systemTradeFlow(currentSystemId)` on relevant ship-arrival events.

### Reused pieces

- Chart pattern: `components/trade/price-chart.tsx` is the Recharts/Foundry template.
- Detail panel composition: existing `app/(game)/@panel/system/[systemId]/page.tsx` already chains `QueryBoundary`-wrapped sections.
- UI primitives: `StatList`, `Badge`, `StatDisplay`, `EmptyState` — all per `components/ui/`.

### Decisions resolved here

- **Visibility tiering deferred**: design's "Trade-Skill Tiered Visibility" is gated on the unbuilt player-progression system. PR 3 ships at the equivalent of the "Local" tier (system-level data on the panel for the currently focused system). Galactic chains / predictive shifts wait for a later PR alongside the skill system.
- **No route browser screen in PR 3**: deferred. The map overlay (PR 2) + per-system surfaces (PR 3) already deliver "view trade routes." A dedicated browser is value-add for a later iteration once we see how players use the map overlay.

### Verification

- `npm run dev`, click a producing system after sim warmup, confirm top exports list populates and sparkline renders.
- Click a consuming system, confirm imports populate symmetrically.
- Click a stagnant system early in the sim, confirm `<EmptyState>` shows ("No recent trade activity") rather than empty list.
- Inspect a system, navigate to a linked destination system, confirm panel data refreshes (no stale state).

---

## Cross-PR Notes

- **Branch / commit cadence**: per workflow preferences, one feature branch with worktrees per phase, cherry-pick into the feature branch, code-review each phase before next. Branch name: `feat/trade-flow`.
- **Schema migration**: `npx prisma db push` after PR 1's schema change; no destructive migration needed (additive).
- **Memory updates after each PR**: append "Last Session" line to `MEMORY.md` reflecting state — e.g. after PR 1: "Trade flow processor merged; map overlay next."
- **Theme compliance** (`docs/design/active/theme.md`): no rounded corners on flow surfaces; copper accent on detail panel sub-section; `font-mono` for all volume numbers; `font-display` (Chakra Petch) for section headings.

## Out of Scope (Explicit)

- Player progression / trade skill tiers — depends on unbuilt system.
- Mission generation hooks (smuggler interception, escort, market manipulation) — Layer 2/3 mission system territory.
- Named convoy entity layer on top of flow — wait until gameplay demand surfaces.
- Per-system aggregate columns on `Market` — defer until profiling shows the on-demand query is hot.
