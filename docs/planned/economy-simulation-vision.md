# Economy Simulation — North-Star Vision

Status: **Vision / not yet built** — created 2026-05-31, refined 2026-05-31 (agency layer, growth/boundedness, treasury, war-coupling, and directed-logistics model worked through — see §5.4, §12, §13). This is the overarching design north star for reworking the economy into a physically-simulated, consequence-driven model. It is deliberately above implementation: it locks the *philosophy and core model*, names the *rethinks* to existing systems, and decomposes the work into buildable sub-projects. Each sub-project gets its own spec → plan → build cycle; this doc is the shared reference they all hang off.

Expect edits. This is a living document.

---

## 1. What this document is (and what it replaces)

Today's economy is a single-stock market sim (see [economy.md](../active/gameplay/economy.md)) where price is the *only* consequence of supply/demand: a system that "needs" food but can't get it simply has expensive food — it doesn't suffer, decline, or change. Needs exist purely as a trading signal. The pricing anchor (`targetStock`) is a per-good magic constant, half measured-from-simulator and half derived from a separate set of seed magic numbers (`equilibrium`, `SELF_SUFFICIENCY`). Production/consumption come from flat per-economy-type rate tables.

This vision replaces that with a **living, physical simulation**: goods are produced by *what a system physically is*, consumed by *the people who live there*, moved by trade, and the running balance decides whether a system **grows or starves**. Price becomes a *readout* of that physical state, not a tuned control.

