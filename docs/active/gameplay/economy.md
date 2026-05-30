# Economy System

The economy is a **single-stock** market simulation. Each `(station, good)` holds one value — `stock` — from which price, buy/sell rates, and the "how much can I trade" limits are all derived. Producers add stock (self-limiting near the ceiling), consumers drain it (self-limiting near the floor), and the spatial flow of goods between systems (trade-flow + player trades) is what separates cheap producer worlds from expensive consumer worlds. There is no separate `demand` axis and no mean-reversion — equilibrium emerges from production/consumption balance plus spatial flow.

See [Design Rationale](#design-rationale) below for why this replaced the legacy dual supply/demand model and how it kills the instant buy→resell exploit.

---

## Goods

12 goods organized in 3 tiers. Tiers create a natural progression: cheap, deep-market goods for early game; expensive, thin-market goods for late game.

### Tier 0 — Raw Materials

Deep, liquid markets (high stock anchor ~111–129), thin per-unit margin. Cheap per unit, always available. A shuttle pilot with 500cr fills cargo with these.

| Good | Base Price | Volatility | Hazard | Price Range |
|---|---|---|---|---|
| Water | 25 | 0.5 | none | 0.5x-2.0x |
| Food | 30 | 0.7 | none | 0.5x-2.0x |
| Ore | 35 | 0.6 | none | 0.5x-2.0x |
| Textiles | 35 | 0.8 | none | 0.5x-2.0x |

### Tier 1 — Processed Goods

Medium-depth markets (stock anchor ~67–75), moderate per-unit margin. Better margin but needs more capital. Mid-game income.

| Good | Base Price | Volatility | Hazard | Price Range |
|---|---|---|---|---|
| Fuel | 35 | 1.0 | low | 0.5x-2.5x |
| Metals | 45 | 0.8 | none | 0.5x-2.5x |
| Chemicals | 55 | 1.2 | low | 0.5x-2.5x |
| Medicine | 65 | 1.5 | none | 0.5x-2.5x |

### Tier 2 — Advanced Goods

Thin, scarce markets (low stock anchor ~31–35), high per-unit price swing. Highest absolute margin per unit but can't fill cargo from one system. Late-game income — needs big capital AND multi-system routes.

| Good | Base Price | Volatility | Hazard | Price Range |
|---|---|---|---|---|
| Electronics | 80 | 1.0 | none | 0.5x-3.0x |
| Machinery | 100 | 0.8 | none | 0.5x-3.0x |
| Weapons | 120 | 2.0 | high | 0.5x-3.0x |
| Luxuries | 150 | 1.8 | none | 0.5x-3.0x |

### Per-Good Pricing Anchors

Each good has a single **pricing anchor** (`targetStock`) — the stock level at which mid price equals base price. Stock above the anchor reads cheap (surplus); below reads expensive (shortage). The anchor's *magnitude* sets the market's **depth**: a high anchor (staples) means a deep, liquid market where large trades barely move price; a low anchor (luxuries) means a thin market where a small trade swings the price hard. This is why the same price formula gives staples flat prices and advanced goods volatile ones — and it's intentional.

Anchors are **calibrated**, not guessed: most goods use the midpoint of their producer/consumer seed-stock levels, but goods touched by *every* economy type (water, food, ore, textiles, chemicals) settle below that midpoint — they have no neutral markets to hold the average up — so their anchor is pinned to the stock level the universe actually settles at, measured via the simulator (`scripts/balance-analysis.ts`). The anchor *is* the natural galactic balance; deviations from it are what create trade signal.

The good's `equilibrium` field gives the **seed stock** for producers (high → cheap) vs consumers (low → expensive); the steady-state spread then emerges from production/consumption + spatial flow. Full values in `lib/constants/goods.ts`; anchors in `lib/constants/market-economy.ts`.

### Good Properties
Each good also has volume (1-2 cargo slots) and mass (0.5-2.5 kg) — stored in data but not currently enforced for cargo. Reserved for future use.

---

## Economy Types

6 economy types define what a system produces and consumes, each with per-good production/consumption rates (units/tick). Production rates are **balanced against universe-wide consumption** (≈ equal production and consumption capacity per good) so no good is systematically drained or flooded across the galaxy — see `scripts/balance-analysis.ts`.

| Type | Produces (rate/tick) | Consumes (rate/tick) |
|---|---|---|
| Agricultural | Food (10), Textiles (4) | Water (4), Chemicals (3), Machinery (1), Medicine (1) |
| Extraction | Water (13), Ore (6) | Food (3), Fuel (3), Textiles (2), Machinery (1) |
| Refinery | Fuel (5), Metals (6), Chemicals (8) | Ore (4), Water (3), Food (1) |
| Industrial | Machinery (2), Weapons (1) | Metals (3), Electronics (2), Chemicals (2), Fuel (2), Water (2), Food (2), Ore (2), Textiles (1) |
| Tech | Electronics (3), Medicine (3) | Metals (2), Chemicals (2), Food (2), Luxuries (1), Water (1) |
| Core | Luxuries (1) | Food (3), Textiles (2), Electronics (2), Medicine (2), Water (2), Weapons (1) |

This creates natural supply chains: Extraction produces ore, Refinery consumes ore and produces metals, Industrial consumes metals and produces machinery. Disrupting any link cascades through the chain. Producer rates are deliberately higher than a single system's local consumption because each producer type supplies many consumer types across the galaxy — the surplus is what flows out along trade routes.

These per-good rates are the actual rates used by both the live game and the simulator via `resolveMarketTickEntry` (`lib/engine/market-tick-builder.ts`).

### Self-Sufficiency Factors

Different economy types have different self-sufficiency for goods they consume. An Agricultural system consuming water (s=0.5, has irrigation) seeds with more stock — and reads cheaper — than a Tech system consuming water (s=0.1, imports everything).

Self-sufficiency blends a consumer's seed stock from the base consumer level toward the producer level:
- `s = 0.0` — fully dependent on imports (lowest seed stock, most expensive)
- `s = 0.5` — partly self-sufficient (mid seed stock)
- `s = 1.0` — meets own needs (seed stock matches producer levels)

This creates price variety between systems consuming the same good. Full factor table in `lib/constants/economy.ts`.

---

## Government Types

All 8 government types are implemented. Every type has trade-offs — buffs balanced by debuffs. Source of truth: `lib/constants/government.ts`. For faction and identity framing see [faction-system.md](./faction-system.md).

| Government | Volatility | Eq. Spread | Tax | Inspection | Danger | Contraband | Taxed goods | Consumption boosts |
|---|---|---|---|---|---|---|---|---|
| Federation | 0.8× | -10% | 12% | 1.2× | 0.00 | weapons | chemicals | medicine |
| Corporate | 0.9× | -5% | 10% | 0.8× | 0.02 | — | — | luxuries |
| Authoritarian | 0.7× | -15% | 15% | 1.5× | 0.00 | weapons, chemicals | — | weapons, fuel |
| Frontier | 1.5× | +20% | 0% | 0.0× | 0.10 | — | — | — |
| Cooperative | 0.7× | -10% | 10% | 1.0× | 0.00 | luxuries | — | food, medicine |
| Technocratic | 1.0× | +5% | 8% | 0.6× | 0.01 | — | water, food | electronics |
| Militarist | 1.3× | +10% | 10% | 1.3× | 0.05 | — | electronics, machinery | weapons, fuel, machinery |
| Theocratic | 0.8× | -5% | 10% | 1.4× | 0.03 | weapons, chemicals, luxuries | — | food, medicine, textiles |

### Government Effects on Gameplay
- **Volatility modifier**: Scales price-noise amplitude. Frontier = wild swings, authoritarian = smooth predictability.
- **Spread modifier** (`equilibriumSpreadPct`): Scales the **bid-ask half-spread** `s` — the gap between buy and sell price. Frontier widens it (+20% → bigger round-trip cost / wider quotes), authoritarian tightens it (-15%). Replaces the legacy supply/demand-band spread now that there is a single stock value.
- **Tax rate**: Fraction of taxed goods seized on arrival (import duty).
- **Danger baseline**: Added to all event-based danger. Frontier adds 10% base cargo loss risk.
- **Contraband**: Goods inspected and confiscated if caught. Inspection chance varies by government (0% frontier to 37.5% authoritarian).
- **Consumption boosts**: Extra consumption per tick for specific goods (e.g., authoritarian +1 weapons consumption) — drains stock faster, raising price.

---

## Market Simulation

### Price Formula
```
mid     = clamp( basePrice × (targetStock / stock) ^ k ,  floor, ceiling )
buyUnit = mid × (1 + s)        (what the player pays)
sellUnit = mid × (1 − s)       (what the player receives)
```
- `stock = targetStock` → mid = basePrice. Above → cheaper, below → more expensive. If stock ≤ 0, price hits the ceiling.
- `k` — elasticity exponent (steepness of the curve). Default **1** (reproduces the legacy hyperbola); higher `k` makes price react more sharply to the same stock gap.
- `s` — bid-ask half-spread. Default **0.05**, scaled by government (see above).
- `floor` / `ceiling` — per-good price multipliers on base price.

### Slippage (intra-trade pricing)
A trade of `q` units moves stock from `S` to `S∓q`, and price moves the whole way. The trade is priced at the **average of the curve over the stock range it moves**, not a flat pre-trade snapshot — each unit is priced at the midpoint of the stock step it causes (`tradeAvgMidPrice` in `lib/engine/market-pricing.ts`).

**Why round-trips don't profit:** a same-station buy→sell walks the identical curve segment down then back up (symmetric), so the player ends where they started minus the spread — a guaranteed small loss. Cross-system profit is untouched: buying at a surplus system walks a *low* segment of its curve, selling at a shortage system walks a *high* segment of a *different* curve. The geographic price gap is the profit; slippage only flattens prices *within* one station.

### Per-Tick Simulation (runs once per region per tick, round-robin)
Each good at each station is updated:

1. **Apply event modifiers** — active events apply one-time stock shocks, multiply production/consumption rates, or shift the anchor.
2. **Self-limiting production** — producing systems add stock, scaled by `sqrt((MAX − stock) / (MAX − MIN))`. Near the ceiling, production approaches zero (warehouses full).
3. **Self-limiting consumption** — consuming systems remove stock, scaled by `sqrt((stock − MIN) / (MAX − MIN))`. Near the floor, consumption approaches zero (nothing left).
4. **Prosperity multiplier** — both production and consumption rates are scaled by the system's prosperity multiplier (0.3x crisis to 1.3x booming).
5. **Noise** — random walk scaled by good volatility and government modifier (base amplitude ±3 units).
6. **Clamp** — stock bounded to [5, 200].

There is no mean-reversion step and no demand axis — both are gone from the single-stock model.

### Key Parameters
| Parameter | Value | Effect |
|---|---|---|
| Elasticity `k` | 1 | Curve steepness (price reaction to stock gap) |
| Bid-ask spread `s` | 0.05 base | Buy/sell gap; scaled by government; makes round-trips lose |
| Noise amplitude | ±3 base | Micro-volatility, scaled by volatility × government |
| Min/max stock | 5 / 200 | Stock bounds (ceiling price at MIN, floor price at MAX) |
| Production rate | 1-13 per good | Per economy type, scaled by self-limiting + prosperity |
| Consumption rate | 1-4 per good | Per economy type, scaled by self-limiting + prosperity |
| Price history | Rolling window | Snapshots recorded periodically (`lib/engine/snapshot.ts`) |

### Prosperity System

Each system has a `prosperity` value from -1.0 (crisis) to +1.0 (booming).

**How it moves:**
- Player trade volume pushes prosperity upward (toward +1)
- Without trade, prosperity decays toward 0 (stagnant) at 0.03/run
- Only events can push prosperity below 0 (crisis states)
- When the triggering event ends, prosperity recovers toward 0

**What it does:** A single multiplier applied equally to both production AND consumption.

| Prosperity | Multiplier | Label |
|---|---|---|
| -1.0 | 0.3x | Crisis (event-driven only) |
| -0.5 | 0.5x | Disrupted (event-driven only) |
| 0.0 | 0.7x | Stagnant |
| 0.5 | 1.0x | Active |
| 1.0 | 1.3x | Booming |

Boom amplifies both sides equally — no corrective tug-of-war. A booming system has more goods flowing in and out, not a directional correction.

**Timing**: With 24 regions and round-robin, each system is processed every ~24 ticks. At 0.03 decay/run, prosperity goes from 1.0 to ~0 in ~33 runs (~800 ticks).

### Event-Driven Anchor Shifts

Events can shift a good's **pricing anchor** — the stock level at which mid price equals base price. This is distinct from a one-time stock shock (which moves stock immediately and persistently); an anchor shift changes *what price a given stock level reads as* for the duration of the event, without touching stock itself.

**Modifier**: `anchor_shift` (`parameter: "target_stock"`). The value is a **multiplier** applied to `targetStock`:
- `> 1` — raises the anchor → goods read as scarcer → higher prices ("demand spike")
- `< 1` — lowers the anchor → goods read as more plentiful → cheaper prices
- `= 1` — no change (identity)
- `goodId: null` — applies to all goods at the target station; setting a specific `goodId` targets one good only
- Multiple active shifts on the same good **compound** (multiply together)

**Storage and write path**: The economy processor computes the net multiplier from all active `anchor_shift` modifiers on a system's events each tick (same round-robin cadence as `stock`) and writes it to **`StationMarket.anchorMult`** (default `1`). Reads are pure: `curveForGood` applies `targetStock = getTargetStock(good) × anchorMult` before evaluating the price curve, so the shift flows automatically through every price read path — player trade, convoy, missions, market display, cross-system comparison, price-history snapshots, and trade-flow gradient.

**Safety cap**: `anchorMult` is clamped to **[0.1, 4.0]** — a single good can at most become 4× as expensive (or 10× as cheap) via anchor shift.

**Summary wording** (what players see): "X demand up" / "X demand down" — anchored to the player's mental model of demand spikes, not the internal multiplier.

See [events.md](./events.md) for the full modifier catalog and event definitions.

---

## How It Composes Each Tick

The per-market steps above sit inside a larger ordering. Each tick processes **one region** (round-robin); three processors touch its markets in sequence, and player trades layer on top in real time:

```
EVENTS       run first  - stock shocks (one-time jolts) + modifiers
   |                      (ongoing: scale production/consumption rates,
   |                      shift the anchor)
   v
ECONOMY      run second - per market: produce -> consume -> prosperity
   |                      scale -> noise -> clamp  (single stock value)
   v
TRADE FLOW   run third  - goods flow along edges by mid-price gradient,
   |                      moving a single stock delta from cheap to dear
   v
PROSPERITY   trade volume (edge flow + players) raises it toward booming;
             no trade decays it toward stagnant; events can force crisis

PLAYER TRADES  anytime (not tick-locked) - buy lowers stock, sell raises
               it (one stock delta); same per-market effect as a flow
```

Viewed another way, the simulation stacks four layers from static to real-time:

```
1  Base identity (static)      economy type -> produce/consume rates;
                               self-sufficiency -> import dependence;
                               traits -> per-good production bonuses;
                               government -> volatility, spread, boosts
2  Tick evolution (each tick)  self-limiting production/consumption,
                               prosperity, noise, clamp, edge flow
3  Disruptions (events)        shocks + modifiers temporarily change how
                               layer 2 behaves
4  Player agency (real-time)   trading on the edge-flow background;
                               sustained trade boosts prosperity
```

Edge-flow mechanics are detailed in [trade-simulation.md](./trade-simulation.md); this is just where it sits in the tick.

---

## Ship Prices & Progression

Ship prices are calibrated relative to trade margins to create a multi-stage progression:

| Ship | Price | Cargo | Role |
|---|---|---|---|
| Shuttle | 0 (starter) | 50 | Early T0 trading |
| Light Freighter | 25,000 | 80 | Upgraded T0/early T1 |
| Scout Skiff | 20,000 | 10 | Exploration |
| Interceptor | 35,000 | 15 | Combat |
| Bulk Freighter | 120,000 | 200 | Serious T1/T2 hauling |
| Corvette | 150,000 | 40 | Combat + opportunistic trade |
| Blockade Runner | 175,000 | 60 | Smuggling |
| Survey Vessel | 90,000 | 50 | Support |
| Heavy Freighter | 350,000 | 400 | Endgame hauling |
| Frigate | 450,000 | 30 | Fleet escort |
| Stealth Transport | 400,000 | 150 | Covert hauling |
| Command Vessel | 500,000 | 80 | Endgame support |

With T0 margins of ~5cr/unit and 50 cargo, a shuttle earns a few hundred cr/trip. Mixing in T1/T2 goods as capital grows shortens the climb to the next ship significantly.

---

## System Interactions

- **Events** inject economic shocks — one-time stock jolts (immediate stock deltas), rate multipliers (production/consumption scale), and **anchor shifts** (the sustained price lever: multiply a good's pricing anchor for the event's duration, raising or lowering where "mid price = base price" sits). Anchor shifts and stock shocks are distinct: a shock moves stock immediately; an anchor shift changes *what price a given stock level reads as* for as long as the event is active. Both are live every tick across all read paths (player trade, convoy, missions, price history snapshots, trade-flow gradient). (see [events.md](./events.md))
- **Trade missions** are generated from price extremes — high prices spawn import missions, low prices spawn export missions (see [trading.md](./trading.md))
- **Navigation danger** is partly driven by government danger baseline — affects cargo loss on arrival (see [navigation.md](./navigation.md))
- **Faction system** (planned) will add faction-specific economic modifiers and war-driven market disruption (see [faction-system.md](./faction-system.md))

---

## Design Rationale

### Why single-stock

The economy previously stored **two** independently-floating values per `(station, good)` — `supply` and `demand` — and priced as `basePrice × (demand / supply)`. That model carried a structural exploit and several awkwardnesses:

- **Snapshot pricing, no intra-trade slippage** — a trade's whole quantity executed at the single price computed *before* the trade, so a bulk buy never paid the rising prices it caused.
- **Instant buy→resell** — draining supply toward zero pinned price to the ceiling, and the player sold the same units straight back at that ceiling for a near risk-free profit.
- **Two free-floating numbers** — "demand" wasn't unmet need; it was a second mean-reverting value, so every event/government/prosperity modifier had to manipulate supply and demand targets in tandem to stay coherent.

The single-stock model replaces both numbers with one `stock` value from which price, trade limits, and the "demand" readout are all derived, and prices each trade at the **integrated average over the stock range it moves** (slippage) plus a **bid-ask spread `s`**. A same-station buy→sell then walks the identical curve segment down and back up — symmetric — so it always loses the spread, killing the round-trip *by construction* rather than by tuning a magic number. Cross-system profit is untouched: the geographic gap between two different systems' curves is the trade signal, restored every tick by production/consumption and spatial flow (see [Slippage](#slippage-intra-trade-pricing)).

This mirrors how comparable games solve it — slippage / marginal pricing (Mount & Blade, Elite) and a bid-ask spread (Port Royale, the finance no-arbitrage result) are the universal anti-exploit tools, and stock-based pricing where production/consumption directly move inventory is the X4 / Elite model.

---

## Related Systems

- **[Trade simulation](./trade-simulation.md)** — edge-flow inter-system trade that provides the spatial restoring force production/consumption alone lack.
