# Economy Substrate v2 — The Available-Space Model

> **Status: Active** — shipped in the Economy Substrate v2 milestone, replacing v1's resource-magnitude
> vector with finite per-body space. Sits *under* the SP3 input-gating cascade (unchanged). This is the
> detailed substrate reference; [system-traits.md](./system-traits.md) is the system-level overview and
> [economy.md](./economy.md) covers how the substrate drives production, consumption, and pricing.
> Implementation: `lib/engine/substrate-space.ts` (pure partition/quality), `lib/engine/body-gen.ts`
> (generation), `lib/engine/industry-seed.ts` (build-out), constants in `lib/constants/substrate-gen.ts`
> + `lib/constants/bodies.ts`.

---

## Key mechanics (the headline)

A **system** is a cluster of **bodies**. Each body has a finite amount of **available space** — the
one scarce quantity everything competes for.

Three things compete for a body's space:

- **Deposit extractors** (tier-0 raw goods) — can only sit on **dedicated deposit slots**. Ore is
  mined where there's ore; you can't make more ore land than the body has.
- **Population centres** (where people live) — can only sit on the **habitable** portion of space.
- **Production & other buildings** (tier-1+ factories, and future special buildings) — **fungible**,
  they sit on any general (non-deposit) space.

The one distinction that makes it all work: **deposit slots are dedicated, but habitation, production,
and everything else share the same general space.** Population and factories genuinely compete for the
same land; mining is carved out separately.

Two more ideas layer on top:

- **Quality, not just quantity.** Each deposit slot has a **quality band** (poor / average / good /
  rich) that multiplies its yield. So a small body with 10 *rich* ore slots out-produces a big body
  with 20 *average* ones. Slots give scale; quality gives richness; they roll independently — which is
  what lets a tiny dense moon and a sprawling sparse planet both be interesting.
- **Built ≤ available.** A body's deposits and habitable land define what's *possible*; how much is
  actually *built* is a separate, smaller number. The gap is visible headroom — the room faction
  build-out (SP5) grows into. "Available" and "built" are never the same number.

Everything a body offers comes from its **size** (how much space) and its **archetype** (how that
space is divided — a garden world is mostly arable + habitable; an asteroid is mostly ore + minerals;
a gas giant is mostly gas with almost no habitable land).

---

## How the pieces interact

```
body size ─────────────► total available space
body archetype ────────► how that space partitions: deposit slots (per resource) + general space
habitability % ────────► how much of the general space is habitable

  deposit slots ── built extractors ─► raw goods  (output × quality band)
  habitable space ─ built pop centres ─► population (= labour pool + consumer demand)
  general space ── built factories ──► refined goods (SP3 input-gated cascade, unchanged)

population (system-wide) ── staffs ──► every facility in the system (labour pooled at system level)
labour fulfilment = population ÷ labour the built facilities demand  → throttles all production
```

The loop: a body's **size + archetype** set its space and how it partitions. **Deposits** cap raw
extraction (×quality); **habitable land** caps population; **general land** hosts factories and
anything else. **Population** (housed on habitable land) is both the labour that staffs the system's
facilities *and* the demand that the markets serve. **Build-out** (SP5) fills the gap between
available and built. Labour and markets are pooled at the **system** level, so a system's habitable
worlds staff the extractors on its airless mining bodies — nobody lives at the drill.

---

## The three space uses (detail)

**Total available space** comes from body size alone — `SPACE_PER_SIZE × size`, summed over bodies.
(This is a change from v1, where habitability scaled *total* space; see "What changes" below. A big
barren rock now has plenty of space for mining and factories — just little for people.)

**Deposit slots** are dedicated per resource. A body's archetype weight vector (below) assigns each
resource a fraction of the body's space; that fraction ÷ slot footprint = the resource's **available
extractor slots**. Extractors can only occupy their own resource's slots.

**General space** = whatever the deposit slots don't claim. It is fungible:
- the **habitable** fraction of it (`habitability% × general space`) can host **population centres**
  *or* factories *or* other buildings;
- the **non-habitable** remainder hosts factories / other buildings but **not** population.

