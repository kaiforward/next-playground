# Mission System Design

Framework for all universe and region-level missions — tasks that players accept and complete by sending ships to systems and interacting through the existing map UI. This covers the full range from trade deliveries to military patrols to diplomatic errands.

**Existing implementation**: Trade missions (delivery contracts from market conditions and events) are live — see [trading.md](../active/trading.md) for the current `TradeMission` model, generation logic, and lifecycle. Non-faction operational missions (patrol, survey, bounty) are also live — see [combat.md](../active/combat.md) for the combat engine and battle system. This spec covers the full vision including faction-gated variants that extend those foundations.

**Out of scope**: In-system missions (story-driven, trait-flavoured content that takes place *within* a system's features — asteroid belts, planet surfaces, ruins) are a separate gameplay layer. See [in-system-gameplay.md](./in-system-gameplay.md).

---

## 1. Shared Mission Model

All universe/region-level missions share the same interaction pattern regardless of type:

1. **Generated** — by tick processors, triggered by market conditions, events, faction state, war state, or facility presence
2. **Available** — displayed at the relevant system's mission board
3. **Accepted** — player commits a ship (or convoy) to the mission
4. **In progress** — player travels to destination(s), performs required actions
5. **Completed / Failed / Expired** — outcome determined, rewards or consequences applied
6. **Abandoned** — player can drop the mission (possible reputation penalty depending on mission source)

The existing trade mission lifecycle (generated → available → accepted → delivered → expired/abandoned) is the template. New mission categories extend this with additional steps or outcome mechanics rather than replacing it.

### Common Properties

All missions share a core set of properties regardless of category:

| Property | Description |
|---|---|
| Source system | Where the mission is posted and accepted |
| Faction | Which faction issued the mission (determines reputation rewards). Null for market-generated trade missions |
| Reputation requirement | Minimum faction standing to accept (None, Neutral, Trusted, Champion) |
| Deadline | Tick-based expiry. Varies by mission type and distance |
| Reward | Credits + reputation gain with issuing faction |
| Progression tier | Early / mid / late game availability |

---

## 2. Mission Categories

### 2.1 Delivery Missions

"Bring X to Y." Player loads cargo, travels to destination, delivers. Outcome depends on having the goods and surviving the danger pipeline.

This is the existing trade mission system, extended with new generation sources.

| Subtype | Source | Description | Example |
|---|---|---|---|
| **Trade (import)** | Market conditions | Good's price exceeds 2x base — system needs supply | "Deliver 20 Medicine to Kepler Station" |
| **Trade (export)** | Market conditions | Good's price below 0.5x base — system has surplus to move | "Transport 30 Ore from Kepler to Vega Outpost" |
| **Event-linked** | Active events | Thematic goods for active events, 1.5x reward bonus | "Emergency: deliver Fuel to war-torn Arcturus" |
| **War logistics** | Active faction war | Deliver war goods (weapons, fuel, food, machinery) to contested or staging systems. Bonus rewards. Tier 1 war contribution | "Supply 15 Weapons to the Terran staging depot at Wolf 359" |
| **Smuggling** | Black market facility | Deliver contraband through dangerous/restricted space. Higher danger, higher margins | "Move 10 Chemicals to the black market at Tortuga" |
| **Courier** | Faction (any facility) | Small-cargo, time-sensitive deliveries. Low reward, good for early reputation building | "Rush delivery: 5 Electronics to the embassy at Sol" |

**Reward formula**: Extends the existing `3 CR/unit × quantity × 1.25^hops × tierMult × sourceMult` pattern. Source multiplier varies: market 1.0x, event 1.5x, war logistics 2.0x, smuggling 2.5x (risk premium), courier 0.5x (low volume, easy).

### 2.2 Operational Missions

"Go to X, spend time, effect applied." Player sends a ship to a target system. The ship is committed for a duration (locked, similar to travel). The ship's stats determine which missions it can accept, and its presence at the target system produces the effect.

**Partially implemented (Layer 1.5)**: Non-faction variants of patrol, survey, and bounty are live. These are generated from system danger levels and traits, without faction or facility requirements. See [combat.md](../active/combat.md) for the battle engine and mission generation details. The faction-gated variants described below extend this foundation in Layer 2.

| Subtype | Source | Stat gate | Duration | Effect | Status |
|---|---|---|---|---|---|
| **Patrol** | Danger level (now) / Naval base (Layer 2) | Firepower ≥ 5 | 15–25 ticks | Reduces danger modifier at target system. Higher danger = higher reward | **Live** (non-faction) |
| **Bounty** | Danger level (now) / Naval base (Layer 2) | Firepower ≥ 4, Hull ≥ 30 | Battle-driven | Tick-based combat vs pirate encounters. Enemy tier (weak/moderate/strong) scales with danger | **Live** (non-faction) |
| **Survey** | System traits (now) / Research station (Layer 2) | Sensors ≥ 6 | 10–15 ticks | Scouts systems with eligible traits (precursor ruins, anomalies, etc.) | **Live** (non-faction) |
| **Intelligence** | Intelligence outpost | Stealth, sensors | Medium (10–20 ticks) | Gathers data on rival faction systems. Detection risk based on stealth vs system security | Planned (Layer 2) |
| **Diplomacy** | Embassy | None (ship is transport) | Short (5–10 ticks) | Ferries envoys between faction systems. Generates positive inter-faction relation drift | Planned (Layer 2) |

**Interaction model**: Same as delivery missions from the player's perspective — accept at a mission board, assign a ship, wait for resolution. The difference is that the outcome comes from the ship's presence and stats rather than cargo delivery.

**Stat gating**: Ship stats set a minimum threshold for acceptance, not a success roll. A ship below the firepower threshold can't take a patrol mission. Above the threshold, better stats improve the effect magnitude (more danger reduction, less detection risk) but don't determine pass/fail.

**Duration**: Operational missions take longer than deliveries. The ship is committed and unavailable for the mission duration, making ship allocation a strategic decision — assigning your best combat ship to a patrol means it's not available for trade runs.

**Bounty combat**: Bounty missions trigger a tick-based battle when the ship arrives at the target system. Battles resolve in rounds (every 6 ticks) with simultaneous damage, morale tracking, and variance. See [combat.md](../active/combat.md) for full engine details.

**Wartime escalation**: Escort and sabotage are wartime activities that belong to the war contribution system (see [war-system.md §8](./war-system.md)). Patrol and intelligence missions may gain wartime variants with higher stakes and rewards, but the mechanics for that integration are designed with the war system, not here.

---

## 3. Mission Sources

What generates missions and where they appear. This ties together all the facility, faction, and event references across the planned docs.

| Source | Mission types generated | Trigger | Reference |
|---|---|---|---|
| **Market conditions** | Trade (import/export) | Price thresholds (existing) | [trading.md](../active/trading.md) |
| **Active events** | Event-linked deliveries | Event with themed goods (existing) | [trading.md](../active/trading.md) |
| **Active faction war** | War logistics deliveries, war contributions (escort, sabotage, intelligence — see [war-system.md §8](./war-system.md)) | War status + contested systems | [war-system.md](./war-system.md) |
| **Naval base** | Patrol | Facility presence + faction state | [system-enrichment.md](./system-enrichment.md) §5 |
| **Intelligence outpost** | Intelligence | Facility presence + faction state | [system-enrichment.md](./system-enrichment.md) §5 |
| **Embassy** | Diplomacy | Facility presence + inter-faction relations | [system-enrichment.md](./system-enrichment.md) §5 |
| **Black market** | Smuggling | Facility presence | [system-enrichment.md](./system-enrichment.md) §5 |
| **Research station** | Survey, data trading | Facility presence | [system-enrichment.md](./system-enrichment.md) §5 |
| **Planetary administration** | Courier, faction reputation | Facility presence + faction state | [system-enrichment.md](./system-enrichment.md) §5 |
| **Trade exchange** | Trade missions (boosted generation) | Facility presence | [system-enrichment.md](./system-enrichment.md) §5 |

---

## 4. Reputation Gating

Mission availability scales with faction reputation, creating a natural progression through mission types. This aligns with the reputation tiers in [faction-system.md](./faction-system.md) §3 and [player-progression.md](./player-progression.md) §7.

| Standing | Available missions |
|---|---|
| **Neutral** (0 to +24) | Trade missions (market-generated), event-linked missions, courier missions, basic patrol |
| **Trusted** (+25 to +74) | All neutral missions + faction-specific deliveries, war logistics (Tier 1), intelligence, survey, diplomacy, smuggling (at black markets) |
| **Champion** (+75 to +100) | All trusted missions + Tier 2 & 3 war contributions (see [war-system.md §8](./war-system.md)), exclusive high-reward variants |

Missions from enemy factions (reputation below -25) are unavailable — they won't offer you work. Trade missions generated by market conditions have no faction gate — anyone can trade.

---

## 5. Reward Structure

All missions pay credits. Faction-sourced missions also pay reputation. War missions additionally track war contribution for end-of-war rewards.

| Category | Credit reward | Reputation reward | Additional |
|---|---|---|---|
| **Trade (market)** | Reward formula + goods sale value | None (no faction source) | — |
| **Trade (event)** | 1.5x reward formula + goods sale value | None | — |
| **Courier** | Low fixed reward | Small faction reputation gain | Good for early-game rep building |
| **War logistics** | 2.0x reward formula + goods sale value | Moderate faction reputation gain | War contribution tracked |
| **Smuggling** | 2.5x reward formula + goods sale value | Small faction reputation gain (with issuing faction) | Risk of contraband inspection |
| **Patrol** | Fixed reward scaled by danger level | Moderate faction reputation gain | Ship committed for duration. Effect scales with ship stats |
| **Intelligence** | Fixed reward | Good faction reputation gain | Detection risk. Wartime variant feeds into war battle modifiers |
| **Diplomacy** | Low fixed reward | Moderate reputation with both factions involved | Generates inter-faction relation drift |
| **Survey** | Fixed reward + data value | Small faction reputation gain | Exploration/discovery feed |

---

## 6. Implementation Notes

- **Mission model**: Operational missions use a separate `Mission` model (distinct from `TradeMission`). Fields include type, stat requirements (JSON), enemy tier (bounty), duration (patrol/survey), and standard lifecycle state. Trade missions remain on the existing `TradeMission` model. A future migration may unify them.
- **Battle model**: Bounty combat uses a `Battle` model tracking player/enemy strength, morale, round history, and resolution state. Battles resolve via a dedicated `battles` tick processor (frequency 1, depends on ship-arrivals).
- **Tick processors**: Two new processors — `missions` (frequency 5, depends on events + economy) generates/expires/completes operational missions; `battles` (frequency 1, depends on ship-arrivals) resolves combat rounds.
- **UI**: The Contracts tab has sub-tabs — "Delivery" for trade missions and "Operations" for patrol/survey/bounty. Operations panel shows stat requirements, enemy tiers, ship eligibility. Battle viewer shows live strength bars, morale, and round history on the ship detail page.
- **War integration**: The boundary between peacetime operational missions and wartime contributions ([war-system.md §8](./war-system.md)) is an implementation design point. The simplest approach: wartime disables peacetime patrol/intelligence generation at affected systems and replaces them with war contribution variants sourced from the war system. The existing combat engine (`lib/engine/combat.ts`) is designed to extend to fleet battles and faction wars.

---

## Related Design Docs

- **[Trading (active)](../active/trading.md)** — existing trade mission implementation (TradeMission model, lifecycle, reward formula)
- **[War System](./war-system.md)** — war logistics, sabotage, intelligence as war contributions
- **[System Enrichment](./system-enrichment.md)** — facilities that generate missions (naval base, embassy, black market, etc.)
- **[Faction System](./faction-system.md)** — reputation gating, faction association
- **[Player Progression](./player-progression.md)** — mission availability by game phase
- **[In-System Gameplay](./in-system-gameplay.md)** — separate system for trait-driven, story-driven missions within systems
