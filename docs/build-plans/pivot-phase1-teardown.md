# Pivot Phase 1 — Teardown

Build plan for deleting the personal-player layer per [grand-strategy-vision.md](../planned/grand-strategy-vision.md) §4/§8. Transient doc — delete when the teardown ships. The app keeps running in its current form throughout; **build + unit/integration tests + `npm run simulate` stay green after every sweep.**

## Scope & settled decisions

Cut systems (vision §4): personal trading, trade missions, operational missions + battles, arrival danger pipeline, player-faction reputation, ship upgrades/shipyard, notifications + Captain's Log, in-system Explore/cantina, convoys, price history. Auth is **not** touched in Phase 1 (login stays; wholesale deletion lands in Phase 2 with the in-memory re-point — simpler than stubbing twice).

Fork decisions (2026-07-06):

1. **Market screen → read-only current-state inspection.** Keep `MarketTable` (prices/stock, minus the cargo column) and `MarketComparisonPanel`. **Price *history* is cut entirely** — grand strategy reads current scarcity, not price charts: `PriceSnapshot` model, `price-snapshots` processor, `lib/services/price-history.ts`, `use-price-history`, `PriceChart`, `StockChart` (snapshot-backed), `app/api/game/prices/[systemId]`.
2. **Fleet & travel → keep minimal.** Ship roster, fleet page, ship detail, navigate + refuel survive (no cargo, no danger, no combat role). Ship purchase/shipyard dies with upgrades; fleets are fixed until faction fleets arrive (dev teleport tool remains for testing). **Repair also dies** — with danger + battles gone, nothing damages hulls (hull/shield stats go inert until war).
3. **Convoys → cut now.** Escort served the dying pipeline; war-era grouping is a fresh design.
4. **Notifications + Captain's Log → cut now.** The Phase 3 faction alert feed is a fresh design.
5. **Void's Gambit**: the pure engine `lib/engine/mini-games/voids-gambit/**` (+ its tests) stays in-repo, parked. Everything that *serves* it (cantina services/routes/UI/hooks, `NpcVisit`, locations derivation) is deleted.
6. **Simulator**: bot hazard-avoidance models retired player behavior — strip danger from `lib/engine/simulator/economy.ts` + `strategies/helpers.ts` so `lib/engine/danger.ts`/`damage.ts` can be deleted. This shifts sim curves slightly; acceptable under the coarse-health-bar calibration rule (no byte-equivalence claim).

## Sweep order (one shared branch `feat/pivot-teardown`, one PR per sweep)

Ordered so each sweep deletes leaf-ward first and the shared-plumbing edits land where the last consumer dies. Each sweep also deletes the system's **active doc** and prunes its SPEC.md section, and ends with: `npx prisma db push` (dev DB), `npx vitest run`, `next build --webpack`, `npm run simulate`.

### Sweep 1 — Missions & battles (trade + operational + combat)

- **Models**: `TradeMission`, `Mission`, `Battle` (+ `Player.tradeMissions/missions`, `Ship`/`StarSystem`/`GameEvent`/`Faction`/`Good` back-relations).
- **Processors**: `lib/tick/processors/trade-missions.ts`, `missions.ts`, `battles.ts` + worlds (`trade-missions-world`, `op-missions-world`, `battles-world`) + prisma adapters (`trade-missions`, `op-missions`, `battles`) + their tests. Deregister in `lib/tick/registry.ts`; drop `missionsUpdated`/`opMissionsUpdated`/`battlesUpdated` payloads from `lib/tick/types.ts` + `lib/tick/helpers.ts` merge functions.
- **Engine**: `lib/engine/combat.ts`, `lib/engine/mission-gen.ts` + tests (`combat`, `mission-gen`, `missions`). Constants: `lib/constants/missions.ts`, `lib/constants/combat.ts`. `lib/utils/missions.ts`.
- **Services/API**: `lib/services/missions.ts`, `missions-v2.ts`; `app/api/game/missions/**`, `op-missions/**`, `battles/**` + integration tests.
- **UI/hooks**: `components/missions/*`, `components/fleet/battle-card.tsx`, `battle-viewer.tsx`; pages `@panel/missions`, `@panel/battles`, `@panel/battle/[battleId]`, `@panel/system/[systemId]/contracts`; hooks `use-system-missions`, `use-player-missions`, `use-mission-mutations`, `use-op-missions`, `use-op-mission-mutations`, `use-battles`.
- **Entanglements**: strip `prisma.mission` query from `lib/services/fleet.ts` (`getFleet` mission badge); strip mission counters from system overview page + Contracts tab/badge from system layout, `SYSTEM_TABS`, map `system-detail-panel`; sidebar Missions/Battles links.
- **Docs**: delete `docs/active/gameplay/combat.md`; strip mission sections from `trading.md` (rest dies in Sweep 2); prune SPEC.md sections (Trading & Missions → missions half, Operational Missions & Combat).

### Sweep 2 — Trading, reputation, notifications, price history

