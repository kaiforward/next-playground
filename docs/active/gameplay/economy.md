# Economy System

The economy is a **single-stock** market simulation. Each `(station, good)` holds one value — `stock` — from which price, buy/sell rates, and the "how much can I trade" limits are all derived. Producers add stock (self-limiting near the ceiling), consumers drain it (self-limiting near the floor), and the spatial flow of goods between systems (trade-flow + player trades) is what separates cheap producer worlds from expensive consumer worlds. There is no second free-floating `demand` value and no mean-reversion — equilibrium emerges from production/consumption balance plus spatial flow. (Each market does store a static per-system **demand rate**, but it only sets where the pricing curve is centred — it never evolves and never moves stock.)

See [Design Rationale](#design-rationale) below for why this replaced the legacy dual supply/demand model and how it kills the instant buy→resell exploit.

---

## Goods

26 goods organized in 3 tiers. Tiers create a natural progression: cheap, deep-market goods for early game; expensive, thin-market goods for late game.

### Tier 0 — Raw Materials

Deep, liquid markets, thin per-unit margin. High population-driven demand gives them the deepest days-of-supply cover, so large trades barely move price. Cheap per unit, always available. A shuttle pilot with 500cr fills cargo with these.

| Good | Base Price | Volatility | Hazard | Price Range |
|---|---|---|---|---|
| Water | 25 | 0.5 | none | 0.5x-2.0x |
| Food | 30 | 0.7 | none | 0.5x-2.0x |
| Ore | 35 | 0.6 | none | 0.5x-2.0x |
| Textiles | 35 | 0.8 | none | 0.5x-2.0x |

### Tier 1 — Processed Goods

Medium-depth markets, moderate per-unit margin. Lower per-capita demand than staples → shallower cover → price reacts more to each trade. Better margin but needs more capital. Mid-game income.

| Good | Base Price | Volatility | Hazard | Price Range |
|---|---|---|---|---|
| Fuel | 35 | 1.0 | low | 0.5x-2.5x |
| Metals | 45 | 0.8 | none | 0.5x-2.5x |
| Chemicals | 55 | 1.2 | low | 0.5x-2.5x |
| Medicine | 65 | 1.5 | none | 0.5x-2.5x |

### Tier 2 — Advanced Goods

Thin, scarce markets, high per-unit price swing. Lowest per-capita demand → shallowest cover → a small trade swings price hard. Highest absolute margin per unit but can't fill cargo from one system. Late-game income — needs big capital AND multi-system routes.

| Good | Base Price | Volatility | Hazard | Price Range |
|---|---|---|---|---|
| Electronics | 80 | 1.0 | none | 0.5x-3.0x |
| Machinery | 100 | 0.8 | none | 0.5x-3.0x |
| Weapons | 120 | 2.0 | high | 0.5x-3.0x |
| Luxuries | 150 | 1.8 | none | 0.5x-3.0x |

### Per-System Pricing Reference (Days of Supply)

There is no per-good anchor table. The stock level at which a good's mid price equals its base price — its **reference** — is computed per `(station, good)` from local demand:

```
demandRate = max( perCapitaNeed(good) × population , MIN_DEMAND )
reference  = TARGET_COVER × demandRate × anchorMult
```

`TARGET_COVER` (40) is the **days of supply** — how many ticks of local consumption a market holds when it prices exactly at base. `demandRate` is the system's physical consumption rate for the good (see [Production & Consumption](#production--consumption)), floored at `MIN_DEMAND` so a near-empty system still yields a finite reference. `anchorMult` (default 1) carries active event anchor shifts (see [Event-Driven Anchor Shifts](#event-driven-anchor-shifts)). Stock above the reference reads cheap (surplus); below reads expensive (shortage).

The reference's *magnitude* sets the market's **depth**, and that depth now emerges from each system's own demand rather than a hand-tuned per-good number: high-demand staples get a high reference (deep, liquid market — large trades barely move price), low-demand advanced goods get a low reference (thin market — a small trade swings price hard). This is why the same price formula gives staples flat prices and advanced goods volatile ones.

`TARGET_COVER` is the single global pricing constant, **calibrated** via the simulator (`npm run simulate`): the chosen value maximises the minimum cross-system price dispersion across all twelve goods, so staples and advanced goods are both tradeable at once. Lower values pin advanced goods to the price floor (cheap everywhere); higher values pin staples to the ceiling (dear everywhere). Constants live in `lib/constants/market-economy.ts`; `demandRate` is stored on `StationMarket` and the reference is assembled in `curveForGood` (`lib/engine/market-pricing.ts`).

### Good Properties
Each good also has volume (1-2 cargo slots) and mass (0.5-2.5 kg) — stored in data but not currently enforced for cargo. Reserved for future use.

---

## Production & Consumption

Production and consumption are **physical** — they derive from each system's seeded industrial base and population, not from an economy-type rate table. Economy type is a derived display label (see [system-traits.md](./system-traits.md)).

**Production** — capacity-driven, computed per good `g` from the system's `SystemBuilding` rows (see [system-traits.md](./system-traits.md) §1.5):

```
production_g = Σ(buildings whose output good is g)  count × outputPerUnit × labourFulfillment
labourFulfillment = min(1, population / Σ(count × labourPerUnit))
```

`labourFulfillment` is one uniform system-wide ratio — population is the labour pool, and if labour demand exceeds population the whole industrial base operates below capacity. Key constraints by building tier:

- **Tier-0 extractors** — output goods are the eight tradeable raw materials (water, ore, food, …). Their building count is capped at world-gen by the system's body resource deposits and build space, so resource-rich bodies drive extractor capacity.
- **Tier-1+ manufacturers** — build-space and labour bound only. Each building type carries a `inputs` recipe, but **input gating is not yet applied** — a manufacturer produces its output at full `labourFulfillment` regardless of whether its input goods are in surplus. `[PENDING: supply-chain]`
- **Housing** — a non-production building type: it does not appear in production sums. Instead, `popCap = bodyBaseline + Σ(housing count × popProvided)`.

**Consumption** — universal and population-scaled, unchanged:
```
consRate = perCapitaNeed(good) × population
```
Every system consumes every good; higher tier → lower per-capita need. A system runs a positive **net balance** for a good when its production exceeds its consumption — that surplus is what flows out along trade routes.

**Emergent geography:** raw goods flow from deposit-rich frontier worlds toward populous cores; manufactured goods follow wherever build space and labour concentrate. Economy-type labels now reflect the build-space allocation at world-gen — a system seeded with more extractor capacity reads as `extraction`, one with heavier manufacturing allocation reads as `industrial` — rather than a coarse labour-only heuristic.

All `outputPerUnit` constants and per-capita needs are first-draft and **simulator-calibrated** — only their relative shape matters (higher tier → smaller output and smaller need). The government `consumptionBoost` layers on top of consumption; strike suppression scales production down when `unrest` exceeds the strike threshold.

### Market Seeding

At seed/reset time each market's starting stock is **cover-based** (`getInitialStock`, `lib/constants/market-economy.ts`): it places stock around the system's days-of-supply reference (`TARGET_COVER × demandRate`), scaled by a cover multiplier set by the good's net balance. Net balance is computed from the capacity-driven production rates above (using a `labourFactor` heuristic to approximate `labourFulfillment` at seed time) and population-scaled consumption. A net producer seeds with deeper cover (toward `SEED_COVER_MAX` → reads cheap), a net consumer with shallower cover (toward `SEED_COVER_MIN` → reads dear), and a balanced or inert market seeds at the reference (reads at base price). The producer share — `production / (production + consumption)` — blends continuously between the two, and the result is clamped to the [5, 200] stock band. Import dependence falls directly out of the substrate and the seeded industrial base.

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
reference = TARGET_COVER × demandRate × anchorMult
mid       = clamp( basePrice × (reference / stock) ^ k ,  floor, ceiling )
buyUnit   = mid × (1 + s)        (what the player pays)
sellUnit  = mid × (1 − s)        (what the player receives)
```
- `reference` — the per-system days-of-supply level where mid = base (see [Per-System Pricing Reference](#per-system-pricing-reference-days-of-supply)).
- `stock = reference` → mid = basePrice. Above → cheaper, below → more expensive. If stock ≤ 0, price hits the ceiling.
- `k` — elasticity exponent (steepness of the curve). Default **1** (reproduces the legacy hyperbola); higher `k` makes price react more sharply to the same stock gap.
- `s` — bid-ask half-spread. Default **0.05**, scaled by government (see above).
- `floor` / `ceiling` — per-good price multipliers on base price.

### Slippage (intra-trade pricing)
A trade of `q` units moves stock from `S` to `S∓q`, and price moves the whole way. The trade is priced at the **average of the curve over the stock range it moves**, not a flat pre-trade snapshot — each unit is priced at the midpoint of the stock step it causes (`tradeAvgMidPrice` in `lib/engine/market-pricing.ts`).

**Why round-trips don't profit:** a same-station buy→sell walks the identical curve segment down then back up (symmetric), so the player ends where they started minus the spread — a guaranteed small loss. Cross-system profit is untouched: buying at a surplus system walks a *low* segment of its curve, selling at a shortage system walks a *high* segment of a *different* curve. The geographic price gap is the profit; slippage only flattens prices *within* one station.

### Per-Tick Simulation (runs once per region per tick, round-robin)
Each good at each station is updated:

1. **Apply event modifiers** — active events apply one-time stock shocks, multiply production/consumption rates, or shift the pricing reference (`anchorMult`).
2. **Self-limiting production** — the system's substrate-derived production rate adds stock, scaled by `sqrt((MAX − stock) / (MAX − MIN))`. Near the ceiling, production approaches zero (warehouses full). Production is also scaled down by the **strike multiplier** — if the system's `unrest` is above the strike threshold, a smooth suppression factor reduces production output.
3. **Self-limiting consumption** — its population-scaled consumption rate removes stock, scaled by `sqrt((stock − MIN) / (MAX − MIN))`. Near the floor, consumption approaches zero (nothing left). Consumption is **never suppressed** by strikes — people still need goods even when workers walk out.
4. **Noise** — random walk scaled by good volatility and government modifier (base amplitude ±3 units).
5. **Clamp** — stock bounded to [5, 200].

There is no mean-reversion step and no demand axis — both are gone from the single-stock model.

### Key Parameters
| Parameter | Value | Effect |
|---|---|---|
| Elasticity `k` | 1 | Curve steepness (price reaction to stock gap) |
| Bid-ask spread `s` | 0.05 base | Buy/sell gap; scaled by government; makes round-trips lose |
| Noise amplitude | ±3 base | Micro-volatility, scaled by volatility × government |
| Min/max stock | 5 / 200 | Stock bounds (ceiling price at MIN, floor price at MAX) |
| Production rate | capacity-driven | `Σ count × outputPerUnit × labourFulfillment`; scaled by self-limiting + strike suppression |
| Consumption rate | population-scaled | `perCapitaNeed × population`; scaled by self-limiting only (never strike-suppressed) |
| Price history | Rolling window | Snapshots recorded periodically (`lib/engine/snapshot.ts`) |

### Population, Unrest, and Strikes

Each system has a **`population`** (a Float magnitude) that is now dynamic — it grows, declines, and migrates. Population drives the system-wide `labourFulfillment` ratio (labour pool for the seeded industrial base) and consumption demand (`perCapitaNeed × population`). As population moves, the stored `demandRate` per market is rewritten each tick to reflect the new level.

**Unrest (`unrest`, 0…1)** accumulates from unmet need. Each economy tick the processor records per-good satisfaction (`delivered / demanded`) for each system it processes. The population processor then computes a convex, demand-weighted dissatisfaction value `D` — where a deep food shortage dominates many shallow ones because food's demand weight is ~8× a luxury's — and integrates it:

```
D       = Σ_g  demandShare_g · (1 − satisfaction_g)²
unrest ← clamp(unrest + k·D − decay·unrest, 0, 1)
```

Chronic unmet demand climbs unrest; relief decays it. This is an integral over time — one bad tick is harmless; sustained shortage crosses the thresholds.

**Strikes** are derived each tick from `unrest` (no separate stored flag): above the strike threshold, a smooth suppression multiplier scales down production output only. People still consume — consumption is never suppressed. The strike state feeds back into the next economy tick's production.

**Growth / decline** is logistic: population grows toward `popCap` when the system is well-fed and calm, and declines under starvation or high unrest. The existing SP1 seeding placed all systems below `popCap`, giving headroom.

**Stability** is the public-facing readout of `unrest`, rendered as a choropleth map mode and a per-system badge. It is the SP2 replacement for the former prosperity choropleth — same pipeline, new source.

The system screen surfaces dynamic population and stability through two views, both tick-invalidated (separate from the static Astrography/substrate read, which is `staleTime: Infinity`):

- **Population tab** — shows the current population magnitude, `popCap` utilisation, unrest/stability (via the stability badge), current strike state, and a per-good demand footprint (how each good's consumption demand distributes across the population).
- **Overview stability row** — a quick stability badge on the system Overview, so the current unrest level is visible without switching tabs.

> **Prosperity is retired.** The former `prosperity` value (a trade-volume proxy for supply-response scaling, 0.3× crisis to 1.3× booming) is removed. SP1 already moved the smooth supply response onto `population` (`labourFactor`), so the proxy became redundant. Population is now the smooth health channel; `unrest` is the consequence channel.

### Event-Driven Anchor Shifts

Events can shift a good's **pricing reference** (the anchor) — the stock level at which mid price equals base price. This is distinct from a one-time stock shock (which moves stock immediately and persistently); an anchor shift changes *what price a given stock level reads as* for the duration of the event, without touching stock itself.

**Modifier**: `anchor_shift` (`parameter: "target_stock"`). The value is a **multiplier** (`anchorMult`) applied to the per-system reference:
- `> 1` — raises the reference → goods read as scarcer → higher prices ("demand spike")
- `< 1` — lowers the reference → goods read as more plentiful → cheaper prices
- `= 1` — no change (identity)
- `goodId: null` — applies to all goods at the target station; setting a specific `goodId` targets one good only
- Multiple active shifts on the same good **compound** (multiply together)

**Storage and write path**: The economy processor computes the net multiplier from all active `anchor_shift` modifiers on a system's events each tick (same round-robin cadence as `stock`) and writes it to **`StationMarket.anchorMult`** (default `1`). Reads are pure: `curveForGood` folds `anchorMult` into the reference (`TARGET_COVER × demandRate × anchorMult`) before evaluating the price curve, so the shift flows automatically through every price read path — player trade, convoy, missions, market display, cross-system comparison, price-history snapshots, and trade-flow gradient.

**Safety cap**: `anchorMult` is clamped to **[0.1, 4.0]** — a single good can at most become 4× as expensive (or 10× as cheap) via anchor shift.

**Summary wording** (what players see): "X demand up" / "X demand down" — anchored to the player's mental model of demand spikes, not the internal multiplier.

See [events.md](./events.md) for the full modifier catalog and event definitions.

---

## How It Composes Each Tick

The per-market steps above sit inside a larger ordering — the logical sequence each market's state moves through every tick. The **economy** processor settles **one region**'s markets per tick (round-robin), and **event** modifiers plus player trades layer on top in real time. The **trade-flow** processor sweeps a work-budget slice of the **intra-faction** edge graph each tick (region lines ignored, faction borders closed; see [trade-simulation.md](./trade-simulation.md)). Two additional processors — **population** and **migration** — run after economy and complete the consequence loop:

```
EVENTS       run first  - stock shocks (one-time jolts) + modifiers
   |                      (ongoing: scale production/consumption rates,
   |                      shift the pricing reference)
   v
ECONOMY      run second - per market: apply event modifiers -> produce
   |                      (scaled by strike suppression if unrest high)
   |                      -> consume -> noise -> clamp (single stock value)
   |                      records per-system satisfaction (delivered/demanded)
   |                      via ctx.results for the population processor
   v
TRADE FLOW   run third  - goods flow along open intra-faction edges
   |                      (region lines ignored, borders closed),
   |                      distance-attenuated, by mid-price gradient;
   |                      a single stock delta moves cheap -> dear
   v
POPULATION   run fourth - reads per-system satisfaction from ctx.results;
   |                      integrates unrest (D formula); applies growth/decline;
   |                      rewrites demandRate for new population level
   v
MIGRATION    run fifth  - relocates population (conserved) along the same
                          intra-faction open-edge topology + work-budget slice;
                          population flows down-unrest / up-headroom,
                          distance-attenuated (gateways throttle both flows)

PLAYER TRADES  anytime (not tick-locked) - buy lowers stock, sell raises
               it (one stock delta); same per-market effect as a flow
```

The economy→population **satisfaction handoff** (`ctx.results`) is purely in-memory and transient — it is not persisted to the database and not broadcast to clients. It carries the per-system `delivered_g / demanded_g` measurements the economy tick records internally, which the population processor consumes in the same tick to update `unrest` and population.

Viewed another way, the simulation stacks four layers from static to real-time:

```
1  Base identity (static)      bodies (resources + population) + seeded
                               industrial base (SystemBuilding counts, buildSpace)
                               -> per-good production rates (capacity-driven);
                               population-scaled consumption rates;
                               demand rate -> days-of-supply pricing reference;
                               net balance -> seed stock + import dependence;
                               government -> volatility, spread, boosts
2  Tick evolution (each tick)  self-limiting production/consumption,
                               strike suppression (from unrest), noise,
                               clamp, edge flow, population growth/decline,
                               migration, demandRate rewrite
3  Disruptions (events)        shocks + modifiers temporarily change how
                               layer 2 behaves
4  Player agency (real-time)   trading on the edge-flow background
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

- **Events** inject economic shocks — one-time stock jolts (immediate stock deltas), rate multipliers (production/consumption scale), and **anchor shifts** (the sustained price lever: multiply a good's per-system pricing reference for the event's duration, raising or lowering where "mid price = base price" sits). Anchor shifts and stock shocks are distinct: a shock moves stock immediately; an anchor shift changes *what price a given stock level reads as* for as long as the event is active. Both are live every tick across all read paths (player trade, convoy, missions, price history snapshots, trade-flow gradient). (see [events.md](./events.md))
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
