# Stock-Based Market Economy — Design

Status: **Approved design — not yet implemented.**
Date: 2026-05-29

## Problem

The current market model stores **two** independently-floating values per `(station, good)` — `supply` and `demand` — and prices each good as `price = basePrice × (demand / supply)`. This creates an instant, risk-free arbitrage exploit and several structural awkwardnesses:

1. **Snapshot pricing with no intra-trade slippage.** A trade's entire quantity executes at a single price computed *before* the trade (`lib/services/trade.ts`, `lib/engine/trade.ts`). Buying all of a system's supply happens at the flat current price; the price only moves *after*. A bulk buy never pays the rising prices it causes.
2. **Instant recompute + immediate sell-back.** After a buy drains supply toward 0, `demand / supply` explodes and price pins to the ceiling. The player immediately sells the same units back at the ceiling. Worked example: at supply 20 / demand 20 (price = base), buying 10 then selling 10 back nets a large profit instead of a loss.
3. **Supply/demand asymmetry.** Every trade moves supply by 100% of quantity but demand by only 10% (`TRADE_DEMAND_IMPACT_FACTOR = 0.1`). Demand is effectively a slow equilibrium-seeking value (2%/tick mean-reversion), so dumping goods crashes price via supply while demand stays sticky-high — "selling doesn't remove the demand."
4. **Two free-floating numbers desync.** Demand is not "unmet need"; it's a second number drifting toward its own target. Every event/government/prosperity modifier has to manipulate both supply and demand targets in tandem.

## Goal

Replace the dual supply/demand model with a **single stock value** per `(station, good)`, from which price, buy/sell rates, and the "demand" readout are all derived. Close the round-trip exploit *by construction* (not by tuning a magic number), make production/consumption directly drive the value that sets price, and give every higher-level system (events, government, prosperity) one curve to modify instead of two.

The design is grounded in how comparable games solve this: **slippage / marginal pricing** (Mount & Blade, Elite Dangerous) and a **bid-ask spread** (Port Royale, Mount & Blade, finance "hot-potato" no-arbitrage result) are the two universal anti-exploit tools; **stock-based pricing where production/consumption directly move inventory** is the X4 / Elite model.

---

## 1. Core Model

Each `(station, good)` stores **one** value: `stock`.

Three reference constants describe the price curve. They are derived from the good and the system's economy type — they are *not* stored as floating per-row state:

- `MIN` / `MAX` — stock bounds. Price ceiling at `MIN`, price floor at `MAX`.
- `targetStock` — the **pricing anchor**: the stock level where `price = basePrice`. It is *not* an equilibrium the system is pulled toward; it is purely the "neutral" point on the price curve.

"Demand" is no longer stored. It is derived on the fly for display and validation:

- **Room to sell** = `MAX − stock` (how many units the market can still absorb before price bottoms out)
- **Available to buy** = `stock − MIN` (market keeps a reserve)
- **Consumption rate** = a per-tick flow, shown as context ("consumes 3/tick") — it explains *why* stock drains over time but is not "demand" itself.

These are three views of the same single value: the stock-vs-target comparison sets price (mechanism), the headroom below `MAX` is the "demand" readout, and the consumption flow is flavor.

## 2. Price Derivation

```
mid      = clamp( basePrice × (targetStock / stock) ^ k ,  floor, ceiling )
buyUnit  = mid × (1 + s)        (what the player pays)
sellUnit = mid × (1 − s)        (what the player receives)
```

- `stock = targetStock` → `mid = basePrice`
- `stock < targetStock` (shortage) → `mid > base` → good to sell into
- `stock > targetStock` (surplus) → `mid < base` → good to buy
- `k` — elasticity dial. `k = 1` reproduces the same hyperbola the current `demand/supply` formula makes; `k < 1` softens the curve. Default `k = 1`.
- `s` — half-spread (bid-ask). Default small (e.g. `0.05`), and **scaled by government type** (Frontier tight, Authoritarian wide). May fold in / coexist with the existing government tax rate.
- `floor` / `ceiling` — the existing per-good `priceFloor` / `priceCeiling` multipliers on base price.

