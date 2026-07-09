# Economy-scale knob (`ECONOMY_SCALE`)

> Was the foundational substrate for the Economy Scaling & Trade-Logistics Rework (doc deleted with the
> grand-strategy pivot; the knob itself is fully live and stays — legible magnitudes serve the strategy
> game just as well).
> Shipped and inert by default (`S = 1`). The calibration pass (2026-06-30) landed on **`S ≈ 100`** —
> validated equilibrium-preserving on both the simulator (clean S=1 vs S=100: prices invariant, quantities
> ×100, dispersion *tightens* as rounding noise shrinks) and a real-DB reseed (tick-500 audit ≈ the
> current-code sim at the same maturity), with magnitudes landing in the legible hundreds–thousands. `S` is
> set via the `ECONOMY_SCALE` **env var**; the code **default stays `1`** so the unscaled baseline keeps the
> unit+sim suite green (flipping the default to 100 breaks ~6 magnitude-pinning
> tests). The code is the source of truth; this spec records the invariant contract and the audited seam
> inventory.

## What it is

One global multiplier `ECONOMY_SCALE = S` on the **goods-side magnitudes** of the economy (production
output, consumption, seeded stock) plus the **absolute terms that silently break if left unscaled** (the
demand floor, per-unit storage, the directed-logistics budget).
Ratio/dimensionless terms (target-cover, price exponent, band ratios, market-state thresholds, route
cost) deliberately do **not** scale.

It is equilibrium-preserving magnitude plumbing. It does **not** pick the real value of `S` (that's the
calibration pass) and does **not** fix the "nowhere is expensive" price-spread problem — `ECONOMY_SCALE`
is ratio-invariant and creates no spread by design (the deleted rework doc's Key Finding #4 — carried
into [economy-specialisation-s4-guardrails.md](../../planned/economy-specialisation-s4-guardrails.md)).

## The invariant (the defining contract)

- **At S = 1: byte-identical to the unscaled economy.** Every unit + sim test passes unchanged
  (multiplying by exactly `1` is identity in IEEE-754).
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

## Approach — bake-at-source

One shared `ECONOMY_SCALE`, imported by each scaled-constant module, which multiplies its **base**
values at module load. Every downstream consumer scales automatically; no consumer/engine code changes,
no function-signature churn. Rejected alternatives: multiplying at each consumption site (scatters S,
violates DRY, easy to miss a seam) and threading S through pure-engine signatures (large churn for a
value that is globally constant per run).

### The knob

- `lib/constants/economy-scale.ts`:
  - `ECONOMY_SCALE = toEconomyScale(process.env.ECONOMY_SCALE ?? "1")` — resolves the `ECONOMY_SCALE`
    env var to a numeric multiplier at module load (default `1`).
  - Helpers `scaleValue(n)` and `scaleRecord(record)` DRY the record mapping (`GOOD_CONSUMPTION`,
    `OUTPUT_PER_UNIT`, `POP_CENTRE_STORAGE`).
  - `toEconomyScale(raw)` parses → **defaults to `1`** when unset → validates **positive and finite**
    (rejects `0` / negative / `NaN` / `Infinity` — these would break pricing, and `NaN`/`Infinity`
    would corrupt a JSON save, since `JSON.stringify` turns them into `null`). The validator lives **inline** in this leaf rather than in
    `lib/types/guards.ts` (where the analogous `toUniverseScale` lives): the module imports nothing so it
    stays the acyclic root of the constants-magnitude graph, and `guards.ts` carries value imports that
    would risk a cycle.
- **Default `1` ⇒ zero behaviour change.** The calibration pass sets the real value via the
  `ECONOMY_SCALE` env var on the simulator run.
- **Server-only — NOT exposed in `next.config.ts`.** The client receives already-scaled market data
  (prices, stock, per-cycle quantities) from the API; it never recomputes economy magnitudes. The two
  client components that import scaled-constant modules read only **unscaled** sibling fields
  (`industry-panel.tsx` → `BUILDING_TYPES[...].resource`; the cadence countdown → a shard interval), so
  no client reads a scaled value. Exposing the env would only matter for a hypothetical future client
  component that displays a scaled-constant *magnitude* directly — which would itself be a layering smell
  (read it from the server). See the client-bundle env gotcha in `CLAUDE.md`.

## Verified seam inventory

Audited against current code. `file:line` are the definition sites.

### Scale by S — goods-side magnitudes

