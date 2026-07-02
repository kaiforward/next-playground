# Economy Specialisation S2 — Specialisation Complexes

> **Status: Planned** — stage **S2** of the four-stage Economy Specialisation track. Sits inside **SP5
> autonomic-light**: every lever works *through* the existing autonomic build planner and physical-economy
> tick — **no faction-agency dependency** (no treasury, doctrine-weighted build, or directed-logistics
> orders). Track umbrella + the other stages live in
> [economy-specialisation.md (planned)](./economy-specialisation.md); S1 (shipped) is
> [economy-specialisation.md (active)](../active/gameplay/economy-specialisation.md); roadmap home is
> [economy-simulation-vision.md](./economy-simulation-vision.md) §13.

---

## Key mechanics (the headline)

S1 gave manufacturing a *gate* (skilled labour a system must build academies to license), but no
**comparative advantage** — with the academies up, every developed system is equally good at every
manufactured good, so at maturity the planner still fills out the whole basket everywhere and the price
gradient re-flattens.

S2 gives manufacturing built comparative advantage: a **specialisation complex** — one anchor building per
system that grants a **fixed yield multiplier to a whole *family* of related goods**. It is the tier-0
deposit `yieldMult`, but *built by investment choice* instead of geological.

> A system may build **one** complex, of **one** of five production families. The complex has a **large,
> fixed footprint** that eats the general space it would otherwise spend on breadth or housing, so a system
> that commits to a family physically **can't also be broad** — it specialises and imports the rest. Nothing
> is forbidden; the finite space does the forcing.

Three properties make it self-limiting and agency-free:

- **Discrete & capped, not a continuous curve.** The buff is a fixed `×B` at a hard cap of **one complex per
  system** — deliberately *not* a marginal-efficiency curve that scales with the industry it buffs (which
  would be runaway-prone: bigger → more buff → bigger). The **hub** scales through its *factories* (which
  already breathe with demand); the **anchor** is a fixed lever those factories sit under.
- **Built by the existing planner, valued transitively.** The autonomic build planner co-builds the complex
  exactly as S1 co-builds academies — charged to the same deficit-serving opportunity, worth *the extra
  output the buff unlocks across the whole family*. It only pays off at scale, so complexes emerge only at
  genuine high-throughput hubs.
- **Self-balancing by demand-pull, no global counter.** The planner is already demand-pulled (it builds only
  to serve structural deficits). That *is* an implicit galaxy-wide balancer: a family in short supply blooms
  deficits everywhere → pulls its industry + complex into being; a family in surplus stops pulling. No
  omniscient "we need more electronics hubs" bookkeeping — which would violate the emergence north star and
  is unnecessary.

---

## The five families

A clean partition of the 18 manufactured (tier-1+) goods into five **vertical** families — grouped so a
family's goods largely share inputs, so a system that commits to a family can realistically produce most of
it and the buff lands. Tier-0 extraction stays **un-anchored**: deposits are already its geological gate.

| # | Family | Goods | Roots on (raw) |
|---|---|---|---|
| ① | **Heavy Industry** | metals, alloys, hull_plating, components, machinery, ship_frames | ore, minerals |
| ② | **Chemicals & Energy** | fuel, chemicals, polymers, medicine | gas, minerals, biomass |
| ③ | **Electronics & Computing** | electronics, targeting_arrays | *(imports intermediates)* |
| ④ | **Armaments** | munitions, weapons, weapons_systems, reactor_cores | radioactives *(+ imports)* |
| ⑤ | **Consumer & Luxury** | consumer_goods, luxuries | textiles *(+ imports)* |

**Input chains** (`⛏` raw, extracted where the deposit exists · `·` made in-family · `⇽X` imported from
family X):

```
① Heavy Industry — self-contained above extraction; exports intermediates to everyone
   metals        ← ⛏ ore
   components     ← ⛏ minerals · metals
   alloys         ← · metals   ⛏ minerals
   hull_plating   ← · metals   · alloys
   machinery      ← · metals   · components
   ship_frames    ← · hull_plating · alloys · components

② Chemicals & Energy — near-self-contained; one import
   fuel       ← ⛏ gas
   chemicals  ← ⛏ gas  ⛏ minerals
   polymers   ← ⛏ gas  ⛏ biomass
   medicine   ← ⛏ biomass  · chemicals

③ Electronics & Computing — apex importer
   electronics      ← ⇽① components  ⇽② chemicals
   targeting_arrays ← · electronics  ⇽① components

④ Armaments — apex importer
   munitions       ← ⇽① metals  ⇽② chemicals
   weapons         ← ⇽① metals  ⇽② chemicals  · munitions
   weapons_systems ← ⇽③ electronics · munitions ⇽① hull_plating
   reactor_cores   ← ⛏ radioactives ⇽① alloys ⇽① components

⑤ Consumer & Luxury — leaf importer
   consumer_goods ← ⛏ textiles  ⇽② polymers
   luxuries       ← · consumer_goods  ⇽③ electronics
```

