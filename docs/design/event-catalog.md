# Event Catalog — Future Event Definitions

Event arcs and shocks that work with the existing event system. Each entry is a new `EventDefinition` — no engine or processor changes required. Add to `lib/constants/events.ts` and they just work.

Events with entries in `EVENT_MISSION_GOODS` (also in `events.ts`) automatically generate trade missions for their themed goods. Currently mapped: war, plague, trade_festival, mining_boom, supply_shortage, pirate_raid, solar_storm. New events get missions by adding a mapping entry.

For ideas that require new engine mechanics, see [simulation-enhancements.md](./simulation-enhancements.md).

## Implemented

These events are live in `lib/constants/events.ts`.

### War

Target: Industrial, tech, extraction, core systems. Multi-phase arc with spread.

| Phase | Duration | Economy Modifiers | Navigation | Spread |
|-------|----------|-------------------|------------|--------|
| **Tensions** | 30-60 | Fuel demand +20, machinery demand +30 | — | — |
| **Escalation** | 20-40 | Fuel demand +50, machinery +50, production x0.7 | Danger 0.05 | — |
| **Active Conflict** | 80-150 | Fuel demand +80, machinery +60, production x0.4, reversion x0.5 | Danger 0.15 | conflict_spillover |
| **Aftermath** | 50-100 | Electronics demand +50, food +40, production x0.7 | Danger 0.03 | — |
| **Recovery** | 40-80 | Lingering demand shifts at 30% | — | — |

Player opportunity: Stockpile machinery during tensions, sell during active conflict. Deliver food/electronics during aftermath.

### Plague / Blight

Target: Agricultural systems. Multi-phase arc with spread.

| Phase | Duration | Economy Modifiers | Navigation | Spread |
|-------|----------|-------------------|------------|--------|
| **Outbreak** | 20-40 | Food production x0.3, food supply shock -30 | — | — |
| **Spreading** | 40-80 | Food production x0.2, medicine demand +40 | Danger 0.03 | plague_risk |
| **Containment** | 30-60 | Food production x0.5, medicine demand +20 | — | — |
| **Recovery** | 40-60 | Food production x0.8, reversion x0.6 | — | — |

Player opportunity: Rush food imports. Sell medicine. Secondary profit at neighbouring agricultural systems.

### Trade Festival

Target: Core systems. Single-phase event. Weight 8, cooldown 120.

| Phase | Duration | Economy Modifiers |
|-------|----------|-------------------|
| **Festival** | 40-80 | Luxury demand +60, food demand +30, all demand +15 |

Player opportunity: Sell luxuries and food at premium prices.

### Mining Boom

Target: Extraction systems. Multi-phase arc with spread. Weight 8, cooldown 120.

| Phase | Duration | Economy Modifiers | Spread |
|-------|----------|-------------------|--------|
| **Discovery** | 20-30 | Ore supply +60, ore production x1.5 | — |
| **Boom** | 60-100 | Ore supply +80, ore production x2.0, food demand +30, luxury demand +40 | ore_glut in region |
| **Peak** | 40-60 | Ore production x1.8, food demand +50 | — |
| **Depletion** | 60-100 | Ore production x0.6, ore supply -20 | — |

Player opportunity: Buy cheap ore during boom, sell to industrial systems. Sell food/luxuries to booming system. After depletion, the system is worse off — avoid buying ore there.

### Supply Shortage

Target: Any system. Single-phase shock event. Weight 10, cooldown 60.

| Phase | Duration | Economy Modifiers |
|-------|----------|-------------------|
| **Shortage** | 30-60 | All supply -25, all demand +25, reversion x0.7, food/fuel supply shock -20 |

Player opportunity: Deliver goods (especially food and fuel) for premium prices.

### Pirate Raid

Target: Any system. Two-phase arc. Weight 8, cooldown 80.

| Phase | Duration | Economy Modifiers | Navigation |
|-------|----------|-------------------|------------|
| **Raiding** | 40-80 | All supply -15, weapons demand +30 | Danger 0.15 |
| **Crackdown** | 20-40 | Machinery demand +25 | Danger 0.03 |

Player opportunity: Avoid the system during raiding (or risk cargo loss for discounted goods). Supply machinery during crackdown.

### Solar Storm

Target: Any system. Short, intense two-phase event. Weight 6, cooldown 40.

