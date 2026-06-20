# Economy Substrate v2 — The Available-Space Model

> **Status: Planned (post-SP3).** Revises the substrate layer from
> [economy-simulation-substrate.md](economy-simulation-substrate.md). Sits *under* the shipped SP3
> input-gating cascade (that stays as-is). Requires a reseed + a calibration pass. Not yet built.

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

Consequences (intended):
- Housing becomes a **real land competitor** everywhere, not a vestigial top-up.
- **Labour fulfilment becomes a live constraint** — a high-industry, low-population system is genuinely
  under-staffed, instead of pop always dwarfing labour demand.

⚠️ **Highest-risk knob — full-fold is locked.** Population is the demand engine of the whole economy;
sourcing capacity entirely from built centres (no body baseline) is the change most likely to need
re-calibration. The intent is deliberate: **people must occupy real land**, competing with industry for
the habitable fraction of general space. A `POP_BASELINE_FLOOR` constant ships **wired but set to 0** —
a one-number escape hatch. If full-fold proves too swingy, the **first** lever is tuning the
population-centre building itself (density, space cost, tiers), *not* re-introducing a baseline; the
floor is the last resort.

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

## Build kickoff — locked decisions (2026-06-20)

Confirmed at the start of the build, layered on the model above:

1. **This doc is the spec.** Substrate-v2 reuses this planned doc as its source of truth (no duplicate
   spec); it graduates to `docs/active/` when the milestone ships. The code-heavy build plan lives
   transiently in `docs/plans/`.
2. **Per-system aggregation.** Deposit slots + quality bands are generated **per body**, then
   **collapsed to per-system aggregates** denormalised onto `StarSystem` — an extractor-slot **cap**
   and an **effective-yield multiplier** per resource — exactly mirroring how the v1 resource vector is
   denormalised today. `SystemBuilding` stays system-level; per-body slots/quality are generation-time
   concepts that never reach the hot path individually. Goods that share a resource (food/textiles ←
   arable) share its slot cap and quality. The seed fills best-quality slots first, so a system's
   effective yield = Σ(filled slots × their band).
3. **Richness modifiers retired.** Folded entirely into quality bands with generated generic names (see
   *Deposit generation* above).
4. **Population full-fold.** No body baseline; `POP_BASELINE_FLOOR = 0` escape hatch (see *Population &
   labour* above).
5. **Panel redesign ships last.** The Industry/substrate panel redesign (plus any other UI polish) is
   the **final phase** of the milestone, built on the finished model so it visualises the real
   substrate. The current panel stays functional throughout the substrate changes.

## Sequencing

SP3 (input-gating cascade) closes first as its own clean PR. Then substrate-v2 lands as its own
milestone: body-generation + seeder rework → reseed → calibration pass → the Industry-panel redesign
on top of the new model (the panel should visualise the *final* substrate, so it follows, not leads).