| Symbol | File | Note |
|---|---|---|
| `GOOD_CONSUMPTION` (all entries) | `lib/constants/physical-economy.ts` | `consRate = need × population`, applied every tick. |
| `OUTPUT_PER_UNIT` map | `lib/constants/industry.ts` | Single `Object.fromEntries`; also feeds `BUILDING_TYPES[g].outputPerUnit`, so scaling here propagates to all production reads. |
| `MIN_DEMAND` | `lib/constants/market-economy.ts` | Demand-rate floor; applied live every shard via `rewriteDemandRates`, not just at seed. |
| `EXTRACTOR_STORAGE_PER_UNIT` (40) | `lib/constants/industry.ts` | Additive in `maxStock` via `facilityStorageForGood`. |
| `PRODUCTION_STORAGE_PER_UNIT` (15) | `lib/constants/industry.ts` | Additive in `maxStock`. |
| `POP_CENTRE_STORAGE_DEFAULT` (2) | `lib/constants/industry.ts` | Per pop-centre default storage. |
| `POP_CENTRE_STORAGE` (**every entry**) | `lib/constants/industry.ts` | Absolute per-good overrides, **not** ratios — each entry scales. |
| `DIRECTED_LOGISTICS.GENERATION_PER_POP` (0.5) | `lib/constants/directed-logistics.ts` | Goods-denominated work budget: `affordable = floor(budget / perUnit)`. ×S deficits need ×S budget to heal the same fraction. |

Seeded stock and industrial input-demand scale automatically (derived from the above) — no edit.

### Sim trading-pressure (keeps the knob complete)

| Symbol | File | Note |
|---|---|---|
| `bots.startingCredits` (500) | `lib/engine/simulator/constants.ts` | Scaled `× S` explicitly so bots can buy the ×S economy at invariant prices. |

### Deliberately NOT scaled

| Symbol | File | Why |
|---|---|---|
| `CONSTRUCTION.THROUGHPUT_PER_POP` (0.05) | `lib/constants/construction.ts` | **Building-denominated**, not goods. The per-faction throughput pool funds construction work; building counts are space-capped and don't scale. Scaling it would change construction *pace*, not magnitude — a dynamics change. (The planner itself holds no budget — it proposes toward the physical ceilings and this pool alone paces the queue.) |
| `TARGET_COVER`, `DEFAULT_ELASTICITY` (k), `SEED_COVER_MIN/MAX` | `lib/constants/market-economy.ts` | Pure ratios; ride S correctly. |
| `classifyMarketState` thresholds (`SURPLUS_MARGIN`, `DEFICIT_FRACTION`), HIGH/LOW price thresholds, self-limiting / output-uptake curves, per-good `priceFloor`/`priceCeiling` | various | Dimensionless ratios. |
| `HOP_WEIGHT` (1.0), `FUEL_WEIGHT` (0.1) | `lib/constants/directed-logistics.ts` | Goods-agnostic route cost. Scaling them *shrinks* `affordable` — the wrong direction; the logistics budget is the lever, not this. |

### Not yet scaled — handled by later sub-projects

`MISSION_CONSTANTS.QUANTITY_RANGE` and the mission reward formula belong to the contract-model rework:
the live generator uses a fixed quantity, so with prices invariant the reward doesn't move here; it only
matters once mission quantity becomes the trade chunk. Ship cargo re-pricing belongs to the ship-economy
sub-project.

## How the invariant is guaranteed

- **S = 1 invariant:** the full unit + sim suite passes byte-identical (`npx vitest run --project unit`).
- **S = k invariance test:** `lib/engine/__tests__/economy-scale-invariance.test.ts` evaluates the same
  physical fixture at S = 1 and S = k via `vi.stubEnv` + `vi.resetModules` + dynamic import, asserting
  market price is equal within rounding tolerance while stock / production / consumption / storage scale
  by k. This is the equilibrium-preservation proof. `economy-scale-pressure.test.ts` covers the
  simulator-pressure seam.
- **Sim discipline:** `npm run simulate` at S = 1 is unchanged; a spot run at S = k (e.g.
  `ECONOMY_SCALE=100 npm run simulate`) shows equilibrium prices within tolerance and imports/exports
  magnitudes ×k. `npm run audit:economy` confirms the magnitudes land where expected.

## Scope boundary — what this knob deliberately does not do

- **Pick the value of S** — that's the calibration pass (calibrate via the simulator).
- **The contract-model rework** — discrete-mission vs bounty vs marketplace-arbitrage.
- **Ship re-pricing / capacity.**
- **The price-spread revival** ("nowhere is expensive") — needs sharper supply scarcity / demand
  concentration, a calibration target, *not* a side-effect of this knob.
