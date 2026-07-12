# Colony Bootstrapping — Build Plan

> Transient build plan for the colony-bootstrapping redesign. Implements
> [`docs/planned/economy-colony-bootstrapping.md`](../planned/economy-colony-bootstrapping.md) (design +
> the resolved §7 decisions). **Delete when the feature ships** — the functional spec moves to `docs/active/`
> and the code becomes the source of truth.

## Success criteria — the whole stream is "done when"

1. Colonies form and build **sensible first industries** (not import-everything).
2. Colonies **don't build things that immediately fail** because pops migrate away.
3. Colonies get a **reasonable, steady** stream of construction points.
4. The **local-industry-vs-imports spread is more even** — building beats importing-everything-and-stagnating.

Validated via the simulator (the real tick) plus unit tests per PR; final calibration (PR4) tunes coefficients
to hit all four at once. Coarse health bar only until PR4 — no premature precision.

## Approach

The **roadmap and sequencing are fixed here now; code-level detail is written just-in-time** — each PR's
detailed section is filled in immediately before we build it, so it reflects what actually shipped before it
(later PRs depend on the exact shapes earlier ones land). **PR1 and PR2 are detailed now; PR3–PR4 are outlined.**

Work lands on the shared feature branch `feat/economy-rework-base`; each PR is a phase branch squash/ff-merged
in (per the workflow conventions).

## Roadmap

- **PR1** — Build correctness + the development stat (+ development map mode)
- **PR2** — Job-aware population
- **PR3** — Colony seeding, pricing & budget fairness (may split 3a/3b)
- **PR4** — Calibration
- *(+ end-of-stream UI surfacing: migration statistics, employment state, pool-floor readouts, map polish)*

---

## PR1 — Build correctness + the development stat (+ dev map mode)

**Goal / outcomes:** colonies build sensible first industries instead of importing everything (outcomes 1 & 4);
introduce the per-system **development** primitive that PR3's pool floor also depends on; ship a development map
mode as the visual sanity-check on the new stat.

### 1. Per-system development stat (new primitive)

