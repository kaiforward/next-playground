# Economy Simulation — Sub-Project 1: Physical Substrate & Population

Status: **SP1 Parts 1–2 shipped** (Part 2, 2026-06-17 — economy onto the substrate); **Part 3 (emergent pricing) design locked** 2026-06-17, build in progress. The built physical-substrate model (bodies, richness, features, derived economy type) and the substrate-driven economy are documented in [system-traits.md](../active/gameplay/system-traits.md) and [economy.md](../active/gameplay/economy.md) (active); this spec retains the full design rationale and the Part 3 plan. It is the sub-project spec for **Sub-Project 1** of the [Economy Simulation Vision](./economy-simulation-vision.md) (vision §13), decomposing SP1 into shippable parts; the build plans (`docs/plans/…`) and implementation hang off it.

Read the [vision](./economy-simulation-vision.md) first — this spec assumes its model (physical substrate, population keystone, days-of-supply pricing, dissolved economy type) and does not re-argue it.

---

## 1. Decisions locked at the start of SP1

The vision left several forks open "to be decided at the start of sub-project 1." They are now settled:

| Fork (vision ref) | Decision | Rationale |
|---|---|---|
| **Sequencing** (§13) | **Substrate-first** | Rebuild the physical foundation before adding consequences. Builds on bedrock, no throwaway migrations; the "alive" payoff (consequences) follows in SP2. |
| **SP1 end-state** | **Physical drivers + emergent pricing** | SP1 makes the economy both physically *driven* (production from bodies+labour, consumption from population) and self-*pricing* (days-of-supply). Economy type is fully dissolved and `CALIBRATED_TARGET_STOCK` is deleted within SP1. SP2 is then *purely* the living-world consequences layer. |
| **Body model** (§3) | **Discrete `SystemBody` records + denormalized aggregates** | Persist individual bodies (sun, planets, belts) for structure + the future per-body build-space budget (SP3 §8.3); denormalize summed aggregates onto `StarSystem` so the per-tick economy hot path never joins the bodies table (avoids the 30s Postgres ceiling at 10K scale). |
| **Body generation** (§3.3) | **Archetype-driven + variance**, sun-gated | A curated archetype roster (garden world, volcanic world, asteroid belt…) jittered by variance + size + rare richness modifiers. Coherent, recognizable worlds; designer keeps a hand on the wheel; old-trait mapping is clean. Avoids the "random body-bag" risk of fully procedural vectors. |
| **Population units** (§14) | **Abstract magnitude** | One synthetic unit world shared with stock, so per-capita consumption rates and the stock-scale increase ([production.md §1.3](./production.md)) calibrate together via the simulator. No false demographic precision; display dressing is a later cosmetic choice. |
| **Features mechanism** (§3.1) | **Reuse the `SystemTrait` table** (pruned catalog) | The surviving *narrative* traits stay in `SystemTrait`; the catalog is pruned to that subset and its economy fields are retired. Events/surveys/danger keep reading `SystemTrait` rows, so their blast radius is minimal. A rename to `SystemFeature` is a possible later cosmetic cleanup, not part of SP1. |

### 1.1 The reframe: a trait is now a property of a body

The current ~52 traits are **not** pruned-in-place. They are **replaced** by a ground-up, bottom-up model:

```
Sun (class gates composition)
  └── Bodies (planets / asteroid belts / gas giants …)
        └── resource-base vector  ← "the new traits", per body, totally different from today's flat tags
```

The "new traits" are body-level: **body type + size + a resource-base vector** (+ population capacity for habitables). They live entirely in the new `SystemBody` model. The legacy consumers (events / surveys / danger) get **no vote** in this rebuild — they are detached up front and re-pointed at *features* (§4.4), so the substrate can be designed cleanly.

---

## 2. SP1 decomposition (3 parts)

