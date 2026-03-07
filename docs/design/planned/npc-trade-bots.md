# NPC Trade Bots

Status: **Planned** — design complete, not yet implemented.

## Problem

The economy needs ~3 traders per system for meaningful competition. With 10-50 real players across 600+ systems, natural player density is far too low. Markets stagnate without baseline competitive pressure. Systems start at prosperity 0 (stagnant, 0.7x multiplier) and never climb out without trade.

## Solution: Stateful NPC Traders

Autonomous NPC merchants that travel between systems, buy and sell goods, and create natural trade pressure. Unlike virtual diffusion, these are stateful entities with positions, cargo, and destinations — their movement creates emergent trade routes that shift over time as market conditions change.

NPCs scale down as players arrive. They exist to keep the universe alive during quiet periods, not to compete with an active player base.

---

## Design

### NPC Lifecycle

Each NPC has a simple state machine:

```
DOCKED → evaluate market → buy cargo → pick destination → IN_TRANSIT → arrive → DOCKED
```

When docked:
1. Sell all cargo (impacts market: supply increases, demand decreases)
2. Refuel if needed
3. Evaluate nearby systems for profitable trades (reuse existing strategy logic)
4. Buy goods and depart

When in transit:
1. Count down travel ticks (based on fuel cost of edge, same as player ships)
2. On arrival, transition to DOCKED

### NPC State Model

NPCs are stored in a dedicated `NpcTrader` table — lightweight rows with just enough state to persist across ticks.

```prisma
model NpcTrader {
  id            String   @id @default(cuid())
  systemId      String
  status        String   @default("docked")    // "docked" | "in_transit"
  destinationId String?                         // target system when in transit
  arrivalTick   Int?                            // tick when NPC arrives
  credits       Float    @default(500)
  cargoGoodId   String?                         // single good carried (NPCs carry one type)
  cargoQuantity Int      @default(0)
  strategy      String   @default("nearest")    // strategy type for decision-making
  createdAt     DateTime @default(now())

  system      StarSystem @relation(fields: [systemId], references: [id])

  @@index([systemId])
  @@index([status])
}
```

NPCs are not region-scoped — they roam freely across the universe. The processor queries NPCs by system, and systems belong to regions, so round-robin processing still works without a direct region FK.

Key simplifications vs player ships:
- **Single cargo slot** — NPCs carry one good type per trip. Simpler logic, realistic for small merchants.
- **No ship types** — NPCs have a fixed cargo capacity and speed (constants, not per-entity).
- **No hull/shields** — NPCs don't engage in combat (future: could be pirate targets).
- **Credits are bounded** — NPCs don't accumulate wealth. Credits reset toward a baseline to prevent runaway accumulation or bankruptcy.

### Tick Processing

A new `npcTradeProcessor` runs inside the economy tick, after market simulation but sharing the same transaction. Processes one region per tick (same round-robin as economy).

```
For each NPC in the current region:

  IF in_transit AND arrivalTick <= currentTick:
    → transition to DOCKED at destination

  IF docked:
    → sell cargo (batch market impact)
    → evaluate strategy (reuse simulator strategy logic)
    → buy goods (batch market impact)
    → set destination, status = in_transit, compute arrivalTick

Batch-write all NPC state changes + market impacts
```

**Performance budget**: With ~3 NPCs × ~25 systems/region = ~75 NPCs per tick. Strategy evaluation is pure math (no DB). Market reads are already loaded by the economy processor. Only new DB work is:
- Read NPC rows for this region (~75 rows)
- Write NPC state updates (batch)
- Market impact writes (folded into existing `batchUpdateMarkets`)

### Adaptive Density

NPCs exist to fill the gap between current player activity and the target activity level. The system self-balances:

**Target NPCs per region** (computed each processor run for the active region):
```
systemsInRegion = systems in the current round-robin region
dockedNpcsHere = NPCs currently docked or in-transit within this region's systems
baseTarget = NPC_BOTS_PER_SYSTEM * systemsInRegion
playerPressure = recentPlayerVolume / PROSPERITY_TARGET_VOLUME * NPC_PLAYER_DISPLACEMENT
regionTarget = max(0, baseTarget - playerPressure)
```

