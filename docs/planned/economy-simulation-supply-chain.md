# Economy Simulation — Sub-Project 3: Supply-Chain Production & Generic Facilities

Status: **Design locked** 2026-06-19. This is the sub-project spec for **Sub-Project 3** of the [Economy Simulation Vision](./economy-simulation-vision.md) (vision §13 item 3, "Supply-chain production + generic facilities"). It assumes the shipped SP1 model (physical substrate, population-scaled consumption, days-of-supply pricing) and SP2 model (dynamic population, unrest, strikes, migration). Read the [vision](./economy-simulation-vision.md) (§5 demand channels, §8 buildings & build space, §9 economy type dissolved), the [SP1 substrate spec](./economy-simulation-substrate.md), and the [SP2 living-world spec](./economy-simulation-living-world.md) first. The build plan lives separately in `docs/plans/` and is deleted once SP3 ships.

> **Goods-count note.** The roster is the **26 market goods** of [production-roster.md](./production-roster.md) (tiers 0–2). The non-market tier-3 military *assets* (Warships, etc.) are **not** part of those 26 and are out of scope (war system). So SP3 ships 26 production building types (one per good) + one housing type = **27 building types**.

---

## 1. What SP3 is

SP1 made production/consumption *physical* (bodies + labour produce; population consumes) and self-*pricing* (days-of-supply). SP2 made population *move* and gave unmet need *teeth* (unrest, strikes, growth/decline, migration). But two things are still missing, and they are exactly what makes the economy a **chain** rather than a set of independent markets:

1. **Tier-1+ production has no inputs.** Today it is labour-only (`coeff × labourFactor(pop)`), so a populous world conjures Metals, Electronics, and Luxuries from nothing. Four resources (gas, minerals, biomass, radioactive) are economically inert because no good consumes them.
2. **There is no industrial base.** Production scales with raw population, so two identical garden worlds produce the same thing. There is no development layer, no specialisation, no opportunity cost — the economy-type label is "loose flavour, not a promise about net trade" (economy.md).

SP3 adds the **industrial base** (a development layer of generic one-good buildings, bounded by a shared **build-space** budget) and **input-gating** (tier-1+ production consumes real inputs, so shortages cascade). This is the vision's dial-1 payoff carried to completion — *"production from the physical resource base"* now means a real supply chain on a finite physical canvas.

SP3 is the **physical layer only**. The buildings exist and gate production, but **nothing decides to build them at runtime** — the industrial base is seeded at world-gen and is static thereafter. *Who decides what to build and where* (faction economic brain, autonomic drift, player facilities) is the SP5 agency layer. SP3 closes the physical economy loop and is the **stop-and-reflect / tuning checkpoint**: SP1–SP3 together are a complete, simulator-tunable physical economy, on top of which agency (SP5), event-perturbation (SP4), and war are built.

The loop SP3 completes (vision §5.3):

```
PRODUCE    → +stock, gated by capacity ∧ inputs ∧ labour      (NEW: capacity + inputs)
CONSUME    → −stock across civilian + production-input demand   (NEW: production-input channel)
CONSEQUENCE→ unrest, growth/decline, migration                  (SP2)
FLOW       → goods diffuse toward shortage; population migrates  (SP1/SP2)
PRICE      → days-of-supply, now over total (civilian+input) demand   (NEW: input demand priced)
```

---

## 2. Decisions locked at the start of SP3

Resolved in brainstorm, 2026-06-19:

