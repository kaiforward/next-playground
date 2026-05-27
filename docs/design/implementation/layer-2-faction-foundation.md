# Layer 2, Sub-Project 1 — Faction Foundation Implementation Plan

## Context

Sub-Project 1 of [Layer 2](./layer-2.md). The structural backbone of the political layer: replaces region-owned government with faction-owned government on a per-system basis, expands governments from 4 → 8, seeds 8 majors + 12–18 minors with archetype-respecting placement, ships inter-faction relations + alliance mechanics, adds per-player faction reputation, fires border-conflict events from the relations processor, and exposes a faction overview UI.

Every later Layer 2 sub-project (Facilities, Contraband, War) depends on this one. Foundation also carries the largest single delta in the roadmap — the regions → factions ownership migration — and a full reseed.

Layer 0 (system traits), Layer 1 (ship roster, upgrades, convoys, damage pipeline), and Layer 1.5 (mission architecture + combat engine) are all complete and stable.

---

## Source Design Docs

- [faction-system.md](../planned/faction-system.md) — all sections except §4 (war summary). Authoritative for faction model, doctrines, relations, alliances, reputation, roster, minor archetypes.
- [navigation-changes.md](../planned/navigation-changes.md) §6 — border-system tier-0 danger only (war-zone danger lands with War).
- [MIGRATION-NOTES §1](../MIGRATION-NOTES.md) — government ownership migration, region `dominantEconomy` re-derivation.

---

## Resolved Design Questions

The 5 open questions in [layer-2.md §3](./layer-2.md) are resolved as follows.