SP1 is large. It ships as three independently-shippable parts, bottom-up. Each part is its own build plan → PR set (each part may itself be 2–3 PRs per the project's phase-PR convention).

| Part | Scope | Ships when |
|---|---|---|
| **Part 1 — Physical hierarchy + generation + reseed** (this spec, §3–§7) | New `SystemBody` schema, sun-gated archetype generation, resource bases, abstract `population` derived + partial/varied seeding, narrative survivors → features, **consumers detached**. The economy keeps running unchanged via a **derived economy-type shim** (a one-function transition, not a migration). | The generation/schema rework is verified **in isolation** before the economy engine is touched. |
| **Part 2 — Economy onto the substrate** (design locked §8.1) | Production = resource base × labour(population); consumption = population × per-capita need. Economy type demoted to a pure derived label. `ECONOMY_PRODUCTION` / `ECONOMY_CONSUMPTION` / `SELF_SUFFICIENCY` deleted. Pricing still anchor-based. | The physical drivers replace the rate tables. |
| **Part 3 — Emergent pricing** (design locked §8.2) | Days-of-supply pricing replaces the anchor curve. `CALIBRATED_TARGET_STOCK` + the `equilibrium` seed pair deleted. The slippage + bid-ask spread anti-exploit guard carries over. | The anchor magic-constant is gone; price is a readout of physical state. |

**Why Part 1 lands alone.** A full reseed plus a rebuilt generator (universe-gen, trait-gen, seed, schema, map trait rendering) is a wide, high-surface change. Landing it behind the shim — with the economy engine *untouched* — means we can validate "the new universe generates coherent, populated, resource-bearing systems and the game still plays identically" before we change a single line of the economy tick. The shim is one derivation function (bodies → economy-type label), deleted in Part 2.

---

## 3. Part 1 — The physical hierarchy

### 3.1 Sun classes (gate composition)

Each system rolls one **sun**, whose class constrains which body archetypes can form — this is the vision's "Sun gates composition" coherence rule (§3.3). Proposed classes (first-draft roster — confirm during review):

| Sun class | Character | Favors | Suppresses |
|---|---|---|---|
| **Blue–white (hot)** | High-energy, irradiated inner system | Volcanic, barren-rock, mineral/ore/radioactive-rich bodies | Habitable/garden worlds (too hot) |
| **Yellow (sol-like)** | Temperate, "main sequence" | Habitable subtypes (garden, ocean, jungle), balanced mix | — (most permissive) |
| **Orange dwarf (cool)** | Dim, long-lived | Marginal habitables, ice/water worlds, gas | High-arable garden worlds |
| **Red dwarf (cold)** | Faint, frontier | Frozen worlds, gas giants, asteroid belts; sparse population | Habitables (mostly inhabitable + stations) |

Sun class is itself rolled (weighted) and stored on the system (or as the system's `Sun` body). It is the first gate of the generation algorithm (§6).

### 3.2 Body archetypes (first-draft roster)

Generation rolls a sun-class-appropriate set of bodies. Each archetype defines a **base resource profile** over the seven locked resource types and a **base population-capacity weight**; generation jitters magnitudes by a variance band × body size, plus rare **richness modifiers** (§3.4). Resource magnitudes below are relative weights (0 = none, 3 = abundant), not final tuned numbers — those come from the simulator.

| Archetype | Hab? | Gas | Minerals | Ore | Biomass | Arable | Water | Radioactive | Pop cap | Notes |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **Garden world** | ✓ | 0 | 1 | 1 | 2 | 3 | 2 | 0 | **High** | The breadbasket; high arable+water. |
| **Ocean world** | ✓ | 0 | 0 | 0 | 2 | 1 | 3 | 0 | High | Water + aquatic biomass; modest arable. |
| **Jungle world** | ✓ | 0 | 0 | 1 | 3 | 2 | 2 | 0 | Med | Biomass-dominant, decent arable. |
| **Arid/marginal world** | ✓ | 0 | 2 | 2 | 0 | 1 | 0 | 1 | Low | Barely habitable; mineral/ore lean. |
| **Volcanic world** | ✗ | 1 | 2 | 3 | 0 | 0 | 0 | 2 | V.low (stations) | Ore + radioactive; **danger** feature. |
| **Frozen/ice world** | ✗ | 1 | 0 | 1 | 0 | 0 | 3 | 0 | V.low | Water + some gas. |
| **Barren rock** | ✗ | 0 | 2 | 2 | 0 | 0 | 0 | 1 | V.low | Generic mineral/ore. |
| **Gas giant** | ✗ | 3 | 0 | 0 | 0 | 0 | 1 | 0 | V.low (orbital) | Gas; small ice/water haul. |
| **Asteroid belt** | ✗ | 0 | 3 | 3 | 0 | 0 | 0 | 1 | V.low (mining) | Minerals + ore; rare radioactive. |

Notes:
- **Arable → Food + Textiles** at the production layer (vision §3.2); a body's arable magnitude feeds both goods in Part 2.
- "Inhabitable" bodies still carry a small population capacity (orbital stations / mining colonies) — the vision's "asteroid belts and gas giants support few" (§4).
- A system has **one sun + 1–N bodies**; the count and mix scale with sun class. A barren red-dwarf frontier system might be `Sun + 1 barren rock + 1 belt`; a yellow-sun core might be `Sun + garden + ocean + gas giant + belt`.

### 3.3 The resource-base vector

Each body persists a resource-base vector over the seven types: `{ gas, minerals, ore, biomass, arable, water, radioactive }`. A type's magnitude is the **cap** on how much of the corresponding good the body can ultimately yield (vision §3.2, §8.3 — a cap on a category, not a placed object). Magnitude = `archetypeProfile[type] × variance × size × (richnessModifier?)`.

The **system aggregate** resource vector = element-wise sum across the system's bodies. This aggregate (plus total pop cap and seed population) is denormalized onto `StarSystem` for the economy hot path.

### 3.4 Richness modifiers (the old "resource trait" content)

The old resource-flavoured traits (helium-3 reserves, heavy metal veins, rare-earth deposits, glacial aquifer, hydrocarbon seas…) are **not** bodies and **not** features. They become rare **richness modifiers** rolled onto a body that multiply one resource magnitude (e.g. "heavy metal veins" → ore ×1.5 on this body). They are the "more water / gas / minerals in costume" the vision describes (§3.1). Stored as part of the body's generated data; surfaced narratively in the body's description.

---

## 4. Part 1 — Traits re-sorted; features detached

### 4.1 The three-way split

Every entry in today's `lib/constants/traits.ts` catalog is reclassified:

| Old trait kind | Examples | Becomes |
|---|---|---|
| **Body-defining** | habitable_world, ocean_world, jungle_world, volcanic_world, frozen_world, desert_world, gas_giant, asteroid_belt | A **body archetype** (§3.2). The trait disappears; the body carries its identity. |
| **Resource-flavour** | helium-3 reserves, heavy metal veins, rare-earth deposits, crystalline formations, glacial aquifer, hydrocarbon seas, organic compounds | A **richness modifier** on a body (§3.4). |
| **Narrative** | precursor_ruins, subspace_rift, dark_nebula, gravitational_anomaly, pirate_stronghold, exotic_matter_traces, ancient_trade_route, seed_vault, orbital_ring_remnant, lagrange_stations | A **feature** (§4.3) — stays in `SystemTrait`, narrative only. |

The exact per-trait mapping (all ~52) is authored as a migration table in the Part 1 build plan; the categories above are the rule.

### 4.2 Features carry **no economy role**

Features keep their quality tier, descriptions, and `dangerModifier`, but their `economyAffinity` and `productionGoods` fields are **retired** — features no longer touch production, consumption, or economy-type derivation. The economic signal now comes entirely from bodies.

### 4.3 Features stay in `SystemTrait`

Mechanism: keep the existing `SystemTrait` table; prune the catalog to the narrative subset; strip the now-dead economy fields from those definitions. Consumers that already read `system.traits` (survey/danger/events) keep working against the same shape — minimal blast radius (the "light touch" decision).

### 4.4 Detaching the consumers (events / surveys / danger)

These three are decoupled from the economic substrate **up front**, so the body rebuild isn't held hostage by them:

- **Survey missions** — re-point eligibility from "survey-eligible traits" to **features** (precursor_ruins, gravitational_anomaly, etc. survive as features, so this is near-zero change beyond the catalog prune).
- **Danger** — danger contributions come from **features** (`dangerModifier`) plus **body type** (e.g. volcanic worlds add an environmental danger baseline). A thin "system danger from bodies+features" derivation replaces any trait-affinity coupling.
- **Events** — event spawn weighting reads **features** + government (unchanged) instead of the old economic traits. Event *physical-perturbation* redesign is **out of scope** (that's vision §10 / SP4) — Part 1 only severs the coupling so events keep spawning sanely.

Reattaching these consumers more deeply to the richer body model (body-specific survey targets, per-body hazards) is explicitly a **later optional polish**, not SP1.

---

## 5. Part 1 — Population & seeding

- **Derivation:** seed population per system from `Σ(body pop-capacity weight × body size)` across habitable + station-bearing bodies, as an **abstract magnitude**.
- **Partial / varied seeding** (vision §3.4): seed **below** carrying capacity, varied by habitability — developed core worlds seed near (but under) their cap; frontier rocks seed near-empty. This yields instant economic geography (developed core vs raw frontier) and growth headroom both ways. Seed at a *locally sustainable* level so SP2's consequence loop doesn't trigger a launch-day crash.
- **Static in Part 1.** Population is a stored stat with a carrying-capacity ceiling, but it does **not** grow/decline/migrate yet — that is SP2's loop. (Labour-gating of production and population-scaled consumption are introduced in **Part 2**, when the economy is rewired; Part 1 only establishes the number and the cap.)

---

## 6. Part 1 — Generation algorithm

The current path (`lib/engine/trait-gen.ts` rolls traits → `deriveEconomyType`; `lib/engine/universe-gen.ts` `generateSystems` attaches traits + economy) is rebuilt:

```
for each system:
  1. roll sun class                  (weighted)
  2. roll body set                   (count + archetype mix gated by sun class)
  3. for each body: roll size, apply archetype resource profile × variance,
     roll rare richness modifiers     → body resource vector + pop-cap weight
  4. roll narrative features          (system/body-level, weighted by … government? sun? — confirm)
  5. sum bodies → system aggregate resource vector + total pop cap
  6. seed population                  (partial/varied, §5)
  7. derive economy-type label        (SHIM, §7) from aggregate + population
```

`GeneratedSystem` gains `sun`, `bodies[]`, aggregate vector, pop cap, seed population; keeps `features[]` (the pruned trait set). `prisma/seed.ts` writes `SystemBody` rows + the denormalized aggregates on `StarSystem` + `SystemTrait` (features) rows.

The connection/region/faction/gateway generation (`generateConnections`, `assignRegions`, faction placement) is **unchanged** — SP1 touches what a *system is made of*, not the graph topology.

---

## 7. Part 1 — The derived economy-type shim

The economy engine is **untouched** in Part 1. But economy type is currently derived from trait affinities, which no longer exist. So Part 1 adds a single derivation function: `deriveEconomyTypeLabel(aggregateResourceVector, population) → EconomyType`, e.g.:

- dominant arable/biomass → `agricultural`
- dominant ore/minerals/gas/radioactive → `extraction`
- high population + balanced → `core` / `industrial` (population-weighted)
- (refinery/tech fall out of mixes — heuristic, tunable)

This keeps `ECONOMY_PRODUCTION` / `ECONOMY_CONSUMPTION` / `SELF_SUFFICIENCY` and the anchor pricing **fully functional and unchanged**, so the game plays identically after the reseed. The function is **deleted in Part 2** when production/consumption derive from bodies+population directly. (Economy type then survives only as a *displayed* descriptor, per vision §9.)

---

## 8. Parts 2 & 3 — both designs locked

Part 2's design is locked below (§8.1) — created 2026-06-17, after Part 1 shipped; it shipped the same day. Part 3's design is locked in §8.2 — created 2026-06-17, picking up directly after Part 2. The code-heavy build plan (files, interfaces, PR phasing, tests) for each part lives transiently in `docs/plans/` and is deleted when the part ships; §8.1 / §8.2 are the durable functional designs.

### 8.1 Part 2 — Economy onto the substrate (locked design)

**Goal.** Rewire the economy tick so production and consumption derive from a system's physical substrate (the denormalized `agg*` resource vector + `population` on `StarSystem`) instead of economy-type rate tables. Economy type becomes a display-only descriptor. Pricing stays anchor-based (Part 3 makes it emergent). Population stays static — the consequence loop (unrest / growth / migration) is SP2, not here.

#### 8.1.1 Locked decisions (2026-06-17)

| Fork | Decision | Rationale |
|---|---|---|
| **Goods roster** | **Keep the 12-good roster** | The 26-good roster ([production-roster.md](./production-roster.md)) belongs to the facilities / supply-chain sub-project (SP3). Expanding now adds new goods, markets, UI, and balance surface — premature facilities work — *without* saving the tier-1+ rework, which SP3 forces regardless. Consequence: the four resources with no tier-0 good (gas, minerals, biomass, radioactive) stay economically inert until SP3. |
| **Tier-1/2 production driver** | **Labour-only** (population); no resource gate | Matches vision §8.2 (tier-1+ is space/labour-bound, not deposit-bound). Least throwaway: SP3 multiplies a local-input-availability term onto the *same* labour term. Flatter intra-tier geography in the interim is acceptable — real balancing waits for SP3. |
| **Economy type** | **Display-only label**, derived at generation | Still drives UI badges + `Region.dominantEconomy`. The classifier (today's shim, §7) survives, renamed out of "shim" framing; nothing in the tick reads it. |

#### 8.1.2 The physical-driver model

**Production** — one descriptor per good, `{ coeff, resource? }`:
```
prodRate(good, sys) = coeff(good) × labourFactor(population)
                      × (resource-driven ? aggregate[resource(good)] : 1)
```
- Tier-0 (resource-driven): `water ← water`, `ore ← ore`, `food ← arable`, `textiles ← arable` (arable splits between the two via differing coeffs). Scales with both deposit magnitude *and* labour.
- Tier-1/2 (labour-only): `coeff × labourFactor(population)`, no resource term. Higher tiers carry smaller coeffs (luxuries rarest).
- `labourFactor(population)` is a normalized, soft-saturating scalar — a fixed per-system value since population is static. Its shape and all coeffs are simulator-tuned.

**Consumption** — universal, population-scaled:
```
consRate(good, sys) = perCapitaNeed(good) × population
```
Every system consumes every good; higher tier → lower per-capita need. Self-sufficiency disappears (a producer simply runs a positive net balance — no seed blend). The government `consumptionBoost` and the prosperity multiplier still layer on top exactly as today.

**Emergent geography:** raw goods flow resource-rich frontier → core; manufactured goods flow populous core → frontier.

**This baseline is deliberately coarse — differentiation is SP2/SP3, not Part 2.** Tier-1/2 production is labour-only with *no space competition*: a body's population and its industrial output both scale off the same `labourFactor`, so a populous world is a net producer of nearly every manufactured good (it never has to choose people *over* factories). Consequently, in Parts 2–3 the import/export geography is shallow and the economy-type label is **loose flavour** — the label is a substrate classifier ([§7](#7-part-1--the-derived-economy-type-shim)), independent of net trade, so a water-rich system can top its exports with water yet read as "core". This is expected, not a calibration bug. The lever that makes economies genuinely differentiate is the **shared build-space budget** (vision §8.3) where housing competes with industry for finite space — scoped to **SP3**, with the consequence loop (growth/decline/migration) in **SP2**. Part 2's calibration target is therefore "**non-degenerate and tradeable**", not "differentiated"; making the label emergent-from-production only becomes meaningful once SP3 makes production profiles diverge.

#### 8.1.3 What this replaces / deletes

- `ECONOMY_PRODUCTION`, `ECONOMY_CONSUMPTION` (`universe.ts`) → two substrate-driven tables: a `GOOD_PRODUCTION` driver map (good → coeff + optional resource) and `GOOD_CONSUMPTION` per-capita needs.
- `SELF_SUFFICIENCY` + `getConsumeEquilibrium` (`economy.ts`) → gone; seeding derives from the new net balance.
- The economy-type **shim** (§7) loses its economic role; the classifier survives for display only.
- `MarketTickEntry` sheds `economyType` / `produces` / `consumes`; `simulateEconomyTick` gates on `rate > 0` directly. A pure `physicalRates(goodId, aggregate, population)` engine fn becomes the single source of the formula, shared by the live processor and the simulator.

#### 8.1.4 Pricing & seeding (anchor stays)

`getTargetStock` / `CALIBRATED_TARGET_STOCK` carry over structurally; the per-good equilibria shift under the new drivers, so the calibrated values are **re-measured via the simulator**. `getInitialStock` is rewritten to seed each market from the sign + magnitude of its new net balance (net producer → high/cheap, net consumer → low/dear). The anchor mechanism itself is deleted in Part 3.

#### 8.1.5 UI — surface the real values

Deleting the rate tables breaks the system Overview's **Produces / Consumes** lists (they read the constant tables today). They are rewired to show the **real per-system** production/consumption computed from that system's substrate, served by extending the Part 1 per-system substrate read service — which keeps the lean map-wide universe payload untouched. The faked population label (derived from economy type + trait count) is replaced with the real `population` magnitude. The economy-type badge is unaffected (the label survives). A polish pass adds net import/export indicators and per-good bars on the Astrography substrate tab.

#### 8.1.6 Calibration

`npm run simulate` validates a stable-but-trading economy within the `[5, 200]` stock band, re-measures the anchors, and tunes the production/consumption coefficients to sane prices. **Coarse calibration only** — the target is a **non-degenerate, tradeable** economy (stocks in band, price dispersion exists, bots profit, greedy ≫ random), *not* a differentiated one. Differentiation needs the SP3 build-space lever (see the coarse-baseline note in §8.1.2); fine balance is SP3's job. Do not chase richer import/export geography by over-tuning the Part 2 coefficients.

#### 8.1.7 Shipping shape (shipped 2026-06-17)

All four phases landed on the shared branch; 2c + 2d were combined into one final PR.

1. ✅ **2a — Engine + constants + substrate-service compute:** new tables, pure `physicalRates`, `MarketTickEntry` simplification, and the substrate read service extended to return per-good production/consumption. No live behaviour change yet (old tables still drove the tick). Fully unit-tested.
2. ✅ **2b — Cutover + UI swap + deletes:** wired the live + sim adapters to the new drivers; swapped the Overview lists to the substrate-service values and fixed the population stat; deleted the three tables + shim role; rewrote `getInitialStock`. Engine and UI flipped together — no broken intermediate.
3. ✅ **2c — Calibrate + docs:** simulator pass, all twelve anchors recalibrated to the substrate equilibrium (coeffs left untouched — the economy was already non-degenerate), `economy.md` + `system-traits.md` + `SPEC.md` updated.
4. ✅ **2d — Display polish:** per-good production/consumption diverging bars with net import/export indicators on the Astrography substrate tab. Population magnitude readout shipped in 2b.

#### 8.1.8 Out of scope (Part 2)

Days-of-supply pricing (Part 3); population dynamics / unrest / migration (SP2); supply-chain input-gating, the 26-good roster, and facilities (SP3); event physical-perturbation redesign (SP4).

### 8.2 Part 3 — Emergent pricing (locked design)

**Goal.** Replace the global per-good pricing anchor with a **per-system days-of-supply** reference, so price becomes a readout of physical state (how many ticks of cover a warehouse holds against *local* demand) rather than a tuned global constant. This deletes the magic number that started the whole redesign (`CALIBRATED_TARGET_STOCK`). Ships standalone against SP1's **static** population — it needs only the per-system demand rate, which Part 2's population-scaled consumption already provides.

#### 8.2.1 The reframe — same curve, per-system reference

The key realisation: days-of-supply is the **same power-law curve** the economy already uses, with a per-system reference replacing the global anchor. With `cover = stock / demandRate` and `price = basePrice × (TARGET_COVER / cover)^k`:

```
reference = TARGET_COVER × demandRate × anchorMult
price     = basePrice × (reference / stock)^k
```

So `midPriceAt`, the integrated-slippage trade pricing (`tradeAvgMidPrice`), the bid-ask spread, and the entire round-trip-exploit guard are **untouched** — the curve shape is identical; only the *source* of the reference stock changes. `curveForGood` stops calling `getTargetStock` / `CALIBRATED_TARGET_STOCK` and instead consumes a per-market `demandRate`. The per-good market-depth gradient (deep, liquid staples vs thin, swingy luxuries) that the 12-entry anchor table hand-tuned now **emerges** from the per-good consumption needs: a high-need staple gets a high `demandRate` → high reference → deep market; a low-need luxury gets a thin one. Fewer magic numbers, more principled.

#### 8.2.2 Locked decisions (2026-06-17)

| Fork | Decision | Rationale |
|---|---|---|
| **`demandRate` definition** | **Base physical demand only** — `max(perCapitaNeed(good) × population, MIN_DEMAND)` | Government `consumptionBoost` and prosperity are deliberately **excluded** from the reference: they already move price *through stock* (they drain it faster, lowering cover), so folding them into the reference too would double-count. `MIN_DEMAND` floors the denominator so a near-empty system gives a finite cover instead of a degenerate zero. |
| **`demandRate` storage** | **New `StationMarket.demandRate` column**, written at **seed** | Mirrors the existing `anchorMult` per-market pricing input exactly — every read path already loads the market row, so threading is purely additive (no new joins, no population/aggregate plumbing into ~12 call sites). Static while population is static (SP1); when SP2 makes population dynamic, the economy processor rewrites it per-tick alongside `anchorMult` — a natural extension, not a rework. |
| **`TARGET_COVER`** | **Single global constant**, simulator-calibrated | Replaces the entire `CALIBRATED_TARGET_STOCK` table with one number. Per-good depth comes from per-good needs (above). Fallback lever if a single value can't hold all 12 goods in the `[5, 200]` band: split to per-tier. |
| **Calibration target** | **Stable + tradeable** (not "growing") | Population is static in SP1, so "stable-but-growing" (vision §3.4, [§9](#9-reseed--simulator-implications)) can't be calibrated here — nothing grows. Part 3 targets the same coarse bar as Part 2: stocks in `[5, 200]`, price dispersion exists, bots profit, greedy ≫ random. "Growing" is deferred to SP2's consequence loop. |

#### 8.2.3 Seeding

`getInitialStock` is rewritten to seed around each market's **per-system reference** (`TARGET_COVER × demandRate`), scaled by the good's net balance: a net producer seeds with **deeper cover** (more stock → reads cheap), a net consumer with **shallower cover** (less stock → reads dear). The producer share — `production / (production + consumption)` — blends continuously, exactly as today, but around the emergent per-system reference instead of the deleted `equilibrium` seed pair. Clamped to `[STOCK_MIN, STOCK_MAX]`.

#### 8.2.4 What this deletes / keeps

- **Delete:** `CALIBRATED_TARGET_STOCK`, `getTargetStock`, the `equilibrium` seed pair on each good (`goods.ts`), and the anchor-midpoint fallback.
- **Keep:** integrated slippage, the bid-ask spread (`getSpread` / `DEFAULT_SPREAD` / government spread scaling), `STOCK_MIN` / `STOCK_MAX`, `DEFAULT_ELASTICITY`, and the round-trip guard (the [economy-resell invariant](../active/gameplay/economy.md) — instant resell stopped by the symmetric spread, rep perks bounded under it). `anchorMult` also stays: `anchor_shift` events now multiply the **per-system reference**, so events keep working unchanged (their physical-perturbation redesign is SP4, out of scope).

#### 8.2.5 Known limitation — pragmatic, solved downstream

A high-population system has a high `demandRate` → high reference → it reads **structurally dear** for every good it doesn't produce (a populous world is short of its imports). This is the *intended* emergent behaviour. The risk: if calibration pushes references past `STOCK_MAX` for typical core populations, those prices pin to the ceiling and lose dispersion. `TARGET_COVER` calibration ([§8.2.6](#826-calibration)) centres references mid-band; the stock-drift report is watched for ceiling-pinning. The genuine fix — build-space making production profiles actually diverge ([vision §8.3](./economy-simulation-vision.md)) and population dynamics relieving structural shortage — is SP2/SP3. Part 3 is deliberately "closer, not perfect": it makes price a faithful readout; later systems make the underlying state richer.

#### 8.2.6 Calibration

`npm run simulate` sets `TARGET_COVER` (and nudges per-capita needs only if a single cover can't hold all goods in band) for a **stable, tradeable** economy: stocks in `[5, 200]`, real price dispersion, bots profit, greedy ≫ random. **Coarse only** — differentiation is the SP3 build-space lever, not Part 3 coefficient-tuning.

#### 8.2.7 Shipping shape (PRs)

Two phases, matching Part 2's shape. Unlike Part 2, there is **no no-op intermediate**: the `curveForGood` signature change forces all callers, and flipping the reference changes every price at once, so 3a is an atomic cutover.

1. **3a — Cutover:** add the `StationMarket.demandRate` column + seed-write it; reframe `curveForGood` to take `demandRate` and apply `TARGET_COVER`; thread `demandRate` through all read sites (services, tick adapters, snapshots, trade-flow) and the simulator's `SimMarketEntry`; rewrite `getInitialStock`; delete `CALIBRATED_TARGET_STOCK` / `getTargetStock` / `equilibrium`. Fully unit-tested. **Reseed required** (new column + new seed stocks).
2. **3b — Calibrate + docs:** simulator pass to set `TARGET_COVER`; rewrite [economy.md](../active/gameplay/economy.md)'s pricing-anchor sections to days-of-supply; mark §8.2 / §9 shipped here; delete the transient `docs/plans/` build plan.

#### 8.2.8 Out of scope (Part 3)

Population dynamics / unrest / migration and the "stable-but-growing" calibration target (SP2); build-space production divergence, the 26-good roster, and facilities (SP3); event physical-perturbation redesign (SP4).

---

## 9. Reseed & simulator implications

- **Full reseed is mandatory** — `SystemBody`, the aggregates, and `population` are all new, and generation is rebuilt. Consistent with the project's "full reseed at sub-project start" norm.
- **Simulator (Part 1):** because the economy still runs via the shim, the simulator's economy tick is **unaffected**; it only needs the synthetic world to carry a derived `economyType` (as today). No new sim modelling in Part 1.
- **Simulator (Part 2, shipped):** validated a stable, tradeable economy in the `[5, 200]` band and recalibrated the anchors to the substrate equilibrium.
- **Simulator (Part 3):** models days-of-supply pricing and calibrates the single `TARGET_COVER` against the **static**-population economy. Target is **stable + tradeable** (§8.2.2) — *not* "growing", which needs population to move.
- **Simulator (SP2):** the "find a **seedable, stable-but-growing** start state" remit (vision §3.4) lands with SP2's population dynamics — the only point at which "growing" is something the simulator can observe.

---

## 10. Part 1 — Out of scope (explicit)

To keep Part 1 a clean, shippable foundation:

- **No** consequence loop — population does not move; no unrest, strikes, rebellion, or migration (SP2).
- **No** economy engine change — production/consumption still from economy-type tables via the shim (Part 2).
- **No** pricing change — anchor curve stays (Part 3).
- **No** facilities / build space — bodies carry the *cap* concept but no build-space budget yet (SP3).
- **No** event physical-perturbation redesign — events only get decoupled from economic traits (SP4).
- **No** deep consumer redesign — survey/danger/events get the light re-point to features only (§4.4).

---

## 11. Part 1 — Success criteria ("done")

1. A fresh seed generates a universe of systems each composed of a **sun + coherent body set**, with persisted `SystemBody` rows and denormalized aggregates + `population` on `StarSystem`.
2. Systems are **partially developed, varied by habitability** — visible developed-core-vs-raw-frontier geography, with growth headroom.
3. The old trait catalog is reclassified: body-defining + resource traits gone; narrative survivors present as **features** with no economy role.
4. Survey missions, danger, and events still function, reading **features** (+ body type for danger).
5. The economy plays **identically** to pre-SP1 (markets, prices, trade) via the derived economy-type shim — verified by `npm run simulate` parity and manual play.
6. All unit/integration tests pass; no `as`/`unknown` violations; conventions held.

---

## 12. Open questions → resolved in the Part 1 build plan

- **Sun-class roster + weights**, and per-class body-count/mix distributions.
- **Full ~52-trait → {body / richness / feature} migration table.**
- **Archetype resource magnitudes + variance bands + size model** (relative weights here; tuned numbers via simulator).
- **Pop-capacity weights per archetype** and the **partial-seed fraction** curve vs habitability.
- **Feature spawn weighting** source (government? sun class? region?).
- **Economy-type shim heuristic** thresholds.
- **Schema specifics**: `SystemBody` columns, the denormalized aggregate representation on `StarSystem` (typed JSON vs columns), how the resource vector is typed (no `Record<string, unknown>` — use a typed `ResourceType` union map).

---

## 13. Relationship to existing docs

- **[economy-simulation-vision.md](./economy-simulation-vision.md)** — the north star; this spec implements its SP1 (§13) and settles its sequencing fork.
- **[system-traits.md](../active/gameplay/system-traits.md)** (active) — now documents the shipped two-layer bodies/features model (Part 1).
- **[production.md](./production.md)** / **[production-roster.md](./production-roster.md)** (planned) — the population stat and tier-0 resource→good mapping align here; consumed by Part 2.
- **[economy.md](../active/gameplay/economy.md)** (active) — pricing-anchor + economy-type sections retired across Parts 2–3; slippage/spread + stock substrate carry forward.