| Fork | Decision | Rationale |
|---|---|---|
| **Building representation** | **Abstract per-type count, not entities.** A `(system, buildingType)` row stores a single `count: Float`. No per-facility rows, no construction state, no ownership. | Same modelling choice as population — a magnitude, not a simulation of individuals. Hundreds of facilities = one Float. Entity-level facilities (owned, constructed, upgradeable, seizable) belong to player-facilities/SP5, where there is an actor to own them. |
| **Agency** | **Deferred to SP5.** Industrial base is **seeded at world-gen and static at runtime** in SP3. | The vision is firm that *who decides to build* (faction brain, autonomic drift, players) is the SP5 agency layer. SP3 is the mechanics of buildings existing and gating production. The only non-agency way to place buildings is generation — so SP3 = seeded-static. |
| **Goods roster** | **Full 26 market goods** (tiers 0–2 of production-roster.md). Tier-3 military *assets* (non-market) out of scope. | The chains interlock — partial adoption orphans intermediates (Alloys and Radioactives only feed downstream goods that would otherwise be cut). All 7 resources finally map to tier-0 goods (vision §3.2). SP3 is the tuning checkpoint, so we calibrate the whole web once. Military-*tagged* goods are dual-use market goods now; their strategic war-demand channel arrives in SP5. |
| **Production model** | **Capacity-driven, replacing `labourFactor`.** `production = count × outputPerUnit × labourFulfillment × inputGate`. | Output now derives from the *built* industrial base, not raw population. `labourFactor`'s soft-saturating curve is replaced by explicit labour accounting (demand vs supply), which is both more physical and the lever the build-space triangle turns on. |
| **Labour allocation** | **Uniform proportional fulfilment** in SP3. `labourFulfillment = min(1, population / labourDemand)`, one ratio per system. | The strategic "staff the food buildings first when starving" prioritisation is an SP5 agency concern. SP3 only needs correct fulfilment math: when SP2 drains population, every building idles proportionally → output falls → cascade, for free. The allocation *mechanism* exists now; the *priority policy* is an SP5 additive term. |
| **Build-space granularity** | **System-aggregate budget** (Σ of per-body contributions), with per-resource deposit caps from the existing `agg*` fields. | Consistent with SP1's denormalized-aggregate hot path (the economy never joins the bodies table). Per-body placement granularity matters only when an actor *chooses where* to build (SP5/player-facilities); the seeded baseline allocates at the system level. |
| **Pricing reference** | **`demandRate` gains a production-input term.** `demandRate = perCapitaNeed×pop + Σ downstream production-input demand`. | Days-of-supply cover must reflect *total* local demand. Without the input term, a heavily-consumed input (Ore at a refinery world) would price as cheap-when-scarce — the wrong signal, and it would penalise high-throughput producers. This is what drives the supply geography. |
| **Intra-system tick order** | **Tier-ordered (T0 → T1 → T2) within a system**, same-tick input propagation. | The economy processor already holds a whole region's markets in memory; ordering the existing loop by tier lets a fresh tier-0 output feed its consumer the same tick. Chosen over a one-tick lag for responsiveness; the cost is a trivial sort. |
| **Housing** | **A building type that raises `popCap` additively.** `popCap = bodyBaseline (SP1) + Σ(housing × popProvided)`. Population grows into it (SP2 logistic). | Makes growing a megacity a real build-space opportunity cost against industry (vision §8.3). Keeps SP1's body-derived baseline intact (people can live on a garden world without built housing); housing is the development layer on top. |
| **Building-type extensibility** | **Building type is its own enum, many-types-to-one-good allowed.** A `(system, buildingType)` row, `buildingType → outputGood` is many-to-one. | Leaves the door open for "better versions" (`ore_extractor_mk2`) and globally-applied upgrade modifiers as pure data additions — no schema migration, no new branches. |

### 2.1 The guiding principle this session

**The industrial base is a development layer over a generation baseline, on a finite physical canvas.** Three things compete for one per-body build-space budget — **extract**, **manufacture**, **house people** — and the competition is what turns the economy-type label from flavour into a real, divergent production profile (vision §9). In SP3 the competition is resolved *at generation* (varied, partial); SP5 lets actors re-resolve it at runtime. The emergent jewel — *over-industrialise a garden world and it can no longer feed itself → decline → cascade* — exists in SP3 as varied seeds that SP2's consequence loop punishes, and becomes a live choice in SP5.

---

## 3. SP3 decomposition (3 parts)

Bottom-up, each its own build plan → PR set (2–3 PRs each), into a shared `feat/economy-sp3` branch off main; final squash/ff to main.