**Trade topology this produces:** ① Heavy (exporter) → ② Chem (near-base) → ③/④ Electronics/Armaments (apex
importers) → ⑤ Consumer (leaf). Strong, directional opposing flows fall straight out of the recipe graph —
the gradient the whole track is chasing.

**Balance note.** The tier spread is intentionally *uneven* — tier-1 clusters in the two base families
(Heavy + Chem hold 8 of 10 tier-1 goods); tier-2 spreads across the downstream three. That is a real
base→apex development gradient, not a defect (there is no tier-2 chemical good to hand ②, nor a tier-1
electronic good to hand ③). By family "weight" it is two heavyweights (Heavy, Armaments ≈ 525 Σ basePrice)
and three mid-weights (≈ 200–220), the thin families making it up on unit price. Any residual
attractiveness imbalance is corrected with a **per-family buff weighting** (a slightly smaller `B` on the
big families) at calibration — *not* by distorting the taxonomy, which stays driven by what feeds what.
Family assignments of border goods (`components` — the universal intermediate, in Heavy; `reactor_cores` —
Heavy vs Armaments; `munitions` — Chem vs Armaments) are the first tweakables.

---

## The buff mechanic

The complex's multiplier threads into production the same way S1's skill caps do — **derived from
`buildings`, no signature change** to `buildingProduction`:

```
// per family f: its goods, its multiplier, its cap.
familyAnchorBuff(buildings, goodId):
    f = FAMILY_BY_GOOD[goodId]              // undefined for tier-0 and un-familied goods → ×1
    if f is undefined: return 1
    count = buildings[COMPLEX_OF[f]] ?? 0   // the family's complex, 0…cap
    return 1 + (B_f − 1) × min(1, count)    // proportional to completeness; full B_f at count = 1

// folded into the existing production sum, alongside the tier-0 yield term:
output_g = Σ count × outputPerUnit × effectiveFulfilment(tier_g) × yieldMult_g × familyAnchorBuff(buildings, g)
```

- **`count ∈ [0, cap]`** (cap = 1). The buff scales linearly with `count`, so a half-built *or* half-decayed
  complex gives half its bonus — smooth, no cliff, and consistent with fractional building counts elsewhere.
- Because the buff multiplies *output*, it automatically flows into **input-demand forecasting**
  (`inputDemandForGood` reads `buildingProduction`): a buffed hub produces more → draws proportionally more
  inputs → is a bigger *importer* of its family's intermediates. Opposing flows for free.
- The buff does **not** change a factory's staffing ratio (`effectiveFulfilment`) — an anchor makes each
  factory *yield more*, not *be more staffed*. Factory decay `used` is unchanged. (A buffed hub can glut its
  family locally faster, dropping `outputUptake` until exports carry it away — the correct self-regulation,
  handled by the existing selling/decay path.)

---

## Autonomic build — the complex as a buildable, family-valued multiplier

The complex produces no good, so — like an academy — the demand-pulled planner would never build it on its
own. S1 already solved this shape for academies (`academyLift`): a non-producing support building is
**co-built, charged to the same deficit-serving opportunity, and valued transitively**. S2 reuses it with
one difference:

- The **academy is a hard gate** (without it, output = 0 → its value is the whole output it unblocks).
- The **complex is a soft multiplier** (output is fine without it → its value is the *marginal extra* output
  the buff unlocks).

**The valuation rule:** when the planner commits family production at a site that lacks that family's
complex, it weighs spending the space on more raw factories vs. on (the complex + fewer, buffed factories),
and builds the complex when the buffed option serves **more deficit per unit of space/budget**. It is
valued against the site's **total reachable deficit across the *whole family***, not just the current good —
because the anchor buffs the entire family. That family-aggregate is what clears the anchor's large
footprint; a single good's marginal gain usually would not.

- **Self-limiting at scale.** With `B ≈ 1.5` and footprint `≈ 8`, the complex only amortises once the site's
  spare family space exceeds ~3× the footprint (small deficit or little space → not worth it). So complexes
  emerge only at real hubs, with the hard cap-1 as a backstop, not the primary limiter.
