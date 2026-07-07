# Economy System

The economy is a **single-stock** market simulation. Each `(station, good)` holds one value — `stock` — from which price, buy/sell rates, and the "how much can I trade" limits are all derived. Producers add stock (self-limiting near the ceiling), consumers drain it (self-limiting near the floor), and the spatial flow of goods between systems (trade-flow + player trades) is what separates cheap producer worlds from expensive consumer worlds. There is no second free-floating `demand` value and no mean-reversion — equilibrium emerges from production/consumption balance plus spatial flow. (Each market does store a static per-system **demand rate**, but it only sets where the pricing curve is centred — it never evolves and never moves stock.)

See [Design Rationale](#design-rationale) below for why this replaced the legacy dual supply/demand model and how it kills the instant buy→resell exploit.

---

## Goods

26 goods organized in 3 tiers. The tiers form a **production chain**: tier-0 raw materials are extracted from body resource deposits, and each tier-1/2 good is manufactured from a recipe of lower-tier inputs (see [Supply Chain & Input-Gating](#supply-chain--input-gating)). The chain also drives the trade progression — cheap, deep-market raw goods for early game; expensive, thin-market manufactured goods for late game.

### Tier 0 — Raw Materials (8)

Deep, liquid markets, thin per-unit margin. High population-driven demand gives them the deepest days-of-supply cover, so large trades barely move price. Cheap per unit, always available. A shuttle pilot with 500cr fills cargo with these. Each tier-0 good is **extracted** from a body resource deposit (no recipe) — Water/Gas/Ore/Minerals/Biomass/Radioactives map 1:1 to their resource; Food and Textiles both come from the `arable` resource.

| Good | Base Price | Volatility | Price Range |
|---|---|---|---|
| Water | 25 | 0.5 | 0.5x-2.0x |
| Food | 30 | 0.7 | 0.5x-2.0x |
| Gas | 30 | 0.7 | 0.5x-2.0x |
| Biomass | 32 | 0.6 | 0.5x-2.0x |
| Ore | 35 | 0.6 | 0.5x-2.0x |
| Textiles | 35 | 0.8 | 0.5x-2.0x |
| Minerals | 40 | 0.8 | 0.5x-2.0x |
| Radioactives | 50 | 1.2 | 0.5x-2.0x |

### Tier 1 — Processed Goods (10)

Medium-depth markets, moderate per-unit margin. Lower per-capita demand than staples → shallower cover → price reacts more to each trade. Better margin but needs more capital. Mid-game income. Each is manufactured from a recipe of tier-0 (and one tier-1) inputs.

| Good | Base Price | Volatility | Price Range | Inputs (per output) |
|---|---|---|---|---|
| Fuel | 35 | 1.0 | 0.5x-2.5x | Gas 1 |
| Metals | 45 | 0.8 | 0.5x-2.5x | Ore 1 |
| Polymers | 48 | 0.7 | 0.5x-2.5x | Gas 0.5, Biomass 0.5 |
| Chemicals | 55 | 1.2 | 0.5x-2.5x | Gas 0.5, Minerals 0.5 |
| Consumer Goods | 55 | 0.6 | 0.5x-2.5x | Textiles 0.5, Polymers 0.5 |
| Alloys | 60 | 0.8 | 0.5x-2.5x | Metals 0.6, Minerals 0.4 |
| Medicine | 65 | 1.5 | 0.5x-2.5x | Biomass 0.5, Chemicals 0.5 |
| Components | 70 | 0.9 | 0.5x-2.5x | Minerals 0.5, Metals 0.5 |
| Hull Plating* | 70 | 0.9 | 0.5x-2.5x | Metals 0.5, Alloys 0.5 |
| Munitions* | 75 | 1.3 | 0.5x-2.5x | Metals 0.5, Chemicals 0.5 |

### Tier 2 — Advanced Goods (8)

Thin, scarce markets, high per-unit price swing. Lowest per-capita demand → shallowest cover → a small trade swings price hard. Highest absolute margin per unit but can't fill cargo from one system. Late-game income — needs big capital AND multi-system routes.

| Good | Base Price | Volatility | Price Range | Inputs (per output) |
|---|---|---|---|---|
| Electronics | 80 | 1.0 | 0.5x-3.0x | Components 0.6, Chemicals 0.4 |
| Machinery | 100 | 0.8 | 0.5x-3.0x | Metals 0.5, Components 0.5 |
| Weapons* | 120 | 2.0 | 0.5x-3.0x | Metals 0.4, Chemicals 0.3, Munitions 0.3 |
| Targeting Arrays* | 140 | 1.0 | 0.5x-3.0x | Electronics 0.6, Components 0.4 |
| Luxuries | 150 | 1.8 | 0.5x-3.0x | Consumer Goods 0.5, Electronics 0.5 |
| Weapons Systems* | 160 | 1.5 | 0.5x-3.0x | Electronics 0.4, Munitions 0.3, Hull Plating 0.3 |
| Reactor Cores* | 170 | 1.2 | 0.5x-3.0x | Radioactives 0.4, Alloys 0.3, Components 0.3 |
| Ship Frames* | 180 | 1.0 | 0.5x-3.0x | Hull Plating 0.4, Alloys 0.3, Components 0.3 |

\* **Military-tagged** dual-use goods. They trade on the open market with ordinary civilian demand today; a strategic war-demand channel (and the tier-3 non-market military *assets* they feed) is planned for the faction-agency and war layers. **Bottleneck goods** — Components (5 downstream recipes), Metals (near-universal), Alloys, and Electronics — sit on the most chains, so a shortage in one cascades widest.

### Per-System Pricing Reference (Days of Supply)

There is no per-good anchor table. The stock level at which a good's mid price equals its base price — its **reference** — is computed per `(station, good)` from local demand:

```
demandRate = max( perCapitaNeed(good) × population  +  Σ production-input draw , MIN_DEMAND )
reference  = TARGET_COVER × demandRate × anchorMult
```

`TARGET_COVER` (40) is the **days of supply** — how many ticks of local demand a market holds when it prices exactly at base. `demandRate` is the system's **total** physical demand rate for the good — civilian consumption (`perCapitaNeed × population`) **plus** the production-input draw of every local building that consumes the good as a recipe input (see [Supply Chain & Input-Gating](#supply-chain--input-gating)) — floored at `MIN_DEMAND` so a near-empty system still yields a finite reference. Including the input term is what makes an input-heavy good price honestly: a refinery world's Ore reads *scarce* when its Smelters' draw outruns supply (pulling Ore in via trade), rather than cheap just because the world burns a lot of it. `anchorMult` (default 1) carries active event anchor shifts (see [Event-Driven Anchor Shifts](#event-driven-anchor-shifts)). Stock above the reference reads cheap (surplus); below reads expensive (shortage).

The reference's *magnitude* sets the market's **depth**, and that depth now emerges from each system's own demand rather than a hand-tuned per-good number: high-demand staples get a high reference (deep, liquid market — large trades barely move price), low-demand advanced goods get a low reference (thin market — a small trade swings price hard). This is why the same price formula gives staples flat prices and advanced goods volatile ones.

`TARGET_COVER` is the single global pricing constant, **calibrated** via the simulator (`npm run simulate`): the chosen value maximises the minimum cross-system price dispersion across all 26 goods, so staples and advanced goods are both tradeable at once. Lower values pin advanced goods to the price floor (cheap everywhere); higher values pin staples to the ceiling (dear everywhere). Constants live in `lib/constants/market-economy.ts`; `demandRate` is stored on `WorldMarket` and the reference is assembled in `curveForGood` (`lib/engine/market-pricing.ts`).

### Good Properties
Each good also has volume (1-2 cargo slots) and mass (0.5-2.5 kg) — stored in data but not currently enforced for cargo. Reserved for future use.

---

## Production & Consumption

Production and consumption are **physical** — they derive from each system's seeded industrial base and population, not from an economy-type rate table. Economy type is a derived display label (see [system-traits.md](./system-traits.md)).

**Production** — capacity-driven and **input-gated**, computed per good `g` from the system's `WorldBuilding` rows (see [system-traits.md](./system-traits.md) §1.5):

```
production_g = Σ(buildings whose output good is g)  count × outputPerUnit × labourFulfillment × inputGate_g × yield_g
labourFulfillment = min(1, population / Σ(count × labourPerUnit))
yield_g           = system yieldMult[resource(g)]  for tier-0 extractables, else 1
```

`labourFulfillment` is one uniform system-wide ratio — population is the labour pool, and if labour demand exceeds population the whole industrial base operates below capacity. `inputGate_g` is the recipe-input availability throttle (always 1 for tier-0; see [Supply Chain & Input-Gating](#supply-chain--input-gating)). Key constraints by building tier:

- **Tier-0 extractors** — output goods are the eight tradeable raw materials (water, ore, gas, …), each extracted from a body resource deposit with no recipe (`inputGate = 1`). Their building count is capped at world-gen by the system's **deposit slots** (a per-resource extractor ceiling), and their output is scaled by the resource's **yield multiplier** (`yieldMult`, the mean quality of the filled slots) — so both how *much* (slots) and how *rich* (quality) a body's deposits are drive extraction. See [the available-space substrate model](./economy-substrate-v2-available-space.md).
- **Tier-1+ manufacturers** — bounded by **general space** and labour, **and input-gated**: each building type carries an `inputs` recipe and draws those inputs from local market stock each tick. A manufacturer short of any input throttles its output proportionally (`inputGate_g < 1`), so shortages cascade down the chain. See [Supply Chain & Input-Gating](#supply-chain--input-gating).
- **Population centres** (the `housing` building type) — a non-production type: they do not appear in production sums. Instead `popCap = Σ(pop-centre count × POP_CENTRE_DENSITY)`, sourced **entirely from built centres** on a body's habitable land — there is no body baseline (the v1 `bodyBaselinePopCap` is retired). Centres are sized at seed to staff the system's labour demand, but their `count` is no longer frozen — both it and the `popCap` it yields are **downward-mutable**, recomputed live each economy shard from the surviving housing (see [Infrastructure Decay](#infrastructure-decay)). See [system-traits.md](./system-traits.md) §1.4.

**Consumption** — two channels drain each good's stock:

1. **Civilian** — universal and population-scaled: `consRate = perCapitaNeed(good) × population`. Every system consumes every good; higher tier → lower per-capita need.
2. **Production-input** — each tier-1+ building draws its recipe inputs from local stock (the cascade; see below). This channel is what finally activates the four once-inert resources — gas, minerals, biomass, radioactives — that nothing consumed until they fed a recipe.

A system runs a positive **net balance** for a good when its production exceeds total (civilian + production-input) consumption — that surplus is what flows out along trade routes.

**Emergent geography:** raw goods flow from deposit-rich frontier worlds toward populous cores; manufactured goods follow wherever build space and labour concentrate. Economy-type labels now reflect the build-space allocation at world-gen — a system seeded with more extractor capacity reads as `extraction`, one with heavier manufacturing allocation reads as `industrial` — rather than a coarse labour-only heuristic.

All `outputPerUnit` constants and per-capita needs are first-draft and **simulator-calibrated** — only their relative shape matters (higher tier → smaller output and smaller need). The government `consumptionBoost` layers on top of consumption; strike suppression scales production down when `unrest` exceeds the strike threshold.

### Infrastructure Decay

`WorldBuilding.count` is no longer seed-frozen. A dedicated **infrastructure-decay** processor runs each economy shard (right after economy commits, before population) and mutates `count` **downward only**, toward what is actively *used* — the gap between *built* and *used* is what rots:

- **"Used" per role.** Housing → occupancy `population / POP_CENTRE_DENSITY`; production/extraction → staffed *and* selling `count × min(labourFulfillment, outputUptake)`. `outputUptake(stock, minStock, maxStock)` (in `lib/engine/tick.ts`) is the seller-side mirror of satisfaction — ~1 when output sells freely at the floor, → 0 as it piles against the storage ceiling.
- **Disuse decay (gentle).** `count ← count − disuseRate · max(0, count − used)`. A small `disuseRate` is itself the hysteresis — one idle shard sheds only a sliver; only a *sustained* gap compounds down.
- **Unrest decay (catastrophic).** Above θ_decay, working capacity is torn down even while in use: `count ← count − unrestRate · count · max(0, unrest − θ_decay)` — the infrastructure mirror of the population-decline term, the snowball.

`count` never rises here (growth is a deliberate, treasury-funded decision deferred to the faction-agency layer) and never drops below 0. Because housing `count` changes, **`popCap` recomputes live** each shard (`Σ housing.count × POP_CENTRE_DENSITY`), and the population processor reads that live value. When housing has rotted *below* its occupants (`population > popCap`, the unrest-snowball case), the overshoot is displaced as **unrest-weighted migration ⊕ death** (the non-conserved death term `overshootDeathRate · overshoot · unrest` in `populationDelta`; the conserved flee-half rides the migration processor, which already repels high-unrest systems). The full model and the Industry-panel surface (available · built · in-use, health-coloured) live in [economy-infrastructure-decay.md](./economy-infrastructure-decay.md).

### Supply Chain & Input-Gating

Tier-1+ production is **input-gated**: each manufacturing building draws its recipe inputs from the system's *local* market stock every tick, and its output is throttled by whichever input is scarcest. This is what turns 26 independent markets into a coupled **chain** — cut the supply of an input and the downstream good throttles in sequence.

The cascade runs **per system, each tick**, with goods processed in **recipe-topological order** — every good after all of its inputs (a Kahn sort over the recipe graph, `PRODUCTION_GOOD_ORDER`), which subsumes the coarse T0→T1→T2 ordering and handles intra-tier edges like metals→alloys→hull_plating. Topological order means a tier-0 output produced this tick is available to its tier-1 consumer the *same* tick. For each producing good `g`:

1. **Desired draw** of each input `i` = `effectiveProduction_g × inputs_g[i]`.
2. **`inputGate_g` = min over inputs of `drawable_i / desired_i`**, clamped to `[0, 1]`. The scarcest input sets the throttle: a Smelter with only half the Ore it wants produces at half capacity.
3. **Output added** to local stock = `effectiveProduction_g × inputGate_g × ceiling`, where `ceiling` is the existing self-limiting `sqrt` factor (warehouses-full damping).
4. **Inputs drawn** from local stock in proportion to *actual* output (`inputs_g[i] × actualOutput`) — you only consume what you actually convert.

**Drawable-above-floor rule.** "Drawable" stock is `max(0, stock − minStock)` — only stock above the market's own scarcity reserve (`minStock`, the per-market price-floor level; see [Market Pricing Band](#market-pricing-band-per-market-stock-range)) can be drawn down by a recipe. Because the gate is computed against drawable stock and inputs drain in proportion to it, every input stays at or above its reserve *by construction* — no re-clamp is needed, and a consumer can never mine its input below the reserve and pin that input's own price to the ceiling.

Inputs come from *local* stock, which trade flow refills from cheaper neighbours (unchanged). So a refinery world with no Ore deposits still runs its Smelters as long as Ore flows in — and **cutting that lane starts the downstream cascade**, grounded in the existing trade-flow lever. The marquee emergent behaviours — need-cascade, lane-cut cascade, over-industrialise-a-garden-world-and-it-can-no-longer-feed-itself — all fall out of this loop composed with the population/unrest dynamics, with the industrial base **static** (seeded at world-gen; runtime construction is a later agency layer). The cascade engine is pure (`lib/engine/supply-chain.ts`, shared by the live tick and the simulator).

### Market Seeding

At seed/reset time each market's starting stock is **cover-based** (`getInitialStock`, `lib/constants/market-economy.ts`): it places stock around the system's days-of-supply reference (`TARGET_COVER × demandRate`), scaled by a cover multiplier set by the good's net balance. Net balance is computed from the capacity-driven production rates above and population-scaled consumption. A net producer seeds with deeper cover (toward `SEED_COVER_MAX` → reads cheap), a net consumer with shallower cover (toward `SEED_COVER_MIN` → reads dear), and a balanced or inert market seeds at the reference (reads at base price). The producer share — `production / (production + consumption)` — blends continuously between the two, and the result is clamped to the market's own **per-market band** (see [Market Pricing Band](#market-pricing-band-per-market-stock-range)) — so a heavy producer with deep storage seeds genuinely deep and cheap. Import dependence falls directly out of the substrate and the seeded industrial base.

---

## Government Types

All 8 government types are implemented. Every type has trade-offs — buffs balanced by debuffs. Source of truth: `lib/constants/government.ts`. For faction and identity framing see [faction-system.md](./faction-system.md).

| Government | Volatility | Eq. Spread | Danger | Consumption boosts |
|---|---|---|---|---|
| Federation | 0.8× | -10% | 0.00 | medicine |
| Corporate | 0.9× | -5% | 0.02 | luxuries |
| Authoritarian | 0.7× | -15% | 0.00 | weapons, fuel |
| Frontier | 1.5× | +20% | 0.10 | — |
| Cooperative | 0.7× | -10% | 0.00 | food, medicine |
| Technocratic | 1.0× | +5% | 0.01 | electronics |
| Militarist | 1.3× | +10% | 0.05 | weapons, fuel, machinery |
| Theocratic | 0.8× | -5% | 0.03 | food, medicine, textiles |

### Government Effects on Gameplay
- **Volatility modifier**: Scales price-noise amplitude. Frontier = wild swings, authoritarian = smooth predictability.
- **Spread modifier** (`equilibriumSpreadPct`): Scales the **bid-ask half-spread** `s` — the gap between buy and sell price. Frontier widens it (+20% → bigger round-trip cost / wider quotes), authoritarian tightens it (-15%). Replaces the legacy supply/demand-band spread now that there is a single stock value.
- **Danger baseline**: Feeds the system danger readout (world attribute — nothing mechanical consumes it since the arrival pipeline was cut). Frontier is the highest at 10%.
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

### Market Pricing Band (per-market stock range)

The `[minStock, maxStock]` band each market's `stock` lives in is **per-market**, derived from the same `WorldMarket` row the price curve reads — replacing the legacy global `[5, 200]`. It splits two jobs an absolute band conflated and gives each its natural driver: **demand prices the market; built infrastructure sets its depth.**

```
demandRate  = max( perCapitaNeed × population + production-input draw , MIN_DEMAND )
targetStock = TARGET_COVER × demandRate × anchorMult        // the anchor — ≡ the pricing reference above
minStock    = targetStock / priceCeiling ^ (1/k)            // scarcity reserve: buying stops, price ceilings out
maxStock    = targetStock / priceFloor ^ (1/k)              // demand headroom — guarantees the full price range
            + Σ_buildings ( count × storagePerUnit[building → good] )   // infrastructure depth & liquidity
```

- **Demand-derived floor & anchor.** `minStock` is a *reserve*, not zero — a player buys everything above it (`stock − minStock`); as stock falls toward it, price climbs to the ceiling and the market holds its last reserve. Both `minStock` and `targetStock` scale with population, so the price point and the scarcity threshold track local demand.
- **Infrastructure-derived ceiling.** `maxStock` is a demand-headroom term (which alone guarantees every market spans its *entire* price curve, so pricing never runs clipped) **plus the sum of storage its buildings provide** (`facilityStorageForGood`, `lib/engine/industry.ts`): extractors and factories store what they handle, population centres hold nominal retail stock (generous on consumer-facing goods). This is what makes a low-population **mega-mine cheap *and* liquid** — huge ore storage lets ore pile high (→ price floors → cheap) against a tiny demand reserve (→ nearly all of it buyable). The storage sum is denormalised onto `WorldMarket.storageCapacity` at seed (recomputed on build-out in SP5), so the band derives from the market row alone.

This restores the cover model's intended invariant — **same days-of-cover → same price regardless of system size** (a huge world holding 1600 food against 20/tick and a tiny outpost holding 80 against 1/tick both sit at 80 days of cover and price identically). It fixes the motivating bug: the global band was *absolute* while the anchor *scales with population*, so on a big world the anchor outgrew the band, stock could never reach it, and the galaxy's biggest food producer read as food-*expensive*. It also yields a free progression arc — an undeveloped system is a thin, swingy market; as build-out (SP5) deepens its storage, its markets become liquid hubs. `marketBand` (`lib/engine/market-pricing.ts`) is the single source of truth; `maxStock > minStock` is guaranteed structurally by the demand-headroom term. The bid-ask spread and buy/sell symmetry that block the resell exploit depend on the *curve*, not the band, and are unchanged.

### Slippage (intra-trade pricing)
A trade of `q` units moves stock from `S` to `S∓q`, and price moves the whole way. The trade is priced at the **average of the curve over the stock range it moves**, not a flat pre-trade snapshot — each unit is priced at the midpoint of the stock step it causes (`tradeAvgMidPrice` in `lib/engine/market-pricing.ts`).

**Why round-trips don't profit:** a same-station buy→sell walks the identical curve segment down then back up (symmetric), so the player ends where they started minus the spread — a guaranteed small loss. Cross-system profit is untouched: buying at a surplus system walks a *low* segment of its curve, selling at a shortage system walks a *high* segment of a *different* curve. The geographic price gap is the profit; slippage only flattens prices *within* one station.

### Per-Tick Simulation (runs once per economy-shard update)
The economy processor groups the shard's markets **by system** and runs the coupled cascade on each (`simulateCoupledEconomyTick`). Within a system goods are processed in recipe-topological order so a fresh input feeds its consumer the same tick; each good's stock is updated:

1. **Apply event modifiers** — active events apply one-time stock shocks, multiply production/consumption rates, or shift the pricing reference (`anchorMult`).
2. **Input-gated, self-limiting production** — the building-capacity production rate is throttled by `inputGate` (recipe-input availability; 1 for tier-0), then by the self-limiting `sqrt((MAX − stock) / (MAX − MIN))` ceiling. Near the ceiling, production approaches zero (warehouses full). Production is also scaled down by the **strike multiplier** — if the system's `unrest` is above the strike threshold, a smooth suppression factor reduces output. The recipe inputs are then drawn from local stock in proportion to actual output (drawable-above-floor; see [Supply Chain & Input-Gating](#supply-chain--input-gating)).
3. **Self-limiting consumption** — its population-scaled civilian consumption rate removes stock, scaled by `sqrt((stock − MIN) / (MAX − MIN))`. Near the floor, consumption approaches zero (nothing left). Consumption is **never suppressed** by strikes — people still need goods even when workers walk out.
4. **Noise** — random walk scaled by good volatility and government modifier, sized as a **fraction of the market's own band width** (`NOISE_FRACTION × (maxStock − minStock)`), so the jitter is proportional everywhere — negligible drift on a deep market, the same relative wobble on a thin one (the old absolute `±3` was negligible on a wide band and overwhelming on a small one).
5. **Clamp** — stock bounded to the market's per-market `[minStock, maxStock]` band.

There is no mean-reversion step and no demand axis — both are gone from the single-stock model.

### Key Parameters
| Parameter | Value | Effect |
|---|---|---|
| Elasticity `k` | 1 | Curve steepness (price reaction to stock gap) |
| Bid-ask spread `s` | 0.05 base | Buy/sell gap; scaled by government; makes round-trips lose |
| Noise fraction | `NOISE_FRACTION` (≈0.02) of band width | Micro-volatility, relative to each market's band, scaled by volatility × government |
| Stock band | per-market `[minStock, maxStock]` | Demand-derived floor reserve + infrastructure-derived ceiling (see [Market Pricing Band](#market-pricing-band-per-market-stock-range)) |
| Production rate | capacity-driven, input-gated | `Σ count × outputPerUnit × labourFulfillment × inputGate`; scaled by self-limiting + strike suppression |
| Consumption rate | civilian + production-input | civilian `perCapitaNeed × population` (self-limiting, never strike-suppressed) + tier-1+ recipe-input draw from local stock |
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

**Growth / decline** is logistic with **symmetric** growth/decline rates: population grows toward `popCap` when the system is well-fed and calm, and declines under high unrest. Seeding places systems below `popCap` (population is a **continuous magnitude** — a tiny outpost seeds at e.g. `pop 0.3`, never rounded to a false 0), so the live tick ramps each up toward its labour-staffing cap and then holds. Today growth is gated mainly by housing-headroom × satisfaction; making it track economic *viability* (can the world feed/employ its people) is the booked **SP4 phase** "Population ← economic viability" (see [available-space model](./economy-substrate-v2-available-space.md) and [economy-simulation-vision.md](../../planned/economy-simulation-vision.md) §13).

**Stability** is the public-facing readout of `unrest`, rendered as a choropleth map mode and a per-system badge. It is the SP2 replacement for the former prosperity choropleth — same pipeline, new source.

The system screen surfaces dynamic population and stability through two views, both tick-invalidated (separate from the static Astrography/substrate read, which is `staleTime: Infinity`):

- **Population tab** — shows the current population magnitude, `popCap` utilisation, unrest/stability (via the stability badge), current strike state, and a per-good demand footprint (how each good's consumption demand distributes across the population).
- **Overview stability row** — a quick stability badge on the system Overview, so the current unrest level is visible without switching tabs.

> **Prosperity is retired.** The former `prosperity` value (a trade-volume proxy for supply-response scaling, 0.3× crisis to 1.3× booming) is removed. SP1 already moved the smooth supply response onto `population` (via `labourFulfillment`), so the proxy became redundant. Population is now the smooth health channel; `unrest` is the consequence channel.

### Event-Driven Anchor Shifts

Events can shift a good's **pricing reference** (the anchor) — the stock level at which mid price equals base price. This is distinct from a one-time stock shock (which moves stock immediately and persistently); an anchor shift changes *what price a given stock level reads as* for the duration of the event, without touching stock itself.

**Modifier**: `anchor_shift` (`parameter: "target_stock"`). The value is a **multiplier** (`anchorMult`) applied to the per-system reference:
- `> 1` — raises the reference → goods read as scarcer → higher prices ("demand spike")
- `< 1` — lowers the reference → goods read as more plentiful → cheaper prices
- `= 1` — no change (identity)
- `goodId: null` — applies to all goods at the target station; setting a specific `goodId` targets one good only
- Multiple active shifts on the same good **compound** (multiply together)

**Storage and write path**: The economy processor computes the net multiplier from all active `anchor_shift` modifiers on a system's events each tick (same shard cadence as `stock`) and writes it to **`WorldMarket.anchorMult`** (default `1`). Reads are pure: `curveForGood` folds `anchorMult` into the reference (`TARGET_COVER × demandRate × anchorMult`) before evaluating the price curve, so the shift flows automatically through every price read path — market display, cross-system comparison, and trade-flow gradient.

**Safety cap**: `anchorMult` is clamped to **[0.1, 4.0]** — a single good can at most become 4× as expensive (or 10× as cheap) via anchor shift.

**Summary wording** (what players see): "X demand up" / "X demand down" — anchored to the player's mental model of demand spikes, not the internal multiplier.

See [events.md](./events.md) for the full modifier catalog and event definitions.

---

## How It Composes Each Tick

The per-market steps above sit inside a larger ordering — the logical sequence each market's state moves through every tick. The **economy** processor processes its shard of systems each tick (every system refreshes every `ECONOMY_UPDATE_INTERVAL` ticks), and **event** modifiers plus player trades layer on top in real time. The **trade-flow** processor sweeps its fixed-interval edge shard each tick (region lines ignored, faction borders closed; see [trade-simulation.md](./trade-simulation.md)). Two additional processors — **population** and **migration** — run after economy and complete the consequence loop:

```
EVENTS       run first  - stock shocks (one-time jolts) + modifiers
   |                      (ongoing: scale production/consumption rates,
   |                      shift the pricing reference)
   v
ECONOMY      run second - per system (markets grouped, recipe-topological
   |                      order): apply event modifiers -> input-gated produce
   |                      (throttled by recipe inputs + strike suppression if
   |                      unrest high) -> draw recipe inputs from local stock
   |                      -> consume -> noise -> clamp (single stock value);
   |                      records per-system satisfaction (delivered/demanded)
   |                      via ctx.results for the population processor
   v
TRADE FLOW   run third  - goods flow along open intra-faction edges
   |                      (region lines ignored, borders closed),
   |                      distance-attenuated, by mid-price gradient;
   |                      a single stock delta moves cheap -> dear
   v
INFRA DECAY  run fourth - shrinks WorldBuilding.count downward toward used
   |                      (disuse where built > used, + unrest teardown above
   |                      theta); recomputes popCap live from surviving housing;
   |                      acts on the economy's just-processed shard
   v
POPULATION   run fifth  - reads per-system satisfaction from ctx.results;
   |                      integrates unrest (D formula); applies growth/decline
   |                      against the live popCap; housing-overshoot sheds the
   |                      excess as unrest-weighted death; rewrites demandRate
   v
MIGRATION    run sixth  - relocates population (conserved) along the same
                          intra-faction open-edge topology + work-budget slice;
                          population flows down-unrest / up-headroom,
                          distance-attenuated (gateways throttle both flows)

PLAYER TRADES  anytime (not tick-locked) - buy lowers stock, sell raises
               it (one stock delta); same per-market effect as a flow
```

The economy→population **satisfaction handoff** (`ctx.results`) is purely in-memory and transient — it is not persisted and not broadcast to clients. It carries the per-system `delivered_g / demanded_g` measurements the economy tick records internally, which the population processor consumes in the same tick to update `unrest` and population.

Viewed another way, the simulation stacks four layers from static to real-time:

```
1  Base identity (static)      bodies (deposit slots × quality + general/
                               habitable space) + seeded industrial base
                               (WorldBuilding counts on available space,
                               recipes) -> per-good production rates
                               (capacity-driven, input-gated, tier-0 × yield);
                               civilian + production-input consumption rates;
                               demand rate -> days-of-supply pricing reference;
                               net balance + facility storage -> per-market band
                               -> seed stock + import dependence;
                               government -> volatility, spread, boosts
2  Tick evolution (each tick)  input-gated self-limiting production (the
                               supply-chain cascade) + civilian consumption,
                               strike suppression (from unrest), noise,
                               clamp, edge flow, infrastructure decay
                               (count -> used, live popCap), population
                               growth/decline, migration, demandRate rewrite
3  Disruptions (events)        shocks + modifiers temporarily change how
                               layer 2 behaves
```

Edge-flow mechanics are detailed in [trade-simulation.md](./trade-simulation.md); this is just where it sits in the tick.

---

## System Interactions

- **Events** inject economic shocks — one-time stock jolts (immediate stock deltas), rate multipliers (production/consumption scale), and **anchor shifts** (the sustained price lever: multiply a good's per-system pricing reference for the event's duration, raising or lowering where "mid price = base price" sits). Anchor shifts and stock shocks are distinct: a shock moves stock immediately; an anchor shift changes *what price a given stock level reads as* for as long as the event is active. Both are live every tick across all read paths (market display, trade-flow gradient). (see [events.md](./events.md))
- **Navigation danger** is partly driven by government danger baseline — a readout-only world attribute since the teardown (see [navigation.md](./navigation.md))
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