| Part | Scope | Ships when |
|---|---|---|
| **Part 1 — The 26-good roster** (§9) | Extend goods 12 → 26: new tier-0 goods for the four inert resources + the new tier-1/2 goods; resource→good mappings; recipe data (structure only); schema/seed for the new markets. Recalibrate the existing **labour-only** economy for 26 goods (coarse). | The 26-good economy runs end-to-end under the current production model; equilibrium targets hold coarsely. |
| **Part 2 — Industrial base & build space** (§4–§6, §10) | `SystemBuilding` table + `StarSystem.buildSpace`; the four building properties; capacity-driven production replacing `labourFactor`; uniform labour fulfilment; housing → `popCap`; the **generation-seeding allocator**. Tier-1+ still un-gated (produces from capacity + labour only). | Production derives from the built industrial base; systems specialise; build-space/labour/pop triangle is seeded stable; calibrated. |
| **Part 3 — Supply-chain input-gating** (§7–§8) | Recipes become **active gates**; the production-input demand channel drains input stock; `demandRate` extended to include input demand; tier-ordered intra-system tick; the cascade. Final whole-web calibration; simulator extensions; UI readouts. | Shortages cascade through the chain; days-of-supply prices input demand honestly; the simulator validates the complete physical economy. |

**Why this order.** Part 1 de-risks the content+roster expansion separately, while the production model is unchanged. Part 2 swaps the *source* of production (population → industrial base) without yet coupling goods to each other — a contained change to one formula + seeding. Part 3 adds the *coupling* (input-gating) that turns 26 independent markets into a chain. Parts 1 and 2 each recalibrate coarsely; the **definitive** calibration is Part 3, where the whole web is live — so we tune once at the end, not three times (coarse-only in the interim, per the SP2 norm).

---

## 4. The industrial base model

### 4.1 The four hard-coded building-type properties

Every building type carries static, hard-coded properties in `lib/constants/industry.ts`. The catalog is **data, not branches** — adding a type (or a better version of one) is a new entry.

| Property | Applies to | Meaning |
|---|---|---|
| `outputGood` | production types | the single good this type produces (1:1 in SP3; many types → one good allowed later) |
| `inputs` | tier-1+ types | recipe: `Record<goodId, unitsPerOutput>` (the supply chain; see §9) |
| `spaceCost` | all | build-space units one building occupies. Default `1.0`; a denser/future/upgraded type may cost `2.0`. **A modifier hook on the space calc is built in from day one** so global upgrades land without rework. |
| `labourPerUnit` | production types | population needed to fully staff one building |
| `popProvided` | housing only | `popCap` added per housing building |

A "better building" is a new type with its own properties that you grow the count on — never a change to existing rows.

### 4.2 Building types in SP3

26 production types (one per good) + 1 housing type = 27. Production types are named after their output (e.g. Ore Extractor, Gas Harvester, Smelter→Metals, Component Fab, Reactor Plant); names are flavour and finalised in implementation — only `outputGood` is load-bearing. `buildingType → outputGood` is many-to-one by design, so SP5/upgrades can add `*_mk2` types.

### 4.3 Data model

- **`SystemBuilding { id, systemId, buildingType: String, count: Float }`** — a thin tall table, one row per building type *present* at a system (≤27 rows/system). Same access pattern and scale as `StationMarket` (26 rows/system) and `SystemBody`. **Static in SP3** — written only at seed, read-only during ticks, so it carries none of the per-tick write-batching cost; loadable per region alongside markets, and cacheable in-process later (cold-fill, invalidate on reseed).
- **`StarSystem.buildSpace: Float`** — total build-space budget, denormalized from bodies at gen (like the `agg*` fields). Deposit caps reuse the existing `agg*` columns. Build-space *usage* is derived (`Σ count × spaceCost`), not stored.
- **`StarSystem.popCap`** (exists) — recomputed at seed to `bodyBaseline + Σ(housing × popProvided)`. Static in SP3 (housing is static), so no per-tick popCap work.

---

## 5. The space / labour / pop triangle