### Slippage (the exploit-killer)

A trade of `q` units drags `stock` from `S` to `S∓q`, and price moves the whole way. The trade is therefore priced at the **average of the curve over the stock range it moves**, not a flat snapshot:

```
tradeAvgMid = (1 / q) × ∫[S−q → S]  basePrice × (targetStock / x) ^ k  dx
```

- For `k = 1` this has the closed form `basePrice × targetStock × ln(S / (S−q)) / q`.
- Equivalently, sum the per-unit price in a loop — quantities are bounded by cargo (≤ ~400), so this is cheap and more readable. Implementation choice deferred to the plan; both give identical results.
- Player pays `q × tradeAvgMid × (1 + s)` to buy; receives `q × tradeAvgMid × (1 − s)` to sell.

### Why the exploit dies by construction

A same-system round-trip walks the **same curve segment** down (buy) then back up (sell) — symmetric — so the player ends where they started, minus the spread (a guaranteed small loss). Cross-system profit is unaffected: buying at a surplus system walks a **low** segment of its curve and selling at a shortage system walks a **high** segment of a *different* curve. The gap between two different systems' price levels is the profit; slippage only flattens prices *within* a single system, never *across* systems. That cross-system difference is structural (economy types) and restored every tick by production/consumption.

**Worked example** (base = 100, `k = 1`). Same-system rows apply the 5% spread (it is what produces the loss); cross-system rows omit it (the geographic gap dominates regardless):

| Action | Today | Stock model |
|---|---|---|
| Buy 10 at home (stock 20→10), ×1.05 | 10 × 100 = 1000 | avg curve 138.6 → pay 1455 |
| Sell 10 straight back (10→20), ×0.95 | supply 0 → ceiling → +2000 | avg curve 138.6 → get 1317 |
| **Same-system net** | **+1000–2000 profit** | **−138 loss** |
| Buy 10 at surplus A (40→30), no spread | — | avg 57.5 → pay 575 |
| Sell 10 at shortage B (10→20), no spread | — | avg 138.6 → get 1386 |
| **Cross-system net** | — | **+811 profit** |

## 3. Tick Dynamics — Emergent Equilibrium

Per tick, per market (inside the economy processor): `stock += production − consumption`, then noise, then clamp to `[MIN, MAX]`.

- **Production** self-limits via `sqrt((MAX − stock) / (MAX − MIN))` → approaches 0 as stock nears `MAX`.
- **Consumption** self-limits via `sqrt((stock − MIN) / (MAX − MIN))` → approaches 0 as stock nears `MIN`.
- Both scaled by the system's **prosperity** multiplier (unchanged).
- **No explicit mean-reversion.** Equilibrium emerges: a producer's stock rises until production self-limits (settles high → cheap), a consumer's stock falls until consumption self-limits (settles low → expensive). Trade flow and player trades move stock between systems. This preserves the existing role of the trade-flow simulator as the *spatial* restoring force (production/consumption alone have no spatial component — that is by design).
- Noise is a small random walk scaled by good volatility × government modifier (unchanged in spirit, applied to the single stock value).

The single mean-reverting `demand` value is removed entirely. The single mean-reverting `supply` value is replaced by this emergent stock.

## 4. Trade Execution

`lib/engine/trade.ts` (`validateAndCalculateTrade` / `validateFleetTrade`) and `lib/services/trade.ts` (`executeTrade`):

- **Buy** quantity capped at `floor(stock − MIN)` (market keeps a reserve).
- **Sell** quantity capped at `floor(MAX − stock)` (can't sell into a full warehouse; beyond capacity the market won't buy).
- Trade price computed via the integrated `tradeAvgMid` × spread, replacing the single snapshot `unitPrice`.
- The delta applied to the market is a single `stockDelta` (`−quantity` on buy, `+quantity` on sell) — replacing the current `supplyDelta` + `demandDelta` pair.
- Still executed inside the existing TOCTOU `$transaction`, re-reading `stock` fresh before writing, using atomic updates.
- `tradeVolumeAccum` increment for prosperity is unchanged.
- Reputation gating / faction buy/sell multipliers stack on top of `buyUnit` / `sellUnit` as today.

