# Events System

Dynamic world events that inject economic shocks, trade opportunities, and navigation danger. Events spawn randomly, progress through multi-phase arcs, apply modifiers to markets and navigation, and spread to neighboring systems.

---

## Event Types

### Primary Events (spawn naturally)

| Event | Target Economies | Phases | Duration Range | Max Active | Danger |
|---|---|---|---|---|---|
| War | Industrial, Tech, Extraction, Core | Tensions → Escalation → Active Conflict → Aftermath → Recovery | 30-60 → 20-40 → 80-150 → 50-100 → 40-80 ticks | 3 | Up to 0.15 |
| Plague | Agricultural | Outbreak → Spreading → Containment → Recovery | 20-40 → 40-80 → 30-60 → 40-60 | 2 | 0.03 |
| Trade Festival | Core | Single phase | 40-80 | 3 | None |
| Mining Boom | Extraction | Discovery → Boom → Peak → Depletion | 20-30 → 60-100 → 40-60 → 60-100 | 2 | None |
| Supply Shortage | Any | Single phase | 30-60 | 3 | None |
| Pirate Raid | Any | Raiding → Crackdown | 40-80 → 20-40 | 3 | Up to 0.15 |
| Solar Storm | Any | Storm → Clearing | 15-30 → 10-20 | 2 | 0.25 (highest) |

### Child Events (spread only, never spawn independently)

| Event | Parent | Effect |
|---|---|---|
| Conflict Spillover | War (Active phase) | Smaller war echo — fuel/machinery demand, mild danger |
| Plague Risk | Plague (Spreading phase) | Milder plague — reduced food production, medicine demand |
| Ore Glut | Mining Boom (Boom phase) | Market oversupply — ore floods neighboring systems |

---

## Event Lifecycle

### Spawning
- Every 20 ticks, a weighted random selection attempts to spawn one event
- Constraints: global cap (15 concurrent), per-system cap (2), per-type cap, economy type filter, cooldown per system
- Events spawn with severity 1.0; child events inherit and multiply parent severity

### Phase Progression
Each tick, every active event is checked:
1. If elapsed time >= phase duration: advance to next phase
2. Old phase modifiers are deleted, new phase modifiers are created
3. Phase-specific shocks (one-time market jolts) are applied
4. If no next phase exists: event expires and is deleted

Phase duration is rolled randomly from a min-max range on each transition.

### Spread
When an event transitions to a phase with spread rules:
- Each neighboring system is evaluated (filtered by region, economy type, existing event caps)
- Per-neighbor probability roll determines if a child event spawns
- Child events have their own lifecycle independent of the parent

---

## Modifiers

Events apply modifiers that alter market behavior and navigation danger.

### Economy Modifiers
| Modifier Type | Effect | Example |
|---|---|---|
| Equilibrium shift | Moves supply/demand target up or down | War: +80 fuel demand, +60 machinery demand |
| Rate multiplier | Scales production or consumption rate | War: production x0.4 (60% reduction) |
| Reversion dampening | Slows price recovery toward equilibrium | Plague: reversion x0.5 (prices stay disrupted longer) |

Modifiers are aggregated per system: shifts sum linearly, multipliers multiply together, reversion takes the most restrictive. All capped: shifts ±100, multipliers [0.1, 3.0], reversion [0.2, 1.0].

### Navigation Modifiers
Danger level modifiers increase cargo loss risk on ship arrival. Applied as equilibrium shift on `danger_level` parameter. Stacks with government danger baseline.

### Shocks
One-time market jolts applied when a phase starts. Directly modify supply or demand at the system (e.g., Plague Outbreak: -30 food supply instantly). Not repeated — only fire once per phase transition.

---

## Player Visibility

- **Notifications**: SSE broadcasts on event spawn, phase transition, expiration, and spread. Displayed as toasts and in the Activity Panel ship log.
- **Map markers**: Active events show colored borders/icons on system nodes. Color and icon vary by event type (red for war, amber for plague, green for mining, etc.).
- **Activity Panel**: Economy tab shows all active events sorted by danger priority, with phase name, system link, and ticks remaining.
- **System detail**: Events section shows active events at that system with phase and modifier details.

---

## Key Gameplay Effects

- **War** is the most impactful — halves production, spikes weapon/fuel demand, creates danger, and spreads conflict to neighbors. Long duration (200-390 ticks total).
- **Solar Storm** has the highest danger (0.25) but is short-lived. Near-total production halt makes it devastating but brief.
- **Trade Festival** is the only purely positive event — demand surge creates profitable opportunities.
- **Mining Boom** floods ore markets, benefits refineries downstream, but ends in depletion.
- **Events create trade missions** — war spawns weapons/fuel delivery contracts, plague spawns medicine/food contracts, etc.

---

## System Interactions

- **Economy**: Events apply modifiers that shift equilibrium, multiply rates, and dampen reversion (see [economy.md](./economy.md))
- **Trade missions**: Event-linked missions spawn with thematic goods and 1.5x reward bonus (see [trading.md](./trading.md))
- **Navigation**: Danger modifiers increase cargo loss on arrival (see [navigation.md](./navigation.md))
- **Tick engine**: Events processor runs every tick, before economy processor (see [tick-engine.md](./tick-engine.md))
- **Faction system** (planned): Faction wars will interact with event system — border conflicts and war events tied to faction relations (see [faction-system.md](../planned/faction-system.md))