So population is capped by habitable land; production can spread across all general land; they fight
over the habitable part.

### Habitability is the housing-per-space efficiency knob — a barren-but-alive galaxy

`habitableFraction` (per archetype, `lib/constants/bodies.ts`) is how efficiently a body's general space
converts to housing. It spans the full range: a garden world (`0.7`) packs people densely; rocky barrens
(asteroid/volcanic `0.02`, barren-rock/frozen `0.03`) support only a thin artificial habitation; a **gas
giant is `0` — no surface, truly dead**. Pure-gas systems are the galaxy's rare genuinely-dead worlds.

Industry is **gated on habitability**: a system with no habitable space at all builds **nothing** — its
substrate (deposit slots + quality) is still generated, but it stays a pristine **undeveloped deposit
field** with no buildings and no population (a faction colonises it later, SP5, by paying for orbital
habitation *and* the extractors together). The rest of the barren galaxy is *alive but small*: a rocky
outpost gets a handful of extractors staffed by a tiny population. Population is a **continuous magnitude**
— a tiny outpost is `pop 0.3`, never rounded down to a false zero — so these outposts run small, honest
markets rather than reading as empty. The result: most systems are extraction-dominant (raw building
blocks are needed in huge volume — this dominance is intended, not a generation flaw), ~2% are truly
undeveloped/dead, and a long tail of tiny outposts sits between.

---

## Deposit generation — partition, not sequential rolls

The naive approach (roll one deposit at a time until space runs out) has an ordering bias — whatever
rolls first dominates. We avoid it by treating generation as a **single partition**:

1. Each **body archetype** carries a **weight vector** over the resource types **plus a `general`
   weight** — e.g. garden `{arable 6, water 3, biomass 2, general 9}`, asteroid `{ore 7, minerals 5,
   general 2}`, gas giant `{gas 9, general 1}`. (This is the existing per-archetype resource profile,
   reused as weights.)
2. Apply per-body **jitter**, then **normalise to the body's space** — every resource competes at
   once, and "remaining space after the other deposits" falls out of the normalisation automatically.
   No "what do we roll first."
3. Roll a **quality band per deposit** independently (poor / average / good / rich).
4. For rare extremes (a 90%-radioactive moon), a low-probability **volatility modifier** spikes one
   weight massively *before* normalising.