Three constraints bind every system. This triangle is the heart of SP3's calibration (the part flagged hardest):

```
SPACE:   Σ (count_t × spaceCost_t)            ≤  buildSpace                     [hard cap]
LABOUR:  Σ (count_t × labourPerUnit_t)        =  labourDemand
POPCAP:  popCap  =  bodyBaseline + Σ (housing × popProvided)                    [housing raises it]
         population grows into popCap (SP2 logistic) and is the labour pool
```

- **`buildSpace`** per body = `BASE_SPACE × sizeFactor(size) × habitabilityFactor(habitable)`, summed to the system. Habitable worlds get a lot; asteroid belts / gas giants ~none.
- **Tier-0 extractors** carry a *second* cap: the system's **deposit** magnitude (the `agg*` field for that resource). Tier-0 capacity ≤ `min(spaceShare, deposit)` — resource-gated buildings are the scarce, valuable ones. Tier-1+ and housing need space + labour but no specific deposit.
- **The asymmetry is the design.** Because staffing one production building (e.g. `labourPerUnit = 0.7`) costs more population than one housing building provides (e.g. `popProvided = 0.5`), every production building forces *more than its own footprint* in housing — a deliberate imbalance that forces a real, mixed build-out and an opportunity cost on every choice. The four knobs `{BASE_SPACE, spaceCost, labourPerUnit, popProvided}` are the calibration triangle, validated in the simulator. (Illustrative ratios; absolute units are a calibration decision relating building-count scale to existing population magnitudes — see §16.)

---

## 6. Production — capacity-driven (replaces `labourFactor`)

For each good *g* at a system:

```
production_g = count_g × outputPerUnit_g × labourFulfillment × inputGate_g
```

- **`count_g`** — built capacity for *g* (sum over building types whose `outputGood = g`).
- **`outputPerUnit_g`** — hard-coded per-building output.
- **`labourFulfillment` = min(1, population / labourDemand)** — one system-wide ratio (uniform proportional allocation, §2). When SP2 drains population, the ratio drops and every building idles proportionally. At a seeded-stable system population ≈ labourDemand, so fulfilment ≈ 1.
- **`inputGate_g`** — `1` for tier-0; for tier-1+, `min over inputs of (localStock_input / desiredInput_input)`, clamped `[0, 1]` (§7). Un-gated in Part 2; active in Part 3.

This rate still feeds the existing self-limiting `sqrt((MAX − stock) / range)` ceiling in `simulateEconomyTick`, so stock never blows past `[5, 200]`. Strike suppression (SP2) still multiplies production output. **`labourFactor` is removed** from the production path — its smooth supply-response role is now the explicit labour-fulfilment ratio.

Tier-0 reconciliation: today `production = coeff × labourFactor × deposit`. Under SP3, the deposit becomes the **cap on extractor count** (build-space ∩ deposit), and production scales with built extractors × labour. The resource still governs how much can be produced, now mediated by the industrial base.

---

## 7. Input-gating — the cascade engine

Tier-1+ buildings **draw their recipe inputs from local single-stock market stock** each tick. This is the vision's **production-input demand channel** (§5.1) — a new consumption term on each input good, on top of civilian consumption.

Within a system, each tick (tier-ordered T0 → T1 → T2):

1. **Desired input draw** for good *g*'s buildings = `count_g × outputPerUnit_g × labourFulfillment × inputs_g[i]` for each input *i*.
2. **`inputGate_g` = min over inputs of (localStock_i / desiredDraw_i)**, clamped `[0, 1]`. A Smelter starved of Ore throttles its Metals output proportionally.
3. **Consume inputs** from local stock = `desiredDraw_i × inputGate_g` (you only draw what you actually convert).
4. **Add output** `production_g` (§6) to local stock.

Because processing is tier-ordered, a tier-0 output produced this tick is available to its tier-1 consumer the same tick. Inputs are drawn from *local* stock, which trade flow refills from cheaper neighbours (unchanged) — so a refinery world with no ore deposits still runs Smelters as long as Ore flows in. **Cut the lane and the downstream cascade starts**, grounded in the existing trade-flow lever.

