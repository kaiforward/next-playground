# Economy Simulation — Sub-Project 1: Physical Substrate & Population

Status: **SP1 Part 1 shipped**; **Part 2 design locked** (§8.1, 2026-06-17); Part 3 a forward sketch — created 2026-05-31. The built physical-substrate model (bodies, richness, features, derived economy type) is documented in [system-traits.md](../active/gameplay/system-traits.md) (active); this spec retains the full design rationale and the Part 2–3 plan. It is the sub-project spec for **Sub-Project 1** of the [Economy Simulation Vision](./economy-simulation-vision.md) (vision §13), decomposing SP1 into shippable parts; the build plans (`docs/plans/…`) and implementation hang off it.

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
| **Part 3 — Emergent pricing** (sketch §8.2) | Days-of-supply pricing replaces the anchor curve. `CALIBRATED_TARGET_STOCK` + the `equilibrium` seed pair deleted. The slippage + bid-ask spread anti-exploit guard carries over. | The anchor magic-constant is gone; price is a readout of physical state. |

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

## 8. Parts 2 & 3 — Part 2 locked, Part 3 a sketch

Part 2's design is locked below (§8.1) — created 2026-06-17, after Part 1 shipped. Part 3 (§8.2) remains a forward sketch. The code-heavy build plan (files, interfaces, PR phasing, tests) for Part 2 lives transiently in `docs/plans/` and is deleted when Part 2 ships; §8.1 is the durable functional design.

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

`npm run simulate` validates a stable-but-trading economy within the `[5, 200]` stock band, re-measures the anchors, and tunes the production/consumption coefficients to sane prices. **Coarse calibration only** — fine balance is SP3's job.

#### 8.1.7 Shipping shape (~4 phase PRs, squashed into the shared branch)

1. **2a — Engine + constants + substrate-service compute:** new tables, pure `physicalRates`, `MarketTickEntry` simplification, and the substrate read service extended to return per-good production/consumption. No live behaviour change yet (old tables still drive the tick). Fully unit-tested.
2. **2b — Cutover + UI swap + deletes:** wire the live + sim adapters to the new drivers; swap the Overview lists to the substrate-service values and fix the population stat; delete the three tables + shim role; rewrite `getInitialStock`. Engine and UI flip together — no broken intermediate.
3. **2c — Calibrate + docs:** simulator pass, recalibrate anchors/coeffs, update `economy.md` + `system-traits.md` + `SPEC.md`, mark Part 2 done.
4. **2d — Display polish:** net import/export indicators, per-good production/consumption bars on the Astrography substrate tab, population magnitude readout.

#### 8.1.8 Out of scope (Part 2)

Days-of-supply pricing (Part 3); population dynamics / unrest / migration (SP2); supply-chain input-gating, the 26-good roster, and facilities (SP3); event physical-perturbation redesign (SP4).

### 8.2 Part 3 — Emergent pricing
- Replace the anchor curve with **days-of-supply**: `cover = stock / local_demand_rate`; `price ↑ as cover ↓` (vision §6). `local_demand_rate` is available because Part 2 made consumption population-scaled.
- Delete `CALIBRATED_TARGET_STOCK`, `getTargetStock`, the `equilibrium` seed pair, and the anchor-midpoint fallback.
- Carry over the **slippage + bid-ask spread** round-trip guard (the economy-resell invariant — instant resell stopped by the symmetric spread, rep perks bounded under it) — bounded, symmetric.
- Price moves **gradual and bounded per tick** (vision §6).

---

## 9. Reseed & simulator implications

- **Full reseed is mandatory** — `SystemBody`, the aggregates, and `population` are all new, and generation is rebuilt. Consistent with the project's "full reseed at sub-project start" norm.
- **Simulator (Part 1):** because the economy still runs via the shim, the simulator's economy tick is **unaffected**; it only needs the synthetic world to carry a derived `economyType` (as today). No new sim modelling in Part 1.
- **Simulator (Parts 2–3):** the simulator's remit extends to "find a **seedable, stable-but-growing** start state" (vision §3.4) and to model population and days-of-supply pricing. Deferred to those parts.

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
