# Habitability & the Substrate

> **Status: Active.** Every body in the galaxy is a climate-class archetype scored for how livable
> it is, carrying two independent physical budgets — habitable land and authored deposit counts —
> plus a habitability score that gates whether it contributes land at all. This is the detailed
> substrate reference; [economy.md](./economy.md) covers how the substrate drives production,
> consumption and pricing, and [colonisation.md](./colonisation.md) covers claims, founding and
> abandonment.
> Implementation: `lib/constants/bodies.ts` (archetype table), `lib/engine/body-gen.ts`
> (generation), `lib/engine/habitability.ts` (fill-best-first quality), `lib/engine/population.ts`
> (growth coupling), `lib/services/colony-eligibility.ts` (colonisability).

---

## The headline

Habitable worlds are rare and big, and a world's nature means something. Each body is a climate
class on a freezing→volcanic spectrum, and each class carries a **habitability score** against the
default population's preference. Only bodies whose score clears a threshold contribute **habitable
land** — the budget housing draws on. Every body, habitable or not, carries a handful of **authored
deposit counts** per resource it hosts. A colonised system works the deposits on all its bodies;
population fills its best land first, so a colony's growth rate is a direct read of how good its
occupied land actually is. Systems that decline to empty end, famine or not.

Industry buildings — factories, academies, complexes and construction centres — **bill no land
at all**; labour, demand and decay bound them instead (see "Why industry bills no land" below).
The two budgets are the whole physical story: habitable land and deposit counts.

---

## Body archetypes and scores

Twelve archetypes span a freezing→volcanic spectrum: `frozen_world`, `tundra_world`,
`boreal_world`, `ocean_world`, `temperate_world`, `gaia_world`, `jungle_world`, `arid_world`,
`volcanic_world`, plus the athermal `barren_rock`, `asteroid_belt` and `gas_giant`
(`lib/constants/bodies.ts`). Each row authors a **habitability score** against the default
population's preference (`HABITABILITY_THRESHOLD = 0.5`):

| class | score | contributes habitable land? |
|---|---|---|
| temperate_world | 1.0 | yes — the only 100% |
| gaia_world | 1.0 | yes (its edge is more land, never a score above 1) |
| jungle_world | 0.7 | yes |
| ocean_world | 0.65 | yes |
| boreal_world | 0.6 | yes |
| arid_world | 0.35 | no — hot-preference / terraforming territory |
| tundra_world | 0.3 | no — cold-preference / terraforming territory |
| frozen_world | 0.1 | no |
| volcanic_world / barren_rock | 0.05 | no |
| asteroid_belt | 0.02 | no |
| gas_giant | 0 | no |

Every class that could ever host people — including arid and tundra — authors a habitable-land
range on its table row; it just sits **dark** (present but non-functional) below the threshold,
waiting for a future adapted population type or terraforming to light it up. Truly dead classes
(frozen, volcanic, barren rock, asteroid, gas giant) author zero. A third, general-purpose land
budget existed on every class's table row through most of this feature's development — see "Why
industry land was cut" below for why it was deleted rather than shipped.

**Correction to a retired claim:** boreal worlds read yellow or orange only. Red-dwarf and
blue-white stars carry no above-threshold class at all — by design, both wait for terraforming or
an adapted population type — so boreal never appears on a red-dwarf table row
(`lib/constants/bodies.ts`, the `red_dwarf` and `blue_white` `SUN_CLASSES` entries carry no
above-threshold archetype weight).

A habitable-count damping ladder (`HABITABLE_COUNT_DAMPING = [1, 1.1, 0.3, 0]`) multiplies
above-threshold class weights before the per-body roll, so a 4th habitable body in one system is a
fixed, non-tunable **zero** — impossible by table, never by chance. Every sun class keeps at least
one positive-weight dead class; yellow and orange dwarf keep at least one positive-weight
above-threshold class.

---

## The two budgets

Aggregates build at generation and rebuild whenever a body unlocks:

- **Habitable land** = Σ authored habitable-land range over bodies whose score clears the default
  threshold and are unlocked. Housing bills against this budget alone.
- **Deposit counts** = per-resource Σ authored integer counts over unlocked bodies. Extractors bill
  one worked level per authored count, capped per resource.

