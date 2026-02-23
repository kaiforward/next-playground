# Layer 1: Fleet Expansion — Implementation Plan

## Context

Layer 1 expands the fleet system from 2 ship types with 2 stats to 12 ship classes with full stat blocks, upgrade modules, convoys, speed-based travel, hull/shield damage, and a danger pipeline overhaul. This is the foundation for all player movement and fleet composition going forward — convoys become the primary way players interact with the map.

Layer 0 (traits, economy derivation, 24 regions) is complete and merged. Layer 1 builds on the enriched universe but does not depend on factions (Layer 2).

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Convoy cargo model | Shared virtual hold | Treat convoy as one giant ship. Too fiddly to assign cargo per-ship. DB stores per-ship, but trade/UI sees combined hold |
| Ship destruction | Disabled, not destroyed | Hull 0 = cargo lost, ship disabled (needs paid repair). Can tighten later if too lenient |
| Repair | At any station, credit cost | Simple, always available. Like refueling. No facility gating yet |
| Shields | Included now | Two-layer damage: shields absorb first, then hull. Shields regenerate on dock. Reused for in-system combat later |
| Escort mechanics | Passive danger reduction | Combat ships in convoy reduce event chance + damage severity. No detailed combat — this is a trade safety system |
| Convoy level gate | Designed for but not implemented | Build the hook for gating but don't enforce. Player progression (Layer 5) gates it later |
| Faction-exclusive ships/modules | Deferred to Layer 2 | Need factions + reputation system |
| Facility gating (shipyard/drydock tiers) | Stubbed | All ships/modules available everywhere. Gating added when facilities ship in Layer 2 |
| Automation Module | Placeholder definition | Module exists in constants but has no behavior. Automation spec is Layer 4 |

---

## Phase Plan

### Phase 1: Ship Constants and Types

Expand from 2 ship types to 12 classes with 10 stats each.

**New/modified files:**
- `lib/constants/ships.ts` — `ShipTypeId` union (12 values), `ShipTypeDefinition` gains: size, role, speed, hull, hullMax, shieldMax, firepower, evasion, stealth, sensors, crewCapacity, slotLayout, price
- `lib/types/game.ts` — New types: `ShipSize`, `ShipRole`, `UpgradeSlotType`. Expand `ShipState` with new stats + shield/hull current values + upgrade slots
- `lib/types/guards.ts` — Expand `SHIP_TYPE_IDS` set, add guards for new union types

**12 ship classes:**

| Class | Size | Role | Key stats |
|---|---|---|---|
| Shuttle | Small | Trade | Balanced starter, speed 5 |
| Light Freighter | Small | Trade | More cargo, less speed |
| Interceptor | Small | Combat | Fast, high firepower, low cargo |
| Scout Skiff | Small | Scout | High sensors/speed, minimal cargo |
| Bulk Freighter | Medium | Trade | High cargo, slow |
| Corvette | Medium | Combat | Balanced combat, moderate cargo |
| Blockade Runner | Medium | Stealth | High stealth/speed, moderate cargo |
| Survey Vessel | Medium | Support | High sensors, moderate everything |
| Heavy Freighter | Large | Trade | Maximum cargo, very slow |
| Frigate | Large | Combat | High hull/firepower, escorts well |
| Stealth Transport | Large | Stealth | High stealth, good cargo |
| Command Vessel | Large | Support | Balanced, high crew/sensors |

**Testable after:** Unit tests verify all 12 types defined, stats valid, slot counts match size, purchasable filter works.

---

### Phase 2: Upgrade Module Constants

Define 12 standard modules across 4 slot types.

**New files:**
- `lib/constants/modules.ts` — `ModuleId` type, `ModuleDefinition` interface, `MODULES` record

**4 slot types × 3 modules each:**
- **Engine:** Fuel Optimiser (tiered, -fuel cost), Thruster Upgrade (tiered, +speed), Manoeuvring Thrusters (capability, +evasion in pipeline)
- **Cargo:** Expanded Hold (tiered, +cargoMax), Reinforced Containers (tiered, -loss severity), Hidden Compartment (capability, conceals cargo %)
- **Defence:** Armour Plating (tiered, +hull), Shield Booster (tiered, +shieldMax), Point Defence Array (capability, -event loss probability)
- **Systems:** Scanner Array (tiered, +sensors), Automation Module (capability, placeholder), Repair Bay (capability, placeholder — hullRegenRate computed but not yet consumed)

