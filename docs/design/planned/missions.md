# Mission System Design

Framework for all universe and region-level missions — tasks that players accept and complete by sending ships to systems and interacting through the existing map UI. This covers the full range from trade deliveries to military patrols to diplomatic errands.

**Existing implementation**: Trade missions (delivery contracts from market conditions and events) are live — see [trading.md](../active/trading.md) for the current `TradeMission` model, generation logic, and lifecycle. This spec extends that foundation.

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

"Go to X, spend time, succeed or fail." Player sends a ship to a target system. The ship is committed for a duration (locked, similar to travel). Outcome is determined by ship stats, system danger, and context — not by cargo.

These are new and require design work for the outcome mechanics. The interaction model is the same as delivery missions from the player's perspective: accept at a mission board, send a ship, wait for resolution.

| Subtype | Source | Ship stats that matter | Description |
|---|---|---|---|
| **Patrol** | Naval base | Firepower, hull, speed | Patrol border systems to reduce danger. Outcome based on combat capability vs system danger level |
| **Escort** | Naval base, war state | Firepower, hull | Protect NPC trade convoys through dangerous space. Similar to player convoy escort but as a mission |
| **Intelligence** | Intelligence outpost | Stealth, sensors, evasion | Gather information at nearby enemy systems. Stealth determines detection risk. Feeds into war battle modifiers |
| **Diplomacy** | Embassy | None (ship is transport) | Ferry diplomatic envoys between faction systems. Generates positive relation drift. Low risk, reputation-focused |
| **Sabotage** | Intelligence outpost, war state | Stealth, evasion | Disrupt enemy infrastructure. High risk — detection means large reputation penalty with target faction. Tier 3 war contribution |
| **Survey** | Research station | Sensors, speed | Survey systems for data. Feeds into exploration/discovery mechanics. Scout ships excel |

**Outcome mechanics**: Needs further discussion. The general pattern is:
- Ship travels to target system and is locked for a mission duration (N ticks)
- On completion, a weighted roll determines success/failure based on relevant ship stats vs difficulty
- Success: reward paid, mission effect applied (danger reduced, intelligence gained, etc.)
- Failure: reduced or no reward, possible ship damage, possible reputation consequences
- Some missions have detection risk (intelligence, sabotage) — failure means the enemy faction knows

**Duration**: Operational missions take longer than deliveries. The ship is committed and unavailable for the mission duration, making ship allocation a strategic decision.

---

## 3. Mission Sources

What generates missions and where they appear. This ties together all the facility, faction, and event references across the planned docs.

| Source | Mission types generated | Trigger | Reference |
|---|---|---|---|
| **Market conditions** | Trade (import/export) | Price thresholds (existing) | [trading.md](../active/trading.md) |
| **Active events** | Event-linked deliveries | Event with themed goods (existing) | [trading.md](../active/trading.md) |
| **Active faction war** | War logistics, escort, sabotage, intelligence | War status + contested systems | [war-system.md](./war-system.md) §6 |
| **Naval base** | Patrol, escort, military logistics | Facility presence + faction state | [system-enrichment.md](./system-enrichment.md) §5 |
| **Intelligence outpost** | Intelligence, sabotage | Facility presence + war/tension state | [system-enrichment.md](./system-enrichment.md) §5 |
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
| **Trusted** (+25 to +74) | All neutral missions + faction-specific deliveries, war logistics (Tier 1), escort, survey, diplomacy, smuggling (at black markets) |
| **Champion** (+75 to +100) | All trusted missions + intelligence, sabotage (Tier 2 & 3 war contributions), exclusive high-reward variants |

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
| **Patrol / Escort** | Fixed reward scaled by danger level | Moderate faction reputation gain | Ship may take damage |
| **Intelligence** | Fixed reward | Good faction reputation gain | War contribution tracked. Detection risk |
| **Sabotage** | Large fixed reward | Large faction reputation gain | War contribution tracked. Guaranteed enemy reputation loss |
| **Diplomacy** | Low fixed reward | Moderate reputation with both factions involved | Generates inter-faction relation drift |
| **Survey** | Fixed reward + data value | Small faction reputation gain | Exploration/discovery feed |

---

## 6. Implementation Notes

- **Model design is TBD**: Whether delivery and operational missions share one DB model or use separate models is an implementation decision. The existing `TradeMission` model covers delivery missions well. Operational missions may need additional fields (committed ship, duration, outcome roll, stat requirements).
- **Tick processor**: Mission generation likely extends the existing `trade-missions` processor or adds a parallel `faction-missions` processor. Frequency and dependency order TBD.
- **UI**: All universe/region-level missions appear on the system's mission board (existing UI pattern). Operational missions need a way to show required ship stats and estimated success chance.

---

## Related Design Docs

- **[Trading (active)](../active/trading.md)** — existing trade mission implementation (TradeMission model, lifecycle, reward formula)
- **[War System](./war-system.md)** — war logistics, sabotage, intelligence as war contributions
- **[System Enrichment](./system-enrichment.md)** — facilities that generate missions (naval base, embassy, black market, etc.)
- **[Faction System](./faction-system.md)** — reputation gating, faction association
- **[Player Progression](./player-progression.md)** — mission availability by game phase
- **[In-System Gameplay](./in-system-gameplay.md)** — separate system for trait-driven, story-driven missions within systems
