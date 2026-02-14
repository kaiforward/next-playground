# Economy Balance — Data-Driven Improvements

Concrete changes to make more goods worth trading, spread player activity across the universe, and make events and government types strategically relevant. Every proposal is grounded in simulator findings.

## Current State (post-12 goods expansion)

The 12-good / 6-economy-type expansion shipped per-good production/consumption rates, per-good volatility, and luxury consumers. Measured via simulator (seed 42, 500 ticks, all strategies):

| Metric | Old (6 goods) | 12 goods | Post-rebalance | Target |
|--------|---------------|----------|----------------|--------|
| Goods >5% profit (greedy) | 2 of 6 | 4 of 12 | 4 of 12 | 6+ of 12 |
| Goods >5% profit (optimal) | 1 of 6 | 2 of 12 | 4 of 12 | 5+ of 12 |
| Goods >5% profit (nearest) | — | — | 6 of 12 | 6+ of 12 |
| Unique systems (greedy) | 10 (5%) | 27 (13.5%) | 8 (4%) | 30+ (15%) |
| Unique systems (optimal) | 14 (7%) | 7 (3.5%) | 18 (9%) | 25+ (12.5%) |
| Top system visits (optimal) | 188 (75%) | 194 (78%) | 97 (39%) | <80 (32%) |
| Tier 0 goods >5% (any smart) | 0% | 0% | ore 6.5% (greedy), textiles 6.1% (nearest) | >5% |
| Max single-good share (optimal) | — | 84.6% | 53.7% | <40% |

**What improved (post-rebalance):** Ore reached 6.5% for greedy — first tier 0 good above 5% for a smart strategy. Textiles hit 6.1% for nearest. Optimal luxuries share dropped from 84.6% to 53.7%. Optimal unique systems nearly tripled (7→18). Optimal top system visits halved (194→97). All strategies trade 10+ goods.

**What still needs work:** Greedy exploration regressed (27→8 systems) — likely concentrated on profitable ore/chemical routes. Optimal still above 40% single-good target. More progress may require route diversity mechanics (hazard, fuel cost variation) rather than further price tuning.

---

## Remaining Problems

### 1. Tier 0 goods are worthless

No smart strategy ever trades water, food, ore, or textiles. The base price gap makes it impossible — a 3:1 ratio on machinery (base 100) yields 200cr; the same ratio on food (base 15) yields 30cr. Same cargo slot, same fuel cost, 6.7x less reward.

**Root cause:** All goods share the same price clamp range `[0.2x, 5.0x]` and the same flat equilibrium targets (produces: S120/D40, consumes: S40/D120). Cheap goods can never compete on absolute profit.

### 2. Optimal route monotony

Optimal visits 7 systems and 194 times each at its top 2. It found Confluence-6 ↔ Confluence-7 (both core systems) for a luxuries loop and never leaves. Luxuries = 84.6% of optimal's profit.

**Root cause:** Luxuries have the highest base price AND only 1 producer type (core, rate 1) but production is slow enough that 2 nearby core systems create a perfect back-and-forth. Nothing disrupts this because equilibrium targets and price clamps don't penalize concentration.

### 3. Government types are inert

Government type data is stored on regions and defined in `lib/constants/government.ts`, but nothing reads it during tick processing. All regions behave identically regardless of government type.

**Root cause:** The economy expansion shipped government data without wiring it into processors. The modifiers (volatility, danger, equilibrium spreads, consumption boosts, event weights) need to be applied.

---

## Proposals

Ordered by expected impact. Independent unless noted.

### Proposal 1: Per-tier price clamps

