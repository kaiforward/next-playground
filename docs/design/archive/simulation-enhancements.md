# Simulation Enhancements

Enhancements to the economy and event engines that add depth to the simulation. Each section describes a mechanic that requires new engine capabilities — new processor logic, new phase behaviors, or new system interactions.

For event definitions that work with the existing system (no code changes), see [event-catalog.md](../active/event-catalog.md).

**Depends on**: [Economy](../active/economy.md) (market simulation), [Events](../active/events.md) (event system), [Production](./production.md) (supply chains, goods roster)

---

## Priority Matrix

Enhancements are ordered by gameplay impact relative to implementation effort. Higher-priority items should ship first.

| Priority | Enhancement | Impact | Effort | Dependencies |
|---|---|---|---|---|
| **High** | Supply chain dependencies | Cascading disruption, strategic depth | Medium | Production roster (26 goods, chain definitions) |
| **High** | NPC trade pressure | Smooths price extremes, creates realistic inter-system flows | Medium | Event system (needs disruption first) |
| **High** | Seasonal cycles | Predictable rhythms, emergent interactions with random events | Low | Events processor (new trigger type) |
| **Medium** | Branching phase outcomes | Richer event narratives, replayability | Medium | Events processor (phase transition logic) |
| **Medium** | Dynamic modifier growth | Bubble/crash patterns, player skill expression | Medium | Events processor (per-tick modifier updates) |
| **Medium** | Player-influenced resolution | Player agency over world events | Medium–High | Analytics processor (new) |
| **Low** | Embargo with smuggling | Niche mechanic, depends on contraband system | Low | Navigation changes §4 (contraband) |
| **Low** | Technological shifts | Long-term world evolution | Low | Permanent event phase support |
| **Low** | Moving event geography | Flavourful but complex spatial logic | High | Events processor (target migration) |
| **Deferred** | Player-triggered events | Feedback loop, emergent storytelling | High | Analytics processor (new), tuning-heavy |

---

## 1. Economy Processor Enhancements

### 1.1 Supply Chain Dependencies

**Priority: High**

The NPC economy currently treats each good independently — production and consumption rates are flat values per economy type. Supply chain dependencies make the economy reactive: if input goods are scarce, output production drops. Cascading effects emerge naturally.

The production system (see [Production Roster §6](./production-roster.md)) defines 26 goods with explicit input chains:

```
Ore → Metals → Alloys → Hull Plating → Ship Frames
Gas → Chemicals → Munitions → Weapons Systems
Minerals + Metals → Components → Electronics → Luxuries
```

**Mechanic**: The economy processor evaluates input availability for each good that has production inputs. If an input good's supply at a system falls below a threshold, the output good's NPC production rate is reduced proportionally. This creates cascading effects:

- War disrupts an Extraction system → Ore supply drops
- Refinery systems receiving less Ore → Metals production drops
- Industrial systems receiving less Metals → Components and Munitions production drops
- Military systems can't rebuild fleet → war effort weakened

**Implementation**: Enhancement to the existing economy processor. Each tick, before computing production output, check input good supply levels. Apply a production multiplier: `min(1.0, input_supply / input_threshold)` for each required input. Multiple inputs use the lowest multiplier (bottleneck determines throughput).

**Tuning**: Input thresholds per good, per economy type. The threshold should be set so that normal supply levels yield a 1.0 multiplier (no penalty). Only disruption (events, wars, player activity) should push supply below threshold.

### 1.2 NPC Trade Pressure

**Priority: High**

Statistical trade flows that create inter-system price convergence within a region. Not individual NPC agents — a modifier source that reads price gradients and nudges prices toward regional averages.

**Mechanic**: The NPC trade processor runs after the economy processor. For each good at each system, it compares the local price to the regional average. If the local price is significantly above average, a small supply modifier is applied (simulating NPC traders bringing goods in). If significantly below, a small demand modifier is applied (simulating NPC traders buying cheap goods).

**Effect**: Smooths extreme price differentials without eliminating player profit margins. A system with a 3x price spike gets nudged toward 2.5x over several ticks, not snapped to 1.0x. Players still profit from price gaps — NPC pressure just prevents infinite equilibrium divergence.

**Constraint**: Must ship AFTER the event system provides disruption. Without disruption creating price spikes, NPC trade pressure would flatten prices toward a boring equilibrium. The two systems create a dynamic tension: events push prices apart, NPC pressure pulls them back together, and players profit in the gap.

**Implementation**: New tick processor. Runs at a slow cadence (every 5–10 ticks). Reads market data, computes regional averages, applies small equilibrium shift modifiers. Modifier strength is a tuning number — too strong flattens prices, too weak has no effect.

### 1.3 Seasonal Cycles

**Priority: High**

Deterministic, time-based events that create predictable economic rhythms. Spawned by the events processor on a schedule rather than random rolls.

**Examples**:
- Every ~500 ticks: **Harvest Festival** on agricultural systems — food/textiles production spike, consumer goods demand spike
- Every ~300 ticks: **Trade Summit** at core systems — temporary trade spread improvement, luxuries demand spike
- Every ~800 ticks: **Solar Minimum** — slight production reduction across all systems, fuel demand increase

