# Economy — Demand-Priced, Infrastructure-Stocked Markets

> **Status: Planned (substrate-v2 mechanism phase).** A market-layer fix delivered *inside* the
> substrate-v2 milestone, ahead of its calibration pass. Requires a reseed. Promotes into
> [docs/active/gameplay/economy.md](../active/gameplay/economy.md) at ship — this is an economy/pricing
> change, not a substrate change; it lives here only until built.

---

## Key mechanic (the headline)

Every `(station, good)` market holds one `stock` scalar, and price is a function of how that stock
compares to the market's **anchor** (the stock level where price equals base). Today that whole system
runs inside a **fixed absolute band, `[5, 200]`**, hard-coded everywhere — while the anchor itself
**scales with population**. The two scales have diverged: on any sizeable world the anchor outgrows the
band, stock can never reach it, and the price curve runs permanently clipped.

The fix splits the band's two fused jobs and gives each its natural, real-world driver:

- **Demand prices the market.** The price anchor and the scarcity reserve (`minStock`) scale with
  **population demand** — because "cheap vs dear" is inherently *relative to how fast a good is
  consumed* (days of cover).
- **Built infrastructure stocks the market.** The storage ceiling (`maxStock`) — how much can pile up,
  and therefore how cheap and how *liquid* a market gets — is the **sum of the storage its buildings
  provide**: extractors and factories store what they handle, population centres hold nominal retail
  stock, and dedicated depots add bulk capacity.

So **demand sets the price; infrastructure sets the depth.** The magic `5` and `200` disappear; both
ends of the band emerge from things the player can read and influence.

---

## Why the fixed band breaks (the motivating bug)

Price is `mid = basePrice × (targetStock / stock) ^ k`, clamped to `[priceFloor, priceCeiling] ×
basePrice`. With `TARGET_COVER = 40` and food's `perCapitaNeed = 0.004`, the anchor is `0.16 ×
population`:

| population | anchor (`targetStock`) | price-meaningful stock range | actual band | result |
|---|--:|---|---|---|
| 625 | 100 | `[50, 200]` | `[5, 200]` | ✅ just fits |
| 1000 | 160 | `[80, 320]` | `[5, 200]` | ❌ abundant half (200→320) unreachable |
| 1250 | 200 | `[100, 400]` | `[5, 200]` | ❌ anchor *is* the ceiling |
| 2000 | 320 | `[160, 640]` | `[5, 200]` | ❌ stock can never reach the anchor |

Two failure modes, both reachable now (pop peaks ~1065) and worse as substrate-v2 lifts population by
design:

1. **A heavy producer can't make its own good cheap** — reaching the price floor needs stock the cap
   forbids, so a big farm world's food bottoms out well above its floor.
2. **Above the anchor, the producer reads *expensive*** — once `targetStock > 200`, stock pins below the
   anchor forever, so the galaxy's biggest food producer reads as food-*expensive*. (The observed
   "system making 64/t food, food is one of the priciest goods" bug.)

The pricing *formula* is correct — price is purely a function of days-of-cover. The fixed band, and the
fact that one absolute scale tried to do two different jobs, is what breaks it.

---

## The model

### 1. Demand prices the market (`targetStock`, `minStock`)

```
demandRate  = perCapitaNeed × population            (floored at MIN_DEMAND)
targetStock = TARGET_COVER × demandRate             // price = base here — the anchor
minStock    = targetStock / priceCeiling ^ (1/k)    // scarcity reserve: buying stops, price ceilings out
```

`minStock` is a **reserve**, not zero. A player can buy everything *above* it (`stock − minStock`); as
stock falls toward `minStock`, price climbs to its ceiling and the market holds its last reserve. Both
scale with population, so the price point and the scarcity threshold track local demand.

### 2. Infrastructure stocks the market (`maxStock`)

```
maxStock = targetStock / priceFloor ^ (1/k)                       // demand headroom — guarantees full price range
         + Σ_buildings ( count × storagePerUnit[building → good] )  // infrastructure depth & liquidity
