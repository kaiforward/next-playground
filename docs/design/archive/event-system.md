# Event System — Dynamic World Simulation

## Philosophy

The economy should feel like a living world. Players profit from being informed, taking risks, and anticipating what comes next — not from memorising a static spreadsheet of prices.

The core principle: **events shift where the rubber band is anchored, they don't stretch it directly**. The existing mean-reversion physics is always in charge. Events temporarily move the equilibrium targets that reversion pulls toward. When events end, the targets snap back and the system self-heals naturally. No cleanup logic, no special recovery code.

This means:
- You can stack 10 modifiers and the system stays bounded
- Remove any modifier and the system gracefully adjusts
- Every feature (wars, plagues, player actions, NPC trade, supply chains) creates modifiers through the same pipeline
- The economy processor stays simple: `effective_target = base_target + sum(active_modifier_shifts)`

## Architecture Overview

```
Events Processor (lifecycle management)
  │ writes/updates
  ▼
Shared State: GameEvent + EventModifier (DB tables)
  ▲ read by
  │
  ├── Economy Processor ──→ adjusts equilibrium targets, production rates
  ├── Navigation Processor ──→ applies danger levels to routes
  ├── Future: Combat Processor ──→ spawns hostile NPCs
  ├── Future: Reputation Processor ──→ shifts faction standings
  └── Future: Any New Processor ──→ queries modifiers for its domain
```

Events are **world facts**, not economy facts. A war in Kronos is a statement about the world. Each processor independently decides how to react:

| Processor | Reads war event as... |
|-----------|----------------------|
| Economy | Fuel demand +100%, production -60% |
| Navigation | Routes through Kronos: 15% cargo loss risk |
| Future: Combat | Spawn hostile NPCs near Kronos |
| Future: Reputation | Faction standings shift |

Adding a new processor (e.g. crew morale) requires zero changes to the event system — it just starts reading existing event types.

## Current Economy — What Exists Today

Each system has a station market per good (6 goods × ~200 systems). Every market stores **supply** and **demand**. Price is derived: `basePrice × (demand / supply)`.

Every tick, for one region (round-robin across 8 regions), each market receives:

1. **Mean reversion** — supply and demand pull 5% closer to equilibrium target
2. **Production/consumption** — producers get +3 supply/tick, consumers lose -2 supply/tick
3. **Random noise** — uniform ±3 on both supply and demand
4. **Clamp** — everything stays within [5, 200]

Equilibrium targets per economy type:
- **Produces a good**: supply 120, demand 40 (cheap)
- **Consumes a good**: supply 40, demand 120 (expensive)
- **Neutral**: supply 60, demand 60

This creates natural price geography (agricultural worlds have cheap food, expensive electronics) but the system is static once you learn the patterns. The 5% reversion rate means deviations halve in ~14 ticks. Nothing dramatic ever happens.

## Layer 1: Modifier System

Modifiers are the **universal interface** between "things happening in the world" and "mechanical effects on game systems." Every disruption — events, player actions, NPC behaviour, seasonal cycles — ultimately produces modifiers that processors consume.

### Modifier Types

| Type | What It Does | Good For |
|------|-------------|----------|
| **Equilibrium Shift** | Moves the supply/demand target the market reverts toward | Prolonged pressure (war demand, plague scarcity) |
| **Shock** | Instant one-time jolt to supply/demand values | Dramatic moments (asteroid impact, supply destruction) |
| **Rate Multiplier** | Scales production/consumption speed | Affecting throughput (plague halves food output, boom doubles mining) |
| **Reversion Dampening** | Slows the mean-reversion rate itself | Making crises feel weighty (markets stay disrupted longer) |

A single event phase can combine all four. A war might apply an instant shock (supply destruction), an equilibrium shift (sustained demand pressure), AND reversion dampening (recovery takes longer than normal).

### Modifier Scope

Modifiers specify what they target:

| Scope | Example |
|-------|---------|
| **System + Good** | "Fuel demand +80 at Kronos" |
| **System (all goods)** | "All production -60% at Kronos" |
| **Region + Good** | "Ore supply +30 across The Foundries" |
| **Region (all goods)** | "Reversion dampened across The Foundries" |

### Modifier Domain

Each modifier declares which processor domain it belongs to:

- `economy` — equilibrium shifts, rate multipliers, reversion dampening
- `navigation` — danger levels, route disruptions, travel time modifiers
- `combat` — NPC spawn rates, hostility levels (future)
- `reputation` — faction standing changes (future)

Processors only query modifiers for their own domain. The economy processor never sees navigation modifiers.

### How the Economy Processor Uses Modifiers

Enhanced simulation per market entry:

```
1. Compute base equilibrium target (existing: produces/consumes/neutral)
2. Query active economy modifiers for this system + good
3. Apply equilibrium shifts:
   effective_supply_target = base_supply_target + sum(supply_shifts)
   effective_demand_target = base_demand_target + sum(demand_shifts)
4. Apply rate multipliers:
   effective_production = base_production × product(production_multipliers)
   effective_consumption = base_consumption × product(consumption_multipliers)
5. Apply reversion dampening:
   effective_reversion = base_reversion × min(dampening_multipliers)
6. Run mean-reversion with effective values (same physics, shifted goalposts)
7. Apply any pending shocks (instant adds, processed once then removed)
8. Clamp to [min, max]
```