## 5. Trade-Flow Simulator

`lib/services/trade-flow.ts` + the trade-flow processor:

- The per-edge gradient becomes the **mid-price difference** between the two systems (each derived from its own `stock`), normalized by base price — same concept as today, computed from one variable per end instead of two.
- A flow moves `stock` from the cheaper end to the more expensive end: `stock` decreases at the source, increases at the destination — the same single-variable delta a player trade makes. The current "smaller demand signal in the opposite direction" bookkeeping is dropped.
- Per-edge budget, displacement throttling, round-robin cadence, event logging, and route inference are all unchanged.

## 6. Events, Government, Prosperity

- **Events** modify the economy by one of: shifting `targetStock` (move the neutral point), scaling production/consumption rates, or applying a one-time direct `stock` shock. This replaces today's dual supply-target + demand-target shifts with a single anchor shift — fewer numbers to keep coherent.
- **Government** scales the **spread `s`** (Frontier tight margins, Authoritarian wide) and the noise/volatility amplitude. Tax interaction with spread to be decided during implementation (fold in vs. additive).
- **Prosperity** scales production & consumption rates equally (unchanged from today).

## 7. Data & UI Surfaces

- **Schema:** `StationMarket` replaces the `supply` and `demand` columns with a single `stock` column. Requires a Prisma migration (`prisma db push`) and a seed update.
- **Market panel / trade UI:** present **In Stock**, **Buy price**, **Sell price**, and trade-panel **max buyable** / **max sellable** (derived from `stock − MIN` / `MAX − stock`). The "supply / demand" framing is replaced with stock + derived headroom.
- **Price history snapshots** and **trade history** record price and work as-is.
- **Heatmap overlay** and **cross-system comparison panel** key on `currentPrice / basePrice` — unchanged.

## 8. Calibration

Acknowledged as a significant effort, owned by the calibration harness (`npm run simulate`):

- The per-(economy-type, good) supply/demand equilibrium pairs in `lib/constants/goods.ts` / `lib/constants/economy.ts` collapse to a single `targetStock` anchor per good plus the existing per-economy-type production/consumption rates.
- Self-sufficiency factors continue to differentiate consumers of the same good — applied as adjustments to production/consumption rates or `targetStock`, decided during calibration.
- Re-run the simulator to confirm equilibrium prices land in each good's target band before promoting values.
- Calibration knobs: production/consumption rates, `MIN` / `MAX`, `targetStock`, elasticity `k`, spread `s`, trade-flow budget.

## 9. Phasing (PRs)

Per the 2–4 PR convention, shipped on a shared `feat/stock-based-economy` branch:

1. **Engine + pricing core** — single-stock `calculatePrice`, integrated-slippage trade pricing, spread; pure functions with Vitest coverage. No DB changes yet.
2. **Schema migration + services** — `StationMarket.stock`, `executeTrade` / engine `trade.ts`, the economy tick processor, the trade-flow processor. Live + simulator run the same processor bodies.
3. **Calibration + UI** — recalibrate `targetStock` / rates against the simulator, update market & trade UI to stock language, update `docs/active/gameplay/economy.md` + `trading.md` + `trade-simulation.md`.

---

## Open Calibration Questions (not blockers — resolved during implementation)

- Exact default `targetStock`, `MIN`, `MAX` per good, and per-economy-type production/consumption rate adjustments.
- Default spread `s` and its government scaling; whether it folds into the existing tax rate or is additive.
- Whether `k` stays at 1 globally or varies by tier.
- Integrated-price implementation: closed-form log vs. per-unit summation.