The entire tunable surface is **the archetype weight vectors + the quality-band odds + the volatility
odds** — all constants the simulator can sweep. The v1 richness modifiers (the 13 `heavy_metals` /
`helium-3` / `glacial_aquifer`-style multipliers) are **retired and fully folded into the band
system**: a deposit's display name is **generated from its band + resource** (e.g. "rich ore deposit",
"marginal water-ice seam") rather than drawn from a curated proper-noun catalog. Generic descriptors
read as *less* repetitive than a small set of recurring named deposits, and they scale to every
band × resource pair for free. Rare volatility extremes may carry a generic special label ("radioactive
hot zone").

### Quality bands (example values — calibration knobs)

| Band    | Yield multiplier (range) |
|---------|--------------------------|
| poor    | 0.4 – 0.7×               |
| average | 0.8 – 1.3×               |
| good    | 1.4 – 1.8×               |
| rich    | 1.9 – 2.5×               |

Labelled for legibility (and panel colour-coding); the range inside each band adds variety. Mirrors
the existing body richness-modifier concept.

---

## Population & labour — folded into space

Population capacity comes **entirely from built population-centre buildings** on habitable land —
there is **no separate body baseline** (the v1 `bodyBaselinePopCap` is retired). `popCap = Σ built
population centres × their density`. Population centres are **data-driven building types** like any
other, so denser / advanced housing (and later, happiness / amenity buildings) are simply new catalog
entries that consume general space and carry their own effects — no structural change needed.

Population centres are sized at seed to **staff the system's industry** — `wantedPopCentres =
labourDemand(buildings) / POP_CENTRE_DENSITY` (`lib/engine/industry-seed.ts`), bounded by the habitable
space available. On most worlds the habitable bound binds first (housing fills the habitable land before it
can house the full workforce), so a **staffing-self-consistency step** (`industry-seed.ts` step 3b) then
scales the built industry *down* to what that housing can staff: every production building is multiplied by
`popCap / labourDemand` so `labourDemand ≤ popCap`. The result is a system that is **fully staffable as its
population matures**, rather than one carrying idle capacity that autonomic decay would immediately
liquidate. The freed deposit/general space is left as honest unbuilt **headroom for later (SP5) faction
build-out**. So a barren world ends up with *less* industry — a skeleton crew sized to its habitable land,
sitting on mostly-unworked deposits — not the same industry run permanently under-staffed; a world with
**no** habitable land (`popCap 0`) builds **nothing** at all (no workforce to house). `yieldMult` is left on
the unscaled placement on purpose — it measures the worked deposit *grade* (a property of the ground), so
the economy-type label stays independent of how much labour is available.

Consequences (intended, and observed in calibration):
- Housing is a **real land competitor** everywhere, not a vestigial top-up.
- **Industry is sized to local labour, not to deposits.** A high-deposit, low-habitability world is a small,
  fully-staffed operation on mostly-unworked deposits — the barren constraint biting as *less built*, with
  the remainder as SP5 headroom. (Population seeds below `popCap` so labour fulfilment ramps from ~the seed
  fill up toward 1 as the world matures, rather than sitting at a permanent structural shortfall.)

**Full-fold held in calibration.** Sourcing capacity entirely from built centres (no body baseline) was
the highest-risk knob, but it calibrated without needing the escape hatch: `POP_BASELINE_FLOOR` ships
**wired but `0`** and stayed there. Population seeds below `popCap` and the live tick grows it toward the
cap (filling housing built for the full workforce), then plateaus — so pre-SP5 the only population
dynamics are this one-time ramp plus unrest-driven decline and migration. Making population growth/decline
track *economic viability* (can the world feed/employ its people) rather than housing-headroom is booked
as an explicit **SP4 phase** ("Population ← economic viability", see
[economy-simulation-vision.md](../../planned/economy-simulation-vision.md) §13).

---

## What changes vs v1

- **Total space** depends on **size only**; habitability becomes the *habitable fraction* of general
  space, not a multiplier on total space. (v1: `40 × size × habitability`.)
- **Deposit magnitude → partition + quality.** v1 generated an absolute magnitude that became the
  extractor count ~1:1 and was never used again (the resource aggregate is not in the production math
  post-SP3). v2 makes the deposit a *fraction of finite surface* (slots) × a *quality band* (yield),
  so the abstraction earns its keep and nothing is silently wasted by a `min()`.
- **Built < available** is explicit — seeding fills well below the slot/space ceilings, leaving
  headroom for SP5 build-out.
- **Population from built centres**, no body baseline.
- **Unchanged:** the SP3 tier-1+ input-gating cascade; system-level pooling of labour, population, and
  markets; building types as a data-driven catalog.

---

## Open calibration knobs (all simulator-tunable)

- `SPACE_PER_SIZE` (total available space per unit body size).
- Archetype **weight vectors** (resource + general split per body type).
- **Quality-band** odds and per-band yield ranges.
- **Volatility** (extreme-deposit) probability and spike magnitude.
- Population-centre **density** values; whether a small body baseline floor survives.
- Seed **fill fractions** (how far below available the seeded build-out sits) per use.

---

## Per-system aggregation

Deposit slots + quality bands are generated **per body**, then **collapsed to per-system aggregates**
denormalised onto `StarSystem` — an extractor-slot **cap** (`slot*` columns) and an **effective-yield
multiplier** (`yield*` columns) per resource — so the per-tick economy never joins the bodies table.
`WorldBuilding` stays system-level; per-body slots/quality are generation-time concepts that never reach
the hot path individually. Goods that share a resource (food/textiles ← arable) share its slot cap and
quality. The seeder fills **best-quality slots first**, so a system's effective yield = mean quality of
its *filled* slots (`1.0` when none are filled). The live tick adds exactly one new production term: a
tier-0 good's output × its resource's `yieldMult`.

The Industry/substrate **panel redesign** that visualises this model is the milestone's final UI phase
(P7) — built last so it renders the finished substrate.