**Problems addressed:** Tier 0 worthless (#1), route monotony (#2)

**Current state:** All goods use `[0.2x, 5.0x]` basePrice clamps.

**Change:** Per-tier (or per-good) price clamp multipliers. Cheap goods get a wider ceiling; expensive goods get a tighter one.

```
Tier  | Current range | Proposed range | Example max profit/unit
0     | 0.2x - 5.0x  | 0.1x - 8.0x   | food: 15→118, ore: 20→158
1     | 0.2x - 5.0x  | 0.15x - 6.0x  | fuel: 35→208, medicine: 65→386
2     | 0.2x - 5.0x  | 0.2x - 4.0x   | machinery: 100→380, luxuries: 150→570
```

**Why it works:** Narrows the max-profit gap between tiers. Food's max profit goes from 96cr to 118cr while machinery's drops from 480cr to 380cr (3.2x gap vs. 5x). Still rewards tier 2 trading, but tier 0 becomes viable on short routes with good spreads.

**Files to modify:**
- `lib/constants/goods.ts` — Add `priceFloor` and `priceCeiling` multipliers per good (or per tier)
- `lib/engine/pricing.ts` — Accept min/max multipliers as parameters
- `lib/engine/simulator/economy.ts` — Pass clamps through to `calculatePrice()`
- `lib/tick/processors/economy.ts` — Pass clamps when building tick entries

**Verify:** Simulator: tier 0 goods should appear at >5% profit share for greedy. Price StdDev for tier 0 goods should increase.

### Proposal 2: Per-good equilibrium targets

**Problems addressed:** Tier 0 worthless (#1), route monotony (#2)

**Current state:** Flat targets — produces: S120/D40, consumes: S40/D120, neutral: S80/D80. All goods have the same supply/demand ratio at equilibrium.

**Change:** Per-good equilibrium modifiers that give cheap goods wider natural spreads:

```
Good         | Produces (S/D)  | Consumes (S/D)  | Ratio  | Note
water        | 150 / 25        | 25 / 140        | 6.0x   | Huge spread, compensates low base price
food         | 145 / 30        | 30 / 140        | 4.8x   | Wide spread
ore          | 140 / 30        | 30 / 135        | 4.7x   | Wide spread
textiles     | 135 / 35        | 35 / 130        | 3.9x   | Moderate-wide
fuel         | 125 / 40        | 40 / 125        | 3.1x   | Near current
metals       | 120 / 40        | 40 / 120        | 3.0x   | Current baseline
chemicals    | 115 / 45        | 45 / 115        | 2.6x   | Slightly tighter
medicine     | 110 / 50        | 50 / 110        | 2.2x   | Tighter (volatile enough)
electronics  | 105 / 55        | 55 / 105        | 1.9x   | Tight (high base price compensates)
machinery    | 100 / 55        | 55 / 100        | 1.8x   | Tight (high base price)
weapons      | 95 / 60         | 60 / 95         | 1.6x   | Tightest (volatility + base price)
luxuries     | 100 / 50        | 45 / 120        | 2.7x   | Moderate (prevent optimal loop abuse)
```

**Why it works:** Cheap goods get wider natural spreads, partially compensating for their lower base price. Combined with Proposal 1, a food route (base 15, 4.8x ratio, 8x ceiling) can approach electronics territory. Luxuries get a moderate spread instead of the widest — this directly counters optimal's loop abuse.

**Files to modify:**
- `lib/constants/economy.ts` — `EQUILIBRIUM_TARGETS` becomes per-good (or per-tier with per-good overrides)
- `prisma/seed.ts` — Seed uses new per-good targets
- `lib/tick/processors/economy.ts` — Reversion uses per-good targets
- `lib/engine/simulator/world.ts` — Sim world creation uses per-good targets
- `lib/engine/simulator/economy.ts` — Sim economy tick uses per-good targets

**Verify:** Simulator: more goods above 5% profit. Optimal's luxuries share should drop below 50%. Unique systems visited should increase.

### Proposal 3: Volume affects cargo capacity

**Problems addressed:** Route monotony (#2), goods differentiation

**Current state:** All goods use 1 cargo slot per unit. Volume data is stored on goods but not enforced.

**Change:** Cargo capacity checks use `good.volume` instead of assuming 1 slot per unit. Bulky goods (water vol 2, ore vol 2, machinery vol 2) take twice the space.

```
Ship with 120 cargo slots:
- 120 Electronics (vol 1) or 60 Ore (vol 2) or 60 Machinery (vol 2)
- Profit comparison: 120 × 60cr = 7200 vs 60 × 200cr = 12000
- But Ore route is 2 hops and Electronics is 5 hops...
```

**Why it works:** Creates "profit per slot" as the real metric, not profit per unit. Bulky tier 0 goods become viable when you factor in their route efficiency — fewer hops, less fuel, faster turnover. Machinery's high per-unit profit is offset by needing 2 slots. This is the key physical tradeoff the design doc envisioned.

**Files to modify:**
- `lib/engine/trade.ts` — `validateAndCalculateTrade()` cargo check: `quantity * volume` vs available space
- `lib/utils/cargo.ts` — `getCargoUsed()` sums `quantity * volume` instead of just `quantity`
- `lib/types/game.ts` — `MarketEntry` or `GoodInfo` should include volume for UI display
- `lib/engine/simulator/bot.ts` — Bot strategies account for volume when calculating optimal quantities
- Trade UI — Show volume per good, available slots accounting for volume

**Verify:** Simulator: machinery and ore trades should decrease in quantity per trade. Tier 0 bulk goods become more competitive on per-slot-per-hop basis. More goods in profit breakdown.

### Proposal 4: Mass affects fuel cost

**Problems addressed:** Route monotony (#2), universe underutilization

**Current state:** Fuel cost is based only on the route (connection fuelCost). Mass data is stored but not used.

**Change:** Actual fuel cost = `routeFuelCost * averageCargoMass`. A ship carrying heavy cargo (ore mass 2.5) burns 2.5x the fuel. Light cargo (textiles mass 0.5) burns half.

```
10-fuel hop carrying 60 Ore (mass 2.5):  10 × 2.5 = 25 fuel
10-fuel hop carrying 120 Textiles (mass 0.5): 10 × 0.5 = 5 fuel
10-fuel hop carrying 120 Electronics (mass 0.5): 10 × 0.5 = 5 fuel
```

**Why it works:** Heavy goods (ore, machinery, metals, water) are only profitable on short hops. Light goods (textiles, electronics, medicine, luxuries) are viable on long routes. This creates **geographic differentiation** — players near extraction systems run ore short-haul, players exploring far regions carry textiles/electronics. Combined with volume, creates distinct "bulk hauler" vs "long-distance runner" playstyles.

**Files to modify:**
- `lib/engine/navigation.ts` — Fuel calculation includes cargo mass factor
- `lib/engine/pathfinding.ts` — Reachability considers cargo mass
- `lib/engine/simulator/bot.ts` — Bots factor fuel cost into route evaluation
- Navigation UI — Show effective fuel cost based on current cargo

**Verify:** Simulator: heavy-good routes should shorten. Light-good routes should lengthen. Unique systems visited should increase as light goods incentivize exploration.

### Proposal 5: Government modifier enforcement

**Problems addressed:** Government types inert (#3), regional differentiation

**Current state:** Government data defined in `lib/constants/government.ts`. Economy processor and danger engine don't read it.

**Change:** Wire 4 modifier categories into existing processors:

1. **Volatility modifier** (economy processor) — Multiply per-good noise by government's `volatilityModifier` (Federation 0.8x → dampened, Frontier 1.5x → wild swings)
2. **Equilibrium spread modifier** (economy processor) — Widen/narrow equilibrium targets by government's `equilibriumSpreadPct` (Federation -10% → tighter margins, Frontier +20% → wider margins)
3. **Consumption boosts** (economy processor) — Government-driven demand adds consumption at all systems in the region (Authoritarian: +weapons, +fuel everywhere; Corporate: +luxuries everywhere; Federation: +medicine everywhere)
4. **Danger baseline** (ship-arrivals processor) — Government's `dangerBaseline` added to event-based danger at all systems in the region (Frontier +0.10 → always risky)

**NOT wired yet (future):** Trade restrictions (needs UI/enforcement mechanic), event weights (needs spawn selector changes).

**Files to modify:**
- `lib/tick/processors/economy.ts` — Read region's governmentType, look up modifiers, apply to volatility/equilibrium/consumption
- `lib/tick/processors/ship-arrivals.ts` — Read destination system's region governmentType, add danger baseline
- `lib/engine/simulator/economy.ts` — Same for simulator

**Verify:** Simulator: Frontier regions should show higher price StdDev. Corporate regions should show luxuries demand at non-core systems. Route diversity should increase as different regions offer different risk/reward.

### Proposal 6: Hazard incidents on arrival

**Problems addressed:** Goods differentiation, risk/reward

**Current state:** Hazard data stored on goods (`"none"`, `"low"`, `"high"`). Danger system only reads event modifiers. Non-hazardous and hazardous goods are treated identically.

**Change:** A new, separate check on ship arrival — independent of the existing event-based danger system. For each hazardous cargo stack on the arriving ship, roll for a hazard incident. Non-hazardous goods (`hazard: "none"`) are never affected by this system.

**Hazard levels:**

| Hazard | Incident chance (per stack) | Loss mode | Example |
|--------|---------------------------|-----------|---------|
| `none` | 0% | N/A | Water, food, electronics — zero risk |
| `low` | 3% base | **Leak** — lose 10-25% of that good only | Fuel leak, chemical spill |
| `high` | 6% base | **Catastrophic** — lose 50-100% of that good only | Weapons detonation, munitions cook-off |

Incident chance compounds with existing danger level: `effectiveChance = baseChance + (dangerLevel × 0.5)`. In a war zone with 0.2 danger, weapons incident chance rises from 6% to 16%. This means hazardous cargo is safe in peaceful space but very risky in conflict zones.

**Bot behaviour:**
- Simple bots (random, nearest): percentage-based avoidance — skip hazardous goods X% of the time.
- Smart bots (greedy, optimal): expected value calculation. `expectedProfit = profit × (1 - incidentChance × avgLossFraction)`. Only carry hazardous goods when the margin justifies the risk.

**Files to modify:**
- `lib/engine/danger.ts` — New `rollHazardIncidents()` function, separate from existing `rollCargoLoss()`
- `lib/tick/processors/ship-arrivals.ts` — Call hazard check after existing danger check
- `lib/engine/simulator/bot.ts` — Smart bots discount hazardous goods by expected loss

**Verify:** Simulator: weapons/chemicals/fuel traders should show measurable cargo loss. Weapons should be the riskiest good to carry through war zones.

### Proposal 8: Trade legality and inspections

**Problems addressed:** Government types inert (#3), risk/reward differentiation

**Current state:** `tradeRestrictions: string[]` defined on government types but never enforced. Federation restricts weapons, authoritarian restricts weapons + chemicals.

**Change:** Replace `tradeRestrictions` with two arrays: `taxed` and `contraband`. Anything not in either list is legal (no need for explicit "legal" designation). Two distinct mechanics on ship arrival:

**Taxed goods — deterministic import duty:**

On arrival at a system whose government taxes a good, a fixed percentage of that good's cargo is seized as import duty. No RNG, no inspection — it always happens. Players can see tax rates upfront and factor them into route planning.

- Base tax rate: ~10-15% of the taxed good's quantity, seized on arrival
- Government modifier scales the rate (authoritarian takes more, corporate takes less)
- Players can choose to sell elsewhere to avoid the tax, creating route decisions

**Contraband goods — RNG inspection:**

On arrival, an inspection roll determines if contraband is detected. If caught, **full confiscation** of that good.

| Level | Mechanic | Penalty | Player experience |
|-------|----------|---------|-------------------|
| Legal | Nothing | None | Normal trade |
| Taxed | Deterministic % cargo seized on arrival | Known, predictable cost | Factor into route math |
| Contraband | RNG inspection roll | Full confiscation if caught | High risk / high reward gamble |

**Inspection chance** scales with government enforcement capability:
- Authoritarian: 1.5× multiplier (strong enforcement)
- Federation: 1.2× multiplier (moderate enforcement)
- Corporate: 0.8× multiplier (lax enforcement)
- Frontier: 0× (no inspections — everything is legal regardless)

**Government legality table:**

| Government | Taxed | Contraband |
|------------|-------|------------|
| Federation | chemicals | weapons |
| Authoritarian | — | weapons, chemicals |
| Corporate | — | — |
| Frontier | — | — |

Future government types will expand the variety of taxed/contraband combinations to create more regional differentiation.

**Bot behaviour:**
- Simple bots (random, nearest): percentage-based skip of restricted goods in regulated regions.
- Smart bots (greedy, optimal): expected value calculation. For taxed goods, subtract the known tax from profit. For contraband, discount by `catchChance × cargoValue`. Only trade restricted goods when the margin still justifies it.

**Both mechanics resolve automatically on arrival** — no player interaction needed for MVP. Players receive game notifications ("5 units of chemicals seized as import duty", "Weapons confiscated by federation authorities"). Future: bribe option, player interaction for inspection events, multi-ship police event management screen.

**Files to modify:**
- `lib/constants/government.ts` — Replace `tradeRestrictions` with `taxed` and `contraband` arrays, add `inspectionChance` and `taxRate` fields
- `lib/engine/danger.ts` — New `rollInspection()` and `applyImportDuty()` functions
- `lib/tick/processors/ship-arrivals.ts` — Tax + inspection checks on arrival
- `lib/engine/simulator/bot.ts` — Smart bots factor legality into route evaluation

**Verify:** Simulator: weapons trading should decrease in federation/authoritarian regions. Smart bots should smuggle when margins justify risk. Frontier should become a weapons trading hub.

---

## Implementation Status

| # | Proposal | Status | Notes |
|---|----------|--------|-------|
| 1 | Per-tier price clamps | **Done** | Per-good `priceFloor`/`priceCeiling` on all 12 goods. Tier 0 gets wider range (0.1–8.0×), tier 2 gets tighter (0.2–4.0×). |
| 2 | Per-good equilibrium targets | **Done** | Per-good `equilibrium` on all 12 goods. Tier 0 has wide supply/demand ratios (up to 6.0×), tier 2 tight (1.6–2.7×). |
| 3 | Volume on cargo | **Rejected** | See reasoning below. |
| 4 | Mass on fuel | **Rejected** | See reasoning below. |
| 5 | Government modifier enforcement | **Done** | Volatility, equilibrium spread, consumption boosts wired into economy processor + simulator. Danger baseline wired into ship-arrivals. |
| 6 | Hazard incidents on arrival | Pending | Separate system from event danger. Per-stack incident rolls for hazardous cargo only. |
| 7 | Tier 0 base price compression + consumption web enrichment | **Done** | See details below. |
| 8 | Trade legality and inspections | Pending | Replace `tradeRestrictions` with `taxed`/`contraband` arrays. Deterministic import duty for taxed goods, RNG inspection for contraband. |

### Why Proposals 3+4 were rejected

Volume enforcement was implemented and tested via simulator. Results showed that **volume-2 goods (water, ore, machinery) became completely untraded** by all smart strategies. The per-space profit penalty from volume=2 cannot be compensated by any reasonable equilibrium or price-clamp tuning because the base price gap between tiers is 7–15×.

Napkin math for best-case producing→consuming routes:
- **Water** (vol 2, base 10, ceiling 8×): ~40 CR/space
- **Luxuries** (vol 1, base 150, ceiling 4.5×): ~600 CR/space

That's a 15× gap. Wider equilibrium spreads help directionally but can't close it. Adding mass on top would compound the problem — heavy goods get penalized on BOTH cargo capacity AND fuel cost, with no compensating advantage.

Elite Dangerous (a major reference) doesn't enforce volume or mass on cargo either — goods differentiation comes from price dynamics, legality, rarity, and route geography rather than physical properties.

**Decision:** Keep `volume` and `mass` as data fields on goods (in Prisma + constants) for future use if a compelling mechanic emerges, but don't enforce them in trade or navigation calculations. The per-tier price clamps and per-good equilibrium targets from Proposals 1+2 are the primary levers for goods balance.

### Proposal 7: Tier 0 base price compression + consumption web enrichment

**Problems addressed:** Tier 0 worthless (#1), route monotony (#2)

**Root cause:** The 15× base price gap between water (10) and luxuries (150) structurally limits tier 0 max profit. Water's max profit was 79 CR/unit vs luxuries' 652 CR/unit — an 8.3× gap that no equilibrium tuning can bridge. Additionally, tier 0 goods had very few consumer types, limiting natural demand.

**Change 1 — Raise tier 0 base prices:**

| Good | Old base | New base | Rationale |
|------|----------|----------|-----------|
| water | 10 | 25 | Still a commodity, but 6× vs luxuries not 15× |
| food | 15 | 30 | Same tier, slight premium |
| ore | 20 | 35 | Raw material, same range as fuel |
| textiles | 25 | 35 | Processed raw, same range as fuel |

Price spread compressed from 15× to ~4.3×. New max profit gap vs luxuries: 2.3–3.3× (competitive on shorter routes).

**Change 2 — Enrich the consumption web:**

Water and food become universal necessities (5 of 6 economy types consume each). Ore gains industrial as a second consumer. Textiles gain industrial as a third consumer.

```
refinery:   ore(4), water(3), food(1)                                  ← +food(1)
industrial: metals(3), electronics(2), chemicals(2), fuel(2),
            water(2), food(2), ore(2), textiles(1)                     ← +water(2), +food(2), +ore(2), +textiles(1)
tech:       metals(2), chemicals(2), luxuries(1), water(1), food(2)    ← +water(1), +food(2)
core:       food(3), textiles(2), electronics(2), medicine(2),
            weapons(1), water(2)                                       ← +water(2)
```

**Results:** See updated metrics below. Ore reached 6.5% of greedy profit (first tier 0 good above 5%). Optimal luxuries share dropped from 84.6% to 53.7%. Optimal unique systems nearly tripled from 7 to 18.

---

## Next Steps

**Next pass:** Proposals 6 + 8 (Hazard incidents + trade legality). Both fire on ship arrival, share the same processor touchpoint. Implement together then move to event content expansion.

---

## Success Criteria

Measured via simulator (seed 42, 500 ticks, all strategies):

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Goods >5% profit share (greedy) | 4 of 12 | 6+ of 12 | Partial |
| Goods >5% profit share (optimal) | 4 of 12 | 5+ of 12 | Close |
| Any tier 0 good >5% (greedy) | ore 6.5% | Yes | **Met** |
| Unique systems (optimal) | 18 (9%) | 20+ (10%) | Close |
| Top system visits (optimal) | 97 | <100 | **Met** |
| Max single-good profit share (optimal) | 53.7% | <40% | Partial |
| Frontier price StdDev vs Federation | — | >1.3x ratio | Untested |

---

## Notes

- Proposals 1-2 are **constants/config changes** — no new processors, no schema changes, no new game mechanics.
- Proposal 5 is **wiring existing data** into existing processors.
- Every change is testable via the simulator. Run `npm run simulate` before and after each proposal.
- The real game and simulator share the same engine code, so simulator results directly predict in-game behavior.
- For future mechanics beyond these proposals, see [simulation-enhancements.md](./simulation-enhancements.md).
