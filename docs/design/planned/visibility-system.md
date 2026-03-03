# Visibility & Intel System Design

How players discover and lose information about the universe. The fog of war layer that makes exploration meaningful, intel valuable, and factions strategically relevant.

**Status**: Designed — ready for phased implementation.

**Depends on**: [Scalable Data Loading](./scalable-data-loading.md) (tile architecture), [Faction System](./faction-system.md) (allied faction visibility, phase 2+), [Navigation](../active/navigation.md) (ship positions and roles for sensor range)

**Inspired by**: X4: Foundations (hardware-invested visibility with price staleness), Stellaris (multi-source intel with progressive reveal), EVE Online (presence-based binary visibility, no server-side snapshots)

---

## 1. Core Principle: See the Stars, Not the Story

The galaxy's topology is public knowledge — every player can see every star, connection, and region boundary. What's hidden is the dynamic state: prices, events, ship activity, danger levels. You know the stars are there. You don't know what's happening at them unless you have eyes nearby.

This creates two distinct map experiences:

| Zoom level | Purpose | Data shown | Visibility required? |
|---|---|---|---|
| Strategic (zoomed out) | Tactical overview | Star positions, connections, regions, faction territories | No — always visible |
| Tactical (zoomed in) | Local operations | System names, economy badges, event icons, ship markers, danger | Yes — requires active visibility |

A player zooming into a region where they have no presence sees dots. No names, no events, no economic data. Dark space.

**Exception — static identity data**: System names and economy types are treated as "star chart" data — publicly known, not gated by visibility. They live in static tiles (see [Scalable Data Loading §2](./scalable-data-loading.md)) and are cacheable forever. The visibility system only gates *dynamic* data: events, ship presence, danger, prices.

---

## 2. Visibility Model (v1 — Binary)

v1 is binary: a system is either **visible** (live data) or **unknown** (no dynamic data). No stale/snapshot state. This keeps the implementation simple while delivering the core gameplay value — information scarcity.

### 2.1 Visibility Sources (v1)

| Source | Range | Refresh rate | Notes |
|---|---|---|---|
| **Own ships** | N hops from ship's current system | Every request (computed from current ship positions) | Primary source. Range varies by ship role (§2.2) |

v1 ships with only ship-based visibility. Future sources are designed but deferred:

| Source (future) | Range | Phase | Notes |
|---|---|---|---|
| Allied factions | Systems owned by factions where player has Friendly+ standing | Phase 2 | Depends on faction system |
| Purchased intel | Specific region or system, time-limited | Phase 3 | Bought from stations or other players |
| Mission reveals | Systems relevant to the active mission | Phase 3 | Expires when mission ends |

### 2.2 Sensor Range (Ship Visibility Radius)

Each ship illuminates systems within N hops of its current position. Hops = graph distance along connections, not Euclidean distance.

Base sensor range by ship role:

| Ship role | Base range (hops) | Rationale |
|---|---|---|
| Scout | 3 | Purpose-built for reconnaissance |
| Support | 2 | Logistics awareness |
| Trade | 2 | Traders need to see nearby market conditions |
| Combat | 1 | Focused on immediate surroundings |
| Stealth | 1 | Low emissions = low sensor output |

**Convoy visibility**: A convoy's visibility is the union of all member ships' ranges. A trade convoy with a scout escort sees further than a lone freighter.

**Future — sensor upgrades**: Ship sensor modules (via upgrade slots) could extend base range by +1 or +2 hops. A fully upgraded scout becomes a dedicated intelligence asset with 4-5 hop range. Deferred to ship upgrade implementation.

### 2.3 Visibility Computation

Visibility is computed **on-demand per API request**, not stored or precomputed per tick. This avoids a visibility tick processor and a `PlayerVisibility` table entirely for v1.

When a player requests a dynamic tile:
1. Load player's ship positions (already available from fleet data)
2. For each ship, BFS outward N hops on the atlas graph (in-memory, loaded at app startup)
3. Union all results → player's visibility set for this request
4. Filter tile response: only return dynamic data for systems in the visibility set

**Performance**: At 10K systems with ~4 connections per system, BFS to depth 3 from one ship visits ~60 systems. A player with 12 ships visits ~720 systems worst case (significant overlap expected). The atlas graph is already in memory for pathfinding. This computation is microseconds, not milliseconds.

**Caching the visibility set**: Within a single request cycle, the visibility set can be computed once and reused across multiple tile fetches. Between requests, ship positions only change on tick (ship arrivals), so the visibility set is stable between ticks. A simple in-memory cache keyed on `(playerId, lastTickId)` avoids recomputation.

---

## 3. What Visibility Gates

Only dynamic, gameplay-relevant data. Static data (names, economy type, trait icons) is always available via static tiles.

### 3.1 Map-Level Dynamic Data (in dynamic tiles)

Minimal data — just enough for map icons and indicators:

| Data | Type | Size | Purpose |
|---|---|---|---|
| Event type IDs | `string[]` | ~20 bytes | Show event icon next to system dot |
| Player ship presence | `boolean` | 1 byte | Show "you have ships here" indicator |
| Danger level | `number` | 4 bytes | Color-code system dot by danger |

That's ~25 bytes per visible system. A dynamic tile with 40 systems: ~1KB. Tiny.

For systems outside the player's visibility: `{ visibility: "unknown" }`. No data, no cost.

### 3.2 System Detail (on click)

Full detail endpoint gated by visibility:

