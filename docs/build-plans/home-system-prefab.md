# Home-system prefab + realistic starting scale

*Colony-bootstrapping arc, PR4 (redefined). Supersedes the old "PR4 = calibration + seeding fix"
outline in `colony-bootstrapping.md`: the seeding fix became a deterministic home-world prefab at a
realistic physical scale, and calibration is deferred to the next PR. Delete this build plan once the
feature ships shared→main.*

## Why

The colony-bootstrapping sim work is blocked on a confound: home systems are **badly set up**. World-gen
seeds them by a fractional allocator (`allocateIndustry`) that scales industry down to a deliberately
under-seeded housing budget and then floors every count to a whole level — which wipes the small tier-1
factory counts (0.1–0.9 → 0) while large extractors survive. The galaxy starts **extraction-only**, driving
both the chronic higher-tier goods deficit and the large early-homeworld unemployment. We can't calibrate
colonisation against home systems that are themselves broken.

Two other problems surface at the same seam:
- **Scale is unrealistically small.** Max system population is `habitableSpace × POP_CENTRE_DENSITY ÷ housing
  footprint ≈ 25 × 20 ÷ 1 ≈ 500` pops = 500 M people. A spacefaring civilisation should have billions.
- **`allocateIndustry` is elaborate machinery for something now trivial.** After the emergent-start pass
  (`applyEmergentStartingCondition`) zeroes every non-homeworld system's population and buildings, the
  allocator's only surviving output is the homeworld's industry. Everything else it computes is discarded.

This PR replaces the fractional allocator with a **deterministic home-world prefab** at a **realistic
physical scale**, and deletes the machinery the prefab obsoletes.

## Goal / outcomes

1. Every faction homeworld starts from an **identical, self-sufficient** industrial base (tier-0→2), so
   calibration measures colonisation, not homeworld set-up noise.
