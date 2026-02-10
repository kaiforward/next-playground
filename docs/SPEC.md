# Stellar Trader — Game Specification

## Overview

A browser-based multiplayer space trading simulation built with Next.js. Players navigate a network of star systems, trade resources between stations, and grow their wealth. The game world features a living economy that evolves independently of player actions.

---

## MVP Scope

### Gameplay Loop

Travel → Discover → Trade → Profit → Upgrade → Repeat

### Core Systems

#### 1. Universe

- A network of star systems connected by jump lanes
- Each system has one dockable station (expandable to multiple later)
- Systems have properties: name, coordinates (for star map display), faction, economy type
- Connections between systems define travel routes

#### 2. Economy

- Goods are categorised as **resources** (raw) or **products** (refined)
- Each station has supply and demand levels per good
- Prices are derived from supply/demand — not static values
- Economy ticks happen on-demand: when a player visits, the game simulates elapsed time
- Simple rule-based NPC traders move goods between systems, creating organic price shifts
- Trade history is recorded per station for trend data

**MVP goods (starting set):**

| Good | Type | Description |
|---|---|---|
| Ore | Resource | Mined from rocky/industrial worlds |
| Food | Resource | Grown on agricultural worlds |
| Fuel | Resource | Refined at industrial stations |
| Electronics | Product | Manufactured at tech hubs |
| Ship Parts | Product | Manufactured at industrial stations |
| Luxuries | Product | Produced at wealthy/core worlds |

#### 3. Players & Fleet

- Players register and log in (simple auth)
- Each player has: credits, a fleet of ships (1:N)
- Ships own their location (systemId), not players
- Ships have: cargo capacity, fuel tank size, current fuel level, status (docked/in_transit)
- Ships in transit have: destinationSystemId, departureTick, arrivalTick
- Inventory is tied to individual ships (cargo holds)
- One ship type for now, fleet expansion and ship types upgradeable later

#### 4. Trading

- Buy and sell goods at station markets using a specific docked ship
- Trade requires ship to be docked at the station's system
- Prices vary by station based on supply/demand
- Transactions update supply/demand levels at the station
- Players can view current market prices and recent price history

#### 5. Navigation

- Players order individual ships to navigate to connected systems
- Travel consumes fuel and takes time (tick-based)
- Travel duration: `ceil(fuelCost / 2)` ticks (minimum 1)
- Ships are locked during transit (cannot trade or take other actions)
- Star map shows all ship positions per system
- UI shows transit progress with ETA

#### 5b. Tick System

- Game time advances via discrete ticks (GameWorld singleton)
- Server-side **tick processor pipeline** (`lib/tick/`) runs on a 1s poll interval
- Each tick: topologically sorted processors run sequentially (ship arrivals, economy simulation)
- Processors declare `frequency` (run every N ticks) and `offset` (phase stagger)
- Economy uses round-robin regional processing (one region per tick across ~8 regions)
- Clients connect via SSE (`GET /api/game/tick-stream`); `useTick` hook wraps EventSource
- Per-player event filtering: SSE route sends global events + only the connected player's events
- Server only advances if enough real time has elapsed (tickRate ms)
- Optimistic locking prevents double-processing

#### 6. Auth

- User registration and login
- Each user has one player profile/game state
- Session-based authentication

---

## Data Model (High Level)

```
User           → Player (1:1)
Player         → Ship (1:1 for MVP, 1:many later)
Ship           → CargoItem (1:many)

StarSystem     → Station (1:1 for MVP, 1:many later)
StarSystem    ↔ StarSystem (many:many via SystemConnection)

Station        → StationMarket (1:many, one entry per good)
Station        → TradeHistory (1:many)

Good           (reference table: name, type, base price)
```

---

## Future Enhancements (Post-MVP)

### Living Economy

- **Cron-based ticks:** Background process updates economy at regular intervals instead of on-demand
- **LLM-generated events:** AI creates narrative events that affect the game world mechanically
  - "A meteor storm disrupts mining in the Kepler system — ore prices surge"
  - "The Trade Guild announces a new shipping route between Sol and Vega"
  - Events have both flavour text and mechanical effects (supply/demand modifiers)
- **NPC factions:** Trade guilds, pirate groups, colonial governments with AI-driven goals and strategies

### Expanded Gameplay

- **Multiple ship types:** Freighters (high cargo), scouts (long range), fighters (combat)
- **Ship upgrades:** Better engines, larger cargo holds, weapons
- **Combat:** Pirates, system defence, player encounters
- **Missions/quests:** Delivery contracts, bounty hunting, exploration
- **Multiple stations per system:** Orbital stations, planet surfaces, asteroid outposts
- **Crafting/manufacturing:** Convert resources into products at appropriate stations
- **Player-to-player trading:** Direct trades or shared marketplace
- **Leaderboards:** Wealthiest traders, most systems visited, trade volume

### Technical

- **Dynamic economy visualisation:** Charts showing price trends, trade volume, supply/demand over time
- **Real-time updates:** WebSockets for live price changes and player positions
- **Mobile-responsive UI:** Playable on phones/tablets

---

## Technical Stack

See `CLAUDE.md` for the canonical tech stack reference. Key setup details:

- **Prisma 7 breaking change:** The `prisma-client` generator uses a query compiler instead of the old Rust engine. All database access requires a driver adapter passed to `new PrismaClient({ adapter })`. See `lib/prisma.ts` for the pattern.
- **Seed configuration:** Prisma 7 moved the seed command from `package.json` to `prisma.config.ts` under `migrations.seed`. The current command is `npx tsx --tsconfig tsconfig.json prisma/seed.ts`.
- **Path aliases:** `@/*` maps to `./*` via `tsconfig.json`. Works in Next.js and Vitest (configured in `vitest.config.ts`). Seed script also uses this via `--tsconfig` flag.
- **Tailwind CSS v4:** No `tailwind.config.js`. Theme variables are defined inline in `globals.css` using `@theme inline {}`.

---

## Work Streams (Implemented)

Built as independent parallel tracks with Stream 1 as the only blocker:

1. **Data Foundation** — Prisma schema, types, constants, seed script, app shell (see [data-model.md](./data-model.md))
2. **Auth System** — NextAuth, registration, login, route protection (see [auth.md](./auth.md))
3. **Economy Engine + Game API** — Pure engine functions, 7 API routes (see [economy-engine.md](./economy-engine.md))
4. **Star Map UI** — React Flow interactive map (see [star-map.md](./star-map.md))
5. **Trading UI & Charts** — Market table, trade forms, charts, dashboard (see [trading-ui.md](./trading-ui.md))
6. **Integration** — Wired mock data to real APIs, session-based auth on all game routes