Where:
- `NPC_BOTS_PER_SYSTEM` — baseline NPC density (default: 2)
- `NPC_PLAYER_DISPLACEMENT` — NPCs displaced per "full player equivalent" of trade volume (default: 1.5)
- `recentPlayerVolume` — sum of `tradeVolumeAccum` across the region's systems (already tracked, captures player trades only since NPC trades won't log to TradeHistory)

**Spawning**: If `dockedNpcsHere < regionTarget`, spawn new NPCs at random systems within the region. Spread evenly — don't cluster at one station.

**Despawning**: If `dockedNpcsHere > regionTarget` (players arrived), mark excess NPCs for removal. Remove idle (docked) NPCs first, let in-transit NPCs finish their trip before removing.

**Gradual scaling**: Don't spawn/despawn more than 2-3 NPCs per processor run. Prevents jarring market swings when a player enters or leaves a region.

Note: NPCs spawned in one region may travel to another via gateways. Displacement only affects spawning — an NPC that migrated to a busy region won't be forcibly despawned, it'll just find fewer profitable trades and eventually return or get removed naturally when idle.

### NPC Strategies

Reuse the existing simulator strategy module (`lib/engine/simulator/strategies/`). NPCs don't all use the same strategy — variety creates more realistic market behavior:

| Strategy | % of NPCs | Behavior |
|---|---|---|
| `nearest` | 60% | Local traders, quick turnover, stay in region |
| `greedy` | 25% | Profit-maximizing, willing to travel further |
| `random` | 15% | Unpredictable, creates noise, occasionally finds odd routes |

Strategy assignment happens at spawn time and persists for the NPC's lifetime.

### Market Impact

NPC trades affect markets identically to player trades:
- **Buy**: supply decreases by quantity, demand increases by `quantity * NPC_TRADE_IMPACT`
- **Sell**: supply increases by quantity, demand decreases by `quantity * NPC_TRADE_IMPACT`
- **Trade volume**: contributes to `tradeVolumeAccum` on the system (drives prosperity)

`NPC_TRADE_IMPACT` (default: 0.5) can differ from the simulator's `tradeImpactFactor` if we want NPCs to have lighter/heavier footprint than players.

### Credit Economy

NPCs need credits to buy goods but shouldn't accumulate infinite wealth or go bankrupt:

- **Starting credits**: `NPC_STARTING_CREDITS` (default: 500) — enough for a few Tier 0/1 trades
- **Credit reset**: Each processor run, nudge NPC credits toward the baseline: `credits = credits + (baseline - credits) * 0.1`. This prevents snowballing profits and softens bad trades.
- **No credit tracking in metrics** — NPC credits are a simulation detail, not player-visible.

---

## Constants

New constants in `lib/constants/npc.ts`:

```typescript
export const NPC_CONSTANTS = {
  /** Baseline NPC traders per system (before player displacement). */
  BOTS_PER_SYSTEM: 2,
  /** Each active player in a region displaces this many NPCs. */
  PLAYER_DISPLACEMENT: 1.5,
  /** Max NPCs spawned or despawned per processor run (prevents jarring swings). */
  MAX_SPAWN_PER_TICK: 3,
  /** NPC cargo capacity (units). Single good type per trip. */
  CARGO_CAPACITY: 15,
  /** NPC travel speed multiplier (1.0 = same as player shuttle). */
  SPEED_MULTIPLIER: 1.0,
  /** Market impact per unit traded (demand delta = quantity * this). */
  TRADE_IMPACT: 0.5,
  /** Starting/baseline credits for NPCs. */
  STARTING_CREDITS: 500,
  /** Credit reversion rate toward baseline per processor run. */
  CREDIT_REVERSION: 0.1,
  /** Fuel threshold — refuel when below this fraction of max. */
  REFUEL_THRESHOLD: 0.4,
  /** Max fuel capacity for NPCs. */
  MAX_FUEL: 60,
  /** "Active player" = traded in this region within this many processor runs. */
  PLAYER_ACTIVITY_WINDOW: 5,
} as const;
```