The marquee emergent behaviours (need-cascade, lane-cut cascade, industrialize-vs-feed) all fall out of this loop composed with SP2's population dynamics — with **static** building counts, no agency required.

---

## 8. Pricing — days-of-supply over total demand

Days-of-supply cover is `stock / local_demand_rate`. With a real input channel, the pricing reference must include it:

```
demandRate = (perCapitaNeed_g × population) + Σ downstream production-input demand for g
```

- The production-input term is the **desired (uncapped) draw** = `Σ_{t: g ∈ inputs_t} count_t × outputPerUnit_t × labourFulfillment × inputs_t[g]`. It depends on the industrial base + labour (stable, not on this tick's stock), so it is well-defined and recomputed per tick.
- This is computed where `demandRate` is already rewritten each tick (the population processor's per-tick rewrite, anticipated by SP1 §8.2.2 and used by SP2). The reference flows automatically through every price read path (player trade, convoy, missions, snapshots, trade-flow gradient) via `curveForGood`.
- **Effect:** an input-heavy good prices honestly — a refinery world's Ore reads scarce (high price) when its Smelters' draw exceeds supply, pulling Ore in via trade; it does **not** read cheap just because the world consumes a lot. High-throughput producers are not penalised.

`anchorMult` (event anchor shifts) continues to multiply the reference unchanged.

---

## 9. The 26-good roster

Adopted from [production-roster.md](./production-roster.md) (tiers 0–2). The goods **catalog and chains** carry forward; the roster's *bundled 14-facility* model is **retired** in favour of one-good-one-building (vision §8.1). Prices/volatility are first-draft and simulator-calibrated; existing 12 goods may be re-tuned to fit the expanded web.

**Tier 0 — Raw (8), resource-driven** (no inputs; capped by deposit ∩ space):

| Good | Resource | Good | Resource |
|---|---|---|---|
| Water | water | Gas | gas |
| Food | arable | Minerals | minerals |
| Ore | ore | Biomass | biomass |
| Textiles | arable | Radioactives | radioactive |

(Arable splits to Food + Textiles via differing coeffs, per vision §3.2.)

**Tier 1 — Processed (10):**

| Good | Inputs | Good | Inputs |
|---|---|---|---|
| Fuel | Gas | Polymers | Gas, Biomass |
| Metals | Ore | Components | Minerals, Metals |
| Chemicals | Gas, Minerals | Consumer Goods | Textiles, Polymers |
| Medicine | Biomass, Chemicals | Munitions* | Metals, Chemicals |
| Alloys | Metals, Minerals | Hull Plating* | Metals, Alloys |

**Tier 2 — Advanced (8):**

| Good | Inputs | Good | Inputs |
|---|---|---|---|
| Electronics | Components, Chemicals | Weapons Systems* | Electronics, Munitions, Hull Plating |
| Machinery | Metals, Components | Targeting Arrays* | Electronics, Components |
| Weapons* | Metals, Chemicals, Munitions | Reactor Cores* | Radioactives, Alloys, Components |
| Luxuries | Consumer Goods, Electronics | Ship Frames* | Hull Plating, Alloys, Components |

\* military-tagged (dual-use market goods; civilian demand now, strategic war-demand channel in SP5). **Bottleneck goods**: Components (5 downstream recipes), Metals (universal), Alloys (military chain), Electronics. Recipe *structure* is fixed here; input/output *quantities* are calibration (§16). Per-resource→good mapping makes all four formerly-inert resources active.

---

## 10. Generation seeding (the main calibration risk)

Each system, at world-gen, seeds a **partial, varied, self-consistent** industrial base (vision §3.4 — neither empty nor maxed):

1. Compute `buildSpace` (Σ body `BASE_SPACE × size × habitability`), per-resource deposit caps (`agg*`), body-baseline `popCap` (SP1).
2. Pick a **development-fill fraction** varied by habitability — developed core worlds seed near (under) capacity, raw frontier near-empty → instant economic geography.
3. Allocate the space budget (coarse, input-consistent):
   - **Tier-0 extractors** up to `min(deposit, space share)` — extract what's physically there.
   - **Tier-1+** sized coarsely to local input availability + demand (don't build Smelters with no Ore path).
   - **Housing** sized so `popCap` supports the labour the buildings demand (supply ≈ demand at steady state).
   - Scale all by the fill fraction; never exceed `buildSpace`.
4. Seed `population` just under `popCap` (SP2 growth headroom); markets at cover (existing `getInitialStock`).

The result is each system stable and self-consistent at seed, varied across the galaxy. This allocator + the four triangle knobs is the primary thing the simulator tunes. **Coarse only** — SP5 (agency, runtime building) reshapes the equilibrium, so we do not over-tune.

---

## 11. Processor architecture

**Extend the economy processor — no new processor.** Capacity-driven production + input-gating *is* the economy tick.

- `EconomyWorld` gains an industry/build-space loader (`SystemBuilding` + `buildSpace` per region), parallel to the existing per-region market load.
- `simulateEconomyTick` changes from **independent-per-market** to **per-system, tier-ordered with input coupling** (§7). It still processes one region per tick (round-robin), now grouping that region's markets by system and ordering goods by tier.
- A new pure module `lib/engine/industry.ts` computes `labourDemand`, `labourFulfillment`, the per-good production rate, and `inputGate` — shared by the live tick and the simulator (the SP1 pure-engine pattern).
- The **population processor** folds the production-input term into its per-tick `demandRate` rewrite (§8). `popCap` is static (seed-time), so no per-tick popCap work.
- **Trade-flow and migration topology are untouched** — input demand simply drains local stock; gradient flow refills it.

No new tick processor, no change to processor ordering or dependencies. The `EconomyWorld` interface, its prisma adapter, and its memory adapter all extend; the processor body stays the single source shared by live and sim.

---

## 12. UI (Part 3)

Tick-invalidated read path (separate from the static substrate read), surfacing the new physical state on the system screen:

- **Industrial base** — building counts by type, build-space utilisation (`used / buildSpace`), and labour fulfilment (a system running below capacity for want of people reads as under-staffed).
- **Supply chain** — per-good input-gate status (which goods are throttled for lack of inputs), making a cascade legible.

Scope is readouts only — there is no build UI in SP3 (no runtime construction). Uses existing components (`StatList`, `ProgressBar`, `Badge`, the Population-tab pattern from SP2). Map overlays are not in scope; revisit if a build-space or specialisation choropleth proves useful.

---

## 13. Calibration

`npm run simulate` is extended to model the industrial base, build space, labour fulfilment, and input-gating, and to check:

- **Triangle stability** — seeded systems sit at labour supply ≈ demand; build-space usage ≤ budget; no system seeded starved or idle at tick 0.
- **Specialisation emerges** — production profiles diverge by build-space allocation (the economy-type label becomes meaningful), with resource-rich frontier → core raw flows and core → frontier manufactured flows sharpening.
- **Cascades work** — cutting a tier-0 supply (or a lane) throttles downstream production in sequence; restoring it recovers. No runaway (self-limiting + bounds hold).
- **Existing targets still hold** — stocks in `[5, 200]`, cross-system price dispersion, greedy ≫ random, SP2's stable-but-growing population — now over 26 goods with `demandRate` including input demand.

**Coarse only.** The triangle knobs, seeding fill-fractions, recipe quantities, and 26-good prices are sim-discovered; SP5 reshapes the equilibrium, so do not over-tune.

---

## 14. Reseed & simulator implications

- **Full reseed** — 14 new goods/markets, `SystemBuilding` rows, `buildSpace` denormalized, `popCap` recomputed with housing. Consistent with the "full reseed at sub-project start" norm.
- **Simulator (Part 1):** recalibrate the labour-only economy for 26 goods (no industrial base yet).
- **Simulator (Part 2):** model capacity-driven production, the triangle, and seeding; validate specialisation + triangle stability.
- **Simulator (Part 3):** model input-gating + the production-input demand channel; validate cascades and whole-web equilibrium. First point at which the *complete* physical economy is observable.

---

## 15. Deferred / out of scope

**→ SP5 (agency / faction economic AI):**
- **Runtime building** — anything that *changes* the industrial base over time: autonomic drift, the faction build planner (subsistence → export → bottleneck → strategic, doctrine-weighted), player facilities. SP3 is seeded-static.
- **Labour priority policy** — strategic allocation (staff food/critical buildings first under a population crash). SP3 uses uniform proportional fulfilment; priority is an additive term on the same allocation.
- **Strategic war-demand** — the military/construction demand channel for the military-tagged goods (vision §5.1 channel 3); the military-as-industrial-base ceiling (§12.4).

**→ Later layers (vision §7, §14):**
- **Per-body build-space placement** as a meaningful choice (matters once an actor chooses *where* — SP5/player-facilities). SP3 allocates at the system level.
- **Amenity needs** (health, entertainment) via non-production service facilities; **industrial externalities** (pollution/blight) → industrialize-vs-livability. Additive need-channels/properties on SP2's spine.
- **Synthetic resources** (some raws manufacturable, not only extracted).
- **Entity-level facilities** (owned, constructed, upgradeable, seizable) — the player-facilities model.

**→ Not in SP3:**
- Tier-3 military *assets* (non-market) — war system. Event physical-perturbation redesign — SP4.

---

## 16. Open questions → for implementation

All remaining unknowns are calibration numbers, validated via the simulator:

- **Triangle units & scale** — absolute `BASE_SPACE`, `spaceCost`, `labourPerUnit`, `popProvided`, and how building-count scale relates to existing population magnitudes (SP2-calibrated). The illustrative `0.7 / 0.5` ratios are not literal.
- **Recipe quantities** — input/output ratios per recipe (structure is fixed in §9; quantities tune vertical-integration depth and bottleneck severity).
- **26-good prices/volatility** — new-good values are first-draft; existing 12 may need adjustment to fit the web.
- **Seeding allocator** — exact tier-1+ allocation heuristic and the development-fill-fraction curve by habitability.
- **`outputPerUnit`** per building type (sets how much capacity a unit of build space buys).
- **Input-gate / self-limiting interaction** — confirm gating composes with the `sqrt` ceiling and strike suppression without oscillation.

---

## 17. Relationship to existing docs

- **[economy-simulation-vision.md](./economy-simulation-vision.md)** — north star; SP3 implements §13 item 3 (§5 demand channels, §8 buildings & build space, §9 economy type dissolved). Resolves vision §14 open items on build-space numbers and (partially) population units.
- **[economy-simulation-substrate.md](./economy-simulation-substrate.md)** (SP1) — SP3 builds on bodies/aggregates, days-of-supply pricing, and the anticipated per-tick `demandRate` rewrite.
- **[economy-simulation-living-world.md](./economy-simulation-living-world.md)** (SP2) — SP3 composes with dynamic population, labour-as-population, unrest/strikes, and migration; population is the labour pool that gates capacity-driven production.
- **[production-roster.md](./production-roster.md)** + **[production.md](./production.md)** (planned, pre-pivot) — the **goods catalog and chains** (§9) carry forward; their bundled-facility roster, economy-type placement, and player-build/market-impact framing are **superseded** by SP3's one-good-one-building + seeded-static abstract-capacity model. Player-build/ownership returns in player-facilities/SP5.
- **[economy.md](../active/gameplay/economy.md)** / **[system-traits.md](../active/gameplay/system-traits.md)** (active) — updated when SP3 ships: production becomes capacity+input-gated (replacing labour-only); `demandRate` includes input demand; the 26-good roster; build space, the industrial base, and housing→popCap documented; economy-type label finally differentiated.
- **[faction-system.md](../active/gameplay/faction-system.md)** / **[war-system.md](./war-system.md)** (planned) — consume SP3's industrial base in SP5+ (build planner, military-as-ceiling, war-demand channel).