| # | Question | Resolution |
|---|---|---|
| 1 | Player spawn faction | **No primary faction.** Players are not faction-aligned at creation. No `primaryFactionId` field on `Player`. Reputation accumulates per-faction through player actions (trade, missions, future war contributions). Spawn continues to use `GameWorld.startingSystemId` (existing logic, pointing at a core-economy system near map center); the system happens to be faction-owned but the player starts with all-zero reputation. |
| 2 | Alliance formation | **Event-gated with telegraph + hook stub.** When relations cross +75, the relations processor spawns a `pact_under_negotiation` event with a 5–10 tick negotiation window. If relations hold above +60 through the window, the `AlliancePact` is created. Dissolution similarly telegraphed when relations drop below +50. The processor exposes a `pendingAllianceInfluence` hook (no-op stub in Foundation; populated by War's diplomatic-mission contributions). |
| 3 | Reputation multipliers | **Moderate symmetric, simulator-tunable.** Champion (+75 to +100) 0.92x buy / 1.08x sell. Trusted (+25 to +74) 0.96x / 1.04x. Neutral (-24 to +24) 1.0x / 1.0x. Distrusted (-74 to -25) 1.08x / 0.92x. Hostile (-100 to -75) trade denied. Values live in a single `REPUTATION_TIERS` constant; trade service reads them. |
| 4 | 8-government modifiers | **Flat per-government, extensible shape.** Match the existing `GovernmentDefinition` interface for all 8 entries — no per-good-tier matrices in Foundation. But the type allows an optional `goodCategoryModifiers?` field for a future per-category nuance pass without restructuring. Starting values for the 4 new governments in §3.1 below. |
| 5 | Minor faction count | **Tied to `UNIVERSE_SCALE`.** `default` (600 systems, 24 regions) → 12 minors. `10k` (10K systems, 60 regions) → 18 minors. New `MINOR_FACTION_COUNT` field added to `UNIVERSE_GEN`. Archetype counts scale proportionally. |

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Government ownership | Per-`StarSystem` via `factionId` FK; `Region.governmentType` dropped entirely | Border regions can contain systems owned by multiple factions ([faction-system.md §7](../planned/faction-system.md)). One-government-per-region is incompatible with the cross-border archetype. |
| Economy processor batching | Keep round-robin by region; resolve `governmentType` per-market inside the adapter | The processor body iterates markets within a region already. Adding `governmentType` to `MarketView` (joined from `system → faction`) lets the body apply the modifier per-market with a one-line change. No restructure of the round-robin loop. |
| `RegionView.governmentType` | Remove from the world interface | After government moves per-system, the type field on `RegionView` is dead. Drop it cleanly rather than letting it linger. |
| Region homogeneity | Not enforced | World-gen will tend to produce mostly-single-faction regions (factions seed around contiguous system clusters), but border regions are explicitly heterogeneous by design. No constraint. |
| `dominantEconomy` re-derivation | Hook function defined in Foundation, called only by world-gen; conquest hook stubbed | Region `dominantEconomy` is currently computed at seed time (per Layer 0). Conquest can change it (per MIGRATION-NOTES §1). The pure derivation function lands in Foundation; the conquest call site lands in War. |
| `Region.governmentType` migration | Hard cut, drop column | A full reseed is already planned. No data migration needed — schema diff plus reseed. |
| Dead `war` eventWeights | Delete from `GOVERNMENT_TYPES` | The "war" event referenced in `corporate`/`authoritarian`/`frontier` `eventWeights` was never defined in `lib/constants/events.ts`. Dead config; cleanup with zero risk. Replaced semantically by border-conflict events. |
| Faction relations storage | One row per unordered pair, convention `factionAId < factionBId` | Avoids duplicate (A,B)/(B,A) rows. Adapter resolves canonical ordering on every read/write. |
| Alliance representation | Separate `AlliancePact` table, not a column on `FactionRelation` | Alliances have their own lifecycle (formation tick, mutual defense state, future war contributions). Keeps relation score and alliance status decoupled. |
| Per-player reputation table | New `PlayerFactionReputation` with `(playerId, factionId)` unique | First per-player per-faction record in the codebase. Wire `TradeMission.factionId` stub column to a real FK in the same migration. |
| Faction-exclusive ship/module gating | Stub hook in Foundation, no variants yet | Roadmap commits to wiring the hook now. The accessor `getFactionShipAccess(playerId, factionId, shipTypeId): boolean` ships with a permissive default; faction-variant ships populate progressively in later layers. |
| Faction overview UI | New `/politics` route group | Existing sidebar has `FLEET_NAV` and `ACTIVITY_NAV`; add `POLITICS_NAV` for "Politics" (faction list) and reachable detail pages. The political map view is a new Pixi layer in the existing map. |

---

## Phase Plan

Five PRs in order. Each is independently mergeable; each leaves the game in a runnable state.

### Phase 1 — Data Model Groundwork (Pure Additions)

Pure-additive types, constants, and schema changes. No removals or behaviour cutover. Phase 1 alone leaves the live game running unchanged — the new tables exist but are empty; the new government literals exist but no faction uses them.

**New/modified files:**
- `lib/types/game.ts` — `GovernmentType` union expanded to 8 string literals: `federation | corporate | authoritarian | frontier | cooperative | technocratic | militarist | theocratic`. New `Doctrine` union: `expansionist | protectionist | mercantile | hegemonic | opportunistic`. New `FactionStatus` derived type: `dominant | major | regional | minor`. New `ReputationStanding` union for the 5 tiers.
- `lib/types/guards.ts` — `GOVERNMENT_TYPES` `ReadonlySet` and `ALL_GOVERNMENT_TYPES` array expanded to 8. New `DOCTRINES` set and `toDoctrine()` guard. New `toFactionStatus()` derivation helper (status from territory size with hysteresis thresholds from faction-system.md §1).
- `lib/constants/government.ts` — 4 new entries (`cooperative`, `technocratic`, `militarist`, `theocratic`) added to `GOVERNMENT_TYPES` matching the existing `GovernmentDefinition` shape (concrete starting values in §3.1 below). Dead `war: N` entries removed from `corporate`/`authoritarian`/`frontier` `eventWeights`. (Safe: the `war` event type was never defined, so no code path uses these.)
- `lib/constants/doctrines.ts` (new) — `DoctrineDefinition` interface (name, description, declarationModifier, exhaustionMultiplier, etc., per faction-system.md §1) and `DOCTRINES` record. Foundation only reads `declarationModifier` for the alliance negotiation threshold; the war-related fields are reserved for the War sub-project.
- `lib/constants/factions.ts` (new) — `FACTION_ROSTER` constant: 8 majors from faction-system.md §6 with name, description, governmentType, doctrine, color. Minor faction generation is procedural; this file holds only the major roster + the archetype distribution config (consumed in Phase 2).
- `lib/constants/reputation.ts` (new) — `REPUTATION_TIERS` constant: tier bounds, buy/sell multipliers, tier name. Helper `getReputationTier(score: number): ReputationStanding` and `getReputationMultipliers(standing): { buy: number; sell: number }`.
- `lib/constants/universe-gen.ts` — `UniverseGenConfig` gains `MINOR_FACTION_COUNT` field. `default` preset → 12, `10k` preset → 18.
- `prisma/schema.prisma`:
  - New `Faction` model: `id`, `name` (unique), `description`, `governmentType String`, `doctrine String`, `homeworldId String` (FK to `StarSystem`), `color String`, `createdAtTick Int`.
  - New `FactionRelation` model: `factionAId`, `factionBId` (with adapter-enforced ordering: `factionAId < factionBId`), `score Float @default(0)`, `historyJson String @default("[]")` (short ring buffer of recent drift drivers — debugging + UI surface), `updatedAtTick Int`. `@@unique([factionAId, factionBId])`.
  - New `AlliancePact` model: `factionAId`, `factionBId`, `formedAtTick Int`, `pendingDissolutionAtTick Int?`. `@@unique([factionAId, factionBId])` (only one pact between a given pair at any time).
  - New `PlayerFactionReputation` model: `playerId`, `factionId`, `score Float @default(0)`, `updatedAtTick Int`. `@@unique([playerId, factionId])`.
  - `StarSystem` gains `factionId String?` FK to `Faction` (nullable in schema; world-gen guarantees non-null after Phase 2 reseed).
  - `TradeMission.factionId` upgraded from stub `String?` to real FK on `Faction`.
  - `Region.governmentType` **stays** in this phase — column dropped in Phase 2.
- `prisma db push` to apply schema; no seed change yet.

**Testable after:** `prisma db push` succeeds. Type-check passes. The live game runs unchanged. Unit tests added for `toFactionStatus()` (hysteresis), `getReputationTier()` boundary values, `getReputationMultipliers()` lookup, and shape parity of the 4 new `GOVERNMENT_TYPES` entries with the existing 4.

---

### Phase 2 — World-Gen Rewrite + Government Cutover + Full Reseed

The cutover phase. Adds faction generation to world-gen, switches every consumer of government from `region.governmentType` to `system.faction.governmentType`, drops the column, reseeds. Pre-cutover and post-cutover both run; the cutover happens in a single PR so the game never holds a half-migrated state.

**World-gen — modified files:**
- `lib/engine/universe-gen.ts`:
  - `generateRegions()` — remove government assignment and the `ALL_GOVERNMENT_TYPES` coverage loop. Regions now carry name + position + `dominantEconomy` derivation only.
  - New `generateFactions(regions, systems, config, rng): GeneratedFaction[]`. Seeds 8 majors (one per government, per `FACTION_ROSTER`) with homeworld selection: highest-prosperity-traits system in each major's assigned cluster. Then seeds `MINOR_FACTION_COUNT` minors with archetype-respecting placement per faction-system.md §7.1:
    - Buffer: between 2 majors (count = ceil(0.33 × N))
    - Frontier: at map edges (count = ceil(0.33 × N))
    - Enclave: inside/adjacent to a single major (count = ceil(0.2 × N))
    - Cluster: shared region with another cluster minor (remaining count)
    - Constraints from faction-system.md §7.1 enforced: no minor borders more than 2 majors; every minor has at least one non-border system; frontier minors have unclaimed space on at least one side.
  - New `assignSystemFactions(systems, factions): Map<systemId, factionId>` — flood-fills system ownership from each faction's homeworld using jump-lane distance. Resolves contested systems via doctrine + distance tiebreak.
  - `selectStartingSystem()` — unchanged interface, but filters for systems in a Federation-government major's territory before the existing core-economy + map-center selection.
  - New pure helper `deriveDominantEconomy(systems): EconomyType` extracted from existing seed logic; used in world-gen and reserved for the future conquest hook.

**Cutover — modified files:**
- `lib/tick/world/economy-world.ts`:
  - `RegionView.governmentType` **removed**.
  - `MarketView` gains `governmentType: GovernmentType` (resolved at adapter from system's owning faction).
- `lib/tick/adapters/prisma/economy.ts` — `getMarketsForRegion` joins `system.faction.governmentType` and includes it on each `MarketView` row.
- `lib/tick/processors/economy.ts` — one-line change: read `government` from `market.governmentType` instead of `targetRegion.governmentType` for each market in the batch. The round-robin region selection is untouched.
- `lib/tick/adapters/prisma/ship-arrivals.ts` — `destination.region.governmentType` join replaced by `destination.faction.governmentType`. The `ShipArrivalView` type in the world interface updates accordingly.
- `lib/tick/adapters/prisma/op-missions.ts` and `lib/services/missions-v2.ts` — same join change.
- `lib/engine/simulator/types.ts` — `SimRegion.governmentType` removed; `SimSystem.governmentType` (or equivalent) added. `SimRunContext.systemToGov` already maps `systemId → string`; this is the per-system source post-cutover.
- `lib/engine/simulator/world.ts` — builds the per-system government map from faction ownership.
- `lib/tick/adapters/memory/economy.ts` — adapter reads `SimSystem.governmentType` per market.
- `lib/services/atlas.ts` and `lib/types/game.ts` (`RegionInfo`) — `governmentType` field on `RegionInfo` replaced with `dominantFactionId: string | null` and `dominantGovernmentType: GovernmentType`. Atlas service derives both from the modal owning faction within the region. (Border regions get the more common faction; ties broken alphabetically.)
- `app/(game)/@panel/system/[systemId]/page.tsx` — danger and Government stat rows read the system's `faction.governmentType` instead of `regionInfo.governmentType`. Faction name + color rendered alongside.
- `lib/map/mock-data.ts` and `lib/test-utils/fixtures.ts` — fixtures updated; new `createTestFaction()` helper added.

**Schema cutover:**
- `prisma/schema.prisma`:
  - `Region.governmentType` column **dropped**.
- `prisma db push` applies the drop.

**Seed cutover (`prisma/seed.ts`):**
- Drop `governmentType: region.governmentType` from `Region` writes.
- Insert `Faction` rows after regions, before systems.
- Set `StarSystem.factionId` per `assignSystemFactions()` output (non-null on every system).
- Insert `FactionRelation` rows: one per unordered major pair (28 pairs for 8 majors) + every minor↔major and minor↔minor pair within a proximity threshold. Initial scores seeded from doctrine compatibility + government opposition matrix (small +/- nudges per faction-system.md §6 "Emergent Rivalries").
- Set `GameWorld.startingSystemId` to a Federation-government major's homeworld.

**Testable after:**
- `npm run simulate` runs cleanly on the new universe.
- `prisma db push` + reseed produces 8 majors + 12 (or 18) minors with archetype-respecting placement.
- Every system has a non-null `factionId`; every major has exactly one homeworld system.
- Existing economy + ship-arrivals + missions tests pass against the new adapter shape.
- Generation tests: 100 seeds × archetype counts, no-minor-borders-3-majors, every-frontier-minor-has-edge constraints.

---

### Phase 3 — Relations Processor + Alliance Events

The processor that drives the political simulation. Spawns border-conflict events. Stages alliance formation/dissolution as events.

**New files** (following the processor-architecture pattern from `docs/design/active/processor-architecture.md`):
- `lib/tick/world/relations-world.ts` — `RelationsWorld` interface:
  - `getFactions(): Promise<FactionView[]>` — `{ id, governmentType, doctrine, territorySize, status }`.
  - `getFactionRelations(): Promise<FactionPairView[]>` — `{ factionAId, factionBId, score, lastUpdatedTick }`.
  - `getBorderLengthsBetween(): Promise<Map<pairKey, number>>` — shared jump-lane count per pair, derived from adjacent system ownership.
  - `getTradeVolumeBetween(sinceTick): Promise<Map<pairKey, number>>` — sums recent `TradeFlow` rows by faction-of-system on each end.
  - `applyRelationUpdates(updates: RelationUpdate[]): Promise<void>` — bulk score writes.
  - `getPendingAlliances(): Promise<PendingAllianceView[]>` — active `pact_under_negotiation` events.
  - `formAlliance(factionAId, factionBId, tick): Promise<void>` and `dissolveAlliance(...)`.
  - `createBorderConflictEvents(creates: EventCreate[]): Promise<void>` — delegates to the existing event-write path used by the events processor.
- `lib/tick/adapters/prisma/relations.ts` — implements against `Faction`, `FactionRelation`, `AlliancePact`, `StarSystem`, `SystemConnection`, `TradeFlow`.
- `lib/tick/adapters/memory/relations.ts` — in-memory implementation for the simulator. Borders and trade volume read from sim state.
- `lib/tick/processors/relations.ts` — `runRelationsProcessor(world, ctx, params): Promise<TickProcessorResult>`:
  1. Fetch all pairs.
  2. For each pair: compute drift from drivers in faction-system.md §2 (border friction, doctrine compatibility, government opposition, historical grievance decay, trade volume, alliance maintenance, common enemy). Sum to a delta; clamp resulting score to `[-100, +100]`.
  3. Bulk write updates via `applyRelationUpdates`.
  4. Detect threshold crossings:
     - Pair entering the unfriendly band (-74 to -25) without an active `border_conflict` for that pair → spawn **one** `border_conflict` event per faction-pair, targeting a representative shared-border system (the system on the lower-score faction's side of the densest border segment between the two). Subsequent skirmish phases never duplicate; a new event spawns only after the previous one resolves *and* the pair re-enters the unfriendly band.
     - Pair crossing +75 without an active `pact_under_negotiation` event → spawn one for that pair (single event, no system target — the event is region-scoped, system-agnostic, displayed on the political map only).
     - Pair dropping below +50 with an active `AlliancePact` → spawn one dissolution event for that pair.
  5. Resolve negotiation windows: alliance events whose `negotiationEndTick` ≤ current tick and whose pair score is still ≥ +60 → call `formAlliance`. Dissolution events past their window → `dissolveAlliance`.
  6. Allow `pendingAllianceInfluence` hook to mutate negotiation outcomes (no-op in Foundation; signature reserved for War).
- `lib/engine/relations.ts` — pure functions: `computeRelationDrift`, `derivePendingAllianceOutcome`, `borderConflictEventTemplate`, `allianceEventTemplate`. Fully unit-testable.

**Event catalog additions** (`lib/constants/events.ts`):
- `border_conflict` event type: 3 phases (`tension` ~20 ticks → `skirmish` ~30 ticks → `de_escalation` ~15 ticks). Modifiers: danger +0.05 in tension, +0.10 in skirmish, +0.02 in de-escalation, all on the participating systems (border systems between the two factions). Economy modifier: -10% production rate on participating systems during skirmish. Spawned only by relations processor — `weight: 0` so `selectEventsToSpawn` ignores it.
- `pact_under_negotiation` event type: single phase, duration = negotiation window. No danger/economy modifiers — purely informational. Renders on the political map.
- `alliance_dissolved` event type: single phase, brief duration. No modifiers.

**Modified files:**
- `lib/constants/government.ts` — delete the dead `war: N` entries from `corporate`/`authoritarian`/`frontier` `eventWeights`.
- `lib/tick/registry.ts` — register `relationsProcessor` with `dependsOn: ["events"]` and a slower cadence (e.g. `frequency: 3` — runs every 3 ticks). Order it after `events` so newly-created border-conflict events are picked up next tick.

**Testable after:**
- Unit tests for `computeRelationDrift` covering each driver in isolation and combined.
- Integration test: 1000-tick simulation produces border-conflict events on hostile pairs and alliance pacts on friendly pairs. No alliance forms instantly (negotiation window honored).
- The 4-tier relations status thresholds from faction-system.md §2 produce visible transitions in the sim log.

---

### Phase 4 — Player-Faction Reputation + Trade Integration

Hooks reputation into the buy/sell transaction. Adds reputation panel UI. Bootstraps player-faction rep rows.

**Modified files:**
- `lib/services/trade.ts`:
  - Query expands to include `station.system.factionId`.
  - After `calculatePrice()` returns `unitPrice`: look up the player's `PlayerFactionReputation` row for the system's faction. Derive `standing` from score via `getReputationTier`. Reject the trade if `standing === "hostile"`.
  - Compute `adjustedUnitPrice = unitPrice * getReputationMultipliers(standing).buy` (for buys) or `.sell` (for sells).
  - Pass `adjustedUnitPrice` through `validateFleetTrade` and the credit transfer.
  - Inside the `prisma.$transaction`: `upsert` the reputation row with a small delta (e.g. +0.5 per successful trade, capped per-tick per faction to prevent grind-spam).
- `lib/services/convoy-trade.ts` — identical changes (mirror of single-ship `trade.ts`).
- `lib/services/players.ts` (or `app/api/register/route.ts` — whichever owns spawn): on player creation, insert a `PlayerFactionReputation` row for every faction with `score: 0`. No starting nudge; players are pure neutral.
- `lib/types/api.ts` / `lib/auth/serialize.ts`: `serializePlayer` includes per-faction reputation rows.

**New files:**
- `lib/services/reputation.ts` — read service: `getPlayerReputation(playerId)`, `getStandingAt(playerId, factionId)`. No write path beyond what trade does (faction missions write their own rep deltas later; combat will too).
- `lib/hooks/use-faction-reputation.ts` — TanStack Query hook for the reputation panel.
- `app/api/game/reputation/route.ts` — GET endpoint for the current player's faction reputations.
- `components/factions/reputation-panel.tsx` — sortable list: faction name, score, tier badge, buy/sell modifiers. Reusable on player profile + faction detail page.
- `components/factions/standing-badge.tsx` — color-coded chip per `ReputationStanding`.

**Testable after:**
- Unit tests: `getReputationTier` boundaries, `getReputationMultipliers` lookup.
- Integration tests for trade: champion-tier player gets the discounted buy price; hostile player is denied; rep increments on successful trade.
- Reputation panel renders for an existing player and reflects 0s across all factions.

---

### Phase 5 — Faction Overview UI

The galaxy-political-map view, faction list, and faction detail page.

**New routes:**
- `app/(game)/politics/page.tsx` — Faction list: table of 8 majors + N minors with name, government badge, doctrine badge, territory size, status, color swatch. Filter and sort. Click → detail.
- `app/(game)/politics/[factionId]/page.tsx` — Faction detail: lore description, homeworld, doctrine, government, territory list (system count + sample systems), relations matrix row for this faction (other factions sorted by score with tier badges), recent border conflicts + active alliances from the event log, player's own reputation with this faction.
- `app/(game)/politics/relations/page.tsx` — Full N×N relations matrix view (8 majors × 8 majors initially; minors expandable). Color-coded by tier.

**New components:**
- `components/factions/faction-card.tsx` — small/medium/large variants, used in the list and on the detail page.
- `components/factions/relations-matrix.tsx` — square grid of pair scores, hover for full pair detail.
- `components/map/pixi/layers/political-territory-layer.ts` — new Pixi layer keyed by `factionId`. Reads `Faction.color`. Replaces the existing economy-colored territory layer when the political-map toggle is on. The existing economy layer stays — the user toggles between them via a map-overlay control.
- `components/map/political-overlay-toggle.tsx` — small overlay button in the map UI.

**New hooks:**
- `lib/hooks/use-factions.ts` — list query.
- `lib/hooks/use-faction.ts` — detail query for a single faction.
- `lib/hooks/use-relations.ts` — pairs query for the matrix view.
- `lib/hooks/use-political-overlay.ts` — client state for the map toggle.

**New API routes (thin wrappers):**
- `app/api/game/factions/route.ts` — GET list.
- `app/api/game/factions/[factionId]/route.ts` — GET detail.
- `app/api/game/factions/relations/route.ts` — GET full relations matrix.

**Modified files:**
- `components/game-sidebar.tsx` — new `POLITICS_NAV` array with Politics, Factions, Relations entries.
- `app/(game)/@panel/system/[systemId]/page.tsx` — government type now resolves via the system's owning faction; faction name + color shown alongside government. Existing `regionInfo?.governmentType` line replaced by `system.faction.governmentType` reads.

**Testable after:**
- Browser walkthrough: faction list loads, click into a major faction → detail page shows territory and relations. Political map overlay toggles cleanly. System detail page shows correct faction + government.
- Visual verification of color contrast for faction palette (8 majors + 12–18 minors = up to 26 colors; faction roster file specifies the major palette, minor palette is procedurally derived with sufficient luminance separation).

---

### Phase 6 — Map Mode/Overlay Split + LOD Polish

Follow-up polish added after Phase 5 review surfaced two issues with the political-overlay UX. Self-contained, doesn't touch faction data or services — lives entirely in the map layer.

**Problem 1 — modes vs overlays conflated.** Phase 5 wired `politicalTerritory` into `useMapOverlays` alongside `tradeFlow`, but they're conceptually different: region tinting and political tinting are *mutually exclusive views of the same territory layer* (a "map mode"), while trade flow is an *additive overlay* that works in either mode. The current single-flat-overlay-list invites the user to toggle both political and tradeFlow off and end up with no territory tint at all.

**Problem 2 — territory layer fades out at close zoom.** LOD curves currently dim `territoryAlpha` as zoom increases so individual systems are more prominent. With a political mode this is backwards — faction colours stay useful (and arguably more useful) when zoomed in to inspect specific systems, and territory polygons are cheap to render. Systems are the thing that needs LOD culling, not territories.

**Modified files:**
- `lib/hooks/use-map-mode.ts` (new) — `mode: "regions" | "political"`, session-persisted via `map-session.ts`. Default `"regions"` to preserve existing behaviour.
- `lib/hooks/use-map-overlays.ts` — drop `politicalTerritory` from the overlay set. Only additive overlays remain (`tradeFlow` today; future heatmaps, scan ranges, etc.).
- `components/map/map-session.ts` — `MapSessionState` gains `mode?: "regions" | "political"`; drop `politicalTerritory` from `MapOverlaysState`.
- `components/map/map-overlay-controls.tsx` — new "Map Mode" toggle group above the overlay list, single-select between Regions and Political. The overlay list shrinks to just the additive set.
- `components/map/star-map.tsx` — read `useMapMode`, pass `mapMode` prop to `PixiMapCanvas` instead of `politicalOverlay`.
- `components/map/pixi/pixi-map-canvas.tsx` — `politicalOverlay` prop renamed to `mapMode`. The visibility-toggle effect picks which layer is active based on the mode.
- `components/map/pixi/lod.ts` — adjust `territoryAlpha` / `showTerritories` curves so territories stay visible at close zoom. Bias the curve toward "always show territories; only fade when truly at universe zoom and the point cloud takes over." Region labels follow the same treatment.

**Testable after:**
- Mode toggle flips between region and political fills without affecting trade-flow overlay state.
- Trade-flow particles render correctly in both modes.
- Zooming from universe → close, territories remain visible throughout; system clutter still respects existing LOD culling.
- Session restore preserves both `mode` and `overlays.tradeFlow` independently.

---

## 3.1 Government Modifier Starting Values (4 New Governments)

Per faction-system.md §1 sketches, refined into concrete values matching the existing `GovernmentDefinition` shape. These are starting values for the plan — simulator tunes from here.

```ts
cooperative: {
  taxed: [],
  contraband: ["luxuries"],
  taxRate: 0.10,
  inspectionModifier: 1.0,
  volatilityModifier: 0.7,
  dangerBaseline: 0.0,
  equilibriumSpreadPct: -10,
  eventWeights: { trade_festival: 3 },
  consumptionBoosts: { food: 1, medicine: 1 },
},
technocratic: {
  taxed: ["water", "food"],
  contraband: [],
  taxRate: 0.08,
  inspectionModifier: 0.6,
  volatilityModifier: 1.0,
  dangerBaseline: 0.01,
  equilibriumSpreadPct: 5,
  eventWeights: { tech_breakthrough: 5 },
  consumptionBoosts: { electronics: 1 },
},
militarist: {
  taxed: ["electronics", "machinery"],
  contraband: [],
  taxRate: 0.10,
  inspectionModifier: 1.3,
  volatilityModifier: 1.3,
  dangerBaseline: 0.05,
  equilibriumSpreadPct: 10,
  eventWeights: { trade_festival: -3 },
  consumptionBoosts: { weapons: 1, fuel: 1, machinery: 1 },
},
theocratic: {
  taxed: [],
  contraband: ["weapons", "chemicals", "luxuries"],
  taxRate: 0.10,
  inspectionModifier: 1.4,
  volatilityModifier: 0.8,
  dangerBaseline: 0.03,
  equilibriumSpreadPct: -5,
  eventWeights: { plague: -3 },
  consumptionBoosts: { food: 1, medicine: 1, textiles: 1 },
},
```

The optional `goodCategoryModifiers?: Record<GoodCategory, { volatility?: number; eqSpread?: number }>` field on `GovernmentDefinition` is **declared but unused in Foundation** — it exists so a follow-up tuning pass can express the "wide for tier 2, narrow for tier 0" nuance from the design doc without restructuring.

---

## Branch Strategy

Foundation ships as **5 PRs** through the shared `feat/layer-2-foundation` branch (one final merge to `main` at the end), grouped by natural seam (bisectability + revert-safety, not review capacity). Each PR is independently mergeable and leaves the game in a runnable state.

| PR | Phases | Scope | Risk profile |
|---|---|---|---|
| **PR 1** | Phase 1 | Data model groundwork: schema additions, new constants, new types/guards. No behaviour change. | Low — pure additions, live game runs unchanged |
| **PR 2** | Phase 2 | World-gen rewrite + government cutover + full reseed. Adapters switch to `system.faction.governmentType`. `Region.governmentType` column dropped. | High — biggest single migration in the roadmap. Must stand alone for revert/bisect |
| **PR 3** | Phases 3 + 4 | Relations processor + alliance events + border-conflict events; player reputation + trade multiplier integration + reputation panel | Medium — runtime gameplay layered on top of the migrated data model. Tightly coupled (relations spawns events; reputation reads from same data) |
| **PR 4** | Phase 5 | Faction overview UI: political map layer, faction list/detail pages, relations matrix | Low — UI polish on top of working systems |
| **PR 5** | Phase 6 | Map mode/overlay split + LOD territory-alpha tuning. Self-contained map polish, no data or service changes. | Low — UI-only, small diff (~5 files) |

**Why split PR 5 from PR 4**: PR 4's theme is "faction overview UI." The mode/overlay distinction and LOD tuning are general map-infrastructure concerns that aren't faction-specific — bundling them dilutes the review focus on PR 4 and conversely buries the map refactor inside a faction-themed diff that reviewers won't expect to find it in. Both PRs are small enough on their own; keeping them separate keeps each diff thematically tight.

**Why not more (e.g. one PR per phase)**: Phases 3 and 4 are tightly coupled — the relations processor spawns events that the reputation system later cares about; testing one without the other is awkward. Splitting them produces two PRs that each block on the other, with no review-quality benefit.

**Branch flow** (per `MEMORY.md` worktree preferences):

1. Worktree per PR (`feat/layer-2-foundation-pr-1`, `-pr-2`, etc.) branched off `main`.
2. Within a worktree, commit per phase if a PR spans multiple phases (PR 3 = Phases 3 + 4).
3. Phase complete + tests green → cherry-pick to the PR branch → run code review (custom local skill).
4. PR merges to `main`. Next PR's worktree branches from updated `main`.
5. Delete the worktree immediately after merge.

This keeps each PR's diff bounded to one natural seam and gives `main` 4 stabilisation points across Foundation.

---

## Deferred to Later Sub-Projects

| Item | Ships with |
|---|---|
| Facility placement and ownership | Facilities sub-project |
| Government-specific contraband/tax pipeline wiring | Contraband sub-project (the *data* lives in `GOVERNMENT_TYPES` after Foundation; the pipeline already reads government per-system once Phase 2 lands) |
| War declarations, exhaustion, battles, sieges | War sub-project |
| War-zone danger values in navigation pipeline | War sub-project |
| Faction-gated mission types (intelligence, diplomacy, escort) | War sub-project |
| Faction-exclusive ship variants | Future ship-roster expansion, gated by the stub hook in Phase 1 |
| Faction-flagship facilities at homeworlds | Facilities sub-project (or later) |
| Conquest hook for `Region.dominantEconomy` re-derivation | War sub-project (the pure derivation function is in Foundation Phase 2; the conquest call site lands with conquest itself) |
| Player-influence on alliance negotiation outcomes | War sub-project (the hook is stubbed in Phase 3) |
| Faction resurrection / rebel events | Far future (faction-system.md §7.1 mentions; out of scope here) |
| Per-good-category modifier nuance | Follow-up tuning pass (the field is declared in Phase 1) |

---

## Verification

- All Layer 1 + 1.5 tests still pass.
- `npm run simulate` runs cleanly on the new universe.
- New tests:
  - `getReputationTier` boundary values.
  - `toFactionStatus` hysteresis (gaining at +N, losing at +M).
  - `computeRelationDrift` per-driver isolation tests.
  - World-gen tests: 100 seeds × archetype constraint validation.
  - Trade service: reputation multiplier integration, hostile-denial, per-tick rep increment cap.
- Simulator validation:
  - 5,000-tick run with full faction roster: no faction destroyed (Foundation has no conquest), border conflicts fire on hostile pairs, alliances form on friendly pairs with telegraph delay honored.
  - Relation drift produces a believable political landscape — no single faction dominates relations universally, no faction ends in pure neutrality with everyone.
- Browser validation:
  - Faction list page loads and renders all 8 majors + N minors.
  - Faction detail page shows territory, doctrine, government, relations matrix row.
  - Political map overlay toggles cleanly, colors match `Faction.color`.
  - System detail page shows the system's faction name, faction color, and inherited government type.
  - Player reputation panel renders zero-rep state for new players; trading at a system bumps the owning faction's rep visibly.
- Stabilization checkpoint (per [MIGRATION-NOTES](../MIGRATION-NOTES.md)) is **not** triggered by Foundation alone — that fires after the full Layer 2 ships (Sub-Project 4 — War).

---

## Done When

- Reseed produces a universe owned by 8 majors + 12–18 minors with archetype-respecting placement.
- Every star system has a non-null `factionId`.
- Relations drift across thousands of ticks produces a believable political landscape — no single faction dominates; conflicts emerge organically.
- Border conflict events fire at unfriendly faction pairs and apply danger / economy modifiers via the existing event pipeline.
- Alliance pacts form (with telegraphed negotiation) and dissolve (with telegraphed warning) based on relations score.
- Players can see faction territory on the map, view their reputation with each faction, and feel reputation in buy/sell prices.
- All Layer 1 + 1.5 tests still pass; existing tick processors run unchanged against the new ownership model (the only processor body change is the one-line `governmentType` source-of-truth shift in the economy adapter; the body itself is untouched).