```

- The **demand-headroom term** guarantees every market can span its *entire* price curve (ceiling →
  floor) regardless of build-out, so pricing never runs clipped. It scales with population, so it also
  gives consumer worlds the headroom to absorb bulk imports (stock rises → price falls → relief).
- The **infrastructure term** is the actual stockpile capacity, summed over the system's built
  buildings. This is what makes a low-population **mega-mine cheap *and* liquid**: huge ore storage from
  its extractors lets ore pile high (→ price floors → cheap) with a tiny demand-driven reserve (→ nearly
  all of it buyable). The fantasy works.

**Per-building storage is per-good, tied to function** (first-draft mapping; values are calibration
knobs):

| Building | Stores | Rationale |
|---|---|---|
| **Extractor** (resource R) | the good(s) of R (ore extractor → ore) | mined on-site, held before shipment |
| **Factory** (good G) | G (its output); optionally a fraction of its recipe inputs | output buffer + feedstock |
| **Population centre** | **nominal across most consumed goods, generous on consumer-facing goods** (consumer_goods, food, water, medicine, luxuries) | retail / utility / government holdings — people keep a bit of everything, a lot of what they buy |
| **Depot** (special, future catalog entry) | large, broad | the open extensibility slot — a player-buildable lever to deepen and stabilise a market |

Population-centre storage is tied to **built capacity** (`popCap` / centre count), not live population,
so `maxStock` only changes when the system is *built up*, not every tick — while the price anchor still
floats with live population. (The catalog is data-driven: denser housing, advanced depots, or amenity
buildings are just new entries carrying their own `storage` contribution — no structural change.)

### 3. What this restores, and the new arc

- **Same days-of-cover → same price, regardless of size.** A huge world holding 1600 food against
  20/tick and a tiny outpost holding 80 against 1/tick both sit at 80 days of cover and price
  identically — the invariant the cover model always meant to express. (Resolves the "huge planet with
  200 vs tiny planet with 1 should price the same relative to consumption" case.)
- **Producers are deep and liquid in what they produce**, consumers are dear in what they lack —
  legibly, because depth follows visible infrastructure.
- **A progression arc for free:** an undeveloped system is a thin, swingy market; as build-out (SP5)
  fills it, its markets deepen and stabilise. Developed worlds *become* the liquid trading hubs — no
  hand-authoring required.

---

## Relative noise

`NOISE_AMPLITUDE` is currently `±3` absolute — negligible on a wide band, overwhelming on a small one.
With per-market bands it becomes a fraction of band width:

```
noise = NOISE_FRACTION × (maxStock − minStock) × (rng × 2 − 1) × volatility
```

A fixed *proportional* jitter everywhere. First-draft `NOISE_FRACTION ≈ 0.02`; a calibration knob.

---

## What changes vs current

- **`STOCK_MIN` / `STOCK_MAX` (= `5` / `200`) are retired** as global scalars. The band becomes a
  per-market `[minStock, maxStock]`: demand-derived floor/anchor, infrastructure-derived ceiling.
- **Building types gain a `storage` contribution** (per-good or per-good-via-category), added to the
  catalog and aggregated per system per good — reusing the existing `SystemBuilding` aggregation path.
- **Stock is a relative quantity** (into the thousands on a dense/built world, low single digits on an
  outpost) — stored as the existing `Float`, no value-column schema change; the building catalog gains
  the storage attribute.
- **Noise is relative to band width.**
- **`getInitialStock` seeds inside the new per-market band** (it already targets a cover multiple of
  the anchor; it stops clamping to absolute `[5, 200]` and respects facility-driven depth).
- **Threading:** the per-market band replaces the global constants at the ~8 sites that read them — the
  economy tick (`tick.ts` / `economy.ts`), trade-flow, the events stock clamp, the simulator bot +
  world, missions, the player trade services, and the seed. Each already has (or can cheaply derive)
  `demandRate` and the system's building counts.
- **Reseed** required (initial stock magnitudes change).
- **Unchanged:** the cover-based price formula, the bid-ask spread, the buy/sell-back symmetry that
  blocks the resell exploit (it depends on the curve, not the band), and trade-reserve *semantics*
  (buys capped at `floor(stock − minStock)`, sells at `floor(maxStock − stock)` — now per-market).

---

## Open calibration knobs

- **Per-building `storage` values** — pop-centre nominal vs consumer-good generosity; extractor /
  factory depth; depot capacity. (The main new surface.)
- `NOISE_FRACTION` (relative noise as a fraction of band width).
- `TARGET_COVER` and per-good `priceFloor` / `priceCeiling` already shape price dynamic range; they now
  also set the demand-headroom term of the band — watch this dual role during calibration.

These fold into the substrate-v2 calibration pass that follows this phase; the mechanism ships with
first-draft values.

---

## Guarantees to enforce in the build

- `maxStock > minStock` for every market (a minimum band width), so price always has dynamic range even
  before any infrastructure is built — the demand-headroom term provides this; assert it.
- `MIN_DEMAND` keeps `demandRate` (and thus the demand terms) non-zero, so a good a system neither
  produces nor consumes is still a thin, non-degenerate pass-through market for trade-flow.
- Guard `NaN` / `Infinity` before any band value reaches raw SQL or the price curve (per the Postgres
  batch-write rules).