**Tiered modules:** Mk I / Mk II / Mk III with increasing stat bonuses and costs.

**Testable after:** Unit tests verify all 12 modules defined, each slot type has 3 modules, tiered modules have 3 tiers, costs are sensible.

---

### Phase 3: Travel Engine — Speed-Based Formula

Replace fixed `hopDuration` with speed-dependent travel. Backward compatible.

**Modified files:**
- `lib/engine/travel.ts` — `hopDuration(fuelCost, shipSpeed?, referenceSpeed?)`. No speed = current behavior. With speed: `max(1, ceil(baseTicks * (referenceSpeed / shipSpeed)))`. Reference speed = Shuttle's speed (preserves current travel times exactly).
- `lib/engine/navigation.ts` — Thread `shipSpeed` through validation functions
- `lib/engine/pathfinding.ts` — Thread `shipSpeed` through pathfinding

**Testable after:** Unit tests: no-speed calls identical to current, faster ships (lower speed value) = fewer ticks, slower ships = more ticks, minimum 1 tick always holds.

---

### Phase 4: Danger Engine — Ship Stats + Upgrade Modifiers

Expand danger pipeline functions to accept ship stats and upgrade bonuses.

**Modified files:**
- `lib/engine/danger.ts` — Each pipeline function gains optional ship stat and upgrade bonus params:
  - Stage 1 (hazard): `hullStat` reduces loss severity, `armourBonus` adds hull, `reinforcedContainersBonus` reduces severity
  - Stage 3 (contraband): `stealthStat` reduces inspection chance, `hiddenCargoFraction` conceals cargo from inspection
  - Stage 4 (cargo loss): `evasionStat` reduces loss probability, `manoeuvringBonus` adds evasion, `pointDefenceReduction` flat probability reduction

**New files:**
- `lib/engine/upgrades.ts` — `computeUpgradeBonuses(installedModules)` aggregates module effects into the flat bonus structure the danger engine expects

**Stat reduction formula:** Diminishing returns: `reduction = stat / (stat + K)` where K is tuned per stage.

**Testable after:** Extensive unit tests for each stat × stage combination. No-stat calls identical to current. Higher stats = less danger.

---

### Phase 5: Hull & Shield Damage Engine

Pure engine functions for the damage model.

**New files:**
- `lib/engine/damage.ts` — Pure functions:
  - `rollDamageOnArrival(dangerLevel, shieldMax, shieldCurrent, hullMax, hullCurrent, rng)` — % chance of damage based on danger level, returns `{ shieldDamage, hullDamage, disabled }`. Shields absorb first.
  - `calculateRepairCost(hullMax, hullCurrent)` — Hull repair cost at 10 CR/point. Shields regenerate free on dock.
  - `computeEscortProtection(escortShips)` — All convoy ships contribute firepower to damage reduction. Diminishing returns formula.

