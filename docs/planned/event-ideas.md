# Event Ideas — Speculative Backlog

A backlog of event concepts that are designed but not yet implemented. Most still need detailed phase/modifier design (or new engine mechanics) before they can ship. For events already live, see the [Event Catalog (active)](../active/gameplay/event-catalog.md). For ideas that require new engine mechanics, see [simulation-enhancements.md](../archive/simulation-enhancements.md).

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
