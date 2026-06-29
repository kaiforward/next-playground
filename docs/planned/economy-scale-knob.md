# Design spec — Global economy-scale knob (`ECONOMY_SCALE`)

> **Design spec for sub-project 1** of the
> [Economy Scaling & Trade-Logistics Rework](./economy-scaling-and-trade-rework.md); the roadmap slot
> is [economy-simulation-vision.md](./economy-simulation-vision.md) §13. The code-heavy, phased
> **implementation plan** derived from this spec lives in `docs/build-plans/` and is deleted once the
> feature ships (the code becomes the source of truth).

## Goal

Introduce one global multiplier `ECONOMY_SCALE = S` on the **goods-side magnitudes** of the economy
(production output, consumption, seeded stock) plus the **absolute terms that silently break if left
unscaled** (the demand floor, per-unit storage, the two silent-flow budgets, the directed-logistics
budget). Ratio/dimensionless terms (target-cover, price exponent, band ratios, market-state thresholds,
route cost) deliberately do **not** scale.

This is foundational, independently mergeable, and equilibrium-preserving. It does **not** pick the
real value of S (that's sub-project 2 calibration) and does **not** fix the "nowhere is expensive"
price-spread problem — `ECONOMY_SCALE` is ratio-invariant and creates no spread by design
([rework doc](./economy-scaling-and-trade-rework.md) Key Finding #4). Pure magnitude plumbing.

## The invariant (the defining contract)

- **At S = 1: byte-identical to today.** Every existing unit + sim test passes unchanged. This is the
  primary merge gate.
- **At S = k: prices and equilibrium ratios are unchanged; only magnitudes scale by k.** Production,
  consumption, stock, target-stock, storage, and the flow budgets all scale by k; `price = basePrice ×
  (targetStock / stock)^elasticity` is invariant because both `targetStock` and `stock` ride k (the
  elasticity exponent is fixed). Float→int rounding loss *shrinks* under scaling (`floor(476.2)` loses
  0.04% vs `floor(4.7)` losing 6%).

Why each moving part stays coherent at S = k:

- `demandRate = max(need × pop, MIN_DEMAND)` — `need` ×S and `MIN_DEMAND` ×S, so both branches ×S.
- `targetStock = TARGET_COVER × demandRate` — `TARGET_COVER` fixed, so ×S.
- `production = count × OUTPUT_PER_UNIT × fulfilment × yield` — `count` is physical (unscaled),
  `OUTPUT_PER_UNIT` ×S, so production ×S. Industrial input-demand (recipe draw) ×S for the same reason.
- `maxStock = (targetStock headroom) + storageCapacity` — both terms ×S.
- Seeded stock (`getInitialStock`) ×S automatically — it is derived entirely from the scaled constants
  above; no separate edit.
- Population, housing, and **build pace** are untouched — see the directed-build note below.

## Approach — bake-at-source (Approach A)

One shared `ECONOMY_SCALE`, imported by each scaled-constant module, which multiplies its **base**
values at module load. Every downstream consumer scales automatically; no consumer/engine code changes,
no function-signature churn. Rejected alternatives: multiplying at each consumption site (scatters S,
violates DRY, easy to miss a seam) and threading S through pure-engine signatures (large churn for a
value that is globally constant per run).

### The knob

- New `lib/constants/economy-scale.ts`:
  - `export const ECONOMY_SCALE = toEconomyScale(process.env.ECONOMY_SCALE)` — mirrors the
    `UNIVERSE_SCALE` → `ACTIVE_SCALE` resolution pattern in `lib/constants/universe-gen.ts`.
  - Helpers `scaleValue(n)` and `scaleRecord(record)` to DRY the record mapping
    (`GOOD_CONSUMPTION`, `OUTPUT_PER_UNIT`, `POP_CENTRE_STORAGE`).
- New `toEconomyScale(raw)` in `lib/types/guards.ts`: parse → **default `1`** when unset → validate
  **positive and finite** (reject `0` / negative / `NaN` / `Infinity` — these would break pricing or trip
  the Postgres `NaN`/`Infinity` raw-SQL guard).
- **Default `1` ⇒ zero behaviour change.** Calibration (sub-project 2) sets the real value via the
  `ECONOMY_SCALE` env var on the simulator run.
- **Server-only — NOT exposed in `next.config.ts`.** The client receives already-scaled market data
  (prices, stock, per-cycle quantities) from the API; it never recomputes economy magnitudes. The two
  client components that import scaled-constant modules today read only **unscaled** sibling fields
  (`industry-panel.tsx` → `BUILDING_TYPES[...].resource`; the cadence countdown → a shard interval), so
  no client reads a scaled value. Exposing the env would only matter for a hypothetical future client
  component that displays a scaled-constant *magnitude* directly — which would itself be a layering smell
  (read it from the server). See the refined client-bundle env gotcha in `CLAUDE.md`.

## Verified seam inventory

Audited against current code. `file:line` are the definition sites.

### Scale by S — goods-side magnitudes

| Symbol | File | Note |
|---|---|---|
| `GOOD_CONSUMPTION` (all entries) | `lib/constants/physical-economy.ts:57` | `consRate = need × population`, applied every tick. |
| `OUTPUT_PER_UNIT` map | `lib/constants/industry.ts:76` | Single `Object.fromEntries`; also feeds `BUILDING_TYPES[g].outputPerUnit`, so scaling here propagates to all production reads. |
| `MIN_DEMAND` | `lib/constants/market-economy.ts:43` | Demand-rate floor; applied live every shard via `rewriteDemandRates`, not just at seed. |
| `EXTRACTOR_STORAGE_PER_UNIT` (40) | `lib/constants/industry.ts:106` | Additive in `maxStock` via `facilityStorageForGood`. |
| `PRODUCTION_STORAGE_PER_UNIT` (15) | `lib/constants/industry.ts:108` | Additive in `maxStock`. |
| `POP_CENTRE_STORAGE_DEFAULT` (2) | `lib/constants/industry.ts:110` | Per pop-centre default storage. |
| `POP_CENTRE_STORAGE` (**every entry**) | `lib/constants/industry.ts:112` | Absolute per-good overrides, **not** ratios — each entry scales. (Not in the rework doc's first cut.) |
| `TRADE_SIMULATION.FLOW_BUDGET` (8) | `lib/constants/trade-simulation.ts:20` | Per-edge market-diffusion unit cap; auto-propagates to the sim's `tradeFlow.flowBudget`. |
| `DIRECTED_LOGISTICS.GENERATION_PER_POP` (0.5) | `lib/constants/directed-logistics.ts:11` | Goods-denominated work budget: `affordable = floor(budget / perUnit)`. ×S deficits need ×S budget to heal the same fraction. |

Seeded stock and industrial input-demand scale automatically (derived from the above) — no edit.

### Sim trading-pressure (this PR — keep the knob complete)

| Symbol | File | Note |
|---|---|---|
| `bots.startingCredits` (500) | `lib/engine/simulator/constants.ts:206` | Hard-coded; scale `× S` explicitly so bots can buy the ×S economy at invariant prices. |
| sim `tradeFlow.flowBudget` | `lib/engine/simulator/constants.ts:186` | References `TRADE_SIMULATION.FLOW_BUDGET` — **auto-scales**, no explicit edit. |

### Deliberately NOT scaled

| Symbol | File | Why |
|---|---|---|
| `DIRECTED_BUILD.GENERATION_PER_POP` (0.05) | `lib/constants/directed-build.ts:12` | **Building-denominated**, not goods. Budget is spent as building units (`budget -= units`, `directed-build.ts:296,407`); building counts are space-capped and don't scale. Scaling it would change construction *pace*, not magnitude — a dynamics change. (The audit's false "analogous to logistics" call; corrected here.) |
| `TARGET_COVER`, `DEFAULT_ELASTICITY` (k), `DEFAULT_SPREAD`, `SEED_COVER_MIN/MAX` | `lib/constants/market-economy.ts` | Pure ratios; ride S correctly. |
| `classifyMarketState` thresholds (`SURPLUS_MARGIN`, `DEFICIT_FRACTION`), HIGH/LOW price thresholds, self-limiting / output-uptake curves, per-good `priceFloor`/`priceCeiling` | various | Dimensionless ratios. |
| `HOP_WEIGHT` (1.0), `FUEL_WEIGHT` (0.1) | `lib/constants/directed-logistics.ts:19` | Goods-agnostic route cost. Scaling them *shrinks* `affordable` — the wrong direction; the logistics budget is the lever, not this. |

### Deferred to sub-project 3 (contract-model rework), not this PR

`MISSION_CONSTANTS.QUANTITY_RANGE` ([20, 60]) and the mission reward formula. The live generator uses a
fixed quantity, so with prices invariant the reward doesn't move under this PR; it only matters once
mission quantity becomes the chunk (C). Ship cargo re-pricing is sub-project 4.

## Verification

- **S = 1 invariant:** full existing unit + sim suite passes byte-identical. Primary gate.
- **S = k invariance test (new unit test):** same physical fixture evaluated at S = 1 and S = k; assert
  market price / `classifyMarketState` equal within rounding tolerance, while stock / production /
  consumption / storage scale by k. This is the equilibrium-preservation proof.
- **Sim discipline (carried from the ditched Phase 2):** `npm run simulate` at S = 1 unchanged; a spot
  run at S = k (e.g. `ECONOMY_SCALE=100 npm run simulate`) shows equilibrium prices within tolerance and
  imports/exports magnitudes ×k. `npm run audit:economy` confirms the magnitudes land where expected.

## Scope boundary — explicitly out of this PR

- The **actual value of S** (sub-project 2 — calibrate via the simulator).
- The **contract-model rework** — discrete-mission vs bounty vs marketplace-arbitrage (sub-project 3).
- **Ship re-pricing / capacity** (sub-project 4).
- The **price-spread revival** ("nowhere is expensive") — needs sharper supply scarcity / demand
  concentration, a calibration target for sub-projects 2 & 4, *not* a side-effect of this knob.