Neither budget derives from the other, and nothing partitions a shared "available space" total the
way an earlier model once did (`lib/engine/industry.ts`'s `SubstrateSpace` — `{ people, deposit }`,
each an independent used/total pair). Factories, academies, specialisation complexes and
construction centres bill **neither** budget: they cost labour, demand and decay, not land.

### Why industry bills no land

A per-body industry-land budget was measured before being ruled out: at generation-tuned tables
(seed 42, t=10K, 182 developed systems) its utilisation topped out at 38% on the busiest homeworld
and never reached 1% on any colony — a ceiling that never binds is pure authoring burden and UI
noise. Industry is therefore gated by labour, deposit slots (extractors only) and decay, never by
a land ceiling — the Victoria 3 model, where urban industry binds on employment, not land. Don't
reintroduce a land gate for industry without new evidence that something would actually bind on it.

### Sizing anchor

The anchor cohort (temperate + gaia + ocean + jungle + boreal) targets a mean full-build-out
capacity ≈ 10,000 pops (500 land at `POP_CENTRE_DENSITY` 20, `lib/constants/industry.ts:179`);
gaia tops the spread with a max body capacity ≈ 20,000 (≈1,000 land). Deposit-count bands are
derived from demand at that anchor population — per resource, `Σ_goods(GOOD_CONSUMPTION[g] /
OUTPUT_PER_UNIT[g]) × target pop` — rather than from measured usage, so the count model's own
premise ("extractor count is deposit-capped") is true for the first time.

### Deposit quality

Each authored deposit count carries its own **quality band** (poor / average / good / rich), rolled
independently per resource per body (`rollQualityBand`, `lib/engine/substrate-space.ts`) and folded
into `yieldMult` — the pure ground-grade multiplier a resource's worked extractors read
(`depositGradeVector`, `lib/engine/body-gen.ts`). A deposit's display name is generated from its
band + resource (e.g. "rich ore deposit", "marginal water-ice seam") rather than drawn from a
curated proper-noun catalog, so every band × resource pair reads naturally without hand-authoring
one. Quality bands are unchanged by the habitability retune — only how much of each resource a body
carries (an authored integer count, not a slot cap derived from body size) changed.

---

## Extraction pooling

Extractors bill deposit counts, but the *yield* they achieve is a per-system pool, fixed at
generation: `extractionEfficiency[resource]` is the deposit-count-weighted mean of each
contributing unlocked body's `extractionModifier` (`lib/engine/body-gen.ts`,
`extractionEfficiencyVector`), and reads 1.0 where the system has no counts for that resource.
Tier-0 output multiplies count × `yieldMult` (the deposit's ground-grade quality, unchanged in
meaning) × `extractionEfficiency`. Because pooling happens once at generation across a system's
bodies rather than per placed extractor, a body's habitability modifier is a **contribution weight**
to the system's shared yield, not the yield of an extractor physically placed there — a body's own
deposit list is presented per-body in the Astrography panel, but the pooled efficiency read lives
at the system-level deposit table, not restated per body.

Tech-locked classes contribute zero counts, zero extraction-efficiency weight and zero habitable
land to every aggregate; locks only ever *release* (unlock re-aggregates the bodies), and there is
no unlock mechanic shipped yet — `[PENDING: technology]`.

---

## Fill-best-first quality and the growth coupling

A system's habitable-land bodies are sorted by score, best first. **Quality** is the
land-weighted mean score over the occupied prefix — the bodies population currently fills, in
score order (`systemHabitabilityQuality`, `lib/engine/habitability.ts`). Edge cases: an empty
system reads its single best body's score (a seed colony opens at its best world's quality, never a
mean and never 0); population overrunning all habitable land clamps at the all-bodies mean. Quality
is cached per system and only recomputed when the occupied prefix crosses a body boundary — most
systems carry one habitable-land body and a constant quality; the mechanic's live audience is mixed
ocean/jungle/boreal-led systems.