The simulation function signature barely changes — it just receives modified parameters.

## Layer 2: Event System

Events are the **narrative wrapper** around modifiers. They have identities, phases, and lifecycles. Players see events ("War erupts in Kronos!"), not raw modifier numbers.

### Event Lifecycle

```
Spawn → Phase 1 → Phase 2 → ... → Phase N → Expired
         │          │                │
         ▼          ▼                ▼
      Create     Swap/update      Remove
      modifiers  modifiers        modifiers
```

Each phase transition:
1. Removes modifiers from the previous phase
2. Creates modifiers for the new phase
3. Optionally spawns spread events at neighbouring systems
4. Emits player-visible notifications

### Single Events vs Arcs

**Single Event**: One phase, fixed duration, simple modifiers.
- Example: "Solar Flare" — production halted for 30 ticks, then gone.

**Arc**: Multiple phases, escalating/de-escalating effects, narrative progression.
- Example: "War" — Tensions → Escalation → Active Conflict → Aftermath → Recovery

Both use the same `GameEvent` model. An arc is just an event with multiple phase definitions.

### Event Definitions (Data, Not Code)

Each event type is a static definition describing its phases, modifiers, triggers, and spread rules. Adding a new event type means adding a definition object — no processor changes.

```typescript
interface EventDefinition {
  type: string;                    // "war", "plague", "gold_rush"
  name: string;                    // Display name: "War"
  description: string;             // "Military conflict erupts"
  targetFilter?: {                 // What systems can this affect?
    economyTypes?: EconomyType[];  // Only specific economy types
    isGateway?: boolean;           // Only gateways
  };
  phases: EventPhaseDefinition[];
  cooldown?: number;               // Min ticks before same event can recur at same system
  maxActive?: number;              // Max simultaneous instances globally
  weight: number;                  // Relative spawn probability
}

interface EventPhaseDefinition {
  name: string;                    // "tensions", "active", "aftermath"
  displayName: string;             // "Tensions Rising"
  durationRange: [number, number]; // Random duration within range [min, max] ticks
  modifiers: ModifierTemplate[];   // What modifiers to apply
  spread?: SpreadRule[];           // Propagation to nearby systems
  notification?: string;           // Player-visible message template
}

interface ModifierTemplate {
  domain: "economy" | "navigation" | "combat" | "reputation";
  type: "equilibrium_shift" | "rate_multiplier" | "reversion_dampening";
  // For shocks, handled separately at phase start
  target: "system" | "region";     // Scope relative to event target
  goodId?: string | null;          // Specific good, or null for all
  parameter: string;               // What to modify: "supply_target", "demand_target", "production_rate", "danger_level"
  value: number;                   // Modifier value (absolute for shifts, multiplier for rates)
}
```

### Regional Spread

Events can propagate to neighbouring systems. Spread rules specify:

```typescript
interface SpreadRule {
  triggerOnPhase: string;          // Which phase triggers spread
  eventType: string;               // What event to spawn (often a weaker variant)
  targetFilter?: {
    sameRegion?: boolean;          // Only within same region
    economyTypes?: EconomyType[];  // Only specific economy types
    maxDistance?: number;           // Max hops from source system
  };
  probability: number;             // 0-1, chance per eligible system
  maxSpreadDepth?: number;         // Prevent infinite chains (default 1)
}
```

Examples:
- War reaches "Active" → spawn "conflict_spillover" at neighbouring systems (30% strength, 50% danger)
- Plague reaches "Spreading" → spawn "plague_risk" at agricultural systems in same region
- Gold Rush reaches "Boom" → spawn "ore_glut" across entire region

Spread events are regular events with their own lifecycle. They can be independently managed, extended, or even spread further (with depth caps).

### Events Processor

Runs every N ticks (e.g. every 10-20 ticks). Responsibilities:

1. **Roll for new events**: weighted random selection based on eligible systems, event weights, cooldowns, and active event limits
2. **Advance phases**: check active events where `currentTick >= phaseStartTick + phaseDuration`, transition to next phase
3. **Manage modifiers**: create new modifiers on phase entry, remove old modifiers on phase exit
4. **Handle spread**: execute spread rules on phase transitions
5. **Expire events**: remove events that have completed all phases
6. **Emit notifications**: push event notifications to SSE for player visibility

The processor does NOT know what modifiers mean — it just manages lifecycle. Economy, navigation, and other processors interpret the modifiers.

## Event Catalog

See [event-catalog.md](../event-catalog.md) for implemented and planned event definitions.

## Future Enhancements

See [simulation-enhancements.md](../simulation-enhancements.md) for ideas requiring new engine mechanics.

## Data Model

### New Tables

