# Economy Simulation — Regional Model

## Problem

The current economy simulation processes all 48 market entries (8 systems × 6 goods) in a single pass every 10 ticks. This works at the current scale but won't survive growth to hundreds of systems. The supply/demand formulas are also pure random walks with no equilibrium target — at scale, prices drift meaninglessly.

This doc covers:
1. **Regional model** — grouping systems into regions for round-robin processing
2. **Gateway-based inter-region travel** — strategic chokepoints between regions
3. **Two-tier navigation** — region-scoped pathfinding with bounded complexity
4. **Revised supply/demand formulas** — mean-reverting drift with economic structure
5. **Batch write strategy** — eliminating sequential UPDATE loops
6. **Universe generation** — procedural system/region generation
7. **Schema changes** — Region model, gateway systems, StarSystem changes
8. **Map visualization** — region-level zoom with aggregate nodes

## Current State

### Economy Tick (`lib/engine/tick.ts`)

Each tick, for every market entry:
- **Producers:** supply += randInt(1,5), demand -= randInt(0,2)
- **Consumers:** supply -= randInt(1,3), demand += randInt(1,5)
- **Drift:** supply += randInt(-2,2), demand += randInt(-2,2)
- **Clamp:** supply and demand to [5, 200]

### Pricing (`lib/engine/pricing.ts`)

```
price = basePrice × (demand / supply)
clamped to [0.2×, 5.0×] basePrice
```

### Trade Impact (`lib/engine/trade.ts`)

Player trades adjust demand by 10% of quantity traded (buy → +demand, sell → −demand).

### What Works

- Price = `basePrice × (demand / supply)` is a good foundation. Intuitive and stable.
- Production/consumption by economy type creates natural trade opportunities.
- Player trade impact on demand creates feedback loops.

### What Doesn't Scale

- **Random walk drift** — Supply/demand has no equilibrium target. Over thousands of ticks, values cluster at the clamp boundaries (5 or 200) rather than oscillating around a meaningful center.
- **Flat processing** — Processing all markets every tick doesn't scale to hundreds of systems.
- **Sequential writes** — One `UPDATE` per market entry. At 1,200 entries, that's 1,200 round-trips per economy tick.
- **No regional structure** — No concept of "nearby" economies influencing each other. All systems are equally isolated.

---

## Design: Regional Economy

### Region Model

A **region** is a group of ~25 geographically nearby systems that share economic influence. Regions are the unit of economy processing — one region is updated per tick.

**Initial target:** ~200 systems across ~8 regions (~25 systems per region). The architecture supports scaling to 1,000+ systems / 20+ regions — just change the generation parameters.

**Why regions matter for gameplay:**
- Regional price differences are the core trading mechanic. A mining region has cheap ore; a tech region needs ore. The price gradient creates the trade route.
- Inter-region hauling through gateways is more profitable than local trading — but requires more fuel, planning, and risk.
- Players discover which regions produce/consume what and plan multi-region routes accordingly.

**Region properties:**
- `id` — Unique identifier
- `name` — Display name (procedurally generated for now, curated name pools later)
- `x, y` — Center coordinates for map display
- `identity` — Economic identity (resource-rich, industrial, tech corridor, etc.)
- Systems belong to exactly one region

### Gateway Systems

Each region has **1-3 designated gateway systems** that serve as the only connection points to adjacent regions. Normal systems only connect within their region.

**Gateway properties:**
- A gateway system is a regular `StarSystem` with `isGateway: true`
- Gateway-to-gateway connections have higher fuel cost (longer jump, deliberate travel decision)
- Each gateway connects to exactly one other region's gateway (one-to-one pairing)
- Gateways are placed at region borders — the systems closest to adjacent regions

**Why gateways?**
- **Pathfinding stays bounded** — Dijkstra never exceeds ~25 nodes. Cross-region routing decomposes into: region-level path (tiny graph) + two intra-region paths (small graphs).
- **Visual clarity** — Regions are physically separated on the map. Gateway connections are visible long-distance lines between clusters.
- **Strategic depth** — Gateways become natural trade hubs, chokepoints, and points of interest. Future content hooks: premium fuel, tariffs, pirate ambushes, faction control.