- **Models**: `TradeHistory`, `PlayerFactionReputation`, `PlayerNotification`, `PriceSnapshot` (+ back-relations).
- **Processors**: `notification-prune.ts`, `price-snapshots.ts` (+ registry/types/helpers edits: `gameNotifications`, `addPlayerNotification`/`persistPlayerNotifications` plumbing — note events' `eventNotifications` SSE payloads are type-level only and stay).
- **Services/API**: `lib/services/trade.ts`, `notifications.ts`, `reputation.ts`, `price-history.ts`; `market.ts#getTradeHistory`; `market-entry.ts` loses its reputation-multiplier params; routes `ship/[shipId]/trade`, `history/[systemId]`, `reputation`, `notifications/**`, `prices/[systemId]` + integration tests (`trade`, `reputation`, `missions` leftovers). Engine `lib/engine/trade.ts` + test. Constants `lib/constants/reputation.ts` (+ tests), `lib/constants/notifications.ts`; notification-type unions in `lib/types/game.ts`.
- **UI/hooks**: `components/trade/trade-form.tsx`, `price-chart.tsx`, `stock-chart.tsx`; `components/factions/reputation-panel.tsx`, `standing-badge.tsx`; `components/notifications/*`, `components/events/notification-entity-links.tsx`; pages `@panel/reputation`, `@panel/log`; market page reduced to inspection view (`MarketTable` minus cargo column + `MarketComparisonPanel`); hooks `use-trade-mutation`, `use-price-history`, `use-faction-reputation`, `use-notifications`; sidebar bell + Captain's Log + credits/ships status chips.
- **Docs**: delete `docs/active/gameplay/trading.md`, `notifications.md`; prune SPEC.md (Trading, Player-Faction Reputation, Notifications, price-snapshot mentions in Tick Engine).

### Sweep 3 — Danger pipeline, convoys, shipyard/upgrades, cargo

- **Ship-arrivals processor → dock-only**: strip Stages 1–5 (`ship-arrivals.ts:~128–242`), escort blocks, damage notifications; world interface loses `getNavModifiersForSystems`/`applyShipDamage`/`applyCargoMutations`; keep `getArrivingShips`/`dockShip`. Drop `shipArrived`-cargo/`cargoLost` payloads from tick types.
- **Engine**: delete `lib/engine/danger.ts`, `damage.ts`, `upgrades.ts`, `shipyard.ts`, `convoy-refuel.ts`, `convoy-repair.ts` + tests; **first** strip simulator imports (decision 6). Keep `computeTraitDanger` (in KEEP `trait-gen.ts`) — system danger remains a world attribute displayed on the overview (`system-danger-badge` stays; it's player-independent and events/war will reuse it).
- **Models**: `CargoItem`, `ShipUpgradeSlot`, `Convoy`, `ConvoyMember` (+ back-relations). `Ship` keeps its stat columns (inert until war) minus upgrade/convoy relations.
- **Services/API**: `convoy*.ts` (convoy, convoy-trade, convoy-refuel, convoy-repair), `upgrades.ts`, `shipyard.ts`, `repair.ts`; routes `convoy/**`, `ship/[shipId]/upgrades`, `ship/[shipId]/repair`, `shipyard`, `dev/set-cargo` + integration tests (`convoy-trade`, `shipyard`). Keep: `fleet.ts`, `navigation.ts`, `refuel.ts` + their routes.
- **UI/hooks**: `components/fleet/{upgrade-slot,upgrade-install-dialog,convoy-*,repair dialogs}`, `components/shipyard/*`, `components/map/compact-convoy-card.tsx`; pages `@panel/convoys`, `@panel/convoy/[convoyId]`, `@panel/system/[systemId]/{convoys,shipyard/**}`; ship-detail/fleet pages lose cargo + upgrade + repair surfaces; hooks `use-convoy`, `use-upgrade-mutations`, `use-purchase-ship-mutation`, `use-repair-mutation`. Constants `lib/constants/modules.ts` (ships.ts stays — roster data).
- **Docs**: delete `docs/active/gameplay/ship-upgrades.md`; rewrite `navigation.md` to travel-only (danger pipeline + convoy sections removed); prune `ship-roster.md` (acquisition/upgrade refs) + SPEC.md (Navigation & Fleet, Ships, Ship Upgrades sections).

### Sweep 4 — Explore/cantina + shell cleanup

- **Explore/cantina**: `NpcVisit` model; `lib/services/cantina.ts`; `app/api/game/cantina/**`; `components/cantina/*`, `components/ui/suit-badge.tsx`; pages `@panel/system/[systemId]/explore/**`; hooks `use-cantina`, `use-voids-gambit`; `lib/engine/cantina/*`; constants `cantina-npcs.ts`, `locations.ts` (`deriveSystemLocations`), `lib/types/cantina.ts`. **Keep parked**: `lib/engine/mini-games/voids-gambit/**` + tests.
- **Shell**: final pass over `SYSTEM_TABS` (Market/Overview/Astrography/Population/Industry/Logistics survive), `game-sidebar.tsx` (Events/Factions/Diplomacy/Tick survive), `top-bar.tsx` `SEGMENT_LABELS`, map `system-detail-panel` buttons, `lib/query/keys.ts`, `lib/types/api.ts`/`game.ts` dead types, orphan `components/dashboard/player-summary.tsx`, `lib/auth/serialize.ts#serializeShip` consumers check.
- **Docs**: SPEC.md final prune (Explore/cantina was never active-specced; verify no `[PENDING:]` stragglers; update tick-engine doc to the surviving processor list) + delete this build plan on merge.

## Tick pipeline after teardown

Keep: ship-arrivals (dock-only) · events · economy · infrastructure-decay · population · migration · trade-flow · directed-logistics · directed-build · relations. Delete: trade-missions · missions · battles · notification-prune · price-snapshots.

## Out of scope (Phase 2+)

Auth/`User`/`Player` deletion, SSE → in-process event bus, Prisma retirement, save/load, pause/speed, sim-bot retirement question (do bots still earn their keep as calibration pressure once no players trade? — revisit at Phase 2), `Player.credits` (inert until the treasury).

## Merge

Squash `feat/pivot-teardown` → main when all four sweeps are in (phase-PR subjects are build-noise).