- **Concentration moat (snowball).** Applied to the working copy the moment it's built, so every *subsequent*
  family-good opportunity at that site sees buffed output → higher `served ÷ route-cost` score → the greedy
  planner keeps choosing that site for family goods over greenfield rivals. This **stacks with S1's academy
  sunk-cost moat**: the site that already paid for its research institutes *and* its Heavy complex becomes
  *the* regional heavy-industry hub and physically can't also be broad.
- **Attract, never restrict.** No rule forbids a Heavy-anchored world from building electronics. Its buffed
  family industry simply wins the competition for finite general space; the complex's footprint + the
  concentrated build-out crowd out the breadth. The "can't feed itself" comes from space scarcity (already
  modelled), routing entirely through the existing planner + physical tick — the S2 scope constraint.
- **Co-build sizing.** The complex joins the existing `academyLift` convergence loop as one more co-built
  term consuming the same budget + general space + spare unskilled labour (it draws a modest unskilled staff,
  like an academy). Production + academies + complex are sized together to fit all constraints.

**Self-balancing across the galaxy** needs no new state: deposits decide *which* families a system *can* root
(Heavy needs ore/minerals, Chem needs gas, Armaments' reactor_cores needs rare radioactives…), and deposits
already vary system-to-system; demand-pull decides *how many*. The natural distribution of planets plus the
deficit signal produce the mix — a self-correcting global balance with zero global bookkeeping.

---

## Decay — the complex rots toward the family it buffs

Same single rule as production, housing, and academies: **decay toward what is used.** The complex's `used`
mirrors the academy's `count × min(1, demand / cap)` shape, with the family's built factory throughput as
its "demand":

```
familyThroughput = Σ_{g ∈ family} (built factory output capacity of g)   // stable, built-base driven
complexUsed      = count × min(1, familyThroughput / (count × R))         // R = rated coverage per full complex
```

- **Thriving family** → `used ≈ count` → the complex holds at its cap.
- **Family collapses / out-competed by a nearer hub** (`familyThroughput → 0`) → `used → 0` → the complex is
  **orphaned and rots away**, freeing its ~8 space *and its cap-1 slot* so the system can later re-specialise
  into whatever the galaxy now pulls from it. This is why the complex decays rather than being permanent —
  without it, a dead forge world would be stranded with a Heavy complex buffing nothing.

It drops into `computeSystemDecay` as one more branch alongside the two academy cases — same rule, same pass.

---

## Seed — a matured galaxy opens already specialised

The seed (`allocateIndustry`) places anchors so a fresh 10k galaxy starts with real specialisation, exactly
as S1 seeds academies sized to seeded skill demand (rather than waiting thousands of ticks for the planner to
grow them in). Per system, after factories are placed:

- Identify the **dominant family** (largest seeded family throughput). Place its complex, `count = min(cap,
  familyThroughput / R)`, charged to the same factory budget; skip if the dominant family's throughput is
  below the amortisation floor (that system seeds un-specialised — a generalist frontier world).
- The complex draws unskilled labour like an academy, so it flows through the existing **staffing
  self-consistency** scale-down (step 3b): if seeded labour exceeds the housed population, the complex scales
  down proportionally alongside production and academies.
- Buff applies automatically at read time from the seeded complex `count` — no need to rescale seeded factory
  counts.

---

## Constants (coarse first-cut — calibrated once, after the whole S1–S4 track)

All magnitudes are first-cut and simulator-tunable; the real calibration is **one pass once the structural
track is in**, per the coarse-health-calibration principle. In `lib/constants/industry.ts`:

- `SPECIALISATION_COMPLEXES` — one entry per family: `{ family, goods, buffMult B_f, spaceCost ≈ 8, labour
  (modest unskilled), cap = 1 }`. Five building types, ids e.g. `heavy_industry_complex`, …
- `FAMILY_BY_GOOD` / `COMPLEX_OF` — the good↔family↔complex lookup maps derived from the catalog.
- `ANCHOR_BUFF` `B` ≈ **1.5×**, with **per-family weighting** (slightly lower on Heavy/Armaments) to level
  anchor attractiveness.
- `ANCHOR_FOOTPRINT` ≈ **8** general-space units at `count = 1` (the largest building type — a shipyard is
  4.0), charged proportionally to `count`.
- `ANCHOR_RATED_COVERAGE` `R` — family throughput one full complex is rated to buff; sets the decay `used`
  ratio and the planner's amortisation reference.
- `ANCHOR_CAP` = **1** per system.

---

## Scope boundaries

**In (S2):** five specialisation-complex building types (one per family) + the good↔family↔complex maps; the
per-family buff folded into `buildingProduction` (and thus input-demand); the planner's transitive,
family-aggregate co-build valuation (extending `academyLift`); complex decay toward family throughput; seed
anchors at each system's dominant family; the complex + its "what it does" copy + cap in the Industry panel.

**Deferred (later stages of the track, all agency-free):**
- **S3 — demand concentration** (civilian consumption by system character, not flat per-capita) — pairs
  directly with S2: a specialised hub becomes a concentrated *importer* of its inputs.
- **S4 — guardrails & tuning** (build-pacing, tier-scaled decay, diffusion friction) — tuned *last*, against
  the real gradient S1–S3 create; the single calibration pass for all S1–S4 magnitudes lands here.

**Genuinely deferred (downstream, unchanged in sequence):** full faction agency (treasury /
doctrine-weighted build / directed-logistics orders — the complex's *capital* cost arrives with the
treasury; in the agency-free near-term it is paid in space + the cap), the contract-model rework, ship
re-pricing, events, war. **Continuous economies-of-scale** stays the explicitly-rejected alternative (the
discrete capped complex *is* economies-of-scale, without the runaway curve).

---

## Live code touched

- `lib/constants/industry.ts` — `SPECIALISATION_COMPLEXES` catalog (five complex `BuildingTypeDef`s:
  fixed footprint, modest unskilled labour, `buffs`/`buffMult`/`cap`), `FAMILY_BY_GOOD` / `COMPLEX_OF` maps,
  `ANCHOR_*` constants.
- `lib/engine/industry.ts` — `familyAnchorBuff(buildings, goodId)` folded into `buildingProduction`
  (and so into `capacityGoodRates` / `inputDemandForGood`); the Industry readout surfaces the complex + its
  family buff.
- `lib/engine/directed-build.ts` — the complex as a family-valued buildable multiplier: extend the
  `academyLift` co-build/convergence path to co-build the family complex, valued against family-aggregate
  reachable deficit; a per-family cap-1 guard in `buildableUnits` for complex types.
- `lib/engine/infrastructure-decay.ts` — complex `used` = `count × min(1, familyThroughput / (count × R))`;
  one branch in `computeSystemDecay`.
- `lib/engine/industry-seed.ts` — seed each system's dominant-family complex, sized to seeded family
  throughput, charged to the factory budget and scaled by the staffing self-consistency pass.
- `lib/constants/building-descriptions.ts` — bespoke "what it does" copy for the five complexes.
- `components/system/industry-panel.tsx` — render the complex (its family, buff, and the goods it buffs);
  minimal, reusing the existing building-row + tooltip surface.

## Relationship to existing docs

- **[economy-specialisation.md (planned)](./economy-specialisation.md)** — this is the detailed spec for the
  **S2** row of that umbrella's staged decomposition; realises its "Specialisation complexes (anchor
  buildings)" section.