```prisma
model GameEvent {
  id            String   @id @default(cuid())
  type          String              // Event definition key: "war", "plague", etc.
  phase         String              // Current phase name: "tensions", "active", etc.
  systemId      String?             // Target system (null for region-level events)
  regionId      String?             // Target region
  startTick     Int                 // Tick when event was created
  phaseStartTick Int               // Tick when current phase began
  phaseDuration  Int               // Ticks until next phase transition
  severity      Float   @default(1.0) // Intensity multiplier (spread events are weaker)
  sourceEventId String?             // Parent event (for spread events)
  metadata      String  @default("{}") // JSON: event-specific data

  system      StarSystem?  @relation(fields: [systemId], references: [id])
  region      Region?      @relation(fields: [regionId], references: [id])
  sourceEvent GameEvent?   @relation("EventSpread", fields: [sourceEventId], references: [id])
  spreadEvents GameEvent[] @relation("EventSpread")
  modifiers   EventModifier[]

  @@index([type])
  @@index([systemId])
  @@index([regionId])
}

model EventModifier {
  id          String  @id @default(cuid())
  eventId     String
  domain      String             // "economy", "navigation", "combat", "reputation"
  type        String             // "equilibrium_shift", "rate_multiplier", "reversion_dampening"
  targetType  String             // "system", "region"
  targetId    String?            // systemId or regionId
  goodId      String?            // Specific good key, or null for all goods
  parameter   String             // "supply_target", "demand_target", "production_rate", "danger_level"
  value       Float              // Modifier value

  event GameEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([domain, targetType, targetId])
  @@index([eventId])
}
```

### Querying Modifiers

Economy processor queries modifiers for a specific system:

```sql
SELECT * FROM EventModifier
WHERE domain = 'economy'
  AND (
    (targetType = 'system' AND targetId = ?)
    OR (targetType = 'region' AND targetId = ?)
  )
```

This gives all active economy modifiers affecting a system — both direct (system-level) and regional. The processor aggregates them:
- Equilibrium shifts: sum all `value` fields per parameter per good
- Rate multipliers: multiply all `value` fields per parameter per good
- Reversion dampening: take the minimum `value` (most dampened wins)

### Shock Handling

Shocks are instant one-time adjustments. They're stored as a separate modifier type and processed once, then deleted. The events processor creates them at phase transitions; the economy processor applies them and marks them as consumed (or the events processor deletes them after one economy tick).

Alternative: shocks aren't stored as modifiers at all. Instead, the events processor directly applies supply/demand changes at phase transition time (inside the shared transaction). This is simpler and avoids the "processed once" bookkeeping.

Recommended: direct application at phase transition. Keeps the modifier table clean for ongoing effects only.

## Safety Mechanisms

1. **Mean reversion is always on** — modifiers shift targets, they don't disable physics
2. **All modifiers have finite duration** — tied to event phases, which always terminate
3. **Stacking caps** — maximum total equilibrium shift per market (e.g. ±100 from base), minimum rate multiplier (e.g. 0.1), minimum reversion rate (e.g. 0.01)
4. **Event limits** — configurable maximum active events per system (e.g. 3), per region (e.g. 8), globally (e.g. 30)
5. **Clamp bounds** — supply/demand still clamped to [5, 200] regardless of modifiers
6. **Cooldowns** — events can't immediately recur at the same system
7. **Severity scaling** — spread events have reduced severity (e.g. 0.3× parent), modifiers are multiplied by severity
8. **Reversion always wins** — even dampened reversion is never zero

The system literally cannot self-destruct because the only thing events can do is temporarily move the goalposts. The rubber band is always pulling.

## Goods Scalability

The system is fully data-driven. Adding a good requires:
1. Add entry to `GOODS` constant
2. Add to `ECONOMY_PRODUCTION` / `ECONOMY_CONSUMPTION` maps
3. Seed creates station market rows

No code changes to processors, modifiers, events, or UI (tables render dynamically from data).

**Performance at scale**: 6 goods × 200 systems = 1,200 markets. Round-robin across 8 regions = ~150 markets per economy tick. At 20 goods = ~500/tick (still trivial). At 50 goods × 500 systems with PostgreSQL parallel processing, each region processes independently.

**Splitting goods** (e.g. ship_parts → thrusters + weapons): add new GOODS entries, update production maps. If supply chain recipes exist, define input requirements. Events that previously targeted "ship_parts" can target the new goods — modifier templates use good IDs.

## Implementation Status

All phases complete. Archived from `docs/design/`.

- **Phase 1: Modifier Infrastructure** — GameEvent + EventModifier in schema, economy processor reads/applies modifiers.
- **Phase 2: Events Processor** — `lib/tick/processors/events.ts`, lifecycle management, 3 starter events (war, plague, trade_festival).
- **Phase 3: Shocks + Spread** — Shock application at phase transitions, regional spread rules, conflict_spillover + plague_risk child events.
- **Phase 4: Navigation Integration** — `lib/engine/danger.ts`, danger modifiers on events, ship-arrivals processor rolls for cargo loss.
- **Phase 5: Player Visibility** — SSE notifications, map event icon badges + border/glow, tabbed event panel (Economy / Ship Log), system detail events section, events API/hook.