### Two-Tier Navigation

Cross-region travel decomposes into two pathfinding tiers:

**Tier 1: Region-level routing** (~8 nodes)
- Input: current region, destination region
- Graph: regions as nodes, gateway connections as edges
- Output: ordered list of (gateway, target region) hops
- Algorithm: Dijkstra on the region graph (trivial at this scale)

**Tier 2: System-level routing** (~25 nodes per call)
- Input: current system, target gateway (within same region)
- Graph: intra-region systems and connections only
- Output: ordered list of system hops with fuel costs
- Algorithm: existing Dijkstra (`findShortestPath`) — unchanged, just scoped to one region's connections

**Full cross-region route example:**
1. Player is at system A in Region 1, wants to reach system Z in Region 3
2. Region-level: Region 1 → (Gateway G1→G2) → Region 2 → (Gateway G3→G4) → Region 3
3. System-level: A → ... → G1 (within Region 1), then G2 → ... → G3 (within Region 2), then G4 → ... → Z (within Region 3)
4. Each segment is an independent Dijkstra call on ~25 nodes

**Key constraint:** Pathfinding never operates on the full graph. The maximum Dijkstra scope is one region (~25 systems). This is a hard performance ceiling that holds regardless of universe size.

**UX implication:** The current 3-phase navigation state machine works within a region. Cross-region travel extends it: the player plans each region segment individually, or we add a higher-level route planner that auto-computes the full multi-region path as a sequence of segments.

### Round-Robin Processing

The economy processor currently runs every 10 ticks. With regions, it runs **every tick** but processes only one region per tick:

```
regionIndex = tick % regionCount
```

With 8 regions, each region is updated every 8 ticks. At a 5s tick rate, that's a full economy cycle every 40 seconds — fast enough to feel alive, slow enough to be cheap.

The processor's `frequency` stays at 1. The round-robin happens inside the processor, not at the registry level. This keeps the registry simple.

### Schema Changes

```prisma
model Region {
  id          String       @id @default(cuid())
  name        String       @unique
  identity    String       // "resource_rich" | "agricultural" | "industrial" | "tech" | "trade_hub"
  x           Float
  y           Float
  systems     StarSystem[]
}

model StarSystem {
  // ... existing fields ...
  regionId    String
  isGateway   Boolean      @default(false)

  region      Region       @relation(fields: [regionId], references: [id])

  @@index([regionId])
}
```

The `@@index([regionId])` on StarSystem is critical — the economy processor queries markets by region, so this index makes the query efficient.

Gateway connections are regular `SystemConnection` rows with higher `fuelCost`. No new connection model needed — the existing schema supports variable fuel costs per edge.

---

## Universe Generation

### Overview

Going from 8 hand-defined systems to ~200 requires procedural generation. The seed script will generate systems with generic names (e.g., "Alpha-7", "Kepler-12") — a curated name pool or hybrid naming system can be added later.

The generated universe is deterministic given a seed value, so the same universe can be regenerated consistently.

### Generation Steps

1. **Generate regions** — Place ~8 region centers on the map with minimum distance between them (Poisson disk sampling or simple grid jitter). Each region gets an economic identity.

2. **Generate systems per region** — For each region, scatter ~25 systems around the center within a bounded radius. Each system gets an economy type weighted by the region's identity. Systems are named generically: `"{RegionName}-{index}"` (e.g., "Forge-7", "Nexus-12").

3. **Designate gateways** — For each pair of adjacent regions, pick the border systems closest to each other and mark them as gateways. Each gateway connects to exactly one gateway in the adjacent region.

4. **Generate intra-region connections** — Within each region, connect systems using a minimum spanning tree (ensures connectivity) plus random extra edges (adds route variety). Target: ~1.5× MST edge count.

5. **Generate inter-region connections** — Connect gateway pairs with higher fuel cost (e.g., 2-3× the average intra-region edge cost).

6. **Generate stations and markets** — Same as current: one station per system, one market entry per good per station. Initial supply/demand based on economy type.

### Economy Type Distribution per Region