It supersedes or reframes several existing/planned docs — see [§15](#15-relationship-to-existing-docs).

---

## 2. Design philosophy

The economy is being deliberately positioned by setting three independent dials:

| Dial | Setting | Meaning |
|---|---|---|
| **What drives production/consumption** | **Realistic** | Production from the physical resource base; consumption from population. Not category rate-tables. |
| **Stakes of an unmet need** | **High** | Systems genuinely thrive or decline based on whether their needs are met. Needs have teeth. |
| **Designer control of the outcome** | **Emergent** | Prices, populations, and trade geography emerge from the simulation. We tune the *rules*, not the *results*. |

This is a blend of **Elite** (a system's economy is driven by what it physically *is*) and **Mount & Blade** (settlements live, starve, riot, and migrate — needs have consequences the player can influence), with **X4**-style supply-chain logistics underneath. The guiding value is **emergence**: rich behaviour arising from simple physical rules, not scripted outcomes.

**Everything derives from universe generation and how factions use it.** That is the organising principle. If a value can be derived from a system's physical bodies + its population + player/faction action, it should be — not assigned from a table.

### 2.1 Design precedents (how each game handles the background economy)

The three games above also resolve a specific problem we face — *how an NPC-driven economy moves goods while keeping player trade legible and meaningful*. They sit on a spectrum (researched, not guessed):

| Game | Goods movement | Player legibility | War interdiction |
|---|---|---|---|
| **Elite Dangerous** | **Abstract** market pool — no visible hauling. Two clocks: a slow daily *structural* tick sets station **states** (boom/bust/famine); a fast (~10-min) clock adjusts supply/demand from actual trading. Depletion/recovery is **gradual and percentage-based** — nothing teleports. | Read published **economic states** + price; infer flows. | (none — abstract) |
| **Mount & Blade: Bannerlord** | **Visible NPC caravans** buy surplus → sell into shortage along roads. | *Watch the caravans move.* | **Raid the caravan.** |
| **X4: Foundations** | **Every good hauled by a real NPC ship**; economy stalls if ships die. *Deliberate holes* are designed into production chains for the player to exploit. | Watch every ship. | Shoot the freighters. |

We adopt **Elite's architecture for v1** (abstract movement, two clock domains, gradual bounded change, legibility via *published state* rather than visible cargo) and **earmark Mount & Blade-style visible convoys as a later presentation-layer upgrade** — see [§12.2](#122-two-transport-modes--market-vs-command). X4's "deliberate production holes for the player" is the same idea as our faction-under-serves-leaves-room-for-players principle ([§12.2](#122-two-transport-modes--market-vs-command)).

---

## 3. The physical substrate

A system's economy is grounded in its **physical bodies**, generated at world creation.

### 3.1 Two-layer traits

The current ~40 narrative traits split into two layers:

- **Bodies** (the economic substrate): **Sun**, **Planets** (habitable / inhabitable subtypes), **Asteroid belts**. Each body carries a *quantified resource base* and a *population capacity*, both scaled by the body's **size**. Resource-flavoured traits from today's catalog (glacial aquifer, helium-3 reserves, heavy metal veins, hydrocarbon seas, …) **collapse into** the body's resource base — they were always just "more water / gas / minerals" in costume.
- **Features** (the narrative layer): precursor ruins, subspace rift, pirate stronghold, nebula, exotic matter, etc. remain **discrete** properties layered on a body or the system. They keep driving danger baselines, event gating, survey missions, and (future) war objectives. They no longer pretend to drive the economy.

**Vocabulary (locked).** Three distinct layers, each 1:1 per tier-0 good — keep them separate; the industrialize-vs-feed tension ([§8.3](#83-shared-build-space-budget)) depends on it:

| Layer | What it is | Term | Examples |
|---|---|---|---|
| **Resource base** | the physical potential present at world-gen — a *cap on a category*, not a placed object | **resource base** (collective); per-type: **deposit** (gas/ore/mineral/water/radioactive), **arable land** (food/textiles), **biomass** | "this body has rich gas deposits" |
| **Industrial base** | the production facilities built on top, which realise the potential | **industrial base** (collective); per-building: **Extractor / Harvester / Smelter / Processor / Factory** | "Gas Harvester", "Ore Extractor" |
| **Goods** | the tier-0 commodities produced | roster name | Gas, Ore, Minerals, Food |

(The old term "endowment" is retired — in a game full of treasuries and capital it reads as a *financial* endowment when it actually means dirt and gas.)

### 3.2 Resource base → raw goods

Each body's resource base maps onto the tier-0 raw goods (catalog in [production-roster.md](./production-roster.md)):

| Resource-base entry | Tier-0 good(s) |
|---|---|
| Gas deposits | Gas |
| Mineral deposits | Minerals |
| Biomass | Biomass |
| Ore deposits | Ore |
| Arable land | Food **+** Textiles |
| Water deposits | Water |
| Radioactive deposits | Radioactives |

Resource **magnitude** (deposit richness / land area / biomass density × body size) sets the *ceiling* on how much of that good the body can yield.

### 3.3 Generation coherence

The **Sun gates composition** — it determines which planet types can roll (a blue dwarf can't host a garden world). Generation produces coherent systems rather than random body-bags, and gives a natural home for physical realism.

A system's **total population capacity** and **total resource availability** are the sums of its bodies' contributions.

### 3.4 Initial development (seeding)

The world is **seeded partially developed, varied by habitability** — not empty, not maxed:

- **Maxed** would leave no growth headroom (the development engine is invisible; factions have nothing to build).
- **Empty** would mean a slow, boring bootstrap and an inconsistent experience for players joining a months-old galaxy.
- **Partial, varied** → the economy is immediately rich enough to *play in*, still *visibly* evolving (boomtowns/ghost towns have headroom both ways), and produces **instant economic geography** — a developed core vs a raw frontier — which is the regional-specialization payoff *and* gives factions a turn-1 agenda (develop the frontier).

Seed *below* carrying capacity but at a *locally sustainable* level, so there's no violent settling crash on launch. The simulator's remit therefore extends from "find equilibrium" to "find a **seedable, stable-but-growing** start state."

---

## 4. Population — the keystone variable

Population is the central new state variable and the linchpin of *both* supply and demand.

- **A single whole number per system** — a scaled magnitude, not a per-individual simulation (no Stellaris-style pops with individual opinions). Migration, rebellion, and strikes are mechanics applied to that one number.
- **Drives demand** — civilian consumption scales with population.
- **Drives supply** — production is gated by available **labour**, so a declining system produces *less* as well as needing less. (This is what makes cascades sharp and self-reinforcing.)
- **Derived from bodies at generation** — habitable worlds support many; asteroid belts and gas giants support few (orbital stations only).
- **Moves over time** — grows when fed and stable, declines when starved or unstable, and **migrates between systems** (see [§7](#7-consequences--the-living-world)).

Population subsumes the role today's `prosperity` stat plays as the "health" channel — see [§10](#10-the-rethinks).

---

## 5. Demand, supply, and the tick loop

### 5.1 Three demand channels

Demand on a good is the sum of:

1. **Civilian** — `population × per-capita need`. The baseline, scales with headcount.
2. **Production inputs** — supply-chain demand (a Smelter needs Ore; a Components Factory needs Minerals + Metals). Scales with local production activity.
3. **Construction / military** — burst demand from building facilities or producing war assets. Socket for the facilities/war sub-projects; the model leaves room for it.

### 5.2 Supply

Production of a good at a system = function of its **bodies** (resource magnitude × size), its **industrial base** (baseline + player/faction facilities), and available **labour** (population), gated for tier 1+ by **input availability**. No economy-type table involved.

### 5.3 The tick loop

```
PRODUCE    → +stock, gated by capacity ∧ inputs ∧ labour
CONSUME    → −stock across the three demand channels; RECORD how much of each need was met
CONSEQUENCE→ need-satisfaction history updates unrest; chronic deficit pushes population down/out,
             sustained surplus + stability pulls it up/in
FLOW       → goods diffuse along jump lanes toward shortage (exists today);
             population migrates along the same lanes toward prosperity (new)
PRICE      → emerges from days-of-supply (see §6)
```

The cascades we want fall out of this loop for free.

**Two clock domains.** This loop is *passive physics* — it runs every tick and decides nothing. The **agency layer** ([§12](#12-agency-layer--who-decides)) — factions reading these signals and choosing what to build and where to push goods — runs on a *slower, deliberate clock* on top. Elite validates this split: its fast (~10-min) market clock handles trading fluctuations while a slow daily *structural* tick makes the big state changes ([§2.1](#21-design-precedents-how-each-game-handles-the-background-economy)). Keeping the two clocks separate is also what makes the world legible — fast changes are small and bounded, big changes are slow and announced.

### 5.4 Growth and its bounds

Growth is the **coupling** between the passive physics loop and the agency layer, and it is **bounded by physics, paced by money**:

- **Physics caps the *potential*.** Carrying capacity = Σ(deposit caps) + build space + population caps. The galaxy can only produce and house so much; development asymptotes. A steady state exists by construction.
- **Money sets the *rate and degree* of realising that potential** (see [§12.1](#121-affordability-treasury--the-money-model)). Money-as-driver stays bounded *precisely because* it can only buy you up to physical ceilings — unbounded capital chasing bounded capacity gives diminishing returns and a natural equilibrium.
- **Two reinforcing growths.** *Demographic*: fed + stable → population rises → more labour *and* more demand. *Developmental*: capital → facilities → higher production ceilings. The flywheel: feed a system → pop grows → more labour works more of the resource base → bigger exportable surplus → more tax/capital → more development → higher ceilings → supports more pop. Decline runs the identical wheel backwards.
- **The economy bootstraps slowly.** Everywhere starts modest (§3.4) and thickens over time — systems grow, produce more, and can project materials further afield only as the logistics network deepens (§12.2). Slow by design.

Growth is held in check by carrying capacity, build space, two opportunity costs (industrialize-vs-feed in [§8.3](#83-shared-build-space-budget), guns-vs-butter in [§12.4](#124-military-as-economic-output)), and logistics pacing ([§12.1](#121-affordability-treasury--the-money-model)).

---

## 6. Pricing — days-of-supply, no global anchor

Price stops being pinned to a per-good global constant. It emerges from **inventory cover**: how many ticks of supply the warehouse holds relative to *local* demand.

```
cover  = stock / local_demand_rate
price  ↑ as cover ↓  (thin cover = dear),  price ↓ as cover ↑  (deep stock = cheap)
```

This **deletes the concept** that started this whole redesign: `CALIBRATED_TARGET_STOCK`, the `equilibrium` seed pair, and the anchor-midpoint fallback all disappear. The anchor was a global magic number; days-of-supply makes the reference *per-system and emergent*, derived from the population it has to feed. Exact formula and the round-trip-exploit guard (slippage + spread) carry over from today's pricing and are tuned in the relevant sub-project.

Price moves are **gradual and bounded per tick** (the Elite property, [§2.1](#21-design-precedents-how-each-game-handles-the-background-economy)): trading nudges cover, cover nudges price, and a warehouse never empties in a single tick. This is what guarantees a player looking at a market sees it *drift*, never teleport — see [§12.2](#122-two-transport-modes--market-vs-command).

---

## 7. Consequences — the living world

This is the dial-2 payoff: needs have stakes, expressed through population.

- **Unrest** accumulates from chronic unmet need (and eases when needs are met). It is the integral of dissatisfaction.
- **Strikes** — production halts while unrest is high.
- **Rebellion** — sustained high unrest slips a system from its faction's control.
- **Migration** — population votes with its feet. Organic growth/decline ([§4](#4-population--the-keystone-variable)) changes a system's *total*; migration **relocates** existing population (conserved in transit) along jump lanes — reusing the trade edge-diffusion engine — away from starving/unstable systems toward prosperous ones. Together they produce emergent population *geography* (boomtowns and ghost towns), rather than every system's headcount drifting in isolation.

The player (and later factions/wars) influences all of this by supplying or cutting off systems. Running a food convoy to a starving cluster literally *grows* it; severing a lane *starves* the downstream.

**Happiness is the inverse of unrest** — a single satisfaction state, deliberately simple in v1, whose only driver is **commodity need-satisfaction** (food, water, goods). It is **forward-compatible by design** with two later layers that plug into the *same* need→unrest loop without rearchitecting it: (1) **amenity needs** (health, entertainment) met by **non-production service facilities** (health / entertainment districts) — simply additional need channels; and (2) **negative externalities** — heavy industry contributing *negatively* to satisfaction (pollution / blight), creating an **industrialize-vs-livability** balance (a sibling of industrialize-vs-feed, [§8.3](#83-shared-build-space-budget)). Both are purely *additive* (more need channels + facility contributions), and the build planner ([§12.3](#123-the-build-planner--what-they-need--what-neighbours-need)) extends to score amenity facilities by unrest exactly as it scores production — **the AI builds happiness the same way it builds farms.** The only requirement on v1 is to keep "need" and "facility" defined generally enough to admit these later; v1 itself keeps happiness = needs-met.

---

## 8. Buildings & build space

### 8.1 Generic, one-good-one-building

Production infrastructure is kept **generic: one building type per good** (Ore Extractor, Gas Harvester, Food Processor, Smelter, Components Factory, …) rather than the bundled multi-output facilities in the current roster. Rationale: the goods list and tier boundaries are still fluid, so a 1:1 good→building mapping means changing a good never forces a facility re-bundle. Vertical clusters become "co-locate the relevant buildings," not pre-packaged combos. Cost is more building *types*, but each is trivially simple to reason about. The aggregate of these buildings across a system (and across a faction) is its **industrial base** ([§3.1](#31-two-layer-traits)).

### 8.2 Two kinds of space

- **Resource-bound capacity** (tier 0): you can only extract where the resource physically is. The deposit magnitude caps extraction of that good.
- **General developed space** (tier 1+): manufacturing needs room, power, and labour — not a specific deposit. Bound by build space and population.

### 8.3 Shared build-space budget

Each body has **one shared build-space budget** (∝ size, scaled by habitability). Within it:

- **Extraction** buildings are capped by *both* the budget *and* their deposit.
- **Manufacturing / housing** are capped by the budget *and* population (and inputs at runtime).

Crucially, **a resource-base entry is a *cap on a category*, not a pre-placed occupant of slots.** "Arable land = 800" means "up to 800 farms' worth of food *if you spend the space on farms*" — not 800 slots you must bulldoze. So you *can* spend the budget on a Components Factory instead of farms; the cost is the food you chose not to grow.

This creates a three-way pull on every body — **extract / manufacture / house more people** — and the emergent jewel: **over-industrialize a garden world and it can no longer feed its own population → decline → cascade.** Development competes with subsistence.

**Population is capacity you raise, not units you place.** A body's baseline population cap is derived at generation from size × habitability (a garden world is a large cap; an asteroid belt ~0). The housing entry in the shared budget is a **coarse population centre** — building it raises the cap significantly and competes for the same space as extraction and manufacturing, so growing a megacity carries a real opportunity cost against industry. Population then *fills* the current cap organically, gated by being fed ([§7](#7-consequences--the-living-world)) — agents raise ceilings, the passive physics loop fills them. This keeps population mostly derived and low-detail while still letting two identical garden worlds diverge — farm-export world vs. dense population hub — based on what the owning faction builds and what its neighbours need. Because demand is multi-channel ([§5.1](#51-three-demand-channels)), **an industrial system is a faction decision answering construction + military demand, not a population by-product** — which is what lets a deliberately low-population forge world exist, spending its space on factories and importing its food.

### 8.4 Baseline vs development

The **baseline NPC economy** comes from bodies × population auto-working their resource base, so **markets function with zero player facilities** (the hybrid principle from [production.md §1](./production.md)). Slots/buildings are the **development layer** (player + faction) that boosts or redirects output on top. "Everything derives from generation" and "markets work without players" both hold.

Exact slot counts, the NPC-baseline-vs-player split, and build UI are facilities-sub-project detail.

---

## 9. Economy type, dissolved

Economy type stops being an assigned category that drives rate tables. Production comes from bodies; consumption from population. **"Economy type" becomes a derived descriptor** — we call a system "Extraction" because that's what its bodies and population happen to make — with **no mechanical role**. This retires `ECONOMY_PRODUCTION`, `ECONOMY_CONSUMPTION`, and `SELF_SUFFICIENCY` entirely (done in phases — stand up the physical drivers first, delete the tables once redundant).

The label only becomes meaningfully *differentiated* once build-space ([§8.3](#83-shared-build-space-budget)) makes production profiles actually diverge. In the pre-facilities baseline (where production is labour-driven with no space competition) a populous world produces a little of everything, so the label is **loose flavour** until the development layer lands — see the coarse-baseline note in [economy-simulation-substrate.md §8.1](./economy-simulation-substrate.md).

---

## 10. The rethinks

Existing systems that change under this vision:

| System | Today | Becomes |
|---|---|---|
| **Traits** | ~40 narrative traits, each with economy affinity + production modifier | Two layers: quantified **resource base** (deposits + pop capacity) + discrete **features** (narrative). Resource traits collapse into the resource base; phenomena/legacy stay as features. |
| **Economy type** | Assigned category driving flat rate tables | Derived descriptor, no mechanical role. Tables deleted. |
| **Pricing anchor** | Global per-good magic constant (`targetStock`) | Emergent per-system **days-of-supply**. Anchor concept deleted. |
| **Prosperity** | A −1…+1 stat driven by *player trade volume* | Folded into **population + unrest**, driven by *need-satisfaction*. |
| **Events** | Pull *price levers* (`anchor_shift` changes the price reading without touching anything physical) | Perturb the *physical* system — destroy stock, halt a facility, kill population, sever a lane — and let price emerge from the damage. |
| **Factions** | Political / relational only (relations, doctrine, war, reputation) | Also **economic managers** — treasury, build decisions, and directed logistics (see [§12](#12-agency-layer--who-decides)). |
| **Production/facilities (planned)** | Bundled facilities, economy-type placement | Generic one-good buildings, body/deposit + space placement. |

---

## 11. Emergent behaviours we are targeting

These are the payoffs the model should produce without scripting:

- **Need-cascade**: a tech cluster with no nearby agriculture → chronic food shortage → population can't grow → its electronics output (needs people) falls → ripples to everyone who needs electronics.
- **Self-reinforcing growth**: a player who runs a food route *grows* the cluster, increasing the electronics it exports — which the player can then also trade.
- **Industrialize-vs-feed**: paving a garden world's arable land with factories starves it.
- **Lane-cut cascade**: a war/event severing a trade lane starves downstream systems in sequence.
- **Population geography**: migration produces boomtowns and ghost towns.
- **Emergent faction economies**: doctrine/government-weighted build planning (see §12) gives each faction a distinct economic character, and regional specialization arises from agents building to local resource base + neighbour demand.
- **Faction value**: resource-rich and high-population systems become obviously worth fighting over.

---

## 12. Agency layer — who decides

Everything above is *passive physics*: bodies produce, population consumes, goods diffuse, systems grow or starve. None of it *decides* anything. The agency layer is the deciding intelligence on top — what gets built, and where resources are deliberately sent. It runs on a slower clock than the physics tick ([§5.3](#53-the-tick-loop)). Three agents:

- **Players** — manual facility builds and shipping (covered by [player-facilities.md](./player-facilities.md)).
- **Factions** — the NPC economic brain (**new**). Today's faction model is purely political/relational; this gives it an economy to manage.
- **Autonomic drift** — unaligned/independent systems develop slowly on their own (subsistence + local resource base only), so the world evolves even before/without a faction brain.

### 12.1 Affordability, treasury & the money model

**Money is the driver, and it is the only unbounded quantity in the simulation.** Everything physical is capped (§5.4); money is not — so spending **must** be a real sink or treasuries inflate to meaninglessness. The model:

- **A monetary-only treasury.** A faction holds *capital*, not physical stockpiles. "Accumulating for war" = accumulating capital + building dedicated capacity near the front ([§12.4](#124-military-as-economic-output)), not hoarding crates. (Physical strategic reserves are a deliberately-deferred later layer.) This keeps everything in two substrates we already have: money + diffusing market stock.
- **Construction is just demand + capital.** Building a facility consumes the **construction demand channel** (real construction goods — metals, components, …) + **capital** + build space + labour. "Can a system afford to expand?" = can the agent marshal those construction inputs to the site (buy local or ship in) and pay the capital. Development is therefore **paced by logistics** — you cannot industrialize faster than you can supply construction materials.
- **The treasury is funded by a throughput / sales tax** — a percentage skim on the *value of goods sold* in faction territory (civilian consumption + exports), where value = quantity × price (both already computed via days-of-supply). It is an abstract skim against the same market counterparty the game already uses — **no civilian wallets to model**. It approximates a *profit* tax without us having to model each system's costs (we tax the revenue side only — a knob to revisit). This base unifies the alternatives: it scales with **production** (more output → more sold), with **population** (more people → more local consumption sold to them), and with **trade** (exports are taxed sales) — so both resource-rich and high-population systems are worth fighting over ([§11](#11-emergent-behaviours-we-are-targeting)). ROI is **demand-gated**: building production that nobody consumes or exports returns nothing, which is a built-in brake on overbuilding.
- **Spending is a budget allocation, not a fixed list of sinks.** Income funds **standing budget bands** (the EU/Paradox shape): each band trades ongoing capital for a boost to a real economic lever, so a faction always splits limited income across competing priorities. **v1 ships only the base of the model — two bands**: *military upkeep* (how much of the industrial-base ceiling is actually fielded, [§12.4](#124-military-as-economic-output)) and *logistics efficiency* (throughput/speed of directed-logistics orders, [§12.2](#122-two-transport-modes--market-vs-command)) — alongside one-off construction spend and war attrition. The set is deliberately small and **extensible**; every future band must hook a lever the physics already has (candidates in [§14](#14-open-questions--deferred-to-sub-project-specs)). **Doctrine/government bias the allocation** — this is where faction economic personality lives. At a developed steady-state income ≈ baseline allocation, so treasuries hover near flat: **a war chest is built by deliberate austerity and drained during war**, and *peace-saves / war-spends* emerges for free.

### 12.2 Two transport modes — market vs command

Two things move goods between systems, and they have opposite characters. The distinction that matters is **signal** (*where* goods are wanted) vs **throughput** (*how much* can actually arrive):

- **Gradient flow** (passive, exists) — the **market** / invisible hand. Every system pulls on its neighbours by its own cover/price; goods diffuse down price gradients along lanes and *equalize*. It is **rate-capped and attenuating** — and that cap is a *feature*: it is what creates uneven systems, gradients, resting points, and economic geography. Uncapped diffusion would flatten the world. So diffusion alone settles each system at a **natural resting point** = local production + the trickle diffusion can sustain.
- **Directed logistics** (active, new) — **command allocation**. The throughput a system needs to grow *beyond* its resting point — volume that diffusion can't sustain over distance. A faction deliberately concentrates resources for a strategic project (feed a shipyard going up, or a front line) — something the market would never do.

**Why directed logistics needs its own channel.** A stronger demand signal only steepens the gradient; it still rides the same capped, attenuating diffusion, so it can't deliver *volume* to a distant site. The extra volume must come from **discrete hauling** — and hauling is exactly what a trader does. So **directed logistics and player trade are the same activity**: carrying a big payload point-to-point, beating diffusion's per-edge limit in one trip.

**The v1 model (abstract, Elite-style):**

- Directed logistics = an **abstract faction logistics order** (capital + time) that delivers volume from a surplus region to a growth/strategic site, above the diffusion cap.
- **Cost** = capital (you're buying at market) **+ civilian crowd-out**: a strong directed pull outcompetes civilian pulls on the same lanes, starving downstream civilian markets → the war→shortage→**revolt** cascade, grounded in a real mechanism (two existing levers composing, *not* a bespoke modifier).
- **Wartime interdiction** = **sever the lane** (an existing lever) → the pull can't be serviced. No convoys to model in v1.
- **The player is the premium throughput layer.** A system's growth gap (what it needs to grow minus what diffusion delivers) is a **standing, legible, high-value demand** the player profits by serving. The player *follows the movements* by reading where the lucrative demand sits.
- **Faction NPC hauling is a stand-in for absent players** — a **population-scaled dial.** With few players the faction backfills the throughput so the world still develops (keeping "markets work without players" true); as the player base grows you turn faction auto-hauling *down* and players absorb it. The faction deliberately **under-serves** (limited capacity), so there is *always residual* demand for players — the faction *creates* trade situations rather than competing them away (X4's "deliberate production holes," [§2.1](#21-design-precedents-how-each-game-handles-the-background-economy)).

**Legibility — nothing vanishes while you watch.** Because changes are **bounded per tick** ([§6](#6-pricing--days-of-supply-no-global-anchor)) and the agency clock is **slow** ([§5.3](#53-the-tick-loop)), the faction is a big, slow, *predictable* current — a market drifts (1000 → 980 → 960), it never teleports to 0, and a player always transacts at the live visible price (plus their own slippage). The only risk carried is the normal trader's risk — the spread may narrow by arrival because the faction (and other players) also supplied the site, which **rewards getting there first.** v1 legibility comes Elite-style from a **published development / economic-state overlay** + the price signal, *not* from visible cargo.

**Phase 2 — visible convoys (Mount & Blade-style), deferred.** Later, render the *same virtual routes* the v1 model already simulates as visible NPC haulers. Because the simulation substrate is unchanged, this is a **pure presentation upgrade** — and it pays for itself by maximizing legibility *and* unlocking **convoy-raiding** as real war gameplay (we already render in-transit ship markers). Earmarked, not built.

How much an agent leans command vs market is **flavoured by government** (Authoritarian / Militarist post aggressive pulls that override civilian needs; Corporate / Frontier let the gradient work) — reusing the existing government axis as a planned-vs-free-market dial, implemented as *how strong a directed pull a faction is willing to post*.

### 12.3 The build planner — "what they need + what neighbours need"

A faction (and the autonomic baseline) scores candidate builds, roughly in priority order:

1. **Subsistence** — chronic *local* shortage of a consumed good → build production/extraction for it (resource base permitting) or import capacity. Don't starve your own population.
2. **Resource base → export** — a rich, unexploited resource base + demand among neighbours/faction-wide → build it for export. Drives emergent **regional specialization**.
3. **Bottleneck relief** — faction-wide scarcity of a chokepoint good (Components) → build it somewhere suitable.
4. **Strategic / doctrine** — war footing → military production; growth ambition → housing to raise the pop cap.

…all gated by the affordability/ROI check from §12.1. The **same need/price signals** drive player arbitrage, gradient flow, and faction build decisions — one signal layer, three consumers. **Doctrine and government weight the priorities**, so faction *personality* produces distinct economies (a militarist over-builds military; a mercantile chases export ROI; a protectionist over-invests in self-sufficiency). This also grounds two things [faction-system.md](../active/gameplay/faction-system.md) marks "planned": **military output** (= directable production capacity) and **faction-owned facilities** (= what the planner builds).

### 12.4 Military as economic output

War power is **not** modelled as a per-ship bill of materials (galaxy-wide hauling micro). It is a **capacity ceiling derived from the aggregate industrial base:**

- **The ceiling.** Sum, across a faction's systems, the production buildings by type — total Smelters/Components Factories → hull capacity, total food/biomass facilities → crew sustainment, total tech/radioactive/exotic facilities → power level / tech tier. The *vector* of building counts maps to a *vector* of military capacities, so a faction's economic **composition is its military character** (mineral-rich → cheap swarms; exotic-rich → few elite ships) — emergent, no scripting.
- **Count = ceiling; feeding them = realisation.** Building count is a slow-moving, stable stock and sets *potential*; whether that potential is *realised* depends on supplying the buildings with inputs/upkeep. **A starved industrial base can't project power even at a high count** — so cutting an enemy's inputs degrades their war potential before you ever touch their fleet (reusing the lane-cut cascade).
- **Military is abstract — but not free.** Assets are built and maintained *behind the scenes* against the ceiling. Military still draws goods as **local demand at military-industrial systems** (the construction/military channel, [§5.1](#51-three-demand-channels)) — what's abstract is that there is **no per-ship bill of materials and no dedicated inter-system military hauling.** The *only* inter-system resource movement the simulation models is growth-enabling material flow ([§12.2](#122-two-transport-modes--market-vs-command)).
- **Costs: build + upkeep.** Fielding military costs facility-build (capital + construction channel) *and* **ongoing upkeep** — a persistent goods/credit drain. This is **guns vs butter**: every unit of build-space/labour/inputs/credit on the military is taken from civilians → unrest ([§7](#7-consequences--the-living-world)); over-militarizing starves your own population, and a standing fleet you can no longer supply attrites. Upkeep is also a treasury sink that helps keep money bounded ([§12.1](#121-affordability-treasury--the-money-model)).
- **Scale gates ambition.** Beyond the continuous capacity ceiling, the *sheer size* of the industrial base also gates **discrete unlocks**: a faction needs a large enough base before it can attempt larger-scale military projects (capital ships, megaprojects) at all. The intent is locked; the exact thresholds — and whether military assets are built as generic buildings or derived from the industrial base — are deferred ([§14](#14-open-questions--deferred-to-sub-project-specs)).

**Military is a downstream concern.** There is no combat in the game yet: military enters only at the agency sub-project (as this ceiling), and full combat resolution lives in the not-yet-built [war-system.md](./war-system.md). This section grounds faction-system.md's "planned" military-output and faction-facility hooks — but **the economy comes first**; none of this is part of sub-projects 1–3.

---

## 13. Sub-project decomposition

The work is far too large for one spec. It breaks into sub-projects, each its own spec → plan → build. Dependencies and a recommended order:

1. **Physical substrate + population** — two-layer traits, bodies with a quantified resource base, sun-gated generation, partial/varied seeding ([§3.4](#34-initial-development-seeding)); derive population, resource availability, and baseline production from bodies + population. This is where economy type's *mechanical* role is replaced. Markets still function via baseline auto-exploitation.
2. **Demand & consequence loop** — population-scaled consumption, need-satisfaction recording, unrest, growth/decline, migration along lanes; days-of-supply pricing. This delivers the "living world." **Specced + forks resolved:** [economy-simulation-living-world.md](./economy-simulation-living-world.md) (SP2). Notable resolutions: it gains a **Part 0** that *de-regions the diffusion engine* (separating performance-sharding from the gameplay flow boundary — flow now follows **sovereign/faction** borders + distance, not regions); **prosperity is retired** in favour of `unrest`; and **rebellion + relation-weighted borders are deferred to sub-project 5** (they need faction control to be a live actor). Tiny/single-system factions noted as a future-consideration item.
3. **Supply-chain production + generic facilities** — input-gating for tier 1+ (shortages cascade); generic one-good buildings and the shared build-space model (the development/industrial-base layer).
4. **Events rethink** — migrate from price-levers to physical perturbations (needs the richer physical state from 1–3 to perturb).
5. **Agency / faction economic AI** — the deciding layer ([§12](#12-agency-layer--who-decides)): the **monetary treasury + throughput tax** (§12.1), the **build planner** (need + neighbour-need + strategic, doctrine/government-weighted, §12.3), **directed logistics** (abstract orders + Elite-style legibility, §12.2), and **military as industrial-base ceiling** (§12.4). Ship an **autonomic-light** version first (subsistence + resource base, self-funded, slow) so the world develops before the full faction brain. Depends on 1–3 and on [faction-system.md](../active/gameplay/faction-system.md). The visible-convoy presentation upgrade (§12.2) is a *later* slice, not part of this sub-project. **Also inherits from SP2** (deferred there because they need faction control to be a live actor): **rebellion** (sustained unrest → system leaves faction control) and **relation-weighted borders** (diplomacy opens the cross-faction flow that SP2 hard-closes).

Trade-flow edge diffusion already exists and threads through all of them.

> **Open sequencing decision (settle when we spec sub-project 1):** *substrate-first* (rebuild the physical foundation and dissolve economy type before adding consequences — builds on bedrock, no throwaway work, but delays the visible "alive" payoff) vs *loop-first* (add population from *existing* traits + the consequence loop + days-of-supply pricing first for a fast living-world payoff, then swap the derivation source to bodies underneath — each phase shippable, but the interim population-from-old-traits derivation is throwaway). To be decided at the start of sub-project 1.

---

## 14. Open questions / deferred to sub-project specs

Resolved this session (now captured above, kept here as a pointer): the **treasury model** is monetary-only (§12.1); the **tax base** is a throughput/sales tax (§12.1); the **directed-logistics abstraction** is abstract orders + Elite-style legibility for v1, M&B visible convoys deferred (§12.2); the **market-vs-command dial** is government-weighted pull strength (§12.2); **military** is an industrial-base ceiling, abstract, with upkeep (§12.4); and **faction spending** is a budget-allocation model with two v1 bands — military upkeep + logistics efficiency (§12.1).

Still open:

- **Sequencing**: substrate-first vs loop-first (see §13).
- **Population units/scale**: what magnitude the single number is in, and how it maps to per-capita consumption rates and to the stock-range increase [production.md](./production.md) calls for.
- **Pricing formula**: exact days-of-supply curve, elasticity, and how the round-trip guard (slippage + spread) carries over.
- **Migration mechanics**: pull/push factors, rate, conservation rules, interaction with jump-lane topology. *(Resolved for SP2 in [economy-simulation-living-world.md](./economy-simulation-living-world.md) §8: attractiveness = low unrest + headroom, distance-attenuated, conserved, on the de-regioned intra-faction topology.)*
- **Unrest → strike/rebellion thresholds**: how unrest accumulates and what triggers each consequence. *(SP2 covers unrest → **strike** + growth/decline (convex demand-weighted dissatisfaction, [living-world §6](./economy-simulation-living-world.md)); **rebellion is deferred to SP5** with the rest of faction dynamics.)*
- **Population satisfaction depth**: amenity need-channels (health, entertainment) met by non-production service facilities, plus negative industrial externalities (pollution/blight) — the industrialize-vs-livability layer (§7). Deferred; additive over the v1 needs→unrest loop.
- **Build-space numbers**: slot budgets per body size, resource-base→cap conversion, baseline-vs-player allocation.
- **Synthetic resources**: some raws may be manufacturable rather than only extracted — fits the chain model; scope later.
- **Tax-rate calibration**: what skim percentage funds construction + war without distorting prices; whether systems also hold a local development fund alongside the faction treasury.
- **Military ceiling formula**: the exact building-count → capacity-vector mapping and upkeep rates (war sub-project / [war-system.md](./war-system.md)).
- **Military production method**: whether military assets are built as generic production buildings (like any good, §8.1) or derived directly from aggregate industrial-base capacity (§12.4). Undecided — settle in the war sub-project.
- **Military project gating**: the industrial-base-size thresholds that unlock larger-scale military projects (§12.4).
- **Budget-allocation bands (extension)**: candidate bands beyond the v1 two — stability/welfare spend (a money lever on unrest), construction subsidy, administration/tax efficiency. Each must hook an existing physics lever; add only as needed (§12.1).
- **Directed-logistics throughput numbers**: how much volume an abstract logistics order moves per tick vs the diffusion cap, and the capital cost curve.
- **Autonomic vs faction-AI split**: how much unaligned systems develop on their own, and the handoff when a faction takes a system over.
- **Tuning**: all balance numbers validated via the simulator (`npm run simulate`), extended to model population, migration, and facility clusters.

---

## 15. Relationship to existing docs

- **[economy.md](../active/gameplay/economy.md)** (active) — the current single-stock model. This vision supersedes its pricing-anchor, economy-type, prosperity, and event-lever sections; the slippage/spread anti-exploit mechanics and the stock substrate carry forward.
- **[system-traits.md](../active/gameplay/system-traits.md)** (active) — reframed into the two-layer bodies/features model (§3), with resource traits folded into the resource base.
- **[faction-system.md](../active/gameplay/faction-system.md)** (active) — gains an economic-management dimension: monetary treasury, build decisions, directed logistics, and military-as-industrial-base (§12). Grounds its "planned" military-output and faction-facility hooks.
- **[production.md](./production.md)** + **[production-roster.md](./production-roster.md)** (planned) — the population stat, raw-goods vocabulary, and supply chains align closely and feed sub-projects 1–3; facility roster re-pointed to generic one-good buildings (§8.1).
- **[player-facilities.md](./player-facilities.md)** (planned) — build system for the development layer (§8) and the player agent (§12).
- **[war-system.md](./war-system.md)** (planned) — consumes the military-as-industrial-base-ceiling model (§12.4); combat resolution and war objectives live there.
- **[events.md](../active/gameplay/events.md)** (active) — event modifier catalog; the `anchor_shift` lever is retired in favour of physical perturbations (§10).