- New pure function `systemDevelopment(input, refs): number` → `0..1` (0 = raw frontier, ~1 = a system that has
  realised the galaxy's biggest natural potential — and then some). Home in `lib/engine/development.ts`.
- **Formula (built): an ABSOLUTE magnitude — how much a system has actually built and worked —
  soft-saturated against the UNIVERSE-WIDE reference (the galaxy's biggest natural potential), NOT a fill
  fraction of the system's own potential.** This follows how EU4 / EU5 (Project Caesar) / Victoria 3 all
  quantify development: magnitude and fill are *separate* signals, and development is always the absolute one;
  a self-normalised fill makes a tiny "full" colony read as developed (the naïve bug this replaced). Housing is
  excluded from both terms, so shells built ahead of population never inflate the reading.

  ```
  popTerm     = 1 − exp(−population / popRef)                      // resident pop vs galaxy's biggest habitable land
  indTerm     = 1 − exp(−staffedIndustry / industryRef)           // STAFFED industry vs galaxy's biggest footprint
  development = w_pop · popTerm  +  w_ind · indTerm                // w_pop + w_ind = 1; default 0.5/0.5, PR4-tuned
  ```

  where `staffedIndustry = (extractorLevels·footprint + non-housing general-space used) × labourFulfil`, and the
  `refs` are the universe-wide maxima from `developmentRefs(systems)` (see below).

- **Design intents baked in:**
  - *Absolute against the galaxy's ceiling, not the system's own.* A system that is "full" for its OWN size
    still has almost nothing measured against the biggest world, so most systems read near the bottom of the
    board even at max housing — realising your own potential is not high development, only realising the
    universe's max potential is. Intentional: the top is reserved for systems that later exceed natural
    potential (robots + special housing), and that is meant to take a long time.
  - *Soft-saturation, so the top is an unreachable ideal.* Even the biggest natural system, fully built to its
    own potential, sits at the soft-saturation knee (~0.63 per term), never at 1; the curve is most sensitive
    at the low end (so it discriminates among colonies) and compresses the top.
  - *Used, not built.* Industry is discounted by headcount staffing (`labourFulfil`), so idle-because-
    understaffed capacity is not development — an over-built colony reads low until pop staffs it.
  - *Housing-immune.* `popTerm` uses actual `population`, not built housing; housing is netted out of industry.
- **Barren-world edge case:** when there is no habitable land (`habitableSpace ≤ 0`, no population possible),
  drop the pop term and let `indTerm` carry the whole reading — a barren extraction colony's development *is*
  its extraction.
- **The universe reference** (`developmentRefs(systems)` in `lib/engine/development.ts`): `popRef` = the max
  `habitablePotentialPop` (habitable land packed with housing) across the galaxy; `industryRef` = the max
  `industryPotential` (every deposit slot worked + all general space as factory) across the galaxy. Derived
  from static substrate, so it is a per-world constant — recomputed cheaply per map read and per build pulse,
  and threaded in identically to both consumers so a system reads one development everywhere. `lib/constants/
  development.ts` keeps only the `w_pop` / `w_ind` weights (per-doctrine-ready, §4 rubric; default 50/50).
- The map mode (§4 below) is the validation surface — this is why it's in PR1. It reads systemDevelopment as
  an ABSOLUTE 0..1 value (no relative-to-visible-max normalisation).
- **Distinct from `SystemControl`.** `developed` is a one-way ownership gate; `systemDevelopment` is the
  continuous magnitude the redesign needs (§7.7b).

### 2. Flow-aware deficit cancellation (§3.1)

- Change `findStructuralDeficits` (`lib/engine/directed-build.ts:177-205`): replace the existence test
  (`exporters.some(reachable)`) with **coverage netting**.
- First cut, per good: `coveredFraction = min(1, Σ reachable-exporter-spare / Σ reachable-deficit)`; residual
  demand `= deficit·(1 − coveredFraction)` is structural → buildable locally. Use `surplusDrawable` (already
  used at `:459`) for exporter spare. `exporterSystemsByGood` gains a spare magnitude alongside `systemId`.
- Keep it O(goods·systems) — cheap enough for the per-pulse planner.

### 3. Development-scaled speculative local-industry nudge (§3.2)

- In the build planner, add a **bounded** impulse for undeveloped systems to stand up tier-0 local extraction
  from their **own deposits**, scaled by `(1 − systemDevelopment)` — strong when young, fading as it matures.
  Bounded (a floor, not autarky) so specialisation survives.
- Bias toward **un-repurposable basics** (food/water) per §7.7 — importing a basic you have a deposit for is
  pure waste.

### 4. Development map mode (UI)

- New map mode colouring systems by `systemDevelopment` (a sequential colour ramp + legend).
- **Data path: dynamic, tick-invalidated — not the static atlas.** Development changes as systems grow, so it
  rides a dynamic read path / tick-keyed query, consistent with visibility/dynamic map data. Verify against
  `docs/active/engineering/map-data-loading.md` at build start.
- Add the mode to the existing map-mode enum/toggle scaffolding; no bespoke map surface.

### Tests

- **Unit:** flow-aware cancellation leaves a residual structural deficit when exporter surplus only partly
  covers demand, and none when fully covered; the speculative nudge scales down as development rises;
  `systemDevelopment` is monotonic in population/industry and stays in `[0,1]`.
- **Sim (real tick):** mean colony industry-level floor rises vs baseline; the zero-industry-colony count
  drops; the import-everything share falls (outcomes 1 & 4).
- **Manual:** the dev map mode renders a sane gradient (homeworlds hot, frontier cold, colonies warming as
  they grow).

### Done when

Colonies build a sensible first-industry floor in the sim; the dev map mode is visually sane; unit + sim green;
`tsc` clean; `npx next build --webpack` clean.

---

## PR2 — Job-aware population

**Goal / outcomes:** outcome 2 (colonies don't build things that fail because pops migrate away; sim shows no
roller-coaster). Couple migration to jobs at **both endpoints** so (a) a colony with open jobs attracts pop,
(b) it fills at *its own* pace not the source's, and (c) *staffed* homeworld workers are not poached to seed a
merely-more-attractive colony. This is the prerequisite for PR3's seed-pop pricing: jobs must drive migration
before the seed can be priced against the source's forgone output.

Everything reads **one new threaded signal** — `labourDemand` (Σ heads the built base wants) — already
computed by `labourDemand(buildings)` in `lib/engine/industry.ts` (housing demands none). No change to
`industry.ts`; the gap (`demand − population`) is computed live in the pure migration engine, so it tracks the
intra-pulse population delta rather than a stale precomputed "openings".

### 1. Thread `labourDemand` to the migration engine (adapter derives, engine stays pure)

- `MigrationNode` (`lib/engine/migration.ts`) and `MigrationNodeView` (`lib/tick/world/migration-world.ts`)
  each gain **`labourDemand: number`**.
- `InMemoryMigrationWorld.getNodesForSystems` (`lib/tick/adapters/memory/migration.ts`) computes it via
  `labourDemand(s.buildings)` (import from `@/lib/engine/industry`). The adapter already holds full
  `SimSystem`s, so this is a one-line derive per node.
- The processor's `liveNode` (`lib/tick/processors/migration.ts`) passes `labourDemand` through **unchanged**
  (building-derived, static within a pulse) while `population` keeps its live intra-tick delta — so as pop
  arrives across several edges in one pulse, the remaining open jobs shrink correctly.

### 2. Jobs term in `migrationAttractiveness` (§7.5)

- `AttractivenessWeights` gains **`jobs: number`**.
- Formula (added to the existing contentment + headroom sum):
  ```
  jobGap   = node.labourDemand − node.population
  jobsTerm = (node.labourDemand > 0 || node.population > 0) ? jobGap / max(node.labourDemand, node.population) : 0
  attractiveness = w.contentment·(1 − unrest) + w.headroom·headroom + w.jobs·jobsTerm
  ```
- Bounded in [−1, 1] by construction (|numerator| ≤ denominator) — no magic constant. Open jobs → positive
  (pull); fully staffed → ~0; unemployment → negative (push).
- **"Jobless colonists drift out" is emergent, not a new rule:** a jobless colony (pop > demand) scores below
  its jobbed neighbours, so the existing conserved gradient flow carries the surplus toward openings. No
  change to the population growth/decline formula (out of scope for this PR; §7.5 is explicit there is no new
  "starve" rule).

### 3. Destination absorptive throttle (§7.4)

- In `migrationFlow`, after `dest` is resolved from the gradient direction, cap inflow at the destination's
  **open jobs** (live pop):
  ```
  absorptiveCapacity = max(0, dest.labourDemand − dest.population)
  ```
- Fold into the `quantity = min(...)`. `destHeadroom = max(0, dest.popCap − dest.population)` stays as the
  **housing hard cap** (overshoot bound); `absorptiveCapacity` is the usually-tighter **jobs cap**, so a
  colony fills to its openings at its own pace — this is the load-bearing fix for the overshoot→wither→leave
  roller-coaster. A fully-staffed colony (no openings) receives nobody.

### 4. Source two-tier draw — spare labour by default, staffed gated by a threshold (§7.4)

- `MigrationFlowParams` gains **`employedGradientThreshold: number`**.
- In `migrationFlow` (source = the less-attractive endpoint):
  ```
  sourceSpare      = max(0, source.population − source.labourDemand)          // idle workers — always drawable
  employed         = min(max(0, source.population), max(0, source.labourDemand))
  employedEligible = |gradient| > params.employedGradientThreshold ? employed : 0
  sourceDrawable   = sourceSpare + employedEligible
  quantity = max(0, min(outflow, sourceDrawable, source.population, destHeadroom, absorptiveCapacity))
  ```
  (`sourceDrawable ≤ source.population` always, so the existing `source.population` term is now a redundant
  safety belt — keep it.)
- **Three nested tiers**, monotonic in the appeal gap: `< gradientThreshold` → nobody moves (unchanged);
  `< employedGradientThreshold` → **only spare labour** moves; `≥ employedGradientThreshold` → spare +
  staffed move.
- **Default `employedGradientThreshold` is effectively unreachable** (above the max achievable appeal gap —
  with weights all 1 the gap tops out ~5), so out of the box `employedEligible = 0` and only spare labour is
  drawable ⇒ the hard source cap: staffed workers stay home. Represent "off" cleanly (a documented very-high
  constant); do **not** use `Infinity` — it is a code param, not world state, but keep the no-`Infinity`
  discipline and a finite sentinel reads more honestly.
- **Deferred (documented, not built): the player speed-dial.** Lowering `employedGradientThreshold` for chosen
  systems (a paid decision / currency cost) is the future player action that coaxes staffed workers toward a
  force-grown frontier (design doc §7.4 / #10). The *mechanism* ships here inert; the player-facing knob is a
  purely additive later change (a per-system threshold override + the decision surface + the cost). Because it
  ships tested (below), that later work is config + plumbing, not new flow logic.

### 5. Constants (`lib/constants/population.ts`)

- `MIGRATION_PARAMS.weights` gains **`jobs: 1`** (provisional; PR4 rebalances the contentment/headroom/jobs
  mix — `headroom` deliberately stays 1 here so PR2 is a pure addition, not a recalibration).
- `MIGRATION_PARAMS` gains **`employedGradientThreshold`** set to the unreachable default (staffed-migration
  off), with a comment naming it as the bar the future player knob lowers.

### Tests

- **Unit (`lib/engine/__tests__/migration.test.ts`):**
  - *Jobs term:* a jobbed node (`demand > pop`) scores above an equal jobless node (`demand = 0`); the term
    flips sign at `pop = demand`; `demand = pop = 0` yields 0 (no NaN).
  - *Destination throttle:* a big source flooding a small colony is capped at the colony's open jobs; a
    fully-staffed colony (no openings) receives nobody even when otherwise attractive.
  - *Source spare cap (default threshold):* a fully-staffed source (`sourceSpare = 0`) sends nobody even to a
    very attractive destination; a source with idle labour sends up to its spare.
  - *Source coax tier (low threshold — proves the future knob):* with a low `employedGradientThreshold`, a
    fully-staffed source **does** release staffed workers when `|gradient|` clears the bar, and **does not**
    below it. (Guards against the coax mechanism being untested dead code.)
  - *Update existing tests* to include `labourDemand` on each `MigrationNode`, choosing values that preserve
    each test's intent (the overshoot-source test gets ample spare labour; the headroom-cap test's destination
    gets ample open jobs so the absorptive cap isn't the binding constraint).
- **Sim (real tick, via the runner):** `detectPingPong` (`population-analysis.ts`) does not worsen and colony
  pop doesn't overshoot-then-collapse; `emptiedCount` / `growthPct` stay sane (coarse health bar). Spot-check
  that homeworlds aren't drained of *staffed* workers (source cap working). Outcome 2.

### Done when

Migration is job-aware at both endpoints: colonies fill to their open jobs at their own pace, staffed workers
stay home by default, and jobless pop drifts toward openings — all reading the one threaded `labourDemand`.
Unit + sim green; `tsc` clean; `npx next build --webpack` clean.

## PR3 — Colony bootstrapping: seeding, pricing, budget fairness, build gate & the pop pump

**Goal / outcomes:** outcomes 2 & 3 — colonies stop being founded off a drained homeworld, fund their first
builds, and actually *grow* rather than freezing at the seed. What shipped are **five** engine changes, all
reading primitives PR1/PR2 already shipped (`systemDevelopment`, `labourDemand`, job-aware migration):

1. **Tiny seed (§1)** — `COLONY_SEED_POP` stays **2**; the seed is a spark, not a transfer. It *works* (vs
   deadlocking) only because of the build gate + pop pump below — validated in the sim.
2. **Seed-pop opportunity-cost pricing (§2)** — founding prefers a job-short source over a busy one.
3. **Development-scaled pool fairness floor (§3)** — a young colony's first build beats the homeworld's fifth
   factory for construction points.
4. **Decay-consistent build gate / "one unit ahead" (§4)** — a 2-pop colony may build its first extractor even
   though it can't fully staff it, because decay only sheds a *whole* idle unit. Creates the jobs that let
   migration flow. **This was the load-bearing unlock** — without it the tiny seed can never create a job.
5. **Employed-migration leak / pop pump (§5)** — a small always-on fraction of a *saturated* core's staffed
   workers leaks toward job-rich colonies, so colonisation proceeds after home worlds fill up.

**Player-directed founding (§3.5) is deferred** — the pool floor is its substrate (see the note near the end).

The bootstrapping loop this closes (each piece removes one break): a **tiny cheap seed** lands → the **build
gate** lets its 2 pops stand up a first extractor (PR1's speculative floor proposes it, the **pool floor**
funds it) → those jobs lift `labourDemand` → PR2's absorptive throttle opens *and* the **pop pump** supplies
the pop → the colony grows and ratchets up more industry. The diagnostic story behind why all five are needed
— and what we deliberately left for PR4 — is in **"Findings & deferred"** below.

### 1. Seed model C — a tiny seed the job-aware loop grows (§7.1)

- `EXPANSION.COLONY_SEED_POP`: **50 → 2**. The seed is now a bootstrap spark, not a population transfer; PR2's
  job-aware migration is what grows the colony once its first jobs appear. A big seed was the deadlock's other
  half — it dumped pops on a jobless world faster than jobs could form, and drained the source.
- **No mechanical change to `applyDevelopments` (`tick.ts`) or the sizing in `planFactionColonyProposals`.**
  Both already conserve-move `min(seedPop, source-available)` and size bundled housing to
  `ceil(seedPop / POP_CENTRE_DENSITY)` whole levels (so `popCap ≥ seedPop` on arrival). At `seedPop = 2` that
  is one housing level — the rest of the colony's housing comes from the proactive housing pass once it is
  fed-and-calm, exactly as the model intends (housing leads).
- **"Drawn from the source's unemployed first" is realised by the pricing (§2 below), not a hard cap** — a
  source with spare labour costs ~nothing to seed from, so the AI naturally pulls the tiny seed from
  job-short sources. A mechanical "only draw idle pop" cap on a 2-pop seed would be noise; the pricing carries
  the intent.

### 2. Seed-population opportunity-cost pricing (§3.3 / §7.2 / §7.3)

Net the seed's **forgone source output** into the colony's value on the **benefit** side (§7.3) — keeping
`work` a pure construction-points denominator, no invented exchange rate. In `planFactionColonyProposals`
(`directed-build.ts`), the source system is already in the `developed: BuildSystemState[]` input (the develop
provider only offers a candidate whose `sourceSystemId` is a developed same-faction system), so **no new
plumbing in `tick.ts`** — look it up by `sourceSystemId`:

```
sourceSpare     = max(0, sourcePop − labourDemand(source.buildings))     // idle workers ≈ free to move
employedSeed    = max(0, seedPop − sourceSpare)                          // the part that must poach staffed workers
sourceStaffed   = max(1, min(sourcePop, labourDemand(source.buildings))) // avoid /0
outputPerWorker = Σ max(0, source.good.production) / sourceStaffed       // source output density (goods/tick)
popCost         = params.popCostWeight · employedSeed · outputPerWorker
value           = colonyValue(candidate, unblocked, σ, params) − popCost
```

- A colony whose `value ≤ 0` after the cost is **not proposed** (net-negative — its worth doesn't clear the
  labour it would drain). Otherwise it competes on `value / establishWork` as today.
- **The bias falls out:** a job-short source (`sourceSpare ≥ 2`) → `employedSeed = 0` → `popCost = 0` → full
  colony value; a fully-staffed productive source → `employedSeed > 0` and a high `outputPerWorker` →
  `popCost` bites → the AI stops draining a busy core. This is "the source's forgone output, **not** a flat
  number" (§7.2) — `outputPerWorker` is the source's real output density, so poaching from a dense homeworld
  costs more than from a sparse frontier.
- New tunable `COLONISATION.SEED_POP_COST_WEIGHT` (default 1.0) → `ColonyEstablishParams.popCostWeight`. It
  bridges the pop cost into the value scalar and is the per-doctrine dial (§4 rubric); PR4 calibrates it
  against `LAND_PREMIUM`/`σ`. `production` is `?? 0` (engine-test fixtures may omit it; the live/sim path
  always supplies it via `toGoodMarketStates`).

### 3. Development-scaled pool fairness floor (§3.4 / §7.9)

The pool drains strictly front-first by ROI, so a homeworld's larger builds monopolise it and a young
colony's valid-but-low-ROI first extractor never funds. Reserve a **development-scaled minimum slice** for
young colonies' build proposals — biggest for the youngest, self-weaning to nothing as they mature — then the
homeworld drains the remainder by value as today. A *minimum*, **not** a max-spend cap (a cap throttles
legitimate high-value homeworld builds and wastes budget — §7.9).

- **New pure `fundQueueWithFloor(ordered, pool, cap, reserved, isFloorEligible)` in `construction.ts`**
  (leaves `fundQueue` untouched for `forecastEtaPulses`), returning the same `{ projects, landed }`. Two
  passes over the one ordered queue:
  - **Pass A** funds only the floor-eligible projects, front-first, from `reserved` (tracking each project's
    absorbed-this-pulse).
  - **Pass B** funds the *whole* queue in ROI order from `pool − (reserved actually spent in A)`, each project
    capped at `cap − absorbedInA` — so the per-pulse absorption cap (the build-time floor) is preserved across
    both passes, and **unspent reserve flows back to the general pool** (no wasted budget). `reserved = 0`
    makes it byte-identical to `fundQueue`.
- **In the processor (`runDirectedBuildProcessor`)**, per developed system compute
  `dev = systemDevelopment(state, refs)` (refs already fetched for the speculative nudge) and
  `floorShare(dev) = POOL_FLOOR_BASE · max(0, 1 − dev / FLOOR_DEV_KNEE)` — a smooth self-weaning curve, zero
  once a system's development clears the knee (so **homeworlds, the most-developed systems, reserve nothing**
  — no colony flag needed, development does the discriminating). `reserved = Σ floorShare` over developed
  systems; `isFloorEligible(p) = p.kind === "build" && floorShareBySystem.get(p.systemId) > 0`. Swap the
  single `fundQueue(...)` call for `fundQueueWithFloor(...)`.
- New tunables `CONSTRUCTION.POOL_FLOOR_BASE` (max reserved points per young colony) and
  `CONSTRUCTION.FLOOR_DEV_KNEE` (development at which the floor fully weans off), PR4-calibrated.
- **Known readout approximation (deferred, not a PR3 bug):** `forecastEtaPulses` (the faction-construction
  ETA) still forward-sims plain `fundQueue`, so a colony row's `≈N pulses` won't reflect the floor's
  reallocation. The ETA is already documented as a coarse estimate (the bar/percent stay exact); threading the
  floor into it needs dev-refs in the read service and belongs in the end-of-stream "pool-floor readouts" UI
  pass (§5), not here.

### 4. Decay-consistent build gate — "one production-unit ahead of staffing"

The original planner gate refused to build any level it couldn't **fully** staff (`labourNeeded ≤ spareLabour`).
That is *stricter than decay requires*: infrastructure decay only sheds a level when a **whole** unit is idle
(`idleLevels = floor(count − used) ≥ 1`, `infrastructure-decay.ts`), so a single partially-staffed unit is
safe. A 2-pop colony therefore *could* run a 20 %-staffed 10-labour extractor with no decay — the planner just
wouldn't build it, and the colony deadlocked (no pop to staff → no build → no jobs → no migration inflow).

- In `planFactionBundles`'s per-opportunity fit, replace the spare-labour test with a **total-demand** gate:
  `labourDemand(site.buildings) + labourNeeded < site.population + prodLabourPerUnit`. Strict `<` keeps the lead
  unit only *fractionally* idle (< 1 whole unit ⇒ decay-safe) and refuses to build on a pop-0 world; gating
  total demand (not `max(0)`-floored spare) bounds the lead across opportunities so it can't stack into
  multi-unit — decaying — under-staffing. For round-number spare (exact multiples of a unit's labour) this
  reproduces the old result; the one-unit lead only appears for the fractional-pop case colonies live in.
- Effect: the tiny seed can stand up its first extractor, whose jobs then open the absorptive cap and pull
  migration. **This is the load-bearing unlock** — the other four pieces are inert without it.

### 5. Employed-migration leak — the pop pump (relaxes the PR2 source cap)

PR2 let *only spare (idle) labour* migrate (`employedGradientThreshold` unreachable). But home worlds saturate
to ~0 spare early (the build planner employs their pop), so migration to colonies stalls the moment colonies
have jobs to receive it. Add a small **always-on leak** of *staffed* workers toward strongly-attractive
destinations:

- `MigrationFlowParams` gains `employedLeakFraction`; `MIGRATION_PARAMS.employedLeakFraction = 0.02`
  (coarse). In `migrationFlow`, below `employedGradientThreshold` the employed pool is drawable at
  `employedLeakFraction × employed` (instead of 0); above the threshold the whole pool still unlocks (the
  future player speed-dial).
- Effect: a saturated core still feeds job-rich colonies a steady 2 % trickle → colonies grow past the seed.
  This is what turns the *tiny seed* into a working "seed + migration grows it" model (§7.1's intent). Existing
  PR2 source-cap tests set `employedLeakFraction: 0` to preserve their spare-only intent; a new test covers the
  leak.

### Deferred — player-directed founding (§3.5 / §7.8)

Founding a colony by hand needs a **player seat**, which is not built (the viewpoint is the whole galaxy;
picking a faction is planned). So this ships documented-but-deferred, exactly as PR2 deferred the migration
"speed-dial": the **development-scaled pool floor above is its mechanism** — §3.5 defines a player pin as "a
fairness floor the player sets by hand", so player-founding becomes a purely additive later piece (a
per-system floor override the player sets to `∞`-equivalent + a queue-injection surface + the automation
toggle) once the seat exists. Nothing here forecloses it.

### Tests

- **Unit (`colonisation-value.test.ts` / `directed-build.test.ts`):** seed-pop cost is 0 when the source has
  spare labour ≥ the seed, and positive when the source is fully staffed; a fully-staffed dense source's
  colony ranks below an equal candidate seeded from a job-short source; a colony whose value goes ≤ 0 after
  the cost is not proposed; a candidate with no spare-labour deficit at either end is unchanged.
- **Unit (`construction.test.ts`):** `fundQueueWithFloor` gives an eligible young-colony build ≥ its reserved
  share even when a higher-ROI homeworld build sits ahead of it; `reserved = 0` reproduces `fundQueue`
  exactly; unspent reserve funds the general queue (no waste); a project's total absorption this pulse never
  exceeds `cap` across both passes; `floorShare` weans to 0 at `dev = FLOOR_DEV_KNEE`.
- **Unit (`expansion.test.ts`):** `COLONY_SEED_POP` is small — a guard against it silently regrowing.
- **Unit (`directed-build.test.ts`):** a 2-pop developed system builds exactly **one** first extractor (one
  unit ahead of full staffing); the strict `<` refuses a second level and refuses to build on a pop-0 world.
- **Unit (`migration.test.ts`):** with `employedLeakFraction > 0` a fully-staffed source (spare 0) sends a
  small fraction of its staffed workers to an attractive destination; with `0` it sends nobody.
- **Sim (real tick):** colony population **grows past the seed** (probe: mean 2 → ~7 over ~500 ticks, all
  colonies building), `colony.withTier0` rises, `colony.populatedButNoIndustry` drops, and the source is not
  over-drained (home worlds lose *less* pop than with a fat seed); `detectPingPong` does not worsen.

### Findings & deferred to PR4

This PR's real output was **diagnosis**. What we confirmed, and what we deliberately left for PR4:

- **The tiny seed alone deadlocks** — 2 pop can't staff a 10-labour extractor, and PR2's job-gated migration
  can't rescue a colony with no jobs. The fix needed the build gate (§4) *and* the pop pump (§5) together; with
  both, the tiny seed works. Kept the tiny seed (it drains the source less than a fat one).
- **The −6/−7 % galaxy pop decline is homeworld-driven, not colony-driven** — home worlds accumulate unrest
  (~0.09 → ~0.26) from a chronic higher-tier goods deficit; colonies are unhappy too but far too small to move
  the total. **So the galaxy-total-pop metric is a bad yardstick for colony work — PR4 must judge colonies on
  colony-specific metrics** (`summarizeColonisation`, colony pop trajectory), not the total.
- **World-gen seeds NO tier-1 industry anywhere (a bug, not calibration).** `industry-seed.ts` places tier-1
  factories at fractional counts (~0.1–0.9 levels) — the staffing-consistency step scales all industry down to
  fit a deliberately-under-seeded housing budget, and step 3c's `Math.floor` then rounds every tier-1 to **0**
  (extractors survive as larger counts). Consequences: (a) the galaxy starts extraction-only → the higher-tier
  deficit that drives the decline; (b) housing is sized for the *pre-floor* labour (incl. the deleted tier-1),
  so `popCap ≫ post-floor labourDemand` → the large **early homeworld unemployment** (≈2200 spare at t≈100)
  that the build planner then slowly re-employs. **Fix direction:** reserve labour/space for whole-level
  manufacturing (e.g. seed the dominant tier-1 family as ≥1 whole level) *before* extractors consume the
  budget, rather than placing extractors-first and flooring the remainder. **A distinct world-gen fix — do it
  first in PR4 so the decline reading is un-confounded.**
- **Colony growth is slow** (mean ~7 of ~130 cap over 500 ticks). Acceptable as "slow colonisation" for now;
  the speed is a value-tuning question (seed / `employedLeakFraction` / build-gate lead / growth rate).
- **Development-scaled unrest sensitivity** (frontier tolerates scarcity, hubs don't) — a coherent idea raised
  for the decline, but the decline concentrates on high-development home worlds, so the seeding/supply lever is
  the bigger one. Consider in PR4; S3 already does the "young systems demand less" half.

### Done when

The four success criteria all trend correctly in the sim (coarse health bar), unit + sim green, `tsc` clean,
`npx next build --webpack` clean. **Shipped at coarse first-cut values; final coefficient tuning is PR4.**

## PR4 — Calibration + seeding fix *(outline — detail JIT)*

Sequenced deliberately so the sim readings aren't confounded (see PR3 "Findings"):

1. **Fix the tier-1 seeding bug FIRST** (`industry-seed.ts`) — reserve labour/space for whole-level
   manufacturing before extractors consume the budget, so the galaxy seeds with a manufacturing base instead of
   extraction-only. This removes the chronic higher-tier deficit *and* the early homeworld unemployment, so the
   pop-decline signal becomes an honest calibration target rather than a bug artifact. Re-measure the decline
   after this lands.
2. **Judge colonies on colony-specific metrics** — extend `summarizeColonisation` / the probe (colony pop
   trajectory + variance, colony industry breadth, local-vs-import share), NOT the galaxy pop total.
3. **Tune the coarse coefficients** together: `COLONY_SEED_POP`, `SEED_POP_COST_WEIGHT`, `POOL_FLOOR_BASE`,
   `FLOOR_DEV_KNEE`, `employedLeakFraction`, the build-gate lead, `DIRECTED_BUILD.SPECULATIVE_FLOOR`, migration
   weights, and the growth/decline rates — to hit all four success criteria simultaneously (colonies form,
   build sensibly, fund steadily, grow at a reasonable pace without over-draining the core).
4. **Consider a development-scaled unrest sensitivity** (frontier tolerates scarcity, hubs don't) if the
   decline persists after (1) — but the seeding fix is expected to be the bigger lever.

Coarse health bar per the calibration convention — precision tuning is perishable and deferred.