| Region Identity | Mining | Agricultural | Industrial | Tech | Core |
|---|---|---|---|---|---|
| Resource-rich | 40% | 20% | 20% | 10% | 10% |
| Agricultural | 15% | 45% | 15% | 15% | 10% |
| Industrial | 20% | 10% | 40% | 20% | 10% |
| Tech corridor | 10% | 10% | 20% | 45% | 15% |
| Trade hub | 15% | 15% | 20% | 15% | 35% |

### Generation Constants

```typescript
// lib/constants/universe-gen.ts

export const UNIVERSE_GEN = {
  SEED: 42,
  REGION_COUNT: 8,
  SYSTEMS_PER_REGION: 25,
  MAP_SIZE: 4000,                    // map coordinate space
  REGION_MIN_DISTANCE: 800,          // minimum distance between region centers
  SYSTEM_SCATTER_RADIUS: 300,        // how far systems spread from region center
  SYSTEM_MIN_DISTANCE: 40,           // minimum distance between systems
  INTRA_REGION_EXTRA_EDGES: 0.5,     // fraction of MST edges to add as extras
  GATEWAY_FUEL_MULTIPLIER: 2.5,      // inter-region fuel cost multiplier
  INTRA_REGION_BASE_FUEL: 8,         // base fuel cost for intra-region connections
} as const;
```

### Implementation

All generation logic lives in `lib/engine/universe-gen.ts` as pure functions (testable, no DB dependency). The seed script calls these functions and writes results to the database.

```typescript
// lib/engine/universe-gen.ts (function signatures)

interface GeneratedRegion {
  name: string;
  identity: RegionIdentity;
  x: number;
  y: number;
}

interface GeneratedSystem {
  name: string;
  economyType: EconomyType;
  x: number;
  y: number;
  regionIndex: number;
  isGateway: boolean;
}

interface GeneratedConnection {
  fromIndex: number;
  toIndex: number;
  fuelCost: number;
}

function generateRegions(params: GenParams): GeneratedRegion[];
function generateSystems(regions: GeneratedRegion[], params: GenParams): GeneratedSystem[];
function generateConnections(systems: GeneratedSystem[], regions: GeneratedRegion[], params: GenParams): GeneratedConnection[];
```

---

## Revised Supply/Demand Formulas

### Equilibrium Targets

Each market entry has an **equilibrium point** — the supply and demand values it naturally drifts toward when no players or events are acting on it. This replaces the aimless random walk.

Equilibrium is determined by economy type:

| Economy Type | Good Relationship | Target Supply | Target Demand |
|---|---|---|---|
| Any | Produces | 120 | 40 |
| Any | Consumes | 40 | 120 |
| Any | Neutral | 60 | 60 |

These targets are the same as the current seed values — the change is that the simulation *pulls toward them* instead of drifting randomly.

### Mean-Reverting Drift

Each tick, supply and demand move toward their equilibrium:

```typescript
// Reversion strength: 5% of the gap per tick
const REVERSION_RATE = 0.05;
// Random noise amplitude
const NOISE_AMPLITUDE = 3;

function driftValue(current: number, target: number): number {
  // Mean reversion: pull toward target
  const reversion = (target - current) * REVERSION_RATE;
  // Random noise: keeps things interesting
  const noise = randInt(-NOISE_AMPLITUDE, NOISE_AMPLITUDE);
  return clamp(Math.round(current + reversion + noise), 5, 200);
}
```

**Why mean-reversion?**
- Prices stay meaningful. A mining station's ore is consistently cheap (high supply, low demand) — it doesn't randomly become expensive.
- Player trades create *temporary* disruptions. If a player buys all the ore, supply drops and price spikes — but it recovers over time. This rewards active trading without permanently breaking the economy.
- The reversion rate (5%) means it takes ~20 ticks to recover halfway. At one region tick every 8 ticks, that's ~160 ticks of real time — enough for the disruption to feel real but not permanent.

### Production and Consumption Effects

On top of mean-reversion, production and consumption still apply. But instead of random magnitudes, they're structured:

```typescript
const PRODUCTION_RATE = 3;  // units per tick
const CONSUMPTION_RATE = 2; // units per tick

// Producers: generate supply, slightly reduce demand
if (produces.includes(goodId)) {
  supply += PRODUCTION_RATE;
  demand -= Math.round(PRODUCTION_RATE * 0.3);
}

// Consumers: deplete supply, generate demand
if (consumes.includes(goodId)) {
  supply -= CONSUMPTION_RATE;
  demand += Math.round(CONSUMPTION_RATE * 0.5);
}
```

These effects stack with mean-reversion. A producer's equilibrium supply target is 120, plus it gains 3 supply per tick — so it overshoots slightly and the mean reversion pulls it back. This creates a natural oscillation around the target rather than a flat line.

### Trade Impact (Unchanged)

Player trades still adjust demand by 10% of quantity. This is a direct perturbation that the mean-reversion will gradually correct.

### Constants Summary

```typescript
// lib/constants/economy.ts

export const ECONOMY_CONSTANTS = {
  /** How quickly supply/demand revert to equilibrium (0-1, fraction per tick). */
  REVERSION_RATE: 0.05,
  /** Random noise amplitude (±units per tick). */
  NOISE_AMPLITUDE: 3,
  /** Supply/demand floor. */
  MIN_LEVEL: 5,
  /** Supply/demand ceiling. */
  MAX_LEVEL: 200,
  /** Units of supply generated per tick by producers. */
  PRODUCTION_RATE: 3,
  /** Units of supply consumed per tick by consumers. */
  CONSUMPTION_RATE: 2,
} as const;

/** Equilibrium targets by good relationship to economy type. */
export const EQUILIBRIUM_TARGETS = {
  produces: { supply: 120, demand: 40 },
  consumes: { supply: 40, demand: 120 },
  neutral:  { supply: 60, demand: 60 },
} as const;
```

---

## Batch Write Strategy

### Current: Individual Prisma Updates

```typescript
for (const u of updates) {
  await tx.stationMarket.update({
    where: { id: u.id },
    data: { supply: u.supply, demand: u.demand },
  });
}
```

At 25 systems × 6 goods = ~150 markets per region tick, this is 150 individual UPDATE statements inside a shared transaction. On SQLite (single commit, no network round trips), this completes in ~15ms. Sufficient for the current scale.

### Future: Parameterized Batch SQL (PostgreSQL)

Deferred to the PostgreSQL migration (see `docs/tick-engine-redesign.md` Step 5). Will use `$executeRaw` with parameterized queries for batch `UPDATE...FROM VALUES` — replacing 150 statements with 1. Processor code stays the same; batch logic lives in a shared utility.

---

## Map Visualization

### Two-Level Map

The star map supports two zoom levels with a smooth transition between them:

**Zoomed out (region view):**
- Each region renders as a single aggregate node showing: region name, identity icon, system count, and a summary of economic activity
- Inter-region gateway connections shown as edges between region nodes
- ~8 nodes + ~12 edges — trivially fast to render
- Clicking a region zooms into it

**Zoomed in (system view):**
- Shows all ~25 systems within one region
- Current behavior: custom SystemNode with economy type colors, ship badges, navigation states
- Gateway systems have distinct styling (e.g., larger node, gate icon, connecting line trailing off-screen toward the adjacent region)
- Pathfinding operates within this region only
- "Jump to region" action available at gateway systems — zooms out, moves to adjacent region, zooms in

**Transition:**
- React Flow's `fitView` targets either the full region set (zoomed out) or a single region's systems (zoomed in)
- The node/edge arrays swap based on the current view level
- A breadcrumb or back button returns to region view from system view

### Performance Budget

| View | Nodes | Edges | React Flow Load |
|---|---|---|---|
| Region view | ~8 | ~12 | Trivial |
| System view | ~25 | ~40 | Light |
| Current (8 systems) | 8 | 24 | Light |

Neither view approaches React Flow's performance limits. No virtualization needed.

### When to Build

Map visualization changes are part of **Step 2c** (frontend updates). The two-level map is a natural companion to the regional economy — without it, 200 systems on one canvas would be cluttered. But the economy and generation work (Steps 2a, 2b) can be built and tested before the map update ships.

---

## Step 3 Preview: Ambient NPC Trade Pressure