2. Worlds are **realistically large** — a developed system supports ~5 B people (~5000 pops), not ~500 M.
3. The fractional allocate → scale-down → floor path (the bug's home) is **deleted**.

Non-goals (explicit follow-ups): coefficient calibration and the galaxy-wide colony-scale tuning; removing
the display-only economy-type taxonomy (~40-file refactor — its own PR); a fat "rare 50 B" size tail (pure
flavour, deferrable).

## Background — how seeding works today

- `generateUniverse` (`universe-gen.ts`) scatters systems, then `applyEmergentStartingCondition(systems,
  homeworldIndices)` zeroes `population` and `buildings` on every **non-homeworld** system, leaving the
  physical substrate (space, deposit slots, yields, danger, traits) intact for colonisation to grow into.
- `allocateIndustry` (`industry-seed.ts`) is the only producer of seeded industry, and after the zeroing only
  **homeworld** results survive. It returns `{ buildings, popCap, yieldMult }`:
  - `buildings`/`popCap` — the fractional-then-floored industry+housing (the bug).
  - `yieldMult` — per-resource **deposit grade** (mean quality of a system's deposit slots). This is retained
    for **every** system by the emergent-start pass and is **mechanically load-bearing**: it scales the output
    of any extractor a colony later builds on that substrate. It must survive.
- The seed-fill curve `popNorm = clamp(habitableSpace / HABITABLE_REF, 0, 1)` (`body-gen.ts`) feeds only the
  allocator's fill scaling — nothing else.

## Design

### 1. Realistic starting scale (uniform bump)

`SPACE_PER_SIZE` (`substrate-gen.ts`) scales **all** physical capacity uniformly — deposit slots, general
space, habitable space. Population, housing, labour, production, and consumption then all scale **linearly**
with it, so every economic ratio (self-sufficiency, staffing balance, price equilibrium) is preserved. Raise
it so a developed system reaches ~5 B:

- `SPACE_PER_SIZE`: **40 → 400** (≈10×). A size-1.0 body then carries ~250 habitable space → ~5000 pop cap;
  the existing `[0.5, 1.5]` size band gives a ~2.5–7.5 B spread.
- **Absolute-magnitude references must scale with it** (they normalise against the old pop/space magnitude):
  - `ECON_POP_HIGH`: **700 → 7000** (economy-type classifier's "high population" reference; display-only, kept
    correct until the economy-type removal PR lands).
  - `HABITABLE_REF`: **deleted, not scaled** — see §4 (the fill curve it feeds is removed).
- **Grep sweep** for any other absolute-pop / absolute-space threshold before committing; scale or note each.
  (Most pop-sensitive knobs — `maxOutflowFraction`, `gradientThreshold`, unrest 0–1, absorptive capacity as
  `demand − pop`, `COLONY_SEED_POP`'s tiny spark — are ratios/absolute-labour and are scale-invariant.)

This also advances an already-documented target: `universe-gen.test.ts` notes the `industrial`/`tech`/`core`
economy types are sparse-to-absent because full-fold population sits just under the gate, and names "lift the
population magnitude" as the P4 fix.

### 2. Home-system prefab

A new constant `HOME_SYSTEM_PREFAB` — an explicit **whole-integer** `{ buildings: Record<string, number>,
population: number }`, identical for every faction. Stamped onto each faction homeworld during world-gen,
right where `applyEmergentStartingCondition` runs: set `s.buildings = { ...HOME_SYSTEM_PREFAB.buildings }`,
`s.population = HOME_SYSTEM_PREFAB.population`, `popCap` derived from housing. Non-homeworlds stay zeroed.

**Sizing procedure** (produces the integers; frozen as the constant and locked by a self-sufficiency test):
for a target consuming population `P ≈ 5000`:
- **Tier-0 extractors** for the staples + recipe feeds — food, water, gas, ore, minerals, biomass, textiles.
  `count(g) = ceil( (perCapitaNeed(g) · P + Σ downstream recipe draw) / outputBase(g) )`. Counts are
  **scale-invariant** — `OUTPUT_PER_UNIT` and `GOOD_CONSUMPTION` both carry one `ECONOMY_SCALE` factor that
  cancels, so the integer stamp holds at any economy scale.
- **Tier-1 factories** for the core processed goods the galaxy currently lacks — fuel, metals, chemicals,
  medicine, components, polymers, consumer_goods, alloys — sized to civilian + recipe demand the same way.
- **A little tier-2** — electronics, machinery, luxuries — so a hub is not in permanent higher-tier deficit
  (feeds the skilled consumption baskets; luxuries appears only in the engineer basket).
- **Academies** — a vocational school + research institute sized to license the skill1/skill2 the factories
  draw (`skill1Demand`/`skill2Demand` of the stamp ÷ per-academy licence).
- **Housing** sized so `popCap = housingPopCap(buildings) ≥ labourDemand(buildings)`; seeded `population =
  popCap` (a full, staffed core). Housing provides 20 popCap/level; industry labour totals are 10 (T0) / 25
  (T1) / 60 (T2) per level, so housing levels ≈ `labourDemand / 20`.

**Invariants (unit-tested):** `labourDemand(buildings) ≤ housingPopCap(buildings)`; every extractor `count(g) ≤`
the guaranteed garden slot cap for its resource; `production(g) ≥ consumption(g)` for every good the population
consumes; all counts whole integers; every faction homeworld gets byte-identical `buildings` + `population`.

### 3. Guaranteed garden body

Each homeworld gets one deterministic **garden body** whose per-resource deposit slots, habitable space, and
general space are guaranteed `≥` the prefab's footprint, so the stamp always fits with **zero flooring or
scale-down**. The surrounding smaller bodies stay procedural (scenery + future expansion deposits). The garden
body's exact size/quality may vary *above* the guaranteed floor; the industry stamp is identical regardless.
Implementation injects/guarantees this body for `homeworldIndices` during body assembly (exact seam decided in
implementation — either a fixed garden body prepended to the homeworld's body list, or a floor on its largest
body's slots/space).

### 4. Delete the fractional allocator

The prefab makes the allocator's fill-driven allocation dead (homeworlds → prefab; others → zeroed):
- **Delete** `allocateIndustry` (allocate → scale-down → floor), `HABITABLE_REF`, the `POP_FILL_*` seed-fill
  curve, and the `fill` plumbing threaded into body-gen.
- **Preserve** the deposit-grade computation: extract `yieldMult` into a small **pure function** that reads a
  system's deposit grade straight off its bodies (quality-weighted mean of its deposit slots), independent of
  any fill or extractor placement — because it's mechanically needed for future extractor output. Today it's a
  byproduct of the seed fill (quality of the slots the seeding happened to fill); the extraction decouples it.

## Phases

- **Phase A — scale.** Bump `SPACE_PER_SIZE` (40→400) and `ECON_POP_HIGH` (700→7000); grep-sweep for other
  absolute-magnitude constants and handle each. Update the substrate/economy-type/gen tests' magnitude
  expectations. `tsc` + vitest green; a `npm run simulate` sanity pass at the new scale.
- **Phase B — deposit grade.** Extract the pure `yieldMult` deposit-grade function (fill-independent) with its
  own unit tests; route the existing yield consumers to it. No behaviour change yet (allocator still present).
- **Phase C — prefab + deletion.** Add `HOME_SYSTEM_PREFAB` (sized per §2) + a self-sufficiency unit test;
  stamp it in `universe-gen`; guarantee the garden body; delete `allocateIndustry`, `HABITABLE_REF`, the
  `POP_FILL_*` curve, and the `fill` plumbing.
- **Phase D — verify.** Gen tests (homeworld carries the prefab + a sufficient garden body; non-homeworlds
  zeroed; every faction identical). Sim: home worlds stable and self-supporting at ~5 B, colonies still
  bootstrap from the tiny seed at the new scale, the −6/−7 % decline shrinks toward an honest calibration
  target, `detectPingPong` does not worsen.

## Tests

- **Unit (prefab):** the §2 invariants — self-sufficiency (`production ≥ consumption` per consumed good),
  `labourDemand ≤ popCap`, extractor counts ≤ garden slot caps, whole integers, identical across factions.
- **Unit (deposit grade):** the extracted `yieldMult` function returns the quality-weighted deposit grade off
  bodies, independent of any fill; neutral (1.0) where a system has no slots for a resource.
- **Gen:** each homeworld has the garden body (slots/space ≥ prefab footprint) and the stamped prefab;
  non-homeworlds remain zeroed; the four substrate economy types still appear (now with the developed types
  present, given the lifted magnitude).
- **Sim (real tick):** the Phase-D outcomes above (coarse health bar, per the calibration convention).

## Done when

`tsc` clean, unit + sim green, `npx next build --webpack` clean; the sim shows identical, self-supporting
~5 B home worlds, colonies bootstrapping at the new scale, and an un-confounded decline reading — the honest
target the calibration PR then tunes.