| Phase | Duration | Economy Modifiers | Navigation |
|-------|----------|-------------------|------------|
| **Storm** | 15-30 | All production x0.1 | Danger 0.25 |
| **Clearing** | 10-20 | Production x0.6, reversion x0.5 | — |

Player opportunity: Avoid during storm, rush in during clearing to buy goods at disrupted prices before reversion kicks in.

### Conflict Spillover (child event)

Spawned by War spread. Reduced severity (0.3x).

### Plague Risk (child event)

Spawned by Plague spread at neighbouring agricultural systems. Reduced severity (0.3x).

### Ore Glut (child event)

Spawned by Mining Boom spread. Reduced severity (0.4x). Ore supply surplus depresses local prices.

## Ideas

Brainstormed event arcs — need detailed phase/modifier design before implementation.

### Fuel Crisis

Target: Tech or industrial systems. Multi-phase arc with spread.

A refinery accident collapses local fuel production. Shortages cascade to connected systems as supply chains dry up. Players who stockpiled fuel profit massively.

Phases: Accident → Shortage Cascade (spread: fuel_shortage at neighbours) → Rationing → Restoration.

Key modifiers: Fuel production x0.1 during accident, fuel demand spikes at neighbours, danger during rationing (civil unrest).

### Station Overhaul

Target: Any system. Multi-phase arc.

A system undergoes major infrastructure upgrades. Production drops to near-zero during construction, but afterward the system temporarily produces at 2x rates. Risk-reward: supply construction materials during the build phase, reap cheap goods during the boom.

Phases: Planning (mild demand shifts) → Construction (production x0.2, electronics/ore demand surge) → Commissioning → Enhanced Operations (production x2.0, slowly declining).

### Revolution

Target: Core or industrial systems. Multi-phase arc with spread.

Political upheaval halts production, spikes danger, and drives demand for food and electronics (communications). Neighbouring systems see refugee-driven demand (food, luxuries). Long arc with heavy economic disruption.

Phases: Unrest (production x0.7, danger 0.05) → Uprising (production x0.1, danger 0.20, spread: unrest at neighbours) → Martial Law (danger 0.15, machinery demand surge) → Stabilisation → Recovery.

### Migration Wave

Target: Agricultural → Core migration. Multi-phase arc.

Population moves between systems over a long period. Origin system sees demand drop and production decline. Destination sees demand surge for food and housing (luxuries). Slow-burning — longest phases in the catalog.

Phases: Early Migration (origin food demand -10, dest food demand +20) → Peak Migration (origin production x0.7, dest all demand +30) → Settlement (dest luxury demand +40) → New Normal (mild lingering shifts).

### Comet Approach

Target: Core systems (celebrations) + mining systems (comet mining). Multi-phase arc.

A positive event — not all events need to be crises. Cultural celebrations drive luxury and food demand at core systems. Mining systems see ore supply boosts from comet material.

Phases: Sighting (luxury demand +20 at core) → Approach (luxury demand +50, food demand +30, ore supply +40 at mining) → Closest Pass (peak modifiers) → Departure (declining modifiers).

### Solar Flare Cascade

Target: Region-level. Multi-phase arc with sequential spread.

Unlike the single-system Solar Storm, this chains through connected systems via spread rules. Each hop is weaker (severity decay). Creates a wave of production disruption across a region.

Phases: Initial Flare (production x0.1, danger 0.25, spread: solar_disruption at neighbours with 0.5 severity) → Aftershock (production x0.5) → Recovery.

### Smuggler's Market

Target: Gateway systems. Two-phase event.

An underground economy emerges. Specific goods become unusually cheap (supply boost from contraband) but danger increases. Risk-reward tradeoff: great prices if you survive the trip.

Phases: Emergence (random good supply +40, danger 0.10) → Established (supply +60, all demand +15, danger 0.15).

### Trade Route Boom

Target: Complementary system pairs (e.g. agricultural + industrial). Spread-based arc.

Two systems with complementary economies see increased traffic. Both get demand boosts for each other's exports. Implemented as an event at one system that spreads a complementary event to a connected system.

Phases: Route Discovery (food demand +20 at industrial, spread: route_boom_partner at agricultural neighbour with ore demand +20) → Peak Traffic (amplified modifiers) → Normalisation.