**Design:**
- Damage chance scales with aggregated danger level (same danger score events already produce)
- Damage amount: random within range, scaled by danger severity
- Shields absorb first: `shieldDamage = min(damage, shieldCurrent)`, remainder hits hull
- Hull at 0: ship disabled, cargo lost (all cargo items deleted), ship stays at system but can't travel
- Shields fully regenerate on dock (instant — they're energy-based)
- Hull repair: pay credits at any station

**Testable after:** Unit tests for damage rolls, shield absorption, hull thresholds, repair cost calculation, escort protection scaling.

---

### Phase 6: Schema and Migration

Prisma schema changes for expanded ships, upgrade slots, hull/shield tracking, and convoys.

**Modified files:**
- `prisma/schema.prisma`:

**Ship model additions:**
```
speed, hull, hullMax, hullCurrent, shieldMax, shieldCurrent,
firepower, evasion, stealth, sensors, crewCapacity,
disabled (Boolean, default false)
```

**New models:**
```
ShipUpgradeSlot (id, shipId, slotType, slotIndex, moduleId?, moduleTier?)
  @@unique([shipId, slotType, slotIndex])

Convoy (id, playerId, name?, systemId, status: "docked"|"in_transit",
        destinationSystemId?, departureTick?, arrivalTick?)

ConvoyMember (id, convoyId, shipId)
  @@unique([shipId]) — a ship can only be in one convoy
```

**Convoy cargo:** Cargo stays on individual ships in the DB. The convoy's "shared hold" is computed by summing cargoMax across member ships. Trade operations distribute cargo across ships with available space automatically.

- `prisma/seed.ts` — Starter Shuttle created with full stats from `SHIP_TYPES["shuttle"]` + empty upgrade slots

**Testable after:** `prisma db push` succeeds, seed runs cleanly, queries return new fields.

---

### Phase 7: Serialization and API Types

Wire new data to the client.

**Modified files:**
- `lib/types/game.ts` — `ShipState` gains all new stats, `UpgradeSlotState`, shield/hull current. New `ConvoyState` type.
- `lib/types/api.ts` — New request/response types for convoy operations, upgrade installation, repair
- `lib/auth/serialize.ts` — `serializeShip` expanded with new stats and slots. New `serializeConvoy`.
- `lib/services/fleet.ts` — Include upgrade slots and convoy membership in ship queries
- `lib/services/navigation.ts` — Read speed stat for travel calculation

**Testable after:** Fleet API returns ships with all new stats. Type checks pass.

---

### Phase 8: Ship Arrivals — Wired Pipeline + Damage

Wire ship stats, upgrade bonuses, and hull/shield damage into the live processor.

**Modified files:**
- `lib/tick/processors/ship-arrivals.ts`:
  1. Query includes ship stats + upgrade slots
  2. Compute upgrade bonuses via `computeUpgradeBonuses()`
  3. Pass stats + bonuses to danger pipeline stages
  4. After cargo loss stages: roll hull/shield damage via `rollDamageOnArrival()`
  5. If hull reaches 0: set `disabled = true`, delete all cargo, emit "ship_disabled" notification
  6. Persist hull/shield changes
  7. Shields regenerate on dock (set `shieldCurrent = shieldMax`)

**For convoy arrivals:**
- All convoy ships arrive together (same arrivalTick)
- Compute escort protection from all convoy member ships (firepower-weighted)
- Apply danger reduction to all ships
- Damage distributed across ships (divided roughly equally, randomized slightly)
- Each ship's hull/shield tracked independently

**Testable after:** Integration tests with different ship stats verifying danger outcomes differ. High-hull ships take less hull damage. Escort convoys are safer.

---

### Phase 9: Navigation — Speed-Based Travel + Convoy Movement

Wire speed into navigation service. Add convoy travel.

**Modified files:**
- `lib/services/navigation.ts` — Read ship speed, pass to validation. For convoy navigation: travel at slowest member's speed, all ships transition together.

**New files:**
- `lib/services/convoy.ts` — Service functions:
  - `createConvoy(playerId, shipIds)` — Group docked ships at same system
  - `disbandConvoy(playerId, convoyId)` — Ungroup ships (only when docked)
  - `addToConvoy(playerId, convoyId, shipId)` — Add docked ship at same system
  - `removeFromConvoy(playerId, convoyId, shipId)` — Remove ship (only when docked)
  - `navigateConvoy(playerId, convoyId, route)` — Move entire convoy. Speed = slowest member. All ships transition to in_transit.

**API routes:**
- `app/api/game/convoy/route.ts` — GET (list convoys), POST (create)
- `app/api/game/convoy/[convoyId]/route.ts` — DELETE (disband)
- `app/api/game/convoy/[convoyId]/members/route.ts` — POST (add), DELETE (remove)
- `app/api/game/convoy/[convoyId]/navigate/route.ts` — POST (move convoy)
- `app/api/game/convoy/[convoyId]/trade/route.ts` — POST (convoy trade)
- `app/api/game/convoy/[convoyId]/repair/route.ts` — POST (convoy repair)

**Testable after:** Create convoy, navigate it, verify all ships arrive at same tick. Verify slowest-speed applies.

---

### Phase 10: Ship Purchase, Upgrades, and Repair Services

Expand shipyard. Add upgrade installation and repair.

**Modified files:**
- `lib/services/shipyard.ts` — `purchaseShip` creates ship with full stats + empty upgrade slots

**New files:**
- `lib/services/upgrades.ts` — `installUpgrade(playerId, shipId, slotId, moduleId, tier?)`, `removeUpgrade(playerId, shipId, slotId)`. TOCTOU-guarded.
- `lib/services/repair.ts` — `repairShip(playerId, shipId)`. Restores hull to max, cost proportional to damage. TOCTOU-guarded.
- `lib/engine/upgrades.ts` — Already created in Phase 4. Add `validateUpgradeInstallation` pure validation.

**API routes:**
- `app/api/game/ship/[shipId]/upgrades/route.ts` — GET, POST (install), DELETE (remove)
- `app/api/game/ship/[shipId]/repair/route.ts` — POST (repair)

**Convoy trade integration:**
- `lib/services/convoy-trade.ts` (separate file) — Combined cargo buy/sell for convoys. Distributes goods across member ships by available space on buy; pulls sequentially on sell. Individual ship trade (`trade.ts`) rejects convoy members.
- `lib/services/convoy-repair.ts` — Fraction-based multi-ship repair. Per-ship heal = `ceil(damage × fraction)` at 10 CR/hull point.
- `lib/engine/convoy-repair.ts` — Pure engine function for repair plan computation.

**Testable after:** Purchase all 12 classes. Install/remove modules. Repair damaged ships. Convoy trade distributes cargo.

---

### Phase 11: Simulator Update

Update simulator for expanded ships and speed-based travel.

**Modified files:**
- `lib/engine/simulator/types.ts` — `SimShip` gains all stats
- `lib/engine/simulator/world.ts` — Create bot ships with full stats
- `lib/engine/simulator/bot.ts` — Use speed in travel, handle hull damage
- `lib/engine/simulator/pathfinding-cache.ts` — Thread speed through

**Testable after:** `npm run simulate` runs cleanly. Travel times match expectations. No test regressions.

---

### Phase 12: UI

Update all ship UI for new stats, convoys, upgrade slots, repair.

**Modified files:**
- `components/fleet/ship-card.tsx` — Role badge, key stats, hull/shield bars, disabled state
- `components/fleet/ship-detail-panel.tsx` — Full 10-stat display, upgrade slots, hull/shield, repair button

**New files:**
- `components/fleet/upgrade-slot.tsx` — Slot display with installed module or empty state
- `components/fleet/upgrade-install-dialog.tsx` — Module picker for a slot type
- `components/fleet/convoy-panel.tsx` — Convoy management: member list, combined cargo, form/disband/add/remove
- `components/fleet/repair-dialog.tsx` — Repair cost display, confirm button
- `components/shipyard/shipyard-panel.tsx` — 12-class grid grouped by size, stats comparison, purchase

**New hooks:**
- `lib/hooks/use-convoy.ts` — Convoy data + mutations
- `lib/hooks/use-upgrade-mutations.ts` — Install/remove upgrade mutations
- `lib/hooks/use-repair-mutation.ts` — Repair mutation

**Testable after:** Visual verification. All 12 ships purchasable. Convoy formation/travel works. Upgrades installable. Repair works.

---

### Phase 13: Documentation and Validation

- Update `docs/design/active/navigation.md` with new ship model, speed travel, convoy, damage
- Update `docs/SPEC.md` with Layer 1 systems
- Update `docs/design/MIGRATION-NOTES.md` — delete resolved deltas, note remaining deferrals
- Validation tests across seeds for ship stat balance
- Full test suite green

---

## Deferred to Layer 2+

| Item | Ships with |
|---|---|
| Faction-exclusive ships (6 variants) | Layer 2 (factions) |
| Faction-exclusive modules (6) | Layer 2 (factions) |
| Shipyard/drydock tier gating | Layer 2 (facilities) |
| Module upkeep costs | Layer 2 (economic tuning) |
| Contraband restrictions by government | Layer 2 (8 government types) |
| Automation Module behavior | Layer 4 |
| Convoy level gating | Layer 5 (player progression) |
| In-system combat (reuses hull/shield) | Layer 3 |

## Branch Strategy

Single `feature/layer-1` branch with commits after each phase. The systems are tightly coupled (ship stats feed into danger pipeline, convoys use navigation, upgrades modify stats) so splitting branches creates integration risk. One PR with phase-by-phase commits, reviewed and squash-merged like Layer 0.

## Verification

- All existing tests pass (411+)
- New tests for: ship constants, module constants, speed travel, danger pipeline with stats, hull/shield damage, escort protection, convoy operations, upgrade installation, repair
- `npm run simulate` runs cleanly with expanded ships
- Visual verification: ship purchase, convoy formation/travel, upgrade install, damage/repair cycle
- Target: ~500+ tests total
