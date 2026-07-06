# Event Ideas — Speculative Backlog

A backlog of event concepts that are designed but not yet implemented. Most still need detailed phase/modifier design (or new engine mechanics) before they can ship. For events already live, see the [Event Catalog (active)](../active/gameplay/event-catalog.md). Ideas that need **new engine capability** (rather than just phase/modifier design) are gathered under [Event Engine Mechanics](#event-engine-mechanics) below.

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

## Event Engine Mechanics

The ideas above are event *arcs* that fit the current engine — they need only phase/modifier design. The items below need **new engine capability** before any event can use them. Several overlap the deferred **SP4 "Events rethink — physical perturbations"** ([economy-simulation-vision.md](./economy-simulation-vision.md) §13 item 4), and their price-lever framing predates SP4's physical-perturbation direction — revisit against that when SP4 is picked up.

### Seasonal Cycles

**Priority: High.** Deterministic, time-based events that create predictable economic rhythms — spawned by the events processor on a schedule rather than random rolls. Examples: every ~500 ticks a **Harvest Festival** on agricultural systems (food/textiles production spike, consumer-goods demand spike); every ~300 ticks a **Trade Summit** at core systems (temporary spread improvement, luxuries demand spike); every ~800 ticks a **Solar Minimum** (slight galaxy-wide production reduction, fuel demand up). Predictable rhythms that interact chaotically with random events; experienced players learn the cycles and position ahead of a known demand spike. *Needs:* a time-based spawn trigger alongside random — a `spawnSchedule` field (vs `spawnChance`) the events processor checks against the tick count.

### Branching Phase Outcomes

**Priority: Medium.** Phases advance linearly today; branching lets a transition pick from multiple successor phases by roll or game state. E.g. a **Diplomatic Summit**: a weighted "success" grants cross-faction trade bonuses, a "failure" spawns an embargo phase instead. *Needs:* a phase `successors: [{ phaseId, weight, condition? }]` field; on transition the processor evaluates conditions and selects a weighted successor instead of always advancing.

### Dynamic Modifier Growth

**Priority: Medium.** Modifiers hold a fixed value within a phase; dynamic growth lets a value change each tick — growing, decaying, or oscillating. E.g. a **Speculative Bubble**: a good's demand modifier starts small and compounds (Hype → Mania → Pop → Crash); savvy players read the pattern, buy early, sell before the pop. *Needs:* a modifier `growth: { rate, curve }` (linear / exponential / decay) the processor applies each tick.

### Player-Influenced Resolution

**Priority: Medium.** Aggregate player behaviour affects phase duration or outcome. E.g. a **Monopoly Attempt**: if players flood the system with supply (detected via trade volume) the monopoly breaks early. *Needs:* the events processor (or a new analytics processor) to monitor per-system player trade data, and a phase `playerInfluence: { metric, threshold, effect }` field.

### Embargo with Smuggling

**Priority: Retired (grand-strategy pivot).** A region-level embargo restricting a good at gateway systems (standard modifiers), plus a "Smuggling" phase where player trades in the embargoed good earn a profit multiplier. Depended on the personal contraband system (navigation-changes.md, deleted) — personal player trading is retired; an embargo as a *faction-level* flow restriction may return with the diplomacy/war design.

### Technological Shifts

**Priority: Low.** Multi-system events that permanently shift equilibrium via a permanent final phase — e.g. "Synthetic Food" (food demand −20% everywhere, electronics +10%), "Fusion Power" (fuel production +50% at tech systems, base fuel price drops). The modifier stays active indefinitely, becoming a new baseline. *Needs:* support for permanent / very-long-lived phases — a `permanent: true` phase field.

### Moving Event Geography

**Priority: Low (high effort).** Events target a fixed system/region today; moving geography lets the target shift over time. E.g. a **Nebula Drift** hazard travelling through a region, applying sequential danger modifiers along its path. *Needs:* the events processor to track event positions on the spatial graph and migrate targets.

### Player-Triggered Events

**Priority: Low (high effort/risk).** An analytics processor watches aggregate player behaviour and spawns events from detected patterns — sustained military-goods inflow → "Militarisation"; a massive sell-off → "Market Crash"; a consistently-avoided system → "Decline." Creates a feedback loop where player actions shape the world; high risk of unintended feedback, so deferred until the core simulation is stable.

### Priority matrix

| Mechanic | Priority | Effort | Key dependency |
|---|---|---|---|
| Seasonal cycles | High | Low–Med | time-based spawn trigger |
| Branching phase outcomes | Medium | Medium | phase `successors` |
| Dynamic modifier growth | Medium | Medium | modifier `growth` curve |
| Player-influenced resolution | Medium | Med–High | player-activity analytics |
| Embargo with smuggling | Medium | Medium | contraband system (nav §4) |
| Technological shifts | Low | Low–Med | permanent phases |
| Moving event geography | Low | High | spatial target tracking |
| Player-triggered events | Low | High | analytics + feedback safeguards |