---

## Trade Activity Visualization

NPC trades contribute to `tradeVolumeAccum` just like player trades. This existing field drives prosperity, which becomes the primary activity indicator.

### Map View

Expose `prosperity` in the dynamic tiles API (`/api/game/systems/dynamic`). The map uses it to show system activity:

- **Glow intensity or accent indicator** on system nodes, modulated by prosperity
- Exact visual TBD — iterate on what reads well alongside existing economy colors, event dots, and ship counts
- Stagnant systems (prosperity ~0) appear dim; booming systems (prosperity ~1) appear vibrant

### System Detail Panel

Add a "Trade Activity" line showing the prosperity-derived label:

| Prosperity Range | Label | Description |
|---|---|---|
| -1.0 to -0.3 | Crisis | Economy in freefall (event-driven) |
| -0.3 to 0.1 | Stagnant | Little to no trade activity |
| 0.1 to 0.5 | Active | Healthy trade flow |
| 0.5 to 1.0 | Booming | High trade volume, competitive market |

### Market Screen

Optional flavor text: "~X NPC traders active in this system" — derived from NPC count at that system. Low priority, nice-to-have.

---

## Implementation Phases

### Phase 1: NPC State + Processor
- Add `NpcTrader` model to schema
- Create `lib/constants/npc.ts` with constants
- Create `npcTradeProcessor` in `lib/tick/processors/`
- Adapt simulator strategy logic for live use (pure functions, no sim types)
- Spawn/despawn logic with adaptive density
- NPC buy/sell/travel loop with batch market writes
- Seed: spawn initial NPCs based on `BOTS_PER_SYSTEM`

### Phase 2: Activity Visualization
- Expose `prosperity` in dynamic tiles API
- Add prosperity-based visual indicator to map system objects
- Add "Trade Activity" label to system detail panel
- Add "Trade Activity" label to full system page

### Phase 3: Adaptive Player Displacement
- Track per-region player trade activity (query `TradeHistory` or use `tradeVolumeAccum`)
- Implement displacement formula in spawn/despawn logic
- Gradual scaling (max spawn/despawn per tick)

### Phase 4: Tuning
- Run simulations with NPC processor active
- Calibrate density, impact, and credit constants
- Verify NPCs create meaningful but not overwhelming pressure
- Verify player displacement works smoothly

---

## Risks

- **Market homogenization**: If NPCs trade too aggressively, all systems converge to similar prices. Mitigation: low cargo capacity (15 units), moderate impact factor, and the `nearest` strategy's proximity bias keeps most NPC trade local.
- **Performance at scale**: 10K systems × 2 NPCs = 20K NPC rows. At ~400 systems/region, that's ~800 NPCs per tick. Strategy evaluation is O(reachable_systems × goods) per NPC. May need to cap evaluation depth or use simpler strategies for large regions.
- **Stale NPCs**: If an NPC gets stuck (no profitable trades, no fuel), it sits idle forever. Mitigation: credit reversion prevents bankruptcy, and idle NPCs get despawned first when reducing density.
- **Cross-region travel**: Gateways are just edges with higher fuel cost — pathfinding handles them transparently. Most NPCs stay local (nearest strategy's distance penalty), but greedy/random NPCs will cross regions when profitable. This creates natural inter-region trade routes without any special logic.

## Resolved Decisions

- **NPC ship counts**: Tracked separately from player ships. Dynamic tiles API gets a new `npcTraderCount` field. Displayed as a distinct indicator on the map, not mixed into player fleet count.
- **Trade history**: NPC trades are NOT logged to `TradeHistory` — that table is for player trades only. NPC market impact shows up naturally through supply/demand changes and price history graphs.
- **Cross-region travel**: Enabled from v1. Gateways need no special handling — they're just high-fuel-cost edges in the adjacency list. Strategy distance penalties naturally keep most NPC trade local.