Quality multiplies the **growth term only** inside `populationDelta`
(`lib/engine/population.ts:465-476`) — decline and overshoot-death read raw population and unrest
untouched, so a marginal-land world doesn't die faster, it grows slower. With
`growthRate == declineRate` (`lib/constants/population.ts`), net population is positive only while
`quality × crowdFactor × (1 − shortfall) > unrest`: a marginal-land colony under sustained stress
genuinely shrinks. That is intended — hard worlds are fragile — and the exit is **abandonment**:
it fires on population dropping below `ABANDON_POP_FLOOR` (1) regardless of the famine bit
(`lib/tick/processors/population.ts`, the `supply.survivalShortfall` requirement is dropped), so
decline-to-empty ends a colony exactly as a famine collapse does. `ABANDON_POP_FLOOR` (1) sits
below `COLONY_SEED_POP` (2), so a fresh seed colony survives an unlucky first cycle.

Colonist delivery and diffusion migration read `popCap`/unrest only and are deliberately
quality-blind — a low-quality world still fills to its built housing, and being empty, fills first.

**Surfaces:** the Population tab's growth line reads "Habitability: N%" (`growthMultiplier`,
`components/system/population-panel.tsx`) with a fill-order decomposition tooltip
(`HabitabilityTooltipContent`) listing every habitable-land body in score order with the
settlement frontier marked. Astrography shows each body's own score band, lock state, occupancy and
deposits (`components/system/body-card.tsx`).

---

## Colonisability

A system is colonisable once its aggregate habitable land reaches one housing level
(`effectiveSpaceCost(HOUSING_TYPE)`, `lib/services/colony-eligibility.ts:86`). A zero-habitable-land
system is never eligible; claims stay free regardless (dead systems remain territory and corridor).
Colonisable share targets 30-40% of systems, and it is deliberately asymmetric: blue-white and
red-dwarf stars carry no above-threshold class for the default population, so roughly a quarter of
stars (by class weight) wait for terraforming or an adapted pop type before they can ever be
colonised.

---

## Claims scoring, abandonment and the planner's site ranking

**Expansion claim scoring** normalises its substrate terms — habitable land ÷ galaxy max, resource
diversity ÷ resource-type count — onto the same [0,1] scale the homeworld-placement scorer uses, so
a giant system cannot dominate a claim candidate's score by raw scale alone
(`lib/engine/expansion.ts`).

**Colonisation value** carries two land-shaped coefficients, not three: `LAND_PREMIUM` on habitable
land and `LAND_DEPOSIT_WEIGHT` on deposit richness (`L(c) = LAND_PREMIUM · peopleLand +
LAND_DEPOSIT_WEIGHT · depositRichness`, [colonisation.md](./colonisation.md)) — the industry-land
term the model once carried was deleted with the budget, not re-derived. The unblocking-value term
`U(c)` still credits a colony for the unmet demand its deposits unblock; land itself is a smaller,
secondary term.

**Abandonment** resets a system to unclaimed frontier the instant its population drops below
`ABANDON_POP_FLOOR`, regardless of cause (famine collapse or the quality-driven decline-to-empty
above) — see [colonisation.md](./colonisation.md) for the full reset mechanics.

**The autonomic build planner's site ranking** no longer has an industry-land ceiling to bound a
tier-1+ site's scored capacity, so it scores construction cost directly instead of a capacity proxy:
for tier-1+ opportunities the site's marginal work-per-delivered-unit (amortising a missing
specialisation complex's own cost over the demand it would actually serve) divides the
demand-weighted proximity sum, so a big shortfall justifies standing up a new complex and a small
one doesn't, and projected staffing of the marginal unit keeps an unstaffable site from
outranking a staffed hub. Tier-0 (deposit-capacity) scoring is unchanged (`lib/engine/
directed-build.ts`, the opportunity-score branch).

---

## Not covered here

- **Technology / terraforming unlock flow** — no unlock mechanic ships; locks only ever release.
  Stale `economyType` labels on unlock are the same accepted interim gap
  (`[PENDING: technology]`).
- **A second population type** — the score table ships with one preference column (`default`); a
  second row is future work.
- **Per-body population or per-tick per-body work** — everything resolves at generation, on
  unlock, or in one per-cycle quality fold; nobody lives at a specific body.
- **Housing quality as a happiness/wealth investment** — a distinct, later mechanic
  (`docs/ROADMAP.md`, the pop-wealth row); nothing here forecloses it.
