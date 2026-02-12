# Simulation Enhancements — Future Mechanics

Ideas that require new engine capabilities — new processor logic, new phase behaviors, or new system interactions. Each section describes the mechanic and why it can't be done with the current event definition system alone.

For event definitions that work with the existing system (no code changes), see [event-catalog.md](./event-catalog.md).

## Event System Enhancements

### Branching Phase Outcomes

Currently phases advance linearly: Phase 1 → Phase 2 → ... → Phase N. Branching would allow a phase transition to choose between multiple next phases based on a roll or game state.

Use case: **Diplomatic Summit** — two regions negotiate a trade pact. If the summit "succeeds" (random roll), a follow-up event grants cross-region trade bonuses. If it "fails," an embargo event spawns instead. The same event arc leads to fundamentally different outcomes.

Requires: Phase transition logic that evaluates conditions and selects from multiple successor phases.

### Dynamic Modifier Growth

Modifiers currently have a fixed value for the duration of a phase. Dynamic growth would allow a modifier's value to change each tick within a phase — growing, decaying, or oscillating.

Use case: **Speculative Bubbles** — a good's demand modifier starts small and compounds each events processor run. Phase 1 ("Hype"): demand grows slowly. Phase 2 ("Mania"): demand accelerates. Phase 3 ("Pop"): demand reverses to large negative. Phase 4 ("Crash"): slow recovery. The growing modifier is managed by the events processor updating the modifier value each tick.

Player interaction: savvy players recognise the bubble pattern, buy early, sell before the pop. Late buyers get burned.

Requires: Events processor logic to update modifier values within a phase, not just at transitions.

### Moving Event Geography

Events currently target a fixed system or region for their entire lifecycle. Moving geography would let an event's target shift over time — affecting different systems on different ticks.

Use case: **Nebula Drift** — a navigational hazard moves through a region over many ticks. Systems along the path get sequential danger modifiers. The hazard "travels" through connected systems, creating a wave of disruption.

Requires: Events processor logic to migrate an event's target system at phase transitions or on a per-tick schedule.

### Player-Influenced Resolution

Events currently resolve on a fixed timer. Player influence would let aggregate player behavior affect phase duration or outcome — shortening, extending, or branching phases based on trade volume or presence.

Use case: **Monopoly Attempt** — an NPC faction tries to corner a good's market. Demand spikes artificially, prices soar. If players flood the system with supply (detected via trade volume), the monopoly "breaks" early. If unchecked, the good stays expensive for the full duration.

Requires: Events processor or a new analytics processor that monitors player trade data and adjusts event state accordingly.

### Embargo with Smuggling Mechanics

A region-level embargo that restricts a specific good at gateway systems. The core embargo phase uses standard modifiers (supply reduction, danger). But the interesting phase — "Smuggling" — needs trade-time logic to detect embargoed goods and apply profit multipliers.

Phases: Imposed (supply target -40 at gateways, danger 0.05) → Smuggling (reduced modifiers, but player trades in embargoed goods yield 2x profit).

Requires: Trade service enhancement to check active embargo modifiers and apply profit multipliers at trade time.

## Economy Processor Enhancements

### Seasonal Cycles

Events with deterministic spawn timing instead of random rolls. The events processor checks time-based triggers:
- Every ~500 ticks: spawn "harvest_festival" on agricultural systems
- Every ~300 ticks: spawn "trade_summit" at core systems
- Every ~800 ticks: spawn "solar_minimum" reducing all production slightly

Predictable rhythms that interact chaotically with random events. A plague during harvest season is devastating. A war during trade summit disrupts diplomatic goods.

Requires: New spawn trigger type in events processor (time-based alongside random).

### Supply Chain Dependencies

Production recipes: certain goods require input goods to produce.

```typescript
PRODUCTION_RECIPES: {
  ship_parts: { inputs: ["ore", "electronics"], efficiency: 0.8 },
  electronics: { inputs: ["ore"], efficiency: 0.9 },
  luxuries: { inputs: ["electronics", "food"], efficiency: 0.7 },
}
```

The economy processor checks input good availability. If ore supply at an industrial system drops below a threshold, ship_parts production rate decreases automatically. Cascading effects emerge naturally: war disrupts mining → ore scarce → ship_parts production drops → military systems can't rebuild.

This is an enhancement to the economy processor, not a separate system. It reads the same market data and applies an additional production multiplier based on input availability.

Requires: Economy processor enhancement to evaluate input availability and apply production penalties.

### Technological Shifts

Multi-region events where a new technology permanently changes equilibrium:
- "Synthetic Food" — food demand -20% everywhere, electronics demand +10% everywhere
- "Fusion Power" — fuel production +50% at tech systems, fuel base price drops

These are events with a very long or permanent final phase. The modifier stays active indefinitely, effectively becoming a new baseline. The world genuinely evolves over time.

Requires: Support for permanent or very-long-lived event phases (current system assumes all events eventually expire).

## New Processors

### Player-Triggered Events

An analytics processor monitors aggregate player behaviour:
- High trade volume of ship_parts into System X → "Militarisation" event
- Massive sell-off of a good at a system → "Market Crash" event
- Players consistently avoiding a system → "Decline" event with slowly worsening economy

Creates a feedback loop where player actions shape the world, which creates new opportunities. The triggers just create regular events through the standard pipeline.

Requires: New analytics processor that reads trade history and spawns events based on detected patterns.

### NPC Trade Pressure

Statistical trade flows (not individual agents) that create intra-region arbitrage. Modelled as a modifier source: the NPC trade processor reads price gradients and creates small equilibrium shift modifiers that push prices toward regional averages. This smooths price extremes without eliminating player profit margins.

Important: this should only be implemented AFTER the event system provides disruption. Without disruption, NPC trade accelerates price flattening, making the predictability problem worse.

Requires: New NPC trade processor that reads market data and creates modifiers.
