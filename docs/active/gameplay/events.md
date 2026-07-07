# Events System

Dynamic world events that inject economic shocks and trade opportunities. Events spawn randomly, progress through multi-phase arcs, apply modifiers to markets, and spread to neighboring systems.

---

## Event Types

### Primary Events (spawn naturally)

| Event | Target Economies | Phases | Duration Range | Max Active |
|---|---|---|---|---|
| War | Industrial, Tech, Extraction, Core | Tensions → Escalation → Active Conflict → Aftermath → Recovery | 30-60 → 20-40 → 80-150 → 50-100 → 40-80 ticks | 3 |
| Plague | Agricultural | Outbreak → Spreading → Containment → Recovery | 20-40 → 40-80 → 30-60 → 40-60 | 2 |
| Trade Festival | Core | Single phase | 40-80 | 3 |
| Mining Boom | Extraction | Discovery → Boom → Peak → Depletion | 20-30 → 60-100 → 40-60 → 60-100 | 2 |
| Supply Shortage | Any | Single phase | 30-60 | 3 |
| Pirate Raid | Any | Raiding → Crackdown | 40-80 → 20-40 | 3 |
| Solar Storm | Any | Storm → Clearing | 15-30 → 10-20 | 2 |
| Refugee Crisis | Core, Agricultural | Influx → Overcrowding → Settlement | 20-40 → 40-80 → 30-60 | 25 |
| Trade Embargo | Core, Industrial | Imposed → Enforcement → Easing | 20-40 → 40-80 → 30-60 | 15 |
| Tech Breakthrough | Tech | Discovery → Innovation → Adoption | 15-30 → 40-80 → 30-60 | 15 |
| Asteroid Strike | Extraction | Impact → Aftermath → Recovery | 10-20 → 40-80 → 30-60 | 15 |

### Child Events (spread only, never spawn independently)

| Event | Parent | Effect |
|---|---|---|
| Conflict Spillover | War (Active phase) | Smaller war echo — fuel/machinery demand |
| Plague Risk | Plague (Spreading phase), Refugee Crisis (Overcrowding phase) | Milder plague — reduced food production, medicine demand |
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

Events apply modifiers that alter market behavior.

### Economy Modifiers
| Modifier Type | Effect | Example |
|---|---|---|
| Anchor shift | Multiplies a good's pricing anchor (`targetStock`) for the event's duration. `>1` raises the anchor → higher prices (surfaces in UI as "demand up"); `<1` lowers it → cheaper ("demand down"). `goodId: null` applies to all goods. Multiple anchor shifts on the same good compound (multiply). | War active conflict: fuel x2.5, machinery x2.0 |
| Rate multiplier | Scales production or consumption rate | War: production x0.4 (60% reduction) |

The anchor for each good is stored as `WorldMarket.anchorMult` (default `1`). The economy processor recomputes it every tick from the system's active anchor-shift modifiers (same writer/cadence as `stock`) and writes it alongside stock. Reads are pure: price, trade limits, and trade-flow calculations all derive `targetStock = getTargetStock(good) × anchorMult`. Modifiers are aggregated per system: anchor shifts multiply together, rate multipliers multiply together. Caps: anchor multiplier [0.1, 4.0], rate multiplier [0.1, 3.0].

### Shocks
One-time market jolts applied when a phase starts. Directly modify supply or demand at the system (e.g., Plague Outbreak: -30 food supply instantly). Not repeated — only fire once per phase transition.

---

## Event Surfaces

- **Notifications**: SSE broadcasts on event spawn, phase transition, expiration, and spread. Displayed as toasts and in the Activity Panel ship log.
- **Map markers**: Active events show colored borders/icons on system nodes. Color and icon vary by event type (red for war, amber for plague, green for mining, etc.).
- **Activity Panel**: Economy tab shows all active events sorted by danger priority, with phase name, system link, and ticks remaining.
- **System detail**: Events section shows active events at that system with phase and modifier details.

---

## Key Gameplay Effects

- **War** is the most impactful — halves production, spikes weapon/fuel demand, and spreads conflict to neighbors. Long duration (200-390 ticks total).
- **Solar Storm** is short-lived but devastating — near-total production halt.
- **Trade Festival** is the only purely positive event — demand surge creates profitable opportunities.
- **Mining Boom** floods ore markets, benefits refineries downstream, but ends in depletion.
- **Refugee Crisis** strains food and medicine supplies at core/agricultural systems, with overcrowding spreading plague risk to neighbors.
- **Trade Embargo** creates severe supply shortages at core/industrial systems — all production and supply suppressed, with slow easing.
- **Tech Breakthrough** is a positive event for tech systems — electronics production surges, machinery demand rises.
- **Asteroid Strike** devastates extraction systems — near-total production halt on impact (0.05x) and ore/fuel supply shocks.

---

## System Interactions

- **Economy**: Events apply modifiers that shift the pricing anchor (`anchor_shift`) and multiply production/consumption rates (`rate_multiplier`); shocks deliver one-time stock jolts (see [economy.md](./economy.md))
- **Tick engine**: Events processor runs every tick, before economy processor (see [tick-engine.md](../engineering/tick-engine.md))
- **Faction relations**: the relations processor spawns border-conflict, pact-negotiation, and alliance-dissolution events (see [faction-system.md](./faction-system.md)); full faction wars are planned (see [war-system.md](../../planned/war-system.md))