**Gameplay value**: Predictable rhythms that interact chaotically with random events. A plague during harvest season is devastating. A war during trade summit disrupts diplomatic goods. Experienced players learn the cycles and position accordingly — stockpiling before a known demand spike.

**Implementation**: New spawn trigger type in events processor (time-based alongside random). Events defined in the event catalog with a `spawnSchedule` field instead of `spawnChance`. The events processor checks tick count against schedules each run.

---

## 2. Event System Enhancements

### 2.1 Branching Phase Outcomes

**Priority: Medium**

Phases currently advance linearly: Phase 1 → Phase 2 → ... → Phase N. Branching allows a phase transition to select from multiple successor phases based on a roll or game state.

**Use case**: **Diplomatic Summit** — two factions negotiate a trade pact. If the summit "succeeds" (weighted roll), a follow-up phase grants cross-faction trade bonuses. If it "fails," an embargo phase spawns instead. The same event arc leads to fundamentally different outcomes, increasing replayability.

**Implementation**: New phase field `successors: Array<{ phaseId, weight, condition? }>`. At phase transition, the events processor evaluates conditions and selects from weighted successors instead of always advancing to the next phase.

### 2.2 Dynamic Modifier Growth

**Priority: Medium**

Modifiers currently have a fixed value for the duration of a phase. Dynamic growth allows a modifier's value to change each tick within a phase — growing, decaying, or oscillating.

**Use case**: **Speculative Bubble** — a good's demand modifier starts small and compounds each events processor run. Phase 1 ("Hype"): demand grows slowly. Phase 2 ("Mania"): demand accelerates. Phase 3 ("Pop"): demand reverses to large negative. Phase 4 ("Crash"): slow recovery.

**Player interaction**: Savvy players recognise the bubble pattern, buy early, sell before the pop. Late buyers get burned. Creates a skill-expression window where market knowledge pays off.

**Implementation**: New modifier field `growth: { rate, curve }` where `curve` is linear, exponential, or decay. Events processor updates modifier values each tick based on the growth function.

### 2.3 Player-Influenced Resolution

**Priority: Medium**

Aggregate player behavior affects phase duration or outcome — shortening, extending, or branching phases based on trade volume or player presence.

**Use case**: **Monopoly Attempt** — an NPC faction tries to corner a good's market. Demand spikes artificially, prices soar. If players flood the system with supply (detected via trade volume), the monopoly "breaks" early. If unchecked, the good stays expensive for the full duration.

**Implementation**: Events processor or a new analytics processor monitors player trade data per system and adjusts event state. New phase field `playerInfluence: { metric, threshold, effect }` where `metric` is trade volume, player count, or good supply level. When the threshold is met, the phase transitions early or branches to an alternate outcome.

---

## 3. Lower Priority Enhancements

### 3.1 Embargo with Smuggling Mechanics

Region-level embargo restricting a specific good at gateway systems. The embargo phase uses standard modifiers (supply reduction, danger). The interesting addition: a "Smuggling" phase where player trades in embargoed goods yield profit multipliers.

Depends on contraband system from [Navigation Changes §4](./navigation-changes.md). Relatively low effort once contraband is implemented — the trade service needs to check active embargo modifiers and apply profit multipliers at trade time.

### 3.2 Technological Shifts

Multi-system events where a new technology permanently changes equilibrium:
- "Synthetic Food" — food demand -20% everywhere, electronics demand +10% everywhere
- "Fusion Power" — fuel production +50% at tech systems, fuel base price drops

These are events with a permanent final phase. The modifier stays active indefinitely, becoming a new baseline. The world genuinely evolves over time.

Requires: Support for permanent or very-long-lived event phases (current system assumes all events eventually expire). New event phase field `permanent: true` that prevents expiration.

### 3.3 Moving Event Geography

Events currently target a fixed system or region. Moving geography lets an event's target shift over time — affecting different systems on different ticks.

**Use case**: **Nebula Drift** — a navigational hazard moves through a region. Systems along the path get sequential danger modifiers. The hazard "travels" through connected systems, creating a wave of disruption.

High implementation effort — requires the events processor to track event positions on the spatial graph and migrate targets. Flavourful but not critical for core gameplay.

### 3.4 Player-Triggered Events

An analytics processor monitors aggregate player behaviour and spawns events based on detected patterns:
- Sustained high trade volume of military goods into a system → "Militarisation" event
- Massive sell-off of a good at a system → "Market Crash" event
- Players consistently avoiding a system → "Decline" event with slowly worsening economy

Creates a feedback loop where player actions shape the world. High implementation effort (new processor, pattern detection, threshold tuning) and high risk of unintended feedback loops. Deferred until the core simulation is stable and well-understood.

---

## Related Design Docs

- **[Economy](../active/economy.md)** — market simulation that these enhancements modify
- **[Events](../active/events.md)** — event system that branching/growth/influence extend
- **[Event Catalog](../active/event-catalog.md)** — event definitions (no-code-change additions)
- **[Production](./production.md)** — supply chain architecture that dependencies model
- **[Production Roster](./production-roster.md)** — 26 goods with explicit input chains
- **[Navigation Changes](./navigation-changes.md)** — contraband system (embargo dependency)