| Visibility | Data returned |
|---|---|
| **Visible** | Full detail: description, traits, market prices, supply/demand, active events with full info, danger breakdown, docked ships |
| **Unknown** | Atlas-only: name, economy type, region, connections. No prices, no events, no ships |

### 3.3 Events

The current global event broadcast (`/api/game/events`) is replaced entirely. Events are embedded in dynamic tile responses, filtered by player visibility. A player only learns about events in systems they can see.

This resolves the "events at scale" open question from [Scalable Data Loading](./scalable-data-loading.md).

---

## 4. Client Rendering

### 4.1 Visible Systems (has live data)
- Full brightness system dot
- System name label (from static tile)
- Event icon overlay (from dynamic tile)
- Ship presence indicator (from dynamic tile)
- Danger-colored dot border (from dynamic tile)

### 4.2 Unknown Systems (no visibility)
- Dim/muted system dot (still rendered from atlas — you can see the star)
- System name still visible (from static tile — it's star chart data)
- No event icons, no ship indicators, no danger coloring
- On click: system detail panel shows limited info with a message like "No current intel on this system"

The visual distinction between visible and unknown should be clear but not jarring. Think dimmed vs full brightness, not invisible vs visible.

---

## 5. Future: Staleness & Snapshots (v2)

Documented here for architectural awareness — not part of v1 implementation.

### 5.1 The Concept

When a player loses visibility of a system (last ship leaves sensor range, faction standing drops), the server snapshots that system's dynamic state at the moment of loss. The player continues to see the snapshot data, visually degraded based on age, until they regain visibility.

**Inspired by**: X4's 4-hour price staleness timer. Creates real information asymmetry — acting on stale data has genuine consequences.

### 5.2 What It Adds to Gameplay

- "I remember this system had cheap fuel, but that was ages ago. Do I risk the trip?" — meaningful decisions
- Intel becomes tradeable (sell your recent snapshot data to other players)
- Factions that share intel become more valuable (their data is fresh)
- Exploration has a memory — the map gradually fills in rather than being binary light/dark

### 5.3 Implementation Sketch

Storage: one row per player-system pair, overwritten each time visibility is lost.

```
PlayerVisibilitySnapshot {
  playerId     String
  systemId     String
  lastSeenTick Int       // When visibility was lost
  snapshot     Json      // Prices, event type IDs, danger at time of loss
}
```

Size: ~200-300 bytes per snapshot. 1,000 players × 2,000 explored systems = 2M rows, ~500MB. Manageable.

Client adds a third rendering state between visible and unknown: **stale** — faded UI with "Last intel: X ticks ago" label. Visual degradation scales with age.

### 5.4 Why Defer

- Binary visibility delivers 90% of the gameplay value (information scarcity, exploration incentive)
- Snapshots add storage, write load on visibility changes, and a third client rendering state
- EVE Online ships without any staleness system and creates compelling gameplay
- Easy to add later — the visibility computation is the same, snapshots are a write hook on visibility loss
- The client already handles visibility states via the dynamic tile response — adding "stale" is a new enum value + visual treatment, not a rewrite

---

## 6. Future: Faction Visibility (v2)

Allied factions extend a player's visibility into faction-controlled territory.

### 6.1 How It Works

- Player has Friendly+ standing (+25 reputation) with a faction → gains visibility of all systems that faction controls
- Standing drops below threshold → visibility lost for those systems
- Faction loses systems in a war → those systems leave the faction's territory → player loses visibility (unless own ships cover them)

### 6.2 Gameplay Implications

- **Early game**: Visibility limited to ship sensor range. Universe feels vast and unknown.
- **Mid game**: Standing with 1-2 factions lights up large regions. Faction territory becomes "home turf."
- **Late game**: Multiple faction alliances, scout ships deployed, purchased intel. Most of the map visible, but maintaining it requires ongoing investment.

### 6.3 Integration

Adds a new visibility source to §2.1. The BFS computation adds faction territory systems to the player's visibility set. No architectural change — just an additional input to the union.

---

## 7. Future: Purchased Intel & Mission Reveals (v3)

### 7.1 Purchased Intel

- Bought from trade stations. Cost scales with distance and region size.
- Provides current dynamic data for a region/system at time of purchase.
- Time-limited: expires after X ticks, then systems go dark again.
- Does NOT provide ongoing visibility — it's a point-in-time photograph.

### 7.2 Mission Reveals

- Active missions grant temporary visibility of relevant systems.
- Delivery missions reveal the destination. Patrol/survey/bounty reveal the target + adjacent systems.
- Expires when mission completes, fails, or is abandoned.
- Solves the chicken-and-egg: "How do I know if a mission is worth it if I can't see the destination?"

### 7.3 Player-to-Player Intel Trading (far future)

- Sell your visibility data to other players. Creates an intel broker role.
- Depends on multiplayer trading infrastructure.

---

## 8. Implementation

See **[Map Scaling Roadmap](./map-scaling-roadmap.md)** for the unified phase sequence across data loading and visibility. Core visibility ships in Phase 3 of the roadmap. Faction visibility, purchased intel, and snapshots are Phases 5-7.

---

## Related Design Docs

- **[Scalable Data Loading](./scalable-data-loading.md)** — tile architecture that this system gates
- **[Faction System](./faction-system.md)** — faction reputation drives allied visibility (Phase 2)
- **[Navigation](../active/navigation.md)** — ship positions and roles determine sensor range
- **[Multiplayer Infrastructure](./multiplayer-infrastructure.md)** — player-to-player intel trading (far future)