- **[economy-specialisation.md (active, S1)](../active/gameplay/economy-specialisation.md)** — S2 builds on
  S1's academy co-build (`academyLift`) and skill-gated production, and stacks its concentration moat on S1's
  academy sunk-cost moat.
- **[economy-simulation-vision.md](./economy-simulation-vision.md)** — realises §8 (industrialise-vs-feed
  pull) and §11 (regional specialisation) at the baseline; pre-builds the substrate full faction agency (§12)
  will later *decide* over.

## Open questions (deferred to the build plan / calibration)

- **All magnitudes** — `B` + per-family weighting, footprint, `R`, the complex's unskilled staffing. Coarse
  first-cut now; validated in the single S1–S4 calibration pass (`npm run simulate` + `audit:economy`,
  cross-checked against the 10k DB at maturity ~tick 6000).
- **Border-good family assignments** — `components` (Heavy vs its own), `reactor_cores` (Heavy vs Armaments),
  `munitions` (Chem vs Armaments). Settle against how the trade topology reads in sim.
- **Planner amortisation reference** — whether valuing the complex against family-aggregate reachable deficit
  needs a dedicated aggregate opportunity, or emerges from the per-good opportunities sharing a site's working
  copy. Settle during the build (an implementation choice, not a design fork).
- **Buff → factory-count seed coupling** — whether seeded hubs should also carry *more* concentrated factory
  counts (not just the buff), or leave that for the mature economy's decay + build to settle. First-cut:
  leave it; buff-only seeding.