*This section sketches the Step 3 design. A full expansion of this doc is needed before implementation.*

### Concept

Tier 1 NPCs are not individual agents — they're statistical trade flows baked into the economy simulation. "This region exported 500 units of ore this tick" is computed as a formula, not by simulating individual NPC ships.

### Intra-Region Trade Pressure

Within a region, goods flow from producers to consumers:
- Mining stations' surplus ore drifts toward industrial stations that consume it
- The flow rate depends on the supply surplus / demand deficit
- This happens naturally through the mean-reversion targets — no explicit flow needed for intra-region trade

### Inter-Region Trade Flows

Between regions, a lower-frequency pass computes trade flows:
1. Calculate each region's **net position** per good: total supply minus total demand
2. Regions with surplus export to adjacent regions with deficit
3. Flow magnitude is proportional to the surplus/deficit gap
4. Applied as supply/demand adjustments at **gateway stations** — the natural trade chokepoints

Gateway stations become the points where inter-region economic pressure manifests. A gateway connecting a mining region to a tech region would see ore flowing through it — supply builds at the mining side, demand builds at the tech side. Players at gateway stations see these flows as trading opportunities.

### Implementation Approach

Inter-region trade runs as a separate phase within the economy processor, at a lower frequency (e.g., every full region cycle — every 8 ticks). It reads aggregated region data and applies small adjustments to gateway station markets. No new processor needed.

---

## Implementation Plan

### Step 2a: Schema + Seed + Generation

1. Add `Region` model, `regionId` and `isGateway` to `StarSystem` in `schema.prisma`
2. Create `lib/constants/economy.ts` with equilibrium targets and simulation constants
3. Create `lib/constants/universe-gen.ts` with generation parameters
4. Create `lib/engine/universe-gen.ts` — procedural generation functions (pure, testable):
   - `generateRegions(params)` — place region centers with minimum spacing
   - `generateSystems(regions, params)` — scatter systems with economy type weights
   - `generateConnections(systems, regions, params)` — MST + extras (intra-region), gateway pairs (inter-region)
5. Add tests for universe generation (connectivity, gateway placement, economy type distribution)
6. Update `prisma/seed.ts` to use procedural generation
7. Run `prisma db push` + `prisma db seed` to populate

### Step 2b: Economy Processor Upgrade

1. Update `lib/engine/tick.ts` — replace random walk with mean-reverting drift
2. Update `lib/tick/processors/economy.ts`:
   - Query markets for one region per tick (round-robin via `tick % regionCount`)
   - Use batch write for market updates
   - Return event with region info: `{ regionId, marketCount }`
3. Add tests for new `simulateEconomyTick` (mean-reversion behavior)
4. Update existing tests if formula changes affect expectations

### Step 2c: Frontend Updates

1. Star map — two-level view (region overview / system detail)
2. Navigation — two-tier pathfinding (region-level + system-level)
3. Gateway system styling and "jump to region" action
4. System detail — show region affiliation

### Step 3: NPC Trade Pressure + Inter-Region Trade

1. Expand economy processor with inter-region flow calculations
2. Compute region adjacency from gateway connections
3. Apply trade pressure adjustments to gateway station markets
4. Tune flow rates for gameplay balance

---

## Resolved Decisions

1. **Universe size** — Start at ~200 systems / ~8 regions. Architecture supports scaling up by changing generation parameters. Generic procedural names for now (e.g., "Forge-7"), curated name pools or hybrid naming later.

2. **Procedural generation** — Fully procedural for Step 2. Hybrid approach (procedural placement + curated name/identity pools) planned for a future polish pass.

3. **Inter-region travel** — Gateway-only. Each region has 1-3 gateway systems. Only gateways have connections to other regions. Higher fuel cost for gateway jumps. This bounds pathfinding to ~25 nodes per call and creates natural strategic chokepoints.

4. **Map visualization** — Two-level view: region overview (aggregate nodes) and system detail (current React Flow behavior scoped to one region). Separate from but companion to the economy work. React Flow handles both levels easily — no virtualization needed.

5. **Migration** — Re-seed and re-register for dev/testing. Production migration strategy deferred.
